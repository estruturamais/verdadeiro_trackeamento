#!/usr/bin/env node
//
// Semeadura da base legada de assinaturas (SUBS-9).
//
// POR QUE ESTE PASSO NAO PODE SER PULADO
// Se a tabela `subscriptions` comecar vazia num negocio que JA tem assinantes, a
// primeira cobranca de cada assinante antigo e classificada como AQUISICAO — um pico
// fantasma de "clientes novos" no primeiro ciclo, que envenena a otimizacao e o CAC
// do relatorio. E a reativacao de quem cancelou antes de o VT existir fica invisivel
// para sempre, porque nao ha registro do cancelamento.
//
// Por isso o CSV precisa incluir os CANCELADOS. Sao eles que fazem a reativacao
// funcionar — importar so os ativos resolve metade do problema.
//
// USO
//   node scripts/import-subscriptions.mjs --csv=clientes.csv --site-id=meu-site --gateway=ticto
//   npm run subs:import -- --csv=clientes.csv --site-id=meu-site --gateway=ticto
//
// Gera `subscriptions-import.sql` (ou o caminho de --out). Depois:
//   wrangler d1 execute tracking_db --file=./subscriptions-import.sql --remote
//
// O SQL usa ON CONFLICT DO NOTHING: rodar duas vezes NAO duplica nem sobrescreve o
// que o webhook ja gravou — o dado vivo sempre vence o import.
//
// COLUNAS DO CSV (cabecalho na 1a linha; a deteccao e por nome, em pt ou en, e
// aceita variacoes comuns de cada gateway):
//   subscription_id  <- id/codigo da assinatura, do PEDIDO ou do assinante  (OBRIGATORIO)
//   email            <- e-mail do assinante                                 (recomendado)
//   status           <- Ativa / Atrasada / Cancelada / active / canceled     (recomendado)
//   plan             <- nome do plano/oferta
//   phone            <- telefone
//   charges_paid     <- numero de cobrancas ja pagas
//   first_charge_at  <- data da 1a cobranca
//
// Status NAO precisa de normalizacao: o classificador compara case-insensitive por
// prefixo 'cancel', o que cobre "Cancelada", "cancelado" e "canceled" de uma vez.

import { readFileSync, writeFileSync } from 'node:fs';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

function morrer(msg) {
  console.error('\nERRO: ' + msg + '\n');
  console.error('Uso: node scripts/import-subscriptions.mjs --csv=arquivo.csv --site-id=meu-site --gateway=ticto [--out=subscriptions-import.sql] [--dry-run]\n');
  process.exit(1);
}

const csvPath = args.csv;
const siteId = args['site-id'];
const gateway = args.gateway;
const outPath = args.out || 'subscriptions-import.sql';

if (!csvPath) morrer('faltou --csv=caminho/do/arquivo.csv');
if (!siteId) morrer('faltou --site-id (o mesmo `site_id` do SITE_CONFIG — se nao bater, o lookup nunca acha a linha)');
if (!gateway) morrer('faltou --gateway (ticto, hotmart, ...). Um CSV por gateway: o mesmo assinante pode existir nos dois.');

// ---------------------------------------------------------------- leitura do CSV
// Parser de CSV com aspas e separador auto-detectado (`,` ou `;` — export brasileiro
// costuma vir com ponto e virgula).
function lerCsv(texto) {
  const limpo = texto.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const primeiraLinha = limpo.split('\n')[0] || '';
  const sep = (primeiraLinha.split(';').length > primeiraLinha.split(',').length) ? ';' : ',';

  const linhas = [];
  let campo = '';
  let linha = [];
  let dentroDeAspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (limpo[i + 1] === '"') { campo += '"'; i++; } else { dentroDeAspas = false; }
      } else { campo += c; }
    } else if (c === '"') { dentroDeAspas = true; }
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else { campo += c; }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => String(c).trim() !== ''));
}

// Nomes de coluna aceitos por campo (comparados sem acento, sem espaco e em minusculas).
const SINONIMOS = {
  subscription_id: ['subscriptionid', 'idassinatura', 'assinaturaid', 'codigoassinatura', 'codigodaassinatura',
    'codigodopedido', 'codigopedido', 'idpedido', 'pedido', 'orderhash', 'hash', 'subscribercode',
    'codigoassinante', 'codigodoassinante', 'id', 'codigo'],
  email: ['email', 'emailcomprador', 'emailassinante', 'emaildocliente', 'comprador', 'cliente'],
  status: ['status', 'situacao', 'statusassinatura', 'situacaoassinatura', 'estado'],
  plan: ['plan', 'plano', 'oferta', 'offer', 'produto', 'nomedoplano', 'nomedaoferta'],
  phone: ['phone', 'telefone', 'celular', 'whatsapp', 'fone'],
  charges_paid: ['chargespaid', 'cobrancas', 'cobrancaspagas', 'parcelaspagas', 'faturaspagas', 'successfulcharges'],
  first_charge_at: ['firstchargeat', 'datadaprimeiracobranca', 'primeiracobranca', 'datacompra', 'datadeinicio',
    'inicio', 'dataadesao', 'createdat', 'datacriacao']
};

const chave = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const linhas = lerCsv(readFileSync(csvPath, 'utf8'));
if (linhas.length < 2) morrer(`o CSV "${csvPath}" nao tem cabecalho + ao menos uma linha de dados`);

const cabecalho = linhas[0].map(chave);
const indice = {};
for (const campo of Object.keys(SINONIMOS)) {
  const i = cabecalho.findIndex((h) => SINONIMOS[campo].indexOf(h) !== -1);
  if (i !== -1) indice[campo] = i;
}

if (indice.subscription_id === undefined) {
  morrer('nao encontrei a coluna do ID da assinatura no cabecalho.\n'
    + '  Colunas lidas: ' + linhas[0].join(' | ') + '\n'
    + '  Renomeie a coluna do identificador para `subscription_id` e rode de novo.\n'
    + '  ATENCAO: e o id do CONTRATO (estavel em todas as cobrancas — na Ticto, o "Codigo do Pedido"),\n'
    + '  NUNCA o da transacao/fatura, que muda a cada cobranca.');
}
if (indice.status === undefined) {
  console.warn('AVISO: sem coluna de status. Todas as linhas entrarao como "active" — os CANCELADOS\n'
    + '  serao importados como ativos e a REATIVACAO nunca sera detectada para eles.\n'
    + '  Se o CSV tiver os cancelados, adicione a coluna de status antes de continuar.');
}

const esc = (v) => "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'";
const pega = (linha, campo) => (indice[campo] === undefined ? '' : String(linha[indice[campo]] || '').trim());

const vistos = new Set();
const valores = [];
let ignoradasSemId = 0;
let duplicadasNoCsv = 0;
let canceladas = 0;

for (const linha of linhas.slice(1)) {
  const subId = pega(linha, 'subscription_id');
  if (!subId) { ignoradasSemId++; continue; }
  if (vistos.has(subId)) { duplicadasNoCsv++; continue; }
  vistos.add(subId);

  const status = pega(linha, 'status') || 'active';
  if (status.toLowerCase().startsWith('cancel')) canceladas++;
  const cobrancas = parseInt(pega(linha, 'charges_paid'), 10);

  valores.push('(' + [
    esc(siteId),
    esc(gateway),
    esc(subId),
    esc(pega(linha, 'email').trim().toLowerCase()),
    esc(pega(linha, 'phone').replace(/\D/g, '')),
    esc(pega(linha, 'plan')),
    Number.isFinite(cobrancas) && cobrancas > 0 ? cobrancas : 1,
    esc(status),
    esc(pega(linha, 'first_charge_at')),
    "'legacy_import'"
  ].join(', ') + ')');
}

if (!valores.length) morrer('nenhuma linha valida no CSV (todas sem ID de assinatura)');

// Lotes: o D1 tem limite de tamanho por statement.
const LOTE = 200;
const partes = [
  '-- Semeadura da base legada de assinaturas',
  `-- origem: ${csvPath}`,
  `-- site_id: ${siteId} | gateway: ${gateway} | linhas: ${valores.length} (${canceladas} canceladas)`,
  '--',
  '-- Pre-requisito: migrations/004_add_subscriptions_table.sql ja aplicada.',
  '-- Aplicar:  wrangler d1 execute tracking_db --file=./' + outPath + ' --remote',
  '--',
  '-- ON CONFLICT DO NOTHING: rodar de novo nao duplica nem sobrescreve o que o webhook',
  '-- ja gravou — o dado vivo sempre vence o import.',
  ''
];
for (let i = 0; i < valores.length; i += LOTE) {
  partes.push(
    'INSERT INTO subscriptions',
    '  (site_id, gateway, subscription_id, email, phone, plan, charges_paid, status, first_charge_at, origin)',
    'VALUES',
    valores.slice(i, i + LOTE).join(',\n'),
    'ON CONFLICT (site_id, gateway, subscription_id) DO NOTHING;',
    ''
  );
}
const sql = partes.join('\n');

if (args['dry-run']) {
  console.log(sql.split('\n').slice(0, 25).join('\n'));
  console.log('\n... (--dry-run: nada gravado)');
} else {
  writeFileSync(outPath, sql, 'utf8');
}

console.log(`\n${valores.length} assinaturas prontas para importar (${canceladas} canceladas, ${valores.length - canceladas} ativas)`);
if (ignoradasSemId) console.log(`${ignoradasSemId} linha(s) ignorada(s) por nao ter ID de assinatura`);
if (duplicadasNoCsv) console.log(`${duplicadasNoCsv} linha(s) duplicada(s) no proprio CSV (mantida a primeira)`);
if (!canceladas) {
  console.log('\nATENCAO: nenhuma assinatura CANCELADA no arquivo. Se o negocio tem churn, peca o export');
  console.log('  incluindo os cancelados — sem eles a REATIVACAO (win-back) nunca sera detectada.');
}
if (!args['dry-run']) {
  console.log(`\nArquivo gerado: ${outPath}`);
  console.log('Aplique com:');
  console.log(`  wrangler d1 execute tracking_db --file=./${outPath} --remote`);
  console.log('\nConfira depois:');
  console.log(`  wrangler d1 execute tracking_db --remote --command "SELECT status, COUNT(*) FROM subscriptions WHERE origin='legacy_import' GROUP BY status"`);
}

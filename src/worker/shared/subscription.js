// Assinaturas (SaaS/recorrencia) — decide se uma cobranca aprovada e AQUISICAO
// (cliente novo), RENOVACAO (cobranca recorrente) ou REATIVACAO (cliente que
// cancelou e voltou). Opt-in por SITE_CONFIG.subscription_tracking.
//
// Fonte de verdade: o payload do gateway decide; a tabela `subscriptions`
// (migrations/004) confirma e cobre o legado — assinantes anteriores ao tracking
// entram por import de CSV (origin='legacy_import', status em pt: 'Ativa' /
// 'Atrasada' / 'Cancelada'; linhas novas gravam em en: 'active' / 'canceled').
// Por isso toda comparacao de status e case-insensitive por prefixo 'cancel'.
//
// IMPORTANTE: esta tabela NAO tem retencao — o cleanup diario nao pode toca-la.
// Perder o historico faz todo assinante antigo voltar a contar como cliente novo.

import { dbWrite } from './db-write.js';

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const COMANDO_MIGRACAO =
  'wrangler d1 execute tracking_db --file=./migrations/004_add_subscriptions_table.sql --remote';

// ---------------------------------------------------------------------------
// Guard de tabela ausente (mesma licao do GADS-13, em `store/user-store.js`)
//
// Ligar `subscription_tracking` sem rodar a migration 004 faz o D1 responder
// "no such table: subscriptions" — prefixado com D1_ERROR. E 'D1_ERROR' esta em
// DB_FULL_PATTERNS (shared/db-write.js): o dbWrite leria isso como BANCO CHEIO e
// rodaria runCleanup(force) — DESTRUTIVO — a cada webhook, apagando dado por um
// erro de schema. Por isso nenhum erro de tabela ausente pode chegar ao dbWrite.
//
// Comportamento: a primeira ocorrencia marca a capacidade como ausente no escopo
// do modulo, avisa UMA vez com o comando exato, e daqui em diante o modulo
// curto-circuita — o webhook segue enviando `Purchase` normalmente, sem assinatura.
// Um isolate novo (depois da migration) volta sozinho ao caminho completo, sem
// precisar de novo deploy.
// ---------------------------------------------------------------------------
let _tabelaOk = true;
let _avisou = false;

function tabelaAusente(err) {
  const msg = String(err?.message || '');
  return msg.includes('no such table: subscriptions')
    || msg.includes('no such table: main.subscriptions');
}

function marcarTabelaAusente() {
  _tabelaOk = false;
  if (_avisou) return;
  _avisou = true;
  console.warn(
    '[subscriptions] `subscription_tracking` esta ligado no SITE_CONFIG, mas a tabela '
    + '`subscriptions` nao existe neste banco. O tracking segue normal (toda cobranca sai '
    + 'como Purchase), mas nao ha classificacao new/renewal/reactivation — ou seja, '
    + 'renovacao esta contando como cliente novo. Rode: ' + COMANDO_MIGRACAO
  );
}

// SELECT protegido: devolve null (em vez de lancar) quando a tabela nao existe.
async function consultar(executar) {
  if (!_tabelaOk) return null;
  try {
    return await executar();
  } catch (err) {
    if (!tabelaAusente(err)) throw err;
    marcarTabelaAusente();
    return null;
  }
}

// Escrita protegida: o erro de tabela ausente e absorvido ANTES do dbWrite, para
// que ele nunca o confunda com banco cheio. Qualquer outro erro segue o caminho
// normal do dbWrite (cleanup + retry em banco cheio; re-lancado nos demais casos).
async function escrever(db, env, label, executar) {
  if (!_tabelaOk) return null;
  return dbWrite(db, async () => {
    try {
      return await executar();
    } catch (err) {
      if (!tabelaAusente(err)) throw err;
      marcarTabelaAusente();
      return null;
    }
  }, label, env);
}

// Exposto so para o harness de verificacao poder reiniciar o estado do modulo.
export function _resetEstadoAssinatura() {
  _tabelaOk = true;
  _avisou = false;
}

// ---------------------------------------------------------------------------
// Configuracao: booleano simples ou objeto com as listas de produto
// ---------------------------------------------------------------------------

function listaDeIds(valor) {
  if (!Array.isArray(valor)) return [];
  return valor.map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
}

// Aceita as duas formas:
//   "subscription_tracking": true                       (todo produto do painel e assinatura)
//   "subscription_tracking": { "enabled": true,
//                              "product_ids": ["123"],          <- os que SAO SaaS
//                              "product_ids_avulso": ["999"] }  <- os que NAO sao
// => { enabled, ids, idsAvulso }
export function subscriptionConfig(config) {
  const vazio = { enabled: false, ids: [], idsAvulso: [] };
  const raw = config?.subscription_tracking;
  if (raw === true) return { enabled: true, ids: [], idsAvulso: [] };
  // Erro de digitacao classico no SITE_CONFIG (booleano entre aspas). Aceitar em
  // silencio seria pior do que aceitar avisando — e ignorar em silencio, pior ainda.
  if (raw === 'true') {
    console.warn('[subscriptions] subscription_tracking veio como a STRING "true" no SITE_CONFIG. '
      + 'Tratando como ligado, mas corrija para o booleano true (sem aspas).');
    return { enabled: true, ids: [], idsAvulso: [] };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.enabled !== true) return vazio;
    return {
      enabled: true,
      ids: listaDeIds(raw.product_ids),
      idsAvulso: listaDeIds(raw.product_ids_avulso)
    };
  }
  return vazio;
}

// PROJETO MISTO: parte dos produtos e SaaS, parte e compra avulsa no MESMO painel.
// Precedencia: as listas do config MANDAM quando informadas; sem listas, decide o
// sinal do payload (o parser so preenche subscription_id quando a oferta e
// recorrente — ex.: a Ticto olha `offer.is_subscription`).
//
// => { saas, motivo, aviso }. `aviso` nao-vazio vira linha acionavel no D1: um id
// que nao esta em nenhuma das listas, ou uma divergencia entre lista e payload,
// nunca pode ser decidido no escuro.
export function resolveProductMode(subCfg, webhookData) {
  const pid = String(webhookData?.product_id || '').trim();
  const temSubId = !!String(webhookData?.subscription_id || '').trim();

  if (pid && subCfg.idsAvulso.indexOf(pid) !== -1) {
    return { saas: false, motivo: 'lista_avulso', aviso: '' };
  }

  if (subCfg.ids.length) {
    if (pid && subCfg.ids.indexOf(pid) !== -1) {
      return {
        saas: true,
        motivo: 'lista_saas',
        aviso: temSubId ? '' : (
          'subscription_id_ausente_em_produto_saas: o product_id ' + pid + ' esta em '
          + 'subscription_tracking.product_ids, mas o parser deste gateway nao devolveu '
          + 'subscription_id — a cobranca saiu como Purchase. Ou a oferta nao esta marcada '
          + 'como recorrente no painel do gateway, ou o gateway ainda nao tem a recorrencia '
          + 'mapeada (so Ticto e Hotmart tem). Ver .claude/skills/new-gateway/SKILL.md'
        )
      };
    }
    return {
      saas: false,
      motivo: 'id_fora_das_listas',
      aviso: (
        'product_id_nao_classificado: ' + (pid || '(vazio)') + ' nao esta em '
        + 'subscription_tracking.product_ids nem em product_ids_avulso. Tratado como compra '
        + 'unica (Purchase). Classifique o id numa das duas listas do SITE_CONFIG para a '
        + 'decisao deixar de depender do default'
      )
    };
  }

  return { saas: temSubId, motivo: 'sinal_payload', aviso: '' };
}

// ---------------------------------------------------------------------------
// Classificacao da cobranca
// ---------------------------------------------------------------------------

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isCanceled(status) {
  return String(status || '').toLowerCase().startsWith('cancel');
}

// => { billing_type: 'new' | 'renewal' | 'reactivation' } ou null (sem subscription_id
// ou sem a tabela — nos dois casos o webhook segue como Purchase normal).
export async function resolveSubscriptionBilling(db, siteId, gateway, webhookData) {
  const subId = String(webhookData.subscription_id || '');
  if (!subId || !_tabelaOk) return null;

  // 1. Assinatura ja conhecida (webhook anterior ou import legado)?
  const row = await consultar(() => db.prepare(
    'SELECT status FROM subscriptions WHERE site_id = ? AND gateway = ? AND subscription_id = ? LIMIT 1'
  ).bind(siteId, gateway, subId).first());
  if (!_tabelaOk) return null;

  // 1b. Cancelada na tabela vence qualquer hint: retomada/nova cobranca de quem
  // cancelou e' REATIVACAO (mesmo que o contador do gateway venha alto).
  if (row && isCanceled(row.status)) return { billing_type: 'reactivation' };

  // 2. O payload decide primeiro (a tabela confirma): o gateway conta as cobrancas
  // (Ticto: subscriptions[0].successful_charges, INCLUINDO a atual; Hotmart:
  // purchase.recurrence_number). hint > 1 = renovacao. hint <= 1 = PRIMEIRA cobranca
  // desta assinatura — mesmo que a linha ja exista na tabela: e' o order bump/combo
  // (webhook proprio com o MESMO identificador de assinatura, segundos depois da
  // cobranca principal que inseriu a linha) ou um replay da mesma fatura. Sem este
  // curto-circuito, o bump de um cliente NOVO viraria 'renewal'.
  const hint = Number(webhookData.charges_paid_hint);
  if (Number.isFinite(hint)) {
    if (hint > 1) return { billing_type: 'renewal' };
    if (row) return { billing_type: 'new' };
    // hint <= 1 e sem linha: segue para o lookup por email (reativacao de legado).
  }

  // 2b. Sem hint no payload: linha na tabela = renovacao.
  if (row) return { billing_type: 'renewal' };

  // 3. Assinatura nova, mas o e-mail ja e cliente (qualquer gateway — cobre a migracao
  // de um gateway para outro): se TODA assinatura anterior dele esta cancelada, e
  // REATIVACAO (quem cancelou e voltou NAO e aquisicao). Se ainda ha assinatura ativa,
  // e upgrade/2o plano — classificado como renovacao para nao inflar a aquisicao.
  const email = normEmail(webhookData.email);
  if (email) {
    const prev = await consultar(() => db.prepare(
      'SELECT status FROM subscriptions WHERE site_id = ? AND email = ? LIMIT 50'
    ).bind(siteId, email).all());
    if (!_tabelaOk) return null;
    const rows = prev?.results || [];
    if (rows.length) {
      const anyActive = rows.some((r) => !isCanceled(r.status));
      return { billing_type: anyActive ? 'renewal' : 'reactivation' };
    }
  }

  // 4. Nunca visto: cliente novo (aquisicao).
  return { billing_type: 'new' };
}

// Upsert pos-dispatch: registra a cobranca para as proximas decisoes.
// charges_paid usa o contador do gateway quando presente; senao incrementa.
export async function recordSubscriptionCharge(db, env, siteId, gateway, webhookData) {
  const subId = String(webhookData.subscription_id || '');
  if (!subId) return;
  const email = normEmail(webhookData.email);
  const phone = String(webhookData.phone || '').replace(/\D/g, '');
  const plan = String(webhookData.plan || webhookData.offer_name || webhookData.product_name || '');
  const hint = Number(webhookData.charges_paid_hint);
  const charges = Number.isFinite(hint) && hint > 0 ? hint : null;

  await escrever(db, env, 'subscription.upsert', () => db.prepare(
    `INSERT INTO subscriptions
       (site_id, gateway, subscription_id, email, phone, plan, charges_paid, status,
        first_charge_at, last_seen_at, origin)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 1), 'active', ${NOW_SQL}, ${NOW_SQL}, 'webhook')
     ON CONFLICT (site_id, gateway, subscription_id) DO UPDATE SET
       charges_paid = COALESCE(?, subscriptions.charges_paid + 1),
       status = 'active',
       email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE subscriptions.email END,
       phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE subscriptions.phone END,
       plan  = CASE WHEN excluded.plan  <> '' THEN excluded.plan  ELSE subscriptions.plan  END,
       last_seen_at = ${NOW_SQL},
       updated_at   = ${NOW_SQL}`
  ).bind(siteId, gateway, subId, email, phone, plan, charges, charges).run());
}

// Evento de cancelamento do gateway: marca a assinatura como cancelada. Insere se
// nao existir — cancelamento de assinatura que nunca passou pelo webhook de venda
// tambem precisa contar para a reativacao futura.
export async function markSubscriptionCanceled(db, env, siteId, gateway, subId, email) {
  const id = String(subId || '');
  if (!id) return;
  await escrever(db, env, 'subscription.cancel', () => db.prepare(
    `INSERT INTO subscriptions
       (site_id, gateway, subscription_id, email, status, last_seen_at, origin)
     VALUES (?, ?, ?, ?, 'canceled', ${NOW_SQL}, 'webhook')
     ON CONFLICT (site_id, gateway, subscription_id) DO UPDATE SET
       status = 'canceled',
       email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE subscriptions.email END,
       last_seen_at = ${NOW_SQL},
       updated_at   = ${NOW_SQL}`
  ).bind(siteId, gateway, id, normEmail(email)).run());
}

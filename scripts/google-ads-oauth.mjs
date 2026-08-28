// Emite o refresh token do Google Ads com OS DOIS escopos exigidos pelo conector:
//
//   adwords      -> Google Ads API (lookup de acao de conversao, upload legado)
//   datamanager  -> Data Manager API (events:ingest — o caminho padrao desde 2026)
//
// POR QUE ISTO EXISTE: um refresh token emitido so com `adwords` faz o upload
// responder `403 insufficient authentication scopes`, e token antigo NUNCA ganha
// escopo novo — tem que ser reemitido. Como o erro so aparece em chamada real,
// ele costuma ser descoberto em producao. Este script fecha esse buraco: ele
// CONFERE o campo `scope` devolvido pela Google e falha alto se faltar algum.
//
// Uso:
//   npm run gads:oauth -- --client-id=XXX.apps.googleusercontent.com --client-secret=YYY
//   npm run gads:oauth                      (pergunta as credenciais no terminal)
//
// Opcoes: --port=8899  (porta do loopback; precisa casar com a URI registrada
//                       no cliente OAuth quando o tipo e "Aplicativo da Web")
//
// Requisitos no Google Cloud, no MESMO projeto do cliente OAuth:
//   1. Google Ads API habilitada
//   2. Data Manager API habilitada  <- o passo mais esquecido
//   3. Credenciais > ID do cliente OAuth 2.0 do tipo "App para computador"
//      (recomendado: aceita qualquer porta de loopback sem registro previo)
//
// Node puro, sem dependencias — funciona identico em Windows, macOS e Linux.
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const SCOPE = 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/datamanager';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_PORT = 8899;

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

// O mesmo defeito que o SCRT documentou nos secrets vale aqui: valor colado com
// quebra de linha no meio vira credencial corrompida. Barrar na entrada.
function clean(value, label) {
  const v = String(value || '').trim();
  if (/\s/.test(v)) {
    console.error('\n[erro] ' + label + ' tem espaco/quebra de linha NO MEIO do valor.');
    console.error('       Cole o valor em uma linha so e rode de novo.');
    process.exit(1);
  }
  return v;
}

async function main() {
  const port = Number(arg('port')) || DEFAULT_PORT;
  const redirectUri = 'http://127.0.0.1:' + port;

  let clientId = arg('client-id') || process.env.GOOGLE_ADS_CLIENT_ID || '';
  let clientSecret = arg('client-secret') || process.env.GOOGLE_ADS_CLIENT_SECRET || '';

  if (!clientId) clientId = await ask('Client ID (...apps.googleusercontent.com): ');
  if (!clientSecret) clientSecret = await ask('Client Secret: ');

  clientId = clean(clientId, 'Client ID');
  clientSecret = clean(clientSecret, 'Client Secret');
  if (!clientId || !clientSecret) {
    console.error('[erro] Client ID e Client Secret sao obrigatorios.');
    process.exit(1);
  }

  // access_type=offline + prompt=consent: SEM OS DOIS a Google devolve apenas um
  // access_token de 1h e nenhum refresh_token (reautorizar a mesma conta sem
  // `prompt=consent` tambem nao reemite o refresh token).
  const authUrl = AUTH_URL + '?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  }).toString();

  console.log('\n1) Abra esta URL no navegador, logado na conta que administra o Google Ads:\n');
  console.log(authUrl + '\n');
  console.log('2) Autorize os DOIS acessos pedidos (Google Ads e Data Manager).');
  console.log('3) Voce sera redirecionado para ' + redirectUri + ' — pode deixar acontecer.\n');
  console.log('Aguardando o retorno da Google...');

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      const received = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(received
        ? '<h2>Autorizado.</h2><p>Pode fechar esta aba e voltar ao terminal.</p>'
        : '<h2>Autorizacao negada.</h2><p>' + (error || 'sem codigo') + '</p>');
      server.close();
      if (received) resolve(received);
      else reject(new Error(error || 'a Google nao devolveu o parametro `code`'));
    });
    server.on('error', (e) => reject(
      e.code === 'EADDRINUSE'
        ? new Error('a porta ' + port + ' esta ocupada — rode com --port=OUTRA')
        : e
    ));
    server.listen(port, '127.0.0.1');
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('\n[erro] a troca do code falhou (HTTP ' + res.status + '):');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  if (!data.refresh_token) {
    console.error('\n[erro] a Google devolveu access_token mas NAO devolveu refresh_token.');
    console.error('       Causa quase sempre: a conta ja havia autorizado este cliente antes.');
    console.error('       Revogue o acesso em https://myaccount.google.com/permissions e rode de novo');
    console.error('       (o script ja envia access_type=offline e prompt=consent).');
    process.exit(1);
  }

  // A VERIFICACAO QUE JUSTIFICA O SCRIPT: confirmar os dois escopos AGORA, no
  // terminal, em vez de descobrir em producao com `403 insufficient authentication scopes`.
  const granted = String(data.scope || '');
  const faltando = SCOPE.split(' ').filter((s) => granted.indexOf(s) === -1);

  console.log('\n--- escopos concedidos pela Google ---');
  console.log(granted || '(nenhum)');

  if (faltando.length) {
    console.error('\n[erro] FALTA escopo: ' + faltando.join(', '));
    console.error('       Este refresh token NAO serve para o conector.');
    console.error('       Confira se a API correspondente esta habilitada no projeto do Google Cloud');
    console.error('       (Data Manager API para o escopo `datamanager`) e autorize os dois acessos.');
    process.exit(1);
  }
  console.log('OK — adwords e datamanager presentes.\n');

  console.log('=== REFRESH TOKEN ===');
  console.log(data.refresh_token);
  console.log('');
  console.log('Grave os tres valores como secrets do Worker. Comando canonico (portavel em');
  console.log('bash, zsh e PowerShell) — crie secrets.json e rode:');
  console.log('');
  console.log(JSON.stringify({
    GOOGLE_ADS_CLIENT_ID: clientId,
    GOOGLE_ADS_CLIENT_SECRET: clientSecret,
    GOOGLE_ADS_REFRESH_TOKEN: data.refresh_token
  }, null, 2));
  console.log('');
  console.log('  npx wrangler secret bulk secrets.json');
  console.log('  rm secrets.json          # PowerShell: Remove-Item secrets.json -Force');
  console.log('');
  console.log('NUNCA subir por pipe (echo "valor" | wrangler secret put NOME): no Windows/PowerShell');
  console.log('o pipe acrescenta CRLF, o secret fica com whitespace e os envios falham com');
  console.log('status_code = 0 + "Error: Network connection lost.".');
}

main().catch((e) => {
  console.error('\n[erro] ' + (e && e.message ? e.message : String(e)));
  process.exit(1);
});

// Conector Google Ads — dois canais que operam SIMULTANEAMENTE:
//
//   canal web      eventos de navegador (page_view/contact/lead/initiate_checkout),
//                  disparados pelo gtag no browser por ROTULO de conversao.
//                  O Worker so registra o log — quem envia e o navegador.
//
//   canal webhook  `purchase` vindo do gateway, enviado server-side por ID NUMERICO
//                  da acao de conversao de IMPORTACAO (UPLOAD_CLICKS).
//
// A regra que resume tudo: ACAO DE SITE -> ROTULO; ACAO DE IMPORTACAO -> ID NUMERICO.
// Acao de importacao NAO tem `tag_snippets`, logo NAO tem rotulo — foi exatamente
// isso que fazia o purchase morrer em silencio quando o gate exigia rotulo.
//
// Upload: `data_manager` (default) ou `conversion_upload` (legado). Desde 2026 a
// Google BLOQUEIA o ConversionUploadService para integracoes novas
// (`CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE`), e o caminho oficial e a Data
// Manager API — que nem usa developer-token, so `Authorization: Bearer`.
import { logEvent } from '../shared/logger.js';
import { cleanSecret, digitsOnly } from '../shared/helpers.js';
import { sha256 } from '../shared/hash.js';

const DATA_MANAGER_URL = 'https://datamanager.googleapis.com/v1/events:ingest';
const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v21';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Cache do access token no escopo do modulo. O isolate do Worker e reusado entre
// requests, entao na pratica um refresh cobre varias vendas; quando o isolate
// morre, o pior caso e um refresh a mais. Best-effort de proposito — nao vale uma
// tabela no D1 para isto.
let _tokenCache = { token: '', expiresAt: 0 };
// Idem para o lookup de acao de conversao (chave `customerId|evento`).
const _actionCache = new Map();

// ---------------------------------------------------------------------------
// Credenciais e OAuth
// ---------------------------------------------------------------------------

// Whitespace NO MEIO da credencial e sempre valor corrompido (colagem quebrada em
// duas linhas, CRLF do pipe do PowerShell) — o trim() nao salva e o header derruba
// a conexao. Mesmo guard dos demais conectores (ver SCRT).
function readCreds(env) {
  const creds = {
    clientId: cleanSecret(env.GOOGLE_ADS_CLIENT_ID),
    clientSecret: cleanSecret(env.GOOGLE_ADS_CLIENT_SECRET),
    refreshToken: cleanSecret(env.GOOGLE_ADS_REFRESH_TOKEN),
    developerToken: cleanSecret(env.GOOGLE_ADS_DEVELOPER_TOKEN)
  };
  const faltando = ['clientId', 'clientSecret', 'refreshToken']
    .filter((k) => !creds[k]);
  if (faltando.length) {
    return { error: 'missing_google_ads_oauth: faltam os secrets ' +
      faltando.map((k) => 'GOOGLE_ADS_' + k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()).join(', ') +
      ' — gere com `npm run gads:oauth` e suba por `wrangler secret bulk`' };
  }
  for (const k of ['clientId', 'clientSecret', 'refreshToken']) {
    if (/\s/.test(creds[k])) {
      return { error: 'invalid_google_ads_credential_whitespace: ' + k +
        ' tem whitespace no meio do valor — reenvie por `wrangler secret bulk`, em uma linha so' };
    }
  }
  return { creds };
}

async function getAccessToken(env) {
  const now = Date.now();
  if (_tokenCache.token && now < _tokenCache.expiresAt) {
    return { token: _tokenCache.token };
  }

  const { creds, error } = readCreds(env);
  if (error) return { error };

  let res;
  let text = '';
  try {
    res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    });
    text = await res.text();
  } catch (e) {
    return { error: 'oauth_fetch_failed: ' + String(e) +
      ' | endpoint=oauth2.googleapis.com — se for "Network connection lost", verifique o secret (whitespace) antes de suspeitar de rede' };
  }

  let data = {};
  try { data = JSON.parse(text); } catch (e) { /* corpo nao-JSON cai no erro abaixo */ }

  if (!res.ok || !data.access_token) {
    // `invalid_grant` = refresh token revogado/expirado; `invalid_client` = par
    // client_id/secret errado. Os dois exigem reemitir — nao adianta retry.
    const acao = String(data.error || '') === 'invalid_grant'
      ? ' — refresh token revogado ou invalido: reemita com `npm run gads:oauth`'
      : '';
    return { error: ('oauth_refresh_failed(' + res.status + '): ' + text + acao).substring(0, 500) };
  }

  // Renova 60s antes de expirar, para nao usar token na fronteira do vencimento.
  const ttl = (Number(data.expires_in) || 3600) * 1000;
  _tokenCache = { token: data.access_token, expiresAt: now + ttl - 60000 };
  return { token: data.access_token };
}

// ---------------------------------------------------------------------------
// Tradução de erro: a resposta da Google vira ACAO no error_message
// ---------------------------------------------------------------------------

function translateGoogleError(status, body) {
  const b = String(body || '');
  const low = b.toLowerCase();

  if (low.includes('has not been used') || low.includes('is disabled')) {
    return 'api_nao_habilitada: habilite a Data Manager API no projeto do Google Cloud ' +
      '(APIs e servicos > Biblioteca > "Data Manager API" > Ativar) e aguarde alguns minutos';
  }
  if (low.includes('insufficient') && low.includes('scope')) {
    return 'escopo_oauth_insuficiente: o refresh token nao tem o escopo `datamanager`. ' +
      'Token antigo nunca ganha escopo novo — reemita com `npm run gads:oauth` e resuba o secret';
  }
  if (b.includes('CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE')) {
    return 'conversion_upload_bloqueado: a Google so aceita o ConversionUploadService para contas ' +
      'ja allowlisted. Remova `upload_api` do config (ou use "data_manager") para subir pela Data Manager API';
  }
  if (b.includes('REQUIRED_FIELD_MISSING') && low.includes('event_source')) {
    return 'event_source_ausente: `eventSource` e obrigatorio no payload da Data Manager (bug do conector)';
  }
  if (status === 404 && low.includes('<html')) {
    return 'endpoint_404_html: a URL do upload esta errada (resposta HTML onde a API devolve JSON)';
  }
  return b.substring(0, 500);
}

// ---------------------------------------------------------------------------
// Resolucao da acao de conversao (GADS-3)
// ---------------------------------------------------------------------------

const ERRO_ACAO_NAO_ENCONTRADA =
  'conversion_action_not_found: preencha `conversion_action_id_purchase` com o ID NUMERICO da acao ' +
  'de importacao. Acoes de importacao (UPLOAD_CLICKS) nao tem rotulo — o id aparece na URL do painel ' +
  '(Google Ads > Objetivos > Conversoes > abra a acao > `ctId=` na barra de enderecos)';

// Ordem: (1) id numerico do config — prioridade absoluta; (2) lookup por rotulo no
// eventSnippet; (3) lookup por type = UPLOAD_CLICKS; (4) erro acionavel.
// O lookup usa a Google Ads API (exige developer-token), que o caminho Data Manager
// NAO precisa ter — por isso e best-effort: sem developer-token vai direto ao (4),
// que e o comportamento correto e documentado.
async function resolveConversionAction(cfg, env, eventKey, token) {
  const direto = cfg?.['conversion_action_id_' + eventKey];
  if (direto) return { actionId: String(direto), via: 'config' };

  const customerId = digitsOnly(cfg?.customer_id);
  const developerToken = cleanSecret(env.GOOGLE_ADS_DEVELOPER_TOKEN);
  if (!customerId || !developerToken || !token) {
    return { error: ERRO_ACAO_NAO_ENCONTRADA };
  }

  const cacheKey = customerId + '|' + eventKey;
  if (_actionCache.has(cacheKey)) return _actionCache.get(cacheKey);

  const label = cfg?.['conversion_label_' + eventKey] || '';
  const headers = {
    'Authorization': 'Bearer ' + token,
    'developer-token': developerToken,
    'Content-Type': 'application/json'
  };
  const loginId = digitsOnly(cfg?.login_customer_id);
  if (loginId) headers['login-customer-id'] = loginId;

  const query =
    'SELECT conversion_action.id, conversion_action.name, conversion_action.type, ' +
    'conversion_action.category, conversion_action.tag_snippets ' +
    'FROM conversion_action WHERE conversion_action.status = "ENABLED"';

  let rows = [];
  try {
    const res = await fetch(
      GOOGLE_ADS_API + '/customers/' + customerId + '/googleAds:searchStream',
      { method: 'POST', headers, body: JSON.stringify({ query }) }
    );
    const text = await res.text();
    if (!res.ok) {
      const out = { error: 'conversion_action_lookup_failed: ' + translateGoogleError(res.status, text) };
      _actionCache.set(cacheKey, out);
      return out;
    }
    const parsed = JSON.parse(text);
    for (const chunk of (Array.isArray(parsed) ? parsed : [parsed])) {
      for (const r of (chunk?.results || [])) rows.push(r.conversionAction || {});
    }
  } catch (e) {
    return { error: 'conversion_action_lookup_failed: ' + String(e).substring(0, 200) };
  }

  let hit = null;

  // (2) rotulo dentro do eventSnippet — so existe em acao de SITE.
  if (label) {
    hit = rows.find((a) => (a.tagSnippets || []).some(
      (t) => String(t.eventSnippet || '').includes(label)
    ));
  }

  // (3) acao de IMPORTACAO: nao tem eventSnippet, entao a busca e por tipo.
  if (!hit) {
    const importacoes = rows.filter((a) => a.type === 'UPLOAD_CLICKS');
    const categoria = cfg?.['conversion_category_' + eventKey];
    hit = (categoria ? importacoes.find((a) => a.category === categoria) : null)
      || (importacoes.length === 1 ? importacoes[0] : null);
  }

  const out = hit?.id
    ? { actionId: String(hit.id), via: hit.type === 'UPLOAD_CLICKS' ? 'lookup_upload_clicks' : 'lookup_label' }
    : { error: ERRO_ACAO_NAO_ENCONTRADA };
  _actionCache.set(cacheKey, out);
  return out;
}

// ---------------------------------------------------------------------------
// Identificadores do usuario
// ---------------------------------------------------------------------------

// O Google exige o telefone em E.164 (`+55...`) ANTES do sha256. O `hashed.phone`
// compartilhado usa o valor cru (padrao Meta) e NUNCA casa aqui — por isso o hash
// e refeito no conector (GADS-4).
async function buildUserIdentifiers(hashed, merged) {
  const ids = [];
  if (hashed?.email) ids.push({ emailAddress: hashed.email });

  const phoneDigits = digitsOnly(merged?.phone);
  if (phoneDigits) {
    const hashedPhoneE164 = await sha256('+' + phoneDigits);
    if (hashedPhoneE164) ids.push({ phoneNumber: hashedPhoneE164 });
  }
  return ids;
}

// gclid > wbraid > gbraid: um so por evento, na ordem de qualidade de atribuicao.
function buildAdIdentifiers(merged) {
  if (merged?.gclid) return { gclid: merged.gclid };
  if (merged?.wbraid) return { wbraid: merged.wbraid };
  if (merged?.gbraid) return { gbraid: merged.gbraid };
  return null;
}

// ---------------------------------------------------------------------------
// Upload — Data Manager (default) e ConversionUpload (legado)
// ---------------------------------------------------------------------------

function buildDataManagerPayload({ cfg, actionId, merged, userIdentifiers, adIdentifiers }) {
  const customerId = digitsOnly(cfg?.customer_id);
  const loginId = digitsOnly(cfg?.login_customer_id);

  const evento = {
    destinationReferences: ['gads'],
    eventTimestamp: new Date().toISOString(),
    // Obrigatorio. Sem ele: 400 REQUIRED_FIELD_MISSING events[0].event_source.
    eventSource: 'WEB',
    currency: merged?.currency || 'BRL',
    conversionValue: parseFloat(merged?.value) || 0,
    consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' }
  };
  if (merged?.order_id) evento.transactionId = String(merged.order_id);
  if (adIdentifiers) evento.adIdentifiers = adIdentifiers;
  if (userIdentifiers.length) evento.userData = { userIdentifiers };

  const destino = {
    reference: 'gads',
    operatingAccount: { product: 'GOOGLE_ADS', accountId: customerId },
    productDestinationId: String(actionId)
  };
  if (loginId) destino.loginAccount = { product: 'GOOGLE_ADS', accountId: loginId };

  return { destinations: [destino], events: [evento], encoding: 'HEX', validateOnly: false };
}

function buildLegacyPayload({ actionId, cfg, merged, userIdentifiers, adIdentifiers }) {
  const customerId = digitsOnly(cfg?.customer_id);
  const conversion = {
    conversionAction: 'customers/' + customerId + '/conversionActions/' + actionId,
    conversionDateTime: legacyDateTime(),
    conversionValue: parseFloat(merged?.value) || 0,
    currencyCode: merged?.currency || 'BRL',
    consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' }
  };
  if (merged?.order_id) conversion.orderId = String(merged.order_id);
  if (adIdentifiers?.gclid) conversion.gclid = adIdentifiers.gclid;
  else if (adIdentifiers?.wbraid) conversion.wbraid = adIdentifiers.wbraid;
  else if (adIdentifiers?.gbraid) conversion.gbraid = adIdentifiers.gbraid;
  if (userIdentifiers.length) {
    conversion.userIdentifiers = userIdentifiers.map((u) => (
      u.emailAddress
        ? { hashedEmail: u.emailAddress, userIdentifierSource: 'FIRST_PARTY' }
        : { hashedPhoneNumber: u.phoneNumber, userIdentifierSource: 'FIRST_PARTY' }
    ));
  }
  return { conversions: [conversion], partialFailure: true };
}

// O legado exige "yyyy-MM-dd HH:mm:ss+|-HH:mm" — ISO puro e recusado.
function legacyDateTime() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00:00');
}

// ---------------------------------------------------------------------------
// Canal webhook — purchase (GADS-1/2/3/4)
// ---------------------------------------------------------------------------

export async function sendGoogleAdsWebhook(googleAdsConfig, hashed, merged, env, siteId) {
  const cfg = googleAdsConfig || {};
  const start = Date.now();
  const source = `${merged.gateway || 'unknown'}`;

  // NENHUM caminho de saida daqui pode dar `return` sem gravar log: um purchase que
  // some sem linha no D1 e indistinguivel de "nao houve venda" — foi assim que a
  // falha original passou despercebida.
  const registrar = (statusCode, errorMsg, sentPayload, responsePayload) => logEvent(env.DB, {
    site_id: siteId, event_name: 'purchase', event_id: '',
    platform: 'google_ads', channel: 'webhook', source,
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload || '',
    error_message: errorMsg || '',
    response_payload: responsePayload || '',
    marca_user: merged.marca_user || '', source_ip: merged.ip || '', user_agent: merged.user_agent || ''
  });

  const customerId = digitsOnly(cfg.customer_id);
  if (!customerId) {
    return registrar(0, 'missing_customer_id: preencha `platforms.google_ads.customer_id` ' +
      '(ID da conta do Google Ads, so digitos, sem hifens)', '', '');
  }

  const { token, error: tokenError } = await getAccessToken(env);
  if (tokenError) return registrar(0, tokenError, '', '');

  const { actionId, error: actionError } = await resolveConversionAction(cfg, env, 'purchase', token);
  if (actionError) return registrar(0, actionError, '', '');

  const userIdentifiers = await buildUserIdentifiers(hashed, merged);
  const adIdentifiers = buildAdIdentifiers(merged);
  if (!adIdentifiers && !userIdentifiers.length) {
    return registrar(0, 'sem_identificador: a venda nao tem gclid/wbraid/gbraid nem e-mail/telefone — ' +
      'sem ao menos um identificador a Google nao tem como atribuir a conversao', '', '');
  }

  const legado = cfg.upload_api === 'conversion_upload';
  const url = legado
    ? GOOGLE_ADS_API + '/customers/' + customerId + ':uploadClickConversions'
    : DATA_MANAGER_URL;

  const payload = legado
    ? buildLegacyPayload({ actionId, cfg, merged, userIdentifiers, adIdentifiers })
    : buildDataManagerPayload({ cfg, actionId, merged, userIdentifiers, adIdentifiers });

  // A Data Manager NAO manda developer-token — so `Authorization: Bearer`.
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  if (legado) {
    headers['developer-token'] = cleanSecret(env.GOOGLE_ADS_DEVELOPER_TOKEN);
    const loginId = digitsOnly(cfg.login_customer_id);
    if (loginId) headers['login-customer-id'] = loginId;
  }

  const sentPayload = JSON.stringify(payload);
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  let gotResponse = false;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: sentPayload });
    statusCode = res.status;
    gotResponse = true;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
    if (!res.ok) errorMsg = translateGoogleError(res.status, responseText);
    // partialFailureError: HTTP 200 com a conversao REJEITADA. Sem isto o log
    // diria sucesso para um evento que a Google descartou.
    else if (responseText.includes('partialFailureError')) {
      errorMsg = 'partial_failure: ' + responseText.substring(0, 400);
    }
  } catch (e) {
    // Resposta ja chegada + excecao ao ler o corpo != "nunca saiu" (pode ter sido aceito).
    if (!gotResponse) statusCode = 0;
    errorMsg = (gotResponse
      ? `body_read_failed: ${String(e)}`
      : `fetch_failed: ${String(e)} | endpoint=${new URL(url).hostname} — se for "Network connection lost", verifique o secret (whitespace) antes de suspeitar de rede`
    ).substring(0, 500);
  }

  await registrar(statusCode, errorMsg, sentPayload, responsePayload);
}

// ---------------------------------------------------------------------------
// Canal web — eventos de navegador (GADS-6)
// ---------------------------------------------------------------------------

// Quem ENVIA o evento de navegador e o gtag, no browser. Aqui so se registra o
// que de fato aconteceu — e o ponto e nao mentir: a versao antiga gravava
// `200 "web-only: dispatched via gtag"` inclusive no canal `server`, onde nada
// dispara. Log verde com zero conversao e a pior falha possivel numa auditoria.
export async function sendGoogleAdsConversion(googleAdsConfig, eventName, hashed, body, env, siteId) {
  const cfg = googleAdsConfig || {};
  const canal = cfg.channel || 'web';
  const label = cfg['conversion_label_' + eventName];

  let statusCode = 0;
  let errorMsg = '';
  let sentPayload = '';

  if (canal !== 'web') {
    errorMsg = 'canal_server_nao_despacha_navegador: `channel: "' + canal + '"` nao envia evento de ' +
      'navegador ao Google Ads (o canal server cobre apenas `purchase`, via webhook do gateway). ' +
      'Para ' + eventName + ' use `channel: "web"` — os dois canais convivem: web por rotulo, ' +
      'webhook por id numerico da acao de importacao';
  } else if (!cfg.conversion_id) {
    errorMsg = 'missing_conversion_id: preencha `platforms.google_ads.conversion_id` (formato AW-XXXXXXXXX)';
  } else if (!label) {
    errorMsg = 'missing_conversion_label_' + eventName + ': sem `conversion_label_' + eventName +
      '` no config o gtag nao dispara este evento (opt-in por rotulo)';
  } else {
    statusCode = 200;
    sentPayload = 'web: gtag conversion send_to=' + cfg.conversion_id + '/' + label;
    errorMsg = '';
  }

  await logEvent(env.DB, {
    site_id: siteId, event_name: eventName, event_id: body.event_id || '',
    platform: 'google_ads', channel: canal === 'web' ? 'web' : 'server', source: 'collect',
    status_code: statusCode, request_ms: 0,
    sent_payload: sentPayload,
    error_message: errorMsg,
    response_payload: '',
    marca_user: body.marca_user || '', source_ip: '', user_agent: ''
  });
}

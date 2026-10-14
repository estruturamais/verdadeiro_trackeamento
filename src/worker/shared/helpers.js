export function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length; i++) {
    if (current == null) return undefined;
    current = current[keys[i]];
  }
  return current;
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.substring(0, idx).trim();
    const value = pair.substring(idx + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

export function generateId() {
  return Date.now() + '-' + crypto.randomUUID();
}

// Credencial vinda de wrangler secret / SITE_CONFIG pode chegar com whitespace
// (CRLF do pipe do PowerShell, espaco colado no copiar/colar do painel da plataforma).
// Em header HTTP isso derruba a conexao ("Network connection lost", status_code 0);
// em query string vira valor invalido que a plataforma rejeita em silencio.
export function cleanSecret(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Só dígitos. O Google Ads exige o telefone em E.164 (`+5511999998888`) ANTES do
// sha256; o hash compartilhado do hashPII (padrão Meta) usa o valor cru e nunca
// casa do lado do Google. A perda é silenciosa: não há erro, só match pior.
export function digitsOnly(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\D/g, '')
    : '';
}

export function splitFirstName(fullname) {
  if (!fullname) return '';
  return fullname.trim().split(/\s+/)[0];
}

export function splitLastName(fullname) {
  if (!fullname) return '';
  const parts = fullname.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

// ---- UTM (last-click da venda) — normaliza para as 5 colunas do webhook_raw ----
// Grava CRU (sem transformar valores). Ver .claude/references/utm-convention.md.

// Chaves prefixadas: utm_source, utm_medium, ... (Kiwify, Kirvano, Ticto, Payt, Green, Tutory).
export function utmPrefixed(obj) {
  obj = obj || {};
  return {
    utm_source:   obj.utm_source   || '',
    utm_medium:   obj.utm_medium   || '',
    utm_campaign: obj.utm_campaign || '',
    utm_term:     obj.utm_term     || '',
    utm_content:  obj.utm_content  || ''
  };
}

// Chaves "nuas": source, medium, campaign, term, content (Hubla, Eduzz).
export function utmBare(obj) {
  obj = obj || {};
  return {
    utm_source:   obj.source   || '',
    utm_medium:   obj.medium   || '',
    utm_campaign: obj.campaign || '',
    utm_term:     obj.term     || '',
    utm_content:  obj.content  || ''
  };
}

// String unica "source|medium|campaign|term|content" (Hotmart, PagTrust — campo sck).
export function utmFromPipe(str) {
  const p = String(str || '').split('|');
  return {
    utm_source:   p[0] || '',
    utm_medium:   p[1] || '',
    utm_campaign: p[2] || '',
    utm_term:     p[3] || '',
    utm_content:  p[4] || ''
  };
}

// ---- Dominio registravel (eTLD+1) e o Domain= do cookie de identidade ----
// Pegar os 2 ultimos rotulos do host devolve o SUFIXO PUBLICO num dominio brasileiro
// (`www.exemplo.com.br` -> `com.br`), com duas falhas silenciosas:
//   1. `Set-Cookie ... Domain=.com.br` e REJEITADO pelo navegador (Public Suffix List):
//      o marca_user nunca persiste e o Worker cunha um id novo a cada page view;
//   2. no web.js, `pay.kiwify.com.br` e `www.exemplo.com.br` viravam o "mesmo" site: o
//      link do checkout era tratado como interno e o indexador (sck/xcod) nao entrava.
// Heuristica no lugar da PSL inteira (centenas de KB): TLD de 2 letras + rotulo desta
// lista = sufixo de 2 niveis (com.br, adv.br, co.uk, com.au...). Errar para MAIS rotulos
// so estreita o cookie (continua valido); errar para menos o faz ser rejeitado.
// Espelhada em src/web.js (getRegistrableDomain/getCookieDomain) — manter iguais.
const SECOND_LEVEL_LABELS = new Set([
  'com', 'net', 'org', 'gov', 'edu', 'mil', 'co', 'ac', 'or', 'ne', 'go', 'gob', 'nom',
  'info', 'biz', 'gr', 'adv', 'art', 'eco', 'ind', 'inf', 'rec', 'srv', 'tur', 'tv',
  'vet', 'med', 'eng', 'esp', 'jor', 'pro', 'psi', 'id', 'me', 'ltd', 'plc', 'sch', 'in'
]);

// Hosts de plataforma que dao um subdominio por cliente (secao privada da PSL):
// `Domain=.pages.dev` e rejeitado igual a `.com.br`, o registravel e `{projeto}.pages.dev`.
const PLATFORM_SUFFIXES = new Set([
  'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'github.io',
  'web.app', 'firebaseapp.com', 'herokuapp.com'
]);

// Dominio registravel SEM ponto (`exemplo.com.br`). '' quando nao ha um seguro de usar:
// IP (v4/v6), host de um rotulo so (`localhost`) ou o host ja e o proprio sufixo publico.
// Aceita o header Host (com porta).
export function getRegistrableDomain(hostname) {
  let host = String(hostname || '').trim().toLowerCase();
  if (!host || host.charAt(0) === '[') return '';                  // [IPv6]:porta
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host || host.includes(':') || /^[\d.]+$/.test(host)) return ''; // IPv6 / IPv4
  const parts = host.split('.');
  if (parts.length < 2 || parts.some(p => !p)) return '';
  const n = parts.length;
  const take = (PLATFORM_SUFFIXES.has(parts[n - 2] + '.' + parts[n - 1]) ||
    (parts[n - 1].length === 2 && SECOND_LEVEL_LABELS.has(parts[n - 2]))) ? 3 : 2;
  return n < take ? '' : parts.slice(-take).join('.');
}

// Valor do Domain= do cookie de identidade, com o ponto (`.exemplo.com.br`), ou '' para
// OMITIR o atributo (cookie host-only, que o navegador aceita) quando nao ha dominio
// registravel seguro. `configDomain` (SITE_CONFIG.cookie_domain) vence o calculo so se o
// host estiver dentro dele e ele nao for um sufixo publico — senao o navegador rejeitaria
// o cookie do mesmo jeito (ex.: o site aberto pelo host alternativo `*.pages.dev`).
export function getCookieDomain(hostname, configDomain) {
  const host = String(hostname || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const cfg = String(configDomain || '').trim().toLowerCase().replace(/^\.+/, '');
  if (cfg && getRegistrableDomain(cfg) && (host === cfg || host.endsWith('.' + cfg))) return '.' + cfg;
  const root = getRegistrableDomain(hostname);
  return root ? '.' + root : '';
}

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

import { getConfig, detectSiteId } from '../shared/config.js';
import { parseCookies, generateId } from '../shared/helpers.js';
import WEB_JS_TEMPLATE from '../../web-template.txt';

// Versao lida do banner do template (carimbada no build a partir do package.json).
// Computada uma vez no carregamento do modulo; '' se o banner nao existir (defensivo).
const VT_VERSION = (WEB_JS_TEMPLATE.match(/Verdadeiro Trackeamento v([0-9.]+)/) || [])[1] || '';

function getRootDomain(request) {
  const host = request.headers.get('host') || '';
  const parts = host.replace(/:\d+$/, '').split('.');
  return parts.length >= 2 ? '.' + parts.slice(-2).join('.') : host;
}

// DEFAULT_TRIGGERS: o agente nao precisa mais explicitar os
// triggers canonicos no SITE_CONFIG. O cliente so define um trigger quando quer
// override; o merge profundo (mergeTriggers) preenche o resto.
//   - initiate_checkout: SEMPRE link_click com match = uniao dos dominios dos
//     gateways configurados (auto). O checkout em quiz/SPA e' detectado no client
//     (handleSpaCheckoutClicks), ESCOPADO por spa_mode.locations — nao se troca o
//     tipo global aqui, pra pagina tradicional e funil de quiz coexistirem no mesmo
//     site sem toggle (o guard _icFired deduplica).
function buildDefaultTriggers(config) {
  const gwDomains = [];
  const gwc = config.gateways_config || {};
  for (const g of Object.keys(gwc)) {
    const doms = (gwc[g] && gwc[g].domains) || [];
    for (const d of doms) if (gwDomains.indexOf(d) === -1) gwDomains.push(d);
  }

  return {
    initiate_checkout: { type: 'link_click', match: gwDomains.join('|') },
    contact: { type: 'link_click', match: 'wa.me|api.whatsapp' },
    lead: { type: 'form_submit', selectors: { elementor: true, cf7: true, generic: true } }
  };
}

// Merge profundo (2 niveis) dos triggers do cliente sobre os defaults. Quando o
// cliente troca o `type` de um trigger, ele passa a ser dono total daquele trigger
// (evita herdar chaves incompativeis, ex.: require_navigation em link_click).
function mergeTriggers(defaults, override) {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = defaults[k];
  if (override && typeof override === 'object') {
    for (const name of Object.keys(override)) {
      const o = override[name];
      const d = out[name];
      // Merge (cliente preenche/override chaves do default) quando ha um default do
      // mesmo tipo OU quando o cliente nao declara type (override parcial, ex.: so
      // `match`). So substitui inteiro quando o cliente declara um type DIFERENTE —
      // evita herdar chaves incompativeis (ex.: require_navigation num link_click).
      if (d && o && typeof o === 'object' && typeof d === 'object' && (!o.type || o.type === d.type)) {
        out[name] = { ...d, ...o };
      } else {
        out[name] = o;
      }
    }
  }
  return out;
}

export async function handleServeWebJs(request, env) {
  const url = new URL(request.url);
  const siteId = url.searchParams.get('site_id') || url.searchParams.get('siteId') || detectSiteId(request, env);
  const config = await getConfig(siteId, env);

  // Extrair ou gerar marca_user
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const marcaUser = cookies.marca_user || generateId();

  // Config segura para o client (sem tokens/secrets)
  const clientConfig = {
    site_id: config.site_id,
    vt_version: VT_VERSION,
    // Default `web`: o canal web cobre os eventos de NAVEGADOR e o purchase vai
    // sempre pelo webhook, independente deste campo. O default antigo (`server`)
    // era uma armadilha — o browser nao disparava e o Worker gravava 200 falso.
    google_ads_channel: config.platforms?.google_ads?.channel || 'web',
    debug: config.debug || false,
    ga4_measurement_id: config.platforms?.ga4?.measurement_id,
    meta_pixel_id: config.platforms?.meta?.pixel_id,
    meta_pixel_ids_mirror: config.platforms?.meta?.pixel_ids_mirror
      ?? (config.platforms?.meta?.pixel_id_purchase ? [config.platforms.meta.pixel_id_purchase] : undefined),
    tiktok_pixel_id: config.platforms?.tiktok?.pixel_id,
    google_ads_conversion_id: config.platforms?.google_ads?.conversion_id,
    google_ads_label_page_view: config.platforms?.google_ads?.conversion_label_page_view,
    google_ads_label_contact: config.platforms?.google_ads?.conversion_label_contact,
    google_ads_label_lead: config.platforms?.google_ads?.conversion_label_lead,
    google_ads_label_initiate_checkout: config.platforms?.google_ads?.conversion_label_initiate_checkout,
    google_ads_label_purchase: config.platforms?.google_ads?.conversion_label_purchase,
    triggers: mergeTriggers(buildDefaultTriggers(config), config.triggers),
    cookies: config.cookies,
    gateways_config: config.gateways_config,
    custom_data: config.custom_data,
    qualification: config.qualification,
    // SPA mode (opt-in): gate da injecao same-origin do indexador no web.js.
    spa_mode: config.spa_mode,
    // escape hatch da reescrita de URL (modais/routers/PWA).
    disable_url_rewrite: config.disable_url_rewrite,
    collect_url: '/collect/event'
  };

  const script = WEB_JS_TEMPLATE
    .replace('/*__CONFIG__*/', 'var __CONFIG__=' + JSON.stringify(clientConfig) + ';')
    .replace('/*__MARCA_USER__*/', 'var __MARCA_USER__="' + marcaUser + '";');

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Set-Cookie': `marca_user=${marcaUser};Path=/;Max-Age=63072000;HttpOnly;SameSite=Lax;Secure;Domain=${getRootDomain(request)}`
    }
  });
}

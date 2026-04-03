import { getConfig, detectSiteId } from '../utils/config.js';
import { parseCookies, generateId } from '../utils/helpers.js';
import WEB_JS_TEMPLATE from '../../web/web-template.txt';

function getRootDomain(request) {
  const host = request.headers.get('host') || '';
  const parts = host.replace(/:\d+$/, '').split('.');
  return parts.length >= 2 ? '.' + parts.slice(-2).join('.') : host;
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
    google_ads_channel: config.platforms?.google_ads?.channel || 'server',
    debug: config.debug || false,
    ga4_measurement_id: config.platforms?.ga4?.measurement_id,
    meta_pixel_id: config.platforms?.meta?.pixel_id,
    meta_pixel_id_purchase: config.platforms?.meta?.pixel_id_purchase,
    meta_purchase_trigger_event: config.platforms?.meta?.purchase_trigger_event || 'lead',
    tiktok_pixel_id: config.platforms?.tiktok?.pixel_id,
    google_ads_conversion_id: config.platforms?.google_ads?.conversion_id,
    google_ads_label_contact: config.platforms?.google_ads?.conversion_label_contact,
    google_ads_label_lead: config.platforms?.google_ads?.conversion_label_lead,
    triggers: config.triggers,
    cookies: config.cookies,
    geolocation: config.geolocation ? {
      provider: config.geolocation.provider,
      api_key: config.geolocation.api_key,
      fallback_provider: config.geolocation.fallback_provider,
      fallback_api_key: config.geolocation.fallback_api_key
    } : null,
    gateways_config: config.gateways_config,
    custom_data: config.custom_data,
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

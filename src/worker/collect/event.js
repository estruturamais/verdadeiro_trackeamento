import { getConfig } from '../shared/config.js';
import { hashPII } from '../shared/hash.js';
import { upsertUserStore } from '../store/user-store.js';
import { logEvent } from '../shared/logger.js';
import { sendMetaCAPI } from '../platforms/meta.js';
import { sendTikTokEvent } from '../platforms/tiktok.js';
import { sendGoogleAdsConversion } from '../platforms/google-ads.js';
import { EVENT_NAMES } from '../shared/event-names.js';
import { sendGA4Event } from '../platforms/ga4.js';
import { sendSheetsLead } from '../platforms/sheets.js';
import { runCleanup } from '../shared/cleanup.js';
import { dbWrite } from '../shared/db-write.js';

export async function handleCollectEvent(request, env, ctx) {
  // Cleanup proativo: roda em background em ~1% dos eventos de browser
  if (Math.random() < 0.01) {
    ctx.waitUntil(runCleanup(env.DB, env).catch(() => {}));
  }
  const body = await request.json();
  const siteId = body.site_id;
  const config = await getConfig(siteId, env);

  const clientIp = request.headers.get('CF-Connecting-IP') || '';
  const userAgent = request.headers.get('User-Agent') || '';
  const cf = request.cf || {};
  const cfCountry = (cf.country || '').toLowerCase();
  const cfCity = (cf.city || '').toLowerCase();
  const cfState = (cf.region || '').toLowerCase();
  const cfZip = cf.postalCode || '';
  const marcaUser = body.marca_user || '';
  const eventName = body.event;
  const eventId = body.event_id;

  // 1. UPSERT no user_store
  // dbWrite: se DB cheio, roda cleanup sincrono e tenta de novo antes de desistir
  await dbWrite(
    env.DB,
    () => upsertUserStore(env.DB, {
      marca_user: marcaUser,
      ip: clientIp,
      user_agent: userAgent,
      fbp: body.browser_data?.fbp || '',
      fbc: body.browser_data?.fbc || '',
      ttp: body.browser_data?.ttp || '',
      ttclid: body.browser_data?.ttclid || '',
      ga_client_id: body.browser_data?.ga_client_id || '',
      ga_session_id: body.browser_data?.ga_session_id || '',
      ga_session_count: body.browser_data?.ga_session_count || '',
      ga_timestamp: body.browser_data?.ga_timestamp || '',
      // Click ids do Google — chegam junto das UTMs no beacon (getClickIds no web.js)
      gclid: body.utm_data?.gclid || '',
      wbraid: body.utm_data?.wbraid || '',
      gbraid: body.utm_data?.gbraid || '',
      page_url: body.page_url || '',
      email: body.user_data?.email || '',
      phone: body.user_data?.phone || '',
      fullname: [body.user_data?.first_name, body.user_data?.last_name].filter(Boolean).join(' '),
      city: body.user_data?.city || cfCity,
      state: body.user_data?.state || cfState,
      country: body.user_data?.country || cfCountry,
      zip: body.user_data?.zip || cfZip
    }),
    'event.upsertUserStore',
    env
  );

  // 1.5 Log do beacon recebido (garante visibilidade mesmo sem plataformas)
  await logEvent(env.DB, {
    site_id: siteId, event_name: eventName, event_id: eventId,
    platform: 'collect', channel: 'web', source: 'browser',
    status_code: 200, request_ms: 0,
    sent_payload: JSON.stringify(body),
    error_message: '', response_payload: '',
    marca_user: marcaUser, source_ip: clientIp, user_agent: userAgent,
    // UTMs da jornada web (cruas) — esta e a unica linha 1-por-evento (platform='collect')
    utm_source:   body.utm_data?.utm_source   || '',
    utm_medium:   body.utm_data?.utm_medium   || '',
    utm_campaign: body.utm_data?.utm_campaign || '',
    utm_term:     body.utm_data?.utm_term     || '',
    utm_content:  body.utm_data?.utm_content  || ''
  });

  // 2. Preparar dados hasheados
  const hashed = await hashPII({
    email: body.user_data?.email,
    phone: body.user_data?.phone,
    first_name: body.user_data?.first_name,
    last_name: body.user_data?.last_name,
    city: body.user_data?.city || cfCity,
    state: body.user_data?.state || cfState,
    country: body.user_data?.country || cfCountry,
    zip: body.user_data?.zip || cfZip,
    external_id: marcaUser
  });

  // 3. Distribuir para APIs (em paralelo)
  const promises = [];

  // Meta CAPI — todos os pixels (primário + espelhos), mesmo eventName, mesmo eventId
  if (config.platforms?.meta?.pixel_id) {
    const metaConfig = config.platforms.meta;
    const accessToken = metaConfig.access_token || env.META_ACCESS_TOKEN;
    const mirrors = metaConfig.pixel_ids_mirror
      ?? (metaConfig.pixel_id_purchase ? [metaConfig.pixel_id_purchase] : []);
    for (const pixelId of [metaConfig.pixel_id, ...mirrors]) {
      promises.push(
        sendMetaCAPI(pixelId, accessToken, eventName, eventId, hashed, body, clientIp, userAgent, env, siteId)
      );
    }
  }

  // TikTok Events API
  if (config.platforms?.tiktok?.pixel_id) {
    promises.push(
      sendTikTokEvent(config.platforms.tiktok, eventName, eventId, hashed, body, clientIp, userAgent, env, siteId)
    );
  }

  // Google Ads — eventos de NAVEGADOR. Quem envia e o gtag no browser (canal `web`);
  // aqui so se registra o log. Chamamos sempre que houver bloco `google_ads`, em
  // qualquer canal, porque o log honesto por canal e o que revela o gap: no canal
  // `server` nada dispara no navegador, e antes isso gravava um `200` mentiroso.
  // `purchase` NAO entra aqui — vai pelo webhook do gateway (sendGoogleAdsWebhook).
  if (config.platforms?.google_ads) {
    const gadsKey = EVENT_NAMES[eventName]?.gads;
    if (gadsKey && gadsKey !== 'purchase') {
      promises.push(
        sendGoogleAdsConversion(config.platforms.google_ads, gadsKey, hashed, body, env, siteId)
      );
    }
  }

  // GA4 Measurement Protocol — todos os eventos
  if (config.platforms?.ga4?.measurement_id) {
    promises.push(
      sendGA4Event(config.platforms.ga4, eventName, eventId, body, clientIp, userAgent, env, siteId)
    );
  }

  // Google Sheets — append (lead/eventos configurados) + upsert por user_id
  // (qualified_lead/disqualified_lead completam a linha do lead). Roteamento append/upsert/skip
  // fica dentro de sendSheetsLead.
  if (config.platforms?.sheets?.id_script) {
    promises.push(
      sendSheetsLead(config.platforms.sheets, eventName, body, clientIp, userAgent, config, siteId, env)
    );
  }

  await Promise.allSettled(promises);

  // Response com Set-Cookie para renovar marca_user
  let origin = 'https://example.com';
  let rootDomain = '';
  try {
    if (body.page_url) {
      const pageUrl = new URL(body.page_url);
      origin = pageUrl.origin;
      const parts = pageUrl.hostname.split('.');
      rootDomain = parts.length >= 2 ? '.' + parts.slice(-2).join('.') : pageUrl.hostname;
    }
  } catch (e) { /* fallback */ }

  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Set-Cookie': `marca_user=${marcaUser};Path=/;Max-Age=63072000;HttpOnly;SameSite=Lax;Secure${rootDomain ? ';Domain=' + rootDomain : ''}`
    }
  });
}

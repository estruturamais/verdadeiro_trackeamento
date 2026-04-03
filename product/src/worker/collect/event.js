import { getConfig } from '../shared/config.js';
import { hashPII } from '../shared/hash.js';
import { upsertUserStore } from '../store/user-store.js';
import { logEvent } from '../shared/logger.js';
import { sendMetaCAPI } from '../platforms/meta.js';
import { sendTikTokEvent } from '../platforms/tiktok.js';
import { sendGoogleAdsConversion } from '../platforms/google-ads.js';
import { sendGA4Event } from '../platforms/ga4.js';

export async function handleCollectEvent(request, env) {
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
  try {
    await upsertUserStore(env.DB, {
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
      page_url: body.page_url || '',
      email: body.user_data?.email || '',
      phone: body.user_data?.phone || '',
      fullname: [body.user_data?.first_name, body.user_data?.last_name].filter(Boolean).join(' '),
      city: body.user_data?.city || cfCity,
      state: body.user_data?.state || cfState,
      country: body.user_data?.country || cfCountry,
      zip: body.user_data?.zip || cfZip
    });
  } catch (e) {
    console.error('[collect-event] upsertUserStore failed:', e);
  }

  // 1.5 Log do beacon recebido (garante visibilidade mesmo sem plataformas)
  await logEvent(env.DB, {
    site_id: siteId, event_name: eventName, event_id: eventId,
    platform: 'collect', channel: 'web', source: 'browser',
    status_code: 200, request_ms: 0,
    sent_payload: JSON.stringify(body),
    error_message: '', response_payload: '',
    marca_user: marcaUser, source_ip: clientIp, user_agent: userAgent
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

  // Meta CAPI — pixel padrao
  if (config.platforms?.meta?.pixel_id) {
    promises.push(
      sendMetaCAPI(config.platforms.meta, eventName, eventId, hashed, body, clientIp, userAgent, 'standard', env, siteId)
    );
  }

  // Meta CAPI — pixel de vendas (dual-pixel)
  if (config.platforms?.meta?.pixel_id_purchase) {
    // PageView no pixel de vendas quando page_view
    if (eventName === 'page_view') {
      promises.push(
        sendMetaCAPI(config.platforms.meta, 'page_view', eventId, hashed, body, clientIp, userAgent, 'purchase', env, siteId)
      );
    }
    // Purchase no pixel de vendas quando purchase_trigger_event
    const purchaseTrigger = config.platforms.meta.purchase_trigger_event || 'lead';
    if (eventName === purchaseTrigger) {
      const purchaseEventId = body.purchase_event_id || eventId;
      promises.push(
        sendMetaCAPI(config.platforms.meta, 'purchase_from_trigger', purchaseEventId, hashed, body, clientIp, userAgent, 'purchase', env, siteId)
      );
    }
  }

  // TikTok Events API
  if (config.platforms?.tiktok?.pixel_id) {
    promises.push(
      sendTikTokEvent(config.platforms.tiktok, eventName, eventId, hashed, body, clientIp, userAgent, env, siteId)
    );
  }

  // Google Ads — server (default) ou web, configuravel via google_ads.channel
  if (config.platforms?.google_ads && (config.platforms.google_ads.channel || 'server') === 'server') {
    if (['contact', 'lead'].includes(eventName)) {
      promises.push(
        sendGoogleAdsConversion(config.platforms.google_ads, eventName, hashed, body, env, siteId)
      );
    }
  }

  // GA4 Measurement Protocol — todos os eventos
  if (config.platforms?.ga4?.measurement_id) {
    promises.push(
      sendGA4Event(config.platforms.ga4, eventName, eventId, body, clientIp, userAgent, env, siteId)
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

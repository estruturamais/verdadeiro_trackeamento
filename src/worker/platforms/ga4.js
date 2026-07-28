import { logEvent } from '../shared/logger.js';
import { EVENT_NAMES } from '../shared/event-names.js';
import { cleanSecret } from '../shared/helpers.js';

export async function sendGA4Event(ga4Config, eventName, eventId, body, clientIp, userAgent, env, siteId) {
  const apiSecret = cleanSecret(ga4Config?.api_secret || env.GA4_API_SECRET);
  if (!ga4Config?.measurement_id || !apiSecret) return;

  // Whitespace interno = credencial corrompida (o trim() nao salva). Na query string vira
  // um api_secret invalido que o GA4 rejeita em silencio — falhar explicito.
  if (/\s/.test(apiSecret)) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: eventName, event_id: eventId,
      platform: 'google_analytics_4', channel: 'web', source: 'collect',
      status_code: 0, request_ms: 0,
      sent_payload: '', error_message: 'invalid_api_secret_whitespace',
      response_payload: '',
      marca_user: body.marca_user || '',
      source_ip: clientIp, user_agent: userAgent
    });
    return;
  }

  const gaClientId = body.browser_data?.ga_client_id;
  if (!gaClientId) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: eventName, event_id: eventId,
      platform: 'google_analytics_4', channel: 'web', source: 'collect',
      status_code: 0, request_ms: 0,
      sent_payload: '', error_message: 'missing_ga_client_id',
      response_payload: '',
      marca_user: body.marca_user || '',
      source_ip: clientIp, user_agent: userAgent
    });
    return;
  }

  const ga4EventName = EVENT_NAMES[eventName]?.ga4 || eventName;

  const params = {
    engagement_time_msec: 100,
    page_location: body.page_url || '',
    page_title: body.page_title || ''
  };
  if (body.browser_data?.ga_session_id) params.session_id = String(body.browser_data.ga_session_id);
  if (body.browser_data?.ga_session_count) params.session_number = parseInt(body.browser_data.ga_session_count, 10);
  if (body.custom_data?.value) {
    params.value = parseFloat(body.custom_data.value) || 0;
    params.currency = body.custom_data.currency || 'BRL';
  }

  const payload = {
    client_id: gaClientId,
    ...(body.browser_data?.ga_timestamp ? { timestamp_micros: String(body.browser_data.ga_timestamp) } : {}),
    non_personalized_ads: false,
    events: [{ name: ga4EventName, params }]
  };

  const sentPayload = JSON.stringify(payload);
  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${ga4Config.measurement_id}&api_secret=${apiSecret}`;
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  let gotResponse = false;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: sentPayload
    });
    statusCode = res.status;
    gotResponse = true;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
  } catch (e) {
    // Preserva o status quando a resposta JA tinha chegado e a excecao veio de ler o corpo:
    // zerar faria a linha parecer "nunca saiu", quando o evento pode ter sido aceito.
    if (!gotResponse) statusCode = 0;
    errorMsg = (gotResponse
      ? `body_read_failed: ${String(e)}`
      : `fetch_failed: ${String(e)} | endpoint=www.google-analytics.com measurement_id=${ga4Config.measurement_id} — se for "Network connection lost", verifique o api_secret (whitespace) antes de suspeitar de rede`
    ).substring(0, 500);
  }

  await logEvent(env.DB, {
    site_id: siteId, event_name: ga4EventName, event_id: eventId,
    platform: 'google_analytics_4', channel: 'web', source: 'collect',
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload,
    error_message: errorMsg, response_payload: responsePayload,
    marca_user: body.marca_user || '',
    source_ip: clientIp, user_agent: userAgent
  });
}

export async function sendGA4MP(ga4Config, merged, env, siteId) {
  const apiSecret = cleanSecret(ga4Config?.api_secret || env.GA4_API_SECRET);
  if (!ga4Config?.measurement_id || !apiSecret) return;
  if (!merged.ga_client_id) return;

  // Ver o guard equivalente em sendGA4Event: whitespace interno = credencial corrompida.
  if (/\s/.test(apiSecret)) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: 'purchase', event_id: '',
      platform: 'google_analytics_4', channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
      status_code: 0, request_ms: 0,
      sent_payload: '', error_message: 'invalid_api_secret_whitespace',
      response_payload: '',
      marca_user: merged.marca_user || '',
      source_ip: merged.ip || '', user_agent: merged.user_agent || ''
    });
    return;
  }

  const payload = {
    client_id: merged.ga_client_id,
    ...(merged.ga_timestamp ? { timestamp_micros: String(merged.ga_timestamp) } : {}),
    non_personalized_ads: false,
    events: [{
      name: 'purchase',
      params: {
        ...(merged.ga_session_id ? { session_id: String(merged.ga_session_id) } : {}),
        ...(merged.ga_session_count ? { session_number: parseInt(merged.ga_session_count, 10) } : {}),
        engagement_time_msec: 100,
        page_location: merged.page_url || '',
        transaction_id: String(merged.order_id || ''),
        value: parseFloat(merged.value) || 0,
        currency: merged.currency || 'BRL',
        items: [{
          item_id: String(merged.product_id || ''),
          item_name: merged.product_name || '',
          price: parseFloat(merged.value) || 0,
          quantity: 1
        }]
      }
    }]
  };

  const sentPayload = JSON.stringify(payload);
  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${ga4Config.measurement_id}&api_secret=${apiSecret}`;
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  let gotResponse = false;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: sentPayload
    });
    statusCode = res.status;
    gotResponse = true;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
  } catch (e) {
    // Resposta ja chegada + excecao ao ler o corpo != "nunca saiu" (o evento pode ter sido aceito).
    if (!gotResponse) statusCode = 0;
    errorMsg = (gotResponse
      ? `body_read_failed: ${String(e)}`
      : `fetch_failed: ${String(e)} | endpoint=www.google-analytics.com measurement_id=${ga4Config.measurement_id} — se for "Network connection lost", verifique o api_secret (whitespace) antes de suspeitar de rede`
    ).substring(0, 500);
  }

  await logEvent(env.DB, {
    site_id: siteId, event_name: 'purchase', event_id: '',
    platform: 'google_analytics_4', channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload,
    error_message: errorMsg, response_payload: responsePayload,
    marca_user: merged.marca_user || '',
    source_ip: merged.ip || '', user_agent: merged.user_agent || ''
  });
}

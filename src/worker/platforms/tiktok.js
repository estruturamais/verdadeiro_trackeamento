import { logEvent } from '../shared/logger.js';
import { cleanSecret } from '../shared/helpers.js';

const TIKTOK_EVENT_NAMES = {
  page_view: 'Pageview', contact: 'Contact', lead: 'SubmitForm',
  initiate_checkout: 'InitiateCheckout', purchase: 'Purchase'
};

export async function sendTikTokEvent(tiktokConfig, eventName, eventId, hashed, body, clientIp, userAgent, env, siteId) {
  const accessToken = cleanSecret(tiktokConfig?.access_token || env?.TIKTOK_ACCESS_TOKEN);
  if (!tiktokConfig?.pixel_id || !accessToken) return;

  const tiktokEventName = TIKTOK_EVENT_NAMES[eventName] || eventName;

  // Whitespace interno = credencial corrompida (o trim() nao salva). No header 'Access-Token'
  // isso derruba a conexao — falhar explicito em vez de gravar um erro de rede opaco.
  if (/\s/.test(accessToken)) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: tiktokEventName, event_id: eventId,
      platform: 'tiktok_ads', channel: 'web', source: 'collect',
      status_code: 0, request_ms: 0,
      sent_payload: '', error_message: 'invalid_access_token_whitespace',
      response_payload: '',
      marca_user: body.marca_user || '',
      source_ip: clientIp, user_agent: userAgent
    });
    return;
  }

  const properties = {};
  if (body.custom_data?.value) {
    properties.value = parseFloat(body.custom_data.value) || 0;
    properties.currency = body.custom_data.currency || 'BRL';
  }

  const payload = {
    event_source: 'web',
    event_source_id: tiktokConfig.pixel_id,
    data: [{
      event: tiktokEventName,
      event_time: Math.floor((body.timestamp || Date.now()) / 1000),
      event_id: eventId,
      page: { url: body.page_url || '' },
      user: {
        ...(hashed.email ? { email: hashed.email } : {}),
        ...(hashed.phone ? { phone_number: hashed.phone } : {}),
        ...(hashed.external_id ? { external_id: hashed.external_id } : {}),
        ip: clientIp,
        user_agent: userAgent,
        ...(body.browser_data?.ttp ? { ttp: body.browser_data.ttp } : {}),
        ...(body.browser_data?.ttclid ? { ttclid: body.browser_data.ttclid } : {})
      },
      ...(Object.keys(properties).length > 0 ? { properties } : {})
    }]
  };

  const sentPayload = JSON.stringify(payload);
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  let gotResponse = false;
  try {
    const res = await fetch(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      {
        method: 'POST',
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: sentPayload
      }
    );
    statusCode = res.status;
    gotResponse = true;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
    if (!res.ok) errorMsg = responseText.substring(0, 500);
  } catch (e) {
    // Preserva o status quando a resposta JA tinha chegado e a excecao veio de ler o corpo:
    // zerar faria a linha parecer "nunca saiu", quando o evento pode ter sido aceito.
    if (!gotResponse) statusCode = 0;
    errorMsg = (gotResponse
      ? `body_read_failed: ${String(e)}`
      : `fetch_failed: ${String(e)} | endpoint=business-api.tiktok.com pixel=${tiktokConfig.pixel_id} — se for "Network connection lost", verifique o access_token (whitespace) antes de suspeitar de rede`
    ).substring(0, 500);
  }

  await logEvent(env.DB, {
    site_id: siteId, event_name: tiktokEventName, event_id: eventId,
    platform: 'tiktok_ads', channel: 'web', source: 'collect',
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload,
    error_message: errorMsg, response_payload: responsePayload,
    marca_user: body.marca_user || '',
    source_ip: clientIp, user_agent: userAgent
  });
}

export async function sendTikTokWebhook(tiktokConfig, eventName, hashed, merged, env, siteId) {
  const accessToken = cleanSecret(tiktokConfig?.access_token || env?.TIKTOK_ACCESS_TOKEN);
  if (!tiktokConfig?.pixel_id || !accessToken) return;

  // Ver o guard equivalente em sendTikTokEvent: whitespace interno = credencial corrompida.
  if (/\s/.test(accessToken)) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: eventName, event_id: '',
      platform: 'tiktok_ads', channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
      status_code: 0, request_ms: 0,
      sent_payload: '', error_message: 'invalid_access_token_whitespace',
      response_payload: '',
      marca_user: merged.marca_user || '',
      source_ip: merged.ip || '', user_agent: merged.user_agent || ''
    });
    return;
  }

  const properties = {};
  if (merged.value) {
    properties.value = parseFloat(merged.value) || 0;
    properties.currency = merged.currency || 'BRL';
    if (merged.product_id || merged.product_name) {
      properties.contents = [{
        content_id: String(merged.product_id || ''),
        content_name: merged.product_name || '',
        content_type: 'product',
        price: parseFloat(merged.value) || 0,
        quantity: 1
      }];
    }
  }

  const payload = {
    event_source: 'web',
    event_source_id: tiktokConfig.pixel_id,
    data: [{
      event: eventName,
      event_time: Math.floor(Date.now() / 1000),
      page: { url: merged.page_url || '' },
      user: {
        ...(hashed.email ? { email: hashed.email } : {}),
        ...(hashed.phone ? { phone_number: hashed.phone } : {}),
        ...(hashed.external_id ? { external_id: hashed.external_id } : {}),
        ip: merged.ip || '',
        user_agent: merged.user_agent || '',
        ...(merged.ttp ? { ttp: merged.ttp } : {}),
        ...(merged.ttclid ? { ttclid: merged.ttclid } : {})
      },
      ...(Object.keys(properties).length > 0 ? { properties } : {})
    }]
  };

  const sentPayload = JSON.stringify(payload);
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  let gotResponse = false;
  try {
    const res = await fetch(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      {
        method: 'POST',
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: sentPayload
      }
    );
    statusCode = res.status;
    gotResponse = true;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
    if (!res.ok) errorMsg = responseText.substring(0, 500);
  } catch (e) {
    // Resposta ja chegada + excecao ao ler o corpo != "nunca saiu" (o evento pode ter sido aceito).
    if (!gotResponse) statusCode = 0;
    errorMsg = (gotResponse
      ? `body_read_failed: ${String(e)}`
      : `fetch_failed: ${String(e)} | endpoint=business-api.tiktok.com pixel=${tiktokConfig.pixel_id} — se for "Network connection lost", verifique o access_token (whitespace) antes de suspeitar de rede`
    ).substring(0, 500);
  }

  await logEvent(env.DB, {
    site_id: siteId, event_name: eventName, event_id: '',
    platform: 'tiktok_ads', channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload,
    error_message: errorMsg, response_payload: responsePayload,
    marca_user: merged.marca_user || '',
    source_ip: merged.ip || '', user_agent: merged.user_agent || ''
  });
}

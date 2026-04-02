import { logEvent } from '../utils/logger.js';

const TIKTOK_EVENT_NAMES = {
  page_view: 'Pageview', contact: 'Contact', lead: 'SubmitForm',
  initiate_checkout: 'InitiateCheckout', purchase: 'Purchase'
};

export async function sendTikTokEvent(tiktokConfig, eventName, eventId, hashed, body, clientIp, userAgent, env, siteId) {
  if (!tiktokConfig?.pixel_id || !tiktokConfig?.access_token) return;

  const tiktokEventName = TIKTOK_EVENT_NAMES[eventName] || eventName;

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
  try {
    const res = await fetch(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      {
        method: 'POST',
        headers: {
          'Access-Token': tiktokConfig.access_token,
          'Content-Type': 'application/json'
        },
        body: sentPayload
      }
    );
    statusCode = res.status;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
    if (!res.ok) errorMsg = responseText.substring(0, 500);
  } catch (e) {
    statusCode = 0;
    errorMsg = String(e).substring(0, 500);
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
  if (!tiktokConfig?.pixel_id || !tiktokConfig?.access_token) return;

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
  try {
    const res = await fetch(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      {
        method: 'POST',
        headers: {
          'Access-Token': tiktokConfig.access_token,
          'Content-Type': 'application/json'
        },
        body: sentPayload
      }
    );
    statusCode = res.status;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
    if (!res.ok) errorMsg = responseText.substring(0, 500);
  } catch (e) {
    statusCode = 0;
    errorMsg = String(e).substring(0, 500);
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

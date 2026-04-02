import { logEvent } from '../utils/logger.js';

const META_EVENT_NAMES = {
  page_view: 'PageView', contact: 'Contact', lead: 'Lead',
  initiate_checkout: 'InitiateCheckout', purchase: 'Purchase',
  purchase_from_trigger: 'Purchase'
};

function cleanUserData(userData) {
  for (const key of Object.keys(userData)) {
    const val = userData[key];
    if (Array.isArray(val) && val.length === 0) delete userData[key];
    if (val === '') delete userData[key];
  }
  return userData;
}

export async function sendMetaCAPI(metaConfig, eventName, eventId, hashed, body, clientIp, userAgent, pixelType, env, siteId) {
  const pixelId = pixelType === 'purchase'
    ? metaConfig.pixel_id_purchase
    : metaConfig.pixel_id;
  const accessToken = pixelType === 'purchase'
    ? (metaConfig.access_token_purchase || env.META_ACCESS_TOKEN_PURCHASE)
    : (metaConfig.access_token || env.META_ACCESS_TOKEN);

  if (!pixelId || !accessToken) {
    const missing = !pixelId ? 'pixel_id' : 'access_token';
    const metaEventName = META_EVENT_NAMES[eventName] || eventName;
    await logEvent(env.DB, {
      site_id: siteId, event_name: metaEventName, event_id: eventId,
      platform: 'meta_ads',
      channel: 'web', source: 'collect',
      status_code: 0, request_ms: 0,
      error_message: `missing_${missing}_for_${pixelType}`,
      response_payload: '',
      marca_user: body.marca_user || '',
      source_ip: clientIp, user_agent: userAgent
    });
    return;
  }

  const metaEventName = META_EVENT_NAMES[eventName] || eventName;

  const payload = {
    data: [{
      event_name: metaEventName,
      event_time: Math.floor((body.timestamp || Date.now()) / 1000),
      event_id: eventId,
      event_source_url: body.page_url || '',
      action_source: 'website',
      user_data: cleanUserData({
        em: hashed.email ? [hashed.email] : [],
        ph: hashed.phone ? [hashed.phone] : [],
        fn: hashed.first_name ? [hashed.first_name] : [],
        ln: hashed.last_name ? [hashed.last_name] : [],
        ct: hashed.city ? [hashed.city] : [],
        st: hashed.state ? [hashed.state] : [],
        country: hashed.country ? [hashed.country] : [],
        zp: hashed.zip ? [hashed.zip] : [],
        external_id: hashed.external_id ? [hashed.external_id] : [],
        client_ip_address: clientIp,
        client_user_agent: userAgent,
        fbp: body.browser_data?.fbp || '',
        fbc: body.browser_data?.fbc || ''
      })
    }],
    ...(body.test_event_code ? { test_event_code: body.test_event_code } : {})
  };

  const sentPayload = JSON.stringify(payload);
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${pixelId}/events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: sentPayload
      }
    );
    statusCode = res.status;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
    if (!res.ok) {
      errorMsg = responseText.substring(0, 500);
    }
  } catch (e) {
    statusCode = 0;
    errorMsg = String(e).substring(0, 500);
  }

  await logEvent(env.DB, {
    site_id: siteId, event_name: metaEventName, event_id: eventId,
    platform: 'meta_ads',
    channel: 'web', source: 'collect',
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload,
    error_message: errorMsg, response_payload: responsePayload,
    marca_user: body.marca_user || '',
    source_ip: clientIp, user_agent: userAgent
  });
}

export async function sendMetaCAPIWebhook(metaConfig, eventName, hashed, merged, pixelType, env, siteId) {
  const pixelId = pixelType === 'purchase'
    ? metaConfig.pixel_id_purchase
    : metaConfig.pixel_id;
  const accessToken = pixelType === 'purchase'
    ? (metaConfig.access_token_purchase || env.META_ACCESS_TOKEN_PURCHASE)
    : (metaConfig.access_token || env.META_ACCESS_TOKEN);

  if (!pixelId || !accessToken) {
    const missing = !pixelId ? 'pixel_id' : 'access_token';
    await logEvent(env.DB, {
      site_id: siteId, event_name: eventName, event_id: '',
      platform: 'meta_ads',
      channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
      status_code: 0, request_ms: 0,
      error_message: `missing_${missing}_for_${pixelType}`,
      response_payload: '',
      marca_user: merged.marca_user || '',
      source_ip: merged.ip || '', user_agent: merged.user_agent || ''
    });
    return;
  }

  const customData = {};
  if (eventName === 'Purchase') {
    if (merged.value) { customData.value = parseFloat(merged.value) || 0; }
    if (merged.currency) { customData.currency = merged.currency; }
    if (merged.product_name) { customData.content_name = merged.product_name; }
    if (merged.product_id) { customData.content_ids = [String(merged.product_id)]; }
    if (merged.order_id) { customData.order_id = String(merged.order_id); }
  }

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: merged.page_url || '',
      action_source: 'website',
      user_data: cleanUserData({
        em: hashed.email ? [hashed.email] : [],
        ph: hashed.phone ? [hashed.phone] : [],
        fn: hashed.first_name ? [hashed.first_name] : [],
        ln: hashed.last_name ? [hashed.last_name] : [],
        ct: hashed.city ? [hashed.city] : [],
        st: hashed.state ? [hashed.state] : [],
        country: hashed.country ? [hashed.country] : [],
        zp: hashed.zip ? [hashed.zip] : [],
        external_id: hashed.external_id ? [hashed.external_id] : [],
        client_ip_address: merged.ip || '',
        client_user_agent: merged.user_agent || '',
        fbp: merged.fbp || '',
        fbc: merged.fbc || ''
      }),
      ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {})
    }]
  };

  const sentPayload = JSON.stringify(payload);
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${pixelId}/events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
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
    platform: 'meta_ads',
    channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload,
    error_message: errorMsg, response_payload: responsePayload,
    marca_user: merged.marca_user || '',
    source_ip: merged.ip || '', user_agent: merged.user_agent || ''
  });
}

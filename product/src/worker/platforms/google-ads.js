import { logEvent } from '../utils/logger.js';

export async function sendGoogleAdsConversion(googleAdsConfig, eventName, hashed, body, env, siteId) {
  await logEvent(env.DB, {
    site_id: siteId, event_name: eventName, event_id: body.event_id || '',
    platform: 'google_ads', channel: 'web', source: 'collect',
    status_code: 200, request_ms: 0,
    sent_payload: 'web-only: gtag dispatched in browser',
    error_message: 'web-only: dispatched via gtag in browser',
    response_payload: '',
    marca_user: body.marca_user || '', source_ip: '', user_agent: ''
  });
}

export async function sendGoogleAdsWebhook(googleAdsConfig, hashed, merged, env, siteId) {
  if (!googleAdsConfig?.conversion_label_purchase) return;

  await logEvent(env.DB, {
    site_id: siteId, event_name: 'purchase', event_id: '',
    platform: 'google_ads', channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
    status_code: 501, request_ms: 0,
    sent_payload: 'TODO: not implemented yet',
    error_message: 'TODO: Google Ads Offline Conversion API requires OAuth2 Service Account',
    response_payload: '',
    marca_user: merged.marca_user || '', source_ip: merged.ip || '', user_agent: ''
  });
}

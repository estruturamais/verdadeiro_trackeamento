import { getConfig, detectSiteId } from '../shared/config.js';
import { hashPII } from '../shared/hash.js';
import { generateId } from '../shared/helpers.js';
import { getUserStore } from '../store/user-store.js';

export async function handleDebug(request, env) {
  const url = new URL(request.url);
  const siteId = url.searchParams.get('site_id') || detectSiteId(request, env);
  const config = await getConfig(siteId, env);

  const eventName = url.searchParams.get('event') || 'page_view';
  const email = url.searchParams.get('email') || '';
  const marcaUser = url.searchParams.get('marca_user') || '';
  const eventId = generateId();

  // Consultar user_store se marca_user fornecido
  let userStoreData = null;
  if (marcaUser) {
    userStoreData = await getUserStore(env.DB, marcaUser);
  }

  // Hash dos dados para simular payload
  const hashed = await hashPII({
    email: email,
    phone: url.searchParams.get('phone') || '',
    first_name: url.searchParams.get('first_name') || '',
    last_name: url.searchParams.get('last_name') || '',
    city: url.searchParams.get('city') || '',
    state: url.searchParams.get('state') || '',
    country: url.searchParams.get('country') || '',
    zip: url.searchParams.get('zip') || '',
    external_id: marcaUser
  });

  const wouldSendTo = {};

  // Meta CAPI — pixel padrao
  if (config.platforms?.meta?.pixel_id) {
    wouldSendTo.meta_capi_standard = {
      url: `https://graph.facebook.com/v21.0/${config.platforms.meta.pixel_id}/events`,
      payload: {
        data: [{
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: 'website',
          user_data: {
            em: hashed.email ? [hashed.email] : [],
            ph: hashed.phone ? [hashed.phone] : [],
            external_id: hashed.external_id ? [hashed.external_id] : []
          }
        }]
      }
    };
  }

  // Meta CAPI — pixel purchase
  if (config.platforms?.meta?.pixel_id_purchase) {
    wouldSendTo.meta_capi_purchase = {
      url: `https://graph.facebook.com/v21.0/${config.platforms.meta.pixel_id_purchase}/events`,
      payload: {
        data: [{
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: 'website',
          user_data: {
            em: hashed.email ? [hashed.email] : [],
            ph: hashed.phone ? [hashed.phone] : [],
            external_id: hashed.external_id ? [hashed.external_id] : []
          }
        }]
      }
    };
  }

  // TikTok Events API
  if (config.platforms?.tiktok?.pixel_id) {
    wouldSendTo.tiktok_events_api = {
      url: 'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      payload: {
        event_source: 'web',
        event_source_id: config.platforms.tiktok.pixel_id,
        data: [{
          event: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          user: {
            email: hashed.email,
            external_id: hashed.external_id
          }
        }]
      }
    };
  }

  // Google Ads
  if (config.platforms?.google_ads) {
    wouldSendTo.google_ads = {
      conversion_id: config.platforms.google_ads.conversion_id,
      label: config.platforms.google_ads[`conversion_label_${eventName}`] || ''
    };
  }

  // Listar plataformas configuradas
  const configuredPlatforms = [];
  if (config.platforms?.meta?.pixel_id) configuredPlatforms.push('meta');
  if (config.platforms?.tiktok?.pixel_id) configuredPlatforms.push('tiktok');
  if (config.platforms?.ga4?.measurement_id) configuredPlatforms.push('ga4');
  if (config.platforms?.google_ads?.conversion_id) configuredPlatforms.push('google_ads');

  return new Response(JSON.stringify({
    event: eventName,
    event_id: eventId,
    would_send_to: wouldSendTo,
    user_store_data: userStoreData,
    config_loaded: {
      site_id: config.site_id || siteId,
      platforms: configuredPlatforms
    }
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

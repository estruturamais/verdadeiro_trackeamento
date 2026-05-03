export async function getConfig(siteId, env) {
  try {
    if (env.SITE_CONFIG) {
      const config = typeof env.SITE_CONFIG === 'string'
        ? JSON.parse(env.SITE_CONFIG)
        : env.SITE_CONFIG;
      // Support both map format {"site_id": {...}} and direct format
      if (siteId && config[siteId]) return config[siteId];
      return config;
    }

    if (env.CONFIG_KV) {
      const kvData = await env.CONFIG_KV.get('config:' + siteId, 'json');
      if (kvData) return kvData;
    }

    return {};
  } catch (e) {
    console.error('[config] Error loading config:', e);
    return {};
  }
}

export function detectSiteId(request, env) {
  const url = new URL(request.url);
  const paramId = url.searchParams.get('site_id');
  if (paramId) return paramId;

  const host = request.headers.get('host') || '';
  return host.replace(/:\d+$/, '').replace(/^www\./, '');
}

export async function getConfigForWebhook(env, gateway) {
  try {
    if (env.SITE_CONFIG) {
      const config = typeof env.SITE_CONFIG === 'string'
        ? JSON.parse(env.SITE_CONFIG)
        : env.SITE_CONFIG;
      return config;
    }

    return {};
  } catch (e) {
    console.error('[config] Error loading webhook config:', e);
    return {};
  }
}

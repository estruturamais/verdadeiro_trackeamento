import { handleServeGA4Script, handleGA4CollectProxy } from './routes/ga4-proxy.js';
import { handleServeWebJs } from './routes/serve-webjs.js';
import { handleCollectEvent } from './collect/event.js';
import { handleWebhook } from './collect/webhook.js';
import { handleDebug } from './routes/debug.js';
import { handleLogs } from './routes/logs.js';

function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // OPTIONS preflight — respond 204 with CORS headers
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request.headers.get('Origin'))
      });
    }

    try {

      // GET /scripts/ga.js → proxy gtag.js
      if (path === '/scripts/ga.js' && method === 'GET') {
        return await handleServeGA4Script(request, env);
      }

      // GET/POST /g/collect → proxy GA4 collect
      if (path === '/g/collect') {
        return await handleGA4CollectProxy(request, env);
      }

      // GET /tracking/web.js → serve client script
      if (path === '/tracking/web.js' && method === 'GET') {
        return await handleServeWebJs(request, env);
      }

      // POST /collect/event → real-time beacon
      if (path === '/collect/event' && method === 'POST') {
        return await handleCollectEvent(request, env);
      }

      // POST /collect/webhook/:gateway → gateway webhooks
      if (path.startsWith('/collect/webhook/') && method === 'POST') {
        const gateway = path.split('/collect/webhook/')[1];
        if (gateway) {
          return await handleWebhook(request, env, gateway);
        }
      }

      // GET /collect/debug → debug endpoint
      if (path === '/collect/debug' && method === 'GET') {
        const response = await handleDebug(request, env);
        return addCorsHeaders(response, request);
      }

      // GET /collect/logs → log viewer
      if (path === '/collect/logs' && method === 'GET') {
        const response = await handleLogs(request, env);
        return addCorsHeaders(response, request);
      }

      // 404 for unmatched routes
      return new Response('Not Found', { status: 404 });

    } catch (err) {
      console.error('Worker fetch error:', err);
      const headers = path.startsWith('/collect/')
        ? { 'Content-Type': 'application/json', ...getCorsHeaders(request.headers.get('Origin')) }
        : { 'Content-Type': 'application/json' };
      return new Response(
        JSON.stringify({ error: 'internal_error', message: err.message }),
        { status: 500, headers }
      );
    }
  },

  async scheduled(event, env, ctx) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM events WHERE timestamp < datetime('now', '-30 days')"),
      env.DB.prepare("DELETE FROM webhook_raw WHERE timestamp < datetime('now', '-30 days')"),
      env.DB.prepare("DELETE FROM user_store WHERE updated_at < datetime('now', '-90 days')")
    ]);
  }
};

function addCorsHeaders(response, request) {
  const origin = request.headers.get('Origin') || '*';
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', origin);
  newHeaders.set('Access-Control-Allow-Credentials', 'true');
  return new Response(response.body, {
    status: response.status,
    headers: newHeaders
  });
}

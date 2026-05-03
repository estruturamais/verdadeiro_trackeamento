import { getConfig, detectSiteId } from '../shared/config.js';

export async function handleLogs(request, env) {
  const url = new URL(request.url);
  const siteId = url.searchParams.get('site_id');

  if (!siteId) {
    return new Response(
      JSON.stringify({ error: 'site_id is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Autenticacao via Bearer token
  const config = await getConfig(siteId, env);
  const expectedToken = config.logging?.log_bearer_token || env.LOG_BEARER_TOKEN || '';
  const authHeader = request.headers.get('Authorization') || '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!expectedToken || providedToken !== expectedToken) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Parametros de query
  const days = parseInt(url.searchParams.get('days') || '1', 10);
  const eventName = url.searchParams.get('event_name') || '';
  const eventId = url.searchParams.get('event_id') || '';
  const platform = url.searchParams.get('platform') || '';
  const status = url.searchParams.get('status') || 'all';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000);

  // Construir query
  const conditions = ['site_id = ?1'];
  const params = [siteId];
  let paramIdx = 2;

  // Filtro por dias
  conditions.push(`timestamp >= datetime('now', '-' || ?${paramIdx} || ' days')`);
  params.push(String(days));
  paramIdx++;

  if (eventName) {
    conditions.push(`event_name = ?${paramIdx}`);
    params.push(eventName);
    paramIdx++;
  }

  if (eventId) {
    conditions.push(`event_id = ?${paramIdx}`);
    params.push(eventId);
    paramIdx++;
  }

  if (platform) {
    conditions.push(`platform = ?${paramIdx}`);
    params.push(platform);
    paramIdx++;
  }

  if (status === 'error') {
    conditions.push('(status_code >= 400 OR status_code IS NULL)');
  } else if (status === 'success') {
    conditions.push('status_code BETWEEN 200 AND 299');
  }

  const sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC LIMIT ?${paramIdx}`;
  params.push(limit);

  const result = await env.DB.prepare(sql).bind(...params).all();

  return new Response(JSON.stringify(result.results || []), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

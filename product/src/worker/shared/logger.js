export async function logEvent(db, data) {
  try {
    await db.prepare(`
      INSERT INTO events (site_id, event_name, event_id, platform, channel, source,
        status_code, request_ms, sent_payload, error_message, response_payload,
        marca_user, source_ip, user_agent)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
    `).bind(
      data.site_id || '',
      data.event_name || '',
      data.event_id || '',
      data.platform || '',
      data.channel || '',
      data.source || '',
      data.status_code ?? null,
      data.request_ms ?? null,
      (data.sent_payload || '').substring(0, 2000),
      data.error_message || '',
      data.response_payload || '',
      data.marca_user || '',
      data.source_ip || '',
      data.user_agent || ''
    ).run();
  } catch (e) {
    console.error('[logger] Error writing event log:', e);
  }
}

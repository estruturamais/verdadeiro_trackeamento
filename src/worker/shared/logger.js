import { dbWrite } from './db-write.js';

export async function logEvent(db, data) {
  await dbWrite(
    db,
    () => db.prepare(`
      INSERT INTO events (site_id, event_name, event_id, platform, channel, source,
        status_code, request_ms, sent_payload, error_message, response_payload,
        marca_user, source_ip, user_agent,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
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
      (data.response_payload || '').substring(0, 2000),
      data.marca_user || '',
      data.source_ip || '',
      data.user_agent || '',
      // UTMs do lado web — so a chamada do beacon (platform='collect') preenche; demais ficam ''
      data.utm_source || '',
      data.utm_medium || '',
      data.utm_campaign || '',
      data.utm_term || '',
      data.utm_content || ''
    ).run(),
    'logger.logEvent'
  );
}

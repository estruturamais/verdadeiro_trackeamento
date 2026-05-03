export async function runCleanup(db) {
  await db.batch([
    db.prepare("DELETE FROM events WHERE timestamp < datetime('now', '-7 days')"),
    db.prepare("DELETE FROM webhook_raw WHERE timestamp < datetime('now', '-14 days')"),
    db.prepare("DELETE FROM user_store WHERE updated_at < datetime('now', '-90 days')")
  ]);
}

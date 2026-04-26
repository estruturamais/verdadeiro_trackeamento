-- =============================================================
-- Schema D1 — Sistema de Tracking Proprietario
-- =============================================================

-- 4.1 Tabela user_store
CREATE TABLE IF NOT EXISTS user_store (
  marca_user      TEXT PRIMARY KEY,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Dados do browser (gravados pelo web.js via Beacon)
  ip              TEXT,
  user_agent      TEXT,
  fbp             TEXT,
  fbc             TEXT,
  ttp             TEXT,
  ttclid          TEXT,
  ga_client_id    TEXT,
  ga_session_id   TEXT,
  ga_session_count TEXT,
  ga_timestamp    TEXT,
  page_url        TEXT,
  -- Dados do usuario (gravados no form submit OU de cookies)
  email           TEXT,
  phone           TEXT,
  fullname        TEXT,
  -- Dados de geolocalizacao
  city            TEXT,
  state           TEXT,
  country         TEXT,
  zip             TEXT
);

-- 4.3 Tabela events
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY,
  timestamp     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  site_id       TEXT    NOT NULL,
  event_name    TEXT    NOT NULL,
  event_id      TEXT,
  platform      TEXT    NOT NULL,
  channel       TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  status_code   INTEGER,
  request_ms    INTEGER,
  sent_payload      TEXT,
  error_message     TEXT,
  response_payload  TEXT,
  marca_user        TEXT,
  source_ip     TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_site_time   ON events (site_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_event_id    ON events (event_id);
CREATE INDEX IF NOT EXISTS idx_events_platform    ON events (platform, status_code);
CREATE INDEX IF NOT EXISTS idx_events_timestamp   ON events (timestamp);

-- 4.4 Tabela webhook_raw
-- Sem UNIQUE em (site_id, gateway, order_id): webhook_raw e' input log puro,
-- todo payload recebido e' gravado, mesmo se duplicado. Dedup de dispatch e'
-- feito em codigo via SELECT por (order_id, processed=1).
CREATE TABLE IF NOT EXISTS webhook_raw (
  id          INTEGER PRIMARY KEY,
  timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  site_id     TEXT    NOT NULL,
  gateway     TEXT    NOT NULL,
  order_id    TEXT,
  payload     TEXT    NOT NULL,
  processed   INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_raw_site_time ON webhook_raw (site_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_raw_gateway   ON webhook_raw (gateway, processed);
-- Indice para dedup: busca rapida por order_id ja processado
CREATE INDEX IF NOT EXISTS idx_webhook_raw_dedup     ON webhook_raw (site_id, gateway, order_id, processed);

-- 4.5 Retention (executado pelo Scheduled Worker diariamente as 03:00 UTC)
-- DELETE FROM events WHERE timestamp < datetime('now', '-30 days');
-- DELETE FROM webhook_raw WHERE timestamp < datetime('now', '-30 days');
-- DELETE FROM user_store WHERE updated_at < datetime('now', '-90 days');

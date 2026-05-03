-- Migration 001: remove UNIQUE(site_id, gateway, order_id) de webhook_raw
--
-- Motivo: webhook_raw passa a ser input log puro — todo payload recebido e'
-- gravado, mesmo duplicado. Dedup de dispatch passa a ser feito em codigo
-- via SELECT por (site_id, gateway, order_id, processed=1).
--
-- SQLite nao permite DROP CONSTRAINT direto: e' preciso recriar a tabela.
--
-- Como executar (D1 wrangler):
--   wrangler d1 execute tracking_db --file=product/migrations/001_drop_webhook_raw_unique.sql --remote

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- 1. Recria webhook_raw sem o UNIQUE
CREATE TABLE webhook_raw_new (
  id          INTEGER PRIMARY KEY,
  timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  site_id     TEXT    NOT NULL,
  gateway     TEXT    NOT NULL,
  order_id    TEXT,
  payload     TEXT    NOT NULL,
  processed   INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

-- 2. Copia todos os dados existentes
INSERT INTO webhook_raw_new (id, timestamp, site_id, gateway, order_id, payload, processed, error)
SELECT id, timestamp, site_id, gateway, order_id, payload, processed, error
FROM webhook_raw;

-- 3. Substitui a tabela antiga
DROP TABLE webhook_raw;
ALTER TABLE webhook_raw_new RENAME TO webhook_raw;

-- 4. Recria indices
CREATE INDEX idx_webhook_raw_site_time ON webhook_raw (site_id, timestamp DESC);
CREATE INDEX idx_webhook_raw_gateway   ON webhook_raw (gateway, processed);
CREATE INDEX idx_webhook_raw_dedup     ON webhook_raw (site_id, gateway, order_id, processed);

COMMIT;

PRAGMA foreign_keys = ON;

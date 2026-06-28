-- Migration 002: adiciona colunas de UTM (analistA+) a events e webhook_raw
--
-- Motivo: o analistA+ consulta performance por origem/criativo. Para isso o D1
-- passa a guardar as UTMs CRUAS:
--   - events.utm_*       → UTMs do lado WEB (jornada), populadas so no beacon (platform='collect')
--   - webhook_raw.utm_*  → UTM last-click da venda; + marca_user e value para cruzar/somar
--
-- Quem instala o VT do zero ja recebe estas colunas pelo schema.sql. Esta migration
-- e para instalacoes que JA rodam a 1.1.x e querem evoluir o D1 existente.
--
-- ATENCAO: ADD COLUMN no SQLite NAO e idempotente (nao ha "IF NOT EXISTS" para coluna).
-- Rode UMA vez. Se uma coluna ja existir, o comando correspondente falha — nesse caso,
-- remova as linhas das colunas ja presentes e rode o restante.
--
-- Como executar (D1 wrangler):
--   wrangler d1 execute tracking_db --file=./migrations/002_add_utm_columns.sql --remote

BEGIN TRANSACTION;

-- events: UTMs do lado web (jornada)
ALTER TABLE events ADD COLUMN utm_source   TEXT;
ALTER TABLE events ADD COLUMN utm_medium   TEXT;
ALTER TABLE events ADD COLUMN utm_campaign TEXT;
ALTER TABLE events ADD COLUMN utm_term     TEXT;
ALTER TABLE events ADD COLUMN utm_content  TEXT;

-- webhook_raw: enriquecimento da venda (marca_user, value + UTM last-click)
ALTER TABLE webhook_raw ADD COLUMN marca_user   TEXT;
ALTER TABLE webhook_raw ADD COLUMN value        TEXT;
ALTER TABLE webhook_raw ADD COLUMN utm_source   TEXT;
ALTER TABLE webhook_raw ADD COLUMN utm_medium   TEXT;
ALTER TABLE webhook_raw ADD COLUMN utm_campaign TEXT;
ALTER TABLE webhook_raw ADD COLUMN utm_term     TEXT;
ALTER TABLE webhook_raw ADD COLUMN utm_content  TEXT;

COMMIT;

-- Migration 003: adiciona os click ids do Google (gclid/wbraid/gbraid) a user_store
--
-- Motivo: a conversao offline do Google Ads (Data Manager API) atribui a venda ao
-- clique do anuncio pelo `gclid`. Sem essa coluna o upload sobe so com e-mail/telefone
-- hasheados (match pior) e a auditoria nao consegue nem responder "houve clique?".
--   - gclid   -> clique padrao (auto-tagging ligado na conta)
--   - wbraid  -> clique web em ambiente com restricao de cookie (iOS)
--   - gbraid  -> clique em app
--
-- O UPSERT usa COALESCE(NULLIF(...)): o PRIMEIRO valor nao-vazio gruda. E a semantica
-- correta — o clique que trouxe o visitante e o que atribui a conversao, nao o ultimo
-- pageview da sessao.
--
-- Quem instala o VT do zero ja recebe estas colunas pelo schema.sql. Esta migration
-- e para instalacoes que JA rodam a 1.5.x ou anterior e querem evoluir o D1 existente.
--
-- ATENCAO: ADD COLUMN no SQLite NAO e idempotente (nao ha "IF NOT EXISTS" para coluna).
-- Rode UMA vez. Se uma coluna ja existir, o comando correspondente falha — nesse caso,
-- remova as linhas das colunas ja presentes e rode o restante.
--
-- Como executar (D1 wrangler):
--   wrangler d1 execute tracking_db --file=./migrations/003_add_gclid_columns.sql --remote

ALTER TABLE user_store ADD COLUMN gclid  TEXT;
ALTER TABLE user_store ADD COLUMN wbraid TEXT;
ALTER TABLE user_store ADD COLUMN gbraid TEXT;

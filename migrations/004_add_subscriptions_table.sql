-- Migration 004: tabela de assinaturas (produtos SaaS / recorrencia)
--
-- ATENCAO — ESTA MIGRATION E OPT-IN. Rode SOMENTE em projeto que vai ligar
-- `subscription_tracking` no SITE_CONFIG. Projeto de compra unica (infoproduto
-- classico) NAO deve criar esta tabela: ela ficaria orfa, sem nunca receber uma
-- linha, e o cleanup diario nao a limpa (ver abaixo). Por isso ela NAO esta no
-- `schema.sql` — quem instala o VT do zero num projeto tradicional nao a recebe.
--
-- POR QUE ELA EXISTE
-- O VT foi desenhado para infoproduto, onde cada compra tem um pedido unico. Em SaaS
-- por assinatura isso deixa de valer: na Ticto, `order.hash` (o "Codigo do Pedido",
-- TOC.../TOP...) e o identificador da ASSINATURA e permanece IGUAL em todas as
-- cobrancas; o que muda a cada cobranca e o "Codigo da Ultima Transacao" (TPC...).
-- Sem esta tabela nao ha como distinguir a 1a cobranca (aquisicao de cliente) das
-- renovacoes — e mandar renovacao ao Meta como aquisicao infla a otimizacao e
-- destroi o CAC reportado.
--
-- COMO E USADA (src/worker/shared/subscription.js)
-- Antes do dispatch, para escolher o nome do evento e a acao de conversao:
--   1. assinatura consta aqui como CANCELADA        -> reactivation
--   2. contador de cobrancas do payload > 1         -> renewal
--   3. linha existe (sem contador)                  -> renewal
--   4. e-mail ja e cliente em outra assinatura      -> renewal / reactivation
--   5. nunca visto                                  -> new (aquisicao)
-- Depois do dispatch, a linha e inserida/atualizada (charges_paid).
--
-- IMPORTANTE: esta tabela NAO tem retencao. O cleanup diario (events 7d /
-- webhook_raw 14d / user_store 90d) NAO deve toca-la — perder o historico aqui faz
-- todo assinante antigo voltar a ser contado como cliente novo na cobranca seguinte.
--
-- SEMEADURA DA BASE LEGADA: se o negocio JA tem assinantes antes do VT, importe o
-- CSV de cada gateway (incluindo os CANCELADOS — sao eles que fazem a reativacao
-- funcionar) com `origin = 'legacy_import'`. Use `npm run subs:import`. Sem isso, a
-- primeira cobranca de cada assinante antigo e classificada como AQUISICAO.
--
-- Como executar (D1 wrangler):
--   wrangler d1 execute tracking_db --file=./migrations/004_add_subscriptions_table.sql --remote

CREATE TABLE IF NOT EXISTS subscriptions (
  id                INTEGER PRIMARY KEY,
  site_id           TEXT    NOT NULL,
  gateway           TEXT    NOT NULL,
  -- Ticto: order.hash (= "Codigo do Pedido"). Hotmart: codigo do assinante.
  subscription_id   TEXT    NOT NULL,
  -- normalizados (lower + trim no e-mail; so digitos no telefone), no padrao do user_store
  email             TEXT,
  phone             TEXT,
  plan              TEXT,
  periodicity       TEXT,
  charges_paid      INTEGER NOT NULL DEFAULT 0,
  -- Linhas novas gravam em ingles ('active'/'canceled'); o import legado costuma vir
  -- em portugues ('Ativa'/'Atrasada'/'Cancelada'). O codigo compara case-insensitive
  -- por PREFIXO 'cancel', que cobre os dois idiomas sem normalizacao no import.
  status            TEXT,
  first_charge_at   TEXT,
  last_seen_at      TEXT,
  -- 'legacy_import' = veio do CSV de clientes ativos; 'webhook' = criada por venda real
  origin            TEXT    NOT NULL DEFAULT 'webhook',
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Chave de negocio: uma assinatura por gateway por site.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_key
  ON subscriptions (site_id, gateway, subscription_id);

-- Lookup por e-mail (caso 4 acima): cobre migracao entre gateways e o cliente que
-- cancelou numa assinatura e voltou em outra.
CREATE INDEX IF NOT EXISTS idx_subscriptions_email
  ON subscriptions (email);

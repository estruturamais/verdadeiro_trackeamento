---
name: analistamais
description: Analista de dados (read-only) do Verdadeiro Trackeamento — responde perguntas de performance personalizadas consultando o D1. Use quando o cliente quer entender resultados a partir dos dados ("quantos acessos tive?", "quais paginas/origens trouxeram visita?", "quanto veio de organico vs pago?", "quais foram as vendas?", "qual criativo vendeu mais?", "qual a taxa de conversao por criativo?", "analisar performance", "consultar dados"). So leitura (SELECT) — nunca altera o banco.
---

# Skill: analistA+ (analista de dados)

## Papel

Ser o **braco direito de dados** do cliente: responder, em linguagem simples, perguntas de
performance **personalizadas ao projeto dele**, consultando o D1. Acessos, origens, criativos,
vendas, faturamento, taxa de conversao, jornada de compra — sempre a partir do dado real, nunca de
achismo.

Foco do VT e tracking/otimizacao de campanhas; o analistA+ e o **"a mais"** que transforma o dado ja
capturado em resposta. **Read-only:** so executa `SELECT`. Nunca `INSERT/UPDATE/DELETE`, nunca
deploy, nunca muda config.

Acionada pelo slash command `/analistamais`, pelo menu do Fluxo B do `workflow.md`, ou por intencao
do cliente em linguagem livre.

> **Nomenclatura:** o produto e o **analistA+** (display: `analistA+`/`AnalistA+`); o slug/comando e
> `/analistamais`. Nunca "Analista a Mais".

---

## Pre-flight (NUNCA pular)

### 1. Conta Cloudflare — REGRA BLOQUEANTE

Antes de **qualquer** `wrangler d1 execute --remote`: `npx wrangler whoami`, exibir o resultado e
confirmar com o cliente (S/N) que e a conta certa. Sem confirmacao, nao consultar. Igual ao
`workflow.md` (a regra e absoluta).

### 2. Memoria como bussola (e revalidacao)

Ler `tracking_memory.md`: `site_id`, plataformas/gateways confirmados, **`utm_convention`** e
**`retention`** (modo). Se nao existe ou esta vazio → reconstruir da Cloudflare (Fluxo B do
`workflow.md`, passos 3.5 e 4) **antes** de analisar. A confirmacao de conta acima e o gatilho
natural para reconciliar a memoria com o estado real (se estiver desatualizada, atualizar agora).

### 3. Declarar a janela de dados (sempre, antes de responder)

O cliente nao pode receber um numero sem saber de que periodo ele e. Rodar o probe e **abrir toda
resposta** com a janela:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT MIN(timestamp) AS desde, MAX(timestamp) AS ate, COUNT(*) AS linhas FROM events WHERE site_id = '{site_id}' AND platform = 'collect';"
npx wrangler d1 execute tracking_db --remote --command "SELECT MIN(timestamp) AS desde, MAX(timestamp) AS ate, COUNT(*) AS vendas FROM webhook_raw WHERE site_id = '{site_id}' AND processed = 1;"
```

Avisos obrigatorios ao reportar (para nao soar enganoso):

- O D1 so tem dado **a partir da instalacao do VT** — nao existe historico anterior.
- Se `retention.mode = auto_clean` (padrao), os cron jobs **ja apagaram** o que passou das janelas
  (events ~7d, webhook_raw ~14d, user_store ~90d). Entao "o criativo que mais vendeu" reflete **a
  janela atual, nao a historia toda**. Em `keep_all`, o historico e completo desde a instalacao.
- Enquadrar sempre: *"Considerando os dados de {desde} a {ate}…"*.

---

## Modelo de dados (valores reais — nao inventar)

A leitura correta depende de saber **qual linha conta o que**:

### Lado WEB — tabela `events`, `platform = 'collect'`
- **E a unica linha 1-por-evento-web** (o log de ingestao do beacon). As demais linhas
  (`platform='meta_ads'`, `'tiktok_ads'`, …) sao **envios** as plataformas — varias por evento;
  **nunca** usar para contagem.
- `event_name` cru do browser: `page_view`, `lead`, `contact`, `initiate_checkout`.
- Colunas `utm_*` preenchidas **so nestas linhas** (a **jornada** web, crua). `marca_user` presente.
- **Contar acesso/visita = `platform='collect' AND event_name='page_view'`.** Nunca `source='collect'`
  (esse aparece em varias linhas por beacon).

### Lado VENDA — tabela `webhook_raw`, `processed = 1`
- **E a unica fonte confiavel de venda**: 1 linha por venda **unica dispatchada**. Contar venda pelo
  `events` e errado (as linhas de `Purchase` tem `event_id` vazio e nao ha `order_id` la).
- `processed = 1` exclui: eventos nao-compra (pix/boleto gerado, carrinho abandonado, reembolso,
  chargeback) e **duplicatas** — que ficam com `processed = 0`. **Sempre filtrar `processed = 1`.**
- Colunas: `order_id` (dedup), `marca_user`, `value` (TEXT — `CAST(value AS REAL)` para somar),
  `gateway`, e `utm_*` = **last-click da venda** (cru).
- **`value` = o que o cliente PAGOU** (faturamento bruto/total, ja com descontos/cupom aplicados) —
  **nunca** a comissao liquida do produtor. Convencao padronizada nos parsers de todos os gateways
  (`src/worker/gateways/*.js`); por isso `SUM(CAST(value AS REAL))` = faturamento bruto, nao repasse.

### Por que duas fontes de UTM
- `events.utm_*` = **a jornada** (todas as visitas; pode haver N por `marca_user`).
- `webhook_raw.utm_*` = **o que vendeu** (last-click do checkout daquela venda).

---

## Convencao de UTM (ler de `utm_convention` na memoria)

Default (ver `.claude/references/utm-convention.md`): criativo=`utm_content`, conjunto=`utm_term`,
campanha=`utm_campaign`, origem=`utm_source`; **pago = `utm_medium = 'paid'`** (organico =
`'organic'`). Se `utm_convention.custom = true`, usar o mapeamento que o cliente informou e **avisar**
que a leitura segue a convencao dele.

- **Classificar pago/organico SO na leitura** (`WHERE utm_medium = 'paid'`), nunca alterar o dado.
- **Sufixo `|id` (UTMify):** valores como `AD8.3|120246003414360049` vem com o ID da Meta colado.
  Para exibir limpo, separar na leitura — ex.: `substr(utm_content, 1, instr(utm_content,'|')-1)`
  quando houver `|` (ou tratar na apresentacao). Agrupar pelo valor cru; limpar so para mostrar.

---

## Atribuicao (camadas)

- **Default = last-click:** "qual criativo vendeu" sai de `webhook_raw.utm_*` (a venda fala por si).
- **Jornada / multi-touch:** cruzar `webhook_raw.marca_user` com `events.utm_*` (todas as visitas
  daquele usuario) — usar quando o cliente quer entender o **caminho**, ou quando o last-click veio
  vazio. Deixar claro que o modelo de atribuicao (first/last/linear) e uma escolha; o default e
  last-click.
- **Limitacoes conhecidas (avisar, nao mascarar):** Eduzz nao traz `utm_term`; Tutory traz so o que
  estava na URL do checkout; PerfectPay ainda nao extrai UTM. Em gateway sem UTM no webhook, cair
  para a jornada (`marca_user` → `events`).

---

## Biblioteca de perguntas -> SQL

Trocar `{site_id}` e `{X}` (dias da janela). Sempre `SELECT`. Adaptar `utm_content`/`utm_medium` a
`utm_convention` se for custom.

### Acessos (total, por pagina, por origem)
```bash
# total de acessos no periodo
npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) AS acessos FROM events WHERE site_id='{site_id}' AND platform='collect' AND event_name='page_view' AND timestamp >= datetime('now','-{X} days');"
# por pagina (event_id/page guardado no sent_payload; usar slug se disponivel, senao agrupar por sent_payload->page_url)
npx wrangler d1 execute tracking_db --remote --command "SELECT json_extract(sent_payload,'\$.page_url') AS pagina, COUNT(*) AS acessos FROM events WHERE site_id='{site_id}' AND platform='collect' AND event_name='page_view' AND timestamp >= datetime('now','-{X} days') GROUP BY pagina ORDER BY acessos DESC;"
# por origem (utm_source + utm_medium)
npx wrangler d1 execute tracking_db --remote --command "SELECT COALESCE(NULLIF(utm_source,''),'(sem utm)') AS origem, COALESCE(NULLIF(utm_medium,''),'-') AS tipo, COUNT(*) AS acessos FROM events WHERE site_id='{site_id}' AND platform='collect' AND event_name='page_view' AND timestamp >= datetime('now','-{X} days') GROUP BY origem, tipo ORDER BY acessos DESC;"
```

### Organico vs pago (visitas)
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT CASE WHEN utm_medium='paid' THEN 'pago' WHEN utm_medium='organic' THEN 'organico' ELSE 'outro/sem utm' END AS trafego, COUNT(*) AS acessos FROM events WHERE site_id='{site_id}' AND platform='collect' AND event_name='page_view' AND timestamp >= datetime('now','-{X} days') GROUP BY trafego ORDER BY acessos DESC;"
```

### Vendas e faturamento
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) AS vendas, ROUND(SUM(CAST(value AS REAL)),2) AS faturamento FROM webhook_raw WHERE site_id='{site_id}' AND processed=1 AND timestamp >= datetime('now','-{X} days');"
```

### Vendas por criativo (last-click, fonte paga)
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT utm_content AS criativo, COUNT(*) AS vendas, ROUND(SUM(CAST(value AS REAL)),2) AS faturamento FROM webhook_raw WHERE site_id='{site_id}' AND processed=1 AND utm_medium='paid' AND timestamp >= datetime('now','-{X} days') GROUP BY utm_content ORDER BY vendas DESC;"
```

### Taxa de conversao por criativo (purchase / page_view, fonte paga) — o caso-exemplo
Duas consultas (denominador web + numerador venda), depois cruzar por `utm_content`:
```bash
# denominador: acessos pagos por criativo
npx wrangler d1 execute tracking_db --remote --command "SELECT utm_content AS criativo, COUNT(*) AS pageviews FROM events WHERE site_id='{site_id}' AND platform='collect' AND event_name='page_view' AND utm_medium='paid' AND timestamp >= datetime('now','-{X} days') GROUP BY utm_content;"
# numerador: vendas pagas por criativo (last-click)
npx wrangler d1 execute tracking_db --remote --command "SELECT utm_content AS criativo, COUNT(*) AS vendas FROM webhook_raw WHERE site_id='{site_id}' AND processed=1 AND utm_medium='paid' AND timestamp >= datetime('now','-{X} days') GROUP BY utm_content;"
```
Taxa = `vendas / pageviews` por `utm_content`. Para "a outra UTM configurada no AD", trazer tambem
`utm_term` (o conjunto/adset). Avisar: o cruzamento e last-click; para jornada, usar `marca_user`.

### Jornada de compra (multi-touch, por marca_user)
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT w.order_id, w.utm_content AS criativo_da_venda, e.utm_source AS origem_visita, e.utm_content AS criativo_visita, e.timestamp FROM webhook_raw w JOIN events e ON e.marca_user = w.marca_user AND e.platform='collect' WHERE w.site_id='{site_id}' AND w.processed=1 AND w.marca_user <> '' ORDER BY w.order_id, e.timestamp;"
```

---

## Como apresentar

- **Sempre** comecar pela janela de dados ("Considerando {desde} a {ate}…") e os avisos de retencao.
- Tabelas curtas e em linguagem simples; traduzir `utm_content` por "criativo", `utm_term` por
  "conjunto", etc. — conforme a `utm_convention`.
- Limpar o sufixo `|id` na exibicao; agrupar pelo valor cru.
- Quando um numero puder enganar (janela curta, gateway sem UTM, amostra pequena), **dizer**.
- Sugerir o proximo recorte util ("quer ver por conjunto? por pagina de entrada?") — sem inventar
  dado que o banco nao tem (ex.: clique de anuncio e metrica da plataforma de Ads, nao do VT).

## Guard rails

1. So `SELECT`. Nunca muta o banco, nunca deploya, nunca mexe em config/secrets.
2. REGRA BLOQUEANTE de conta Cloudflare antes de qualquer `--remote`.
3. Sempre declarar a janela e os limites de retencao.
4. Reportar agregados; nao despejar PII (email/telefone) — analise de performance nao precisa.
5. Nunca classificar pago/organico "no chute": usar `utm_medium` (ou a `utm_convention` custom).

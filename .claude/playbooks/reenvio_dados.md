# Skill: reenvio_dados

**Quando usar:** Quando eventos de páginas ou compras (webhooks) deixaram de ser enviados para pixels ou plataformas específicas e precisam ser reenviados retroativamente.

---

## Pré-requisito: levantar variáveis do projeto

Antes de qualquer fase, extraia as variáveis abaixo do `wrangler.toml` do projeto:

```bash
grep -E "name|database_name|database_id|route|workers_dev" wrangler.toml | grep -v "^#"
```

| Variável | Onde encontrar |
|---|---|
| `{WORKER_DOMAIN}` | campo `route` ou URL gerada pelo `workers_dev` no `wrangler.toml` |
| `{DB_NAME}` | campo `database_name` no binding D1 do `wrangler.toml` |
| `{DATABASE_ID}` | campo `database_id` no binding D1 do `wrangler.toml` |
| `{REPROCESS_SECRET}` | wrangler secret — verificar com `npx wrangler secret list` (nome esperado: `REPROCESS_SECRET`) |

**Verificar se o endpoint existe:**
```bash
ls src/worker/routes/ | grep reprocess
```

Se o arquivo não existir, o endpoint `/collect/reprocess-selective` **ainda não foi implementado neste projeto**. Informar ao usuário antes de prosseguir — o reenvio não pode ser executado sem ele.

---

## Como funciona

Esta skill conduz 5 fases em ordem: **coleta → confirmação → consulta prévia → execução → verificação**. Não pule nenhuma fase nem execute nada antes da confirmação explícita do usuário.

---

## Fase 1 — Coleta de dados

Reúna as seguintes informações antes de qualquer ação. Se o usuário já informou algum dado no prompt inicial, reutilize — só pergunte o que estiver faltando.

### Perguntas a fazer

**1. Período**
> "De qual data até qual data devo consultar os logs? (padrão: hoje e ontem)"

Formato aceito do usuário: `DD/MM/AAAA` (padrão brasileiro). Converta internamente para `YYYY-MM-DD` ao montar queries e curl. Se o usuário disser "hoje e ontem", converta para as datas reais.

**2. Plataforma(s)**
> "Quais plataformas devem receber os dados? (Meta Ads, TikTok Ads, GA4 — pode ser mais de uma)"

A execução automática via endpoint suporta atualmente apenas **Meta Ads** (`platform='meta_ads'`). Para TikTok Ads (`tiktok_ads`) e GA4 (`google_analytics_4`), documentar como limitação e orientar execução manual conforme a skill correspondente. **GA4, compra que não foi ao GA4:** roteiro manual na seção [GA4 — reenvio manual do purchase (até 72h)](#ga4--reenvio-manual-do-purchase-até-72h) abaixo — ele **não** usa o endpoint.

**3. Pixels / IDs de destino** *(apenas para Meta Ads)*
> "Quais pixel IDs do Meta devem receber os dados? Liste apenas os pixels espelho ou de destino — **não inclua o pixel primário** a menos que o usuário confirme explicitamente que quer reenviar para ele também."

Se o usuário não souber os IDs, consulte o `wrangler.toml`:
```bash
grep -A5 '"meta"' wrangler.toml
```
Campos relevantes: `pixel_id` (primário — excluir por padrão), `pixel_ids_mirror` (espelhos — incluir).

**4. Escopo de páginas**
> "Quais URLs de páginas devem ser incluídas? Cole as URLs completas, uma por linha. (ou diga 'nenhuma' para pular eventos de página)"

O filtro usa `startsWith` — variações com `?utm_source=...` são incluídas automaticamente.

**5. Escopo de webhooks (compras)**
> "Quais product_ids de produtos devem ser incluídos? (ou diga 'nenhum' para pular webhooks de compra)"

O product_id vive em caminhos diferentes no payload de cada gateway — **fonte da verdade: o parser em `src/worker/gateways/{gateway}.js`** (qualquer reprocessamento deve ler pelo mesmo caminho). Snapshot atual:
- **Hotmart / PagTrust**: `data.product.id`
- **Kiwify**: `Product.product_id`
- **Kirvano**: `data.products.0.id`
- **Lastlink**: `Data.Products.0.Id`
- **Hubla**: `event.product.id` (ou `event.products.0.id`)
- **Eduzz**: `data.items.0.productId`
- **Ticto**: `item.product_id`
- **Payt**: `product.code`
- **PerfectPay**: `product.code`

---

## Fase 2 — Confirmação

Antes de executar qualquer coisa, apresente este resumo ao usuário e **aguarde confirmação explícita** ("pode executar", "sim", "ok" ou similar):

```
Resumo do reenvio:

Banco Cloudflare D1: {DATABASE_ID}
Worker: {WORKER_DOMAIN}/collect/reprocess-selective

Período: {DD/MM/AAAA} a {DD/MM/AAAA}
Plataformas: {lista}

[Meta Ads]
Pixels destino: {lista de pixel_ids}
⚠️  Pixel primário: {pixel_id do wrangler.toml} — EXCLUÍDO (não será reenviado)

Eventos de página:
{lista de URLs — ou "Nenhuma"}

Webhooks de compra:
Product IDs: {lista — ou "Nenhum"}

Endpoint: POST https://{WORKER_DOMAIN}/collect/reprocess-selective
```

Se alguma variável não estiver confirmada, pergunte:
> "Você está logado na conta Cloudflare correta? O database_id é `{DATABASE_ID}` (extraído do `wrangler.toml`). Confirme antes de prosseguir."

---

## Fase 3 — Consulta prévia (somente leitura)

Mostre quantos registros serão processados antes de executar. Use o wrangler CLI:

**Eventos de página no período:**
```bash
npx wrangler d1 execute {DB_NAME} --remote --command \
  "SELECT event_name, COUNT(*) as total FROM events WHERE platform='collect' AND channel='web' AND timestamp >= '{YYYY-MM-DD}T00:00:00' AND timestamp <= '{YYYY-MM-DD}T23:59:59' GROUP BY event_name ORDER BY total DESC"
```
> O filtro por URL é aplicado pelo endpoint em JS — este número é o total bruto do período.

**Webhooks no período:**
```bash
npx wrangler d1 execute {DB_NAME} --remote --command \
  "SELECT gateway, COUNT(*) as total FROM webhook_raw WHERE timestamp >= '{YYYY-MM-DD}T00:00:00' AND timestamp <= '{YYYY-MM-DD}T23:59:59' GROUP BY gateway ORDER BY total DESC"
```
> O filtro por product_id é aplicado pelo endpoint em JS.

**⚠️ Limitação conhecida sobre timestamps de webhooks:** o campo `timestamp` da tabela `webhook_raw` registra o momento em que o Worker *recebeu* o webhook, não o horário original da transação no gateway. Para Hotmart, o horário real da compra estaria em `data.purchase.order_date` — mas esse campo não está mapeado no FDV atualmente. A consulta por data filtra pela data de recebimento.

Apresente os resultados ao usuário antes de prosseguir.

---

## Fase 4 — Execução

Execute o curl com os dados coletados. Lembre de converter as datas de `DD/MM/AAAA` para `YYYY-MM-DD` neste passo.

Substitua `{REPROCESS_SECRET}` pelo valor do wrangler secret (obtido via `npx wrangler secret list` — o valor em si deve ser fornecido pelo usuário ou estar documentado no projeto):

```bash
curl -s -X POST https://{WORKER_DOMAIN}/collect/reprocess-selective \
  -H "Authorization: Bearer {REPROCESS_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{
    "pixel_ids": ["{pixel_id_1}", "{pixel_id_2}"],
    "page_urls": [
      "https://exemplo.com/pagina-1",
      "https://exemplo.com/pagina-2"
    ],
    "product_ids": ["{product_id}"],
    "from_date": "YYYY-MM-DD",
    "to_date": "YYYY-MM-DD"
  }'
```

- Se não há páginas: `"page_urls": []`
- Se não há webhooks: `"product_ids": []`
- O endpoint não altera o campo `processed` dos webhooks — seguro reexecutar

---

## Fase 5 — Verificação por plataforma

### Meta Ads (`platform='meta_ads'`)

**Interpretar o resultado JSON:**
```json
{
  "pages":    { "total": 39, "ok": 39, "error": 0 },
  "webhooks": { "total": 67, "ok": 67, "error": 0, "skipped": 0 }
}
```
- `ok`: enviados com sucesso
- `skipped`: webhooks ignorados (não são eventos de aprovação de compra)
- `error`: falha no envio — checar `details` para ver quais IDs falharam

**Verificar no painel:**
1. Meta Events Manager → selecionar cada pixel espelho → Testar Eventos
2. Filtrar pelo período do reenvio
3. Confirmar que o pixel primário **não aparece** nos eventos reenviados

**Se houver erros:**
- Verificar se o `META_ACCESS_TOKEN` está válido (`npx wrangler secret list`)
- Verificar se os pixel IDs estão corretos
- Consultar `events` no D1 com `platform='meta_ads'` para ver a resposta da API

---

## GA4 — reenvio manual do purchase (até 72h)

**Quando:** venda que **não foi** ao GA4 — linha `google_analytics_4 / purchase / missing_ga_client_id`
em `events` (1.9.0+), ou receita do GA4 abaixo da do gateway depois de desligar um emissor antigo (ver
o sintoma na seção 2.6 do `.claude/skills/audit-tracking/SKILL.md`). Recupera **só o GA4**.

**Por que não reenviar o webhook:** o dedup (`order_id` + `product_id`) barra a 2ª passagem — e, se
passasse, duplicaria a venda na Meta, no TikTok e no Google Ads. O `/collect/reprocess-selective`
também não serve: ele é só Meta.

**A janela de 72h:** o Measurement Protocol aceita `timestamp_micros` até 72h no passado. Dentro dela,
a venda entra **no dia e hora em que o webhook chegou**. Depois de 72h o GA4 aceita, mas lança o evento
72h atrás — a receita cai no dia errado. Não deixe para depois.

**1. Achar as vendas e o horário de recebimento** (só leitura):

```bash
npx wrangler d1 execute {DB_NAME} --remote --command \
  "SELECT e.event_id, e.marca_user, w.gateway, w.timestamp AS recebido_em FROM events e JOIN webhook_raw w ON w.order_id = e.event_id WHERE e.platform = 'google_analytics_4' AND e.event_name = 'purchase' AND e.error_message = 'missing_ga_client_id' AND e.timestamp >= datetime('now','-3 days') ORDER BY e.id DESC"
```

> O `webhook_raw.order_id` guarda o `txnId` (`order_id` + `_` + `product_id`), o mesmo valor do
> `events.event_id`. Se o JOIN vier vazio, buscar pelo `event_id` no `webhook_raw.payload` com `LIKE`.

Conferir **antes** que a venda não está no GA4 por outro caminho (outro emissor ainda ligado, ou uma
linha `204` do VT para o mesmo `event_id`) — reenviar o que já entrou conta em dobro.

**2. Montar o payload com o código REAL** (parser + `fdvMerge` + `sendGA4MP`, com o `fetch`
interceptado — nada sai daqui). Script descartável na raiz do repo, **não commitar**:

```js
// reenvio-ga4.mjs — node reenvio-ga4.mjs <gateway> <payload.json> <recebido_em ISO> [user_store.json]
import { readFileSync } from 'node:fs';
import { GATEWAY_PARSERS } from './src/worker/gateways/index.js';
import { fdvMerge } from './src/worker/store/fdv.js';
import { sendGA4MP } from './src/worker/platforms/ga4.js';

const [, , gateway, payloadFile, recebidoEm, storeFile] = process.argv;
const data = GATEWAY_PARSERS[gateway](JSON.parse(readFileSync(payloadFile, 'utf8')));
const store = storeFile ? JSON.parse(readFileSync(storeFile, 'utf8')) : null; // linha do user_store, se o FDV recuperou
const merged = { ...fdvMerge(store, data), gateway,
  event_id: data.product_id ? `${data.order_id}_${data.product_id}` : String(data.order_id) };

let out;
globalThis.fetch = async (_url, init) => { out = JSON.parse(init.body); return new Response(null, { status: 204 }); };
const DB = { prepare: () => ({ bind: () => ({ run: async () => {} }) }) };
// unattributed_purchases so aqui: sem client_id real, sai o sintetico (mesma formula do opt-in, nunca PII)
await sendGA4MP({ measurement_id: '{G-XXXXXXXXXX}', api_secret: 'x', unattributed_purchases: true },
  merged, { DB }, '{site_id}');
out.timestamp_micros = String(Date.parse(recebidoEm) * 1000);   // hora em que o webhook chegou
console.log(JSON.stringify(out));
```

O `payload.json` é o `webhook_raw.payload` da venda. Com identidade recuperada (ex.: o `marca_user`
existe no `user_store`), exporte a linha do `user_store` para o `user_store.json` — aí sai o `client_id`
real, com sessão; sem ela, sai o sintético (sem sessão e sem engajamento: entra na receita sem inventar
visita).

**3. Validar o formato** no servidor oficial (não grava nada):

```bash
node reenvio-ga4.mjs kiwify payload.json 2026-10-13T14:02:11Z > ga4.json
curl -s -X POST "https://www.google-analytics.com/debug/mp/collect?measurement_id={G-XXXXXXXXXX}&api_secret=x" \
  -H "Content-Type: application/json" -d @ga4.json
```

Só seguir com `{"validationMessages":[]}`.

**4. Enviar** — confirmação explícita do usuário antes (o envio é definitivo; o GA4 não apaga evento):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://www.google-analytics.com/mp/collect?measurement_id={G-XXXXXXXXXX}&api_secret={api_secret}" \
  -H "Content-Type: application/json" -d @ga4.json
```

`204` = aceito. O `api_secret` não sai do cofre da Cloudflare (`wrangler secret` não devolve o valor):
use um que o cliente tenha, ou crie um novo em GA4 > Admin > Fluxos de dados > Web > *Segredos da API
do Measurement Protocol* só para o reenvio e apague depois. Apagar `reenvio-ga4.mjs`, `payload.json`,
`user_store.json` e `ga4.json` ao terminar.

**5. Conferir e registrar.** Evento com data no passado **não aparece no Tempo real** — conferir nos
relatórios de monetização/receita depois do processamento do GA4 (pode levar até 24-48h). O reenvio
manual **não grava** linha em `events`: registrar no `tracking_memory.md` (data, `event_id`s, `client_id`
real ou sintético).

---

## Referência técnica

### Endpoint `/collect/reprocess-selective`

| Campo | Descrição |
|---|---|
| Método | `POST` |
| Auth | `Authorization: Bearer {REPROCESS_SECRET}` (wrangler secret do projeto) |
| `pixel_ids` | Array de pixel IDs Meta que receberão os eventos |
| `page_urls` | Array de URLs — filtro por `startsWith`, inclui variações com querystring |
| `product_ids` | Array de product IDs — busca nos caminhos dos gateways suportados |
| `from_date` | `YYYY-MM-DD` (início do período, inclusive) |
| `to_date` | `YYYY-MM-DD` (fim do período, inclusive) |

**Caminhos de product_id por gateway** (fonte da verdade: os parsers em `src/worker/gateways/`):

| Gateway | Caminho no payload |
|---|---|
| Hotmart / PagTrust | `data.product.id` |
| Kiwify | `Product.product_id` |
| Kirvano | `data.products.0.id` |
| Lastlink | `Data.Products.0.Id` |
| Hubla | `event.product.id` (ou `event.products.0.id`) |
| Eduzz | `data.items.0.productId` |
| Ticto | `item.product_id` |
| Payt | `product.code` |
| PerfectPay | `product.code` |

### Banco D1

| Variável | Valor (extrair do `wrangler.toml`) |
|---|---|
| `{DB_NAME}` | campo `database_name` |
| `{DATABASE_ID}` | campo `database_id` |

| Tabela | Conteúdo relevante |
|---|---|
| `events` | Logs de eventos de página (`platform='collect'`, `channel='web'`, `sent_payload` com o beacon completo) |
| `webhook_raw` | Payloads brutos de todos os gateways (`processed=1` para já processados) |

Timestamps em formato ISO com Z: `2026-04-08T13:07:04.372Z`

### Pixels no projeto (referência)

Consulte sempre o `wrangler.toml` para os valores atuais:
```bash
grep SITE_CONFIG wrangler.toml | python -m json.tool 2>/dev/null || grep SITE_CONFIG wrangler.toml
```
Campos: `platforms.meta.pixel_id` (primário), `platforms.meta.pixel_ids_mirror` (espelhos).

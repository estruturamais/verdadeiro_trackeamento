# Skill: reenvio_dados

**Quando usar:** Quando eventos de páginas ou compras (webhooks) deixaram de ser enviados para pixels ou plataformas específicas e precisam ser reenviados retroativamente.

---

## Pré-requisito: levantar variáveis do projeto

Antes de qualquer fase, extraia as variáveis abaixo do `wrangler.toml` do projeto:

```bash
grep -E "name|database_name|database_id|route|workers_dev" product/wrangler.toml | grep -v "^#"
```

| Variável | Onde encontrar |
|---|---|
| `{WORKER_DOMAIN}` | campo `route` ou URL gerada pelo `workers_dev` no `wrangler.toml` |
| `{DB_NAME}` | campo `database_name` no binding D1 do `wrangler.toml` |
| `{DATABASE_ID}` | campo `database_id` no binding D1 do `wrangler.toml` |
| `{REPROCESS_SECRET}` | wrangler secret — verificar com `npx wrangler secret list` (nome esperado: `REPROCESS_SECRET`) |

**Verificar se o endpoint existe:**
```bash
ls product/src/worker/routes/ | grep reprocess
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

A execução automática via endpoint suporta atualmente apenas **`tracking_meta_ads`** (Meta Ads). Para `tracking_tiktok_ads` (TikTok Ads) e `tracking_ga4` (GA4), documentar como limitação e orientar execução manual conforme a skill correspondente.

**3. Pixels / IDs de destino** *(apenas para Meta Ads)*
> "Quais pixel IDs do Meta devem receber os dados? Liste apenas os pixels espelho ou de destino — **não inclua o pixel primário** a menos que o usuário confirme explicitamente que quer reenviar para ele também."

Se o usuário não souber os IDs, consulte o `wrangler.toml`:
```bash
grep -A5 '"meta"' product/wrangler.toml
```
Campos relevantes: `pixel_id` (primário — excluir por padrão), `pixel_ids_mirror` (espelhos — incluir).

**4. Escopo de páginas**
> "Quais URLs de páginas devem ser incluídas? Cole as URLs completas, uma por linha. (ou diga 'nenhuma' para pular eventos de página)"

O filtro usa `startsWith` — variações com `?utm_source=...` são incluídas automaticamente.

**5. Escopo de webhooks (compras)**
> "Quais product_ids de produtos devem ser incluídos? (ou diga 'nenhum' para pular webhooks de compra)"

O filtro busca o product_id nos seguintes caminhos do payload, dependendo do gateway:
- **Hotmart**: `data.product.id`
- **Kiwify**: `Product.product_id`
- **Outros gateways**: `product_id` (raiz)

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

### Meta Ads (`tracking_meta_ads`)

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

**Caminhos de product_id por gateway:**

| Gateway | Caminho no payload |
|---|---|
| Hotmart | `data.product.id` |
| Kiwify | `Product.product_id` |
| Outros | `product_id` (raiz) |

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
grep SITE_CONFIG product/wrangler.toml | python -m json.tool 2>/dev/null || grep SITE_CONFIG product/wrangler.toml
```
Campos: `platforms.meta.pixel_id` (primário), `platforms.meta.pixel_ids_mirror` (espelhos).

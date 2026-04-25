# SPEC: Retenção de Dados e Escrita Defensiva no D1

## Contexto

O banco D1 (`tracking_db`) atingiu o limite de tamanho (`D1_ERROR: Exceeded maximum DB size`) durante um pico de reenvios da Hubla. O erro fazia o worker retornar HTTP 500, o que acionava o mecanismo de retry do gateway, que por sua vez enviava mais webhooks — um ciclo que agravava o problema.

Em 25/04/2026, durante um diagnóstico de incidente real, foram identificados dois problemas críticos adicionais:

1. **`getUserStore` em `webhook.js` não estava protegido por `try/catch`** — um erro de banco nessa linha abortava o webhook inteiro *antes* do dispatch para as plataformas (Meta, TikTok, etc.), fazendo com que vendas não fossem rastreadas mesmo com o gateway recebendo HTTP 200.
2. **O cleanup dependia exclusivamente do cron** — que pode não executar em certos ambientes. Sem fallback, o banco cresce indefinidamente até atingir o limite.

Esta spec define as regras permanentes de retenção, os limites de payload, o padrão de escrita defensiva e o mecanismo de cleanup em múltiplas camadas que deve ser seguido em qualquer contribuição futura.

---

## Princípios

1. **`webhook_raw` é um audit log** — todo payload recebido deve ser gravado, sem exceção.
2. **Falhas de gravação nunca bloqueiam o processamento** — se o banco estiver cheio, o webhook ainda é despachado para as plataformas (Meta, TikTok, etc.) e o gateway recebe HTTP 200.
3. **Reads de banco também devem ser protegidos** — `getUserStore` e qualquer outro SELECT dentro de `handleWebhook` deve usar `.catch(() => null)`. Um SELECT que lança exceção aborta o webhook da mesma forma que um INSERT.
4. **A retenção garante espaço permanente** — dados suficientemente antigos são excluídos de forma recorrente para que o banco nunca encha em condições normais.
5. **Payloads têm tamanho máximo** — colunas TEXT usadas para debug têm limite explícito de caracteres.

---

## Tabelas e Retenção

| Tabela | O que armazena | Retenção | Justificativa |
|---|---|---|---|
| `webhook_raw` | Payload bruto de cada webhook recebido | **14 dias** | Audit log de 2 semanas é suficiente para investigar qualquer incidente |
| `events` | Log de cada envio para Meta, TikTok, GA4, Google Ads | **7 dias** | Usado apenas para debug imediato; problemas são investigados em horas |
| `user_store` | Dados de sessão e PII do visitante | **90 dias** | Janela longa necessária para atribuir compras a visitas antigas |

---

## Módulo de Cleanup (`shared/cleanup.js`)

`runCleanup` é extraído em módulo próprio para ser importado de qualquer handler, sem criar dependências circulares.

**`src/worker/shared/cleanup.js`**
```js
export async function runCleanup(db) {
  await db.batch([
    db.prepare("DELETE FROM events WHERE timestamp < datetime('now', '-7 days')"),
    db.prepare("DELETE FROM webhook_raw WHERE timestamp < datetime('now', '-14 days')"),
    db.prepare("DELETE FROM user_store WHERE updated_at < datetime('now', '-90 days')")
  ]);
}
```

Os DELETEs são eficientes porque `timestamp` é indexado (`idx_events_timestamp`, `idx_webhook_raw_site_time`). Quando não há registros antigos para excluir, o custo é próximo de zero.

---

## Cleanup em Múltiplas Camadas

O banco nunca deve depender de uma única camada para ser limpo. A arquitetura usa quatro camadas independentes:

| Camada | Onde | Frequência | Comportamento |
|---|---|---|---|
| **1 — Cron** | `index.js` → `scheduled` | A cada 6h | Mecanismo primário; garante limpeza regular em produção |
| **2 — Todo webhook de compra** | `webhook.js` → `handleWebhook` | 100% dos webhooks | `ctx.waitUntil` — não atrasa a resposta; cobre períodos sem cron |
| **3 — Eventos de browser** | `event.js` → `handleCollectEvent` | ~1% dos PageViews | Backup em tráfego de alto volume; `Math.random() < 0.01` |
| **4 — Catch de erro** | `index.js` → bloco `catch` | Quando qualquer rota lança D1_ERROR | Última linha de defesa quando o banco já está cheio |

### Camada 1 — Cron

**`wrangler.toml`**
```toml
[triggers]
crons = ["0 */6 * * *"]
```

**`src/worker/index.js`**
```js
import { runCleanup } from './shared/cleanup.js';

// No export default:
async scheduled(event, env, ctx) {
  await runCleanup(env.DB);
}
```

### Camada 2 — Todo webhook de compra

O cleanup é disparado via `ctx.waitUntil` logo na entrada de `handleWebhook`, antes de qualquer processamento. Por ser não-bloqueante, não impacta a latência da resposta ao gateway.

**`src/worker/collect/webhook.js`**
```js
import { runCleanup } from '../shared/cleanup.js';

export async function handleWebhook(request, env, gateway, ctx) {
  // Cleanup proativo: custo ~0 quando nada a deletar (DELETE indexado por timestamp)
  ctx.waitUntil(runCleanup(env.DB).catch(() => {}));
  // ...resto do handler
}
```

### Camada 3 — Eventos de browser

**`src/worker/collect/event.js`**
```js
import { runCleanup } from '../shared/cleanup.js';

export async function handleCollectEvent(request, env, ctx) {
  if (Math.random() < 0.01) {
    ctx.waitUntil(runCleanup(env.DB).catch(() => {}));
  }
  // ...resto do handler
}
```

### Camada 4 — Catch de erro (emergência)

**`src/worker/index.js`**
```js
} catch (err) {
  if (err.message?.includes('D1_ERROR') || err.message?.includes('maximum DB size')) {
    ctx.waitUntil(runCleanup(env.DB).catch(() => {}));
  }
  // ...retornar Response de erro normalmente
}
```

---

## Padrão de Escrita Defensiva

**Regra geral:** nenhum erro de banco — write ou read — deve propagar para fora de `handleWebhook`. Qualquer exceção não capturada resulta em HTTP 500, que aciona retries do gateway e piora o problema.

### Reads (getUserStore e similares)

```js
// CORRETO — erro capturado; processamento continua sem dados de sessão
const storeResult = webhookData.marca_user
  ? await getUserStore(env.DB, webhookData.marca_user).catch(() => null)
  : null;
```

```js
// ERRADO — se o banco lançar exceção, o webhook aborta antes do dispatch para Meta
const storeResult = await getUserStore(env.DB, webhookData.marca_user);
```

### INSERT inicial (gravação do payload bruto)

```js
// CORRETO — erro de banco é capturado; processamento continua
try {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO webhook_raw (site_id, gateway, order_id, payload) VALUES (?, ?, ?, ?)'
  ).bind(siteId, gateway, null, JSON.stringify(body).substring(0, 8192)).run();
} catch (e) {
  console.error('[webhook] webhook_raw INSERT failed:', e.message);
  // O webhook segue para dispatch nas plataformas normalmente
}
```

```js
// ERRADO — exceção propaga, worker retorna 500, gateway reenvia
await env.DB.prepare('INSERT OR IGNORE INTO webhook_raw ...').bind(...).run();
```

### UPDATE do order_id

```js
try {
  await env.DB.prepare(
    'UPDATE webhook_raw SET order_id = ? WHERE site_id = ? AND gateway = ? AND order_id IS NULL ORDER BY id DESC LIMIT 1'
  ).bind(txnId, siteId, gateway).run();
} catch (e) {
  console.error('[webhook] webhook_raw UPDATE order_id failed:', e.message);
}
```

### UPDATE de processed = 1

```js
try {
  await env.DB.prepare(
    'UPDATE webhook_raw SET processed = 1 WHERE site_id = ? AND gateway = ? AND order_id = ?'
  ).bind(siteId, gateway, txnId).run();
} catch (e) {
  console.error('[webhook] webhook_raw UPDATE processed failed:', e.message);
}
```

---

## Limites de Payload (Colunas TEXT de Debug)

Colunas usadas para armazenar JSON de request/response têm limite explícito. O truncamento acontece no momento da gravação, nunca na leitura.

| Coluna | Tabela | Limite |
|---|---|---|
| `payload` | `webhook_raw` | 8.192 chars |
| `sent_payload` | `events` | 2.000 chars |
| `response_payload` | `events` | 2.000 chars |

**`src/worker/shared/logger.js`**
```js
(data.sent_payload     || '').substring(0, 2000),
(data.response_payload || '').substring(0, 2000),
```

**`src/worker/collect/webhook.js`**
```js
JSON.stringify(body).substring(0, 8192)
```

---

## O que NÃO fazer

- **Não remover o `.catch(() => null)` dos reads em `handleWebhook`** — um SELECT que lança exceção aborta o webhook antes do dispatch para as plataformas.
- **Não remover o `try/catch` dos writes** — qualquer erro não capturado em `handleWebhook` vira HTTP 500 e causa retry do gateway.
- **Não centralizar `runCleanup` em `index.js`** — isso cria dependência circular quando importado de `webhook.js` ou `event.js`. O módulo correto é `shared/cleanup.js`.
- **Não depender somente do cron para cleanup** — crons podem não executar em certos planos ou após redeploys. As camadas 2 e 3 (cleanup proativo) são o backup principal.
- **Não aumentar os períodos de retenção** sem revisar o impacto no tamanho do banco. O limite do D1 no plano gratuito é 500 MB; no Workers Paid é 10 GB por banco.
- **Não gravar payloads sem truncar** — a coluna `payload` no schema não tem `CHECK` de tamanho; o limite precisa ser aplicado na camada da aplicação.
- **Não alterar o cron para frequência menor que a cada 6 horas** sem também reduzir os períodos de retenção.

---

## Checklist para PRs que alteram lógica de banco

- [ ] Reads dentro de `handleWebhook` usam `.catch(() => null)` ou `try/catch`?
- [ ] Writes em `webhook_raw` estão dentro de `try/catch`?
- [ ] Payloads TEXT estão sendo truncados antes do `bind()`?
- [ ] Novos writes em `events` passam por `logEvent()` (que já tem `try/catch` e truncamento)?
- [ ] O período de retenção de qualquer nova tabela está documentado no `scheduled` handler e em `shared/cleanup.js`?
- [ ] O `wrangler.toml` continua com cron `0 */6 * * *`?
- [ ] `handleWebhook` e `handleCollectEvent` recebem `ctx` e o repassam para `runCleanup`?

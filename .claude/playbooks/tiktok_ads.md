# Skill: tracking_tiktok_ads

## Papel

Voce e o especialista em TikTok Ads. Conhece o TikTok Pixel, a Events API server-side, os requisitos de hashing de PII, e os detalhes especificos do sistema de tracking proprietario.

Voce e carregado pelo `tracking_base` apenas quando o cliente confirma uso de TikTok Ads no Step 1. Sua responsabilidade: coletar credenciais, explicar a logica de deduplicacao e payload, e validar os eventos no TikTok Events Manager.

---

## Mapeamento de eventos

Extraido de `TIKTOK_EVENT_NAMES` em `src/worker/platforms/tiktok.js`:

```
page_view         → Pageview           (P maiusculo, v minusculo — diferente de Meta que usa PageView!)
contact           → Contact
lead              → SubmitForm          (NAO "Lead" — especifico do TikTok!)
initiate_checkout → InitiateCheckout
purchase          → Purchase
```

---

## Modelo de deduplicacao

- **Browser:** `ttq.track(eventName, data, {event_id: event_id})`
- **Worker Events API:** mesmo `event_id` no campo `data[0].event_id`
- TikTok deduplica: se o mesmo `event_id` chega via browser E Events API, conta apenas uma vez
- **Webhook (purchase via gateway):** NAO tem `event_id` — e server-originated, sem contraparte no browser

---

## Payload Events API exato

### Beacon (web) — `sendTikTokEvent` em `tiktok.js` linhas 19-38

```json
{
  "event_source": "web",
  "event_source_id": "{pixel_id}",
  "data": [{
    "event": "Pageview|Contact|SubmitForm|InitiateCheckout|Purchase",
    "event_time": "{Math.floor(timestamp / 1000)}",
    "event_id": "{timestamp_ms-UUID}",
    "page": { "url": "{page_url}" },
    "user": {
      "email": "{sha256(email)}",
      "phone_number": "{sha256(phone)}",
      "external_id": "{sha256(marca_user)}",
      "ip": "{client_ip}",
      "user_agent": "{user_agent}",
      "ttp": "{_ttp cookie — CONDICIONAL: so incluido se body.browser_data.ttp for truthy}",
      "ttclid": "{ttclid param — CONDICIONAL: so incluido se body.browser_data.ttclid for truthy}"
    },
    "properties": {
      "value": 97.00,
      "currency": "BRL"
    }
  }]
}
```

**Notas do beacon:**
- `properties` so e incluido se `body.custom_data.value` existir (`Object.keys(properties).length > 0`)
- `ttp` e `ttclid` usam spread condicional — ausentes do payload se falsy
- `email`, `phone_number`, `external_id` sao omitidos se o hash resultar em string vazia (campos opcionais)

---

### Webhook (purchase via gateway) — `sendTikTokWebhook` em `tiktok.js` linhas 77-150

```json
{
  "event_source": "web",
  "event_source_id": "{pixel_id}",
  "data": [{
    "event": "Purchase",
    "event_time": "{Math.floor(Date.now() / 1000)}",
    "page": { "url": "{merged.page_url}" },
    "user": {
      "email": "{sha256(merged.email)}",
      "phone_number": "{sha256(merged.phone)}",
      "external_id": "{sha256(merged.marca_user)}",
      "ip": "{merged.ip}",
      "user_agent": "{merged.user_agent}",
      "ttp": "{merged.ttp — CONDICIONAL}",
      "ttclid": "{merged.ttclid — CONDICIONAL}"
    },
    "properties": {
      "value": 97.00,
      "currency": "BRL",
      "contents": [{
        "content_id": "{product_id}",
        "content_name": "{product_name}",
        "content_type": "product",
        "price": 97.00,
        "quantity": 1
      }]
    }
  }]
}
```

**Diferencas criticas do webhook em relacao ao beacon:**
- **Sem `event_id`** — webhook e server-originated, sem contraparte browser para deduplicar
- `ttp` e `ttclid` vem de `merged` (user_store enriquecido) em vez de `body.browser_data`
- `properties.contents` adicionado quando `merged.product_id` ou `merged.product_name` estiverem presentes
- `event_time` usa `Date.now()` (tempo do processamento), nao timestamp do evento original

---

## API

- **Endpoint:** `POST https://business-api.tiktok.com/open_api/v1.3/event/track/`
- **Header de autenticacao:** `Access-Token: {access_token}` — **NAO** `Authorization: Bearer` (diferente de Meta!)
- **Header:** `Content-Type: application/json`

---

## PII Hashing

Extraido de `src/worker/utils/hash.js`:

- **Algoritmo:** SHA-256 via `crypto.subtle.digest`
- **Normalizacao antes do hash:** `toLowerCase().trim()`
- **Campos hasheados:** `email`, `phone_number`, `external_id`
- **Campos NAO hasheados:** `ip`, `user_agent`, `ttp`, `ttclid`

Implementacao real:
```javascript
const normalized = value.toLowerCase().trim();
const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
// retorna hex string
```

---

## Campos condicionais — resumo

| Campo | Condicao para inclusao |
|---|---|
| `user.ttp` | `body.browser_data.ttp` truthy (beacon) / `merged.ttp` truthy (webhook) |
| `user.ttclid` | `body.browser_data.ttclid` truthy (beacon) / `merged.ttclid` truthy (webhook) |
| `properties` | `value` presente no `custom_data` (beacon) / `merged.value` presente (webhook) |
| `properties.contents` | `merged.product_id` OU `merged.product_name` presente (webhook apenas) |

---

## Credenciais a coletar

**Pixel ID:**
> TikTok Ads Manager > Ativos > Eventos > Eventos Web > selecionar o pixel > ID do pixel (numero)

**Access Token:**
> TikTok Ads Manager > Ativos > Eventos > Eventos Web > selecionar o pixel > Gerenciar > Configuracoes > Gerar token

Pedir os dois de uma vez:
> "Para configurar o TikTok Ads, preciso de:
> 1. **Pixel ID** — encontre em: TikTok Ads Manager > Ativos > Eventos > Eventos Web > ID do pixel
> 2. **Access Token** — encontre na mesma tela > Gerenciar > Configuracoes > Gerar token"

---

## Separacao config vs secrets

| Dado | Destino | Nome no sistema |
|---|---|---|
| `pixel_id` | Config JSON (`SITE_CONFIG` no `wrangler.toml`) | `platforms.tiktok.pixel_id` |
| `access_token` | Config JSON (`SITE_CONFIG` no `wrangler.toml`) | `platforms.tiktok.access_token` |

**EXCECAO obrigatoria:** O codigo le `tiktokConfig.access_token` diretamente do config — **nao faz fallback para `env.TIKTOK_ACCESS_TOKEN`** (diferente de Meta e GA4). Se o access_token for colocado como wrangler secret, o TikTok falha silenciosamente sem log. Colocar sempre no config JSON.

Ao gravar no `tracking_memory.md`:
- `pixel_id`: gravar o valor
- `access_token`: gravar apenas `CONFIGURADO (SECRETO)` — nunca o valor real

---

## Validacao

Instruir o cliente:
> "No TikTok Ads Manager, acesse: Ativos > Eventos > Eventos Web > selecione o pixel > Diagnostico > Atividade recente. O evento deve aparecer em tempo real apos o teste."

Verificar tambem na tabela `events` do D1 (delegado para `tracking_base`):
- Linha esperada: `Pageview | tiktok_ads | web | collect | 200 |`
- `status_code` deve ser `200` para sucesso

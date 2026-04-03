# Skill: tracking_meta_ads

## Papel

Voce e o especialista em Meta Ads (Facebook/Instagram Ads). Conhece o Meta Pixel, a Conversions API (CAPI), o sistema de dual-pixel, Advanced Matching, e os formatos exatos de payload extraidos do codigo real em producao.

Esta skill e carregada apenas quando o cliente confirma uso de Meta Ads no Step 1. Responsabilidades: coletar credenciais Meta no Step 3 e conduzir validacao Meta no Step 4.

---

## Mapeamento de eventos

Fonte: `META_EVENT_NAMES` em `src/worker/platforms/meta.js`

```
page_view             → PageView
contact               → Contact
lead                  → Lead
initiate_checkout     → InitiateCheckout
purchase              → Purchase
purchase_from_trigger → Purchase   (evento interno do dual-pixel — quando purchase_trigger_event dispara no pixel de vendas)
```

---

## Modelo de deduplicacao

- **Browser:** `fbq('track', 'Lead', userData, {eventID: event_id})`
- **Worker CAPI:** mesmo `event_id` no campo `event_id` do payload
- **Meta deduplica por `event_id`:** se o mesmo ID chega via browser E via CAPI, a Meta conta apenas uma conversao
- **Webhook (purchase via gateway):** NAO tem `event_id` — e server-originated, sem contraparte browser, portanto nao precisa de deduplicacao

---

## Dual-pixel — logica completa (CRITICO)

### Web — `src/worker/routes/collect-event.js` linhas 74-97

**Pixel padrao (`pixel_id`):**
- Recebe TODOS os eventos normalmente, para todos os eventNames

**Pixel de vendas (`pixel_id_purchase`) — acionado quando `pixel_id_purchase` esta configurado:**
1. Quando `eventName === 'page_view'`: envia `page_view` (→ `PageView`) ao pixel de vendas
2. Quando `eventName === purchaseTrigger` (default: `'lead'`, configuravel via `purchase_trigger_event`):
   - Envia `purchase_from_trigger` (→ `Purchase`) ao pixel de vendas
   - `purchaseEventId = body.purchase_event_id || eventId`

### Webhook — `src/worker/routes/collect-webhook.js` linhas 85-99

**Pixel padrao (`pixel_id`):**
- Recebe `Purchase`

**Pixel de vendas (`pixel_id_purchase`):**
- Recebe `Purchase` (1a chamada)
- Recebe `PageView` (2a chamada separada)

Total: quando dual-pixel ativo em webhook, sao 3 chamadas CAPI para a Meta por compra (Purchase para pixel padrao + Purchase e PageView para pixel de vendas).

---

## `cleanUserData` — `meta.js` linhas 9-16

Remove automaticamente do `user_data` antes de enviar:
- Arrays vazios `[]`
- Strings vazias `''`

Resultado: payload limpo, sem campos `em: []` ou `fbp: ""`.

---

## Payload CAPI exato

### Beacon (web) — `sendMetaCAPI` em `meta.js` linhas 44-68

```json
{
  "data": [{
    "event_name": "PageView|Contact|Lead|InitiateCheckout|Purchase",
    "event_time": 1700000000,
    "event_id": "{timestamp_ms}-{uuid}",
    "event_source_url": "https://seusite.com.br/pagina",
    "action_source": "website",
    "user_data": {
      "em": ["{sha256_email}"],
      "ph": ["{sha256_phone}"],
      "fn": ["{sha256_first_name}"],
      "ln": ["{sha256_last_name}"],
      "ct": ["{sha256_city}"],
      "st": ["{sha256_state}"],
      "country": ["{sha256_country}"],
      "zp": ["{sha256_zip}"],
      "external_id": ["{sha256_marca_user}"],
      "client_ip_address": "189.100.10.5",
      "client_user_agent": "Mozilla/5.0 ...",
      "fbp": "_fbp cookie value",
      "fbc": "_fbc cookie value"
    }
  }],
  "test_event_code": "TEST12345"
}
```

Notas:
- `test_event_code` so e incluido quando `body.test_event_code` estiver presente (opcional)
- Campos de `user_data` com valor vazio/nulo sao removidos por `cleanUserData`
- `event_time` e `Math.floor(timestamp / 1000)` — Unix timestamp em segundos
- `fbp` e `fbc` vem de `body.browser_data.fbp` e `body.browser_data.fbc`

### Webhook (purchase) — `sendMetaCAPIWebhook` em `meta.js` linhas 110-165

**Diferencas em relacao ao beacon:**
- **NAO tem campo `event_id`** (server-originated, sem browser counterpart)
- **NAO tem campo `test_event_code`**
- `event_source_url` vem de `merged.page_url` (user_store enrichment)
- `fbp` e `fbc` vem de `merged.fbp` e `merged.fbc`
- Adiciona `custom_data` quando `eventName === 'Purchase'`:

```json
{
  "data": [{
    "event_name": "Purchase",
    "event_time": 1700000000,
    "event_source_url": "https://seusite.com.br/pagina",
    "action_source": "website",
    "user_data": { "...": "..." },
    "custom_data": {
      "value": 97.00,
      "currency": "BRL",
      "content_name": "Curso X",
      "content_ids": ["produto-123"],
      "order_id": "ORD-456789"
    }
  }]
}
```

Notas sobre `custom_data`:
- Incluido SOMENTE quando `eventName === 'Purchase'`
- Cada campo dentro de `custom_data` e incluido SOMENTE se o campo correspondente existir em `merged`:
  - `value`: de `merged.value` (parseFloat)
  - `currency`: de `merged.currency`
  - `content_name`: de `merged.product_name`
  - `content_ids`: de `merged.product_id` (como string em array)
  - `order_id`: de `merged.order_id` (como string)
- Se nenhum campo de `custom_data` for preenchido, o objeto nao e incluido

---

## API

- **Endpoint:** `POST https://graph.facebook.com/v21.0/{pixelId}/events`
- **Headers:**
  - `Authorization: Bearer {accessToken}`
  - `Content-Type: application/json`
- **Versao da API:** `v21.0`

### Resolucao de credenciais no codigo

```javascript
// Pixel ID
const pixelId = pixelType === 'purchase'
  ? metaConfig.pixel_id_purchase
  : metaConfig.pixel_id;

// Access Token (config tem prioridade sobre env)
const accessToken = pixelType === 'purchase'
  ? (metaConfig.access_token_purchase || env.META_ACCESS_TOKEN_PURCHASE)
  : (metaConfig.access_token || env.META_ACCESS_TOKEN);
```

---

## Advanced Matching

- Dados de usuario (`user_data`) sao enviados em TODOS os eventos, nao apenas em conversoes
- Isso melhora a taxa de match para todos os eventos (PageView, Contact, Lead, etc.)
- **Campos hasheados em SHA-256 antes do envio:** `em`, `ph`, `fn`, `ln`, `ct`, `st`, `country`, `zp`, `external_id`
- **Campos NAO hasheados (enviados em texto puro):** `client_ip_address`, `client_user_agent`, `fbp`, `fbc`
- `external_id` e o cookie `marca_user` hasheado — identificador cross-session do usuario

---

## Credenciais a coletar (Step 3)

### Pixel ID
- Onde encontrar: Meta Business Suite > Events Manager > Fontes de Dados > selecionar pixel > ID numerico (ex: `1234567890123456`)

### Access Token permanente (RECOMENDADO)
1. Meta Business Suite > Configuracoes do Negocio > Usuarios do Sistema
2. Criar usuario do sistema com funcao "Admin"
3. Adicionar ativo (pixel) ao usuario
4. Gerar token com permissao `ads_management`
5. **Token nao expira** — preferivel ao token temporario

### Access Token temporario (NAO recomendado)
- Events Manager > selecionar pixel > Configuracoes > Gerar token
- **Expira em 60 dias** — requer renovacao manual periodica

### Se dual-pixel ativo
- Coletar Pixel ID e Access Token para o segundo pixel (pixel de vendas)
- Repetir o mesmo processo acima para `pixel_id_purchase` e `META_ACCESS_TOKEN_PURCHASE`

---

## Separacao config vs secrets

| Campo | Destino | Wrangler secret name |
|---|---|---|
| `pixel_id` | Config JSON (`SITE_CONFIG`) | — |
| `pixel_id_purchase` | Config JSON (`SITE_CONFIG`) | — |
| `purchase_trigger_event` | Config JSON (`SITE_CONFIG`) | — |
| `access_token` | Wrangler secret | `META_ACCESS_TOKEN` |
| `access_token_purchase` | Wrangler secret | `META_ACCESS_TOKEN_PURCHASE` |

**NUNCA incluir access tokens no Config JSON.** Configurar via:
```bash
echo "{access_token}" | npx wrangler secret put META_ACCESS_TOKEN
echo "{access_token_purchase}" | npx wrangler secret put META_ACCESS_TOKEN_PURCHASE
```

---

## Validacao (Step 4)

1. Acesse **Meta Events Manager** > selecionar pixel > **Testar Eventos**
2. Insira a URL do site com `?debug=1`
3. Execute a acao (ex: abrir a pagina, preencher formulario)
4. O evento deve aparecer em tempo real no painel
5. Verificar que aparece "Servidor" como origem — confirma que o CAPI esta funcionando

Se dual-pixel ativo: verificar nos dois pixels separadamente.

**Na tabela `events` do D1:**
```
PageView | meta_ads | web | collect | 200 |
Lead     | meta_ads | web | collect | 200 |
```
Status 200 = sucesso para todos os eventos Meta.

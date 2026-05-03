# Skill: tracking_meta_ads

## Papel

Voce e o especialista em Meta Ads (Facebook/Instagram Ads). Conhece o Meta Pixel, a Conversions API (CAPI), o sistema de dual-pixel, Advanced Matching, e os formatos exatos de payload extraidos do codigo real em producao.

Esta skill e carregada apenas quando o cliente confirma uso de Meta Ads no Step 1. Responsabilidades: coletar credenciais Meta no Step 3 e conduzir validacao Meta no Step 4.

---

## Mapeamento de eventos

Fonte: `META_EVENT_NAMES` em `src/worker/platforms/meta.js`

```
page_view         → PageView
contact           → Contact
lead              → Lead
initiate_checkout → InitiateCheckout
purchase          → Purchase
```

---

## Modelo de deduplicacao

- **Browser:** `fbq('track', 'Lead', userData, {eventID: event_id})`
- **Worker CAPI:** mesmo `event_id` no campo `event_id` do payload
- **Meta deduplica por `event_id`:** se o mesmo ID chega via browser E via CAPI, a Meta conta apenas uma conversao
- **Webhook (purchase via gateway):** NAO tem `event_id` — e server-originated, sem contraparte browser, portanto nao precisa de deduplicacao

---

## Pixels espelho — N pixels simultâneos

Quando o cliente usa mais de um pixel Meta, todos recebem **exatamente os mesmos eventos** em todos os canais — sem lógica condicional entre eles.

### Configuração

```json
{
  "platforms": {
    "meta": {
      "pixel_id": "PIXEL_PRINCIPAL",
      "pixel_ids_mirror": ["PIXEL2", "PIXEL3"]
    }
  }
}
```

- `pixel_id`: pixel primário (obrigatório)
- `pixel_ids_mirror`: array de pixels espelho (opcional, pode ter 1, 2, 3... elementos)
- Um único `META_ACCESS_TOKEN` cobre todos os pixels via fallback — token separado por pixel não é necessário

### Comportamento por canal

| Canal | Quem recebe |
|---|---|
| Browser (fbq `init`) | Todos os pixels são inicializados na carga da página |
| Browser (fbq `trackSingle`) | Todos os pixels recebem o evento com o mesmo `eventID` |
| Server CAPI (beacon) | Todos os pixels recebem o mesmo `eventName` + `eventId` via CAPI |
| Server CAPI (webhook) | Todos os pixels recebem `Purchase` via CAPI |

**Deduplicação:** o mesmo `eventID` é enviado para todos os pixels. A Meta deduplica browser↔CAPI por pixel individualmente — cada pixel conta o evento uma vez.

### Backward compatibility

Clientes com `pixel_id_purchase` no config (formato antigo) continuam funcionando: o código trata `pixel_id_purchase` como `pixel_ids_mirror: [pixel_id_purchase]` automaticamente, sem necessidade de migrar configs existentes.

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

As funções `sendMetaCAPI` e `sendMetaCAPIWebhook` recebem `pixelId` e `accessToken` diretamente. O loop em `event.js` e `webhook.js` resolve os pixels antes de chamar as funções:

```javascript
const accessToken = metaConfig.access_token || env.META_ACCESS_TOKEN;
const mirrors = metaConfig.pixel_ids_mirror
  ?? (metaConfig.pixel_id_purchase ? [metaConfig.pixel_id_purchase] : []);
for (const pixelId of [metaConfig.pixel_id, ...mirrors]) {
  // chama sendMetaCAPI(pixelId, accessToken, ...)
}
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

### Se pixels espelho ativos
- Coletar o Pixel ID de cada pixel espelho
- Um unico `META_ACCESS_TOKEN` cobre todos via fallback — token separado por pixel nao e necessario (caso comum quando todos estao no mesmo BM)
- Se tokens distintos por pixel forem necessarios, configurar `META_ACCESS_TOKEN_MIRROR` como secret adicional (caso raro)

---

## Separacao config vs secrets

| Campo | Destino | Wrangler secret name |
|---|---|---|
| `pixel_id` | Config JSON (`SITE_CONFIG`) | — |
| `pixel_ids_mirror` | Config JSON (`SITE_CONFIG`) — array, omitir se nao tiver espelhos | — |
| `access_token` | Wrangler secret | `META_ACCESS_TOKEN` |

**NUNCA incluir access tokens no Config JSON.** Configurar via:
```bash
echo "{access_token}" | npx wrangler secret put META_ACCESS_TOKEN
```

Um unico secret cobre o pixel primario e todos os pixels espelho via fallback no codigo.

---

## Guard de duplo carregamento

O script web tem um guard no topo do IIFE:

```js
if (window.__MARCA_TRACKING_LOADED__) return;
window.__MARCA_TRACKING_LOADED__ = true;
```

Isso garante que, mesmo que o `<script>` seja incluido multiplas vezes na pagina (dois tags, plugin WordPress, page builder), o script so executa uma vez — nenhum pixel e inicializado duas vezes e nenhum evento e disparado em duplicata.

**Diagnostico:** se o Meta Pixel Helper reportar eventos duplicados mesmo com o guard ativo, o disparo extra vem de fora do nosso script — tipicamente um plugin WordPress (PixelYourSite, Meta for WordPress), tema com pixel hardcoded no `header.php`, ou Google Tag Manager com tag de PageView configurada. Nesses casos, remover o pixel duplicado na origem resolve o problema.

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

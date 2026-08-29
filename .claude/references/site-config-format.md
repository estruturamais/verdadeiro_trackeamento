# Reference: SITE_CONFIG — Formato Correto e Bugs Comuns

## Formato padrao (single-site)

O sistema e single-site por padrao: um Worker por dominio rastreado. O `SITE_CONFIG` deve ser um **objeto JSON direto** com os dados do site:

```toml
# wrangler.toml
[vars]
SITE_CONFIG = '{"site_id":"meu_site","platforms":{"meta":{"pixel_id":"{pixel_id}"}},"triggers":{...}}'
```

O JSON expandido:

```json
{
  "site_id": "meu_site",
  "platforms": {
    "meta": {
      "pixel_id": "{pixel_id}"
    }
  },
  "triggers": {
    "lead": {
      "type": "form_submit",
      "selectors": { "elementor": true, "cf7": true, "generic": true }
    }
  }
}
```

**Regras:**
- O JSON deve ser uma linha unica (sem quebras) dentro do `wrangler.toml`
- `platforms` e um **objeto** com chaves por plataforma, nunca um array
- Nomes de campos usam snake_case: `pixel_id`, nao `pixelId`
- Seguir a estrutura completa de `config.example.json`

---

## Blocos de assinatura (SaaS) — todos opt-in

Nenhum deles existe em projeto de compra unica. **Omitidos, o comportamento e exatamente o de
antes**: toda cobranca aprovada sai como `Purchase` e a tabela `subscriptions` nem precisa existir.

| Chave | Onde | O que faz |
|---|---|---|
| `subscription_tracking` | raiz | Liga a classificacao `new`/`renewal`/`reactivation`. Aceita `true` (todo produto e assinatura) ou o objeto `{ enabled, product_ids, product_ids_avulso }`. **Exige `migrations/004`** — sem a tabela o Worker avisa no log e segue mandando `Purchase`. |
| `subscription_events` | raiz | Nome do evento Meta por tipo de cobranca. Aceita **string ou array**. Defaults: `new: "Subscribe"`, `renewal: "SubscriptionRenewal"`, `reactivation: "SubscriptionReactivation"`. |
| `purchase_dispatch` | raiz | `"shadow"` roda o pipeline inteiro e grava no `events` o que **teria** sido enviado, sem enviar nada. |
| `conversion_action_id_renewal` | `platforms.google_ads` | Id numerico da 2a acao de conversao (renovacao/reativacao). Sem ele, recorrente e barrada com `renewal_action_not_configured` — nunca sobe na acao de aquisicao. |
| `triggers.lead.routes` | `triggers.lead` | Roteia o `form_submit` por slug (app logado/SPA). Ver abaixo. |

```jsonc
{
  "subscription_tracking": {
    "enabled": true,
    "product_ids": ["7194235"],          // os que SAO assinatura
    "product_ids_avulso": ["8801122"]    // os de compra unica (projeto MISTO)
  },
  "subscription_events": { "new": ["Purchase", "Subscribe"] },
  "triggers": {
    "lead": {
      "routes": [
        { "match": "login", "event": "login", "custom_data": { "method": "email" },
          "confirm_success": { "request_match": "auth/v1/token?grant_type=password", "timeout_ms": 20000 } },
        { "match": "esqueci-senha", "event": "none" },
        { "event": "complete_registration",
          "field_selector": "[id$=sobrenome]",
          "confirm_success": { "request_match": "auth/v1/signup", "timeout_ms": 20000 } }
      ]
    }
  }
}
```

**Precedencia no projeto misto:** as listas MANDAM quando informadas — `product_ids_avulso` primeiro,
depois `product_ids`. Um `product_id` que nao esteja em nenhuma das duas e tratado como **compra
unica** e gera uma linha de aviso no D1 (`platform='subscription'`). Sem as listas, decide o sinal do
payload do gateway.

**`triggers.lead`:** ate a 1.6.0 o bloco era **decorativo** — `type` e `selectors` nao eram lidos por
ninguem e todo form da pagina virava `lead`. A partir da 1.7.0:
- `"type": "disabled"` desliga o evento **de verdade** (os cookies `marca_*` e o beacon `identify`
  continuam — identidade nao e conversao);
- `routes[]` escolhe o evento pela **slug** (`match` = substring do pathname, pipe = OU; 1a que casa
  vence; sem `match` = default; `event: "none"` nao dispara nada);
- `form_selector` / `field_selector` (no trigger ou na rota) prendem o evento aos forms certos;
- `confirm_success` arma o evento no submit e so dispara no **2xx** da requisicao casada —
  `request_match` aceita **query string**, o que separa o login real do refresh de sessao.
- **Sem `routes`, o comportamento historico e preservado** (todo submit vira `lead`).

---

## Como getConfig() le o SITE_CONFIG

O Worker tem dois caminhos de leitura de config:

**Para requisicoes web (beacon):**
```javascript
const config = JSON.parse(env.SITE_CONFIG);
if (siteId && config[siteId]) return config[siteId]; // lookup por site_id (formato map)
return config; // fallback: retorna o objeto direto (formato flat — padrao)
```

**Para webhooks de gateway:**
```javascript
const config = JSON.parse(env.SITE_CONFIG); // retorna o objeto direto sem lookup
return config;
```

O formato flat funciona em ambos os caminhos. O formato map (ver secao abaixo) **nao funciona para webhooks** — causa falha silenciosa.

---

## Bug 1 — Nomes de campo errados em platforms.meta

**Errado:**
```json
{
  "platforms": ["meta"],
  "meta": { "pixelId": "{pixel_id}" }
}
```

**Correto:**
```json
{
  "platforms": {
    "meta": { "pixel_id": "{pixel_id}" }
  }
}
```

O worker acessa `config.platforms?.meta?.pixel_id`. Se:
- `platforms` e um array → `config.platforms?.meta` e `undefined`
- O campo e `pixelId` (camelCase) → `config.platforms.meta.pixel_id` e `undefined`

Em ambos os casos o Meta CAPI e silenciosamente ignorado — nenhum erro, zero eventos `meta_ads` no D1.

---

## Bug 2 — Parametro siteId vs site_id em serve-webjs

O script e carregado no site com um parametro que identifica o cliente:

```html
<script src="https://{dominio}/tracking/web.js?site_id={site_id}"></script>
```

Alguns CMSs (ex: WordPress com Elementor Code Injection) podem gerar `?siteId=` (camelCase) em vez de `?site_id=`.

O `serve-webjs.js` aceita ambos:

```javascript
// src/worker/routes/serve-webjs.js
const siteId = url.searchParams.get('site_id') || url.searchParams.get('siteId') || detectSiteId(request, env);
```

**Sintoma:** `__CONFIG__` no browser esta vazio (`meta_pixel_id` undefined) mesmo com SITE_CONFIG correto. Inspecionar a URL do script no HTML do site para ver qual parametro esta sendo passado.

---

## Diagnostico

Para verificar se o config esta sendo lido corretamente, fazer curl no endpoint do script:

```bash
curl "https://{dominio}/tracking/web.js?site_id={site_id}" | head -3
```

A primeira linha do script contem o config injetado:

```javascript
var __CONFIG__={"site_id":"meu_site","meta_pixel_id":"1234567890","..."}
```

**Interpretar o resultado:**

| O que aparece em `__CONFIG__` | Diagnostico |
|-------------------------------|-------------|
| `meta_pixel_id: "{pixel_id}"` correto | Config OK |
| `meta_pixel_id` ausente ou `undefined` | Bug de config — verificar SITE_CONFIG e site_id |
| `__CONFIG__={}` | site_id nao encontrado ou config invalido |

**Proximos passos se o config estiver errado:**
1. Verificar se o JSON do `SITE_CONFIG` usa formato flat direto (nao map)
2. Verificar se o `site_id` no JSON bate com o parametro `?site_id=` na URL do script
3. Verificar se `platforms.meta.pixel_id` usa snake_case

---

## Avancado: formato map (multi-site)

> **NAO usar para single-site** — quebra webhooks silenciosamente.

Para instalar o mesmo Worker em multiplos sites (caso raro), o formato map funciona para requisicoes web mas **nao para webhooks** (o `getConfigForWebhook` nao faz lookup por site_id). Requer modificacao no codigo-fonte para suportar completamente.

Formato map (para referencia):
```json
{
  "meu_site": {
    "site_id": "meu_site",
    "platforms": { "meta": { "pixel_id": "{pixel_id}" } }
  }
}
```

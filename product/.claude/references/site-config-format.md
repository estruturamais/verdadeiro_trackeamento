# Reference: SITE_CONFIG — Formato Correto e Bugs Comuns

## Como getConfig() le o SITE_CONFIG

Codigo em `src/worker/utils/config.js`:

```javascript
const config = JSON.parse(env.SITE_CONFIG);
if (siteId && config[siteId]) return config[siteId]; // retorna sub-objeto do site
return config; // fallback: retorna tudo (pode causar bugs silenciosos)
```

O `SITE_CONFIG` deve ser um **map** onde cada chave e um `site_id`. Quando o worker recebe uma requisicao com `site_id=meu_site`, ele extrai `config["meu_site"]` e retorna esse sub-objeto para o codigo de plataformas (`config.platforms?.meta?.pixel_id`, etc.).

Se o SITE_CONFIG nao estiver no formato de map, o `config[siteId]` retorna `undefined` e o fallback devolve o JSON inteiro — causando falhas silenciosas nos lookups de plataforma.

---

## Formato correto

```toml
# wrangler.toml
[vars]
SITE_CONFIG = '{"meu_site":{"site_id":"meu_site","platforms":{"meta":{"pixel_id":"{pixel_id}"}}}}'
```

O JSON expandido:

```json
{
  "{site_id}": {
    "site_id": "{site_id}",
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
}
```

**Regras:**
- O JSON deve ser uma linha unica (sem quebras) dentro do `wrangler.toml`
- O objeto raiz e sempre `{ "{site_id}": { ...config do site... } }`
- `platforms` e um **objeto** com chaves por plataforma, nunca um array
- Nomes de campos usam snake_case: `pixel_id`, nao `pixelId`

---

## Bug 1 — Config direta sem wrapper por site_id

**Errado** (config sem map — o fallback devolve o objeto inteiro, lookup de `config.platforms?.meta?.pixel_id` pode funcionar acidentalmente mas e frágil):
```json
{"site_id": "meu_site", "platforms": {"meta": {"pixel_id": "{pixel_id}"}}}
```

**Correto** (config com map):
```json
{"meu_site": {"site_id": "meu_site", "platforms": {"meta": {"pixel_id": "{pixel_id}"}}}}
```

**Sintoma:** `__CONFIG__` no browser tem `site_id` vazio ou undefined. Verificar com curl (ver secao Diagnostico).

---

## Bug 2 — Nomes de campo errados em platforms.meta

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

## Bug 3 — Parametro siteId vs site_id em serve-webjs

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
| `__CONFIG__={}` ou `__CONFIG__={"google_ads_channel":"server",...}` sem pixel | site_id nao encontrado no map |

**Proximos passos se o config estiver errado:**
1. Verificar se o JSON do `SITE_CONFIG` esta no formato de map (`{ "{site_id}": {...} }`)
2. Verificar se o `site_id` usado na URL bate exatamente com a chave no JSON
3. Verificar se `platforms.meta.pixel_id` usa snake_case

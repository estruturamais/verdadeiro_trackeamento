# Skill: new_gateway

## Papel

Adiciona suporte completo a um gateway novo ou completa o parser de um gateway skeleton existente (ticto, eduzz, perfectpay, payt), permitindo que webhooks de compra aprovada sejam processados e os eventos enviados para todas as plataformas configuradas.

Pode ser invocada durante o Step 2 (gateway detectado sem suporte completo) ou o Step 5 (cliente relata que webhooks de compra nao chegam nas plataformas).

---

## Status dos gateways

### Parsers completos — NAO invocar esta skill
hotmart, kiwify, kirvano, lastlink, pagtrust

### Skeletons — invocar para completar
| Gateway    | Arquivo                          | Situacao                        |
|------------|----------------------------------|---------------------------------|
| ticto      | `gateways/ticto.js`      | Apenas `marca_user` mapeado     |
| eduzz      | `gateways/eduzz.js`      | Apenas `marca_user` mapeado     |
| perfectpay | `gateways/perfectpay.js` | Apenas `marca_user` mapeado     |
| payt       | `gateways/payt.js`       | Apenas `marca_user` mapeado     |

---

## Interface webhookData

Todo parser retorna exatamente este objeto. Campos sem dado disponivel: string vazia `''`, nunca `undefined`.

```js
{
  marca_user:   string | undefined,  // parametro de rastreamento (xcod/sck/src/etc)
  email:        string,
  phone:        string,              // sem + inicial
  name:         string,
  order_id:     string,              // identificador unico da transacao
  value:        string | number,     // decimal — ex: "97.00" ou 97.00
  currency:     string,              // ISO — ex: "BRL"
  product_name: string,
  product_id:   string,              // sempre String()
  city:         string,
  state:        string,
  country:      string,
  zip:          string,              // 5 digitos — aplicar regex se necessario
  ip:           string,
  user_agent:   string
}
```

---

## Passo 1 — Coletar o payload

Antes de perguntar ao usuario, tentar buscar o payload via `WebFetch` na documentacao publica do gateway (buscar por "webhook payload example purchase approved {gateway}").

Se nao encontrar, solicitar:

> "Para mapear o webhook do {gateway}, preciso de um exemplo do payload JSON que ele envia quando uma compra e aprovada. Voce encontra isso no painel do gateway em Ferramentas > Webhooks > Simular (ou Historico de eventos). Cole o JSON aqui."

---

## Passo 2 — Analisar e mapear

Com o payload, identificar cada campo:

| webhookData  | O que procurar                                                                      |
|--------------|-------------------------------------------------------------------------------------|
| evento       | Campo que indica aprovacao: `event`, `data.event`, `status`, `type`, `webhook_event_type` |
| `marca_user` | Parametro de URL injetado pelo web.js: `sck`, `src`, `xcod`, `utm_id`, `utm_content`, `utm_perfect` — geralmente dentro de um objeto de UTMs ou tracking |
| `email`      | Email do comprador                                                                  |
| `phone`      | Telefone — verificar prefixo `+`                                                    |
| `name`       | Nome completo                                                                       |
| `order_id`   | ID unico da transacao                                                               |
| `value`      | Valor — verificar formato: decimal, centavos (9700) ou string com moeda ("BRL 97") |
| `currency`   | Moeda — se ausente, inferir ("BRL" para gateways brasileiros)                      |
| `product_name` / `product_id` | Nome e ID do produto                                                |
| endereco     | city, state, country, zip                                                           |
| `ip`         | Nem sempre disponivel                                                               |

Apresentar mapeamento proposto antes de escrever qualquer arquivo:

> "Baseado no payload, vou usar estes mapeamentos:
>
> - Evento de aprovacao: `{campo}` = `{valor}`
> - `marca_user`: `{path}`
> - `email`: `{path}`
> - `order_id`: `{path}`
> - `value`: `{path}` ({observacao de formato se houver})
> ...
>
> Confirma ou precisa ajustar algum campo?"

Aguardar confirmacao antes de continuar.

---

## Passo 3 — Transformacoes comuns

Aplicar conforme necessario (ver parsers existentes como referencia em `gateways/`):

```js
// Phone — remover + inicial
var phone = String(getNestedValue(body, '{path}') || '').replace(/^\+?(.*)$/, '$1');

// Zip — extrair 5 primeiros digitos
var zip = String(getNestedValue(body, '{path}') || '').replace(/(\d{5}).*/, '$1');

// Value em centavos (ex: 9700 → "97.00")
var rawValue = String(getNestedValue(body, '{path}') || '');
var value = rawValue.replace(/(.+)(\d{2})$/, '$1.$2');

// Currency e value no mesmo campo (ex: "BRL 97.00")
var total    = String(getNestedValue(body, '{path}') || '');
var currency = total.match(/^(\S+)/) ? total.match(/^(\S+)/)[1] : 'BRL';
var value    = total.replace(/^[A-Z]+\s*/, '');

// Email e name — lowercase
email: (getNestedValue(body, '{path}') || '').toLowerCase(),
name:  (getNestedValue(body, '{path}') || '').toLowerCase(),
```

---

## Passo 4 — Gerar o parser

**Skeleton existente:** sobrescrever o arquivo `gateways/{gateway}.js`  
**Gateway novo:** criar `gateways/{gateway}.js`

```js
import { getNestedValue } from '../shared/helpers.js';

export function parse{Gateway}(body) {
  // {transformacoes necessarias}

  return {
    marca_user:   getNestedValue(body, '{path}'),
    email:        (getNestedValue(body, '{path}') || '').toLowerCase(),
    phone:        phone,
    name:         (getNestedValue(body, '{path}') || '').toLowerCase(),
    order_id:     getNestedValue(body, '{path}'),
    value:        value,
    currency:     '{ISO}',
    product_name: getNestedValue(body, '{path}') || '',
    product_id:   String(getNestedValue(body, '{path}') || ''),
    city:         (getNestedValue(body, '{path}') || '').toLowerCase(),
    state:        getNestedValue(body, '{path}') || '',
    country:      getNestedValue(body, '{path}') || '',
    zip:          zip,
    ip:           getNestedValue(body, '{path}') || '',
    user_agent:   ''
  };
}
```

---

## Passo 5 — Atualizar gateways/index.js

**Skeleton existente:**
- O import e o registro em `GATEWAY_PARSERS` ja existem — nao alterar
- Se `APPROVAL_EVENTS[gateway]` for `null` e o payload tiver um campo de evento identificavel, atualizar para `{ field: '{campo}', value: '{valor}' }`
- Se o gateway nao enviar campo de tipo de evento (aceita qualquer payload), manter `null`

**Gateway novo — adicionar as tres entradas:**

```js
// 1. Import no topo
import { parse{Gateway} } from './{gateway}.js';

// 2. GATEWAY_PARSERS
{gateway}: parse{Gateway},

// 3. APPROVAL_EVENTS
{gateway}: { field: '{campo}', value: '{valor}' },   // ou null se sem filtro de evento
```

---

## Passo 6 — Atualizar overview.md (apenas gateway novo nao listado)

Em `.claude/skills/overview.md`:

**Tabela de deteccao de checkout (Step 2):**
```
| {gateway} | {dominio1}, {dominio2} |
```

**Tabela de URLs de webhook (Step 5):**
```
| {Gateway} | {Onde configurar no painel} | `https://{dominio}/collect/webhook/{gateway}` |
```

---

## Passo 7 — gateways_config no SITE_CONFIG (web.js tracking)

Para que o web.js injete o parametro de rastreamento nos links de checkout, adicionar entrada em `gateways_config` no `wrangler.toml`:

```json
"{gateway}": {
  "domains": ["{dominio1}", "{dominio2}"],
  "caminho": "sck",
  "indexador": "{nome_do_parametro}",
  "user_params": {}
}
```

- `indexador`: nome do parametro que o gateway usa na URL (ex: `xcod` para Hotmart, `sck` para Kiwify) — deve ser o mesmo campo que `marca_user` no parser
- `user_params`: preencher apenas se o gateway aceitar pre-preenchimento de dados do usuario na URL (ex: `{"email": "email", "phone": "phonenumber"}`)
- Se o gateway nao tiver parametro de rastreamento na URL, omitir a entrada de `gateways_config`

---

## Passo 8 — Deploy e validacao

```bash
npx wrangler deploy
```

Solicitar ao cliente que envie um webhook de teste (simulacao no painel do gateway ou compra de teste real). Verificar no D1:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT gateway, order_id, processed, error FROM webhook_raw WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 3;"
```

**Sucesso:** `processed = 1`, `order_id` preenchido, `error = null`

**Se `processed = 0` com `order_id` preenchido:** o evento de aprovacao nao passou pelo filtro. Verificar se o valor do campo de evento no webhook de teste corresponde ao configurado em `APPROVAL_EVENTS`. Alguns gateways enviam valores diferentes em ambiente de teste vs producao.

**Se `order_id = null`:** o parser nao extraiu o order_id — revisar o path configurado com o payload real.

---
name: new-gateway
description: Adiciona suporte a um novo gateway de pagamento no Verdadeiro Trackeamento, ou completa um parser skeleton existente (ticto, eduzz, perfectpay, payt). Mapeia o payload do webhook de compra aprovada, gera o parser e o registra. Use ao integrar um gateway ainda sem suporte completo ou quando webhooks de compra não chegam às plataformas.
---

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

Se o payload ja veio junto (ex: invocacao via `/new-gateway {nome}` com o JSON colado), pular direto para o Passo 2.

Caso contrario, oferecer as tres formas de obter o payload (alternativas):

> "Para mapear o webhook do {gateway}, preciso de um exemplo do payload de **compra aprovada**. Como prefere?
>
> **A** — Colar o JSON agora: no painel do {gateway}, em Ferramentas > Webhooks > Simular (ou Historico de eventos), copie um evento de compra aprovada e cole aqui.
> **B** — Eu procuro na documentacao publica do gateway (pode vir incompleto).
> **C** — Instalar a URL pronta e esperar uma venda real (recomendado): configure `https://{dominio}/collect/webhook/{gateway}` no painel do gateway; quando cair a primeira venda real, eu leio o payload direto do banco e configuro."

- **A** → aguardar o JSON e seguir para o Passo 2.
- **B** → tentar `WebFetch` ("webhook payload example purchase approved {gateway}"); se achar, confirmar com o cliente; se nao, cair para A ou C.
- **C** (preferivel pelo `marca_user`) → o payload de **venda real** traz o `marca_user` no parametro certo (a simulacao do painel costuma vir sem os parametros de rastreamento, que sao o campo mais critico). Quando o cliente avisar que a venda caiu, ler do D1:
>
> ```bash
> npx wrangler d1 execute tracking_db --remote --command "SELECT payload FROM webhook_raw WHERE gateway = '{gateway}' ORDER BY id DESC LIMIT 1;"
> ```
>
> Usar esse `payload` cru como referencia e seguir para o Passo 2.

> **IMPORTANTE — nao ha trigger automatico para a venda.** Na opcao C, depois de o cliente instalar a URL do webhook, **NOS** precisamos instrui-lo a **voltar e avisar assim que cair a primeira venda real** — esse setup fica **pendente** ate la. Deixar a expectativa explicita:
>
> > "Pronto, configure essa URL no painel do {gateway}. **Como o gateway nao me avisa sozinho, me chame aqui assim que cair a primeira venda real** — e nesse momento que eu fecho a parte mais importante (qual parametro carrega o `marca_user`). Aproveite e ja me mande tambem uma **URL de checkout real** do {gateway} (clique no seu botao de compra e copie a URL apos carregar) — com ela eu ja configuro a deteccao do checkout e o evento de inicio de compra sem esperar a venda."

### Enquanto a primeira venda nao cai — 3 cenarios (decidir com o cliente)

Ao aguardar a venda real (opcao C), o restante do VT (pagina, lead, initiate_checkout) ja pode ir ao ar, mas o **Purchase do {gateway} ainda nao esta validado**. Explicar os 3 caminhos e perguntar — resposta simples: **"1", "2" ou "3"**:

> **1 — Manter o tracking que voce ja usa, sem mexer ainda.** Eu so ativo o VT quando o Purchase estiver 100%. Sem risco de queda. *(recomendado)*
>
> **2 — Entregar o VT agora sem o Purchase do {gateway}.** Pagina e lead ja funcionam; o Purchase passa a contar a partir da 1a venda (quando eu configuro o parser com o webhook real). As vendas desse intervalo **nao se perdem** — da pra reenviar retroativamente depois. *(recomendado)*
>
> **3 — Entregar o VT ja disparando o Purchase agora, sem esperar a venda.** Eu configuro o parser "no escuro" (suposicao/skeleton). O Purchase ate dispara, mas vai **seco** — sem o cruzamento de checkout/FDV (sem fbp/fbc/geo/dados do comprador) e com risco de mapear o campo errado. Atribuicao pobre. *(nao recomendado)*

Recomendar **1 ou 2**. Na **2**, nada se perde: apos validar o parser, fazer o reenvio retroativo das vendas do intervalo seguindo `.claude/playbooks/reenvio_dados.md` (esse reenvio depende do endpoint `/collect/reprocess-selective` existir no projeto — o `reenvio_dados.md` verifica e avisa se faltar). Evitar a **3** — Purchase sem dado contamina a qualidade do evento e pode exigir retrabalho se o mapeamento "no escuro" estiver errado.

Gravar a escolha do cliente no `tracking_memory.md`.

---

## Passo 2 — Analisar e mapear

Com o payload, identificar cada campo:

| webhookData  | O que procurar                                                                      |
|--------------|-------------------------------------------------------------------------------------|
| evento       | Campo que indica aprovacao: `event`, `data.event`, `status`, `type`, `webhook_event_type` |
| `marca_user` | Parametro de URL injetado pelo web.js: `sck`, `src`, `xcod`, `sf_trk`, `utm_id`, `utm_content`, `utm_perfect`, `utm_term` — geralmente dentro de um objeto de UTMs ou tracking. Sem parametro dedicado, cair num UTM padrao (ver nota abaixo) |
| `email`      | Email do comprador                                                                  |
| `phone`      | Telefone — verificar prefixo `+`                                                    |
| `name`       | Nome completo                                                                       |
| `order_id`   | ID unico da transacao                                                               |
| `value`      | Valor — verificar formato: decimal, centavos (9700) ou string com moeda ("BRL 97") |
| `currency`   | Moeda — se ausente, inferir ("BRL" para gateways brasileiros)                      |
| `product_name` / `product_id` | Nome e ID do produto                                                |
| endereco     | city, state, country, zip                                                           |
| `ip`         | Nem sempre disponivel                                                               |

> **marca_user sem parametro dedicado:** se o gateway nao oferecer um parametro proprio de rastreamento (`sck`/`src`/`xcod`/`sf_trk`/etc.), usar um **campo de UTM padrao** como indexador — foi o caso da **Eduzz**, que usa `utm_term` (`utm.term` no payload, ver `src/worker/gateways/eduzz.js`). Regra de ouro: o campo escolhido para o `marca_user` no parser tem que ser o **mesmo** definido como `indexador` no `gateways_config` (Passo 7) — round-trip checkout↔webhook. Confirmar com a venda real que o valor injetado na URL voltou nesse campo do `webhook_raw.payload`.

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

Em `.claude/playbooks/overview.md`:

**Tabela de deteccao de checkout (Step 2):**
```
| {gateway} | {dominio1}, {dominio2} |
```

**Tabela de URLs de webhook (Step 5):**
```
| {Gateway} | {Onde configurar no painel} | `https://{dominio}/collect/webhook/{gateway}` |
```

---

## Passo 7 — Config do checkout: gateways_config + trigger (web.js)

Este e o elo mais critico do gateway: garantir que o `marca_user` seja **injetado** na URL do checkout e **volte** no webhook — e o indexador que cruza via FDV no `Purchase` (ver `.claude/references/marca-user.md`). Os dois ajustes abaixo dependem de uma **URL de checkout real** e **nao exigem uma venda** — podem ser feitos na hora.

### Pedir a URL de checkout real

> "Me envie a URL completa do checkout do {gateway}: clique no seu proprio botao de compra, espere carregar a pagina de pagamento e copie a URL inteira da barra de endereco."

### 1. gateways_config — injecao do marca_user

```json
"{gateway}": {
  "domains": ["{dominio do checkout}", "{subdominios}"],
  "caminho": "caminho",
  "indexador": "{parametro_do_marca_user}",
  "user_params": {}
}
```

- `domains`: o(s) dominio(s) do checkout real. O `detectGateway` casa por dominio exato ou subdominio (ancorado no final). **Sem o dominio certo aqui, o `web.js` nao reconhece o link e nao injeta o `marca_user`.**
- `indexador`: o parametro que carrega o `marca_user` na URL. **Decisao mais importante do gateway:** tem que ser (a) o **mesmo campo** que o parser le como `marca_user` no webhook, e (b) um parametro que o gateway **preserva** da URL ate o webhook. O round-trip e confirmado na venda real (Passo 8): o valor injetado na URL apareceu no `webhook_raw.payload`? Ex: `xcod` (Hotmart/Hubla), `sck` (Kiwify), `utm_perfect` (PerfectPay), `utm_term` (Eduzz — sem parametro dedicado, cai num UTM padrao).
- `caminho`: parametro que recebe a string de UTMs (geralmente `caminho`; Hotmart/Kiwify usam `sck`).
- `user_params`: so se o gateway aceitar pre-preenchimento de email/phone/name na URL (ex: `{"email": "email", "phone": "phonenumber"}`).
- **Omitir `gateways_config` so se o gateway nao aceitar NENHUM parametro de query** na URL do checkout (raro). Se ele repassa UTMs ate o webhook (caso comum), **nao** omitir: usar um UTM padrao como `indexador` (ver a nota do Passo 2 — a Eduzz usa `utm_term`). Sem `gateways_config`, nao ha como cruzar a compra via FDV no Purchase.

### 2. Trigger initiate_checkout — disparo do evento

O `initiate_checkout` dispara por um regex em `triggers.initiate_checkout.match`, testado contra a URL do link clicado. O default `pay|eduzz` cobre a maioria via "pay" (`pay.hotmart.com`, `pay.kiwify.com.br`), mas **nem todo checkout contem "pay"** — a Eduzz e o exemplo (URL sem "pay", por isso "eduzz" entra explicito). Conferir na URL real: se o checkout do {gateway} nao casa com o regex atual, adicionar um token que exista na URL dele.

```json
"initiate_checkout": { "type": "link_click", "match": "pay|eduzz|{token_do_novo_gateway}" }
```

Validar via `?debug=1`: ao clicar no botao de compra, o console mostra `[Tracking] Gateway detected: {gateway} | ... | {indexador}={marca_user}` e o `initiate_checkout` dispara.

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

**Se `processed = 1` mas o Purchase chega ao Meta sem `fbp`/`fbc`/`external_id` (dados do browser):** o `marca_user` nao foi extraido ou nao chegou ao checkout. Todo comprador que passou por uma pagina com o script tem `marca_user` — a unica excecao esperada e quem foi direto ao checkout; o resto e falha na cadeia. Ver `.claude/references/marca-user.md` para o diagnostico (parser x `gateways_config` x injecao no checkout).

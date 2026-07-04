# Referencia: rastreamento de checkout em quiz/SPA (element_click)

Fonte unica sobre **por que** o disparo do `InitiateCheckout` em funil/quiz e' click-based (e nunca
por interceptacao de navegacao) e **como** configurar. Lido por caminho pelo onboarding
(`overview.md`) e pela skill `audit-tracking`. Complementa `.claude/references/marca-user.md`
(propagacao do id) e `.claude/references/utmify-compat.md` (coexistencia UTMify).

Origem: implementacao real de funil de quiz single-page (Next.js → gateway). Validado em producao.

---

## O problema

Em pagina de vendas tradicional o botao de compra e' um `<a href="https://{gateway}/...">`. O VT
intercepta o clique (`handleLinkClicks` → `e.target.closest('a')`), injeta `caminho`+`indexador` no
href e dispara o `initiate_checkout` (trigger `link_click`).

Em **funil/quiz** (Next.js/React/XQuiz/Cakto e afins) o botao final costuma ser um `<button>`/`<div>`
que navega via `window.location.href = checkoutUrl` — **sem `<a>`**. Consequencias:

1. `handleLinkClicks` nao acha nenhum `<a>` → o `initiate_checkout` **nunca dispara**.
2. O botao monta a URL do checkout copiando `URLSearchParams(window.location.search)` da propria
   pagina. Se o `indexador` do gateway (que carrega o `marca_user`) nao estiver na URL da pagina, ele
   **nao chega ao checkout** → o `Purchase` perde `external_id`/match quality.

Sao **duas causas independentes**, com dois consertos complementares (um sem o outro = tracking pela
metade):

| Causa | Conserto | Onde |
|---|---|---|
| O evento nao dispara (botao nao-ancora) | `element_click` + `require_navigation` (QZIC-1/2/3) | `src/web.js` |
| O `marca_user` nao chega ao checkout | ramo same-origin em `addParamsToUrl`, gated por `spa_mode` (IZZO-7/14) | `src/web.js` |

---

## Por que NAO interceptar a navegacao (`Location` e' `[LegacyUnforgeable]`)

Tentacao natural: "e so patchar o setter de `window.location.href`/`assign`/`replace` e injetar o
`marca_user` la". **Nao funciona no Chrome/Firefox.**

O objeto `Location` e' marcado `[LegacyUnforgeable]` na spec do HTML: suas propriedades (`href`,
`assign`, `replace`) sao **proprias e nao-configuraveis**, e nao ficam em `Location.prototype`.

- `Object.getOwnPropertyDescriptor(Location.prototype, 'href')` → `undefined`.
- Qualquer `Object.defineProperty(Location.prototype, 'href', ...)` e' **silenciosamente ignorado**
  (ou lanca) — o patch nao pega.

Sao interceptaveis apenas: `history.pushState` / `history.replaceState`, `window.open` e cliques em
`<a>`. O `src/web.js` ainda patcha `location.href/assign/replace` — mas **so como rede de seguranca**
onde o browser permitir; **nunca** como caminho principal do disparo em SPA.

> **Regra para o proximo agente:** o disparo de checkout em SPA e' **click-based** (detectar o clique
> no botao antes de a pagina navegar). Nao reintroduza a abordagem de interceptar `window.location`
> como caminho principal — ela e' comprovadamente quebrada no Chrome.

---

## Como funciona o disparo click-based

Tres pecas no `src/web.js` (Module 2b), todas **aditivas** — so atuam em triggers
`type: "element_click"`, sem tocar em `link_click`/`form_submit`:

- **`element_click` (QZIC-1)** — handler no `document` em **capture-phase** (dispara antes de o
  builder navegar). Casa o elemento clicado por **seletor CSS** (`selector`, default cobre
  `<button>`/`<a>`/`[role=button]`/inputs) e/ou **texto visivel** (`text`, OR por `|`,
  case-insensitive).
- **`require_navigation` (QZIC-2)** — no clique **arma** o disparo; so dispara se a pagina realmente
  **sair** (`pagehide`, com `visibilitychange=hidden` como fallback mobile, janela ~2,5s). Distingue
  o botao de checkout (que navega p/ fora) dos botoes que so rolam a pagina / avancam etapa — e
  **independe do texto** (nao quebra se o cliente mudar o rotulo do botao).
- **`_icFired` (QZIC-3)** — guard que **nao reseta** durante a vida da pagina: o `InitiateCheckout`
  dispara **uma vez por visita**, mesmo com varios CTAs iguais.

### Configuracao (SITE_CONFIG → triggers)

Com `spa_mode.enabled: true`, o `serve-webjs.js` ja monta o default abaixo automaticamente
(IZZO-3/QZIC-5) — o agente **nao** precisa escrever isto. Mostrado aqui so p/ override manual:

```json
"triggers": {
  "initiate_checkout": {
    "type": "element_click",
    "require_navigation": true,
    "text": "comprar|garantir|quero|finalizar",
    "selector": "button,[role=\"button\"]"
  }
}
```

- `text` e `selector` sao **opcionais**. Com `require_navigation: true`, o mais robusto e' deixar o
  texto de fora (o gatilho e' a navegacao real, nao o rotulo).
- **Trade-off:** com `require_navigation` o disparo acontece no `pagehide` (pagina saindo) → chega
  via **CAPI** (server-side). O pixel de navegador nem sempre completa antes do unload; o Meta
  deduplica por `eventID`. Server-side-first: o `navigator.sendBeacon` sobrevive ao `unload`.

---

## Propagacao do `marca_user` (ramo same-origin — IZZO-7, escopado por `spa_mode.locations`)

Para o `marca_user` chegar ao checkout que copia `window.location.search`, a URL da **propria
pagina** precisa ganhar o `indexador` do gateway. Isso e' feito no `addParamsToUrl` (ramo
`else if (userId)` → `getSpaLocation()`), escrito na URL via `replaceState` no load.

- Roda **apenas** quando a pagina atual **casa uma `spa_mode.location`** (default OFF). Paginas fora
  das locations (tradicionais) **nao** recebem injecao — zero poluicao de URL.
- Injeta **so o `indexador`** (nunca o `caminho`, que codifica UTMs em `key=value::` e poluiria a
  barra), e **so do(s) gateway(s) pre-fixado(s) daquela location** (`location.gateways`) — assim o
  `marca_user` entra no parametro CERTO do gateway daquele funil → o `Purchase` mantem
  `external_id`/match e o **FDV merge** enriquece o evento.

### A flag `spa_mode` (escopo por slug/subdominio)

```json
"spa_mode": {
  "enabled": true,
  "locations": [
    { "match": "/quiz",             "gateways": ["lastlink"] },
    { "match": "quiz.seusite.com",  "gateways": ["hotmart"] }
  ]
}
```

- **`enabled`** — kill-switch. `false` (ou ausente) → modo SPA totalmente desligado (comportamento
  tradicional em todas as paginas).
- **`locations[]`** — cada entrada escopa ONDE o modo SPA vale:
  - `match` comeca com `/` → **prefixo de caminho/slug** (`window.location.pathname` comeca com ele).
  - senao → **host** (match exato ou subdominio: o host termina com `.match`).
  - `gateways` → gateway(s) **pre-fixado(s)** daquele local. O checkout do quiz copia a URL da pagina;
    entao o indexador injetado tem que ser o do gateway REAL daquele funil. **Fixe 1 gateway por
    location** (o normal em quiz). Se o local tiver mais de um, todos sao injetados (modo permissivo).
- **Site inteiro e' quiz:** use uma location `{ "match": "/", "gateways": ["..."] }`.
- **Retrocompat:** `enabled: true` **sem** `locations` → o dominio inteiro vira uma location implicita,
  usando `spa_mode.gateways` (lista global). Prefira `locations` — evita poluir paginas tradicionais.

Por que escopar (e nao um flag global): o FDV suporta **multiplos gateways** e sites **mistos**
(paginas tradicionais + um funil de quiz). Um flag global injetaria o indexador em TODA pagina (inclui
as tradicionais → poluicao + crosstalk entre gateways) e trocaria o disparo de checkout do site
inteiro. Escopando por `location`, o **mesmo script** atende pagina tradicional (via `link_click` +
`detectGateway` no clique) **e** funil de quiz (via deteccao automatica + injecao same-origin), sem
toggle e sem interferencia. O guard `_icFired` deduplica caso ambos os caminhos se cruzem.

### Disparo do checkout no quiz e' automatico (nao troca o trigger)

O `initiate_checkout` continua `link_click` (tradicional) para o site todo. Nas paginas que casam uma
location, o `handleSpaCheckoutClicks` (no client) arma o disparo no clique e conclui no `pagehide`
(`require_navigation` implicito) — sem depender de `text`/`selector`. Logo **nao** e' preciso
configurar `element_click` para o fluxo de quiz padrao; o tipo `element_click` (secao 1) fica
disponivel so para overrides manuais.

### Escape hatch `disable_url_rewrite` (IZZO-10)

A reescrita da URL usa `history.replaceState`. Em sites com modais/routers/PWA que escutam
`popstate`, isso pode interferir. Duas defesas ja embutidas:

1. **Idempotencia** — `rewriteCurrentUrl` so chama `replaceState` se a URL mudou de fato (evita loop
   e re-render desnecessario).
2. **Valvula de escape** — `"disable_url_rewrite": true` desliga a reescrita da URL da pagina (cai no
   modo "so links externos"). Use se o cliente reportar algo como "depois que instalei, meu modal
   abre sozinho ao carregar". Custo: em SPA, o `marca_user` deixa de chegar ao checkout — so ligar
   quando a reescrita realmente conflita.

---

## Como decidir (onboarding)

A pergunta A/B/C de **tipo de site** no Step 2 do `overview.md` decide:

- **A — botoes diretos (`<a href>` p/ gateway):** `spa_mode` **off** (default). Multi-gateway puro.
- **B — tem funil de quiz/SPA:** coletar **quais slugs/subdominios** rodam o quiz e **qual gateway
  cada um usa**; montar `spa_mode.enabled: true` + `spa_mode.locations[]` (uma entrada por
  slug/subdominio, gateway pre-fixado). Sites **mistos** (tradicional + quiz) sao o caso normal.
- **C — nao sei:** o agente analisa o HTML no Step 2 (sinais: `__NEXT_DATA__`, `/_next/`,
  `id="__nuxt"`, `<div id="root">`, `window.location.href = ...URLSearchParams`, dominios de builder
  conhecidos); se houver quiz, **perguntar os slugs/subdominios + gateway** antes de gravar.

Gravar `tipo_site` e `spa_mode_locations` no `tracking_memory.md`.

---

## Checklist de validacao (nao quebrar o resto)

- Site tradicional: `<a href>` para gateway ainda recebe `caminho`+`indexador` no clique e dispara
  `initiate_checkout` via `link_click`. Multi-gateway: cada link so o seu indexador.
- Lead: `form_submit` (Elementor/CF7/generico) continua disparando `lead`.
- Quiz (slug em `locations`): `<button>` que navega via `window.location` → `InitiateCheckout` **uma
  vez**, so nos botoes que redirecionam; `marca_user` na URL da pagina e na URL do checkout, no
  indexador do gateway pre-fixado daquela location.
- Site misto: pagina fora das locations (tradicional) **nao** recebe injecao same-origin nem
  `InitiateCheckout` por clique — segue no `link_click`. Slug de quiz no mesmo dominio funciona em
  paralelo, sem toggle.
- `spa_mode` off/ausente: sem poluicao de URL em nenhuma pagina.

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

## Propagacao do `marca_user` (ramo same-origin — IZZO-7, gated por `spa_mode`)

Para o `marca_user` chegar ao checkout que copia `window.location.search`, a URL da **propria
pagina** precisa ganhar o `indexador` do gateway. Isso e' feito no `addParamsToUrl` (ramo
`else if (userId && SPA_MODE_ENABLED)`), escrito na URL via `replaceState` no load.

- Roda **apenas** quando `spa_mode.enabled: true` (default OFF) — sites tradicionais/multi-gateway
  **nao** recebem poluicao de URL (ver `spa_mode` abaixo).
- Injeta **so o `indexador`** (nunca o `caminho`, que codifica UTMs em `key=value::` e poluiria a
  barra de enderecos).
- `spa_mode.gateways` restringe a injecao a gateways especificos (recomendado: liste so o(s)
  gateway(s) do fluxo SPA — XQuiz tipicamente usa 1). Omitido → injeta o indexador de todos os
  gateways configurados (fallback permissivo).

### A flag `spa_mode`

```json
"spa_mode": { "enabled": true, "gateways": ["lastlink"] }
```

| `enabled` | Efeito |
|---|---|
| `false` (default) | Comportamento original: injeta so na URL externa no clique. Multi-gateway funciona sem poluicao de URL. `initiate_checkout` default = `link_click`. |
| `true` | Injeta o indexador na URL da propria pagina (same-origin). `initiate_checkout` default = `element_click`+`require_navigation`. |

Por que opt-in: o FDV suporta **multiplos gateways na mesma pagina** — cada `<a>` recebe so o seu
indexador no clique. Injetar todos os indexadores na URL da pagina quebraria essa neutralidade
(poluicao + potencial crosstalk). Por isso a injecao same-origin so faz sentido em sites que copiam
`URLSearchParams` para o checkout (quiz/SPA), e fica atras da flag.

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
- **B — quiz/SPA (Next.js/React/XQuiz/Cakto):** `spa_mode.enabled: true` + `spa_mode.gateways` com
  o(s) gateway(s) do fluxo.
- **C — nao sei:** o agente analisa o HTML no Step 2 (sinais: `__NEXT_DATA__`, `/_next/`,
  `id="__nuxt"`, `<div id="root">`, `window.location.href = ...URLSearchParams`, dominios de builder
  conhecidos) e decide.

Gravar `tipo_site` e `spa_mode_gateways` no `tracking_memory.md`.

---

## Checklist de validacao (nao quebrar o resto)

- Site tradicional: `<a href>` para gateway ainda recebe `caminho`+`indexador` no clique e dispara
  `initiate_checkout` via `link_click`. Multi-gateway: cada link so o seu indexador.
- Lead: `form_submit` (Elementor/CF7/generico) continua disparando `lead`.
- Quiz: `<button>` que navega via `window.location` → `InitiateCheckout` **uma vez**, so nos botoes
  que redirecionam; `marca_user` na URL da pagina e na URL do checkout.
- `spa_mode` off: sem poluicao de URL em site tradicional.

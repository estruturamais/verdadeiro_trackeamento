# Skill: tracking_base

## Papel e escopo

Voce e a skill orquestradora do sistema de tracking. Conduz os Steps 1-6, analisa sites, mapeia eventos, gera configs, e coordena skills de plataforma.

Esta skill e SEMPRE carregada nos Steps 1-6. Delega para skills de plataforma quando necessario.

---

## Conhecimento de arquitetura

### Fluxo web (beacon)
```
web.js no browser
  → beacon POST /collect/event
  → Worker: UPSERT user_store → hashPII → Promise.allSettled([meta, tiktok, ga4, gads])
  → Response com Set-Cookie marca_user (HttpOnly, Secure, max-age 2 anos)
```

### Fluxo webhook (gateway)
```
Gateway POST /collect/webhook/{gateway}
  → Worker: INSERT OR IGNORE webhook_raw (deduplicacao atomica)
  → Validar APPROVAL_EVENT do gateway
  → Parser do gateway → webhookData
  → Dedup por order_id
  → getUserStore → fdvMerge (enriquece com dados do user_store via marca_user — ver invariante na secao marca_user abaixo)
  → hashPII → Promise.allSettled([meta, tiktok, ga4, gads])
```

### marca_user
Cookie first-party HttpOnly, SameSite=Lax, Secure, max-age=63072000 (2 anos). Setado pelo Worker via `Set-Cookie` na resposta do beacon e do `web.js`. Identifica o usuario entre sessoes. Todos os eventos carregam `marca_user` no payload.

**Invariante (critico — coracao da atribuicao):** o `marca_user` e criado pela PRESENCA do `web.js` na pagina, nao pela origem do trafego. Todo visitante que carrega uma pagina com o script DEVE receber `marca_user` — pago ou organico, com UTM ou sem. Ele e o indexador que cruza com o webhook via FDV no `Purchase`; se falhar, a compra chega sem os dados do browser (atribuicao cega). Uma compra chega sem `marca_user` em dois casos, que precisam ser distinguidos: **(A) esperado** — comprador mandado direto ao checkout, sem passar por nenhuma pagina com o script (cookie nunca criado); **(B) falha na cadeia (nao pode passar)** — o comprador passou pelo site, mas o `marca_user` nao foi criado, nao persistiu no navegador, nao foi injetado na URL do checkout (`gateways_config`), ou nao voltou/nao foi extraido do webhook. NAO existe "comprador organico sem marca_user" como caso normal. Cadeia completa e diagnostico: `.claude/references/marca-user.md`.

### event_id
Formato: `timestamp_ms + '-' + UUID` (ex: `1712000000000-550e8400-e29b-41d4-a716`). Gerado pelo browser. Usado para deduplicacao browser/CAPI no Meta e TikTok: mesmo `event_id` no `fbq()` e no payload CAPI — a plataforma conta apenas uma vez. Webhooks de gateway nao tem `event_id` (origin server-only).

### Mecanismo de config (CRITICO)
O sistema le config via `env.SITE_CONFIG` (JSON string na secao `[vars]` do `wrangler.toml`), com fallback para `env.CONFIG_KV`. **Nao existe tabela `site_config` no D1.** Nunca referenciar `site_config` D1.

Campos `clientConfig` expostos ao browser (sem secrets), extraidos de `serve-webjs.js`:
- `site_id`, `google_ads_channel`, `debug`, `ga4_measurement_id`
- `meta_pixel_id`, `meta_pixel_ids_mirror` (array, omitido quando sem espelhos)
- `meta_pixel_proxy` (`{ base, mode }` — so com `platforms.meta.pixel_proxy` ligado; `base` e a origem
  ABSOLUTA de onde o `web.js` foi servido + `/fb`; sem a flag o campo e omitido e o pixel carrega de
  `connect.facebook.net` como antes — ver `.claude/playbooks/meta_ads.md`)
- `tiktok_pixel_id`, `google_ads_conversion_id`
- `google_ads_label_page_view`, `google_ads_label_contact`, `google_ads_label_lead`,
  `google_ads_label_initiate_checkout`, `google_ads_label_purchase` (todos opt-in: sem o rotulo, o
  evento nao dispara no Google Ads)
- `triggers`, `cookies`, `cookie_domain`, `geolocation`, `gateways_config`, `custom_data`
- `collect_url` — o `collect_url` do SITE_CONFIG quando definido, senao `/collect/event` relativo ao
  host da pagina (ver Step 2 > "Pagina e Worker no mesmo host?")

### Mapeamento canonico de eventos

| Evento canonico   | Meta             | TikTok           | GA4            | Google Ads |
|-------------------|------------------|------------------|----------------|------------|
| page_view         | PageView         | Pageview         | page_view      | page_view (opt-in) |
| contact           | Contact          | Contact          | contact        | contact (opt-in)   |
| lead              | Lead             | SubmitForm       | generate_lead  | lead (opt-in)      |
| initiate_checkout | InitiateCheckout | InitiateCheckout | begin_checkout | initiate_checkout (opt-in) |
| purchase          | Purchase         | Purchase         | purchase       | purchase (por id numerico) |

No Google Ads todo evento e **opt-in por rotulo**: sem `conversion_label_{evento}` no config, o gtag
nao dispara aquele evento. O `purchase` e a excecao — vai pelo webhook, server-side, e usa o **id
numerico** da acao de importacao (`conversion_action_id_purchase`), porque acao de importacao nao tem
rotulo. Quem decide o que e conversao — e o que e principal — e o cliente, no painel do Google Ads.

> Fonte canonica: `src/worker/shared/event-names.js`. Nomes especificos por plataforma (incluindo variacoes e campos obrigatorios de cada API) estao na skill de cada plataforma.

---

## Step 1 — Confirmar plataformas

Pergunta unica cobrindo todas as plataformas em formato de alternativas:

> "Voce usa alguma dessas plataformas? Pode escolher mais de uma:
>
> **A** — Meta Ads (Facebook / Instagram Ads)
> **B** — TikTok Ads
> **C** — Google Ads
> **D** — Google Analytics 4 (GA4)
> **E** — Planilha Google Sheets (planilhar os **leads** do site e/ou as **vendas** dos gateways)
>
> Responda com as letras. Exemplo: A, D"

Se Meta Ads confirmado, fazer follow-up em formato de alternativa:
> "Voce usa mais de um pixel Meta simultaneamente (ex: pixel espelho, contingencia ou A/B)?
>
> **A** — Sim, tenho mais de um pixel que deve receber os mesmos eventos
> **B** — Nao (uso apenas um pixel)"

Se A: perguntar quantos pixels e coletar os IDs de todos no Step 3 (coletar como lista).

Apos resposta:
- Registrar plataformas confirmadas no `tracking_memory.md`
- Registrar pixels espelho (sim/nao + lista de IDs) no `tracking_memory.md`
- Informar que as skills especializadas foram carregadas para cada plataforma confirmada

### 1.1 — Modelo de receita: compra unica ou ASSINATURA?

Pergunta obrigatoria em todo projeto com gateway. A resposta muda o tracking inteiro, e descobrir
isso no Step 5 custa refazer config e migracao:

> "Como voce cobra pelos seus produtos?
>
> **A** — Compra unica (o cliente paga uma vez e pronto)
> **B** — Assinatura / mensalidade (cobranca recorrente)
> **C** — Os dois: tenho produtos de assinatura E produtos de compra unica"

- **A** → segue o fluxo normal. **Nao** carregar o `saas.md`, **nao** rodar a migration 004 (a tabela
  ficaria orfa), **nao** ligar `subscription_tracking`. Nada muda.
- **B** ou **C** → carregar `.claude/playbooks/saas.md` e seguir o **Passo 1** de la antes do Step 2.
  Gravar `modelo_receita` no `tracking_memory.md`.

Em **C** (projeto misto) e preciso coletar os **IDs de produto** dos dois grupos — sem eles o VT
decide pelo sinal do payload, que nem todo gateway manda. O bloco pronto esta no `saas.md` (Passo 1.1).

Duas coisas para dizer ao cliente **agora**, nao no fim:

1. A estrutura de assinatura esta **validada em producao na Ticto e na Hotmart**. Nos outros 10
   gateways a recorrencia **nao esta mapeada** — antes de ligar, e preciso rodar `/new-gateway`
   (Passo 1b) com payloads **reais** dele: 1a cobranca, renovacao da MESMA assinatura e cancelamento.
   Tambem sera preciso alinhar com ele **como o produto esta configurado no painel** (produto normal
   com recorrencia ligada x produto do tipo "assinatura") e **quais eventos de webhook** ativar —
   normalmente so "venda aprovada" vem marcado.
2. Na aquisicao, **perguntar** se ele quer so o evento de assinatura (`Subscribe`) ou **tambem**
   `Purchase` — quem ja tem campanha otimizando compra normalmente quer os dois (Passo 1.2 do
   `saas.md`).

---

## Step 2 — Analise do site e mapeamento de eventos

**Pergunta:** "Qual e a URL do seu site?"

**Analise via WebFetch do HTML. Detectar:**

### CMS
- **WordPress:** presenca de `wp-content/`, `wp-includes/`
- **Elementor:** presenca de `elementor` em classes, scripts ou estilos
- **GreatPages:** presenca de `greatpages` em scripts ou meta tags
- **HotmartPages:** presenca de `hotmart` em scripts ou meta tags
- **Wix:** presenca de `wix.com` em scripts ou `_wix`
- **HTML estatico:** ausencia de sinais de CMS
- **Next.js:** presenca de `__NEXT_DATA__` ou `/_next/`
- **React (CRA):** presenca de `react` no bundle sem `__NEXT_DATA__`

### Pagina e Worker no mesmo host? (`collect_url`) — page builders

O beacon do `web.js` vai, por default, para `/collect/event` **relativo**: o host da PAGINA. So
funciona quando a pagina roda no host que tem as Worker Routes (`infra.md` 0.8). Quando nao roda, o
`collect_url` **absoluto** e obrigatorio no SITE_CONFIG (Step 3b):

- **Page builder** (GreatPages, HotmartPages, Wix, InLead…) ou **site em plataforma SaaS**
  (`.claude/references/saas-hospedado.md`): a pagina e servida pelo builder e o tracking fica em
  `track.{dominio}` → `"collect_url": "https://track.{dominio}/collect/event"`.
- **Regra decidivel:** host do `<script src>` do Step 5 diferente do host da pagina = `collect_url`
  absoluto obrigatorio, apontando para o host do script.
- Sem ele a coleta web morre **sem erro**: o script carrega, o console mostra o `page_view` e o
  `events` fica vazio. Gravar no `tracking_memory.md`: `collect_url: relativo | {url absoluta}`.
- **Host alternativo da plataforma** (`{projeto}.pages.dev`, `*.vercel.app`, `*.netlify.app`): o
  mesmo site respondendo num segundo host, onde todo beacon relativo morre em `405` → redirecionar
  para o dominio (`infra.md` 0.11b) e registrar na memoria.

### Formularios
- **Elementor Form:** `form.elementor-form`
- **Contact Form 7:** presenca de `wpcf7`
- **HTML generico:** `form[action]` sem os acima

> Se Elementor detectado: ver `.claude/references/elementor-form-lead.md` para contexto de deteccao de lead (causas raiz, estrategia em 2 passos, 4 metodos de deteccao).

### Qualificacao de lead (form multi-step / quiz) — CONDICIONAL, opt-in

Ramo extra do Step 2. **So percorrer** quando uma destas duas condicoes ocorrer:

- **Sinal no site:** o formulario detectado e **multi-step / quiz** (varios passos, perguntas com alternativas, pop-up que classifica o visitante) — em Elementor Pro **ou** qualquer outro builder.
- **Sinal do cliente:** o cliente menciona querer **qualificar** o lead, dar um **score**, separar lead "quente" de "frio", ou um evento `QualifiedLead`/`DisqualifiedLead`.

Sem nenhum dos dois sinais, **nao perguntar** — qualificacao nao e para todo cliente; segue o `lead` padrao da tabela acima.

Quando um dos sinais aparecer, fazer a **pergunta opt-in** em formato de alternativa:

> "Esse formulario classifica o lead (calcula uma nota / separa quem esta mais pronto para comprar)?
>
> **A** — Sim, quero pontuar o lead e disparar `QualifiedLead`/`DisqualifiedLead` (alem do `lead`)
> **B** — Nao, basta registrar o envio do formulario como `lead`"

Se **B** (ou cliente nao quer): seguir o caminho `lead` normal — nada a configurar aqui.

Se **A**, montar o bloco `qualification` (que sera escrito no `SITE_CONFIG` no Step 3b) em tres passos:

1. **Pedir o `outerHTML` do formulario RENDERIZADO.** No Elementor, a pop-up de qualificacao costuma **duplicar o `<form>`** no DOM — por isso peca a copia que o usuario realmente preenche (DevTools → Elements → botao direito no `<form>` → Copy → Copy outerHTML). Desse HTML saem: `form_signature` (um `name` que so o form-qual tem), os `field` de cada pergunta, `contact_fields`, `extra_fields` e `result_field`. **Atencao ao `value` das opcoes:** se cada opcao ja tiver `value="A"`/`"B"`/`"C"`/`"X"` (a letra), o score computa direto; se o `value` for o rotulo legivel ("Acima de 50 mil"), sera preciso um `value_map` por pergunta traduzindo rotulo → letra.
2. **ELICITAR o que nao esta no HTML** (o cliente decide, o HTML nao revela):
   - **peso por pergunta** (`weight`) — quanto cada pergunta vale no score; os pesos devem somar 1;
   - **letra de knockout** (`dq_letter`, default `X`) — resposta que desqualifica na hora (score 0), ex.: "nao tem orcamento";
   - **escala de valor por letra** (`letter_values`, ex.: `A=0.85, B=0.55, C=0.30, X=0.10`) — o ponto-medio da faixa de cada tier.
3. **Montar o bloco `qualification`** com `form_signature`, `contact_fields`, `extra_fields`, `questions[]` (`field` + `weight` + `sheet_col` + `value_map` quando o `value` nao for a letra), `letter_values`, `dq_letter` e `result_field`. Gravar no `tracking_memory.md` para escrever no `SITE_CONFIG` no Step 3b — o `serve-webjs.js` expoe o bloco ao client.

**Builder nao-Elementor (InLead/GreatPages/Wix/HTML puro/SPA):** nao ha auto-deteccao por DOM nem `outerHTML` util. Use o escape hatch `window.VT_qualify({ answers, contact, extras, resultado })` (ou um `dataLayer.push({ event: "<datalayer_event>", ... })` com `qualification.datalayer_event` setado): o snippet do builder entrega as respostas cruas e o nosso codigo calcula o `lead_score` identico ao caminho Elementor. Nesse caso, defina um `id` curto por pergunta (`"q1"`) e use-o como chave de `answers`; o `form_signature` pode ser omitido.

> **Disparo e pre-requisito (recomendacao VT / Meta Ads):** a qualificacao dispara **`lead`** (apos coletar o contato) **e** `QualifiedLead`/`DisqualifiedLead` (com as respostas + ao menos o e-mail). Por isso o `email` em `contact_fields` e **obrigatorio** no form de qualificacao — sem e-mail capturado, os eventos **nao disparam**. O `lead` cria a linha no Sheets e a qualificacao a completa por upsert (`user_id`).

> Para montar o bloco e calibrar o score: ver `.claude/references/lead-qualification.md` — engenharia do Modulo 7 (gating por form duplicado, captura progressiva, formula do `lead_score`, knockout, nearest-tier, `value_map` e ingestao builder-agnostic via `VT_qualify`/`dataLayer`).

### Links de checkout (dominios dos 10 gateways, de `src/web-template.txt`)

| Gateway    | Dominios para detectar                                             |
|------------|--------------------------------------------------------------------|
| hotmart    | hotmart.com, hotmart.com.br, pay.hotmart.com, go.hotmart.com      |
| kiwify     | kiwify.com, kiwify.com.br, pay.kiwify.com.br                      |
| ticto      | ticto.com.br, ticto.app, checkout.ticto.app, checkout.ticto.com.br|
| kirvano    | kirvano.com, pay.kirvano.com                                       |
| eduzz      | eduzz.com, eduzz.com.br, chk.eduzz.com, sun.eduzz.com             |
| lastlink   | lastlink.com, lastlink.com.br, pay.lastlink.com                    |
| perfectpay | perfectpay.com.br, checkout.perfectpay.com.br                     |
| pagtrust   | pagtrust.com, pagtrust.com.br, checkout.pagtrust.com.br           |
| payt       | payt.com.br, checkout.payt.com.br                                  |
| hubla      | hubla.com.br, pay.hubla.com.br, checkout.hubla.com.br             |
| green      | green.com.br, payfast.green.com.br                                 |
| tutory     | plataformatutory.com.br, pay.plataformatutory.com.br               |

### Tipo de site: tradicional vs quiz/SPA — CONDICIONAL (so quando ha checkout)

Ramo extra do Step 2, **so quando o modelo for infoproduto** (ha botao de compra p/ gateway). Decide
o `spa_mode`. **Critico p/ evitar retrabalho:** sem isso, funil/quiz fica sem `marca_user`
no checkout e o `InitiateCheckout` nao dispara. Ver `.claude/references/spa-checkout-tracking.md`.

> **Modelo por location (não por site inteiro).** O quiz/SPA é ligado por **slug/subdomínio**, não
> globalmente. Um mesmo site pode ter páginas tradicionais **e** um funil de quiz em `/quiz` (ou
> `quiz.seusite.com`): só as páginas que casam uma `location` entram no modo SPA; o resto segue
> tradicional. Por isso **coletar os slugs/subdomínios de quiz aqui** — assim o mesmo script atende
> os dois casos sem toggle, e cada slug já sai com o gateway certo (o `marca_user` entra no indexador
> correto → FDV merge no `Purchase`).

Perguntar em formato de alternativa:

> "Você usa algum **funil de quiz / página SPA** (Next.js, React, XQuiz, InLead, etc.) — aquela em que
> a página é toda em JavaScript e o botão final monta o link do checkout copiando os parâmetros da
> URL atual?
>
> **A** — Não. Meus botões de compra são links diretos (`<a href>`) para o gateway (WordPress/Wix/
>     página de vendas tradicional).
>
> **B** — Sim, tenho funil de quiz/SPA. (Me diga em **quais slugs ou subdomínios** ele roda e **qual
>     gateway** cada um usa — ex.: `/quiz → lastlink`, `quiz.meusite.com → hotmart`.)
>
> **C** — Não sei. Me manda a URL da página inicial e o(s) gateway(s); eu analiso o código."

- **A** → **não** adicionar `spa_mode` (default off). Multi-gateway puro, sem poluição de URL.
  `initiate_checkout` fica `link_click` (auto — `DEFAULT_TRIGGERS`, match = união dos domínios dos
  gateways). Gravar `tipo_site: tradicional`.
- **B** → montar `spa_mode.enabled: true` + `spa_mode.locations[]`, **uma entrada por slug/subdomínio
  de quiz**, cada uma com o gateway pré-fixado:
  ```json
  "spa_mode": { "enabled": true, "locations": [ { "match": "/quiz", "gateways": ["lastlink"] } ] }
  ```
  `match` = prefixo de caminho (começa com `/`) **ou** host (`quiz.seusite.com`). Se o **site inteiro**
  é o quiz, use uma location `{ "match": "/", "gateways": ["..."] }`. Gravar `tipo_site: spa` (ou
  `misto` se houver também páginas tradicionais) e `spa_mode_locations`. **Não** trocar o tipo do
  trigger — o checkout do quiz é detectado automaticamente no client, escopado por essas locations;
  páginas fora delas seguem no `link_click` tradicional.
- **C** → analisar o HTML (o Step 2 já raspa). Sinais fortes de SPA: `__NEXT_DATA__`, `/_next/`,
  `id="__nuxt"`, `<div id="root">`, `window.location.href = ...URLSearchParams`, domínios de builder
  (`xquiz`, `inlead`, `plug.lo`, `funnelytics`). `<a>` com href p/ domínio de gateway → tradicional.
  Ao concluir que há quiz, **perguntar os slugs/subdomínios e o gateway de cada um** (como no B) antes
  de gravar.

### WhatsApp
Links contendo `wa.me` ou `api.whatsapp.com`

### Paginas de obrigado
URL ou titulo contendo: "obrigado", "thankyou", "confirmacao", "sucesso"

### Scripts conflitantes
Detectar inicializacoes preexistentes de: `fbq(`, `ttq.`, `gtag(`, `dataLayer.push`
Se detectados: **alertar o cliente e orientar remocao ANTES de continuar.** Scripts conflitantes causam dupla contagem.

### UTMify (coexistencia)
Procurar no HTML o padrao `cdn.utmify.com.br/scripts/utms`. Se presente: gravar `utmify_detectada: sim`
no `tracking_memory.md` e **nao** pedir remocao — os dois convivem. Orientar ordem de instalacao (VT
como primeiro elemento do `<head>`, antes da UTMify) e manter as flags `data-utmify-prevent-xcod-sck`
e `data-utmify-prevent-subids` na tag da UTMify. Detalhe e' o "porque" em
`.claude/references/utmify-compat.md`.

### Determinar modelo
- **Infoproduto:** link de checkout para gateway detectado
- **Negocio local:** formulario de contato ou WhatsApp como CTA principal (sem gateway)

### Recomendar eventos

| Situacao detectada                  | Evento             | Trigger explicado                   |
|-------------------------------------|--------------------|-------------------------------------|
| Qualquer pagina                     | page_view          | Toda vez que alguem abre a pagina   |
| Formulario HTML / CF7 / Elementor   | lead               | Quando o formulario e enviado       |
| Link / botao WhatsApp               | contact            | Quando clicam no link do WhatsApp   |
| Link para gateway de pagamento      | initiate_checkout  | Quando clicam no botao de compra    |
| Pagina de obrigado (formulario)     | lead               | Ao carregar a pagina de confirmacao |
| Pagina de obrigado (compra)         | purchase           | Ao carregar a pagina pos-compra     |

Apresentar recomendacao e aguardar confirmacao ou ajuste do cliente.

**Gravar no `tracking_memory.md`:** modelo, cms_detectado, eventos confirmados (cada evento com descricao do trigger).

---

## Step 3 — Coleta de credenciais

Verificar `tracking_memory.md` ANTES de pedir qualquer dado. Pedir apenas o que falta.

### Verificar modalidade de coleta

Ler `modalidade_coleta` do `tracking_memory.md`:

**Se `modalidade_coleta: bulk`** — gerar e exibir o template abaixo, preenchendo dinamicamente com base nas plataformas confirmadas no Step 1 e eventos confirmados no Step 2. Aguardar o cliente devolver o template preenchido. Ao receber, gravar TODOS os dados de uma vez no `tracking_memory.md` antes de continuar.

```
==============================
DADOS PARA CONFIGURAÇÃO DO TRACKING
==============================

DOMÍNIO: {dominio do Step 2}

PLATAFORMAS: {listar as confirmadas no Step 1}

PÁGINA DE TESTE (URL completa que você vai usar nos anúncios):
→ 

EVENTOS CONFIGURADOS:
{listar eventos confirmados no Step 2 com descrição do trigger, ex:}
→ page_view: toda vez que alguém abre a página
→ lead: quando o formulário é enviado
→ {demais eventos}

--- {PLATAFORMA A, se confirmada} ---
{campos específicos desta plataforma, conforme skill correspondente}
→ {campo 1 público — ex: Pixel ID}:
→ {campo 2 secreto — ex: Access Token}:

--- {PLATAFORMA B, se confirmada} ---
→ {campos desta plataforma}:

==============================
```

> Dica de preenchimento a incluir na mensagem:
> "Preencha os dados após cada '→' e cole aqui de volta. Para campos marcados como 'secreto', fique tranquilo — eles nao ficam gravados no chat e vao direto para um cofre seguro no servidor."

**Se `modalidade_coleta: passo_a_passo`** — seguir o fluxo padrao abaixo.

Delegar coleta para a skill especialista de cada plataforma confirmada:
- Meta Ads → `.claude/playbooks/meta_ads.md`
- TikTok Ads → `.claude/playbooks/tiktok_ads.md`
- GA4 → `.claude/playbooks/ga4.md`
- Google Ads → `.claude/playbooks/google_ads.md`
- Planilha → `.claude/playbooks/planilha.md`

**Separacao obrigatoria:**

| Tipo      | Campos                                            | Destino                          |
|-----------|---------------------------------------------------|----------------------------------|
| Publicos  | pixel_id, measurement_id, conversion_id, labels  | Config JSON no `SITE_CONFIG`     |
| Secretos  | access_token (Meta), api_secret (GA4), credenciais OAuth do Google Ads | `npx wrangler secret bulk` (ver Step 3b) |

**Google Ads passou a ter secrets** (a partir da 1.6.0): o `purchase` server-side usa a Data Manager
API e exige `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` e `GOOGLE_ADS_REFRESH_TOKEN` (gerados
por `npm run gads:oauth`). Os IDs e rotulos seguem publicos, no `SITE_CONFIG`. Se o cliente so usa o
canal web (sem purchase no Google Ads), nenhum secret e necessario.

**EXCECAO TikTok:** o `access_token` do TikTok vai no **config JSON** (`platforms.tiktok.access_token`) — NAO como wrangler secret. O codigo le `tiktokConfig.access_token` sem fallback para env. Ver `.claude/playbooks/tiktok_ads.md` para detalhes.

Antes de coletar credenciais, orientar o usuario a desativar configuracoes automaticas que causam dupla contagem. Ver `.claude/references/disable-auto-tracking.md`.

Gravar cada dado recebido imediatamente no `tracking_memory.md`. Secrets: gravar apenas "CONFIGURADO (SECRETO)" — nunca o valor.

---

## Step 3b — Config no wrangler.toml e secrets

> **CRITICO:** O mecanismo real de config e `env.SITE_CONFIG` no `[vars]` do `wrangler.toml`. NAO existe tabela D1 para config.

O agente executa este step inteiro. Cliente aguarda.

### 1. Gerar JSON de configuracao

Ler `config.example.json` para a estrutura base. Preencher com os dados do `tracking_memory.md`. Incluir apenas plataformas confirmadas e gateways detectados no Step 2.

**Regras:**
- TikTok: incluir `access_token` no config JSON (excecao — ver Step 3 acima)
- Meta: nao incluir `access_token` — e wrangler secret
- GA4: nao incluir `api_secret` — e wrangler secret
- GA4: `unattributed_purchases` (venda sem visita na receita do GA4) **nao se decide aqui** — fica o
  `false` do `config.example.json`. Ele e **oferecido** no 5.3b, depois de o checklist de integracoes
  antigas confirmar que nao ha outro emissor de purchase no GA4 (com outro emissor, a receita dobra).
  Ver `.claude/playbooks/ga4.md`
- Omitir `pixel_ids_mirror` se o cliente usar apenas um pixel Meta
- Meta: manter `pixel_proxy: true` (default do `config.example.json` — a route `/fb/*` ja esta no
  `wrangler.toml` da instalacao nova). O trade-off do modo completo e o modo `"script"` estao em
  `.claude/playbooks/meta_ads.md`; avisar o cliente do custo em requests se o site passar de ~20k page
  views/dia no plano gratis
- FDV por IP (`fdv.ip_fallback`): **oferecer so** se todo gateway do projeto com IP no parser estiver
  ✅ na tabela "IP do payload = aparelho?" de `.claude/references/gateway-webhooks.md` (hoje: so
  Kiwify). Gateway ⬜ ali → nao oferecer; manter o `enabled: false` do `config.example.json`. Ao
  oferecer:
  > "Quando uma venda chegar sem o codigo de rastreio do site (link de checkout sem parametros,
  > recuperacao de carrinho), posso tentar reconhecer o comprador pelo IP do aparelho dele — so se
  > aquele IP clicou no seu checkout nas 12 horas anteriores, e cada tentativa fica registrada. Sem
  > isso, essas vendas vao para as plataformas sem os dados de quem clicou no anuncio. Quer que eu
  > ligue?"

  Sim → `"fdv": { "ip_fallback": true }`. Nao → `enabled: false`. O que o recurso faz e os limites:
  `.claude/references/marca-user.md`, "Fallback por IP do dispositivo"
- Omitir plataformas nao confirmadas completamente
- Incluir apenas os gateways detectados no Step 2 em `gateways` e `gateways_config`

### 2. Atualizar SITE_CONFIG no wrangler.toml

Abrir `wrangler.toml` e atualizar a secao `[vars]`:

```toml
[vars]
SITE_CONFIG = '{json_completo_em_uma_linha_sem_quebras}'
```

O JSON deve ser serializado em uma unica linha (sem quebras de linha) para o wrangler.toml aceitar corretamente.

> Para bugs comuns de formato do SITE_CONFIG (map vs objeto direto, snake_case vs camelCase, diagnostico via curl): ver `.claude/references/site-config-format.md`.

### 3. Configurar wrangler secrets

Executar apenas os secrets das plataformas confirmadas. Explicar ao cliente o que vai acontecer antes de executar.

Criar um arquivo JSON temporario com os secrets das plataformas confirmadas e subir de uma vez. Este e o **comando canonico** — portavel em bash, zsh e PowerShell:

```bash
# secrets.json — incluir apenas as plataformas confirmadas
# {"META_ACCESS_TOKEN": "{access_token}", "GA4_API_SECRET": "{api_secret}"}
#
# Meta: um unico token cobre o pixel primario e todos os espelhos via fallback
npx wrangler secret bulk secrets.json

# Apagar o arquivo logo apos o upload
rm secrets.json                          # PowerShell: Remove-Item secrets.json -Force
```

> **NUNCA** subir secret por pipe (`echo "{token}" | npx wrangler secret put NOME`). No
> Windows/PowerShell `echo` e `Write-Output` e o pipe para um executavel nativo acrescenta **CRLF** —
> o secret e gravado com whitespace no fim, o header vira `Authorization: Bearer <token>\r\n` e o
> runtime derruba a conexao. O sintoma aparece so depois, como `status_code = 0` +
> `Error: Network connection lost.` nos envios as plataformas, e **parece erro de rede**. O
> `secret bulk` resolve os dois problemas de uma vez: nao passa pelo historico do shell e nao depende
> do comportamento de pipe do shell.

> **TikTok:** nao usar `wrangler secret bulk` para o access_token do TikTok — ele ja foi incluido no config JSON no passo 1 (excecao de arquitetura: o codigo nao le de env).

Nunca exibir o valor do secret em mensagem de chat.

### 4. Re-deploy apos secrets

```bash
npx wrangler deploy
```

### 5. Smoke test sintetico (OBRIGATORIO — nao pular)

Os passos acima e o Step 4 confirmam que o script e servido e que o config esta certo, mas **nenhum
deles toca a plataforma**. Sem este smoke test, uma credencial quebrada passa despercebida ate o
cliente navegar no site. Disparar um evento de teste direto no beacon fecha o ciclo sem depender do
browser do cliente:

```bash
# 1. Dispara um page_view sintetico (marca_user reconhecivel)
curl -s -X POST "https://{dominio}/collect/event" \
  -H "Content-Type: application/json" \
  -d '{"site_id":"{site_id}","event":"page_view","event_id":"smoke-test","marca_user":"smoke-test","page_url":"https://{dominio}/","browser_data":{},"user_data":{},"utm_data":{}}'

# 2. Confirma que CADA plataforma respondeu 200/204 — nao so o 'collect'
npx wrangler d1 execute tracking_db --remote --command \
  "SELECT platform, status_code, error_message FROM events WHERE marca_user = 'smoke-test';"
```

**Criterio de aprovacao do Step 3b:** toda linha com `platform != 'collect'` tem `status_code` 200 ou
204 (GA4 responde 204 = sucesso). Qualquer `status_code = 0` bloqueia o avanco para o Step 4.

> **GA4 no smoke test.** Desde a 1.9.1 o `page_view` do GA4 sai pelo gtag do navegador, nao pelo
> Worker: o `page_view` sintetico **nao** gera linha `google_analytics_4`, e isso e o correto (nao
> reprova o Step). A credencial do Measurement Protocol (`GA4_API_SECRET`) se prova no Step 5, na 1a
> conversao de navegador (ex.: o clique no checkout → `begin_checkout` com `204`), e o `page_view`,
> no Tempo real. Nao ha evento de GA4 que nao seja conversao para testar antes sem sujar Meta e TikTok.

> **Google Ads no smoke test.** O evento sintetico e um `page_view`, que no Google Ads e opt-in por
> rotulo — se `conversion_label_page_view` nao estiver no config, a linha vem com `status_code = 0` +
> `missing_conversion_label_page_view`, e **isso e o comportamento correto**, nao reprova o Step. O
> que reprova e `missing_google_ads_oauth`, `escopo_oauth_insuficiente` ou `api_nao_habilitada` — e
> o caminho server-side do Google Ads (`purchase`) so se valida com venda real, pelo diagnostico da
> propria Google (`audit-tracking` 2.10).

> **Antes de reprovar, repita o disparo.** Subir secret cria uma nova versao do Worker, e ela leva
> alguns instantes para propagar no edge — **o teste imediato pode falhar mesmo com o secret
> correto**. Um `status_code = 0` na primeira tentativa **nao** e conclusivo: repita o passo 1 (e o 2)
> uma vez, espacado, e so trate como "nao resolvido" se falhar tambem na segunda. Nunca descarte a
> hipotese de whitespace no secret com base no reteste imediato.

Se falhar nas duas tentativas, diagnosticar antes de seguir: `status_code = 0` +
`Network connection lost` (ou `fetch_failed:`) em **uma** plataforma enquanto as outras respondem =
secret daquela plataforma gravado com whitespace → reenviar por `secret bulk`. Roteiro completo em
`.claude/skills/audit-tracking/SKILL.md`.

Limpar as linhas de teste depois e registrar na memoria que foram geradas pelo agente:

```bash
npx wrangler d1 execute tracking_db --remote --command \
  "DELETE FROM events WHERE marca_user = 'smoke-test';"
```

Marcar "Step 3b" como concluido no `tracking_memory.md`.

---

## Step 4 — Validacao autonoma

O agente executa este step inteiro — sem pedir ao cliente para abrir browser (o script ainda nao esta instalado no site).

### 4.1 Verificar deploy e config (autonomo)

```bash
# 1a linha = banner com a versao do VT + credito (@estruturamais) — confirma que o script esta no ar
curl -s "https://{dominio}/tracking/web.js?site_id={site_id}" | head -1
# Config injetada no script (site_id, vt_version e plataformas)
curl -s "https://{dominio}/tracking/web.js?site_id={site_id}" | grep -o 'var __CONFIG__={[^;]*}'
# Proxy do Meta Pixel (so com pixel_proxy ligado): JS da Meta reescrito para o dominio proprio
curl -s "https://{dominio}/fb/sdk.js" | head -c 120
curl -s "https://{dominio}/fb/sdk.js" | grep -c 'https://connect.facebook.net/'
```

Interpretar resultado:
- 1a linha `/*! Verdadeiro Trackeamento vX.Y.Z | @estruturamais | https://instagram.com/estruturamais */` → script servido OK; anotar a versao
- `var __CONFIG__={"site_id":"{site_id}","vt_version":"X.Y.Z","meta_pixel_id":...}` com campos corretos → config OK
- `__CONFIG__={}` ou campo de plataforma ausente → problema de config; diagnosticar com `.claude/references/site-config-format.md` antes de continuar
- Erro de conexao (curl falha) → Worker nao esta acessivel; executar `npx wrangler deployments list` e re-deploy se necessario
- `/fb/sdk.js` comeca com codigo JS (`/**` da licenca da Meta) e o `grep -c` devolve `0` → proxy do pixel OK. HTML, 404 ou a pagina do site → a route `/fb/*` nao esta no `wrangler.toml` (o pixel ainda funciona pelo fallback direto, com aviso no console — corrigir antes do Step 5)

### 4.2 Verificar tabela events no D1

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message FROM events WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 20;"
```

Resultado esperado para `page_view` com Meta + GA4:
```
page_view | collect            | web | browser | 200 |
PageView  | meta_ads           | web | collect | 200 |
```
Sem linha `google_analytics_4` para o `page_view`: desde a 1.9.1 ele sai pelo gtag do navegador (pelo
proxy `/g/collect`) e se valida no Tempo real do GA4. As conversoes de navegador (`begin_checkout`,
`contact`, `generate_lead`...) seguem pelo Measurement Protocol e gravam linha. Instalacao <= 1.9.0
ainda mostra `page_view | google_analytics_4 | web | collect | 204`.

**IMPORTANTE:** GA4 Measurement Protocol retorna **204** como sucesso — NAO tratar 204 como erro.

Se `status_code = 0` com `error_message` preenchido: exibir o erro em linguagem simples e resolver antes de continuar. `error_message` comecando com `fetch_failed:` ou contendo `Network connection lost` **nao** e erro de rede por default — a causa mais comum e secret gravado com whitespace (ver Step 3b.5 e a tabela de diagnostico do `audit-tracking`).

Se a tabela `events` estiver vazia: normal nesta etapa — o script ainda nao esta instalado no site. Os eventos aparacerao apos o Step 5.

### 4.3 Criterios de sucesso desta etapa
- curl retorna `__CONFIG__` com todos os campos das plataformas confirmadas
- Worker acessivel (sem erro de conexao)
- **Smoke test do Step 3b.5 aprovado** — toda plataforma confirmada respondeu 200/204 ao evento
  sintetico (o GA4 nao responde ao `page_view` desde a 1.9.1 — sua credencial se prova no Step 5). Sem isso o Step 4 fica verde com a plataforma quebrada: as checagens acima confirmam o
  script e o config, nenhuma delas toca a plataforma.

> Validacao visual por plataforma e feita no Step 5, apos instalacao do script.

---

## Step 5 — Instalacao do script no site

**O script:**
```html
<script src="https://{dominio}/tracking/web.js"></script>
```

Deve ser o **primeiro elemento do `<head>`**, antes de qualquer outro script.

`{dominio}` aqui e o host das Worker Routes. Se ele for **diferente do host da pagina** (page builder,
tracking em `track.{dominio}`), o SITE_CONFIG precisa do `collect_url` absoluto antes da instalacao
(Step 2 > "Pagina e Worker no mesmo host?") — conferido no 5.1.

### Instrucoes por CMS (baseado no `cms_detectado` no Step 2)

| CMS                         | Instrucao                                                                    |
|-----------------------------|------------------------------------------------------------------------------|
| WordPress sem Elementor     | Plugin "WPCode" (Insert Headers and Footers) > Scripts in Header             |
| WordPress com Elementor     | Elementor > Site Settings > Custom Code > Head, prioridade 1                |
| WordPress edicao direta     | header.php apos `<head>` — apenas em tema filho                              |
| GreatPages                  | Configuracoes da pagina > Codigo personalizado > head                        |
| HotmartPages                | Configuracoes > Codigo de rastreamento > Cabecalho                           |
| Wix                         | Configuracoes > Avancado > Codigo personalizado > head, ordem "First"        |
| HTML estatico               | Primeira linha dentro de `<head>` em todos os HTMLs                          |
| Next.js                     | `_document.js`, strategy `beforeInteractive`                                 |
| React (CRA)                 | `public/index.html`, primeira linha do `<head>`                              |

### 5.1 — O beacon chega ao Worker? (page builder e host alternativo)

O console do `?debug=1` (5.2) mostra o `page_view` **mesmo quando o beacon se perde**: o log e do
navegador, nao do Worker. Conferir o destino antes:

1. **Destino configurado** (autonomo):
   ```bash
   curl -s "https://{dominio}/tracking/web.js?site_id={site_id}" | grep -o '"collect_url":"[^"]*"'
   ```
   `"/collect/event"` com a pagina num host que nao e o das routes → falta o `collect_url` absoluto
   (Step 2) → corrigir o SITE_CONFIG e redeployar antes de seguir.
2. **No navegador do cliente** (F12 > Network, filtro `collect/event`): o `POST` do `page_view` vai
   para o host das routes e responde `200` com `{"status":"ok"}`. Com `collect_url` absoluto vem
   antes um `OPTIONS` (preflight, `204`) — normal. `405`/`404`, ou o `POST` indo para o host do
   builder → mesma causa do item 1.
3. **Host alternativo da plataforma** (so se houver — `infra.md` 0.11b):
   ```bash
   curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "https://{host-alternativo}/"
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://{host-alternativo}/collect/event"
   ```
   Esperado: `301 -> https://{dominio}/` no primeiro. `200` no primeiro e `405` (ou qualquer resposta
   que nao seja a do Worker) no segundo = o site responde num host onde todo beacon morre → aplicar o
   redirect do `infra.md` 0.11b antes de seguir.

### 5.2 Confirmar no browser (apos instalacao)

Instruir o cliente:
> "Agora que o script esta instalado, acesse `{dominio}?debug=1` e abra o console do navegador (F12 > Console). Voce deve ver: `[Tracking] page_view fired - event_id: ...`. Me diga o que aparece."

Apos confirmacao, verificar tabela `events` no D1:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message FROM events WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 20;"
```

Verificar: `status_code` 200 ou 204 para cada plataforma, nenhum `error_message` — **com uma excecao**: a linha `google_ads | web` vem `200` **com** `error_message` comecando por `web: despacho do navegador nao confirmado pelo servidor`. E aviso, nao erro: o Worker nao ve o navegador, entao a conversao de navegador do Google Ads se valida **no navegador** (`.claude/playbooks/google_ads.md`, Step 4), nunca pelo D1. Se algum outro evento falhar, diagnosticar e resolver antes de continuar.

### 5.2a — Solicitar funil de conversao completo

Apos confirmacao do page_view no browser, instruir o cliente a percorrer o funil completo:

> "Otimo! Agora preciso que voce simule o caminho completo de um visitante no seu site — acesse a pagina, preencha o formulario (ou clique no botao de compra), conclua o processo de checkout se houver. Use dados de teste. Me avise quando terminar cada etapa."

Aguardar confirmacao do cliente de que completou o funil.

### 5.2b — Verificar e gravar eventos validados na memoria

Apos o cliente confirmar que completou o funil, consultar o D1 para todos os eventos do site:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message, timestamp FROM events WHERE site_id = '{site_id}' ORDER BY timestamp DESC LIMIT 50;"
```

Com base no resultado, gravar imediatamente no `tracking_memory.md` a secao de validacao:

```markdown
## Validacao Step 5
- data_validacao: {data e hora da consulta}
- eventos_confirmados:
  - {event_name} → {plataformas com status_code 200/204}: OK
  - {event_name com erro} → {plataforma}: ERRO — {error_message}
- status_geral: {OK se todos 200/204 | PARCIAL se algum falhou | ERRO se nenhum chegou}
```

Se algum evento retornou erro: diagnosticar e resolver antes de continuar para o Step 6.

A linha `google_ads | web` com `200` **nao** confirma a conversao (ver 5.1): registrar o Google Ads web
como OK so depois da validacao no navegador do 5.3.

GA4 (1.9.1+): o `page_view` nao tem linha no D1 — registrar como OK pelo Tempo real do GA4 (5.3). A
credencial do MP fica provada pela 1a conversao de navegador do funil (ex.: `begin_checkout` com
`204`); se o funil nao tiver conversao de navegador, ela so se prova na 1a venda.

### 5.3 Validacao visual por plataforma

Delegar para a skill especialista de cada plataforma confirmada:
- Meta Ads → `.claude/playbooks/meta_ads.md` (Events Manager > Testar Eventos)
- GA4 → `.claude/playbooks/ga4.md` (GA4 > Tempo real: o `page_view` vem do navegador desde a 1.9.1; DebugView com `?debug=1`)
- TikTok Ads → `.claude/playbooks/tiktok_ads.md` (Events Manager > Atividade recente)
- Google Ads → `.claude/playbooks/google_ads.md` (Google Tag Assistant ou painel com delay 3h)
- Planilha → `.claude/playbooks/planilha.md` (verificar linha inserida na planilha + D1 com `platform = 'sheets'` — leads chegam com `channel = 'web'`; vendas com `channel = 'webhook'` e `event_name = 'purchase'`)

### 5.3b — Desligar integracoes antigas (ANTES do teste de webhook e do go-live)

Tudo o que ja mandava evento as plataformas continua mandando depois da instalacao, **em paralelo**
com o VT — e conta em dobro. No GA4 a receita duplica (o outro emissor manda o proprio
`transaction_id`, e o GA4 nao deduplica); na Meta e no TikTok so ha dedup com o mesmo `event_id`, que
o emissor antigo nao tem; no Google Ads o lance passa a contar a venda duas vezes. Por isso o
checklist roda **aqui**, antes do teste de webhook (5.4) e antes de subir campanha — nao so na
entrega. Passar item a item ao cliente, esperar a resposta de cada um e gravar no `tracking_memory.md`
(`integracoes_antigas: {item}: desligado | nao tinha | pendente`). Os itens de gateway so valem para
infoproduto.

Onde o caminho exato do painel nao esta escrito abaixo, ele muda de gateway para gateway (e de versao
da interface): descreva **o que procurar**, nao invente menu.

| Desligar | O que procurar | Como confirmar que saiu |
|---|---|---|
| **Integracao GA4 nativa do gateway** | No painel do gateway, na area de integracoes, pixels ou rastreamento (da conta e de cada produto/oferta): um campo com um ID `G-...` ou a opcao Google Analytics/GA4 | No GA4, toda compra tem `transaction_id` = o `order_id` do gateway e valor = o que o cliente pagou (e o que o VT envia). Transacao com **ID diferente** do `order_id` (um codigo curto, por exemplo) ou **valor = comissao** do produtor = outro emissor ainda ligado |
| **Tags GA4 de evento/compra no GTM** | No container do GTM do site: tags de evento do GA4 (`purchase`, `begin_checkout`, `generate_lead`...) e a tag do Google com o mesmo `G-` mandando `page_view`. Pausar/remover e **publicar** o container — sem publicar, nada muda no site | No navegador (DevTools > Network, filtro `collect`): nenhuma requisicao a `*.google-analytics.com/g/collect` saindo direto da pagina. O gtag do VT manda pelo proprio dominio (`/g/collect`); hit direto para o Google = outra tag GA4 ativa |
| **Webhooks antigos de servidor** (Stape, sGTM ou outro) ainda no painel do gateway | Na mesma tela de webhooks da tabela abaixo: toda URL de **rastreamento** que nao seja a do VT (`https://{dominio}/collect/webhook/{gateway}`) — dominio `stape.io`, subdominio de servidor de tags do proprio site, servico de "CAPI"/conversao. Webhook de area de membros, CRM ou e-mail marketing **fica** | A lista do painel so tem, para rastreamento, a URL do VT. E no GA4/Meta a compra de teste nao aparece durante o `shadow` (prova cruzada abaixo) |
| **Meta** | Pixel colado no `<head>`, plugin (PixelYourSite, Pixel Cat, Facebook for WordPress), tag da Meta no GTM, integracao do gateway com o pixel ou com a API de Conversoes, "Deteccao automatica de eventos" (`.claude/references/disable-auto-tracking.md`) | No Gerenciador de Eventos do pixel, abrir o `Purchase` e o `PageView` e ver **de onde** chegam: devem sobrar o navegador (o pixel que o VT carrega) e o servidor do VT, deduplicados pelo mesmo `event_id`. Outra fonte — integracao de parceiro (o gateway) ou um segundo servidor — = emissor antigo. Compras do dia ≈ vendas aprovadas no gateway, nao o dobro |
| **TikTok** | Pixel colado no `<head>`, plugin TikTok for Business, tag do TikTok no GTM, integracao do gateway com o pixel | No Events Manager do TikTok, os eventos chegam so pelo pixel do VT e pela Events API do VT, deduplicados; compras do dia ≈ vendas aprovadas |
| **Google Ads** | Tag de conversao de compra no site ou no GTM (`gtag` com `send_to: 'AW-.../...'` de compra), integracao do gateway com o Google Ads, acao de compra importada do GA4 | Em Metas (na UI antiga, Objetivos) > Conversoes: as acoes de compra que **recebem** conversao. Se, alem da acao de importacao do VT (`conversion_action_id_purchase`), outra acao de compra recebe conversao como **principal**, o lance conta a venda duas vezes — avisar o cliente; quem decide qual fica principal e ele, no painel |

**Prova cruzada no teste do 5.4.** Com o `shadow` ligado o VT **nao envia** compra a nenhuma plataforma.
Se o teste for uma **compra de teste de verdade** (nao so a simulacao do webhook) e ela aparecer no
GA4 (Tempo real, evento `purchase`), na Meta, no TikTok ou no Google Ads, quem mandou foi um emissor
antigo — voltar a tabela antes do go-live.

**Oferta — venda sem visita no GA4 (`platforms.ga4.unattributed_purchases`).** So com GA4 confirmado
e **depois** de o checklist acima confirmar que **nao ha outro emissor de purchase no GA4** (as tres
primeiras linhas): com outro emissor ligado, a receita conta em dobro. Perguntar:

> "Algumas vendas chegam sem uma visita identificada no site — link de checkout antigo ou salvo,
> venda feita pelo agente de vendas do gateway, comprador que nunca passou pelo site. Hoje elas nao
> entram no GA4, e a receita do GA4 fica abaixo da do gateway. Posso fazer essas vendas entrarem na
> receita do GA4, mas **sem atribuicao**: elas aparecem sem campanha nem origem ('(not set)'). Quer que
> eu ligue?"

- **Sim** → `"unattributed_purchases": true` em `platforms.ga4` no `SITE_CONFIG`, no mesmo deploy do
  5.4.1. Gravar `ga4_unattributed_purchases: sim`.
- **Nao, ou sem resposta** → **nao liga** (fica o `false` do `config.example.json`). Gravar `nao`.
- O que o recurso faz e como aparece no D1: `.claude/playbooks/ga4.md`, "Venda sem visita".

---

### Webhooks de gateway — apenas se modelo for infoproduto

> Para um gateway nao listado abaixo (ou com parser incompleto), invocar `.claude/skills/new-gateway/SKILL.md` antes de continuar.

> **Setup correto no painel (evento/formato/versao/tipo):** ao instruir o cliente, seguir
> `.claude/references/gateway-webhooks.md` — ele diz **qual evento marcar** (so o de compra aprovada,
> para nao poluir o `webhook_raw`), em **JSON**, e a **versao/variante** que o parser entende (ex.:
> Ticto = evento "Venda Realizada", v2, JSON, "Enviar Order Bump | Combo junto com a oferta
> principal"). Evento/versao/formato errado = compra nao parseada = venda perdida.

> 🛑 **Ligar o `shadow` ANTES de passar a URL ao cliente (5.4.1).** O webhook de teste do gateway
> chega como compra aprovada e, sem o `shadow`, sai como `Purchase` real para todas as plataformas — na
> Meta nao ha como apagar. O cliente pode disparar o teste no mesmo minuto em que salva a URL.

Instruir o cliente a configurar a URL de webhook no painel do gateway detectado:

| Gateway    | Onde configurar              | URL do webhook                                     |
|------------|------------------------------|----------------------------------------------------|
| Hotmart    | Ferramentas > Webhooks       | `https://{dominio}/collect/webhook/hotmart`        |
| Kiwify     | Configuracoes > Webhooks     | `https://{dominio}/collect/webhook/kiwify`         |
| Kirvano    | Integracoes > Webhooks       | `https://{dominio}/collect/webhook/kirvano`        |
| Lastlink   | Configuracoes > Notificacoes | `https://{dominio}/collect/webhook/lastlink`       |
| Ticto      | Integracoes > Webhook        | `https://{dominio}/collect/webhook/ticto`          |
| Eduzz      | Ferramentas > Postback       | `https://{dominio}/collect/webhook/eduzz`          |
| PerfectPay | Configuracoes > Webhook      | `https://{dominio}/collect/webhook/perfectpay`     |
| PagTrust   | Configuracoes > Integracao   | `https://{dominio}/collect/webhook/pagtrust`       |
| Payt       | Configuracoes > Webhook      | `https://{dominio}/collect/webhook/payt`           |
| Green      | Configuracoes > Webhooks     | `https://{dominio}/collect/webhook/green`          |
| Tutory     | Configuracoes > Webhooks     | `https://{dominio}/collect/webhook/tutory`         |

### 5.4 Validacao de webhooks (apenas infoproduto)

O parser **nao distingue teste de venda**: a simulacao do painel e a compra de teste chegam como compra
aprovada, e o Worker despacha `Purchase` para todas as plataformas. Caso real: o teste da Kiwify
(`johndoe@example.com`, "Example product", R$ 42,50) virou `Purchase` em todos os pixels e
plataformas configurados no dia da instalacao — venda fantasma no aprendizado das campanhas, sem remocao possivel na Meta. Por
isso o teste roda **sempre** sob `purchase_dispatch: "shadow"`, nesta ordem: **ligar → testar →
conferir → desligar → conferir que desligou**.

**5.4.1 — Ligar o `shadow` (antes de passar a URL do webhook)**

Na **raiz** do `SITE_CONFIG` no `wrangler.toml` — ao lado de `site_id`, nao dentro de `platforms`:

```jsonc
"purchase_dispatch": "shadow"
```

```bash
npx wrangler deploy
```

Com a chave, o webhook roda o pipeline inteiro (grava o `webhook_raw`, aprova, parseia, deduplica) e
cada envio que **teria** acontecido vira uma linha no `events` com `status_code = 0` e `error_message`
comecando com `shadow_mode` — nada sai para Meta, TikTok, GA4 nem Google Ads, e a planilha de vendas
nao recebe linha. O `shadow` so pausa o despacho do **webhook**: os eventos do navegador (`page_view`,
`lead`, `initiate_checkout`) seguem normais. Gravar `shadow_ligado_em: {data e hora}` no
`tracking_memory.md`.

> **Janela curta.** O `shadow` vale para o site inteiro: uma venda **real** que cair enquanto ele esta
> ligado tambem fica retida, e nao volta sozinha (o pedido fica `processed = 1` e o reenvio do gateway
> cai no dedup). Ligar, testar e desligar na mesma sessao.

**5.4.2 — Testar**

So agora passar a URL (tabela acima) e pedir o teste: compra de teste ou simulacao de webhook do
gateway, quando disponivel. Com o `shadow` no ar, os dois sao seguros.

**5.4.3 — Conferir**

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT gateway, order_id, processed, error FROM webhook_raw WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 5;"
npx wrangler d1 execute tracking_db --remote --command "SELECT platform, event_name, status_code, error_message FROM events WHERE site_id = '{site_id}' AND channel = 'webhook' AND platform <> 'fdv' ORDER BY id DESC LIMIT 10;"
```

**Criterios de sucesso:**
- `webhook_raw`: `processed = 1` e `error = null` — webhook recebido, aprovado e parseado; `order_id`
  preenchido — o parser extraiu o identificador da compra
- `events`: uma linha por destino do baseline (cada pixel Meta, TikTok, GA4, Google Ads), **todas** com
  `status_code = 0` + `shadow_mode` — e o que teria saido. Destino faltando = nao esta no config
- **Qualquer `200`/`204` nessa consulta = o `shadow` nao estava no ar e o teste foi despachado.**
  (A linha `platform = 'fdv'` e o log do merge por IP, nao envio — por isso fica fora da consulta.)
  Registrar como venda de teste despachada (`audit-tracking`, secao 2.7) e conferir o deploy do 5.4.1
  antes de repetir o teste

**Diagnostico por resultado:**

| `processed` | `order_id` | Causa provavel |
|---|---|---|
| `0` | preenchido | Evento de aprovacao filtrado — verificar se o gateway estava em modo de teste ou se o evento enviado nao era uma compra aprovada |
| `0` | `null` | Parser nao extraiu order_id — revisar o path do order_id no parser com o payload real |
| Linha ausente | — | Webhook nao chegou ao Worker — verificar URL configurada no painel do gateway e se o dominio esta correto |

Se `processed = 0` com `order_id` preenchido e o evento era uma compra real aprovada, verificar a tabela `events` para detalhes do erro por plataforma:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, status_code, error_message FROM events WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 10;"
```

**5.4.4 — Desligar (antes do go-live)**

**So depois do ultimo teste de compra do Step 5** — o 5.5.2 usa a mesma compra de teste (a linha
`meta_ads` dela existe sob `shadow`, com o `marca_user`): fazer o 5.5 e voltar aqui. **Remover** a chave
`purchase_dispatch` do `SITE_CONFIG` (remover, nao trocar o valor) e:

```bash
npx wrangler deploy
```

Gravar `shadow_desligado_em: {data e hora}` no `tracking_memory.md`. **Depois de desligar, nenhum teste
novo:** reenviar o **mesmo** teste nao despacha (o `order_id` dele ja esta `processed = 1` e cai no
dedup), mas um teste com outro `order_id` vira venda real. Nunca chegar ao Step 6 com a chave no config.

**5.4.5 — Conferir que desligou**

```bash
# 1. imediato: a chave saiu do config que foi deployado? (nenhuma linha = saiu)
grep -n "purchase_dispatch" wrangler.toml

# 2. prova no ar, na primeira venda real depois do deploy: 200/204 por destino e nenhum shadow_mode
npx wrangler d1 execute tracking_db --remote --command "SELECT platform, event_name, status_code, error_message, timestamp FROM events WHERE site_id = '{site_id}' AND channel = 'webhook' ORDER BY id DESC LIMIT 10;"
```

A saida do `wrangler deploy` **nao** serve de prova: ela trunca o valor do `SITE_CONFIG`. Venda real com
`shadow_mode` depois do `shadow_desligado_em` = o deploy nao pegou — refazer o 5.4.4 na hora (cada venda
nessa condicao fica fora das plataformas). Sem venda real ate a entrega, registrar a checagem 2 como
pendente no `tracking_memory.md` (`shadow_conferido_na_venda_real: pendente`); o `audit-tracking` (2.7)
pega o `shadow` esquecido.

### 5.5 Validacao E2E do caminho do `marca_user`

Ramo extra do Step 5, **so infoproduto** (com checkout). Prova que o `marca_user` foi gerado,
propagado e chegou ao webhook — antes de uma compra real revelar o elo quebrado. **Essencial em
`tipo_site: spa`** (o caminho novo do quiz), util em qualquer infoproduto.

**5.5.1 — Pedir as URLs reais visitadas** (copiar da barra de enderecos, com tudo apos o `?`):

> "Para validar o funil inteiro, me envie duas URLs, copiadas da barra de enderecos:
> 1. **Pagina inicial** — depois que o site terminar de carregar.
> 2. **Checkout** — depois de clicar em comprar."

**5.5.2 — Validacao cruzada (o agente executa):**

1. **URL inicial contem o `indexador` do gateway?** (consultar `gateways_config[gw].indexador` — ex.:
   `marca_user` na Lastlink — devolvido no webhook via `Data.Purchase.OriginUrl` —, `xcod` na Hotmart).
   Ausente → a reescrita de URL do VT nao rodou:
   - Em `tipo_site: spa`/`misto`: confirmar que a URL testada casa uma `spa_mode.locations[].match`
     (slug/subdominio certo) e que o gateway daquela location (`location.gateways`) e o esperado.
   - Checar CSP/bloqueio do script, ou `disable_url_rewrite` ligado indevidamente.
2. **URL do checkout contem o MESMO indexador com o MESMO valor?** Comparar string-a-string. Diferente
   ou ausente → o site quebrou a propagacao (a SPA nao copiou `window.location.search`, ou a UTMify
   nao esta com as flags — ver `utmify-compat.md`).
3. **`marca_user` no D1 bate com a URL inicial?**
   ```bash
   npx wrangler d1 execute tracking_db --remote --command "SELECT marca_user, MAX(timestamp) FROM events WHERE site_id = '{site_id}' AND event_name = 'page_view' ORDER BY id DESC LIMIT 1;"
   ```
   Comparar com o valor do indexador da URL inicial — devem ser identicos.
4. **Webhook (se houve compra de teste) bate com o mesmo valor?**
   ```bash
   npx wrangler d1 execute tracking_db --remote --command "SELECT marca_user FROM events WHERE site_id = '{site_id}' AND event_name = 'Purchase' AND platform = 'meta_ads' ORDER BY id DESC LIMIT 1;"
   ```
   Igual ao inicial → ciclo completo. Gravar as URLs em `urls_validacao_e2e` no `tracking_memory.md`.

**5.5.3 — Reportar em linguagem simples:**

```
✓ marca_user gerado na pagina inicial: 1778161...
✓ marca_user propagado para o checkout: 1778161... (igual ao inicial)
✓ Webhook recebido com marca_user correto
Tracking do funil 100% validado.
```

Se algum passo falhar, apontar o que olhar (script no head? spa_mode desligado? UTMify sem flags?
site reescreve a URL apos o load?).

---

## Step 6 — Entrega e resumo

**Tom:** breve, objetivo, focado no que o cliente ganha. Sem jargao tecnico.

**NAO mencionar:** Cloudflare, Worker, D1, Wrangler, CAPI, Measurement Protocol, SHA-256, event_id, marca_user, endpoints, beacon.

**Antes da entrega — oferta de auditoria (recomendado):**

Apos validar o funil (Step 5), oferecer uma verificacao final antes de fechar:

> "Antes de fechar, posso rodar uma verificacao rapida pra confirmar que cada evento esta sendo capturado e enviado certo? (S) sim / (N) pode entregar assim"

Se **S**: carregar `.claude/skills/audit-tracking/SKILL.md`. O Step 0 da auditoria reaproveita o `tracking_memory` e os dados ja validados no Step 5 — nao repete perguntas ja respondidas no setup. Se **N**: seguir direto para a entrega abaixo. A mensagem final ao cliente continua terminando com o fecho obrigatorio (seguir o @estruturamais + print na DM).

**Fonte dos dados para a mensagem:** usar `tracking_memory.md` — especificamente as secoes de plataformas confirmadas, eventos confirmados e `Validacao Step 5`. Nao raspar arquivos de config para montar a entrega; a memoria e a fonte canonica do que foi configurado e validado.

**Estrutura da mensagem de entrega — tres blocos, nesta ordem.** O terceiro e **passo obrigatorio
antes de subir campanha**, nao um aviso no rodape: o cliente le rapido e nao desliga. Os itens dele
saem do checklist do 5.3b (`integracoes_antigas` no `tracking_memory.md`): o que ficou `pendente` la
vai marcado como pendente aqui.

> **✅ TRACKING ATIVO**
>
> Seu tracking esta configurado e funcionando. Um script leve no seu site coleta os dados de forma
> segura e os envia para um servidor no seu proprio dominio.
>
> - **Plataformas recebendo os dados:** {plataforma}: {descricao simples, ex: "Meta Ads: recebe todos os eventos para otimizar seus anuncios"}
> - **O que sera rastreado:**
>   - Visualizacao de pagina — toda vez que alguem acessa seu site
>   - {evento 2 em linguagem simples, ex: "Envio de formulario — quando alguem preenche e envia o formulario de contato"}
>   - {evento 3, ex: "Clique no WhatsApp — quando alguem clica para te chamar no WhatsApp"}
> - **Paginas com o script:** {quantas e quais, das instaladas no Step 5}
> - **Vendas recebidas de:** {gateway(s) com o aviso de venda configurado} *(so infoproduto)*
>
> **⚠️ ONDE O TRACKING FUNCIONA (E ONDE NAO FUNCIONA)**
>
> - ✓ **Funciona** nas paginas onde o script foi colocado no `<head>`: {lista}.
> - ✗ **NAO funciona** em pagina sem o script — landing nova, outro dominio, pagina feita em outro
>   construtor. Toda pagina nova precisa receber o script, senao fica sem tracking sem avisar.
> - ✓ **Funciona** para compras pela {gateway(s)}. *(so infoproduto)*
> - ✗ **NAO funciona** para vendas em outro gateway, ou numa conta nova do mesmo gateway, ate o aviso
>   de venda dela ser configurado — me chame antes de comecar a vender por la. *(so infoproduto)*
>
> **🚫 OBRIGATORIO — DESLIGAR INTEGRACOES ANTIGAS**
>
> Tudo o que ja mandava evento para as plataformas continua mandando, em paralelo com o novo
> tracking: as compras contam em dobro e a otimizacao das campanhas piora. Antes de subir campanha,
> confirme que esta tudo desligado:
>
> - [ ] Pixels colados direto no site (codigo da Meta, do TikTok, `gtag` de conversao do Google Ads ou do Google Analytics)
> - [ ] Plugins de pixel (PixelYourSite, Pixel Cat, Facebook for WordPress, TikTok for Business, qualquer plugin com "pixel" ou "conversions" no nome)
> - [ ] Tags de conversao e de compra no Google Tag Manager (Google Analytics, Meta, TikTok, Google Ads) — o GTM pode ficar para outros usos
> - [ ] Integracao nativa do gateway com Meta, TikTok, Google Analytics ou Google Ads
> - [ ] Avisos de venda (webhooks) antigos de rastreamento no painel do gateway — Stape, servidor de tags ou outro *(so infoproduto)*
> {itens `pendente` no 5.3b: "⏳ ainda pendente: {item}"}
>
> Qualquer um desses ainda ativo dispara o evento de novo. Quando desligar, me avise que eu confiro
> nas plataformas que so o novo tracking esta enviando.
>
> Voce pode subir sua campanha. Os dados aparecem em cada plataforma em poucos minutos (Meta e
> TikTok) ou ate 24h (Google Ads).

---

**Para finalizar — siga e mande um print 💜**

O **Verdadeiro Trackeamento** foi criado pelo perfil [@estruturamais](https://instagram.com/estruturamais). Para fechar: **siga o @estruturamais no Instagram** e **mande um print desta mensagem na DM do perfil** — assim confirmamos que a sua instalacao ficou pronta e voce recebe suporte e novidades no que precisar.

---

**Apos a mensagem para o cliente, exibir bloco de referencia tecnica (para o operador):**

---

### Referencia tecnica da configuracao

**Dominio trackeado:** `{dominio}`
**Script instalado em:** todas as paginas de `{dominio}` onde o `<script src="https://{dominio}/tracking/web.js">` foi adicionado ao `<head>`

**Plataformas configuradas, eventos e canal de envio:**

| Plataforma | Eventos configurados | Canal de envio |
|---|---|---|
| Meta Ads | {lista de eventos canonicos, ex: page_view, lead, purchase} | Web (pixel) + Servidor (CAPI) |
| TikTok Ads | {eventos} | Web (pixel) + Servidor (Events API) |
| Google Analytics 4 | {eventos} | Web (gtag, pelo proxy `/g/collect`) para o `page_view` + Servidor (Measurement Protocol) para as conversoes e a compra |
| Google Ads | {eventos} | Web (gtag) para eventos de navegador + Servidor (Data Manager API) para a compra |
| Google Sheets | lead e/ou compra aprovada (venda) | Servidor |

Incluir apenas as plataformas confirmadas no Step 1. Canal de envio e fixo por plataforma — nao
variar. **Google Ads e GA4 usam os dois canais ao mesmo tempo**, e nao ha duplicidade: no Google Ads
sao acoes de conversao diferentes (as de navegador por rotulo, a compra por id numerico da acao de
importacao); no GA4 cada evento sai por um canal so (`page_view` pelo navegador desde a 1.9.1,
conversoes e compra pelo servidor).

**Pre-requisitos para o tracking continuar funcionando:**
- O script `<script src="https://{dominio}/tracking/web.js">` deve permanecer como **primeiro elemento do `<head>`** em todas as paginas. Remover ou mover o script interrompe o tracking imediatamente.
- O dominio deve permanecer **apontado para a Cloudflare** (nameservers ou CNAME configurado). Migrar o DNS sem migrar o Worker derruba o tracking.
- O Worker nao tem custo dentro do plano gratuito (100k requisicoes/dia). Nao e necessario renovar — funciona indefinidamente.

**Sobre a cobertura do tracking:**
O tracking funciona automaticamente em todas as paginas com o script instalado, desde que os elementos da pagina sigam os mesmos padroes detectados no Step 2: mesmos seletores de formulario, mesmo padrao de links de checkout para o gateway, e mesmas URLs ou titulos de paginas de obrigado. Paginas com estrutura diferente precisam de mapeamento adicional.

**Manutencao do banco de dados:**
A retencao automatica esta ativa (cron diario as 03:00 UTC, modo `auto_clean` — o padrao). Sao removidos automaticamente os eventos com mais de **7 dias** (`events`), os webhooks com mais de **14 dias** (`webhook_raw`) e os dados de visitante nao atualizados ha mais de **90 dias** (`user_store`). Para guardar o historico existe o modo `keep_all`, em que a limpeza de rotina nao roda — exige plano pago da Cloudflare e e escolhido na pergunta de retencao do `workflow.md`. Para verificar o volume atual do banco:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) as eventos FROM events; SELECT COUNT(*) as webhooks FROM webhook_raw;"
```

Se necessario apagar manualmente dados antigos (ex: banco proximo do limite), usar sempre as colunas de data — nunca o `id`:

```bash
# Apagar eventos com mais de X dias
npx wrangler d1 execute tracking_db --remote --command "DELETE FROM events WHERE timestamp < datetime('now', '-{X} days');"

# Apagar webhooks com mais de X dias
npx wrangler d1 execute tracking_db --remote --command "DELETE FROM webhook_raw WHERE timestamp < datetime('now', '-{X} days');"
```

---

## Regras gerais durante o workflow

As 10 regras gerais do workflow estao em `.claude/workflow.md`. Seguir sempre.

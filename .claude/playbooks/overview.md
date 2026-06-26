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
- `tiktok_pixel_id`, `google_ads_conversion_id`
- `google_ads_label_contact`, `google_ads_label_lead`
- `triggers`, `cookies`, `geolocation`, `gateways_config`, `custom_data`, `collect_url`

### Mapeamento canonico de eventos

| Evento canonico   | Meta             | TikTok           | GA4            | Google Ads |
|-------------------|------------------|------------------|----------------|------------|
| page_view         | PageView         | Pageview         | page_view      | — (null)   |
| contact           | Contact          | Contact          | contact        | contact    |
| lead              | Lead             | SubmitForm       | generate_lead  | lead       |
| initiate_checkout | InitiateCheckout | InitiateCheckout | begin_checkout | — (null)   |
| purchase          | Purchase         | Purchase         | purchase       | purchase   |

`page_view` e `initiate_checkout` nao enviam para Google Ads.

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
> **E** — Planilha Google Sheets (para salvar leads automaticamente)
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

### WhatsApp
Links contendo `wa.me` ou `api.whatsapp.com`

### Paginas de obrigado
URL ou titulo contendo: "obrigado", "thankyou", "confirmacao", "sucesso"

### Scripts conflitantes
Detectar inicializacoes preexistentes de: `fbq(`, `ttq.`, `gtag(`, `dataLayer.push`
Se detectados: **alertar o cliente e orientar remocao ANTES de continuar.** Scripts conflitantes causam dupla contagem.

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
| Secretos  | access_token (Meta), api_secret (GA4)             | `npx wrangler secret put`        |

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
- Omitir `pixel_ids_mirror` se o cliente usar apenas um pixel Meta
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

```bash
# Meta Ads (sempre que Meta confirmado)
# Um unico token cobre o pixel primario e todos os espelhos via fallback
echo "{access_token}" | npx wrangler secret put META_ACCESS_TOKEN

# GA4 (apenas se GA4 confirmado)
echo "{api_secret}" | npx wrangler secret put GA4_API_SECRET
```

> **TikTok:** nao usar `wrangler secret put` para o access_token do TikTok — ele ja foi incluido no config JSON no passo 1 (excecao de arquitetura: o codigo nao le de env).

Usar `echo | wrangler secret put` para evitar que o valor fique no historico do shell. Nunca exibir o valor do secret em mensagem de chat.

### 4. Re-deploy apos secrets

```bash
npx wrangler deploy
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
```

Interpretar resultado:
- 1a linha `/*! Verdadeiro Trackeamento vX.Y.Z | @estruturamais | https://instagram.com/estruturamais */` → script servido OK; anotar a versao
- `var __CONFIG__={"site_id":"{site_id}","vt_version":"X.Y.Z","meta_pixel_id":...}` com campos corretos → config OK
- `__CONFIG__={}` ou campo de plataforma ausente → problema de config; diagnosticar com `.claude/references/site-config-format.md` antes de continuar
- Erro de conexao (curl falha) → Worker nao esta acessivel; executar `npx wrangler deployments list` e re-deploy se necessario

### 4.2 Verificar tabela events no D1

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message FROM events WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 20;"
```

Resultado esperado para `page_view` com Meta + GA4:
```
page_view | collect            | web | browser | 200 |
PageView  | meta_ads           | web | collect | 200 |
page_view | google_analytics_4 | web | collect | 204 |
```

**IMPORTANTE:** GA4 Measurement Protocol retorna **204** como sucesso — NAO tratar 204 como erro.

Se `status_code = 0` com `error_message` preenchido: exibir o erro em linguagem simples e resolver antes de continuar.

Se a tabela `events` estiver vazia: normal nesta etapa — o script ainda nao esta instalado no site. Os eventos aparacerao apos o Step 5.

### 4.3 Criterios de sucesso desta etapa
- curl retorna `__CONFIG__` com todos os campos das plataformas confirmadas
- Worker acessivel (sem erro de conexao)

> Validacao visual por plataforma e feita no Step 5, apos instalacao do script.

---

## Step 5 — Instalacao do script no site

**O script:**
```html
<script src="https://{dominio}/tracking/web.js"></script>
```

Deve ser o **primeiro elemento do `<head>`**, antes de qualquer outro script.

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

### 5.2 Confirmar no browser (apos instalacao)

Instruir o cliente:
> "Agora que o script esta instalado, acesse `{dominio}?debug=1` e abra o console do navegador (F12 > Console). Voce deve ver: `[Tracking] page_view fired - event_id: ...`. Me diga o que aparece."

Apos confirmacao, verificar tabela `events` no D1:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message FROM events WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 20;"
```

Verificar: `status_code` 200 ou 204 para cada plataforma, nenhum `error_message`. Se algum evento falhar, diagnosticar e resolver antes de continuar.

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

### 5.3 Validacao visual por plataforma

Delegar para a skill especialista de cada plataforma confirmada:
- Meta Ads → `.claude/playbooks/meta_ads.md` (Events Manager > Testar Eventos)
- GA4 → `.claude/playbooks/ga4.md` (GA4 > DebugView)
- TikTok Ads → `.claude/playbooks/tiktok_ads.md` (Events Manager > Atividade recente)
- Google Ads → `.claude/playbooks/google_ads.md` (Google Tag Assistant ou painel com delay 3h)
- Planilha → `.claude/playbooks/planilha.md` (verificar linha inserida na planilha + D1 com `platform = 'sheets'`)

---

### Webhooks de gateway — apenas se modelo for infoproduto

> Para gateways com parser incompleto (ticto, eduzz, perfectpay, payt) ou para um gateway nao listado abaixo, invocar `.claude/skills/new-gateway/SKILL.md` antes de continuar.

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

### 5.4 Validacao de webhooks (apenas infoproduto)

Apos o cliente configurar a URL de webhook no painel do gateway e realizar uma compra de teste (ou usar a simulacao de webhook do gateway, quando disponivel), verificar no D1:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT gateway, order_id, processed, error FROM webhook_raw WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 5;"
```

**Criterios de sucesso:**
- `processed = 1` e `error = null`: webhook recebido, validado e eventos disparados para as plataformas
- `order_id` preenchido: parser do gateway extraiu o identificador da compra corretamente

**Diagnostico por resultado:**

| `processed` | `order_id` | Causa provavel |
|---|---|---|
| `0` | preenchido | Evento de aprovacao filtrado — verificar se o gateway estava em modo de teste ou se o evento enviado nao era uma compra aprovada |
| `0` | `null` | Parser nao extraiu order_id — gateway skeleton (eduzz, ticto, perfectpay, payt) ainda nao tem parser completo |
| Linha ausente | — | Webhook nao chegou ao Worker — verificar URL configurada no painel do gateway e se o dominio esta correto |

Se `processed = 0` com `order_id` preenchido e o evento era uma compra real aprovada, verificar a tabela `events` para detalhes do erro por plataforma:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, status_code, error_message FROM events WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 10;"
```

---

## Step 6 — Entrega e resumo

**Tom:** breve, objetivo, focado no que o cliente ganha. Sem jargao tecnico.

**NAO mencionar:** Cloudflare, Worker, D1, Wrangler, CAPI, Measurement Protocol, SHA-256, event_id, marca_user, endpoints, beacon.

**Antes da entrega — oferta de auditoria (recomendado):**

Apos validar o funil (Step 5), oferecer uma verificacao final antes de fechar:

> "Antes de fechar, posso rodar uma verificacao rapida pra confirmar que cada evento esta sendo capturado e enviado certo? (S) sim / (N) pode entregar assim"

Se **S**: carregar `.claude/skills/audit-tracking/SKILL.md`. O Step 0 da auditoria reaproveita o `tracking_memory` e os dados ja validados no Step 5 — nao repete perguntas ja respondidas no setup. Se **N**: seguir direto para a entrega abaixo. A mensagem final ao cliente continua terminando com o fecho obrigatorio (seguir o @estruturamais + print na DM).

**Fonte dos dados para a mensagem:** usar `tracking_memory.md` — especificamente as secoes de plataformas confirmadas, eventos confirmados e `Validacao Step 5`. Nao raspar arquivos de config para montar a entrega; a memoria e a fonte canonica do que foi configurado e validado.

**Estrutura da mensagem de entrega:**

> Seu tracking esta configurado e funcionando.
>
> **O que foi instalado:**
> Um script leve no seu site que coleta dados de forma segura e os envia para um servidor no seu proprio dominio.
>
> **O que sera rastreado:**
> - Visualizacao de pagina — toda vez que alguem acessa seu site
> - {evento 2 em linguagem simples, ex: "Envio de formulario — quando alguem preenche e envia o formulario de contato"}
> - {evento 3, ex: "Clique no WhatsApp — quando alguem clica para te chamar no WhatsApp"}
>
> **Plataformas recebendo os dados:**
> - {plataforma}: {descricao simples, ex: "Meta Ads: recebe todos os eventos para otimizar seus anuncios"}
>
> Voce pode subir sua campanha normalmente. Os dados aparecem em cada plataforma em poucos minutos (Meta e TikTok) ou ate 24h (Google Ads).

---

**⚠️ Importante — Remover integracoes antigas:**

Para evitar eventos duplicados que prejudicam a otimizacao das campanhas, remova do site e das ferramentas:

- **Pixels instalados via `<script>` no site**: Meta Pixel base code, TikTok Pixel base code
- **Plugins de tracking** (WordPress ou construtores): PixelYourSite, Pixel Cat, Facebook for WordPress, TikTok for Business, qualquer plugin com "pixel" ou "conversions" no nome
- **Tags de conversao no Google Tag Manager** para Meta, TikTok ou Google Ads — se usar GTM para outros fins, manter, mas remover as tags de evento de conversao
- **Integracoes nativas dos gateways com Meta/TikTok**: dentro do painel Hotmart, Kiwify etc., desativar integracao direta com pixel se houver

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
| Google Analytics 4 | {eventos} | Servidor (Measurement Protocol) |
| Google Ads | {eventos} | Web (gtag) |
| Google Sheets | lead | Servidor |

Incluir apenas as plataformas confirmadas no Step 1. Canal de envio e fixo por plataforma — nao variar.

**Pre-requisitos para o tracking continuar funcionando:**
- O script `<script src="https://{dominio}/tracking/web.js">` deve permanecer como **primeiro elemento do `<head>`** em todas as paginas. Remover ou mover o script interrompe o tracking imediatamente.
- O dominio deve permanecer **apontado para a Cloudflare** (nameservers ou CNAME configurado). Migrar o DNS sem migrar o Worker derruba o tracking.
- O Worker nao tem custo dentro do plano gratuito (100k requisicoes/dia). Nao e necessario renovar — funciona indefinidamente.

**Sobre a cobertura do tracking:**
O tracking funciona automaticamente em todas as paginas com o script instalado, desde que os elementos da pagina sigam os mesmos padroes detectados no Step 2: mesmos seletores de formulario, mesmo padrao de links de checkout para o gateway, e mesmas URLs ou titulos de paginas de obrigado. Paginas com estrutura diferente precisam de mapeamento adicional.

**Manutencao do banco de dados:**
A retencao automatica esta ativa (cron diario as 03:00 UTC). Dados com mais de 30 dias sao removidos automaticamente das tabelas de eventos e webhooks. Para verificar o volume atual do banco:

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

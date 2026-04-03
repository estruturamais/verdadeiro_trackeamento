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
  → getUserStore → fdvMerge (enriquece com dados do user_store SE marca_user presente; sem xcod/sck o evento e enviado com PII do webhook)
  → hashPII → Promise.allSettled([meta, tiktok, ga4, gads])
```

### marca_user
Cookie first-party HttpOnly, SameSite=Lax, Secure, max-age=63072000 (2 anos). Setado pelo Worker via `Set-Cookie` na resposta do beacon e do `web.js`. Identifica o usuario entre sessoes. Todos os eventos carregam `marca_user` no payload.

### event_id
Formato: `timestamp_ms + '-' + UUID` (ex: `1712000000000-550e8400-e29b-41d4-a716`). Gerado pelo browser. Usado para deduplicacao browser/CAPI no Meta e TikTok: mesmo `event_id` no `fbq()` e no payload CAPI — a plataforma conta apenas uma vez. Webhooks de gateway nao tem `event_id` (origin server-only).

### Mecanismo de config (CRITICO)
O sistema le config via `env.SITE_CONFIG` (JSON string na secao `[vars]` do `wrangler.toml`), com fallback para `env.CONFIG_KV`. **Nao existe tabela `site_config` no D1.** Nunca referenciar `site_config` D1.

Campos `clientConfig` expostos ao browser (sem secrets), extraidos de `serve-webjs.js`:
- `site_id`, `google_ads_channel`, `debug`, `ga4_measurement_id`
- `meta_pixel_id`, `meta_pixel_id_purchase`, `meta_purchase_trigger_event`
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

Pergunta unica cobrindo todas as plataformas:

> "Voce usa alguma dessas plataformas? Pode marcar todas que usar:
> - Meta Ads (Facebook / Instagram Ads)
> - TikTok Ads
> - Google Ads
> - Google Analytics 4 (GA4)"

Se Meta Ads confirmado, fazer follow-up:
> "Voce usa um pixel separado so para rastrear compras (pixel de vendas)? Se nao sabe, pode dizer nao."

Apos resposta:
- Registrar plataformas confirmadas no `tracking_memory.md`
- Registrar dual-pixel (sim/nao) no `tracking_memory.md`
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

### Links de checkout (dominios dos 9 gateways, de `src/web/web-template.txt`)

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

Delegar coleta para a skill especialista de cada plataforma confirmada:
- Meta Ads → `.claude/skills/meta.md`
- TikTok Ads → `.claude/skills/tiktok.md`
- GA4 → `.claude/skills/ga4.md`
- Google Ads → `.claude/skills/google_ads.md`

**Separacao obrigatoria:**

| Tipo      | Campos                                            | Destino                          |
|-----------|---------------------------------------------------|----------------------------------|
| Publicos  | pixel_id, measurement_id, conversion_id, labels  | Config JSON no `SITE_CONFIG`     |
| Secretos  | access_token (Meta), api_secret (GA4)             | `npx wrangler secret put`        |

**EXCECAO TikTok:** o `access_token` do TikTok vai no **config JSON** (`platforms.tiktok.access_token`) — NAO como wrangler secret. O codigo le `tiktokConfig.access_token` sem fallback para env. Ver `.claude/skills/tiktok.md` para detalhes.

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
- Meta: nao incluir `access_token` nem `access_token_purchase` — sao wrangler secrets
- GA4: nao incluir `api_secret` — e wrangler secret
- Omitir `pixel_id_purchase` se o cliente nao tiver um segundo pixel configurado
- Omitir `purchase_trigger_event` quando nao houver `pixel_id_purchase` — este campo so tem efeito com segundo pixel ativo (define qual evento browser dispara Purchase nesse segundo pixel)
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
echo "{access_token}" | npx wrangler secret put META_ACCESS_TOKEN

# Meta Ads dual-pixel (apenas se dual-pixel ativo)
echo "{access_token_purchase}" | npx wrangler secret put META_ACCESS_TOKEN_PURCHASE

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
curl "https://{dominio}/tracking/web.js?site_id={site_id}" | head -3
```

Interpretar resultado:
- `var __CONFIG__={"site_id":"{site_id}","meta_pixel_id":...}` com campos corretos → config OK
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

### 5.3 Validacao visual por plataforma

Delegar para a skill especialista de cada plataforma confirmada:
- Meta Ads → `.claude/skills/meta.md` (Events Manager > Testar Eventos)
- GA4 → `.claude/skills/ga4.md` (GA4 > DebugView)
- TikTok Ads → `.claude/skills/tiktok.md` (Events Manager > Atividade recente)
- Google Ads → `.claude/skills/google_ads.md` (Google Tag Assistant ou painel com delay 3h)

---

### Webhooks de gateway — apenas se modelo for infoproduto

> Para gateways com parser incompleto (ticto, eduzz, perfectpay, payt) ou para um gateway nao listado abaixo, invocar `.claude/skills/new_gateway.md` antes de continuar.

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

**Apos a mensagem para o cliente, exibir bloco de referencia tecnica (para o operador):**

---

### Referencia tecnica da configuracao

**Dominio trackeado:** `{dominio}`
**Script instalado em:** todas as paginas de `{dominio}` onde o `<script src="https://{dominio}/tracking/web.js">` foi adicionado ao `<head>`

**Plataformas configuradas e eventos por plataforma:**

| Plataforma | Eventos configurados |
|---|---|
| {plataforma, ex: Meta Ads} | {lista de eventos canonicos, ex: page_view, lead, purchase} |
| {plataforma} | {eventos} |

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

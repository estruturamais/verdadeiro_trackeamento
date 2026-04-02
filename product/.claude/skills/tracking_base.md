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
  → getUserStore → fdvMerge (enriquece com dados do user_store)
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

### Mapeamento canonico de eventos (de `src/shared/event-names.js`)

| Evento canonico   | Meta             | TikTok           | GA4            | Google Ads |
|-------------------|------------------|------------------|----------------|------------|
| page_view         | PageView         | Pageview         | page_view      | — (null)   |
| contact           | Contact          | Contact          | contact        | contact    |
| lead              | Lead             | SubmitForm       | generate_lead  | lead       |
| initiate_checkout | InitiateCheckout | InitiateCheckout | begin_checkout | — (null)   |
| purchase          | Purchase         | Purchase         | purchase       | purchase   |

`page_view` e `initiate_checkout` nao enviam para Google Ads.

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
- Meta Ads → `tracking_meta_ads`
- TikTok Ads → `tracking_tiktok_ads`
- GA4 → `tracking_ga4`
- Google Ads → `tracking_google_ads`

**Separacao obrigatoria:**

| Tipo      | Campos                                            | Destino                          |
|-----------|---------------------------------------------------|----------------------------------|
| Publicos  | pixel_id, measurement_id, conversion_id, labels  | Config JSON no `SITE_CONFIG`     |
| Secretos  | access_token, api_secret                          | `npx wrangler secret put`        |

Gravar cada dado recebido imediatamente no `tracking_memory.md`. Secrets: gravar apenas "CONFIGURADO (SECRETO)" — nunca o valor.

---

## Step 3b — Config no wrangler.toml e secrets

> **CRITICO:** O mecanismo real de config e `env.SITE_CONFIG` no `[vars]` do `wrangler.toml`. NAO existe tabela D1 para config.

O agente executa este step inteiro. Cliente aguarda.

### 1. Gerar JSON de configuracao

Seguir a estrutura completa de `config.example.json`. Incluir apenas plataformas confirmadas. Nunca incluir access_tokens ou api_secrets no JSON.

```json
{
  "site_id": "{site_id}",
  "debug": false,
  "platforms": {
    "meta": {
      "pixel_id": "{pixel_id}",
      "pixel_id_purchase": "{se dual-pixel ativo — omitir chave se nao aplicavel}",
      "purchase_trigger_event": "lead"
    },
    "tiktok": {
      "pixel_id": "{pixel_id}"
    },
    "ga4": {
      "measurement_id": "{G-XXXXXXXXXX}"
    },
    "google_ads": {
      "conversion_id": "{AW-XXXXXXXXXX}",
      "channel": "{web ou server}",
      "conversion_label_contact": "{label}",
      "conversion_label_lead": "{label}",
      "conversion_label_purchase": "{label}"
    }
  },
  "gateways": ["{lista de gateways detectados no Step 2}"],
  "gateways_config": {
    "hotmart": {
      "domains": ["hotmart.com", "hotmart.com.br", "pay.hotmart.com", "go.hotmart.com"],
      "caminho": "sck",
      "indexador": "xcod",
      "user_params": { "email": "email", "phone": "phonenumber", "name": "name" }
    },
    "kiwify": {
      "domains": ["kiwify.com", "kiwify.com.br", "pay.kiwify.com.br"],
      "caminho": "caminho",
      "indexador": "sck"
    },
    "ticto": {
      "domains": ["ticto.com.br", "ticto.app", "checkout.ticto.app", "checkout.ticto.com.br"],
      "caminho": "caminho",
      "indexador": "sck"
    },
    "kirvano": {
      "domains": ["kirvano.com", "pay.kirvano.com"],
      "caminho": "caminho",
      "indexador": "src"
    },
    "eduzz": {
      "domains": ["eduzz.com", "eduzz.com.br", "chk.eduzz.com", "sun.eduzz.com"],
      "caminho": "caminho",
      "indexador": "utm_medium"
    },
    "lastlink": {
      "domains": ["lastlink.com", "lastlink.com.br", "pay.lastlink.com"],
      "caminho": "caminho",
      "indexador": "utm_id"
    },
    "perfectpay": {
      "domains": ["perfectpay.com.br", "checkout.perfectpay.com.br"],
      "caminho": "caminho",
      "indexador": "utm_perfect"
    },
    "pagtrust": {
      "domains": ["pagtrust.com", "pagtrust.com.br", "checkout.pagtrust.com.br"],
      "caminho": "sck",
      "indexador": "sck"
    },
    "payt": {
      "domains": ["payt.com.br", "checkout.payt.com.br"],
      "caminho": "caminho",
      "indexador": "src"
    }
  },
  "triggers": {
    "lead": {
      "type": "form_submit",
      "selectors": { "elementor": true, "cf7": true, "generic": true }
    },
    "contact": {
      "type": "link_click",
      "match": "wa.me|api.whatsapp"
    },
    "initiate_checkout": {
      "type": "link_click",
      "match": "pay"
    }
  },
  "custom_data": {},
  "cookies": {
    "user": "marca_user",
    "email": "marca_email",
    "phone": "marca_phone",
    "name": "marca_name"
  },
  "geolocation": null,
  "logging": {
    "enabled": true,
    "retention_days": 30,
    "log_bearer_token": "{token secreto — opcional}"
  }
}
```

Incluir em `gateways_config` apenas os gateways detectados no Step 2.

### 2. Atualizar SITE_CONFIG no wrangler.toml

Abrir `wrangler.toml` e atualizar a secao `[vars]`:

```toml
[vars]
SITE_CONFIG = '{json_completo_em_uma_linha_sem_quebras}'
```

O JSON deve ser serializado em uma unica linha (sem quebras de linha) para o wrangler.toml aceitar corretamente.

### 3. Configurar wrangler secrets

Executar apenas os secrets das plataformas confirmadas. Explicar ao cliente o que vai acontecer antes de executar.

```bash
# Meta Ads (sempre que Meta confirmado)
echo "{access_token}" | npx wrangler secret put META_ACCESS_TOKEN

# Meta Ads dual-pixel (apenas se dual-pixel ativo)
echo "{access_token_purchase}" | npx wrangler secret put META_ACCESS_TOKEN_PURCHASE

# TikTok Ads (apenas se TikTok confirmado)
echo "{access_token}" | npx wrangler secret put TIKTOK_ACCESS_TOKEN

# GA4 (apenas se GA4 confirmado)
echo "{api_secret}" | npx wrangler secret put GA4_API_SECRET
```

Usar `echo | wrangler secret put` para evitar que o valor fique no historico do shell. Nunca exibir o valor do secret em mensagem de chat.

### 4. Re-deploy apos secrets

```bash
npx wrangler deploy
```

Marcar "Step 3b" como concluido no `tracking_memory.md`.

---

## Step 4 — Validacao

### 4.1 Teste no browser

Instruir o cliente:
> "Acesse `{dominio}?debug=1` e abra o console do navegador (F12 > Console). Voce deve ver: `[Tracking] page_view fired - event_id: ...`. Me diga o que aparece."

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

### 4.3 Validacao visual por plataforma

Delegar para a skill especialista de cada plataforma confirmada:
- Meta Ads → `tracking_meta_ads` (Events Manager > Testar Eventos)
- GA4 → `tracking_ga4` (GA4 > DebugView)
- TikTok Ads → `tracking_tiktok_ads` (Events Manager > Atividade recente)
- Google Ads → `tracking_google_ads` (Google Tag Assistant ou painel com delay 3h)

### 4.4 Criterios de sucesso
- `status_code` 200 ou 204 para cada plataforma na tabela `events`
- Nenhum `error_message` preenchido
- Confirmacao visual em ao menos uma plataforma

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

### Webhooks de gateway — apenas se modelo for infoproduto

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

## Regras gerais durante o workflow

1. **Nao pular steps** — confirmar resultado esperado de cada step antes de avancar
2. **Gravar tudo imediatamente** — qualquer dado fornecido fora de ordem vai para o `tracking_memory.md` na hora
3. **Verificar memoria antes de perguntar** — nunca pedir o que ja esta no `tracking_memory.md`
4. **Nunca exibir secrets** — confirmar apenas "configurado", nunca repetir o valor
5. **Explicar antes de executar** — antes de qualquer comando de terminal, explicar em linguagem simples o que vai acontecer e por que
6. **Aguardar confirmacao em acoes invasivas** — wrangler.toml, deploy, secrets: explicar e aguardar "pode continuar" antes de executar
7. **Linguagem simples na entrega** — Step 6 e para o cliente, sem jargao tecnico
8. **Detectar e alertar conflitos** — scripts de tracking pre-existentes no site devem ser alertados antes de continuar
9. **Um step de cada vez** — gravar antecipacoes no `tracking_memory.md` mas nao sair do step atual
10. **Retomada de sessao** — se invocado com `tracking_memory.md` existente, exibir status e perguntar se quer continuar de onde parou

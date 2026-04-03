# Skill: tracking_ga4

## Papel

Voce e o especialista em GA4 (Google Analytics 4). Conhece o modelo server-only deste sistema, o Measurement Protocol, o proxy de primeiro dominio, e os guards criticos extraidos do codigo real em producao.

Voce e carregado pelo `tracking_base` apenas quando o cliente confirma uso de GA4 no Step 1. Sua responsabilidade: coletar credenciais, explicar o modelo server-only, e validar os eventos via DebugView.

---

## Modelo server-only (CRITICO — o aspecto mais contra-intuitivo do sistema)

GA4 e a unica plataforma com modelo **exclusivamente server-side** neste sistema. Entender por que e essencial para nao confundir o cliente nem introduzir contagem dupla.

**O que o browser faz:**
- Carrega `gtag.js` (via proxy de primeiro dominio em `/scripts/ga.js`)
- O gtag cria e mantem os cookies `_ga` e `_ga_*`
- `send_page_view: false` — o browser NAO dispara nenhum evento
- O browser apenas deixa os cookies disponiveis para o `web.js` ler

**O que o Worker faz:**
- Le os cookies GA4 do beacon (`ga_client_id`, `ga_session_id`, `ga_session_count`, `ga_timestamp`)
- Envia TODOS os eventos via Measurement Protocol para `google-analytics.com/mp/collect`

**Por que server-only?**
GA4 NAO tem mecanismo de deduplicacao por `event_id` como Meta e TikTok. Se o browser E o servidor enviassem o mesmo evento, o GA4 contaria em dobro. Por isso o browser so mantem cookies e o Worker faz todo o tracking.

---

## Proxy de primeiro dominio

Extraido de `src/worker/routes/ga4-proxy.js`:

**Rota `/scripts/ga.js?id={measurement_id}`**
- Proxia `https://www.googletagmanager.com/gtag/js?id={id}&l=dataLayer`
- Cache: `public, max-age=3600`
- Serve o script do proprio dominio do cliente — nao e bloqueado por ad blockers

**Rota `/g/collect`**
- Proxia `https://www.google-analytics.com/g/collect` (mantendo todos os query params)
- Suporta GET e POST
- Mantem o trafego de cookies GA4 em primeiro dominio

---

## Browser-side: inicializacao do gtag

Extraido de `src/web/web-template.txt` funcao `initGA4`:

```javascript
// Carrega de /scripts/ga.js (proxy, NAO googletagmanager.com direto)
var ga4Config = {
  send_page_view: false,
  server_container_url: window.location.origin  // aponta coleta para o proprio dominio
};
// Se debug mode ativo:
ga4Config.debug_mode = true;
gtag('config', __CONFIG__.ga4_measurement_id, ga4Config);
```

**Cookies criados pelo gtag que o web.js le:**
- `_ga` — formato `GA1.1.{client_id}`. `ga_client_id` e extraido como `parts[2] + '.' + parts[3]`
- `_ga_{suffix}` — contem session_id, session_count e timestamp, extraidos por regex:
  - `ga_session_id`: match `/s(\d+)j/`
  - `ga_session_count`: match `/j(\d+)t/`
  - `ga_timestamp`: match `/t(\d+)/`

---

## Guard critico: ga_client_id ausente

Extraido de `src/worker/platforms/ga4.js` linhas 8-20:

Se `body.browser_data.ga_client_id` estiver ausente, a funcao **retorna imediatamente** sem fazer nenhum fetch para o GA4.

```
Log gravado na tabela events:
  platform: 'google_analytics_4'
  status_code: 0
  error_message: 'missing_ga_client_id'
```

**Motivo:** GA4 descarta silenciosamente eventos sem `client_id` — enviar seria desperdicio de requests.

**Quando acontece:** normalmente na primeira visita do usuario, antes do cookie `_ga` ser criado pelo gtag. Na segunda visita ja existe o cookie e o evento e enviado normalmente.

---

## Mapeamento de eventos

Extraido de `src/shared/event-names.js` coluna `ga4`:

```
page_view         → page_view
contact           → contact
lead              → generate_lead       (NAO "lead" — nome especifico do GA4!)
initiate_checkout → begin_checkout      (NAO "initiate_checkout"!)
purchase          → purchase
```

**Atencao:** `lead` e `initiate_checkout` tem nomes diferentes no GA4. Usar os nomes errados faz os eventos aparecerem como customizados no painel, perdendo os relatorios padrao.

---

## Payload Measurement Protocol — Beacon (web)

Extraido de `sendGA4Event` em `src/worker/platforms/ga4.js` linhas 24-41:

```json
{
  "client_id": "{ga_client_id extraido do cookie _ga}",
  "timestamp_micros": "{ga_timestamp — incluido apenas se presente}",
  "non_personalized_ads": false,
  "events": [{
    "name": "page_view | contact | generate_lead | begin_checkout | purchase",
    "params": {
      "engagement_time_msec": 100,
      "page_location": "{page_url}",
      "page_title": "{page_title}",
      "session_id": "{ga_session_id — incluido apenas se presente, como String}",
      "session_number": "{ga_session_count — incluido apenas se presente, como parseInt}",
      "value": 97.00,
      "currency": "BRL"
    }
  }]
}
```

**Campos condicionais:**
- `timestamp_micros`, `session_id`, `session_number`: incluidos apenas se presentes nos cookies
- `value` e `currency`: incluidos apenas se `body.custom_data.value` estiver presente

**Parametros intencionalmente ausentes:**
- `event_id` — GA4 nao usa para deduplicacao (por isso o modelo e server-only)
- `marca_user` — GA4 usa `client_id` (cookie `_ga`), nao identificador customizado

---

## Payload Measurement Protocol — Webhook/Purchase

Extraido de `sendGA4MP` em `src/worker/platforms/ga4.js` linhas 74-101:

```json
{
  "client_id": "{ga_client_id do user_store}",
  "timestamp_micros": "{ga_timestamp — condicional}",
  "non_personalized_ads": false,
  "events": [{
    "name": "purchase",
    "params": {
      "session_id": "{ga_session_id — condicional}",
      "session_number": "{ga_session_count — condicional, parseInt}",
      "engagement_time_msec": 100,
      "page_location": "{page_url do user_store}",
      "transaction_id": "{order_id}",
      "value": 97.00,
      "currency": "BRL",
      "items": [{
        "item_id": "{product_id}",
        "item_name": "{product_name}",
        "price": 97.00,
        "quantity": 1
      }]
    }
  }]
}
```

**Diferenca do beacon:** usa `transaction_id` e `items` (dados vindos do webhook do gateway via `user_store`).

---

## API

- **Endpoint:** `POST https://www.google-analytics.com/mp/collect?measurement_id={G-XXXXXXXXXX}&api_secret={secret}`
- **Header:** `Content-Type: application/json`
- **IMPORTANTE:** O Measurement Protocol retorna **204** em caso de sucesso, NAO 200. Nao tratar 204 como erro — e o comportamento esperado da API do GA4.

---

## Credenciais a coletar

**Measurement ID (publico — vai no config JSON):**
> GA4 > Admin > Fluxos de dados > Web > ID no formato `G-XXXXXXXXXX`

**API Secret (secreto — vai como wrangler secret):**
> Mesma tela > "Segredos da API do Measurement Protocol" > Criar
> Gerar um novo secret e copiar o valor

**Mensagem de coleta sugerida:**
> Para configurar o GA4, preciso de duas informacoes:
> 1. **Measurement ID** — no GA4, va em Admin > Fluxos de dados > Web. E o codigo que comeca com `G-`
> 2. **API Secret** — na mesma tela, clique em "Segredos da API do Measurement Protocol" e crie um novo. Copie o valor gerado.

---

## Separacao config vs secrets

| Campo | Destino |
|---|---|
| `measurement_id` (ex: `G-XXXXXXXXXX`) | Config JSON no `SITE_CONFIG` do `wrangler.toml` |
| `api_secret` | `npx wrangler secret put GA4_API_SECRET` |

**Nota do codigo:** `ga4Config.api_secret || env.GA4_API_SECRET` — se o `api_secret` estiver no config JSON, ele tem prioridade sobre o env secret. O padrao recomendado e usar o wrangler secret e nao incluir o `api_secret` no config JSON.

**Gravar na memoria:** apenas "CONFIGURADO (SECRETO)" para o api_secret — nunca o valor real.

---

## Validacao

**DebugView em tempo real:**
> GA4 > Admin > DebugView

Para ver eventos em tempo real, o `web.js` deve enviar com `debug_mode: true` nos params do evento. Isso acontece automaticamente quando o site e acessado com `?debug=1` na URL.

**Verificar na tabela events do D1:**
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message FROM events WHERE site_id = '{site_id}' AND platform = 'google_analytics_4' ORDER BY id DESC LIMIT 10;"
```

**Resultado esperado:**
```
page_view | google_analytics_4 | web | collect | 204 |
```

**Status 204 = sucesso.** Nao e erro. E o comportamento correto da API do GA4 Measurement Protocol.

**Se aparecer `status_code: 0` e `error_message: 'missing_ga_client_id'`:** normal na primeira visita. Recarregar a pagina e tentar novamente — na segunda visita o cookie ja existe.

**Se aparecer outro `error_message`:** exibir o erro ao cliente em linguagem simples e diagnosticar antes de continuar.

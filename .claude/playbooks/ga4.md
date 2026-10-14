# Skill: tracking_ga4

## Papel

Voce e o especialista em GA4 (Google Analytics 4). Conhece o modelo deste sistema (page_view pelo navegador, conversoes pelo servidor), o Measurement Protocol, o proxy de primeiro dominio, e os guards criticos extraidos do codigo real em producao.

Voce e carregado pelo `tracking_base` apenas quando o cliente confirma uso de GA4 no Step 1. Sua responsabilidade: coletar credenciais, explicar o modelo, e validar pelo Tempo real do GA4 (o DebugView mostra o page_view e os automaticos do navegador, mas nao as conversoes do Measurement Protocol — ver "Validacao").

---

## Modelo: page_view pelo navegador, conversoes pelo servidor (CRITICO — mudou na 1.9.1)

Cada evento do GA4 sai por **um** caminho so: o GA4 NAO deduplica por `event_id` como a Meta e o
TikTok, e o mesmo evento pelo navegador **e** pelo servidor conta em dobro.

**O que o navegador faz (gtag.js, pelo proxy de primeiro dominio):**
- Carrega `gtag.js` de `/scripts/ga.js` e manda os hits para `{dominio}/g/collect` (proxy proprio,
  via `server_container_url`).
- **Envia o `page_view`** no `config` (`send_page_view: true`, o padrao do Google) e os eventos
  automaticos (`session_start`, `first_visit`, `user_engagement`, `scroll`, cliques de saida —
  medicao otimizada). E desses hits que o GA4 deriva usuario, sessao, origem, cidade e dispositivo.
- E esse hit que grava `_ga` e `_ga_<ID>`. Ha container que **adia** o cookie ate o 1o hit: ate a
  1.9.0, com `send_page_view: false`, o `gtag('get')` devolvia um `client_id`/`session_id`
  **provisorio** e o hit seguinte gravava OUTRO — a 1a pagina de cada visita ia para um usuario e uma
  sessao que nao existiam (usuarios e sessoes inflados, pagina de entrada perdida).
- **Nao** envia as conversoes.

**O que o Worker faz (Measurement Protocol, `google-analytics.com/mp/collect`):**
- Recebe no beacon a identidade GA4 (`ga_client_id`, `ga_session_id`, `ga_session_count`) — lida
  dos cookies que o `page_view` do navegador acabou de gravar — e a guarda no `user_store`.
- Envia as **conversoes de navegador** (`begin_checkout`, `contact`, `generate_lead`, `sign_up`,
  `login`) e o **`purchase`** do webhook, amarrados a sessao do navegador pelo `session_id`.
- **Nao** envia `page_view` (ate a 1.9.0 enviava): o D1 nao tem mais linha `google_analytics_4` de
  `page_view` — ele se valida no Tempo real.

**Trade-off, dito com honestidade:** o `page_view` do GA4 passou a depender do navegador. Visitante
com bloqueador que barra o `/g/collect` do proprio dominio (ou o `gtag.js`) perde o `page_view` do
GA4 — como em qualquer instalacao de GA4. Meta e TikTok seguem server-side (o beacon do VT nao passa
pelo gtag), e as conversoes do GA4 seguem pelo MP para quem tem o `_ga`.

**Fonte (Google, conferida em 14/10/2026):** [Measure pageviews](https://developers.google.com/analytics/devguides/collection/ga4/views?client_type=gtag)
— `send_page_view` vem `true` por padrao e o `config` "sends a pageview by default", com
`page_title` de `document.title` e `page_location` de `location.href`; e *"Google Analytics will
send `page_view` events based on browser history changes even if you set `send_page_view: false`"*
(medicao otimizada — ver `.claude/references/disable-auto-tracking.md`).

> **Sintoma de que o `page_view` do navegador nao esta saindo (1.9.1+):** Tempo real sem
> *Visualizacoes por titulo da pagina*, com o site no ar. Conferir as routes `/scripts/ga.js` e
> `/g/collect` no `wrangler.toml` e o script como 1o elemento do `<head>`. Ate a 1.9.0, o mesmo
> sintoma apontava para o MP — ver a secao 2.4b do `audit-tracking`.

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
- **Repassa o IP do visitante** (`_uip` = `CF-Connecting-IP`, mais `X-Forwarded-For`). Sem isso o
  Google geolocaliza o IP de saida da Cloudflare e o visitante aparece **sem cidade** (ou na cidade
  do datacenter). `_uip` e o parametro do GTM server-side do proprio Google; o `X-Forwarded-For`
  segue o snippet oficial do Google tag gateway para Cloudflare. O valor e sempre sobrescrito (o
  gtag nunca o envia; vindo do navegador seria forjavel).

---

## Browser-side: inicializacao do gtag

Extraido de `src/web-template.txt` funcao `initGtag` (`initGA4` segue como alias), bloco `if (ga4Id)`:

```javascript
// Carrega de /scripts/ga.js (proxy, NAO googletagmanager.com direto)
var ga4Config = {
  send_page_view: true,                          // o page_view do GA4 sai PELO NAVEGADOR (1.9.1)
  server_container_url: window.location.origin  // aponta coleta para o proprio dominio (/g/collect)
};
// Se debug mode ativo:
ga4Config.debug_mode = true;
gtag('config', __CONFIG__.ga4_measurement_id, ga4Config);
// Sinal de pronto para o beacon (ver abaixo): as callbacks rodam quando o gtag.js
// carrega e processa a fila — a essa altura o page_view do navegador ja gravou _ga/_ga_<ID>.
gtag('get', __CONFIG__.ga4_measurement_id, 'client_id', cb);
gtag('get', __CONFIG__.ga4_measurement_id, 'session_id', cb);
```

**Cookies criados pelo gtag que o web.js le:**
- `_ga` — formato `GA1.1.{client_id}`. `ga_client_id` e extraido como `parts[2] + '.' + parts[3]`
- `_ga_{ID sem "G-"}` — lido pelo **nome exato** da propriedade, nos dois formatos:
  - `GS2.1.s{session_id}$o{session_number}$g{engajada}$t{ultimo_hit}$j..$l..$h..` (atual)
  - `GS1.1.{session_id}.{session_number}.{engajada}.{ultimo_hit}...` (legado)
  - Cookie duplicado (dois niveis de dominio) → vale o de `t` mais recente.
  - As regex antigas (`/s(\d+)j/`, `/j(\d+)t/`) nao casavam com nenhum dos dois — o `session_id`
    nunca saia. Corrigido na 1.9.0.
- `ga_timestamp` (`t` + `000000`) segue no beacon e no `user_store` so como **informativo** — o
  Worker nao o usa mais como `timestamp_micros`.

**O beacon do `page_view` espera o `<title>`, o gtag e, com Meta, o `_fbp`** (desde a 1.9.0/1.9.1).
Desde a 1.9.1 ele **nao vai ao GA4**: alimenta Meta e TikTok e grava no `user_store` o `client_id` e a
sessao **reais**, usados nas conversoes e no `purchase`. O script e o 1o elemento do `<head>`:
rodando na hora, ele saia **antes do `<title>`** e **antes do gtag.js** (async) — sem `_ga` na 1a
pagina do visitante novo, ou com a sessao anterior no `_ga_<ID>`. Agora:
- so o **beacon** do page_view espera; o `fbq`/`ttq` de navegador saem na hora, com o mesmo `event_id`;
- sai quando o `<title>` foi lido **e** as callbacks do `gtag('get', ...)` voltaram — a essa altura o
  `page_view` do navegador ja foi montado e gravou os cookies que o beacon le;
- **teto de 3 s** (gtag bloqueado/lento nao custa o evento) e envio imediato no `pagehide` /
  `visibilitychange=hidden` se o visitante sair antes (`sendBeacon` sobrevive ao unload);
- os dados de navegador sao **relidos no envio** (de quebra pega `_fbp`/`_ttp` que nasceram nesse
  meio-tempo).

> ⚠️ **`client_id` do cookie primeiro.** Na 1a visita a callback de `gtag('get', ID, 'client_id')`
> devolve um id **provisorio**, diferente do que o gtag grava no `_ga` logo em seguida (reproduzido
> no Chrome). Usando o valor do `get`, a 1a e a 2a pagina do mesmo visitante viram **dois usuarios**
> no GA4. Por isso o `get` e so o **sinal de pronto**: o `client_id` sai do cookie `_ga`, e o valor
> do `get` cobre so quem nao tem cookie. O `session_id` segue a mesma regra.

---

## Guard critico: ga_client_id ausente

Extraido de `sendGA4Event` e `sendGA4MP` em `src/worker/platforms/ga4.js`:

Se `body.browser_data.ga_client_id` estiver ausente, a funcao **retorna imediatamente** sem fazer nenhum fetch para o GA4.

```
Log gravado na tabela events:
  platform: 'google_analytics_4'
  status_code: 0
  error_message: 'missing_ga_client_id'
```

**Motivo:** o Measurement Protocol exige `client_id`.

**Quando acontece:**
- **Conversao de navegador (beacon):** `begin_checkout`/`contact`/`generate_lead`... de visitante com
  o gtag bloqueado, ou que saiu antes de ele carregar. Ate a 1.9.0 o `page_view` tambem passava por
  aqui (com a espera do gtag, caiu de 37% para ~2% no cliente medido); desde a 1.9.1 ele sai pelo
  navegador e nao gera mais esta linha.
- **Purchase (webhook):** venda sem visita identificada — comprador que nunca passou pelo site, link
  de checkout antigo/salvo com indexador de antes do VT, venda pelo agente de vendas do gateway
  (`src: kiwify_sales_agent`). Por padrao a venda **nao vai ao GA4** e a receita fica abaixo da do
  gateway. Com `platforms.ga4.unattributed_purchases: true` ela sai com `client_id` sintetico (ver
  `.claude/references/site-config-format.md`).

---

## Venda sem visita (`unattributed_purchases`) — oferecer no onboarding, nunca ligar sozinho

O onboarding **oferece** a flag ao cliente; ela nunca e ligada por default nem por decisao do agente.

- **Quando oferecer:** so **depois** de o checklist de integracoes antigas (Step 5, 5.3b do
  `overview.md`) confirmar que **nao ha outro emissor de purchase no GA4** — integracao GA4 nativa do
  gateway, tag de compra do GA4 no GTM, webhook antigo de servidor (Stape, sGTM ou outro). Com outro
  emissor ligado, a receita do GA4 conta **em dobro**: ele manda o proprio `transaction_id` e o GA4 nao
  deduplica. No Step 3b ela fica `false`, como vem no `config.example.json`.
- **O trade-off, dito ao cliente:** a venda sem visita identificada (link de checkout antigo ou
  salvo, venda pelo agente de vendas do gateway, comprador que nunca passou pelo site) passa a entrar
  na **receita** do GA4, e a receita do GA4 se aproxima da do gateway — mas **sem atribuicao**: essas
  vendas aparecem sem campanha nem origem ("(not set)"). Sem a flag, elas ficam fora do GA4 e gravam
  `missing_ga_client_id`.
- **Sem resposta = nao liga.** So `sim` explicito vira `"unattributed_purchases": true` em
  `platforms.ga4`; gravar a resposta no `tracking_memory.md` (`ga4_unattributed_purchases: sim | nao`).
- **Como aparece:** a venda sai com `client_id` sintetico (derivado do pedido, nunca de e-mail ou
  telefone), sem sessao e sem `engagement_time_msec`; o D1 grava `204` +
  `aviso_client_id_sintetico` (nao e erro — ver "Validacao").

---

## Mapeamento de eventos

Extraido de `src/shared/event-names.js` coluna `ga4`:

```
page_view         → page_view           (pelo NAVEGADOR, no config do gtag — nao passa pelo MP desde a 1.9.1)
contact           → contact
lead              → generate_lead       (NAO "lead" — nome especifico do GA4!)
initiate_checkout → begin_checkout      (NAO "initiate_checkout"!)
purchase          → purchase
```

**Atencao:** `lead` e `initiate_checkout` tem nomes diferentes no GA4. Usar os nomes errados faz os eventos aparecerem como customizados no painel, perdendo os relatorios padrao.

---

## Payload Measurement Protocol — Beacon (web)

Extraido de `sendGA4Event` em `src/worker/platforms/ga4.js`:

```json
{
  "client_id": "{ga_client_id extraido do cookie _ga}",
  "ip_override": "{IP do visitante — CF-Connecting-IP do beacon}",
  "user_agent": "{User-Agent do visitante}",
  "consent": { "ad_personalization": "GRANTED" },
  "events": [{
    "name": "contact | generate_lead | begin_checkout | sign_up | login | purchase",
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

O `page_view` nao passa por aqui desde a 1.9.1 (sai pelo gtag do navegador); ate a 1.9.0 tinha este
mesmo formato.

**Campos condicionais:**
- `session_id`, `session_number`: incluidos apenas se presentes nos cookies
- `value` e `currency`: incluidos apenas se `body.custom_data.value` estiver presente

**Campos de request (doc oficial do MP, `reference?client_type=gtag`):**
- `ip_override` / `user_agent`: sem eles, o GA4 deriva geografia e dispositivo "dos eventos de tag
  pelo `client_id`" — e esses passam pelo proxy. Com eles, a cidade e o aparelho do visitante vao
  direto no evento.
- `consent.ad_personalization: GRANTED`: substituto oficial do `non_personalized_ads` (deprecado);
  mesmo efeito do `non_personalized_ads: false` de antes.
- **Sem `timestamp_micros`** (desde a 1.9.0): o beacon chega em tempo real. O valor antigo (ultimo
  hit do cookie + 60s) datava eventos no futuro ou dias atras.

**Parametros intencionalmente ausentes:**
- `event_id` — GA4 nao usa para deduplicacao (por isso o modelo e server-only)
- `marca_user` — GA4 usa `client_id` (cookie `_ga`), nao identificador customizado

---

## Payload Measurement Protocol — Webhook/Purchase

Extraido de `sendGA4MP` em `src/worker/platforms/ga4.js`:

```json
{
  "client_id": "{ga_client_id do user_store — ou sintetico, com unattributed_purchases}",
  "ip_override": "{IP do comprador: user_store, ou o do dispositivo informado pelo gateway}",
  "user_agent": "{User-Agent do user_store — condicional}",
  "consent": { "ad_personalization": "GRANTED" },
  "events": [{
    "name": "purchase",
    "params": {
      "session_id": "{ga_session_id — condicional}",
      "session_number": "{ga_session_count — condicional, parseInt}",
      "engagement_time_msec": 100,  // omitido na venda sintetica (nao inventa usuario ativo)
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

**Sem `timestamp_micros`** tambem aqui: o `ga_timestamp` do `user_store` e o ultimo hit da **visita**,
nao a hora da compra — a receita caia no dia da visita (boleto pago dias depois → travado em 72h
atras). O webhook chega em tempo real; a sessao vai pelo `session_id`.

**Venda que nao foi ao GA4** (sem `client_id`, flag desligada) grava `missing_ga_client_id` com
`sent_payload` = `{ motivo, marca_user_presente }` — ate a 1.8.0 era um `return` mudo, sem linha no D1.
O log do envio leva o `event_id` do webhook (`order_id` + `product_id`), cruzavel com a linha da Meta.
Para **recuperar** uma venda perdida dentro de 72h, ver a secao GA4 do `.claude/playbooks/reenvio_dados.md`.

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
| `api_secret` | `npx wrangler secret bulk` (chave `GA4_API_SECRET`) |

```bash
# secrets.json: {"GA4_API_SECRET": "{api_secret}"}
npx wrangler secret bulk secrets.json
rm secrets.json                          # PowerShell: Remove-Item secrets.json -Force
```

> **NUNCA** subir por pipe (`echo "{api_secret}" | npx wrangler secret put GA4_API_SECRET`). No
> Windows/PowerShell o pipe acrescenta CRLF e o secret e gravado com whitespace — na query string do
> Measurement Protocol isso vira um `api_secret` invalido, rejeitado em silencio. Ver o Step 3b do
> `overview.md`.

**Nota do codigo:** `ga4Config.api_secret || env.GA4_API_SECRET` — se o `api_secret` estiver no config JSON, ele tem prioridade sobre o env secret. O padrao recomendado e usar o wrangler secret e nao incluir o `api_secret` no config JSON.

**Gravar na memoria:** apenas "CONFIGURADO (SECRETO)" para o api_secret — nunca o valor real.

---

## Validacao

**Tempo real (o teste que o cliente consegue fazer):**
> GA4 > Relatorios > Tempo real — abrir uma pagina do site e conferir, em segundos, o card
> *Visualizacoes por titulo da pagina* (o titulo aparece) e *Usuarios por cidade* (a cidade certa).
> Desde a 1.9.1 e o **unico** lugar para validar o `page_view`: ele sai pelo navegador e nao grava
> linha no D1.

> **Leitura que evita alarme falso:** o card **"Finalizacoes de compra"** do GA4 e o `begin_checkout`
> (checkout **iniciado**, o `initiate_checkout` do VT), nao venda. Venda e `purchase` / "Receita".

**DebugView:** com `?debug=1` o gtag do navegador liga `debug_mode` — o DebugView mostra o
`page_view` (1.9.1+) e os eventos **automaticos** do navegador. As conversoes do MP **nao** levam
`debug_mode` e nao aparecem la: para elas, usar o Tempo real.

**Validar o FORMATO do payload do MP** (servidor de validacao oficial — nao grava nada na
propriedade): `POST https://www.google-analytics.com/debug/mp/collect?measurement_id={G-...}&api_secret={qualquer}`
com o JSON do `sent_payload`. Resposta `{"validationMessages":[]}` = payload valido.

**Verificar na tabela events do D1:**
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message FROM events WHERE site_id = '{site_id}' AND platform = 'google_analytics_4' ORDER BY id DESC LIMIT 10;"
```

**Resultado esperado** (depois de uma conversao de navegador, ex.: clique no checkout):
```
begin_checkout | google_analytics_4 | web | collect | 204 |
```
Sem linha de `page_view`: desde a 1.9.1 ele sai pelo navegador (validar no Tempo real). Instalacao
<= 1.9.0 ainda grava `page_view | google_analytics_4 | web | collect | 204`.

**Status 204 = sucesso.** Nao e erro. E o comportamento correto da API do GA4 Measurement Protocol.
Mas `204` **nao prova** que o evento aparece onde o cliente olha (o MP aceita evento sem titulo,
sem sessao ou com data errada): a query de qualidade (titulo, sessao, `timestamp_micros`, IP) esta na
secao 2.4b do `.claude/skills/audit-tracking/SKILL.md`.

**Se aparecer `status_code: 0` e `error_message: 'missing_ga_client_id'`:** numa conversao de navegador, gtag bloqueado ou visitante que saiu antes de ele carregar (esperado em poucos %). No `purchase`, venda sem visita identificada — ver o guard acima e `unattributed_purchases`.

**`status_code: 204` com `error_message: 'aviso_client_id_sintetico: ...'`:** nao e erro. A venda
entrou no GA4 com `client_id` sintetico (sem atribuicao), porque `unattributed_purchases` esta ligado.

**Se aparecer outro `error_message`:** exibir o erro ao cliente em linguagem simples e diagnosticar antes de continuar.

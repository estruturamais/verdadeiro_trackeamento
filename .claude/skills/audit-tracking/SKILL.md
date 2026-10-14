---
name: audit-tracking
description: Audita um Verdadeiro Trackeamento ja implantado — confirma que os eventos configurados estao sendo capturados, enviados e atribuidos corretamente nas plataformas. Use quando o cliente quer saber se o tracking esta funcionando ("ta funcionando?", "ta tudo certo?", "confere pra mim", "auditar", "revisar tracking", "os eventos estao chegando?") ou logo apos finalizar o setup. Comeca pelo banco de dados (D1) e so pede prints do Gerenciador de Eventos quando o banco nao basta.
---

# Skill: audit-tracking

## Papel

Auditar a saude de um VT em producao: confirmar que cada evento **configurado** esta sendo
capturado, enviado e atribuido corretamente em cada plataforma **confirmada**. Diagnosticar a causa
e apontar **onde corrigir** quando algo falha — sem empurrar para um doc generico.

Pode ser acionada: logo apos o Step 6 do onboarding, pelo menu do Fluxo B (manutencao), por
intencao do cliente em linguagem livre, ou pelo slash command `/audit-tracking`.

---

## Principios condutores

1. **Banco primeiro.** O D1 e deterministico e o assistente acessa sozinho — e a Camada 2. Prints do
   Gerenciador (Camada 1) e browser/humano (Camada 3) so quando o banco nao basta. Perguntar o
   minimo.
2. **Validar contra o `tracking_memory`, nunca contra lista fixa.** A bussola e o que o projeto
   **configurou e salvou** (eventos, canais, plataformas, gateways, Sheets). "So chega Purchase" so
   e problema se o baseline previa `page_view`/`lead` tambem.
3. **Nunca acusar falha sem antes descartar as causas do Step 0** (sem dado / sem instalacao / sem
   webhook / nao configurado / nao solicitado).
4. **Modular por plataforma.** Ler do `tracking_memory` quais plataformas existem e interpretar
   respostas conforme cada uma (ex: GA4 `204` = sucesso). Nunca assumir Meta.
5. **Nao expor secrets.** Confirmar "configurado", nunca repetir valores.

---

## Pre-requisitos de acesso

Igual ao Fluxo B do `workflow.md`:

- Ambiente local com `wrangler.toml` preenchido; conta Cloudflare confirmada (REGRA BLOQUEANTE:
  `npx wrangler whoami` + S/N explicito antes de qualquer `wrangler d1 execute --remote`).
- **Computador novo / arquivos locais vazios:** reconstruir `wrangler.toml` e `tracking_memory.md`
  da Cloudflare (`workflow.md` Fluxo B, passos 3.5 e 4) **antes** de auditar. A memoria e a primeira
  fonte — nao varrer o codigo de producao para reconstruir estado.

---

## Step 0 — Porta de entrada (ESSENCIAL — nunca pular)

Objetivo: separar **"tracking com bug"** de **"sem dado / sem config / nao solicitado"**. No banco,
todas essas causas se parecem (ausencia de linha), mas a solucao de cada uma e oposta.

| O que parece | Causa real | Nao e bug de tracking |
|---|---|---|
| Evento X nao chega | Script nao esta no `<head>` da pagina | sim |
| Compra nao chega | Webhook nao configurado no gateway | sim |
| Lead nao cai na planilha | ID/script do Sheets nao configurado | sim |
| Evento X "faltando" | Evento nunca foi configurado (nao pediram, ou pediram e nao foi feito) | sim |
| Tudo zerado | Sem trafego/compra real no periodo (ou fora da janela de retencao do D1 — ver 0.3) | sim |
| Google Ads com `0,00` conversao | Upload aceito **sem clique correspondente** (campanha parada, anuncio reprovado) — ver 2.10 | sim |
| Google Ads sem conversao, D1 "verde" | `channel` errado no config: instalacao antiga em `server` grava `200` para evento de navegador que nunca disparou — ver 2.10 | sim |
| **Nenhuma invocacao do Worker** (`wrangler tail` conecta e nao mostra nada), com rotas registradas | o host e servido por **plataforma SaaS** (Lovable/Vercel/Netlify/Framer) por custom hostname — o request nao entra na zona do cliente. 🛑 **Nunca "resolver" ligando o proxy no apex**: isso ja derrubou site em producao e a validacao imediata **passa mesmo assim**. Tracking so em `track.{dominio}` — ver `.claude/references/saas-hospedado.md` | sim |
| **Site instavel/fora do ar** logo apos alguem ter ligado a nuvem laranja | Cloudflare na frente de Cloudflare com custom hostname. **Voltar para nuvem cinza e a PRIMEIRA acao**, antes de qualquer investigacao | sim |
| Script carrega, o console mostra o `page_view` e a pagina **nao aparece** no `events` (ou tudo zerado) | beacon relativo indo para o host da pagina, que nao tem Worker: page builder/SaaS sem `collect_url` absoluto, ou o site aberto pelo **host alternativo** da plataforma (`*.pages.dev`, `*.vercel.app`) — `405` sem erro nenhum. Ver **2.1b** | sim — config/infra (`overview.md` 5.1, `infra.md` 0.11b) |
| Renovacao de assinatura "sumindo" | ver **2.11** (`subscription_tracking`, tabela ausente, id da assinatura usado como `order_id`) | depende |
| Console com `[Tracking] Proxy do Meta Pixel indisponivel`, ou `connect.facebook.net` no Network com `pixel_proxy` ligado | Route `/fb/*` ausente no `wrangler.toml` (o `git pull` nao a traz) — o pixel esta no fallback direto, **nao morreu** | sim — config de infra; ver `atualizar.md` (1.8.0) |

### 0.1 Memoria como bussola + versao no ar

Ler `tracking_memory.md`. Se nao existe ou esta vazio → reconstruir da Cloudflare (Fluxo B) antes de
seguir.

Ler tambem a versao do VT que esta **efetivamente no ar** (sobrevive ao apagar arquivos locais) e
reporta-la no inicio da auditoria:
```bash
curl -s "https://{dominio}/tracking/web.js?site_id={site_id}" | head -1
```
A 1a linha e o banner `/*! Verdadeiro Trackeamento vX.Y.Z | @estruturamais | https://instagram.com/estruturamais */`. Se a versao no ar for **menor** que a do repo local (`package.json`), sinalizar que aquele cliente esta numa versao antiga — algumas correcoes/funcionalidades podem nao existir nele e talvez valha um re-deploy.

### 0.2 Baseline esperado (do `tracking_memory`)

Listar: eventos configurados (com o canal de envio por evento), plataformas confirmadas, gateways
detectados, Sheets (sim/nao), pixels espelho Meta. **Este e o gabarito da auditoria.**

### 0.3 Ha dados? (D1 — em `auto_clean`: `events` <= 7 dias, `webhook_raw` <= 14 dias; em `keep_all`: desde a instalacao)

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT platform, COUNT(*) AS total, MAX(timestamp) AS ultimo FROM events WHERE site_id = '{site_id}' AND timestamp >= datetime('now','-{X} days') GROUP BY platform ORDER BY platform;"
npx wrangler d1 execute tracking_db --remote --command "SELECT gateway, COUNT(*) AS total, MAX(timestamp) AS ultimo FROM webhook_raw WHERE site_id = '{site_id}' AND timestamp >= datetime('now','-{X} days') GROUP BY gateway;"
```

> Lembrar o obvio: o banco so tem o que aconteceu **depois** do script instalado / webhook
> configurado. Page view, initiate checkout, compra real e qualquer evento configurado so existem
> apos ocorrerem com a captura no ar.

### 0.4 Reconciliacao esperado x presente — bloco numerado S/N

**So quando algo do baseline nao tem dado** (ou o cliente reclama de algo que nao consta no
baseline). Montar **UM bloco** que o cliente copia, cola e responde de uma vez no formato
`1.S 2.N 3.S` — nunca pergunta a pergunta. Incluir apenas as linhas pertinentes ao baseline:

> Pra eu saber se e um problema de **captura** ou de **configuracao**, copie as perguntas abaixo,
> cole aqui e responda cada uma com **S** (sim) ou **N** (nao):
>
> 1. O script do VT esta instalado no `<head>` da pagina que voce esperava trackear? S/N
> 2. Ja houve trafego real (ou um teste seu) nessa pagina nos ultimos dias? S/N
> 3. [infoproduto] O webhook do {gateway} esta configurado no painel do gateway? S/N
> 4. [infoproduto] Ja houve uma compra real ou de teste no periodo? S/N
> 5. [Sheets] O ID/script da planilha foi configurado? S/N
>
> Pode responder assim, em uma linha: `1.S 2.S 3.N 4.N 5.S`

Interpretacao:

- **1.N** (script nao instalado) → causa: instalacao. Orientar o Step 5 do `overview.md` (script
  como primeiro elemento do `<head>`). Nao e bug.
- **2.N / 4.N** (sem trafego/compra) → sem dado por falta de evento real, nao por falha. Orientar
  gerar trafego ou compra de teste e reauditar.
- **3.N** (webhook ausente) → orientar configurar `https://{dominio}/collect/webhook/{gateway}`.
- **5.N** (Sheets sem ID) → orientar configurar o ID/script da planilha.
- **Tudo S e ainda sem dado** → agora sim ha sinal de **falha real** → seguir para a Camada 2.

### 0.5 Evento reclamado que nao consta no baseline

> "O evento **{X}** nao consta como configurado neste projeto. Como prefere seguir?
>
> **A** — Quero adicionar agora
> **B** — Nao precisa
> **C** — Achei que ja estava configurado"

- **A** → tratar como **setup** (`overview.md` Step 2/3), nao como auditoria.
- **C** → mostrar o que o `tracking_memory` registra como configurado e alinhar a expectativa.

**So avancar para a Camada 2 quando:** existe config esperada **e** existe dado no periodo (ou o
cliente confirmou os pre-requisitos e o dado deveria existir).

---

## Camada 2 — Banco de dados (auto-servico, sempre primeiro)

Para cada item: rodar a query, interpretar contra o baseline, dar **veredito** e, se falha,
**onde corrigir**.

> **Valores reais das colunas `events` (nao inventar):**
> - `platform`: `collect` (log de ingestao do beacon), `meta_ads`, `tiktok_ads`, `google_analytics_4`, `google_ads`, `sheets`.
> - `channel`: `web` (evento originado no browser/beacon) ou `webhook` (originado no gateway). **NAO existe `server`** — `channel` codifica a origem, nao o transporte.
> - `source`: `browser` (linha de ingestao `platform='collect'`), `collect` (envio disparado a partir do beacon) ou o **nome do gateway** (envio a partir de webhook).
> - Cada envio a uma plataforma vira uma linha (`platform='meta_ads'`, `'tiktok_ads'`, ...); a linha `platform='collect'` e so o log de entrada do beacon, nao um envio.
> - O pixel do **browser** (`fbq`) dispara client-side e **nao** aparece em `events` — o banco so registra os envios server-side (CAPI/MP/Events API) e o log do beacon. A comparacao "Navegador x Servidor" e exclusiva do Gerenciador (Camada 1).

### 2.1 Pulso por plataforma
Ja coletado em 0.3. Plataforma do baseline **sem nenhuma linha** → falha silenciosa: conferir se ela
esta no `SITE_CONFIG` e se os secrets existem (`npx wrangler secret list`).

### 2.1b Hosts que chegam ao Worker (page builder / host alternativo)
De quais hosts os beacons chegam (o host sai da `page_url` da linha de ingestao):
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT substr(r, 1, instr(r || '/', '/') - 1) AS host, COUNT(*) AS beacons, MAX(ts) AS ultimo FROM (SELECT substr(u, instr(u, '://') + 3) AS r, ts FROM (SELECT json_extract(sent_payload,'\$.page_url') AS u, timestamp AS ts FROM events WHERE site_id = '{site_id}' AND platform = 'collect' AND timestamp >= datetime('now','-{X} days'))) GROUP BY host ORDER BY beacons DESC;"
```
- **Esperado:** so os hosts do dominio que o cliente usa (`{dominio}`, `www.`, subdominios de LP).
- **Host de plataforma na lista** (`*.pages.dev`, `*.vercel.app`, `*.netlify.app`, preview de
  builder) → ha trafego real pelo host alternativo, chegando ao Worker por `collect_url` absoluto.
  Ali a identidade e cookie de terceiro → `ATENCAO`: redirecionar o host (`infra.md` 0.11b).
- **Host que o cliente diz ter o script e nao aparece** → o beacon morre antes do Worker: `FALHA`.
  ⚠️ **No host quebrado nao existe linha nenhuma** — o banco nao mostra o que nunca chegou, entao a
  ausencia e o unico sinal. Confirmar pelo destino servido e pelo host:
  ```bash
  curl -s "https://{dominio}/tracking/web.js?site_id={site_id}" | grep -o '"collect_url":"[^"]*"'
  curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "https://{host-alternativo}/"
  ```
  `"/collect/event"` com a pagina fora do host das routes (page builder, `track.{dominio}`) → falta o
  `collect_url` absoluto (`overview.md` Step 2). Host alternativo respondendo `200` em vez de `301`
  → aplicar o redirect (`infra.md` 0.11b). Roteiro completo no `overview.md` 5.1.

### 2.2 Config declarada x banco entrega
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT DISTINCT event_name, platform, channel FROM events WHERE site_id = '{site_id}' ORDER BY event_name, platform;"
```
Comparar com os eventos/plataformas/canais do `tracking_memory`. Divergencia = config X realidade.

### 2.3 Taxa de erro por plataforma/evento (modular)
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT platform, event_name, status_code, COUNT(*) AS n, MAX(error_message) AS erro FROM events WHERE site_id = '{site_id}' AND timestamp >= datetime('now','-{X} days') GROUP BY platform, event_name, status_code ORDER BY platform, event_name;"
```
Interpretar **por plataforma**: GA4 `204` = sucesso; Meta `200` pode trazer `fbtrace`/erro no
`response_payload`; etc. Para o significado da resposta de cada API, ver a doc da plataforma (lista
no fim desta Camada) — **somente leitura, sem reexecutar setup**.

### 2.3b Falha de transporte — o secret com whitespace que se disfarca de erro de rede

**Reproduzido em producao 2x** (clientes e gateways diferentes, ambos com operador Windows/PowerShell).
Todo envio de uma plataforma gravando `status_code = 0` + `Error: Network connection lost.` em ~37ms
**nao** e erro de rede: e o valor **armazenado no cofre** com whitespace. Subir secret por pipe
(`echo "{token}" | wrangler secret put`) no PowerShell acrescenta CRLF; o header vira
`Authorization: Bearer <token>\r\n` e o runtime derruba a conexao antes da resposta.

O sintoma aponta para o lugar errado — parece rede, parece bloqueio de saida do Worker, parece
instabilidade da plataforma. **Nao investigar rede antes de descartar o secret.**

| Assinatura em `events` | Causa provavel | Correcao |
|---|---|---|
| `status_code = 0` + `Network connection lost` (ou prefixo `fetch_failed:`) em **uma** plataforma, enquanto as outras respondem | Secret daquela plataforma gravado com whitespace | Reenviar por `wrangler secret bulk` e refazer o teste (ver o aviso de propagacao abaixo) |
| `status_code = 0` + `Network connection lost` em **todas** as plataformas | Ai sim, saida do Worker | Testar `GET https://{dominio}/scripts/ga.js` — se responder (traz o script do googletagmanager), a saida esta boa e o problema e credencial |
| `status_code = 400` com corpo **HTML** (`<title>Facebook \| Error</title>`) em vez de JSON | Requisicao rejeitada na borda por **header malformado** — mesma causa do `status_code = 0`, outra assinatura | Tratar como whitespace no secret: reenviar por `secret bulk`. **Nao** investigar o `sent_payload` |
| `status_code = 0` + `invalid_access_token_whitespace` / `invalid_api_secret_whitespace` | Guard do codigo: whitespace **no meio** do valor (colagem quebrada em duas linhas) | Reenviar o secret por `secret bulk`, em uma linha so |
| `status_code = 0` + `missing_access_token` / `missing_pixel_id` | Secret nunca foi criado (ou config sem o ID) | `npx wrangler secret list` e recriar por `secret bulk` |
| `error_message` com prefixo `body_read_failed:` (status **preservado**, nao zerado) | A resposta **chegou** e a excecao veio de ler o corpo — o evento **pode ter sido aceito** | Conferir duplicidade na plataforma **antes** de reenviar; nao e caso de credencial |

> **Regra que generaliza para qualquer plataforma:** resposta **HTML** onde a API sempre devolve JSON
> = requisicao malformada no **transporte**. Olhe o header, nao o corpo.

**AVISO DE PROPAGACAO — nunca reprovar a hipotese no reteste imediato.** Subir secret cria uma nova
versao do Worker, e ela leva alguns instantes para propagar no edge. Na segunda reproducao o teste
logo apos o `secret bulk` voltou `Network connection lost` de novo, e a causa correta chegou a ser
dada como descartada antes de um segundo teste, minutos depois, passar (`200`). Depois de regravar o
secret, **aguarde a propagacao antes de concluir qualquer coisa**: um `status_code = 0` no teste
imediato **nao** invalida a hipotese de whitespace. Repita o disparo; so trate como "nao resolvido"
se falhar tambem numa segunda tentativa espacada.

**Roteiro de descarte** (o que funcionou nas duas implantacoes — nao refazer a investigacao do zero):

1. **Descartar o browser** — reproduzir com POST server-side direto no beacon:
   ```bash
   curl -s -X POST "https://{dominio}/collect/event" -H "Content-Type: application/json" \
     -d '{"site_id":"{site_id}","event":"page_view","event_id":"diag","marca_user":"diag","page_url":"https://{dominio}/","browser_data":{},"user_data":{},"utm_data":{}}'
   ```
   Se a falha se repete sem browser nenhum, o problema esta no Worker/credencial.
2. **Descartar a saida do Worker** — `curl -s "https://{dominio}/scripts/ga.js" | head -c 200` (ou
   `/fb/sdk.js`, que busca o fbevents.js na Meta). Se o Worker consegue buscar um script externo, a
   saida esta boa.
3. **Descartar a credencial — por ENVIO, nunca por leitura.** Enviar um `PageView` sintetico direto a
   Graph API, fora do Worker, com o mesmo token:
   ```bash
   curl -s -X POST "https://graph.facebook.com/v21.0/{pixel_id}/events" \
     -H "Authorization: Bearer {token}" -H "Content-Type: application/json" \
     -d '{"data":[{"event_name":"PageView","event_time":{epoch_s},"event_id":"diag","action_source":"website","user_data":{"external_id":["diag"]}}]}'
   ```
   - `{"events_received":1}` → credencial e permissao OK → o problema esta no **valor armazenado**.
   - Erro OAuth → ai sim a credencial e o problema.
4. Sobrou o **valor armazenado no cofre** → reenviar o **mesmo** token por `wrangler secret bulk` e
   retestar (respeitando o aviso de propagacao).

> **NAO validar token de CAPI por leitura.** `GET graph.facebook.com/v21.0/{pixel_id}` da **falso
> negativo**: um token de CAPI perfeitamente funcional pode nao ter permissao de *leitura* e devolver
> `{"error":{"message":"(#100) Missing Permission","code":100}}` enquanto o **envio** com o mesmo
> token responde `{"events_received":1}`. Quem le o `(#100)` como "token ruim" pede um token novo ao
> cliente — e o token novo, subido pelo mesmo pipe quebrado, falha igual. **Permissao de leitura do
> pixel nao e requisito da CAPI.**

Ao corrigir, orientar sempre o comando portavel — `npx wrangler secret bulk secrets.json` (apagando o
arquivo em seguida), **nunca** `echo | wrangler secret put`. Detalhe no Step 3b do
`.claude/playbooks/overview.md`.

### 2.4 Cobertura de parametros (calculada do nosso lado)
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, channel, sent_payload FROM events WHERE site_id = '{site_id}' AND platform = 'meta_ads' AND timestamp >= datetime('now','-{X} days') ORDER BY id DESC LIMIT 50;"
```
Medir a % de presenca de cada chave no `user_data` do Meta (`em`, `ph`, `fn`, `ln`, `external_id`,
`client_ip_address`, `client_user_agent`, `fbp`, `fbc`). Para as outras plataformas o `sent_payload`
tem formato proprio — repetir trocando `platform` (`tiktok_ads`, `google_analytics_4`). Comparar a
cobertura entre `channel='web'` (eventos de browser) e `channel='webhook'` (compras) ajuda a isolar
onde o dado falta. Ao reportar, lembrar a **origem** de cada parametro:

| Parametro | Origem | Onde validar veracidade (valor cru) |
|---|---|---|
| geo (city/state/country) | Cloudflare via IP (browser) | `user_store` |
| fbp/fbc/ttp/ttclid/ga_* | so browser | `user_store` |
| email/phone/name | **web (form)** ou webhook | `user_store` (lead) / `webhook_raw.payload` (compra) |
| value/currency/product/order_id | so webhook | `webhook_raw.payload` |

**`fbp` no `PageView` (Meta).** O `fbp` do `PageView` vem do cookie `_fbp`, que o pixel so cria depois
de carregar: na 1a pagina, ate a 1.9.0, o beacon saia antes dele. Desde a 1.9.1 o `page_view` espera o
`_fbp` (teto de 3 s) — ver `.claude/playbooks/meta_ads.md`. % de `PageView` com `fbp` no
`sent_payload` (repetir com a janela de antes e de depois do deploy para comparar):
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) AS pageviews, SUM(json_valid(sent_payload)) AS legiveis, SUM(CASE WHEN json_valid(sent_payload) THEN json_extract(sent_payload,'$.data[0].user_data.fbp') IS NOT NULL ELSE 0 END) AS com_fbp, ROUND(100.0 * SUM(CASE WHEN json_valid(sent_payload) THEN json_extract(sent_payload,'$.data[0].user_data.fbp') IS NOT NULL ELSE 0 END) / MAX(SUM(json_valid(sent_payload)), 1), 1) AS pct_fbp FROM events WHERE site_id = '{site_id}' AND platform = 'meta_ads' AND channel = 'web' AND event_name = 'PageView' AND timestamp >= datetime('now','-{X} days');"
```
`pct_fbp` e sobre as linhas `legiveis` (o `sent_payload` e cortado em 2000 caracteres; URL muito longa
deixa o JSON ilegivel). Baixo mesmo na 1.9.1 = pixel bloqueado/lento no navegador desses visitantes
(sai no teto sem `fbp`) — o proxy `pixel_proxy` resgata parte deles.

### 2.4b GA4 — `204` em tudo e o relatorio por pagina vazio

**Rodar so quando o baseline tiver GA4.** O sintoma que o cliente ve: no GA4, **usuario ativo no Tempo
real sem nenhuma visualizacao** ("Nenhum dado disponivel" em *Visualizacoes por titulo da pagina*),
paginas sem titulo, ou **usuario sem cidade**. O `204` do Measurement Protocol **nao prova nada** aqui:
o MP aceita o evento mesmo quando ele nao vai aparecer onde o cliente olha. O usuario ativo vem dos
eventos automaticos do gtag do navegador (que roda com `send_page_view: false`); o `page_view` e so o
do MP — se ele chega sem titulo, sem sessao ou com a data errada, a pagina some do relatorio.

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, COUNT(*) n, SUM(error_message='missing_ga_client_id') sem_cid, SUM(CASE WHEN json_valid(sent_payload) THEN json_extract(sent_payload,'$.events[0].params.page_title')<>'' ELSE 0 END) com_titulo, SUM(CASE WHEN json_valid(sent_payload) THEN json_extract(sent_payload,'$.events[0].params.session_id') IS NOT NULL ELSE 0 END) com_sessao, SUM(CASE WHEN json_valid(sent_payload) THEN json_extract(sent_payload,'$.timestamp_micros') IS NOT NULL ELSE 0 END) com_timestamp, SUM(CASE WHEN json_valid(sent_payload) THEN json_extract(sent_payload,'$.ip_override') IS NOT NULL ELSE 0 END) com_ip FROM events WHERE site_id = '{site_id}' AND platform = 'google_analytics_4' AND timestamp >= datetime('now','-{X} days') GROUP BY event_name;"
```
(`CASE WHEN json_valid` e obrigatorio: as linhas de erro tem `sent_payload` vazio, e o SQLite nao garante
curto-circuito no `AND` — o `json_extract` estoura com `malformed JSON`.)

**Saudavel (1.9.0+):** `com_titulo` e `com_sessao` = enviados, `com_timestamp = 0`, `com_ip` = enviados,
`sem_cid` em poucos % (gtag bloqueado / visitante que saiu antes de ele carregar).

| Assinatura | Causa | Estado |
|---|---|---|
| `page_view` com `com_titulo = 0` (e `begin_checkout`/`contact` com titulo) | Beacon disparado antes do `<title>` ser lido (o script e o 1o do `<head>`) | Corrigido na 1.9.0: o page_view espera o titulo |
| `com_sessao = 0` em tudo, e `user_store.ga_session_id` vazio para todos | Leitura do cookie `_ga_<ID>` nao casava com o formato `GS2` (`s…$o…$t…`) nem com o `GS1` | Corrigido na 1.9.0 |
| `com_timestamp > 0` | `timestamp_micros` = ultimo hit do cookie + 60s: page_view ~1 min no **futuro**, visitante que volta datado horas/dias **atras** (o GA4 trava em 72h) — fora do Tempo real e no dia errado | Corrigido na 1.9.0: o Worker nao manda mais |
| `sem_cid` alto so no `page_view` (dezenas de %) | 1a pagina do visitante novo, antes de o gtag criar o `_ga` | Corrigido na 1.9.0: o page_view espera o gtag (teto de 3 s). O resto e gtag bloqueado ou saida antes de ele carregar |
| `com_ip = 0` | MP sem `ip_override`/`user_agent` (GA4 deriva cidade e aparelho dos eventos de tag) | Corrigido na 1.9.0 |

Se alguma assinatura aparecer numa instalacao **1.9.0 ou mais nova**, o codigo no ar e anterior a
correcao — conferir a versao no ar (Step 0.1) antes de investigar. Em instalacao antiga, e o motivo
para atualizar (`.claude/playbooks/atualizar.md`).

**"Usuario online sem cidade" (ou todo mundo na mesma cidade).** A doc do MP: sem `ip_override` /
`user_location`, o GA4 deriva a geografia "dos eventos de tag pelo `client_id`" — os do gtag, que
passam pelo proxy `/g/collect`. Se o proxy nao repassa o IP do visitante, o Google geolocaliza o IP
da Cloudflare. Desde a 1.9.0 o MP manda `ip_override`/`user_agent` (coluna `com_ip` acima) e o proxy
repassa `_uip` + `X-Forwarded-For`. A prova final e no GA4: Tempo real > *Usuarios por cidade* com a
cidade real do visitante (comparar com `user_store.city`, que vem da Cloudflare). O `_uip` e evidencia
de terceiros (o parametro do GTM server-side do Google), nao doc publica — se a cidade dos eventos
**automaticos** continuar errada com o `com_ip` cheio, registrar e nao insistir no proxy.

> **Leitura que evita alarme falso:** o card **"Finalizacoes de compra"** do GA4 e o `begin_checkout`
> (checkout **iniciado** — o `initiate_checkout` do VT), nao venda. No caso real, os 7 do card bateram
> com os 7 `begin_checkout` do D1. Venda e `purchase` / "Receita de compra".

### 2.5 Veracidade (NAO no `sent_payload` — esta hasheado)
O `sent_payload` guarda o PII **hasheado** (SHA-256): prova presenca, nao veracidade. Para checar
email fake/teste ou normalizacao errada **antes** do hash, inspecionar o **valor cru**:
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT email, phone, city, state, country FROM user_store WHERE updated_at >= datetime('now','-{X} days') ORDER BY updated_at DESC LIMIT 30;"
```
E o `webhook_raw.payload` para compras. Sinalizar padroes obviamente invalidos (ex: `test@test`,
vazio, telefone sem digitos, nome em caixa errada).

### 2.6 marca_user x FDV — CORACAO da auditoria
O `marca_user` e o indexador que cruza com o webhook via FDV no `Purchase`. **Se ele falha, a compra
chega sem os dados do browser (fbp, fbc, geo, email) — atribuicao cega.** Este e o elo mais critico
do VT: nao pode passar. Para compras no periodo, cruzar `webhook_raw` (indexador no payload) com
`user_store` e com o `sent_payload` da compra em `events`.

Quando o **Purchase chega sem `fbp`/`fbc`/`external_id`**, percorrer a **cadeia inteira** de tras pra
frente — nunca concluir "direto ao checkout" sem antes descartar a falha tecnica (ver a cadeia dos 5
elos em `.claude/references/marca-user.md`):

1. **(parser) `webhook_raw.payload` tem o campo do indexador?** Sim mas o parser retornou vazio →
   corrigir o `path` em `src/worker/gateways/{gateway}.js`. Nao tem no raw → seguir.
2. **(injecao) `gateways_config`** tem o `indexador` certo (`xcod` Hotmart, `sck` Kiwify,
   `marca_user` Hubla/Lastlink/Tutory, `utm_perfect` PerfectPay)? A URL do checkout carrega o
   parametro? (confirmar na Camada 3 — URL pos redirecionamento). Errado/ausente → corrigir config e
   re-deploy.
3. **(persistencia) o cookie sobrevive entre paginas/dominios?** Checkout em dominio diferente,
   bloqueio de cookie (incognito/ITP), `web.js` carregado tarde → `?debug=1` deve mostrar o **mesmo**
   `marca_user` entre paginas (Camada 3).
4. **(criacao) o cookie chega a existir?** `?debug=1` sem `marca_user` nenhum → `web.js` nao rodou
   (script ausente/bloqueado) → caso de instalacao (Step 5), nao de parser.
5. **Sem nenhum sinal de passagem pelo site** (sem evento web, sem cookie em momento algum) →
   **(A) esperado:** comprador foi direto ao checkout. Nunca classificar como "organico".

#### 2.6b Linha `fdv` — o fallback por IP (`fdv.ip_fallback`)

Com `fdv.ip_fallback` ligado no `SITE_CONFIG`, toda venda **sem indexador, sem e-mail conhecido e com
IP no payload** deixa uma linha `platform='fdv'` (ordem do FDV merge: sck → e-mail → IP — ver
`.claude/references/marca-user.md`, "Fallback por IP do dispositivo"):

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT timestamp, event_name, event_id, status_code, error_message, marca_user, source_ip, sent_payload FROM events WHERE site_id = '{site_id}' AND platform = 'fdv' AND timestamp >= datetime('now','-{X} days') ORDER BY id DESC LIMIT 20;"
```

- **`fdv_ip_match` (200):** identidade recuperada pelo IP; o `marca_user` da linha e o visitante
  escolhido. Olhar `ambiguo` no `sent_payload`: `true` = mais de um visitante clicou no checkout
  daquele IP na janela (`candidatos` diz quantos) e ficou o clique mais recente — confirmar com o
  cliente quando a venda importar (casal no mesmo wifi, CGNAT de operadora movel).
- **`fdv_ip_no_match` (0, `ip_sem_visita_com_checkout_na_janela`):** ninguem daquele IP clicou no
  checkout dentro de `window_hours`. Ou e (A) legitimo (direto ao checkout; venda do agente de vendas
  do gateway), ou o IP mudou entre o beacon e o pagamento (IPv6 x IPv4, troca 4G → wifi), ou o
  boleto/Pix foi aprovado depois da janela. Para separar, rodar a consulta de "Cuidado antes de
  concluir (A)" do `marca-user.md` com janela maior e sem exigir checkout.
- **`status_code = 0` nesta linha nao e falha de envio** — nada e enviado a plataforma nenhuma. Nao
  somar na taxa de erro da 2.3.
- **Flag ligada e nenhuma linha `fdv`** com vendas sem `marca_user` no periodo: o e-mail recuperou
  antes (passo 4b) ou o payload veio sem IP — gateway cujo parser nao le IP (tabela "IP do payload =
  aparelho?" em `.claude/references/gateway-webhooks.md`). Com indexador presente, mesmo desconhecido
  no `user_store`, o fallback nao roda.
- **Gateway ⬜ naquela tabela com a flag ligada** → recomendar desligar ate conferir a premissa
  (`new-gateway`, Passo 8): o risco e atribuir a venda ao visitante errado.

#### GA4 — "a venda nao apareceu no GA4" (receita do GA4 abaixo da do gateway)

**Rodar so quando o baseline tiver GA4.** O Measurement Protocol exige `client_id`: venda que chega sem
a identidade do navegador **nao vai ao GA4**. Desde a 1.9.0 isso deixa linha (antes era um `return`
mudo — a venda sumia do GA4 sem rastro):

```sql
SELECT e.event_id, e.marca_user, e.sent_payload, e.timestamp
  FROM events e
 WHERE e.site_id = '{site_id}' AND e.platform = 'google_analytics_4' AND e.event_name = 'purchase'
   AND e.error_message = 'missing_ga_client_id'
   AND e.timestamp >= datetime('now','-{X} days')
 ORDER BY e.id DESC;
```

O `event_id` e o mesmo da linha da Meta (`order_id` + `product_id`) — cruzar com o `webhook_raw` do
pedido e percorrer a cadeia acima (`marca_user_presente: false` no `sent_payload` = a venda chegou sem
nenhum `marca_user`; `true` = havia indexador, mas o visitante nunca teve o `_ga` gravado no
`user_store` — gtag bloqueado, ou o `sck` nao e do VT).

**Por que aparece "de repente":** enquanto existia um emissor antigo (integracao nativa do gateway,
Stape/sGTM), ele mandava **toda** venda ao GA4 e mascarava o buraco. Quando o cliente desliga o antigo
(o certo), toda venda sem identidade some e a receita do GA4 despenca — caso real: "Receita de compra
R$ 0,00" com duas vendas no periodo. Assinaturas reais, lidas no `webhook_raw.payload` (campos da Kiwify):

| No payload | Leitura |
|---|---|
| `TrackingParameters.sck` com formato que **nao e do VT** (VT = `{ms}-{uuid}`), ex. `{ms}-{ms}.{n}.{n}`, e sem linha no `user_store` | Link de checkout **antigo/salvo** (indexador de antes do VT, recuperacao de carrinho). O `sck` nao recupera; o e-mail (FDV por e-mail) ou o IP (`fdv.ip_fallback`, se ligado) ainda podem |
| `TrackingParameters.src = "kiwify_sales_agent"` | Venda feita pelo **agente de vendas da Kiwify**, fora do site. Nao ha navegador para atribuir — caso (A) legitimo |

**Correcao para a receita bater:** `platforms.ga4.unattributed_purchases: true` (opt-in) — a venda sai
com `client_id` sintetico e grava `204` + `aviso_client_id_sintetico` (nao e erro). **Antes de ligar,
confirmar que nao ha outro emissor de purchase no GA4** (contaria em dobro). Ver
`.claude/references/site-config-format.md`. Venda perdida ha **menos de 72h** pode ser reenviada so
ao GA4 — secao GA4 do `.claude/playbooks/reenvio_dados.md`.

> **GA4 com valor/ID diferentes dos do VT = outro emissor.** O VT envia `transaction_id = order_id`
> (UUID na Kiwify) e `value` = valor pago. Receita igual a `my_commission` e ID curto (um `order_ref`
> curto) = webhook antigo (Stape/sGTM) ou integracao nativa do gateway ainda ligados → GA4 conta 2x.

### 2.7 Reconciliacao de volume
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) AS webhooks, SUM(processed) AS processados FROM webhook_raw WHERE site_id = '{site_id}' AND timestamp >= datetime('now','-{X} days');"
```
Comparar `webhooks` x `events` Purchase com status 2xx x vendas que o cliente sabe que houve. Sobra
em `webhook_raw` com `processed = 0` ou `error` preenchido → vendas perdidas (investigar `error`).

**`shadow` esquecido.** Webhooks com `processed = 1` e o `events` do webhook so com `status_code = 0` +
`shadow_mode` → a chave `purchase_dispatch: "shadow"` ficou no config e **nenhuma venda chega as
plataformas**:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) AS linhas_shadow, MAX(timestamp) AS ultima FROM events WHERE site_id = '{site_id}' AND error_message LIKE 'shadow_mode%' AND timestamp >= datetime('now','-{X} days');"
```

`ultima` depois do `shadow_desligado_em` da memoria (ou sem `shadow` registrado) → remover a chave e
deployar (`overview.md`, 5.4.4). Excecao: `shadow` intencional registrado na memoria (validacao do
`saas.md`, Passo 7). As vendas do intervalo ficaram fora das plataformas — listar com a consulta de
`atualizar.md` ("Teste de webhook com a instalacao em producao").

**Venda de teste despachada como venda real.** O webhook de teste do gateway (simulacao do painel,
compra de teste) chega como compra aprovada; sem `shadow` no ar na hora, vira `Purchase` real. Sobra de
Purchase 2xx contra as vendas que o cliente conhece costuma ser isto. Candidatos = webhook com marcador
de teste no payload **e** envio 2xx a algum destino:

```bash
npx wrangler d1 execute tracking_db --remote --command "
SELECT * FROM (
  SELECT w.id, w.timestamp, w.gateway, w.order_id, w.value,
    (SELECT GROUP_CONCAT(e.platform || ' ' || e.event_name || ' ' || e.status_code, ', ')
       FROM events e
      WHERE e.site_id = w.site_id AND e.channel = 'webhook'
        AND e.platform IN ('meta_ads', 'tiktok_ads', 'google_analytics_4', 'google_ads', 'sheets')
        AND e.status_code BETWEEN 200 AND 299
        AND e.timestamp BETWEEN w.timestamp AND strftime('%Y-%m-%dT%H:%M:%fZ', w.timestamp, '+60 seconds')
        AND instr(COALESCE(w.order_id, ''), e.event_id) = 1) AS despachado_2xx
  FROM webhook_raw w
  WHERE w.site_id = '{site_id}' AND w.timestamp >= datetime('now','-{X} days')
    AND (lower(w.payload) LIKE '%@example.com%' OR lower(w.payload) LIKE '%john doe%'
      OR lower(w.payload) LIKE '%johndoe%' OR lower(w.payload) LIKE '%example product%'
      OR lower(w.payload) GLOB '*[^a-z]test[^a-z]*' OR lower(w.payload) GLOB '*[^a-z]teste[^a-z]*')
) WHERE despachado_2xx IS NOT NULL ORDER BY id DESC;"
```

- `despachado_2xx` lista o que cada destino aceitou (`meta_ads Purchase 200, meta_ads Purchase 200,
  tiktok_ads Purchase 200` = 2 pixels + TikTok). Teste feito sob `shadow` nao aparece (`status_code 0`) — nem a
  linha `platform = 'fdv'` do merge por IP, que grava `200` no `fdv_ip_match` mas nao e envio a
  destino nenhum (por isso o filtro de `platform`).
- **Por que janela de 60 s + prefixo, e nao `event_id = order_id`:** Meta, Google Ads e (desde a 1.9.0) o
  GA4 gravam o envio com o mesmo `order_id` do `webhook_raw`; o TikTok grava `event_id` vazio e a
  planilha grava o `order_id` cru (sem o `_{product_id}`). Igualdade simples perde esses destinos.
  Efeito colateral: outra venda no mesmo minuto pode somar uma linha de TikTok a lista — a selecao do
  teste nao muda.
- **Confirmar no payload antes de concluir** (`SELECT payload FROM webhook_raw WHERE id = {id};`): o
  marcador e candidato, nao veredito — comprador real pode ter nome parecido, ou o produto ter "teste"
  no nome. A heuristica serve a esta revisao humana, **nunca** para filtrar despacho no codigo.
- **Retencao:** o `events` guarda 7 dias e o `webhook_raw` 14 (`src/worker/shared/cleanup.js`) — usar
  `X <= 7`. Teste de 8 a 14 dias atras so aparece no `webhook_raw` (rodar o `SELECT` interno, sem o
  filtro de fora): `processed = 1` sem `shadow` registrado na memoria para aquela data = foi despachado.

O que fazer (o VT nao tem rotina de remocao em destino nenhum):

| Destino | O que da para fazer |
|---|---|
| Meta | Nao ha remocao. Registrar no `tracking_memory.md` (data, valor, `order_id`, pixels) e descontar na leitura do periodo |
| GA4 | O `transaction_id` e o `order_id` do gateway (o da consulta sem o `_{product_id}`) e fica no relatorio — usar para identificar e excluir nas analises |
| TikTok / Google Ads | O VT nao envia retratacao — registrar e descontar como na Meta |
| Planilha (`sheets`) | Apagar a linha do pedido a mao |

Sinal para o cliente, em linguagem de negocio: *"No dia {data}, a {gateway} mandou um webhook de teste e
ele contou como venda de R$ {valor} na Meta/TikTok. Na Meta nao da para apagar; anotei a data para
descontarmos na leitura desse periodo. Os proximos testes passam pelo modo de validacao, que nao envia
nada as plataformas."* Proximo teste: so sob `shadow` (`overview.md` 5.4, ou `atualizar.md` em
producao).

### 2.8 Duplicatas / order bump
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT order_id, COUNT(*) AS n FROM webhook_raw WHERE site_id = '{site_id}' AND order_id IS NOT NULL GROUP BY order_id HAVING n > 1 ORDER BY n DESC LIMIT 20;"
```
O `order_id` ja inclui `product_id` (dedup nao bloqueia order bump). Confirmar que o dedup nao
disparou dobrado nem bloqueou bump legitimo.

### 2.9 Espelhos Meta
Se ha `pixel_ids_mirror` no baseline: confirmar que cada pixel tem linha em `events` (um espelho
mudo = atribuicao perdida).

### 2.10 Google Ads — conversao offline que "chega" e nao aparece

Tres armadilhas distintas moram aqui, e cada uma se disfarca das outras. **Nao mexer em credencial,
secret ou payload antes de separar as tres.**

**Armadilha A — log verde, zero envio.** Ate a 1.5.0 o conector gravava `status_code = 200` com
`web-only: dispatched via gtag in browser` **em qualquer canal**, e o default de `channel` era
`server`. Num site com `channel` omitido ou em `server`, o navegador **nao** dispara (`web.js` exige
`google_ads_channel === 'web'`) e o Worker registrava sucesso mesmo assim: **zero conversao no Google
Ads com o D1 inteiro verde**. Da 1.6.0 em diante o canal `server` grava `status_code = 0` +
`canal_server_nao_despacha_navegador`, e o default virou `web`.

**Armadilha B — `EXCELLENT` com `0,00`.** Ver o bloco proprio abaixo.

**Armadilha C — canal `web` verde com o destino `AW-` nunca configurado.** Ate a 1.8.0 o `web.js` so
emitia `gtag('config')` para o GA4. O destino `AW-` nao era configurado na carga da pagina, e a
conversao de navegador dependia do gtag carregar o destino no proprio clique, correndo contra os
500 ms da navegacao — no caso real, **zero** requisicao com o rotulo. **Sem GA4** no config era pior:
o `gtag` nem existia, o `ReferenceError` abortava o beacon e o evento sumia de **todas** as plataformas
(Meta CAPI, TikTok, GA4). O D1 gravava `google_ads | web | 200` o tempo todo. Depois da correcao, a
linha `web` com rotulo segue `200`, mas com `error_message` `web: despacho do navegador nao confirmado
pelo servidor ...` — o Worker so sabe que o **beacon** chegou, nunca que o gtag despachou.

| Assinatura em `events` | Causa provavel | Correcao |
|---|---|---|
| `google_ads` com `200` e `web-only: dispatched via gtag` em **qualquer** canal | Instalacao **pre-1.6.0** — log mentiroso, nao prova nada | Conferir a versao no ar (0.1). Ate atualizar, validar o Google Ads pelo Tag Assistant, nunca pelo D1. Para atualizar: `.claude/playbooks/atualizar.md` |
| `google_ads` / `web` com `200`, `error_message` **vazio** e `sent_payload` `web: gtag conversion send_to=...` | Instalacao **1.6.0 a 1.8.0** — Armadilha C: o destino `AW-` nao era configurado no gtag; o `200` so prova que o beacon chegou | Atualizar (`atualizar.md`). Ate la, provar no navegador (abaixo) |
| `google_ads` / `web` com `200` + `web: despacho do navegador nao confirmado pelo servidor` | **Normal** — o servidor nao enxerga o gtag | Provar no navegador (abaixo), nunca pelo D1 |
| Site **sem GA4**, versao **<= 1.8.0**: evento com rotulo do Google Ads (ex.: `contact`) **sem nenhuma linha** em `events`, enquanto o `page_view` aparece | Armadilha C: o `ReferenceError` do `gtag` abortava o beacon — o evento sumiu de **todas** as plataformas | Atualizar. Nao e falha de Meta/TikTok/GA4: o evento nunca saiu do navegador |
| Aviso `colunas de click id ausentes` no log do Worker (`wrangler tail`) | Codigo 1.6.0 deployado sem a `migrations/003` | **Nada quebrou** — o `user_store` segue gravando. Rodar a migracao habilita o `gclid`, sem novo deploy |
| `status_code = 0` + `canal_server_nao_despacha_navegador` | `channel: "server"` com evento de navegador. Correto e honesto: nada foi despachado | Trocar para `channel: "web"`. Os dois canais convivem — web por rotulo, webhook por id numerico |
| `status_code = 0` + `missing_conversion_label_{evento}` | Opt-in: aquele evento nao tem rotulo no config | Preencher `conversion_label_{evento}`, ou ignorar se o evento nao deve ser conversao |
| `status_code = 0` + `conversion_action_not_found` | `conversion_action_id_purchase` vazio. Acao de **importacao** (`UPLOAD_CLICKS`) **nao tem rotulo** — procurar por rotulo sempre falha | Pegar o id numerico no painel (`ctId=` na URL da acao) e preencher `conversion_action_id_purchase` |
| `status_code = 0` + `missing_google_ads_oauth` / `invalid_google_ads_credential_whitespace` | Secret ausente ou com whitespace | `npm run gads:oauth` e subir por `wrangler secret bulk` (ver 2.3b) |
| `403` + `api_nao_habilitada` | **Data Manager API desligada** no projeto do Google Cloud — o passo mais esquecido da implantacao | Cloud Console > APIs e servicos > Biblioteca > "Data Manager API" > Ativar |
| `403` + `escopo_oauth_insuficiente` | Refresh token emitido so com `adwords` | Reemitir com `npm run gads:oauth` (pede `adwords` **+** `datamanager`). **Token antigo nunca ganha escopo novo** |
| `400` + `conversion_upload_bloqueado` | `upload_api: "conversion_upload"` em conta nao allowlisted | Trocar para `data_manager` (ou remover o campo — e o default) |
| `400` + `DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS` no `error_message`, so nas vendas **sem** `gclid` | **"Conversões otimizadas para leads" desligada na conta.** E pre-requisito bloqueante: venda so com e-mail/telefone (a maioria) e recusada; com `gclid` passa — por isso o erro aparece numa parte das vendas e um teste com `gclid` nao o mostra | Google Ads > Metas > Conversoes > Configuracoes > "Conversões otimizadas para leads" > ativar + método "Tag do Google" > Salvar. Confirmar pela linha recolhida "Gerenciadas usando a tag do Google" e pela consulta de pre-requisitos abaixo. **Nao** e a secao "Conversões otimizadas" (sem "para leads"), que nao destrava o upload |
| `200` + `partial_failure: ...EXPIRED_CLICK` | A Google **aceitou o request e descartou a conversao** (clique fora da janela) | Nao e bug: e venda de um clique antigo demais |
| `200` sem `error_message` | Request aceito. **So isso** — o casamento com o clique e assincrono | Provar pelas consultas abaixo, nunca pelo D1 |

> **A regra que generaliza:** `200` da Data Manager significa **request aceito**, nao conversao
> registrada. O D1 prova que **nos enviamos**; so o diagnostico da propria Google prova que **ela
> casou**. Auditar conversao offline pelo D1 e o erro classico.
>
> No canal `web` e ainda menos: quem envia e o navegador, e o D1 **nem prova que enviamos** — so que
> o beacon chegou. Conversao de navegador se valida no navegador.

**Prova da conversao de navegador (canal `web`) — no navegador, nunca no D1.** Abrir o site com
`?debug=1` e o DevTools:

1. Console: `[Tracking] Google Ads (web) configurado: AW-...` na carga. Ausente → `channel` diferente
   de `web`, `conversion_id` vazio, ou versao **<= 1.8.0** (Armadilha C).
2. Aba **Network** (marcar *Preserve log*), filtro = o **numero** do `AW-`. Na **carga** ja aparecem
   requisicoes com ele (`gtag/js?id=AW-...`, `viewthroughconversion/<numero>`) — e o destino
   configurado. Ao **disparar** o evento (ex.: clique no WhatsApp para o `contact`):
   `pagead/conversion/<numero>/` e/ou `pagead/1p-conversion/<numero>/` **com o rotulo do evento na
   URL**. Sem requisicao com o rotulo, a conversao nao saiu.
3. Alternativa sem DevTools: **Google Tag Assistant** (`tagassistant.google.com`) — a conversao
   aparece com o `send_to` `AW-.../rotulo`.

Sem requisicao com o rotulo, conferir nesta ordem: `channel: "web"`, `conversion_label_{evento}`,
`conversion_id`, versao no ar (0.1). Evento **sem** rotulo no config nao dispara — por design (opt-in).

**Prova definitiva — o diagnostico da propria Google** (Google Ads > Ferramentas > Editor de
consultas, ou via API). Pedir ao cliente ou rodar com as credenciais do onboarding:

```
# a foto geral do upload
SELECT offline_conversion_upload_client_summary.status,
       offline_conversion_upload_client_summary.total_event_count,
       offline_conversion_upload_client_summary.successful_event_count,
       offline_conversion_upload_client_summary.success_rate,
       offline_conversion_upload_client_summary.pending_event_count
FROM offline_conversion_upload_client_summary

# o mesmo POR ACAO — separa aquisicao de renovacao quando ha mais de uma acao de importacao
SELECT offline_conversion_upload_conversion_action_summary.conversion_action_name,
       offline_conversion_upload_conversion_action_summary.status,
       offline_conversion_upload_conversion_action_summary.success_rate,
       offline_conversion_upload_conversion_action_summary.pending_event_count
FROM offline_conversion_upload_conversion_action_summary

# pre-requisitos da CONTA (sem eles nada casa, por mais correto que esteja o envio)
SELECT customer.auto_tagging_enabled,
       customer.conversion_tracking_setting.accepted_customer_data_terms,
       customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled
FROM customer
```

Saudavel: `status = EXCELLENT`, `success_rate = 1`, **`pending = 0`**.
- `auto_tagging_enabled = false` → **nao existe `gclid`** para subir. Ligar em Google Ads >
  Configuracoes da conta > Marcacao automatica. Sem isso resta so o match por e-mail/telefone.
- `accepted_customer_data_terms = false` → o e-mail hasheado **nao casa**. Aceitar os termos de dados
  do cliente no painel.
- `enhanced_conversions_for_leads_enabled = false` → toda venda **sem `gclid`** e recusada com
  `DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS`. Ligar "Conversões otimizadas para
  leads" (método "Tag do Google") — passo a passo no Step 3 do `.claude/playbooks/google_ads.md`. Nao
  confundir com "Conversões otimizadas" (sem "para leads").

#### A armadilha do `EXCELLENT` com `0,00` no relatorio

**Isto e estado NORMAL, nao falha de tracking.** O Google Ads so reporta conversao **atribuivel a um
clique de anuncio**. Um upload aceito sem clique correspondente entra como **sucesso** no diagnostico
e **nao aparece** no relatorio de conversoes. O cliente abre o painel, ve `0,00` e reporta como bug —
e o agente vai investigar credencial, secret e payload sem necessidade.

No caso real que originou esta secao, a causa era que os anuncios estavam **reprovados**
(`HAS_ADS_DISAPPROVED`, politica `COMPROMISED_SITE`) → 0 impressao → 0 clique → `gclid` 0% no
`user_store` → nada para atribuir. **O tracking estava perfeito.**

Ordem de checagem antes de culpar o VT:

1. **A janela de datas do relatorio cobre o periodo em que o VT ja estava no ar?** Conversao nao
   retroage: upload feito hoje nao preenche relatorio de antes da instalacao.
2. **As campanhas estao servindo?**
   ```
   SELECT campaign.name, campaign.primary_status, campaign.primary_status_reasons FROM campaign
   ```
   `primary_status_reasons` traz o motivo exato (`HAS_ADS_DISAPPROVED`, `BUDGET_CONSTRAINED`, ...).
3. **Algum anuncio reprovado?** (a politica exata, quando o passo 2 apontar reprovacao)
   ```
   SELECT ad_group_ad.ad.id, ad_group_ad.policy_summary.approval_status,
          ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad
   ```
4. **Lado do VT — houve clique?**
   ```sql
   SELECT COUNT(*) total, SUM(gclid IS NOT NULL AND gclid <> '') com_gclid FROM user_store;
   ```
   `com_gclid = 0` com trafego real → **nunca houve clique de anuncio**. Fecha o diagnostico: o
   problema esta na veiculacao, nao no tracking. (Coluna disponivel a partir da 1.6.0; em instalacao
   anterior, aplicar `migrations/003_add_gclid_columns.sql`.)

### 2.11 SaaS por assinatura — os tres tipos de cobranca

**Rodar so quando o baseline tiver `subscription_tracking` ligado.** Se o config nao tem a chave, o
projeto e de compra unica: `Purchase` para tudo, a tabela `subscriptions` nem deve existir, e
qualquer pergunta sobre renovacao aqui e ruido.

**Antes de tudo — a tabela existe?**

```sql
SELECT COUNT(*) FROM subscriptions;
```

Erro `no such table` = `migrations/004_add_subscriptions_table.sql` **nao foi aplicada**. Sintoma no
D1: `subscription_tracking` ligado no config e **nenhum** evento `Subscribe`/`SubscriptionRenewal` em
`events` — toda cobranca saindo como `Purchase`. O tracking nao quebrou (o Worker avisa no
`wrangler tail` e segue mandando `Purchase`), mas **renovacao esta contando como cliente novo**.
Correcao: rodar a migration. Nao e preciso redeployar.

**a) Os tres tipos aparecem, e todos com sucesso?**

```sql
SELECT event_name, COUNT(DISTINCT event_id) AS eventos, status_code
  FROM events
 WHERE channel = 'webhook'
 GROUP BY event_name, status_code
 ORDER BY event_name;
```

Esperado num negocio maduro: **muito mais renovacao do que aquisicao** (a base recorrente e maior que
o fluxo de novos). Se `SubscriptionRenewal` = 0 depois de um ciclo inteiro de cobranca, o problema
nao e de envio — e de o gateway nao estar mandando o evento de renovacao (ver `gateway-webhooks.md`)
ou de o parser estar usando o id da assinatura como `order_id`, o que faz **toda renovacao cair no
dedup** (a 1a cobranca funciona e as seguintes somem sem erro).

**b) Alguma renovacao barrada por falta da 2a acao do Google?**

```sql
SELECT COUNT(*) FROM events WHERE error_message LIKE 'renewal_action_not_configured%';
```

Qualquer valor > 0: criar a acao `UPLOAD_CLICKS` **secundaria**, contagem **"Todas"**, e preencher
`platforms.google_ads.conversion_action_id_renewal`. Ver `google_ads.md`. O conector **nunca** cai na
acao de aquisicao — as conversoes barradas estao perdidas, mas a campanha nao foi corrompida.

**c) Algum produto sem classificacao no projeto misto?**

```sql
SELECT error_message, COUNT(*) FROM events
 WHERE platform = 'subscription' GROUP BY error_message;
```

`product_id_nao_classificado` = o id nao esta em `product_ids` nem em `product_ids_avulso` e foi
tratado como compra unica. `subscription_id_ausente_em_produto_saas` = o config diz que e assinatura,
mas o parser nao devolveu `subscription_id` (oferta nao marcada como recorrente no painel, ou gateway
sem recorrencia mapeada).

**d) ⚠️ O teto de atribuicao da renovacao — a consulta que evita o falso alarme**

```sql
SELECT (SELECT COUNT(*) FROM subscriptions WHERE lower(status) NOT LIKE 'cancel%') AS ativos,
       (SELECT COUNT(*) FROM subscriptions s WHERE lower(s.status) NOT LIKE 'cancel%'
          AND EXISTS (SELECT 1 FROM user_store u WHERE lower(u.email)=lower(s.email) AND u.email<>''))
       AS identificados;
```

**A atribuicao de renovacao comeca baixa por COBERTURA, nao por defeito.** A renovacao e 100%
server-side: nao ha navegador, e a identidade so existe se aquele assinante ja passou pelo site/app
(login, lead, `identify`). No caso real que originou esta secao, **129 de 655 ativos identificados
(19,7%)** produziram **16% de atribuicao** nas renovacoes — ou seja, o sistema entregava
**praticamente tudo o que a cobertura permitia**, e a curva sobe sozinha conforme a base loga.

> Antes de diagnosticar "atribuicao ruim", **compare a atribuicao com o teto**. Se a atribuicao esta
> proxima de `identificados / ativos`, nao ha defeito: ha cobertura baixa, e o caminho e aumentar a
> cobertura (garantir que o script roda no app logado), nao mexer no conector.

**e) A semeadura do legado foi feita?**

```sql
SELECT origin, COUNT(*) FROM subscriptions GROUP BY origin;
```

Negocio que ja tinha assinantes antes do VT e **nenhuma** linha `legacy_import`: a primeira cobranca
de cada assinante antigo foi (ou sera) classificada como **AQUISICAO** — pico fantasma de "clientes
novos" no primeiro ciclo, e a reativacao de quem cancelou antes fica invisivel para sempre. Ver o
Passo 4 do `.claude/playbooks/saas.md`.

**f) O cliente reclamou que `SubscriptionRenewal` "nao existe" no Gerenciador?**

Nao e bug. `SubscriptionRenewal` e `SubscriptionReactivation` sao **eventos personalizados**: nao
aparecem como conversao padrao no Gerenciador de Eventos. Para otimizar por eles e preciso criar uma
**Conversao Personalizada**. Confirme que os eventos estao chegando pela consulta (a) antes de
qualquer outra investigacao.

---

**Docs de plataforma (leitura/interpretacao apenas — nao reexecutar setup; so as do baseline):**
Meta → `.claude/playbooks/meta_ads.md` · TikTok → `.claude/playbooks/tiktok_ads.md` · GA4 →
`.claude/playbooks/ga4.md` · Google Ads → `.claude/playbooks/google_ads.md` · Sheets →
`.claude/playbooks/planilha.md`.

---

## Camada 1 — Gerenciador de Eventos (prints — so quando o banco nao basta)

O assistente **nao acessa** o Gerenciador. So o Meta tem: a **nota de correspondencia (EMQ 0-10)** e
o que o Meta efetivamente **casou**. Pedir em **UM bloco** (nao pergunta a pergunta), com onde clicar
e como mandar o print com tudo:

> Pra completar a auditoria do lado do Meta, me envie prints destas telas (Gerenciador de Eventos do
> pixel `{pixel_id}`):
>
> 1. **Visao geral** dos eventos — a lista de eventos e se aparecem como "Ativo/Recente".
> 2. Em **{evento principal, ex: Purchase}** → a secao com a **nota de correspondencia** e a lista de
>    **parametros** com a **% de envio** de cada um.
> 3. O **grafico de {evento}** nos ultimos **{X} dias** mostrando **Navegador x Servidor** (as duas
>    linhas).
>
> Dica: amplie a janela para {X} dias e deixe o **nome do evento visivel** no print.

Interpretacao (cruzar com a Camada 2):

- **Nota baixa (~<6) mas nossa cobertura no `sent_payload` era alta** → problema de **matching do
  Meta** ou dado de baixa qualidade (ex: email tratado errado) → revisar 2.5.
- **Linhas Navegador x Servidor descoladas** em evento dual-channel → ~5% e o esperado; diferenca
  grande so conclui com amostra relevante (> ~100 eventos). **Purchase e server-only** — nao esperar
  linha "Navegador" para ele.

Para GA4 / TikTok, o equivalente (onde olhar) esta na doc de cada plataforma; pedir o print analogo
**so** se o banco indicar duvida. **Google Ads e caso a parte:** o D1 nao prova conversao offline —
usar a **2.10** (o diagnostico da propria Google) antes de pedir qualquer print.

---

## Camada 3 — Browser / humano (confirmacao na ponta)

- **3.1 `?debug=1`:** orientar acessar `{dominio}/{pagina}?debug=1`, abrir o console (F12 > Console)
  e relatar os logs `[Tracking] ...` e o `marca_user` capturado.
- **3.2 Passagem do indexador:** pedir a **URL completa do checkout apos o redirecionamento** e
  confirmar que o **parametro certo daquele gateway** carrega o `marca_user` (`xcod` Hotmart,
  `sck` Kiwify, `marca_user` Hubla/Lastlink/Tutory, `utm_perfect` PerfectPay, etc. — ler de
  `gateways_config`).
- **3.3 Proxy do Meta Pixel** (so com `pixel_proxy` ligado): na aba Network filtrando `fb/`, devem
  aparecer `sdk.js`, `signals/config/…`, `signals/plugins/…` e `tr` **no dominio do cliente** — e,
  filtrando `facebook`, nada de `connect.facebook.net` nem `facebook.com/tr` (`instagram.com/tr` e
  `privacy_sandbox` podem aparecer e nao sao o pixel). Pedir o teste **com uBlock ligado**: e
  exatamente o visitante que o proxy resgata. Console sem `[Tracking] Proxy do Meta Pixel
  indisponivel`. Detalhe e validacao por `curl` em `.claude/playbooks/meta_ads.md`.

---

## Relatorio final

Resumir por **plataforma/evento**: `OK` / `ATENCAO` / `FALHA`, com a causa e o **local do ajuste**
quando houver. Gravar no `tracking_memory.md` uma secao `## Auditoria {data}` com o resultado (sem
secrets). Se houver `FALHA` com correcao de codigo/config (parser, `gateways_config`, secret
ausente), propor a correcao e seguir o procedimento normal (deploy + REGRA BLOQUEANTE de conta
Cloudflare).

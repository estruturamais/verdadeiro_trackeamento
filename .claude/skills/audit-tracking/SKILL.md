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
| Tudo zerado | Sem trafego/compra real no periodo (ou fora dos 30 dias de retencao) | sim |
| Google Ads com `0,00` conversao | Upload aceito **sem clique correspondente** (campanha parada, anuncio reprovado) — ver 2.10 | sim |
| Google Ads sem conversao, D1 "verde" | `channel` errado no config: instalacao antiga em `server` grava `200` para evento de navegador que nunca disparou — ver 2.10 | sim |

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

### 0.3 Ha dados? (D1 — janela <= 30 dias)

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
2. **Descartar a saida do Worker** — `curl -s "https://{dominio}/scripts/ga.js" | head -c 200`. Se o
   Worker consegue buscar um script externo, a saida esta boa.
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

### 2.7 Reconciliacao de volume
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) AS webhooks, SUM(processed) AS processados FROM webhook_raw WHERE site_id = '{site_id}' AND timestamp >= datetime('now','-{X} days');"
```
Comparar `webhooks` x `events` Purchase com status 2xx x vendas que o cliente sabe que houve. Sobra
em `webhook_raw` com `processed = 0` ou `error` preenchido → vendas perdidas (investigar `error`).

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

Duas armadilhas distintas moram aqui, e cada uma se disfarca da outra. **Nao mexer em credencial,
secret ou payload antes de separar as duas.**

**Armadilha A — log verde, zero envio.** Ate a 1.5.0 o conector gravava `status_code = 200` com
`web-only: dispatched via gtag in browser` **em qualquer canal**, e o default de `channel` era
`server`. Num site com `channel` omitido ou em `server`, o navegador **nao** dispara (`web.js` exige
`google_ads_channel === 'web'`) e o Worker registrava sucesso mesmo assim: **zero conversao no Google
Ads com o D1 inteiro verde**. Da 1.6.0 em diante o canal `server` grava `status_code = 0` +
`canal_server_nao_despacha_navegador`, e o default virou `web`.

**Armadilha B — `EXCELLENT` com `0,00`.** Ver o bloco proprio abaixo.

| Assinatura em `events` | Causa provavel | Correcao |
|---|---|---|
| `google_ads` com `200` e `web-only: dispatched via gtag` em **qualquer** canal | Instalacao **pre-1.6.0** — log mentiroso, nao prova nada | Conferir a versao no ar (0.1). Ate atualizar, validar o Google Ads pelo Tag Assistant, nunca pelo D1 |
| `status_code = 0` + `canal_server_nao_despacha_navegador` | `channel: "server"` com evento de navegador. Correto e honesto: nada foi despachado | Trocar para `channel: "web"`. Os dois canais convivem — web por rotulo, webhook por id numerico |
| `status_code = 0` + `missing_conversion_label_{evento}` | Opt-in: aquele evento nao tem rotulo no config | Preencher `conversion_label_{evento}`, ou ignorar se o evento nao deve ser conversao |
| `status_code = 0` + `conversion_action_not_found` | `conversion_action_id_purchase` vazio. Acao de **importacao** (`UPLOAD_CLICKS`) **nao tem rotulo** — procurar por rotulo sempre falha | Pegar o id numerico no painel (`ctId=` na URL da acao) e preencher `conversion_action_id_purchase` |
| `status_code = 0` + `missing_google_ads_oauth` / `invalid_google_ads_credential_whitespace` | Secret ausente ou com whitespace | `npm run gads:oauth` e subir por `wrangler secret bulk` (ver 2.3b) |
| `403` + `api_nao_habilitada` | **Data Manager API desligada** no projeto do Google Cloud — o passo mais esquecido da implantacao | Cloud Console > APIs e servicos > Biblioteca > "Data Manager API" > Ativar |
| `403` + `escopo_oauth_insuficiente` | Refresh token emitido so com `adwords` | Reemitir com `npm run gads:oauth` (pede `adwords` **+** `datamanager`). **Token antigo nunca ganha escopo novo** |
| `400` + `conversion_upload_bloqueado` | `upload_api: "conversion_upload"` em conta nao allowlisted | Trocar para `data_manager` (ou remover o campo — e o default) |
| `200` + `partial_failure: ...EXPIRED_CLICK` | A Google **aceitou o request e descartou a conversao** (clique fora da janela) | Nao e bug: e venda de um clique antigo demais |
| `200` sem `error_message` | Request aceito. **So isso** — o casamento com o clique e assincrono | Provar pelas consultas abaixo, nunca pelo D1 |

> **A regra que generaliza:** `200` da Data Manager significa **request aceito**, nao conversao
> registrada. O D1 prova que **nos enviamos**; so o diagnostico da propria Google prova que **ela
> casou**. Auditar conversao offline pelo D1 e o erro classico.

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

---

## Relatorio final

Resumir por **plataforma/evento**: `OK` / `ATENCAO` / `FALHA`, com a causa e o **local do ajuste**
quando houver. Gravar no `tracking_memory.md` uma secao `## Auditoria {data}` com o resultado (sem
secrets). Se houver `FALHA` com correcao de codigo/config (parser, `gateways_config`, secret
ausente), propor a correcao e seguir o procedimento normal (deploy + REGRA BLOQUEANTE de conta
Cloudflare).

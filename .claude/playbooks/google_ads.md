# Skill: tracking_google_ads

## Papel

Voce e o especialista em Google Ads. Conhece os dois canais do sistema (navegador por **rotulo** e
webhook por **id numerico**), a **Data Manager API** — o unico caminho aberto para conversao offline
em integracao nova — e os formatos exatos de payload extraidos do conector real em producao.

Esta skill e carregada apenas quando o cliente confirma uso de Google Ads no Step 1.
Responsabilidades: coletar credenciais no Step 3 e conduzir a validacao no Step 4.

---

## Mapeamento de eventos

| Evento canonico | Rotulo usado | Canal | Como e enviado |
|---|---|---|---|
| `page_view` | `conversion_label_page_view` | web | gtag no navegador |
| `contact` | `conversion_label_contact` | web | gtag no navegador |
| `lead` | `conversion_label_lead` | web | gtag no navegador |
| `initiate_checkout` | `conversion_label_initiate_checkout` | web | gtag no navegador |
| `purchase` | — usa `conversion_action_id_purchase` | webhook | Worker → Data Manager API |

**Todos sao OPT-IN.** Sem o rotulo daquele evento no config, o gtag **nao dispara** — nada de
`page_view` virando conversao sem alguem ter pedido. O `purchase` nao usa rotulo (ver a regra
abaixo).

**Quem decide o que e conversao — e o que e conversao principal — e o cliente, no painel do Google
Ads.** O papel do VT e saber enviar o que estiver configurado; nao opinar sobre quais acoes entram no
lance. Isso vale especialmente para `page_view`: se o cliente pedir, envie.

---

## A regra que resume o Google Ads

> **Acao de conversao de SITE → tem ROTULO. Acao de conversao de IMPORTACAO → NAO tem rotulo, so ID
> NUMERICO.**

Uma acao de importacao (`type = UPLOAD_CLICKS`) — que e justamente a que recebe o `purchase`
server-side — nao possui `tag_snippets`, logo **nao possui rotulo nenhum**. Procurar rotulo nela
sempre falha. O id numerico esta na **URL do painel**: abra a acao em *Google Ads > Objetivos >
Conversoes* e leia o parametro `ctId=` na barra de enderecos.

Ate a 1.5.0 o dispatch do purchase era gateado por `conversion_label_purchase`. Como a acao de
importacao nao tem rotulo, **nenhuma venda passava do gate — e nao havia log** (`return` seco). O
resultado era indistinguivel de "nao houve venda". Corrigido na 1.6.0.

---

## Os dois canais operam SIMULTANEAMENTE

Nao e "ou web ou server". Sao caminhos independentes, para eventos diferentes, em **acoes de
conversao diferentes** — por isso nao ha duplicacao entre eles.

### Canal `web` — eventos de navegador (default)

```javascript
gtag('event', 'conversion', {
  send_to: 'AW-123456789/AbCdEf123',   // conversion_id / conversion_label_{evento}
  value: 197.00,
  currency: 'BRL'
});
```

Quem envia e o **navegador**. O Worker apenas **registra o log** — ele nao tem como enviar por este
caminho. Requer `channel: "web"` (o default) e o rotulo do evento no config.

### Canal `webhook` — `purchase` server-side

O gateway avisa o Worker da compra aprovada; o Worker faz o FDV merge (recupera `gclid`, e-mail e
telefone da sessao do visitante) e sobe a conversao para a **Data Manager API**. **Independe de
`channel`** — funciona mesmo com `channel: "web"`.

> **Configuracao recomendada:** `channel: "web"` **mais** `conversion_action_id_purchase` preenchido.
> Eventos de navegador pelo navegador, venda pelo servidor — cada um onde funciona melhor, sem risco
> de duplicidade.

**Atencao a instalacoes antigas:** ate a 1.5.0 o default de `channel` era `server`, e nesse modo o
navegador nao disparava **e** o Worker gravava `status_code: 200` mesmo assim. Isso produzia **zero
conversao no Google Ads com o D1 inteiro verde**. Da 1.6.0 em diante o default e `web` e o canal
`server` grava o motivo real de nada ter sido despachado.

---

## Por que Data Manager API (e nao o servico classico)

Desde 2026 a Google **bloqueia o `ConversionUploadService.UploadClickConversions` para integracoes
novas**. A conta responde:

```
CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE
"New integrations for uploading click conversions should use the Data Manager API.
 Usage of ConversionUploadService.UploadClickConversions is limited to existing users"
```

Isso **so aparece em chamada real** — nenhum teste de credencial revela. O conector usa por padrao
`upload_api: "data_manager"`; `"conversion_upload"` existe apenas para contas que ja estavam
allowlisted no servico legado.

Duas diferencas praticas do caminho novo:
- **Nao usa developer-token.** So `Authorization: Bearer`. (O developer-token continua util apenas
  para o lookup automatico da acao de conversao e para o caminho legado.)
- **Exige o escopo `datamanager`** no refresh token, alem de `adwords`, e a **Data Manager API
  habilitada** no projeto do Google Cloud.

### Payload exato — `sendGoogleAdsWebhook` em `platforms/google-ads.js`

`POST https://datamanager.googleapis.com/v1/events:ingest`

```json
{
  "destinations": [{
    "reference": "gads",
    "operatingAccount": { "product": "GOOGLE_ADS", "accountId": "{customer_id}" },
    "loginAccount":     { "product": "GOOGLE_ADS", "accountId": "{login_customer_id}" },
    "productDestinationId": "{conversion_action_id_purchase}"
  }],
  "events": [{
    "destinationReferences": ["gads"],
    "eventTimestamp": "2026-08-28T14:03:00.000Z",
    "eventSource": "WEB",
    "currency": "BRL",
    "conversionValue": 197.0,
    "transactionId": "{order_id}",
    "adIdentifiers": { "gclid": "{gclid}" },
    "userData": { "userIdentifiers": [
      { "emailAddress": "{sha256 do e-mail}" },
      { "phoneNumber": "{sha256 do telefone em E.164}" }
    ]},
    "consent": { "adUserData": "CONSENT_GRANTED", "adPersonalization": "CONSENT_GRANTED" }
  }],
  "encoding": "HEX",
  "validateOnly": false
}
```

Notas campo a campo:
- **`eventSource` e obrigatorio.** Sem ele: `400 REQUIRED_FIELD_MISSING events[0].event_source`.
- `productDestinationId` e o **id numerico** da acao, nao o rotulo, nao o resource name.
- `loginAccount` so vai quando ha `login_customer_id` (conta MCC/administradora).
- `adIdentifiers` usa `gclid`, ou `wbraid` (web com restricao de cookie/iOS), ou `gbraid` (app) —
  **um so**, nessa ordem de preferencia.
- `transactionId` = `order_id` do gateway: e ele que permite a Google deduplicar reenvio.
- **Telefone em E.164:** `sha256('+' + digitos)`. O hash compartilhado do sistema (padrao Meta) usa o
  valor cru e **nunca casa** no Google — o conector refaz o hash so para este destino. A perda seria
  silenciosa: nenhum erro, so match pior.

### Caminho legado (`upload_api: "conversion_upload"`)

`POST https://googleads.googleapis.com/v21/customers/{customer_id}:uploadClickConversions`, com os
headers `developer-token` e `login-customer-id`. Atencao a duas armadilhas ja pagas:
- A URL **nao** e `customers/{id}/conversionUploads:upload` — essa devolve **404 em HTML**.
- `conversionDateTime` exige `yyyy-MM-dd HH:mm:ss+HH:mm`; ISO puro e recusado.

---

## Resolucao da acao de conversao no codigo

`resolveConversionAction` tenta, nesta ordem:

1. **`conversion_action_id_{evento}` do config** — prioridade absoluta, sem nenhuma chamada de API.
2. Lookup por **rotulo** dentro do `eventSnippet` das acoes (so encontra acao de **site**).
3. Lookup por **`type = UPLOAD_CLICKS`** (+ categoria, quando informada) — o caminho da acao de
   importacao, que nao tem `eventSnippet`.
4. **Erro acionavel** — nao um `conversion_action_not_found` mudo:
   > preencha `conversion_action_id_purchase` com o ID NUMERICO da acao de importacao. Acoes de
   > importacao (UPLOAD_CLICKS) nao tem rotulo — o id aparece na URL do painel (`ctId=`).

Os passos 2 e 3 usam a Google Ads API, que exige **developer-token**. Como o caminho Data Manager
**nao** precisa de developer-token, o normal e nao ter um — e ai o resultado e direto o passo 4. Por
isso: **preencher o id numerico no config e o caminho padrao, nao um plano B.**

---

## Credenciais a coletar (Step 3)

### Conversion ID
- Google Ads > **Objetivos > Conversoes > Tags do Google** > formato `AW-XXXXXXXXXX`
- Publico. Vai no `SITE_CONFIG`.

### Conversion Labels (um por evento de navegador que virar conversao)
1. Google Ads > **Objetivos > Conversoes > Nova acao de conversao > Website**
2. Abrir a acao criada > **Configurar tag** > *Instalar a tag manualmente*
3. No snippet, `send_to: 'AW-123456789/AbCdEf123'` — o **rotulo** e a parte **depois da barra**
- Publico. Um rotulo por evento; sem ele o evento nao dispara.

### Acao de conversao de IMPORTACAO (para o `purchase`)
1. Google Ads > **Objetivos > Conversoes > Nova acao de conversao > Importar**
2. Escolher **"Importacoes manuais usando a API ou envios"** (nao planilha, nao Salesforce)
3. Abrir a acao criada e **ler o `ctId=` na URL** — esse numero e o
   `conversion_action_id_purchase`
- Publico. **Esta acao nao tem rotulo** — nao procure por um.

### Customer ID (e Login Customer ID)
- Numero de 10 digitos no topo direito do painel (`123-456-7890` → gravar so os digitos)
- Se a conta e gerenciada por uma **MCC/conta de administrador**, o `login_customer_id` e o ID da
  MCC; caso contrario, omitir.

### Credenciais OAuth (secretas)
1. **Google Cloud Console**, no projeto do cliente:
   - APIs e servicos > Biblioteca > **Google Ads API** > Ativar
   - APIs e servicos > Biblioteca > **Data Manager API** > Ativar ← **o passo mais esquecido**
   - Credenciais > Criar credenciais > **ID do cliente OAuth** > tipo **App para computador**
2. No repo: `npm run gads:oauth --client-id={id} --client-secret={secret}`
3. Autorizar os **dois** acessos. O script confere o `scope` devolvido e **falha** se faltar
   `datamanager` — token emitido so com `adwords` responde `403 insufficient authentication scopes`
   no upload, e **token antigo nunca ganha escopo novo** (tem que ser reemitido).

### Bloco unico para o cliente copiar, colar e responder

```
--- GOOGLE ADS ---
Antes de preencher, ATIVE no Google Cloud (mesmo projeto, os dois):
  1. "Google Ads API"        -> Biblioteca > Ativar
  2. "Data Manager API"      -> Biblioteca > Ativar   (sem esta, a venda nao sobe)
E confirme no Google Ads > Configuracoes da conta que a "Marcacao automatica" (auto-tagging)
esta LIGADA — sem ela nao existe gclid, e sem gclid nao ha clique a que atribuir a venda.

→ ID de conversao (AW-XXXXXXXXXX):
→ ID da conta / Customer ID (10 digitos):
→ ID da conta administradora / MCC (se houver, senao deixe em branco):
→ Rotulo de conversao de CONTATO (parte depois da barra no send_to):
→ Rotulo de conversao de LEAD:
→ ID NUMERICO da acao de conversao de IMPORTACAO para COMPRA (o `ctId=` da URL):
→ Client ID do OAuth (secreto):
→ Client Secret do OAuth (secreto):
```

> Dica de preenchimento a incluir na mensagem:
> "Preencha os dados apos cada '→' e cole aqui de volta. Para campos marcados como 'secreto', fique
> tranquilo — eles nao ficam gravados no chat e vao direto para um cofre seguro no servidor."

O **refresh token** nao se pede ao cliente: ele e gerado por voce com `npm run gads:oauth` a partir
do Client ID/Secret.

---

## Separacao config vs secrets

| Campo | Destino | Wrangler secret name |
|---|---|---|
| `conversion_id` | Config JSON (`SITE_CONFIG`) | — |
| `channel` | Config JSON — `web` (default) ou `server` | — |
| `customer_id` / `login_customer_id` | Config JSON — so digitos, sem hifens | — |
| `conversion_label_*` | Config JSON — um por evento de navegador | — |
| `conversion_action_id_purchase` | Config JSON — id numerico da acao de importacao | — |
| `upload_api` | Config JSON — `data_manager` (default) ou `conversion_upload` | — |
| Client ID do OAuth | **Wrangler secret** | `GOOGLE_ADS_CLIENT_ID` |
| Client Secret do OAuth | **Wrangler secret** | `GOOGLE_ADS_CLIENT_SECRET` |
| Refresh token | **Wrangler secret** | `GOOGLE_ADS_REFRESH_TOKEN` |
| Developer token (opcional) | **Wrangler secret** | `GOOGLE_ADS_DEVELOPER_TOKEN` |

Ate a 1.5.0 o Google Ads nao tinha secret nenhum (so o canal web existia). **Isso mudou:** o
`purchase` server-side exige as tres credenciais OAuth.

```bash
# secrets.json: {"GOOGLE_ADS_CLIENT_ID":"...","GOOGLE_ADS_CLIENT_SECRET":"...","GOOGLE_ADS_REFRESH_TOKEN":"..."}
npx wrangler secret bulk secrets.json
rm secrets.json                          # PowerShell: Remove-Item secrets.json -Force
```

> **NUNCA** usar `echo "{token}" | npx wrangler secret put GOOGLE_ADS_REFRESH_TOKEN`. No
> Windows/PowerShell o pipe acrescenta CRLF, o secret e gravado com whitespace e o header
> `Authorization: Bearer <token>\r\n` derruba a conexao — o envio grava `status_code = 0` +
> `Error: Network connection lost.`, que **parece erro de rede** e manda a investigacao para o lugar
> errado. Ver o Step 3b do `overview.md`.

---

## Config JSON para Google Ads

```json
{
  "platforms": {
    "google_ads": {
      "conversion_id": "AW-123456789",
      "channel": "web",
      "customer_id": "1234567890",
      "login_customer_id": "0987654321",
      "conversion_action_id_purchase": "7654321",
      "upload_api": "data_manager",
      "conversion_label_contact": "{rotulo}",
      "conversion_label_lead": "{rotulo}"
    }
  }
}
```

- `channel`: `web` (default) para os eventos de navegador. O `purchase` **nao** depende deste campo.
- `login_customer_id`: omitir quando a conta nao e gerenciada por MCC.
- `upload_api`: omitir na duvida — o default `data_manager` e o unico caminho aberto para conta nova.
- Rotulos: **so os eventos que o cliente quiser** como conversao. Nao preencher = nao disparar.

---

## SaaS por assinatura: DUAS acoes de conversao, nao uma

So se aplica quando `subscription_tracking` esta ligado (ver `.claude/playbooks/saas.md`).

**O problema.** A acao de aquisicao precisa ser contagem **"Uma"** (`ONE_PER_CLICK`) para manter o
lance limpo. Mas assim **a renovacao no mesmo `gclid` e descartada** — e, se o cliente clicar num
anuncio novo antes de renovar, a renovacao conta como **AQUISICAO**, inflando a campanha. Uma acao so
erra nos dois sentidos.

**A solucao.** Duas acoes `UPLOAD_CLICKS` separadas, com roteamento no conector:

| `billing_type` | Acao | Configuracao no painel |
|---|---|---|
| `new` | `conversion_action_id_purchase` | **primaria**, contagem **"Uma"** |
| `renewal` · `reactivation` | `conversion_action_id_renewal` | **secundaria**, contagem **"Todas"** |

```json
"conversion_action_id_purchase": "7654321",
"conversion_action_id_renewal":  "7654399"
```

`renewal` e `reactivation` **nunca** sobem na acao de aquisicao. Sem
`conversion_action_id_renewal`, o conector **falha de forma legivel** e grava no D1:

```
renewal_action_not_configured: preencha `platforms.google_ads.conversion_action_id_renewal`
(acao UPLOAD_CLICKS secundaria, contagem "Todas") — renovacao/reativacao NAO sobe na acao de aquisicao
```

O log usa `event_name = subscription_renewal` / `subscription_reactivation` (em vez de `purchase`),
entao da para separar os tres tipos de cobranca por uma consulta so no `events`.

### Como criar a 2a acao (passos no painel)

1. **Metas > Conversoes > Nova acao de conversao > Importar > Importacoes manuais (API)**
2. Nome sugerido: `[VT] Renovacao de assinatura`
3. Categoria: **Assinatura** (`SUBSCRIBE_PAID`) ou "Outra"
4. **Contagem: "Todas"** — cada renovacao e uma conversao real, diferente da aquisicao
5. **Objetivo: secundaria** (nao entra no lance)
6. Copiar o id numerico — ele aparece na tela como **"Codigo do tipo de conversao"**, e tambem no
   `ctId=` da URL

> ⚠️ **Higiene obrigatoria do Smart Bidding.** Com lance inteligente, o algoritmo persegue **todas**
> as acoes marcadas como **primarias**. Se a renovacao ficar primaria, a campanha passa a otimizar
> por receita recorrente que ela nao gerou, e o CAC do relatorio afunda sozinho. **Rebaixe a
> secundarias tudo o que nao for a compra que voce quer comprar.**
>
> As acoes de conversao do **YouTube geradas pelo sistema** sao `MUTATE_NOT_ALLOWED` pela API — so
> da para rebaixa-las **pela UI**.

---

## Armadilhas (leia antes de abrir um chamado)

**1. `EXCELLENT` no diagnostico e `0,00` no relatorio.** Estado **normal**. O Google Ads so reporta
conversao **atribuivel a um clique de anuncio**; upload aceito sem clique correspondente conta como
sucesso no diagnostico e **nao aparece** no relatorio. Antes de culpar o VT, nesta ordem: (1) a
janela de datas do relatorio cobre o periodo em que o VT ja estava no ar? (2) as campanhas estao
**servindo**? (3) ha anuncio **reprovado**? (4) `gclid` e 0% no `user_store`? Se sim, **nunca houve
clique**. No caso real que gerou esta secao, os anuncios estavam reprovados
(`HAS_ADS_DISAPPROVED` / `COMPROMISED_SITE`) e o tracking estava perfeito. Roteiro completo com as
queries: **`audit-tracking`, secao 2.10**.

**2. `200` nao significa conversao registrada.** Significa **request aceito**. O casamento com o
clique e assincrono. Auditar conversao offline pelo D1 e o erro classico — a prova esta nas consultas
`offline_conversion_upload_*` da 2.10.

**3. Marcacao automatica desligada.** Sem auto-tagging nao existe `gclid`; sem `gclid`, so resta o
match por e-mail/telefone hasheados. Conferir com
`SELECT customer.auto_tagging_enabled FROM customer`.

**4. Termos de dados do cliente nao aceitos.** Sem `accepted_customer_data_terms` o e-mail hasheado
nao casa — e nao ha erro nenhum no upload.

### Sintoma → causa → correcao

| Sintoma | Causa | Correcao |
|---|---|---|
| Nenhuma linha `google_ads` no D1 para `purchase` | Bloco `google_ads` ausente no `SITE_CONFIG` | Adicionar o bloco. Existindo o bloco, sempre ha log — mesmo que so para dizer o que falta |
| `status_code 0` + `conversion_action_not_found` | Acao de importacao nao tem rotulo, e o id nao foi preenchido | Preencher `conversion_action_id_purchase` com o `ctId=` |
| `status_code 0` + `canal_server_nao_despacha_navegador` | `channel: "server"` com evento de navegador | Trocar para `channel: "web"` |
| `status_code 0` + `missing_conversion_label_{evento}` | Opt-in: rotulo daquele evento ausente | Preencher o rotulo, ou ignorar se o evento nao deve ser conversao |
| `403` + `api_nao_habilitada` | Data Manager API desligada no Cloud | Ativar no Cloud Console e aguardar alguns minutos |
| `403` + `escopo_oauth_insuficiente` | Refresh token sem o escopo `datamanager` | `npm run gads:oauth` e resubir o secret. Token antigo **nao** ganha escopo novo |
| `400` + `conversion_upload_bloqueado` | Conta nao allowlisted no servico legado | `upload_api: "data_manager"` (ou remover o campo) |
| `200` + `partial_failure ... EXPIRED_CLICK` | Clique fora da janela de conversao | Nao e bug — venda de clique antigo demais |
| Tag Assistant nao mostra a conversao | `channel` != `web`, rotulo ausente, ou `conversion_id` errado | Conferir os tres, nesta ordem |

---

## Validacao (Step 4)

### Canal web
1. **Google Tag Assistant** (extensao Chrome): resultado imediato — mostra se a tag de conversao
   disparou e para qual `send_to`
2. **Painel Google Ads > Conversoes**: delay de ate 3h

### Canal webhook (purchase)
1. Aguardar (ou fazer) uma compra aprovada real
2. Conferir a linha no D1 (abaixo)
3. **Rodar o diagnostico da propria Google** — `audit-tracking` 2.10. E a unica prova de que a
   conversao casou

### Consulta D1

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message FROM events WHERE site_id = '{site_id}' AND platform = 'google_ads' ORDER BY id DESC LIMIT 10;"
```

**Resultado esperado com `channel: "web"` + purchase configurado:**
```
purchase | google_ads | webhook | hotmart | 200 |
lead     | google_ads | web     | collect | 200 |
contact  | google_ads | web     | collect | 200 |
```
As linhas `web` registram que o **navegador** despachou (o `sent_payload` mostra o `send_to` usado);
a linha `webhook` com `200` significa **request aceito pela Data Manager** — confirmar o casamento
pela 2.10.

**Houve clique de anuncio?** (pre-requisito de toda atribuicao offline)
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) total, SUM(gclid IS NOT NULL AND gclid <> '') com_gclid FROM user_store;"
```
`com_gclid = 0` com trafego real → marcacao automatica desligada, ou as campanhas nunca serviram.

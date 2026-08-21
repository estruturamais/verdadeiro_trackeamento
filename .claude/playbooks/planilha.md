# Skill: tracking_planilha

## Papel

Voce e o especialista na integracao do VT com Google Sheets via Google Apps Script. Sabe conduzir o
cliente da planilha modelo ate o planilhamento validado, e ativar a integracao no Worker via
`SITE_CONFIG`.

Sao **dois planilhamentos independentes**, que o cliente pode querer separadamente ou juntos:

| | O que grava | De onde vem | Aba padrao | Liga com |
|---|---|---|---|---|
| **Leads** | 1 linha por cadastro no site | beacon do browser (`/collect/event`) | `users` | `sheets.events` |
| **Vendas** | 1 linha por compra aprovada | webhook do gateway (`/collect/webhook/{gw}`) | `transactions` | `sheets.purchase` |

A integracao e **server-side** nos dois casos: o Worker chama o GAS no momento em que recebe o
evento, sem depender de GTM ou de qualquer script no browser.

O conector vive em `src/worker/platforms/sheets.js`, com duas entradas:

- **`sendSheetsLead`** — ligado em `src/worker/collect/event.js` (eventos do browser). Faz **append**
  (linha nova) e **upsert por `user_id`** (completa a linha do lead).
- **`sendSheetsPurchase`** — ligado em `src/worker/collect/webhook.js` (webhook do gateway). Faz
  **append de 1 linha por compra aprovada** numa aba de vendas. E **opt-in**: so dispara com o bloco
  `sheets.purchase` no `SITE_CONFIG`.

Os dois batem no mesmo **GAS universal** — um unico `Codigo.gs` que faz append + upsert +
auto-criacao de colunas + **roteamento de aba por request** (`_sheet`). Uma implantacao so atende
leads e vendas em abas diferentes.

Quando o cliente ja tem um `id_script`, voce o usa diretamente. Quando nao tem, voce o guia pelo processo completo de criacao.

---

## Fluxo inicial

### Passo 1 — Perguntar O QUE planilhar (sempre primeiro)

> "Posso te entregar dois planilhamentos automaticos. O que voce quer?
>
> **A** — **Leads**: cada cadastro feito no seu site vira uma linha, com contato, UTMs e pagina de origem
> **B** — **Vendas**: cada compra aprovada vira uma linha, com comprador, produto, valores e a UTM que trouxe a venda
> **C** — **Os dois** (recomendado)
>
> Pode escolher mais de um."

Gravar a resposta no `tracking_memory.md` **antes** de continuar (regra 13 do workflow).

> **Pre-requisito de cada um:** **A** so faz sentido se o site tiver formulario de captura (se nao
> tiver, avise e siga so com B). **B** exige o **webhook do gateway cadastrado** — sem isso nenhuma
> venda chega ao Worker. Confira no `tracking_memory` se ja foi feito; se nao, isso entra na lista de
> pendencias do cliente.

### Passo 2 — Perguntar se ja tem planilha

> "Voce ja tem um Google Apps Script implantado recebendo dados nessa planilha? Se sim, me manda o
> **codigo da implantacao** (`id_script`). Se nao, te guio do zero — leva uns 3 minutos."

- **Ja tem o `id_script`** → **antes de confiar nele**, rodar o teste de versao da secao
  "Validacao > 1b". Se a resposta nao trouxer o campo `sheet`, o script e antigo (v1/v2 hardcoded) e
  **precisa ser atualizado** — ver "Atualizacao do script GAS". So depois ir para "Ativar no Worker".
- **Nao tem** → seguir "Configurar o Google Apps Script" abaixo.

> **GAS universal v3:** um unico `Codigo.gs` serve para **todos os clientes e todas as abas** — append,
> upsert, auto-criacao de colunas e roteamento de aba por request. E **zero configuracao**: nao ha ID
> de planilha para preencher.

---

## Configurar o Google Apps Script

### 1. Duplicar a planilha modelo

Dizer ao cliente, literalmente:

> "1. Abra a planilha modelo:
>    https://docs.google.com/spreadsheets/d/1TG9gBVd6SlwBZKvf80-4kG6pSE3Mm4N9Okv8pkhN_Gc/edit
> 2. Estando logado na **sua** conta Google, va em **Arquivo > Fazer uma copia**
> 3. De o nome que quiser e salve no seu Drive
>
> Pronto — a copia ja vem com as abas certas (`users` para leads, `transactions` para vendas) e com o
> script embutido. Me avisa quando tiver a copia."

**Por que duplicar e nao criar do zero:** a copia ja traz os cabecalhos exatos que o Worker envia
(`país` com acento, `user_id` como coluna-chave do upsert, as 25 colunas de `transactions`) e ja traz
o `Codigo.gs` junto — script vinculado viaja com a planilha no *Fazer uma copia*.

> ⚠️ **Nunca peca para o cliente compartilhar/editar a planilha modelo.** Ela e o molde de todos os
> alunos. Se ele disser que "editou a planilha do link", pare e peca para fazer a copia.

**Abas do modelo:**

| Aba | Para que serve | Quem preenche |
|---|---|---|
| `users` | Leads capturados no site | VT (evento `lead` + qualificacao) |
| `transactions` | Compras aprovadas | VT (webhook do gateway) |
| `advertising` | Investimento e metricas de midia | Fora do VT (importacao manual/API) |
| `utm \| padrao`, `utm \| criacao` | Convencao de UTM e montador de links | Referencia — o VT nao escreve nelas |

Com `AUTO_CREATE_HEADERS = true`, qualquer campo que chegar sem coluna correspondente ganha uma coluna
nova automaticamente — entao **nao ha o que pre-criar**. Mantenha `user_id`, `data` e `hora` na linha 1
de `users`: `user_id` e a **coluna-chave do upsert** (sem ela a qualificacao nao completa a linha do lead).

Colunas especiais preenchidas automaticamente pelo script (nao precisam vir no payload):
- `data` → data do registro no formato `dd/MM/yyyy`
- `hora` → hora do registro no formato `HH:mm` (fuso **da propria planilha**)

> **Nao e preciso copiar o ID da planilha.** O GAS v3 se resolve sozinho. O unico codigo que voce vai
> pedir ao cliente e o `id_script`, gerado na implantacao (passo 3).

### 2. Colar o Apps Script (GAS universal v3 — zero configuracao)

1. Na planilha, va em **Extensoes > Apps Script**
2. Substitua **todo** o conteudo do `Codigo.gs` pelo script abaixo. **Nao ha nada para preencher** — o
   script descobre sozinho em qual planilha esta (`SpreadsheetApp.getActiveSpreadsheet()`):

```javascript
// ============================================================================
// Verdadeiro Trackeamento — Codigo.gs universal (v3)
// @estruturamais | https://instagram.com/estruturamais
//
// Um unico script para TODAS as abas e TODOS os alunos:
//   • leads da web   -> aba `users`        (append + upsert por user_id)
//   • vendas (webhook) -> aba `transactions` (append)
//   • qualquer outra aba que o Worker pedir via `_sheet`
//
// ZERO CONFIGURACAO: o script descobre sozinho em qual planilha esta.
// Duplicou a planilha modelo? Implantou? Acabou. Nao ha ID para trocar.
// ============================================================================

// ===== Configuracao (normalmente NAO precisa mexer em nada aqui) =====

// Deixe VAZIO. O script usa a planilha em que ele esta instalado.
// So preencha com um ID se o script for AVULSO (nao criado por Extensoes > Apps Script).
var SHEET_KEY = "";

// Aba usada quando o request nao manda `_sheet` (o Worker sempre manda).
var SHEET_NAME = "users";

var AUTO_CREATE_HEADERS = true;  // campo sem coluna correspondente -> cria o cabecalho
var AUTO_CREATE_SHEET   = true;  // `_sheet` pedindo aba inexistente -> cria a aba
var KEY_COLUMN          = "user_id";

// Colunas gravadas como TEXTO. Sem isso o Sheets converte em numero e come o
// zero a esquerda / mostra notacao cientifica (telefone, CPF, ID de transacao).
var TEXT_COLUMNS = [
  "telefone", "comprador_telefone", "user_id",
  "transaction_id", "produto_id", "oferta_id", "utm_id"
];

// Colunas gravadas como NUMERO (coercao explicita antes do setValue). Sem isso,
// planilha em pt-BR le o PONTO de "0.625" como separador de milhar e o
// lead_score vira 625. Um Number gravado via setValue independe do locale.
// NAO usar coercao generica (quebraria telefone/IDs) — so as colunas listadas.
var NUMERIC_COLUMNS = ["lead_score"];

// ============================================================================

function doGet(e)  { return handleResponse(e); }
function doPost(e) { return handleResponse(e); }

function handleResponse(e) {
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);

  try {
    // Parametros (GET query string ou POST JSON)
    var data = (e && e.postData && e.postData.contents)
      ? JSON.parse(e.postData.contents)
      : ((e && e.parameter) || {});

    // ---- Parametros de CONTROLE — NUNCA viram coluna ----
    var mode    = String(data._mode || "append").toLowerCase(); // "append" | "upsert"
    var keyCol  = data._key   || KEY_COLUMN;                    // coluna-chave do upsert
    var tabName = data._sheet || SHEET_NAME;                    // aba de destino
    var ssKey   = data._ss    || SHEET_KEY;                     // planilha de destino
    delete data._mode;
    delete data._key;
    delete data._sheet;
    delete data._ss;

    var doc   = resolveSpreadsheet(ssKey);
    var sheet = doc.getSheetByName(tabName);
    if (!sheet) {
      if (!AUTO_CREATE_SHEET) return jsonOut({ result: "error", error: "sheet_not_found: " + tabName });
      sheet = doc.insertSheet(tabName);
    }

    // ---- Cabecalhos atuais (linha 1), ignorando colunas vazias no fim ----
    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    while (headers.length && headers[headers.length - 1] === "") headers.pop();

    // ---- Auto-criacao de colunas ----
    if (AUTO_CREATE_HEADERS) {
      for (var key in data) {
        if (data.hasOwnProperty(key) && headers.indexOf(key) === -1) {
          headers.push(key);
          sheet.getRange(1, headers.length).setValue(key);
        }
      }
    }

    // Fuso da propria planilha (Arquivo > Configuracoes), com fallback para o Brasil
    var tz            = doc.getSpreadsheetTimeZone() || "America/Sao_Paulo";
    var now           = new Date();
    var formattedDate = Utilities.formatDate(now, tz, "dd/MM/yyyy");
    var formattedTime = Utilities.formatDate(now, tz, "HH:mm");

    // ===== UPSERT: completa a linha existente (procura pela coluna-chave) =====
    if (mode === "upsert") {
      var keyIdx = headers.indexOf(keyCol);
      var keyVal = data[keyCol];
      var targetRow = -1;

      if (keyIdx !== -1 && keyVal) {
        var lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          var keyValues = sheet.getRange(2, keyIdx + 1, lastRow - 1, 1).getValues();
          for (var r = keyValues.length - 1; r >= 0; r--) {   // de baixo p/ cima: pega a linha mais recente
            if (String(keyValues[r][0]) === String(keyVal)) { targetRow = r + 2; break; }
          }
        }
      }

      if (targetRow !== -1) {
        // Grava SO as colunas presentes no payload (preserva contato/data/hora e o resto)
        for (var c = 0; c < headers.length; c++) {
          var h = headers[c];
          if (data.hasOwnProperty(h) && data[h] !== "") {
            var cell = sheet.getRange(targetRow, c + 1);
            if (TEXT_COLUMNS.indexOf(h) !== -1) cell.setNumberFormat("@");
            cell.setValue(coerceVal(h, data[h]));
          }
        }
        return jsonOut({ result: "success", mode: "update", sheet: tabName, row: targetRow });
      }
      // Chave nao encontrada -> cai para append (cria a linha)
    }

    // ===== APPEND: linha nova alinhada aos cabecalhos =====
    var row = [];
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (h === "data")      row.push(formattedDate);
      else if (h === "hora") row.push(formattedTime);
      else                   row.push(data.hasOwnProperty(h) ? coerceVal(h, data[h]) : "");
    }
    var nextRow = sheet.getLastRow() + 1;

    // Formata como texto as colunas sensiveis ANTES de escrever
    for (var t = 0; t < headers.length; t++) {
      if (TEXT_COLUMNS.indexOf(headers[t]) !== -1) {
        sheet.getRange(nextRow, t + 1).setNumberFormat("@");
      }
    }
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);

    return jsonOut({ result: "success", mode: "append", sheet: tabName, row: nextRow });
  }
  catch (err) {
    return jsonOut({ result: "error", error: err.message });
  }
  finally {
    lock.releaseLock();
  }
}

// Coercao numerica das colunas em NUMERIC_COLUMNS: aceita "0.625" e "0,625" e
// grava como Number (independe do locale da planilha). Valor nao-numerico passa cru.
function coerceVal(h, v) {
  if (NUMERIC_COLUMNS.indexOf(h) === -1) return v;
  if (v === "" || v == null) return v;
  var n = Number(String(v).replace(",", "."));
  return isNaN(n) ? v : n;
}

// Resolve a planilha SEM depender de ID hardcoded.
// Script vinculado (Extensoes > Apps Script) enxerga a propria planilha, entao a
// copia de cada aluno grava na copia dele — nao na planilha modelo.
function resolveSpreadsheet(ssKey) {
  if (ssKey) return SpreadsheetApp.openById(ssKey);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error("planilha_nao_resolvida: preencha SHEET_KEY com o ID da sua planilha");
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**Como o script funciona — orientado a cabecalhos:**
- Le os nomes das colunas da linha 1 da aba.
- **Append** (default): para cada cabecalho, busca o valor de mesmo nome no payload e grava uma linha nova. `data` e `hora` sao preenchidas automaticamente; campo sem valor fica vazio.
- **Upsert** (`_mode=upsert&_key=user_id`): localiza a linha cuja coluna-chave (`user_id`) bate com o valor recebido e atualiza **apenas as colunas presentes no payload** — preserva contato, `data`, `hora` e qualquer coluna nao enviada. Se nao achar a chave, cria a linha (fallback para append). A varredura e **de baixo para cima**: com `user_id` repetido, completa a linha mais recente.
- **Auto-create** (`AUTO_CREATE_HEADERS = true`): qualquer chave do payload sem coluna correspondente vira um cabecalho novo na hora — sem mexer no script para adicionar colunas.
- **Roteamento de aba** (`_sheet`): o request decide **em qual aba** gravar. `SHEET_NAME` e so o fallback. Com `AUTO_CREATE_SHEET = true`, uma aba pedida que ainda nao existe e criada na hora. Assim **uma unica implantacao** atende leads (`users`), vendas (`transactions`) e o que mais vier — sem reimplantar o script a cada aba nova.
- **Zero configuracao** (`SHEET_KEY = ""`): o script grava na planilha em que ele **esta instalado**, via `SpreadsheetApp.getActiveSpreadsheet()`. E o que torna o `Codigo.gs` identico para todo mundo: a copia de cada aluno grava na copia dele. So preencha `SHEET_KEY` se o script for **avulso** (criado em `script.google.com` em vez de `Extensoes > Apps Script`) ou se precisar gravar numa planilha diferente da que hospeda o script.
- **Colunas de texto** (`TEXT_COLUMNS`): `telefone`, `comprador_telefone`, `transaction_id`, `produto_id`, `oferta_id`, `user_id` e `utm_id` sao gravadas com formato texto. Sem isso o Sheets converte em numero e come o zero a esquerda (ou mostra notacao cientifica).
- **Colunas numericas** (`NUMERIC_COLUMNS`): `lead_score` e gravado como `Number` via `coerceVal` (aceita ponto e virgula). Sem isso, planilha em **pt-BR** le `0.625` como `625` (ponto = separador de milhar). Coluna numerica nova? Acrescente o nome em `NUMERIC_COLUMNS` — nunca aplicar coercao generica (quebraria telefone/IDs).
- **Fuso horario**: lido da propria planilha (`Arquivo > Configuracoes`), com fallback `America/Sao_Paulo`.
- `_mode`, `_key`, `_sheet` e `_ss` sao **parametros de controle** — sao removidos antes de gravar e **nunca viram coluna**.

### Parametros de controle

| Parametro | Default | Para que serve |
|---|---|---|
| `_sheet` | `SHEET_NAME` | Aba de destino. Enviado pelo Worker a partir de `sheets.sheet` (eventos web) e `sheets.purchase.sheet` (vendas). |
| `_ss` | `SHEET_KEY` | Planilha de destino (so se precisar gravar em outra planilha). |
| `_mode` | `append` | `append` (linha nova) ou `upsert` (completa a linha existente). |
| `_key` | `user_id` | Coluna-chave do upsert. |

### 3. Implantar como aplicativo web

1. Clique em **Implantar > Nova implantacao**
2. Em "Tipo", selecione **Aplicativo da Web**
3. Configure:
   - **Descricao:** `Verdadeiro Trackeamento` (qualquer nome descritivo)
   - **Executar como:** `Eu ({seu email})` — **obrigatorio**: e o que faz o `getActiveSpreadsheet()` enxergar a planilha
   - **Quem tem acesso:** `Qualquer pessoa` — obrigatorio para o Worker fazer o request sem autenticacao
4. Clique em **Implantar**
5. Autorize as permissoes solicitadas (a tela de aviso "Google nao verificou este app" e esperada:
   **Avancado > Acessar {nome do projeto}**; o app e o proprio script do cliente)
6. Copie a URL gerada. O `id_script` e a parte entre `/macros/s/` e `/exec`:
   ```
   https://script.google.com/macros/s/AKfycbwbyKd0epPr7Dhi9yYKWAmXz5YRVWJyv59KSOou18Rq/exec
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       id_script
   ```

---

## Dados enviados pelo Worker

O Worker (`sendSheetsLead` em `src/worker/platforms/sheets.js`) monta os campos numa query string GET e chama o GAS com `redirect: 'follow'` (o GAS responde **302** → `script.googleusercontent.com`; sem seguir o redirect o request falha). Os cabecalhos da planilha devem usar os **mesmos nomes (case-sensitive, inclusive acentos)**.

Campos vazios **nao** vao na query string — em upsert, nao sobrescrevem o que ja esta na linha.

### Append — evento `lead` (e os eventos listados em `sheets.events`)

| Chave (cabecalho na planilha) | Origem no Worker | Descricao |
|---|---|---|
| `data` | GAS — automatico | Data do registro `dd/MM/yyyy` |
| `hora` | GAS — automatico | Hora do registro `HH:mm` |
| `evento` | `page_event_names[slug]` ou `body.event` | Nome do evento por pagina (ver abaixo) ou o evento cru |
| `user_id` | `body.marca_user` | ID unico do usuario (cookie first-party) — **coluna-chave do upsert** |
| `nome` | `body.user_data.first_name` + `last_name` | Nome do lead |
| `email` | `body.user_data.email` | Email do lead |
| `telefone` | `body.user_data.phone` | Telefone do lead |
| `gender` | `body.user_data.gender` | Genero do usuario |
| `país` | `body.user_data.country` | Pais do usuario — **com acento, case-sensitive** |
| `estado` | `body.user_data.state` | Estado do usuario |
| `cidade` | `body.user_data.city` | Cidade do usuario |
| `utm_source` | `body.utm_data.utm_source` | UTM — origem |
| `utm_medium` | `body.utm_data.utm_medium` | UTM — midia |
| `utm_campaign` | `body.utm_data.utm_campaign` | UTM — campanha |
| `utm_content` | `body.utm_data.utm_content` | UTM — conteudo |
| `utm_term` | `body.utm_data.utm_term` | UTM — termo |
| `utm_id` | `body.utm_data.utm_id` | UTM — ID |
| `gclid` | `body.utm_data.gclid` | Click ID do Google Ads |
| `slug` | `body.page_url` (ultimo segmento do pathname) | Slug da pagina (ex: `registrol20`) |
| `page_location` | `body.page_url` | URL completa da pagina |
| `ip_address` | Header `CF-Connecting-IP` | IP do visitante |
| `user_agent` | Header `User-Agent` | User agent do browser |
| `fbc` | `body.browser_data.fbc` | Cookie de clique Meta Ads |
| `fbp` | `body.browser_data.fbp` | Cookie de browser Meta Ads |

**Importante:** `data` e `hora` sao preenchidas pelo GAS — nao devem existir como cabecalhos que esperam valor do payload (o script ja trata isso automaticamente). `país` precisa do acento; um cabecalho `pais` sem acento fica sempre vazio.

### Upsert — eventos `qualified_lead` / `disqualified_lead`

Esses eventos **nao criam linha nova**: fazem **UPSERT por `user_id`** (`_mode=upsert&_key=user_id`), completando a linha ja criada pelo evento `lead`. Gravam **apenas as colunas de qualificacao** abaixo — contato, `data`, `hora` e UTMs ficam preservados. Quando o sheets esta configurado, a qualificacao **sempre** dispara o upsert (independente de `sheets.events`).

| Chave (cabecalho na planilha) | Origem no Worker | Descricao |
|---|---|---|
| `user_id` | `body.marca_user` | **Chave do upsert** — casa com a linha do lead |
| `meta_event` | `QUAL_EVENTS[event].meta_event` | `QualifiedLead` ou `DisqualifiedLead` |
| `qualificacao` | `QUAL_EVENTS[event].qualificacao` | `QUALIFICADO` ou `DESQUALIFICADO` |
| `lead_score` | `body.custom_data.lead_score` | Score 0–1 (float) — gravado como numero via `NUMERIC_COLUMNS` |
| `tier` | `body.custom_data.lead_tier` | Faixa `A`/`B`/`C`/`X` |
| `resultado` | `body.qualification.resultado` | Valor calculado no site (campo `result_field`) |
| `{sheet_col}` por pergunta | `body.qualification.answers[field]` | Uma coluna por pergunta — ver mapeamento abaixo |
| `{extra}` (ex.: `instagram`) | `body.qualification.extras[chave]` | Campos extras ja chaveados pelo nome logico da coluna |

**Respostas por pergunta → coluna:** o Worker percorre `config.qualification.questions[]` e grava `answers[field]` na coluna nomeada por `sheet_col`. Com a config de exemplo (`faturamento`/`tempo`/`investir`/`iniciar`), a planilha ganha essas quatro colunas. As **letras** das respostas (A/B/C/X) sao gravadas como vieram do form.

Com `AUTO_CREATE_HEADERS = true`, todas essas colunas de qualificacao sao criadas automaticamente na primeira gravacao — nao precisa pre-cria-las.

---

### Append de VENDAS — webhook de compra aprovada (`sheets.purchase`)

Uma linha por compra aprovada, gravada na aba de `sheets.purchase.sheet` (`_sheet`). Roda **depois**
do dedup do webhook (`webhook_raw`), entao **reenvio do mesmo gateway nao duplica linha**; Order Bump
com o mesmo `order_id` mas `product_id` diferente entra como linha propria (o txn_id junta os dois).

Contato (`comprador_*`) sai do **FDV merge** — banco (`user_store`, dado de browser real) na frente,
webhook como fallback. Os campos de transacao vem **sempre do webhook**.

| Coluna | Origem | Descricao |
|---|---|---|
| `plataforma` | `purchase.platform_names[gateway]` ou o gateway cru | Rotulo do gateway (ex.: `Hotmart`) |
| `data` / `hora` | GAS — automatico | `dd/MM/yyyy` e `HH:mm` (fuso da planilha) |
| `evento` | `purchase.evento` (default `compra_aprovada`) | Rotulo fixo do evento |
| `comprador_nome` | `merged.fullname` | Nome do comprador |
| `comprador_email` | `merged.email` | Email do comprador |
| `comprador_telefone` | `merged.phone` | Telefone do comprador |
| `transaction_id` | `webhookData.order_id` | ID da transacao no gateway |
| `produto_nome` | `webhookData.product_name` | Nome do produto |
| `produto_id` | `webhookData.product_id` | ID do produto |
| `oferta_nome` | `webhookData.offer_name` | Nome da oferta (vazio nos gateways que so mandam o codigo) |
| `oferta_id` | `webhookData.offer_id` | Codigo da oferta / do checkout |
| `pagamento_moeda` | `webhookData.currency` | Moeda (`BRL`) |
| `pagamento_metodo` | `webhookData.payment_method` | Forma de pagamento (`CREDIT_CARD`, `PIX`, `BILLET`...) |
| `pagamento_parcelas` | `webhookData.installments` | Numero de parcelas |
| `utm_source` … `utm_content` | `webhookData.utm_*` | UTM **last-click da venda** (indexador/caminho do gateway) |
| `utm_id` | `webhookData.utm_id` | Vazio nos gateways cujo caminho tem so as 5 UTMs |
| `order_bump` | `webhookData.order_bump` | `SIM` / `NAO` (vazio se o gateway nao informa) |
| `pagamento_valor_total` | `webhookData.value` | **O que o cliente pagou** (bruto) |
| `pagamento_valor_gateway` | `webhookData.value_gateway` | Taxa retida pelo gateway |
| `pagamento_valor_nosso` | `webhookData.value_net` | Liquido do produtor. `total = gateway + nosso` |

**Campos que o parser do gateway devolve** para as colunas de transacao:
`offer_id`, `offer_name`, `payment_method`, `installments`, `order_bump` (boolean cru),
`value_gateway`, `value_net`. **Todos os 12 parsers completos ja os preenchem** — cada um com os
campos que o payload real daquele gateway oferece (campo que o gateway nao manda fica de fora e a
coluna fica vazia; nao quebra nada). Gateway novo via `/new-gateway` ja nasce com o contrato completo.

> A **coluna-chave `user_id` nao existe** na aba de vendas: vendas sao sempre **append**, nunca upsert.
> Se quiser cruzar venda com lead, acrescente uma coluna `user_id` na aba — mas note que o
> `sendSheetsPurchase` nao a envia hoje.

---

## Fluxo de qualificacao (visao end-to-end)

Quando o cliente tem um formulario de qualificacao multi-step (Elementor), o ciclo na planilha e:

1. **`lead`** (append) — o form de contato cria a linha com `user_id`, contato, UTMs, `data`/`hora`.
2. **`qualified_lead` / `disqualified_lead`** (upsert por `user_id`) — completa **a mesma linha** com `meta_event`, `qualificacao`, `lead_score`, `tier`, `resultado`, as respostas (`faturamento`/`tempo`/…) e extras (`instagram`).

Resultado: **uma linha por lead**, enriquecida com o resultado da qualificacao. A engenharia do client (Modulo 7, captura progressiva, gating do form) esta na reference `.claude/references/lead-qualification.md`; a metodologia do `lead_score` (peso × valor da letra, knockout, nearest-tier) e o bloco `qualification` no `SITE_CONFIG` estao documentados la. Esta skill cobre **so a parte da planilha**.

> **Pre-requisito:** o upsert so completa a linha se o evento `lead` tiver criado ela antes (mesma `user_id`). Se a qualificacao gravar sem o lead anterior, o GAS cai no fallback de append e cria uma linha so com as colunas de qualificacao (sem contato).

---

## Ativar no Worker

Com o `id_script` em maos, adicionar a plataforma `sheets` no `SITE_CONFIG` do `wrangler.toml`:

```json
"sheets": {
  "id_script": "{id_script}",
  "sheet": "{aba dos eventos web}",
  "purchase": { "sheet": "{aba das vendas}" }
}
```

- `sheet` — aba dos eventos web (lead/qualificacao). Omitido, o GAS usa o `SHEET_NAME` dele.
- `purchase` — **opt-in da planilha de vendas**. Sem esse bloco, nenhuma venda e planilhada.
  Campos: `sheet` (aba), `evento` (rotulo, default `compra_aprovada`),
  `platform_names` (mapa `gateway -> rotulo`), `enabled: false` para desligar sem remover o bloco.

### Os 3 cenarios (conforme a resposta do Passo 1)

**A — so leads:**
```json
"sheets": { "id_script": "{id_script}", "sheet": "users" }
```

**B — so vendas:**
```json
"sheets": { "id_script": "{id_script}", "events": [], "purchase": { "sheet": "transactions" } }
```
O `"events": []` e o que **desliga** o append dos eventos web sem desligar as vendas. Sem ele, o
default e `["lead"]` e o Worker tentaria gravar leads tambem.

**C — os dois:**
```json
"sheets": {
  "id_script": "{id_script}",
  "sheet": "users",
  "events": ["lead"],
  "purchase": { "sheet": "transactions", "platform_names": { "hotmart": "Hotmart" } }
}
```

> As duas entradas usam **o mesmo `id_script`**. Nao existe "um script para leads e outro para
> vendas" — o `_sheet` separa os destinos.

Exemplo completo de config com sheets:

```json
{
  "site_id": "meu_site",
  "platforms": {
    "meta": { "pixel_id": "..." },
    "sheets": {
      "id_script": "AKfycbwbyKd0epPr7Dhi9yYKWAmXz5YRVWJyv59KSOou18Rq"
    }
  }
}
```

Por padrao, o Worker faz **append** apenas no evento `lead`. Para incluir outros eventos no append, adicionar o campo `events`:

```json
"sheets": {
  "id_script": "...",
  "events": ["lead", "contact"]
}
```

> A qualificacao (`qualified_lead`/`disqualified_lead`) **nao** precisa estar em `events`: enquanto o `sheets` estiver configurado, esses eventos sempre disparam o upsert.

### `page_event_names` — nome do evento por pagina

Para gravar um rotulo de evento diferente por landing page na coluna `evento`, mapear `slug → nome` (o `slug` e o ultimo segmento do pathname da `page_url`):

```json
"sheets": {
  "id_script": "...",
  "page_event_names": { "registrol20": "L20_LG_SLPC", "brasilia": "BSB_LEAD" }
}
```

- Pagina `/lp/registrol20` → coluna `evento` recebe `L20_LG_SLPC`.
- Sem match (slug fora do mapa) → cai no nome cru do evento (`lead`).
- Aplica-se aos eventos de **append**; o upsert de qualificacao usa `meta_event`/`qualificacao`, nao `evento`.

Apos atualizar o `wrangler.toml`, fazer o deploy:

```bash
npx wrangler deploy
```

---

## Atualizacao do script GAS

### Identificar a versao instalada

Rode o teste de "Validacao > 1b" e olhe a resposta:

| Resposta do GAS | Versao | O que falta |
|---|---|---|
| sem o campo `sheet`, e a linha cai na aba errada | **v1** (append-only, aba hardcoded) | upsert, auto-create, `_sheet` |
| com `"sheet":"transactions"` mas `SHEET_KEY` preenchido no codigo | **v2** | zero-config (quebra se a planilha for duplicada) |
| com `"sheet":"transactions"` e `SHEET_KEY = ""` no codigo | **v3** | nada — esta atual |

v1 e v2 **funcionam** para o cliente que ja esta rodando (o `SHEET_KEY` deles aponta para a planilha
certa). A v3 so e obrigatoria na **planilha modelo** — sem ela, a copia do aluno grava na planilha do
professor. Ao dar manutencao num cliente antigo, migrar para a v3 e recomendado mas nao urgente.

### Reimplantar

Se precisar modificar o `Codigo.gs` apos a primeira implantacao:
1. Edite o arquivo no Apps Script
2. Va em **Implantar > Gerenciar implantacoes**
3. Clique no icone de edicao
4. Em "Versao", selecione **Nova versao**
5. Clique em **Implantar**

**O `id_script` nao muda ao criar uma nova versao.** Nao e necessario atualizar o `wrangler.toml`.

> ⚠️ **Nova versao ≠ Nova implantacao.** Se o cliente clicar em *Implantar > Nova implantacao*, o
> Google gera um `id_script` **novo** e o antigo continua servindo a versao velha do codigo — o
> Worker seguiria falando com o script desatualizado. Nesse caso: pegar o `id_script` novo,
> atualizar o `SITE_CONFIG` e fazer `npx wrangler deploy`. Sempre confirme qual dos dois o cliente
> fez comparando o `id_script` que ele mandou com o que esta no config.

---

## Validacao

### 1. Testar o endpoint diretamente

**Append:**
```
https://script.google.com/macros/s/{id_script}/exec?evento=lead&user_id=teste123&nome=Teste&email=teste@teste.com
```
Resposta esperada: `{"result":"success","mode":"append","sheet":"users","row":N}`

**Upsert** (rode depois do append acima, com o mesmo `user_id`):
```
https://script.google.com/macros/s/{id_script}/exec?_mode=upsert&_key=user_id&user_id=teste123&qualificacao=QUALIFICADO&lead_score=0.72&tier=B
```
Resposta esperada: `{"result":"success","mode":"update","sheet":"users","row":N}` — **mesma `row` N** do append. Verificar na planilha que `qualificacao`/`lead_score`/`tier` foram preenchidos **sem apagar** nome/email/`data`/`hora`, e que `lead_score` aparece como `0,72` (numero), nao `72`.

### 1b. Testar o roteamento de aba (vendas)

```
https://script.google.com/macros/s/{id_script}/exec?_sheet=transactions&plataforma=Hotmart&evento=compra_aprovada&transaction_id=TESTE-1&pagamento_valor_total=1
```
Resposta esperada: `{"result":"success","mode":"append","sheet":"transactions","row":N}` — repare no
campo `sheet`: e a confirmacao de que o `_sheet` foi respeitado. Se a resposta **nao trouxer** o campo
`sheet` (ou a linha cair na aba errada), o Apps Script implantado ainda e **v1/v2** — reimplante com
o GAS v3.

Depois apague a linha de teste da planilha.

### 2. Verificar no D1 apos um lead real

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, status_code, error_message, response_payload FROM events WHERE site_id = '{site_id}' AND platform = 'sheets' ORDER BY id DESC LIMIT 5;"
```

Resultado esperado (lead + qualificacao):
```
lead            | sheets | 200 | | {"result":"success","mode":"append","sheet":"users","row":N}
qualified_lead  | sheets | 200 | | {"result":"success","mode":"update","sheet":"users","row":N}
```

Para as **vendas**, a linha do log vem com `event_name = 'purchase'`, `channel = 'webhook'` e
`source = {gateway}`:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, source, status_code, error_message, response_payload FROM events WHERE platform = 'sheets' AND channel = 'webhook' ORDER BY id DESC LIMIT 5;"
```

```
purchase | hotmart | 200 | | {"result":"success","mode":"append","sheet":"transactions","row":N}
```

### Erros comuns

| Sintoma | Causa provavel | Solucao |
|---|---|---|
| Nenhuma linha no D1 com `platform = 'sheets'` | `id_script` ausente/incorreto no config | Verificar `SITE_CONFIG` no `wrangler.toml` e fazer novo deploy |
| `status_code: 0` + `error_message` | Worker nao alcancou o GAS | Verificar se o GAS esta implantado com "Qualquer pessoa" |
| `{"result":"error"}` no `response_payload` | `SHEET_KEY`/`SHEET_NAME` incorretos no GAS | Corrigir e reimplantar nova versao |
| Upsert cria linha nova em vez de completar | Coluna `user_id` ausente, ou o `lead` nao gravou antes | Garantir a coluna-chave `user_id` na linha 1 e que o `lead` veio primeiro |
| `mode:"update"` mas qualificacao em outra linha | `user_id` divergente entre `lead` e qualificacao | Conferir que o mesmo `marca_user` (cookie) cobre os dois eventos |
| Colunas de qualificacao nao aparecem | GAS antigo (append-only, sem upsert/auto-create) | Reimplantar com o GAS universal acima |
| Coluna `país` sempre vazia | Cabecalho `pais` sem acento | Renomear o cabecalho para `país` (case/acento exatos) |
| Colunas vazias na planilha | Nome do cabecalho diferente da chave enviada | Alinhar nomes — case-sensitive |
| `lead_score = 0.625` aparece como `625` | GAS sem `NUMERIC_COLUMNS`/`coerceVal` (v1/v2) em planilha pt-BR | Reimplantar com o GAS v3 (coercao numerica) |
| Venda cai na aba errada (`sheet` da resposta != aba pedida) | Apps Script ainda na v1 (ignora `_sheet`) | Reimplantar com o GAS v3 (Nova versao) |
| Dados do cliente aparecem na planilha de OUTRA pessoa | Copia de uma planilha cujo GAS tinha `SHEET_KEY` hardcoded (v1/v2) | Migrar para o GAS v3 (`SHEET_KEY = ""`) e reimplantar |
| `{"result":"error","error":"planilha_nao_resolvida..."}` | Script avulso (nao vinculado a uma planilha) | Preencher `SHEET_KEY` com o ID da planilha, ou recriar via `Extensoes > Apps Script` |
| Leads gravando quando o cliente so queria vendas | `events` ausente (default `["lead"]`) | Adicionar `"events": []` ao bloco `sheets` |
| Telefone vira numero / perde zero a esquerda | Coluna fora de `TEXT_COLUMNS` | Acrescentar o nome da coluna em `TEXT_COLUMNS` e reimplantar |
| Nenhuma linha com `channel = 'webhook'` no D1 | Bloco `sheets.purchase` ausente no `SITE_CONFIG` | Adicionar `purchase.sheet` e fazer novo deploy |
| Venda nao planilhada mas ha `webhook_raw` | Webhook nao era compra aprovada (`status: ignored`) ou era duplicata (`status: duplicate`) | Conferir o retorno do `/collect/webhook/{gateway}` |
| `pagamento_valor_gateway`/`_nosso` vazios | Gateway nao informa taxa/liquido no payload (ex.: Kirvano, Eduzz) | Comportamento esperado — conferir a planta do gateway no parser |

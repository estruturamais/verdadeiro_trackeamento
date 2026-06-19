# Skill: tracking_planilha

## Papel

Voce e o especialista na integracao de leads com Google Sheets via Google Apps Script. Sabe configurar a planilha, implantar o script como aplicativo web, e ativar a integracao no Worker via `SITE_CONFIG`.

A integracao e **server-side**: o Worker envia os dados para o GAS no momento em que recebe o evento (`lead` e, quando ha qualificacao, `qualified_lead`/`disqualified_lead`), sem depender de GTM ou de qualquer script no browser.

O conector vive em `src/worker/platforms/sheets.js` (`sendSheetsLead`), ligado em `src/worker/collect/event.js`. Ele faz **append** (linha nova) e **upsert por `user_id`** (completa a linha do lead) contra um **GAS universal** — um unico `Codigo.gs` que faz append + upsert + auto-criacao de colunas.

Quando o cliente ja tem um `id_script`, voce o usa diretamente. Quando nao tem, voce o guia pelo processo completo de criacao.

---

## Fluxo inicial

**Pergunta ao cliente:**
> "Voce ja tem um Google Apps Script implantado para receber os leads na planilha? Se sim, me passa o `id_script` (o codigo da implantacao). Se nao, vou te guiar na configuracao."

- Se **ja tem o id_script** → ir direto para a secao "Ativar no Worker"
- Se **nao tem** → seguir a configuracao do zero abaixo

> **GAS universal:** o script abaixo ja vem com append + upsert + auto-criacao de colunas. E o mesmo `Codigo.gs` para qualquer cliente — copiar/colar e sair usando, sem pre-criar cabecalhos. Se o cliente trouxe um `id_script` de um script antigo (append-only, sem upsert), **reimplante** com a versao universal antes de ligar a qualificacao (ver "Atualizacao do script GAS").

---

## Configurar o Google Apps Script

### 1. Criar a planilha

1. Acesse `sheets.google.com` e crie uma nova planilha (ou use uma existente)
2. Renomeie a aba para o nome desejado (ex: `Leads`)
3. Na linha 1, adicione os cabecalhos das colunas desejadas

**Modelo de referencia:**
`https://docs.google.com/spreadsheets/d/1TG9gBVd6SlwBZKvf80-4kG6pSE3Mm4N9Okv8pkhN_Gc/edit?usp=sharing`

Com `AUTO_CREATE_HEADERS = true` (default do GAS universal), **nao e obrigatorio pre-criar os cabecalhos**: qualquer campo que chegar sem coluna correspondente ganha uma coluna nova automaticamente. Ainda assim, recomenda-se deixar pelo menos `user_id`, `data` e `hora` na linha 1 — `user_id` e a **coluna-chave do upsert** (sem ela a qualificacao nao consegue completar a linha do lead).

Colunas especiais preenchidas automaticamente pelo script (nao precisam vir no payload):
- `data` → data do registro no formato `dd/MM/yyyy`
- `hora` → hora do registro no formato `HH:mm` (fuso America/Sao_Paulo)

4. Copie o **ID da planilha** da URL — e a parte entre `/d/` e `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/1TG9gBVd6SlwBZKvf80-4kG6pSE3Mm4N9Okv8pkhN_Gc/edit?usp=sharing
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          ID_DA_PLANILHA = 1TG9gBVd6SlwBZKvf80-4kG6pSE3Mm4N9Okv8pkhN_Gc
   ```

### 2. Criar o Apps Script (GAS universal: append + upsert + auto-create)

1. Na planilha, va em **Extensoes > Apps Script**
2. Substitua todo o conteudo do `Codigo.gs` pelo script abaixo, com `SHEET_NAME` e `SHEET_KEY` preenchidos:

```javascript
// ===== Configuracao (so estas duas linhas mudam por cliente) =====
var SHEET_NAME = "NOME_DA_ABA";    // nome exato da aba
var SHEET_KEY  = "ID_DA_PLANILHA"; // ID da planilha (parte entre /d/ e /edit)

// Cria coluna nova quando chega um campo do payload sem cabecalho correspondente.
// Deixe true para "copiar/colar e sair usando" sem pre-criar cabecalhos.
var AUTO_CREATE_HEADERS = true;
// Coluna-chave default do upsert (o Worker manda _key=user_id explicitamente).
var KEY_COLUMN = "user_id";

function doGet(e)  { return handleResponse(e); }
function doPost(e) { return handleResponse(e); }

function handleResponse(e) {
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);

  try {
    var doc   = SpreadsheetApp.openById(SHEET_KEY);
    var sheet = doc.getSheetByName(SHEET_NAME);

    // Pega os parametros (GET query string ou POST JSON)
    var data = (e.postData && e.postData.contents)
      ? JSON.parse(e.postData.contents)
      : (e.parameter || {});

    // Parametros de CONTROLE do GAS universal — NUNCA viram coluna.
    var mode   = String(data._mode || "append").toLowerCase(); // "append" | "upsert"
    var keyCol = data._key || KEY_COLUMN;
    delete data._mode;
    delete data._key;

    // Cabecalhos atuais (linha 1)
    var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];

    // Auto-criacao: qualquer chave do payload sem coluna ganha um cabecalho novo
    if (AUTO_CREATE_HEADERS) {
      for (var key in data) {
        if (data.hasOwnProperty(key) && headers.indexOf(key) === -1) {
          headers.push(key);
          sheet.getRange(1, headers.length).setValue(key);
        }
      }
    }

    var now           = new Date();
    var formattedDate = Utilities.formatDate(now, "America/Sao_Paulo", "dd/MM/yyyy");
    var formattedTime = Utilities.formatDate(now, "America/Sao_Paulo", "HH:mm");

    // ===== UPSERT: completa a linha existente (procura pela coluna-chave) =====
    if (mode === "upsert") {
      var keyIdx = headers.indexOf(keyCol);
      var keyVal = data[keyCol];
      var targetRow = -1;

      if (keyIdx !== -1 && keyVal) {
        var lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          var keyValues = sheet.getRange(2, keyIdx + 1, lastRow - 1, 1).getValues();
          for (var r = 0; r < keyValues.length; r++) {
            if (String(keyValues[r][0]) === String(keyVal)) { targetRow = r + 2; break; }
          }
        }
      }

      if (targetRow !== -1) {
        // Grava SO as colunas presentes no payload (preserva contato/data/hora e o resto)
        for (var c = 0; c < headers.length; c++) {
          var h = headers[c];
          if (data.hasOwnProperty(h) && data[h] !== "") {
            sheet.getRange(targetRow, c + 1).setValue(data[h]);
          }
        }
        return jsonOut({ result: "success", mode: "update", row: targetRow });
      }
      // Chave nao encontrada -> cai para append (cria a linha)
    }

    // ===== APPEND: linha nova alinhada aos cabecalhos =====
    var row = [];
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (h === "data")      row.push(formattedDate);
      else if (h === "hora") row.push(formattedTime);
      else                   row.push(data.hasOwnProperty(h) ? data[h] : "");
    }
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);

    return jsonOut({ result: "success", mode: "append", row: nextRow });
  }
  catch (err) {
    return jsonOut({ result: "error", error: err.message });
  }
  finally {
    lock.releaseLock();
  }
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
- **Upsert** (`_mode=upsert&_key=user_id`): localiza a linha cuja coluna-chave (`user_id`) bate com o valor recebido e atualiza **apenas as colunas presentes no payload** — preserva contato, `data`, `hora` e qualquer coluna nao enviada. Se nao achar a chave, cria a linha (fallback para append).
- **Auto-create** (`AUTO_CREATE_HEADERS = true`): qualquer chave do payload sem coluna correspondente vira um cabecalho novo na hora — sem mexer no script para adicionar colunas.
- `_mode` e `_key` sao **parametros de controle** — sao removidos antes de gravar e **nunca viram coluna**.

### 3. Implantar como aplicativo web

1. Clique em **Implantar > Nova implantacao**
2. Em "Tipo", selecione **Aplicativo da Web**
3. Configure:
   - **Descricao:** `Webhook Leads` (qualquer nome descritivo)
   - **Executar como:** `Eu ({seu email})`
   - **Quem tem acesso:** `Qualquer pessoa` — obrigatorio para o Worker fazer o request sem autenticacao
4. Clique em **Implantar**
5. Autorize as permissoes solicitadas
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
| `lead_score` | `body.custom_data.lead_score` | Score 0–1 (float) |
| `tier` | `body.custom_data.lead_tier` | Faixa `A`/`B`/`C`/`X` |
| `resultado` | `body.qualification.resultado` | Valor calculado no site (campo `result_field`) |
| `{sheet_col}` por pergunta | `body.qualification.answers[field]` | Uma coluna por pergunta — ver mapeamento abaixo |
| `{extra}` (ex.: `instagram`) | `body.qualification.extras[chave]` | Campos extras ja chaveados pelo nome logico da coluna |

**Respostas por pergunta → coluna:** o Worker percorre `config.qualification.questions[]` e grava `answers[field]` na coluna nomeada por `sheet_col`. Com a config de exemplo (`faturamento`/`tempo`/`investir`/`iniciar`), a planilha ganha essas quatro colunas. As **letras** das respostas (A/B/C/X) sao gravadas como vieram do form.

Com `AUTO_CREATE_HEADERS = true`, todas essas colunas de qualificacao sao criadas automaticamente na primeira gravacao — nao precisa pre-cria-las.

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
  "id_script": "{id_script}"
}
```

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

Se precisar modificar o `Codigo.gs` apos a primeira implantacao (ex.: migrar de um script append-only antigo para o GAS universal):
1. Edite o arquivo no Apps Script
2. Va em **Implantar > Gerenciar implantacoes**
3. Clique no icone de edicao
4. Em "Versao", selecione **Nova versao**
5. Clique em **Implantar**

**O `id_script` nao muda ao criar uma nova versao.** Nao e necessario atualizar o `wrangler.toml`.

---

## Validacao

### 1. Testar o endpoint diretamente

**Append:**
```
https://script.google.com/macros/s/{id_script}/exec?evento=lead&user_id=teste123&nome=Teste&email=teste@teste.com
```
Resposta esperada: `{"result":"success","mode":"append","row":N}`

**Upsert** (rode depois do append acima, com o mesmo `user_id`):
```
https://script.google.com/macros/s/{id_script}/exec?_mode=upsert&_key=user_id&user_id=teste123&qualificacao=QUALIFICADO&lead_score=0.72&tier=B
```
Resposta esperada: `{"result":"success","mode":"update","row":N}` — **mesma `row` N** do append. Verificar na planilha que `qualificacao`/`lead_score`/`tier` foram preenchidos **sem apagar** nome/email/`data`/`hora`.

### 2. Verificar no D1 apos um lead real

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, status_code, error_message, response_payload FROM events WHERE site_id = '{site_id}' AND platform = 'sheets' ORDER BY id DESC LIMIT 5;"
```

Resultado esperado (lead + qualificacao):
```
lead            | sheets | 200 | | {"result":"success","mode":"append","row":N}
qualified_lead  | sheets | 200 | | {"result":"success","mode":"update","row":N}
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

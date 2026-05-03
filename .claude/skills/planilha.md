# Skill: tracking_planilha

## Papel

Voce e o especialista na integracao de leads com Google Sheets via Google Apps Script. Sabe configurar a planilha, implantar o script como aplicativo web, e ativar a integracao no Worker via `SITE_CONFIG`.

A integracao e **server-side**: o Worker envia os dados para o GAS no momento em que recebe o evento `lead`, sem depender de GTM ou de qualquer script no browser.

Quando o cliente ja tem um `id_script`, voce o usa diretamente. Quando nao tem, voce o guia pelo processo completo de criacao.

---

## Fluxo inicial

**Pergunta ao cliente:**
> "Voce ja tem um Google Apps Script implantado para receber os leads na planilha? Se sim, me passa o `id_script` (o codigo da implantacao). Se nao, vou te guiar na configuracao."

- Se **ja tem o id_script** → ir direto para a secao "Ativar no Worker"
- Se **nao tem** → seguir a configuracao do zero abaixo

---

## Configurar o Google Apps Script

### 1. Criar a planilha

1. Acesse `sheets.google.com` e crie uma nova planilha (ou use uma existente)
2. Renomeie a aba para o nome desejado (ex: `Leads`)
3. Na linha 1, adicione os cabecalhos das colunas desejadas

**Modelo de referencia:**
`https://docs.google.com/spreadsheets/d/1TG9gBVd6SlwBZKvf80-4kG6pSE3Mm4N9Okv8pkhN_Gc/edit?usp=sharing`

Colunas especiais preenchidas automaticamente pelo script (nao precisam vir no payload):
- `data` → data do registro no formato `dd/MM/yyyy`
- `hora` → hora do registro no formato `HH:mm` (fuso America/Sao_Paulo)

4. Copie o **ID da planilha** da URL — e a parte entre `/d/` e `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/1TG9gBVd6SlwBZKvf80-4kG6pSE3Mm4N9Okv8pkhN_Gc/edit?usp=sharing
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          ID_DA_PLANILHA = 1TG9gBVd6SlwBZKvf80-4kG6pSE3Mm4N9Okv8pkhN_Gc
   ```

### 2. Criar o Apps Script

1. Na planilha, va em **Extensoes > Apps Script**
2. Substitua todo o conteudo do `Codigo.gs` pelo script abaixo, com `SHEET_NAME` e `SHEET_KEY` preenchidos:

```javascript
// 1) Nome da sua aba e ID da planilha
var SHEET_NAME = "NOME_DA_ABA";    // substituir pelo nome exato da aba
var SHEET_KEY  = "ID_DA_PLANILHA"; // substituir pelo ID copiado acima

// 2) Mantém essa parte para configuração única
var SCRIPT_PROP = PropertiesService.getScriptProperties();

function doGet(e)  { return handleResponse(e); }
function doPost(e) { return handleResponse(e); }

function handleResponse(e) {
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);

  try {
    var doc   = SpreadsheetApp.openById(SHEET_KEY);
    var sheet = doc.getSheetByName(SHEET_NAME);

    // Cabeçalho na linha 1
    var headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0];
    var nextRow = sheet.getLastRow() + 1;

    // Pega os parâmetros (GET ou POST JSON)
    var data = e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : e.parameter;

    // Monta a linha a gravar
    var row = [];
    var now = new Date();
    var formattedDate = Utilities.formatDate(now, "America/Sao_Paulo", "dd/MM/yyyy");
    var formattedTime = Utilities.formatDate(now, "America/Sao_Paulo", "HH:mm");

    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (h === "data") {
        row.push(formattedDate);
      }
      else if (h === "hora") {
        row.push(formattedTime);
      }
      else {
        // Se não vier no payload, devolve string vazia
        row.push(data[h] || "");
      }
    }

    // Grava de uma vez
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);

    return ContentService
      .createTextOutput(JSON.stringify({ result: "success", row: nextRow }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: "error", error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  finally {
    lock.releaseLock();
  }
}
```

**Como o script funciona — orientado a cabecalhos:**
- Le os nomes das colunas da linha 1 da aba
- Para cada cabecalho, busca o valor de mesmo nome no payload recebido
- Colunas `data` e `hora` sao preenchidas automaticamente
- Qualquer campo sem valor fica vazio — sem erro
- Para adicionar uma coluna nova: basta acrescentar o nome no cabecalho — sem mexer no script

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

O Worker envia os seguintes campos para o GAS via query string GET. Os cabecalhos da planilha devem usar os mesmos nomes (case-sensitive):

| Chave (cabecalho na planilha) | Origem no Worker | Descricao |
|---|---|---|
| `data` | GAS — automatico | Data do registro `dd/MM/yyyy` |
| `hora` | GAS — automatico | Hora do registro `HH:mm` |
| `evento` | `body.event` | Tipo do evento (ex: `lead`) |
| `user_id` | `body.marca_user` | ID unico do usuario (cookie first-party) |
| `nome` | `body.user_data.first_name` + `last_name` | Nome do lead |
| `email` | `body.user_data.email` | Email do lead |
| `telefone` | `body.user_data.phone` | Telefone do lead |
| `gender` | `body.user_data.gender` | Genero do usuario |
| `pais` | `body.user_data.country` | Pais do usuario |
| `estado` | `body.user_data.state` | Estado do usuario |
| `cidade` | `body.user_data.city` | Cidade do usuario |
| `utm_source` | `body.utm_data.utm_source` | UTM — origem |
| `utm_medium` | `body.utm_data.utm_medium` | UTM — midia |
| `utm_campaign` | `body.utm_data.utm_campaign` | UTM — campanha |
| `utm_content` | `body.utm_data.utm_content` | UTM — conteudo |
| `utm_term` | `body.utm_data.utm_term` | UTM — termo |
| `utm_id` | `body.utm_data.utm_id` | UTM — ID |
| `slug` | `body.page_url` (pathname) | Slug da pagina (ex: `brasilia`) |
| `page_location` | `body.page_url` | URL completa da pagina |
| `ip_address` | Header `CF-Connecting-IP` | IP do visitante |
| `user_agent` | Header `User-Agent` | User agent do browser |
| `fbc` | `body.browser_data.fbc` | Cookie de clique Meta Ads |
| `fbp` | `body.browser_data.fbp` | Cookie de browser Meta Ads |

**Importante:** `data` e `hora` sao preenchidas pelo GAS — nao devem existir como cabecalhos que esperam valor do payload (o script ja trata isso automaticamente).

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

Por padrao, o Worker so envia para o Sheets no evento `lead`. Para incluir outros eventos, adicionar o campo `events`:

```json
"sheets": {
  "id_script": "...",
  "events": ["lead", "contact"]
}
```

Apos atualizar o `wrangler.toml`, fazer o deploy:

```bash
npx wrangler deploy
```

---

## Atualizacao do script GAS

Se precisar modificar o `Codigo.gs` apos a primeira implantacao:
1. Edite o arquivo no Apps Script
2. Va em **Implantar > Gerenciar implantacoes**
3. Clique no icone de edicao
4. Em "Versao", selecione **Nova versao**
5. Clique em **Implantar**

**O `id_script` nao muda ao criar uma nova versao.** Nao e necessario atualizar o `wrangler.toml`.

---

## Validacao

### 1. Testar o endpoint diretamente

Acessar no browser com parametros de teste:
```
https://script.google.com/macros/s/{id_script}/exec?evento=lead&nome=Teste&email=teste@teste.com
```

Resposta esperada: `{"result":"success","row":N}`

Verificar na planilha se a linha foi inserida.

### 2. Verificar no D1 apos um lead real

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT platform, status_code, error_message, response_payload FROM events WHERE site_id = '{site_id}' AND platform = 'sheets' ORDER BY id DESC LIMIT 5;"
```

Resultado esperado:
```
sheets | 200 | | {"result":"success","row":N}
```

### Erros comuns

| Sintoma | Causa provavel | Solucao |
|---|---|---|
| Nenhuma linha no D1 com `platform = 'sheets'` | `id_script` ausente ou incorreto no config | Verificar `SITE_CONFIG` no `wrangler.toml` e fazer novo deploy |
| `status_code: 0` + `error_message` | Worker nao conseguiu alcancar o GAS | Verificar se o GAS esta implantado com "Qualquer pessoa" |
| `{"result":"error"}` no `response_payload` | `SHEET_KEY` ou `SHEET_NAME` incorretos no GAS | Corrigir e reimplantar nova versao |
| Colunas vazias na planilha | Nome do cabecalho diferente da chave enviada | Alinhar nomes — case-sensitive |

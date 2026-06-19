# Reference: Qualificacao de lead multi-step — engenharia do Modulo 7

> Builder-agnostic. O **Elementor** e o caminho zero-config (auto-deteccao por DOM); para
> qualquer outro builder (InLead/GreatPages/Wix/HTML puro) use o escape hatch `window.VT_qualify()`
> ou o `dataLayer` (secao 7). O calculo do `lead_score` e identico nos dois caminhos.
> *(Antes deste doc se chamava `elementor-multistep-qualification.md`.)*

## Quando este arquivo se aplica

- Site tem um **formulario de qualificacao multi-step** (quiz/pop-up) que classifica o lead — em Elementor Pro **ou** qualquer outro builder.
- O objetivo nao e so disparar `lead`, e calcular um **`lead_score`** e emitir `QualifiedLead`/`DisqualifiedLead`.
- O `SITE_CONFIG` tem (ou vai ganhar) um bloco `qualification`, exposto ao client pelo `serve-webjs.js`.

Pre-requisito de leitura: `.claude/references/elementor-form-lead.md` cobre os 4 metodos de deteccao de sucesso do Elementor (Modulo 5). Esta reference assume aquilo e descreve a **camada de qualificacao** (Modulo 7) construida por cima.

Codigo-fonte: `src/web.js`, funcao `initQualification()` (Modulo 7) + o roteamento em `_fireElementorLead()` (Modulo 5). Worker: `platforms/meta.js` (eventos custom), `platforms/sheets.js` (upsert).

---

## Arquitetura em uma frase

O Modulo 5 ja detecta o sucesso de qualquer form Elementor e dispara `lead`. O Modulo 7 **intercepta esse sucesso apenas quando o form e o de qualificacao**, captura as respostas **progressivamente** (antes do Elementor limpar os campos), calcula o `lead_score` e emite o **`lead`** (apos coletar o contato) **seguido de** `QualifiedLead`/`DisqualifiedLead` (com as respostas + ao menos o e-mail). Tudo **aditivo**: onde nao ha bloco `qualification` nem a assinatura do form, o Modulo 7 nao faz nada.

```
Elementor success (4 metodos do Modulo 5)
        │
        ▼
 _fireElementorLead()
        │
  window.__rtQualPending === true ?
   ├── sim → fireQualResult()  →  fireTrigger('lead') + (~1s) emitQual(Qualified/Disqualified)
   └── nao → fireTrigger('lead', ...)      (caminho normal)
```

---

## 1. Ativacao condicional (aditivo, sem regressao)

`initQualification()` retorna cedo se nao houver config valido — o Modulo 7 so existe onde foi configurado:

```js
function initQualification() {
  var Q = __CONFIG__.qualification;
  if (!Q) return;   // sem bloco qualification → no-op (com bloco, roda mesmo sem form_signature — secao 7)
  ...
}
try { initQualification(); } catch(e) {}
```

O bloco `qualification` chega ao client via `serve-webjs.js` (`clientConfig.qualification = config.qualification`). Forma do bloco (do `config.example.json`):

```json
"qualification": {
  "form_signature": "form_fields[q1]",
  "contact_fields": { "name": "form_fields[nome]", "email": "form_fields[email]", "phone": "form_fields[whatsapp]" },
  "extra_fields": { "instagram": "form_fields[instagram]" },
  "questions": [
    { "field": "form_fields[q1]", "weight": 0.30, "sheet_col": "faturamento" },
    { "field": "form_fields[q2]", "weight": 0.20, "sheet_col": "tempo" },
    { "field": "form_fields[q3]", "weight": 0.30, "sheet_col": "investir" },
    { "field": "form_fields[q4]", "weight": 0.20, "sheet_col": "iniciar" }
  ],
  "letter_values": { "A": 0.85, "B": 0.55, "C": 0.30, "X": 0.10 },
  "dq_letter": "X",
  "result_field": "form_fields[resultado]"
}
```

| Campo | Papel |
|---|---|
| `form_signature` | `name` de um input que **so existe no form-qual** — identifica o form (ver secao 2) |
| `contact_fields` | mapeia `name`→`{name,email,phone}` para salvar cookies/Advanced Matching |
| `extra_fields` | campos extras (ex.: `instagram`) → vao em `extras` p/ o Sheets |
| `questions[]` | `field` (name do input), `weight` (peso, soma 1), `sheet_col` (coluna no Sheets) |
| `letter_values` | valor numerico de cada letra (ponto-medio da faixa do tier) |
| `dq_letter` | letra de **knockout** (desqualifica na hora) |
| `result_field` | input com o resultado calculado no proprio site (texto livre) |

---

## 2. Gating por form especifico — a pop-up DUPLICA o `<form>`

**Modo de falha real.** A pop-up de qualificacao do Elementor costuma renderizar o `<form>` **duas vezes** no DOM (um na pagina, um no modal). `document.querySelector('form...')` pega o errado — captura campos vazios e/ou quebra o `lead` dos outros forms da pagina.

**Solucao: nunca consultar o DOM globalmente.** Identifique o form pelo evento (`e.target`/`e.target.closest('form')`) e confirme que ele e o form-qual procurando, **dentro daquele form**, um input cujo `name === form_signature`:

```js
function isQualForm(form) {
  if (!form || !form.querySelectorAll) return false;
  var inputs = form.querySelectorAll('input, textarea, select');
  for (var i = 0; i < inputs.length; i++) {
    if (inputs[i].name === Q.form_signature) return true;   // assinatura estavel
  }
  return false;
}
```

Por que `form_signature` (um `name` que so o form-qual tem) e nao `form_id`/classe:
- Sobrevive a duplicacao (cada copia tem a assinatura, e iteramos sobre a copia que recebeu o evento).
- Estavel entre renders e independente do `id` gerado pelo Elementor (que muda por instancia).

**Nao quebrar o `lead` dos outros forms.** O roteamento e feito por uma flag por-submissao (`window.__rtQualPending`), nao por substituir o handler global. Forms normais continuam caindo em `fireTrigger('lead')`; so o form-qual roteia para o Modulo 7 (secao 4).

---

## 3. Captura progressiva — o Elementor limpa os campos no sucesso

**Modo de falha real.** Se voce ler as respostas **no callback de sucesso**, recebe vazio: o Elementor limpa os campos do form depois do AJAX, antes (ou junto) do success. Sintoma: `lead_score` sempre 0, colunas de resposta vazias no Sheets.

**Solucao: capturar em todo momento em que o usuario interage**, acumulando em estado local. O Modulo 7 captura em **tres** gatilhos, todos no capture phase (`true`):

```js
// (a) cada resposta marcada/digitada
document.addEventListener('change', function(e) {
  var form = e.target && e.target.closest ? e.target.closest('form') : null;
  if (!form || !isQualForm(form)) return;
  window.__rtHasQualForm = true;
  captureFrom(form);
}, true);

// (b) submit nativo (quando ocorre) — tambem decide o roteamento
document.addEventListener('submit', function(e) {
  var form = e.target;
  if (!form || form.tagName !== 'FORM') return;
  var isQual = isQualForm(form);
  window.__rtQualPending = isQual;   // reseta p/ false em forms normais
  if (isQual) { window.__rtHasQualForm = true; captureFrom(form); }
}, true);

// (c) clique no botao de envio do passo final (multi-step nem sempre emite submit nativo)
document.addEventListener('click', function(e) {
  var btn = e.target && e.target.closest ? e.target.closest('button, [type="submit"], .elementor-button') : null;
  if (!btn) return;
  var form = btn.closest ? btn.closest('form') : null;
  if (!form || !isQualForm(form)) return;
  window.__rtHasQualForm = true;
  window.__rtQualPending = true;
  captureFrom(form);
}, true);
```

`captureFrom()` le **so os campos vigiados** (perguntas + contato + extras + `result_field`), ignorando vazios e respeitando `checked` em radio/checkbox:

```js
function captureFrom(form) {
  var inputs = form.querySelectorAll('input, textarea, select');
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i], nm = el.name;
    if (!nm || !WATCHED[nm]) continue;                       // so o que interessa
    var type = (el.type || '').toLowerCase();
    if ((type === 'radio' || type === 'checkbox') && !el.checked) continue;
    var val = (el.value || '').trim();
    if (!val) continue;                                      // vazio nao sobrescreve
    storeValue(nm, val);                                     // roteia p/ answers/contact/extras/resultado
  }
}
```

`WATCHED` e um set montado uma vez a partir de `questions[].field` + `contact_fields` + `extra_fields` + `result_field`. `storeValue()` deposita cada `name` no balde certo (`answers`, `contact`, `extras` ou `resultado`).

**Resultado:** quando o sucesso chega, as respostas ja estao em memoria — reler o DOM (vazio) e desnecessario.

---

## 4. Reaproveitamento dos 4 metodos de sucesso (Modulo 5)

O Modulo 7 **nao** reimplementa deteccao de sucesso. Os 4 metodos do Modulo 5 (MutationObserver `.elementor-message-success` + jQuery `ajaxSuccess` + intercept XHR + intercept fetch — ver `elementor-form-lead.md`) ja convergem em `_fireElementorLead()`. O ponto de extensao e **uma bifurcacao** no inicio dessa funcao:

```js
// src/web.js — _fireElementorLead() (Modulo 5)
function _fireElementorLead() {
  if (_elLeadFired) return;
  _elLeadFired = true;
  setTimeout(function() { _elLeadFired = false; }, 5000);   // dedup compartilhada
  // MODULE 7: se o sucesso veio do form-qual, roteia p/ qualificacao em vez de 'lead'
  if (window.__rtQualPending && typeof window.__rtQualOnSuccess === 'function') {
    try { window.__rtQualOnSuccess(); } catch(e) {}
    return;
  }
  try {
    var fd = _elementorPendingFormData || {};
    _elementorPendingFormData = null;
    saveUserCookies(fd);
    fireTrigger('lead', fd);
  } catch(e) {}
}
```

Vantagens de pendurar aqui:
- **Um unico guard de dedup** (`_elLeadFired`, reset 5s) cobre `lead` e qualificacao — nenhum disparo duplo, independente de quantos dos 4 metodos detectem o mesmo sucesso.
- A escolha lead-vs-qualificacao e por-submissao (`__rtQualPending`), entao a mesma pagina pode ter um form normal (→`lead`) e o form-qual (→`QualifiedLead`) sem conflito.

`window.__rtQualOnSuccess` (Elementor) e `window.VT_qualify` (secao 7) convergem em `fireQualResult()`, que aplica a **ordem de disparo recomendada** (especialista Meta Ads): `lead` apos o contato, depois a qualificacao.

```js
var _qualEmitted = false;
function fireQualResult() {
  if (_qualEmitted) return;
  if (!contact.email) return;            // precondicao: respostas + ao menos o e-mail
  _qualEmitted = true;
  setTimeout(function() { _qualEmitted = false; }, 5000);
  window.__rtQualPending = false;
  saveUserCookies(contact);              // Advanced Matching
  var r = computeScore();
  var customData = { lead_score: r.score, lead_tier: r.tier };
  var qualification = { answers: answers, extras: extras, resultado: resultado };  // p/ o Sheets
  // 1) lead apos o contato: evento Lead + cria a linha no Sheets (append) com contato
  fireTrigger('lead', contact);
  // 2) QualifiedLead/DisqualifiedLead ~1s depois — upsert por user_id completa a linha do lead
  var key = r.qualified ? 'qualified_lead' : 'disqualified_lead';
  var metaName = r.qualified ? 'QualifiedLead' : 'DisqualifiedLead';
  setTimeout(function() { emitQual(key, metaName, customData, contact, qualification); }, 1000);
}
```

**Por que dispara `lead` E `QualifiedLead`/`DisqualifiedLead`** (recomendacao de tracking, nao um detalhe de implementacao — deixar claro a quem configura):
- O **`lead`** (apos coletar contato) alimenta a otimizacao padrao do Meta e **cria a linha no Sheets** (append, com contato).
- O **`QualifiedLead`/`DisqualifiedLead`** (apos respostas + e-mail) leva `lead_score`/`lead_tier` ao CAPI para otimizacao por qualidade e **completa a mesma linha** via upsert por `user_id`.
- **Precondicao `contact.email`**: sem e-mail capturado, **nada dispara**. Por isso o `email` em `contact_fields` e **obrigatorio** no form de qualificacao — sem ele o match no Meta e a linha do Sheets ficam fracos.
- **Ordem/atraso**: o `lead` (append) vai primeiro e a qualificacao (upsert) ~1s depois, para a linha existir antes do upsert. Como rede de seguranca, o upsert tambem grava o contato (caso o beacon do `lead` se perca). Em form que **redireciona** no sucesso, o atraso pode encurtar a janela do beacon de qualificacao — prefira form que mostra o resultado inline.

`emitQual()` dispara o evento custom em todos os pixels-espelho com **`trackSingleCustom`** (mesmo `eventID`) e manda o beacon ao Worker; o `custom_data` (`lead_score`/`lead_tier`) vai pro CAPI e o bloco `qualification` (respostas/extras/resultado) vai em campo dedicado p/ o Sheets gravar via upsert. Ver a skill `meta_ads` (CAPI) e `planilha` (Sheets).

---

## 5. Metodologia do `lead_score`

### Valor por letra

Cada letra de resposta (A/B/C/X) vale o **ponto-medio da faixa do tier** que ela representa. Default:

| Letra | `letter_value` | Leitura |
|---|---|---|
| A | 0.85 | tier alto |
| B | 0.55 | tier medio |
| C | 0.30 | tier baixo |
| X | 0.10 | knockout (desqualifica) |

### Formula

`lead_score = Σ(weight_i × letter_value(answer_i))`, com os `weight` somando 1. Implementacao:

```js
function computeScore() {
  var score = 0, knockout = false;
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    if (!q || !q.field) continue;
    var letter = String(answers[q.field] || '').trim().toUpperCase();
    if (letter && letter === dqLetter) knockout = true;       // knockout
    var v = letterValues[letter];
    var w = typeof q.weight === 'number' ? q.weight : (parseFloat(q.weight) || 0);
    if (typeof v === 'number') score += w * v;
  }
  if (knockout) score = 0;
  score = Math.round(score * 10000) / 10000;                  // tira ruido de float
  return { score: score, qualified: !knockout, tier: nearestTier(score, knockout) };
}
```

### Knockout (`dq_letter`)

Se **qualquer** resposta for a `dq_letter` (default `X`), o lead e desqualificado independente do resto: `score = 0`, `qualified = false`, `tier = dq_letter`. Use para criterios eliminatorios (ex.: "nao tem orcamento" → fora, mesmo que o resto seja A).

### Nearest-tier

O `tier` reportado **nao** e a letra de nenhuma resposta isolada — e a letra cujo `letter_value` esta **mais proximo do score agregado**. Isso resume o lead numa unica faixa coerente com o score:

```js
function nearestTier(score, knockout) {
  if (knockout) return dqLetter;
  var best = '', bestDiff = Infinity;
  for (var L in letterValues) {
    var diff = Math.abs(score - letterValues[L]);
    if (diff < bestDiff) { bestDiff = diff; best = L; }
  }
  return best;
}
```

Exemplo: respostas A/B/A/B com pesos 0.30/0.20/0.30/0.20 → `score = 0.30·0.85 + 0.20·0.55 + 0.30·0.85 + 0.20·0.55 = 0.70`. O `letter_value` mais proximo de 0.70 e A (0.85, diff 0.15) vs B (0.55, diff 0.15) — empate resolvido pela ordem de iteracao do objeto (a primeira chave que atinge o menor diff vence). **Cuidado com empates**: a escolha depende da ordem das chaves em `letter_values`; defina faixas que evitem score exatamente equidistante entre duas letras.

---

## 6. Diagnostico

| Sintoma | Causa provavel | Verificacao / correcao |
|---|---|---|
| `QualifiedLead`/`DisqualifiedLead` nao dispara | `__CONFIG__.qualification` ausente ou sem `form_signature` | No console: `__CONFIG__.qualification`. Conferir `serve-webjs.js` expoe o bloco e o `wrangler.toml` tem `qualification` |
| Dispara `lead` em vez de qualificacao | `form_signature` nao bate com nenhum input do form | Inspecionar o `outerHTML` do form renderizado; confirmar que existe input com `name === form_signature` |
| `lead_score` sempre 0 (sem knockout) | Respostas capturadas vazias (leu depois do Elementor limpar) **ou** `value` nao bate letra/`value_map` | Confirmar captura no `change`/click; `answers` deve encher antes do sucesso. Garantir que o `value` e a letra **ou** que ha `value_map` cobrindo o rotulo (secao 8) |
| `lead_score` 0 inesperado | Knockout: alguma resposta = `dq_letter` | Checar respostas vs `dq_letter`; se nao deveria eliminar, revisar o mapeamento value=letra |
| Score nao bate com a conta | `weight` nao soma 1, ou `value`/`value_map` resolve letra errada | Somar os `weight`; conferir que cada `value` resolve para A/B/C/X — direto ou via `value_map` (secao 8) |
| Evento duplicado | — (improvavel: guard `_elLeadFired` compartilhado) | Se ocorrer, disparo extra vem de fora do nosso script (plugin/GTM) — ver skill `meta_ads`, secao de guard |
| Respostas/colunas vazias no Sheets | `questions[].sheet_col` ausente, ou GAS antigo sem upsert | Conferir `sheet_col` no config e reimplantar o GAS universal — ver skill `planilha` |
| Captura pega o form errado | Uso de `querySelector` global numa pop-up que duplica o form | Garantir que so `isQualForm(e.target...)` e usado; nunca DOM global |

### Como inspecionar o form (passo obrigatorio na configuracao)

Os `name`/`id` dos campos mudam por form e a ordem dos steps define onde cada gatilho cai. **Sempre** peca o `outerHTML` do form-qual renderizado (DevTools → Elements → copiar o `<form>`) antes de montar o bloco `qualification`: dele saem `form_signature`, os `field` das perguntas, `contact_fields`, `extra_fields` e `result_field`. Para o `value` de cada opcao, ha duas opcoes: (a) garantir que o `value` ja e a **letra** (A/B/C/X), ou (b) deixar o `value` como rotulo legivel e mapea-lo via `value_map` na pergunta (secao 8). Em builder nao-Elementor, ignore o `outerHTML` e use o escape hatch `VT_qualify`/`dataLayer` (secao 7).

---

## 7. Ingestao builder-agnostic — `VT_qualify` / `dataLayer` (`QUAL-13`, AS-BUILT)

A auto-deteccao da secao 2-4 e **Elementor-only** (depende do DOM do form e da duplicacao da pop-up). Para qualquer outro builder (InLead, GreatPages, Wix, HTML puro, SPA) o Modulo 7 expoe um **escape hatch**: o snippet do builder entrega os **dados crus** e o nosso codigo faz todo o resto (computeScore/knockout/nearest-tier/emissao). O `lead_score` e os eventos sao **identicos** ao caminho Elementor.

### Ativacao

O Modulo 7 agora roda sempre que existe o bloco `qualification` no config — **mesmo sem `form_signature`**. Quando `form_signature` esta presente, os listeners de DOM do Elementor (secao 2-4) tambem ligam; quando ausente, **so** o escape hatch fica ativo. Ou seja:

| Config | Elementor auto-detect | `VT_qualify()` | `dataLayer` |
|---|---|---|---|
| `qualification` com `form_signature` | ✅ liga | ✅ sempre | so se `datalayer_event` setado |
| `qualification` sem `form_signature` | — | ✅ sempre | so se `datalayer_event` setado |
| sem bloco `qualification` | — | — | — |

### Contrato `window.VT_qualify(data)`

Sempre exposto quando ha bloco `qualification`. Uma chamada = "processe esta qualificacao": faz merge dos dados crus no estado e dispara `QualifiedLead`/`DisqualifiedLead`. **O snippet nao calcula nada** — so entrega:

```js
window.VT_qualify({
  answers: { q1: "A", q2: "Acima de 50 mil" }, // chave = `id` OU `field` da pergunta
  contact: { name: "Fulano", email: "f@x.com", phone: "+5511999999999" }, // chaves de contact_fields
  extras:  { instagram: "@fulano" },            // chaves de extra_fields
  resultado: "tier-A"                            // opcional (aceita tambem `result`)
});
```

- **`answers`** — cada chave e casada a uma pergunta por `questions[].id` (amigavel) **ou** `questions[].field`. O valor cru passa pelo mesmo `value_map`/`letter_values` do calculo padrao (secao 8). Em builders sem o `name` estilo Elementor, defina um `id` curto (`"q1"`) por pergunta e use-o como chave.
- **`contact`/`extras`** — keyed pelas **chaves logicas** (`name`/`email`/`phone`, `instagram`), nao pelos `name` de DOM. O contato alimenta cookies (`saveUserCookies`) e o user_data dos pixels/CAPI.
- **Merge, nao replace** — pode chamar uma vez com tudo ou progressivamente; a emissao final usa o estado acumulado.
- **Dedup** — guard local de 5s evita emissao dupla se `VT_qualify` for chamado mais de uma vez (espelha o `_elLeadFired` do Modulo 5).

### Listener `dataLayer` (opt-in)

So liga quando `qualification.datalayer_event` esta definido (ex.: `"vt_qualify"`). O Modulo 7 envolve `dataLayer.push` e tambem varre entradas ja empilhadas; qualquer objeto `{ event: "<datalayer_event>", answers, contact, ... }` e encaminhado para `VT_qualify`. Util em GTM/Wix, onde o builder so consegue empurrar um objeto no `dataLayer`:

```js
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: "vt_qualify",
  answers: { q1: "A", q2: "B", q3: "A", q4: "C" },
  contact: { name: "Fulano", email: "f@x.com", phone: "+5511999999999" }
});
```

Nao colide com o GA4: o `gtag()` empilha um objeto `Arguments` (sem `.event` string), entao e ignorado pelo filtro.

### Onde plugar em cada builder

- **HTML puro / JS custom** — chame `VT_qualify(...)` no handler de submit do seu form, montando `answers`/`contact` a partir dos seus inputs.
- **GreatPages / InLead / Wix** — se houver "codigo de conversao" ou webhook de form, dispare o `dataLayer.push({ event: "vt_qualify", ... })` la; senao, injete um `<script>` que escuta o submit e chama `VT_qualify`.
- **GTM** — uma Custom HTML Tag no trigger de envio do form, lendo as respostas via Variables e empurrando o objeto `vt_qualify`.

---

## 8. `value_map` por pergunta (`QUAL-14`, AS-BUILT)

Antes, o `value` de cada opcao **precisava ser a letra** (A/B/C/X) — se fosse o rotulo legivel ("Acima de 50 mil"), o score nao computava. Agora cada pergunta pode trazer um `value_map` que traduz **rotulo legivel → letra**:

```jsonc
{ "field": "form_fields[q1]", "weight": 0.30, "sheet_col": "faturamento",
  "value_map": { "Acima de 50 mil": "A", "10 a 50 mil": "B", "Menos de 10 mil": "C", "Nao faturo ainda": "X" } }
```

Resolucao (`resolveLetter` em `computeScore`):

1. Pergunta tem `value_map` e o valor cru bate uma chave → usa a letra mapeada (match **exato**, depois **case-insensitive**).
2. Sem `value_map`, ou valor cru sem hit no mapa → usa o **valor cru em maiuscula** (comportamento legado: `value` ja e a letra).

O knockout (`dq_letter`) e o `nearest-tier` operam sobre a **letra resolvida**, entao funcionam igual com ou sem `value_map`. O payload enviado ao Sheets continua guardando a **resposta crua legivel** (`answers`), nao a letra — a coluna fica human-readable. `value_map` so afeta o **calculo do score**.

Beneficio pratico: o form do builder pode usar `value="Acima de 50 mil"` (o que o usuario ve / o que cai no Sheets) sem quebrar o score. Sem `value_map`, **mantenha a regra antiga** `value = letra`.

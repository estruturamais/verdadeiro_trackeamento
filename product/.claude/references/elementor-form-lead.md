# Reference: Elementor Pro Form — Deteccao de Lead

## Quando este arquivo se aplica

- Site usa WordPress + Elementor Pro (widget `form.default`)
- O evento `lead` nao dispara apos submissao do formulario
- `triggers.lead.selectors.elementor: true` esta no `SITE_CONFIG`
- `page_view` funciona corretamente (descarta problema de carregamento do script)

---

## Causas raiz da falha

1. **jQuery event != evento DOM nativo.** Elementor Pro dispara `submit_success` via jQuery `.trigger('submit_success')` no elemento do formulario. jQuery events NAO propagam para listeners nativos: `document.addEventListener('submit_success', ...)` nunca dispara. A solucao nao e ouvir `submit_success` — e detectar o sucesso por outro mecanismo.

2. **LiteSpeed Cache atrasa todos os scripts do Elementor.** O plugin substitui `type="text/javascript"` por `type="litespeed/javascript"` e so executa o JavaScript do Elementor (incluindo jQuery) na primeira interacao do usuario (mousemove, scroll, touch). Consequencia: jQuery pode nao estar disponivel quando `initForms()` executa. Metodos que dependem de jQuery precisam verificar `typeof jQuery !== 'undefined'` em tempo de execucao.

3. **Early return sem alternativa.** O listener generico de `submit` tinha `if (form.classList.contains('elementor-form')) return;` sem disparar o lead — excluia Elementor sem fornecer outro caminho.

---

## Estrategia em 2 passos

O Elementor limpa os valores dos campos do formulario APOS o AJAX ser disparado, mas ANTES do callback de sucesso. Isso significa que:

- **Captura de dados** (nome, email, telefone) → deve acontecer no evento `submit` nativo, ainda com os campos preenchidos
- **Disparo do lead** → deve acontecer apenas quando o sucesso e confirmado (callback AJAX com `success: true`)

Esses dois momentos precisam ser separados. Tentar fazer tudo em um so listener nao funciona.

---

## Passo A — Capturar dados antes do AJAX limpar os campos

Listener `submit` no capture phase (`true` como terceiro argumento). Detectar formulario Elementor, extrair dados e armazenar. NAO disparar o lead aqui.

```javascript
// Trecho de src/web/web.js — initForms()
var _elementorPendingFormData = null;
document.addEventListener('submit', function(event) {
  try {
    var form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    if (form.classList.contains('elementor-form')) {
      _elementorPendingFormData = extractGenericFormData(form); // captura agora
      return; // NAO dispara o lead aqui
    }
    // ... outros formularios
  } catch(e) {}
}, true); // capture phase obrigatorio
```

**Por que capture phase?** Garante que o listener roda antes de qualquer handler do Elementor que possa chamar `event.stopPropagation()`.

---

## Passo B — 4 metodos de deteccao de sucesso (em ordem de prioridade)

Todos chamam a mesma funcao `_fireElementorLead()`. O guard de deduplicacao garante que o lead dispara apenas uma vez, independente de quantos metodos detectem o sucesso.

### Metodo 1 — MutationObserver (mais confavel, sem dependencias)

Observa `document.body` procurando pelo elemento `.elementor-message-success`. Cobre dois cenarios:
- **childList**: Elementor insere o elemento de sucesso como novo no no DOM
- **attributes**: Elementor mostra/oculta um elemento ja existente via classe ou style

```javascript
// Trecho de src/web/web.js — initForms()
new MutationObserver(function(mutations) {
  for (var m = 0; m < mutations.length; m++) {
    var mut = mutations[m];
    if (mut.type === 'childList') {
      for (var n = 0; n < mut.addedNodes.length; n++) {
        var node = mut.addedNodes[n];
        if (node.nodeType !== 1) continue;
        if ((node.classList && node.classList.contains('elementor-message-success')) ||
            (node.querySelector && node.querySelector('.elementor-message-success'))) {
          _fireElementorLead();
        }
      }
    }
    if (mut.type === 'attributes' && mut.target && mut.target.classList &&
        mut.target.classList.contains('elementor-message-success')) {
      _fireElementorLead();
    }
  }
}).observe(document.body, {
  childList: true, subtree: true,
  attributes: true, attributeFilter: ['class', 'style']
});
```

### Metodo 2 — jQuery ajaxSuccess

Captura todas as requisicoes AJAX feitas via jQuery. Identifica a do formulario Elementor pela presenca de `elementor_pro_forms_send_form` no body da requisicao.

```javascript
// Trecho de src/web/web.js — initForms()
if (typeof jQuery !== 'undefined') {
  jQuery(document).ajaxSuccess(function(event, xhr, settings) {
    try {
      var data = settings.data || '';
      var dataStr = typeof data === 'string' ? data : (data ? JSON.stringify(data) : '');
      if (dataStr.indexOf('elementor_pro_forms_send_form') !== -1) {
        var resp = xhr.responseJSON || JSON.parse(xhr.responseText);
        if (resp && resp.success) _fireElementorLead();
      }
    } catch(eJq) {}
  });
}
```

**Limitacao LiteSpeed:** Com LiteSpeed Cache, jQuery so esta disponivel apos primeira interacao. O `if (typeof jQuery !== 'undefined')` neste momento ja e apos a interacao do usuario (o submit), entao normalmente funciona — mas nao e garantido em todos os cenarios de carregamento.

### Metodo 3 — XMLHttpRequest prototype intercept

Sobrescreve `XMLHttpRequest.prototype.open` e `send` antes de qualquer script carregar. Nao depende de jQuery.

```javascript
// Trecho de src/web/web.js — initForms()
var _xhrOpen = XMLHttpRequest.prototype.open;
var _xhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method, url) {
  this._rrUrl = typeof url === 'string' ? url : '';
  return _xhrOpen.apply(this, arguments);
};
XMLHttpRequest.prototype.send = function(data) {
  var xhr = this;
  var dataStr = typeof data === 'string' ? data : '';
  if ((xhr._rrUrl || '').indexOf('admin-ajax.php') !== -1 &&
      dataStr.indexOf('elementor_pro_forms_send_form') !== -1) {
    xhr.addEventListener('load', function() {
      try {
        if (xhr.status === 200) {
          var resp = JSON.parse(xhr.responseText);
          if (resp && resp.success) _fireElementorLead();
        }
      } catch(eXhr) {}
    });
  }
  return _xhrSend.apply(this, arguments);
};
```

### Metodo 4 — window.fetch intercept

Cobre versoes do Elementor que usam a REST API (`wp-json`) ao inves de `admin-ajax.php`.

```javascript
// Trecho de src/web/web.js — initForms()
var _origFetch = window.fetch;
window.fetch = function(url, options) {
  var result = _origFetch.apply(this, arguments);
  try {
    var urlStr = typeof url === 'string' ? url : '';
    var body = options && options.body ? options.body : '';
    var bodyStr = typeof body === 'string' ? body : '';
    if ((urlStr.indexOf('admin-ajax.php') !== -1 || urlStr.indexOf('wp-json') !== -1) &&
        bodyStr.indexOf('elementor_pro_forms_send_form') !== -1) {
      result.then(function(resp) {
        return resp.clone().json().then(function(data) {
          if (data && data.success) _fireElementorLead();
        });
      }).catch(function() {});
    }
  } catch(eFetch) {}
  return result;
};
```

---

## Guard de deduplicacao

Todos os 4 metodos chamam a mesma funcao. O guard garante disparo unico.

```javascript
// Trecho de src/web/web.js — initForms()
var _elLeadFired = false;
function _fireElementorLead() {
  if (_elLeadFired) return;
  _elLeadFired = true;
  setTimeout(function() { _elLeadFired = false; }, 5000); // reset apos 5s
  try {
    var fd = _elementorPendingFormData || {};
    _elementorPendingFormData = null;
    saveUserCookies(fd);
    fireTrigger('lead', fd);
  } catch(e) {}
}
```

---

## Mapeamento de campos do Elementor

O Elementor Pro serializa os campos com o padrao `form_fields[fieldname]` onde `fieldname` e o Field ID configurado no widget (por padrao = label em lowercase).

Exemplos comuns:
- `form_fields[name]` ou `form_fields[nome]` → nome
- `form_fields[email]` → email
- `form_fields[telefone]` ou `form_fields[phone]` ou `form_fields[whatsapp]` → telefone

A funcao `extractGenericFormData()` em `src/web/web.js` ja trata isso corretamente via substring match no `input.name`:
- Email: `inputName.indexOf('email') !== -1`
- Telefone: `inputName.indexOf('phone') !== -1 || inputName.indexOf('tel') !== -1 || inputName.indexOf('whatsapp') !== -1 || inputName.indexOf('celular') !== -1`
- Nome: `inputName.indexOf('name') !== -1 || inputName.indexOf('nome') !== -1`

Nenhum parser especifico para Elementor e necessario — o extractor generico funciona.

---

## Constraint: LiteSpeed Cache

O plugin LiteSpeed Cache converte scripts para `type="litespeed/javascript"` e os executa apenas na primeira interacao do usuario. Impacto em cada metodo:

| Metodo | Dependencia | Status com LiteSpeed |
|--------|-------------|---------------------|
| MutationObserver | Nenhuma (API nativa) | Sempre funciona — inicia com o script |
| jQuery ajaxSuccess | jQuery | Funciona se jQuery carregou antes do submit |
| XHR intercept | Nenhuma (API nativa) | Sempre funciona — sobrescreve antes de qualquer AJAX |
| fetch intercept | Nenhuma (API nativa) | Sempre funciona |

**Recomendacao:** O Metodo 1 (MutationObserver) e o mais confavel neste stack. Manter todos os 4 como defense-in-depth.

---

## Sintomas que indicam este problema

- Evento `lead` ausente na tabela `events` do D1 apos submissao do formulario
- Sem `[Tracking] lead fired` no console com `?debug=1`
- `page_view` funciona corretamente (descarta problemas de carregamento do script)
- `__CONFIG__` no browser tem `meta_pixel_id` correto (descarta bug de config)
- Nenhum erro CORS ou de rede na aba Network do DevTools para `/collect/event`

# Referencia: coexistencia com UTMify (e similares)

Fonte unica sobre como o Verdadeiro Trackeamento convive com a **UTMify**
(`cdn.utmify.com.br/scripts/utms/latest.js`), onipresente em site de infoproduto BR. Lido por
caminho pelo onboarding (`overview.md`, Step 2). Complementa
`.claude/references/spa-checkout-tracking.md` (a injecao same-origin e' o que faz os dois conviverem).

---

## O que a UTMify faz (e por que pode conflitar)

A UTMify persiste UTMs e **reescreve os links de checkout** para preservar os parametros, e pode
adicionar params proprios (`xcod`/`sck` para Hotmart, subids). Sem orientacao, o cliente que roda os
dois pode acabar com:

- `Purchase` perdendo match quality (checkout sem o `indexador`/`external_id` do VT);
- `xcod`/`sck` **duplicados** (UTMify + VT escrevendo o mesmo param);
- disputa de setters de `Location.prototype.href`.

---

## Deteccao (Step 2)

No HTML do site, procurar o padrao:

```
cdn.utmify.com.br/scripts/utms
```

Se presente: gravar `utmify_detectada: sim` no `tracking_memory.md` e aplicar a orientacao abaixo.

---

## Orientacao padrao de coexistencia

Nao e' preciso desinstalar a UTMify — os dois rodam juntos: a UTMify cuida da **persistencia de
UTMs**; o VT cuida da **identidade do usuario** (`marca_user`).

1. Instalar o script do VT como **primeiro elemento do `<head>`** — antes da UTMify.
2. **Manter as flags `data-utmify-prevent-xcod-sck` e `data-utmify-prevent-subids`** na tag da UTMify
   — quem cuida de `xcod`/`sck` e' o VT, com base no gateway detectado. Isso evita duplicidade.

Ordem correta no `<head>`:

```html
<head>
  <script src="https://{dominio}/tracking/web.js"></script>
  <script src="https://cdn.utmify.com.br/scripts/utms/latest.js"
          data-utmify-prevent-xcod-sck data-utmify-prevent-subids async defer></script>
</head>
```

---

## Por que os dois convivem (a chave e' a injecao same-origin)

A injecao de `utm_id`/indexador na URL same-origin (IZZO-7, so com `spa_mode.enabled`; ver
`spa-checkout-tracking.md`) e' o elo que faz UTMify e VT conviverem sem conflito:

- O VT injeta o `indexador` do gateway (ex.: `utm_id={marca_user}` na Lastlink) na URL da pagina via
  `replaceState`.
- A UTMify detecta `utm_id` como UTM padrao e o **propaga** em todos os links de checkout.
- O checkout recebe o `utm_id` mesmo quando o site usa o sistema da UTMify para gerenciar os links.

Resultado: zero retrabalho do cliente que ja tem UTMify; o `marca_user` chega ao gateway pelos dois
caminhos (VT direto + propagacao UTMify).

> **Nota:** em site **tradicional** (`<a href>` direto, `spa_mode` off) nao ha injecao same-origin —
> e nem precisa: o VT injeta `caminho`+`indexador` no clique de cada link, e a UTMify (com as flags
> acima) nao reescreve `xcod`/`sck` por cima. As duas orientacoes (flags + ordem no `<head>`) valem
> para os dois tipos de site.

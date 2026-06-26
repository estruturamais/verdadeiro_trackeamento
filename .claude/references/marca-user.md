# Referencia: invariante do marca_user

Fonte unica sobre o que e o `marca_user`, quando ele existe e quando (excepcionalmente) falta.
Lido por caminho pelo onboarding (`overview.md`), pela skill `new-gateway` e pela skill
`audit-tracking`. Nao duplicar este conteudo em outros docs — apontar para ca.

---

## O que e

`marca_user` e o identificador first-party do visitante. Cookie HttpOnly, SameSite=Lax, Secure,
`max-age=63072000` (2 anos), setado pelo Worker via `Set-Cookie` na resposta do beacon e do
`web.js`. Identifica o mesmo usuario entre sessoes. Todos os eventos web carregam `marca_user` no
payload.

---

## Invariante (regra de ouro)

**O `marca_user` e criado pela PRESENCA do `web.js` na pagina — nao pela origem do trafego.**

- Todo visitante que carrega uma pagina com o script recebe `marca_user`: **pago ou organico, com
  UTM ou sem**.
- O `web.js` injeta o `marca_user` no **parametro indexador** dos links de checkout (definido em
  `gateways_config`). Ex: `xcod` (Hotmart/Hubla), `sck` (Kiwify), `utm_perfect` (PerfectPay).
- No webhook de compra, o gateway devolve esse indexador. O parser do gateway o extrai como
  `marca_user`; o `fdvMerge` usa o `marca_user` para buscar o `user_store` e enriquecer o evento
  com os dados do browser (fbp, fbc, geo, email capturado etc.).
- Portanto: **toda compra que passou por uma pagina com o script tem `marca_user`.**

Por que isto e o ponto mais critico do VT: o `marca_user` e o **indexador que cruza com o webhook
via FDV no evento de `Purchase`**. Se ele falha, a compra chega ao Meta/TikTok/etc. **sem** os dados
do browser (fbp, fbc, geo, email capturado) — atribuicao cega. Esse elo nao pode passar despercebido
na implementacao nem na auditoria.

Uma compra chega **sem** `marca_user` em **dois casos** — que precisam ser distinguidos:

- **(A) Esperado:** comprador mandado **direto ao checkout** sem passar por nenhuma pagina com o
  script. O cookie nunca foi criado; o webhook chega "magro" (so o PII que o gateway coleta no
  checkout). Sem correcao possivel pelo tracking.
- **(B) Falha na cadeia (critico — nao pode passar):** o comprador **passou** por uma pagina com o
  script, mas o `marca_user` falhou em algum elo. Esta e a causa que a auditoria existe para pegar.

> **NAO existe "comprador organico sem marca_user" como caso normal.** Organico tambem passa pelo
> site e tambem recebe `marca_user`. Ausencia num webhook e sempre (A) direto ao checkout ou
> (B) um elo quebrado da cadeia abaixo.

---

## A cadeia do marca_user (cada elo pode quebrar)

```
web.js roda na pagina
  → (1) cria o cookie marca_user (Set-Cookie do Worker)
  → (2) o navegador PERSISTE o cookie (HttpOnly, SameSite=Lax, Secure, 2 anos)
  → (3) web.js INJETA o marca_user no parametro indexador dos links de checkout (gateways_config)
  → (4) o gateway CARREGA o indexador pelo checkout e o DEVOLVE no webhook
  → (5) o parser EXTRAI o marca_user do webhook_raw.payload
  → fdvMerge cruza com user_store → enriquece o Purchase
```

---

## Diagnostico — webhook de compra sem marca_user

Investigar de tras pra frente (do dado disponivel ate a origem), localizando o elo quebrado:

1. **(5) O parser extraiu?** Conferir o `webhook_raw.payload` (cru): o campo do indexador existe no
   payload?
   - **Existe no raw, mas o parser retornou vazio** → corrigir o `path` do `marca_user` em
     `src/worker/gateways/{gateway}.js`.
   - **Nao existe no raw** → o indexador nao chegou ao gateway (itens 4/3).
2. **(4/3) O indexador chegou ao checkout?** Conferir `gateways_config` no `SITE_CONFIG`: o
   `indexador` configurado e o parametro certo daquele gateway? A URL do checkout no site carrega
   esse parametro com o valor do `marca_user`? (Camada 3 da auditoria: pedir a URL completa do
   checkout apos o redirecionamento.)
   - **Parametro errado/ausente em `gateways_config`** → corrigir a config e re-deploy.
   - **Link de checkout fora do padrao detectado** (dominio nao listado, botao que abre o checkout
     sem passar pela reescrita do `web.js`) → ajustar a deteccao/injecao.
3. **(2) O cookie persistiu no navegador?** Se a navegacao gera evento mas o `marca_user` some entre
   paginas/dominios → investigar bloqueio de cookie (incognito, ITP/Safari, terceiros), checkout em
   **dominio diferente** do site, ou `web.js` carregado tarde demais. Confirmar via `?debug=1`
   (Camada 3): o `marca_user` aparece e e o **mesmo** entre paginas?
4. **(1) O cookie foi criado?** Se `?debug=1` nao mostra `marca_user` nenhum → o `web.js` nao rodou
   (script ausente do `<head>`, bloqueado, ou erro de carregamento). Volta a ser caso de instalacao
   (Step 5 do onboarding), nao de parser.
5. **Nenhum sinal de passagem pelo site** (sem evento web associado, sem cookie em momento algum) →
   caso (A): comprador foi direto ao checkout. Esperado.

---

## Onde isso vive no codigo (referencia — pode mudar de lugar)

- Set do cookie + injecao do indexador nos links de checkout: `src/web.js` (via `gateways_config`).
- Extracao do `marca_user` no webhook: `src/worker/gateways/{gateway}.js`.
- Merge com o browser: `src/worker/store/fdv.js` (`fdvMerge` usa `marca_user` para buscar o
  `user_store`).

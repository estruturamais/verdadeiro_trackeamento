# Referencia: setup do webhook no painel de cada gateway

Fonte unica sobre **como configurar o webhook no front-end de cada gateway** — qual **evento** marcar,
em qual **formato**, **versao** e **tipo/variante**. O objetivo e **nao poluir o back-end**: enviar
**so** o evento de compra aprovada (e nao pix/boleto gerado, carrinho abandonado, reembolso,
chargeback…), no formato/versao que o parser entende.

Lida por caminho pelo Step 5 do `overview.md` (configuracao de webhook — modelo infoproduto) e pela
skill `new-gateway` (ao integrar/completar um gateway). Para **onde** fica no painel e a URL, ver a
tabela do `overview.md` Step 5. Para o que o parser espera no payload, ver `APPROVAL_EVENTS` em
`src/worker/gateways/index.js`. Identificador do comprador: `[[marca-user]]`.

---

## Por que isto importa (dois riscos)

1. **Correcao (critico):** evento/versao/formato/tipo errado → o payload nao bate com o parser → a
   compra **nao e parseada** → venda perdida na atribuicao. Ex.: a Ticto so traz `tracking` + itens
   na **v2** com o envio de order bump em combo.
2. **Limpeza (back-end):** marcar varios eventos alem da compra aprovada enche o `webhook_raw` com
   linhas que ficam `processed = 0` (o `APPROVAL_EVENTS` filtra antes do dispatch, entao nao
   duplicam envio — mas ocupam espaco, pressionam a retencao e sujam o log). **Regra: marcar apenas o
   evento de compra aprovada.**

> **Principio:** **um** evento (compra aprovada), formato **JSON**, versao/variante que o parser
> espera. Menos evento = `webhook_raw` limpo = contagem confiavel do analistA+ (que usa `processed=1`).

---

## Ticto

- **Evento a marcar:** `Venda Realizada`
- **Tipo/variante:** `Enviar Order Bump | Combo junto com a oferta principal` — envia o produto
  principal **junto** com os order bumps no mesmo webhook (o parser usa `tracking` + os itens; o
  combo garante que os bumps cheguem com a oferta principal).
- **Versao:** **v2** (versao 2)
- **Formato:** **JSON**
- **URL:** `https://{dominio}/collect/webhook/ticto`
- **O que o parser exige (referencia):** `status = authorized` (ver `APPROVAL_EVENTS.ticto`).
- **Nao marcar** outros eventos (PIX gerado, boleto gerado, reembolso, chargeback, etc.).

---

## Demais gateways

Pendentes de documentacao do **rotulo exato de UI** (evento/formato/versao/tipo). Completar conforme
cada um for confirmado em painel real — nao inferir rotulos. Enquanto nao documentado aqui, usar a
tabela "onde + URL" do `overview.md` Step 5 e, como base tecnica do que o parser aceita,
`APPROVAL_EVENTS` em `src/worker/gateways/index.js`:

| Gateway | Valor que o parser exige (payload) | Setup no painel |
|---|---|---|
| Hotmart | `event = PURCHASE_APPROVED` | a documentar |
| Kiwify | `webhook_event_type = order_approved` | a documentar |
| Kirvano | `event = SALE_APPROVED` | a documentar |
| Lastlink | `Event = Purchase_Order_Confirmed` | a documentar |
| Eduzz | `data.status = paid` | a documentar |
| Hubla | `type = invoice.payment_succeeded` | a documentar |
| Green | `currentStatus = paid` | a documentar |
| Tutory | `[0].status = paid` | a documentar |
| PagTrust | `event = PURCHASE_APPROVED` | a documentar |
| Payt | `status = paid` | a documentar |
| PerfectPay | skeleton (sem `APPROVAL_EVENTS`) | a documentar |

> Em todos: **marcar so o evento de compra aprovada, em JSON**. Ao confirmar o rotulo exato de um
> gateway, adicionar uma secao propria aqui (como a da Ticto).

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

## Excecao: negocio por ASSINATURA (SaaS)

A regra "so o evento de compra aprovada" vale para **compra unica**. Num negocio por assinatura, com
`subscription_tracking` ligado, e preciso marcar **mais dois** eventos no painel — e eles normalmente
vem **desligados**:

| Evento | Por que e necessario |
|---|---|
| **renovacao / cobranca recorrente** | sem ele, so a 1a cobranca chega; as renovacoes nao existem para o VT |
| **cancelamento de assinatura** | nao e evento de anuncio e nao despacha nada — e o **insumo da REATIVACAO**. Sem ele, quem cancelou e voltou e classificado como renovacao e o win-back fica invisivel |

### Os dois identificadores (o erro que custa toda a recorrencia)

| Campo do parser | O que e | Comportamento |
|---|---|---|
| `order_id` | a **FATURA** | **muda** a cada cobranca |
| `subscription_id` | o **CONTRATO** | **igual** em todas as cobrancas |

Usar o estavel como `order_id` faz **toda renovacao cair no dedup** e nunca chegar as plataformas.
A primeira cobranca funciona e as seguintes somem sem erro nenhum — nao ha log que acuse.

| Gateway | `order_id` (fatura) | `subscription_id` (contrato) | `charges_paid_hint` |
|---|---|---|---|
| **Ticto** | `order.transaction_hash` (TPC…) | `order.hash` (TOC…/TOP…, o "Codigo do Pedido") — **so** se `offer.is_subscription` | `subscriptions[0].successful_charges` (inclui a atual) |
| **Hotmart** | `data.purchase.transaction` | `data.subscription.subscriber.code` | `data.purchase.recurrence_number` (pode nao vir) |
| demais 10 | — | ❌ **nao mapeado** | ❌ |

**Cancelamento** (payload BRUTO — o parser de compra nao roda nesses eventos):

| Gateway | Evento | Caminho do id | Caminho do e-mail |
|---|---|---|---|
| Ticto | `status = subscription_canceled` | `order.hash` | `customer.email` |
| Hotmart | `event = SUBSCRIPTION_CANCELLATION` | `data.subscriber.code` | `data.subscriber.email` |

⚠️ O caminho do identificador **muda conforme o tipo de evento** dentro do mesmo gateway — na Ticto,
o caminho do codigo do assinante na compra **nao** e o do cancelamento. Nunca reaproveite sem
conferir no payload real.

Para os 10 gateways sem mapeamento, rode o **Passo 1b** da skill `new-gateway` (protocolo de
descoberta por comparacao de payloads). **Nao inferir caminhos.**

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
| PerfectPay | `sale_status_enum_key = approved` | Configuracoes > Webhook — marcar so venda aprovada, em JSON |

> Em todos: **marcar so o evento de compra aprovada, em JSON**. Ao confirmar o rotulo exato de um
> gateway, adicionar uma secao propria aqui (como a da Ticto).

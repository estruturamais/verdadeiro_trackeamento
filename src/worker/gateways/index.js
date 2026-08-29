import { parseHotmart } from './hotmart.js';
import { parseKiwify } from './kiwify.js';
import { parseKirvano } from './kirvano.js';
import { parseLastlink } from './lastlink.js';
import { parsePagTrust } from './pagtrust.js';
import { parseTicto } from './ticto.js';
import { parseEduzz } from './eduzz.js';
import { parsePerfectPay } from './perfectpay.js';
import { parsePayt } from './payt.js';
import { parseHubla } from './hubla.js';
import { parseGreen } from './green.js';
import { parseTutory } from './tutory.js';

// Gateways com implementacao completa e validada
export const GATEWAY_PARSERS = {
  hotmart:    parseHotmart,
  kiwify:     parseKiwify,
  kirvano:    parseKirvano,
  lastlink:   parseLastlink,
  pagtrust:   parsePagTrust,
  eduzz:      parseEduzz,
  payt:       parsePayt,
  ticto:      parseTicto,
  perfectpay: parsePerfectPay,

  hubla:      parseHubla,
  green:      parseGreen,
  tutory:     parseTutory
};

// Cada entrada e' { field, value } (igualdade simples) OU uma FUNCAO
// (body) => { approved, reason } para gateways cuja aprovacao depende de mais de
// um campo. Ver o consumo em src/worker/collect/webhook.js.
export const APPROVAL_EVENTS = {
  hotmart:    { field: 'event',                value: 'PURCHASE_APPROVED' },
  kiwify:     { field: 'webhook_event_type',   value: 'order_approved' },
  kirvano:    { field: 'event',                value: 'SALE_APPROVED' },
  lastlink:   { field: 'Event',                value: 'Purchase_Order_Confirmed' },
  pagtrust:   { field: 'event',                value: 'PURCHASE_APPROVED' },
  ticto:      { field: 'status', value: 'authorized' },
  eduzz:      { field: 'data.status', value: 'paid' },
  perfectpay: { field: 'sale_status_enum_key', value: 'approved' },
  payt:       { field: 'status', value: 'paid' },

  hubla:      { field: 'type', value: 'invoice.payment_succeeded' },
  green:      { field: 'currentStatus', value: 'paid' },
  // Tutory entrega o payload como array de 1 posicao — o status fica em [0].status
  tutory:     { field: '0.status', value: 'paid' }
};

// Eventos de CANCELAMENTO de assinatura (SaaS). Processados somente quando
// `subscription_tracking` esta ligado no SITE_CONFIG: marcam a assinatura como
// cancelada na tabela `subscriptions`, para a proxima cobranca do mesmo cliente ser
// classificada como REATIVACAO (e nao aquisicao). Cancelamento NAO e evento de
// anuncio — nada e despachado as plataformas; ele e o INSUMO da reativacao.
//
// ATENCAO: os caminhos apontam para o payload BRUTO, porque o parser de compra nao
// roda nesses eventos. E o caminho do identificador MUDA conforme o tipo de evento
// dentro do MESMO gateway — na Ticto, o codigo do assinante na compra nao e o do
// cancelamento. Nunca reaproveitar o caminho da compra sem conferir no payload real.
//
// So Ticto e Hotmart. Para os outros 10 gateways nao ha payload real de cancelamento
// e inferir o caminho gera parser que falha em silencio — ver o protocolo de
// descoberta em .claude/skills/new-gateway/SKILL.md.
export const CANCEL_EVENTS = {
  // payload REAL 2026-08-22: status=subscription_canceled, order.hash=TOC..., customer.email
  ticto:   { field: 'status', value: 'subscription_canceled',
             subscription_id_path: 'order.hash', email_path: 'customer.email' },
  // payload de teste do painel: event=SUBSCRIPTION_CANCELLATION, data.subscriber.{code,email}
  hotmart: { field: 'event', value: 'SUBSCRIPTION_CANCELLATION',
             subscription_id_path: 'data.subscriber.code', email_path: 'data.subscriber.email' }
};

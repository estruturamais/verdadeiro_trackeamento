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

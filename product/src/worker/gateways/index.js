import { parseHotmart } from './hotmart.js';
import { parseKiwify } from './kiwify.js';
import { parseKirvano } from './kirvano.js';
import { parseLastlink } from './lastlink.js';
import { parsePagTrust } from './pagtrust.js';
import { parseTicto } from './ticto.js';
import { parseEduzz } from './eduzz.js';
import { parsePerfectPay } from './perfectpay.js';
import { parsePayt } from './payt.js';

// Gateways com implementacao completa e validada
// + Skeletons — mapeamento de marca_user confirmado, demais campos TODO
export const GATEWAY_PARSERS = {
  hotmart:    parseHotmart,
  kiwify:     parseKiwify,
  kirvano:    parseKirvano,
  lastlink:   parseLastlink,
  pagtrust:   parsePagTrust,

  // Skeletons — nao disparam eventos ricos (order_id vazio = sem custom_data rico para as APIs)
  ticto:      parseTicto,
  eduzz:      parseEduzz,
  perfectpay: parsePerfectPay,
  payt:       parsePayt
};

export const APPROVAL_EVENTS = {
  hotmart:    { field: 'event',                value: 'PURCHASE_APPROVED' },
  kiwify:     { field: 'webhook_event_type',   value: 'order_approved' },
  kirvano:    { field: 'event',                value: 'SALE_APPROVED' },
  lastlink:   { field: 'Event',                value: 'Purchase_Order_Confirmed' },
  pagtrust:   { field: 'event',                value: 'PURCHASE_APPROVED' },
  // Sem validacao de evento confirmada — aceitar qualquer payload (skeleton)
  ticto:      null,
  eduzz:      null,
  perfectpay: null,
  payt:       null
};

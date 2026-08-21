import { parseHotmart } from './hotmart.js';

// Mesmo formato do Hotmart — inclusive os extras da transacao (oferta, metodo,
// parcelas, comissoes). Confirmar os extras no primeiro payload real de venda.
export function parsePagTrust(body) {
  return parseHotmart(body);
}

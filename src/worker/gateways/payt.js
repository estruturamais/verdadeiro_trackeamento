import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

// marca_user e UTMs em link.sources.* (chaves prefixadas). O indexador e o
// parametro `src` (mesmo definido no gateways_config do web.js) — round-trip
// checkout->webhook confirmado: o valor injetado em ?src= volta em link.sources.src.
export function parsePayt(body) {
  const utm = utmPrefixed(getNestedValue(body, 'link.sources'));

  // Phone: customer.phone vem sem DDI/+ ("11959326414") — remover + por seguranca
  var phone = String(getNestedValue(body, 'customer.phone') || '').replace(/^\+?(.*)$/, '$1');

  // Value em centavos (total_price ja com descontos/cupom): 27265 -> "272.65"
  var rawValue = String(getNestedValue(body, 'transaction.total_price') || '');
  var value = rawValue.replace(/(.+)(\d{2})$/, '$1.$2');

  return {
    ...utm,
    marca_user:   getNestedValue(body, 'link.sources.src'),
    email:        (getNestedValue(body, 'customer.email') || '').toLowerCase(),
    phone:        phone,
    name:         (getNestedValue(body, 'customer.name') || '').toLowerCase(),
    order_id:     String(getNestedValue(body, 'transaction_id') || ''),
    value:        value,
    currency:     'BRL',
    product_name: getNestedValue(body, 'product.name') || '',
    product_id:   String(getNestedValue(body, 'product.code') || ''),
    city:         '', state: '', country: '', zip: '',
    ip:           getNestedValue(body, 'customer.ip') || '',
    user_agent:   '',

    // --- Extras da transacao (planilha de vendas; nao usados pelas plataformas de ads) ---
    // Payt nao tem entidade "oferta" — o titulo do link de checkout faz esse papel.
    // Metodo/parcelas: so o metodo vem no payload (transaction.payment_method).
    offer_id:       '',
    offer_name:     getNestedValue(body, 'link.title') || '',
    payment_method: getNestedValue(body, 'transaction.payment_method') || '',
    installments:   '',
    order_bump:     undefined,
    // commission[] por type ('platform' = taxa Payt; 'producer' = liquido), em centavos
    value_gateway:  commissionByType(body, 'platform'),
    value_net:      commissionByType(body, 'producer')
  };
}

// commission[] da Payt: [{ type, amount }] com type em platform | producer.
// `amount` vem em centavos. Buscar por type, nunca por indice.
function commissionByType(body, type) {
  const list = getNestedValue(body, 'commission');
  if (!Array.isArray(list)) return '';
  const found = list.find(function (c) { return c && c.type === type; });
  return found && found.amount != null ? (found.amount / 100).toFixed(2) : '';
}

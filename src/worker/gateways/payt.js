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
    user_agent:   ''
  };
}

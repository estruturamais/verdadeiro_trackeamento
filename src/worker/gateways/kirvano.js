import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

export function parseKirvano(body) {
  // O webhook real da Kirvano vem ACHATADO (campos no topo, sem wrapper "data").
  // O fallback `body.data || body` mantem compatibilidade caso algum dia venha aninhado.
  const data = body.data || body;

  const utm = utmPrefixed(getNestedValue(data, 'utm'));

  // Currency: extrair primeira palavra do total_price (ex: "BRL 97.00" → "BRL")
  var totalPrice = String(getNestedValue(data, 'total_price') || '');
  var currency = totalPrice.match(/^(\S+)/) ? totalPrice.match(/^(\S+)/)[1] : 'BRL';
  // Value: extrair valor numerico
  var value = totalPrice.replace(/^[A-Z]+\s*/, '');

  return {
    ...utm,
    marca_user: getNestedValue(data, 'utm.src'),
    email: (getNestedValue(data, 'customer.email') || '').toLowerCase(),
    phone: getNestedValue(data, 'customer.phone_number'),
    name: (getNestedValue(data, 'customer.name') || '').toLowerCase(),
    order_id: getNestedValue(data, 'sale_id'),
    value: value,
    currency: currency,
    product_name: getNestedValue(data, 'products.0.name'),
    product_id: String(getNestedValue(data, 'products.0.id') || ''),
    city: '',
    state: '',
    country: '',
    zip: '',
    ip: '',
    user_agent: ''
  };
}

import { getNestedValue } from '../shared/helpers.js';

export function parseKirvano(body) {
  // Currency: extrair primeira palavra do total_price (ex: "BRL 97.00" → "BRL")
  var totalPrice = String(getNestedValue(body, 'data.total_price') || '');
  var currency = totalPrice.match(/^(\S+)/) ? totalPrice.match(/^(\S+)/)[1] : 'BRL';
  // Value: extrair valor numerico
  var value = totalPrice.replace(/^[A-Z]+\s*/, '');

  return {
    marca_user: getNestedValue(body, 'data.utm.src'),
    email: (getNestedValue(body, 'data.customer.email') || '').toLowerCase(),
    phone: getNestedValue(body, 'data.customer.phone_number'),
    name: (getNestedValue(body, 'data.customer.name') || '').toLowerCase(),
    order_id: getNestedValue(body, 'data.sale_id'),
    value: value,
    currency: currency,
    product_name: getNestedValue(body, 'data.products.0.name'),
    product_id: String(getNestedValue(body, 'data.products.0.id') || ''),
    city: '',
    state: '',
    country: '',
    zip: '',
    ip: '',
    user_agent: ''
  };
}

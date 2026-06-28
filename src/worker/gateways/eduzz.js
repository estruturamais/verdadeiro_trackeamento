import { getNestedValue, utmBare } from '../shared/helpers.js';

export function parseEduzz(body) {
  // Webhook real (myeduzz.invoice_paid) aninha tudo em data.*; fallback para body
  // mantem compatibilidade com payloads achatados de teste.
  const data = body.data || body;

  // UTMs (chaves nuas) em data.utm. utm_term e sacrificado para o marca_user → fica vazio.
  const utm = { ...utmBare(getNestedValue(data, 'utm')), utm_term: '' };

  // Phone: buyer.phone vem null; o numero com DDI esta em cellphone — remover + inicial
  var phone = String(getNestedValue(data, 'buyer.cellphone') || '').replace(/^\+?(.*)$/, '$1');

  // Zip: extrair 5 primeiros digitos
  var zip = String(getNestedValue(data, 'buyer.address.zipCode') || '').replace(/^(\d{5}).*/, '$1');

  return {
    ...utm,
    marca_user: getNestedValue(data, 'utm.term'),
    email: getNestedValue(data, 'buyer.email'),
    phone: phone,
    name: getNestedValue(data, 'buyer.name'),
    order_id: getNestedValue(data, 'id'),
    value: getNestedValue(data, 'price.value'),
    currency: getNestedValue(data, 'price.currency'),
    product_name: getNestedValue(data, 'items.0.name') || '',
    product_id: String(getNestedValue(data, 'items.0.productId') || ''),
    city: (getNestedValue(data, 'buyer.address.city') || '').toLowerCase(),
    state: (getNestedValue(data, 'buyer.address.state') || '').toLowerCase(),
    country: getNestedValue(data, 'buyer.address.country') || '',
    zip: zip,
    ip: '',
    user_agent: ''
  };
}

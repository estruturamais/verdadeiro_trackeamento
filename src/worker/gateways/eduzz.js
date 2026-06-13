import { getNestedValue } from '../shared/helpers.js';

export function parseEduzz(body) {
  // Phone: buyer.phone vem null; o numero com DDI esta em cellphone — remover + inicial
  var phone = String(getNestedValue(body, 'buyer.cellphone') || '').replace(/^\+?(.*)$/, '$1');

  // Zip: extrair 5 primeiros digitos
  var zip = String(getNestedValue(body, 'buyer.address.zipCode') || '').replace(/^(\d{5}).*/, '$1');

  return {
    marca_user: getNestedValue(body, 'utm.term'),
    email: getNestedValue(body, 'buyer.email'),
    phone: phone,
    name: getNestedValue(body, 'buyer.name'),
    order_id: getNestedValue(body, 'id'),
    value: getNestedValue(body, 'price.value'),
    currency: getNestedValue(body, 'price.currency'),
    product_name: getNestedValue(body, 'items.0.name') || '',
    product_id: String(getNestedValue(body, 'items.0.productId') || ''),
    city: (getNestedValue(body, 'buyer.address.city') || '').toLowerCase(),
    state: (getNestedValue(body, 'buyer.address.state') || '').toLowerCase(),
    country: getNestedValue(body, 'buyer.address.country') || '',
    zip: zip,
    ip: '',
    user_agent: ''
  };
}

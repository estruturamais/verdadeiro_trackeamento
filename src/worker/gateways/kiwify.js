import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

export function parseKiwify(body) {
  const utm = utmPrefixed(getNestedValue(body, 'TrackingParameters'));

  // Value = o que o cliente pagou (bruto, em centavos). NAO usar my_commission (comissao liquida do produtor).
  // Formato em centavos sem ponto — regex: (.+)(\d{2})$ → $1.$2
  var rawValue = String(getNestedValue(body, 'Commissions.charge_amount') || '');
  var value = rawValue.replace(/(.+)(\d{2})$/, '$1.$2');

  // Phone: remover + inicial
  var phone = String(getNestedValue(body, 'Customer.mobile') || '').replace(/^\+?(.*)$/, '$1');

  // Zip: extrair 5 primeiros digitos
  var zip = String(getNestedValue(body, 'Customer.zipcode') || '').replace(/^(\d{5}).*/, '$1');

  return {
    ...utm,
    marca_user: getNestedValue(body, 'TrackingParameters.sck'),
    email: getNestedValue(body, 'Customer.email'),
    phone: phone,
    name: getNestedValue(body, 'Customer.full_name'),
    order_id: getNestedValue(body, 'order_id'),
    value: value,
    currency: getNestedValue(body, 'Commissions.currency'),
    product_name: getNestedValue(body, 'Product.product_name'),
    product_id: String(getNestedValue(body, 'Product.product_id') || ''),
    city: getNestedValue(body, 'Customer.city'),
    state: getNestedValue(body, 'Customer.state'),
    country: '',
    zip: zip,
    ip: getNestedValue(body, 'Customer.ip'),
    user_agent: ''
  };
}

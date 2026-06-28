import { getNestedValue, utmFromPipe } from '../shared/helpers.js';

export function parseHotmart(body) {
  // UTMs: sck = "source|medium|campaign|term|content" (marca_user vem do xcod, separado)
  const utm = utmFromPipe(getNestedValue(body, 'data.purchase.origin.sck'));

  return {
    ...utm,
    marca_user: getNestedValue(body, 'data.purchase.origin.xcod'),
    email: getNestedValue(body, 'data.buyer.email'),
    phone: getNestedValue(body, 'data.buyer.checkout_phone'),
    name: getNestedValue(body, 'data.buyer.name'),
    order_id: getNestedValue(body, 'data.purchase.transaction'),
    // value = o que o cliente pagou (bruto). NAO usar data.commissions[1] (comissao liquida do produtor).
    value: getNestedValue(body, 'data.purchase.price.value'),
    currency: getNestedValue(body, 'data.purchase.price.currency_value'),
    product_name: getNestedValue(body, 'data.product.name'),
    product_id: String(getNestedValue(body, 'data.product.id') || ''),
    city: (getNestedValue(body, 'data.buyer.address.city') || '').toLowerCase(),
    state: (getNestedValue(body, 'data.buyer.address.state') || '').toLowerCase(),
    country: getNestedValue(body, 'data.buyer.address.country_iso'),
    zip: getNestedValue(body, 'data.buyer.address.zipcode'),
    ip: '',
    user_agent: ''
  };
}

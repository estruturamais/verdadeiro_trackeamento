import { getNestedValue } from '../shared/helpers.js';

export function parseHotmart(body) {
  return {
    marca_user: getNestedValue(body, 'data.purchase.origin.xcod'),
    email: getNestedValue(body, 'data.buyer.email'),
    phone: getNestedValue(body, 'data.buyer.checkout_phone'),
    name: getNestedValue(body, 'data.buyer.name'),
    order_id: getNestedValue(body, 'data.purchase.transaction'),
    value: getNestedValue(body, 'data.commissions.1.value'),
    currency: getNestedValue(body, 'data.commissions.1.currency_value'),
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

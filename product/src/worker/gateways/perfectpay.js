import { getNestedValue } from '../utils/helpers.js';

// TODO: Completar com payload real do gateway
export function parsePerfectPay(body) {
  return {
    marca_user: getNestedValue(body, 'metadata.utm_perfect'),
    email: '', phone: '', name: '',
    order_id: '', value: '', currency: 'BRL',
    product_name: '', product_id: '',
    city: '', state: '', country: '', zip: '',
    ip: '', user_agent: ''
  };
}

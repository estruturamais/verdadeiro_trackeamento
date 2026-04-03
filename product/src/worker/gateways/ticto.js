import { getNestedValue } from '../shared/helpers.js';

// TODO: Completar com payload real do gateway
export function parseTicto(body) {
  return {
    marca_user: getNestedValue(body, 'data.tracking.sck'),
    email: '', phone: '', name: '',
    order_id: '', value: '', currency: 'BRL',
    product_name: '', product_id: '',
    city: '', state: '', country: '', zip: '',
    ip: '', user_agent: ''
  };
}

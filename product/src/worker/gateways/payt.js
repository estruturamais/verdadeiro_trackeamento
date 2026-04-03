import { getNestedValue } from '../shared/helpers.js';

// TODO: Completar com payload real do gateway — confirmar campo src
export function parsePayt(body) {
  return {
    marca_user: getNestedValue(body, 'src'),
    email: '', phone: '', name: '',
    order_id: '', value: '', currency: 'BRL',
    product_name: '', product_id: '',
    city: '', state: '', country: '', zip: '',
    ip: '', user_agent: ''
  };
}

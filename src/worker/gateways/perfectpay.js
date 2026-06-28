import { getNestedValue } from '../shared/helpers.js';

// TODO: Completar com payload real do gateway — incluindo a extracao de UTM
// (utm_source/medium/campaign/term/content) quando houver um webhook de amostra.
export function parsePerfectPay(body) {
  return {
    utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '',
    marca_user: getNestedValue(body, 'metadata.utm_perfect'),
    email: '', phone: '', name: '',
    order_id: '', value: '', currency: 'BRL',
    product_name: '', product_id: '',
    city: '', state: '', country: '', zip: '',
    ip: '', user_agent: ''
  };
}

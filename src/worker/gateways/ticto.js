import { getNestedValue } from '../shared/helpers.js';

export function parseTicto(body) {
  // paid_amount vem em centavos (ex: 10000 = R$100,00)
  const paidAmount = getNestedValue(body, 'order.paid_amount');
  const value = paidAmount ? (paidAmount / 100).toFixed(2) : '';

  // country vem como "Brasil" — normalizar para "br" para hash correto
  const countryRaw = (getNestedValue(body, 'customer.address.country') || '').toLowerCase();
  const country = (countryRaw === 'brasil' || countryRaw === 'brazil') ? 'br' : countryRaw;

  // zip_code pode conter hífen (ex: "11700-630") — remover para padronizar
  const zip = (getNestedValue(body, 'customer.address.zip_code') || '').replace(/\D/g, '');

  // phone: objeto separado com ddi + ddd + number → concatenar e manter só dígitos
  const phoneDdi    = String(getNestedValue(body, 'customer.phone.ddi') || '');
  const phoneDdd    = String(getNestedValue(body, 'customer.phone.ddd') || '');
  const phoneNumber = String(getNestedValue(body, 'customer.phone.number') || '');
  const phone = [phoneDdi, phoneDdd, phoneNumber].join('').replace(/\D/g, '');

  return {
    marca_user:   getNestedValue(body, 'tracking.sck') || '',
    email:        getNestedValue(body, 'customer.email') || '',
    phone:        phone,
    name:         getNestedValue(body, 'customer.name') || '',
    order_id:     getNestedValue(body, 'order.hash') || String(getNestedValue(body, 'order.id') || ''),
    value:        value,
    currency:     'BRL',
    product_name: getNestedValue(body, 'item.product_name') || '',
    product_id:   String(getNestedValue(body, 'item.product_id') || ''),
    city:         getNestedValue(body, 'customer.address.city') || '',
    state:        getNestedValue(body, 'customer.address.state') || '',
    country:      country,
    zip:          zip,
    ip:           '',
    user_agent:   ''
  };
}

import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

export function parsePerfectPay(body) {
  // UTMs (chaves prefixadas) em metadata.utm_*. O marca_user mora em metadata.utm_perfect
  // (parametro dedicado da PerfectPay), entao nenhuma das 5 UTMs padrao e sacrificada.
  const utm = utmPrefixed(getNestedValue(body, 'metadata'));

  // value: sale_amount e o total pago pelo cliente (em reais, ja decimal).
  // NUNCA usar commission[].commission_amount (liquido do produtor).
  const saleAmount = getNestedValue(body, 'sale_amount');
  const value = saleAmount != null ? Number(saleAmount).toFixed(2) : '';

  // phone: phone_formated_ddi traz DDI+DDD+numero ("+55(19) 99625-2809") — manter so digitos
  const phone = String(getNestedValue(body, 'customer.phone_formated_ddi') || '').replace(/\D/g, '');

  // zip: extrair 5 primeiros digitos
  const zip = String(getNestedValue(body, 'customer.zip_code') || '').replace(/\D/g, '').replace(/^(\d{5}).*/, '$1');

  return {
    ...utm,
    marca_user:   getNestedValue(body, 'metadata.utm_perfect'),
    email:        (getNestedValue(body, 'customer.email') || '').toLowerCase(),
    phone:        phone,
    name:         (getNestedValue(body, 'customer.full_name') || '').toLowerCase(),
    order_id:     getNestedValue(body, 'code') || '',
    value:        value,
    currency:     getNestedValue(body, 'currency_enum_key') || 'BRL',
    product_name: getNestedValue(body, 'product.name') || '',
    product_id:   String(getNestedValue(body, 'product.code') || ''),
    city:         (getNestedValue(body, 'customer.city') || '').toLowerCase(),
    state:        (getNestedValue(body, 'customer.state') || '').toLowerCase(),
    country:      (getNestedValue(body, 'customer.country') || '').toLowerCase(),
    zip:          zip,
    ip:           getNestedValue(body, 'customer.ip') || '',
    user_agent:   ''
  };
}

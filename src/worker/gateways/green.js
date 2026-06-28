import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

export function parseGreen(body) {
  // Phone: client.cellphone vem com DDI e + inicial (ex: "+5564...") — remover o +
  var phone = String(getNestedValue(body, 'client.cellphone') || '').replace(/^\+?(.*)$/, '$1');

  // UTMs: Green guarda em saleMetas[] como pares {meta_key, meta_value}
  var metas = getNestedValue(body, 'saleMetas');
  var metaMap = {};
  if (Array.isArray(metas)) {
    for (var i = 0; i < metas.length; i++) {
      if (metas[i] && metas[i].meta_key) metaMap[metas[i].meta_key] = metas[i].meta_value;
    }
  }
  var utm = utmPrefixed(metaMap);

  // Zip: extrair 5 primeiros digitos (client.zipcode costuma vir null)
  var zip = String(getNestedValue(body, 'client.zipcode') || '').replace(/^(\d{5}).*/, '$1');

  return {
    ...utm,
    // marca_user: indexador injetado no checkout e devolvido no webhook (round-trip FDV)
    marca_user:   getNestedValue(body, 'sf_trk'),
    email:        (getNestedValue(body, 'client.email') || '').toLowerCase(),
    phone:        phone,
    name:         (getNestedValue(body, 'client.name') || '').toLowerCase(),
    order_id:     String(getNestedValue(body, 'sale.id') || ''),
    value:        getNestedValue(body, 'sale.total'),   // decimal em reais (nao centavos)
    currency:     getNestedValue(body, 'currency') || 'BRL',
    product_name: getNestedValue(body, 'product.name') || '',
    product_id:   String(getNestedValue(body, 'product.id') || ''),
    city:         (getNestedValue(body, 'client.city') || '').toLowerCase(),
    state:        (getNestedValue(body, 'client.uf') || '').toLowerCase(),
    country:      '',
    zip:          zip,
    ip:           '',
    user_agent:   ''
  };
}

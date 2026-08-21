import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

export function parseKirvano(body) {
  // O webhook real da Kirvano vem ACHATADO (campos no topo, sem wrapper "data").
  // O fallback `body.data || body` mantem compatibilidade caso algum dia venha aninhado.
  const data = body.data || body;

  const utm = utmPrefixed(getNestedValue(data, 'utm'));

  // Currency: extrair primeira palavra do total_price (ex: "BRL 97.00" → "BRL")
  var totalPrice = String(getNestedValue(data, 'total_price') || '');
  var currency = totalPrice.match(/^(\S+)/) ? totalPrice.match(/^(\S+)/)[1] : 'BRL';
  // Value: extrair valor numerico
  var value = totalPrice.replace(/^[A-Z]+\s*/, '');

  return {
    ...utm,
    marca_user: getNestedValue(data, 'utm.src'),
    email: (getNestedValue(data, 'customer.email') || '').toLowerCase(),
    phone: getNestedValue(data, 'customer.phone_number'),
    name: (getNestedValue(data, 'customer.name') || '').toLowerCase(),
    order_id: getNestedValue(data, 'sale_id'),
    value: value,
    currency: currency,
    product_name: getNestedValue(data, 'products.0.name'),
    product_id: String(getNestedValue(data, 'products.0.id') || ''),
    city: '',
    state: '',
    country: '',
    zip: '',
    ip: '',
    user_agent: '',

    // --- Extras da transacao (planilha de vendas; nao usados pelas plataformas de ads) ---
    // products[] traz oferta e flag de bump por item; o parser segue products[0]
    // (mesmo item usado em product_name/product_id).
    offer_id: getNestedValue(data, 'products.0.offer_id') || '',
    offer_name: getNestedValue(data, 'products.0.offer_name') || '',
    payment_method: getNestedValue(data, 'payment.method') || '',
    installments: getNestedValue(data, 'payment.installments') ?? '',
    // boolean cru (true/false/undefined) — quem consome decide o rotulo
    order_bump: getNestedValue(data, 'products.0.is_order_bump'),
    // Kirvano nao informa taxa/liquido no payload — colunas ficam vazias
    value_gateway: '',
    value_net: ''
  };
}

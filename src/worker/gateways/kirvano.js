import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

// `total_price` e TEXTO com moeda. O payload real (compra aprovada, 2026) manda o simbolo e o
// formato pt-BR — "R$ 169,80" —, e a leitura antiga esperava "BRL 97.00": tirava so as letras do
// inicio, sobrava "$ 169,80" (parseFloat -> NaN -> value 0 em Meta/GA4/TikTok/Google Ads) e a
// moeda virava "R$", que nao e ISO 4217. Aceita os dois formatos e devolve o valor com ponto
// decimal ("169.80"), como os demais parsers.
function parseTotalPrice(raw) {
  const s = String(raw || '').trim();
  const iso = s.match(/^([A-Z]{3})(?=[\s\d])/);
  const currency = iso ? iso[1] : 'BRL'; // "R$" (ou sem prefixo) = real
  let num = s.replace(/^[^\d-]+/, '');
  // Virgula presente = formato pt-BR: ponto e milhar ("1.169,80"), virgula e decimal.
  num = num.includes(',') ? num.replace(/\./g, '').replace(',', '.') : num;
  num = num.replace(/[^\d.-]/g, '');
  return { value: num, currency };
}

export function parseKirvano(body) {
  // O webhook real da Kirvano vem ACHATADO (campos no topo, sem wrapper "data").
  // O fallback `body.data || body` mantem compatibilidade caso algum dia venha aninhado.
  const data = body.data || body;

  const utm = utmPrefixed(getNestedValue(data, 'utm'));

  // total_price = o que o cliente pagou (produto + bumps; ex.: 119,90 + 49,90 = "R$ 169,80")
  const { value, currency } = parseTotalPrice(getNestedValue(data, 'total_price'));

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

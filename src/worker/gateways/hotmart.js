import { getNestedValue, utmFromPipe } from '../shared/helpers.js';

// Comissoes da Hotmart: array [{ value, currency_value, source }] com
// source = MARKETPLACE (taxa retida pela Hotmart) | PRODUCER (liquido do produtor)
// | AFFILIATE | COPRODUCER. Devolve o `value` da primeira ocorrencia do source.
function commissionBySource(body, source) {
  const list = getNestedValue(body, 'data.commissions');
  if (!Array.isArray(list)) return '';
  const found = list.find((c) => c && c.source === source);
  return found && found.value != null ? found.value : '';
}

export function parseHotmart(body) {
  // UTMs: sck = "source|medium|campaign|term|content" (marca_user vem do xcod, separado)
  const utm = utmFromPipe(getNestedValue(body, 'data.purchase.origin.sck'));

  return {
    ...utm,
    marca_user: getNestedValue(body, 'data.purchase.origin.xcod'),
    email: getNestedValue(body, 'data.buyer.email'),
    phone: getNestedValue(body, 'data.buyer.checkout_phone'),
    name: getNestedValue(body, 'data.buyer.name'),
    order_id: getNestedValue(body, 'data.purchase.transaction'),
    // value = o que o cliente pagou (bruto). NAO usar data.commissions[1] (comissao liquida do produtor).
    value: getNestedValue(body, 'data.purchase.price.value'),
    currency: getNestedValue(body, 'data.purchase.price.currency_value'),
    product_name: getNestedValue(body, 'data.product.name'),
    product_id: String(getNestedValue(body, 'data.product.id') || ''),
    city: (getNestedValue(body, 'data.buyer.address.city') || '').toLowerCase(),
    state: (getNestedValue(body, 'data.buyer.address.state') || '').toLowerCase(),
    country: getNestedValue(body, 'data.buyer.address.country_iso'),
    zip: getNestedValue(body, 'data.buyer.address.zipcode'),
    ip: '',
    user_agent: '',

    // --- Extras da transacao (planilha de vendas; nao usados pelas plataformas de ads) ---
    offer_id: getNestedValue(body, 'data.purchase.offer.code') || '',
    // offer.name nem sempre vem no payload — fica vazio quando ausente
    offer_name: getNestedValue(body, 'data.purchase.offer.name') || '',
    payment_method: getNestedValue(body, 'data.purchase.payment.type') || '',
    installments: getNestedValue(body, 'data.purchase.payment.installments_number') ?? '',
    // boolean cru (true/false/undefined) — quem consome decide o rotulo
    order_bump: getNestedValue(body, 'data.purchase.order_bump.is_order_bump'),
    value_gateway: commissionBySource(body, 'MARKETPLACE'),
    value_net: commissionBySource(body, 'PRODUCER')
  };
}

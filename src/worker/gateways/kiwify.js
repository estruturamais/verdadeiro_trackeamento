import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

// Centavos sem ponto -> decimal (ex: 1990 -> "19.90"). Vazio se nao informado.
function fromCents(raw) {
  var s = String(raw ?? '');
  return s ? s.replace(/(.+)(\d{2})$/, '$1.$2') : '';
}

export function parseKiwify(body) {
  const utm = utmPrefixed(getNestedValue(body, 'TrackingParameters'));

  // Value = o que o cliente pagou (bruto, em centavos). NAO usar my_commission (comissao liquida do produtor).
  var value = fromCents(getNestedValue(body, 'Commissions.charge_amount'));

  // Phone: remover + inicial
  var phone = String(getNestedValue(body, 'Customer.mobile') || '').replace(/^\+?(.*)$/, '$1');

  // Zip: extrair 5 primeiros digitos
  var zip = String(getNestedValue(body, 'Customer.zipcode') || '').replace(/^(\d{5}).*/, '$1');

  return {
    ...utm,
    marca_user: getNestedValue(body, 'TrackingParameters.sck'),
    email: getNestedValue(body, 'Customer.email'),
    phone: phone,
    name: getNestedValue(body, 'Customer.full_name'),
    order_id: getNestedValue(body, 'order_id'),
    value: value,
    currency: getNestedValue(body, 'Commissions.currency'),
    product_name: getNestedValue(body, 'Product.product_name'),
    product_id: String(getNestedValue(body, 'Product.product_id') || ''),
    city: getNestedValue(body, 'Customer.city'),
    state: getNestedValue(body, 'Customer.state'),
    country: '',
    zip: zip,
    ip: getNestedValue(body, 'Customer.ip'),
    user_agent: '',

    // --- Extras da transacao (planilha de vendas; nao usados pelas plataformas de ads) ---
    // Kiwify nao tem entidade "oferta" no payload — o codigo do checkout faz esse papel.
    offer_id: getNestedValue(body, 'checkout_link') || '',
    offer_name: '',
    payment_method: getNestedValue(body, 'payment_method') || '',
    installments: getNestedValue(body, 'installments') ?? '',
    // Kiwify nao informa order bump no payload — fica undefined (coluna vazia)
    order_bump: undefined,
    // Commissions.* tambem vem em centavos. Em assinatura, charge_amount pode divergir
    // de kiwify_fee + my_commission (valores do ciclo) — extrair como o gateway reporta.
    value_gateway: fromCents(getNestedValue(body, 'Commissions.kiwify_fee')),
    value_net: fromCents(getNestedValue(body, 'Commissions.my_commission'))
  };
}

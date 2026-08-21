import { getNestedValue } from '../shared/helpers.js';

// Comissoes da Lastlink: Data.Commissions = [{ Value, Source }] com Source em
// MARKETPLACE (taxa da Lastlink) | PRODUCER (liquido) | COPRODUCER | AFFILIATE.
// Buscar por Source, nunca por indice.
function commissionBySource(body, source) {
  const list = getNestedValue(body, 'Data.Commissions');
  if (!Array.isArray(list)) return '';
  const found = list.find(function (c) { return c && c.Source === source; });
  return found && found.Value != null ? found.Value : '';
}

export function parseLastlink(body) {
  // Phone: remover + inicial
  var phone = String(getNestedValue(body, 'Data.Buyer.PhoneNumber') || '').replace(/^\+?(.*)$/, '$1');
  // Zip: extrair 5 primeiros digitos
  var zip = String(getNestedValue(body, 'Data.Buyer.Address.ZipCode') || '').replace(/(\d{5}).*/, '$1');

  // UTMs em PascalCase (Data.Utm.Utm*)
  var utmBase = getNestedValue(body, 'Data.Utm') || {};
  var utm = {
    utm_source:   utmBase.UtmSource   || '',
    utm_medium:   utmBase.UtmMedium   || '',
    utm_campaign: utmBase.UtmCampaign || '',
    utm_term:     utmBase.UtmTerm     || '',
    utm_content:  utmBase.UtmContent  || ''
  };

  // Lastlink nao tem campo de rastreamento proprio: usamos a chave 'marca_user' (indexador)
  // injetada no checkout, devolvida na URL de origem (Data.Purchase.OriginUrl).
  var marcaUser = '';
  try {
    var originUrl = getNestedValue(body, 'Data.Purchase.OriginUrl');
    if (originUrl) marcaUser = new URL(originUrl).searchParams.get('marca_user') || '';
  } catch (e) {}

  return {
    ...utm,
    marca_user: marcaUser,
    email: (getNestedValue(body, 'Data.Buyer.Email') || '').toLowerCase(),
    phone: phone,
    name: (getNestedValue(body, 'Data.Buyer.Name') || '').toLowerCase(),
    order_id: getNestedValue(body, 'Data.Purchase.PaymentId'),
    value: getNestedValue(body, 'Data.Purchase.OriginalPrice.Value'),
    currency: 'BRL',
    product_name: getNestedValue(body, 'Data.Products.0.Name'),
    product_id: String(getNestedValue(body, 'Data.Products.0.Id') || ''),
    city: (getNestedValue(body, 'Data.Buyer.Address.City') || '').toLowerCase(),
    state: getNestedValue(body, 'Data.Buyer.Address.State'),
    country: getNestedValue(body, 'Data.Buyer.Address.Country'),
    zip: zip,
    ip: getNestedValue(body, 'Data.DeviceInfo.ip'),
    user_agent: getNestedValue(body, 'Data.DeviceInfo.UserAgent'),

    // --- Extras da transacao (planilha de vendas; nao usados pelas plataformas de ads) ---
    offer_id: String(getNestedValue(body, 'Data.Offer.Id') || ''),
    offer_name: getNestedValue(body, 'Data.Offer.Name') || '',
    payment_method: getNestedValue(body, 'Data.Purchase.Payment.PaymentMethod') || '',
    installments: getNestedValue(body, 'Data.Purchase.Payment.NumberOfInstallments') ?? '',
    // Lastlink nao informa order bump no payload — fica undefined (coluna vazia)
    order_bump: undefined,
    value_gateway: commissionBySource(body, 'MARKETPLACE'),
    value_net: commissionBySource(body, 'PRODUCER')
  };
}

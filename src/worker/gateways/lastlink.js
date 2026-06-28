import { getNestedValue } from '../shared/helpers.js';

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
    user_agent: getNestedValue(body, 'Data.DeviceInfo.UserAgent')
  };
}

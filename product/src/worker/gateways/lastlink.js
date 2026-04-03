import { getNestedValue } from '../shared/helpers.js';

export function parseLastlink(body) {
  // Phone: remover + inicial
  var phone = String(getNestedValue(body, 'Data.Buyer.PhoneNumber') || '').replace(/^\+?(.*)$/, '$1');
  // Zip: extrair 5 primeiros digitos
  var zip = String(getNestedValue(body, 'Data.Buyer.Address.ZipCode') || '').replace(/(\d{5}).*/, '$1');

  return {
    marca_user: getNestedValue(body, 'Data.Utm.UtmId'),
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

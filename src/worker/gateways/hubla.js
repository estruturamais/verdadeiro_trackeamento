import { getNestedValue, utmBare } from '../shared/helpers.js';

export function parseHubla(body) {
  let marcaUser = '';

  // UTMs (chaves nuas) na sessao de pagamento
  const utm = utmBare(getNestedValue(body, 'event.invoice.paymentSession.utm'));

  // Hubla nao tem campo de rastreamento proprio: ecoa a URL da sessao de pagamento.
  // O web.js injeta o marca_user na chave 'marca_user' (indexador), lida de volta aqui.
  const urlString = getNestedValue(body, 'event.invoice.paymentSession.url');
  if (urlString) {
    try {
      const url = new URL(urlString);
      marcaUser = url.searchParams.get('marca_user') || '';
    } catch(e) {}
  }

  const firstName = getNestedValue(body, 'event.invoice.payer.firstName') || '';
  const lastName  = getNestedValue(body, 'event.invoice.payer.lastName') || '';
  const fullName  = [firstName, lastName].filter(Boolean).join(' ');

  const totalCents = getNestedValue(body, 'event.invoice.amount.totalCents');
  const value = totalCents ? (totalCents / 100).toFixed(2) : '';

  // Hubla envia o telefone com +55 — remover o + para padronizar
  const phoneRaw = String(getNestedValue(body, 'event.invoice.payer.phone') || '');
  const phone = phoneRaw.replace(/^\+/, '');

  return {
    ...utm,
    marca_user:   marcaUser,
    email:        getNestedValue(body, 'event.invoice.payer.email'),
    phone:        phone,
    name:         fullName,
    order_id:     getNestedValue(body, 'event.invoice.id'),
    value:        value,
    currency:     getNestedValue(body, 'event.invoice.currency') || 'BRL',
    product_name: getNestedValue(body, 'event.product.name') || getNestedValue(body, 'event.products.0.name'),
    product_id:   String(getNestedValue(body, 'event.product.id') || getNestedValue(body, 'event.products.0.id') || ''),
    // Hubla nao envia endereco no payload — campos vazios para nao sobrescrever dados do user_store
    city:         '',
    state:        '',
    country:      '',
    zip:          '',
    // IP e User-Agent vem da sessao de pagamento
    ip:           getNestedValue(body, 'event.invoice.paymentSession.ip'),
    user_agent:   getNestedValue(body, 'event.invoice.paymentSession.userAgent')
  };
}

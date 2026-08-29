import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

// A Ticto envia a STRING "Nao Informado" em campo vazio (visto em payload real de
// producao, 2026-08-22) — sem filtrar, venda organica ganharia marca_user/utm_*
// literalmente "Nao Informado": lookup no user_store por essa string e external_id
// hasheado dela indo para as plataformas.
function cleanNI(value) {
  const v = value == null ? '' : String(value);
  // Tolerante a variantes: 'Não Informado' (payload real, U+00E3), 'Nao Informado'
  // e a forma mojibake 'NÃ£o Informado' (dupla codificacao em algum hop).
  return /^n.{0,2}o informado$/i.test(v.trim()) ? '' : v;
}

export function parseTicto(body) {
  // tracking.* limpo do placeholder antes de qualquer uso (utm + sck)
  const trackingRaw = getNestedValue(body, 'tracking') || {};
  const tracking = {};
  for (const k of Object.keys(trackingRaw)) tracking[k] = cleanNI(trackingRaw[k]);
  const utm = utmPrefixed(tracking);

  // paid_amount vem em centavos (ex: 10000 = R$100,00)
  const paidAmount = getNestedValue(body, 'order.paid_amount');
  const value = paidAmount ? (paidAmount / 100).toFixed(2) : '';

  // country vem como "Brasil" — normalizar para "br" para hash correto
  const countryRaw = (getNestedValue(body, 'customer.address.country') || '').toLowerCase();
  const country = (countryRaw === 'brasil' || countryRaw === 'brazil') ? 'br' : countryRaw;

  // zip_code pode conter hífen (ex: "11700-630") — remover para padronizar
  const zip = (getNestedValue(body, 'customer.address.zip_code') || '').replace(/\D/g, '');

  // phone: objeto separado com ddi + ddd + number → concatenar e manter só dígitos
  const phoneDdi    = String(getNestedValue(body, 'customer.phone.ddi') || '');
  const phoneDdd    = String(getNestedValue(body, 'customer.phone.ddd') || '');
  const phoneNumber = String(getNestedValue(body, 'customer.phone.number') || '');
  const phone = [phoneDdi, phoneDdd, phoneNumber].join('').replace(/\D/g, '');

  // A oferta e recorrente? Payload real traz `offer.is_subscription`; o bloco
  // `subscriptions[]` nao-vazio serve de fallback. Venda AVULSA no mesmo painel
  // Ticto NAO pode entrar no fluxo de assinatura (viraria Subscribe e poluiria a
  // tabela `subscriptions`) — por isso o gate, e nao a leitura direta do hash.
  const assinaturas = getNestedValue(body, 'subscriptions');
  const ehAssinatura = getNestedValue(body, 'offer.is_subscription') === true
    || (Array.isArray(assinaturas) && assinaturas.length > 0);

  return {
    ...utm,
    marca_user:   tracking.sck || '',
    email:        getNestedValue(body, 'customer.email') || '',
    phone:        phone,
    name:         getNestedValue(body, 'customer.name') || '',
    // order.transaction_hash (TPC...) muda a CADA cobranca — e o id da TRANSACAO
    // (a fatura). order.hash (TOC..., o "Codigo do Pedido") e o id da ASSINATURA e e
    // IGUAL em todas as cobrancas: usa-lo como order_id fazia toda renovacao cair no
    // dedup de dispatch e nunca chegar as plataformas (achado 2026-08-22, payload
    // real). Fallbacks preservam o comportamento em payload de compra unica antigo.
    order_id:     getNestedValue(body, 'order.transaction_hash')
      || getNestedValue(body, 'transaction.hash')
      || getNestedValue(body, 'order.hash')
      || String(getNestedValue(body, 'order.id') || ''),
    value:        value,
    currency:     'BRL',
    product_name: getNestedValue(body, 'item.product_name') || '',
    product_id:   String(getNestedValue(body, 'item.product_id') || ''),
    city:         getNestedValue(body, 'customer.address.city') || '',
    state:        getNestedValue(body, 'customer.address.state') || '',
    country:      country,
    zip:          zip,
    ip:           '',
    user_agent:   '',

    // --- Assinatura (SaaS) — consumido quando SITE_CONFIG.subscription_tracking liga ---
    // order.hash e estavel por assinatura: e o subscription_id, mas SO quando a oferta
    // e recorrente (ver `ehAssinatura` acima).
    subscription_id:   ehAssinatura ? (getNestedValue(body, 'order.hash') || '') : '',
    // successful_charges INCLUI a cobranca atual: 1 = primeira, >1 = renovacao.
    charges_paid_hint: getNestedValue(body, 'subscriptions.0.successful_charges'),
    plan:              getNestedValue(body, 'offer.name') || getNestedValue(body, 'item.offer_name') || '',

    // --- Extras da transacao (planilha de vendas; nao usados pelas plataformas de ads) ---
    offer_id:       getNestedValue(body, 'item.offer_code') || '',
    offer_name:     getNestedValue(body, 'item.offer_name') || '',
    payment_method: getNestedValue(body, 'payment_method') || '',
    installments:   getNestedValue(body, 'order.installments') ?? '',
    // Ticto nao traz flag de bump no payload (bump/combo chega como webhook proprio) — fica undefined
    order_bump:     undefined,
    // marketplace_commission (taxa Ticto) e producer.amount (liquido) vem em centavos
    value_gateway:  getNestedValue(body, 'marketplace_commission') != null
      ? (getNestedValue(body, 'marketplace_commission') / 100).toFixed(2) : '',
    value_net:      getNestedValue(body, 'producer.amount') != null
      ? (getNestedValue(body, 'producer.amount') / 100).toFixed(2) : ''
  };
}

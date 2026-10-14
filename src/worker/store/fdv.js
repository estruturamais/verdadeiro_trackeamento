export function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

// Fallback do FDV merge por IP do dispositivo — opt-in em SITE_CONFIG.fdv.ip_fallback.
// Aceita `true` ou { enabled, window_hours, require_checkout }. Omitido = desligado e o
// comportamento e exatamente o de antes.
//   window_hours     quanto tempo ANTES do webhook a visita ainda conta (default 12, teto 72;
//                    `events` so guarda 7 dias no modo auto_clean)
//   require_checkout so casa se aquele IP clicou no checkout (initiate_checkout) na janela
//                    (default true). Sem isso, IP compartilhado (CGNAT, wifi de casa) casaria
//                    comprador com qualquer visitante curioso do mesmo IP.
export function fdvIpFallbackConfig(config) {
  const off = { enabled: false, windowHours: 12, requireCheckout: true };
  const raw = config?.fdv?.ip_fallback;
  if (raw === true) return { ...off, enabled: true };
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.enabled === true) {
    const h = Number(raw.window_hours);
    return {
      enabled: true,
      windowHours: Number.isFinite(h) && h > 0 ? Math.min(h, 72) : off.windowHours,
      requireCheckout: raw.require_checkout !== false
    };
  }
  return off;
}

export function fdvMerge(storeData, webhookData) {
  const store = storeData || {};

  return {
    // Dados de atribuicao: banco prioridade (browser real)
    email:            firstDefined(store.email, webhookData.email),
    phone:            firstDefined(store.phone, webhookData.phone),
    fullname:         firstDefined(store.fullname, webhookData.name),
    ip:               firstDefined(store.ip, webhookData.ip),
    user_agent:       firstDefined(store.user_agent, webhookData.user_agent),
    city:             firstDefined(store.city, webhookData.city),
    state:            firstDefined(store.state, webhookData.state),
    country:          firstDefined(store.country, webhookData.country),
    zip:              firstDefined(webhookData.zip, ''),  // zip so vem do webhook

    // Browser data: SEMPRE do banco
    fbp:              store.fbp || '',
    fbc:              store.fbc || '',
    ttp:              store.ttp || '',
    ttclid:           store.ttclid || '',
    ga_client_id:     store.ga_client_id || '',
    ga_session_id:    store.ga_session_id || '',
    ga_session_count: store.ga_session_count || '',
    ga_timestamp:     store.ga_timestamp || '',
    gclid:            store.gclid || '',
    wbraid:           store.wbraid || '',
    gbraid:           store.gbraid || '',
    page_url:         store.page_url || '',
    marca_user:       store.marca_user || webhookData.marca_user,

    // Dados da transacao: SEMPRE do webhook
    order_id:         webhookData.order_id,
    value:            webhookData.value,
    currency:         webhookData.currency || 'BRL',
    product_name:     webhookData.product_name,
    product_id:       webhookData.product_id,

    // Extras da transacao — consumidos pela planilha de vendas (sheets).
    // As plataformas de ads ignoram; parser que nao preenche deixa vazio.
    offer_id:         webhookData.offer_id || '',
    offer_name:       webhookData.offer_name || '',
    payment_method:   webhookData.payment_method || '',
    installments:     webhookData.installments ?? '',
    order_bump:       webhookData.order_bump,          // boolean cru (true/false/undefined)
    value_gateway:    webhookData.value_gateway ?? '',
    value_net:        webhookData.value_net ?? '',

    // UTM last-click da venda (vem do indexador/caminho do gateway)
    utm_source:       webhookData.utm_source || '',
    utm_medium:       webhookData.utm_medium || '',
    utm_campaign:     webhookData.utm_campaign || '',
    utm_term:         webhookData.utm_term || '',
    utm_content:      webhookData.utm_content || '',
    utm_id:           webhookData.utm_id || ''
  };
}

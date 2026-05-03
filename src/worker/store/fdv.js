export function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
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
    page_url:         store.page_url || '',
    marca_user:       store.marca_user || webhookData.marca_user,

    // Dados da transacao: SEMPRE do webhook
    order_id:         webhookData.order_id,
    value:            webhookData.value,
    currency:         webhookData.currency || 'BRL',
    product_name:     webhookData.product_name,
    product_id:       webhookData.product_id
  };
}

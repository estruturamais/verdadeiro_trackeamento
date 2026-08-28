// Google Ads: a coluna `gads` diz QUAL rotulo do config aquele evento usa
// (`conversion_label_{gads}`). Nenhum evento dispara sozinho — o disparo e OPT-IN
// pelo rotulo: sem `conversion_label_page_view` no config, page_view nao vira
// conversao. Quem decide o que e conversao (e o que e principal) e o cliente, no
// painel do Google Ads; o papel do VT e saber enviar o que estiver configurado.
export const EVENT_NAMES = {
  page_view:         { meta: 'PageView',          tiktok: 'Pageview',         ga4: 'page_view',      gads: 'page_view' },
  contact:           { meta: 'Contact',           tiktok: 'Contact',          ga4: 'contact',        gads: 'contact' },
  lead:              { meta: 'Lead',              tiktok: 'SubmitForm',       ga4: 'generate_lead',  gads: 'lead' },
  initiate_checkout: { meta: 'InitiateCheckout',  tiktok: 'InitiateCheckout', ga4: 'begin_checkout', gads: 'initiate_checkout' },
  purchase:          { meta: 'Purchase',          tiktok: 'Purchase',         ga4: 'purchase',       gads: 'purchase' }
};

// Google Ads: a coluna `gads` diz QUAL rotulo do config aquele evento usa
// (`conversion_label_{gads}`). Nenhum evento dispara sozinho — o disparo e OPT-IN
// pelo rotulo: sem `conversion_label_page_view` no config, page_view nao vira
// conversao. Quem decide o que e conversao (e o que e principal) e o cliente, no
// painel do Google Ads; o papel do VT e saber enviar o que estiver configurado.
export const EVENT_NAMES = {
  page_view:         { meta: 'PageView',          tiktok: 'Pageview',         ga4: 'page_view',      gads: 'page_view' },
  contact:           { meta: 'Contact',           tiktok: 'Contact',          ga4: 'contact',        gads: 'contact' },
  lead:              { meta: 'Lead',              tiktok: 'SubmitForm',       ga4: 'generate_lead',  gads: 'lead' },
  // Cadastro confirmado na LP/app (evento padrao) e login (evento CUSTOM no Meta;
  // sem `gads` porque login nao e conversao de campanha, e sim sinal de audiencia/
  // exclusao). Sao os eventos que `triggers.lead.routes` roteia por slug num SaaS,
  // onde cadastro e login tem o mesmo submit no DOM e so a rota os separa.
  complete_registration: { meta: 'CompleteRegistration', tiktok: 'CompleteRegistration', ga4: 'sign_up', gads: 'complete_registration' },
  login:             { meta: 'Login',             tiktok: '',                 ga4: 'login',          gads: '' },
  initiate_checkout: { meta: 'InitiateCheckout',  tiktok: 'InitiateCheckout', ga4: 'begin_checkout', gads: 'initiate_checkout' },
  purchase:          { meta: 'Purchase',          tiktok: 'Purchase',         ga4: 'purchase',       gads: 'purchase' }
};

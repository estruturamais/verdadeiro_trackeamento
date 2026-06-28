import { getNestedValue, utmPrefixed } from '../shared/helpers.js';

export function parseTutory(body) {
  // A Tutory entrega o payload como array de uma posicao — desembrulhar.
  const data = Array.isArray(body) ? body[0] : body;

  // marca_user, ip e user_agent vivem dentro de metadados.dados_visitante, que
  // chega como STRING JSON — precisa virar objeto antes de qualquer leitura.
  // A Tutory nao tem parametro de rastreamento dedicado, mas entrega a URL que
  // foi acessada no checkout (campo `referer`). Injetamos o marca_user nessa URL
  // sob a chave `marca_user` (mesmo nome usado como `indexador` no gateways_config)
  // e o lemos de volta aqui — round-trip checkout<->webhook que cruza via FDV.
  // Usar a chave `marca_user` (em vez de um UTM) preserva todas as UTMs valiosas.
  let marcaUser = '';
  let ip = '';
  let userAgent = '';
  // UTMs (last-click): mesma URL do referer; sem param de rastreamento dedicado.
  let utm = utmPrefixed({});
  const visitorRaw = getNestedValue(data, 'metadados.dados_visitante');
  if (visitorRaw) {
    try {
      const visitor = typeof visitorRaw === 'string' ? JSON.parse(visitorRaw) : visitorRaw;
      ip = visitor.ip || '';
      userAgent = visitor.userAgent || '';
      if (visitor.referer) {
        const sp = new URL(visitor.referer).searchParams;
        marcaUser = sp.get('marca_user') || '';
        utm = utmPrefixed({
          utm_source:   sp.get('utm_source'),
          utm_medium:   sp.get('utm_medium'),
          utm_campaign: sp.get('utm_campaign'),
          utm_term:     sp.get('utm_term'),
          utm_content:  sp.get('utm_content')
        });
      }
    } catch (e) {}
  }

  // Phone: vem so com DDI, sem + — remover o + por seguranca para padronizar.
  const phone = String(getNestedValue(data, 'telefone') || '').replace(/^\+/, '');

  // Zip: extrair os 5 primeiros digitos (ex: "00000-000" -> "00000").
  const zip = String(getNestedValue(data, 'endereco.cep') || '').replace(/^(\d{5}).*/, '$1');

  return {
    ...utm,
    marca_user:   marcaUser,
    email:        (getNestedValue(data, 'email') || '').toLowerCase(),
    phone:        phone,
    name:         (getNestedValue(data, 'nome') || '').toLowerCase(),
    order_id:     String(getNestedValue(data, 'id') || ''),
    value:        getNestedValue(data, 'valor'),   // decimal em reais (valor bruto pago)
    currency:     'BRL',                           // Tutory nao envia moeda — gateway BR
    product_name: getNestedValue(data, 'produto.nome') || '',
    product_id:   String(getNestedValue(data, 'produto.id') || ''),
    city:         (getNestedValue(data, 'endereco.cidade') || '').toLowerCase(),
    state:        getNestedValue(data, 'endereco.estado') || '',
    country:      getNestedValue(data, 'endereco.pais') || '',
    zip:          zip,
    ip:           ip,
    user_agent:   userAgent
  };
}

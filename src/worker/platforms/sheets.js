import { logEvent } from '../shared/logger.js';
import { cleanSecret } from '../shared/helpers.js';

// Eventos de qualificacao -> colunas derivadas do `event` (meta_event/qualificacao).
// Esses eventos NAO criam linha nova: fazem UPSERT por user_id, completando a
// linha ja criada pelo evento `lead`.
const QUAL_EVENTS = {
  qualified_lead: { meta_event: 'QualifiedLead', qualificacao: 'QUALIFICADO' },
  disqualified_lead: { meta_event: 'DisqualifiedLead', qualificacao: 'DESQUALIFICADO' }
};

// slug = ultimo segmento nao-vazio do pathname (ex.: '/lp/registrol20' -> 'registrol20')
function pageSlug(pageUrl) {
  try {
    const parts = new URL(pageUrl).pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  } catch (e) {
    return '';
  }
}

function fullName(userData) {
  return [userData?.first_name, userData?.last_name].filter(Boolean).join(' ');
}

// Conector unico de Google Sheets (GAS universal: append + upsert + auto-create + roteamento de aba).
// - append (linha nova): eventos em sheets.events (default ['lead']).
// - upsert por user_id (`_mode=upsert&_key=user_id`): qualified_lead/disqualified_lead,
//   completando a linha do lead (preserva contato/data/hora; grava so as colunas de qualificacao).
// A aba de destino vai em `_sheet` (sheets.sheet aqui; sheets.purchase.sheet nas vendas),
// entao a aba nao fica hardcoded no Apps Script.
export async function sendSheetsLead(sheetsConfig, eventName, body, clientIp, userAgent, config, siteId, env) {
  // id_script vai interpolado na URL — whitespace no valor quebra a requisicao.
  const idScript = cleanSecret(sheetsConfig?.id_script);
  if (!idScript) return;

  const qual = QUAL_EVENTS[eventName];
  const appendEvents = sheetsConfig.events || ['lead'];
  // qualificacao sempre faz upsert quando o sheets esta configurado; demais eventos
  // so disparam (append) se listados em sheets.events.
  if (!qual && !appendEvents.includes(eventName)) return;

  const fields = {};
  let upsert = false;

  if (qual) {
    // UPSERT: chave + colunas de qualificacao. O evento `lead` (append) ja cria a
    // linha com o contato; aqui completamos com as colunas de qualificacao.
    upsert = true;
    fields.user_id = body.marca_user || '';
    fields.meta_event = qual.meta_event;
    fields.qualificacao = qual.qualificacao;

    // Rede de seguranca: se o beacon do `lead` se perder, o upsert ainda grava o
    // contato. O filtro de nao-vazios (abaixo) nao sobrescreve contato existente com vazio.
    const ud = body.user_data || {};
    fields.nome = fullName(ud);
    fields.email = ud.email || '';
    fields.telefone = ud.phone || '';

    const cd = body.custom_data || {};
    if (cd.lead_score != null) fields.lead_score = cd.lead_score;
    if (cd.lead_tier) fields.tier = cd.lead_tier;

    const q = body.qualification || {};
    if (q.resultado != null && q.resultado !== '') fields.resultado = q.resultado;

    // respostas: map questions[].field -> questions[].sheet_col
    const questions = config?.qualification?.questions || [];
    const answers = q.answers || {};
    for (const ques of questions) {
      if (ques?.field && ques?.sheet_col && answers[ques.field] != null && answers[ques.field] !== '') {
        fields[ques.sheet_col] = answers[ques.field];
      }
    }

    // extras (ex.: instagram) ja vem chaveado pelo nome logico da coluna
    const extras = q.extras || {};
    for (const k in extras) {
      if (Object.prototype.hasOwnProperty.call(extras, k) && extras[k] != null && extras[k] !== '') {
        fields[k] = extras[k];
      }
    }
  } else {
    // APPEND: linha nova com os dados padrao do lead
    const ud = body.user_data || {};
    const utm = body.utm_data || {};
    const bd = body.browser_data || {};
    const pageEventNames = sheetsConfig.page_event_names || {};
    const slug = pageSlug(body.page_url);

    fields.evento = pageEventNames[slug] || eventName;
    fields.user_id = body.marca_user || '';
    fields.nome = fullName(ud);
    fields.email = ud.email || '';
    fields.telefone = ud.phone || '';
    fields.gender = ud.gender || '';
    fields['país'] = ud.country || '';
    fields.estado = ud.state || '';
    fields.cidade = ud.city || '';
    fields.utm_source = utm.utm_source || '';
    fields.utm_medium = utm.utm_medium || '';
    fields.utm_campaign = utm.utm_campaign || '';
    fields.utm_content = utm.utm_content || '';
    fields.utm_term = utm.utm_term || '';
    fields.utm_id = utm.utm_id || '';
    fields.gclid = utm.gclid || '';
    fields.slug = slug;
    fields.page_location = body.page_url || '';
    fields.ip_address = clientIp || '';
    fields.user_agent = userAgent || '';
    fields.fbc = bd.fbc || '';
    fields.fbp = bd.fbp || '';
  }

  // Parametros de CONTROLE do GAS universal (nunca viram coluna).
  // `_sheet` roteia a gravacao para a aba pedida — sem hardcode no Apps Script.
  const control = { _sheet: sheetsConfig.sheet || '' };
  if (upsert) {
    control._mode = 'upsert';
    control._key = 'user_id';
  }

  await callGas(idScript, fields, control, {
    site_id: siteId, event_name: eventName, event_id: body.event_id || '',
    channel: 'web', source: 'collect',
    marca_user: body.marca_user || '',
    source_ip: clientIp, user_agent: userAgent
  }, env);
}

// Planilha de VENDAS — append de uma linha por compra aprovada (webhook do gateway).
// Opt-in: so dispara com o bloco `sheets.purchase` no SITE_CONFIG. A aba de destino
// vai no parametro de controle `_sheet`, entao a mesma implantacao do Apps Script
// atende quantas abas forem necessarias (leads numa, vendas noutra).
export async function sendSheetsPurchase(sheetsConfig, gateway, merged, env, siteId) {
  const idScript = cleanSecret(sheetsConfig?.id_script);
  if (!idScript) return;

  const purchase = sheetsConfig.purchase;
  if (!purchase || purchase.enabled === false) return;

  // Colunas da aba de transacoes (cabecalhos case-sensitive na linha 1).
  // `data` e `hora` sao preenchidas pelo proprio GAS — nao vao no payload.
  const fields = {
    plataforma:              purchase.platform_names?.[gateway] || gateway,
    evento:                  purchase.evento || 'compra_aprovada',
    comprador_nome:          merged.fullname || '',
    comprador_email:         merged.email || '',
    comprador_telefone:      merged.phone || '',
    transaction_id:          merged.order_id || '',
    produto_nome:            merged.product_name || '',
    produto_id:              merged.product_id || '',
    oferta_nome:             merged.offer_name || '',
    oferta_id:               merged.offer_id || '',
    pagamento_moeda:         merged.currency || '',
    pagamento_metodo:        merged.payment_method || '',
    pagamento_parcelas:      merged.installments,
    utm_source:              merged.utm_source || '',
    utm_medium:              merged.utm_medium || '',
    utm_campaign:            merged.utm_campaign || '',
    utm_term:                merged.utm_term || '',
    utm_content:             merged.utm_content || '',
    utm_id:                  merged.utm_id || '',
    // boolean cru -> rotulo legivel; `undefined` (gateway nao informa) fica vazio
    order_bump:              merged.order_bump === true ? 'SIM' : (merged.order_bump === false ? 'NAO' : ''),
    pagamento_valor_total:   merged.value,
    pagamento_valor_gateway: merged.value_gateway,
    pagamento_valor_nosso:   merged.value_net
  };

  await callGas(idScript, fields, { _sheet: purchase.sheet || '' }, {
    site_id: siteId, event_name: 'purchase', event_id: String(merged.order_id || ''),
    channel: 'webhook', source: gateway,
    marca_user: merged.marca_user || '',
    source_ip: merged.ip || '', user_agent: merged.user_agent || ''
  }, env);
}

// Monta a query string, chama o GAS e loga o resultado no D1.
// Campos vazios nao entram na query (em upsert, nao sobrescrevem o que ja esta na linha).
async function callGas(idScript, fields, control, logMeta, env) {
  const params = new URLSearchParams();
  for (const k in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, k) && fields[k] != null && fields[k] !== '') {
      params.set(k, String(fields[k]));
    }
  }
  for (const k in control) {
    if (Object.prototype.hasOwnProperty.call(control, k) && control[k]) {
      params.set(k, String(control[k]));
    }
  }

  const endpoint = `https://script.google.com/macros/s/${idScript}/exec?${params.toString()}`;
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  try {
    // GAS responde 302 -> script.googleusercontent.com; precisa seguir o redirect.
    const res = await fetch(endpoint, { method: 'GET', redirect: 'follow' });
    statusCode = res.status;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
    if (!res.ok) errorMsg = responseText.substring(0, 500);
  } catch (e) {
    statusCode = 0;
    errorMsg = String(e).substring(0, 500);
  }

  await logEvent(env.DB, {
    ...logMeta,
    platform: 'sheets',
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: endpoint,
    error_message: errorMsg, response_payload: responsePayload
  });
}

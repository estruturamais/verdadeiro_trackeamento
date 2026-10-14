import { logEvent } from '../shared/logger.js';
import { EVENT_NAMES } from '../shared/event-names.js';
import { cleanSecret } from '../shared/helpers.js';

// Campos de NIVEL DE REQUEST do Measurement Protocol, comuns a todo envio. Referencia:
// developers.google.com/analytics/devguides/collection/protocol/ga4/reference?client_type=gtag
//
// - ip_override / user_agent: sem eles, "o GA4 deriva geografia e dispositivo dos eventos de
//   tag pelo client_id". Os eventos do gtag passam pelo proxy /g/collect e chegavam ao
//   Google com o IP da Cloudflare — o visitante aparecia sem cidade (ou na do datacenter).
//   Com o IP e o UA do proprio visitante, o MP nao depende mais disso.
// - consent.ad_personalization: substituto oficial do `non_personalized_ads` (deprecado).
//   `GRANTED` e o mesmo que o `non_personalized_ads: false` de antes.
function mpRequestBase(clientId, ip, userAgent) {
  return {
    client_id: clientId,
    ...(ip ? { ip_override: ip } : {}),
    ...(userAgent ? { user_agent: userAgent } : {}),
    consent: { ad_personalization: 'GRANTED' }
  };
}

// client_id para a venda que chega SEM visita identificada (comprador que nunca passou
// pelo site, link de checkout antigo, venda feita pelo agente de vendas do gateway). O MP
// exige client_id; sem ele a venda nao entra no GA4 e a receita fica abaixo da do gateway.
// Deriva do PEDIDO, nunca de e-mail/telefone (hash de dado pessoal no GA4 fere a politica
// do Google), e e deterministico: o mesmo pedido cai sempre no mesmo "usuario". Mesmo
// formato do gtag (`<numero>.<numero>`).
async function syntheticClientId(siteId, orderId) {
  const data = new TextEncoder().encode(`vt-ga4|${siteId}|${orderId}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const a = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  const b = ((h[4] << 24) | (h[5] << 16) | (h[6] << 8) | h[7]) >>> 0;
  return `${a}.${b}`;
}

export async function sendGA4Event(ga4Config, eventName, eventId, body, clientIp, userAgent, env, siteId) {
  const apiSecret = cleanSecret(ga4Config?.api_secret || env.GA4_API_SECRET);
  if (!ga4Config?.measurement_id || !apiSecret) return;

  // Whitespace interno = credencial corrompida (o trim() nao salva). Na query string vira
  // um api_secret invalido que o GA4 rejeita em silencio — falhar explicito.
  if (/\s/.test(apiSecret)) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: eventName, event_id: eventId,
      platform: 'google_analytics_4', channel: 'web', source: 'collect',
      status_code: 0, request_ms: 0,
      sent_payload: '', error_message: 'invalid_api_secret_whitespace',
      response_payload: '',
      marca_user: body.marca_user || '',
      source_ip: clientIp, user_agent: userAgent
    });
    return;
  }

  const gaClientId = body.browser_data?.ga_client_id;
  if (!gaClientId) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: eventName, event_id: eventId,
      platform: 'google_analytics_4', channel: 'web', source: 'collect',
      status_code: 0, request_ms: 0,
      sent_payload: '', error_message: 'missing_ga_client_id',
      response_payload: '',
      marca_user: body.marca_user || '',
      source_ip: clientIp, user_agent: userAgent
    });
    return;
  }

  const ga4EventName = EVENT_NAMES[eventName]?.ga4 || eventName;

  const params = {
    engagement_time_msec: 100,
    page_location: body.page_url || '',
    page_title: body.page_title || ''
  };
  if (body.browser_data?.ga_session_id) params.session_id = String(body.browser_data.ga_session_id);
  if (body.browser_data?.ga_session_count) params.session_number = parseInt(body.browser_data.ga_session_count, 10);
  if (body.custom_data?.value) {
    params.value = parseFloat(body.custom_data.value) || 0;
    params.currency = body.custom_data.currency || 'BRL';
  }

  // SEM timestamp_micros: o beacon chega em tempo real, e o horario do recebimento e o
  // horario certo. Ate a 1.8.0 ia o `t` do cookie `_ga_*` + 60s — o ultimo hit do gtag,
  // nao o evento. Em producao (10/2026) isso datava a maioria dos page_view ~1 min no
  // FUTURO e o de visitante que voltava horas/dias no PASSADO (o GA4 trava em 72h):
  // fora do Tempo real e no dia errado.
  const payload = {
    ...mpRequestBase(gaClientId, clientIp, userAgent),
    events: [{ name: ga4EventName, params }]
  };

  const sentPayload = JSON.stringify(payload);
  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${ga4Config.measurement_id}&api_secret=${apiSecret}`;
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  let gotResponse = false;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: sentPayload
    });
    statusCode = res.status;
    gotResponse = true;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
  } catch (e) {
    // Preserva o status quando a resposta JA tinha chegado e a excecao veio de ler o corpo:
    // zerar faria a linha parecer "nunca saiu", quando o evento pode ter sido aceito.
    if (!gotResponse) statusCode = 0;
    errorMsg = (gotResponse
      ? `body_read_failed: ${String(e)}`
      : `fetch_failed: ${String(e)} | endpoint=www.google-analytics.com measurement_id=${ga4Config.measurement_id} — se for "Network connection lost", verifique o api_secret (whitespace) antes de suspeitar de rede`
    ).substring(0, 500);
  }

  await logEvent(env.DB, {
    site_id: siteId, event_name: ga4EventName, event_id: eventId,
    platform: 'google_analytics_4', channel: 'web', source: 'collect',
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload,
    error_message: errorMsg, response_payload: responsePayload,
    marca_user: body.marca_user || '',
    source_ip: clientIp, user_agent: userAgent
  });
}

export async function sendGA4MP(ga4Config, merged, env, siteId) {
  const apiSecret = cleanSecret(ga4Config?.api_secret || env.GA4_API_SECRET);
  if (!ga4Config?.measurement_id || !apiSecret) return;
  // O Measurement Protocol exige client_id. Sem ele (webhook sem marca_user, ou o visitante
  // nunca teve o _ga gravado no user_store) o purchase NAO sai — e ate a 1.8.0 isso era um
  // `return` mudo: nenhuma linha no D1, indistinguivel de "nao houve venda" (foi assim que
  // uma venda real sumiu do GA4 sem rastro, 10/2026). Agora vira linha explicita, igual ao
  // `missing_ga_client_id` do beacon, para a auditoria enxergar o buraco.
  //
  // Com `platforms.ga4.unattributed_purchases: true` (opt-in) a venda sai mesmo assim, com
  // client_id sintetico: entra na receita do GA4 sem atribuicao ("(not set)"). Sem a flag,
  // o comportamento e o de antes. Caso real (10/2026): com o emissor antigo desligado, venda
  // por link de checkout antigo e venda pelo agente de vendas da Kiwify sumiram do GA4.
  let clientId = merged.ga_client_id;
  const sintetico = !clientId && ga4Config.unattributed_purchases === true && !!merged.order_id;
  if (sintetico) clientId = await syntheticClientId(siteId, merged.order_id);
  if (!clientId) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: 'purchase', event_id: merged.event_id ? String(merged.event_id) : '',
      platform: 'google_analytics_4', channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
      status_code: 0, request_ms: 0,
      sent_payload: JSON.stringify({
        motivo: 'GA4 MP exige client_id; o comprador chegou sem ga_client_id no user_store',
        marca_user_presente: !!merged.marca_user
      }),
      error_message: 'missing_ga_client_id',
      response_payload: '',
      marca_user: merged.marca_user || '',
      source_ip: merged.ip || '', user_agent: merged.user_agent || ''
    });
    return;
  }

  // Ver o guard equivalente em sendGA4Event: whitespace interno = credencial corrompida.
  if (/\s/.test(apiSecret)) {
    await logEvent(env.DB, {
      site_id: siteId, event_name: 'purchase', event_id: '',
      platform: 'google_analytics_4', channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
      status_code: 0, request_ms: 0,
      sent_payload: '', error_message: 'invalid_api_secret_whitespace',
      response_payload: '',
      marca_user: merged.marca_user || '',
      source_ip: merged.ip || '', user_agent: merged.user_agent || ''
    });
    return;
  }

  // SEM timestamp_micros (ver sendGA4Event): o `ga_timestamp` do user_store e o
  // ultimo hit da VISITA, nao a hora da compra — a receita caia no dia da visita, e
  // num boleto pago dias depois, travada em 72h atras. A sessao vai pelo session_id.
  // ip_override/user_agent: do navegador do comprador (user_store) ou, sem visita, o IP que o
  // gateway reporta do dispositivo (na Kiwify, conferido igual ao do navegador em 10/2026).
  const payload = {
    ...mpRequestBase(clientId, merged.ip, merged.user_agent),
    events: [{
      name: 'purchase',
      params: {
        ...(merged.ga_session_id ? { session_id: String(merged.ga_session_id) } : {}),
        ...(merged.ga_session_count ? { session_number: parseInt(merged.ga_session_count, 10) } : {}),
        // Venda sem visita nao leva engagement_time_msec: nao inventa um "usuario ativo"
        // que nunca esteve no site (entra na receita, nao no Tempo real).
        ...(sintetico ? {} : { engagement_time_msec: 100 }),
        page_location: merged.page_url || '',
        transaction_id: String(merged.order_id || ''),
        value: parseFloat(merged.value) || 0,
        currency: merged.currency || 'BRL',
        items: [{
          item_id: String(merged.product_id || ''),
          item_name: merged.product_name || '',
          price: parseFloat(merged.value) || 0,
          quantity: 1
        }]
      }
    }]
  };

  const sentPayload = JSON.stringify(payload);
  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${ga4Config.measurement_id}&api_secret=${apiSecret}`;
  const start = Date.now();
  let statusCode = 0;
  let errorMsg = '';
  let responsePayload = '';
  let gotResponse = false;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: sentPayload
    });
    statusCode = res.status;
    gotResponse = true;
    const responseText = await res.text();
    responsePayload = responseText.substring(0, 1000);
  } catch (e) {
    // Resposta ja chegada + excecao ao ler o corpo != "nunca saiu" (o evento pode ter sido aceito).
    if (!gotResponse) statusCode = 0;
    errorMsg = (gotResponse
      ? `body_read_failed: ${String(e)}`
      : `fetch_failed: ${String(e)} | endpoint=www.google-analytics.com measurement_id=${ga4Config.measurement_id} — se for "Network connection lost", verifique o api_secret (whitespace) antes de suspeitar de rede`
    ).substring(0, 500);
  }

  await logEvent(env.DB, {
    site_id: siteId, event_name: 'purchase', event_id: merged.event_id ? String(merged.event_id) : '',
    platform: 'google_analytics_4', channel: 'webhook', source: `${merged.gateway || 'unknown'}`,
    status_code: statusCode, request_ms: Date.now() - start,
    sent_payload: sentPayload,
    // Aviso (nao erro) quando o client_id e sintetico: a venda entrou, sem atribuicao.
    error_message: errorMsg || (sintetico ? 'aviso_client_id_sintetico: venda sem visita identificada' : ''),
    response_payload: responsePayload,
    marca_user: merged.marca_user || '',
    source_ip: merged.ip || '', user_agent: merged.user_agent || ''
  });
}

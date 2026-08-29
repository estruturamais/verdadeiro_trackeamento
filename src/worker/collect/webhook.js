import { getConfigForWebhook } from '../shared/config.js';
import { hashPII } from '../shared/hash.js';
import { getNestedValue } from '../shared/helpers.js';
import { splitFirstName, splitLastName } from '../shared/helpers.js';
import { getUserStore, getUserStoreByEmail } from '../store/user-store.js';
import { fdvMerge } from '../store/fdv.js';
import { GATEWAY_PARSERS, APPROVAL_EVENTS, CANCEL_EVENTS } from '../gateways/index.js';
import { sendMetaCAPIWebhook } from '../platforms/meta.js';
import { sendTikTokWebhook } from '../platforms/tiktok.js';
import { sendGA4MP } from '../platforms/ga4.js';
import { sendGoogleAdsWebhook } from '../platforms/google-ads.js';
import { sendSheetsPurchase } from '../platforms/sheets.js';
import { runCleanup } from '../shared/cleanup.js';
import { logEvent } from '../shared/logger.js';
import { dbWrite } from '../shared/db-write.js';
import {
  subscriptionConfig,
  resolveProductMode,
  resolveSubscriptionBilling,
  recordSubscriptionCharge,
  markSubscriptionCanceled
} from '../shared/subscription.js';

// Nome do evento Meta por tipo de cobranca (SaaS). Defaults: aquisicao = o evento
// padrao `Subscribe`; renovacao/reativacao = eventos CUSTOM (otimizaveis por Conversao
// Personalizada). Overridavel por SITE_CONFIG.subscription_events
// ({ new, renewal, reactivation }) — caso classico: campanhas que ja otimizam pelo
// evento `Purchase` mapeiam new -> ["Purchase","Subscribe"] para nao perder o
// aprendizado, e o Purchase fica LIMPO (so aquisicao; renovacao nunca entra nele).
// Nomes distintos tambem blindam a dedup da Meta (chave = event_id + event_name).
const SUBSCRIPTION_META_EVENTS = {
  new: 'Subscribe',
  renewal: 'SubscriptionRenewal',
  reactivation: 'SubscriptionReactivation'
};

// Aceita string OU array no config (ex.: new: ["Purchase", "Subscribe"] — a Meta
// NAO deduplica nomes diferentes com o mesmo event_id, entao os dois chegam:
// Purchase alimenta as campanhas atuais; Subscribe fica disponivel para teste).
function subscriptionEventNames(config, billingType) {
  const custom = config.subscription_events || {};
  const value = custom[billingType] || SUBSCRIPTION_META_EVENTS[billingType] || 'Subscribe';
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

export async function handleWebhook(request, env, gateway, ctx) {
  // Cleanup proativo: roda em background em todo webhook (DELETE indexado, custo ~0 quando nada a deletar)
  ctx.waitUntil(runCleanup(env.DB, env).catch(() => {}));
  const body = await request.json();
  const config = await getConfigForWebhook(env, gateway);
  const subCfg = subscriptionConfig(config);

  // 1. Gravar webhook bruto — input log: TODO payload recebido e' gravado,
  // mesmo duplicado. Dedup de dispatch e' feito mais abaixo via SELECT.
  // dbWrite: se DB cheio, roda cleanup sincrono e tenta de novo antes de desistir.
  // Capturamos o id da linha inserida pra escopar as UPDATEs subsequentes
  // a esta request especifica (com duplicatas, multiplas linhas tem mesmo order_id).
  const insertResult = await dbWrite(
    env.DB,
    () => env.DB.prepare(
      'INSERT INTO webhook_raw (site_id, gateway, order_id, payload) VALUES (?, ?, ?, ?)'
    ).bind(config.site_id || '', gateway, null, JSON.stringify(body).substring(0, 8192)).run(),
    'webhook.insert_raw',
    env
  );
  const rawId = insertResult?.meta?.last_row_id ?? null;

  // 1b. Cancelamento de assinatura (SaaS, opt-in): NAO e venda e nao vai a plataforma
  // nenhuma — registra o status na tabela `subscriptions`, que e o insumo da
  // REATIVACAO futura. Sem processar isto, quem cancelou e voltou seria classificado
  // como renovacao e o win-back ficaria invisivel. Encerra com 200.
  const cancel = CANCEL_EVENTS[gateway];
  if (cancel && subCfg.enabled) {
    const cancelValue = cancel.field ? getNestedValue(body, cancel.field) : '';
    if (cancelValue === cancel.value) {
      const subId = String(getNestedValue(body, cancel.subscription_id_path) || '');
      const subEmail = String(getNestedValue(body, cancel.email_path) || '');
      if (subId) {
        await markSubscriptionCanceled(env.DB, env, config.site_id || '', gateway, subId, subEmail)
          .catch((e) => console.error('[webhook] markSubscriptionCanceled failed:', e.message));
      }
      return new Response(
        JSON.stringify({ status: 'subscription_cancel_recorded', subscription_id: subId }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // 2. Validar evento de aprovacao — { field, value } (igualdade) ou funcao
  // (body) => { approved, reason } para gateways com regra composta.
  const approval = APPROVAL_EVENTS[gateway];
  if (approval) {
    let approved = true;
    let reason = 'not_purchase_approved';
    if (typeof approval === 'function') {
      try {
        const verdict = approval(body) || {};
        approved = !!verdict.approved;
        if (verdict.reason) reason = verdict.reason;
      } catch (e) {
        // Regra de aprovacao quebrada nao pode virar Purchase as cegas.
        console.error(`[webhook] approval fn failed for ${gateway}:`, e.message);
        approved = false;
        reason = 'approval_check_failed';
      }
    } else {
      const eventValue = approval.field ? getNestedValue(body, approval.field) : '';
      approved = eventValue === approval.value;
    }
    if (!approved) {
      return new Response(
        JSON.stringify({ status: 'ignored', reason }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // 3. Parsear dados do webhook
  const parser = GATEWAY_PARSERS[gateway];
  if (!parser) {
    return new Response(
      JSON.stringify({ error: 'unknown_gateway' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const webhookData = parser(body);

  // 3b. Deduplicacao: verificar se a transacao (compra) ja foi processada
  // Construimos um ID unico que junta order_id e product_id para nao bloquear Order Bumps (que costumam ter o mesmo order_id)
  let txnId = webhookData.order_id ? String(webhookData.order_id) : null;
  if (txnId && webhookData.product_id) {
    txnId = `${txnId}_${webhookData.product_id}`;
  }

  if (txnId) {
    // SEMPRE atualizar o registro recem-inserido com o txnId, mesmo que seja
    // duplicata. webhook_raw e' input log: a auditoria precisa do txnId em
    // cada linha pra cruzar com events e identificar duplicatas via COUNT.
    if (rawId) {
      // Enriquecimento da venda na MESMA linha (chave id=rawId): order_id + marca_user,
      // value e UTM last-click (cru). Best-effort por cima do raw ja gravado.
      await dbWrite(
        env.DB,
        () => env.DB.prepare(
          'UPDATE webhook_raw SET order_id = ?, marca_user = ?, value = ?, ' +
          'utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_term = ?, utm_content = ? ' +
          'WHERE id = ?'
        ).bind(
          txnId,
          webhookData.marca_user || '',
          webhookData.value || '',
          webhookData.utm_source || '',
          webhookData.utm_medium || '',
          webhookData.utm_campaign || '',
          webhookData.utm_term || '',
          webhookData.utm_content || '',
          rawId
        ).run(),
        'webhook.update_order_id',
        env
      );
    }

    // Dedup de DISPATCH: existe outra linha com este txnId ja processada (processed=1)?
    // Se sim, ja foi enviada pra plataformas em request anterior — skip dispatch.
    // Filtra por id != rawId pra nao falsear positivo se algum dia a propria
    // linha vier com processed=1 (caso patologico — defensivo).
    // SELECT protegido: se lancar, assume nao-duplicata (preferivel a retornar 500).
    let alreadyDispatched = null;
    try {
      alreadyDispatched = await env.DB.prepare(
        'SELECT id FROM webhook_raw WHERE site_id = ? AND gateway = ? AND order_id = ? AND processed = 1 AND id != ? LIMIT 1'
      ).bind(config.site_id || '', gateway, txnId, rawId ?? -1).first();
    } catch (e) {
      console.error('[webhook] dedup SELECT failed, assuming not dispatched:', e.message);
    }

    if (alreadyDispatched) {
      return new Response(
        JSON.stringify({ status: 'duplicate', txn_id: txnId, skipped: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // 4. Consultar user_store (apenas se marca_user presente — comprador organico nao tem xcod/sck)
  let storeResult = webhookData.marca_user
    ? await getUserStore(env.DB, webhookData.marca_user).catch(() => null)
    : null;

  // 4b. FDV merge por EMAIL — fallback quando o webhook nao traz marca_user. Se o
  // beacon ja vinculou email <-> marca_user/fbp/fbc/ga/gclid no user_store (pelo
  // `lead` ou pelo `identify`), recupera pela linha mais recente do mesmo email.
  // Vale para TODO projeto, nao so os de assinatura: so roda quando o evento sairia,
  // de outro modo, sem identidade nenhuma.
  if (!storeResult && webhookData.email) {
    storeResult = await getUserStoreByEmail(env.DB, webhookData.email).catch(() => null);
  }

  // 5. Merge fdv
  const merged = fdvMerge(storeResult, webhookData);
  // O gateway nao vem do fdvMerge — sem esta linha, `merged.gateway` fica undefined e
  // TODO dispatch de webhook grava events.source = 'unknown' (meta/tiktok/ga4/gads).
  merged.gateway = gateway;
  // event_id para as plataformas = txnId (order_id + product_id), a MESMA chave do
  // dedup interno: order bump chega como webhook proprio com o mesmo order_id e
  // product_id diferente — com event_id = order_id cru, a dedup da Meta
  // (event_id + event_name, 48h) descartaria o bump. E com o subscription_id no
  // lugar do order_id, descartaria toda renovacao.
  if (txnId) merged.event_id = txnId;

  // 5b. SaaS: classifica a cobranca ANTES do dispatch — decide o nome do evento no
  // Meta e a acao de conversao no Google Ads. O payload decide (contador do gateway);
  // a tabela `subscriptions` confirma e cobre o legado (cliente que ja era assinante
  // antes de o tracking existir).
  //
  // PROJETO MISTO: `resolveProductMode` decide, produto a produto, se esta cobranca
  // entra no fluxo de assinatura ou segue como Purchase padrao.
  let billing = null;
  if (subCfg.enabled) {
    const modo = resolveProductMode(subCfg, webhookData);
    if (modo.aviso) {
      // Decisao de config nunca pode ficar implicita: vira linha consultavel no D1.
      await logEvent(env.DB, {
        site_id: config.site_id || '', event_name: 'subscription_gate', event_id: txnId || '',
        platform: 'subscription', channel: 'webhook', source: gateway,
        status_code: 0, request_ms: 0,
        sent_payload: JSON.stringify({
          product_id: webhookData.product_id || '', motivo: modo.motivo, saas: modo.saas
        }),
        error_message: modo.aviso, response_payload: '',
        marca_user: merged.marca_user || '', source_ip: merged.ip || '', user_agent: merged.user_agent || ''
      }).catch(() => {});
    }
    if (modo.saas && webhookData.subscription_id) {
      billing = await resolveSubscriptionBilling(env.DB, config.site_id || '', gateway, webhookData)
        .catch((e) => {
          console.error('[webhook] resolveSubscriptionBilling failed:', e.message);
          return null;
        });
    }
  }
  if (billing) {
    merged.billing_type = billing.billing_type;
    merged.subscription_id = String(webhookData.subscription_id || '');
  }

  // 6. Hash PII
  const hashed = await hashPII({
    email: merged.email,
    phone: merged.phone,
    first_name: splitFirstName(merged.fullname),
    last_name: splitLastName(merged.fullname),
    city: merged.city,
    state: merged.state,
    country: merged.country,
    zip: merged.zip,
    external_id: merged.marca_user
  });

  // 7. Dispatch para APIs (em paralelo)
  //
  // MODO SHADOW (purchase_dispatch: 'shadow' no SITE_CONFIG): o pipeline roda
  // INTEIRO (parse, dedup, billing_type, tabela subscriptions) e cada envio que
  // ACONTECERIA vira uma linha no `events` (status_code 0, error 'shadow_mode') —
  // mas NADA e enviado as plataformas. Uso: validar a estrutura com webhooks reais
  // de producao enquanto pixels hardcoded de checkout/site ainda nao foram
  // removidos. Ligar de verdade = remover a chave do config.
  const promises = [];
  const shadow = config.purchase_dispatch === 'shadow';
  const shadowLog = (platform, eventName, target) => logEvent(env.DB, {
    site_id: config.site_id || '', event_name: eventName,
    event_id: merged.event_id ? String(merged.event_id) : '',
    platform, channel: 'webhook', source: gateway,
    status_code: 0, request_ms: 0,
    sent_payload: JSON.stringify({
      shadow: true, target: target || '',
      billing_type: merged.billing_type || '', subscription_id: merged.subscription_id || '',
      value: merged.value || '', currency: merged.currency || 'BRL',
      email_present: !!merged.email, gclid_present: !!merged.gclid
    }),
    error_message: 'shadow_mode: dispatch pausado (validacao em producao) — nada foi enviado',
    response_payload: '',
    marca_user: merged.marca_user || '', source_ip: merged.ip || '', user_agent: merged.user_agent || ''
  }).catch(() => {});

  // Meta CAPI — todos os pixels (primario + espelhos). Sem assinatura: Purchase.
  // Com assinatura: nomes por billing_type (string ou ARRAY — multi-evento).
  const metaEventNames = billing
    ? subscriptionEventNames(config, billing.billing_type)
    : ['Purchase'];
  if (config.platforms?.meta?.pixel_id) {
    const metaConfig = config.platforms.meta;
    const accessToken = metaConfig.access_token || env.META_ACCESS_TOKEN;
    const mirrors = metaConfig.pixel_ids_mirror
      ?? (metaConfig.pixel_id_purchase ? [metaConfig.pixel_id_purchase] : []);
    for (const pixelId of [metaConfig.pixel_id, ...mirrors]) {
      for (const evName of metaEventNames) {
        promises.push(shadow
          ? shadowLog('meta_ads', evName, `pixel:${pixelId}`)
          : sendMetaCAPIWebhook(pixelId, accessToken, evName, hashed, merged, env, config.site_id));
      }
    }
  }

  // TikTok Events API (Purchase)
  if (config.platforms?.tiktok?.pixel_id) {
    promises.push(shadow
      ? shadowLog('tiktok_ads', 'Purchase', '')
      : sendTikTokWebhook(config.platforms.tiktok, 'Purchase', hashed, merged, env, config.site_id));
  }

  // GA4 Measurement Protocol (purchase)
  if (config.platforms?.ga4?.measurement_id) {
    promises.push(shadow
      ? shadowLog('google_analytics_4', 'purchase', '')
      : sendGA4MP(config.platforms.ga4, merged, env, config.site_id));
  }

  // Google Ads — conversao offline (purchase) pela Data Manager API.
  // O gate NAO exige `conversion_label_purchase`: a acao de conversao de IMPORTACAO
  // (UPLOAD_CLICKS) — que e justamente o caminho do purchase server-side — nao tem
  // `tag_snippets`, logo NAO tem rotulo. Gatear por rotulo fazia toda venda morrer
  // aqui, antes de qualquer log, e a falha ficava indistinguivel de "nao houve venda".
  // Basta existir o bloco `google_ads`: o que faltar vira erro ACIONAVEL no D1.
  // Independe de `channel` — o canal server cobre o purchase; o web cobre o navegador.
  if (config.platforms?.google_ads) {
    if (shadow) {
      const gads = config.platforms.google_ads;
      const isRec = merged.billing_type === 'renewal' || merged.billing_type === 'reactivation';
      promises.push(shadowLog(
        'google_ads',
        isRec ? `subscription_${merged.billing_type}` : 'purchase',
        `action:${isRec ? (gads.conversion_action_id_renewal || '?') : (gads.conversion_action_id_purchase || '?')}`
      ));
    } else {
      promises.push(
        sendGoogleAdsWebhook(config.platforms.google_ads, hashed, merged, env, config.site_id)
      );
    }
  }

  // Google Sheets — planilha de vendas (append de 1 linha por compra aprovada).
  // Opt-in via `sheets.purchase` no SITE_CONFIG; a aba vai no parametro `_sheet`.
  // Ja e pos-dedup por construcao: reenvio do gateway nao duplica linha; order bump
  // com mesmo order_id e product_id diferente entra como linha propria.
  if (config.platforms?.sheets?.id_script && !shadow) {
    promises.push(
      sendSheetsPurchase(config.platforms.sheets, gateway, merged, env, config.site_id)
    );
  }

  await Promise.allSettled(promises);

  // 7b. Registrar a cobranca na tabela subscriptions (pos-dispatch): e' esta linha
  // que faz a PROXIMA cobranca desta assinatura ser classificada como renovacao.
  if (billing) {
    await recordSubscriptionCharge(env.DB, env, config.site_id || '', gateway, webhookData)
      .catch((e) => console.error('[webhook] recordSubscriptionCharge failed:', e.message));
  }

  // Marcar SOMENTE esta linha como processada (WHERE id = rawId).
  // Com duplicatas permitidas, multiplas linhas tem o mesmo order_id —
  // marcar por order_id mancharia tambem as duplicatas que NAO disparamos.
  if (rawId) {
    await dbWrite(
      env.DB,
      () => env.DB.prepare(
        'UPDATE webhook_raw SET processed = 1 WHERE id = ?'
      ).bind(rawId).run(),
      'webhook.update_processed',
      env
    );
  }

  const resp = { status: 'processed' };
  if (billing) resp.billing_type = billing.billing_type;
  if (shadow) resp.shadow = true;
  return new Response(
    JSON.stringify(resp),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

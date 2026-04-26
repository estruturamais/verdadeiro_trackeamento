import { getConfigForWebhook } from '../shared/config.js';
import { hashPII } from '../shared/hash.js';
import { getNestedValue } from '../shared/helpers.js';
import { splitFirstName, splitLastName } from '../shared/helpers.js';
import { getUserStore } from '../store/user-store.js';
import { fdvMerge } from '../store/fdv.js';
import { GATEWAY_PARSERS, APPROVAL_EVENTS } from '../gateways/index.js';
import { sendMetaCAPIWebhook } from '../platforms/meta.js';
import { sendTikTokWebhook } from '../platforms/tiktok.js';
import { sendGA4MP } from '../platforms/ga4.js';
import { sendGoogleAdsWebhook } from '../platforms/google-ads.js';
import { runCleanup } from '../shared/cleanup.js';
import { dbWrite } from '../shared/db-write.js';

export async function handleWebhook(request, env, gateway, ctx) {
  // Cleanup proativo: roda em background em todo webhook (DELETE indexado, custo ~0 quando nada a deletar)
  ctx.waitUntil(runCleanup(env.DB).catch(() => {}));
  const body = await request.json();
  const config = await getConfigForWebhook(env, gateway);

  // 1. Gravar webhook bruto (INSERT OR IGNORE para deduplicacao atomica)
  // dbWrite: se DB cheio, roda cleanup sincrono e tenta de novo antes de desistir
  await dbWrite(
    env.DB,
    () => env.DB.prepare(
      'INSERT OR IGNORE INTO webhook_raw (site_id, gateway, order_id, payload) VALUES (?, ?, ?, ?)'
    ).bind(config.site_id || '', gateway, null, JSON.stringify(body).substring(0, 8192)).run(),
    'webhook.insert_raw'
  );

  // 2. Validar evento de aprovacao
  const approval = APPROVAL_EVENTS[gateway];
  if (approval) {
    const eventValue = approval.field ? getNestedValue(body, approval.field) : '';
    if (eventValue !== approval.value) {
      return new Response(
        JSON.stringify({ status: 'ignored', reason: 'not_purchase_approved' }),
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
    // SELECT de dedup protegido: se lancar, assumir que nao e' duplicata e seguir
    // (preferivel a retornar 500 e disparar retry do gateway)
    let duplicate = null;
    try {
      duplicate = await env.DB.prepare(
        'SELECT id FROM webhook_raw WHERE site_id = ? AND gateway = ? AND order_id = ?'
      ).bind(config.site_id || '', gateway, txnId).first();
    } catch (e) {
      console.error('[webhook] dedup SELECT failed, assuming no duplicate:', e.message);
    }

    if (duplicate) {
      return new Response(
        JSON.stringify({ status: 'duplicate', txn_id: txnId, skipped: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Atualizar o registro ja gravado com o txnId agora que temos o valor
    await dbWrite(
      env.DB,
      () => env.DB.prepare(
        'UPDATE webhook_raw SET order_id = ? WHERE site_id = ? AND gateway = ? AND order_id IS NULL ORDER BY id DESC LIMIT 1'
      ).bind(txnId, config.site_id || '', gateway).run(),
      'webhook.update_order_id'
    );
  }

  // 4. Consultar user_store (apenas se marca_user presente — comprador organico nao tem xcod/sck)
  const storeResult = webhookData.marca_user
    ? await getUserStore(env.DB, webhookData.marca_user).catch(() => null)
    : null;

  // 5. Merge fdv
  const merged = fdvMerge(storeResult, webhookData);

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
  const promises = [];

  // Meta CAPI — todos os pixels (primário + espelhos), Purchase
  if (config.platforms?.meta?.pixel_id) {
    const metaConfig = config.platforms.meta;
    const accessToken = metaConfig.access_token || env.META_ACCESS_TOKEN;
    const mirrors = metaConfig.pixel_ids_mirror
      ?? (metaConfig.pixel_id_purchase ? [metaConfig.pixel_id_purchase] : []);
    for (const pixelId of [metaConfig.pixel_id, ...mirrors]) {
      promises.push(
        sendMetaCAPIWebhook(pixelId, accessToken, 'Purchase', hashed, merged, env, config.site_id)
      );
    }
  }

  // TikTok Events API (Purchase)
  if (config.platforms?.tiktok?.pixel_id) {
    promises.push(
      sendTikTokWebhook(config.platforms.tiktok, 'Purchase', hashed, merged, env, config.site_id)
    );
  }

  // GA4 Measurement Protocol (purchase)
  if (config.platforms?.ga4?.measurement_id) {
    promises.push(
      sendGA4MP(config.platforms.ga4, merged, env, config.site_id)
    );
  }

  // Google Ads Enhanced Conversions (purchase)
  if (config.platforms?.google_ads?.conversion_label_purchase) {
    promises.push(
      sendGoogleAdsWebhook(config.platforms.google_ads, hashed, merged, env, config.site_id)
    );
  }

  await Promise.allSettled(promises);

  // Marcar webhook como processado (apenas quando ha txnId para identificar o registro)
  if (txnId) {
    await dbWrite(
      env.DB,
      () => env.DB.prepare(
        'UPDATE webhook_raw SET processed = 1 WHERE site_id = ? AND gateway = ? AND order_id = ?'
      ).bind(config.site_id || '', gateway, txnId).run(),
      'webhook.update_processed'
    );
  }

  return new Response(
    JSON.stringify({ status: 'processed' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

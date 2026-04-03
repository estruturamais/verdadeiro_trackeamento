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

export async function handleWebhook(request, env, gateway) {
  const body = await request.json();
  const config = await getConfigForWebhook(env, gateway);

  // 1. Gravar webhook bruto (INSERT OR IGNORE para deduplicacao atomica)
  await env.DB.prepare(
    'INSERT OR IGNORE INTO webhook_raw (site_id, gateway, order_id, payload) VALUES (?, ?, ?, ?)'
  ).bind(config.site_id || '', gateway, null, JSON.stringify(body)).run();

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

  // 3b. Deduplicacao: verificar se order_id ja foi processado
  if (webhookData.order_id) {
    const duplicate = await env.DB.prepare(
      'SELECT id FROM webhook_raw WHERE site_id = ? AND gateway = ? AND order_id = ?'
    ).bind(config.site_id || '', gateway, String(webhookData.order_id)).first();

    if (duplicate) {
      return new Response(
        JSON.stringify({ status: 'duplicate', order_id: webhookData.order_id, skipped: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Atualizar o registro ja gravado com o order_id agora que temos o valor
    await env.DB.prepare(
      'UPDATE webhook_raw SET order_id = ? WHERE site_id = ? AND gateway = ? AND order_id IS NULL ORDER BY id DESC LIMIT 1'
    ).bind(String(webhookData.order_id), config.site_id || '', gateway).run();
  }

  // 4. Consultar user_store (apenas se marca_user presente — comprador organico nao tem xcod/sck)
  const storeResult = webhookData.marca_user
    ? await getUserStore(env.DB, webhookData.marca_user)
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

  // Meta CAPI — pixel padrao (Purchase)
  if (config.platforms?.meta?.pixel_id) {
    promises.push(
      sendMetaCAPIWebhook(config.platforms.meta, 'Purchase', hashed, merged, 'standard', env, config.site_id)
    );
  }

  // Meta CAPI — pixel de vendas (Purchase + PageView)
  if (config.platforms?.meta?.pixel_id_purchase) {
    promises.push(
      sendMetaCAPIWebhook(config.platforms.meta, 'Purchase', hashed, merged, 'purchase', env, config.site_id)
    );
    promises.push(
      sendMetaCAPIWebhook(config.platforms.meta, 'PageView', hashed, merged, 'purchase', env, config.site_id)
    );
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

  // Marcar webhook como processado (apenas quando ha order_id para identificar o registro)
  if (webhookData.order_id) {
    await env.DB.prepare(
      'UPDATE webhook_raw SET processed = 1 WHERE site_id = ? AND gateway = ? AND order_id = ?'
    ).bind(config.site_id || '', gateway, String(webhookData.order_id)).run();
  }

  return new Response(
    JSON.stringify({ status: 'processed' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

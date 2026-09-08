// Proxy de primeiro dominio do Meta Pixel (FBPX).
//
// Por que existe: connect.facebook.net (fbevents.js, config do pixel, plugins) e
// www.facebook.com/tr (o beacon) estao em toda lista de bloqueio. O VT ja sobrevive
// pelo lado servidor (CAPI com o mesmo event_id), mas o visitante bloqueado ficava sem
// evento de navegador E sem o cookie _fbp (que so o fbevents.js cria e que a CAPI
// reaproveita) — e a URL da Meta aparecia no inspecionar de todo site com VT. Aqui o
// Worker serve os scripts pelo proprio dominio e reescreve, dentro deles, as URLs que a
// Meta embute — o mesmo padrao do ga4-proxy.js, com o que o fbevents.js exige a mais.
//
// O que o fbevents.js real (v2.9.393) embute e que este modulo trata:
//   - CDN_BASE_URL = "https://connect.facebook.net/": base de signals/config/{id},
//     signals/plugins/{nome}.js, /log/error e da telemetria. E TAMBEM o prefixo que o
//     guard interno "Disallowed script URL" exige nas URLs de plugin — reescrever esse
//     literal para {origem}/fb/ e o que faz o guard passar. Sem reescrever, o pixel quebra.
//   - "https://www.facebook.com/tr" e ".../tr/": endpoint do beacon (Image GET ou
//     navigator.sendBeacon POST multipart) e a lista de endpoints validos. So e
//     reescrito no modo `full`.
//   - www.instagram.com/tr e www.facebook.com/privacy_sandbox/topics ficam como estao:
//     dependem de cookie/API do proprio navegador; proxiar nao ganha nada.
//
// Nomes de caminho sao neutros de proposito: a EasyPrivacy tem regra GENERICA
// `/fbevents.js` (sem ancora de dominio). /fb/sdk.js, /fb/tr e /fb/signals/... foram
// conferidos contra EasyList, EasyPrivacy, uBlock e AdGuard.
import { getConfig, detectSiteId } from '../shared/config.js';

const META_CDN = 'https://connect.facebook.net/';
const META_TR = 'https://www.facebook.com/tr';
const PROXY_PREFIX = '/fb';
const SCRIPT_CACHE_TTL = 1200; // segundos — espelha o Cache-Control do proprio connect.facebook.net
const FORWARD_HEADERS = ['User-Agent', 'Accept', 'Accept-Language', 'Content-Type', 'Referer'];

// Le `platforms.meta.pixel_proxy` do SITE_CONFIG. Ausente/false = desligado (instalacao
// antiga nao muda nada). true ou "full" = script + config + plugins + /tr pelo dominio
// proprio. "script" = so os scripts; o /tr segue direto ao facebook.com (mantem cookie de
// login e IP real no evento de navegador do visitante sem bloqueador).
export function resolvePixelProxyMode(config) {
  const meta = config && config.platforms ? config.platforms.meta : undefined;
  const v = meta ? meta.pixel_proxy : undefined;
  if (v === true || v === 'full') return 'full';
  if (v === 'script') return 'script';
  return null;
}

// Origem de onde ESTE request foi servido (https://{host}). E o host onde o Worker
// comprovadamente roda — raiz ou track.{dominio} — por isso o web.js recebe a base
// ABSOLUTA, nunca um caminho relativo (que iria para o host da pagina).
export function getWorkerOrigin(request) {
  return new URL(request.url).origin;
}

// Reescrita dos literais que a Meta embute nos scripts. `base` = {origem}/fb.
export function rewriteMetaScript(body, base, mode) {
  let out = body.split(META_CDN).join(base + '/');
  if (mode === 'full') out = out.split(META_TR).join(base + '/tr');
  return out;
}

// Caminho no proxy -> caminho em connect.facebook.net. null = fora da allowlist.
function resolveUpstreamPath(rest) {
  if (rest === '/sdk.js') return 'en_US/fbevents.js';
  const m = rest.match(/^\/signals\/(config\/\d+|plugins\/[A-Za-z0-9_-]+\.js)$/);
  return m ? 'signals/' + m[1] : null;
}

// Caminho apos /fb, com barras iniciais colapsadas: o fbevents.js monta
// CDN_BASE_URL + "/log/error" (barra dupla) e isso precisa cair no mesmo lugar.
function restPath(url) {
  return url.pathname.slice(PROXY_PREFIX.length).replace(/^\/+/, '/');
}

// GET /fb/sdk.js | /fb/signals/config/{id} | /fb/signals/plugins/{nome}.js
export async function handleMetaScriptProxy(request, env) {
  const url = new URL(request.url);
  const upstreamPath = resolveUpstreamPath(restPath(url));
  if (!upstreamPath) return new Response('Not Found', { status: 404 });

  const upstream = await fetch(META_CDN + upstreamPath + url.search, {
    headers: { 'User-Agent': request.headers.get('User-Agent') || '' },
    cf: { cacheTtl: SCRIPT_CACHE_TTL, cacheEverything: true }
  });
  if (!upstream.ok) {
    // Sem cache: o web.js cai no fallback (connect.facebook.net direto) e avisa no console.
    return new Response('upstream_error', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  const config = await getConfig(detectSiteId(request, env), env);
  const mode = resolvePixelProxyMode(config) || 'full';
  const body = rewriteMetaScript(await upstream.text(), getWorkerOrigin(request) + PROXY_PREFIX, mode);

  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=' + SCRIPT_CACHE_TTL,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

// GET|POST /fb/tr[/] -> https://www.facebook.com/tr[/]
export async function handleMetaTrProxy(request, env) {
  const url = new URL(request.url);
  // Query CRUA: cd[...]/ud[...] chegam a Meta exatamente como o fbevents.js montou.
  const target = META_TR + (url.pathname.endsWith('/') ? '/' : '') + url.search;

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  const origin = request.headers.get('Origin');
  if (!headers.has('Referer') && origin) headers.set('Referer', origin + '/');
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers.set('X-Forwarded-For', ip);
  // Cookie/Authorization NUNCA seguem: o marca_user (e qualquer cookie do site) nao vai para a Meta.

  const init = { method: request.method, headers };
  if (request.method === 'POST') init.body = request.body; // stream — boundary do multipart intacto
  const upstream = await fetch(target, init);

  const out = new Headers();
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) out.set('Content-Type', contentType);
  out.set('Cache-Control', 'no-store');
  if (origin) {
    out.set('Access-Control-Allow-Origin', origin);
    out.set('Access-Control-Allow-Credentials', 'true');
  } else {
    out.set('Access-Control-Allow-Origin', '*');
  }
  // Set-Cookie do upstream nao passa: nada da Meta vira cookie no dominio do cliente.
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

// Entrada unica do router para /fb/*.
export async function handleMetaProxy(request, env) {
  const rest = restPath(new URL(request.url));
  const method = request.method;
  if (rest === '/tr' || rest === '/tr/') {
    if (method !== 'GET' && method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    return handleMetaTrProxy(request, env);
  }
  // Telemetria do proprio fbevents.js (log/fbevents_telemetry, log/error): descartada
  // aqui mesmo — nao e tracking e nao custa um subrequest.
  if (rest.startsWith('/log/')) return new Response(null, { status: 204 });
  if (method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  return handleMetaScriptProxy(request, env);
}

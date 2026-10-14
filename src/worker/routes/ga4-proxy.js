export async function handleServeGA4Script(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const upstream = await fetch(
    `https://www.googletagmanager.com/gtag/js?id=${id}&l=dataLayer`,
    { headers: { 'User-Agent': request.headers.get('User-Agent') || '' } }
  );
  const body = await upstream.text();
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function handleGA4CollectProxy(request, env) {
  const url = new URL(request.url);
  const targetUrl = new URL('https://www.google-analytics.com/g/collect');
  url.searchParams.forEach((value, key) => targetUrl.searchParams.set(key, value));

  // IP do VISITANTE. Sem ele o Google geolocaliza o IP de saida da Cloudflare (quem faz
  // este fetch): usuario no Tempo real sem cidade, ou na cidade do datacenter. `_uip` e o
  // parametro com que o GTM server-side do proprio Google repassa o IP ao /g/collect; o
  // X-Forwarded-For segue o snippet oficial do Google tag gateway para Cloudflare. Sempre
  // sobrescreve: o gtag nunca manda `_uip`, e um valor vindo do navegador seria forjavel.
  const clientIp = request.headers.get('CF-Connecting-IP') || '';
  if (clientIp) targetUrl.searchParams.set('_uip', clientIp);

  const upstream = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: {
      'User-Agent': request.headers.get('User-Agent') || '',
      'Content-Type': request.headers.get('Content-Type') || '',
      ...(clientIp ? { 'X-Forwarded-For': clientIp } : {})
    },
    body: request.method === 'POST' ? await request.text() : undefined
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Access-Control-Allow-Origin': '*' }
  });
}

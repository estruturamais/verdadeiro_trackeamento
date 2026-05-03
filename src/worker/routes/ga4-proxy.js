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

  const upstream = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: {
      'User-Agent': request.headers.get('User-Agent') || '',
      'Content-Type': request.headers.get('Content-Type') || ''
    },
    body: request.method === 'POST' ? await request.text() : undefined
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Access-Control-Allow-Origin': '*' }
  });
}

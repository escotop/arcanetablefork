const ALLOWED_HOST_SUFFIXES = ['wasabisys.com', 'mtgcardbuilder.com', 'wp.com'];

export function isAllowedImageHost(hostname) {
  return ALLOWED_HOST_SUFFIXES.some(
    suffix => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

export async function handleImageProxyRequest(uri) {
  if (!uri) {
    return { status: 400, body: 'Missing uri parameter' };
  }

  let target;
  try {
    target = new URL(uri);
  } catch {
    return { status: 400, body: 'Invalid uri parameter' };
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return { status: 400, body: 'Invalid uri protocol' };
  }

  if (!isAllowedImageHost(target.hostname)) {
    return { status: 400, body: 'Host not allowed' };
  }

  try {
    const upstream = await fetch(target.href, {
      headers: { 'User-Agent': 'arcanetable-image-proxy/1.0' },
    });

    if (!upstream.ok) {
      return { status: upstream.status, body: 'Upstream image not found' };
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return { status: 400, body: 'Upstream response is not an image' };
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*',
      },
      body,
    };
  } catch {
    return { status: 502, body: 'Failed to fetch upstream image' };
  }
}

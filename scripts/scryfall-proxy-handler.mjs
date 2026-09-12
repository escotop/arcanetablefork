const SCRYFALL_API = 'https://api.scryfall.com';

const SCRYFALL_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'ArcaneTable/1.0 (https://github.com/arcanetable)',
};

export async function handleScryfallProxyRequest({ url, method = 'GET', body }) {
  if (!url) {
    return { status: 400, body: JSON.stringify({ object: 'error', details: 'missing_path' }) };
  }

  const requestUrl = new URL(url, 'http://localhost');
  const pathname = requestUrl.pathname.replace(/^\/api\/scryfall/, '');
  const targetUrl = `${SCRYFALL_API}${pathname}${requestUrl.search || ''}`;

  const normalizedMethod = method.toUpperCase();
  const init = {
    method: normalizedMethod,
    headers: { ...SCRYFALL_HEADERS },
  };

  if (body && normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    init.headers['Content-Type'] = 'application/json';
    init.body = body;
  }

  const response = await fetch(targetUrl, init);
  const text = await response.text();

  return {
    status: response.status,
    body: text,
    contentType: response.headers.get('content-type') ?? 'application/json',
  };
}

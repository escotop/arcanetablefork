import { handleScryfallProxyRequest } from '../scripts/scryfall-proxy-handler.mjs';

function readBody(req) {
  if (req.body === undefined || req.body === null) return undefined;
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body);
}

function getRequestPath(req) {
  let path = req.query?.path;
  if (Array.isArray(path)) path = path.join('/');
  if (path) return String(path);

  const rawUrl = req.url ?? '';
  const url = rawUrl.startsWith('http') ? new URL(rawUrl) : new URL(rawUrl, 'http://localhost');
  const pathname = url.pathname.replace(/^\/api\/scryfall\/?/, '');
  return pathname || undefined;
}

function buildRequestUrl(req) {
  const path = getRequestPath(req);
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (key === 'path') continue;
    if (Array.isArray(value)) {
      value.forEach(entry => query.append(key, String(entry)));
    } else if (value !== undefined) {
      query.set(key, String(value));
    }
  }

  const suffix = query.toString() ? `?${query.toString()}` : '';
  return `/api/scryfall/${path ?? ''}${suffix}`;
}

export default async function handler(req, res) {
  const result = await handleScryfallProxyRequest({
    url: buildRequestUrl(req),
    method: req.method,
    body: readBody(req),
  });

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(result.status).send(result.body);
}

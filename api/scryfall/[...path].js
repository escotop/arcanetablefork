import { handleScryfallProxyRequest } from '../../scripts/scryfall-proxy-handler.mjs';

function readBody(req) {
  if (req.body === undefined || req.body === null) return undefined;
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body);
}

export default async function handler(req, res) {
  const path = Array.isArray(req.query?.path) ? req.query.path.join('/') : req.query?.path;
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
  const requestPath = `/api/scryfall/${path ?? ''}${suffix}`;
  const result = await handleScryfallProxyRequest({
    url: requestPath,
    method: req.method,
    body: readBody(req),
  });

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(result.status).send(result.body);
}

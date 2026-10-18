import { handleMpcfillProxyRequest } from '../scripts/mpcfill-proxy-handler.mjs';

function getRequestPath(req) {
  let path = req.query?.path;
  if (Array.isArray(path)) path = path.join('/');
  if (path) return String(path);

  const rawUrl = req.url ?? '';
  const url = rawUrl.startsWith('http') ? new URL(rawUrl) : new URL(rawUrl, 'http://localhost');
  const pathname = url.pathname.replace(/^\/api\/mpcfill\/?/, '');
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
  return `/api/mpcfill/${path ?? ''}${suffix}`;
}

export default async function handler(req, res) {
  const result = await handleMpcfillProxyRequest(buildRequestUrl(req));

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(result.status).json(result.body);
}

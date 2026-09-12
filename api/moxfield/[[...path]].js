import { handleMoxfieldProxyRequest } from '../../scripts/moxfield-proxy-handler.mjs';

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
  const requestPath = `/api/moxfield/${path ?? ''}${suffix}`;
  const result = await handleMoxfieldProxyRequest(requestPath);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(result.status).json(result.body);
}

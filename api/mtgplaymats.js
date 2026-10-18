import { handleMtgplaymatsProxyRequest } from '../scripts/mtgplaymats-proxy-handler.mjs';

function buildRequestUrl(req) {
  const rawUrl = req.url ?? '';
  const url = rawUrl.startsWith('http') ? new URL(rawUrl) : new URL(rawUrl, 'http://localhost');
  return `${url.pathname}${url.search}`;
}

export default async function handler(req, res) {
  const result = await handleMtgplaymatsProxyRequest(buildRequestUrl(req));

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(result.status).json(result.body);
}

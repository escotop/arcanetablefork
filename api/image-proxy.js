import { handleImageProxyRequest } from '../scripts/image-proxy-handler.mjs';

export default async function handler(req, res) {
  const uri = typeof req.query?.uri === 'string' ? req.query.uri : undefined;
  const result = await handleImageProxyRequest(uri);

  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }

  res.status(result.status).send(result.body);
}

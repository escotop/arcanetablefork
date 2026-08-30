import http from 'node:http';
import { URL } from 'node:url';
import { handleImageProxyRequest } from './scripts/image-proxy-handler.mjs';

const port = Number(process.env.IMAGE_PROXY_PORT ?? 3001);

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (requestUrl.pathname !== '/image-proxy') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const result = await handleImageProxyRequest(requestUrl.searchParams.get('uri'));
  const headers = result.headers ?? { 'Content-Type': 'text/plain; charset=utf-8' };
  res.writeHead(result.status, headers);
  res.end(result.body);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Image proxy listening on http://127.0.0.1:${port}`);
});

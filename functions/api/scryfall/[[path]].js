import {
  handleScryfallProxyRequest,
  scryfallCacheKey,
} from '../../../scripts/scryfall-proxy-handler.mjs';
import { readRequestBody, textResponse } from '../../_proxy-response.js';

export async function onRequest(context) {
  const { request, caches, waitUntil } = context;
  const url = new URL(request.url);
  const body = await readRequestBody(request);
  const cacheKeyUrl =
    request.method === 'GET' || body
      ? await scryfallCacheKey(`${url.pathname}${url.search}`, request.method, body)
      : undefined;

  const cache = caches?.default;
  if (cache && cacheKeyUrl) {
    const cacheRequest = new Request(cacheKeyUrl, { method: 'GET' });
    const cached = await cache.match(cacheRequest);
    if (cached) return cached;
  }

  const result = await handleScryfallProxyRequest({
    url: `${url.pathname}${url.search}`,
    method: request.method,
    body,
  });

  const response = textResponse(result);

  if (cache && cacheKeyUrl && result.cacheable && result.status === 200) {
    const cacheRequest = new Request(cacheKeyUrl, { method: 'GET' });
    waitUntil(cache.put(cacheRequest, response.clone()));
  }

  return response;
}

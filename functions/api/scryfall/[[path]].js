import { handleScryfallProxyRequest } from '../../../scripts/scryfall-proxy-handler.mjs';
import { readRequestBody, textResponse } from '../../_proxy-response.js';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const result = await handleScryfallProxyRequest({
    url: `${url.pathname}${url.search}`,
    method: request.method,
    body: await readRequestBody(request),
  });

  return textResponse(result, {
    'Content-Type': result.contentType ?? 'application/json',
  });
}

import { handleImageProxyRequest } from '../scripts/image-proxy-handler.mjs';
import { binaryResponse, textResponse } from './_proxy-response.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const result = await handleImageProxyRequest(url.searchParams.get('uri') ?? undefined);

  if (result.headers) {
    return binaryResponse(result);
  }

  return textResponse(result, { 'Content-Type': 'text/plain; charset=utf-8' });
}

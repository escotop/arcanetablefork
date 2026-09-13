import { handleMoxfieldProxyRequest } from '../../../scripts/moxfield-proxy-handler.mjs';
import { jsonResponse } from '../../_proxy-response.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const result = await handleMoxfieldProxyRequest(`${url.pathname}${url.search}`);
  return jsonResponse(result);
}

import { handleMpcfillProxyRequest } from '../../../scripts/mpcfill-proxy-handler.mjs';
import { jsonResponse } from '../../_proxy-response.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const result = await handleMpcfillProxyRequest(`${url.pathname}${url.search}`);
  return jsonResponse(result);
}

/** Node's ServerResponse.end() does not accept ArrayBuffer (fetch upstream images). */
export function bodyForNodeResponse(body) {
  if (body == null) return undefined;
  if (typeof body === 'string' || Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return String(body);
}

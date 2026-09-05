const LOG_OMITTED_USERDATA_KEYS = new Set([
  'cardBack',
  'publicCardBack',
  'resting',
  'spanishPreviewSavedMat',
  'spanishPreviewSavedUrl',
]);

/** Strip Three.js materials and other non-JSON fields before persisting to Yjs. */
export function serializeCardUserDataForLog(userData: Record<string, unknown>) {
  const cloneable = Object.fromEntries(
    Object.entries(userData).filter(([key]) => !LOG_OMITTED_USERDATA_KEYS.has(key)),
  );
  return JSON.parse(JSON.stringify(cloneable)) as Record<string, unknown>;
}

export function sanitizeGameLogEvent(event: Record<string, unknown>) {
  if (!event || typeof event !== 'object') return event;

  if (event.type === 'bulk' && Array.isArray(event.events)) {
    for (const nested of event.events) {
      sanitizeGameLogEvent(nested as Record<string, unknown>);
    }
    return event;
  }

  const payload = event.payload as Record<string, unknown> | undefined;
  const userData = payload?.userData;
  if (userData && typeof userData === 'object' && 'id' in userData) {
    payload!.userData = serializeCardUserDataForLog(userData as Record<string, unknown>);
  }

  return event;
}

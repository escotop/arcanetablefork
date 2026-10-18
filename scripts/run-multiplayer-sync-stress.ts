import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;
globalThis.document = window.document;
globalThis.window = window as unknown as Window & typeof globalThis;
globalThis.Image = window.Image;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

const originalFetch = globalThis.fetch?.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('unknown-card-image') || url.includes('scryfall') || url.startsWith('/api/')) {
    const isImage = url.includes('unknown-card-image') || url.includes('image');
    return {
      ok: true,
      status: 200,
      headers: { get: () => (isImage ? 'image/png' : 'application/json') },
      json: async () => ({ object: 'error', details: 'headless-stub' }),
      blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    } as Response;
  }
  if (originalFetch) return originalFetch(input, init);
  throw new Error(`fetch not available: ${url}`);
};

globalThis.Audio = class Audio {
  volume = 1;
  preload = '';
  cloneNode() {
    return new Audio();
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
  load() {}
} as unknown as typeof Audio;

if (!globalThis.OffscreenCanvas) {
  globalThis.OffscreenCanvas = window.HTMLCanvasElement as unknown as typeof OffscreenCanvas;
}
if (!globalThis.createImageBitmap) {
  globalThis.createImageBitmap = async () =>
    ({ width: 1, height: 1, close: () => {} }) as ImageBitmap;
}

const { runMultiplayerSyncStress, MAX_SYNC_STRESS_ACTIONS } = await import(
  '../src/lib/multiplayerSync.sim.runner'
);

const maxActions = Number(process.env.SYNC_STRESS_MAX) || MAX_SYNC_STRESS_ACTIONS;
const result = await runMultiplayerSyncStress(maxActions);

if (result.ok) {
  console.log(
    `OK: ${result.actionsCompleted}/${MAX_SYNC_STRESS_ACTIONS} acciones simuladas; replay A/B sin divergencia (log length ${result.logLength}).`,
  );
  process.exit(0);
}

console.error('DESYNC detectado');
console.error(`Acción #${result.actionIndex + 1}, tipo=${result.kind}, actor=${result.actorId}`);
console.error(result.diagnosis);
if (result.lastEvent) {
  console.error('Último evento en log:', JSON.stringify(result.lastEvent, null, 2).slice(0, 2000));
}
process.exit(1);

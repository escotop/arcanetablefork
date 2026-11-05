/**
 * One headless player for the live sync sim. Runs in its own process (own module
 * state, own Y.Doc) and talks to the orchestrator over IPC:
 *  - Yjs updates are relayed by the orchestrator (with latency) to the other client.
 *  - Commands drive real game code paths (drag-drop play, tap, draw, ...).
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;
globalThis.document = window.document;
globalThis.window = window as unknown as Window & typeof globalThis;
globalThis.Image = window.Image;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.HTMLElement = window.HTMLElement;
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

const FETCH_DELAY_MS = Number(process.env.SIM_FETCH_DELAY_MS ?? 0);
if (FETCH_DELAY_MS > 0) {
  // Card art goes through <img> (image proxy). JSDOM never loads it, so fail it after the delay
  // like a slow download would (the game then falls back, which is also delayed).
  globalThis.Image = class SlowImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = '';
    naturalWidth = 1;
    naturalHeight = 1;
    width = 1;
    height = 1;
    set src(_value: string) {
      setTimeout(() => this.onerror?.(), FETCH_DELAY_MS);
    }
  } as unknown as typeof Image;
}
globalThis.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (FETCH_DELAY_MS > 0) await new Promise(r => setTimeout(r, FETCH_DELAY_MS));
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    json: async () => ({ object: 'error', details: 'headless-stub', url }),
    blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
  } as unknown as Response;
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
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close: () => {} }) as ImageBitmap;
}

// Keep the console quiet; the orchestrator only needs IPC.
if (!process.env.SIM_VERBOSE) {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
  console.error = () => {};
}

const CLIENT_ID = Number(process.env.SIM_CLIENT_ID);
const PREFIX = String(process.env.SIM_PREFIX);
const SEAT_INDEX = Number(process.env.SIM_SEAT_INDEX ?? 0);
const DECK_SIZE = 30;

const Y = await import('yjs');
const G = await import('../../src/lib/globals');
const RE = await import('../../src/remoteEvents');
const { PlayArea } = await import('../../src/lib/playArea');
const { transferCard } = await import('../../src/lib/transferCard');
const CE = await import('../../src/lib/createEvents');
const { renderAnimations } = await import('../../src/lib/animations');
const { getRotationFromCardState } = await import('../../src/lib/card');
const { cardFromDeckEntry } = await import('../../src/lib/cardLoading');
const { setupSeatSync } = await import('../../src/lib/seatSync');
const { applyCardOrientation } = await import('../../src/lib/card');
const THREE = await import('three');

const send = (msg: unknown) => process.send?.(msg);

// ---------- world setup ----------
// Awareness is relayed to the other client by the orchestrator (same FIFO as Yjs updates).
const awarenessStates = new Map<number, Record<string, unknown>>();
const awarenessListeners = new Set<(change: unknown, origin: unknown) => void>();
const emitAwarenessChange = (id: number, origin: string) => {
  for (const fn of awarenessListeners) fn({ added: [], updated: [id], removed: [] }, origin);
};
const provider = {
  awareness: {
    clientID: CLIENT_ID,
    getStates: () => awarenessStates,
    getLocalState: () => awarenessStates.get(CLIENT_ID),
    setLocalStateField: (key: string, value: unknown) => {
      const entry = { ...(awarenessStates.get(CLIENT_ID) ?? {}) };
      entry[key] = value;
      awarenessStates.set(CLIENT_ID, entry);
      send({ type: 'aw', id: CLIENT_ID, state: JSON.parse(JSON.stringify(entry)) });
      emitAwarenessChange(CLIENT_ID, 'local');
    },
    on(event: string, fn: (change: unknown, origin: unknown) => void) {
      if (event === 'change') awarenessListeners.add(fn);
    },
    off(event: string, fn: (change: unknown, origin: unknown) => void) {
      if (event === 'change') awarenessListeners.delete(fn);
    },
  },
  on() {},
  off() {},
  synced: true,
};

G.headlessInit({ provider });
const BUG = await import('../../src/lib/bugGameLog');
try {
  BUG.initBugGameLog(`sim-${PREFIX}`);
} catch (error) {
  process.stderr.write(`bug log init failed: ${error}\n`);
}
G.setGameTable(new THREE.Group());
G.setEventCatchUpComplete(false);
await RE.processEvents();
G.finishHistoricalLogReplay();
G.setEventCatchUpComplete(true);

G.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin === 'remote') return;
  send({ type: 'y', data: Buffer.from(update).toString('base64') });
});

G.gameLog.observe(() => {
  void RE.processEvents().then(() => RE.syncPlayAreasFromGameLog());
});
if (!process.env.SIM_NO_SEAT_SYNC) setupSeatSync();

// Render loop: mirrors main3d's ~30fps animate(). Pausing it simulates a hidden tab
// (requestAnimationFrame stops, but timers, network and sounds keep running).
let renderPaused = false;
setInterval(() => {
  if (renderPaused) return;
  G.clock.getDelta();
  renderAnimations(G.clock.elapsedTime);
}, 33);

// ---------- helpers ----------
function createDeckCards() {
  return Array.from({ length: DECK_SIZE }, (_, i) => {
    const name = `${PREFIX} Card ${i}`;
    const entry = {
      id: `${PREFIX}-${i}`,
      name,
      qty: 1,
      categories: [] as string[],
      set: 'TST',
      collector_number: String(i),
      detail: {
        name,
        set: 'TST',
        collector_number: String(i),
        type_line: 'Creature',
        image_uris: { normal: `https://img.test/${PREFIX}-${i}.png` },
      },
    };
    const card = cardFromDeckEntry(entry, CLIENT_ID);
    card.id = `${PREFIX}-${i}`;
    return card;
  });
}

function localArea() {
  const area = G.playAreas[CLIENT_ID];
  if (!area) throw new Error('local play area missing');
  return area;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Same sequence as main3d onDocumentDrop for a card dropped into another zone. */
async function dragTransfer(card: any, fromZone: any, toZone: any, position?: number[]) {
  const transferEvent = CE.createTransferCardEvent(card, fromZone, toZone, {
    addOptions: {
      ...(toZone.zone !== 'hand' ? { skipLocalAnimation: true } : {}),
      ...(toZone.zone === 'battlefield' ? { positionArray: position ?? [0, 0, 0] } : {}),
    },
  });
  const extended = transferEvent.payload.extendedOptions;
  const options = {
    preventTransmit: true,
    localSounds: true,
    addOptions: extended?.addOptions,
    userData: extended?.userData,
  };
  if (process.env.SIM_OLD_DROP_ORDER) {
    // Previous main3d order: wait for the local move (and its art) before publishing.
    await transferCard(card, fromZone, toZone, options);
    G.dispatchGameEvent(transferEvent);
  } else {
    const move = transferCard(card, fromZone, toZone, options);
    G.dispatchGameEvent(transferEvent);
    await move;
  }
  await G.flushDispatchEventQueue();
}

function quatAngle(a: any, b: any) {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot);
}

function round(v: number) {
  return Math.round(v * 10) / 10;
}

function fingerprint() {
  const seats = Object.values(G.playAreas)
    .filter(Boolean)
    .map((area: any) => {
      const bf = area.battlefieldZone;
      const battlefield = bf.cards
        .map((card: any) => {
          const mesh = card.mesh;
          const ud = mesh?.userData ?? {};
          const zonePos = ud.zone?.[bf.id]?.position as number[] | undefined;
          const posErr = zonePos
            ? mesh.position.distanceTo(new THREE.Vector3().fromArray(zonePos))
            : -1;
          const rotErr = mesh ? quatAngle(mesh.quaternion, getRotationFromCardState(ud)) : -1;
          return {
            id: card.id,
            tapped: !!ud.isTapped,
            flipped: !!ud.isFlipped,
            zonePos: zonePos?.map(round),
            // What the player actually sees:
            visual: {
              onBattlefieldMesh: mesh?.parent === bf.mesh,
              posErr: round(posErr),
              rotErr: round(rotErr),
              looksTapped: mesh
                ? quatAngle(mesh.quaternion, getRotationFromCardState({ isTapped: true, isFlipped: ud.isFlipped })) < 0.1
                : false,
              animating: !!ud.isAnimating,
            },
          };
        })
        .sort((a: any, b: any) => a.id.localeCompare(b.id));
      return {
        clientId: area.clientId,
        handCount: area.hand.cards.length,
        deckCount: area.deck.cards.length,
        graveyard: area.graveyardZone.cards.map((c: any) => c.id).sort(),
        battlefield,
      };
    })
    .sort((a: any, b: any) => a.clientId - b.clientId);

  return {
    clientId: CLIENT_ID,
    processed: G.processedEvents(),
    logLength: G.gameLog.length,
    seats,
    sounds: ((globalThis as any).__simSounds ?? []).length,
    seatSyncEvents: G.gameLog.toArray().filter((e: any) => e?.type === 'seatSync').length,
  };
}

async function waitIdle(maxMs = 15_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await RE.processEvents();
    if (G.processedEvents() >= G.gameLog.length) {
      await sleep(80);
      if (G.processedEvents() >= G.gameLog.length) return true;
    }
    await sleep(25);
  }
  return false;
}

// ---------- commands ----------
const commands: Record<string, (args: any) => Promise<unknown> | unknown> = {
  async join() {
    G.setLocalPlayerClientId(CLIENT_ID);
    const cards = createDeckCards();
    const area = new PlayArea(
      CLIENT_ID,
      cards.map(c => ({ id: c.id, name: c.detail?.name ?? c.id })),
      cards,
      { isLocalPlayer: true, index: SEAT_INDEX, playerSessionId: `session-${PREFIX}` },
    );
    G.table.add(area.mesh);
    G.setPlayAreas(CLIENT_ID, area);
    area.subscribeEvents(G.sendEvent);
    G.sendEvent({ type: 'join', payload: area.getLocalState() });
    await G.flushDispatchEventQueue();
    return { ok: true };
  },
  async draw({ count = 1 }) {
    const area = localArea();
    for (let i = 0; i < count; i++) {
      const card = area.deck.cards[0];
      if (!card) break;
      area.deck.materializeTopCard();
      G.dispatchGameEvent(CE.createDeckDrawLogEvent({ source: 'top' }));
      await transferCard(card, area.deck, area.hand);
    }
    await G.flushDispatchEventQueue();
    return { hand: area.hand.cards.length };
  },
  /** Drag a hand card to the battlefield; optionally tap it `tapAfterMs` later (land + mana). */
  async play({ position, tapAfterMs, flipAfterMs, newest = false }) {
    const area = localArea();
    const card = newest ? area.hand.cards.at(-1) : area.hand.cards[0];
    if (!card) throw new Error('empty hand');
    const drop = dragTransfer(card, area.hand, area.battlefieldZone, position);
    if (tapAfterMs !== undefined) {
      await sleep(tapAfterMs);
      area.tap(card.mesh);
    }
    if (flipAfterMs !== undefined) {
      await sleep(flipAfterMs);
      area.flip(card.mesh);
    }
    await drop;
    await G.flushDispatchEventQueue();
    return { cardId: card.id };
  },
  async tap({ cardId }) {
    const area = localArea();
    const card = cardId
      ? area.battlefieldZone.cards.find((c: any) => c.id === cardId)
      : area.battlefieldZone.cards.find((c: any) => !c.mesh?.userData?.isTapped) ??
        area.battlefieldZone.cards[0];
    if (!card?.mesh) throw new Error('no battlefield card');
    area.tap(card.mesh);
    await G.flushDispatchEventQueue();
    return { cardId: card.id, tapped: card.mesh.userData.isTapped };
  },
  async toGraveyard({ cardId }) {
    const area = localArea();
    const card = cardId
      ? area.battlefieldZone.cards.find((c: any) => c.id === cardId)
      : area.battlefieldZone.cards[0];
    if (!card) throw new Error('no battlefield card');
    await dragTransfer(card, area.battlefieldZone, area.graveyardZone);
    return { cardId: card.id };
  },
  debugLog() {
    const entries = G.gameLog.toArray() as any[];
    const types: Record<string, number> = {};
    for (const e of entries) types[e?.type] = (types[e?.type] ?? 0) + 1;
    return {
      types,
      joins: entries
        .filter(e => e?.type === 'join')
        .map(e => ({ clientID: e.clientID, deck: e.payload?.deck?.cards?.length, cards: e.payload?.cards?.length })),
      areas: Object.values(G.playAreas)
        .filter(Boolean)
        .map((a: any) => ({
          clientId: a.clientId,
          deck: a.deck.cards.length,
          hand: a.hand.cards.length,
          bf: a.battlefieldZone.cards.length,
          gy: a.graveyardZone.cards.length,
          peek: a.peekZone.cards.length,
        })),
      processed: G.processedEvents(),
      length: G.gameLog.length,
    };
  },
  /** Break this client's view of another seat without any event (like a lost event). */
  corruptRemote({ kind }) {
    const area = Object.values(G.playAreas).find((a: any) => a && a.clientId !== CLIENT_ID) as any;
    if (!area) throw new Error('no remote seat');
    if (kind === 'untap') {
      const card = area.battlefieldZone.cards.find((c: any) => c.mesh?.userData?.isTapped);
      if (!card) throw new Error('no tapped remote card');
      card.mesh.userData.isTapped = false;
      applyCardOrientation(card.mesh);
      return { cardId: card.id };
    }
    const card = area.battlefieldZone.cards.at(-1);
    if (!card) throw new Error('no remote battlefield card');
    area.battlefieldZone.removeCard(card.mesh);
    area.hand.addCard(card, { skipAnimation: true });
    return { cardId: card.id };
  },
  /** Same steps as main3d reconnectViaLogReplay + reclaimLocalPlayArea (page reload). */
  async reconnect({ settleMs = 150, finishWhileBehind = false }) {
    G.resetGameSceneForReplay();
    await RE.waitForGameLogCatchUp({ maxWaitMs: 15_000 });
    RE.syncPlayAreasFromGameLog();
    const area = G.playAreas[CLIENT_ID] as any;
    if (!area) throw new Error('own seat not rebuilt');
    try {
      area.setAsLocalPlayArea();
    } catch {
      area.isLocalPlayArea = true;
    }
    area.subscribeEvents(G.sendEvent);
    G.setLocalPlayerClientId(CLIENT_ID);
    await sleep(settleMs); // card system init, advice, textures... in the real flow
    let finished = false;
    if (finishWhileBehind) {
      // Reclaim finishes right when an opponent event lands and is not applied yet (busy table).
      await new Promise<void>(resolve => {
        const onEntry = () => {
          G.gameLog.unobserve(onEntry);
          clearTimeout(timer);
          G.finishHistoricalLogReplay();
          finished = true;
          resolve();
        };
        const timer = setTimeout(() => {
          G.gameLog.unobserve(onEntry);
          resolve();
        }, 5_000);
        G.gameLog.observe(onEntry);
      });
    }
    if (!finished) G.finishHistoricalLogReplay();
    G.setEventCatchUpComplete(true);
    return { initialReplayComplete: G.isInitialGameLogReplayComplete() };
  },
  setRenderPaused({ value }) {
    renderPaused = !!value;
    return { renderPaused };
  },
  async idle({ maxMs }) {
    return { idle: await waitIdle(maxMs) };
  },
  fingerprint() {
    return fingerprint();
  },
  sounds() {
    return (globalThis as any).__simSounds ?? [];
  },
  buglog() {
    return BUG.getLocalBugGameLogText();
  },
  internals() {
    return {
      initialReplayComplete: G.isInitialGameLogReplayComplete(),
      historicalReplay: G.isHistoricalLogReplayInProgress(),
      catchUp: G.isEventCatchUpComplete(),
      yjsClientId: G.ydoc.clientID,
    };
  },
};

process.on('message', async (msg: any) => {
  if (msg?.type === 'aw') {
    awarenessStates.set(msg.id, msg.state);
    emitAwarenessChange(msg.id, 'remote');
    return;
  }
  if (msg?.type === 'y') {
    Y.applyUpdate(G.ydoc, new Uint8Array(Buffer.from(msg.data, 'base64')), 'remote');
    return;
  }
  if (msg?.type === 'cmd') {
    try {
      const result = await commands[msg.name](msg.args ?? {});
      send({ type: 'res', id: msg.id, result });
    } catch (error) {
      send({ type: 'res', id: msg.id, error: error instanceof Error ? error.stack : String(error) });
    }
  }
});

send({ type: 'ready', clientId: CLIENT_ID });

// vite-node closes its dev server once this module finishes, which breaks the game's
// lazy `import()` calls. Keep the module pending for the whole session.
await new Promise<void>(resolve => process.on('disconnect', () => resolve()));
process.exit(0);

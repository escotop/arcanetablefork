import uniqBy from 'lodash-es/uniqBy';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { cancelAnimation, renderAnimations, serializeAnimation } from './lib/animations';
import { resolveHowItPlaysAdviceForDeck } from './lib/commanderBracket';
import { getDeckStore } from './lib/deckStore';
import { getCardMeshTetherPoint, setCardData, setCounterLabelHoverTarget, updateTextureAnimation } from './lib/card';
import { clearSpanishPreview, clearSpanishPreviewForCard } from './lib/spanishCardPreview';
import {
  CARD_STACK_OFFSET,
  CARD_THICKNESS,
  DEFAULT_COMMANDER_LIFE,
  GameOptions,
  isMagicCardSystem,
  LoadSettings,
} from './lib/constants';
import {
  animateCameraLook,
  animateCameraTiltToRest,
  onCameraMouseLeave,
  onCameraViewChange,
  updateCameraTiltBlockedState,
} from './lib/cameraTilt';
import {
  animating,
  applyPlayerTransform,
  baseCameraQuaternion,
  camera,
  cardSystem,
  cardsById,
  clock,
  DEFAULT_CARD_BACK,
  dispatchGameEvent,
  expect,
  flushDispatchEventQueue,
  focusCamera,
  focusRenderer,
  gameLog,
  getLocalPlayArea,
  getLocalPlayerClientId,
  hasPersistedGameState,
  hoverSignal,
  init,
  initHowItPlaysAdvice,
  initClock,
  isCameraTiltBlocked,
  isLocalHandZone,
  isSpectating,
  isUnderLocalHand,
  isGameplayBlocked,
  playAreas,
  players,
  processedEvents,
  provider,
  renderer,
  scene,
  scrollTarget,
  selection,
  sendEvent,
  setupCss3dRenderer,
  css3dRenderer,
  patchCss3dPointerEvents,
  setAnimating,
  setCapturedErrors,
  setCardBackTexture,
  setContextMenuSignal,
  setHoverSignal,
  setIsIntitialized,
  setLocalPlayerClientId,
  onLocalPlayAreaChanged,
  setEventCatchUpComplete,
  finishHistoricalLogReplay,
  setPlayAreas,
  setPlayers,
  setSettings,
  settings,
  FOCUS_PANEL_LAYER,
  FOCUS_PANEL_MAX_SCALE,
  FOCUS_PANEL_MIN_SCALE,
  table,
  updateFocusPanelSize,
  tearingDown,
  updateFocusCamera,
  zonesById,
} from './lib/globals';
import { devLog } from './lib/devLog';
import {
  getOrCreatePlayerSessionId,
  getStoredJoinBinding,
  persistJoinBinding,
  registerPlayerSession,
  resolveJoinClientId,
} from './lib/playerSession';
import { Hand } from './lib/hand';
import { PlayArea } from './lib/playArea';
import { getPlayAreaPlayerName } from './lib/playAreaNameTag';
import { resolvePlayerColor } from './lib/playerColor';
import { handlePingAwarenessChanges, isCardPingTarget, publishTablePingFromHit } from './lib/pingSync';
import {
  isBoardInteractionSuppressed,
  suppressBoardInteractionAfterPing,
} from './lib/pingInteractionGuard';
import {
  cancelPingWheelDrag,
  finishPingWheelDrag,
  isPingModifierHeld,
  isPingWheelDragActive,
  setupPingWheelKeys,
  startPingWheelDrag,
  updatePingWheelHover,
} from './lib/pingWheelState';
import { preloadPingVideos } from './lib/pingVideoEffect';
import { updateWaterdrops } from './lib/waterdropEffect';
import { setCameraViewMode as applyCameraViewMode, setCameraViewByPlayerIndex as applyCameraViewByPlayerIndex, getVisualSeatIndex, setAfterCameraViewChange } from './lib/cameraView';
import { syncCameraDebugGuiFromActiveView } from './lib/cameraDebugGui';
import { transferCard } from './lib/transferCard';
import { drawCards, OPENING_HAND_SIZE } from './lib/shortcuts/commands/deck';
import { setCounters } from './lib/ui/counterDialog';
import { resolveStackAnchor } from './lib/footprintOverlap';
import { restackItemsLocally } from './lib/utils';
import { processEvents, syncPlayAreasFromGameLog, waitForGameLogCatchUp, waitForMultiplayerGameState } from './remoteEvents';
import { setupGameStateImportObserver } from './lib/gameStateSnapshot';
import {
  acquireWorldSnapshot,
  gameNeedsSnapshotSync,
  hasSnapshotCatchUp,
  restoreLocalPlayerAwarenessFromWorldSnapshot,
  setupPersistentSnapshotPublisher,
  setupSyncBarrierObserver,
} from './lib/worldSnapshot';
import { getDeckStore } from './lib/deckStore';
import { loadGameMeta, saveGameMeta } from './lib/gameMeta';
import { refreshMultiplayerSyncState } from './lib/multiplayerSync';
import { initReloadOtherPlayerDebug, logReloadOther } from './lib/reloadOtherPlayerDebug';
import { unwrap } from 'solid-js/store';
import {
  beginLoadProfile,
  endLoadProfile,
  markLoadProfile,
  profileAsync,
} from './lib/loadProfile';
import { initTurnOrderSync } from './lib/turnOrder';
import { createRestackEvent, createTransferCardEvent } from './lib/createEvents';

var container;

let composer: EffectComposer;
let raycaster: THREE.Raycaster;
let mouse: THREE.Vector2;
let cameraMouse: THREE.Vector2;
let outlinePass: OutlinePass;
let dragTargets: THREE.Object3D[];
let dragStartMouse = new THREE.Vector2();
/** NDC Y delta above drag start before a hand-origin drag targets leaving the hand. */
const HAND_DRAG_OUT_NDC_DELTA = 0.06;
let hand: Hand;
let time = 0;
let playArea: PlayArea;
let currentGameId: string;

function applyReconnectedPlayerAwareness(gameId: string, playerSessionId: string) {
  restoreLocalPlayerAwarenessFromWorldSnapshot(gameId);

  const meta = loadGameMeta(gameId);
  provider.awareness.setLocalStateField('playerSessionId', playerSessionId);
  if (meta?.name) provider.awareness.setLocalStateField('name', meta.name);

  const localState = provider.awareness.getLocalState() ?? {};
  if (meta?.life !== undefined) {
    provider.awareness.setLocalStateField('life', meta.life);
  } else if (localState.life === undefined) {
    provider.awareness.setLocalStateField('life', settings.startingLife);
  }

  if (meta?.commanderLife !== undefined) {
    provider.awareness.setLocalStateField('commanderLife', meta.commanderLife);
  } else if (isMagicCardSystem(cardSystem) && localState.commanderLife === undefined) {
    provider.awareness.setLocalStateField('commanderLife', DEFAULT_COMMANDER_LIFE);
  }

  provider.awareness.setLocalStateField(
    'color',
    settings.playerColor ?? resolvePlayerColor({ name: meta?.name ?? localState.name }),
  );
}

function waitForProviderSync(maxWaitMs = 8000): Promise<{
  synced: boolean;
  timedOut: boolean;
}> {
  if (!provider) {
    return Promise.resolve({ synced: false, timedOut: false });
  }

  return new Promise(resolve => {
    if ((provider as { synced?: boolean }).synced) {
      resolve({ synced: true, timedOut: false });
      return;
    }
    let settled = false;
    const finish = (synced: boolean, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      provider.off('sync', onSync);
      resolve({ synced, timedOut });
    };
    const onSync = (synced: boolean) => {
      if (synced) finish(true, false);
    };
    provider.on('sync', onSync);
    setTimeout(() => finish(false, true), maxWaitMs);
  });
}

async function waitForGameLogReplay(maxWaitMs = 30_000) {
  const replayStart = processedEvents();
  const logLength = gameLog.length;
  const caughtUp = await profileAsync('gameLog replay', () =>
    waitForGameLogCatchUp({ maxWaitMs }),
  );
  syncPlayAreasFromGameLog();
  scheduleBattlefieldOrientationSync();
  markLoadProfile('gameLog replay counts', {
    eventsReplayed: processedEvents() - replayStart,
    gameLogLength: logLength,
    processedTotal: processedEvents(),
    currentLogLength: gameLog.length,
    caughtUp,
  });
  if (!caughtUp) {
    return;
  }
}

async function waitForPlayAreaOnTable(clientId: number, maxWaitMs = 15_000) {
  const deadline = performance.now() + maxWaitMs;

  while (performance.now() < deadline) {
    await processEvents();
    syncPlayAreasFromGameLog();

    const area = playAreas[clientId];
    if (area) {
      if (area.mesh.parent !== table) {
        table.add(area.mesh);
        readjustPlayAreas();
      }
      return area;
    }

    await waitForGameLogCatchUp({
      maxWaitMs: Math.max(250, deadline - performance.now()),
    });
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return playAreas[clientId];
}

function scheduleBattlefieldOrientationSync() {
  Object.values(playAreas).forEach(area => area?.reapplyBattlefieldOrientations());
  requestAnimationFrame(() => {
    Object.values(playAreas).forEach(area => area?.reapplyBattlefieldOrientations());
  });
}

function ensurePlayAreaOnTable(area: PlayArea) {
  if (area.mesh.parent !== table) {
    table.add(area.mesh);
    readjustPlayAreas();
  }
}

async function finalizeReconnectedPlayArea(
  gameId: string,
  playerSessionId: string,
  initCardSystem?: (uri: string) => Promise<unknown>,
) {
  const area = getLocalPlayArea();
  if (!area) return false;

  area.setAsLocalPlayArea();
  area.subscribeEvents(sendEvent);
  playArea = area;
  hand = area.hand;
  setLocalPlayerClientId(area.clientId);
  registerPlayerSession(playerSessionId, area.clientId);
  persistJoinBinding(gameId, { playerSessionId, clientId: area.clientId });
  setIsIntitialized(true);

  const meta = loadGameMeta(gameId);
  if (meta?.cardSystemUri && initCardSystem) {
    await profileAsync('card system init', () => initCardSystem(meta.cardSystemUri!));
    await profileAsync('card back texture', () =>
      setCardBackTexture(cardSystem.cardBack ?? DEFAULT_CARD_BACK),
    );
  }

  applyReconnectedPlayerAwareness(gameId, playerSessionId);

  ensurePlayAreaOnTable(area);
  readjustPlayAreas();
  scheduleBattlefieldOrientationSync();

  const storedDeck = meta?.deckId ? getDeckStore().decks[meta.deckId] : undefined;
  const advice = await profileAsync('how it plays advice (reconnect)', () =>
    resolveHowItPlaysAdviceForDeck(storedDeck),
  );
  initHowItPlaysAdvice(advice, playerSessionId);

  markLoadProfile('reclaim play area ready', { joinClientId: area.clientId, cardCount: area.deck.cards.length });
  void area.loadTextures();
  renderer?.compile(scene, camera);
  markLoadProfile('renderer compile (reconnect)');
  finishHistoricalLogReplay();
  setEventCatchUpComplete(true);
  return true;
}

async function reclaimLocalPlayArea(
  joinClientId: number,
  gameId: string,
  playerSessionId: string,
  initCardSystem?: (uri: string) => Promise<unknown>,
  options?: { maxReplayWaitMs?: number; maxAreaWaitMs?: number; skipReplayWait?: boolean },
) {
  if (!options?.skipReplayWait && !hasSnapshotCatchUp()) {
    await waitForGameLogReplay(options?.maxReplayWaitMs ?? 30_000);
  }

  const area = await profileAsync('wait for play area on table', () =>
    waitForPlayAreaOnTable(joinClientId, options?.maxAreaWaitMs ?? 15_000),
  );
  if (!area) return false;

  area.setAsLocalPlayArea();
  area.subscribeEvents(sendEvent);
  playArea = area;
  hand = area.hand;
  setLocalPlayerClientId(joinClientId);

  const meta = loadGameMeta(gameId);
  if (meta?.cardSystemUri && initCardSystem) {
    await profileAsync('card system init', () => initCardSystem(meta.cardSystemUri!));
    await profileAsync('card back texture', () =>
      setCardBackTexture(cardSystem.cardBack ?? DEFAULT_CARD_BACK),
    );
  }

  applyReconnectedPlayerAwareness(gameId, playerSessionId);

  registerPlayerSession(playerSessionId, joinClientId);
  persistJoinBinding(gameId, { playerSessionId, clientId: joinClientId });
  setIsIntitialized(true);
  ensurePlayAreaOnTable(area);
  readjustPlayAreas();
  scheduleBattlefieldOrientationSync();

  const storedDeck = meta?.deckId ? getDeckStore().decks[meta.deckId] : undefined;
  const advice = await profileAsync('how it plays advice (reconnect)', () =>
    resolveHowItPlaysAdviceForDeck(storedDeck),
  );
  initHowItPlaysAdvice(advice, playerSessionId);

  markLoadProfile('reclaim play area ready', { joinClientId, cardCount: area.deck.cards.length });
  void area.loadTextures();
  renderer?.compile(scene, camera);
  markLoadProfile('renderer compile (reconnect)');
  finishHistoricalLogReplay();
  setEventCatchUpComplete(true);
  return true;
}

export async function tryReconnectToGame(
  gameId: string,
  initCardSystem?: (uri: string) => Promise<unknown>,
): Promise<boolean> {
  const playerSessionId = getOrCreatePlayerSessionId(gameId);
  const providerSync = await profileAsync('provider sync', () => waitForProviderSync());
  markLoadProfile('provider sync result', providerSync);
  const joinClientId = await profileAsync('resolve join client', () =>
    resolveJoinClientId(gameLog, gameId, playerSessionId, processEvents),
  );
  if (joinClientId === undefined) {
    markLoadProfile('no existing join — fresh game');
    return false;
  }

  // Siempre intentar snapshot primero si hay múltiples jugadores
  if (gameNeedsSnapshotSync(playerSessionId, gameId)) {
    const snapshotApplied = await profileAsync('acquire world snapshot', () =>
      acquireWorldSnapshot(gameId, playerSessionId),
    );
    if (snapshotApplied) {
      const ok = await profileAsync('finalize reconnected play area', () =>
        finalizeReconnectedPlayArea(gameId, playerSessionId, initCardSystem),
      );
      markLoadProfile('reconnect path', { path: 'snapshot', ok });
      return ok;
    }
  }

  // Solo reclamar sin replay del log como fuente de datos
  const reclaimed = await profileAsync('reclaim local play area', () =>
    reclaimLocalPlayArea(joinClientId, gameId, playerSessionId, initCardSystem, {
      maxReplayWaitMs: 5_000,
      maxAreaWaitMs: 15_000,
      skipReplayWait: true,
    }),
  );
  markLoadProfile('reconnect path', { path: 'reclaim', reclaimed });
  return reclaimed;
}

export async function localInit(gameOptions: GameOptions) {
  keyboardHandHoverIndex = undefined;
  keyboardHandHoverMouseLock = undefined;
  container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.inset = '0';
  container.style.width = '100%';
  container.style.height = '100%';
  document.body.appendChild(container);
  currentGameId = gameOptions.gameId;
  await profileAsync('globals.init (3d + indexeddb)', () => init(gameOptions), {
    gameId: gameOptions.gameId,
  });

  time = 0;
  dragTargets = [];

  provider.awareness.on('change', change => {
    let newPlayers = Array.from(provider.awareness.getStates().entries()).map(([id, entry]) => ({
      entry,
      id,
    }));
    setPlayers(newPlayers);
    handlePingAwarenessChanges(change);
    refreshMultiplayerSyncState();
    void processEvents().then(() => {
      syncPlayAreasFromGameLog();
      refreshMultiplayerSyncState();
    });
  });

  setPlayers(
    Array.from(provider.awareness.getStates().entries()).map(([id, entry]) => ({
      entry,
      id,
    })),
  );

  onLocalPlayAreaChanged(area => {
    playArea = area;
    hand = area.hand;
    keyboardHandHoverIndex = undefined;
    keyboardHandHoverMouseLock = undefined;
    readjustPlayAreas();
    scheduleBattlefieldOrientationSync();
    void area.loadTextures();
  });

  initTurnOrderSync();

  provider.on('sync', isSynced => {
    if (!isSynced) return;
    void waitForGameLogCatchUp({ maxWaitMs: 5000 }).then(() => syncPlayAreasFromGameLog());
  });

  outlinePass = new OutlinePass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    scene,
    camera,
  );
  outlinePass.pulsePeriod = 2;

  var ambient = new THREE.AmbientLight(0xffffff);
  ambient.intensity = 2;
  ambient.layers.enable(FOCUS_PANEL_LAYER);
  scene.add(ambient);

  var directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.intensity = 2;
  directionalLight.layers.enable(FOCUS_PANEL_LAYER);
  directionalLight.position.set(0, 200, 0);
  directionalLight.shadow.mapSize.set(1024 * 2, 1024 * 2);
  directionalLight.shadow.camera.left = -140;
  directionalLight.shadow.camera.right = 140;
  directionalLight.shadow.camera.top = 140;
  directionalLight.shadow.camera.bottom = -140;
  directionalLight.castShadow = true;
  directionalLight.shadow.camera.far = 400;
  scene.add(directionalLight);
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  cameraMouse = new THREE.Vector2();

  gameLog.observe(() => {
    logReloadOther('main-gamelog-observe-fired', {
      logLength: gameLog.length,
      processed: processedEvents(),
    });
    void processEvents().then(() => {
      logReloadOther('main-gamelog-process-done-sync-playareas');
      syncPlayAreasFromGameLog();
    });
  });
  setupGameStateImportObserver(() => currentGameId);
  initReloadOtherPlayerDebug();
  setupSyncBarrierObserver();
  setupPersistentSnapshotPublisher();
  setupPingWheelKeys({ onQuickPing: publishQuickRegularPing });
  preloadPingVideos();
  refreshMultiplayerSyncState();

  container.appendChild(renderer.domElement);
  setupCss3dRenderer(container);
  markLoadProfile('canvas + css3d renderer');

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  markLoadProfile('postprocessing composer');

  // TODO: these document listeners are never cleaned up!
  renderer.domElement.addEventListener('mousemove', onRendererMouseMove, false);
  renderer.domElement.addEventListener('contextmenu', onContextMenu, false);
  renderer.domElement.addEventListener('auxclick', onAuxClick, false);
  document.addEventListener('mousemove', onDocumentMouseMove, false);
  document.documentElement.addEventListener('mouseleave', onDocumentMouseLeave, false);
  document.addEventListener('click', onDocumentClick, false);
  document.addEventListener('dragstart', onDocumentDragStart, false);
  document.addEventListener('dragend', onDocumentDragEnd, false);
  document.addEventListener('mouseup', onDocumentDrop, false);
  document.addEventListener('wheel', onDocumentScroll, { passive: false });
  window.addEventListener('resize', onWindowResize, false);

  void profileAsync('initial processEvents', () => processEvents(), {
    gameLogLength: gameLog.length,
    processedEvents: processedEvents(),
  });

  if (gameOptions.deck) {
    loadDeckAndJoin(gameOptions);
  }
  markLoadProfile('localInit complete', {
    gameLogLength: gameLog.length,
    hasDeck: !!gameOptions.deck,
  });
  startAnimating();
}

export function readjustPlayAreas() {
  let entries = Object.values(playAreas).sort((a, b) => a.index - b.index);

  let selfIndex = entries.findIndex(e => e.isLocalPlayArea);

  let sorted;

  if (selfIndex > -1) {
    sorted = entries.splice(selfIndex);
    sorted.push(...entries);
  } else {
    sorted = [, ...entries];
  }

  sorted.forEach((playArea, i) => {
    const index = getVisualSeatIndex(i, sorted.length);
    applyPlayerTransform(playArea.mesh, index);
    playArea?.updatePositions();
  });
}

export async function loadDeckAndJoin(
  settings: LoadSettings,
  initCardSystem?: (uri: string) => Promise<unknown>,
) {
  await profileAsync('provider sync (join)', () => waitForProviderSync(5000));

  const playerSessionId = getOrCreatePlayerSessionId(currentGameId);
  const remotePlayersOnline = players().filter(
    player => player.id !== provider.awareness.clientID && !player.entry?.isSpectating,
  );
  markLoadProfile('join context', {
    remotePlayers: remotePlayersOnline.length,
    gameLogLength: gameLog.length,
  });

  const existingJoinClientId = await profileAsync('resolve join client (new game)', () =>
    resolveJoinClientId(gameLog, currentGameId, playerSessionId, processEvents),
  );

  const needsMultiplayerSync =
    existingJoinClientId !== undefined || remotePlayersOnline.length > 0;

  if (needsMultiplayerSync) {
    await profileAsync('multiplayer state (pre-join)', () =>
      waitForMultiplayerGameState(existingJoinClientId !== undefined ? 8000 : 3000),
    );
    syncPlayAreasFromGameLog();

    if (existingJoinClientId !== undefined && gameNeedsSnapshotSync(playerSessionId, currentGameId)) {
      const snapshotApplied = await profileAsync('acquire world snapshot (join)', () =>
        acquireWorldSnapshot(currentGameId, playerSessionId),
      );

      if (snapshotApplied && getLocalPlayArea()) {
        await profileAsync('finalize reconnected play area (join)', () =>
          finalizeReconnectedPlayArea(currentGameId, playerSessionId, initCardSystem),
        );
        markLoadProfile('join complete', { path: 'snapshot-reconnect' });
        return;
      }
    }
  } else {
    markLoadProfile('skipped multiplayer pre-sync — solo/new table');
  }

  if (existingJoinClientId !== undefined) {
    // Solo intentar reclamar el área de juego, sin replay del log como fuente de datos
    // El estado debe venir del snapshot o ser creado nuevo
    if (getLocalPlayArea()) {
      await profileAsync('finalize reconnected play area (join)', () =>
        finalizeReconnectedPlayArea(currentGameId, playerSessionId, initCardSystem),
      );
      markLoadProfile('join complete', { path: 'reconnect-existing' });
      return;
    }

    const reclaimed = await profileAsync('reclaim local play area (join)', () =>
      reclaimLocalPlayArea(
        existingJoinClientId,
        currentGameId,
        playerSessionId,
        initCardSystem,
        { maxReplayWaitMs: 5_000, maxAreaWaitMs: 10_000, skipReplayWait: true },
      ),
    );
    if (reclaimed) {
      markLoadProfile('join complete', { path: 'reclaim' });
      return;
    }
  }

  let deck = settings.deck;

  let counters = deck?.counters ?? [];

  await profileAsync('card back texture (new game)', () =>
    setCardBackTexture(unwrap(settings.cardSystem.cardBack) ?? DEFAULT_CARD_BACK),
  );

  playArea = await profileAsync('PlayArea.FromDeck', () =>
    PlayArea.FromDeck(provider.awareness.clientID, deck),
  );
  playArea.index = players().length;
  playArea.playerSessionId = playerSessionId;

  setPlayAreas(provider.awareness.clientID, playArea);
  playArea.setAsLocalPlayArea();
  setLocalPlayerClientId(playArea.clientId);
  registerPlayerSession(playerSessionId, playArea.clientId);

  const advice = await profileAsync('how it plays advice', () =>
    resolveHowItPlaysAdviceForDeck(deck),
  );
  initHowItPlaysAdvice(advice, playerSessionId);

  setIsIntitialized(true);
  setCounters(existing => uniqBy([...counters, ...existing], 'id'));

  playArea.subscribeEvents(sendEvent);
  provider.awareness.setLocalStateField('life', settings.startingLife);
  if (isMagicCardSystem(settings.cardSystem)) {
    provider.awareness.setLocalStateField(
      'commanderLife',
      settings.startingCommanderLife ?? DEFAULT_COMMANDER_LIFE,
    );
  }
  provider.awareness.setLocalStateField('name', settings.name);
  provider.awareness.setLocalStateField('playerSessionId', playerSessionId);
  provider.awareness.setLocalStateField(
    'color',
    settings.playerColor ?? resolvePlayerColor({ name: settings.name }),
  );
  sendEvent({ type: 'join', payload: playArea.getLocalState() });
  counters.forEach(counter => sendEvent({ type: 'createCounter', counter }));

  await profileAsync('opening hand', async () => {
    await drawCards(playArea, OPENING_HAND_SIZE);
    await processEvents();
  });

  saveGameMeta(currentGameId, {
    name: settings.name,
    life: settings.startingLife,
    ...(isMagicCardSystem(settings.cardSystem)
      ? {
          commanderLife: settings.startingCommanderLife ?? DEFAULT_COMMANDER_LIFE,
        }
      : {}),
    cardSystemUri: settings.cardSystem.uri ?? '',
    deckId: settings.deck?.id,
  });

  persistJoinBinding(currentGameId, {
    playerSessionId,
    clientId: playArea.clientId,
  });

  hand = playArea.hand;

  ensurePlayAreaOnTable(playArea);

  readjustPlayAreas();
  playArea.hand.updatePositions?.();
  finishHistoricalLogReplay();
  setEventCatchUpComplete(true);
  refreshMultiplayerSyncState();

  requestAnimationFrame(() => renderer?.compile(scene, camera));

  if (remotePlayersOnline.length > 0) {
    void waitForMultiplayerGameState(5000).then(() => refreshMultiplayerSyncState());
  }

  markLoadProfile('join complete', {
    path: 'new game',
    deckCards: playArea.deck.cards.length,
    remotePlayers: remotePlayersOnline.length,
  });
}

let focusPanelScaleTarget = settings.focusPanelScale;
let focusPanelScaleDisplayed = settings.focusPanelScale;

function updateFocusPanelScaleSmoothing() {
  if (!hoverSignal()?.mesh) {
    focusPanelScaleTarget = settings.focusPanelScale;
    focusPanelScaleDisplayed = settings.focusPanelScale;
    return;
  }

  if (Math.abs(focusPanelScaleDisplayed - focusPanelScaleTarget) < 0.002) {
    focusPanelScaleDisplayed = focusPanelScaleTarget;
  } else {
    focusPanelScaleDisplayed += (focusPanelScaleTarget - focusPanelScaleDisplayed) * 0.22;
  }

  if (Math.abs(settings.focusPanelScale - focusPanelScaleDisplayed) > 0.002) {
    setSettings('focusPanelScale', focusPanelScaleDisplayed);
    updateFocusPanelSize(focusPanelScaleDisplayed);
  }
}

function onDocumentScroll(event: WheelEvent) {
  if (hoverSignal()?.mesh) {
    event.preventDefault();
    const step = event.deltaY > 0 ? -0.05 : 0.05;
    focusPanelScaleTarget = Math.min(
      FOCUS_PANEL_MAX_SCALE,
      Math.max(FOCUS_PANEL_MIN_SCALE, focusPanelScaleTarget + step),
    );
    return;
  }

  if (scrollTarget()) {
    scrollTarget().dispatchEvent({ type: 'scroll', event });
    return;
  }
}

let postDragClickGuard: (() => void) | null = null;

function activatePostDragClickGuard(timeoutMs = 50) {
  postDragClickGuard?.();

  let active = true;
  const onClickCapture = (event: MouseEvent) => {
    if (!active) return;
    active = false;
    cleanup();
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const cleanup = () => {
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('pointerup', onPointerUpCapture, true);
    clearTimeout(timer);
    if (postDragClickGuard === cleanup) {
      postDragClickGuard = null;
    }
  };

  const onPointerUpCapture = (event: PointerEvent) => {
    if (!active) return;
    event.stopImmediatePropagation();
  };

  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('pointerup', onPointerUpCapture, true);
  const timer = window.setTimeout(cleanup, timeoutMs);
  postDragClickGuard = cleanup;
}

function finishPingWheelInteraction(clientX: number, clientY: number) {
  const pingSelection = finishPingWheelDrag(clientX, clientY);
  if (!pingSelection) return false;

  publishTablePingFromHit(pingSelection.hit, pingSelection.type);
  suppressBoardInteractionAfterPing();
  activatePostDragClickGuard(400);
  return true;
}

function isUnderLocalDeck(object: THREE.Object3D): boolean {
  const localArea = getLocalPlayArea();
  if (!localArea) return false;
  let node: Object3D | null = object;
  while (node) {
    if (node === localArea.deck.mesh) return true;
    node = node.parent;
  }
  return false;
}

function isDeckZoneObject(object: THREE.Object3D): boolean {
  let node: Object3D | null = object;
  while (node) {
    const ud = node.userData;
    if (ud?.location === 'deck' || ud?.zone === 'deck') return true;
    node = node.parent;
  }
  return false;
}

function resolveContextMenuTarget(object: THREE.Object3D): THREE.Object3D {
  if (isUnderLocalDeck(object)) {
    let current: Object3D | null = object;
    while (current) {
      const ud = current.userData;
      if (ud?.location === 'deck' || ud?.zone === 'deck') return current;
      current = current.parent;
    }
  }

  let current: Object3D | null = object;
  while (current) {
    const ud = current.userData;
    if (ud?.isInteractive && ud?.id && ud?.location) return current;
    current = current.parent;
  }
  return object;
}

function onContextMenu(event: PointerEvent) {
  event.preventDefault();
  if (isGameplayBlocked()) return;
  updateMouse(event);
  raycaster.setFromCamera(mouse, camera);
  let intersects = raycaster.intersectObject(scene);

  if (!intersects.length) return;
  let target = resolveContextMenuTarget(intersects[0].object);
  if (!target) return;
  if (isDeckZoneObject(target) && !isUnderLocalDeck(target)) return;
  if (target.userData.location === 'hand' && !isUnderLocalHand(target)) return;

  setContextMenuSignal({
    mouse: { x: event.x, y: event.y },
    target,
  });
}

function findTablePingHit(): THREE.Intersection | undefined {
  const targets: THREE.Object3D[] = [table];
  Object.values(playAreas).forEach(area => {
    if (area) targets.push(area.battlefieldZone.mesh);
  });

  const hits = raycaster.intersectObjects(targets, true);
  for (const hit of hits) {
    if (!hit.face) continue;
    if (isCardPingTarget(hit.object)) continue;
    return hit;
  }
  return undefined;
}

function publishQuickRegularPing() {
  if (isGameplayBlocked()) return;
  if (isSpectating()) return;
  if (!getLocalPlayArea()) return;

  raycaster.setFromCamera(mouse, camera);
  const tableHit = findTablePingHit();
  if (tableHit) {
    publishTablePingFromHit(tableHit, 'regular');
  }
}

function onAuxClick(event: MouseEvent) {
  if (event.button !== 1) return;
  event.preventDefault();
}

function onDocumentClick(event: PointerEvent) {
  if (isBoardInteractionSuppressed()) return;
  if (isGameplayBlocked()) return;
  updateMouse(event);
  setContextMenuSignal();
  raycaster.setFromCamera(mouse, camera);
  let intersects = raycaster.intersectObject(scene);

  if (selection.onClick(event, intersects[0]?.object)) return;

  if (dragTargets?.length) return;

  if (!intersects.length) return;

  let target = intersects[0].object;

  if (!target) return;

  const clickedCard = getCardMesh(target);
  if (clickedCard && keyboardHandHoverIndex !== undefined) {
    const area = getLocalPlayArea();
    const pinnedMesh = area?.hand.cards[keyboardHandHoverIndex]?.mesh;
    if (clickedCard !== pinnedMesh) {
      releaseKeyboardHandHover();
    }
  }

  if (target.userData.isAnimating && !['battlefield', 'hand'].includes(target.userData.location))
    return;

  if (target.userData.zone === 'battlefield') {
    setHoverSignal({ mouse });
  } else if (target.userData.location === 'battlefield') {
    const cardMesh = clickedCard ?? getCardMesh(target);
    if (cardMesh) {
      getLocalPlayArea()?.tap(cardMesh as THREE.Mesh);
    }

    flushDispatchEventQueue().then(() => {
      setHoverSignal(signal => {
        focusOn(target);
        const tether = getCardMeshTetherPoint(target);
        return {
          mouse,
          ...signal,
          tether,
        };
      });
    });
  } else if (target.userData.location === 'graveyard') {
    resolvePlayAreaForZoneClick(target)?.peekGraveyard();
  } else if (target.userData.location === 'exile') {
    resolvePlayAreaForZoneClick(target)?.peekExile();
  }

  if (target.parent?.userData.isInteractive) {
    target = target.parent;
  }

  if (isDeckZoneObject(target) && !isUnderLocalDeck(target)) return;
  if (target.userData.location === 'hand' && !isUnderLocalHand(target)) return;

  target.dispatchEvent({ type: 'click', event });
}

function resolvePlayAreaForZoneClick(target: THREE.Object3D): PlayArea | undefined {
  const clientId = target.userData.clientId;
  if (clientId != null) {
    return playAreas[clientId];
  }

  const zoneId = target.userData.zoneId ?? target.userData.id;
  if (!zoneId) return undefined;

  for (const area of Object.values(playAreas)) {
    if (!area) continue;
    if (area.graveyardZone.id === zoneId || area.exileZone.id === zoneId) {
      return area;
    }
  }

  return undefined;
}

function resolveStackTopCardMesh(zoneId: string | undefined) {
  if (!zoneId) return undefined;
  const zone = zonesById.get(zoneId);
  if (!zone || !('cards' in zone) || !zone.cards.length) return undefined;
  return zone.cards[zone.cards.length - 1].mesh;
}

function resolveInteractiveTarget(object: THREE.Object3D): THREE.Object3D {
  let current: THREE.Object3D | null = object;
  while (current) {
    const ud = current.userData;
    if (ud?.isOrnament) {
      current = current.parent;
      continue;
    }
    if (ud?.isInteractive && ud?.id && cardsById.has(ud.id)) return current;
    if (ud?.zone === 'deck') return current;
    if (
      ud?.location === 'graveyard' ||
      ud?.location === 'exile' ||
      ud?.zone === 'graveyard' ||
      ud?.zone === 'exile'
    ) {
      const topCard = resolveStackTopCardMesh(ud.zoneId ?? ud.id);
      if (topCard) return topCard;
    }
    current = current.parent;
  }
  return object;
}

function onDocumentDragStart(event: PointerEvent) {
  event.preventDefault();
  updateMouse(event);
  dragStartMouse.copy(mouse);
  event.dataTransfer.dropEffect = 'move';
  if (isGameplayBlocked()) return;
  raycaster.setFromCamera(mouse, camera);
  if (isSpectating()) return;

  if (isPingModifierHeld() && getLocalPlayArea()) {
    const tableHit = findTablePingHit();
    if (tableHit) {
      const emptyDragImage = new Image();
      emptyDragImage.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      event.dataTransfer.setDragImage(emptyDragImage, 0, 0);
      startPingWheelDrag(tableHit, event.clientX, event.clientY);
      return;
    }
  }

  let intersects = raycaster.intersectObject(scene);
  if (!intersects.length) return;

  let intersection = intersects[0];
  let target = resolveInteractiveTarget(intersection.object);
  let targets = [target];

  if (target.userData.zone === 'deck' || target.userData.location === 'deck') return;
  if (target.userData.location === 'hand' && !isUnderLocalHand(target)) return;
  if (!cardsById.has(target.userData.id)) return;

  if (!target.userData.isInteractive) {
    setHoverSignal();
    selection.startRectangleSelection(event);
    return;
  }

  if (selection.selectedItems.length && selection.selectedItems.includes(intersection.object)) {
    targets = selection.selectedItems.slice();
  }

  // prevent dragging targets in the reveal zone
  targets = targets.filter(target => target.userData.location !== 'reveal');

  let origin = new THREE.Vector3(0, 0, 0);
  targets.forEach(target => {
    target.userData.mouseDistance = target
      .worldToLocal(intersection.point.clone())
      .distanceTo(origin);
  });

  targets.sort((a, b) => {
    return b.userData.mouseDistance - a.userData.mouseDistance;
  });

  if (targets.length > 0) {
    targets.forEach((target, i) => {
      clearSpanishPreviewForCard(target.userData.id);

      const dragOffset = new THREE.Vector3(
        0,
        CARD_STACK_OFFSET * (targets.length - i - 1),
        CARD_THICKNESS * (i + 1),
      );

      setCardData(target, 'isDragging', true);
      setCardData(target, 'dragOffset', dragOffset.toArray());
      setCardData(target, 'dragQuat', target.quaternion.toArray());
    });
  }

  dragTargets = targets;
}

function resolveDropZone(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    const ud = current.userData;
    const zoneId = ud?.zoneId ?? (ud?.zone === 'deck' || ud?.zone === 'hand' ? ud?.id : undefined);
    if (zoneId) {
      const zone = zonesById.get(zoneId);
      if (zone) return zone;
    }
    current = current.parent;
  }
  return undefined;
}

function getHandDropInsertIndex(hand: Hand, intersection: THREE.Intersection | undefined, dragged: THREE.Object3D[]) {
  return hand.getDropInsertIndex(
    mouse,
    intersection,
    dragged.map(target => target.userData.id),
  );
}

function isHandZoneHit(intersection: THREE.Intersection) {
  const zone = resolveDropZone(intersection.object);
  return zone?.zone === 'hand' || intersection.object.userData.location === 'hand';
}

function isPriorityStackZoneHit(intersection: THREE.Intersection) {
  const zone = resolveDropZone(intersection.object);
  if (zone && ['deck', 'graveyard', 'exile', 'battlefield'].includes(zone.zone)) return true;

  const location = intersection.object.userData.location;
  return location === 'deck' || location === 'graveyard' || location === 'exile';
}


function isDraggingOutOfHand(dragged: THREE.Object3D[]) {
  if (!dragged.every(target => target.userData.location === 'hand')) return false;
  return mouse.y > dragStartMouse.y + HAND_DRAG_OUT_NDC_DELTA;
}

function shouldUseHandDropTargeting(dragged: THREE.Object3D[]) {
  const hand = getLocalPlayArea()?.hand;
  if (!hand?.isLocalHand || !hand.isMouseInDropZone(mouse)) return false;
  return !isDraggingOutOfHand(dragged);
}

function getDragRestackIntersections(dragged: THREE.Object3D[]) {
  const hand = getLocalPlayArea()?.hand;
  if (shouldUseHandDropTargeting(dragged)) {
    const handIntersection = hand!.findDragIntersection(raycaster, mouse);
    if (handIntersection) return [handIntersection];
  }

  const targetsById = Object.fromEntries(dragged.map(target => [target.userData.id, target]));
  const filtered = raycaster.intersectObject(scene).filter(hit => {
    if (targetsById[hit.object.userData.id]) return false;
    if (isHandZoneHit(hit)) return false;
    return true;
  });
  if (filtered.length) return filtered;

  if (isDraggingOutOfHand(dragged)) {
    const zoneBoxes: THREE.Object3D[] = [];
    for (const area of Object.values(playAreas)) {
      zoneBoxes.push(area.battlefieldZone.mesh);
    }
    return raycaster.intersectObjects(zoneBoxes, false);
  }

  return filtered;
}

function resolveDragDropIntersection(dragged: THREE.Object3D[]) {
  const hand = getLocalPlayArea()?.hand;
  if (shouldUseHandDropTargeting(dragged)) {
    return hand!.findDragIntersection(raycaster, mouse);
  }

  return findDropIntersection(dragged, { excludeHand: true });
}

function updateHandDragPreview(dragged: THREE.Object3D[]) {
  const hand = getLocalPlayArea()?.hand;
  if (!hand?.isLocalHand || !shouldUseHandDropTargeting(dragged)) {
    hand?.clearDragPreview();
    return;
  }

  const handIntersection = hand.findDragIntersection(raycaster, mouse);
  if (!handIntersection) {
    hand.clearDragPreview();
    return;
  }

  hand.setDragPreview(
    getHandDropInsertIndex(hand, handIntersection, dragged),
    dragged.map(target => target.userData.id),
  );
}

/** Raycast zone containers only so dragged cards do not block drops onto the battlefield. */
function findDropIntersection(
  dragged: THREE.Object3D[],
  { excludeHand = false }: { excludeHand?: boolean } = {},
) {
  const targetsById = Object.fromEntries(dragged.map(target => [target.userData.id, target]));
  const sceneHits = raycaster.intersectObject(scene);

  for (const hit of sceneHits) {
    if (targetsById[hit.object.userData.id]) continue;
    if (excludeHand && isHandZoneHit(hit)) continue;
    if (isPriorityStackZoneHit(hit)) return hit;
  }

  for (const hit of sceneHits) {
    if (targetsById[hit.object.userData.id]) continue;
    if (excludeHand && isHandZoneHit(hit)) continue;
    if (resolveDropZone(hit.object)) return hit;
    if (
      hit.object.userData.isInteractive ||
      hit.object.userData.zone ||
      hit.object.userData.location === 'deck'
    ) {
      return hit;
    }
  }

  const zoneBoxes: THREE.Object3D[] = [];
  for (const area of Object.values(playAreas)) {
    zoneBoxes.push(area.battlefieldZone.mesh);
  }

  const zoneHits = raycaster.intersectObjects(zoneBoxes, false);
  for (const hit of zoneHits) {
    if (resolveDropZone(hit.object)) return hit;
  }
}

function getBattlefieldDropPosition(
  toZone: { mesh: THREE.Object3D },
  intersection: THREE.Intersection,
  targets: THREE.Object3D[],
  target: THREE.Object3D,
) {
  const localPoint = toZone.mesh.worldToLocal(intersection.point.clone());
  const anchor = resolveStackAnchor(localPoint, toZone.mesh, targets);
  const offset = target.userData.dragOffset
    ? new THREE.Vector3().fromArray(target.userData.dragOffset)
    : new THREE.Vector3();
  return anchor.clone().add(offset);
}

function onDocumentDragEnd(event: DragEvent) {
  if (!isPingWheelDragActive()) return;

  event.preventDefault();
  event.stopPropagation();
  finishPingWheelInteraction(event.clientX, event.clientY);
}

async function onDocumentDrop(event) {
  event.preventDefault();
  updateMouse(event);
  if (isGameplayBlocked()) return;

  if (finishPingWheelInteraction(event.clientX, event.clientY)) {
    event.stopImmediatePropagation();
    return;
  }

  if (isBoardInteractionSuppressed()) return;

  if (isPingWheelDragActive()) {
    cancelPingWheelDrag();
    return;
  }

  if (selection.isDown || selection.helper.enabled) {
    selection.completeRectangleSelection(event);
  }
  if (!dragTargets?.length) return;

  const dragged = dragTargets.slice();
  dragTargets = [];
  activatePostDragClickGuard();

  try {
    raycaster.setFromCamera(mouse, camera);

    let intersection = resolveDragDropIntersection(dragged);
    if (!intersection) return;

    let shouldClearSelection = false;
    const toZone = resolveDropZone(intersection.object);
    if (!toZone) return;
    if (toZone.zone === 'hand' && !isLocalHandZone(toZone)) return;
    const toZoneId = toZone.id;

    restackItemsLocally(dragged, getDragRestackIntersections(dragged));

    const sameZoneTargets: THREE.Object3D[] = [];
    let nextHandInsertIndex =
      toZone.zone === 'hand'
        ? getHandDropInsertIndex(toZone as Hand, intersection, dragged)
        : undefined;

    for (const target of dragged) {
      setCardData(target, 'isDragging', false);

      let fromZoneId = target.userData.zoneId;
      let fromZone = zonesById.get(fromZoneId)!;
      expect(!!fromZone, `fromZone not found `, { fromZone });

      if (fromZoneId && fromZoneId === toZoneId) {
        if (toZone.zone === 'hand') {
          const hand = toZone as Hand;
          const card = cardsById.get(target.userData.id)!;
          const insertIndex = nextHandInsertIndex ?? hand.cards.indexOf(card);
          dispatchGameEvent(
            createTransferCardEvent(card, hand, hand, {
              addOptions: {
                insertIndex,
                skipLocalAnimation: true,
              },
            }),
          );
          if (nextHandInsertIndex !== undefined) nextHandInsertIndex++;
          shouldClearSelection = true;
          continue;
        }

        setCardData(target, `zone.${toZone.id}.position`, target.position.toArray());
        setCardData(target, `zone.${toZone.id}.rotation`, target.rotation.toArray());
        sameZoneTargets.push(target);
        continue;
      }

      let card = cardsById.get(target.userData.id);
      if (!card) {
        const cardMesh = getCardMesh(target);
        if (cardMesh) card = cardsById.get(cardMesh.userData.id);
      }
      let position =
        toZone.zone === 'battlefield'
          ? getBattlefieldDropPosition(toZone, intersection, dragged, target)
          : toZone.mesh.worldToLocal(intersection.point.clone());
      expect(!!card, `card not found`, { card });

      dispatchGameEvent(
        createTransferCardEvent(card, fromZone, toZone, {
          addOptions: {
            ...(toZone.zone !== 'hand' ? { skipLocalAnimation: true } : {}),
            ...(toZone.zone === 'deck'
              ? { location: 'top' as const }
              : toZone.zone === 'hand'
                ? { insertIndex: nextHandInsertIndex ?? toZone.cards.length }
                : { positionArray: position.toArray() }),
          },
        }),
      );
      if (toZone.zone === 'hand' && nextHandInsertIndex !== undefined) nextHandInsertIndex++;
      shouldClearSelection = true;
    }

    if (sameZoneTargets.length > 0) {
      dispatchGameEvent(createRestackEvent(intersection, sameZoneTargets));
    }

    await flushDispatchEventQueue();

    if (shouldClearSelection) {
      selection.clearSelection();
    }

    if (dragged.length) {
      setHoverSignal(signal => {
        let mesh = signal?.mesh ?? dragged[0];
        focusOn(mesh);
        const tether = getCardMeshTetherPoint(mesh);
        return {
          mouse,
          ...(signal ?? {}),
          tether,
          mesh,
        };
      });
    }
  } finally {
    getLocalPlayArea()?.hand.clearDragPreview();
    for (const target of dragged) {
      setCardData(target, 'isDragging', false);
    }
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  composer.setSize(window.innerWidth, window.innerHeight);

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  updateFocusPanelSize();

  css3dRenderer?.setSize(window.innerWidth, window.innerHeight);

  Object.values(playAreas).forEach(playArea => playArea.updatePositions());
}

function onDocumentMouseMove(event) {
  cameraMouse.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  );
  if (isPingWheelDragActive()) {
    updatePingWheelHover(event.clientX, event.clientY);
  }
  if (dragTargets?.length) {
    updateMouse(event);
  }
}

function onDocumentMouseLeave() {
  onCameraMouseLeave();
  if (isPingWheelDragActive()) {
    cancelPingWheelDrag();
  }
}

function updateMouse(event) {
  mouse.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  );
}

function onRendererMouseMove(event) {
  updateMouse(event);

  if (isPingWheelDragActive()) {
    updatePingWheelHover(event.clientX, event.clientY);
    return;
  }

  selection.onMove(event);

  if (dragTargets?.length) {
    raycaster.setFromCamera(mouse, camera);

    restackItemsLocally(dragTargets, getDragRestackIntersections(dragTargets));
    updateHandDragPreview(dragTargets);

    if (hoverSignal()) {
      setHoverSignal(signal => {
        if (signal.mesh) {
          focusOn(signal.mesh);
          const tether = getCardMeshTetherPoint(signal.mesh);
          return {
            mouse,
            ...signal,
            tether,
          };
        } else {
          return {
            ...signal,
            mouse,
          };
        }
      });
    }
  } else {
    setHoverSignal(signal => {
      if (!signal) return { mouse };
      return { ...signal, mouse };
    });
  }
}

let ticks = 0;
let interval = 1 / 30;
let isErrored = false;

export function animate() {
  if (tearingDown) return;
  try {
    if (isErrored) return;
    if (animating()) requestAnimationFrame(animate);
    let delta = clock.getDelta();
    ticks += delta;
    time += delta;

    if (ticks >= interval) {
      render3d(delta);
      ticks = ticks % interval;
    }
  } catch (e) {
    devLog.error(e);
    setCapturedErrors(errors => [...errors, e]);
    isErrored = true;
  }
}

export function startAnimating() {
  if (animating()) return;
  initClock();
  setAnimating(true);
  animate();
}

let hover: { object: THREE.Object3D; colors: THREE.Color[] } | undefined;
let keyboardHandHoverIndex: number | undefined;
/** Card under the mouse when hand zoom was activated; mouse may stay there without taking over. */
let keyboardHandHoverMouseLock: string | undefined;

function restoreHoverMaterialColors() {
  if (!hover?.object || !hover.colors.length) return;

  const materials = Array.isArray(hover.object.material)
    ? hover.object.material
    : hover.object.material
      ? [hover.object.material]
      : [];

  materials.forEach((mat, i) => {
    const saved = hover!.colors[i];
    if (!saved || typeof mat?.color?.set !== 'function') return;
    mat.color.set(saved);
  });
}

function applyHoverTarget(mesh: THREE.Object3D) {
  const tether = getCardMeshTetherPoint(mesh);
  hover = { object: mesh, colors: [] };
  setCounterLabelHoverTarget(mesh.userData?.id ?? null);
  setHoverSignal({ mesh: mesh as THREE.Mesh, tether, mouse });
  focusOn(mesh);
  outlinePass.selectedObjects = [mesh];
}

export function dismissZoomPanel() {
  const area = getLocalPlayArea();
  if (keyboardHandHoverIndex !== undefined) {
    area?.hand.clearFocus();
    keyboardHandHoverIndex = undefined;
    keyboardHandHoverMouseLock = undefined;
  }

  if (hover?.object) {
    if (hover.object.userData?.location === 'hand') {
      hover.object.dispatchEvent({ type: 'mouseout', mesh: hover.object });
    }
    restoreHoverMaterialColors();
    hover = undefined;
  }

  outlinePass.selectedObjects = [];
  clearHoverSignal();
}

export function clearKeyboardHandHover() {
  if (keyboardHandHoverIndex === undefined) return;
  const area = getLocalPlayArea();
  area?.hand.clearFocus();
  keyboardHandHoverIndex = undefined;
  keyboardHandHoverMouseLock = undefined;
  if (hover?.object?.userData?.location === 'hand') {
    hover.object.dispatchEvent({ type: 'mouseout', mesh: hover.object });
    hover = undefined;
    outlinePass.selectedObjects = [];
    clearHoverSignal();
  }
}

function releaseKeyboardHandHover() {
  if (keyboardHandHoverIndex === undefined) return;
  getLocalPlayArea()?.hand.clearFocus();
  keyboardHandHoverIndex = undefined;
  keyboardHandHoverMouseLock = undefined;
}

function showKeyboardHandHoverAtIndex(zeroIndex: number) {
  const area = getLocalPlayArea();
  if (!area) return;
  if (zeroIndex < 0 || zeroIndex >= area.hand.cards.length) return;

  if (keyboardHandHoverIndex !== undefined && keyboardHandHoverIndex !== zeroIndex) {
    area.hand.clearFocus();
  }

  if (keyboardHandHoverIndex === undefined) {
    keyboardHandHoverMouseLock = hover?.object?.uuid;
  }

  keyboardHandHoverIndex = zeroIndex;
  area.hand.focusCardAtIndex(zeroIndex, { keyboard: true });
  applyHoverTarget(area.hand.cards[zeroIndex].mesh);
}

export function setKeyboardHandHover(oneBasedIndex: number) {
  const area = getLocalPlayArea();
  if (!area) return;

  const zeroIndex = oneBasedIndex - 1;
  if (zeroIndex < 0 || zeroIndex >= area.hand.cards.length) return;

  if (keyboardHandHoverIndex === zeroIndex) {
    clearKeyboardHandHover();
    return;
  }

  showKeyboardHandHoverAtIndex(zeroIndex);
}

export function navigateKeyboardHandHover(direction: -1 | 1) {
  const area = getLocalPlayArea();
  if (!area || area.hand.cards.length === 0) return;

  const nextIndex =
    keyboardHandHoverIndex === undefined
      ? 0
      : (keyboardHandHoverIndex + direction + area.hand.cards.length) % area.hand.cards.length;

  showKeyboardHandHoverAtIndex(nextIndex);
}

function syncKeyboardHandHover() {
  const area = getLocalPlayArea();
  if (!area || keyboardHandHoverIndex === undefined) return;

  const card = area.hand.cards[keyboardHandHoverIndex];
  if (!card) {
    clearKeyboardHandHover();
    return;
  }

  applyHoverTarget(card.mesh);
}

function shouldYieldHandZoomToMouse(next?: THREE.Object3D) {
  if (keyboardHandHoverIndex === undefined) return false;
  if (!next) return false;

  const nextCard = getCardMesh(next) ?? next;
  if (keyboardHandHoverMouseLock === undefined) return true;
  return nextCard.uuid !== keyboardHandHoverMouseLock;
}

function getCardMesh(target: THREE.Object3D | undefined) {
  if (!target?.userData?.id) return;
  if (cardsById.has(target.userData.id)) return target;
  if (target.parent?.userData?.id && cardsById.has(target.parent.userData.id)) {
    return target.parent;
  }
}

function clearHoverSignal() {
  clearSpanishPreview();
  setCounterLabelHoverTarget(null);
  setHoverSignal(signal => (signal?.mouse ? { mouse: signal.mouse } : undefined));
  focusCamera.userData.target = undefined;
  cancelAnimation(focusCamera);
}

function highlightHover(intersects: THREE.Intersection<THREE.Object3D<THREE.Object3DEventMap>>[]) {
  let needsCleanup = false;
  let next;
  let target = intersects?.[0]?.object;

  // select top of deck
  if (target?.parent?.userData.zone === 'deck') {
    target = target.parent?.children[0];
    let zone = zonesById.get(target.userData.zoneId);
    if (zone) {
      target = zone.cards[0].mesh;
    }
  }

  if (!intersects.length) needsCleanup = true;
  if (target !== hover?.object) {
    needsCleanup = true;
    let { isInteractive, isAnimating, location } = target?.userData ?? {};
    if (
      (isInteractive || ['graveyard', 'exile'].includes(location)) &&
      !isAnimating &&
      (location !== 'hand' || isUnderLocalHand(target))
    ) {
      next = target;
    }
  }

  if (keyboardHandHoverIndex !== undefined) {
    if (shouldYieldHandZoomToMouse(next)) {
      releaseKeyboardHandHover();
    } else {
      if (needsCleanup && hover) {
        clearSpanishPreview();
        restoreHoverMaterialColors();
        const pinnedMesh = getLocalPlayArea()?.hand.cards[keyboardHandHoverIndex]?.mesh;
        if (hover.object !== pinnedMesh) {
          hover.object.dispatchEvent({ type: 'mouseout', mesh: hover.object });
        }
        hover = undefined;
        outlinePass.selectedObjects = [];
      }
      syncKeyboardHandHover();
      return;
    }
  }

  if (needsCleanup && hover) {
    clearSpanishPreview();
    restoreHoverMaterialColors();

    const area = getLocalPlayArea();
    const pinnedMesh =
      keyboardHandHoverIndex !== undefined
        ? area?.hand.cards[keyboardHandHoverIndex]?.mesh
        : undefined;
    const skipMouseout = pinnedMesh && hover.object === pinnedMesh;

    if (!skipMouseout) {
      hover.object.dispatchEvent({ type: 'mouseout', mesh: hover.object });
    }
    hover = undefined;
    outlinePass.selectedObjects = [];
  }

  if (next) {
    const tether = getCardMeshTetherPoint(next);

    hover = { object: next, colors: [] };
    setCounterLabelHoverTarget(next.userData?.id ?? null);
    setHoverSignal({ mesh: next, tether, mouse });

    hover.object.dispatchEvent({ type: 'mousein', mesh: hover.object });
    focusOn(next);

    outlinePass.selectedObjects = [hover.object];
  } else if (needsCleanup) {
    if (keyboardHandHoverIndex !== undefined) {
      syncKeyboardHandHover();
      return;
    }
    clearHoverSignal();
  }
}

function focusOn(target: THREE.Object3D) {
  if (focusCamera.userData.target !== target.uuid) {
    cancelAnimation(focusCamera);
  }
  focusCamera.userData.target = target.uuid;
}

function render3d(delta: number) {
  renderAnimations(time);
  updateTextureAnimation(delta);
  updateWaterdrops(delta);
  updateFocusPanelScaleSmoothing();

  const tiltBlocked = isCameraTiltBlocked();
  updateCameraTiltBlockedState(tiltBlocked);

  if (settings.enableCameraTilt && !isSpectating() && !tiltBlocked) {
    animateCameraLook(cameraMouse.x, cameraMouse.y);
  } else {
    animateCameraTiltToRest();
  }

  Object.values(playAreas).forEach(playArea => {
    playArea?.updateNameTag(getPlayAreaPlayerName(playArea));
  });

  raycaster.setFromCamera(mouse, camera);

  if (!selection.enabled) {
    let intersects = raycaster.intersectObject(scene).filter(hit => {
      if (isSpectating()) return true;
      const localClientId = getLocalPlayerClientId();
      if (
        hit.object?.userData.clientId !== localClientId &&
        !hit.object?.userData.isPublic
      )
        return false;
      return true;
    });

    highlightHover(intersects);
  }

  let signal = hoverSignal();
  if (signal?.mesh) {
    const tetherPoint = getCardMeshTetherPoint(signal.mesh);
    if (!tetherPoint.equals(signal.tether)) {
      setHoverSignal(signal => ({
        ...signal,
        tether: getCardMeshTetherPoint(signal.mesh),
      }));
    }
  }

  // camera.lookAt(scene.position);
  composer.render();
  css3dRenderer?.render(scene, camera);
  patchCss3dPointerEvents();

  if (hoverSignal()?.mesh) {
    const mesh = hoverSignal().mesh as THREE.Object3D;
    updateFocusCamera(mesh);

    const focusLayerObjects: THREE.Object3D[] = [];
    mesh.traverse(obj => {
      if (obj.userData?.excludeFromFocusPanel) return;
      obj.layers.enable(FOCUS_PANEL_LAYER);
      focusLayerObjects.push(obj);
    });

    focusRenderer.render(scene, focusCamera);

    for (const obj of focusLayerObjects) {
      obj.layers.disable(FOCUS_PANEL_LAYER);
    }
  }
}

setAfterCameraViewChange(() => {
  onCameraViewChange();
  syncCameraDebugGuiFromActiveView();
});

export function setCameraViewByPlayerIndex(orderedIndex: number) {
  applyCameraViewByPlayerIndex(orderedIndex);
}

export function setCameraViewMode(mode: 'local' | 'opponent') {
  applyCameraViewMode(mode);
}

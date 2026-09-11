import ColorHash from 'color-hash';
import * as Comlink from 'comlink';
import { createEffect, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import * as THREE from 'three';
import {
  ArrowHelper,
  BoxGeometry,
  Clock,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IndexeddbPersistence } from 'y-indexeddb';
import { touchGameLastAccess } from './gamePersistence';
import { markLoadProfile, profileAsync } from './loadProfile';
import { WebsocketProvider } from 'y-websocket';
import { Doc } from 'yjs';
import { YArray, YMap } from 'yjs/dist/src/internals';
import {
  ANNOUNCEMENT_VISIBLE_DURATION,
  Card,
  CARD_HEIGHT,
  CARD_WIDTH,
  CardSystem,
  CardZone,
  ContextMenuSignal,
  GameState,
  HoverSignal,
  TABLE_COLOR,
} from './constants';
import type { CommanderBracketHowItPlaysSection } from './commanderBracket';
import type { PlayArea } from './playArea';
import { DEFAULT_CARD_BACK_URL } from './mtgCardSystem';
import TextureLoaderWorker from './textureLoaderWorker?worker';
import { type TextureLoaderWorkerType } from './textureLoaderWorker';
import { sanitizeGameLogEvent } from './gameLogEvents';
import { logReloadOther } from './reloadOtherPlayerDebug';
import { cleanupFromNode, getFocusCameraPositionRelativeTo } from './utils';
import { Selection } from './selection';
import { captureConsole } from './console-capture';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import GUI from 'lil-gui';
import { createLocalStore } from './localStore';
import {
  clearPlayerSessionRegistry,
  clearJoinBinding,
  unregisterPlayerSession,
  getOrCreatePlayerSessionId,
  persistJoinBinding,
  registerPlayerSession,
  setPlayerSessionId,
  iterateGameLogEvents,
} from './playerSession';
import { resetMultiplayerSyncState } from './multiplayerSync';
import { removePlayerFromTurnOrder } from './turnOrder';
import { clearWaterdrops } from './waterdropEffect';
import { clearPingSync } from './pingSync';
import { clearVideoPings } from './pingVideoEffect';
import { resetCameraView, captureLocalCameraView } from './cameraView';
import { setupCameraDebugGui, resetCameraDebugGui } from './cameraDebugGui';
import { clearSpanishPreview } from './spanishCardPreview';
import { devLog } from './devLog';
import { getPlayAreaPlayerEntry } from './playAreaNameTag';
import { resolvePlayerColor, syncLocalPlayerColor } from './playerColor';

export function expect(test: boolean, message: string, ...supplemental: any) {
  if (!test) {
    devLog.error(message, ...supplemental);
    throw new Error(message);
  }
}

export const logger = devLog;
export let clock: Clock;
export let loadingManager: LoadingManager;
export let textureLoader: TextureLoader;
export let renderer: WebGLRenderer;
export let css3dRenderer: CSS3DRenderer | null = null;
export let scene: Scene;
export let camera: PerspectiveCamera;
export let focusRenderer: WebGLRenderer;
export let focusCamera: PerspectiveCamera;
export let [hoverSignal, setHoverSignal] = createSignal<HoverSignal>();
export let [contextMenuSignal, setContextMenuSignal] = createSignal<ContextMenuSignal>();
export let [customCardSpawnScreenPoint, setCustomCardSpawnScreenPoint] = createSignal<{
  x: number;
  y: number;
} | null>(null);
export let cardsById = new Map<string, Card>();
export let zonesById = new Map<string, CardZone<unknown>>();
export let [playAreas, setPlayAreas] = createStore<Record<number, PlayArea>>({});
export let [peekFilterText, setPeekFilterText] = createSignal('');
export let [peekTypeFilter, setPeekTypeFilter] = createSignal<string | null>(null);
export let [cardSearchModalOpen, setCardSearchModalOpen] = createSignal(false);
export let [howItPlaysAdvice, setHowItPlaysAdvice] = createSignal<
  CommanderBracketHowItPlaysSection | undefined
>();
export let [howItPlaysHelpVisible, setHowItPlaysHelpVisible] = createSignal(false);
export let [howItPlaysModalOpen, setHowItPlaysModalOpen] = createSignal(false);
export let [howItPlaysHandTick, setHowItPlaysHandTick] = createSignal(0);

export function bumpHowItPlaysHandTick() {
  setHowItPlaysHandTick(value => value + 1);
}

export let [howItPlaysMulliganTick, setHowItPlaysMulliganTick] = createSignal(0);

export function notifyHowItPlaysMulligan() {
  bumpHowItPlaysHandTick();
  setHowItPlaysMulliganTick(value => value + 1);
}

export function hasLocalPlayerPlayedFromHand(
  log: YArray<unknown>,
  playerSessionId: string,
): boolean {
  let handId: string | undefined;
  let battlefieldId: string | undefined;

  for (const event of iterateGameLogEvents(log)) {
    if (event?.type === 'kick' && event.payload?.playerSessionId === playerSessionId) {
      handId = undefined;
      battlefieldId = undefined;
    }
    if (event?.type === 'join' && event.payload?.playerSessionId === playerSessionId) {
      handId = event.payload?.hand?.id as string | undefined;
      battlefieldId = event.payload?.battlefield?.id as string | undefined;
    }
    if (
      event?.type === 'transferCard' &&
      handId &&
      battlefieldId &&
      event.payload?.fromZoneId === handId &&
      event.payload?.toZoneId === battlefieldId
    ) {
      return true;
    }
  }

  return false;
}

export function initHowItPlaysAdvice(
  section?: CommanderBracketHowItPlaysSection,
  playerSessionId?: string,
) {
  setHowItPlaysAdvice(section);
  setHowItPlaysHandTick(0);
  const playedFromHand =
    !!playerSessionId && hasLocalPlayerPlayedFromHand(gameLog, playerSessionId);
  setHowItPlaysHelpVisible(!!section && !playedFromHand);
  setHowItPlaysModalOpen(false);
}

export function dismissHowItPlaysHelp() {
  setHowItPlaysHelpVisible(false);
  setHowItPlaysModalOpen(false);
}

export let [cardSearchModalData, setCardSearchModalData] = createSignal<{
  cards: Card[];
  zone: 'peek' | 'graveyard' | 'exile' | 'tokenSearch';
  title?: string;
  deckViewMode?: 'peek' | 'search';
  readOnly?: boolean;
} | null>(null);
export let ydoc = new Doc();

// Interceptar errores de serialización en el YDoc
ydoc.on('update', (update, origin) => {
  logReloadOther('ydoc-update', {
    origin: origin === null ? 'null' : typeof origin === 'string' ? origin : origin?.constructor?.name,
    updateBytes: update?.byteLength,
  });
});

export let table: Object3D;
export let gameLog: YArray<any>;
export let gameState: YMap<GameState>;
export let [animating, setAnimating] = createSignal(false);
export let [players, setPlayers] = createSignal([]);
export let [isInitialized, setIsIntitialized] = createSignal(false);
export let focusRayCaster: Raycaster;
export let arrowHelper = new ArrowHelper();
export const [scrollTarget, setScrollTarget] = createSignal();
export let provider: WebsocketProvider | WebrtcProvider;
let indexeddbPersistence: IndexeddbPersistence | null = null;
export let [logs, setLogs] = createStore([]);
export let [processedEvents, setProcessedEvents] = createSignal(0);
let gameStateImportInProgress = false;
let eventCatchUpComplete = false;
let syncPaused = false;
let gameplayBlocked = false;

export function setSyncPaused(value: boolean) {
  syncPaused = value;
}

export function isSyncPaused() {
  return syncPaused;
}

export function setGameplayBlocked(value: boolean) {
  gameplayBlocked = value;
}

export function isGameplayBlocked() {
  return gameplayBlocked;
}

export function setEventCatchUpComplete(value: boolean) {
  eventCatchUpComplete = value;
}

export function isEventCatchUpComplete() {
  return eventCatchUpComplete;
}

/** True while rebuilding table state from the persisted log (reload/reconnect). */
let historicalLogReplayInProgress = true;

export function isHistoricalLogReplayInProgress() {
  return historicalLogReplayInProgress;
}

export function finishHistoricalLogReplay() {
  historicalLogReplayInProgress = false;
}

export function hasPersistedGameState() {
  return !!indexeddbPersistence?.synced && gameLog.length > 0;
}

export function setGameStateImportInProgress(value: boolean) {
  gameStateImportInProgress = value;
}

export function isGameStateImportInProgress() {
  return gameStateImportInProgress;
}

export function resetGameSceneForReplay() {
  clearSpanishPreview();
  Object.values(playAreas).forEach(playArea => {
    if (playArea && table) table.remove(playArea.mesh);
    playArea?.destroy();
  });
  setPlayAreas({});
  cardsById.clear();
  zonesById.clear();
  setLogs([]);
  setProcessedEvents(0);
  setPlayerCount(0);
  clearPlayerSessionRegistry();
  setLocalPlayerClientId(undefined);
  setIsIntitialized(false);
  setEventCatchUpComplete(false);
  historicalLogReplayInProgress = true;
}
export let [isSpectating, setIsSpectating] = createSignal(false);
export let [playerCount, setPlayerCount] = createSignal(0);
export let orbitControls: OrbitControls;
export const PLAY_AREA_ROTATIONS = [0, Math.PI, Math.PI / 2, Math.PI / 2 + Math.PI];
export const colorHashLight = new ColorHash({ lightness: 0.7 });
export const colorHashDark = new ColorHash({ lightness: 0.2 });
export const [selectedDeckId, setSelectedDeckId] = createSignal<string | undefined>();
export const FOCUS_PANEL_BASE_HEIGHT_RATIO = 0.5;
/** Render layer used by the hover/zoom panel — only the hovered card is shown. */
export const FOCUS_PANEL_LAYER = 1;
export const FOCUS_PANEL_WIDE_ASPECT = 750 / 700;
export const FOCUS_PANEL_MIN_SCALE = 0.25;
export const FOCUS_PANEL_MAX_SCALE = 1.5;

export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 1;
export const SOUND_VOLUME_STEP = 0.05;

export const [settings, setSettings] = createLocalStore('settings', {
  enableCameraTilt: true,
  focusPanelScale: 1,
  playerColor: undefined as string | undefined,
  localSoundVolume: 0.65,
  remoteSoundVolume: 0.4,
});

export function cardShowsCounterModifiers(mesh?: THREE.Object3D) {
  if (!mesh) return false;
  if (mesh.userData?.isToken) return true;

  const mods = mesh.userData?.modifiers;
  if (!mods) return false;

  const declared = mods.counters;
  if (!declared) return false;
  return Object.values(declared).some(
    value => value !== 0 && value !== '' && value != null && value !== false,
  );
}

export function getFocusPanelAspect(mesh?: THREE.Object3D) {
  return cardShowsCounterModifiers(mesh) ? FOCUS_PANEL_WIDE_ASPECT : CARD_WIDTH / CARD_HEIGHT;
}

export function getFocusPanelDimensions(scale = settings.focusPanelScale, mesh?: THREE.Object3D) {
  const focusHeight = window.innerHeight * FOCUS_PANEL_BASE_HEIGHT_RATIO * scale;
  const focusWidth = focusHeight * getFocusPanelAspect(mesh);
  return { focusWidth, focusHeight };
}

export function updateFocusPanelSize(scale = settings.focusPanelScale, mesh?: THREE.Object3D) {
  if (!focusRenderer || !focusCamera) return;
  const targetMesh = mesh ?? hoverSignal()?.mesh;
  const { focusWidth, focusHeight } = getFocusPanelDimensions(scale, targetMesh);
  focusRenderer.setPixelRatio(window.devicePixelRatio);
  focusRenderer.setSize(focusWidth, focusHeight);
  focusCamera.aspect = focusWidth / focusHeight;
  focusCamera.updateProjectionMatrix();
}
export let textureLoaderWorker: Comlink.Remote<TextureLoaderWorkerType>;
export let gui: GUI = null;
export let baseCameraQuaternion: THREE.Quaternion;
export let [announcement, setAnnouncement] = createSignal<string | undefined>();
export let tearingDown = false;

export let selection: Selection;
export let [capturedErrors, setCapturedErrors] = createSignal([]);

export let cardLoadingTexture: THREE.Texture;
export let cardBackTexture: THREE.Texture;

export let [cardSystem, setCardSystem] = createStore<CardSystem>({} as CardSystem);

/** Stable client id from the original join event; used after reconnect when awareness id changes. */
let localPlayerClientId: number | undefined;

export function setLocalPlayerClientId(clientId: number | undefined) {
  localPlayerClientId = clientId;
}

export function getLocalPlayerClientId() {
  if (localPlayerClientId !== undefined) return localPlayerClientId;
  const awarenessId = provider?.awareness?.clientID;
  if (awarenessId !== undefined && playAreas[awarenessId]?.isLocalPlayArea) {
    return awarenessId;
  }
}

export function getLocalPlayArea(): PlayArea | undefined {
  const clientId = getLocalPlayerClientId();
  return clientId !== undefined ? playAreas[clientId] : undefined;
}

export function isLocalHandZone(zone: CardZone | undefined): boolean {
  if (!zone || zone.zone !== 'hand') return false;
  const localArea = getLocalPlayArea();
  return !!localArea && localArea.hand.id === zone.id;
}

export function isUnderLocalHand(object: THREE.Object3D): boolean {
  const localArea = getLocalPlayArea();
  if (!localArea) return false;

  let node: THREE.Object3D | null = object;
  while (node) {
    if (node === localArea.hand.mesh) return true;
    node = node.parent;
  }
  return false;
}

type LocalPlayAreaChangedHandler = (area: PlayArea) => void;
const localPlayAreaChangedHandlers = new Set<LocalPlayAreaChangedHandler>();

export function onLocalPlayAreaChanged(handler: LocalPlayAreaChangedHandler) {
  localPlayAreaChangedHandlers.add(handler);
  return () => {
    localPlayAreaChangedHandlers.delete(handler);
  };
}

function notifyLocalPlayAreaChanged(area: PlayArea) {
  localPlayAreaChangedHandlers.forEach(handler => handler(area));
}

/** Reclaim control of an existing seat after a mistaken new-player assignment. */
export function playAsPlayer(targetClientId: number, gameId: string): boolean {
  if (targetClientId === getLocalPlayerClientId()) return false;

  const target = playAreas[targetClientId];
  if (!target || !provider) return false;

  const previous = getLocalPlayArea();
  if (previous && previous.clientId !== targetClientId) {
    previous.unsetAsLocalPlayArea();
    previous.unsubscribeEvents(sendEvent);
  }

  target.setAsLocalPlayArea();
  target.subscribeEvents(sendEvent);
  setLocalPlayerClientId(targetClientId);
  setIsIntitialized(true);
  setIsSpectating(false);

  const targetEntry = getPlayAreaPlayerEntry(target);
  const adoptedSessionId = target.playerSessionId ?? targetEntry?.playerSessionId;
  const playerSessionId = adoptedSessionId ?? getOrCreatePlayerSessionId(gameId);

  if (adoptedSessionId) {
    setPlayerSessionId(gameId, adoptedSessionId);
  }
  persistJoinBinding(gameId, { playerSessionId, clientId: targetClientId });
  registerPlayerSession(playerSessionId, targetClientId);

  provider.awareness.setLocalStateField('playerSessionId', playerSessionId);
  if (targetEntry?.name) provider.awareness.setLocalStateField('name', targetEntry.name);
  if (targetEntry?.life !== undefined) provider.awareness.setLocalStateField('life', targetEntry.life);
  if (targetEntry?.commanderLife !== undefined) {
    provider.awareness.setLocalStateField('commanderLife', targetEntry.commanderLife);
  }

  const color = targetEntry?.color ?? resolvePlayerColor({ name: targetEntry?.name });
  provider.awareness.setLocalStateField('color', color);
  syncLocalPlayerColor(color);

  setHoverSignal(undefined);
  setContextMenuSignal(undefined);
  notifyLocalPlayAreaChanged(target);

  return true;
}

export function isLocalCardGridSearchOpen() {
  const area = getLocalPlayArea();
  if (!area) return false;
  return (
    area.peekZone.cards.length > 0 ||
    area.revealZone.cards.length > 0 ||
    area.tokenSearchZone.cards.length > 0
  );
}

export function isCameraTiltBlocked() {
  if (cardSearchModalOpen()) return true;
  const area = getLocalPlayArea();
  return (area?.tokenSearchZone.cards.length ?? 0) > 0;
}

export const DEFAULT_CARD_BACK = DEFAULT_CARD_BACK_URL;

[('warn', 'error')].forEach(captureConsole);

export function doXTimes(x: number, callback, delay = 5): Promise<void> {
  if (x < 1) return Promise.resolve();
  return new Promise<void>(resolve => {
    new Array(x).fill(0).forEach((_, i) =>
      setTimeout(() => {
        callback();
        if (i === x - 1) resolve();
      }, delay * i),
    );
  });
}

export function doAfter(x: number, callback: Function): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(async () => {
      await callback();
      resolve();
    }, x);
  });
}

let announcmentTimeout: NodeJS.Timeout;

export function createAnnouncement(message: string) {
  setAnnouncement(message);
  clearTimeout(announcmentTimeout);
  announcmentTimeout = setTimeout(() => setAnnouncement(), ANNOUNCEMENT_VISIBLE_DURATION);
}

export function headlessInit(opts = {}) {
  clock = new Clock();
  setProcessedEvents(0);
  loadingManager = new LoadingManager();
  textureLoader = new TextureLoader(loadingManager);
  textureLoaderWorker = Comlink.wrap(new TextureLoaderWorker());
  gameLog = opts.gameLog ?? ydoc.getArray('gameLog');
  gameState = opts.gameState ?? ydoc.getMap('gameState');

  provider = opts?.provider;
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      url,
      texture => resolve(texture),
      undefined,
      error => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

export async function setCardBackTexture(url: string) {
  const old = cardBackTexture;
  try {
    cardBackTexture = await loadTexture(url);
  } catch (error) {
    devLog.warn('[setCardBackTexture] failed to load', url, error);
    if (!cardBackTexture) {
      cardBackTexture = old;
    }
    return;
  }
  cardBackTexture.colorSpace = THREE.SRGBColorSpace;

  scene.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (Array.isArray(mat)) {
        mat.forEach((mat, i) => {
          if (mat.map === old) {
            mat.map = cardBackTexture;
            mat.needsUpdate = true;
          }
        });
      } else if (mat?.map?.userData?.isCardBack) {
        mat.map = cardBackTexture;
        mat.needsUpdate = true;
      }
    }
  });
  old?.dispose();
}

export function initClock() {
  clock = new Clock();
}

export const DEFAULT_CARD_SYSTEM_URI = 'https://api.scryfall.com';

function waitForIndexedDbSync(): Promise<void> {
  if (!indexeddbPersistence) return Promise.resolve();
  return new Promise(resolve => {
    if (indexeddbPersistence!.synced) {
      resolve();
      return;
    }
    const onSynced = () => {
      indexeddbPersistence!.off('synced', onSynced);
      resolve();
    };
    indexeddbPersistence.on('synced', onSynced);
    setTimeout(() => {
      indexeddbPersistence!.off('synced', onSynced);
      resolve();
    }, 500);
  });
}

function createSyncProvider(gameId: string) {
  const wsUrl =
    (import.meta.env.VITE_YJS_WS_URL as string | undefined) ?? 'wss://ws.arcanetable.app';
  return new WebsocketProvider(wsUrl, gameId, ydoc);
}

let activeGameId: string | undefined;

export function getActiveGameId(): string | undefined {
  return activeGameId;
}

export async function init({ gameId }) {
  tearingDown = false;
  activeGameId = gameId;
  touchGameLastAccess(gameId);
  headlessInit();
  indexeddbPersistence?.destroy();
  
  try {
    logReloadOther('indexeddb-init-start', { gameId });
    indexeddbPersistence = new IndexeddbPersistence(`arcanetable-${gameId}`, ydoc);
    await profileAsync('indexeddb sync', () => waitForIndexedDbSync(), { gameId });
    logReloadOther('indexeddb-init-done', { gameId });
  } catch (error) {
    logReloadOther('indexeddb-init-failed', {
      gameId,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('[IndexedDB] Failed to initialize, clearing corrupted database:', error);
    // Clear corrupted database
    try {
      const dbName = `arcanetable-${gameId}`;
      await new Promise((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        deleteRequest.onsuccess = () => {
          console.log('[IndexedDB] Corrupted database cleared successfully');
          resolve(null);
        };
        deleteRequest.onerror = () => {
          console.error('[IndexedDB] Failed to clear database');
          reject(deleteRequest.error);
        };
        deleteRequest.onblocked = () => {
          console.warn('[IndexedDB] Database deletion blocked, will retry');
          setTimeout(() => resolve(null), 1000);
        };
      });
      // Retry with clean database
      indexeddbPersistence = new IndexeddbPersistence(`arcanetable-${gameId}`, ydoc);
      await profileAsync('indexeddb sync (retry)', () => waitForIndexedDbSync(), { gameId });
    } catch (retryError) {
      console.error('[IndexedDB] Failed to recover, continuing without persistence:', retryError);
      indexeddbPersistence = null;
    }
  }
  
  provider = createSyncProvider(gameId);
  markLoadProfile('sync provider created', { gameId });

  cardBackTexture = textureLoader.load(cardSystem.cardBack ?? DEFAULT_CARD_BACK);
  cardBackTexture.colorSpace = THREE.SRGBColorSpace;

  cardLoadingTexture = textureLoader.load(`/loading-texture.png`);
  cardLoadingTexture.repeat.setX(1 / 3);
  cardLoadingTexture.repeat.setY(1 / 2);
  markLoadProfile('card textures queued');

  THREE.Cache.enabled = true;

  camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 5000);
  camera.position.z = 200;
  const matrix = new THREE.Matrix4();
  matrix.makeRotationX((Math.PI / 2) * -0.4);
  camera.position.applyMatrix4(matrix);

  baseCameraQuaternion = camera.quaternion.clone();

  renderer = new WebGLRenderer();
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.draggable = true;
  renderer.setClearColor(0x05050e);
  renderer.domElement.style.width = '100vw';

  const { focusWidth, focusHeight } = getFocusPanelDimensions();

  focusRenderer = new WebGLRenderer({ alpha: true, antialias: true });
  focusRenderer.setPixelRatio(window.devicePixelRatio);
  focusRenderer.setSize(focusWidth, focusHeight);
  // Flat, even preview — shadow maps on tilted hand cards moiré at high zoom.
  focusRenderer.shadowMap.enabled = false;
  focusRenderer.setClearColor(0x000000, 0);

  focusCamera = new PerspectiveCamera(50, focusWidth / focusHeight, 1, 2000);
  focusCamera.layers.set(FOCUS_PANEL_LAYER);

  scene = new Scene();

  gui = new GUI();
  gui.hide();

  scene.add(arrowHelper);

  camera.lookAt(scene.position);
  baseCameraQuaternion = camera.quaternion.clone();
  captureLocalCameraView();

  createEffect(() => {
    if (!settings.enableCameraTilt) {
      camera.quaternion.copy(baseCameraQuaternion);
    }
  });

  selection = new Selection(renderer, camera, scene);
  markLoadProfile('three.js scene + renderers');

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  new HDRLoader().load(
    '/qwantani_night_puresky_4k.hdr',
    texture => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    // Skysphere — scale it to zoom in/out
    const skyGeo = new THREE.SphereGeometry(1000, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    sky.scale.setScalar(2);
    sky.rotation.set(0.791681348704628, -1.60221225333079, 1.25663706143592);
    sky.position.set(77, -500, -500);
    scene.add(sky);

    scene.environmentIntensity = 0.516;
    scene.fog = new THREE.FogExp2(0x0d0015, 0.0006);
    scene.backgroundBlurriness = 0.308;
    scene.backgroundIntensity = 0;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromEquirectangular(texture).texture;
    scene.environmentIntensity = 0.4;
    scene.environment = envMap;
    pmrem.dispose();
    },
    undefined,
    error => {
      devLog.warn('[init] HDR environment failed to load', error);
    },
  );

  focusRayCaster = new Raycaster();

  const tableGeometry = new BoxGeometry(400, 200, 5);
  const tableMaterial = new MeshStandardMaterial({ color: TABLE_COLOR });
  table = new Mesh(tableGeometry, tableMaterial);
  table.receiveShadow = true;
  table.userData.zone = 'battlefield';
  table.rotateX(Math.PI * -0.4);
  table.position.y = 20;
  table.position.z = -10;

  arrowHelper.setDirection(new Vector3(0, 1, 0).applyQuaternion(table.quaternion));
  arrowHelper.position.copy(table.position);
  arrowHelper.setLength(100);

  const tableParams = {
    rotationX: Math.PI * -0.5,
    rotationY: 0,
    rotationZ: 0,
    positionX: 0,
    positionY: -100,
    positionZ: 0,
  };

  scene.add(table);
  markLoadProfile('table mesh ready');
  // setupCameraDebugGui(); // Disabled
}

export function applyPlayerTransform(group: THREE.Group, index: number) {
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  switch (index) {
    case 0:
      return;
    case 1:
      group.rotateZ(Math.PI / 2);
      group.position.setX(100);
      return;
    case 2:
      group.rotateZ(Math.PI);
      return;
    case 3:
      group.rotateZ(Math.PI / 2 + Math.PI);
      group.position.setX(-100);
      return;
  }
}

export function startSpectating() {
  setIsSpectating(true);
  setPlayerCount(count => count - 1);
  provider.awareness.setLocalStateField('isSpectating', true);
  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target = table.position;

  Object.values(playAreas).forEach((playArea, i) => {
    applyPlayerTransform(playArea.mesh, i);
  });
}

function detectCircularRefs(obj: unknown, path = '', seen = new WeakSet()): string | null {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return null;
  
  if (seen.has(obj as object)) {
    return `Circular reference at: ${path}`;
  }
  seen.add(obj as object);
  
  // Check for Three.js objects
  if ('isObject3D' in obj || 'isMaterial' in obj || 'isTexture' in obj) {
    return `Three.js object at: ${path} (type: ${(obj as any).type || 'unknown'})`;
  }
  
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = detectCircularRefs(obj[i], `${path}[${i}]`, seen);
      if (result) return result;
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const result = detectCircularRefs(value, path ? `${path}.${key}` : key, seen);
      if (result) return result;
    }
  }
  return null;
}

function safeGameLogPush(events: unknown[]) {
  const eventTypes = Array.isArray(events)
    ? events.map((event: any) => event?.type ?? 'unknown')
    : ['unknown'];
  logReloadOther('gamelog-push-attempt', { eventTypes, count: events.length });

  const circular = detectCircularRefs(events);
  if (circular) {
    logReloadOther('gamelog-push-blocked-circular', { circular, eventTypes });
    console.error('[CIRCULAR_REF_DETECTED]', circular);
    console.error('[EVENT_CAUSING_ISSUE]', JSON.stringify(events, (key, value) => {
      if (value && typeof value === 'object') {
        if ('isObject3D' in value) return '[Object3D]';
        if ('isMaterial' in value) return '[Material]';
        if ('isTexture' in value) return '[Texture]';
      }
      return value;
    }, 2).slice(0, 2000));
    // Skip pushing to avoid crash
    return;
  }
  try {
    gameLog.push(events);
    logReloadOther('gamelog-push-done', { eventTypes, newLength: gameLog.length });
  } catch (error) {
    logReloadOther('gamelog-push-threw', {
      eventTypes,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * @deprecated use dispatchEvent instead
 */
export function sendEvent(event) {
  if (syncPaused || isGameplayBlocked()) {
    return;
  }
  event.clientID = getLocalPlayerClientId();
  event.locallyApplied = true;
  sanitizeGameLogEvent(event);
  safeGameLogPush([event]);
}

let batch: any[] = [];
let batchTiming: number = 0;
let flushScheduled = false;
export let drainResolvers: (() => void)[] = [];

export async function flushDispatchEventQueue() {
  if (!batch.length) return;
  const events = batch.splice(0);
  flushScheduled = false;
  return new Promise<void>(resolve => {
    drainResolvers.push(resolve);
    let event = {
      type: 'bulk',
      timing: batchTiming,
      events,
      clientID: events[0].clientID,
    };
    sanitizeGameLogEvent(event);
    safeGameLogPush([event]);
  });
}

export function dispatchGameEvent(event: any, timing = 0) {
  if (syncPaused || isGameplayBlocked()) return;
  event.clientID = getLocalPlayerClientId();
  if (batch.length > 0 && timing !== batchTiming) {
    flushDispatchEventQueue();
  }
  batchTiming = timing;
  batch.push(event);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushDispatchEventQueue);
  }
}

/** CSS3DObject and the renderer's inner camera layer default to pointer-events: auto and block the WebGL canvas. */
export function patchCss3dPointerEvents() {
  if (!css3dRenderer) return;
  const root = css3dRenderer.domElement;
  root.style.pointerEvents = 'none';
  root.querySelectorAll<HTMLElement>('*').forEach(node => {
    node.style.pointerEvents = 'none';
  });
}

export function setupCss3dRenderer(container: HTMLElement) {
  css3dRenderer?.domElement.remove();
  css3dRenderer = new CSS3DRenderer();
  css3dRenderer.setSize(window.innerWidth, window.innerHeight);
  css3dRenderer.domElement.style.position = 'absolute';
  css3dRenderer.domElement.style.top = '0';
  css3dRenderer.domElement.style.left = '0';
  css3dRenderer.domElement.style.pointerEvents = 'none';
  css3dRenderer.domElement.style.zIndex = '2';
  container.appendChild(css3dRenderer.domElement);
  patchCss3dPointerEvents();
}

export function cleanup() {
  tearingDown = true;
  setSyncPaused(false);
  setGameplayBlocked(false);
  resetMultiplayerSyncState();
  clearSpanishPreview();
  setLocalPlayerClientId(undefined);
  clearPlayerSessionRegistry();
  cardsById.clear();
  zonesById.clear();
  setPeekFilterText('');
  setPeekTypeFilter(null);
  setHoverSignal();
  setScrollTarget();
  provider?.destroy();
  indexeddbPersistence?.destroy();
  indexeddbPersistence = null;
  ydoc.destroy();
  ydoc = new Doc();
  
  // Interceptar errores de serialización en el nuevo YDoc
  ydoc.on('update', (update, origin) => {
    logReloadOther('ydoc-update-after-reset', {
      origin: origin === null ? 'null' : typeof origin === 'string' ? origin : origin?.constructor?.name,
      updateBytes: update?.byteLength,
    });
  });
  
  setAnimating(false);
  setPlayers([]);
  setSelectedDeckId();
  setCapturedErrors([]);
  setIsSpectating(false);
  setIsIntitialized(false);
  setEventCatchUpComplete(false);
  initHowItPlaysAdvice();
  clearWaterdrops();
  clearPingSync();
  clearVideoPings();
  resetCameraView();

  resetCameraDebugGui();
  gui?.destroy?.();
  gui = null;

  if (!renderer) return;

  selection.destroy();

  renderer.domElement.remove();
  renderer.dispose();

  focusRenderer.dispose();
  focusRenderer.domElement.remove();

  css3dRenderer?.domElement.remove();
  css3dRenderer = null;

  cleanupFromNode(scene, true);
}
export function getProjectionVec(vec: Vector3): Vector3 | null {
  if (!camera || !renderer?.domElement) return null;

  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const projectionVec = vec.clone().project(camera);
  if (projectionVec.z > 1) return null;

  projectionVec.x = rect.left + ((projectionVec.x + 1) / 2) * rect.width;
  projectionVec.y = rect.top + ((1 - projectionVec.y) / 2) * rect.height;
  projectionVec.z = 0;
  return projectionVec;
}

export function getTetherCssVariables(tether: {
  x: number;
  y: number;
  offset: { x?: string; y?: string };
  rotation?: number;
}) {
  return `
    --x: ${tether.x}px;
    --y: ${tether.y}px;
    --offset-x: ${tether.offset?.x || 0};
    --offset-y: ${tether.offset?.y || 0};
    --rotation: ${tether.rotation ?? 0}deg;
  `;
}

export function onConcede(clientId?: string) {
  if (!clientId) {
    clientId = provider.awareness.clientID;
    startSpectating();
    sendEvent({ type: 'concede' });
  } else {
    setPlayerCount(count => count - 1);
  }
  const playArea = playAreas[clientId];
  playArea.destroy();
  setPlayAreas(clientId, undefined);
  removePlayerFromTurnOrder(clientId);
  if (playerCount() < 2) {
    Object.values(playAreas).forEach(playArea => {
      playArea.destroy();
    });
    setSelectedDeckId();
    setIsSpectating(false);
    setIsIntitialized(false);
    orbitControls?.dispose();
    selection.destroy();
  }
}

export function onKickPlayer(
  targetClientId: number,
  options?: { playerSessionId?: string; gameId?: string },
) {
  const playArea = playAreas[targetClientId];
  if (!playArea) return;

  const playerName =
    players().find(
      player =>
        player.id === targetClientId ||
        (options?.playerSessionId && player.entry.playerSessionId === options.playerSessionId),
    )?.entry?.name ?? 'Player';

  if (options?.playerSessionId) {
    unregisterPlayerSession(options.playerSessionId);
  }

  setPlayerCount(count => count - 1);
  table.remove(playArea.mesh);
  playArea.destroy();
  setPlayAreas(targetClientId, undefined);
  removePlayerFromTurnOrder(targetClientId);

  const isLocal = targetClientId === getLocalPlayerClientId();
  if (isLocal) {
    setLocalPlayerClientId(undefined);
    setIsIntitialized(false);
    setSelectedDeckId(undefined);
    setIsSpectating(false);
    if (options?.gameId) clearJoinBinding(options.gameId);
    createAnnouncement('You were removed from the game');
  } else {
    createAnnouncement(`${playerName} was removed from the game`);
  }
}

export function kickPlayer(targetClientId: number, gameId: string) {
  if (targetClientId === getLocalPlayerClientId()) return;
  const playArea = playAreas[targetClientId];
  if (!playArea) return;

  dispatchGameEvent({
    type: 'kick',
    payload: {
      targetClientId,
      playerSessionId: playArea.playerSessionId,
      gameId,
    },
  });
}

export function updateFocusCamera(target: Object3D) {
  if (focusCamera.userData.isAnimating) return;

  const { position, lookAt, up } = getFocusCameraPositionRelativeTo(target);

  focusCamera.position.copy(position);
  focusCamera.up.copy(up);
  focusCamera.lookAt(lookAt);
}

export function mouseToScreen(mouse: THREE.Vector2): THREE.Vector2 {
  const result = new THREE.Vector2(
    ((mouse.x + 1) / 2) * window.innerWidth,
    ((1 - mouse.y) / 2) * window.innerHeight,
  );
  return result;
}

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
import { WebrtcProvider } from 'y-webrtc';
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
import type { PlayArea } from './playArea';
import TextureLoaderWorker from './textureLoaderWorker?worker';
import { type TextureLoaderWorkerType } from './textureLoaderWorker';
import { cleanupFromNode, getFocusCameraPositionRelativeTo } from './utils';
import { Selection } from './selection';
import { captureConsole } from './console-capture';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import GUI from 'lil-gui';
import { createLocalStore } from './localStore';
import { clearPlayerSessionRegistry, clearJoinBinding, unregisterPlayerSession } from './playerSession';
import { clearWaterdrops } from './waterdropEffect';
import { clearPingSync } from './pingSync';
import { resetCameraView, captureLocalCameraView } from './cameraView';
import { clearSpanishPreview } from './spanishCardPreview';

export function expect(test: boolean, message: string, ...supplemental: any) {
  if (!test) {
    console.error(message, ...supplemental);
    throw new Error(message);
  }
}

const enableLogger = !import.meta.env.PROD;
const emptyFunc = () => {};

export const logger = {
  log: enableLogger ? console.log.bind(console) : emptyFunc,
  warn: enableLogger ? console.warn.bind(console) : emptyFunc,
};
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
export let cardsById = new Map<string, Card>();
export let zonesById = new Map<string, CardZone<unknown>>();
export let [playAreas, setPlayAreas] = createStore<Record<number, PlayArea>>({});
export let [peekFilterText, setPeekFilterText] = createSignal('');
export let ydoc = new Doc();
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

export function setEventCatchUpComplete(value: boolean) {
  eventCatchUpComplete = value;
}

export function isEventCatchUpComplete() {
  return eventCatchUpComplete;
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
}
export let [isSpectating, setIsSpectating] = createSignal(false);
export let [playerCount, setPlayerCount] = createSignal(0);
export let orbitControls: OrbitControls;
export const PLAY_AREA_ROTATIONS = [0, Math.PI, Math.PI / 2, Math.PI / 2 + Math.PI];
export const colorHashLight = new ColorHash({ lightness: 0.7 });
export const colorHashDark = new ColorHash({ lightness: 0.2 });
export const [selectedDeckId, setSelectedDeckId] = createSignal<string | undefined>();
export const FOCUS_PANEL_BASE_HEIGHT_RATIO = 0.5;
export const FOCUS_PANEL_WIDE_ASPECT = 750 / 700;
export const FOCUS_PANEL_MIN_SCALE = 0.25;
export const FOCUS_PANEL_MAX_SCALE = 1.5;

export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 1;
export const SOUND_VOLUME_STEP = 0.05;

export const [settings, setSettings] = createLocalStore('settings', {
  enableCameraTilt: false,
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

export const DEFAULT_CARD_BACK = '/arcane-table-back.webp';

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

export async function setCardBackTexture(url: string) {
  const old = cardBackTexture;
  cardBackTexture = await new Promise(resolve => textureLoader.load(url, resolve));
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

export const DEFAULT_CARD_SYSTEM_URI = 'https://scry-server-mtg.arcanetable.app';

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
    }, 1500);
  });
}

function parseEnvUrlList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map(url => url.trim())
    .filter(Boolean);
}

function createSyncProvider(gameId: string) {
  const wsUrl = import.meta.env.VITE_YJS_WS_URL as string | undefined;
  if (import.meta.env.PROD || wsUrl) {
    return new WebsocketProvider(wsUrl ?? 'wss://ws.arcanetable.app', gameId, ydoc);
  }

  const signaling =
    parseEnvUrlList(import.meta.env.VITE_YJS_SIGNALING_URL as string | undefined) ?? [
      'wss://signaling.arcanetable.app',
    ];

  return new WebrtcProvider(gameId, ydoc, { signaling });
}

export async function init({ gameId }) {
  tearingDown = false;
  touchGameLastAccess(gameId);
  headlessInit();
  indexeddbPersistence?.destroy();
  indexeddbPersistence = new IndexeddbPersistence(`arcanetable-${gameId}`, ydoc);
  await profileAsync('indexeddb sync', () => waitForIndexedDbSync(), { gameId });
  provider = createSyncProvider(gameId);
  markLoadProfile('sync provider created', { gameId });

  loadingManager.onProgress = function (item, loaded, total) {
    console.log(item, loaded, total);
  };

  cardBackTexture = textureLoader.load(cardSystem.cardBack ?? `/arcane-table-back.webp`);
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

  focusRenderer = new WebGLRenderer();
  focusRenderer.setPixelRatio(window.devicePixelRatio);
  focusRenderer.setSize(focusWidth, focusHeight);
  focusRenderer.shadowMap.enabled = true;
  focusRenderer.setClearAlpha(0x05050e);

  focusCamera = new PerspectiveCamera(50, focusWidth / focusHeight, 1, 2000);

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

  new HDRLoader().load('/qwantani_night_puresky_4k.hdr', texture => {
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
  });

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

/**
 * @deprecated use dispatchEvent instead
 */
export function sendEvent(event) {
  event.clientID = getLocalPlayerClientId();
  event.locallyApplied = true;
  logger.warn('sendEvent', event.type);
  gameLog.push([event]);
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
    logger.log('[dispatchGameEvent]', event);
    gameLog.push([event]);
  });
}

export function dispatchGameEvent(event: any, timing = 0) {
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
  clearSpanishPreview();
  setLocalPlayerClientId(undefined);
  clearPlayerSessionRegistry();
  cardsById.clear();
  zonesById.clear();
  setPeekFilterText('');
  setHoverSignal();
  setScrollTarget();
  provider?.destroy();
  indexeddbPersistence?.destroy();
  indexeddbPersistence = null;
  ydoc.destroy();
  ydoc = new Doc();
  setAnimating(false);
  setPlayers([]);
  setSelectedDeckId();
  setCapturedErrors([]);
  setIsSpectating(false);
  setIsIntitialized(false);
  setEventCatchUpComplete(false);
  clearWaterdrops();
  clearPingSync();
  resetCameraView();

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

  let { position, rotation, lookAt } = getFocusCameraPositionRelativeTo(target);

  focusCamera.position.copy(position);
  focusCamera.lookAt(lookAt);
  focusCamera.rotation.copy(rotation);
}

export function mouseToScreen(mouse: THREE.Vector2): THREE.Vector2 {
  const result = new THREE.Vector2(
    ((mouse.x + 1) / 2) * window.innerWidth,
    ((1 - mouse.y) / 2) * window.innerHeight,
  );
  return result;
}

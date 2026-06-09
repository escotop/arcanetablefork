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
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';
import { Doc } from 'yjs';
import { YArray } from 'yjs/dist/src/internals';
import { Card, CARD_WIDTH, CardSystem, CardZone, HoverSignal, TABLE_COLOR } from './constants';
import type { PlayArea } from './playArea';
import TextureLoaderWorker from './textureLoaderWorker?worker';
import { type TextureLoaderWorkerType } from './textureLoaderWorker';
import { cleanupFromNode, getFocusCameraPositionRelativeTo } from './utils';
import { Selection } from './selection';
import { captureConsole } from './console-capture';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import GUI from 'lil-gui';
import { createLocalStore } from './localStore';

export function expect(test: boolean, message: string, ...supplemental: any) {
  if (!test) {
    console.error(message, ...supplemental);
    throw new Error(message);
  }
}

export let clock: Clock;
export let loadingManager: LoadingManager;
export let textureLoader: TextureLoader;
export let renderer: WebGLRenderer;
export let scene: Scene;
export let camera: PerspectiveCamera;
export let focusRenderer: WebGLRenderer;
export let focusCamera: PerspectiveCamera;
export let [hoverSignal, setHoverSignal] = createSignal<HoverSignal>();
export let cardsById = new Map<string, Card>();
export let zonesById = new Map<string, CardZone<unknown>>();
export let [playAreas, setPlayAreas] = createStore<Record<number, PlayArea>>({});
export let [peekFilterText, setPeekFilterText] = createSignal('');
export let ydoc = new Doc();
export let table: Object3D;
export let gameLog: YArray<any>;
export let [animating, setAnimating] = createSignal(false);
export let [players, setPlayers] = createSignal([]);
export let [isInitialized, setIsIntitialized] = createSignal(false);
export let focusRayCaster: Raycaster;
export let arrowHelper = new ArrowHelper();
export const [scrollTarget, setScrollTarget] = createSignal();
export let provider: WebsocketProvider | WebrtcProvider;
export let [logs, setLogs] = createStore([]);
export let [processedEvents, setProcessedEvents] = createSignal(0);
export let [isSpectating, setIsSpectating] = createSignal(false);
export let [playerCount, setPlayerCount] = createSignal(0);
export let orbitControls: OrbitControls;
export const PLAY_AREA_ROTATIONS = [0, Math.PI, Math.PI / 2, Math.PI / 2 + Math.PI];
export const colorHashLight = new ColorHash({ lightness: 0.7 });
export const colorHashDark = new ColorHash({ lightness: 0.2 });
export const [selectedDeckId, setSelectedDeckId] = createSignal<string | undefined>();
export const [settings, setSettings] = createLocalStore('settings', { enableCameraTilt: false });
export let textureLoaderWorker: Comlink.Remote<TextureLoaderWorkerType>;
export let gui: GUI = null;
export let baseCameraQuaternion: THREE.Quaternion;


export let selection: Selection;
export let [capturedErrors, setCapturedErrors] = createSignal([]);

export let cardLoadingTexture: THREE.Texture;
export let cardBackTexture: THREE.Texture;

export let [cardSystem, setCardSystem] = createStore<CardSystem>({} as CardSystem);

export const DEFAULT_CARD_BACK = '/arcane-table-back.webp';

[('warn', 'error')].forEach(captureConsole);

export function doXTimes(x: number, callback, delay = 100): Promise<void> {
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

export function headlessInit(opts = {}) {
  clock = new Clock();
  setProcessedEvents(0);
  loadingManager = new LoadingManager();
  textureLoader = new TextureLoader(loadingManager);
  textureLoaderWorker = Comlink.wrap(new TextureLoaderWorker());
  gameLog = opts.gameLog ?? ydoc.getArray('gameLog');
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

export async function init({ gameId }) {
  headlessInit();
  if (import.meta.env.PROD) {
    provider = new WebsocketProvider('wss://ws.arcanetable.app', gameId, ydoc);
  } else {
    provider = new WebrtcProvider(gameId, ydoc, { signaling: [`signaling.arcanetable.app`] });
  }

  loadingManager.onProgress = function (item, loaded, total) {
    console.log(item, loaded, total);
  };

  cardBackTexture = textureLoader.load(cardSystem.cardBack ?? `/arcane-table-back.webp`);
  cardBackTexture.colorSpace = THREE.SRGBColorSpace;

  cardLoadingTexture = textureLoader.load(`/loading-texture.png`);
  cardLoadingTexture.repeat.setX(1 / 3);
  cardLoadingTexture.repeat.setY(1 / 2);

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

  let focusHeight = window.innerHeight * 0.5;
  let focusWidth = (focusHeight / 700) * 750;

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

  createEffect(() => {
    if (!settings.enableCameraTilt) {
      camera.quaternion.copy(baseCameraQuaternion)
    }
  })

  selection = new Selection(renderer, camera, scene);

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
  table.rotateX(Math.PI * -.4);
  table.position.y = 20;
  table.position.z = -10;

  arrowHelper.setDirection(new Vector3(0, 1, 0).applyQuaternion(table.quaternion));
  arrowHelper.position.copy(table.position)
  arrowHelper.setLength(100)


  const tableParams = {
    rotationX: Math.PI * -0.5,
    rotationY: 0,
    rotationZ: 0,
    positionX: 0,
    positionY: -100,
    positionZ: 0,
  };

  scene.add(table);
}

export function applyPlayerTransform(group: THREE.Group, index: number) {
  switch (index) {
    case 0:
      return;
    case 1:
      group.rotateZ(Math.PI);
      return;
    case 2:
      group.rotateZ(Math.PI / 2);
      group.position.setX(100);
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

  Object.values(playAreas).forEach(playArea => {
    applyPlayerTransform(playArea.mesh, i);
  });
}

export function sendEvent(event) {
  event.clientID = provider.awareness.clientID;
  gameLog.push([event]);
}

export function cleanup() {
  cardsById.clear();
  zonesById.clear();
  setPeekFilterText('');
  setHoverSignal();
  setScrollTarget();
  provider?.destroy();
  ydoc.destroy();
  ydoc = new Doc();
  setAnimating(false);
  setPlayers([]);
  setSelectedDeckId();
  setCapturedErrors([]);
  setIsSpectating(false);
  setIsIntitialized(false);

  gui?.destroy?.();
  gui = null;

  if (!renderer) return;

  selection.destroy();

  renderer.domElement.remove();
  renderer.dispose();

  focusRenderer.dispose();
  focusRenderer.domElement.remove();

  cleanupFromNode(scene, true);
}
export function getProjectionVec(vec: Vector3) {
  let canvas = renderer.domElement;
  let projectionVec = vec.clone();
  projectionVec.project(camera);
  projectionVec.x = Math.round(
    (0.5 + projectionVec.x / 2) * (canvas.width / window.devicePixelRatio),
  );
  projectionVec.y = Math.round(
    (0.5 - projectionVec.y / 2) * (canvas.height / window.devicePixelRatio),
  );
  return projectionVec;
}

export function onConcede(clientId?: string) {
  if (!clientId) {
    clientId = provider.awareness.clientID;
    startSpectating();
    sendEvent({ type: 'concede' });
  } else {
    setPlayerCount(count => count - 1);
  }
  console.log(clientId);
  console.log(playAreas);
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

export function updateFocusCamera(target: Object3D, offset = new Vector3(CARD_WIDTH / 4, 0, 0)) {
  if (focusCamera.userData.isAnimating) return;

  let { position, rotation } = getFocusCameraPositionRelativeTo(target, offset);

  focusCamera.position.copy(position);

  focusCamera.lookAt(target.getWorldPosition(new Vector3()));
  focusCamera.rotation.copy(rotation);
}

export function mouseToScreen(mouse: THREE.Vector2): THREE.Vector2 {
  const result = new THREE.Vector2(
    ((mouse.x + 1) / 2) * window.innerWidth,
    ((1 - mouse.y) / 2) * window.innerHeight,
  );
  console.log({ result });
  return result;
}

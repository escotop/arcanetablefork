import uniqBy from 'lodash-es/uniqBy';
import { nanoid } from 'nanoid';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { cancelAnimation, renderAnimations, serializeAnimation } from './lib/animations';
import { cloneCard, getCardMeshTetherPoint, setCardData, updateTextureAnimation } from './lib/card';
import {
  CARD_STACK_OFFSET,
  CARD_THICKNESS,
  GameOptions,
  LoadSettings,
  LOOK_EASE,
  LOOK_STRENGTH_X,
  LOOK_STRENGTH_Y,
} from './lib/constants';
import {
  animating,
  applyPlayerTransform,
  baseCameraQuaternion,
  camera,
  cardsById,
  clock,
  DEFAULT_CARD_BACK,
  dispatchGameEvent,
  expect,
  flushDispatchEventQueue,
  focusCamera,
  focusRayCaster,
  focusRenderer,
  gameLog,
  hoverSignal,
  init,
  initClock,
  isSpectating,
  playAreas,
  players,
  provider,
  renderer,
  scene,
  scrollTarget,
  selection,
  sendEvent,
  setAnimating,
  setCapturedErrors,
  setCardBackTexture,
  setContextMenuSignal,
  setHoverSignal,
  setIsIntitialized,
  setPlayAreas,
  setPlayers,
  settings,
  table,
  tearingDown,
  updateFocusCamera,
  zonesById,
} from './lib/globals';
import { Hand } from './lib/hand';
import { PlayArea } from './lib/playArea';
import { transferCard } from './lib/transferCard';
import { setCounters } from './lib/ui/counterDialog';
import { restackItems, restackItemsLocally } from './lib/utils';
import { processEvents } from './remoteEvents';
import { getDeckStore } from './lib/deckStore';
import { unwrap } from 'solid-js/store';
import {
  createAnimationEvent,
  createRestackEvent,
  createTapEvent,
  createTransferCardEvent,
} from './lib/createEvents';

var container;

let composer: EffectComposer;
let raycaster: THREE.Raycaster;
let mouse: THREE.Vector2;
let cameraMouse: THREE.Vector2;
let outlinePass: OutlinePass;
let dragTargets: THREE.Object3D[];
let hand: Hand;
let time = 0;
let playArea: PlayArea;

export async function localInit(gameOptions: GameOptions) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await init(gameOptions);

  time = 0;
  dragTargets = [];

  provider.awareness.on('change', change => {
    let newPlayers = Array.from(provider.awareness.getStates().entries()).map(([id, entry]) => ({
      entry,
      id,
    }));
    setPlayers(newPlayers);
  });

  outlinePass = new OutlinePass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    scene,
    camera,
  );
  outlinePass.pulsePeriod = 2;

  var ambient = new THREE.AmbientLight(0xffffff);
  ambient.intensity = 2;
  scene.add(ambient);

  var directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.intensity = 2;
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

  gameLog.observe(processEvents);

  processEvents();

  container.appendChild(renderer.domElement);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // TODO: these document listeners are never cleaned up!
  renderer.domElement.addEventListener('mousemove', onRendererMouseMove, false);
  renderer.domElement.addEventListener('contextmenu', onContextMenu, false);
  document.addEventListener('mousemove', onDocumentMouseMove, false);
  document.addEventListener('click', onDocumentClick, false);
  document.addEventListener('dragstart', onDocumentDragStart, false);
  document.addEventListener('mouseup', onDocumentDrop, false);
  document.addEventListener('wheel', onDocumentScroll, false);
  window.addEventListener('resize', onWindowResize, false);

  if (gameOptions.deck) {
    loadDeckAndJoin(gameOptions);
  }
  startAnimating();
}

export function readjustPlayAreas() {
  let entries = Object.values(playAreas).sort((a, b) => a.index - b.index);
  console.log({ entries, playAreas });

  let selfIndex = entries.findIndex(e => e.isLocalPlayArea);

  let sorted;

  if (selfIndex > -1) {
    sorted = entries.splice(selfIndex);
    sorted.push(...entries);
  } else {
    sorted = [, ...entries];
  }

  let mapIndex = {
    1: [0],
    2: [0, 2],
  };

  console.log(sorted.length);
  let indexMap = mapIndex[sorted.length];

  sorted.forEach((playArea, i) => {
    let index = indexMap?.[i] ?? i;
    applyPlayerTransform(playArea.mesh, index);
  });
}

export async function loadDeckAndJoin(settings: LoadSettings) {
  let deck = settings.deck;

  let counters = deck?.counters ?? [];

  await setCardBackTexture(unwrap(settings.cardSystem.cardBack) ?? DEFAULT_CARD_BACK);

  playArea = await PlayArea.FromDeck(provider.awareness.clientID, deck);
  playArea.index = players().length;

  console.log(playArea.index);

  setPlayAreas(provider.awareness.clientID, playArea);
  setIsIntitialized(true);
  setCounters(existing => uniqBy([...counters, ...existing], 'id'));

  playArea.subscribeEvents(sendEvent);
  provider.awareness.setLocalStateField('life', settings.startingLife);
  provider.awareness.setLocalStateField('name', settings.name);
  sendEvent({ type: 'join', payload: playArea.getLocalState() });
  counters.forEach(counter => sendEvent({ type: 'createCounter', counter }));

  hand = playArea.hand;

  table.add(playArea.mesh);

  readjustPlayAreas();
  renderer.compile(scene, camera);
}

function onDocumentScroll(event) {
  if (!scrollTarget()) return;

  scrollTarget().dispatchEvent({ type: 'scroll', event });
}

let isDragging = false;

function onContextMenu(event: PointerEvent) {
  event.preventDefault();
  raycaster.setFromCamera(mouse, camera);
  let intersects = raycaster.intersectObject(scene);

  if (!intersects.length) return;
  let target = intersects[0].object;
  if (!target) return;

  setContextMenuSignal({
    mouse: { x: event.x, y: event.y},
    target,
  });
}

function onDocumentClick(event: PointerEvent) {
  setContextMenuSignal();
  raycaster.setFromCamera(mouse, camera);
  let intersects = raycaster.intersectObject(scene);

  if (isDragging) {
    isDragging = false;
    return;
  }

  if (selection.onClick(event, intersects[0]?.object)) return;

  if (dragTargets?.length) return;

  if (!intersects.length) return;

  let target = intersects[0].object;

  if (!target) return;

  if (target.userData.isAnimating && !['battlefield', 'hand'].includes(target.userData.location))
    return;

  if (target.userData.zone === 'battlefield') {
    setHoverSignal({ mouse });
  } else if (target.userData.location === 'battlefield') {
    dispatchGameEvent(createTapEvent(target));

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
    if (target.userData.clientId !== provider.awareness.clientID) {
      let remotePlayArea = playAreas[target.userData.clientId];
      remotePlayArea?.graveyardZone.mesh.children.forEach((cardMesh, i) => {
        let card = cardsById.get(cardMesh.userData.id);
        if (!card) return;

        let cardProxy = cloneCard(card, nanoid());
        setCardData(cardProxy.mesh, 'isPublic', true);
        setTimeout(() => {
          playArea.reveal(cardProxy);
        }, 50 * i);
      });
    } else {
      playArea.peekGraveyard();
    }
  } else if (target.userData.location === 'exile') {
    if (target.userData.clientId !== provider.awareness.clientID) {
      let remotePlayArea = playAreas[target.userData.clientId];
      remotePlayArea?.exileZone.mesh.children.forEach((cardMesh, i) => {
        let card = cardsById.get(cardMesh.userData.id)!;
        if (!card) return;

        let cardProxy = cloneCard(card, nanoid());
        setCardData(cardProxy.mesh, 'isPublic', true);
        setTimeout(() => {
          playArea.reveal(cardProxy);
        }, 50 * i);
      });
    } else {
      playArea.peekExile();
    }
  }

  if (target.parent?.userData.isInteractive) {
    target = target.parent;
  }

  target.dispatchEvent({ type: 'click', event });
}

function onDocumentDragStart(event: PointerEvent) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  raycaster.setFromCamera(mouse, camera);
  let intersects = raycaster.intersectObject(scene);
  if (isSpectating()) return;
  if (!intersects.length) return;

  let intersection = intersects[0];
  let target = intersection.object;
  let targets = [target];

  if (target.userData.location === 'deck') return;

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

async function onDocumentDrop(event) {
  event.preventDefault();
  selection.completeRectangleSelection(event);
  if (!dragTargets?.length) return;
  raycaster.setFromCamera(mouse, camera);

  let intersections = raycaster.intersectObject(scene);

  let targetsById = Object.fromEntries(dragTargets.map(target => [target.userData.id, target]));
  let intersection = intersections.find(
    i =>
      !targetsById[i.object.userData.id] &&
      (i.object.userData.isInteractive || i.object.userData.zone),
  )!;
  if (!intersection) return;

  let shouldClearSelection = false;
  let toZoneId = intersection.object.userData.zoneId;
  let toZone = zonesById.get(toZoneId)!;
  expect(!!toZone, `toZone is not found`, { toZone });

  restackItemsLocally(dragTargets, intersections);

  for (const target of dragTargets ?? []) {
    setCardData(target, 'isDragging', false);

    let fromZoneId = target.userData.zoneId;
    let fromZone = zonesById.get(fromZoneId)!;
    expect(!!fromZone, `fromZone not found `, { fromZone });

    if (fromZoneId && fromZoneId === toZoneId) {
      setCardData(target, `zone.${toZone.id}.position`, target.position.toArray());
      setCardData(target, `zone.${toZone.id}.rotation`, target.rotation.toArray());
      dispatchGameEvent(
        createAnimationEvent(target, {
          duration: 0.2,
          to: {
            position: target.position,
            rotation: target.rotation,
          },
        }),
      );
      continue;
    }

    let card = cardsById.get(target.userData.id)!;
    let position = toZone.mesh.worldToLocal(intersection.point.clone());
    expect(!!card, `card not found`, { card });

    dispatchGameEvent(
      createTransferCardEvent(card, fromZone, toZone, {
        addOptions: {
          skipLocalAnimation: true,
          positionArray: position.toArray(),
        },
      }),
    );
    shouldClearSelection = true;
  }

  await flushDispatchEventQueue();

  if (intersection.object.userData.zone === 'battlefield') {
    dispatchGameEvent(createRestackEvent(intersection, dragTargets), 25);
  }

  if (shouldClearSelection) {
    selection.clearSelection();
  }

  if (dragTargets.length) {
    setHoverSignal(signal => {
      let mesh = signal?.mesh ?? dragTargets[0];
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

  dragTargets = [];
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  composer.setSize(window.innerWidth, window.innerHeight);

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  let focusHeight = window.innerHeight * 0.5;
  let focusWidth = (focusHeight / 700) * 750;

  focusRenderer.setPixelRatio(window.devicePixelRatio);
  focusRenderer.setSize(focusWidth, focusHeight);
}

function onDocumentMouseMove(event) {
  cameraMouse.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  );
}

function onRendererMouseMove(event) {
  mouse.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  );

  selection.onMove(event);

  if (dragTargets?.length) {
    isDragging = true;
    raycaster.setFromCamera(mouse, camera);

    let intersections = raycaster.intersectObject(scene);

    restackItemsLocally(dragTargets, intersections);

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
    setHoverSignal(signal => ({
      mouse,
      ...signal,
    }));
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
    console.error(e);
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

let hover: THREE.Object3D;

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
    if ((isInteractive || ['graveyard', 'exile'].includes(location)) && !isAnimating) next = target;
  }

  if (needsCleanup && hover) {
    hover.object.material?.forEach?.((mat, i) => mat.color.set(hover.colors[i]));

    hover.object.dispatchEvent({ type: 'mouseout', mesh: hover.object });
    hover = undefined;
    outlinePass.selectedObjects = [];
  }

  if (next) {
    const tether = getCardMeshTetherPoint(next);

    hover = { object: next, colors: [] };
    setHoverSignal({ mesh: next, tether, mouse });

    hover.object.dispatchEvent({ type: 'mousein', mesh: hover.object });
    focusOn(next);

    outlinePass.selectedObjects = [hover.object];
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

  if (settings.enableCameraTilt && !isSpectating()) {
    animateCameraLook();
  }

  raycaster.setFromCamera(mouse, camera);

  if (!selection.enabled) {
    let intersects = raycaster.intersectObject(scene).filter(hit => {
      if (isSpectating()) return true;
      if (
        hit.object?.userData.clientId !== provider.awareness.clientID &&
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

  if (hoverSignal()?.mesh) {
    let mesh = hoverSignal().mesh as THREE.Mesh;
    updateFocusCamera(mesh);

    focusRayCaster.set(
      focusCamera.position,
      mesh.localToWorld(new THREE.Vector3()).sub(focusCamera.position).normalize(),
    );
    let intersections = focusRayCaster.intersectObject(scene);
    let targetDistance;
    let materials = intersections
      .map(({ object, distance }) => {
        if (object.uuid === mesh.uuid) {
          targetDistance = distance;
          return [];
        }
        if (targetDistance && distance > targetDistance) return [];
        return Array.isArray(object.material) ? object.material : [object.material];
      })
      .flat();

    materials.forEach(mat => (mat.wireframe = true));
    focusRenderer.render(scene, focusCamera);
    materials.forEach(mat => (mat.wireframe = false));
  }
}

let currentYaw = 0;
let currentPitch = 0;

function animateCameraLook() {
  const targetYaw = -cameraMouse.x * LOOK_STRENGTH_X;
  const targetPitch = cameraMouse.y * LOOK_STRENGTH_Y;

  currentYaw += (targetYaw - currentYaw) * LOOK_EASE;
  currentPitch += (targetPitch - currentPitch) * LOOK_EASE;

  // Apply on top of base rotation
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), currentYaw);
  const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), currentPitch);

  camera.quaternion.copy(baseCameraQuaternion).multiply(yawQ).multiply(pitchQ);
}

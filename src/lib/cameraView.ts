import { createSignal } from 'solid-js';
import { Euler, Group, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { applyPlayerTransform, camera, baseCameraQuaternion, players, playAreas, table } from './globals';
import { getRegisteredClientIdForSession } from './playerSession';
import type { PlayArea } from './playArea';

interface CameraViewState {
  position: Vector3;
  quaternion: Quaternion;
}

let localCameraPosition: Vector3 | null = null;
let localCameraQuaternion: Quaternion | null = null;
let f3UserSaved = false;

const playerCameraViews = new Map<number, CameraViewState>();

const worldUp = new Vector3(0, 1, 0);
const seatWorldMatrixInverse = new Matrix4();
const tempLocalPoint = new Vector3();
const tempWorldPoint = new Vector3();
const cameraEuler = new Euler(0, 0, 0, 'YXZ');
const seatDeltaQuaternion = new Quaternion();
const seatFrameFrom = new Group();
const seatFrameTo = new Group();

const F3_TUNED_VIEW: CameraViewParams = {
  posX: 230,
  posY: 159,
  posZ: 28,
  rotX: -51,
  rotY: 68,
  rotZ: 28,
};

/** Maps ordered player index (0 = you) to physical table seat for each player count. */
export const SEAT_VISUAL_INDEX: Record<number, number[]> = {
  1: [0],
  2: [0, 2],
  3: [0, 2, 1],
  4: [0, 2, 1, 3],
};

/** Ordered play area index: 0 = you, 1+ = other players clockwise. */
export const [cameraViewPlayerIndex, setCameraViewPlayerIndex] = createSignal(0);

export interface CameraViewParams {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

/** @deprecated Use cameraViewPlayerIndex() !== 0 */
export function cameraViewMode(): 'local' | 'opponent' {
  return cameraViewPlayerIndex() === 0 ? 'local' : 'opponent';
}

export function isViewingFromRemoteSeat() {
  return cameraViewPlayerIndex() !== 0;
}

function worldPointToSeatLocal(world: Vector3, area: PlayArea, target = tempLocalPoint) {
  area.mesh.updateMatrixWorld(true);
  seatWorldMatrixInverse.copy(area.mesh.matrixWorld).invert();
  return target.copy(world).applyMatrix4(seatWorldMatrixInverse);
}

function seatLocalPointToWorld(local: Vector3, area: PlayArea, target = tempWorldPoint) {
  area.mesh.updateMatrixWorld(true);
  return target.copy(local).applyMatrix4(area.mesh.matrixWorld);
}

function quaternionToEulerDegrees(quaternion: Quaternion) {
  cameraEuler.setFromQuaternion(quaternion, 'YXZ');
  return {
    rotX: MathUtils.radToDeg(cameraEuler.x),
    rotY: MathUtils.radToDeg(cameraEuler.y),
    rotZ: MathUtils.radToDeg(cameraEuler.z),
  };
}

function eulerDegreesToQuaternion(rotX: number, rotY: number, rotZ: number) {
  cameraEuler.set(
    MathUtils.degToRad(rotX),
    MathUtils.degToRad(rotY),
    MathUtils.degToRad(rotZ),
    'YXZ',
  );
  return new Quaternion().setFromEuler(cameraEuler);
}

function paramsToViewState(params: CameraViewParams): CameraViewState {
  return {
    position: new Vector3(params.posX, params.posY, params.posZ),
    quaternion: eulerDegreesToQuaternion(params.rotX, params.rotY, params.rotZ),
  };
}

function captureViewStateFromCamera(): CameraViewState {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  };
}

function applyViewState(state: CameraViewState) {
  if (!camera) return;

  camera.position.copy(state.position);
  camera.quaternion.copy(state.quaternion);
  camera.up.copy(worldUp);
  baseCameraQuaternion.copy(state.quaternion);
}

function storeViewState(index: number, state: CameraViewState) {
  playerCameraViews.set(index, {
    position: state.position.clone(),
    quaternion: state.quaternion.clone(),
  });

  if (index === 0) {
    localCameraPosition = state.position.clone();
    localCameraQuaternion = state.quaternion.clone();
  }

  if (index === 2) {
    f3UserSaved = true;
    playerCameraViews.delete(3);
  }
}

export function captureLocalCameraView() {
  if (!camera) return;
  storeViewState(0, captureViewStateFromCamera());
}

export function readCameraViewParams(): CameraViewParams {
  if (!camera) {
    return { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0 };
  }

  const rotation = quaternionToEulerDegrees(camera.quaternion);

  return {
    posX: camera.position.x,
    posY: camera.position.y,
    posZ: camera.position.z,
    rotX: rotation.rotX,
    rotY: rotation.rotY,
    rotZ: rotation.rotZ,
  };
}

export function writeCameraViewParams(params: CameraViewParams) {
  if (!camera) return;

  const index = cameraViewPlayerIndex();
  const quaternion = eulerDegreesToQuaternion(params.rotX, params.rotY, params.rotZ);

  camera.position.set(params.posX, params.posY, params.posZ);
  camera.quaternion.copy(quaternion);
  camera.up.copy(worldUp);
  baseCameraQuaternion.copy(quaternion);

  storeViewState(index, {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  });
}

export function getOrderedPlayAreas(): PlayArea[] {
  const entries = Object.values(playAreas)
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);

  const selfIndex = entries.findIndex(area => area.isLocalPlayArea);
  if (selfIndex === -1) return entries;

  const localFirst = entries.splice(selfIndex);
  localFirst.push(...entries);
  return localFirst;
}

export function getVisualSeatIndex(orderedIndex: number, playerCount: number) {
  return SEAT_VISUAL_INDEX[playerCount]?.[orderedIndex] ?? orderedIndex;
}

function getBattlefieldWorldCenter(area: PlayArea, target = new Vector3()) {
  area.battlefieldZone.mesh.updateMatrixWorld(true);
  area.battlefieldZone.mesh.getWorldPosition(target);
  return target;
}

function getF1ReferenceViewState(): CameraViewState | null {
  const savedF1 = playerCameraViews.get(0);
  if (savedF1) {
    return {
      position: savedF1.position.clone(),
      quaternion: savedF1.quaternion.clone(),
    };
  }

  if (!localCameraPosition || !localCameraQuaternion) return null;

  return {
    position: localCameraPosition.clone(),
    quaternion: localCameraQuaternion.clone(),
  };
}

function getF3ViewState(): CameraViewState {
  const savedF3 = playerCameraViews.get(2);
  if (f3UserSaved && savedF3) {
    return {
      position: savedF3.position.clone(),
      quaternion: savedF3.quaternion.clone(),
    };
  }

  return paramsToViewState(F3_TUNED_VIEW);
}

function syncF1ReferenceFromSlot() {
  const savedF1 = playerCameraViews.get(0);
  if (!savedF1) return;

  localCameraPosition = savedF1.position.clone();
  localCameraQuaternion = savedF1.quaternion.clone();
}

function getSeatDeltaQuaternion(localArea: PlayArea, viewedArea: PlayArea) {
  localArea.mesh.updateMatrixWorld(true);
  viewedArea.mesh.updateMatrixWorld(true);

  const localRotation = new Matrix4().extractRotation(localArea.mesh.matrixWorld);
  const viewedRotation = new Matrix4().extractRotation(viewedArea.mesh.matrixWorld);
  const deltaMatrix = new Matrix4().multiplyMatrices(
    viewedRotation,
    localRotation.clone().invert(),
  );

  return seatDeltaQuaternion.setFromRotationMatrix(deltaMatrix);
}

function mirrorPositionBetweenSeats(
  referencePosition: Vector3,
  fromArea: PlayArea,
  toArea: PlayArea,
) {
  const fromCenter = getBattlefieldWorldCenter(fromArea, new Vector3());
  const toCenter = getBattlefieldWorldCenter(toArea, new Vector3());

  const camInFromSeat = worldPointToSeatLocal(referencePosition, fromArea, new Vector3());
  const centerInFromSeat = worldPointToSeatLocal(fromCenter, fromArea, new Vector3());
  const camOffset = camInFromSeat.clone().sub(centerInFromSeat);

  const centerInToSeat = worldPointToSeatLocal(toCenter, toArea, new Vector3());
  const newCamLocal = centerInToSeat.clone().add(camOffset);

  return seatLocalPointToWorld(newCamLocal, toArea, new Vector3());
}

function mirrorQuaternionBetweenSeats(
  referenceQuaternion: Quaternion,
  fromArea: PlayArea,
  toArea: PlayArea,
) {
  const seatDelta = getSeatDeltaQuaternion(fromArea, toArea);
  return seatDelta.multiply(referenceQuaternion);
}

function buildMirroredViewState(
  reference: CameraViewState,
  fromArea: PlayArea,
  toArea: PlayArea,
): CameraViewState {
  return {
    position: mirrorPositionBetweenSeats(reference.position, fromArea, toArea),
    quaternion: mirrorQuaternionBetweenSeats(reference.quaternion, fromArea, toArea),
  };
}

function asSeatPlayArea(mesh: Group): PlayArea {
  return { mesh } as PlayArea;
}

function ensureSeatFramesOnTable() {
  if (!table) return;
  if (!seatFrameFrom.parent) table.add(seatFrameFrom);
  if (!seatFrameTo.parent) table.add(seatFrameTo);
}

function mirrorViewBetweenVisualSeats(
  reference: CameraViewState,
  fromSeat: number,
  toSeat: number,
): CameraViewState | null {
  if (!table) return null;

  ensureSeatFramesOnTable();

  seatFrameFrom.position.set(0, 0, 0);
  seatFrameFrom.rotation.set(0, 0, 0);
  seatFrameTo.position.set(0, 0, 0);
  seatFrameTo.rotation.set(0, 0, 0);

  applyPlayerTransform(seatFrameFrom, fromSeat);
  applyPlayerTransform(seatFrameTo, toSeat);

  return buildMirroredViewState(
    reference,
    asSeatPlayArea(seatFrameFrom),
    asSeatPlayArea(seatFrameTo),
  );
}

function createF4ViewState(ordered: PlayArea[]): CameraViewState | null {
  const f3View = getF3ViewState();

  if (ordered.length >= 4 && ordered[2] && ordered[3]) {
    return buildMirroredViewState(f3View, ordered[2], ordered[3]);
  }

  if (ordered.length >= 3) {
    return mirrorViewBetweenVisualSeats(f3View, 1, 3);
  }

  return null;
}

function createMirroredViewState(orderedIndex: number): CameraViewState | null {
  if (!camera) return null;

  const ordered = getOrderedPlayAreas();

  if (orderedIndex === 0) {
    return getF1ReferenceViewState();
  }

  if (orderedIndex === 2) {
    return getF3ViewState();
  }

  if (orderedIndex === 3) {
    return createF4ViewState(ordered);
  }

  const reference = getF1ReferenceViewState();
  const localArea = ordered[0];
  const viewedArea = ordered[orderedIndex];
  if (!reference || !localArea || !viewedArea) return null;

  return buildMirroredViewState(reference, localArea, viewedArea);
}

function normalizeClientId(clientId: unknown): number | null {
  const id = Number(clientId);
  return Number.isFinite(id) ? id : null;
}

function findPlayAreaForClientId(clientId: unknown, playerSessionId?: string): PlayArea | undefined {
  const normalizedId = normalizeClientId(clientId);
  if (normalizedId !== null) {
    const direct = playAreas[normalizedId];
    if (direct) return direct;
  }

  const areas = Object.values(playAreas).filter(Boolean) as PlayArea[];
  if (normalizedId !== null) {
    const byClientId = areas.find(area => area.clientId === normalizedId);
    if (byClientId) return byClientId;
  }

  const sessionId =
    playerSessionId ??
    (
      players() as Array<{ id: number; entry?: { playerSessionId?: string } }>
    ).find(entry => normalizeClientId(entry.id) === normalizedId)?.entry?.playerSessionId;
  if (!sessionId) return undefined;

  const bySession = areas.find(area => area.playerSessionId === sessionId);
  if (bySession) return bySession;

  const registeredId = getRegisteredClientIdForSession(sessionId);
  if (registeredId !== undefined) {
    return playAreas[registeredId];
  }

  return undefined;
}

function refreshViewPresentation() {
  const ordered = getOrderedPlayAreas();
  const viewIndex = cameraViewPlayerIndex();
  const viewedArea = ordered[viewIndex];
  const localArea = ordered[0];

  ordered.forEach(area => {
    if (!area) return;
    if (viewIndex === 0) {
      area.hand.mesh.visible = true;
      return;
    }

    if (viewIndex === 3 && !viewedArea) {
      area.hand.mesh.visible = area !== localArea;
      return;
    }

    area.hand.mesh.visible = area !== localArea && area !== viewedArea;
  });

  Object.values(playAreas).forEach(area => area?.refreshNameTagOrientation());
}

export function getCameraViewIndexForClientId(
  clientId: number,
  playerSessionId?: string,
): number | null {
  const area = findPlayAreaForClientId(clientId, playerSessionId);
  if (!area) return null;

  const ordered = getOrderedPlayAreas();
  const index = ordered.indexOf(area);
  return index >= 0 ? index : null;
}

export function setCameraViewByPlayerIndex(orderedIndex: number) {
  if (!camera || !table) return;
  syncF1ReferenceFromSlot();
  if (!localCameraPosition || !localCameraQuaternion) captureLocalCameraView();
  if (!localCameraPosition || !localCameraQuaternion) return;

  const ordered = getOrderedPlayAreas();
  if (orderedIndex < 0) return;
  if (orderedIndex !== 3 && orderedIndex >= ordered.length) return;
  if (orderedIndex === 3 && ordered.length < 3) return;

  setCameraViewPlayerIndex(orderedIndex);

  if (orderedIndex === 2) {
    applyViewState(getF3ViewState());
  } else if (orderedIndex === 3) {
    const viewState = createF4ViewState(ordered);
    if (!viewState) return;
    applyViewState(viewState);
  } else {
    const saved = playerCameraViews.get(orderedIndex);
    if (saved) {
      applyViewState({
        position: saved.position.clone(),
        quaternion: saved.quaternion.clone(),
      });
    } else {
      const viewState = createMirroredViewState(orderedIndex);
      if (!viewState) return;
      applyViewState(viewState);
    }
  }

  refreshViewPresentation();
  afterCameraViewChange?.(orderedIndex);
}

let afterCameraViewChange: ((orderedIndex: number) => void) | undefined;

export function setAfterCameraViewChange(
  callback: ((orderedIndex: number) => void) | undefined,
) {
  afterCameraViewChange = callback;
}

export function setCameraViewMode(mode: 'local' | 'opponent') {
  if (mode === 'local') {
    setCameraViewByPlayerIndex(0);
    return;
  }

  if (getOrderedPlayAreas().length < 2) return;
  setCameraViewByPlayerIndex(1);
}

export function resetCameraView() {
  setCameraViewPlayerIndex(0);
  localCameraPosition = null;
  localCameraQuaternion = null;
  f3UserSaved = false;
  playerCameraViews.clear();
  refreshViewPresentation();
}

export function getActiveCameraViewLabel() {
  return `F${cameraViewPlayerIndex() + 1}`;
}

export function getCameraCoordinateSpaceLabel() {
  return 'World XYZ + rotation (degrees)';
}

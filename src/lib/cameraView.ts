import { createSignal } from 'solid-js';
import { Quaternion, Vector3 } from 'three';
import { camera, baseCameraQuaternion, playAreas, table } from './globals';
import type { PlayArea } from './playArea';

let localCameraPosition: Vector3 | null = null;
let localCameraQuaternion: Quaternion | null = null;
let localLookTarget: Vector3 | null = null;

const worldUp = new Vector3(0, 1, 0);
const lookTarget = new Vector3();
const SEAT_VISUAL_INDEX: Record<number, number[]> = {
  1: [0],
  2: [0, 2],
};

/** Ordered play area index: 0 = you, 1+ = other players clockwise. */
export const [cameraViewPlayerIndex, setCameraViewPlayerIndex] = createSignal(0);

/** @deprecated Use cameraViewPlayerIndex() !== 0 */
export function cameraViewMode(): 'local' | 'opponent' {
  return cameraViewPlayerIndex() === 0 ? 'local' : 'opponent';
}

export function isViewingFromRemoteSeat() {
  return cameraViewPlayerIndex() !== 0;
}

export function captureLocalCameraView() {
  if (!camera) return;
  localCameraPosition = camera.position.clone();
  localCameraQuaternion = baseCameraQuaternion.clone();
  const lookDirection = new Vector3(0, 0, -1).applyQuaternion(localCameraQuaternion);
  localLookTarget = localCameraPosition.clone().add(lookDirection);
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

function getVisualSeatIndex(orderedIndex: number, playerCount: number) {
  return SEAT_VISUAL_INDEX[playerCount]?.[orderedIndex] ?? orderedIndex;
}

function getSeatAngle(seatIndex: number) {
  switch (seatIndex) {
    case 1:
      return Math.PI / 2;
    case 2:
      return Math.PI;
    case 3:
      return (Math.PI * 3) / 2;
    default:
      return 0;
  }
}

function transformPointInTablePlane(worldPoint: Vector3, target: Vector3, angle: number) {
  const local = table.worldToLocal(worldPoint.clone());
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = local.x * cos - local.y * sin;
  const y = local.x * sin + local.y * cos;
  target.copy(table.localToWorld(new Vector3(x, y, local.z)));
}

function applySeatCameraTransform(visualSeatIndex: number) {
  if (!camera || !localCameraPosition || !localLookTarget) return;

  const angle = getSeatAngle(visualSeatIndex);
  transformPointInTablePlane(localCameraPosition, camera.position, angle);
  transformPointInTablePlane(localLookTarget, lookTarget, angle);

  camera.up.copy(worldUp);
  camera.lookAt(lookTarget);
  baseCameraQuaternion.copy(camera.quaternion);
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

    area.hand.mesh.visible = area !== localArea && area !== viewedArea;
  });

  Object.values(playAreas).forEach(area => area?.refreshNameTagOrientation());
}

export function setCameraViewByPlayerIndex(orderedIndex: number) {
  if (!camera || !table) return;
  if (!localCameraPosition || !localCameraQuaternion) captureLocalCameraView();
  if (!localCameraPosition || !localCameraQuaternion || !localLookTarget) return;

  const ordered = getOrderedPlayAreas();
  if (orderedIndex < 0 || orderedIndex >= ordered.length) return;

  const visualSeat = getVisualSeatIndex(orderedIndex, ordered.length);
  setCameraViewPlayerIndex(orderedIndex);

  if (visualSeat === 0) {
    camera.position.copy(localCameraPosition);
    baseCameraQuaternion.copy(localCameraQuaternion);
  } else {
    applySeatCameraTransform(visualSeat);
  }

  refreshViewPresentation();
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
  localLookTarget = null;
  refreshViewPresentation();
}

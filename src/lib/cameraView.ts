import { createSignal } from 'solid-js';
import { Object3D, Quaternion, Vector3 } from 'three';
import { camera, baseCameraQuaternion, getLocalPlayerClientId, playAreas, table } from './globals';

let localCameraPosition: Vector3 | null = null;
let localCameraQuaternion: Quaternion | null = null;
let localLookTarget: Vector3 | null = null;

/** Reused proxy to mirror camera position with the same rotateZ(π) as opponent play areas. */
const cameraProxy = new Object3D();
const worldUp = new Vector3(0, 1, 0);
const lookTarget = new Vector3();

export const [cameraViewMode, setCameraViewModeSignal] = createSignal<'local' | 'opponent'>('local');

export function captureLocalCameraView() {
  if (!camera) return;
  localCameraPosition = camera.position.clone();
  localCameraQuaternion = baseCameraQuaternion.clone();
  const lookDirection = new Vector3(0, 0, -1).applyQuaternion(localCameraQuaternion);
  localLookTarget = localCameraPosition.clone().add(lookDirection);
}

export function getOpponentPlayArea() {
  const localClientId = getLocalPlayerClientId();
  return Object.values(playAreas).find(area => area && area.clientId !== localClientId);
}

function resetCameraProxy() {
  cameraProxy.position.set(0, 0, 0);
  cameraProxy.rotation.set(0, 0, 0);
  cameraProxy.quaternion.set(0, 0, 0, 1);
}

function mirrorPointInTablePlane(worldPoint: Vector3, target: Vector3) {
  cameraProxy.position.copy(worldPoint);
  cameraProxy.quaternion.set(0, 0, 0, 1);
  cameraProxy.rotation.set(0, 0, 0);
  table.attach(cameraProxy);
  cameraProxy.position.x *= -1;
  cameraProxy.position.y *= -1;
  table.updateMatrixWorld(true);
  cameraProxy.getWorldPosition(target);
  table.remove(cameraProxy);
  resetCameraProxy();
}

function applyOpponentCameraTransform() {
  if (!camera || !localCameraPosition || !localCameraQuaternion || !localLookTarget || !table) {
    return;
  }

  mirrorPointInTablePlane(localCameraPosition, camera.position);
  mirrorPointInTablePlane(localLookTarget, lookTarget);

  camera.up.copy(worldUp);
  camera.lookAt(lookTarget);
  baseCameraQuaternion.copy(camera.quaternion);
}

function refreshOpponentViewPresentation() {
  const inOpponentView = cameraViewMode() === 'opponent';
  const opponent = getOpponentPlayArea();

  if (opponent) {
    opponent.hand.mesh.visible = !inOpponentView;
  }

  Object.values(playAreas).forEach(area => area?.refreshNameTagOrientation());
}

export function setCameraViewMode(mode: 'local' | 'opponent') {
  if (!camera || !table) return;
  if (!localCameraPosition || !localCameraQuaternion) captureLocalCameraView();
  if (!localCameraPosition || !localCameraQuaternion) return;
  if (mode === 'opponent' && !getOpponentPlayArea()) return;

  setCameraViewModeSignal(mode);

  if (mode === 'local') {
    camera.position.copy(localCameraPosition);
    baseCameraQuaternion.copy(localCameraQuaternion);
  } else {
    applyOpponentCameraTransform();
  }

  refreshOpponentViewPresentation();
}

export function resetCameraView() {
  setCameraViewModeSignal('local');
  localCameraPosition = null;
  localCameraQuaternion = null;
  localLookTarget = null;
  refreshOpponentViewPresentation();
}

import { createSignal } from 'solid-js';
import * as THREE from 'three';
import {
  CAMERA_TILT_CENTER_FRACTION,
  CAMERA_TILT_EDGE_FRACTION,
  CAMERA_TILT_LATERAL_BOTTOM_EXCLUDE_FRACTION,
  CAMERA_TILT_VERTICAL_UNTILT_FRACTION,
  LOOK_EASE,
  LOOK_STRENGTH_X,
  LOOK_STRENGTH_Y,
} from './constants';
import { baseCameraQuaternion, camera, isCameraTiltBlocked, isSpectating, settings } from './globals';

export type CameraTiltDirection = 'left' | 'right' | 'top';

export interface CameraTiltHintsState {
  left: boolean;
  right: boolean;
  top: boolean;
}

export const [cameraTiltHints, setCameraTiltHints] = createSignal<CameraTiltHintsState>({
  left: false,
  right: false,
  top: false,
});

let latchedTiltX = 0;
let latchedTiltY = 0;
let currentYaw = 0;
let currentPitch = 0;
let cameraTiltDisarmed = false;
let cameraTiltWasBlocked = false;

function getLateralTiltEdgeMinY() {
  return -1 + CAMERA_TILT_LATERAL_BOTTOM_EXCLUDE_FRACTION * 2;
}

function isInCameraTiltEdgeZone(ndcX: number, ndcY: number) {
  const edgeBound = 1 - CAMERA_TILT_EDGE_FRACTION * 2;
  const inTopEdge = ndcY > edgeBound;
  const inLateralEdge =
    ndcY > getLateralTiltEdgeMinY() && (ndcX < -edgeBound || ndcX > edgeBound);
  return inLateralEdge || inTopEdge;
}

function getEdgeFlags(ndcX: number, ndcY: number) {
  const edgeBound = 1 - CAMERA_TILT_EDGE_FRACTION * 2;
  const lateralEdgeMinY = getLateralTiltEdgeMinY();
  return {
    inLeftEdge: ndcX < -edgeBound && ndcY > lateralEdgeMinY,
    inRightEdge: ndcX > edgeBound && ndcY > lateralEdgeMinY,
    inTopEdge: ndcY > edgeBound,
  };
}

function clearCameraTiltHints() {
  setCameraTiltHints({ left: false, right: false, top: false });
}

function releaseCameraTiltLatch() {
  latchedTiltX = 0;
  latchedTiltY = 0;
}

export function onCameraMouseLeave() {
  releaseCameraTiltLatch();
  cameraTiltDisarmed = true;
  clearCameraTiltHints();
}

export function resetCameraTiltInstant() {
  releaseCameraTiltLatch();
  currentYaw = 0;
  currentPitch = 0;
  camera?.quaternion.copy(baseCameraQuaternion);
  clearCameraTiltHints();
}

export function onCameraViewChange() {
  resetCameraTiltInstant();
  cameraTiltDisarmed = false;
  cameraTiltWasBlocked = isCameraTiltBlocked();
}

function isCameraTiltAnimatingToRest() {
  return (
    latchedTiltX !== 0 ||
    latchedTiltY !== 0 ||
    Math.abs(currentYaw) > 1e-4 ||
    Math.abs(currentPitch) > 1e-4
  );
}

export function applyCameraTiltAnimation() {
  const targetYaw = -latchedTiltX * LOOK_STRENGTH_X;
  const targetPitch = latchedTiltY * LOOK_STRENGTH_Y;

  currentYaw += (targetYaw - currentYaw) * LOOK_EASE;
  currentPitch += (targetPitch - currentPitch) * LOOK_EASE;

  if (latchedTiltX === 0 && latchedTiltY === 0) {
    if (Math.abs(currentYaw) < 1e-4) currentYaw = 0;
    if (Math.abs(currentPitch) < 1e-4) currentPitch = 0;
  }

  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), currentYaw);
  const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), currentPitch);

  camera.quaternion.copy(baseCameraQuaternion).multiply(yawQ).multiply(pitchQ);
}

export function updateCameraTiltBlockedState(tiltBlocked: boolean) {
  if (cameraTiltWasBlocked && !tiltBlocked) {
    cameraTiltDisarmed = true;
  }
  cameraTiltWasBlocked = tiltBlocked;
}

function updateCameraTiltHints(ndcX: number, ndcY: number) {
  if (!settings.enableCameraTilt || isSpectating() || isCameraTiltBlocked()) {
    clearCameraTiltHints();
    return;
  }

  if (cameraTiltDisarmed) {
    if (!isInCameraTiltEdgeZone(ndcX, ndcY)) {
      cameraTiltDisarmed = false;
    } else {
      clearCameraTiltHints();
      return;
    }
  }

  const { inLeftEdge, inRightEdge, inTopEdge } = getEdgeFlags(ndcX, ndcY);

  setCameraTiltHints({
    left: inLeftEdge && latchedTiltY === 0 && latchedTiltX !== -1,
    right: inRightEdge && latchedTiltY === 0 && latchedTiltX !== 1,
    top: inTopEdge && latchedTiltX === 0 && latchedTiltY !== 1,
  });
}

function updateCameraTiltUntilt(ndcX: number, ndcY: number) {
  const centerBound = CAMERA_TILT_CENTER_FRACTION * 2;
  const inHorizontalCenter = Math.abs(ndcX) <= centerBound;
  const verticalUntiltCenter = -CAMERA_TILT_VERTICAL_UNTILT_FRACTION * 2;
  const inVerticalCenter = Math.abs(ndcY - verticalUntiltCenter) <= centerBound;

  if (inHorizontalCenter) latchedTiltX = 0;
  if (inVerticalCenter) latchedTiltY = 0;
}

export function activateCameraTilt(direction: CameraTiltDirection) {
  if (!settings.enableCameraTilt || isSpectating() || isCameraTiltBlocked() || cameraTiltDisarmed) {
    return;
  }

  if (direction === 'left' && latchedTiltY === 0) {
    latchedTiltX = -1;
  } else if (direction === 'right' && latchedTiltY === 0) {
    latchedTiltX = 1;
  } else if (direction === 'top' && latchedTiltX === 0) {
    latchedTiltY = 1;
  }
}

export function animateCameraLook(ndcX: number, ndcY: number) {
  updateCameraTiltHints(ndcX, ndcY);
  updateCameraTiltUntilt(ndcX, ndcY);
  applyCameraTiltAnimation();
}

export function animateCameraTiltToRest() {
  if (latchedTiltX !== 0 || latchedTiltY !== 0) {
    releaseCameraTiltLatch();
  }
  clearCameraTiltHints();
  if (isCameraTiltAnimatingToRest()) {
    applyCameraTiltAnimation();
  }
}

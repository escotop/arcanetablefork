import { createSignal } from 'solid-js';
import type { Intersection } from 'three';
import {
  getPingWheelSectorIndex,
  PING_WHEEL_TYPES,
  type PingTypeId,
} from './pingTypes';

export const [pingWheelOpen, setPingWheelOpen] = createSignal(false);
export const [pingWheelCenter, setPingWheelCenter] = createSignal({ x: 0, y: 0 });
export const [pingWheelHoverIndex, setPingWheelHoverIndex] = createSignal(0);

let pendingPingHit: Intersection | null = null;
let pingWheelDragActive = false;
let pingWheelReleaseClaimed = false;
let pingModifierHeld = false;
let gKeyPressUsedForWheel = false;
let gKeyQuickPingClaimed = false;
let pingWheelKeysInstalled = false;

export interface PingWheelKeyOptions {
  onQuickPing?: () => void;
}

export function isPingModifierHeld() {
  return pingModifierHeld;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function setupPingWheelKeys(options: PingWheelKeyOptions = {}) {
  if (typeof window === 'undefined' || pingWheelKeysInstalled) return;
  pingWheelKeysInstalled = true;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.key.toLowerCase() !== 'g') return;
    if (isTypingTarget(event.target)) return;
    gKeyPressUsedForWheel = false;
    gKeyQuickPingClaimed = false;
    pingModifierHeld = true;
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.repeat || event.key.toLowerCase() !== 'g') return;
    pingModifierHeld = false;

    if (isTypingTarget(event.target)) return;

    if (gKeyPressUsedForWheel || isPingWheelDragActive()) return;

    if (gKeyQuickPingClaimed) return;
    gKeyQuickPingClaimed = true;
    options.onQuickPing?.();
  };

  const onBlur = () => {
    pingModifierHeld = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
}

export function isPingWheelDragActive() {
  return pingWheelDragActive;
}

export function startPingWheelDrag(hit: Intersection, clientX: number, clientY: number) {
  pendingPingHit = hit;
  pingWheelDragActive = true;
  pingWheelReleaseClaimed = false;
  gKeyPressUsedForWheel = true;
  setPingWheelCenter({ x: clientX, y: clientY });
  setPingWheelHoverIndex(
    getPingWheelSectorIndex(clientX, clientY, clientX, clientY, PING_WHEEL_TYPES.length),
  );
  setPingWheelOpen(true);
}

export function updatePingWheelHover(clientX: number, clientY: number) {
  if (!pingWheelDragActive) return;
  const center = pingWheelCenter();
  setPingWheelHoverIndex(
    getPingWheelSectorIndex(center.x, center.y, clientX, clientY, PING_WHEEL_TYPES.length),
  );
}

export function cancelPingWheelDrag() {
  if (pingWheelDragActive) {
    gKeyPressUsedForWheel = true;
  }
  pendingPingHit = null;
  pingWheelDragActive = false;
  pingWheelReleaseClaimed = true;
  setPingWheelOpen(false);
  setPingWheelHoverIndex(0);
}

export function consumePingWheelDrag(clientX: number, clientY: number): { hit: Intersection; type: PingTypeId } | null {
  return finishPingWheelDrag(clientX, clientY);
}

/** Pick sector from release position. Only the first release event per drag is handled. */
export function finishPingWheelDrag(clientX: number, clientY: number) {
  if (!pingWheelDragActive || pingWheelReleaseClaimed) return null;
  pingWheelReleaseClaimed = true;
  pingWheelDragActive = false;
  setPingWheelOpen(false);

  const center = pingWheelCenter();
  const sectorIndex = getPingWheelSectorIndex(
    center.x,
    center.y,
    clientX,
    clientY,
    PING_WHEEL_TYPES.length,
  );

  const hit = pendingPingHit;
  const type = PING_WHEEL_TYPES[sectorIndex]?.id ?? PING_WHEEL_TYPES[0].id;

  pendingPingHit = null;
  setPingWheelHoverIndex(0);

  gKeyPressUsedForWheel = true;

  if (!hit) return null;
  return { hit, type };
}

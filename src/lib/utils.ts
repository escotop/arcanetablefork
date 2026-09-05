import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import get from 'lodash-es/get';
import set from 'lodash-es/set';
import { twMerge } from 'tailwind-merge';
import { Box3, Euler, Intersection, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { CARD_STACK_OFFSET, CARD_THICKNESS, CARD_WIDTH } from './constants';
import { cardsById, camera, zonesById } from './globals';
import { createAnimationEvent } from './createEvents';
import { animateObject } from './animations';
import { resolveStackAnchor } from './footprintOverlap';
import { getRotationFromCardState } from './card';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `+N`/`-N` adjust current life; `40-6` style expressions; plain integer sets absolute life. */
export function parseLifeInput(value: string, currentLife: number): number | undefined {
  const trimmed = value.trim().replace(/\s+/g, '');
  if (!trimmed) return currentLife;

  const relativeAdd = trimmed.match(/^\+(\d+)$/);
  if (relativeAdd) return currentLife + parseInt(relativeAdd[1], 10);

  const relativeSub = trimmed.match(/^-(\d+)$/);
  if (relativeSub) return currentLife - parseInt(relativeSub[1], 10);

  if (/^-?\d+([+-]\d+)+$/.test(trimmed)) {
    const tokens = trimmed.match(/[+-]?\d+/g);
    if (!tokens?.length) return undefined;
    return tokens.reduce((sum, token) => sum + parseInt(token, 10), 0);
  }

  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  return undefined;
}

export function isVectorEqual(a: Vector3 | Euler, b: Vector3 | Euler) {
  if (!a || !b) return false;
  let ab = a.toArray();
  let bb = b.toArray();
  for (let i in ab) {
    if (ab[i] !== bb[i]) return false;
  }
  return true;
}
export function hydratePathWith<T>(obj: any, path: string[], hydrator: (value: any) => T) {
  if (get(obj, path)) {
    set(obj, path, hydrator(get(obj, path)));
  }
}
export function cleanMaterial(material: Material) {
  material.dispose();

  // dispose textures
  for (const key of Object.keys(material)) {
    const value = material[key];
    if (value && typeof value === 'object' && 'minFilter' in value) {
      value.dispose();
    }
  }
}

export function isValidMaterial(mat) {
  return mat && mat.isMaterial === true && typeof mat.onBeforeRender === 'function';
}

export function cleanupMesh(object: Mesh) {
  if (!object.isMesh) return;
  object.geometry.dispose();
  if (object.material.isMaterial) {
    cleanMaterial(object.material);
  } else {
    for (const material of object.material) cleanMaterial(material);
  }
}

export function cleanupFromNode(root: Object3D, isScene?: boolean) {
  root.traverse(object => {
    if (!object.isMesh) return;
    cleanupMesh(object);
    if (!isScene) root.remove(object);
  });
}

export function getGlobalRotation(mesh: Object3D) {
  let initialQuart = new Quaternion();
  mesh.getWorldQuaternion(initialQuart);
  let euler = new Euler().setFromQuaternion(initialQuart);
  return euler;
}
export function getFocusCameraPositionRelativeTo(target: Object3D) {
  const distance = 26;
  const box = new Box3().setFromObject(target);
  const lookAt = box.getCenter(new Vector3());

  const worldQuat = target.getWorldQuaternion(new Quaternion());
  const frontNormal = new Vector3(0, 0, 1).applyQuaternion(worldQuat).normalize();
  const backNormal = frontNormal.clone().negate();
  const up = new Vector3(0, 1, 0).applyQuaternion(worldQuat).normalize();

  // Face whose normal points toward the main camera is the one the player sees.
  const toCamera = camera.position.clone().sub(lookAt).normalize();
  const faceNormal = frontNormal.dot(toCamera) >= backNormal.dot(toCamera) ? frontNormal : backNormal;
  const position = lookAt.clone().add(faceNormal.multiplyScalar(distance));

  return { position, lookAt, up };
}

export async function sha1(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export function shuffleItems<T>(items: T[], order?: number[]) {
  let newOrder = [];
  for (let i = 0; i < items.length; i++) {
    let j = order?.[i] ?? (Math.random() * (i + 1)) | 0;
    [items[i], items[j]] = [items[j], items[i]];
    newOrder[i] = j;
  }
  return newOrder;
}

export function resolveDropTargetObject(object: Object3D): Object3D | undefined {
  let current: Object3D | null = object;
  while (current) {
    const ud = current.userData;
    if (ud?.zoneId && zonesById.has(ud.zoneId)) {
      return current;
    }
    if (
      ud?.location === 'deck' ||
      ud?.location === 'graveyard' ||
      ud?.location === 'exile' ||
      ud?.location === 'hand'
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

export function restackItemsLocally(items: Object3D[], intersections: Intersection[]) {
  if (!intersections.length) return;

  let targetsById = Object.fromEntries(items.map(target => [target.userData.id, target]));
  let intersection = intersections.find(i => {
    if (targetsById[i.object.userData.id]) return false;
    return resolveDropTargetObject(i.object) !== undefined;
  });

  if (!intersection) return;
  if (!items?.[0]?.parent) return;

  const destZoneObject = resolveDropTargetObject(intersection.object);
  if (!destZoneObject) return;
  const localAnchor = destZoneObject.worldToLocal(intersection.point.clone());
  const resolvedLocal = resolveStackAnchor(localAnchor, destZoneObject, items);
  const anchor = items[0].parent.worldToLocal(destZoneObject.localToWorld(resolvedLocal));
  const targetWorldQuat = destZoneObject.getWorldQuaternion(new Quaternion());

  return items.forEach((item, i) => {
    if (!item.parent) return;
    const sourceWorldQuat = item.parent.getWorldQuaternion(new Quaternion());
    const localOffset = new Vector3().fromArray(item.userData.dragOffset);

    const anchorWorld = item.parent
      .localToWorld(anchor.clone())
      .add(localOffset.applyQuaternion(targetWorldQuat));
    let position = item.parent.worldToLocal(anchorWorld);

    const localQuat = sourceWorldQuat.clone().invert().multiply(targetWorldQuat.clone())

    localQuat.multiply(getRotationFromCardState(item.userData))

    item.position.copy(position);
    item.quaternion.copy(localQuat);
  });
}

export function restackItems(anchor: Vector3, items: Object3D[]) {
  if (!items[0]?.parent) return [];

  if (!items?.[0]?.parent) return [];
  return Promise.all(
    items.flatMap((item, i) => {
      if (!item.parent) return [];
      let localOffset = new Vector3();

      if (item.userData.dragOffset) {
        localOffset.fromArray(item.userData.dragOffset)
      }

      let position = anchor.clone().add(localOffset);

      return animateObject(item, {
        completeOnCancel: true,
        duration: 0,
        to: { position, quarternion: getRotationFromCardState(item.userData) },
      });
    }),
  );
}

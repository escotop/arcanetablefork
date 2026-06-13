import {
  CatmullRomCurve3,
  CurveJSON,
  Euler,
  EulerTuple,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { clock, expect, sendEvent } from './globals';
import { setCardData } from './card';

export interface AnimationOpts {
  from?: {
    position?: Vector3;
    rotation?: Euler;
    quarternion?: Quaternion;
  };
  to?: {
    position?: Vector3;
    rotation?: Euler;
    quarternion?: Quaternion;
  };
  path?: CatmullRomCurve3;
  duration: number;
  start?: number;
  completeOnCancel?: boolean;
  onComplete?: () => void;
}

export interface SerializedAnimationOpts {
  from?: {
    position?: number[];
    rotation?: EulerTuple;
    quarternion?: number[];
  };
  to?: {
    position?: number[];
    rotation?: EulerTuple;
    quarternion?: number[];
  };
  path?: CurveJSON;
  duration: number;
  start?: number;
  completeOnCancel?: boolean;
}

export interface AnimationGroup {
  animatingObjects: Set<{ obj: Object3D } & AnimationOpts>;
  animationMap: Map<string, any>;
}

export const animationGroupQueue: AnimationGroup[] = [];
queueAnimationGroup();

export function rehydrateAnimation(serialized: SerializedAnimationOpts): AnimationOpts {
  const opts = structuredClone(serialized) as AnimationOpts;

  if (serialized.to?.position) {
    if (!Array.isArray(serialized.to.position))
      throw new Error(
        `rehydrateAnimation opts.to.position not serialized ${serialized.to.position}`,
      );
    opts.to!.position = new Vector3().fromArray(serialized.to.position);
  }
  if (serialized.from?.position) {
    if (!Array.isArray(serialized.from.position))
      throw new Error(
        `rehydrateAnimation opts.from.position not serialized ${serialized.from.position}`,
      );
    opts.from!.position = new Vector3().fromArray(serialized.from.position);
  }

  if (serialized.to?.rotation) {
    if (!Array.isArray(serialized.to.rotation))
      throw new Error(
        `rehydrateAnimation opts.to.rotation not serialized ${serialized.to.rotation}`,
      );
    opts.to!.rotation = new Euler().fromArray(serialized.to.rotation);
  }
  if (serialized.from?.rotation) {
    if (!Array.isArray(serialized.from.rotation))
      throw new Error(
        `rehydrateAnimation opts.from.rotation not serialized ${serialized.from.rotation}`,
      );
    opts.from!.rotation = new Euler().fromArray(serialized.from.rotation);
  }

  if (serialized.to?.quarternion) {
    if (!Array.isArray(serialized.to.quarternion))
      throw new Error(
        `rehydrateAnimation opts.to.quarternion not serialized ${serialized.to.quarternion}`,
      );
    opts.to!.quarternion = new Quaternion().fromArray(serialized.to.quarternion);
  }
  if (serialized.from?.quarternion) {
    if (!Array.isArray(serialized.from.quarternion))
      throw new Error(
        `rehydrateAnimation opts.from.quarternion not serialized ${serialized.from.quarternion}`,
      );
    opts.from!.quarternion = new Quaternion().fromArray(serialized.from.quarternion);
  }

  if (serialized.path) {
    if (!Array.isArray(serialized.path))
      throw new Error(`rehydrateAnimation opts.to.rotation not serialized ${serialized.path}`);
    opts.path = new CatmullRomCurve3().fromJSON(serialized.path);
  }
  return opts;
}

export function serializeAnimation(opts: AnimationOpts): SerializedAnimationOpts {
  const { to, from, path, ...rest } = opts;
  const serialized: any = { ...rest };

  if (to) {
    serialized.to = {};
    if (to.position) serialized.to.position = to.position.toArray();
    if (to.rotation) serialized.to.rotation = to.rotation.toArray();
    if (to.quarternion) serialized.to.quarternion = to.quarternion.toArray();
  }
  if (from) {
    serialized.from = {};
    if (from.position) serialized.from.position = from.position.toArray();
    if (from.rotation) serialized.from.rotation = from.rotation.toArray();
    if (from.quarternion) serialized.from.quarternion = from.quarternion.toArray();
  }
  if (path) serialized.path = path.toJSON();

  return serialized;
}

export function queueAnimationGroup(emit?: boolean) {
  if (emit) {
    sendEvent({ type: 'queueAnimationGroup' });
  }
  animationGroupQueue.push({
    animatingObjects: new Set<{ obj: Object3D } & AnimationOpts>(),
    animationMap: new Map<string, any>(),
  });
}

export function animateObject(obj: Object3D, opts: AnimationOpts) {
  expect(animationGroupQueue.length > 0, `animationGroupQueue empty!`);
  const { animationMap, animatingObjects } = animationGroupQueue.at(-1)!;

  if (opts.to?.position && !(opts.to.position instanceof Vector3)) {
    throw new Error(`animateObject: to.position is not a Vector3 for object ${obj.userData.id}`);
  }
  if (opts.from?.position && !(opts.from.position instanceof Vector3)) {
    throw new Error(`animateObject: from.position is not a Vector3 for object ${obj.userData.id}`);
  }

  if (opts.path) {
    const badIndex = opts.path.points.findIndex(p => !p);
    if (badIndex !== -1) {
      throw new Error(
        `animateObject: CatmullRomCurve3 has undefined point at index ${badIndex} for object ${obj.userData.id} (${obj.userData.location})`,
      );
    }
  }

  if (animationMap.has(obj.uuid)) {
    let animation = animationMap.get(obj.uuid);
    if (animation.completeOnCancel) renderAnimation(animationMap.get(obj.uuid), 1);
    cancelAnimation(obj);

    animatingObjects.delete(animation);
    animationMap.delete(obj.uuid);
  }

  if (!opts.from) {
    opts.from = {};
  }

  if (opts.to?.position && !opts.from.position) {
    opts.from.position = obj.position.clone();
  }

  if (opts.to?.rotation && !opts.from.rotation) {
    opts.from.rotation = obj.rotation.clone();
  }

  if (opts.to?.rotation) {
    opts.from.quarternion = new Quaternion().setFromEuler(opts.from.rotation);
    opts.to.quarternion = new Quaternion().setFromEuler(opts.to.rotation);
  }

  let animation = {
    obj,
    ...opts,
    start: clock.elapsedTime,
  };

  setCardData(obj, 'isAnimating', true);
  animationMap.set(obj.uuid, animation);
  animatingObjects.add(animation);
}

export function cancelAnimation(obj: Object3D) {
  const { animationMap, animatingObjects } = animationGroupQueue.at(-1)!;
  let animation = animationMap.get(obj.uuid);
  animationMap.delete(obj.uuid);
  animatingObjects.delete(animation);
}

function renderAnimation(animation, delta: number): boolean {
  if (animation.path) {
    animation.path.getPointAt(delta, animation.obj.position);
  }

  if (animation.to?.position) {
    let from = animation.from?.position ?? animation.to?.position;
    animation.obj.position.copy(from.clone().lerp(animation.to.position, delta));
  }
  if (animation.to?.rotation) {
    let from = animation.from?.quarternion ?? animation.to?.quarternion;
    animation.obj.quaternion.copy(from.clone().slerp(animation.to.quarternion!.clone(), delta));
  }

  if (delta >= 1) {
    setCardData(animation.obj, 'isAnimating', false);
    if (animation.onComplete) {
      animation.onComplete();
    }
    return true;
  }
  return false;
}

export function renderAnimations(time: number) {
  expect(animationGroupQueue.length > 0, `animationGroupQueue empty!`);
  const { animatingObjects, animationMap } = animationGroupQueue[0];
  for (const animation of animatingObjects) {
    let t = Math.max(0, Math.min((time - animation.start) / animation.duration, 1));
    if (renderAnimation(animation, t)) {
      animatingObjects.delete(animation);
      animationMap.delete(animation.obj.uuid);
    }
  }
  if (animatingObjects.size < 1 && animationGroupQueue.length > 1) {
    animatingObjects.clear();
    animationGroupQueue[0].animationMap.clear();
    animationGroupQueue.shift();
    animationGroupQueue[0].animatingObjects.forEach(animation => {
      animation.start = clock.elapsedTime;
    });
  }
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

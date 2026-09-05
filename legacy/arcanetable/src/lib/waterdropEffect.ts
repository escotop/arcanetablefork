import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from 'three';
import { scene } from './globals';

interface WaterdropPart {
  mesh: Mesh;
  material: MeshBasicMaterial;
}

interface WaterdropInstance {
  group: Group;
  ring: WaterdropPart;
  dot: WaterdropPart;
  age: number;
  duration: number;
}

const DROP_DURATION = 0.45;
const PING_SIZE = 2.25;
/** Lift along the surface normal so the ping clears stacked cards. */
const PING_SURFACE_LIFT = 2;
const PING_RENDER_ORDER = 1000;
const ACTIVE_DROPS: WaterdropInstance[] = [];

function disposeWaterdrop(drop: WaterdropInstance) {
  drop.group.removeFromParent();
  [drop.ring, drop.dot].forEach(({ mesh, material }) => {
    mesh.geometry.dispose();
    material.dispose();
  });
}

export function clearWaterdrops() {
  ACTIVE_DROPS.splice(0).forEach(disposeWaterdrop);
}

export function updateWaterdrops(delta: number) {
  for (let i = ACTIVE_DROPS.length - 1; i >= 0; i--) {
    const drop = ACTIVE_DROPS[i];
    drop.age += delta;

    if (drop.age >= drop.duration) {
      disposeWaterdrop(drop);
      ACTIVE_DROPS.splice(i, 1);
      continue;
    }

    const t = drop.age / drop.duration;
    const ringScale = 0.4 + t * 1.5;
    drop.ring.mesh.scale.set(ringScale, ringScale, ringScale);
    drop.ring.material.opacity = (1 - t) * 1;

    const dotScale = 1 - t * 0.35;
    drop.dot.mesh.scale.set(dotScale, dotScale, dotScale);
    drop.dot.material.opacity = (1 - t * 1.1) * 1;
  }
}

export const DEFAULT_WATERDROP_NORMAL: [number, number, number] = [0, 1, 0];

function toVector3(value: Vector3 | [number, number, number] | undefined, fallback: Vector3) {
  if (value instanceof Vector3) return value.clone();
  if (Array.isArray(value) && value.length === 3) return new Vector3().fromArray(value);
  return fallback.clone();
}

/** Quick ping marker at a world-space point on the table. */
export function spawnWaterdrop(
  worldPosition: Vector3 | [number, number, number] | undefined,
  worldNormal: Vector3 | [number, number, number] | undefined,
  color: string | undefined,
) {
  if (!scene || !color) return;

  const position = toVector3(worldPosition, new Vector3());
  if (!worldPosition) return;

  const normal = toVector3(worldNormal, new Vector3().fromArray(DEFAULT_WATERDROP_NORMAL)).normalize();

  position.addScaledVector(normal, PING_SURFACE_LIFT);

  const group = new Group();
  group.position.copy(position);
  group.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);
  group.renderOrder = PING_RENDER_ORDER;
  scene.add(group);

  const threeColor = new Color(color);

  const ringMaterial = new MeshBasicMaterial({
    color: threeColor,
    transparent: true,
    opacity: 1,
    side: DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const ringMesh = new Mesh(
    new RingGeometry(1.1 * PING_SIZE, 1.55 * PING_SIZE, 24),
    ringMaterial,
  );
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.renderOrder = PING_RENDER_ORDER;
  group.add(ringMesh);

  const dotMaterial = new MeshBasicMaterial({
    color: threeColor,
    transparent: true,
    opacity: 1,
    side: DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const dotMesh = new Mesh(new CircleGeometry(0.65 * PING_SIZE, 20), dotMaterial);
  dotMesh.rotation.x = -Math.PI / 2;
  dotMesh.renderOrder = PING_RENDER_ORDER;
  group.add(dotMesh);

  ACTIVE_DROPS.push({
    group,
    ring: { mesh: ringMesh, material: ringMaterial },
    dot: { mesh: dotMesh, material: dotMaterial },
    age: 0,
    duration: DROP_DURATION,
  });
}

export function worldNormalFromIntersection(faceNormal: Vector3, objectMatrixWorld: Matrix4) {
  return faceNormal.clone().transformDirection(objectMatrixWorld).normalize();
}

import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { CARD_WIDTH, CARD_HEIGHT,  CARD_THICKNESS } from './constants';

const HW = CARD_WIDTH / 2;
const HH = CARD_HEIGHT / 2;
const STEP = CARD_THICKNESS; // stack height increment (along Z)
const TABLE_Z = 0;
const REACH2 = (2 * Math.hypot(HW, HH)) ** 2; // squared sum of bounding radii

const _e = new Euler();
const zRot = (q: Quaternion) => _e.setFromQuaternion(q, 'ZYX').z; // in-plane spin / tap

// SAT overlap of two oriented rectangles in the XY plane (height-independent)
function footprintsOverlap(
  ax: number,
  ay: number,
  aRot: number,
  bx: number,
  by: number,
  bRot: number,
): boolean {
  const a = [Math.cos(aRot), Math.sin(aRot), -Math.sin(aRot), Math.cos(aRot)];
  const b = [Math.cos(bRot), Math.sin(bRot), -Math.sin(bRot), Math.cos(bRot)];
  const dx = bx - ax,
    dy = by - ay;
  for (const [nx, ny] of [
    [a[0], a[1]],
    [a[2], a[3]],
    [b[0], b[1]],
    [b[2], b[3]],
  ]) {
    const ra = HW * Math.abs(nx * a[0] + ny * a[1]) + HH * Math.abs(nx * a[2] + ny * a[3]);
    const rb = HW * Math.abs(nx * b[0] + ny * b[1]) + HH * Math.abs(nx * b[2] + ny * b[3]);
    if (Math.abs(dx * nx + dy * ny) > ra + rb) return false; // separating axis
  }
  return true;
}

// export function resolveStackAnchor(anchor: Vector3, parent: Object3D, items: Object3D[]): Vector3 {
//   const held = new Set(items.map(i => i.userData.id));
//   const dragRot = zRot(items[0].quaternion);

//   let topZ: number | null = null;

//   for (const child of parent.children) {
//     if (held.has(child.userData.id) || !child.userData.isInteractive) continue;

//     const dx = child.position.x - anchor.x;
//     const dy = child.position.y - anchor.y;
//     if (dx * dx + dy * dy >= REACH2) continue; // sphere reject (XY)

//     if (
//       !footprintsOverlap(
//         anchor.x,
//         anchor.y,
//         dragRot,
//         child.position.x,
//         child.position.y,
//         zRot(child.quaternion),
//       )
//     )
//       continue; // OBB narrow phase

//     if (topZ === null || child.position.z > topZ) topZ = child.position.z; // topmost
//   }

//   const out = anchor.clone();
//   out.z = topZ === null ? TABLE_Z : topZ + STEP;
//   return out;
// }
//
//
//
export function resolveStackAnchor(anchor: Vector3, parent: Object3D, items: Object3D[]): Vector3 {
  const held = new Set(items.map(i => i.userData.id));
  const dragRot = zRot(items[0].quaternion);

  type C = { x: number; y: number; z: number; rot: number };
  const cands: C[] = [];
  for (const c of parent.children) {
    if (held.has(c.userData.id) || !c.userData.isInteractive) continue;
    cands.push({ x: c.position.x, y: c.position.y, z: c.position.z, rot: zRot(c.quaternion) });
  }

  const near = (ax: number, ay: number, b: C) => {
    const dx = b.x - ax, dy = b.y - ay;
    return dx * dx + dy * dy < REACH2;
  };

  // cards the dropped footprint directly touches
  const pile = new Set<C>();
  for (const c of cands)
    if (near(anchor.x, anchor.y, c) && footprintsOverlap(anchor.x, anchor.y, dragRot, c.x, c.y, c.rot))
      pile.add(c);

  // flood-fill: anything overlapping the pile is part of the same stack (e.g. Putrefy on Simic)
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pile)
      for (const c of cands)
        if (!pile.has(c) && near(p.x, p.y, c) && footprintsOverlap(p.x, p.y, p.rot, c.x, c.y, c.rot)) {
          pile.add(c);
          grew = true;
        }
  }

  let topZ: number | null = null;
  for (const p of pile) if (topZ === null || p.z > topZ) topZ = p.z;

  const out = anchor.clone();
  out.z = topZ === null ? TABLE_Z : topZ + STEP;
  return out;
}

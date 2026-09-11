import { nanoid } from 'nanoid';
import { Matrix4, Object3D, Vector3 } from 'three';
import { playAreas, provider, table, cardsById } from './globals';
import type { PlayArea } from './playArea';
import { displayPlayerColor } from './playerColor';
import type { PingTypeId } from './pingTypes';
import { spawnVideoPing } from './pingVideoEffect';
import {
  DEFAULT_WATERDROP_NORMAL,
  spawnWaterdrop,
  worldNormalFromIntersection,
} from './waterdropEffect';
import type { Intersection } from 'three';

export interface PingPayload {
  id: string;
  type?: PingTypeId;
  space: 'playArea' | 'table';
  /** playAreas key when space is playArea */
  playAreaClientId?: number;
  position: [number, number, number];
  normal: [number, number, number];
  color: string;
}

const lastPingIdByClient = new Map<number, string>();

export function clearPingSync() {
  lastPingIdByClient.clear();
}

function findPlayAreaForHit(object: Object3D): PlayArea | undefined {
  for (const area of Object.values(playAreas)) {
    if (!area) continue;
    if (object === area.battlefieldZone.mesh) return area;

    let node: Object3D | null = object;
    while (node) {
      if (node === area.mesh) return area;
      node = node.parent;
    }
  }
  return undefined;
}

function worldToLocalDirection(worldNormal: Vector3, matrixWorld: Matrix4) {
  return worldNormal
    .clone()
    .transformDirection(new Matrix4().copy(matrixWorld).invert())
    .normalize();
}

function localToWorldDirection(localNormal: Vector3, matrixWorld: Matrix4) {
  return localNormal.clone().transformDirection(matrixWorld).normalize();
}

function resolvePingToWorld(ping: PingPayload) {
  if (ping.space === 'table') {
    if (!table) return null;

    const position = new Vector3().fromArray(ping.position);
    table.localToWorld(position);

    const normal = localToWorldDirection(
      new Vector3().fromArray(ping.normal),
      table.matrixWorld,
    );

    return { position, normal };
  }

  const playArea = ping.playAreaClientId !== undefined ? playAreas[ping.playAreaClientId] : undefined;
  if (!playArea) return null;

  const position = new Vector3().fromArray(ping.position);
  playArea.mesh.localToWorld(position);

  const normal = localToWorldDirection(
    new Vector3().fromArray(ping.normal),
    playArea.mesh.matrixWorld,
  );

  return { position, normal };
}

function spawnPing(ping: PingPayload) {
  const world = resolvePingToWorld(ping);
  if (!world) return;

  if (ping.type) {
    spawnVideoPing(world.position, world.normal, ping.type);
    return;
  }

  spawnWaterdrop(world.position, world.normal, ping.color);
}

function buildPingFromHit(hit: Intersection, type?: PingTypeId): PingPayload | undefined {
  if (!hit.face) return undefined;

  const worldNormal = worldNormalFromIntersection(hit.face.normal, hit.object.matrixWorld);
  const color = displayPlayerColor(provider?.awareness?.getLocalState());
  const playArea = findPlayAreaForHit(hit.object);

  if (playArea) {
    const localPoint = playArea.mesh.worldToLocal(hit.point.clone());
    const localNormal = worldToLocalDirection(worldNormal, playArea.mesh.matrixWorld);

    return {
      id: nanoid(),
      type,
      space: 'playArea',
      playAreaClientId: playArea.clientId,
      position: localPoint.toArray(),
      normal: localNormal.toArray(),
      color,
    };
  }

  if (table) {
    const localPoint = table.worldToLocal(hit.point.clone());
    const localNormal = worldToLocalDirection(worldNormal, table.matrixWorld);

    return {
      id: nanoid(),
      type,
      space: 'table',
      position: localPoint.toArray(),
      normal: localNormal.toArray(),
      color,
    };
  }

  return undefined;
}

export function publishTablePingFromHit(hit: Intersection, type?: PingTypeId) {
  if (!provider?.awareness) return;

  const ping = buildPingFromHit(hit, type);
  if (!ping) return;

  const clientId = provider.awareness.clientID;
  lastPingIdByClient.set(clientId, ping.id);
  spawnPing(ping);
  provider.awareness.setLocalStateField('ping', ping);
}

export function isTablePingSurface(object: Object3D) {
  if (object === table) return true;

  for (const area of Object.values(playAreas)) {
    if (!area) continue;
    if (object === area.battlefieldZone.mesh || object === area.mesh) return true;
  }

  return false;
}

export function isCardPingTarget(object: Object3D) {
  let current: Object3D | null = object;
  while (current) {
    if (current.userData?.id && cardsById.has(current.userData.id)) return true;
    current = current.parent;
  }
  return false;
}

function applyRemotePing(clientId: number, ping: PingPayload | undefined) {
  if (!ping?.id || !ping.position || !ping.color) return;
  if (lastPingIdByClient.get(clientId) === ping.id) return;

  lastPingIdByClient.set(clientId, ping.id);

  if (!ping.space) {
    if (ping.type) {
      spawnVideoPing(
        new Vector3().fromArray(ping.position),
        new Vector3().fromArray(ping.normal ?? DEFAULT_WATERDROP_NORMAL),
        ping.type,
      );
    } else {
      spawnWaterdrop(ping.position, ping.normal ?? DEFAULT_WATERDROP_NORMAL, ping.color);
    }
    return;
  }

  spawnPing(ping);
}

export function handlePingAwarenessChanges(change: {
  added?: number[];
  updated?: number[];
}) {
  if (!provider?.awareness) return;

  const clientIds = [...(change.added ?? []), ...(change.updated ?? [])];
  for (const clientId of clientIds) {
    if (clientId === provider.awareness.clientID) continue;
    const ping = provider.awareness.getStates().get(clientId)?.ping as PingPayload | undefined;
    applyRemotePing(clientId, ping);
  }
}

import { nanoid } from 'nanoid';
import { Matrix4, Object3D, Vector3 } from 'three';
import { playAreas, provider, table } from './globals';
import type { PlayArea } from './playArea';
import { displayPlayerColor } from './playerColor';
import {
  DEFAULT_WATERDROP_NORMAL,
  spawnWaterdrop,
  worldNormalFromIntersection,
} from './waterdropEffect';
import type { Intersection } from 'three';

export interface PingPayload {
  id: string;
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
  spawnWaterdrop(world.position, world.normal, ping.color);
}

export function publishTablePingFromHit(hit: Intersection) {
  if (!provider?.awareness) return;

  const worldNormal = worldNormalFromIntersection(hit.face!.normal, hit.object.matrixWorld);
  const color = displayPlayerColor(provider.awareness.getLocalState());
  const playArea = findPlayAreaForHit(hit.object);

  let ping: PingPayload;

  if (playArea) {
    const localPoint = playArea.mesh.worldToLocal(hit.point.clone());
    const localNormal = worldToLocalDirection(worldNormal, playArea.mesh.matrixWorld);

    ping = {
      id: nanoid(),
      space: 'playArea',
      playAreaClientId: playArea.clientId,
      position: localPoint.toArray(),
      normal: localNormal.toArray(),
      color,
    };
  } else if (table) {
    const localPoint = table.worldToLocal(hit.point.clone());
    const localNormal = worldToLocalDirection(worldNormal, table.matrixWorld);

    ping = {
      id: nanoid(),
      space: 'table',
      position: localPoint.toArray(),
      normal: localNormal.toArray(),
      color,
    };
  } else {
    return;
  }

  const clientId = provider.awareness.clientID;
  lastPingIdByClient.set(clientId, ping.id);
  spawnPing(ping);
  provider.awareness.setLocalStateField('ping', ping);
}

function applyRemotePing(clientId: number, ping: PingPayload | undefined) {
  if (!ping?.id || !ping.position || !ping.color) return;
  if (lastPingIdByClient.get(clientId) === ping.id) return;

  lastPingIdByClient.set(clientId, ping.id);

  // Legacy pings used world-space coordinates before per-client layout fix.
  if (!ping.space) {
    spawnWaterdrop(ping.position, ping.normal ?? DEFAULT_WATERDROP_NORMAL, ping.color);
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

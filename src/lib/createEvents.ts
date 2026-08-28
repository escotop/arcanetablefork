import { Card, CardZone } from './constants';
import { expect, zonesById } from './globals';
import { Intersection, Object3D } from 'three';
import { AnimationOpts, serializeAnimation } from './animations';
import { resolveStackAnchor } from './footprintOverlap';

interface DefaultAddOptions {
  destroy?: boolean;
}

interface ExtendedOptions<AddOptions extends DefaultAddOptions = {}> {
  addOptions?: AddOptions;
  userData?: unknown;
  preventTransmit?: boolean;
}

// TODO: need to handle skipAnimation, and use it correctly when clientId == self and skipAnimation in remoteEvents
export function createTransferCardEvent<AddOptions extends {}>(
  card: Card,
  fromZone?: CardZone<any>,
  toZone?: CardZone<AddOptions>,
  opts: ExtendedOptions<AddOptions> = {},
) {
  const { addOptions = {}, userData } = opts;

  expect(!!card, `card is undefined`);

  return {
    type: 'transferCard',
    payload: {
      userData: card.mesh.userData,
      fromZoneId: fromZone?.id,
      toZoneId: toZone?.id,
      extendedOptions: {
        addOptions: {
          skipAnimation: false,
          ...addOptions,
        },
        userData,
        preventTransmit: true,
      },
    },
  } as const;
}

export function createTapEvent(object3D: Object3D) {
  return {
    type: 'tap',
    payload: {
      userData: {
        id: object3D.userData.id,
        isTapped: !object3D.userData.isTapped,
      },
    },
  } as const;
}

export function createAnimationEvent(target: Object3D, animation: AnimationOpts) {
  return {
    type: 'animateObject',
    payload: {
      userData: { id: target.userData.id },
      animation: serializeAnimation(animation),
    },
  };
}

export function createRestackEvent(intersection: Intersection, items: Object3D[]) {
  const zone = zonesById.get(intersection.object.userData.zoneId || intersection.object.id)!;
  expect(!!zone, `zone not found`);
  const anchor = zone.mesh.worldToLocal(intersection.point.clone());
  anchor.copy(resolveStackAnchor(anchor, zone.mesh, items));

  return {
    type: 'restack',
    payload: {
      zoneId: intersection.object.userData.zoneId,
      anchor: anchor.toArray(),
      items: items.map(item => ({
        id: item.userData.id,
        dragOffset: item.userData.dragOffset,
        // dragQuat: item.userData.dragQuat,
      })),
    },
  };
}

export function createPassTurnEvent() {
  return {
    type: 'passTurn',
  };
}

/** Search/peek UI events are synced live but not replayed when loading a saved game. */
export const SKIP_REPLAY = true as const;

export function createPeekCardsEvent(
  fromZoneId: string,
  toZoneId: string,
  count: number,
  options?: { skipAnimation?: boolean },
) {
  return {
    type: 'peekCards',
    skipReplay: SKIP_REPLAY,
    payload: { fromZoneId, toZoneId, count, ...options },
  } as const;
}

export function createDismissZoneEvent(zoneId: string) {
  return {
    type: 'dismissZone',
    skipReplay: SKIP_REPLAY,
    payload: { zoneId },
  } as const;
}

export function createTransferEntireZoneEvent(
  fromZoneId: string,
  toZoneId: string,
  addOptions?: { location?: 'top' | 'bottom' },
) {
  return {
    type: 'transferEntireZone',
    skipReplay: SKIP_REPLAY,
    payload: { fromZoneId, toZoneId, addOptions },
  } as const;
}

export function createWaterdropEvent(
  worldPosition: [number, number, number],
  worldNormal: [number, number, number],
  color: string,
) {
  return {
    type: 'waterdrop',
    payload: {
      position: worldPosition,
      normal: worldNormal,
      color,
    },
  } as const;
}

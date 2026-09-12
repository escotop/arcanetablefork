import { ensureCardMesh } from './card';
import { Card, CardZone } from './constants';
import { expect, getLocalPlayerClientId, zonesById } from './globals';
import { serializeCardUserDataForLog } from './gameLogEvents';
import { Intersection, Object3D } from 'three';
import { AnimationOpts, serializeAnimation } from './animations';
import { resolveStackAnchor } from './footprintOverlap';
import { resolveDropTargetObject } from './utils';

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
  if (!card.mesh) {
    const ownerId = card.clientId ?? getLocalPlayerClientId();
    if (ownerId !== undefined) ensureCardMesh(card, ownerId);
  }
  expect(!!card.mesh, `card mesh is undefined`);

  return {
    type: 'transferCard',
    payload: {
      userData: serializeCardUserDataForLog(card.mesh.userData),
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
        isTapped: !!object3D.userData.isTapped,
      },
    },
  } as const;
}

export function createFlipEvent(object3D: Object3D) {
  return {
    type: 'flip',
    payload: {
      userData: {
        id: object3D.userData.id,
        isFlipped: !!object3D.userData.isFlipped,
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
  const destObject = resolveDropTargetObject(intersection.object) ?? intersection.object;
  const zoneId = destObject.userData.zoneId ?? destObject.userData.id;
  const zone = zonesById.get(zoneId)!;
  expect(!!zone, `zone not found`);
  const anchor = destObject.worldToLocal(intersection.point.clone());
  anchor.copy(resolveStackAnchor(anchor, destObject, items));

  return {
    type: 'restack',
    payload: {
      zoneId: zone.id,
      anchor: anchor.toArray(),
      items: items.map(item => ({
        id: item.userData.id,
        dragOffset: item.userData.dragOffset,
        // dragQuat: item.userData.dragQuat,
      })),
    },
  };
}

export function createPassTurnEvent(turnOrder: import('./turnOrder').TurnOrderState) {
  return {
    type: 'passTurn',
    payload: { turnOrder },
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

export function createDeckPeekLogEvent(count: number) {
  return {
    type: 'deckPeek',
    payload: { count },
  } as const;
}

export function createDeckSearchLogEvent() {
  return {
    type: 'deckSearch',
    payload: {},
  } as const;
}

export function createDeckShuffleLogEvent() {
  return {
    type: 'deckShuffle',
    payload: {},
  } as const;
}

export function createDeckDrawLogEvent(
  payload:
    | { source: 'top' }
    | { source: 'peek' }
    | { source: 'choice' },
) {
  return {
    type: 'deckDraw',
    payload,
  } as const;
}

export function createDeckPeekReorderEvent(order: string[]) {
  return {
    type: 'deckPeekReorder',
    payload: { order },
  } as const;
}

export function createDeckPeekMoveEvent(placement: 'top' | 'bottom', cardId: string) {
  return {
    type: 'deckPeekMove',
    payload: { placement, cardId },
  } as const;
}

export function createCoinFlipEvent(result: 'heads' | 'tails') {
  return {
    type: 'coinFlip',
    payload: { result },
  } as const;
}

export function createDieRollEvent(sides: number, result: number) {
  return {
    type: 'roll',
    payload: { roll: [{ sides, result }] },
  } as const;
}

export function createCustomCounterTypeLogEvent(counter: { id: string; name: string }) {
  return {
    type: 'createCounter',
    payload: { counter: { id: counter.id, name: counter.name } },
  } as const;
}

export function createCardCustomCounterLogEvent(payload: {
  cardId: string;
  cardName?: string;
  counterId: string;
  counterName: string;
  previousValue?: number;
  value?: number;
}) {
  return {
    type: 'cardCustomCounter',
    payload: {
      userData: { id: payload.cardId },
      cardName: payload.cardName,
      counterId: payload.counterId,
      counterName: payload.counterName,
      previousValue: payload.previousValue,
      value: payload.value,
    },
  } as const;
}

export function createPlayerCustomCounterLogEvent(payload: {
  counterId: string;
  counterName: string;
  previousValue?: number;
  value: number;
}) {
  return {
    type: 'playerCustomCounter',
    payload: {
      counterId: payload.counterId,
      counterName: payload.counterName,
      previousValue: payload.previousValue,
      value: payload.value,
    },
  } as const;
}

export function createCreateCardEvent(card: Card, zoneId: string) {
  expect(!!card, 'card is undefined');
  if (!card.mesh) {
    const ownerId = card.clientId ?? getLocalPlayerClientId();
    if (ownerId !== undefined) ensureCardMesh(card, ownerId);
  }
  expect(!!card.mesh, 'card mesh is undefined');

  return {
    type: 'createCard',
    payload: {
      userData: serializeCardUserDataForLog(card.mesh.userData),
      zoneId,
    },
  } as const;
}

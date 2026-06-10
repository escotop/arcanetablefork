import { Card, CardZone } from './constants';
import * as Sentry from '@sentry/solidstart';
import { expect } from './globals';
import { Mesh, Object3D } from 'three';

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
  fromZone: CardZone<any>,
  toZone: CardZone<AddOptions>,
  opts: ExtendedOptions<AddOptions> = {},
) {
  const { addOptions = {}, userData } = opts;

  expect(!!card, `card is undefined`);
  expect(!!fromZone, `fromZone is undefined`);
  expect(!!toZone, `toZone is undefined`);

  return {
    type: 'transferCard',
    payload: {
      userData: card.mesh.userData,
      fromZoneId: fromZone.id,
      toZoneId: toZone.id,
      extendedOptions: {
        addOptions: {
          ...addOptions,
          skipAnimation: false,
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

export function createAnimationEvent() {

}

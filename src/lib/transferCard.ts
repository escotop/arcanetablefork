import { setCardData, updateModifiers, ensureCardMesh, loadCardTextures } from './card';
import { Card, CardZone } from './constants';
import { cardsById, sendEvent } from './globals';
import { Deck } from './deck';
import { serializeCardUserDataForLog } from './gameLogEvents';
import { onStackCardAdded } from './cardLoading';
import type { CardStack } from './cardStack';
import * as Sentry from '@sentry/solidstart';
import { devLog } from './devLog';

interface DefaultAddOptions {
  destroy?: boolean;
}

interface ExtendedOptions<AddOptions extends DefaultAddOptions = {}> {
  addOptions?: AddOptions;
  userData?: unknown;
  preventTransmit?: boolean;
}

// toZone and fromZone being undefined are actually valid in cases like tokens
export async function transferCard<AddOptions extends {}>(
  card: Card,
  fromZone?: CardZone<any>,
  toZone?: CardZone<AddOptions>,
  {
    addOptions = {} as AddOptions,
    userData,
    preventTransmit = false,
  }: ExtendedOptions<AddOptions> = {},
) {
  if (!card) {
    devLog.warn(`card is undefined`, new Error().stack);
    Sentry.captureException(new Error(`card is undefined`), {
      extra: {
        userData,
        addOptions,
        preventTransmit,
        toZone,
        fromZone,
      },
    });
    return;
  }

  if (fromZone?.zone === 'deck') {
    (fromZone as Deck).prepareCardForRemoval(card);
  }

  if (!card.mesh) {
    const ownerId = card.clientId ?? (fromZone as Deck | undefined)?.clientId;
    if (ownerId === undefined) return;
    ensureCardMesh(card, ownerId);
  }

  if (!card.mesh) return;

  if (addOptions?.skipAnimation) {
    setCardData(card.mesh, 'skipAnimation', true);
  }

  await fromZone?.removeCard?.(card.mesh);

  if (addOptions?.skipAnimation) {
    setCardData(card.mesh, 'skipAnimation', false);
  }

  if (toZone && toZone?.zone !== 'battlefield') {
    if (!card.mesh) return;
    if (card.mesh.userData.isToken) {
      addOptions.destroy = true;
    }
    card.mesh.userData.modifiers = undefined;
    updateModifiers(card);
  }
  if (userData) {
    Object.entries(userData).forEach(([field, value]) => {
      setCardData(card.mesh, field, value);
    });
  }

  if (!toZone) {
    card.mesh!.geometry.dispose();
    cardsById.delete(card.id);
  } else {
    const textureZones = new Set(['hand', 'battlefield', 'peek', 'tokenSearch', 'reveal']);
    if (textureZones.has(toZone.zone)) {
      if (toZone.zone === 'peek' || toZone.zone === 'reveal') {
        setCardData(card.mesh, 'isPublic', true);
      }
      await loadCardTextures(card);
    }
    await toZone.addCard(card, addOptions);
    if (toZone.zone === 'graveyard' || toZone.zone === 'exile') {
      onStackCardAdded(toZone as CardStack);
    }
  }

  if (!preventTransmit) {
    sendEvent({
      type: 'transferCard',
      payload: {
        userData: serializeCardUserDataForLog(card.mesh.userData),
        fromZoneId: fromZone?.id,
        toZoneId: toZone?.id,
        extendedOptions: {
          addOptions: {
            ...addOptions,
            skipAnimation: false,
          },
          userData,
          preventTransmit: true,
        },
      },
    });
  }
}

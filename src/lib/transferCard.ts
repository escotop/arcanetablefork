import { ensureCardMesh, loadCardTextures, setCardData, updateModifiers } from './card';
import { Card, CardZone } from './constants';
import {
  cardsById,
  dismissHowItPlaysHelp,
  getLocalPlayArea,
  getLocalPlayerClientId,
  isEventCatchUpComplete,
  isHistoricalLogReplayInProgress,
  isLocalHandZone,
  sendEvent,
} from './globals';
import { applyLoyaltyWhenPlayingToBattlefield } from './loyaltyCounter';
import { playDrawSound } from './sounds';
import { Deck } from './deck';
import { Hand } from './hand';
import { serializeCardUserDataForLog } from './gameLogEvents';
import { onStackCardAdded } from './cardLoading';
import type { CardStack } from './cardStack';
import * as Sentry from '@sentry/solidstart';
import { devLog } from './devLog';

interface DefaultAddOptions {
  destroy?: boolean;
  insertIndex?: number;
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

  if (isEventCatchUpComplete() && !preventTransmit) {
    if (fromZone?.zone === 'hand' && !isLocalHandZone(fromZone)) return;
    if (toZone?.zone === 'hand' && !isLocalHandZone(toZone)) return;
  }

  if (fromZone === toZone && toZone?.zone === 'hand') {
    (toZone as Hand).reorderCard(
      card,
      (addOptions as DefaultAddOptions).insertIndex ?? fromZone.cards.indexOf(card),
    );

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
    return;
  }

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

  const placingFaceDown =
    userData &&
    typeof userData === 'object' &&
    (userData as Record<string, unknown>).isFlipped === true;

  if (fromZone?.zone === 'hand' && toZone?.zone === 'battlefield' && card.mesh) {
    setCardData(card.mesh, 'isTapped', false);
    if (!placingFaceDown) {
      setCardData(card.mesh, 'isFlipped', false);
    }
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
    }

    await toZone.addCard(card, addOptions);

    if (textureZones.has(toZone.zone)) {
      const textureLoad = loadCardTextures(card).catch(error => {
        devLog.warn('[transferCard] texture load failed', card.detail?.name ?? card.id, error);
      });
      if (toZone.zone === 'peek' || toZone.zone === 'tokenSearch') {
        void textureLoad;
      } else {
        await textureLoad;
      }
    }

    if (toZone.zone === 'graveyard' || toZone.zone === 'exile') {
      onStackCardAdded(toZone as CardStack);
    }

    if (
      fromZone?.zone === 'hand' &&
      toZone.zone === 'battlefield' &&
      isLocalHandZone(fromZone) &&
      !isHistoricalLogReplayInProgress()
    ) {
      const playArea = getLocalPlayArea();
      if (playArea?.isLocalPlayArea) {
        void applyLoyaltyWhenPlayingToBattlefield(card, playArea);
      }
    }
  }

  if (
    isLocalHandZone(fromZone) &&
    toZone?.zone === 'battlefield' &&
    !isHistoricalLogReplayInProgress()
  ) {
    dismissHowItPlaysHelp();
  }

  if (
    toZone?.zone === 'hand' &&
    isLocalHandZone(toZone) &&
    fromZone?.zone !== 'hand' &&
    !preventTransmit &&
    isEventCatchUpComplete() &&
    !isHistoricalLogReplayInProgress()
  ) {
    playDrawSound(false);
  }

  if (!preventTransmit) {
    if (!card.mesh) {
      const ownerId = card.clientId ?? getLocalPlayerClientId();
      if (ownerId !== undefined) ensureCardMesh(card, ownerId);
    }
    if (!card.mesh) {
      devLog.warn('[transferCard] missing mesh, skipping transmit', card.id);
      return;
    }

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

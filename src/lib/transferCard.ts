import { setCardData, updateModifiers } from './card';
import { Card, CardZone } from './constants';
import { cardsById, sendEvent } from './globals';
import * as Sentry from '@sentry/solidstart';

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
    console.warn(`card is undefined`, new Error().stack);
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

  await fromZone?.removeCard?.(card.mesh);

  if (toZone && toZone?.zone !== 'battlefield') {
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
    card.mesh.geometry.dispose();
    cardsById.delete(card.id);
  } else {
    await toZone.addCard(card, addOptions);
  }

  if (!preventTransmit) {
    sendEvent({
      type: 'transferCard',
      payload: {
        userData: card.mesh.userData,
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

import uniqBy from 'lodash-es/uniqBy';
import { nanoid } from 'nanoid';
import { Vector3 } from 'three';
import { animateObject, queueAnimationGroup, rehydrateAnimation } from './lib/animations';
import { cloneCard, splitUserdata, setCardData } from './lib/card';
import { Card } from './lib/constants';
import * as Sentry from '@sentry/solidstart';
import {
  applyPlayerTransform,
  cardsById,
  drainResolvers,
  expect,
  gameLog,
  logger,
  logs,
  onConcede,
  playAreas,
  processedEvents,
  provider,
  setLogs,
  setPlayAreas,
  setPlayerCount,
  setProcessedEvents,
  table,
  zonesById,
} from './lib/globals';
import { PlayArea } from './lib/playArea';
import { transferCard } from './lib/transferCard';
import { setCounters } from './lib/ui/counterDialog';
import { isLogMessageStackable } from './lib/ui/log';
import * as EventCreators from './lib/createEvents';
import { restackItems } from './lib/utils';
import { readjustPlayAreas } from './main3d';

type Events = ReturnType<(typeof EventCreators)[keyof typeof EventCreators]>;
type Event = { clientID: string } & Events;

let processing = false;
let events = [];
let timing = 100;

export async function processEvents() {
  if (processing) return;
  processing = true;
  try {
    while (processedEvents() < gameLog.length) {
      const srcEvent = gameLog.get(processedEvents());
      setProcessedEvents(e => e + 1);
      if (srcEvent.type === 'bulk') {
        timing = srcEvent.timing;
        events = srcEvent.events.map(e => {
          e.clientID = srcEvent.clientID;
          e.locallyApplied = srcEvent.locallyApplied;
          return e;
        });
      } else {
        timing = 25;
        events = [srcEvent];
      }

      while (events.length > 0) {
        let event = events.shift();
        try {
          addLogMessage(event);
        } catch (e) {
          Sentry.captureException(e, 'addLogMessage');
          console.error(e);
        }
        if (event.clientID === provider.awareness.clientID && event.locallyApplied) break;
        let playArea = playAreas[event.clientID];
        await handleEvent(event, playArea);
        if (events.length > 0) {
          await new Promise(resolve => setTimeout(resolve, timing));
        }
      }
    }
  } finally {
    processing = false;
    drainResolvers.splice(0).forEach(r => r());
  }
}

function applyEventUserData(card: Card, userData: Record<string, unknown>) {
  const { id, ...fields } = userData;
  Object.entries(fields).forEach(([key, value]) => setCardData(card.mesh, key, value));
}

export async function handleEvent(event: Event, playArea: PlayArea) {
  expect(!!EVENTS[event.type], `${event.type} not implemented`);
  let card = cardsById.get(event.payload?.userData?.id);
  if (card && event.payload.userData) {
    applyEventUserData(card, event.payload.userData);
  }
  logger.log('handleEvents', ...arguments);
  await EVENTS[event.type](event, playArea, card);
}

const EVENTS = {
  join(event: Event) {
    let playArea = PlayArea.FromNetworkState({ ...event.payload, clientID: event.clientID });

    table.add(playArea.mesh);
    setPlayAreas(event.clientID, playArea);
    setPlayerCount(count => count + 1);

    readjustPlayAreas();
  },
  concede(event: Event, playArea: PlayArea) {
    onConcede(event.clientID);
  },
  toggleTokenMenu(event: Event, playArea: PlayArea) {
    return playArea.toggleTokenMenu(event.payload);
  },
  queueAnimationGroup(event: Event) {
    queueAnimationGroup();
  },
  modifyCard(event: Event, playArea: PlayArea, card: Card) {
    setCardData(card.mesh, 'modifiers', event.payload.userData.modifiers);
    playArea.modifyCard(card);
  },
  createCounter(event: Event) {
    setCounters(counters => uniqBy([...counters, event.counter], 'id'));
  },
  animateObject(event: Event, _playArea: PlayArea, card: Card) {
    const [_, cloneable] = splitUserdata(event.payload.userData);
    if (!card) {
      console.trace('card undefined', { event, _playArea, card });
    }
    Object.assign(card.mesh.userData, cloneable);
    animateObject(card.mesh, rehydrateAnimation(event.payload.animation));
  },
  async transferCard(event: Event, playArea: PlayArea, card: Card) {
    let fromZone = zonesById.get(event.payload.fromZoneId)!;
    let toZone = zonesById.get(event.payload.toZoneId)!;

    if (
      event.clientID === provider.awareness.clientID &&
      event.payload.extendedOptions?.addOptions?.skipLocalAnimation
    ) {
      event.payload.extendedOptions.addOptions.skipAnimation = true;
    }

    await transferCard(card, fromZone, toZone, event.payload.extendedOptions);
  },
  async restack(event: ReturnType<typeof EventCreators.createRestackEvent>) {
    const items = event.payload.items.map(item => cardsById.get(item.id)?.mesh).filter(Boolean);

    await restackItems(new Vector3().fromArray(event.payload.anchor), items);
  },
  createCard(event: Event, playArea: PlayArea) {
    let card = cloneCard({ detail: event.payload.userData.card.detail }, event.payload.userData.id);

    let zone = zonesById.get(event.payload.zoneId);
    let options = {};

    let p = event.payload?.addOptions?.position;
    if (p) {
      options.position = new Vector3(p.x, p.y, p.z);
    }

    zone?.addCard(card, options);
  },
  tap(event: Event, playArea: PlayArea, card: Card) {
    playArea?.tap(card.mesh);
  },
  flip(event: Event, playArea: PlayArea, card: Card) {
    playArea?.flip(card.mesh);
  },
  clone(event: Event, playArea: PlayArea) {
    playArea?.clone(event.payload.id, event.payload.newId);
  },
  reveal(event: Event, remotePlayArea: PlayArea, card: Card) {
    expect(!!card, 'card not found');
    let cardProxy = cloneCard(card, nanoid());
    // remotePlayArea.peek();
    setCardData(cardProxy.mesh, 'isPublic', true);
    const playArea = playAreas[provider.awareness.clientID];
    playArea.reveal(cardProxy);
  },
  deckFlipTop(event: Event, playArea: PlayArea) {
    playArea?.deckFlipTop(event.payload.toggle);
  },
  shuffleDeck(event: Event, playArea: PlayArea) {
    return playArea?.shuffleDeck(event.payload.order);
  },
  mulligan(event: Event, playArea: PlayArea) {
    return playArea.mulligan(event.payload.drawCount, event.payload.order);
  },
};

function addLogMessage(event) {
  if (event.type === 'animateObject') return;
  let index = logs.length;

  const { type, clientID, payload } = event;
  let count = 1;
  let lastEvent = logs[index - 1];
  if (isLogMessageStackable(lastEvent, event)) {
    count = lastEvent.count + 1;
    index--;
  }

  let logPayload = payload;
  if (type !== 'join') {
    if (payload?.userData) {
      logPayload = {
        ...logPayload,
        userData: { ...logPayload.userData, cardBack: undefined },
      };
    }
  }

  setLogs(index, {
    type,
    clientID,
    payload: logPayload,
    count,
  });
}

import { Component, ErrorBoundary, For, JSX, Show } from 'solid-js';
import { cardsById, logs, setCardSearchModalData, setCardSearchModalOpen, zonesById } from '../globals';
import { resolveLogPlayerColor, resolveLogPlayerName } from '../playAreaNameTag';
import { devLog } from '../devLog';
import style from './overlay.module.css';
import { captureException, withSentryErrorBoundary } from '@sentry/solidstart';
import type { Card } from '../constants';

const SentryErrorBoundry = withSentryErrorBoundary(ErrorBoundary);

const Log: Component = props => {
  return (
    <div class={style.log}>
      <div class={style.anchor} />
      <SentryErrorBoundry
        fallback={error => {
          devLog.error(error, logs);
          captureException(error, logs);
          return <p>Sorry, something went wrong</p>;
        }}>
        <For each={logs}>
          {log => {
            let text = parseLogEntry(log);
            return (
              <Show when={text}>
                <p>
                  <span
                    class='font-semibold'
                    style={{ color: resolveLogPlayerColor(log.clientID) }}>
                    {resolveLogPlayerName(log.clientID) ?? 'unknown'}
                  </span>{' '}
                  {text}
                </p>
              </Show>
            );
          }}
        </For>
      </SentryErrorBoundry>
    </div>
  );
};

export function isLogMessageStackable(previous, next) {
  if (!previous) return false;
  if (previous.clientID !== next.clientID) return false;

  let prevUserData = previous.payload?.userData;
  let nextUserData = next.payload?.userData;
  if (!prevUserData || !nextUserData) return false;
  if (next.type === 'reveal') return false;

  if (previous.type === 'transferCard' && next.type === 'transferCard') {
    if (prevUserData.id !== nextUserData.id) return false;

    const fromZone = zonesById.get(previous.payload?.fromZoneId);
    const toZone = zonesById.get(previous.payload?.toZoneId);
    if (fromZone?.zone === 'hand' && toZone?.zone === 'battlefield') return false;
  }

  let isCardNameVisible = userData => userData.isPublic || userData.wasPublic;

  if (
    previous.type === next.type &&
    !isCardNameVisible(prevUserData) &&
    !isCardNameVisible(nextUserData) &&
    prevUserData.location === nextUserData.location &&
    prevUserData.previousLocation === nextUserData.previousLocation
  )
    return true;
}

function getCardNameFromLogPayload(
  userData: { card?: { detail?: { name?: string } } } | undefined,
  card?: { detail?: { name?: string } },
) {
  return card?.detail?.name ?? userData?.card?.detail?.name;
}

export function resolveLogCard(
  userData: Record<string, unknown> | undefined,
  clientId?: number,
): Card | undefined {
  if (!userData?.id) return undefined;

  const id = String(userData.id);
  const live = cardsById.get(id);
  if (live) return live;

  const embedded = userData.card as Partial<Card> | undefined;
  const detail = embedded?.detail;
  if (!detail?.name) return undefined;

  return {
    id,
    clientId: embedded?.clientId ?? Number(clientId) ?? 0,
    detail,
    customArtUrl: embedded?.customArtUrl,
    modifiers: {} as Card['modifiers'],
  };
}

export function openLogCardPreview(card: Card, title?: string) {
  setCardSearchModalData({
    cards: [card],
    zone: 'peek',
    title: title ?? card.detail?.name ?? 'Card',
    readOnly: true,
  });
  setCardSearchModalOpen(true);
}

function LogCardLink(props: { card: Card; children?: JSX.Element }) {
  return (
    <button
      type='button'
      class='font-semibold underline decoration-dotted underline-offset-2 cursor-pointer hover:text-sky-300'
      onClick={event => {
        event.stopPropagation();
        openLogCardPreview(props.card);
      }}>
      {props.children ?? props.card.detail?.name ?? 'a card'}
    </button>
  );
}

function renderLogCardName(
  card: Card | undefined,
  fallback: string,
  userData?: Record<string, unknown>,
  clientId?: number,
) {
  const resolved = card ?? (userData ? resolveLogCard(userData, clientId) : undefined);
  if (!resolved) return <strong>{fallback}</strong>;
  return <LogCardLink card={resolved}>{fallback}</LogCardLink>;
}

function isTransferFaceDown(
  userData: { isFlipped?: boolean } | undefined,
  entry: { payload?: { extendedOptions?: { userData?: { isFlipped?: boolean } } } },
) {
  if (userData?.isFlipped) return true;
  return entry.payload?.extendedOptions?.userData?.isFlipped === true;
}

function getTransferCardReference(
  entry: { count?: number; clientID?: number; payload?: { extendedOptions?: { userData?: { isFlipped?: boolean } } } },
  userData: { isPublic?: boolean; wasPublic?: boolean; isFlipped?: boolean; card?: { detail?: { name?: string } }; id?: string } | undefined,
  card: Card | undefined,
  fromZone?: { zone?: string },
  toZone?: { zone?: string },
) {
  const name = getCardNameFromLogPayload(userData, card);

  if (isTransferFaceDown(userData, entry)) {
    if (fromZone?.zone === 'hand' && toZone?.zone === 'battlefield') {
      return <strong>Card</strong>;
    }
    return 'a card';
  }

  if (name) {
    return renderLogCardName(card, name, userData, entry.clientID);
  }
  if (userData?.isPublic || userData?.wasPublic) {
    return renderLogCardName(card, 'a card', userData, entry.clientID);
  }
  if (fromZone?.zone === 'hand' && toZone?.zone === 'battlefield') {
    return renderLogCardName(card, 'a card', userData, entry.clientID);
  }
  if (entry?.count > 1) return `${entry.count} cards`;
  return 'a card';
}

export function parseLogEntry(entry) {
  let card = cardsById.get(entry.payload?.userData?.id);
  let { userData, ...data } = entry?.payload || {};
  let cardReference = () => {
    if (userData?.isPublic || userData?.wasPublic) return getCardNameFromLogPayload(userData, card);
    if (entry?.count > 1) return `${entry.count} cards`;
    return 'a card';
  };

  switch (entry?.type) {
    case 'join':
      return 'Joined';
    case 'transferCard': {
      let fromZone = zonesById.get(data.fromZoneId);
      let toZone = zonesById.get(data.toZoneId);
      let destination = toZone.zone;
      if (
        toZone?.mesh.userData.zone === 'deck' &&
        entry.extendedOptions?.addOptions?.location === 'bottom'
      )
        destination = `Bottom of ${destination}`;

      return (
        <>
          moved {getTransferCardReference(entry, userData, card, fromZone, toZone)} from{' '}
          <strong>{fromZone?.mesh.userData.zone}</strong> to <strong>{destination}</strong>
        </>
      );
    }
    case 'concede':
      return 'conceded';
    case 'kick':
      return 'was removed from the game';
    case 'passTurn':
      return null;
    case 'animateObject':
      return null;
    case 'tap':
      return (
        <>
          {userData.isTapped ? 'tapped' : 'untapped'}{' '}
          {renderLogCardName(card, card?.detail?.name ?? 'a card', userData, entry.clientID)}
        </>
      );
    case 'shuffleDeck':
    case 'deckShuffle':
      return 'shuffled the deck';
    case 'deckPeek':
      return (
        <>
          peeked at <strong>{entry.payload?.count ?? 1}</strong> top cards of the deck
        </>
      );
    case 'deckPeekReorder':
      return 'reordered deck while peeking';
    case 'deckPeekMove':
      return entry.payload?.placement === 'bottom'
        ? 'moved a card to the bottom of the deck while peeking'
        : 'moved a card to the top of the deck while peeking';
    case 'deckSearch':
      return 'looked at his deck';
    case 'deckDraw':
      if (entry.payload?.source === 'choice') {
        const choiceCard: Card = {
          id: `log-draw-${entry.payload.cardName ?? 'card'}`,
          clientId: Number(entry.clientID) || 0,
          detail: { name: entry.payload.cardName },
          modifiers: {} as Card['modifiers'],
        };
        return (
          <>
            drawed card at choice (
            <LogCardLink card={choiceCard}>
              {entry.payload.cardName} {entry.payload.deckPosition}
            </LogCardLink>
            )
          </>
        );
      }
      return 'drawed top card';
    case 'mulligan':
      return `mulliganed and drew ${entry.payload?.drawCount} cards`;
    case 'createCounter':
      return null;
    case 'reveal':
      return (
        <>
          revealed {renderLogCardName(card, card?.detail?.name ?? 'a card', userData, entry.clientID)}
        </>
      );
    case 'coinFlip':
      return (
        <>
          flipped a coin: <strong>{entry.payload?.result === 'heads' ? 'Heads' : 'Tails'}</strong>
        </>
      );
    case 'roll':
      return (
        <>
          rolled{' '}
          <For each={entry.payload.roll}>
            {die => (
              <>
                [d{die.sides}] <strong>{die.result}</strong>{' '}
              </>
            )}
          </For>
          Total: <strong>{entry.payload.roll.reduce((a, b) => a + b.result, 0)}</strong>
        </>
      );

    default:
      return `${entry?.type} ${cardReference()}`;
  }
}

export default Log;

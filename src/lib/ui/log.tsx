import { Component, ErrorBoundary, For, Show } from 'solid-js';
import { cardsById, logs, zonesById } from '../globals';
import { resolveLogPlayerColor, resolveLogPlayerName } from '../playAreaNameTag';
import { devLog } from '../devLog';
import style from './overlay.module.css';
import { captureException, withSentryErrorBoundary } from '@sentry/solidstart';

const SentryErrorBoundry = withSentryErrorBoundary(ErrorBoundary);

const Log: Component = props => {
  return (
    <div class={`${style.log} bg-slate-800 text-white p-4 bg-opacity-75`}>
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

function getTransferCardReference(
  entry: { count?: number },
  userData: { isPublic?: boolean; wasPublic?: boolean; card?: { detail?: { name?: string } } } | undefined,
  card: { detail?: { name?: string } } | undefined,
  fromZone?: { zone?: string },
  toZone?: { zone?: string },
) {
  const name = getCardNameFromLogPayload(userData, card);
  if (userData?.isPublic || userData?.wasPublic) {
    return name ?? 'a card';
  }
  if (fromZone?.zone === 'hand' && toZone?.zone === 'battlefield') {
    return name ?? 'a card';
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
          moved <strong>{getTransferCardReference(entry, userData, card, fromZone, toZone)}</strong>{' '}
          from <strong>{fromZone?.mesh.userData.zone}</strong> to <strong>{destination}</strong>
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
      return `${userData.isTapped ? 'tapped' : 'untapped'} ${card?.detail.name}`;
    case 'shuffleDeck':
    case 'deckShuffle':
      return 'shuffled the deck';
    case 'deckPeek':
      return (
        <>
          peeked at <strong>{entry.payload?.count ?? 1}</strong> top cards of the deck
        </>
      );
    case 'deckSearch':
      return 'looked at his deck';
    case 'deckDraw':
      if (entry.payload?.source === 'choice') {
        return (
          <>
            drawed card at choice (
            <strong>
              {entry.payload.cardName} {entry.payload.deckPosition}
            </strong>
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
          revealed <strong>{card?.detail.name}</strong>
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

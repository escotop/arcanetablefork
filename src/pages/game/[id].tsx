import { useSearchParams } from '@solidjs/router';
import { Component, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { toast } from 'solid-sonner';
import { useCardSystemContext } from '~/lib/cardSystemContext';
import { getDeckStore } from '~/lib/deckStore';
import {
  cleanup,
  isInitialized,
  isSpectating,
  selectedDeckId,
  setIsIntitialized,
  setSelectedDeckId,
} from '~/lib/globals';
import { HotKeys } from '~/lib/shortcuts/hotkeys';
import StackTraceDialog from '~/lib/stack-trace-dialog';
import DeckPicker from '~/lib/ui/deckPicker';
import GameLoadingOverlay from '~/lib/ui/gameLoadingOverlay';
import MultiplayerSyncOverlay from '~/lib/ui/multiplayerSyncOverlay';
import Overlay from '~/lib/ui/overlay';
import { beginLoadProfile, endLoadProfile, markLoadProfile, profileAsync } from '~/lib/loadProfile';
import { loadDeckAndJoin, localInit, tryReconnectToGame } from '~/main3d';

const GamePage: Component = props => {
  const [reconnecting, setReconnecting] = createSignal(true);
  const [, setSearchParams] = useSearchParams();
  const [cardSystemStore, { initCardSystem, setCardSystem }] = useCardSystemContext();

  const isGameLoading = () =>
    reconnecting() || (!!selectedDeckId() && !isInitialized() && !isSpectating());

  onMount(async () => {
    beginLoadProfile('open game', { gameId: props.params.gameId });
    setSearchParams({ system: undefined }, { replace: true });

    let reconnected = false;
    try {
      await profileAsync('localInit', () => localInit({ gameId: props.params.gameId }));
      reconnected = await profileAsync('tryReconnectToGame', () =>
        tryReconnectToGame(props.params.gameId, initCardSystem),
      );
      if (reconnected) {
        setSelectedDeckId('reconnected');
        markLoadProfile('reconnected to existing seat');
      } else {
        markLoadProfile('awaiting deck selection');
      }
    } finally {
      setReconnecting(false);
      endLoadProfile({ reconnected });
    }
  });

  onCleanup(() => {
    cleanup();
  });

  return (
    <>
      <Show when={isGameLoading()}>
        <GameLoadingOverlay />
      </Show>
      <Show when={isInitialized()}>
        <Overlay />
        <MultiplayerSyncOverlay />
        <HotKeys />
      </Show>
      <Show when={cardSystemStore && !reconnecting()}>
        <Show when={!selectedDeckId() && !isSpectating()}>
          <DeckPicker
            onStart={async settings => {
              beginLoadProfile('join with deck', {
                gameId: props.params.gameId,
                deckId: settings.deckId,
              });
              setSelectedDeckId(settings.deckId);
              try {
                const deckStore = getDeckStore();
                const deck = await profileAsync('clone deck from store', async () =>
                  structuredClone(unwrap(deckStore.decks[settings.deckId])),
                );
                if (!deck) {
                  throw new Error('Mazo no encontrado');
                }
                const cardSystem = await profileAsync('setCardSystem', () =>
                  setCardSystem(deck.system || cardSystemStore.system),
                );

                settings.deck = deck;
                settings.cardSystem = cardSystem;
                await loadDeckAndJoin(settings, initCardSystem);
              } catch (error) {
                setSelectedDeckId(undefined);
                setIsIntitialized(false);
                toast.error(
                  error instanceof Error ? error.message : 'No se pudo iniciar la partida',
                );
                throw error;
              } finally {
                endLoadProfile({ deckId: settings.deckId });
              }
            }}
          />
        </Show>
      </Show>
      <StackTraceDialog />
    </>
  );
};

export default GamePage;

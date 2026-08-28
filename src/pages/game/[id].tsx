import {  useSearchParams } from '@solidjs/router';
import { Component,  createSignal, onCleanup, onMount, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import CopyLinkButton from '~/components/ui/copy-link-button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { useCardSystemContext } from '~/lib/cardSystemContext';
import { getDeckStore } from '~/lib/deckStore';
import {
  cleanup,
  isInitialized,
  isSpectating,
  players,
  selectedDeckId,
  setSelectedDeckId,
} from '~/lib/globals';
import { HotKeys } from '~/lib/shortcuts/hotkeys';
import StackTraceDialog from '~/lib/stack-trace-dialog';
import DeckPicker from '~/lib/ui/deckPicker';
import GameLoadingOverlay from '~/lib/ui/gameLoadingOverlay';
import Overlay from '~/lib/ui/overlay';
import { loadDeckAndJoin, localInit, tryReconnectToGame } from '~/main3d';
import {
  beginLoadProfile,
  endLoadProfile,
  profileAsync,
} from '~/lib/loadProfile';

const GamePage: Component = props => {
  const [inviteDismissed, setInviteDismissed] = createSignal(false);
  const [reconnecting, setReconnecting] = createSignal(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [cardSystemStore, { initCardSystem, setCardSystem }] = useCardSystemContext();

  const isGameLoading = () =>
    reconnecting() || (!!selectedDeckId() && !isInitialized() && !isSpectating());

  onMount(async () => {
    beginLoadProfile('game page load', { gameId: props.params.gameId });
    let reconnected = false;
    try {
      await profileAsync('localInit', () => localInit({ gameId: props.params.gameId }));
      reconnected = await profileAsync('tryReconnectToGame', () =>
        tryReconnectToGame(props.params.gameId, initCardSystem),
      );
      if (reconnected) {
        setSelectedDeckId('reconnected');
      }
    } finally {
      setReconnecting(false);
      endLoadProfile({ reconnected, gameId: props.params.gameId });
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
        <HotKeys />
      </Show>
      <Show when={cardSystemStore && !reconnecting()}>
        <Show when={!selectedDeckId() && !isSpectating()}>
          <DeckPicker
            onStart={async settings => {
              beginLoadProfile('new game join', { gameId: props.params.gameId, deckId: settings.deckId });
              setSelectedDeckId(settings.deckId);
              const deckStore = getDeckStore();
              let deck = structuredClone(unwrap(deckStore.decks[settings.deckId]));
              const cardSystem = await profileAsync('setCardSystem', () =>
                setCardSystem(deck.system || cardSystemStore.system),
              );
              setSearchParams({ system: cardSystem.uri }, { replace: true });

              settings.deck = deck;
              settings.cardSystem = cardSystem;
              await profileAsync('loadDeckAndJoin', () => loadDeckAndJoin(settings, initCardSystem));
              endLoadProfile({ deckId: settings.deckId });
            }}
          />
        </Show>
      </Show>
      <Show when={selectedDeckId() && players().length < 2 && !inviteDismissed()}>
        <Dialog open onOpenChange={open => setInviteDismissed(!open)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite a Friend</DialogTitle>
            </DialogHeader>
            <CopyLinkButton />
          </DialogContent>
        </Dialog>
      </Show>
      <StackTraceDialog />
    </>
  );
};

export default GamePage;

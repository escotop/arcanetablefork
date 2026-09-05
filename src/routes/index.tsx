import { useNavigate } from '@solidjs/router';
import { nanoid } from 'nanoid';
import { Component, createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { produce, unwrap } from 'solid-js/store';
import { Button } from '~/components/ui/button';
import { getDeckPreviewImageUrl } from '~/lib/deck';
import { useCardSystemContext } from '~/lib/cardSystemContext';
import { Deck } from '~/lib/constants';
import { createDeckStore } from '~/lib/deckStore';
import { getDeckCoverMetadata } from '~/lib/deck';
import { DeckEditor } from '~/lib/ui/deckEditor';
import BracketEstimateTag from '~/lib/ui/bracketEstimateTag';
import { ManageDecksDropdown } from '~/lib/ui/manageDecksButton';
import PencilIcon from 'lucide-solid/icons/pencil';

function deckCardCount(deck: Deck) {
  return Object.values(deck.cards).reduce((sum, card) => sum + (card.qty ?? 1), 0);
}

function listDeckIds(store: { decks: Record<string, Deck>; systems: Record<string, string[]> }) {
  const ids = new Set<string>();
  for (const deckIds of Object.values(store.systems)) {
    for (const id of deckIds ?? []) {
      if (store.decks[id]) ids.add(id);
    }
  }
  for (const id of Object.keys(store.decks)) {
    ids.add(id);
  }
  return [...ids]
    .map(id => store.decks[id])
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const LandingPage: Component = () => {
  const navigate = useNavigate();
  const [gameUrl, setGameUrl] = createSignal(`/game/${nanoid()}`);
  const [, { initCardSystem }] = useCardSystemContext();
  const [deckStore, setDeckStore] = createDeckStore();
  const [editingDeck, setEditingDeck] = createSignal<Deck>();

  const decks = createMemo(() => listDeckIds(deckStore));

  onMount(() => {
    setGameUrl(`/game/${nanoid()}`);
    void initCardSystem();

    for (const deck of decks()) {
      const hasDetail = [...Object.values(deck.cards), ...Object.values(deck.inPlay ?? {})].some(
        card => card.detail?.image_uris || card.detail?.card_faces?.length,
      );
      if (!hasDetail) continue;

      const metadata = getDeckCoverMetadata(deck);
      if (
        metadata.coverImage !== deck.coverImage ||
        metadata.coverImageFullArt !== deck.coverImageFullArt
      ) {
        setDeckStore('decks', deck.id, current => ({ ...current, ...metadata }));
      }
    }
  });

  function saveDeck(updatedDeck: Deck) {
    const fromSystem = unwrap(editingDeck()?.system) || 'unsorted';
    const toSystem = updatedDeck.system || 'unsorted';

    setDeckStore('systems', fromSystem, (entries = []) => entries.filter(id => id !== updatedDeck.id));
    setDeckStore('systems', 'unsorted', (entries = []) => entries.filter(id => id !== updatedDeck.id));
    setDeckStore('systems', toSystem, (entries = []) => [
      updatedDeck.id,
      ...entries.filter(id => id !== updatedDeck.id),
    ]);
    setDeckStore('decks', {
      [updatedDeck.id]: { ...updatedDeck, ...getDeckCoverMetadata(updatedDeck) },
    });
  }

  function deleteDeck(deckId: string) {
    setDeckStore(
      produce(state => {
        delete state.decks[deckId];
        for (const system of Object.keys(state.systems)) {
          state.systems[system] = (state.systems[system] ?? []).filter(id => id !== deckId);
        }
      }),
    );
  }

  return (
    <div class='min-h-screen bg-background text-foreground'>
      <main class='mx-auto max-w-5xl px-6 py-8'>
        <header class='mb-8'>
          <h1 class='text-xl font-semibold tracking-tight'>Untapped Table</h1>
          <p class='mt-1 text-sm text-muted-foreground'>
            Virtual table to play Magic: The Gathering with your friends.
          </p>
        </header>

        <div class='mb-8'>
          <Button type='button' onClick={() => navigate(gameUrl())}>
            New game
          </Button>
        </div>

        <div class='flex flex-col gap-6'>
          <section class='rounded-lg border border-border bg-card'>
            <div class='flex items-center justify-between gap-3 border-b border-border px-6 py-4'>
              <h2 class='text-base font-medium'>Decks</h2>
              <ManageDecksDropdown onNewDeck={() => setEditingDeck({} as Deck)} />
            </div>

            <div class='min-h-80 max-h-160 overflow-y-auto px-6 py-6'>
              <Show
                when={decks().length > 0}
                fallback={
                  <p class='text-sm text-muted-foreground'>
                    No decks yet. Create one by importing a card list.
                  </p>
                }>
                <ul>
                  <For each={decks()}>
                    {deck => (
                      <li class='flex items-center justify-between gap-5 border-b border-border py-5 last:border-b-0'>
                        <div class='flex min-w-0 items-center gap-4'>
                          <img
                            src={getDeckPreviewImageUrl(deck)}
                            alt=''
                            class='size-14 shrink-0 rounded-md border border-border object-cover'
                            loading='lazy'
                          />
                          <div class='min-w-0'>
                            <div class='flex min-w-0 items-center gap-2.5'>
                              <p class='truncate text-base font-medium'>{deck.name || 'Untitled'}</p>
                              <div class='flex shrink-0 flex-wrap items-center gap-1.5'>
                                <BracketEstimateTag bracket={deck.bracketEstimate} />
                                <Show when={deck.tags?.length}>
                                  <For each={deck.tags}>
                                    {tag => (
                                      <span class='rounded bg-white px-2 py-0.5 text-xs leading-none text-black'>
                                        {tag.name}
                                      </span>
                                    )}
                                  </For>
                                </Show>
                              </div>
                            </div>
                            <p class='mt-1 text-sm text-muted-foreground'>{deckCardCount(deck)} cards</p>
                          </div>
                        </div>
                        <Button
                          variant='outline'
                          type='button'
                          class='shrink-0 gap-1.5'
                          onClick={() => setEditingDeck(deck)}>
                          <PencilIcon class='size-4' />
                          Edit
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </section>

          <section class='rounded-lg border border-border bg-card'>
            <div class='border-b border-border px-6 py-4'>
              <h2 class='text-base font-medium'>Getting started</h2>
            </div>
            <div class='px-6 py-6'>
              <ol class='list-decimal space-y-3 pl-5 text-base text-muted-foreground'>
                <li>Import a deck from a card list.</li>
                <li>Start a new game.</li>
                <li>Share the room link with up to 3 other players.</li>
              </ol>
              <p class='mt-6 text-base text-muted-foreground'>
                Decks are saved in local storage. Export a backup to avoid losing them.
              </p>
            </div>
          </section>
        </div>
      </main>

      <Show when={editingDeck()} keyed>
        {deck => (
          <Portal>
            <DeckEditor
              onClose={() => setEditingDeck()}
              deck={structuredClone(unwrap(deck))}
              onChange={updatedDeck => {
                saveDeck(updatedDeck);
              }}
              onDelete={() => {
                const deckId = deck.id;
                if (deckId) deleteDeck(deckId);
              }}
            />
          </Portal>
        )}
      </Show>
    </div>
  );
};

export default LandingPage;

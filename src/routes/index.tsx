import { useNavigate } from '@solidjs/router';
import { nanoid } from 'nanoid';
import { Component, createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { produce, unwrap } from 'solid-js/store';
import { Button } from '~/components/ui/button';
import { resetDocumentScroll } from '~/lib/documentScrollLock';
import { DeckPreviewImage } from '~/lib/ui/deckPreviewImage';
import { useCardSystemContext } from '~/lib/cardSystemContext';
import { Deck } from '~/lib/constants';
import { createDeckStore } from '~/lib/deckStore';
import { markDeckDeleted } from '~/lib/deckSync';
import {
  COLOR_IDENTITY_VERSION,
  IDENTITY_ORDER,
  resolveDeckColorIdentity,
  type IdentityColor,
} from '~/lib/deckColorIdentity';
import { MANA_ICON_BY_BUCKET } from '~/lib/manaCost';
import { getDeckCoverMetadata } from '~/lib/deck';
import { isBrokenDeckCoverUrl } from '~/lib/deckCoverPreview';
import { DeckEditor } from '~/lib/ui/deckEditor';
import { getBracketTagLabel } from '~/lib/commanderBracket';
import { compareDecksForList } from '~/lib/deckOrder';
import BracketEstimateTag from '~/lib/ui/bracketEstimateTag';
import { DeckBracketFilterBar, matchesDeckPanelFilters, type BracketFilter } from '~/lib/ui/deckBracketFilter';
import { ManageDecksDropdown } from '~/lib/ui/manageDecksButton';
import PencilIcon from 'lucide-solid/icons/pencil';
import { ProfileMenu } from '~/lib/ui/profileMenu';
import { useAuth } from '~/lib/auth';

const IDENTITY_NAMES: Record<IdentityColor, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

/**
 * Mana symbols of the deck's color identity; works it out once for decks without it
 * (or with one computed by an older version of the rules).
 */
const DeckColorIdentity: Component<{ deck: Deck; onResolved(colors: string[]): void }> = props => {
  const isCurrent = () =>
    !!props.deck.colorIdentity && props.deck.colorIdentityVersion === COLOR_IDENTITY_VERSION;

  onMount(() => {
    if (isCurrent()) return;
    const deckId = props.deck.id;
    void resolveDeckColorIdentity(props.deck).then(colors => {
      if (colors && props.deck.id === deckId && !isCurrent()) {
        props.onResolved(colors);
      }
    });
  });

  const colors = () =>
    IDENTITY_ORDER.filter(color => props.deck.colorIdentity?.includes(color));

  return (
    <Show when={colors().length > 0}>
      <div class='mt-1 flex h-4 shrink-0 items-center gap-1'>
        <For each={colors()}>
          {color => (
            <img
              src={MANA_ICON_BY_BUCKET[color]}
              alt={IDENTITY_NAMES[color]}
              title={IDENTITY_NAMES[color]}
              class='size-4 drop-shadow'
              draggable={false}
            />
          )}
        </For>
      </div>
    </Show>
  );
};

function listDeckIds(store: { decks: Record<string, Deck>; systems: Record<string, string[]> }) {
  const ids = new Set<string>();
  for (const deckIds of Object.values(store.systems)) {
    for (const id of deckIds ?? []) {
      if (id && store.decks[id]) ids.add(id);
    }
  }
  for (const id of Object.keys(store.decks)) {
    if (id) ids.add(id);
  }
  return [...ids]
    .map(id => store.decks[id])
    .filter(Boolean)
    .sort(compareDecksForList);
}

const LandingPage: Component = () => {
  const navigate = useNavigate();
  const auth = useAuth();
  const [gameUrl, setGameUrl] = createSignal(`/game/${nanoid()}`);
  const [, { initCardSystem }] = useCardSystemContext();
  const [deckStore, setDeckStore] = createDeckStore();
  const [editingDeck, setEditingDeck] = createSignal<Deck>();
  const [bracketFilter, setBracketFilter] = createSignal<BracketFilter>('all');
  const [manaColorFilter, setManaColorFilter] = createSignal<IdentityColor[]>([]);
  const [deckSearchQuery, setDeckSearchQuery] = createSignal('');

  const decks = createMemo(() => listDeckIds(deckStore));
  const filteredDecks = createMemo(() =>
    decks().filter(deck =>
      matchesDeckPanelFilters(deck, bracketFilter(), deckSearchQuery(), manaColorFilter()),
    ),
  );

  createEffect(() => {
    if (!editingDeck()) {
      resetDocumentScroll();
    }
  });

  onMount(() => {
    resetDocumentScroll();
    setGameUrl(`/game/${nanoid()}`);
    void initCardSystem();

    for (const deck of decks()) {
      const needsCover =
        !deck.coverImage || isBrokenDeckCoverUrl(deck.coverImage);
      if (!needsCover) continue;

      const metadata = getDeckCoverMetadata(deck);
      if (!metadata.coverImage) continue;

      setDeckStore('decks', deck.id, current => ({ ...current, ...metadata }));
    }
  });

  function saveDeck(updatedDeck: Deck) {
    if (!updatedDeck.id) return;

    const fromSystem = unwrap(editingDeck()?.system) || 'unsorted';
    const toSystem = updatedDeck.system || 'unsorted';

    setDeckStore('systems', fromSystem, (entries = []) =>
      entries.filter(id => id && id !== updatedDeck.id),
    );
    setDeckStore('systems', 'unsorted', (entries = []) =>
      entries.filter(id => id && id !== updatedDeck.id),
    );
    setDeckStore('systems', toSystem, (entries = []) => [
      updatedDeck.id,
      ...entries.filter(id => id && id !== updatedDeck.id),
    ]);
    setDeckStore('decks', {
      [updatedDeck.id]: {
        ...updatedDeck,
        ...getDeckCoverMetadata(updatedDeck),
        lastUsedAt: Date.now(),
      },
    });
  }

  function deleteDeck(deckId: string) {
    markDeckDeleted(deckId);
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
      <main class='mx-auto max-w-6xl px-6 py-8'>
        <header class='mb-8 flex items-start justify-between gap-4'>
          <div>
            <h1 class='text-xl font-semibold tracking-tight'>Untapped Table</h1>
            <p class='mt-1 text-sm text-muted-foreground'>
              Virtual table to play Magic: The Gathering with your friends.
            </p>
          </div>
          <ProfileMenu />
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

            <div class='px-6 py-6'>
              <Show
                when={decks().length > 0}
                fallback={
                  <p class='text-sm text-muted-foreground'>
                    No decks yet. Create one by importing a card list.
                  </p>
                }>
                <DeckBracketFilterBar
                  class='mb-4'
                  value={bracketFilter()}
                  onChange={setBracketFilter}
                  searchQuery={deckSearchQuery()}
                  onSearchChange={setDeckSearchQuery}
                  manaColors={manaColorFilter()}
                  onManaColorsChange={setManaColorFilter}
                />
                <Show
                  when={filteredDecks().length > 0}
                  fallback={
                    <p class='text-sm text-muted-foreground'>
                      No decks match your filters.
                    </p>
                  }>
                  <div class='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4'>
                    <For each={filteredDecks()}>
                    {deck => (
                      <article class='group relative aspect-[626/457] overflow-hidden rounded-lg shadow-md'>
                        <button
                          type='button'
                          class='block size-full text-left'
                          onClick={() => setEditingDeck(deck)}>
                          <DeckPreviewImage
                            deck={deck}
                            class='absolute inset-0 size-full object-cover object-center'
                            onResolvedCover={url => {
                              if (deck.coverImage === url) return;
                              setDeckStore('decks', deck.id, current => ({
                                ...current,
                                coverImage: url,
                              }));
                            }}
                          />
                          <div class='absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/10' />
                          <div class='absolute inset-x-0 bottom-0 p-3'>
                            <p class='truncate text-base font-semibold text-white'>
                              {deck.name || 'Untitled'}
                            </p>
                            <DeckColorIdentity
                              deck={deck}
                              onResolved={colors =>
                                setDeckStore('decks', deck.id, current => ({
                                  ...current,
                                  colorIdentity: colors,
                                  colorIdentityVersion: COLOR_IDENTITY_VERSION,
                                }))
                              }
                            />
                            <Show
                              when={
                                (deck.bracketEstimate != null &&
                                  getBracketTagLabel(deck.bracketEstimate)) ||
                                deck.tags?.length
                              }>
                              <div class='mt-2 flex flex-wrap items-center gap-1.5'>
                                <BracketEstimateTag bracket={deck.bracketEstimate} />
                                <Show when={deck.tags?.length}>
                                  <For each={deck.tags}>
                                    {tag => (
                                      <span class='rounded bg-white/90 px-2 py-0.5 text-xs leading-none text-black'>
                                        {tag.name}
                                      </span>
                                    )}
                                  </For>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        </button>
                        <Button
                          variant='ghost'
                          type='button'
                          size='icon'
                          class='absolute right-2 top-2 size-8 bg-black/35 text-white hover:bg-black/55 hover:text-white'
                          aria-label={`Edit ${deck.name || 'Untitled'}`}
                          onClick={() => setEditingDeck(deck)}>
                          <PencilIcon class='size-4' />
                        </Button>
                      </article>
                    )}
                  </For>
                </div>
                </Show>
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
                {auth.user()
                  ? 'Decks are saved to your account and synced across devices.'
                  : 'Decks are saved on this device. Sign in to sync them to your account, or export a backup to avoid losing them.'}
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

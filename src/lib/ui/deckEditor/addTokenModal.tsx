import { Component, createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContentExtended,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
} from '~/components/ui/dialog';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import CheckIcon from 'lucide-solid/icons/check';
import { CardEntryDetail } from '~/lib/constants';
import { getCardImage } from '~/lib/card';
import { getTokenKey } from '~/lib/deckTokens';
import { searchCards } from '~/lib/scryfall/client';
import { cardSystem } from '~/lib/globals';

interface Props {
  open: boolean;
  /** Token keys already in the deck (shown as added). */
  existingKeys: Set<string>;
  onAdd(token: CardEntryDetail): void;
  onClose(): void;
}

const SEARCH_DEBOUNCE_MS = 400;

/** Search every existing token on Scryfall (`t:token`) and add it to the deck by hand. */
const AddTokenModal: Component<Props> = props => {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<CardEntryDetail[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let requestId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function runSearch(q: string, nextPage: number) {
    const id = ++requestId;
    setLoading(true);
    setError(undefined);
    try {
      const result = await searchCards(
        `${q.trim()} t:token`,
        { page: nextPage },
        { priority: 'interactive' },
      );
      if (id !== requestId) return;
      setResults(current => (nextPage === 1 ? result.data : [...current, ...result.data]));
      setTotal(result.total_cards);
      setPage(nextPage);
    } catch {
      if (id !== requestId) return;
      setError('Could not search tokens right now. Try again in a moment.');
    } finally {
      if (id === requestId) setLoading(false);
    }
  }

  createEffect(
    on(
      () => [props.open, query()] as const,
      ([open, q]) => {
        if (!open) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void runSearch(q, 1), q ? SEARCH_DEBOUNCE_MS : 0);
      },
    ),
  );
  onCleanup(() => timer && clearTimeout(timer));

  return (
    // Only mount while open: the full-screen wrapper below would otherwise sit on top of the
    // page invisibly and swallow every click.
    <Show when={props.open}>
    <Dialog modal open={props.open} onOpenChange={open => !open && props.onClose()}>
      <Portal>
        <div class='fixed inset-0 z-[70] flex items-start justify-center sm:items-center'>
          <DialogOverlay class='z-[70]' />
          <DialogContentExtended class='z-[70] flex h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] flex-col'>
            <DialogHeader>
              <DialogTitle>Add token</DialogTitle>
            </DialogHeader>
            <input
              type='search'
              autofocus
              placeholder='Search tokens (e.g. goblin, treasure, 1/1 spirit)…'
              class='h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              value={query()}
              onInput={e => setQuery(e.currentTarget.value)}
            />
            <div class='text-xs text-muted-foreground'>
              <Show when={!loading() || results().length} fallback='Searching…'>
                {total()} tokens found
              </Show>
            </div>
            <div class='min-h-0 flex-1 overflow-y-auto'>
              <Show when={error()}>
                <p class='p-4 text-center text-sm text-destructive'>{error()}</p>
              </Show>
              <div class='grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7 2xl:grid-cols-9'>
                <For each={results()}>
                  {token => {
                    const added = () => props.existingKeys.has(getTokenKey(token));
                    return (
                      <button
                        type='button'
                        disabled={added()}
                        title={`${token.name} — ${token.type_line ?? ''} (${token.set?.toUpperCase() ?? ''})`}
                        class='group relative flex flex-col items-center gap-1 rounded-md p-1 text-left hover:bg-accent disabled:cursor-default disabled:opacity-60'
                        onClick={() => props.onAdd(token)}>
                        <img
                          loading='lazy'
                          class='w-full rounded-[4.75%]'
                          src={
                            getCardImage({ detail: token } as never) ??
                            cardSystem.fallbackImage ??
                            '/unknown-card-image.webp'
                          }
                          alt={token.name}
                        />
                        <span class='w-full truncate text-center text-xs'>{token.name}</span>
                        <span class='w-full truncate text-center text-[10px] text-muted-foreground'>
                          {token.type_line?.replace(/^Token\s*/, '')} · {token.set?.toUpperCase()}
                        </span>
                        <Show when={added()}>
                          <span class='absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground'>
                            <CheckIcon class='size-3' />
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
              <Show when={loading()}>
                <div class='flex justify-center p-4'>
                  <LoaderIcon class='size-5 animate-spin' />
                </div>
              </Show>
              <Show when={!loading() && results().length < total()}>
                <div class='flex justify-center p-3'>
                  <Button
                    type='button'
                    variant='secondary'
                    onClick={() => void runSearch(query(), page() + 1)}>
                    Load more
                  </Button>
                </div>
              </Show>
            </div>
            <div class='flex justify-end'>
              <Button type='button' variant='outline' onClick={props.onClose}>
                Done
              </Button>
            </div>
          </DialogContentExtended>
        </div>
      </Portal>
    </Dialog>
    </Show>
  );
};

export default AddTokenModal;

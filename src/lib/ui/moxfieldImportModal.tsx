import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';
import ImagesIcon from 'lucide-solid/icons/images';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field';
import { mergeImportedDecks } from '~/lib/deckBulkTransfer';
import { createDeckStore } from '~/lib/deckStore';
import {
  deckListItemFromSummary,
  fetchCommanderPreview,
  fetchMoxfieldUserPublicDecksPage,
  MOXFIELD_IMPORT_PAGE_SIZE,
  resolveMoxfieldUsername,
} from '~/lib/moxfield/client';
import { importMoxfieldDecks } from '~/lib/moxfield/import';
import type { MoxfieldDeckListItem } from '~/lib/moxfield/types';

interface MoxfieldImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MoxfieldDeckTileProps {
  publicId: string;
  name: string;
  selected: boolean;
  commanderName?: string;
  commanderImageUrl?: string;
  disabled: boolean;
  onToggle: () => void;
  onPreviewLoaded: (
    publicId: string,
    preview: Pick<MoxfieldDeckListItem, 'commanderName' | 'commanderImageUrl'>,
  ) => void;
}

const MoxfieldDeckTile: Component<MoxfieldDeckTileProps> = props => {
  let tileRef: HTMLDivElement | undefined;
  const [previewLoaded, setPreviewLoaded] = createSignal(
    Boolean(props.commanderImageUrl || props.commanderName),
  );
  const [imageFailed, setImageFailed] = createSignal(false);

  createEffect(() => {
    props.commanderImageUrl;
    setImageFailed(false);
  });

  onMount(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0]?.isIntersecting || previewLoaded()) return;
        observer.disconnect();
        void loadPreview();
      },
      { rootMargin: '120px' },
    );

    if (tileRef) observer.observe(tileRef);
    onCleanup(() => observer.disconnect());
  });

  async function loadPreview() {
    if (previewLoaded()) return;
    try {
      const preview = await fetchCommanderPreview(props.publicId);
      props.onPreviewLoaded(props.publicId, preview);
    } finally {
      setPreviewLoaded(true);
    }
  }

  function toggleSelected() {
    if (props.disabled) return;
    props.onToggle();
  }

  const showImage = () => Boolean(props.commanderImageUrl) && !imageFailed();

  return (
    <div
      ref={tileRef}
      role='button'
      tabIndex={props.disabled ? -1 : 0}
      aria-pressed={props.selected}
      aria-disabled={props.disabled}
      class='group relative cursor-pointer overflow-hidden rounded-lg border text-left shadow-sm transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      classList={{
        'ring-2 ring-primary ring-offset-2 ring-offset-background': props.selected,
        'pointer-events-none opacity-50': props.disabled,
      }}
      onClick={toggleSelected}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleSelected();
      }}>
      <div class='aspect-[626/457] bg-muted p-2'>
        <Show
          when={showImage()}
          fallback={
            <div class='flex size-full items-center justify-center rounded-sm bg-muted'>
              <ImagesIcon class='size-8 text-muted-foreground/50' aria-hidden='true' />
            </div>
          }>
          <img
            src={props.commanderImageUrl}
            alt={props.commanderName ?? props.name}
            class='size-full rounded-sm object-contain'
            loading='lazy'
            onError={() => setImageFailed(true)}
          />
        </Show>
      </div>
      <div class='pointer-events-none absolute inset-0 bg-black/20 transition group-hover:bg-black/30' />
      <div
        class='pointer-events-none absolute left-2 top-2 z-10 flex size-4 items-center justify-center rounded-sm border border-primary bg-background/90 shadow-sm'
        classList={{
          'border-none bg-primary text-primary-foreground': props.selected,
        }}
        aria-hidden='true'>
        <Show when={props.selected}>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
            stroke-linecap='round'
            stroke-linejoin='round'
            class='size-4'>
            <path d='M5 12l5 5l10 -10' />
          </svg>
        </Show>
      </div>
      <div class='pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-8'>
        <p class='line-clamp-2 text-sm font-semibold text-white'>{props.name}</p>
        <Show when={props.commanderName}>
          <p class='truncate text-xs text-white/80'>{props.commanderName}</p>
        </Show>
      </div>
    </div>
  );
};

export const MoxfieldImportModal: Component<MoxfieldImportModalProps> = props => {
  const [deckStore, setDeckStore] = createDeckStore();
  const [step, setStep] = createSignal<'username' | 'select'>('username');
  const [username, setUsername] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [importing, setImporting] = createSignal(false);
  const [decks, setDecks] = createSignal<MoxfieldDeckListItem[]>([]);
  const [profileUsername, setProfileUsername] = createSignal('');
  const [resolvedUsername, setResolvedUsername] = createSignal('');
  const [totalDeckCount, setTotalDeckCount] = createSignal(0);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [totalPages, setTotalPages] = createSignal(0);

  let loadAbort: AbortController | undefined;

  const selectedCount = createMemo(() => decks().filter(deck => deck.selected).length);
  const allSelected = createMemo(
    () => decks().length > 0 && decks().every(deck => deck.selected),
  );
  const hasMoreDecks = createMemo(() => currentPage() < totalPages());

  function reset() {
    loadAbort?.abort();
    loadAbort = undefined;
    setStep('username');
    setUsername('');
    setDecks([]);
    setProfileUsername('');
    setResolvedUsername('');
    setTotalDeckCount(0);
    setCurrentPage(0);
    setTotalPages(0);
    setLoading(false);
    setLoadingMore(false);
    setImporting(false);
  }

  function handleOpenChange(open: boolean) {
    if (!open && importing()) return;
    if (!open) {
      loadAbort?.abort();
      props.onOpenChange(false);
      reset();
      return;
    }
    props.onOpenChange(open);
  }

  function appendDecks(pageDecks: ReturnType<typeof deckListItemFromSummary>[]) {
    setDecks(current => {
      const seen = new Set(current.map(deck => deck.publicId));
      const next = [...current];
      for (const deck of pageDecks) {
        if (seen.has(deck.publicId)) continue;
        seen.add(deck.publicId);
        next.push(deck);
      }
      return next;
    });
  }

  async function loadDecksPage(pageNumber: number, append: boolean) {
    const user = resolvedUsername();
    if (!user) return;

    loadAbort?.abort();
    loadAbort = new AbortController();
    const signal = loadAbort.signal;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await fetchMoxfieldUserPublicDecksPage(user, pageNumber, { signal });
      if (signal.aborted) return;

      const items = result.decks.map(summary => deckListItemFromSummary(summary, true));
      if (append) {
        appendDecks(items);
      } else {
        setDecks(items);
      }

      setTotalDeckCount(result.totalResults);
      setCurrentPage(result.pageNumber);
      setTotalPages(result.totalPages);
    } catch (error) {
      if (signal.aborted) return;
      toast.error(error instanceof Error ? error.message : 'Could not load Moxfield decks.');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  async function onSearchUser() {
    const value = username().trim();
    if (!value) {
      toast.error('Enter a Moxfield username.');
      return;
    }

    setDecks([]);
    setTotalDeckCount(0);
    setCurrentPage(0);
    setTotalPages(0);
    setLoading(true);

    try {
      const user = await resolveMoxfieldUsername(value);
      setProfileUsername(value);
      setResolvedUsername(user);
      await loadDecksPage(1, false);
      setStep('select');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load Moxfield decks.');
      setLoading(false);
    }
  }

  async function onLoadMore() {
    if (!hasMoreDecks() || loadingMore()) return;
    await loadDecksPage(currentPage() + 1, true);
  }

  function toggleDeck(publicId: string, selected: boolean) {
    setDecks(current =>
      current.map(deck => (deck.publicId === publicId ? { ...deck, selected } : deck)),
    );
  }

  function updateDeckPreview(
    publicId: string,
    preview: Pick<MoxfieldDeckListItem, 'commanderName' | 'commanderImageUrl'>,
  ) {
    setDecks(current =>
      current.map(deck => (deck.publicId === publicId ? { ...deck, ...preview } : deck)),
    );
  }

  function toggleSelectAll(selected: boolean) {
    setDecks(current => current.map(deck => ({ ...deck, selected })));
  }

  async function onImportSelected() {
    const selected = decks().filter(deck => deck.selected);
    if (!selected.length) {
      toast.error('Select at least one deck.');
      return;
    }

    setImporting(true);
    try {
      const imported = await importMoxfieldDecks(selected.map(deck => deck.publicId));
      const merged = mergeImportedDecks(imported, {
        decks: deckStore.decks,
        systems: deckStore.systems,
      });
      setDeckStore(merged);
      toast.success(`Imported ${imported.length} deck${imported.length === 1 ? '' : 's'}`);
      handleOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent class='max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Import Moxfield decks</DialogTitle>
        </DialogHeader>

        <Show
          when={step() === 'select'}
          fallback={
            <div class='space-y-4'>
              <p class='text-sm text-muted-foreground'>Import public decks from a profile</p>
              <TextField>
                <TextFieldLabel>Moxfield username</TextFieldLabel>
                <TextFieldInput
                  placeholder='username'
                  value={username()}
                  disabled={loading()}
                  onInput={event => setUsername(event.currentTarget.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void onSearchUser();
                    }
                  }}
                />
              </TextField>
            </div>
          }>
          <div class='space-y-4'>
            <div class='flex flex-wrap items-center justify-between gap-2'>
              <div class='space-y-1'>
                <p class='text-sm text-muted-foreground'>
                  Public decks from{' '}
                  <span class='font-medium text-foreground'>{profileUsername()}</span>
                </p>
                <Show when={totalDeckCount() > 0}>
                  <p class='text-xs text-muted-foreground'>
                    Showing {decks().length} of {totalDeckCount()} decks
                  </p>
                </Show>
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={importing() || loadingMore() || !decks().length}
                onClick={() => toggleSelectAll(!allSelected())}>
                {allSelected() ? 'Deselect all' : 'Select all'}
              </Button>
            </div>

            <div class='grid max-h-[min(60vh,520px)] grid-cols-2 gap-3 overflow-y-auto p-1 sm:grid-cols-3'>
              <Index each={decks()}>
                {deck => (
                  <MoxfieldDeckTile
                    publicId={deck().publicId}
                    name={deck().name}
                    selected={deck().selected}
                    commanderName={deck().commanderName}
                    commanderImageUrl={deck().commanderImageUrl}
                    disabled={importing()}
                    onToggle={() => toggleDeck(deck().publicId, !deck().selected)}
                    onPreviewLoaded={updateDeckPreview}
                  />
                )}
              </Index>
            </div>

            <Show when={hasMoreDecks()}>
              <div class='flex justify-center pt-1'>
                <Button
                  type='button'
                  variant='outline'
                  disabled={importing() || loadingMore()}
                  onClick={() => void onLoadMore()}>
                  <Show when={loadingMore()} fallback={`Load more (${MOXFIELD_IMPORT_PAGE_SIZE})`}>
                    <>
                      <LoaderIcon class='mr-2 size-4 animate-spin' />
                      Loading…
                    </>
                  </Show>
                </Button>
              </div>
            </Show>
          </div>
        </Show>

        <DialogFooter class='gap-2 sm:justify-between'>
          <Show when={step() === 'select'}>
            <Button
              type='button'
              variant='ghost'
              disabled={loading() || importing()}
              onClick={() => setStep('username')}>
              Back
            </Button>
          </Show>

          <div class='ml-auto flex gap-2'>
            <Button
              type='button'
              variant='ghost'
              disabled={loading() || importing()}
              onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>

            <Show
              when={step() === 'select'}
              fallback={
                <Button type='button' disabled={loading()} onClick={() => void onSearchUser()}>
                  <Show when={loading()} fallback='Continue'>
                    <>
                      <LoaderIcon class='mr-2 size-4 animate-spin' />
                      Loading…
                    </>
                  </Show>
                </Button>
              }>
              <Button
                type='button'
                disabled={importing() || selectedCount() === 0}
                onClick={() => void onImportSelected()}>
                <Show when={importing()} fallback={`Import selected (${selectedCount()})`}>
                  <LoaderIcon class='mr-2 size-4 animate-spin' />
                  Importing…
                </Show>
              </Button>
            </Show>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

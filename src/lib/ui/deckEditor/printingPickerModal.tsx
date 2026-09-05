import { Component, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { DetailedCardEntry } from '~/lib/constants';
import {
  addSavedCustomArtUrl,
  CustomCardArtOption,
  fetchGalleryCustomArt,
  getSavedCustomArtUrls,
  isCustomArtImageSelected,
  savedUrlsToCustomArtOptions,
} from '~/lib/customCardArt';
import {
  CardPrintingOption,
  fetchCardPrintings,
  getPrintingLabel,
  getPrintingPreviewUrl,
} from '~/lib/deck';
import { getCardImage } from '~/lib/card';
import { cardSystem } from '~/lib/globals';
import { cn } from '~/lib/cnUtil';
import intersectionObserver from '~/lib/intersectionObserver';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import XIcon from 'lucide-solid/icons/x';

interface Props {
  entry: DetailedCardEntry;
  pinnedPrintings?: CardPrintingOption[];
  onSelect(printing: CardPrintingOption): void;
  onSelectCustomArt(option: CustomCardArtOption): void;
  onClose(): void;
}

type PanelMode = 'printings' | 'custom-art';

const COLS_STORAGE_KEY = 'arcanetable-printing-picker-cols-v2';
const DEFAULT_COLS = 4;
const MIN_COLS = 1;
const MAX_COLS = 12;

function readColsPerRow() {
  const raw = localStorage.getItem(COLS_STORAGE_KEY);
  if (raw == null || raw.trim() === '') return DEFAULT_COLS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_COLS) return DEFAULT_COLS;
  return Math.min(MAX_COLS, Math.round(parsed));
}

function writeColsPerRow(value: number) {
  localStorage.setItem(COLS_STORAGE_KEY, String(value));
}

const PrintingPickerModal: Component<Props> = props => {
  const [panelMode, setPanelMode] = createSignal<PanelMode>('printings');
  const [printings, setPrintings] = createSignal<CardPrintingOption[]>([]);
  const [page, setPage] = createSignal(0);
  const [totalPages, setTotalPages] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [colsPerRow, setColsPerRow] = createSignal(readColsPerRow());
  const [colsInput, setColsInput] = createSignal(String(readColsPerRow()));

  const [savedUrls, setSavedUrls] = createSignal<string[]>([]);
  const [customUrlInput, setCustomUrlInput] = createSignal('');
  const [galleryCards, setGalleryCards] = createSignal<CustomCardArtOption[]>([]);
  const [galleryPage, setGalleryPage] = createSignal(0);
  const [galleryTotalPages, setGalleryTotalPages] = createSignal(0);
  const [customLoading, setCustomLoading] = createSignal(false);

  const selectedId = () => props.entry.id;
  const selectedImageUrl = () => getCardImage(props.entry);

  const savedCustomOptions = createMemo(() =>
    savedUrlsToCustomArtOptions(props.entry.name, savedUrls()),
  );

  const customArtOptions = createMemo(() => [...savedCustomOptions(), ...galleryCards()]);

  const visiblePrintings = createMemo(() => {
    const fetched = printings();
    const pinned = props.pinnedPrintings ?? [];
    const ids = new Set(fetched.map(printing => printing.id));
    return [...pinned.filter(printing => printing.id && !ids.has(printing.id)), ...fetched];
  });

  async function loadPage(nextPage: number, append = false) {
    if (loading()) return;
    setLoading(true);
    try {
      const result = await fetchCardPrintings(props.entry.name, nextPage);
      setPrintings(append ? [...printings(), ...result.data] : result.data);
      setPage(result.page);
      setTotalPages(result.total_pages);
    } finally {
      setLoading(false);
    }
  }

  async function loadGalleryPage(nextPage: number, append = false) {
    if (customLoading()) return;
    setCustomLoading(true);
    try {
      const result = await fetchGalleryCustomArt(props.entry.name, nextPage);
      setGalleryCards(append ? [...galleryCards(), ...result.data] : result.data);
      setGalleryPage(result.page);
      setGalleryTotalPages(result.total_pages);
    } finally {
      setCustomLoading(false);
    }
  }

  async function openCustomArtPanel() {
    setPanelMode('custom-art');
    setSavedUrls(getSavedCustomArtUrls(props.entry.name));
    if (galleryCards().length === 0) {
      await loadGalleryPage(1);
    }
  }

  function addCustomUrl() {
    const next = addSavedCustomArtUrl(props.entry.name, customUrlInput());
    setSavedUrls(next);
    setCustomUrlInput('');
  }

  onMount(() => {
    void loadPage(1);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }

    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  function loadMorePrintings() {
    if (page() < totalPages()) {
      void loadPage(page() + 1, true);
    }
  }

  function loadMoreGallery() {
    if (galleryPage() < galleryTotalPages()) {
      void loadGalleryPage(galleryPage() + 1, true);
    }
  }

  function updateColsPerRow(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(value)));
    if (next === colsPerRow()) {
      setColsInput(String(next));
      return;
    }
    setColsPerRow(next);
    setColsInput(String(next));
    writeColsPerRow(next);
  }

  function commitColsInput() {
    const parsed = Number.parseInt(colsInput(), 10);
    if (!Number.isFinite(parsed)) {
      setColsInput(String(colsPerRow()));
      return;
    }
    updateColsPerRow(parsed);
  }

  function isCustomArtSelected(option: CustomCardArtOption) {
    return isCustomArtImageSelected(selectedImageUrl(), option.imageUrl);
  }

  return (
    <div
      class='fixed inset-0 z-[70] flex flex-col bg-background/95 backdrop-blur-sm'
      onContextMenu={e => e.preventDefault()}>
      <header class='flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3'>
        <div class='min-w-0'>
          <h2 class='truncate text-lg font-semibold'>{props.entry.name}</h2>
          <p class='text-sm text-muted-foreground'>
            {panelMode() === 'printings' ? 'Choose a printing' : 'Custom card art'}
          </p>
        </div>
        <div class='flex shrink-0 items-center gap-3'>
          <Button
            type='button'
            variant={panelMode() === 'custom-art' ? 'default' : 'outline'}
            size='sm'
            class='whitespace-nowrap'
            onClick={() => {
              if (panelMode() === 'printings') {
                void openCustomArtPanel();
              } else {
                setPanelMode('printings');
              }
            }}>
            Custom card art
          </Button>
          <label class='flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap'>
            Cards by row
            <input
              type='text'
              inputMode='numeric'
              autocomplete='off'
              class='h-8 w-16 rounded-md border border-input bg-transparent px-2 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              value={colsInput()}
              onInput={e => setColsInput(e.currentTarget.value.replace(/\D/g, ''))}
              onBlur={commitColsInput}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  commitColsInput();
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
          <Button type='button' variant='ghost' size='icon' onClick={props.onClose}>
            <XIcon class='size-5' />
          </Button>
        </div>
      </header>

      <div class='min-h-0 flex-1 overflow-y-auto p-4'>
        <Show when={panelMode() === 'printings'}>
          <Show
            when={!loading() || printings().length > 0}
            fallback={
              <div class='flex h-full min-h-48 items-center justify-center gap-2 text-muted-foreground'>
                <LoaderIcon class='size-5 animate-spin' />
                Loading printings…
              </div>
            }>
            <div
              class='grid gap-4'
              style={{ 'grid-template-columns': `repeat(${colsPerRow()}, minmax(0, 1fr))` }}>
              <For each={visiblePrintings()}>
                {printing => {
                  const isSelected = () => printing.id === selectedId();
                  return (
                    <button
                      type='button'
                      class={cn(
                        'group relative flex flex-col gap-2 rounded-lg border bg-card p-2 text-left transition-colors hover:border-primary',
                        isSelected() && 'border-primary ring-2 ring-primary/40',
                      )}
                      onClick={() => props.onSelect(printing)}>
                      <div class='relative aspect-[5/7] overflow-hidden rounded-md bg-muted'>
                        <img
                          src={
                            getPrintingPreviewUrl(printing) ??
                            cardSystem.fallbackImage ??
                            '/unknown-card-image.webp'
                          }
                          alt=''
                          class='h-full w-full object-cover'
                          loading='lazy'
                          decoding='async'
                        />
                        <Show when={isSelected()}>
                          <Badge class='absolute left-2 top-2 shadow-md'>Selected</Badge>
                        </Show>
                      </div>
                      <div class='min-w-0 px-1'>
                        <div class='truncate font-mono text-xs font-bold uppercase'>
                          {getPrintingLabel(printing)}
                        </div>
                        <Show when={printing.set_name || printing.collector_number}>
                          <div class='truncate text-xs text-muted-foreground'>
                            {printing.set_name}
                            {printing.collector_number ? ` · #${printing.collector_number}` : ''}
                          </div>
                        </Show>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>

            <Show when={!loading() && visiblePrintings().length === 0}>
              <div class='py-12 text-center text-sm text-muted-foreground'>No printings found</div>
            </Show>

            <Show when={page() < totalPages()}>
              <div
                class='flex justify-center py-6'
                use:intersectionObserver={{ onIntersect: loadMorePrintings }}>
                <Show
                  when={loading()}
                  fallback={
                    <span class='text-sm text-muted-foreground'>Scroll for more printings…</span>
                  }>
                  <div class='flex items-center gap-2 text-sm text-muted-foreground'>
                    <LoaderIcon class='size-4 animate-spin' />
                    Loading more…
                  </div>
                </Show>
              </div>
            </Show>
          </Show>
        </Show>

        <Show when={panelMode() === 'custom-art'}>
          <Show
            when={!customLoading() || customArtOptions().length > 0}
            fallback={
              <div class='flex h-full min-h-48 items-center justify-center gap-2 text-muted-foreground'>
                <LoaderIcon class='size-5 animate-spin' />
                Loading custom card art…
              </div>
            }>
            <div
              class='grid gap-4'
              style={{ 'grid-template-columns': `repeat(${colsPerRow()}, minmax(0, 1fr))` }}>
              <div class='flex flex-col gap-2 rounded-lg border border-dashed bg-card/50 p-2 opacity-80'>
                <div class='relative aspect-[5/7] overflow-hidden rounded-md border border-dashed border-muted-foreground/30 bg-muted/40'>
                  <div class='flex h-full flex-col items-center justify-center gap-3 p-3'>
                    <label class='w-full text-center text-xs font-medium text-muted-foreground'>
                      Custom url card
                    </label>
                    <input
                      type='url'
                      placeholder='https://…'
                      autocomplete='off'
                      class='h-8 w-full rounded-md border border-input bg-background/80 px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                      value={customUrlInput()}
                      onInput={e => setCustomUrlInput(e.currentTarget.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') addCustomUrl();
                      }}
                    />
                    <Button type='button' size='sm' class='w-full' onClick={addCustomUrl}>
                      Add
                    </Button>
                  </div>
                </div>
                <div class='px-1 text-center text-xs text-muted-foreground'>Add a custom image URL</div>
              </div>

              <For each={customArtOptions()}>
                {option => {
                  const isSelected = () => isCustomArtSelected(option);
                  return (
                    <button
                      type='button'
                      class={cn(
                        'group relative flex flex-col gap-2 rounded-lg border bg-card p-2 text-left transition-colors hover:border-primary',
                        isSelected() && 'border-primary ring-2 ring-primary/40',
                      )}
                      onClick={() => props.onSelectCustomArt(option)}>
                      <div class='relative aspect-[5/7] overflow-hidden rounded-md bg-muted'>
                        <img
                          src={option.thumbUrl}
                          alt=''
                          class='h-full w-full object-cover'
                          loading='lazy'
                          decoding='async'
                        />
                        <Show when={isSelected()}>
                          <Badge class='absolute left-2 top-2 shadow-md'>Selected</Badge>
                        </Show>
                      </div>
                      <div class='min-w-0 px-1'>
                        <div class='truncate text-xs font-bold'>{option.label}</div>
                        <div class='truncate text-xs text-muted-foreground'>
                          {option.source === 'custom'
                            ? 'Custom URL'
                            : option.creator
                              ? `by ${option.creator}`
                              : 'MTGCardBuilder'}
                        </div>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>

            <Show when={!customLoading() && customArtOptions().length === 0}>
              <div class='py-12 text-center text-sm text-muted-foreground'>
                No custom card art found for this card
              </div>
            </Show>

            <Show when={galleryPage() < galleryTotalPages()}>
              <div
                class='flex justify-center py-6'
                use:intersectionObserver={{ onIntersect: loadMoreGallery }}>
                <Show
                  when={customLoading()}
                  fallback={
                    <span class='text-sm text-muted-foreground'>
                      Scroll for more gallery cards…
                    </span>
                  }>
                  <div class='flex items-center gap-2 text-sm text-muted-foreground'>
                    <LoaderIcon class='size-4 animate-spin' />
                    Loading more…
                  </div>
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default PrintingPickerModal;

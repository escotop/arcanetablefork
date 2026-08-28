import { Component, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { DetailedCardEntry } from '~/lib/constants';
import {
  CardPrintingOption,
  fetchCardPrintings,
  getPrintingLabel,
  getPrintingPreviewUrl,
} from '~/lib/deck';
import { cardSystem } from '~/lib/globals';
import { cn } from '~/lib/cnUtil';
import intersectionObserver from '~/lib/intersectionObserver';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import XIcon from 'lucide-solid/icons/x';

interface Props {
  entry: DetailedCardEntry;
  onSelect(printing: CardPrintingOption): void;
  onClose(): void;
}

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
  const [printings, setPrintings] = createSignal<CardPrintingOption[]>([]);
  const [page, setPage] = createSignal(0);
  const [totalPages, setTotalPages] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [colsPerRow, setColsPerRow] = createSignal(readColsPerRow());
  const [colsInput, setColsInput] = createSignal(String(readColsPerRow()));

  const selectedId = () => props.entry.id;

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

  onMount(() => {
    void loadPage(1);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }

    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  function loadMore() {
    if (page() < totalPages()) {
      void loadPage(page() + 1, true);
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

  return (
    <div
      class='fixed inset-0 z-[70] flex flex-col bg-background/95 backdrop-blur-sm'
      onContextMenu={e => e.preventDefault()}>
      <header class='flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3'>
        <div class='min-w-0'>
          <h2 class='truncate text-lg font-semibold'>{props.entry.name}</h2>
          <p class='text-sm text-muted-foreground'>Choose a printing</p>
        </div>
        <div class='flex shrink-0 items-center gap-3'>
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
            <For each={printings()}>
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

          <Show when={!loading() && printings().length === 0}>
            <div class='py-12 text-center text-sm text-muted-foreground'>No printings found</div>
          </Show>

          <Show when={page() < totalPages()}>
            <div
              class='flex justify-center py-6'
              use:intersectionObserver={{ onIntersect: loadMore }}>
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
      </div>
    </div>
  );
};

export default PrintingPickerModal;

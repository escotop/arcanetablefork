import ChevronLeftIcon from 'lucide-solid/icons/chevron-left';
import ChevronRightIcon from 'lucide-solid/icons/chevron-right';
import ChevronsLeftIcon from 'lucide-solid/icons/chevrons-left';
import ChevronsRightIcon from 'lucide-solid/icons/chevrons-right';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import SearchIcon from 'lucide-solid/icons/search';
import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { scrollTarget, setScrollTarget } from '../globals';
import { toast } from 'solid-sonner';
import { Button } from '~/components/ui/button';
import { TextField, TextFieldInput } from '~/components/ui/text-field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  exploreMpcfillCardbacks,
  MPCFILL_EXPLORE_URL,
  mpcfillCardBackImageUrl,
} from '../mpcfill/client';
import type { MpcfillCardBackProduct } from '../mpcfill/client';
import type { SavedCardBack } from '../savedCardBack';

export interface CardBackPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected?: SavedCardBack;
  onSelect: (cardBack: SavedCardBack) => void;
}

const PAGINATION_WINDOW = 5;
const PAGINATION_CENTER_OFFSET = Math.floor(PAGINATION_WINDOW / 2);

function buildPaginationNumbers(current: number, lastPage: number): number[] {
  if (lastPage < PAGINATION_WINDOW) {
    return Array.from({ length: lastPage }, (_, index) => index + 1);
  }

  let start = current - PAGINATION_CENTER_OFFSET;
  let end = current + PAGINATION_CENTER_OFFSET;

  if (start < 1) {
    start = 1;
    end = Math.min(PAGINATION_WINDOW, lastPage);
  } else if (end > lastPage) {
    end = lastPage;
    start = Math.max(1, end - PAGINATION_WINDOW + 1);
  }

  const pages: number[] = [];
  for (let pageNumber = start; pageNumber <= end; pageNumber++) {
    pages.push(pageNumber);
  }
  return pages;
}

const SEARCH_DEBOUNCE_MS = 300;

const CardBackPickerModal: Component<CardBackPickerModalProps> = props => {
  const [page, setPage] = createSignal(1);
  const [products, setProducts] = createSignal<MpcfillCardBackProduct[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [hasNextPage, setHasNextPage] = createSignal(false);
  const [lastPage, setLastPage] = createSignal(1);
  const [searchInput, setSearchInput] = createSignal('');
  const [searchQuery, setSearchQuery] = createSignal('');

  const isSearching = () => searchQuery().trim().length > 0;

  const paginationNumbers = createMemo(() => buildPaginationNumbers(page(), lastPage()));

  let catalogRequestId = 0;

  async function loadPage(targetPage: number) {
    if (targetPage < 1) return;
    const requestId = ++catalogRequestId;
    setLoading(true);
    try {
      const result = await exploreMpcfillCardbacks(searchQuery(), targetPage);
      if (requestId !== catalogRequestId) return;
      setProducts(result.products);
      setPage(targetPage);
      setHasNextPage(result.hasNext);
      setLastPage(Math.max(1, result.lastPage));
    } catch (error) {
      if (requestId !== catalogRequestId) return;
      toast.error('No se pudieron cargar los reversos');
      console.error(error);
    } finally {
      if (requestId === catalogRequestId) {
        setLoading(false);
      }
    }
  }

  createEffect(() => {
    if (!props.open) return;
    setSearchInput('');
    setSearchQuery('');
    setLastPage(1);
    setHasNextPage(false);
  });

  createEffect(() => {
    if (!props.open) return;
    const value = searchInput();
    const timer = window.setTimeout(() => setSearchQuery(value), SEARCH_DEBOUNCE_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(() => {
    if (!props.open) return;
    searchQuery();
    void loadPage(1);
  });

  createEffect(() => {
    if (!props.open) return;

    const previousScrollTarget = scrollTarget();
    setScrollTarget();

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || loading()) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' && page() > 1) {
        event.preventDefault();
        void loadPage(page() - 1);
      } else if (event.key === 'ArrowRight' && hasNextPage()) {
        event.preventDefault();
        void loadPage(page() + 1);
      }
    }

    document.addEventListener('keydown', onKeyDown);

    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown);
      setScrollTarget(previousScrollTarget);
    });
  });

  function stopWheelPropagation(event: WheelEvent) {
    event.stopPropagation();
  }

  function handleScrollAreaWheel(event: WheelEvent) {
    event.stopPropagation();
    const element = event.currentTarget as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = element;
    const atTop = scrollTop <= 0 && event.deltaY < 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && event.deltaY > 0;
    if (atTop || atBottom) {
      event.preventDefault();
    }
  }

  function handleOpenChange(open: boolean) {
    props.onOpenChange(open);
  }

  function selectProduct(product: MpcfillCardBackProduct) {
    props.onSelect({
      id: product.id,
      title: product.title,
      imageUrl: product.imageUrl,
      previewUrl: product.previewUrl,
      sourceName: product.sourceName,
    });
    props.onOpenChange(false);
    toast.success('Reverso guardado');
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent
        class='flex h-[90vh] w-[96vw] max-w-[min(96vw,1400px)] flex-col gap-4 overflow-hidden'
        onWheel={stopWheelPropagation}>
        <DialogHeader>
          <DialogTitle>Elegir reverso de carta</DialogTitle>
          <DialogDescription>
            Catálogo de{' '}
            <a
              href={MPCFILL_EXPLORE_URL}
              target='_blank'
              rel='noopener noreferrer'
              class='underline'>
              MPC Autofill
            </a>
            {' '}
            (tipo Cardback).
          </DialogDescription>
        </DialogHeader>

        <TextField class='w-full'>
          <div class='relative'>
            <SearchIcon
              class='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
              aria-hidden='true'
            />
            <TextFieldInput
              type='search'
              class='pl-9'
              placeholder='Buscar por nombre…'
              value={searchInput()}
              onInput={event => setSearchInput(event.currentTarget.value)}
              aria-label='Buscar reverso por nombre'
            />
          </div>
        </TextField>

        <Show
          when={!loading()}
          fallback={
            <div class='flex flex-1 items-center justify-center py-16 text-muted-foreground'>
              <LoaderIcon class='size-8 animate-spin' />
            </div>
          }>
          <div
            class='flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1'
            onWheel={handleScrollAreaWheel}>
            <Show
              when={products().length > 0}
              fallback={
                <p class='py-8 text-center text-sm text-muted-foreground'>
                  {isSearching() ? 'Ningún reverso coincide con la búsqueda.' : 'Sin resultados.'}
                </p>
              }>
              <ul class='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
                <For each={products()}>
                  {product => (
                    <li>
                      <button
                        type='button'
                        class='group flex w-full flex-col overflow-hidden rounded-md border border-input text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        classList={{
                          'ring-2 ring-primary': props.selected?.id === product.id,
                        }}
                        onClick={() => selectProduct(product)}>
                        <div class='aspect-[5/7] w-full bg-muted'>
                          <img
                            src={mpcfillCardBackImageUrl(product.previewUrl)}
                            alt=''
                            loading='lazy'
                            class='h-full w-full object-contain'
                          />
                        </div>
                        <span class='line-clamp-2 p-2 text-xs leading-snug'>{product.title}</span>
                        <Show when={product.sourceName}>
                          <span class='px-2 pb-2 text-[10px] text-muted-foreground line-clamp-1'>
                            {product.sourceName}
                          </span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>

        <DialogFooter class='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center'>
          <nav class='flex flex-wrap items-center justify-center gap-1' aria-label='Paginación del catálogo'>
            <Button
              type='button'
              variant='outline'
              size='icon'
              class='size-8'
              disabled={loading() || page() <= 1}
              aria-label='Primera página'
              onClick={() => void loadPage(1)}>
              <ChevronsLeftIcon class='size-4' />
            </Button>
            <Button
              type='button'
              variant='outline'
              size='icon'
              class='size-8'
              disabled={loading() || page() <= 1}
              aria-label='Página anterior'
              onClick={() => void loadPage(page() - 1)}>
              <ChevronLeftIcon class='size-4' />
            </Button>

            <For each={paginationNumbers()}>
              {pageNumber => (
                <Button
                  type='button'
                  variant={page() === pageNumber ? 'default' : 'outline'}
                  size='icon'
                  class='size-8 min-w-8 font-mono text-sm'
                  disabled={loading() || page() === pageNumber}
                  aria-label={`Página ${pageNumber}`}
                  aria-current={page() === pageNumber ? 'page' : undefined}
                  onClick={() => void loadPage(pageNumber)}>
                  {pageNumber}
                </Button>
              )}
            </For>

            <Button
              type='button'
              variant='outline'
              size='icon'
              class='size-8'
              disabled={loading() || !hasNextPage()}
              aria-label='Página siguiente'
              onClick={() => void loadPage(page() + 1)}>
              <ChevronRightIcon class='size-4' />
            </Button>
            <Button
              type='button'
              variant='outline'
              size='icon'
              class='size-8'
              disabled={loading() || page() >= lastPage()}
              aria-label='Última página'
              onClick={() => void loadPage(lastPage())}>
              <ChevronsRightIcon class='size-4' />
            </Button>
          </nav>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CardBackPickerModal;

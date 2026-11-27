import ChevronLeftIcon from 'lucide-solid/icons/chevron-left';
import ChevronRightIcon from 'lucide-solid/icons/chevron-right';
import ChevronsLeftIcon from 'lucide-solid/icons/chevrons-left';
import ChevronsRightIcon from 'lucide-solid/icons/chevrons-right';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import PlusIcon from 'lucide-solid/icons/plus';
import Trash2Icon from 'lucide-solid/icons/trash-2';
import SearchIcon from 'lucide-solid/icons/search';
import XIcon from 'lucide-solid/icons/x';
import ZoomInIcon from 'lucide-solid/icons/zoom-in';
import { Component, createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { scrollTarget, setScrollTarget } from '../globals';
import { toast } from 'solid-sonner';
import { cn } from '~/lib/cnUtil';
import { Button } from '~/components/ui/button';
import { useAuth } from '~/lib/auth';
import { assetFavorites, isAssetFavorite, toggleAssetFavorite } from '~/lib/assetFavorites';
import { FavoriteButton } from '~/lib/ui/favoriteButton';
import { TextField, TextFieldInput } from '~/components/ui/text-field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { exploreMpcfillCardbacks, MPCFILL_EXPLORE_URL } from '../mpcfill/client';
import type { MpcfillCardBackProduct } from '../mpcfill/client';
import { HEARTHSTONE_CARD_BACKS_URL, searchHearthstoneCardBacks } from '../hearthstoneCardBacks';
import type { SavedCardBack } from '../savedCardBack';
import {
  addCustomCardBack,
  cardBackImageUrl,
  createCustomCardBack,
  customCardBacks,
  isCustomCardBackId,
  parseCardBackUrl,
  removeCustomCardBack,
} from '../customCardBacks';

export interface CardBackPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected?: SavedCardBack;
  onSelect: (cardBack: SavedCardBack) => void;
  /** Use above deck editor modals (z-70), e.g. `z-[80]`. */
  stackClass?: string;
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

type CardBackSource = 'mpcfill' | 'hearthstone' | 'custom';

const SOURCES: { id: CardBackSource; label: string }[] = [
  { id: 'mpcfill', label: 'MPC Autofill' },
  { id: 'hearthstone', label: 'Hearthstone' },
  { id: 'custom', label: 'Custom' },
];

function sourceOfCardBack(id: string | number | undefined): CardBackSource {
  if (String(id ?? '').startsWith('hearthstone-')) return 'hearthstone';
  return isCustomCardBackId(id) ? 'custom' : 'mpcfill';
}

function loadSourcePage(source: CardBackSource, query: string, page: number) {
  if (source === 'hearthstone') return Promise.resolve(searchHearthstoneCardBacks(query, page));
  // Custom backs are all on one page, built from the saved list (see visibleProducts).
  if (source === 'custom') return Promise.resolve({ products: [], hasNext: false, lastPage: 1 });
  return exploreMpcfillCardbacks(query, page);
}

/** Loads an image to check the URL works before saving it. */
function checkImageLoads(src: string) {
  return new Promise<boolean>(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
  });
}

const CardBackPickerModal: Component<CardBackPickerModalProps> = props => {
  const [page, setPage] = createSignal(1);
  const [products, setProducts] = createSignal<MpcfillCardBackProduct[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [hasNextPage, setHasNextPage] = createSignal(false);
  const [lastPage, setLastPage] = createSignal(1);
  const [searchInput, setSearchInput] = createSignal('');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [source, setSource] = createSignal<CardBackSource>('mpcfill');
  /** Card back shown full size over the grid. */
  const [zoomed, setZoomed] = createSignal<MpcfillCardBackProduct>();
  const [fullLoaded, setFullLoaded] = createSignal(false);
  /** Form to add a custom card back by URL. */
  const [adding, setAdding] = createSignal(false);
  const [customUrl, setCustomUrl] = createSignal('');
  const [customName, setCustomName] = createSignal('');
  const [checkingCustom, setCheckingCustom] = createSignal(false);
  createEffect(() => {
    zoomed();
    setFullLoaded(false);
  });

  const isSearching = () => searchQuery().trim().length > 0;

  const auth = useAuth();
  const canFavorite = () => auth.enabled && !!auth.user();
  /** Favorites matching the search, shown at the start of the first page. */
  const favorites = createMemo(() => {
    if (!canFavorite()) return [];
    const query = searchQuery().trim().toLowerCase();
    return assetFavorites('card_back').filter(
      item =>
        sourceOfCardBack(item.id) === source() &&
        (!query || item.title.toLowerCase().includes(query)),
    );
  });
  /** Custom backs saved in this browser. */
  const localCustomBacks = createMemo(() => {
    if (source() !== 'custom') return [];
    const query = searchQuery().trim().toLowerCase();
    return customCardBacks().filter(item => !query || item.title.toLowerCase().includes(query));
  });
  const visibleProducts = createMemo(() => {
    if (source() === 'custom') {
      const favs = favorites();
      const favIds = new Set(favs.map(item => String(item.id)));
      return [...favs, ...localCustomBacks().filter(item => !favIds.has(String(item.id)))];
    }
    if (page() !== 1) return products();
    const favs = favorites();
    const favIds = new Set(favs.map(item => String(item.id)));
    return [...favs, ...products().filter(item => !favIds.has(String(item.id)))];
  });

  const paginationNumbers = createMemo(() => buildPaginationNumbers(page(), lastPage()));

  let catalogRequestId = 0;

  async function loadPage(targetPage: number) {
    if (targetPage < 1) return;
    const requestId = ++catalogRequestId;
    setLoading(true);
    try {
      const result = await loadSourcePage(source(), searchQuery(), targetPage);
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
    setZoomed();
    setAdding(false);
    setSource(sourceOfCardBack(props.selected?.id));
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
    source();
    void loadPage(1);
  });

  createEffect(() => {
    if (!props.open) return;

    const previousScrollTarget = scrollTarget();
    setScrollTarget();

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || loading() || zoomed()) return;
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

  async function submitCustomCardBack(event: Event) {
    event.preventDefault();
    if (checkingCustom()) return;
    const url = parseCardBackUrl(customUrl());
    if (!url) {
      toast.error('Introduce una URL de imagen válida (http o https)');
      return;
    }
    const back = createCustomCardBack(url, customName());
    setCheckingCustom(true);
    const loads = await checkImageLoads(cardBackImageUrl(back.imageUrl, back.id));
    setCheckingCustom(false);
    if (!loads) {
      toast.error('No se pudo cargar la imagen de esa URL');
      return;
    }
    addCustomCardBack(back);
    // Signed in: also keep it in the account, so it's there on other devices.
    if (canFavorite() && !isAssetFavorite('card_back', back.id)) {
      void toggleAssetFavorite('card_back', back);
    }
    setCustomUrl('');
    setCustomName('');
    setAdding(false);
    setSearchInput('');
    setSource('custom');
    toast.success('Reverso custom añadido');
  }

  function deleteCustomCardBack(back: MpcfillCardBackProduct) {
    removeCustomCardBack(String(back.id));
    if (isAssetFavorite('card_back', back.id)) void toggleAssetFavorite('card_back', back);
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent
        portalClass={props.stackClass}
        overlayClass={props.stackClass}
        class={cn(
          'flex h-[96vh] w-[96vw] max-w-[min(96vw,1400px)] flex-col gap-3 overflow-hidden p-4 sm:p-5',
          props.stackClass,
        )}
        onWheel={stopWheelPropagation}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          // Escape closes the full-size view first, not the whole picker.
          if (!zoomed()) return;
          event.preventDefault();
          setZoomed();
        }}>
        <DialogHeader class='space-y-1 pr-8'>
          <DialogTitle>Elegir reverso de carta</DialogTitle>
          <DialogDescription class='truncate text-xs'>
            <Show
              when={source() !== 'custom'}
              fallback={
                <>
                  Reversos añadidos por URL.{' '}
                  {canFavorite()
                    ? 'Se guardan en tu cuenta.'
                    : 'Se guardan en este navegador; inicia sesión para tenerlos en todos tus dispositivos.'}
                </>
              }>
              <Show
                when={source() === 'hearthstone'}
                fallback={
                  <>
                    Catálogo de{' '}
                    <a
                      href={MPCFILL_EXPLORE_URL}
                      target='_blank'
                      rel='noopener noreferrer'
                      class='underline'>
                      MPC Autofill
                    </a>{' '}
                    (tipo Cardback).
                  </>
                }>
                Reversos de{' '}
                <a
                  href={HEARTHSTONE_CARD_BACKS_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                  class='underline'>
                  Hearthstone Wiki
                </a>
                . Resolución media (≈400×600): bien en mesa, algo blandos al imprimir.
              </Show>
            </Show>
          </DialogDescription>
        </DialogHeader>

        <div class='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div class='flex shrink-0 gap-2' role='tablist' aria-label='Origen de los reversos'>
            <For each={SOURCES}>
              {item => (
                <Button
                  type='button'
                  role='tab'
                  size='sm'
                  variant={source() === item.id ? 'default' : 'outline'}
                  aria-selected={source() === item.id}
                  onClick={() => setSource(item.id)}>
                  {item.label}
                </Button>
              )}
            </For>
            <Button
              type='button'
              size='sm'
              variant={adding() ? 'default' : 'outline'}
              class='px-2'
              aria-label='Añadir reverso custom por URL'
              title='Añadir reverso custom por URL'
              aria-expanded={adding()}
              onClick={() => setAdding(value => !value)}>
              <PlusIcon class='size-4' />
            </Button>
          </div>

          <TextField class='w-full sm:flex-1'>
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
        </div>

        <Show when={adding()}>
          <form
            class='flex flex-col gap-2 rounded-md border border-input p-3 sm:flex-row sm:items-center'
            onSubmit={event => void submitCustomCardBack(event)}>
            <TextField class='w-full sm:flex-[2]'>
              <TextFieldInput
                type='url'
                placeholder='URL de la imagen (https://…)'
                value={customUrl()}
                onInput={event => setCustomUrl(event.currentTarget.value)}
                aria-label='URL de la imagen del reverso'
                autofocus
              />
            </TextField>
            <TextField class='w-full sm:flex-1'>
              <TextFieldInput
                type='text'
                placeholder='Nombre (opcional)'
                value={customName()}
                onInput={event => setCustomName(event.currentTarget.value)}
                aria-label='Nombre del reverso'
              />
            </TextField>
            <div class='flex shrink-0 gap-2'>
              <Button type='submit' size='sm' disabled={checkingCustom() || !customUrl().trim()}>
                <Show when={checkingCustom()} fallback='Añadir'>
                  <LoaderIcon class='size-4 animate-spin' />
                </Show>
              </Button>
              <Button type='button' size='sm' variant='outline' onClick={() => setAdding(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Show>

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
              when={visibleProducts().length > 0}
              fallback={
                <p class='py-8 text-center text-sm text-muted-foreground'>
                  {isSearching()
                    ? 'Ningún reverso coincide con la búsqueda.'
                    : source() === 'custom'
                      ? 'Aún no hay reversos custom. Pulsa + para añadir uno por URL.'
                      : 'Sin resultados.'}
                </p>
              }>
              <ul class='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7'>
                <For each={visibleProducts()}>
                  {product => (
                    <li class='relative'>
                      <button
                        type='button'
                        class='group flex w-full flex-col overflow-hidden rounded-md border border-input text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        classList={{
                          'ring-2 ring-primary': props.selected?.id === product.id,
                        }}
                        onClick={() => selectProduct(product)}>
                        <div class='aspect-[5/7] w-full bg-muted'>
                          <img
                            src={cardBackImageUrl(product.previewUrl, String(product.id))}
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
                      <button
                        type='button'
                        class='absolute left-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow-md transition-colors hover:bg-black/75'
                        aria-label='Ver reverso a pantalla completa'
                        title='Ver a pantalla completa'
                        onClick={event => {
                          event.stopPropagation();
                          setZoomed(product);
                        }}>
                        <ZoomInIcon class='size-4' />
                      </button>
                      <Show when={canFavorite()}>
                        <FavoriteButton
                          class='right-2 top-2'
                          active={isAssetFavorite('card_back', product.id)}
                          addLabel='Guardar reverso como favorito'
                          removeLabel='Quitar reverso de favoritos'
                          onToggle={() => void toggleAssetFavorite('card_back', product)}
                        />
                      </Show>
                      <Show when={isCustomCardBackId(product.id)}>
                        <button
                          type='button'
                          class='absolute right-2 top-12 z-10 flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow-md transition-colors hover:bg-destructive'
                          aria-label='Borrar reverso custom'
                          title='Borrar reverso custom'
                          onClick={event => {
                            event.stopPropagation();
                            deleteCustomCardBack(product);
                          }}>
                          <Trash2Icon class='size-4' />
                        </button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>

        <DialogFooter class='flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-center'>
          <nav
            class='flex flex-wrap items-center justify-center gap-1'
            aria-label='Paginación del catálogo'>
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
        <Show when={zoomed()} keyed>
          {product => (
            <div
              class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/95 p-4 backdrop-blur-sm'
              role='dialog'
              aria-label={product.title}
              onClick={() => setZoomed()}>
              <button
                type='button'
                class='absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75'
                aria-label='Cerrar vista completa'
                onClick={() => setZoomed()}>
                <XIcon class='size-5' />
              </button>
              <div class='relative flex min-h-0 w-full flex-1 items-center justify-center'>
                {/* The preview shows at once and is swapped for the full image when it loads. */}
                <Show when={!fullLoaded()}>
                  <img
                    src={cardBackImageUrl(product.previewUrl, String(product.id))}
                    alt=''
                    class='h-full max-w-full object-contain blur-[1px]'
                  />
                  <LoaderIcon class='absolute size-8 animate-spin text-white drop-shadow' />
                </Show>
                <img
                  src={cardBackImageUrl(product.imageUrl, String(product.id))}
                  alt={product.title}
                  class='max-h-full max-w-full object-contain'
                  classList={{ hidden: !fullLoaded() }}
                  onLoad={() => setFullLoaded(true)}
                  onError={() => setFullLoaded(true)}
                  onClick={event => event.stopPropagation()}
                />
              </div>
              <div class='flex shrink-0 flex-wrap items-center justify-center gap-3'>
                <span class='text-sm font-medium'>{product.title}</span>
                <Show when={product.sourceName}>
                  <span class='text-xs text-muted-foreground'>{product.sourceName}</span>
                </Show>
                <Button
                  type='button'
                  size='sm'
                  onClick={event => {
                    event.stopPropagation();
                    setZoomed();
                    selectProduct(product);
                  }}>
                  Elegir este reverso
                </Button>
              </div>
            </div>
          )}
        </Show>
      </DialogContent>
    </Dialog>
  );
};

export default CardBackPickerModal;

import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { Command, CommandInput } from '~/components/ui/command';
import { Dialog, DialogContent } from '~/components/ui/dialog';
import { cn } from '~/lib/utils';
import { Card } from '../constants';
import {
  cardSystem,
  doAfter,
  doXTimes,
  getLocalPlayArea,
  getLocalPlayerClientId,
  hoverSignal,
  peekFilterText,
  peekTypeFilter,
  setCardSearchModalData,
  setHoverSignal,
  setPeekFilterText,
  setPeekTypeFilter,
} from '../globals';
import { transferCard } from '../transferCard';
import { getCardImage } from '../card';
import { spawnTokenOnBattlefield } from '../playArea';
import { logDeckDrawChoice, logDeckDrawTop } from '../shortcuts/commands/deck';
import { supportsCardPrintings } from '../deck';
import { playDrawSound } from '../sounds';
import {
  fetchSpanishPrintingImageUrl,
  SPANISH_PREVIEW_NOT_FOUND_MESSAGE,
} from '../spanishCardPreview';
import useCardGrouping, { getCardTypeCategory } from './deckEditor/cardGroupings';
import {
  entryMatchesSubtypeFilter,
  getSubtypeOptionsForPeek,
} from './deckEditor/cardSubtypes';
import SubtypeFilter from './deckEditor/subtypeFilter';
import LoaderIcon from 'lucide-solid/icons/loader-circle';

type ModalSpanishPreviewState =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string }
  | { phase: 'not-found' };

interface CardSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: Card[];
  title?: string;
  zone: 'peek' | 'graveyard' | 'exile' | 'tokenSearch';
  deckViewMode?: 'peek' | 'search';
  readOnly?: boolean;
}

export const CardSearchModal: Component<CardSearchModalProps> = props => {
  const playArea = () => getLocalPlayArea();
  const [selectedCard, setSelectedCard] = createSignal<Card | null>(null);
  const [viewMode, setViewMode] = createSignal<'grid' | 'list'>('grid');
  const [hoveredCard, setHoveredCard] = createSignal<Card | null>(null);
  const [flippedCardIds, setFlippedCardIds] = createSignal<Set<string>>(new Set());
  const [spanishPreviewByCardId, setSpanishPreviewByCardId] = createSignal<
    Record<string, ModalSpanishPreviewState>
  >({});
  const [contextMenuCard, setContextMenuCard] = createSignal<Card | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = createSignal<{ x: number; y: number } | null>(null);
  const [activeSubtypes, setActiveSubtypes] = createSignal<string[]>([]);
  const [cardsPerRow, setCardsPerRow] = createSignal(
    parseInt(localStorage.getItem('cardSearchModal_cardsPerRow') || '5', 10)
  );
  let inputRef: HTMLInputElement;
  let modalContentRef: HTMLDivElement;
  let contextMenuRef: HTMLDivElement | undefined;
  let blockCardInteractionUntil = 0;
  let blockDrawUntil = 0;
  let mouseDownCardId: string | null = null;

  // Crear una lista de cartas reactiva que se actualiza cuando se roban cartas
  const [localCards, setLocalCards] = createSignal<Card[]>(props.cards);
  
  createEffect(() => {
    setLocalCards(props.cards);
  });

  const cardGrouping = useCardGrouping(cardSystem.types ?? [], localCards);

  // Guardar cardsPerRow en localStorage cuando cambia
  createEffect(() => {
    const value = cardsPerRow();
    if (value >= 1 && value <= 10) {
      localStorage.setItem('cardSearchModal_cardsPerRow', value.toString());
    }
  });

  // Cerrar focus camera al abrir el modal
  createEffect(() => {
    if (props.open) {
      setHoverSignal();

      if (props.zone === 'tokenSearch') {
        setPeekFilterText('');
        setPeekTypeFilter(null);
      }
      
      // Limpiar cualquier búsqueda 3D antigua
      const area = playArea();
      if (area) {
        // Si hay cartas en peekZone 3D, dismissarlo
        if (area.peekZone.cards.length > 0) {
          void area.dismissFromZone(area.peekZone);
        }
        // Si hay cartas en tokenSearchZone 3D, dismissarlo
        if (area.tokenSearchZone.cards.length > 0) {
          void area.dismissFromZone(area.tokenSearchZone);
        }
      }
    }
  });

  createEffect(() => {
    peekTypeFilter();
    setActiveSubtypes([]);
  });

  const subtypeOptions = createMemo(() => {
    if (props.zone !== 'peek') return [];
    return getSubtypeOptionsForPeek(peekTypeFilter(), localCards());
  });

  const filteredCards = createMemo(() => {
    let candidates = localCards();

    const typeFilter = peekTypeFilter();
    if (typeFilter) {
      const lowerTypes = (cardSystem.types ?? []).map(type => type.toLowerCase());
      candidates = candidates.filter(card => {
        if (typeFilter === 'unsorted') {
          return !getCardTypeCategory(card, lowerTypes);
        }
        return getCardTypeCategory(card, lowerTypes) === typeFilter;
      });
    }

    if (props.zone === 'peek' && activeSubtypes().length) {
      candidates = candidates.filter(card => entryMatchesSubtypeFilter(card, activeSubtypes()));
    }

    const filterText = peekFilterText().toLowerCase();
    const filters = filterText
      .split(',')
      .map(filter => filter.trim())
      .filter(Boolean);

    if (filters.length) {
      const haystack = (card: Card) =>
        `${card.detail.name} ${card.detail.type_line} ${card.detail.oracle_text}`.toLowerCase();
      candidates = candidates.filter(card =>
        filters.every(filter => haystack(card).includes(filter)),
      );
    }

    if (props.deckViewMode === 'search') {
      candidates = [...candidates].sort((a, b) =>
        a.detail.name.localeCompare(b.detail.name, undefined, { sensitivity: 'base' }),
      );
    }

    return candidates;
  });

  function handleCardMouseDown(card: Card, e: MouseEvent) {
    if (e.button !== 0) return; // Solo click izquierdo
    mouseDownCardId = card.id;
  }

  function handleCardClick(card: Card, e: MouseEvent) {
    // Solo ejecutar si el mousedown fue en la misma carta
    if (mouseDownCardId !== card.id) {
      mouseDownCardId = null;
      return;
    }
    mouseDownCardId = null;

    if (isDrawBlocked()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    drawWithoutRevealing(card);
  }

  function isDrawBlocked() {
    return performance.now() < blockDrawUntil;
  }

  function blockDraw(durationMs = 500) {
    blockDrawUntil = performance.now() + durationMs;
  }

  function isCardInteractionBlocked() {
    return performance.now() < blockCardInteractionUntil;
  }

  function blockCardInteraction(durationMs = 500) {
    blockCardInteractionUntil = performance.now() + durationMs;
  }

  function isCardFlipped(cardId: string) {
    return flippedCardIds().has(cardId);
  }

  function toggleCardFlip(card: Card) {
    setFlippedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(card.id)) {
        next.delete(card.id);
      } else {
        next.add(card.id);
      }
      return next;
    });
  }

  function getSpanishPreviewState(cardId: string) {
    return spanishPreviewByCardId()[cardId];
  }

  function clearModalSpanishPreview(cardId: string) {
    setSpanishPreviewByCardId(prev => {
      if (!prev[cardId]) return prev;
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
  }

  async function toggleModalSpanishPreview(card: Card) {
    if (!supportsCardPrintings() || !card.detail?.name) return;

    const current = getSpanishPreviewState(card.id);
    if (current?.phase === 'loading') return;

    if (current?.phase === 'ready' || current?.phase === 'not-found') {
      clearModalSpanishPreview(card.id);
      return;
    }

    setSpanishPreviewByCardId(prev => ({ ...prev, [card.id]: { phase: 'loading' } }));

    const url = await fetchSpanishPrintingImageUrl(card);
    setSpanishPreviewByCardId(prev => ({
      ...prev,
      [card.id]: url ? { phase: 'ready', url } : { phase: 'not-found' },
    }));
  }

  function clearModalSpanishPreviews() {
    setSpanishPreviewByCardId({});
  }

  function handleFlipCard(card: Card) {
    mouseDownCardId = null;
    blockDraw(500);
    blockCardInteraction(500);
    toggleCardFlip(card);
    setHoveredCard(card);
    closeContextMenu();
  }

  function handleCardContextMenu(card: Card, e: MouseEvent) {
    if (props.readOnly) return;

    e.preventDefault();
    e.stopPropagation();
    mouseDownCardId = null;
    blockCardInteraction();

    const menuWidth = 128;
    const menuHeight = 300;
    const bounds = modalContentRef?.getBoundingClientRect();
    if (!bounds) return;

    let x = e.clientX - bounds.left;
    let y = e.clientY - bounds.top;

    if (x + menuWidth > bounds.width) {
      x = bounds.width - menuWidth - 8;
    }
    if (y + menuHeight > bounds.height) {
      y = bounds.height - menuHeight - 8;
    }
    if (x < 8) x = 8;
    if (y < 8) y = 8;

    setContextMenuCard(card);
    setContextMenuPosition({ x, y });
  }

  function closeContextMenu() {
    setContextMenuCard(null);
    setContextMenuPosition(null);
  }

  function handleContextMenuAction(e: MouseEvent, action: () => void) {
    e.preventDefault();
    e.stopPropagation();
    mouseDownCardId = null;
    blockCardInteraction();
    action();
    closeContextMenu();
  }

  function handleDrawFromMenu(e: MouseEvent, card: Card) {
    e.preventDefault();
    e.stopPropagation();
    mouseDownCardId = null;
    blockCardInteraction();
    drawWithoutRevealing(card, { force: true });
    closeContextMenu();
  }

  function moveCardToZone(card: Card, zoneName: string) {
    const area = playArea();
    if (!area) return;

    if (props.zone === 'tokenSearch' && zoneName === 'battlefield') {
      spawnTokenOnBattlefield(area, card);
      playDrawSound();
      setLocalCards(prev => prev.filter(c => c.id !== card.id));
      closeContextMenu();
      return;
    }

    // Determinar la zona de origen
    let fromZone = getZone();
    if (!fromZone) return;

    // Determinar la zona de destino
    let toZone;
    switch (zoneName) {
      case 'hand':
        toZone = area.hand;
        break;
      case 'graveyard':
        toZone = area.graveyardZone;
        break;
      case 'exile':
        toZone = area.exileZone;
        break;
      case 'battlefield':
        toZone = area.battlefieldZone;
        break;
      case 'deck-top':
        toZone = area.deck;
        break;
      case 'deck-bottom':
        toZone = area.deck;
        break;
      default:
        return;
    }

    if (zoneName === 'deck-bottom') {
      transferCard(card, fromZone, toZone, { addOptions: { location: 'bottom' } });
    } else {
      transferCard(card, fromZone, toZone);
    }

    setLocalCards(prev => prev.filter(c => c.id !== card.id));
    closeContextMenu();
  }

  function drawWithoutRevealing(card: Card, options?: { force?: boolean }) {
    if (!options?.force && isDrawBlocked()) return;

    const area = playArea();
    if (!area) return;
    
    // Si es un token, lo clonamos al campo de batalla en lugar de moverlo a la mano
    if (props.zone === 'tokenSearch') {
      spawnTokenOnBattlefield(area, card);
      playDrawSound();
      return;
    }
    
    // Para cartas normales, determinar la zona de origen
    let fromZone;
    
    // Primero verificar si la carta está en alguna de las zonas conocidas
    if (area.graveyardZone.cards.some(c => c.id === card.id)) {
      fromZone = area.graveyardZone;
    } else if (area.exileZone.cards.some(c => c.id === card.id)) {
      fromZone = area.exileZone;
    } else if (area.peekZone.cards.some(c => c.id === card.id)) {
      fromZone = area.peekZone;
    } else if (area.deck.cards.some(c => c.id === card.id)) {
      fromZone = area.deck;
    } else if (area.tokenSearchZone.cards.some(c => c.id === card.id)) {
      fromZone = area.tokenSearchZone;
    } else {
      // Si no está en ninguna zona conocida, usar la zona por defecto según props
      fromZone =
        props.zone === 'graveyard'
          ? area.graveyardZone
          : props.zone === 'exile'
            ? area.exileZone
            : props.zone === 'peek'
              ? area.deck
              : area.deck;
    }
    
    if (fromZone === area.deck) {
      const deckIndex = area.deck.cards.findIndex(entry => entry.id === card.id);
      if (props.zone === 'peek' && deckIndex >= 0) {
        logDeckDrawChoice(card.detail.name, deckIndex + 1);
      } else {
        logDeckDrawTop();
      }
    }

    transferCard(card, fromZone, area.hand);
    playDrawSound();
    
    // Actualizar la lista local eliminando la carta
    setLocalCards(prev => prev.filter(c => c.id !== card.id));
  }

  function dismissModal() {
    setPeekFilterText('');
    setPeekTypeFilter(null);
    setSelectedCard(null);
    
    const area = playArea();
    if (!area) return;
    
    // Limpiar tanto el peekZone 3D como el modal 2D
    if (props.zone === 'peek') {
      if (area.peekZone.cards.length > 0) {
        void area.dismissFromZone(area.peekZone);
      }
    }
    
    if (props.zone === 'tokenSearch') {
      if (area.tokenSearchZone.cards.length > 0) {
        void area.dismissFromZone(area.tokenSearchZone);
      }
    }
    
    // Limpiar los datos del modal y cerrarlo
    setCardSearchModalData(null);
    props.onOpenChange(false);
  }

  createEffect(() => {
    if (props.open && inputRef) {
      setTimeout(() => inputRef?.focus(), 100);
    }
  });

  createEffect(() => {
    if (!props.open) {
      setHoveredCard(null);
      setFlippedCardIds(new Set());
      clearModalSpanishPreviews();
      setActiveSubtypes([]);
    }
  });

  onCleanup(() => {
    setPeekFilterText('');
    setPeekTypeFilter(null);
    setActiveSubtypes([]);
    setHoveredCard(null);
    setFlippedCardIds(new Set());
    clearModalSpanishPreviews();
  });

  const getCurrentCardImage = (card: Card) => {
    if (isCardFlipped(card.id) && card.detail?.card_faces && card.detail.card_faces.length >= 2) {
      const backFace = card.detail.card_faces[1];
      if (backFace?.image_uris?.normal || backFace?.image_uris?.large) {
        return backFace.image_uris.large || backFace.image_uris.normal;
      }
    }

    const spanishPreview = getSpanishPreviewState(card.id);
    if (spanishPreview?.phase === 'ready') {
      return spanishPreview.url;
    }

    return getCardImage(card);
  };

  const getModalTitle = () => {
    if (props.title) return props.title;
    
    switch (props.zone) {
      case 'peek':
        if (props.deckViewMode === 'peek') {
          return `Peek (${filteredCards().length}/${localCards().length})`;
        }
        return `Search Deck (${filteredCards().length}/${localCards().length})`;
      case 'graveyard':
        return `Search Graveyard (${filteredCards().length}/${localCards().length})`;
      case 'exile':
        return `Search Exile (${filteredCards().length}/${localCards().length})`;
      case 'tokenSearch':
        return `Search Token (${filteredCards().length}/${localCards().length})`;
      default:
        return `Search Cards (${filteredCards().length}/${localCards().length})`;
    }
  };

  const getZone = () => {
    const area = playArea();
    if (!area) return null;
    
    if (props.zone === 'peek') {
      // Si hay cartas en peekZone, usar esa zona; si no, usar el deck
      return area.peekZone.cards.length > 0 ? area.peekZone : area.deck;
    }
    
    if (props.zone === 'tokenSearch') {
      return area.tokenSearchZone;
    }
    
    return props.zone === 'graveyard' ? area.graveyardZone : area.exileZone;
  };

  // Manejo de tecla ESC a nivel de documento
  createEffect(() => {
    if (!props.open) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (contextMenuCard()) {
          closeContextMenu();
        } else {
          dismissModal();
        }
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      // Tecla F para voltear la carta en hover
      if (e.key.toLowerCase() === 'f' && hoveredCard()) {
        const card = hoveredCard();
        if (card?.detail?.card_faces && card.detail.card_faces.length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          toggleCardFlip(card);
        }
        return;
      }

      if (
        e.key.toLowerCase() === 't' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        hoveredCard()
      ) {
        const card = hoveredCard();
        if (!card || !supportsCardPrintings()) return;
        e.preventDefault();
        e.stopPropagation();
        void toggleModalSpanishPreview(card);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown, true);
    
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown, true);
    });
  });

  return (
    <Dialog open={props.open} onOpenChange={dismissModal}>
      <DialogContent
        class='max-w-[90vw] h-[95vh] overflow-hidden flex flex-col p-0'
        hideClose
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            dismissModal();
          }
        }}>
        <div ref={modalContentRef} class='relative flex flex-col h-full'>
          {/* Header con búsqueda y filtros */}
            <div class='sticky top-0 z-20 overflow-visible bg-background border-b p-4 space-y-3'>
            {/* Título */}
            <div class='flex items-center justify-between'>
              <h2 class='text-lg font-semibold'>
                {getModalTitle()}
              </h2>
              <button
                type='button'
                class='rounded px-3 py-1.5 text-sm transition-colors border border-border hover:bg-accent'
                onClick={dismissModal}>
                Close (ESC)
              </button>
            </div>

            {/* Filtros por tipo */}
            <div class='flex flex-wrap gap-2'>
              <button
                type='button'
                class={cn(
                  'rounded px-2 py-1 text-sm transition-colors hover:bg-accent',
                  !peekTypeFilter() && 'bg-accent font-semibold',
                )}
                onClick={() => setPeekTypeFilter(null)}>
                {cardGrouping().totalCount} All
              </button>
              <For each={Object.entries(cardGrouping().types)}>
                {([type, grouping]) => (
                  <Show when={grouping.count > 0}>
                    <button
                      type='button'
                      class={cn(
                        'flex gap-1 border-l-2 border-border px-2 py-1 text-sm transition-colors hover:bg-accent',
                        peekTypeFilter() === type && 'bg-accent font-semibold',
                      )}
                      onClick={() =>
                        setPeekTypeFilter(current => (current === type ? null : type))
                      }>
                      <span>{grouping.name}</span>
                      <span>{grouping.count}</span>
                    </button>
                  </Show>
                )}
              </For>
              <Show when={cardGrouping().unsorted.count > 0}>
                <button
                  type='button'
                  class={cn(
                    'flex gap-1 border-l-2 border-border px-2 py-1 text-sm transition-colors hover:bg-accent',
                    peekTypeFilter() === 'unsorted' && 'bg-accent font-semibold',
                  )}
                  onClick={() =>
                    setPeekTypeFilter(current => (current === 'unsorted' ? null : 'unsorted'))
                  }>
                  <span>Unsorted</span>
                  <span>{cardGrouping().unsorted.count}</span>
                </button>
              </Show>
            </div>

            {/* Barra de búsqueda con botones de vista */}
            <div class='flex items-center gap-2 overflow-visible'>
              <Command
                class='flex-1'
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    dismissModal();
                  }
                }}>
                <CommandInput
                  ref={inputRef!}
                  placeholder='Search by name, type, or text...'
                  value={peekFilterText()}
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                      e.preventDefault();
                      e.stopPropagation();
                      (e.currentTarget as HTMLInputElement).select();
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      dismissModal();
                    }
                  }}
                  onValueChange={value => {
                    setPeekFilterText(value);
                  }}
                />
              </Command>
              <Show when={props.zone === 'peek' && subtypeOptions().length > 0}>
                <SubtypeFilter
                  options={subtypeOptions()}
                  value={activeSubtypes()}
                  onChange={setActiveSubtypes}
                  inlineMenu
                />
              </Show>
              <div class='flex items-center gap-2'>
                <input
                  type='number'
                  min='1'
                  max='10'
                  value={cardsPerRow()}
                  onInput={e => {
                    const value = parseInt(e.currentTarget.value, 10);
                    if (value >= 1 && value <= 10) {
                      setCardsPerRow(value);
                    }
                  }}
                  onWheel={e => e.preventDefault()}
                  onMouseDown={e => {
                    // Prevenir selección al hacer click
                    const target = e.currentTarget;
                    setTimeout(() => target.blur(), 0);
                  }}
                  class='w-14 rounded border border-border bg-background px-2 py-1.5 text-sm text-center'
                  title='Cards per row'
                />
                <button
                  type='button'
                  class={cn(
                    'rounded px-3 py-1.5 text-sm transition-colors border whitespace-nowrap',
                    viewMode() === 'grid' ? 'bg-accent border-accent-foreground' : 'border-border hover:bg-accent',
                  )}
                  onClick={() => setViewMode('grid')}>
                  Grid
                </button>
                <button
                  type='button'
                  class={cn(
                    'rounded px-3 py-1.5 text-sm transition-colors border whitespace-nowrap',
                    viewMode() === 'list' ? 'bg-accent border-accent-foreground' : 'border-border hover:bg-accent',
                  )}
                  onClick={() => setViewMode('list')}>
                  List
                </button>
              </div>
            </div>
          </div>

          {/* Grid de cartas con scroll */}
          <div class='flex-1 overflow-y-auto p-4'>
            <Show
              when={filteredCards().length > 0}
              fallback={
                <div class='flex items-center justify-center h-full text-muted-foreground'>
                  No cards found
                </div>
              }>
              <Switch>
                <Match when={viewMode() === 'grid'}>
                  <div 
                    class='grid gap-3'
                    style={{
                      'grid-template-columns': `repeat(${cardsPerRow()}, minmax(0, 1fr))`
                    }}>
                    <For each={filteredCards()}>
                      {card => {
                        const hasDoubleFace = () => card.detail?.card_faces && card.detail.card_faces.length >= 2;
                        return (
                          <div
                            class='group relative aspect-[2.5/3.5] cursor-pointer overflow-hidden rounded-lg border-2 border-transparent transition-all hover:border-primary hover:scale-105 hover:shadow-lg'
                            onMouseDown={(e) => handleCardMouseDown(card, e)}
                            onClick={(e) => handleCardClick(card, e)}
                            onPointerDown={e => {
                              if (isDrawBlocked() || isCardInteractionBlocked()) {
                                e.preventDefault();
                                e.stopPropagation();
                              }
                            }}
                            onContextMenu={(e) => handleCardContextMenu(card, e)}
                            onMouseEnter={() => setHoveredCard(card)}
                            onMouseLeave={() => setHoveredCard(null)}>
                            <img
                              src={getCurrentCardImage(card)}
                              alt={card.detail.name}
                              class='w-full h-full object-cover'
                              loading='lazy'
                            />
                            <Show when={getSpanishPreviewState(card.id)?.phase === 'loading'}>
                              <div class='absolute inset-0 flex items-center justify-center bg-black/50'>
                                <LoaderIcon class='size-8 animate-spin text-white' />
                              </div>
                            </Show>
                            <Show when={getSpanishPreviewState(card.id)?.phase === 'not-found'}>
                              <div class='absolute inset-0 flex items-center justify-center bg-black/60 p-2'>
                                <p class='text-xs text-white text-center'>
                                  {SPANISH_PREVIEW_NOT_FOUND_MESSAGE}
                                </p>
                              </div>
                            </Show>
                            <div class='absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                              <p class='text-xs text-white font-semibold truncate'>
                                {card.detail.name}
                              </p>
                              <Show when={hasDoubleFace()}>
                                <p class='text-xs text-white/80 mt-0.5'>
                                  Press F to flip card
                                </p>
                              </Show>
                              <Show when={supportsCardPrintings()}>
                                <p class='text-xs text-white/80 mt-0.5'>Press T for Spanish</p>
                              </Show>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Match>
                <Match when={viewMode() === 'list'}>
                  <div class='space-y-2'>
                    <For each={filteredCards()}>
                      {card => {
                        const hasDoubleFace = () => card.detail?.card_faces && card.detail.card_faces.length >= 2;
                        return (
                          <div
                            class='group flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-all hover:border-primary hover:bg-accent'
                            onMouseDown={(e) => handleCardMouseDown(card, e)}
                            onClick={(e) => handleCardClick(card, e)}
                            onPointerDown={e => {
                              if (isDrawBlocked() || isCardInteractionBlocked()) {
                                e.preventDefault();
                                e.stopPropagation();
                              }
                            }}
                            onContextMenu={(e) => handleCardContextMenu(card, e)}
                            onMouseEnter={() => setHoveredCard(card)}
                            onMouseLeave={() => setHoveredCard(null)}>
                            <div class='relative shrink-0'>
                              <img
                                src={getCurrentCardImage(card)}
                                alt={card.detail.name}
                                class='w-16 h-22 object-cover rounded'
                                loading='lazy'
                              />
                              <Show when={getSpanishPreviewState(card.id)?.phase === 'loading'}>
                                <div class='absolute inset-0 flex items-center justify-center rounded bg-black/50'>
                                  <LoaderIcon class='size-5 animate-spin text-white' />
                                </div>
                              </Show>
                              <Show when={getSpanishPreviewState(card.id)?.phase === 'not-found'}>
                                <div class='absolute inset-0 flex items-center justify-center rounded bg-black/60 p-1'>
                                  <p class='text-[10px] text-white text-center leading-tight'>
                                    {SPANISH_PREVIEW_NOT_FOUND_MESSAGE}
                                  </p>
                                </div>
                              </Show>
                            </div>
                            <div class='flex-1 min-w-0'>
                              <div class='flex items-baseline gap-2'>
                                <p class='font-semibold truncate'>{card.detail.name}</p>
                                <Show when={hasDoubleFace()}>
                                  <p class='text-xs text-muted-foreground whitespace-nowrap'>
                                    (Press F to flip)
                                  </p>
                                </Show>
                                <Show when={supportsCardPrintings()}>
                                  <p class='text-xs text-muted-foreground whitespace-nowrap'>
                                    (Press T for Spanish)
                                  </p>
                                </Show>
                              </div>
                              <p class='text-sm text-muted-foreground truncate'>
                                {card.detail.type_line}
                              </p>
                              <Show when={card.detail.oracle_text}>
                                <p class='text-xs text-muted-foreground line-clamp-2 mt-1'>
                                  {card.detail.oracle_text}
                                </p>
                              </Show>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Match>
              </Switch>
            </Show>
          </div>
          <Show when={contextMenuCard() && contextMenuPosition()}>
            {() => {
              const card = contextMenuCard()!;
              const pos = contextMenuPosition()!;
              const hasDoubleFace = card.detail?.card_faces && card.detail.card_faces.length >= 2;
              return (
                <>
                  <div
                    class='absolute inset-0 z-[100]'
                    onClick={closeContextMenu}
                    onContextMenu={e => {
                      e.preventDefault();
                      closeContextMenu();
                    }}
                  />
                  <div
                    ref={contextMenuRef}
                    class='absolute z-[101] w-32 rounded-md border border-border bg-popover py-1 shadow-lg pointer-events-auto'
                    style={{
                      left: `${pos.x}px`,
                      top: `${pos.y}px`,
                    }}
                    onClick={e => e.stopPropagation()}
                    onContextMenu={e => e.preventDefault()}>
                    <button
                      type='button'
                      class='w-full px-2 py-1.5 text-sm text-left transition-colors hover:bg-accent'
                      onClick={e => handleDrawFromMenu(e, card)}>
                      Draw
                    </button>
                    <Show when={hasDoubleFace}>
                      <button
                        type='button'
                        class='w-full px-2 py-1.5 text-sm text-left transition-colors hover:bg-accent'
                        onClick={e =>
                          handleContextMenuAction(e, () => handleFlipCard(card))
                        }>
                        Flip card
                      </button>
                    </Show>
                    <div class='my-1 border-t border-border' />
                    <div class='px-2 py-1 text-xs font-semibold text-muted-foreground'>Move to</div>
                    <button
                      type='button'
                      class='w-full px-2 py-1.5 text-sm text-left transition-colors hover:bg-accent'
                      onClick={e =>
                        handleContextMenuAction(e, () => moveCardToZone(card, 'battlefield'))
                      }>
                      Battlefield
                    </button>
                    <button
                      type='button'
                      class='w-full px-2 py-1.5 text-sm text-left transition-colors hover:bg-accent'
                      onClick={e =>
                        handleContextMenuAction(e, () => moveCardToZone(card, 'graveyard'))
                      }>
                      Graveyard
                    </button>
                    <button
                      type='button'
                      class='w-full px-2 py-1.5 text-sm text-left transition-colors hover:bg-accent'
                      onClick={e =>
                        handleContextMenuAction(e, () => moveCardToZone(card, 'exile'))
                      }>
                      Exile
                    </button>
                    <button
                      type='button'
                      class='w-full px-2 py-1.5 text-sm text-left transition-colors hover:bg-accent'
                      onClick={e =>
                        handleContextMenuAction(e, () => moveCardToZone(card, 'deck-top'))
                      }>
                      Deck (top)
                    </button>
                    <button
                      type='button'
                      class='w-full px-2 py-1.5 text-sm text-left transition-colors hover:bg-accent'
                      onClick={e =>
                        handleContextMenuAction(e, () => moveCardToZone(card, 'deck-bottom'))
                      }>
                      Deck (bottom)
                    </button>
                  </div>
                </>
              );
            }}
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CardSearchModal;

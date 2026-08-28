import { nanoid } from 'nanoid';
import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Button } from '~/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxControl,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemLabel,
  ComboboxTrigger,
} from '~/components/ui/combobox';
import {
  labelVariants,
  TextField,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field';
import { getCardImage } from '../card';
import { DetailedCardEntry, Deck, FORMATS, CardSystem } from '../constants';
import {
  CardPrintingOption,
  fetchCardInfo,
  getPrintingPreviewUrl,
  populateCardInfo,
  prefetchCardPrintings,
  supportsCardPrintings,
} from '../deck';
import { cardSystem, colorHashDark } from '../globals';
import { cn } from '../utils';
import styles from './deckEditor.module.css';
import CardList from './deckEditor/cardList';
import DeckGridCard from './deckEditor/deckGridCard';
import PrintingPickerModal from './deckEditor/printingPickerModal';
import random from 'lodash-es/random';
import { Command, CommandInput } from '~/components/ui/command';
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group';
import { capitalize, debounce } from 'lodash-es';
import { createStore, reconcile, SetStoreFunction, unwrap } from 'solid-js/store';
import { getCardKey, hydrateDeck, serializeDeck } from '../deckStore';
import { useCardSystemContext } from '../cardSystemContext';
import AddIcon from 'lucide-solid/icons/plus';
import SubIcon from 'lucide-solid/icons/minus';
import SearchIcon from 'lucide-solid/icons/search';
import { useSearchParams } from '@solidjs/router';
import { trackDeep } from '@solid-primitives/deep';
import DownloadIcon from 'lucide-solid/icons/download';
import {
  Select,
  SelectContent,
  SelectHiddenSelect,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Portal } from 'solid-js/web';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { toast } from 'solid-sonner';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { AlertDialog, AlertDialogContent } from '~/components/ui/alert-dialog';
import intersectionObserver from '../intersectionObserver';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import DeckImportDialog from './deckEditor/deckImportDialog';
import useCardGrouping, { getSimpleType } from './deckEditor/cardGroupings';
import OverflowMenuIcon from 'lucide-solid/icons/ellipsis';
import DeleteIcon from 'lucide-solid/icons/trash-2';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

interface Props {
  onClose(): void;
  onChange(deck: Deck): void;
  onDelete(): void;
  deck: Deck;
}

export const DeckEditor: Component<Props> = props => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchResults, setSearchResults] = createSignal();
  const [cardSystemStore, { setCardSystem }] = useCardSystemContext();
  const [isDirty, setIsDirty] = createSignal(false);
  const [printingPickerKey, setPrintingPickerKey] = createSignal<string>();
  const [importDialogOpen, setImportDialogOpen] = createSignal(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [typeFilter, setTypeFilter] = createSignal<string | null>(null);
  let formRef: HTMLFormElement;

  const [deck, setDeck] = createStore<Deck>(
    props.deck?.name ? unwrap(props.deck) : { cards: {}, inPlay: {} },
  );

  const getDeckList = createMemo(() => {
    trackDeep(deck.cards);
    return Object.values(deck?.cards || {});
  });

  const deckCardKeys = createMemo(() => Object.keys(deck.cards ?? {}));

  const getInPlayList = createMemo(() => {
    trackDeep(deck.inPlay);
    return Object.values(deck?.inPlay || {});
  });

  onMount(async () => {
    if (deck.system) {
      await setCardSystem(deck.system);
      await rehydrateDeck(deck);
    }
  });

  createEffect(
    on(
      () => deck.system,
      () => {
        rehydrateDeck(unwrap(deck));
        setTypeFilter(null);
        setSearchParams({ q: undefined, type: undefined }, { replace: true });
      },
    ),
  );

  let hydrationCount = 0;
  async function rehydrateDeck(deck: Deck) {
    let currentHydration = ++hydrationCount;
    return hydrateDeck(structuredClone(unwrap(deck))).then(deck => {
      // ignore old hydrations (if the card system toggle changing fast)
      if (hydrationCount !== currentHydration) return;
      setDeck(deck);
    });
  }

  function closeCurrentDialog() {
    setSearchParams({ dialog: undefined, src: undefined }, { replace: true });
  }

  function openImportDialog() {
    setImportDialogOpen(true);
  }

  function closeImportDialog() {
    setImportDialogOpen(false);
  }

  function closeDeleteDialog() {
    setDeleteDialogOpen(false);
  }

  function openDeleteDialog() {
    setDeleteDialogOpen(true);
  }

  const updateDeck: SetStoreFunction<Deck> = (...params: any[]) => {
    (setDeck as any)(...params);
    setIsDirty(true);
  };

  function withPrintingImages(
    entry: DetailedCardEntry,
    printing: CardPrintingOption,
  ): DetailedCardEntry {
    if (getCardImage(entry) || !getPrintingPreviewUrl(printing)) return entry;

    return {
      ...entry,
      detail: {
        ...entry.detail,
        image_uris: printing.image_uris ?? entry.detail?.image_uris,
        card_faces: printing.card_faces ?? entry.detail?.card_faces,
      },
    };
  }

  async function changeCardPrinting(storageKey: string, printing: CardPrintingOption) {
    const previous = deck.cards[storageKey];
    if (!previous) return;

    const qty = previous.qty;
    let updated = await fetchCardInfo({
      name: previous.name,
      id: printing.id,
      set: printing.set,
      qty,
      categories: previous.categories ?? [],
    }).catch(() => undefined);

    if (!updated?.id) {
      updated = withPrintingImages(
        {
          ...previous,
          id: printing.id,
          set: printing.set ?? previous.set,
        },
        printing,
      );
    } else {
      updated = withPrintingImages(updated, printing);
    }

    if (!updated?.id) return;

    const nextEntry = {
      ...updated,
      qty,
      categories: previous.categories ?? updated.categories ?? [],
    };
    updateDeck('cards', storageKey, nextEntry);

    if (deck.inPlay?.[previous.name]?.id === previous.id) {
      updateDeck('inPlay', previous.name, nextEntry);
    }
  }

  function openPrintingPicker(storageKey: string) {
    if (!supportsCardPrintings() || !(deck.cards[storageKey]?.qty > 0)) return;
    const entry = deck.cards[storageKey];
    if (entry?.name) prefetchCardPrintings(entry.name);
    setPrintingPickerKey(storageKey);
  }

  function handlePrintingContextMenu(event: MouseEvent, storageKey: string) {
    if (!supportsCardPrintings() || !(deck.cards[storageKey]?.qty > 0)) return;
    event.preventDefault();
    event.stopPropagation();
    openPrintingPicker(storageKey);
  }

  let isEditing = () => !!props?.deck?.id;

  onMount(() => {
    if (!isEditing()) {
      openImportDialog();
    }
  });

  onMount(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    onCleanup(() => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    });
  });

  function onSaveDeck(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    for (let [field, value] of formData.entries()) {
      if (field === 'startingLife') value = parseInt(value);
      setDeck(field, value);
    }

    const serializedDeck = serializeDeck(unwrap(deck));

    props.onChange(serializedDeck);
    props.onClose();
    e.currentTarget.reset();
  }

  onCleanup(() => {
    setSearchParams(
      {
        page: undefined,
        totalPages: undefined,
        dialog: undefined,
        src: undefined,
        q: undefined,
        type: undefined,
      },
      { replace: true },
    );
  });

  function getSearchString(systemId: string, params: URLSearchParams) {
    return [systemId, params.get('q'), params.getAll('type').sort()].join(':');
  }

  async function loadMoreResults(entry: IntersectionObserverEntry) {
    const q = (unwrap(searchParams.q) ?? '') as string;
    const t = unwrap(searchParams.type);
    const page = unwrap(searchParams.page) as string;
    const totalPages = unwrap(searchParams.totalPages) as string;
    if (!q?.length && !t?.length) return;
    if (!page?.length) return;

    if (totalPages && parseInt(page) >= parseInt(totalPages)) {
      return;
    }

    debouncedOnSearch(q, t, parseInt(page) + 1);
  }

  let lastSearchString: string | undefined;
  let cancelSearch = false;

  function onSearch(q?: string, t?: string | string[], page?: number) {
    if (cancelSearch) return;
    const url = new URL(cardSystem.cardSearchEndpoint);

    if (q) {
      url.searchParams.set('q', q);
    }

    if (Array.isArray(t)) {
      t.forEach(t => url.searchParams.append('type', t));
    } else if (t) {
      url.searchParams.append('type', t);
    }
    if (page) {
      url.searchParams.set('page', page.toString());
    }

    let searchString = getSearchString(cardSystem.id, url.searchParams);

    const isSearchSame = searchString === lastSearchString;
    lastSearchString = searchString;

    let outdatedSearch = page
      ? page <= parseInt(searchParams.page ?? '')
      : searchParams.page && !page;

    if (isSearchSame && outdatedSearch) {
      console.log('tried outdated search');
      return;
    }

    function fetchPage(append?: true) {
      fetch(url)
        .then(r => r.json())
        .then(result => {
          if (result.code === 'error') {
            toast(`failed to load search results. Try again later`);
            return;
          }

          const newResults = result.data.map(detail => populateCardInfo(detail));

          const isSearchSame =
            getSearchString(cardSystem.id, new URLSearchParams(location.search)) ===
            getSearchString(result.id, url.searchParams);

          // search changed while paging, stop
          if (append && !isSearchSame) return;

          if (append) {
            setSearchResults((results = []) => [...results, ...newResults]);
          } else {
            setSearchResults(newResults);
          }

          setSearchParams({ page: result.page, totalPages: result.total_pages }, { replace: true });

          if (isSearchSame && result.page < result.total_pages) {
            url.searchParams.set('page', result.page + 1);
            // fetchPage(true);
          }
        });
    }
    fetchPage(isSearchSame);
  }
  let debouncedOnSearch = debounce(onSearch, 750, { trailing: true });

  const isSearching = () => (searchParams.q || searchParams.type)?.length > 0;

  createEffect(() => {
    cardSystem.uri;
    const q = unwrap(searchParams.q) ?? '';
    const t = unwrap(searchParams.type);
    if (!q?.length && !t?.length) {
      cancelSearch = true;
      lastSearchString = '';
      return setSearchResults();
    }
    cancelSearch = false;
    debouncedOnSearch(q, t);
  });

  function onDownloadDeckList() {
    let params = {
      name: 'unnamed deck',
    };
    if (formRef) {
      params.name = formRef.elements['name'].value;
    }

    let cards = Object.values(deck.cards)
      .filter(card => card.qty)
      .map(card => [card.qty, card.name, card.set && `[${card.set}]`].filter(Boolean).join(' '));

    let content = [cards].flat().join('\n');

    if (!cards.length) return;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${params.name}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const cardGrouping = useCardGrouping(cardSystem.types ?? [], getDeckList);

  const filteredDeckCardKeys = createMemo(() => {
    trackDeep(deck.cards);
    const filter = typeFilter();
    const keys = deckCardKeys();
    if (!filter) return keys;

    const lowerTypes = (cardSystem.types ?? []).map(type => type.toLowerCase());

    return keys.filter(key => {
      const entry = deck.cards[key];
      if (!entry?.qty) return false;

      const simpleType = getSimpleType(entry);
      const type = lowerTypes.find(candidate => simpleType?.endsWith(candidate));

      if (filter === 'unsorted') return !type;
      return type === filter;
    });
  });

  return (
    <>
      <div class={styles.container} onDragOver={e => e.preventDefault()}>
        <form ref={formRef} class={styles.editorForm} onSubmit={onSaveDeck}>
          <div
            style='grid-area: header;'
            class='pr-7 pl-4 p-4  flex flex-row gap-2 items-center bg-background'>
            <div class='flex flex-wrap gap-2 items-center'>
              <button
                type='button'
                class={cn(
                  'rounded px-1 transition-colors hover:bg-muted',
                  !typeFilter() && 'font-semibold',
                )}
                onClick={() => setTypeFilter(null)}>
                {cardGrouping().totalCount} Cards Added
              </button>
              <For each={Object.entries(cardGrouping().types)}>
                {([type, grouping]) => (
                  <Show when={grouping.count > 0}>
                    <button
                      type='button'
                      class={cn(
                        'flex gap-1 border-l-2 px-2 py-1 transition-colors hover:bg-muted',
                        typeFilter() === type && 'bg-muted font-semibold',
                      )}
                      onClick={() => setTypeFilter(current => (current === type ? null : type))}>
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
                    'flex gap-1 border-l-2 px-2 py-1 transition-colors hover:bg-muted',
                    typeFilter() === 'unsorted' && 'bg-muted font-semibold',
                  )}
                  onClick={() =>
                    setTypeFilter(current => (current === 'unsorted' ? null : 'unsorted'))
                  }>
                  <span>Unsorted</span>
                  <span>{cardGrouping().unsorted.count}</span>
                </button>
              </Show>
            </div>
            <div class='ml-auto' />
            <Button
              class='cursor-pointer'
              variant='outline'
              type='button'
              onClick={() => {
                if (isDirty()) return setSearchParams({ dialog: 'editor-confirm-close' });
                props.onClose();
              }}>
              Close
            </Button>
          </div>
          <div class={`gap-5 pt-4 ${styles.formContainer}`}>
            <input type='hidden' value={props?.deck?.id ?? nanoid()} name='id' />
            <TextField
              class='px-4'
              value={deck?.name ?? ''}
              onChange={name => updateDeck('name', name)}>
              <TextFieldLabel for='name'>Deck Name</TextFieldLabel>
              <TextFieldInput required type='text' id='name' name='name' placeholder='deck name' />
            </TextField>

            <Select
              value={cardSystem}
              class='px-4'
              name='system'
              optionValue='id'
              optionTextValue='name'
              onChange={async system => {
                await setCardSystem(system?.id);
                updateDeck('system', system?.id);
              }}
              options={(() =>
                Object.values(cardSystemStore.systems).sort((a, b) =>
                  a.name.localeCompare(b.name),
                ))()}
              itemComponent={props => (
                <SelectItem item={props.item}>{props.item.rawValue?.name}</SelectItem>
              )}>
              <SelectHiddenSelect />
              <label>Card System</label>
              <SelectTrigger aria-label='system'>
                <SelectValue<CardSystem>>{state => state.selectedOption()?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>

            <div class='px-4'>
              <label class={cn(labelVariants())}>Deck Tags</label>
              <Combobox
                multiple
                triggerMode='focus'
                options={FORMATS}
                onChange={value => updateDeck('tags', value)}
                value={deck.tags}
                onsubmit={e => {
                  e.preventDefault();
                }}
                optionValue='name'
                optionTextValue='name'
                placeholder='tags'
                itemComponent={props => (
                  <ComboboxItem item={props.item}>
                    <ComboboxItemLabel>{props.item.rawValue.name}</ComboboxItemLabel>
                  </ComboboxItem>
                )}>
                <ComboboxControl>
                  {state => (
                    <>
                      <div class={styles.multiSelectControl}>
                        <For each={state.selectedOptions()}>
                          {option => (
                            <span
                              class={styles.multiSelectItem}
                              onPointerDown={e => e.stopPropagation()}>
                              <Button
                                size='xs'
                                variant='secondary'
                                style={`background-color: ${colorHashDark.hex(option.name)}; color: white;`}
                                onClick={() => state.remove(option)}>
                                {option.name}
                              </Button>
                            </span>
                          )}
                        </For>
                        <div class={styles.multiSelectInput}>
                          <ComboboxInput
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                              }
                            }}
                          />
                          <ComboboxTrigger />
                        </div>
                      </div>
                    </>
                  )}
                </ComboboxControl>
                <ComboboxContent style='max-height: 50lvh; overflow: auto;' />
              </Combobox>
            </div>
            <Show when={getDeckList()}>
              <CardList
                entries={getDeckList()}
                addCard={entry => {
                  updateDeck('cards', getCardKey(entry), 'qty', number => number + 1);
                }}
                removeCard={entry =>
                  updateDeck('cards', getCardKey(entry), 'qty', number => Math.max(number - 1, 0))
                }
              />
            </Show>

            <div class='px-4'>
              <label class={cn(labelVariants())}>Start in play</label>
              <div class='text-muted-foreground'>
                useful for commanders, or other cards that should start on the table
              </div>
              <Combobox
                multiple
                options={getDeckList()}
                value={getInPlayList()}
                optionValue={card => {
                  return card.name;
                }}
                onChange={cards => {
                  updateDeck({
                    inPlay: Object.fromEntries(cards.map(card => [card.name, card])),
                  });
                }}
                optionTextValue={(card: DetailedCardEntry) => {
                  return card.name;
                }}
                optionLabel={card => card.name}
                placeholder='Card in play'
                itemComponent={props => (
                  <ComboboxItem item={props.item}>
                    <ComboboxItemLabel>{props.item.rawValue.name}</ComboboxItemLabel>
                  </ComboboxItem>
                )}>
                <ComboboxControl>
                  {state => (
                    <>
                      <div class={styles.multiSelectControl}>
                        <For each={state.selectedOptions()}>
                          {option => (
                            <span
                              class={styles.multiSelectItem}
                              onPointerDown={e => e.stopPropagation()}>
                              <Button
                                size='xs'
                                variant='secondary'
                                onClick={() => state.remove(option)}>
                                {option.name}
                              </Button>
                            </span>
                          )}
                        </For>
                        <div class={styles.multiSelectInput}>
                          <ComboboxInput />
                          <ComboboxTrigger />
                        </div>
                      </div>
                    </>
                  )}
                </ComboboxControl>
                <ComboboxContent style='max-height: 50lvh; overflow: auto;' />
              </Combobox>
            </div>

            <div class='flex gap-4 justify-end px-2 pb-4'>
              <Button variant='ghost' type='button' onClick={openImportDialog}>
                Import Card List
              </Button>
              <Button type='submit'>{isEditing() ? 'Update Deck' : 'Create Deck'}</Button>
              <DropdownMenu>
                <DropdownMenuTrigger as={Button<'button'>} variant='ghost'>
                  <OverflowMenuIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent class='w-48'>
                  <DropdownMenuItem
                    disabled={Object.values(deck.cards).filter(card => card.qty).length < 1}
                    onClick={onDownloadDeckList}>
                    <div class='flex gap-2'>
                      <DownloadIcon class='text-muted-foreground' />
                      <span>Download Deck</span>
                    </div>
                  </DropdownMenuItem>
                  <Show when={isEditing()}>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={openDeleteDialog}>
                      <div class='flex gap-2'>
                        <DeleteIcon class='text-muted-foreground' />
                        <span>Delete Deck</span>
                      </div>
                    </DropdownMenuItem>
                  </Show>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div class={styles.cardListScrollContainer} aria-hidden='false'>
            <div
              class='top-0 sticky z-10 backdrop-blur-xl p-2'
              style='background: hsla(var(--background) / .7);'>
              <Command style='background: transparent;' value={searchParams.q || ''}>
                <CommandInput
                  wrapperStyle='border-bottom-color: var(--color-gray-400);'
                  style='background: transparent;'
                  placeholder='Search'
                  value={searchParams.q ?? ''}
                  onValueChange={q => setSearchParams({ q })}
                />
              </Command>
              <ToggleGroup
                class='inline-flex py-2 gap-1'
                multiple
                value={
                  Array.isArray(searchParams.type)
                    ? searchParams.type
                    : [searchParams.type].filter(Boolean)
                }
                onChange={type => setSearchParams({ type })}>
                <For each={cardSystem.types}>
                  {cardType => (
                    <ToggleGroupItem
                      class='data-[pressed]:bg-muted-foreground/20 hover:bg-muted-foreground/10'
                      value={cardType}>
                      {capitalize(cardType)}
                    </ToggleGroupItem>
                  )}
                </For>
              </ToggleGroup>
            </div>
            <div class={`p-4 ${styles.cardList}`}>
              <Show
                when={searchResults()}
                fallback={
                  <For
                    each={filteredDeckCardKeys()}
                    keyed
                    fallback={
                      typeFilter() ? (
                        <div class='p-8 text-center text-muted-foreground'>
                          <p>
                            No{' '}
                            {typeFilter() === 'unsorted'
                              ? 'unsorted'
                              : capitalize(typeFilter()!)}{' '}
                            cards in this deck.
                          </p>
                          <Button
                            class='mt-3'
                            type='button'
                            variant='secondary'
                            onClick={() => setTypeFilter(null)}>
                            Show all cards
                          </Button>
                        </div>
                      ) : (
                        <EmptyGridContainer
                          hasSearchResults={searchParams.totalPages > 0}
                          isSearching={isSearching()}
                          importCardList={openImportDialog}
                        />
                      )
                    }>
                    {(storageKey, index) => (
                      <DeckGridCard
                        storageKey={storageKey}
                        index={index()}
                        card={() => deck.cards[storageKey]}
                        updateDeck={updateDeck}
                        onChangePrinting={changeCardPrinting}
                        onPreview={src => setSearchParams({ dialog: 'card-preview', src })}
                        onOpenPrintings={() => openPrintingPicker(storageKey)}
                      />
                    )}
                  </For>
                }>
                <For
                  each={searchResults()}
                  fallback={
                    <EmptyGridContainer
                      hasSearchResults={searchParams.totalPages > 0}
                      isSearching={isSearching()}
                      importCardList={openImportDialog}
                    />
                  }>
                  {(card, i) => {
                    const cardKey = () => getCardKey(card);
                    const deckCard = () => deck.cards?.[cardKey()];
                    return (
                      <div
                        data-index={i()}
                        id={card.id}
                        style={`
                        position: relative;
                        --timing: ${random(400, 600)}ms;
                        --delay: ${random(250, 500)}ms;
                        --distance: ${random(20, 100)}px;
                        content-visibility: auto;
                      `}
                        class='fade-in-from-below'
                        onContextMenu={e => handlePrintingContextMenu(e, cardKey())}
                        onMouseDown={e => {
                          if (e.button !== 2 || !supportsCardPrintings() || !(deckCard()?.qty > 0)) {
                            return;
                          }
                          if (card.name) prefetchCardPrintings(card.name);
                        }}>
                        <img
                          src={
                            getCardImage(card) ??
                            cardSystem.fallbackImage ??
                            '/unknown-card-image.webp'
                          }
                          style={`anchor-name: --card-${i()}; height: 100%;`}
                        />
                        <div
                          class='absolute inset-0 fade-in'
                          style={`
                      position-anchor: --card-${i()};
                      right: anchor(right);
                      height: anchor-size(height);
                      container-type: size;
                      --delay: ${random(1000, 1250)}ms;
                      --timing: ${random(500, 1250)}ms;
                    `}>
                          <div
                            class='grid place-items-center justify-end'
                            style={`
                        height: 100%;
                        padding-inline: 10cqw;
                        padding-bottom: 10cqh;
                      `}>
                            <div
                              class='dark gap-2 font-bold text-white flex items-center rounded'
                              style={`background: hsla(var(--background) / .4);`}>
                              <Show
                                when={!card.detail?.name || !getCardImage(card)}
                                fallback={
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={() =>
                                      setSearchParams({
                                        dialog: 'card-preview',
                                        src: getCardImage(card),
                                      })
                                    }>
                                    <SearchIcon />
                                  </Button>
                                }>
                                <div class='pl-2'>{card.name}</div>
                              </Show>
                              <Show when={deckCard()?.qty > 0}>
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  type='button'
                                  onClick={() => {
                                    let id = getCardKey(unwrap(card));
                                    if (deck.cards[id]) {
                                      return updateDeck('cards', id, 'qty', (qty = 1) =>
                                        Math.max(qty - 1, 0),
                                      );
                                    }
                                  }}>
                                  <SubIcon
                                    class='text-white'
                                    style='filter: drop-shadow(2px 4px 6px black);'
                                  />
                                </Button>
                              </Show>
                              <Show when={deckCard()?.qty > 0}>{deckCard()?.qty}</Show>

                              <Button
                                size='icon'
                                variant='ghost'
                                type='button'
                                onClick={() => {
                                  let id = getCardKey(unwrap(card));
                                  if (deck.cards[id]) {
                                    return updateDeck('cards', id, 'qty', (qty = 1) => qty + 1);
                                  }
                                  updateDeck('cards', id, { ...unwrap(card), qty: 1 });
                                }}>
                                <AddIcon
                                  class='text-white'
                                  style='filter: drop-shadow(2px 4px 6px black);'
                                />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
            <div use:intersectionObserver={{ onIntersect: loadMoreResults }}>
              <Show
                when={
                  (searchParams.q || searchParams.type) &&
                  searchParams.page < searchParams.totalPages
                }>
                <div class='flex gap-2 justify-center p-6'>
                  <LoaderIcon class='animate-spin' /> Loading more results
                </div>
              </Show>
            </div>
          </div>
        </form>
      </div>

      <Portal>
        <Show when={printingPickerKey() && deck.cards[printingPickerKey()!]}>
          <PrintingPickerModal
            entry={deck.cards[printingPickerKey()!]}
            onClose={() => setPrintingPickerKey(undefined)}
            onSelect={printing => {
              void changeCardPrinting(printingPickerKey()!, printing);
              setPrintingPickerKey(undefined);
            }}
          />
        </Show>
        <Show when={importDialogOpen()}>
          <DeckImportDialog
            onClose={closeImportDialog}
            onImport={importedDeck => {
              setDeck(reconcile(importedDeck));
              setIsDirty(true);
              closeImportDialog();
            }}
          />
        </Show>
        <Show when={searchParams.dialog === 'editor-confirm-close'}>
          <Dialog open onOpenChange={isOpen => !isOpen && closeCurrentDialog()}>
            <DialogContent class='z-[70]'>
              <DialogHeader>
                <DialogTitle>Unsaved Changes</DialogTitle>
              </DialogHeader>
              <p>Are you sure you want to close the deck editor?</p>
              <p>
                All <b>unsaved changes</b> will <b>be lost</b>
              </p>
              <DialogFooter>
                <Button variant='ghost' onclick={closeCurrentDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    closeCurrentDialog();
                    props.onClose();
                  }}>
                  Close Without Saving
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Show>
        <Show when={deleteDialogOpen()}>
          <ConfirmDeleteDialog
            name={deck.name}
            onClose={closeDeleteDialog}
            onDelete={() => {
              closeDeleteDialog();
              props.onDelete();
              props.onClose();
            }}
          />
        </Show>
        <Show when={searchParams.dialog === 'card-preview'}>
          <AlertDialog open onOpenChange={isOpen => !isOpen && closeCurrentDialog()}>
            <AlertDialogContent>
              <AlertTitle />
              <img src={searchParams.src} />
            </AlertDialogContent>
          </AlertDialog>
        </Show>
      </Portal>
    </>
  );
};

function EmptyGridContainer(props: {
  isSearching: boolean;
  hasSearchResults: boolean;
  importCardList(): void;
}) {
  return (
    <div class='p-8 flex-col flex gap-4'>
      <Switch>
        <Match when={props.hasSearchResults}>
          <Alert class='inline-block'>
            <AlertTitle>Searching</AlertTitle>
            <AlertDescription>
              <p>Loading Search Results</p>
            </AlertDescription>
          </Alert>
        </Match>
        <Match when={props.isSearching}>
          <Alert class='inline-block'>
            <AlertTitle>No Results Found</AlertTitle>
            <AlertDescription>
              <p>Sorry, we couldn't find any results for that search</p>
            </AlertDescription>
          </Alert>
        </Match>
        <Match when>
          <Alert class='inline-block'>
            <AlertTitle>Your deck doesn't have any cards</AlertTitle>
            <AlertDescription>
              <p>Add cards by searching above or import a card list</p>
              <Button class='mt-4' onClick={props.importCardList}>
                Import Card List
              </Button>
            </AlertDescription>
          </Alert>
        </Match>
      </Switch>
    </div>
  );
}

function ConfirmDeleteDialog(props: { name: string; onClose(): void; onDelete(): void }) {
  return (
    <Dialog open onOpenChange={isOpen => !isOpen && props.onClose()}>
      <DialogContent class='z-[70]'>
        <DialogHeader>
          <DialogTitle>Delete Deck?</DialogTitle>
        </DialogHeader>
        <p>
          Are you sure you want to delete <b>{props.name}</b>? This cannot be undone.
        </p>
        <DialogFooter>
          <Button variant='ghost' type='button' onClick={props.onClose}>
            Cancel
          </Button>
          <Button type='button' variant='destructive' onClick={props.onDelete}>
            Delete Deck
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

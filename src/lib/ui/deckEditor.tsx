import { nanoid } from 'nanoid';
import {
  Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  JSX,
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
  entryToPrintingOption,
  fetchCardInfo,
  formatDeckListLine,
  getPrintingPreviewUrl,
  populateCardInfo,
  prefetchCardPrintings,
  supportsCardPrintings,
} from '../deck';
import { cardSystem, colorHashDark } from '../globals';
import { devLog } from '../devLog';
import { searchCards } from '../scryfall/client';
import { cn } from '../utils';
import styles from './deckEditor.module.css';
import CardList from './deckEditor/cardList';
import DeckGridCard from './deckEditor/deckGridCard';
import PrintingPickerModal from './deckEditor/printingPickerModal';
import { CustomCardArtOption, applyCustomArtToEntry, normalizeTextureUrl } from '~/lib/customCardArt';
import { Command, CommandInput } from '~/components/ui/command';
import { capitalize, debounce } from 'lodash-es';
import random from 'lodash-es/random';
import AddIcon from 'lucide-solid/icons/plus';
import SubIcon from 'lucide-solid/icons/minus';
import SearchIcon from 'lucide-solid/icons/search';
import ImagesIcon from 'lucide-solid/icons/images';
import { createStore, reconcile, SetStoreFunction, unwrap } from 'solid-js/store';
import { findDeckEntryMatch, getCardKey } from '../deckEntryMatch';
import { hydrateDeck, serializeDeck } from '../deckStore';
import { useCardSystemContext } from '../cardSystemContext';
import { MTG_CARD_SYSTEM } from '../mtgCardSystem';
import { useSearchParams } from '@solidjs/router';
import { trackDeep } from '@solid-primitives/deep';
import CopyIcon from 'lucide-solid/icons/copy';
import PrinterIcon from 'lucide-solid/icons/printer';
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
  DialogContentExtended,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
} from '~/components/ui/dialog';
import { toast } from 'solid-sonner';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import intersectionObserver from '../intersectionObserver';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import DeckImportDialog from './deckEditor/deckImportDialog';
import ExportDeckModal from './deckEditor/exportDeckModal';
import PrintDeckModal from './deckEditor/printDeckModal';
import useCardGrouping, { getCardTypeCategory } from './deckEditor/cardGroupings';
import {
  countSpecialDeckTabs,
  entryMatchesSubtypeFilter,
  getSpecialDeckType,
  getSubtypeOptionsForTab,
  SPECIAL_DECK_TAB_TYPES,
  tabSupportsSubtypeFilter,
} from './deckEditor/cardSubtypes';
import SubtypeFilter from './deckEditor/subtypeFilter';
import CommanderBracketModal from './deckEditor/commanderBracketModal';
import BracketEstimateTag from './bracketEstimateTag';
import {
  buildCommanderBracketPayload,
  CommanderBracketApiError,
  CommanderBracketEstimate,
  buildCommanderBracketShareUrl,
  estimateCommanderBracket,
  getBracketEstimateFromResult,
  getHowItPlaysSection,
} from '../commanderBracket';
import {
  canBeCommander,
  compareCommanderFirst,
  countCommanders,
  isCommanderCard,
  MAX_COMMANDERS,
  sortCommandersFirst,
  toggleCommanderCategories,
} from '../deckCommander';
import { collectTokenPartIds, getDefaultTokenEntry, getTokenKey, mergeTokenPrintings, resolveTokensByIds } from '../deckTokens';
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

const NEW_DECK_PRINTING_TIP_KEY = 'mtgplayer-deck-editor-printing-tip-seen';

export const DeckEditor: Component<Props> = props => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchResults, setSearchResults] = createSignal<DetailedCardEntry[]>();
  const [cardSystemStore, { setCardSystem }] = useCardSystemContext();
  const [isDirty, setIsDirty] = createSignal(false);
  const [printingPickerKey, setPrintingPickerKey] = createSignal<string>();
  const [printingPickerSection, setPrintingPickerSection] = createSignal<'cards' | 'sideboard'>(
    'cards',
  );
  const [tokenPrintingPickerKey, setTokenPrintingPickerKey] = createSignal<string>();
  const [importDialogOpen, setImportDialogOpen] = createSignal(false);
  const [printDialogOpen, setPrintDialogOpen] = createSignal(false);
  const [exportDialogOpen, setExportDialogOpen] = createSignal(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [closeConfirmDialogOpen, setCloseConfirmDialogOpen] = createSignal(false);
  const [bracketModalOpen, setBracketModalOpen] = createSignal(false);
  const [bracketLoading, setBracketLoading] = createSignal(false);
  const [bracketError, setBracketError] = createSignal<string>();
  const [bracketResult, setBracketResult] = createSignal<CommanderBracketEstimate>();
  const [bracketShareUrl, setBracketShareUrl] = createSignal<string>();
  const [newDeckTipOpen, setNewDeckTipOpen] = createSignal(false);
  const [typeFilter, setTypeFilter] = createSignal('deck');
  const [activeSubtypes, setActiveSubtypes] = createSignal<string[]>([]);
  let formRef: HTMLFormElement;

  const [deck, setDeck] = createStore<Deck>(
    props.deck?.id
      ? structuredClone(unwrap(props.deck))
      : { cards: {}, inPlay: {}, sideboard: {}, tokens: {}, system: MTG_CARD_SYSTEM.id },
  );

  const getDeckList = createMemo(() => {
    trackDeep(deck.cards);
    return sortCommandersFirst(Object.values(deck?.cards || {}));
  });

  const deckCardKeys = createMemo(() => Object.keys(deck.cards ?? {}));

  const getInPlayList = createMemo(() => {
    trackDeep(deck.inPlay);
    return Object.values(deck?.inPlay || {});
  });

  const getSideboardList = createMemo(() => {
    trackDeep(deck.sideboard);
    return sortCommandersFirst(Object.values(deck?.sideboard || {}));
  });

  const sideboardCardKeys = createMemo(() =>
    Object.keys(deck.sideboard ?? {}).sort((left, right) =>
      (deck.sideboard?.[left]?.name ?? '').localeCompare(deck.sideboard?.[right]?.name ?? ''),
    ),
  );

  const deckQtyCount = createMemo(() =>
    getDeckList().reduce((sum, card) => sum + (card.qty ?? 0), 0),
  );

  const sideboardQtyCount = createMemo(() =>
    getSideboardList().reduce((sum, card) => sum + (card.qty ?? 0), 0),
  );

  onMount(async () => {
    if (!props.deck?.id && !localStorage.getItem(NEW_DECK_PRINTING_TIP_KEY)) {
      setNewDeckTipOpen(true);
    }
    await setCardSystem(deck.system ?? MTG_CARD_SYSTEM.id);
    if (props.deck?.id || Object.keys(deck.cards ?? {}).length > 0) {
      await rehydrateDeck(deck);
    }
  });

  function closeNewDeckTip() {
    localStorage.setItem(NEW_DECK_PRINTING_TIP_KEY, '1');
    setNewDeckTipOpen(false);
  }

  createEffect(
    on(
      () => deck.system,
      () => {
        rehydrateDeck(unwrap(deck));
        setTypeFilter('deck');
        setSearchParams(
          { q: undefined, page: undefined, totalPages: undefined, catalogType: undefined },
          { replace: true },
        );
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

  function openPrintDialog() {
    setPrintDialogOpen(true);
  }

  function closePrintDialog() {
    setPrintDialogOpen(false);
  }

  function openExportDialog() {
    if (!deckExportContent().trim()) return;
    setExportDialogOpen(true);
  }

  function closeExportDialog() {
    setExportDialogOpen(false);
  }

  function getDeckName() {
    if (formRef?.elements.namedItem('name')) {
      return String((formRef.elements.namedItem('name') as HTMLInputElement).value || '').trim();
    }
    return deck.name?.trim() || 'deck';
  }

  function closeDeleteDialog() {
    setDeleteDialogOpen(false);
  }

  function openDeleteDialog() {
    setDeleteDialogOpen(true);
  }

  function closeConfirmDialog() {
    setCloseConfirmDialogOpen(false);
  }

  function openCloseConfirmDialog() {
    setCloseConfirmDialogOpen(true);
  }

  const updateDeck: SetStoreFunction<Deck> = (...params: any[]) => {
    (setDeck as any)(...params);
    setIsDirty(true);
  };

  function invalidateBracketEstimate() {
    if (deck.bracketEstimate != null || deck.howItPlaysAdvice != null) {
      setDeck({ bracketEstimate: undefined, howItPlaysAdvice: undefined });
      setIsDirty(true);
    }
  }

  const updateDeckCards: SetStoreFunction<Deck> = (...params: any[]) => {
    invalidateBracketEstimate();
    (updateDeck as any)(...params);
  };

  const updateSideboardCards: SetStoreFunction<Deck> = (...params: any[]) => {
    invalidateBracketEstimate();
    (updateDeck as any)(...params);
  };

  function removeFromInPlay(entry: DetailedCardEntry) {
    const inPlay = deck.inPlay ?? {};
    const matchKey = Object.keys(inPlay).find(
      key =>
        key === getCardKey(entry) ||
        key === entry.name ||
        inPlay[key].id === entry.id,
    );
    if (matchKey) updateDeck('inPlay', matchKey, undefined);
  }

  function sendCardToSideboard(storageKey: string) {
    const entry = deck.cards[storageKey];
    if (!entry?.qty) return;

    invalidateBracketEstimate();

    const remaining = entry.qty - 1;
    if (remaining <= 0) {
      updateDeck('cards', storageKey, undefined);
      removeFromInPlay(entry);
    } else {
      updateDeck('cards', storageKey, 'qty', remaining);
    }

    const sideboardEntry = deck.sideboard?.[storageKey];
    if (sideboardEntry?.qty) {
      updateDeck('sideboard', storageKey, 'qty', (qty = 0) => qty + 1);
    } else {
      updateDeck('sideboard', storageKey, { ...entry, qty: 1 });
    }
  }

  function sendCardToDeck(storageKey: string) {
    const entry = deck.sideboard?.[storageKey];
    if (!entry?.qty) return;

    invalidateBracketEstimate();

    const remaining = entry.qty - 1;
    if (remaining <= 0) {
      updateDeck('sideboard', storageKey, undefined);
    } else {
      updateDeck('sideboard', storageKey, 'qty', remaining);
    }

    const deckEntry = deck.cards[storageKey];
    if (deckEntry?.qty) {
      updateDeckCards('cards', storageKey, 'qty', (qty = 0) => qty + 1);
    } else {
      updateDeckCards('cards', storageKey, { ...entry, qty: 1 });
    }
  }

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

  function updateInPlayMirror(previous: DetailedCardEntry, nextEntry: DetailedCardEntry) {
    const inPlay = deck.inPlay ?? {};
    const matchKey = Object.keys(inPlay).find(
      key =>
        key === getCardKey(previous) ||
        key === previous.name ||
        inPlay[key].id === previous.id,
    );
    if (!matchKey) return;

    const nextKey = getCardKey(nextEntry);
    const qty = inPlay[matchKey].qty ?? nextEntry.qty;
    if (matchKey !== nextKey) {
      updateDeck('inPlay', matchKey, undefined);
    }
    updateDeck('inPlay', nextKey, { ...nextEntry, qty });
  }

  function changeCardCustomArt(
    storageKey: string,
    option: CustomCardArtOption,
    section: 'cards' | 'sideboard' = 'cards',
  ) {
    const previous = deck[section]?.[storageKey];
    if (!previous) return;

    const nextEntry: DetailedCardEntry = applyCustomArtToEntry({
      ...previous,
      customArtUrl: normalizeTextureUrl(option.imageUrl) ?? option.imageUrl,
      detail: previous.detail,
    });

    updateDeck(section, storageKey, nextEntry);
    if (section === 'cards') {
      updateInPlayMirror(previous, nextEntry);
    }
  }

  function changeTokenCustomArt(tokenKey: string, option: CustomCardArtOption) {
    const previous =
      deckTokenEntryList().find(entry => getTokenKey(entry.detail) === tokenKey) ??
      deck.tokens?.[tokenKey];
    if (!previous) return;

    const nextEntry = applyCustomArtToEntry({
      ...previous,
      customArtUrl: normalizeTextureUrl(option.imageUrl) ?? option.imageUrl,
      detail: previous.detail,
    });

    updateDeck('tokens', tokenKey, { ...nextEntry, qty: 1 });
  }

  async function changeTokenPrinting(tokenKey: string, printing: CardPrintingOption) {
    const previous =
      deckTokenEntryList().find(entry => getTokenKey(entry.detail) === tokenKey) ??
      deck.tokens?.[tokenKey];
    if (!previous) return;

    let updated = await fetchCardInfo({
      name: previous.name,
      id: printing.id,
      set: printing.set,
      collector_number: printing.collector_number,
      qty: 1,
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

    updateDeck('tokens', tokenKey, {
      ...updated,
      qty: 1,
      categories: previous.categories ?? updated.categories ?? [],
    });
  }

  function openTokenPrintingPicker(tokenKey: string) {
    const entry = deckTokenEntryList().find(item => getTokenKey(item.detail) === tokenKey);
    if (!supportsCardPrintings() || !entry) return;
    if (entry.name) prefetchCardPrintings(entry.name);
    setTokenPrintingPickerKey(tokenKey);
  }

  function toggleCommander(storageKey: string) {
    const entry = deck.cards[storageKey];
    if (!entry?.qty) return;

    const nextIsCommander = !isCommanderCard(entry);
    if (nextIsCommander && !canBeCommander(entry)) return;
    if (nextIsCommander && countCommanders(Object.values(deck.cards)) >= MAX_COMMANDERS) {
      toast.error(`You can mark at most ${MAX_COMMANDERS} commanders.`);
      return;
    }

    const nextCategories = toggleCommanderCategories(entry.categories, nextIsCommander);
    updateDeckCards('cards', storageKey, 'categories', nextCategories);

    if (nextIsCommander) {
      const nextEntry = { ...entry, categories: nextCategories };
      updateDeck('inPlay', getCardKey(nextEntry), { ...nextEntry, qty: 1 });
    }
  }

  async function openBracketEstimate() {
    setBracketModalOpen(true);
    setBracketLoading(true);
    setBracketError(undefined);
    setBracketResult(undefined);

    const cards = getDeckList();
    const payload = buildCommanderBracketPayload(cards);
    setBracketShareUrl(buildCommanderBracketShareUrl(payload));

    try {
      const result = await estimateCommanderBracket(cards);
      setBracketResult(result);
      const bracket = getBracketEstimateFromResult(result);
      const advice = getHowItPlaysSection(result);
      const persistedDeck = serializeDeck({
        ...unwrap(deck),
        bracketEstimate: bracket ?? undefined,
        howItPlaysAdvice: advice ?? undefined,
      });
      setDeck({
        bracketEstimate: persistedDeck.bracketEstimate,
        howItPlaysAdvice: persistedDeck.howItPlaysAdvice,
      });
      setIsDirty(true);
      props.onChange(persistedDeck);
    } catch (error) {
      const message =
        error instanceof CommanderBracketApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Could not estimate bracket.';
      setBracketError(message);
    } finally {
      setBracketLoading(false);
    }
  }

  function closeBracketModal() {
    setBracketModalOpen(false);
    setBracketLoading(false);
    setBracketError(undefined);
    setBracketShareUrl(undefined);
  }

  async function changeCardPrinting(
    storageKey: string,
    printing: CardPrintingOption,
    section: 'cards' | 'sideboard' = 'cards',
  ) {
    const previous = deck[section]?.[storageKey];
    if (!previous) return;

    const qty = previous.qty;
    let updated = await fetchCardInfo({
      name: previous.name,
      id: printing.id,
      set: printing.set,
      collector_number: printing.collector_number,
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
    updateDeck(section, storageKey, nextEntry);
    if (section === 'cards') {
      updateInPlayMirror(previous, nextEntry);
    }
  }

  function openPrintingPicker(
    storageKey: string,
    section: 'cards' | 'sideboard' = 'cards',
  ) {
    if (!supportsCardPrintings() || !(deck[section]?.[storageKey]?.qty > 0)) return;
    const entry = deck[section]?.[storageKey];
    if (entry?.name) prefetchCardPrintings(entry.name);
    setPrintingPickerSection(section);
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
        catalogType: undefined,
      },
      { replace: true },
    );
  });

  function tabButtonClass(active: boolean) {
    return cn(styles.tabButton, active && styles.tabButtonActive);
  }

  const searchQuery = () => (searchParams.q ?? '').trim().toLowerCase();

  function entryMatchesSearch(entry: DetailedCardEntry | undefined) {
    const query = searchQuery();
    if (!query) return true;
    if (!entry?.qty) return false;

    const haystack = [entry.name, entry.detail?.type_line, entry.detail?.oracle_text, entry.set]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  }

  const CATALOG_TYPE_ALL = 'all';

  const isCatalogTab = () => typeFilter() === 'all';
  const isSideboardTab = () => typeFilter() === 'sideboard';
  const showSearchTypeFilter = () => isCatalogTab() || isSideboardTab();
  const catalogTypeFilter = () => {
    const raw = searchParams.catalogType as string | undefined;
    if (!raw || raw === CATALOG_TYPE_ALL) return CATALOG_TYPE_ALL;
    return raw;
  };
  const hasCatalogTypeFilter = () => catalogTypeFilter() !== CATALOG_TYPE_ALL;
  const isSearching = () => {
    const hasTextSearch = searchQuery().length > 0;
    const hasTypeFilter = hasCatalogTypeFilter();
    const hasSubtypeFilter = activeSubtypes().length > 0;
    if (isCatalogTab() || isSideboardTab()) {
      return hasTextSearch || hasTypeFilter || hasSubtypeFilter;
    }
    return hasTextSearch || hasSubtypeFilter;
  };
  const searchPlaceholder = () =>
    isCatalogTab() ? 'Search all MTG cards...' : 'Search in this tab...';

  type CatalogTypeOption = { value: string; label: string };

  const catalogTypeOptions = createMemo((): CatalogTypeOption[] => [
    { value: CATALOG_TYPE_ALL, label: 'All types' },
    ...(cardSystem.types ?? []).map(type => ({
      value: type,
      label: capitalize(type),
    })),
  ]);

  const selectedCatalogType = createMemo(
    () =>
      catalogTypeOptions().find(option => option.value === catalogTypeFilter()) ??
      catalogTypeOptions()[0],
  );

  function getSearchString(systemId: string, params: URLSearchParams, subtypes: string[] = []) {
    return [systemId, params.get('q'), params.get('catalogType'), subtypes.join('|')].join(':');
  }

  function hasCatalogSearchCriteria(
    q?: string,
    catalogType?: string,
    subtypes: string[] = activeSubtypes(),
  ) {
    const hasTextSearch = (q ?? '').trim().length > 0;
    const hasTypeFilter = Boolean(catalogType && catalogType !== CATALOG_TYPE_ALL);
    return hasTextSearch || hasTypeFilter || subtypes.length > 0;
  }

  async function loadMoreResults() {
    if (!isCatalogTab()) return;

    const q = (unwrap(searchParams.q) ?? '') as string;
    const catalogType = unwrap(searchParams.catalogType) as string | undefined;
    const subtypes = activeSubtypes();
    const page = unwrap(searchParams.page) as string;
    const totalPages = unwrap(searchParams.totalPages) as string;
    if (!hasCatalogSearchCriteria(q, catalogType, subtypes)) return;
    if (!page?.length) return;

    if (totalPages && parseInt(page) >= parseInt(totalPages)) {
      return;
    }

    debouncedOnSearch(q, parseInt(page) + 1, catalogType, subtypes);
  }

  let lastSearchString: string | undefined;
  let cancelSearch = false;

  function onSearch(q?: string, page?: number, catalogType?: string, subtypes?: string[]) {
    if (cancelSearch || !isCatalogTab()) return;

    const searchPage = page ?? 1;
    const subtypeFilters = subtypes ?? activeSubtypes();
    const types =
      catalogType && catalogType !== CATALOG_TYPE_ALL ? [catalogType] : [];
    const searchString = getSearchString(
      cardSystem.id,
      new URLSearchParams({
        q: q ?? '',
        ...(catalogType ? { catalogType } : {}),
      }),
      subtypeFilters,
    );

    const isSearchSame = searchString === lastSearchString;
    lastSearchString = searchString;

    const outdatedSearch = page
      ? page <= parseInt(searchParams.page ?? '')
      : searchParams.page && !page;

    if (isSearchSame && outdatedSearch) {
      devLog.log('tried outdated search');
      return;
    }

    function fetchPage(append?: true) {
      searchCards(q ?? '', { types, subtypes: subtypeFilters, page: searchPage })
        .then(result => {
          if ((result as { code?: string }).code === 'error') {
            toast(`failed to load search results. Try again later`);
            return;
          }

          const newResults = result.data.map(detail => populateCardInfo(detail));
          const isSearchSame =
            getSearchString(
              cardSystem.id,
              new URLSearchParams(location.search),
              subtypeFilters,
            ) === searchString;

          if (append && !isSearchSame) return;

          if (append) {
            setSearchResults((results = []) => [...results, ...newResults]);
          } else {
            setSearchResults(newResults);
          }

          setSearchParams({ page: result.page, totalPages: result.total_pages }, { replace: true });
        })
        .catch(() => toast('failed to load search results. Try again later'));
    }

    fetchPage(isSearchSame);
  }

  const debouncedOnSearch = debounce(onSearch, 750, { trailing: true });

  createEffect(() => {
    if (typeFilter() !== 'all') {
      cancelSearch = true;
      lastSearchString = '';
      setSearchResults(undefined);
      return;
    }

    cardSystem.uri;
    const q = unwrap(searchParams.q) ?? '';
    const catalogType = unwrap(searchParams.catalogType) as string | undefined;
    const subtypes = activeSubtypes();
    if (!hasCatalogSearchCriteria(q, catalogType, subtypes)) {
      cancelSearch = true;
      lastSearchString = '';
      setSearchResults(undefined);
      return;
    }

    cancelSearch = false;
    debouncedOnSearch(q, undefined, catalogType, subtypes);
  });

  const deckExportContent = createMemo(() => {
    trackDeep(deck.cards);
    trackDeep(deck.sideboard);

    let mainLines = Object.values(deck.cards)
      .filter(card => card.qty)
      .map(card => formatDeckListLine(card));

    const sideboardLines = Object.values(deck.sideboard ?? {})
      .filter(card => card.qty)
      .map(card => formatDeckListLine(card));

    if (sideboardLines.length > 0) {
      mainLines = [...mainLines, '', 'SIDEBOARD:', ...sideboardLines];
    }

    return mainLines.join('\n');
  });
  createEffect(() => {
    typeFilter();
    catalogTypeFilter();
    setActiveSubtypes([]);
  });

  function entryPassesFilters(entry: DetailedCardEntry | undefined) {
    return entryMatchesSearch(entry) && entryMatchesSubtypeFilter(entry, activeSubtypes());
  }

  const cardGrouping = useCardGrouping(cardSystem.types ?? [], getDeckList);

  const specialTabCounts = createMemo(() => {
    trackDeep(deck.cards);
    return countSpecialDeckTabs(getDeckList());
  });

  const subtypeOptions = createMemo(() => {
    const tab = typeFilter();
    if (!tabSupportsSubtypeFilter(tab)) return [];

    if (tab === 'all') {
      return getSubtypeOptionsForTab(tab, catalogTypeFilter(), []);
    }

    if (tab === 'sideboard') {
      trackDeep(deck.sideboard);
      return getSubtypeOptionsForTab(tab, catalogTypeFilter(), getSideboardList());
    }

    trackDeep(deck.cards);
    return getSubtypeOptionsForTab(tab, catalogTypeFilter(), getDeckList());
  });

  const filteredSearchResults = createMemo(() => {
    const results = searchResults();
    if (!results) return results;
    if (!activeSubtypes().length) return results;
    return results.filter(card => entryMatchesSubtypeFilter(card, activeSubtypes()));
  });

  const deckTokenPartIds = createMemo(() => {
    trackDeep(deck.cards);
    return collectTokenPartIds(getDeckList().filter(entry => entry?.qty));
  });

  const [deckTokens] = createResource(deckTokenPartIds, resolveTokensByIds);

  const deckTokenEntryList = createMemo(() => {
    trackDeep(deck.tokens);
    const resolved = deckTokens();
    if (!resolved) return [];
    return mergeTokenPrintings(resolved, deck.tokens);
  });

  function getTokenPinnedPrintings(tokenKey: string): CardPrintingOption[] | undefined {
    const defaultEntry = getDefaultTokenEntry(tokenKey, deckTokens());
    return defaultEntry ? [entryToPrintingOption(defaultEntry)] : undefined;
  }

  const filteredMainDeckKeys = createMemo(() => {
    trackDeep(deck.cards);
    const filter = typeFilter();
    if (filter === 'all' || filter === 'sideboard' || filter === 'tokens') return [];

    let keys = deckCardKeys().filter(key => deck.cards[key]?.qty);

    const sortKeys = (list: string[]) =>
      [...list].sort((a, b) => compareCommanderFirst(deck.cards[a], deck.cards[b]));

    const isFullDeckView = filter === 'deck';
    if (!isFullDeckView) {
      const lowerTypes = (cardSystem.types ?? []).map(type => type.toLowerCase());

      keys = keys.filter(key => {
        const entry = deck.cards[key];
        if (!entry?.qty) return false;

        if (SPECIAL_DECK_TAB_TYPES.includes(filter as (typeof SPECIAL_DECK_TAB_TYPES)[number])) {
          return getSpecialDeckType(entry) === filter;
        }

        const type = getCardTypeCategory(entry, lowerTypes);

        if (filter === 'unsorted') return !type && !getSpecialDeckType(entry);
        return type === filter;
      });
    }

    return sortKeys(keys);
  });

  const filteredDeckCardKeys = createMemo(() =>
    filteredMainDeckKeys().filter(key => entryPassesFilters(deck.cards[key])),
  );

  const filteredSideboardCardKeys = createMemo(() => {
    trackDeep(deck.sideboard);
    const lowerTypes = (cardSystem.types ?? []).map(type => type.toLowerCase());
    const activeTypeFilter = catalogTypeFilter();

    return sideboardCardKeys().filter(key => {
      const entry = deck.sideboard?.[key];
      if (!entry?.qty || !entryPassesFilters(entry)) return false;

      if (activeTypeFilter !== CATALOG_TYPE_ALL) {
        const category = getCardTypeCategory(entry, lowerTypes);
        if (category !== activeTypeFilter) return false;
      }

      return true;
    });
  });

  const unsortedDeckCount = createMemo(() => {
    trackDeep(deck.cards);
    const lowerTypes = (cardSystem.types ?? []).map(type => type.toLowerCase());
    return getDeckList().reduce((sum, entry) => {
      if (!entry?.qty) return sum;
      const type = getCardTypeCategory(entry, lowerTypes);
      if (type || getSpecialDeckType(entry)) return sum;
      return sum + (entry.qty ?? 1);
    }, 0);
  });

  const filteredTokenEntries = createMemo(() =>
    deckTokenEntryList().filter(entry => entryMatchesSearch(entry)),
  );

  const getPrintTokenList = createMemo(() => {
    trackDeep(deck.tokens);
    return deckTokenEntryList()
      .map(entry => {
        const key = getTokenKey(entry.detail);
        const saved = deck.tokens?.[key];
        const qty = saved?.qty ?? entry.qty ?? 1;
        if (qty < 1) return undefined;
        return {
          ...entry,
          ...saved,
          qty,
          detail: saved?.detail ?? entry.detail,
        };
      })
      .filter((entry): entry is DetailedCardEntry => entry !== undefined);
  });

  return (
    <>
      <div class={styles.container} onDragOver={e => e.preventDefault()}>
        <form ref={formRef} class={styles.editorForm} onSubmit={onSaveDeck}>
          <div
            style='grid-area: header;'
            class='pr-7 pl-4 p-4  flex flex-row gap-2 items-center bg-background'>
            <div class={styles.tabBar}>
              <button
                type='button'
                class={tabButtonClass(typeFilter() === 'all')}
                onClick={() => setTypeFilter('all')}>
                All cards
              </button>
              <span class={styles.tabDivider} aria-hidden='true' />
              <button
                type='button'
                class={tabButtonClass(typeFilter() === 'deck')}
                onClick={() => setTypeFilter('deck')}>
                <span>Deck</span>
                <span>{deckQtyCount()}</span>
              </button>
              <For each={Object.entries(cardGrouping().types)}>
                {([type, grouping]) => (
                  <Show when={grouping.count > 0}>
                    <button
                      type='button'
                      class={tabButtonClass(typeFilter() === type)}
                      onClick={() => setTypeFilter(current => (current === type ? 'deck' : type))}>
                      <span>{grouping.name}</span>
                      <span>{grouping.count}</span>
                    </button>
                  </Show>
                )}
              </For>
              <For each={SPECIAL_DECK_TAB_TYPES}>
                {type => (
                  <Show when={specialTabCounts()[type] > 0}>
                    <button
                      type='button'
                      class={tabButtonClass(typeFilter() === type)}
                      onClick={() => setTypeFilter(current => (current === type ? 'deck' : type))}>
                      <span>{capitalize(type)}</span>
                      <span>{specialTabCounts()[type]}</span>
                    </button>
                  </Show>
                )}
              </For>
              <Show when={unsortedDeckCount() > 0}>
                <button
                  type='button'
                  class={tabButtonClass(typeFilter() === 'unsorted')}
                  onClick={() =>
                    setTypeFilter(current => (current === 'unsorted' ? 'deck' : 'unsorted'))
                  }>
                  <span>Unsorted</span>
                  <span>{unsortedDeckCount()}</span>
                </button>
              </Show>
              <Show when={sideboardQtyCount() > 0}>
                <button
                  type='button'
                  class={tabButtonClass(typeFilter() === 'sideboard')}
                  onClick={() =>
                    setTypeFilter(current => (current === 'sideboard' ? 'deck' : 'sideboard'))
                  }>
                  <span>Sideboard</span>
                  <span>{sideboardQtyCount()}</span>
                </button>
              </Show>
              <Show when={deckTokenPartIds().length > 0}>
                <button
                  type='button'
                  class={tabButtonClass(typeFilter() === 'tokens')}
                  onClick={() =>
                    setTypeFilter(current => (current === 'tokens' ? 'deck' : 'tokens'))
                  }>
                  <span>Tokens</span>
                </button>
              </Show>
            </div>
            <div class='ml-auto flex items-center gap-2'>
            <BracketEstimateTag bracket={deck.bracketEstimate} />
            <Button
              class='cursor-pointer'
              variant='outline'
              type='button'
              disabled={bracketLoading()}
              onClick={() => void openBracketEstimate()}>
              Estimate deck
            </Button>
            <Button
              class='cursor-pointer'
              variant='outline'
              type='button'
              onClick={() => {
                if (isDirty()) return openCloseConfirmDialog();
                props.onClose();
              }}>
              Close
            </Button>
            </div>
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
                        <BracketEstimateTag bracket={deck.bracketEstimate} class='mr-1' />
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
                  updateDeckCards('cards', getCardKey(entry), 'qty', number => number + 1);
                }}
                removeCard={entry =>
                  updateDeckCards('cards', getCardKey(entry), 'qty', number => Math.max(number - 1, 0))
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
                optionValue={card => getCardKey(card)}
                onChange={cards => {
                  updateDeck({
                    inPlay: Object.fromEntries(cards.map(card => [getCardKey(card), card])),
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
                    onClick={openExportDialog}>
                    <div class='flex gap-2'>
                      <CopyIcon class='text-muted-foreground' />
                      <span>Export deck</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={Object.values(deck.cards).filter(card => card.qty).length < 1}
                    onClick={openPrintDialog}>
                    <div class='flex gap-2'>
                      <PrinterIcon class='text-muted-foreground' />
                      <span>Print deck</span>
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
              class='top-0 sticky z-10 backdrop-blur-xl px-2 pt-2 pb-1'
              style='background: hsla(var(--background) / .7);'>
              <div class={styles.searchBarRow}>
                <Command
                  class='h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none'
                  style='background: transparent;'
                  value={searchParams.q || ''}>
                  <CommandInput
                    wrapperStyle='border-bottom: none; padding-inline: 0;'
                    class='h-9 py-1'
                    style='background: transparent;'
                    placeholder={searchPlaceholder()}
                    value={searchParams.q ?? ''}
                    onValueChange={q =>
                      setSearchParams({ q, page: undefined, totalPages: undefined })
                    }
                  />
                </Command>
                <Show when={showSearchTypeFilter()}>
                  <Select
                    placeholder='All types'
                    options={catalogTypeOptions()}
                    optionValue='value'
                    optionTextValue='label'
                    value={selectedCatalogType()}
                    onChange={option =>
                      setSearchParams({
                        catalogType:
                          !option?.value || option.value === CATALOG_TYPE_ALL
                            ? undefined
                            : option.value,
                        page: undefined,
                        totalPages: undefined,
                      })
                    }
                    itemComponent={props => (
                      <SelectItem item={props.item}>{props.item.rawValue.label}</SelectItem>
                    )}>
                    <SelectHiddenSelect />
                    <SelectTrigger aria-label='Card type' class={styles.catalogTypeSelect}>
                      <SelectValue<CatalogTypeOption> placeholder='All types'>
                        {state => state.selectedOption()?.label ?? 'All types'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </Show>
                <Show when={tabSupportsSubtypeFilter(typeFilter())}>
                  <SubtypeFilter
                    options={subtypeOptions()}
                    value={activeSubtypes()}
                    onChange={setActiveSubtypes}
                  />
                </Show>
              </div>
            </div>
            <div class={`p-4 ${styles.cardList}`}>
              <Show
                when={typeFilter() === 'all'}
                fallback={
                  <Show
                    when={typeFilter() === 'sideboard'}
                    fallback={
                      <Show
                        when={typeFilter() === 'tokens'}
                        fallback={
                          <For
                            each={filteredDeckCardKeys()}
                            keyed
                            fallback={
                              isSearching() ? (
                                <EmptyGridContainer
                                  isSearching
                                  importCardList={openImportDialog}
                                />
                              ) : typeFilter() !== 'deck' ? (
                                <div class='p-8 text-center text-muted-foreground'>
                                  <p>
                                    No{' '}
                                    {typeFilter() === 'unsorted'
                                      ? 'unsorted'
                                      : capitalize(typeFilter())}{' '}
                                    cards in this deck.
                                  </p>
                                  <Button
                                    class='mt-3'
                                    type='button'
                                    variant='secondary'
                                    onClick={() => setTypeFilter('deck')}>
                                    Show deck
                                  </Button>
                                </div>
                              ) : (
                                <EmptyGridContainer
                                  isSearching={false}
                                  importCardList={openImportDialog}
                                />
                              )
                            }>
                            {(storageKey, index) => (
                              <DeckGridCard
                                storageKey={storageKey}
                                index={index()}
                                section='cards'
                                card={() => deck.cards[storageKey]}
                                updateDeck={updateDeckCards}
                                onChangePrinting={changeCardPrinting}
                                onToggleCommander={toggleCommander}
                                onSendToSideboard={sendCardToSideboard}
                                onPreview={src => setSearchParams({ dialog: 'card-preview', src })}
                                onOpenPrintings={() => openPrintingPicker(storageKey)}
                              />
                            )}
                          </For>
                        }>
                        <Show
                          when={!deckTokens.loading}
                          fallback={
                            <div class='col-span-full flex flex-col items-center gap-3 p-8 text-muted-foreground'>
                              <LoaderIcon class='size-6 animate-spin' />
                              <p>Loading tokens...</p>
                            </div>
                          }>
                          <For
                            each={filteredTokenEntries()}
                            keyed={entry => getTokenKey(entry.detail)}
                            fallback={
                              isSearching() ? (
                                <EmptyGridContainer
                                  isSearching
                                  importCardList={openImportDialog}
                                />
                              ) : (
                                <div class='p-8 text-center text-muted-foreground'>
                                  <p>No tokens created by cards in this deck.</p>
                                  <Button
                                    class='mt-3'
                                    type='button'
                                    variant='secondary'
                                    onClick={() => setTypeFilter('deck')}>
                                    Show deck
                                  </Button>
                                </div>
                              )
                            }>
                            {(entry, index) => {
                              const tokenKey = () => getTokenKey(entry.detail);
                              return (
                                <DeckGridCard
                                  variant='token'
                                  storageKey={tokenKey()}
                                  index={index()}
                                  card={() => entry}
                                  pinnedPrintings={getTokenPinnedPrintings(tokenKey())}
                                  updateDeck={updateDeck}
                                  onChangePrinting={changeTokenPrinting}
                                  onPreview={src => setSearchParams({ dialog: 'card-preview', src })}
                                  onOpenPrintings={() => openTokenPrintingPicker(tokenKey())}
                                />
                              );
                            }}
                          </For>
                        </Show>
                      </Show>
                    }>
                    <For
                      each={filteredSideboardCardKeys()}
                      keyed
                      fallback={
                        isSearching() ? (
                          <EmptyGridContainer isSearching importCardList={openImportDialog} />
                        ) : (
                          <div class='p-8 text-center text-muted-foreground'>
                            <p>No sideboard cards in this deck.</p>
                            <Button
                              class='mt-3'
                              type='button'
                              variant='secondary'
                              onClick={() => setTypeFilter('deck')}>
                              Show deck
                            </Button>
                          </div>
                        )
                      }>
                      {(storageKey, index) => (
                        <DeckGridCard
                          storageKey={storageKey}
                          index={index()}
                          section='sideboard'
                          card={() => deck.sideboard![storageKey]}
                          updateDeck={updateSideboardCards}
                          onChangePrinting={(storageKey, printing) =>
                            void changeCardPrinting(storageKey, printing, 'sideboard')
                          }
                          onSendToDeck={sendCardToDeck}
                          onPreview={src => setSearchParams({ dialog: 'card-preview', src })}
                          onOpenPrintings={() => openPrintingPicker(storageKey, 'sideboard')}
                        />
                      )}
                    </For>
                  </Show>
                }>
                <Switch>
                  <Match when={!isSearching()}>
                    <CatalogEmptyState mode='browse' />
                  </Match>
                  <Match when={isSearching() && searchResults() === undefined}>
                    <CatalogEmptyState mode='loading' />
                  </Match>
                  <Match when={isSearching() && filteredSearchResults()?.length === 0}>
                    <CatalogEmptyState mode='empty' />
                  </Match>
                  <Match when={filteredSearchResults()?.length}>
                    <For each={filteredSearchResults()!}>
                    {(card, i) => {
                      const cardKey = () => getCardKey(card);
                      const deckMatch = () => findDeckEntryMatch(card, deck.cards ?? {});
                      const deckCard = () => deckMatch()?.entry;
                      const deckStorageKey = () => deckMatch()?.key ?? cardKey();
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
                          onContextMenu={e => handlePrintingContextMenu(e, deckStorageKey())}
                          onMouseDown={e => {
                            if (
                              e.button !== 2 ||
                              !supportsCardPrintings() ||
                              !(deckCard()?.qty > 0)
                            ) {
                              return;
                            }
                            const name = deckCard()?.name ?? card.name;
                            if (name) prefetchCardPrintings(name);
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
                                    <>
                                      <Show when={deckCard()?.qty > 0 && supportsCardPrintings()}>
                                        <Button
                                          type='button'
                                          variant='ghost'
                                          size='icon'
                                          title='Choose printing'
                                          onClick={e => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            openPrintingPicker(deckStorageKey());
                                          }}>
                                          <ImagesIcon />
                                        </Button>
                                      </Show>
                                      <Button
                                        type='button'
                                        variant='ghost'
                                        size='icon'
                                        title='Preview card'
                                        onClick={e => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          const src = getCardImage(card);
                                          if (src) {
                                            setSearchParams({ dialog: 'card-preview', src });
                                          }
                                        }}>
                                        <SearchIcon />
                                      </Button>
                                    </>
                                  }>
                                  <div class='pl-2'>{card.name}</div>
                                </Show>
                                <Show when={deckCard()?.qty > 0}>
                                  <Button
                                    size='icon'
                                    variant='ghost'
                                    type='button'
                                    onClick={() => {
                                      const match = findDeckEntryMatch(unwrap(card), deck.cards);
                                      if (match) {
                                        return updateDeckCards('cards', match.key, 'qty', (qty = 1) =>
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
                                    const match = findDeckEntryMatch(unwrap(card), deck.cards);
                                    if (match) {
                                      return updateDeckCards('cards', match.key, 'qty', (qty = 1) => qty + 1);
                                    }
                                    const id = getCardKey(unwrap(card));
                                    updateDeckCards('cards', id, { ...unwrap(card), qty: 1 });
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
                  </Match>
                </Switch>
              </Show>
            </div>
            <Show when={isCatalogTab()}>
              <div use:intersectionObserver={{ onIntersect: loadMoreResults }}>
                <Show
                  when={
                    isSearching() &&
                    Number(searchParams.page) < Number(searchParams.totalPages)
                  }>
                  <div class='flex gap-2 justify-center p-6'>
                    <LoaderIcon class='animate-spin' /> Loading more results
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </form>
      </div>

      <Portal>
        <CommanderBracketModal
          open={bracketModalOpen()}
          loading={bracketLoading()}
          error={bracketError()}
          result={bracketResult()}
          shareUrl={bracketShareUrl()}
          onClose={closeBracketModal}
        />
        <Show when={printingPickerKey() && deck[printingPickerSection()]?.[printingPickerKey()!]}>
          <PrintingPickerModal
            entry={deck[printingPickerSection()]![printingPickerKey()!]}
            onClose={() => setPrintingPickerKey(undefined)}
            onSelect={printing => {
              void changeCardPrinting(printingPickerKey()!, printing, printingPickerSection());
              setPrintingPickerKey(undefined);
            }}
            onSelectCustomArt={option => {
              changeCardCustomArt(printingPickerKey()!, option, printingPickerSection());
              setPrintingPickerKey(undefined);
            }}
          />
        </Show>
        <Show
          when={
            tokenPrintingPickerKey() &&
            deckTokenEntryList().find(item => getTokenKey(item.detail) === tokenPrintingPickerKey())
          }>
          <PrintingPickerModal
            entry={
              deckTokenEntryList().find(
                item => getTokenKey(item.detail) === tokenPrintingPickerKey(),
              )!
            }
            pinnedPrintings={getTokenPinnedPrintings(tokenPrintingPickerKey()!)}
            onClose={() => setTokenPrintingPickerKey(undefined)}
            onSelect={printing => {
              void changeTokenPrinting(tokenPrintingPickerKey()!, printing);
              setTokenPrintingPickerKey(undefined);
            }}
            onSelectCustomArt={option => {
              changeTokenCustomArt(tokenPrintingPickerKey()!, option);
              setTokenPrintingPickerKey(undefined);
            }}
          />
        </Show>
        <Show when={importDialogOpen()}>
          <DeckImportDialog
            onClose={closeImportDialog}
            onImport={importedDeck => {
              invalidateBracketEstimate();
              setDeck('cards', reconcile(importedDeck.cards ?? {}, { merge: false }));
              setDeck('inPlay', reconcile(importedDeck.inPlay ?? {}, { merge: false }));
              setDeck('sideboard', reconcile(importedDeck.sideboard ?? {}, { merge: false }));
              if (importedDeck.name) setDeck('name', importedDeck.name);
              if (importedDeck.system && importedDeck.system !== deck.system) {
                setDeck('system', importedDeck.system);
              }
              setIsDirty(true);
              closeImportDialog();
            }}
          />
        </Show>
        <Show when={printDialogOpen()}>
          <PrintDeckModal
            open={printDialogOpen()}
            deckName={getDeckName()}
            cards={getDeckList()}
            sideboardCards={getSideboardList()}
            tokenCards={getPrintTokenList()}
            onClose={closePrintDialog}
          />
        </Show>
        <Show when={exportDialogOpen()}>
          <ExportDeckModal
            open={exportDialogOpen()}
            content={deckExportContent()}
            onClose={closeExportDialog}
          />
        </Show>
        <Show when={newDeckTipOpen()}>
          <EditorOverlayDialog onClose={closeNewDeckTip}>
            <DialogHeader>
              <DialogTitle>Choosing card art</DialogTitle>
            </DialogHeader>
            <p>
Mark your commander card with the star icon in the card.
Right click an added card to choose an official impression or community ones.

            </p>
            <DialogFooter>
              <Button type='button' onClick={closeNewDeckTip}>
                Got it
              </Button>
            </DialogFooter>
          </EditorOverlayDialog>
        </Show>
        <Show when={closeConfirmDialogOpen()}>
          <EditorOverlayDialog onClose={closeConfirmDialog}>
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
            </DialogHeader>
            <p>Are you sure you want to close the deck editor?</p>
            <p>
              All <b>unsaved changes</b> will <b>be lost</b>
            </p>
            <DialogFooter>
              <Button variant='ghost' type='button' onClick={closeConfirmDialog}>
                Cancel
              </Button>
              <Button
                type='button'
                onClick={() => {
                  closeConfirmDialog();
                  props.onClose();
                }}>
                Close Without Saving
              </Button>
            </DialogFooter>
          </EditorOverlayDialog>
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
        <Show when={searchParams.dialog === 'card-preview' && searchParams.src}>
          <EditorOverlayDialog onClose={closeCurrentDialog}>
            <img
              src={searchParams.src as string}
              alt=''
              class='mx-auto max-h-[80vh] w-auto max-w-full rounded-md'
            />
          </EditorOverlayDialog>
        </Show>
      </Portal>
    </>
  );
};

function CatalogEmptyState(props: { mode: 'browse' | 'loading' | 'empty' }) {
  return (
    <div class='p-8 flex-col flex gap-4'>
      <Switch>
        <Match when={props.mode === 'loading'}>
          <Alert class='inline-block'>
            <AlertTitle>Searching</AlertTitle>
            <AlertDescription>
              <p>Loading search results...</p>
            </AlertDescription>
          </Alert>
        </Match>
        <Match when={props.mode === 'empty'}>
          <Alert class='inline-block'>
            <AlertTitle>No Results Found</AlertTitle>
            <AlertDescription>
              <p>Sorry, we couldn't find any MTG cards matching that search.</p>
            </AlertDescription>
          </Alert>
        </Match>
        <Match when>
          <Alert class='inline-block'>
            <AlertTitle>Browse all MTG cards</AlertTitle>
            <AlertDescription>
              <p>Search above to find and add cards from the full card catalog.</p>
            </AlertDescription>
          </Alert>
        </Match>
      </Switch>
    </div>
  );
}

function EmptyGridContainer(props: {
  isSearching: boolean;
  importCardList(): void;
}) {
  return (
    <div class='p-8 flex-col flex gap-4'>
      <Switch>
        <Match when={props.isSearching}>
          <Alert class='inline-block'>
            <AlertTitle>No Results Found</AlertTitle>
            <AlertDescription>
              <p>Sorry, we couldn't find any cards matching that search in this tab.</p>
            </AlertDescription>
          </Alert>
        </Match>
        <Match when>
          <Alert class='inline-block'>
            <AlertTitle>Your deck doesn't have any cards</AlertTitle>
            <AlertDescription>
              <p>Add cards from All cards, or import a card list</p>
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

function EditorOverlayDialog(props: { onClose(): void; children: JSX.Element }) {
  return (
    <Portal>
      <div class='fixed inset-0 z-[70] flex items-start justify-center sm:items-center'>
        <Dialog modal open onOpenChange={isOpen => !isOpen && props.onClose()}>
          <DialogOverlay class='z-[70]' />
          <DialogContentExtended
            class='z-[70] max-w-lg'
            onInteractOutside={e => e.preventDefault()}>
            {props.children}
          </DialogContentExtended>
        </Dialog>
      </div>
    </Portal>
  );
}

function ConfirmDeleteDialog(props: { name: string; onClose(): void; onDelete(): void }) {
  return (
    <EditorOverlayDialog onClose={props.onClose}>
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
    </EditorOverlayDialog>
  );
}

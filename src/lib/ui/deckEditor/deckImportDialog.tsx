import { debounce } from 'lodash-es';

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';

import { Portal } from 'solid-js/web';

import { createStore, reconcile } from 'solid-js/store';

import { Button } from '~/components/ui/button';

import {

  Dialog,

  DialogContentExtended,

  DialogFooter,

  DialogHeader,

  DialogOverlay,

  DialogTitle,

} from '~/components/ui/dialog';

import { TextField, TextFieldTextArea } from '~/components/ui/text-field';

import { CardSystem, Deck, DetailedCardEntry } from '~/lib/constants';

import { parseImportedCardList } from '~/lib/deck';
import { buildImportedInPlay, fetchCardInfoForImport } from '~/lib/deckImportLookup';

import useCardGrouping from './cardGroupings';

import { cardSystem } from '~/lib/globals';

import {

  Select,

  SelectContent,

  SelectHiddenSelect,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from '~/components/ui/select';

import { useCardSystemContext } from '~/lib/cardSystemContext';

import LoaderIcon from 'lucide-solid/icons/loader-circle';



export interface DeckImportDialogProps {

  onClose(): void;

  onImport(deck: Deck): void;

}



let cache = new Map();

const DECK_LIST_PLACEHOLDER = `Deck
4 Lightning Bolt
Commander
1x Alela, Artful Provocateur (brc) 119
1 Orcish Bowmasters [ltr] #433`;

export default function DeckImportDialog(props: DeckImportDialogProps) {

  const [cardSystemStore, { setCardSystem }] = useCardSystemContext();

  const [textContent, setTextContent] = createSignal('');

  const [deck, updateDeck] = createStore<Deck>({ name: '', cards: {}, inPlay: {} } as Deck);

  const [loading, setLoading] = createSignal(false);

  const [progress, setProgress] = createSignal({ current: 0, total: 0, name: '' });



  const foundCards = () => Object.values(deck?.cards || {}).filter(card => card.found !== false);

  const importStats = createMemo(() => {
    const entries = Object.values(deck?.cards || {});
    const found = entries.filter(card => card.found !== false);
    const foundQty = found.reduce((sum, card) => sum + (card.qty ?? 1), 0);
    const totalQty = entries.reduce((sum, card) => sum + (card.qty ?? 1), 0);
    return { foundQty, totalQty };
  });

  const cardGrouping = useCardGrouping(cardSystem.types ?? [], foundCards);



  const notFoundList = () => Object.values(deck?.cards || {}).filter(card => card.found === false) ?? [];

  const printingMismatchList = () =>

    Object.values(deck?.cards || {}).filter(card => card.found !== false && card.printingMismatch) ?? [];



  function formatRequestedPrinting(card: DetailedCardEntry) {

    const parts = [card.name];

    if (card.set) parts.push(`[${card.set.toUpperCase()}]`);

    if (card.collector_number) parts.push(`#${card.collector_number}`);

    return parts.join(' ');

  }



  function formatResolvedPrinting(card: DetailedCardEntry) {

    const set = card.detail?.set?.toUpperCase();

    const collector = card.detail?.collector_number;

    if (set && collector) return `${set} #${collector}`;

    if (set) return set;

    return 'default printing';

  }



  function handleDrop(event: DragEvent) {

    event.preventDefault();

    if (!event.dataTransfer) return;

    let { files } = event.dataTransfer;

    if (files.length > 0) {

      let file = files[0];

      let name = file.name.slice(0, file.name.lastIndexOf('.')).replace(/^Deck\s\-\s/, '');

      updateDeck('name', name);

      file.text().then(text => {

        setTextContent(text);

      });

    }

  }



  let parseGeneration = 0;

  async function parseDeckList(cardListText: string) {
    const generation = ++parseGeneration;
    const trimmed = cardListText.trim();

    if (!trimmed) {
      setLoading(false);
      setProgress({ current: 0, total: 0, name: '' });
      updateDeck('cards', reconcile({}));
      updateDeck('inPlay', reconcile({}));
      return;
    }

    const { cards: newCardEntries, inPlayIndices } = parseImportedCardList(cardListText);
    cache.clear();
    setLoading(true);
    setProgress({ current: 0, total: newCardEntries.length, name: '' });

    try {
      const cards = await fetchCardInfoForImport(newCardEntries, cache, (current, total, name) => {
        if (generation !== parseGeneration) return;
        setProgress({ current, total, name });
      });

      if (generation !== parseGeneration) return;

      updateDeck('cards', reconcile(cards));
      updateDeck('inPlay', reconcile(buildImportedInPlay(newCardEntries, inPlayIndices, cards)));
    } finally {
      if (generation === parseGeneration) {
        setLoading(false);
        setProgress({ current: 0, total: 0, name: '' });
      }
    }
  }



  onMount(() => {

    cache.clear();

    window.addEventListener('drop', handleDrop, { passive: false });

  });



  onCleanup(() => {

    window.removeEventListener('drop', handleDrop);

    parseGeneration++;

  });



  createEffect(() => {

    parseDeckList(textContent());

  });



  const debouncedSetTextContent = debounce(setTextContent, 750, { trailing: true });



  return (

    <Dialog modal open onOpenChange={isOpen => !isOpen && !loading() && props.onClose()}>

      <Portal>

        <div class='fixed inset-0 z-[70] flex items-start justify-center sm:items-center'>

          <DialogOverlay class='z-[70]' onDragOver={e => e.preventDefault()} />

          <DialogContentExtended

            class='z-[70] max-w-4xl'

            onInteractOutside={e => {

              e.preventDefault();

            }}>

          <DialogHeader>

            <DialogTitle>Import Card List</DialogTitle>

          </DialogHeader>

          <p>Would you like to import an existing card list?</p>

          <div class='flex'>

            <TextField class='flex-2'>

              <TextFieldTextArea

                class='h-96 whitespace-pre'

                placeholder={DECK_LIST_PLACEHOLDER}

                onInput={e => {

                  debouncedSetTextContent(e.currentTarget.value)

                }}

                value={textContent()}

              />

            </TextField>

            <Show when={textContent()?.length}>

              <div class='flex-3 px-4'>

                <Select

                  class='mb-4'

                  value={cardSystem}

                  name='system'

                  optionValue='id'

                  optionTextValue='name'

                  onChange={async system => {

                    await setCardSystem(system?.id);

                    updateDeck('system', system?.id);

                    cache.clear();

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



                <Show when={loading()}>

                  <div class='mb-4 flex items-center gap-2 text-sm text-muted-foreground'>

                    <LoaderIcon class='size-4 animate-spin' />

                    <span>

                      Looking up cards{' '}

                      {progress().total > 0

                        ? `(${progress().current}/${progress().total})`

                        : ''}

                      {progress().name ? `: ${progress().name}` : ''}

                    </span>

                  </div>

                </Show>



                <label>
                  {importStats().foundQty} of {importStats().totalQty} cards found
                  <Show when={printingMismatchList().length > 0}>
                    {' '}
                    · {printingMismatchList().length} exact printing
                    {printingMismatchList().length === 1 ? '' : 's'} not found
                  </Show>
                  <Show when={notFoundList().length > 0}>
                    {' '}
                    · {notFoundList().length} not found
                  </Show>
                </label>

                <div class='flex flex-wrap gap-2 my-2'>

                  <For each={Object.values(cardGrouping().types)}>

                    {grouping => (

                      <Show when={grouping.count > 0}>

                        <div class='flex gap-1 border-l-2 px-2 py-1'>

                          <span>{grouping.name}</span>

                          <span>{grouping.count}</span>

                        </div>

                      </Show>

                    )}

                  </For>

                </div>



                <Show when={printingMismatchList().length > 0}>

                  <hr class='my-4' />

                  <label>Exact printing not found ({printingMismatchList().length})</label>

                  <For each={printingMismatchList()}>

                    {card => (

                      <div class='text-yellow-600 dark:text-yellow-400'>

                        {formatRequestedPrinting(card)} — using {formatResolvedPrinting(card)}

                      </div>

                    )}

                  </For>

                </Show>



                <Show when={notFoundList()?.length > 0}>

                  <hr class='my-4' />

                  <label>Cards not found ({notFoundList().length})</label>

                  <For

                    each={notFoundList()}

                    fallback={<p class='text-muted-foreground'>All cards found</p>}>

                    {card => (

                      <div class='mb-2 text-error-foreground'>

                        <div>{formatRequestedPrinting(card)}</div>

                        <Show when={card.importLookupReason}>

                          <div class='text-xs text-muted-foreground'>{card.importLookupReason}</div>

                        </Show>

                        <Show when={card.importLookupTrace?.length}>

                          <details class='text-xs text-muted-foreground'>

                            <summary class='cursor-pointer'>Lookup steps</summary>

                            <ul class='mt-1 list-disc pl-4'>

                              <For each={card.importLookupTrace}>

                                {step => <li>{step}</li>}

                              </For>

                            </ul>

                          </details>

                        </Show>

                      </div>

                    )}

                  </For>

                </Show>

              </div>

            </Show>

          </div>

          <DialogFooter>

            <Button variant='ghost' disabled={loading()} onClick={props.onClose}>

              Continue without importing

            </Button>

            <Button disabled={loading()} onClick={() => props.onImport(deck)}>

              Import Card List

            </Button>

          </DialogFooter>

        </DialogContentExtended>

        </div>

      </Portal>

    </Dialog>

  );

}



import { debounce } from 'lodash-es';
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentExtended,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '~/components/ui/dialog';
import { TextField, TextFieldTextArea } from '~/components/ui/text-field';
import { Card, CardSystem, Deck, DetailedCardEntry } from '~/lib/constants';
import { fetchCardInfo, loadCardList } from '~/lib/deck';
import { getCardKey } from '~/lib/deckStore';
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

export interface DeckImportDialogProps {
  onClose(): void;
  onImport(deck: Deck): void;
}

let cache = new Map();

export default function DeckImportDialog(props: DeckImportDialogProps) {
  const [cardSystemStore, { setCardSystem }] = useCardSystemContext();
  const [textContent, setTextContent] = createSignal('');
  const [deck, updateDeck] = createStore<Deck>({ name: '', cards: {} } as Deck);

  const cardGrouping = useCardGrouping(cardSystem.types ?? [], () => Object.values(deck.cards));

  const notFoundList = () => Object.values(deck?.cards || {}).filter(card => !card.found) ?? [];

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (!event.dataTransfer) return;
    let { files } = event.dataTransfer;
    if (files.length > 0) {
      let file = files[0];
      let name = file.name.slice(0, file.name.lastIndexOf('.')).replace(/^Deck\s\-\s/, '');
      updateDeck('name', name);
      file.text().then(result => {
        setTextContent(result);
      });
    }
  }

  function handlePaste(event) {
    const text = event.clipboardData.getData('text');
    setTextContent(text);
  }

  async function parseDeckList(cardListText: string) {
    let newCardEntries = loadCardList(cardListText);
    let newCardList = await Promise.all(newCardEntries.map(entry => fetchCardInfo(entry, cache)));

    let cards: Record<string, DetailedCardEntry> = {};

    for (const card of newCardList) {
      const key = getCardKey(card);
      cards[key] = card;
    }
    updateDeck('cards', reconcile(cards));
  }

  onMount(() => {
    window.addEventListener('drop', handleDrop, { passive: false });
    window.addEventListener('paste', handlePaste, { passive: false });
  });

  onCleanup(() => {
    window.removeEventListener('drop', handleDrop);
    window.removeEventListener('paste', handlePaste);
  });

  createEffect(() => {
    parseDeckList(textContent());
  });

  const debouncedSetTextContent = debounce(setTextContent, 750, { trailing: true });

  return (
    <Dialog modal open onOpenChange={isOpen => !isOpen && props.onClose()}>
      <DialogPortal>
        <DialogOverlay onDragOver={e => e.preventDefault()} />
        <DialogContentExtended
          class='max-w-4xl'
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
                placeholder='Paste a decklist or drop a deck list file'
                onInput={e => debouncedSetTextContent(e.currentTarget.value)}
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
                <label>Cards Found</label>
                <div class='flex flex-wrap gap-2 my-2'>
                  <div class='flex gap-1 border-1 px-2 py-1 rounded'>
                    <span>Total</span>
                    <span>{cardGrouping().totalCount}</span>
                  </div>
                  <For each={Object.values(cardGrouping().types)}>
                    {grouping => (
                      <Show when={grouping.count > 0}>
                        <div class='flex gap-1 border-1 px-2 py-1 rounded'>
                          <span>{grouping.name}</span>
                          <span>{grouping.count}</span>
                        </div>
                      </Show>
                    )}
                  </For>
                </div>

                <hr class='my-4' />
                <label>Cards not found</label>
                <For
                  each={notFoundList()}
                  fallback={<p class='text-muted-foreground'>All cards found</p>}>
                  {card => <div class='text-error-foreground'>{card.name}</div>}
                </For>
              </div>
            </Show>
          </div>
          <DialogFooter>
            <Button variant='ghost' onClick={props.onClose}>
              Continue without importing
            </Button>
            <Button onClick={() => props.onImport(deck)}>Import Card List</Button>
          </DialogFooter>
        </DialogContentExtended>
      </DialogPortal>
    </Dialog>
  );
}

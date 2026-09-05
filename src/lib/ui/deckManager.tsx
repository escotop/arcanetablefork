import { Component, createSignal, For, JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { toast } from 'solid-sonner';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { getDeckPreviewImageUrl } from '../deck';
import { createDeckStore } from '../deckStore';
import { useCardSystemContext } from '../cardSystemContext';
import { colorHashDark } from '../globals';
import { exportAllDecksZip, mergeImportedDecks, parseDecksZip } from '../deckBulkTransfer';
import PencilIcon from 'lucide-solid/icons/pencil';
import { DeckEditor } from './deckEditor';
import BracketEstimateTag from './bracketEstimateTag';
import styles from './deckPicker.module.css';
import { Deck } from '../constants';
import { produce, unwrap } from 'solid-js/store';

interface DeckManagerDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  hideClose?: boolean;
  selectedDeckId?: string;
  onSelectDeck?: (id: string) => void;
  footerStart?: JSX.Element;
  footer?: JSX.Element;
}

export const DeckManagerDialog: Component<DeckManagerDialogProps> = props => {
  const [deckStore, setDeckStore] = createDeckStore();
  const [cardSystemStore] = useCardSystemContext();
  const [editingDeck, setEditingDeck] = createSignal<Deck>();
  const [importing, setImporting] = createSignal(false);
  let importInput: HTMLInputElement | undefined;
  const [selectedDeckId, setSelectedDeckId] = createSignal(
    props.selectedDeckId ?? deckStore?.systems[cardSystemStore.system]?.[0],
  );

  function shouldShowSystem(system: string) {
    if (!cardSystemStore) return false;
    if (cardSystemStore.system === 'unsorted' && system === 'unsorted') return false;
    return system !== cardSystemStore.system;
  }

  function currentSelection() {
    return props.selectedDeckId ?? selectedDeckId();
  }

  function handleSelect(deckId: string) {
    if (props.selectedDeckId === undefined) {
      setSelectedDeckId(deckId);
    }
    props.onSelectDeck?.(deckId);
  }

  function onExportAll() {
    try {
      exportAllDecksZip(deckStore.decks);
      toast.success('Decks exported');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    }
  }

  async function onImportFile(file: File) {
    setImporting(true);
    try {
      const imported = parseDecksZip(await file.arrayBuffer());
      if (!imported.length) {
        toast.error('No deck JSON files found in zip');
        return;
      }

      const merged = mergeImportedDecks(imported, {
        decks: deckStore.decks,
        systems: deckStore.systems,
      });
      setDeckStore(merged);
      toast.success(`Imported ${imported.length} deck${imported.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
      if (importInput) importInput.value = '';
    }
  }

  return (
    <>
      <Show when={editingDeck()} keyed>
        {deck => (
          <Portal>
            <DeckEditor
              onClose={() => setEditingDeck()}
              deck={structuredClone(unwrap(deck))}
              onChange={updatedDeck => {
                let fromSystem = unwrap(editingDeck()?.system) || 'unsorted';
                let toSystem = updatedDeck.system || 'unsorted';

                setDeckStore('systems', fromSystem, (entries = []) =>
                  entries.filter(id => id !== deck.id),
                );

                setDeckStore('systems', 'unsorted', (entries = []) =>
                  entries.filter(id => id !== deck.id),
                );

                setDeckStore('systems', toSystem, (entries = []) => [
                  updatedDeck.id,
                  ...entries.filter(id => id !== updatedDeck.id),
                ]);
                setDeckStore('decks', { [updatedDeck.id]: updatedDeck });
              }}
              onDelete={() => {
                const deckId = deck.id;
                setDeckStore(
                  produce(state => {
                    delete state.decks[deckId];
                    for (const system of Object.keys(state.systems)) {
                      state.systems[system] = (state.systems[system] ?? []).filter(
                        id => id !== deckId,
                      );
                    }
                  }),
                );
              }}
            />
          </Portal>
        )}
      </Show>
      <Show when={!editingDeck()}>
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
          <DialogContent class='max-w-3xl' hideClose={props.hideClose}>
            <DialogHeader>
              <DialogTitle>{props.title ?? 'Your Decks'}</DialogTitle>
            </DialogHeader>
            <div class='flex flex-col gap-5'>
              <div>
                <h2>{cardSystemStore?.systems?.[cardSystemStore.system]?.name}</h2>
                <div class='grid grid-cols-3 gap-4 my-2'>
                  <For each={deckStore.systems[cardSystemStore?.system] ?? []}>
                    {deckId => {
                      let deck = () => deckStore.decks[deckId];
                      return (
                        <Show when={deck()}>
                          <DeckOption
                            deck={deck()!}
                            isSelected={
                              props.onSelectDeck ? deck()!.id === currentSelection() : false
                            }
                            onSelect={() => handleSelect(deck()!.id)}
                            onEdit={() => setEditingDeck(deck())}
                            selectable={!!props.onSelectDeck}
                          />
                        </Show>
                      );
                    }}
                  </For>
                </div>

                <For each={Object.entries(deckStore.systems)}>
                  {([system, deckIds]) => (
                    <Show when={shouldShowSystem(system) && deckIds.length > 0}>
                      <h2>{cardSystemStore.systems[system]?.name ?? system}</h2>
                      <div class='grid grid-cols-3 gap-4 my-2'>
                        <For each={deckIds}>
                          {deckId => {
                            let deck = deckStore.decks[deckId];
                            return (
                              <Show when={deck}>
                                <DeckOption
                                  deck={deck}
                                  isSelected={
                                    props.onSelectDeck ? deck.id === currentSelection() : false
                                  }
                                  onSelect={() => handleSelect(deck.id)}
                                  onEdit={() => setEditingDeck(deck)}
                                  selectable={!!props.onSelectDeck}
                                />
                              </Show>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  )}
                </For>
              </div>
              <DialogFooter class='flex-wrap gap-2 sm:justify-between'>
                <div class='flex flex-wrap gap-2 mr-auto'>
                  <Button variant='ghost' type='button' onClick={onExportAll}>
                    Export all
                  </Button>
                  <Button
                    variant='ghost'
                    type='button'
                    disabled={importing()}
                    onClick={() => importInput?.click()}>
                    {importing() ? 'Importing…' : 'Import in bulk'}
                  </Button>
                  <input
                    ref={importInput}
                    type='file'
                    accept='.zip,application/zip'
                    class='hidden'
                    onChange={e => {
                      const file = e.currentTarget.files?.[0];
                      if (file) void onImportFile(file);
                    }}
                  />
                </div>
                <div class='flex flex-wrap gap-2 justify-end'>
                  {props.footerStart}
                  <Button variant='outline' type='button' onClick={() => setEditingDeck({})}>
                    Create Deck
                  </Button>
                  {props.footer ?? (
                    <Button variant='ghost' type='button' onClick={() => props.onOpenChange?.(false)}>
                      Close
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </Show>
    </>
  );
};

interface DeckOptionProps {
  onSelect(): void;
  onEdit(): void;
  isSelected: boolean;
  selectable: boolean;
  deck: Deck;
}

function DeckOption(props: DeckOptionProps) {
  return (
    <div
      style='position: relative; aspect-ratio: 626/457;'
      class='relative rounded-lg overflow-hidden shadow-lg'
      classList={{ [styles.selectedRadioItem]: props.isSelected }}>
      <button
        style='width: 100%; height: 100%;'
        type='button'
        onClick={() => props.selectable && props.onSelect()}
        disabled={!props.selectable}>
        <div
          class='bg-cover'
          style={`background-image: url(${getDeckPreviewImageUrl(props.deck)}); height: 100%;`}></div>
        <div class='absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent py-4 px-2 text-left'>
          <h3 class='text-white text-xl font-semibold'>{props.deck?.name}</h3>
          <div class='flex flex-row gap-2 pt-2 flex-wrap'>
            <BracketEstimateTag bracket={props.deck.bracketEstimate} />
            <For each={props.deck.tags}>
              {tag => (
                <span
                  class='text-white rounded-md h-7 px-3 text-sm inline-flex items-center justify-center whitespace-nowrap'
                  style={`background-color: ${colorHashDark.hex(tag.name)};`}>
                  {tag.name}
                </span>
              )}
            </For>
          </div>
        </div>
      </button>
      <div class='absolute top-2 right-2'>
        <button type='button' style='cursor: pointer;' onClick={props.onEdit}>
          <PencilIcon style='color: white; filter: drop-shadow(2px 4px 6px black);' />
        </button>
      </div>
    </div>
  );
}

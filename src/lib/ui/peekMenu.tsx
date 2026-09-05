import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Command, CommandInput } from '~/components/ui/command';
import { Menubar, MenubarItem, MenubarMenu } from '~/components/ui/menubar';
import { cn } from '~/lib/utils';
import { Card } from '../constants';
import {
  cardSystem,
  cardsById,
  doAfter,
  doXTimes,
  getLocalPlayArea,
  getLocalPlayerClientId,
  hoverSignal,
  peekFilterText,
  peekTypeFilter,
  setHoverSignal,
  setPeekFilterText,
  setPeekTypeFilter,
} from '../globals';
import { transferCard } from '../transferCard';
import useCardGrouping from './deckEditor/cardGroupings';
import MoveMenu from './moveMenu';
import styles from './peekMenu.module.css';

const PeekMenu: Component = props => {
  let userData = () => hoverSignal()?.mesh?.userData;
  const isOwner = createMemo(() => userData()?.clientId === getLocalPlayerClientId());
  const location = createMemo(() => userData()?.location);
  const playArea = () => getLocalPlayArea();

  const peekCards = createMemo(() => {
    const area = playArea();
    if (!area) return [] as Card[];
    area.peekZone.observable.cardCount;
    return [...area.peekZone.cards];
  });

  const cardCount = () => peekCards().length;
  const card = () => cardsById.get(hoverSignal()?.mesh?.userData.id);
  const [viewField, setViewField] = createSignal(false);
  let inputRef;

  const cardGrouping = useCardGrouping(cardSystem.types ?? [], peekCards);

  function drawAfterRevealing(card: Card) {
    const area = playArea();
    if (!area) return;
    drawWithoutRevealing(card);
    area.reveal(card);
  }

  function drawWithoutRevealing(card: Card) {
    const area = playArea();
    if (!area) return;
    transferCard(card, area.peekZone, area.hand);
  }

  function dismissPeek() {
    const area = playArea();
    if (!area) return;
    setPeekFilterText('');
    setPeekTypeFilter(null);
    void area.dismissFromZone(area.peekZone);
  }

  createEffect(() => {
    if (location() === 'peek' && isOwner() && inputRef) {
      inputRef.focus();
    }
  });

  return (
    <>
      <Show when={peekCards().length > 0 && playArea()?.peekZone?.observable}>
        <div class={styles.searchContainer}>
          <div class={styles.searchHeader}>
            <div class={styles.search}>
            <div class='mb-3 flex flex-wrap gap-2'>
              <button
                type='button'
                class={cn(
                  'rounded px-2 py-1 text-sm text-white transition-colors hover:bg-white/10',
                  !peekTypeFilter() && 'bg-white/20 font-semibold',
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
                        'flex gap-1 border-l-2 border-white/30 px-2 py-1 text-sm text-white transition-colors hover:bg-white/10',
                        peekTypeFilter() === type && 'bg-white/20 font-semibold',
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
                    'flex gap-1 border-l-2 border-white/30 px-2 py-1 text-sm text-white transition-colors hover:bg-white/10',
                    peekTypeFilter() === 'unsorted' && 'bg-white/20 font-semibold',
                  )}
                  onClick={() =>
                    setPeekTypeFilter(current => (current === 'unsorted' ? null : 'unsorted'))
                  }>
                  <span>Unsorted</span>
                  <span>{cardGrouping().unsorted.count}</span>
                </button>
              </Show>
            </div>
            <Command
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  dismissPeek();
                }
              }}>
              <CommandInput
                ref={inputRef}
                placeholder='Search'
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
                    dismissPeek();
                  }
                }}
                onValueChange={value => {
                  setPeekFilterText(value);
                }}
              />
              <Menubar>
                <MenubarMenu>
                  <MenubarItem
                    class='whitespace-nowrap'
                    onClick={async () => {
                      const area = playArea();
                      if (!area) return;
                      await area.transferEntireZone(area.peekZone, area.deck, {
                        location: 'bottom',
                      });
                      await doAfter(100, () => area.shuffleDeck());

                      setHoverSignal();
                    }}>
                    Shuffle into deck
                  </MenubarItem>
                  <MenubarItem
                    class='whitespace-nowrap'
                    onClick={() => {
                      const area = playArea();
                      if (!area) return;
                      doXTimes(cardCount(), () => drawAfterRevealing(area.peekZone.cards[0]));
                    }}>
                    Reveal & Draw All
                  </MenubarItem>
                  <MenubarItem
                    class='whitespace-nowrap'
                    onClick={() => {
                      const area = playArea();
                      if (!area) return;
                      doXTimes(cardCount(), () => drawWithoutRevealing(area.peekZone.cards[0]));
                    }}>
                    Draw All
                  </MenubarItem>
                  <MoveMenu
                    text='Move All To'
                    cards={playArea()!.peekZone.cards}
                    playArea={playArea()!}
                    fromZone={playArea()!.peekZone}
                  />
                  <Switch>
                    <Match when={viewField()}>
                      <MenubarItem
                        class='whitespace-nowrap'
                        onClick={() => {
                          const area = playArea();
                          if (!area) return;
                          area.peekZone.viewGrid();
                          setViewField(false);
                        }}>
                        View Grid
                      </MenubarItem>
                    </Match>
                    <Match when>
                      <MenubarItem
                        variant='ghost'
                        class='whitespace-nowrap'
                        onClick={() => {
                          const area = playArea();
                          if (!area) return;
                          area.peekZone.viewField();
                          setViewField(true);
                        }}>
                        View Field
                      </MenubarItem>
                    </Match>
                  </Switch>
                  <MenubarItem class='whitespace-nowrap ml-auto' onClick={dismissPeek}>
                    Dismiss
                  </MenubarItem>
                </MenubarMenu>
              </Menubar>
            </Command>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
};

export default PeekMenu;

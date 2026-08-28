import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { Command, CommandInput } from '~/components/ui/command';
import { Menubar, MenubarItem, MenubarMenu } from '~/components/ui/menubar';
import { Card } from '../constants';
import {
  cardsById,
  doAfter,
  doXTimes,
  getLocalPlayArea,
  getLocalPlayerClientId,
  hoverSignal,
  peekFilterText,
  setHoverSignal,
  setPeekFilterText,
} from '../globals';
import { transferCard } from '../transferCard';
import MoveMenu from './moveMenu';
import styles from './peekMenu.module.css';

const PeekMenu: Component = props => {
  let userData = () => hoverSignal()?.mesh?.userData;
  const isOwner = createMemo(() => userData()?.clientId === getLocalPlayerClientId());
  const location = createMemo(() => userData()?.location);
  const playArea = () => getLocalPlayArea();
  const cardCount = () => playArea()?.peekZone.cards.length ?? 0;
  const card = () => cardsById.get(hoverSignal()?.mesh?.userData.id);
  const [viewField, setViewField] = createSignal(false);
  let inputRef;
  const [peekCards, setPeekCards] = createSignal<Card[]>([]);

  createEffect(() => {
    const area = playArea();
    if (!area) {
      setPeekCards([]);
      return;
    }
    const unsub = area.peekZone.subscribeToCardList(setPeekCards);
    onCleanup(unsub);
  });

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

  createEffect(() => {
    if (location() === 'peek' && isOwner() && inputRef) {
      inputRef.focus();
    }
  });

  return (
    <>
      <Show when={peekCards()?.length > 0 && playArea()?.peekZone?.observable}>
        <div class={styles.searchContainer}>
          <div class={styles.search}>
            <h2 class='text-white text-xl text-left mb-4'>
              Peek — from {peekCards()[0]?.mesh?.userData?.previousLocation} |{' '}
              {playArea()!.peekZone.observable.cardCount}
            </h2>
            <Command>
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
                  const area = playArea();
                  if (!area) return;
                  if (e.code === 'Escape') {
                    e.preventDefault();
                    area.dismissFromZone(area.peekZone);
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
                  <MenubarItem
                    class='whitespace-nowrap ml-auto'
                    onClick={() => {
                      const area = playArea();
                      if (!area) return;
                      area.dismissFromZone(area.peekZone);
                    }}>
                    Dismiss
                  </MenubarItem>
                </MenubarMenu>
              </Menubar>
            </Command>
          </div>
        </div>
      </Show>
    </>
  );
};

export default PeekMenu;

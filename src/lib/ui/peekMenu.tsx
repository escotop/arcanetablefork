import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Button } from '~/components/ui/button';
import { Command, CommandInput } from '~/components/ui/command';
import { Menubar, MenubarItem, MenubarMenu } from '~/components/ui/menubar';
import { Card } from '../constants';
import {
  cardsById,
  doAfter,
  doXTimes,
  hoverSignal,
  peekFilterText,
  playAreas,
  provider,
  setHoverSignal,
  setPeekFilterText,
} from '../globals';
import { transferCard } from '../transferCard';
import MoveMenu from './moveMenu';
import styles from './peekMenu.module.css';

const PeekMenu: Component = props => {
  let userData = () => hoverSignal()?.mesh?.userData;
  const isOwner = createMemo(() => userData()?.clientId === provider.awareness.clientID);
  const location = createMemo(() => userData()?.location);
  const tether = () => hoverSignal()?.tether;
  const playArea = playAreas[provider.awareness.clientID];
  const cardCount = () => playArea.peekZone.cards.length;
  const card = () => cardsById.get(hoverSignal()?.mesh?.userData.id);
  const [viewField, setViewField] = createSignal(false);
  let inputRef;
  const [peekCards, setPeekCards] = createSignal([]);

  onMount(() => {
    const unsub = playArea.peekZone.subscribeToCardList(setPeekCards);

    onCleanup(() => {
      unsub();
    });
  });

  function drawAfterRevealing(card: Card) {
    drawWithoutRevealing(card);
    playArea.reveal(card);
  }

  function drawWithoutRevealing(card: Card) {
    transferCard(card, playArea.peekZone, playArea.hand);
  }

  createEffect(() => {
    if (location() === 'peek' && isOwner() && inputRef) {
      inputRef.focus();
    }
  });

  return (
    <>
      <Show when={peekCards()?.length > 0}>
        <div class={styles.searchContainer}>
          <div class={styles.search}>
            <h2 class='text-white text-xl text-left mb-4'>
              Peek — from {peekCards()[0]?.mesh?.userData?.previousLocation} |{' '}
              {playArea.peekZone.observable.cardCount}
            </h2>
            <Command>
              <CommandInput
                ref={inputRef}
                placeholder='Search'
                value={peekFilterText()}
                onKeyUp={e => {
                  if (e.code === 'Escape') {
                    playArea.dismissFromZone(playArea.peekZone);
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
                      playArea.peekZone.cards;
                      await playArea.transferEntireZone(playArea.peekZone, playArea.deck, {
                        location: 'bottom',
                      });
                      await doAfter(100, () => playArea.shuffleDeck());

                      setHoverSignal();
                    }}>
                    Shuffle into deck
                  </MenubarItem>
                  <MenubarItem
                    class='whitespace-nowrap'
                    onClick={() =>
                      doXTimes(cardCount(), () => drawAfterRevealing(playArea.peekZone.cards[0]))
                    }>
                    Reveal & Draw All
                  </MenubarItem>
                  <MenubarItem
                    class='whitespace-nowrap'
                    onClick={() =>
                      doXTimes(cardCount(), () => drawWithoutRevealing(playArea.peekZone.cards[0]))
                    }>
                    Draw All
                  </MenubarItem>
                  <MoveMenu
                    text='Move All To'
                    cards={playArea.peekZone.cards}
                    playArea={playArea}
                    fromZone={playArea.peekZone}
                  />
                  <Switch>
                    <Match when={viewField()}>
                      <MenubarItem
                        class='whitespace-nowrap'
                        onClick={() => {
                          playArea.peekZone.viewGrid();
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
                          playArea.peekZone.viewField();
                          setViewField(true);
                        }}>
                        View Field
                      </MenubarItem>
                    </Match>
                  </Switch>
                  <MenubarItem
                    class='whitespace-nowrap ml-auto'
                    onClick={() => {
                      playArea.dismissFromZone(playArea.peekZone);
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

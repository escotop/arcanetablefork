import { nanoid } from 'nanoid';
import { Component, createEffect, createSignal, Match, onCleanup, Show, Switch } from 'solid-js';
import { Button } from '~/components/ui/button';
import { Command, CommandInput } from '~/components/ui/command';
import { Menubar, MenubarContent, MenubarMenu, MenubarTrigger } from '~/components/ui/menubar';
import NumberFieldMenuItem from '~/components/ui/number-field-menu-item';
import { cleanupCard, cloneCard } from '../card';
import { Card } from '../constants';
import {
  cardsById,
  doXTimes,
  getLocalPlayArea,
  hoverSignal,
  sendEvent,
  setPeekFilterText,
} from '../globals';
import styles from './peekMenu.module.css';

const TokenSearchMenu: Component = props => {
  const playArea = () => getLocalPlayArea();
  const [peekCards, setPeekCards] = createSignal<Card[]>([]);
  let inputRef;

  createEffect(() => {
    const area = playArea();
    if (!area) {
      setPeekCards([]);
      return;
    }

    const unsub = area.tokenSearchZone.subscribeToCardList(cardList => {
      setPeekCards(cardList);
      if (cardList?.length > 0 && inputRef) {
        inputRef.focus();
      }
    });

    onCleanup(unsub);
  });

  const cardMesh = () => hoverSignal()?.mesh;
  const tether = () => hoverSignal()?.tether;
  const [viewField, setViewField] = createSignal(false);

  function addToBattlefield(referenceCard: Card) {
    const area = playArea();
    if (!area) return;
    let card = cloneCard(referenceCard, nanoid());

    let battlefield = area.battlefieldZone;
    let tokenZone = area.tokenSearchZone;
    tokenZone.mesh.localToWorld(card.mesh.position);
    battlefield.addCard(card);

    sendEvent({
      type: 'createCard',
      payload: {
        userData: card.mesh.userData,
        zoneId: battlefield.id,
      },
    });
  }

  return (
    <>
      <Show when={peekCards()?.length > 0 && playArea()?.tokenSearchZone?.observable}>
        <div class={styles.searchContainer}>
          <div class={styles.search}>
            <h2 class='text-white text-xl text-left mb-4'>
              Tokens | {playArea()!.tokenSearchZone.observable.cardCount}
            </h2>
            <Command>
              <CommandInput
                ref={inputRef}
                placeholder='Search'
                onKeyUp={e => {
                  const area = playArea();
                  if (!area) return;
                  if (e.code === 'Escape') {
                    area.dismissFromZone(area.tokenSearchZone);
                  }
                }}
                onValueChange={value => {
                  setPeekFilterText(value);
                }}
              />
              <Menubar>
                <MenubarMenu>
                  <Switch>
                    <Match when={viewField()}>
                      <Button
                        variant='ghost'
                        onClick={() => {
                          const area = playArea();
                          if (!area) return;
                          area.tokenSearchZone.viewGrid();
                          setViewField(false);
                        }}>
                        View Grid
                      </Button>
                    </Match>
                    <Match when>
                      <Button
                        variant='ghost'
                        onClick={() => {
                          const area = playArea();
                          if (!area) return;
                          area.tokenSearchZone.viewField();
                          setViewField(true);
                        }}>
                        View Field
                      </Button>
                    </Match>
                  </Switch>
                  <Button
                    variant='ghost'
                    onClick={() => {
                      const area = playArea();
                      if (!area) return;
                      area.dismissFromZone(area.tokenSearchZone);
                    }}>
                    Dismiss
                  </Button>
                </MenubarMenu>
              </Menubar>
            </Command>
          </div>
        </div>
        <Show when={tether() && cardMesh()}>
          <div
            class={styles.peekActions}
            style={`--x: ${tether()!.x}px; --y: ${tether()!.y}px;`}>
            <Menubar>
              <MenubarMenu>
                <MenubarTrigger>Add</MenubarTrigger>
                <MenubarContent>
                  <div class='py-1.5 px-2'>Add Tokens</div>
                  <NumberFieldMenuItem
                    onSubmit={count => {
                      const mesh = cardMesh();
                      const area = playArea();
                      if (!mesh || !area) return;
                      let card = cardsById.get(mesh.userData.id)!;
                      doXTimes(count, () => addToBattlefield(card), 50);
                    }}
                  />
                </MenubarContent>

                <Button
                  variant='ghost'
                  onClick={() => {
                    const mesh = cardMesh();
                    const area = playArea();
                    if (!mesh || !area) return;
                    area.tokenSearchZone.removeCard(mesh);
                    cleanupCard(cardsById.get(mesh.userData.id));
                  }}>
                  Dismiss
                </Button>
              </MenubarMenu>
            </Menubar>
          </div>
        </Show>
      </Show>
    </>
  );
};

export default TokenSearchMenu;

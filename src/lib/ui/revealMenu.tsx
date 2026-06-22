import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Command, CommandInput } from '~/components/ui/command';
import { Menubar, MenubarItem, MenubarMenu } from '~/components/ui/menubar';
import { playAreas, players, provider, setHoverSignal, setPeekFilterText } from '../globals';
import styles from './peekMenu.module.css';
import { cleanupCard } from '../card';
import { Card } from '../constants';

export default function RevealMenu() {
  const playArea = playAreas[provider.awareness.clientID];
  const [peekCards, setPeekCards] = createSignal<Card[]>([]);

  const revealingPlayer = createMemo(() => {
    let card = peekCards()?.[0];
    if (!card) return;
    return players().find(player => player.id === card.mesh.userData.clientId);

  })

  let inputRef;

  onMount(() => {
    const unsub = playArea.revealZone.subscribeToCardList(cardList => {
      setPeekCards(cardList)
      if (cardList?.length > 0 && inputRef) {
        inputRef.focus()
      }
    });

    onCleanup(() => {
      unsub();
    });
  });

  return (
    <>
      <Show when={peekCards()?.length > 0 && peekCards()?.[0]?.mesh.userData.location === 'reveal'}>
        <div class={styles.searchContainer}>
          <div class={styles.search}>
            <h2 class='text-white text-xl text-left mb-4'>
              Revealed — from {revealingPlayer()?.entry?.name} |{' '}
              {playArea.revealZone.observable.cardCount}
            </h2>
            <Command>
              <CommandInput
                ref={inputRef}
                placeholder='Search'
                onKeyUp={e => {
                  if (e.code === 'Escape') {
                    playArea.dismissFromZone(playArea.revealZone);
                  }
                }}
                onValueChange={value => {
                  setPeekFilterText(value);
                }}
              />
              <Menubar>
                <MenubarMenu>
                  <MenubarItem
                    onClick={() => {
                      let cards = playArea.revealZone.cards;

                      cards.forEach(card => {
                        playArea.revealZone.removeCard(card.mesh);
                        cleanupCard(card);
                      });
                      setHoverSignal();
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
}

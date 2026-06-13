import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Command, CommandInput } from '~/components/ui/command';
import { Menubar, MenubarItem, MenubarMenu } from '~/components/ui/menubar';
import { hoverSignal, playAreas, provider, setHoverSignal, setPeekFilterText } from '../globals';
import styles from './peekMenu.module.css';
import { cleanupCard } from '../card';

export default function RevealMenu() {
  let userData = () => hoverSignal()?.mesh?.userData;
  const location = createMemo(() => userData()?.location);
  const playArea = playAreas[provider.awareness.clientID];
  let inputRef;

  const [peekCards, setPeekCards] = createSignal([]);

  onMount(() => {
    const unsub = playArea.peekZone.subscribeToCardList(setPeekCards);

    onCleanup(() => {
      unsub();
    });
  });

  createEffect(() => {
    if (location() === 'reveal' && inputRef) inputRef.focus();
  });

  return (
    <>
      <Show when={peekCards()?.length > 0}>
        <div class={styles.search}>
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
      </Show>
    </>
  );
}

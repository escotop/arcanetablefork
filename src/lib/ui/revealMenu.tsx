import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Command, CommandInput } from '~/components/ui/command';
import { Menubar, MenubarItem, MenubarMenu } from '~/components/ui/menubar';
import { getLocalPlayArea, setHoverSignal, setPeekFilterText } from '../globals';
import styles from './peekMenu.module.css';
import { Card } from '../constants';

export default function RevealMenu() {
  const playArea = () => getLocalPlayArea();
  const [peekCards, setPeekCards] = createSignal<Card[]>([]);

  let inputRef;

  onMount(() => {
    const area = playArea();
    if (!area) return;
    const unsub = area.revealZone.subscribeToCardList(cardList => {
      setPeekCards(cardList);
      if (cardList?.length > 0 && inputRef) {
        inputRef.focus();
      }
    });

    onCleanup(() => {
      unsub();
    });
  });

  return (
    <>
      <Show when={peekCards()?.length > 0 && playArea()}>
        {area => (
        <div class={styles.searchContainer}>
          <div class={styles.searchHeader}>
            <div class={styles.search}>
            <Command>
              <CommandInput
                ref={inputRef}
                placeholder='Search'
                onKeyUp={e => {
                  if (e.code === 'Escape') {
                    area.dismissFromZone(area.revealZone);
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
                      area.dismissFromZone(area.revealZone);
                      setHoverSignal();
                    }}>
                    Dismiss
                  </MenubarItem>
                </MenubarMenu>
              </Menubar>
            </Command>
            </div>
          </div>
        </div>
        )}
      </Show>
    </>
  );
}

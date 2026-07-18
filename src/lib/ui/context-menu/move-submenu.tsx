import { Card, CardZone, KEY } from '~/lib/constants';
import { doXTimes } from '~/lib/globals';
import { PlayArea } from '~/lib/playArea';
import { transferCard } from '~/lib/transferCard';
import { useMenuContext } from './context';
import { Dynamic, Show } from 'solid-js/web';
import DropdownIcon from 'lucide-solid/icons/chevron-right';
import { createEffect, onMount } from 'solid-js';

interface Props {
  cards: Card[];
  fromZone: CardZone;
  playArea: PlayArea;
  text?: string;
  onComplete?(): void;
  showShortcuts?: boolean;
  vertical?: true;
}

export default function MoveSubMenu(props: Props) {
  const menuCtx = useMenuContext();

  function moveTo<T extends {}>(zone: CardZone<T>, addOptions?: T) {
    let cards = props.cards.slice();
    doXTimes(cards.length, () => {
      if (!cards.length) {
        return console.trace(`tried to transfer cards when there are no cards`, {
          cards,
          zone,
          addOptions,
        });
      }
      transferCard(cards.shift(), props.fromZone, zone, { addOptions });
    });
    props.onComplete?.();
  }

  function moveToFaceDown<T extends {}>(zone: CardZone<T>, addOptions?: T) {
    let cards = props.cards.slice();
    doXTimes(cards.length, () => {
      let card = cards.shift()!;
      transferCard(card, props.fromZone, zone, { addOptions, userData: { isFlipped: true } });
    });
    props.onComplete?.();
  }

  return (
    <Dynamic component={menuCtx.menu}>
      <Dynamic
        component={menuCtx.trigger}
        class={`whitespace-nowrap font-normal px-2 flex gap-2 ${props.vertical ? 'w-full' : ''}`}
        variant='ghost'>
        {props.text ?? 'Move to'}
        <Show when={menuCtx.type === 'menubar'}>
          <DropdownIcon class='ml-auto' stroke-width={1} />
        </Show>
      </Dynamic>
      <Dynamic component={menuCtx.content}>
        <Dynamic component={menuCtx.item} onClick={() => moveTo(props.playArea.peekZone)}>
          Search
        </Dynamic>
        <Show when={props.fromZone !== props.playArea.hand}>
          <Dynamic component={menuCtx.item} onClick={() => moveTo(props.playArea.hand)}>
            Hand
          </Dynamic>
        </Show>
        <Dynamic
          component={menuCtx.item}
          onClick={() => props.cards.forEach(card => props.playArea.reveal(card))}>
          Reveal
        </Dynamic>
        <Dynamic component={menuCtx.item} onClick={() => moveTo(props.playArea.graveyardZone)}>
          Discard{' '}
          {props.showShortcuts && <Dynamic component={menuCtx.shortcut}>{KEY.Mod} d</Dynamic>}
        </Dynamic>
        <Dynamic component={menuCtx.item} onClick={() => moveTo(props.playArea.exileZone)}>
          Exile {props.showShortcuts && <Dynamic component={menuCtx.shortcut}>{KEY.Mod} e</Dynamic>}
        </Dynamic>
        <Dynamic component={menuCtx.item} onClick={() => moveTo(props.playArea.deck)}>
          Top of Deck{' '}
          {props.showShortcuts && <Dynamic component={menuCtx.shortcut}>{KEY.Shift} T</Dynamic>}
        </Dynamic>
        <Dynamic
          component={menuCtx.item}
          onClick={() => moveTo(props.playArea.deck, { location: 'bottom' })}>
          Bottom of Deck{' '}
          {props.showShortcuts && <Dynamic component={menuCtx.shortcut}>{KEY.Shift} B</Dynamic>}
        </Dynamic>
        <Show when={props.fromZone !== props.playArea.battlefieldZone}>
          <Dynamic component={menuCtx.item} onClick={() => moveTo(props.playArea.battlefieldZone)}>
            Battlefield
          </Dynamic>
          <Dynamic
            component={menuCtx.item}
            onClick={() => moveToFaceDown(props.playArea.battlefieldZone)}>
            Battlefield Face down
          </Dynamic>
        </Show>
      </Dynamic>
    </Dynamic>
  );
}

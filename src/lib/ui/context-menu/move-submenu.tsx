import { Card, CardZone, KEY } from '~/lib/constants';
import { doXTimes } from '~/lib/globals';
import { PlayArea } from '~/lib/playArea';
import { transferCard } from '~/lib/transferCard';
import { useMenuContext } from './context';
import { Dynamic, Show } from 'solid-js/web';
import DropdownIcon from 'lucide-solid/icons/chevron-right';
import { requestBulkMoveConfirmation } from '../moveBulkConfirm';

interface Props {
  cards: Card[];
  fromZone: CardZone;
  playArea: PlayArea;
  text?: string;
  onComplete?(): void;
  showShortcuts?: boolean;
  vertical?: true;
  hide?: string[];
  confirmBeforeMove?: boolean;
}

export default function MoveSubMenu(props: Props) {
  const ctx = useMenuContext();

  function requestMove(destination: string, cardCount: number, execute: () => void) {
    requestBulkMoveConfirmation(destination, cardCount, execute, props.confirmBeforeMove);
  }

  function moveTo<T extends {}>(zone: CardZone<T>, addOptions?: T, destination = 'destination') {
    const cards = props.cards.slice();
    const cardCount = cards.length;
    requestMove(destination, cardCount, () => {
      doXTimes(cardCount, () => {
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
    });
  }

  function moveToFaceDown<T extends {}>(
    zone: CardZone<T>,
    addOptions?: T,
    destination = 'Battlefield Face down',
  ) {
    const cards = props.cards.slice();
    const cardCount = cards.length;
    requestMove(destination, cardCount, () => {
      doXTimes(cardCount, () => {
        const card = cards.shift()!;
        transferCard(card, props.fromZone, zone, { addOptions, userData: { isFlipped: true } });
      });
      props.onComplete?.();
    });
  }

  return (
    <Dynamic component={ctx.menu}>
      <Dynamic
        component={ctx.trigger}
        class={`whitespace-nowrap font-normal px-2 flex gap-2 ${props.vertical ? 'w-full' : ''}`}
        variant='ghost'>
        {props.text ?? 'Move to'}
        <Show when={ctx.type === 'menubar'}>
          <DropdownIcon class='ml-auto' stroke-width={1} />
        </Show>
      </Dynamic>
      <Dynamic component={ctx.content}>
        <Show when={props.fromZone !== props.playArea.hand && !(props.hide ?? []).includes('hand')}>
          <Dynamic component={ctx.item} onClick={() => moveTo(props.playArea.hand, undefined, 'Hand')}>
            Hand
          </Dynamic>
        </Show>
        <Dynamic component={ctx.item} onClick={() => moveTo(props.playArea.graveyardZone, undefined, 'Discard')}>
          Discard
          {props.showShortcuts && <Dynamic component={ctx.shortcut}>{KEY.Mod} d</Dynamic>}
        </Dynamic>
        <Dynamic component={ctx.item} onClick={() => moveTo(props.playArea.exileZone, undefined, 'Exile')}>
          Exile {props.showShortcuts && <Dynamic component={ctx.shortcut}>{KEY.Mod} e</Dynamic>}
        </Dynamic>
        <Dynamic component={ctx.separator} />
        <Dynamic component={ctx.item} onClick={() => moveTo(props.playArea.deck, undefined, 'Top of Deck')}>
          Top of Deck
          {props.showShortcuts && <Dynamic component={ctx.shortcut}>{KEY.Shift} T</Dynamic>}
        </Dynamic>
        <Dynamic
          component={ctx.item}
          onClick={() => moveTo(props.playArea.deck, { location: 'bottom' }, 'Bottom of Deck')}>
          Bottom of Deck
          {props.showShortcuts && <Dynamic component={ctx.shortcut}>{KEY.Shift} B</Dynamic>}
        </Dynamic>
        <Show when={props.fromZone !== props.playArea.battlefieldZone}>
          <Dynamic component={ctx.separator} />
          <Dynamic
            component={ctx.item}
            onClick={() => moveTo(props.playArea.battlefieldZone, undefined, 'Battlefield')}>
            Battlefield
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => moveToFaceDown(props.playArea.battlefieldZone)}>
            Battlefield Face down
          </Dynamic>
        </Show>
      </Dynamic>
    </Dynamic>
  );
}

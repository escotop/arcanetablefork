import { Component } from 'solid-js';
import { Show } from 'solid-js/web';
import {
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarShortcut,
  MenubarTrigger,
} from '~/components/ui/menubar';
import { Card, CardZone, KEY } from '../constants';
import { doXTimes } from '../globals';
import { PlayArea } from '../playArea';
import { transferCard } from '../transferCard';
import DropdownIcon from 'lucide-solid/icons/chevron-right';
import { requestBulkMoveConfirmation } from './moveBulkConfirm';

interface Props {
  cards: Card[];
  fromZone: CardZone;
  playArea: PlayArea;
  text: string;
  onComplete?(): void;
  showShortcuts?: boolean;
  vertical?: true;
  confirmBeforeMove?: boolean;
}

const MoveMenu: Component<Props> = props => {
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
    <MenubarMenu orientation='vertical'>
        <MenubarTrigger
          class={`whitespace-nowrap font-normal px-2 flex gap-2 ${props.vertical ? 'w-full' : ''}`}
          variant='ghost'>
          {props.text ?? 'Move to'}
          <DropdownIcon class='ml-auto' stroke-width={1} />
        </MenubarTrigger>
        <MenubarContent>
          <Show when={props.fromZone !== props.playArea.hand}>
            <MenubarItem onClick={() => moveTo(props.playArea.hand, undefined, 'Hand')}>
              Hand
            </MenubarItem>
          </Show>
          <MenubarItem onClick={() => moveTo(props.playArea.graveyardZone, undefined, 'Discard')}>
            Discard {props.showShortcuts && <MenubarShortcut>{KEY.Mod} d</MenubarShortcut>}
          </MenubarItem>
          <MenubarItem onClick={() => moveTo(props.playArea.exileZone, undefined, 'Exile')}>
            Exile {props.showShortcuts && <MenubarShortcut>{KEY.Mod} e</MenubarShortcut>}
          </MenubarItem>
          <MenubarItem onClick={() => moveTo(props.playArea.deck, undefined, 'Top of Deck')}>
            Top of Deck {props.showShortcuts && <MenubarShortcut>{KEY.Shift} T</MenubarShortcut>}
          </MenubarItem>
          <MenubarItem
            onClick={() => moveTo(props.playArea.deck, { location: 'bottom' }, 'Bottom of Deck')}>
            Bottom of Deck {props.showShortcuts && <MenubarShortcut>{KEY.Shift} B</MenubarShortcut>}
          </MenubarItem>
          <Show when={props.fromZone !== props.playArea.battlefieldZone}>
            <MenubarItem onClick={() => moveTo(props.playArea.battlefieldZone, undefined, 'Battlefield')}>
              Battlefield
            </MenubarItem>
            <MenubarItem onClick={() => moveToFaceDown(props.playArea.battlefieldZone)}>
              Battlefield Face down
            </MenubarItem>
          </Show>
        </MenubarContent>
    </MenubarMenu>
  );
};

export default MoveMenu;

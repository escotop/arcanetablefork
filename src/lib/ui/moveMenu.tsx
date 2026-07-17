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
import { Button } from '~/components/ui/button';

interface Props {
  cards: Card[];
  fromZone: CardZone;
  playArea: PlayArea;
  text: string;
  onComplete?(): void;
  showShortcuts?: boolean;
}

const MoveMenu: Component<Props> = props => {
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
    <MenubarMenu orientation='vertical'>
      <MenubarTrigger
        class='whitespace-nowrap font-normal px-2 flex gap-2 w-full'
        as={Button<'button'>}
        variant='ghost'>
        {props.text ?? 'Move to'}
        <DropdownIcon class='ml-auto' stroke-width={1} />
      </MenubarTrigger>
      <MenubarContent>
        <MenubarItem onClick={() => moveTo(props.playArea.peekZone)}>Search</MenubarItem>
        <Show when={props.fromZone !== props.playArea.hand}>
          <MenubarItem onClick={() => moveTo(props.playArea.hand)}>Hand</MenubarItem>
        </Show>
        <MenubarItem onClick={() => props.cards.forEach(card => props.playArea.reveal(card))}>
          Reveal
        </MenubarItem>
        <MenubarItem onClick={() => moveTo(props.playArea.graveyardZone)}>
          Discard {props.showShortcuts && <MenubarShortcut>{KEY.Mod} d</MenubarShortcut>}
        </MenubarItem>
        <MenubarItem onClick={() => moveTo(props.playArea.exileZone)}>
          Exile {props.showShortcuts && <MenubarShortcut>{KEY.Mod} e</MenubarShortcut>}
        </MenubarItem>
        <MenubarItem onClick={() => moveTo(props.playArea.deck)}>
          Top of Deck {props.showShortcuts && <MenubarShortcut>{KEY.Shift} T</MenubarShortcut>}
        </MenubarItem>
        <MenubarItem onClick={() => moveTo(props.playArea.deck, { location: 'bottom' })}>
          Bottom of Deck {props.showShortcuts && <MenubarShortcut>{KEY.Shift} B</MenubarShortcut>}
        </MenubarItem>
        <Show when={props.fromZone !== props.playArea.battlefieldZone}>
          <MenubarItem onClick={() => moveTo(props.playArea.battlefieldZone)}>
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

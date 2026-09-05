import { PlayArea } from '~/lib/playArea';
import { useMenuContext } from './context';
import { Dynamic } from 'solid-js/web';
import MoveSubMenu from './move-submenu';
import { cardsById } from '~/lib/globals';
import { Mesh } from 'three';
import { transferCard } from '~/lib/transferCard';
import { createMemo } from 'solid-js';

export default function PeekContextMenu(props: { playArea: PlayArea; targetMesh: Mesh }) {
  const ctx = useMenuContext();
  const card = createMemo(() => cardsById.get(props.targetMesh.userData.id));

  return (
    <>
      <Dynamic
        component={ctx.item}
        onClick={() => transferCard(card(), props.playArea.peekZone, props.playArea.hand)}>
        Draw
      </Dynamic>
      <Dynamic
        component={ctx.item}
        onClick={() => {
          transferCard(card(), props.playArea.peekZone, props.playArea.hand);
          props.playArea.reveal(card());
        }}>
        Draw & Reveal
      </Dynamic>
      <Dynamic component={ctx.separator} />
      <MoveSubMenu
        hide={['hand']}
        cards={[card()]}
        fromZone={props.playArea.peekZone}
        playArea={props.playArea}
      />
    </>
  );
}

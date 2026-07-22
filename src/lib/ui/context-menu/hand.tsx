import { Dynamic } from 'solid-js/web';
import { PlayArea } from '~/lib/playArea';
import { useMenuContext } from './context';
import { Mesh } from 'three';
import { cardsById } from '~/lib/globals';
import MoveSubMenu from './move-submenu';

export default function HandContextMenu(props: { playArea: PlayArea; targetMesh: Mesh }) {
  const ctx = useMenuContext();
  const getCard = () => {
    const card = cardsById.get(props.targetMesh.userData.id);
    if (!card)
      console.error(`card not in cardsById map`, JSON.stringify(props.targetMesh.userData));
    return card;
  };
  return (
    <>
      <Dynamic component={ctx.item} onClick={() => props.playArea.reveal(getCard())}>
        Reveal
      </Dynamic>
      <MoveSubMenu
        cards={[getCard()].filter(Boolean)}
        playArea={props.playArea}
        fromZone={props.playArea.hand}
      />
      <Dynamic component={ctx.separator} />
      <MoveSubMenu
        text={`Move all ${props.playArea.hand.cards.length} cards`}
        cards={props.playArea.hand.cards}
        playArea={props.playArea}
        fromZone={props.playArea.hand}
      />
    </>
  );
}

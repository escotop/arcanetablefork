import { Dynamic } from 'solid-js/web';
import { PlayArea } from '~/lib/playArea';
import { useMenuContext } from './context';
import { Mesh } from 'three';
import { selection } from '~/lib/globals';
import { resolveInteractiveCard } from '~/lib/card';
import MoveSubMenu from './move-submenu';

export default function HandContextMenu(props: { playArea: PlayArea; targetMesh: Mesh }) {
  const ctx = useMenuContext();

  let meshes = () => {
    const selected = selection.selectedItems.filter(mesh => mesh.userData.location === 'hand');
    return selected.length > 0 ? selected : [props.targetMesh];
  };

  function selectedCards() {
    return meshes()
      .map(mesh => resolveInteractiveCard(mesh))
      .filter(Boolean);
  }

  return (
    <>
      <MoveSubMenu
        onComplete={() => selection.clearSelection()}
        cards={selectedCards()}
        playArea={props.playArea}
        fromZone={props.playArea.hand}
      />
      <Dynamic component={ctx.separator} />
      <MoveSubMenu
        text={`Move all ${props.playArea.hand.cards.length} cards`}
        cards={props.playArea.hand.cards}
        playArea={props.playArea}
        fromZone={props.playArea.hand}
        confirmBeforeMove
      />
    </>
  );
}

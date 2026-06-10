import { Mesh } from 'three';
import { createTapEvent } from '~/lib/createEvents';
import { dispatchGameEvent } from '~/lib/globals';
import { PlayArea } from '~/lib/playArea';

export function untapAll(playArea: PlayArea) {
  let tappedCardMeshes = playArea.battlefieldZone.mesh.children.filter(
    mesh => mesh.userData.isTapped,
  ) as Mesh[];

  tappedCardMeshes.forEach(cardMesh => dispatchGameEvent(createTapEvent(cardMesh)));
}

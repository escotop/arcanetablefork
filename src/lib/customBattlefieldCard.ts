import { nanoid } from 'nanoid';
import { Raycaster, Vector2 } from 'three';
import { initializeCardMesh, loadCardTextures, setCardData, updateModifiers } from './card';
import { createCreateCardEvent } from './createEvents';
import { Card, CardEntryDetail } from './constants';
import { camera, getLocalPlayArea, sendEvent } from './globals';
import type { PlayArea } from './playArea';

function buildCustomCardDetail(frontUrl: string, backUrl?: string): CardEntryDetail {
  const frontFace: CardEntryDetail = {
    name: 'Custom Card',
    search: 'custom card',
    type_line: 'Custom',
    popularity: 0,
    image_uris: { normal: frontUrl },
  };

  return {
    ...frontFace,
    card_faces: backUrl
      ? [
          frontFace,
          {
            ...frontFace,
            name: 'Custom Card (Back)',
            image_uris: { normal: backUrl },
          },
        ]
      : undefined,
  };
}

export function resolveBattlefieldPositionFromScreen(
  screenX: number,
  screenY: number,
): [number, number, number] | undefined {
  const area = getLocalPlayArea();
  if (!area || !camera) return undefined;

  const ndc = new Vector2(
    (screenX / window.innerWidth) * 2 - 1,
    -(screenY / window.innerHeight) * 2 + 1,
  );
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObject(area.battlefieldZone.mesh, false);
  if (hits.length > 0) {
    const local = area.battlefieldZone.mesh.worldToLocal(hits[0].point.clone());
    return local.toArray() as [number, number, number];
  }

  return [0, 0, 0];
}

export function spawnCustomCardOnBattlefield(
  playArea: PlayArea,
  frontUrl: string,
  backUrl: string | undefined,
  position?: [number, number, number],
) {
  const normalizedFront = frontUrl.trim();
  if (!normalizedFront) return;

  const normalizedBack = backUrl?.trim() || undefined;
  const card: Card = {
    id: nanoid(),
    clientId: playArea.clientId,
    customArtUrl: normalizedFront,
    detail: buildCustomCardDetail(normalizedFront, normalizedBack),
    modifiers: {} as Card['modifiers'],
  };

  initializeCardMesh(card, playArea.clientId);
  setCardData(card.mesh!, 'isPublic', true);
  setCardData(card.mesh!, 'modifiers', { power: 0, toughness: 0, counters: {} });

  playArea.battlefieldZone.addCard(card, {
    skipAnimation: false,
    positionArray: position,
  });

  updateModifiers(card);
  void loadCardTextures(card);
  sendEvent(createCreateCardEvent(card, playArea.battlefieldZone.id));
  return card;
}

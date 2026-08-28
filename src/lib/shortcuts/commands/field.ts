import { Mesh } from 'three';
import { createTapEvent } from '~/lib/createEvents';
import { Card } from '~/lib/constants';
import { cardsById, dispatchGameEvent, getLocalPlayerClientId } from '~/lib/globals';
import { PlayArea } from '~/lib/playArea';

export function untapAll(playArea: PlayArea) {
  let tappedCardMeshes = playArea.battlefieldZone.mesh.children.filter(
    mesh => mesh.userData.isTapped,
  ) as Mesh[];

  tappedCardMeshes.forEach(cardMesh => dispatchGameEvent(createTapEvent(cardMesh)));
}

function defaultCardModifiers(modifiers?: Card['mesh']['userData']['modifiers']) {
  return {
    power: modifiers?.power ?? 0,
    toughness: modifiers?.toughness ?? 0,
    counters: { ...(modifiers?.counters ?? {}) },
  };
}

export function adjustCardPowerToughness(playArea: PlayArea, card: Card, delta: number) {
  playArea.modifyCard(card, modifiers => {
    const base = defaultCardModifiers(modifiers);
    return {
      ...base,
      power: base.power + delta,
      toughness: base.toughness + delta,
    };
  });
}

export function adjustBattlefieldCardsPowerToughness(
  cardList: Card[],
  playArea: PlayArea | undefined,
  delta: number,
) {
  if (!playArea) return false;

  const localClientId = getLocalPlayerClientId();
  const targets = cardList.filter(
    card =>
      card.mesh.userData.location === 'battlefield' &&
      Number(card.mesh.userData.clientId) === Number(localClientId),
  );

  if (!targets.length) return false;

  targets.forEach(card => adjustCardPowerToughness(playArea, card, delta));
  return true;
}

/** Keyboard layouts vary; match by key and physical code. */
export function getPowerToughnessDeltaFromKey(event: KeyboardEvent): number | null {
  if (event.code === 'NumpadAdd' || event.key === '+' || event.key === '=') {
    return 1;
  }
  if (event.code === 'NumpadSubtract' || event.key === '-' || event.key === '_') {
    return -1;
  }
  return null;
}

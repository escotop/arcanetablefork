import hotkeys from 'hotkeys-js';
import { createEffect, onMount } from 'solid-js';
import {
  selection,
  cardsById,
  zonesById,
  playAreas,
  provider,
  hoverSignal,
  dispatchGameEvent,
} from '../globals';
import { transferCard } from '../transferCard';
import { drawCards, searchDeck } from './commands/deck';
import { untapAll } from './commands/field';
import { createTapEvent } from '../createEvents';
import { Card } from '../constants';

export function HotKeys() {
  const cardMesh = () => hoverSignal()?.mesh;
  const playArea = playAreas[provider?.awareness?.clientID];
  const cards = () => {
    let items = selection.selectedItems;
    if (items.length) {
      return items.map(item => cardsById.get(item.userData.id)).filter(Boolean) as Card[];
    }
    if (!cardMesh()) return [];

    return [cardsById.get(cardMesh().userData.id)].filter(Boolean) as Card[];
  };
  createEffect(() => {
    if (selection.selectedItems.length) {
      hotkeys.setScope(selection.selectedItems[0].userData.location);
    }
  });

  onMount(() => {
    hotkeys('shift+r', function () {
      untapAll(playArea);
    });

    hotkeys('d', function () {
      drawCards(playArea, 1);
    });

    hotkeys('ctrl+d,command+d', function (e) {
      e.preventDefault();
      cards().map(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, playArea.graveyardZone);
      });
      selection.clearSelection();
    });

    hotkeys('ctrl+c,command+c', function (e) {
      e.preventDefault();
      cards().map(card => {
        playArea.clone(card.id);
      });
    });

    hotkeys('ctrl+e,command+e', function (e) {
      e.preventDefault();
      cards().map(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, playArea.exileZone);
      });
      selection.clearSelection();
    });

    hotkeys('ctrl+f,command+f', function (e) {
      e.preventDefault();
      cards().map(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, playArea.battlefieldZone);
      });
    });

    hotkeys('shift+t', function (e) {
      e.preventDefault();
      cards().forEach(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, playArea.deck);
      });
    });

    hotkeys('shift+b', function (e) {
      e.preventDefault();

      cards().forEach(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, playArea.deck, { addOptions: { location: 'bottom' } });
      });
    });

    hotkeys('p', function (e) {
      e.preventDefault();
      cards().map(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, playArea.peekZone);
      });
      selection.clearSelection();
    });

    hotkeys('s', function (e) {
      e.preventDefault();
      searchDeck(playArea);
    });

    hotkeys('escape', 'peek', function (e) {
      e.preventDefault();
      playArea.dismissFromZone(playArea.peekZone);
    });

    hotkeys('escape', 'tokenSearch', function (e) {
      e.preventDefault();
      playArea.dismissFromZone(playArea.tokenSearchZone);
    });

    hotkeys('escape', 'reveal', function (e) {
      e.preventDefault();
      playArea.dismissFromZone(playArea.revealZone);
    });

    hotkeys('t', 'battlefield', function (e) {
      e.preventDefault();
      cards().forEach(card => dispatchGameEvent(createTapEvent(card.mesh)));
    });

    hotkeys('c', 'battlefield', function (e) {
      e.preventDefault();
      cards().forEach(card => playArea.clone(card?.mesh.userData.id));
    });

    hotkeys('f', 'battlefield', function (e) {
      e.preventDefault();
      cards().forEach(card => playArea.flip(card.mesh));
    });

    return () => {
      hotkeys.unbind();
    };
  });
  return null;
}

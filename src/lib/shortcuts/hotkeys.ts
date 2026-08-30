import hotkeys from 'hotkeys-js';
import { createEffect, onMount } from 'solid-js';
import {
  cardsById,
  getLocalPlayArea,
  hoverSignal,
  selection,
  dispatchGameEvent,
  zonesById,
} from '../globals';
import { transferCard } from '../transferCard';
import { drawCards, searchDeck } from './commands/deck';
import { untapAll, adjustBattlefieldCardsPowerToughness, getPowerToughnessDeltaFromKey } from './commands/field';
import { activateSpanishPreview } from '../spanishCardPreview';
import { createPassTurnEvent } from '../createEvents';
import { Card } from '../constants';
import { getOrderedPlayAreas } from '../cameraView';
import { dismissZoomPanel, navigateKeyboardHandHover, setKeyboardHandHover, setCameraViewByPlayerIndex } from '../../main3d';

export function HotKeys() {
  const cardMesh = () => hoverSignal()?.mesh;
  const playArea = () => getLocalPlayArea();
  const cards = () => {
    let items = selection.selectedItems;
    if (items.length) {
      return items.map(item => cardsById.get(item.userData.id)).filter(Boolean) as Card[];
    }
    if (!cardMesh()) return [];

    return [cardsById.get(cardMesh().userData.id)].filter(Boolean) as Card[];
  };
  createEffect(() => {
    const selected = selection.selectedItems[0];
    if (selected?.userData?.location) {
      hotkeys.setScope(selected.userData.location);
      return;
    }
    hotkeys.setScope(hoverSignal()?.mesh?.userData?.location ?? 'all');
  });

  onMount(() => {
    const requirePlayArea = () => {
      const area = playArea();
      if (!area) throw new Error('No local play area');
      return area;
    };

    const adjustPowerToughness = (delta: number) => {
      adjustBattlefieldCardsPowerToughness(cards(), playArea(), delta);
    };

    const onPowerToughnessKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      const location =
        selection.selectedItems[0]?.userData?.location ??
        hoverSignal()?.mesh?.userData?.location;
      if (location !== 'battlefield') return;

      const delta = getPowerToughnessDeltaFromKey(event);
      if (delta === null) return;

      event.preventDefault();
      adjustPowerToughness(delta);
    };

    window.addEventListener('keydown', onPowerToughnessKeyDown);

    const onSpanishPreviewKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key.toLowerCase() !== 't') return;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      const mesh = hoverSignal()?.mesh;
      if (!mesh?.userData?.id) return;

      event.preventDefault();
      void activateSpanishPreview(mesh.userData.id);
    };

    window.addEventListener('keydown', onSpanishPreviewKeyDown);

    const onFunctionKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const match = /^F([1-4])$/i.exec(event.key);
      if (!match) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      const playerIndex = parseInt(match[1], 10) - 1;
      if (playerIndex >= getOrderedPlayAreas().length) return;

      event.preventDefault();
      setCameraViewByPlayerIndex(playerIndex);
    };

    window.addEventListener('keydown', onFunctionKeyDown);

    hotkeys('shift+r', function () {
      const area = playArea();
      if (!area) return;
      untapAll(area);
    });

    hotkeys('space', function () {
      dispatchGameEvent(createPassTurnEvent());
    });

    hotkeys('d', function () {
      const area = playArea();
      if (!area) return;
      drawCards(area, 1);
    });

    hotkeys('ctrl+d,command+d', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      cards().map(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, area.graveyardZone);
      });
      selection.clearSelection();
    });

    hotkeys('ctrl+c,command+c', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      cards().map(card => {
        area.clone(card.id);
      });
    });

    hotkeys('ctrl+e,command+e', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      cards().map(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, area.exileZone);
      });
      selection.clearSelection();
    });

    hotkeys('ctrl+f,command+f', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      cards().map(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, area.battlefieldZone);
      });
    });

    hotkeys('shift+t', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      cards().forEach(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, area.deck);
      });
    });

    hotkeys('shift+b', function (e) {
      e.preventDefault();
      const area = requirePlayArea();

      cards().forEach(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, area.deck, { addOptions: { location: 'bottom' } });
      });
    });

    hotkeys('p', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      cards().map(card => {
        const previousZone = zonesById.get(card.mesh.userData.zoneId);
        transferCard(card, previousZone, area.peekZone);
      });
      selection.clearSelection();
    });

    hotkeys('s', function (e) {
      e.preventDefault();
      const area = playArea();
      if (!area) return;
      searchDeck(area);
    });

    hotkeys('1,2,3,4,5,6,7,8,9,0', function (e, handler) {
      e.preventDefault();
      const key = handler.key === '0' ? 10 : parseInt(handler.key, 10);
      setKeyboardHandHover(key);
    });

    hotkeys('left', function (e) {
      e.preventDefault();
      navigateKeyboardHandHover(-1);
    });

    hotkeys('right', function (e) {
      e.preventDefault();
      navigateKeyboardHandHover(1);
    });

    hotkeys('escape', function (e) {
      e.preventDefault();
      dismissZoomPanel();
      selection.clearSelection();

      const area = playArea();
      if (!area) return;

      if (area.peekZone.cards.length > 0) {
        void area.dismissFromZone(area.peekZone);
        return;
      }
      if (area.tokenSearchZone.cards.length > 0) {
        void area.dismissFromZone(area.tokenSearchZone);
        return;
      }
      if (area.revealZone.cards.length > 0) {
        void area.dismissFromZone(area.revealZone);
      }
    });

    hotkeys('escape', 'peek', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      area.dismissFromZone(area.peekZone);
    });

    hotkeys('escape', 'tokenSearch', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      area.dismissFromZone(area.tokenSearchZone);
    });

    hotkeys('escape', 'reveal', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      area.dismissFromZone(area.revealZone);
    });

    hotkeys('c', 'battlefield', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      cards().forEach(card => area.clone(card?.mesh.userData.id));
    });

    hotkeys('f', 'battlefield', function (e) {
      e.preventDefault();
      const area = requirePlayArea();
      cards().forEach(card => area.flip(card.mesh));
    });

    return () => {
      window.removeEventListener('keydown', onPowerToughnessKeyDown);
      window.removeEventListener('keydown', onSpanishPreviewKeyDown);
      window.removeEventListener('keydown', onFunctionKeyDown);
      hotkeys.unbind();
    };
  });
  return null;
}

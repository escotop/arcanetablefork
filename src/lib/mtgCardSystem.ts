import type { CardSystem } from './constants';
import defaultCardBackUrl from '../assets/card back.png';

export const DEFAULT_CARD_BACK_URL = defaultCardBackUrl;

export const MTG_CARD_SYSTEM: CardSystem = {
  id: 'mtgplayer',
  name: 'Magic: The Gathering',
  uri: 'https://api.scryfall.com',
  cardDetailEndpoint: 'scryfall://cards',
  cardSearchEndpoint: 'scryfall://search',
  cardBack: defaultCardBackUrl,
  fallbackImage: '/unknown-card-image.webp',
  popularity: 'popularity',
  imageUriFormat: 'scryfall',
  collectorLookup: true,
  types: ['creature', 'planeswalker', 'land', 'instant', 'sorcery', 'enchantment', 'artifact'],
  searchField: {
    filterEmpty: true,
    searchFields: [
      { field: 'name' },
      { field: 'type' },
      { field: 'cmc' },
      { field: 'mana_cost' },
      { field: 'oracle_text' },
      { field: 'mana_cost', transform: 'stripBracces' },
      { field: 'card_faces', recurse: true },
    ],
  },
};

export function initMtgCardSystem() {
  return MTG_CARD_SYSTEM;
}

const LEGACY_MTG_SYSTEM_IDS = new Set(['mtgplayer', 'scry-server-mtg']);

/** Maps Arcanetable / legacy deck.system values to this app's single MTG system id. */
export function normalizeCardSystemId(systemId?: string | null): string {
  if (!systemId || LEGACY_MTG_SYSTEM_IDS.has(systemId) || systemId.startsWith('scry-server')) {
    return MTG_CARD_SYSTEM.id;
  }
  return systemId;
}

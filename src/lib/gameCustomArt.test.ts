import { describe, expect, it, vi } from 'vitest';

const warmed = vi.hoisted(() => [] as string[]);

// card.ts pulls in the 3D engine and .tsx UI, which this test environment can't load.
vi.mock('./card', () => ({
  ensureCardMesh: () => {},
  loadCardTextures: async () => {},
  prefetchHiddenHandCardTextureCache: () => {},
  warmCardTextureCache: () => {},
  warmCardTextureCacheAsync: async (card: { customArtUrl?: string }) => {
    warmed.push(card.customArtUrl!);
  },
}));
vi.mock('./globals', () => ({ cardsById: new Map() }));

import type { Card, CardEntryDetail } from './constants';
import { parseImportedCardList } from './deckParser';
import { slimSerializedCardEntry } from './gameLogEvents';
import { cardFromDeckEntry, prefetchLibraryCustomArt } from './cardLoading';
import { getDisplayTextureUrl, getTextureLoadUrlCandidates } from './customCardArt';

// Lines taken from a real deck with custom printings (mtgcardbuilder art on wasabisys).
const DECK = `1 Mask of Memory [sld] #2309
1 Spectator Seating [msc] #268 {art:https%3A%2F%2Fs3.us-central-1.wasabisys.com%2Fpp-wasabi%2Fbuilder%2Fimgs%2Ftmp_6aa709ae5f0df.png}
1 Mother of Runes [clb] #702 {art:https%3A%2F%2Fs3.us-central-1.wasabisys.com%2Fpp-wasabi%2Fbuilder%2Fimgs%2Ftmp_6a0c83d73da7e.png}`;

const detail = (name: string) =>
  ({
    name,
    type_line: 'Creature',
    image_uris: {
      png: `https://cards.scryfall.io/png/front/x/${name}.png`,
      large: `https://cards.scryfall.io/large/front/x/${name}.jpg`,
      normal: `https://cards.scryfall.io/normal/front/x/${name}.jpg`,
    },
  }) as unknown as CardEntryDetail;

/** What Deck.getSerializable sends for a card still in the library (no mesh yet). */
function serializedLibraryCard(id: string, name: string, customArtUrl?: string) {
  return {
    id,
    detail: detail(name),
    customArtUrl,
    userData: { id, card: { detail: detail(name), customArtUrl }, clientId: 1 },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
}

describe('custom printings reach the other players', () => {
  const parsed = parseImportedCardList(DECK).cards;

  it('reads the custom art from the deck list', () => {
    expect(parsed.filter(card => card.customArtUrl)).toHaveLength(2);
  });

  it('keeps customArtUrl when an opponent rebuilds library cards from the shared state', () => {
    for (const [index, entry] of parsed.entries()) {
      const sent = slimSerializedCardEntry(
        serializedLibraryCard(`c${index}`, entry.name, entry.customArtUrl),
      );
      const rebuilt = cardFromDeckEntry(JSON.parse(JSON.stringify(sent)), 2);
      expect(rebuilt.customArtUrl).toBe(entry.customArtUrl);
    }
  });

  it('keeps customArtUrl for cards sent in the join payload', () => {
    const entry = parsed.find(card => card.customArtUrl)!;
    const rebuilt = cardFromDeckEntry(
      { id: 'j1', detail: detail(entry.name), customArtUrl: entry.customArtUrl },
      2,
    );
    expect(rebuilt.customArtUrl).toBe(entry.customArtUrl);
  });
});

describe('custom art is ready before it is drawn', () => {
  it('warms every custom printing in the library, once per image', async () => {
    const cards = parseImportedCardList(DECK).cards.map(
      (entry, index) => ({ id: `l${index}`, customArtUrl: entry.customArtUrl }) as Card,
    );
    const expected = cards.flatMap(card => (card.customArtUrl ? [card.customArtUrl] : []));

    prefetchLibraryCustomArt({ cards });
    prefetchLibraryCustomArt({ cards });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(warmed.sort()).toEqual(expected.sort());
  });
});

describe('lighter custom art images', () => {
  it('loads custom art resized through the proxy first', () => {
    const url = parseImportedCardList(DECK).cards.find(card => card.customArtUrl)!.customArtUrl!;
    const [first, ...rest] = getTextureLoadUrlCandidates(url);
    expect(first).toContain('images.weserv.nl');
    expect(first).toContain('&w=745');
    expect(first).toContain('output=webp');
    // Full-size fallbacks are still there.
    expect(rest.some(candidate => !candidate.includes('&w='))).toBe(true);
    expect(getDisplayTextureUrl(url)).toContain('&w=1000');
    // Printing never uses a resized copy.
    expect(getTextureLoadUrlCandidates(url, { fullSize: true }).some(c => c.includes('&w='))).toBe(
      false,
    );
  });
});

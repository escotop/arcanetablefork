import { strToU8, unzipSync, zipSync } from 'fflate';
import { nanoid } from 'nanoid';
import { Deck } from './constants';

interface DeckStoreShape {
  decks: Record<string, Deck>;
  systems: Record<string, string[]>;
}

function sanitizeDeckFilename(deck: Deck) {
  const base =
    (deck.name || 'deck')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'deck';
  return `${base}-${(deck.id || nanoid()).slice(0, 8)}.json`;
}

function exportDeckForArchive(deck: Deck): Deck {
  const stripCards = (cards: Record<string, Deck['cards'][string]> = {}) =>
    Object.fromEntries(
      Object.entries(cards)
        .filter(([, card]) => card.qty > 0)
        .map(([key, card]) => [key, { ...card, detail: undefined }]),
    );

  return {
    ...deck,
    cards: stripCards(deck.cards),
    inPlay: stripCards(deck.inPlay),
    tokens: stripCards(deck.tokens),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportAllDecksZip(decks: Record<string, Deck>) {
  const entries = Object.values(decks).filter(deck => deck?.id);
  if (!entries.length) {
    throw new Error('No decks to export');
  }

  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();

  for (const deck of entries) {
    let filename = sanitizeDeckFilename(deck);
    while (usedNames.has(filename)) {
      filename = `${filename.replace(/\.json$/, '')}-${nanoid(4)}.json`;
    }
    usedNames.add(filename);
    files[filename] = strToU8(JSON.stringify(exportDeckForArchive(deck), null, 2));
  }

  const zipped = zipSync(files);
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), 'arcanetable-decks.zip');
}

function normalizeImportedDeck(raw: unknown): Deck | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const deck = raw as Partial<Deck>;
  if (!deck.cards || typeof deck.cards !== 'object') return undefined;

  return {
    ...deck,
    id: deck.id || nanoid(),
    name: deck.name || 'Imported deck',
    version: deck.version ?? 2,
    system: deck.system || 'unsorted',
    startingLife: deck.startingLife ?? 40,
    cards: deck.cards,
    inPlay: deck.inPlay ?? {},
    tokens: deck.tokens ?? {},
  } as Deck;
}

export function parseDecksZip(buffer: ArrayBuffer): Deck[] {
  const unzipped = unzipSync(new Uint8Array(buffer));
  const decks: Deck[] = [];

  for (const [path, data] of Object.entries(unzipped)) {
    if (path.startsWith('__MACOSX/') || path.endsWith('/')) continue;
    if (!path.toLowerCase().endsWith('.json')) continue;

    try {
      const parsed = JSON.parse(new TextDecoder().decode(data));
      const deck = normalizeImportedDeck(parsed);
      if (deck) decks.push(deck);
    } catch {
      // skip invalid json entries
    }
  }

  return decks;
}

export function mergeImportedDecks(
  imported: Deck[],
  store: DeckStoreShape,
): DeckStoreShape {
  const decks = { ...store.decks };
  const systems = Object.fromEntries(
    Object.entries(store.systems).map(([key, value]) => [key, [...value]]),
  ) as Record<string, string[]>;

  for (const deck of imported) {
    const system = deck.system || 'unsorted';
    systems[system] ??= [];

    for (const [systemId, deckIds] of Object.entries(systems)) {
      systems[systemId] = deckIds.filter(id => id !== deck.id);
    }

    systems[system] = [deck.id, ...systems[system].filter(id => id !== deck.id)];
    decks[deck.id] = deck;
  }

  return { decks, systems };
}

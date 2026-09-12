import { nanoid } from 'nanoid';
import type { CardEntry, Deck } from '../constants';
import {
  buildImportedInPlay,
  buildImportedSection,
  buildImportedSideboard,
  fetchCardInfoForImport,
} from '../deckImportLookup';
import { MTG_CARD_SYSTEM } from '../mtgCardSystem';
import { COMMANDER_CATEGORY } from '../deckCommander';
import { fetchMoxfieldDeck } from './client';
import type { MoxfieldCardEntry } from './types';

function moxfieldEntryToCardEntry(
  entry: MoxfieldCardEntry,
  options?: { commander?: boolean },
): CardEntry {
  const card = entry.card ?? {};
  const scryfallId =
    (typeof card.scryfall_id === 'string' && card.scryfall_id) ||
    (typeof card.scryfallId === 'string' && card.scryfallId) ||
    '';

  return {
    id: scryfallId,
    name: card.name?.trim() ?? '',
    qty: entry.quantity ?? 1,
    categories: options?.commander ? [COMMANDER_CATEGORY] : [],
    set: card.set?.trim().toLowerCase() ?? '',
    collector_number: card.collector_number?.trim().toLowerCase(),
  };
}

function entriesFromBoard(board?: Record<string, MoxfieldCardEntry>) {
  return Object.values(board ?? {}).filter(entry => entry.card?.name?.trim());
}

export async function importMoxfieldDeck(publicId: string): Promise<Deck> {
  const moxfieldDeck = await fetchMoxfieldDeck(publicId);
  const cache = new Map();

  const cardEntries: CardEntry[] = [];
  const inPlayIndices: number[] = [];

  for (const entry of entriesFromBoard(moxfieldDeck.commanders)) {
    inPlayIndices.push(cardEntries.length);
    cardEntries.push(moxfieldEntryToCardEntry(entry, { commander: true }));
  }

  for (const entry of entriesFromBoard(moxfieldDeck.mainboard)) {
    cardEntries.push(moxfieldEntryToCardEntry(entry));
  }

  const sideboardEntries = entriesFromBoard(moxfieldDeck.sideboard).map(moxfieldEntryToCardEntry);
  const importEntries = [...cardEntries, ...sideboardEntries];
  const resolvedCards = await fetchCardInfoForImport(importEntries, cache);

  return {
    id: nanoid(),
    name: moxfieldDeck.name?.trim() || 'Imported deck',
    version: 2,
    system: MTG_CARD_SYSTEM.id,
    startingLife: 40,
    cards: buildImportedSection(cardEntries, resolvedCards),
    inPlay: buildImportedInPlay(cardEntries, inPlayIndices, resolvedCards),
    sideboard: sideboardEntries.length
      ? buildImportedSideboard(sideboardEntries, resolvedCards)
      : {},
    tokens: {},
  };
}

export async function importMoxfieldDecks(publicIds: string[]) {
  const decks: Deck[] = [];

  for (const publicId of publicIds) {
    decks.push(await importMoxfieldDeck(publicId));
  }

  return decks;
}

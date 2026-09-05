import * as a from 'arcsecond';
import type { CardEntry } from './constants';

const SECTION_COMMANDER = /^commander$/i;
const SECTION_DECK = /^deck$/i;

const cardCategory = (open, close) =>
  a
    .sequenceOf([
      a.choice([a.char(open), a.char(',')]),
      a.everyCharUntil(a.choice([a.char(','), a.char(close)])),
    ])
    .map(r => r?.[1]);

export const cardCategories = (open, close) =>
  a.sequenceOf([a.many1(cardCategory(open, close)), a.char(close)]).map(r => r?.[0]);

const inlineWhitespace = a.regex(/^[ \t]*/);

const collectorNumber = a
  .sequenceOf([
    inlineWhitespace,
    a.possibly(a.char('#')),
    a.regex(/^[0-9]+/),
  ])
  .map(r => r?.[2] || undefined);

function extractCollectorNumber(segment?: string | null) {
  if (!segment) return undefined;
  const match = segment.match(/(?:^|\))\s*#?\s*([0-9]+)(?=\s|$)/);
  return match?.[1];
}

function normalizeSetCode(set?: string) {
  if (!set) return undefined;
  const trimmed = set.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(':')) {
    return trimmed.split(':')[0].toLowerCase();
  }
  return trimmed.toLowerCase();
}

export const card = a
  .sequenceOf([
    a.possibly(a.digits),
    a.possibly(a.char('x')),
    a.everyCharUntil(a.choice([a.char('('), a.char('\n'), a.char('['), a.char('<'), a.endOfInput])),
    a.possibly(
      a.sequenceOf([a.char('('), a.everyCharUntil(a.char(')')), a.char(')')]),
    ).map(r => r?.[1]),
    a.everyCharUntil(a.choice([a.char('['), a.char('\n'), a.char('<'), a.endOfInput])),

    a.possibly(cardCategories('<', '>')),
    a.everyCharUntil(a.choice([a.char('['), a.char('\n'), a.endOfInput])),
    a.possibly(cardCategories('[', ']')),
    a.possibly(collectorNumber),
  ])
  .map(([rawQty, _, name, parenSet, afterParen, cats1, betweenAngles, categories, trailingCollector]) => {
    let set = parenSet;
    let resolvedCategories = categories;
    if (categories?.length === 1 && !set) {
      set = categories[0];
      resolvedCategories = cats1 || [];
    }

    const setCollector = set?.includes(':') ? set.split(':') : undefined;
    if (setCollector?.length === 2) {
      set = setCollector[0];
    }

    const collector_number =
      extractCollectorNumber(afterParen) ||
      trailingCollector ||
      (setCollector?.length === 2 ? setCollector[1] : undefined);

    let qty = parseInt(rawQty, 10);
    return {
      qty: isNaN(qty) ? 1 : qty,
      name: name.trim(),
      set: normalizeSetCode(set),
      categories: resolvedCategories,
      collector_number: collector_number || undefined,
    };
  });

const comment = a
  .sequenceOf([a.str('//'), a.everyCharUntil(a.choice([a.char('\n'), a.endOfInput]))])
  .map(r => null);

const barComment = a
  .sequenceOf([a.str('=='), a.everyCharUntil(a.choice([a.char('\n'), a.endOfInput]))])
  .map(r => null);

export const deck = a
  .many(
    a
      .sequenceOf([
        a.optionalWhitespace,
        a.choice([comment, barComment, card]),
        a.everyCharUntil(a.choice([a.char('\n'), a.endOfInput])),
        a.optionalWhitespace,
      ])
      .map(r => r?.[1]),
  )
  .map(r => r.filter(Boolean));

function isCommentLine(trimmed: string) {
  return trimmed.startsWith('//') || trimmed.startsWith('==');
}

export interface ParsedImportedCardList {
  cards: CardEntry[];
  inPlayIndices: number[];
}

export function parseImportedCardList(cardList: string): ParsedImportedCardList {
  const cards: CardEntry[] = [];
  const inPlayIndices: number[] = [];
  let markNextInPlay = false;

  for (const rawLine of cardList.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || isCommentLine(trimmed)) continue;

    if (SECTION_DECK.test(trimmed)) continue;

    if (SECTION_COMMANDER.test(trimmed)) {
      markNextInPlay = true;
      continue;
    }

    const parsed = card.run(rawLine).result;
    if (!parsed?.name?.length) continue;

    if (markNextInPlay) {
      inPlayIndices.push(cards.length);
      markNextInPlay = false;
    }

    cards.push(parsed as CardEntry);
  }

  return { cards, inPlayIndices };
}

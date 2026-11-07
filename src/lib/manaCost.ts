import type { CardEntryDetail } from './constants';

export type ManaBucket = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export interface ManaPip {
  bucket: ManaBucket;
  value: number;
  color: string;
  textColor: string;
}

export type ManaDisplayItem =
  | { kind: 'generic'; value: number }
  | { kind: 'variable'; letter: 'X' | 'Y' | 'Z' }
  | { kind: 'symbol'; bucket: Exclude<ManaBucket, 'C'> }
  | { kind: 'phyrexian'; bucket: Exclude<ManaBucket, 'C'> | 'C' };

export const MANA_ICON_BY_BUCKET: Record<Exclude<ManaBucket, 'C'>, string> = {
  W: '/plains.png',
  U: '/island.png',
  B: '/swamp.png',
  R: '/mountain.png',
  G: '/forest.png',
};

export const PHYREXIAN_ICON_BY_BUCKET: Record<Exclude<ManaBucket, 'C'>, string> = {
  W: '/phixyellow.png',
  U: '/phixblue.png',
  B: '/phixgrey.png',
  R: '/phixred.png',
  G: '/phixgreen.png',
};

export const PHYREXIAN_COLORLESS_ICON = '/phixgrey.png';

const COLORED_MANA = new Set<string>(['W', 'U', 'B', 'R', 'G']);

function phyrexianBucket(raw: string): Exclude<ManaBucket, 'C'> | 'C' | undefined {
  if (raw === 'P/P') return 'C';
  const match = raw.match(/^([WUBRG])\/P$/);
  return match ? (match[1] as Exclude<ManaBucket, 'C'>) : undefined;
}

export const MANA_COLORS: Record<ManaBucket, { color: string; textColor: string }> = {
  W: { color: '#f8f6d8', textColor: '#1a1a1a' },
  U: { color: '#0e68ab', textColor: '#ffffff' },
  B: { color: '#403c39', textColor: '#ffffff' },
  R: { color: '#d3202a', textColor: '#ffffff' },
  G: { color: '#00733e', textColor: '#ffffff' },
  C: { color: '#cac5c0', textColor: '#1a1a1a' },
};

const COLORED_DISPLAY_ORDER: Exclude<ManaBucket, 'C'>[] = ['W', 'U', 'B', 'R', 'G'];

const NON_MANA_SYMBOLS = new Set(['T', 'E', 'S']);

function bucketsForSymbol(raw: string): ManaBucket[] {
  if (/^\d+$/.test(raw)) {
    return ['C'];
  }

  if (raw === 'X' || raw === 'Y' || raw === 'Z') {
    return ['C'];
  }

  if (NON_MANA_SYMBOLS.has(raw)) {
    return [];
  }

  if (raw in MANA_COLORS && raw !== 'C') {
    return [raw as ManaBucket];
  }

  return [];
}

export function parseManaCost(manaCost: string): ManaPip[] {
  if (!manaCost) return [];

  const counts: Record<ManaBucket, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const pattern = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(manaCost))) {
    const raw = match[1];

    if (/^\d+$/.test(raw)) {
      counts.C += Number(raw);
      continue;
    }

    if (raw === 'X' || raw === 'Y' || raw === 'Z') {
      counts.C += 1;
      continue;
    }

    const phyrexian = phyrexianBucket(raw);
    if (phyrexian) {
      if (phyrexian === 'C') {
        counts.C += 1;
      } else {
        counts[phyrexian] += 1;
      }
      continue;
    }

    if (raw.includes('/')) {
      for (const part of raw.split('/')) {
        if (/^\d+$/.test(part)) {
          counts.C += Number(part);
        } else if (COLORED_MANA.has(part)) {
          counts[part as ManaBucket] += 1;
        }
      }
      continue;
    }

    const buckets = bucketsForSymbol(raw);
    if (!buckets.length) continue;

    if (buckets.length === 1) {
      counts[buckets[0]] += 1;
    } else {
      for (const bucket of buckets) {
        counts[bucket] += 1;
      }
    }
  }

  const pips: ManaPip[] = [];
  if (counts.C > 0) {
    pips.push({ bucket: 'C', value: counts.C, ...MANA_COLORS.C });
  }
  for (const bucket of COLORED_DISPLAY_ORDER) {
    if (counts[bucket] > 0) {
      pips.push({ bucket, value: counts[bucket], ...MANA_COLORS[bucket] });
    }
  }
  return pips;
}

/** One pip per mana symbol, in printed order ({X} → letter, {2} → number, {W} → icon). */
export function expandManaCostForDisplay(manaCost: string): ManaDisplayItem[] {
  if (!manaCost) return [];

  const items: ManaDisplayItem[] = [];
  const pattern = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(manaCost))) {
    const raw = match[1];

    if (/^\d+$/.test(raw)) {
      items.push({ kind: 'generic', value: Number(raw) });
      continue;
    }

    if (raw === 'X' || raw === 'Y' || raw === 'Z') {
      items.push({ kind: 'variable', letter: raw });
      continue;
    }

    if (NON_MANA_SYMBOLS.has(raw)) continue;

    const phyrexian = phyrexianBucket(raw);
    if (phyrexian) {
      items.push({ kind: 'phyrexian', bucket: phyrexian });
      continue;
    }

    if (raw.includes('/')) {
      for (const part of raw.split('/')) {
        if (/^\d+$/.test(part)) {
          items.push({ kind: 'generic', value: Number(part) });
        } else if (COLORED_MANA.has(part)) {
          items.push({ kind: 'symbol', bucket: part as Exclude<ManaBucket, 'C'> });
        }
      }
      continue;
    }

    if (raw in MANA_COLORS && raw !== 'C') {
      items.push({ kind: 'symbol', bucket: raw as Exclude<ManaBucket, 'C'> });
    }
  }

  return items;
}

/** Mana colors / colorless symbols present in a cost string (hybrids count as each color). */
export function getManaBucketsInCost(manaCost: string): Set<ManaBucket> {
  const present = new Set<ManaBucket>();
  if (!manaCost) return present;

  const pattern = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(manaCost))) {
    const raw = match[1];

    if (/^\d+$/.test(raw) || raw === 'X' || raw === 'Y' || raw === 'Z') {
      present.add('C');
      continue;
    }

    if (NON_MANA_SYMBOLS.has(raw)) continue;

    const phyrexian = phyrexianBucket(raw);
    if (phyrexian) {
      present.add(phyrexian);
      continue;
    }

    if (raw.includes('/')) {
      for (const part of raw.split('/')) {
        if (/^\d+$/.test(part)) {
          present.add('C');
        } else if (COLORED_MANA.has(part)) {
          present.add(part as ManaBucket);
        } else if (part === 'C') {
          present.add('C');
        }
      }
      continue;
    }

    if (raw in MANA_COLORS) {
      present.add(raw as ManaBucket);
    }
  }

  return present;
}

export function getManaBucketsInEntry(entry?: { detail?: CardEntryDetail }): Set<ManaBucket> {
  const present = new Set<ManaBucket>();
  if (!entry?.detail) return present;

  const costs: string[] = [];
  if (entry.detail.mana_cost) costs.push(entry.detail.mana_cost);
  for (const face of entry.detail.card_faces ?? []) {
    if (face.mana_cost) costs.push(face.mana_cost);
  }

  for (const cost of costs) {
    for (const bucket of getManaBucketsInCost(cost)) {
      present.add(bucket);
    }
  }

  return present;
}

export type ManaFilterMode = 'and' | 'or';

type DetailWithProduced = CardEntryDetail & { produced_mana?: string[] };

const BASIC_LAND_TYPES: [RegExp, ManaBucket][] = [
  [/\bPlains\b/, 'W'],
  [/\bIsland\b/, 'U'],
  [/\bSwamp\b/, 'B'],
  [/\bMountain\b/, 'R'],
  [/\bForest\b/, 'G'],
];

const ANY_COLOR_TEXT = /mana of any (one )?colou?r|any combination of colou?rs|mana of any type/i;

function isLandEntry(detail: CardEntryDetail): boolean {
  const frontType = detail.card_faces?.[0]?.type_line ?? detail.type_line ?? '';
  return /\bLand\b/.test(frontType);
}

/** Mana a land can add: Scryfall's produced_mana when present, otherwise read from its text. */
export function getManaBucketsProducedByEntry(detail: CardEntryDetail): Set<ManaBucket> {
  const present = new Set<ManaBucket>();
  const produced = (detail as DetailWithProduced).produced_mana;
  if (Array.isArray(produced) && produced.length) {
    for (const symbol of produced) {
      if (symbol in MANA_COLORS) present.add(symbol as ManaBucket);
    }
    return present;
  }

  const faces = detail.card_faces?.length ? detail.card_faces : [detail];
  for (const face of faces) {
    for (const [pattern, bucket] of BASIC_LAND_TYPES) {
      if (pattern.test(face.type_line ?? '')) present.add(bucket);
    }
    for (const line of (face.oracle_text ?? '').split('\n')) {
      const addIndex = line.search(/\badd\b/i);
      if (addIndex < 0) continue;
      const clause = line.slice(addIndex);
      if (ANY_COLOR_TEXT.test(clause)) {
        for (const bucket of COLORED_DISPLAY_ORDER) present.add(bucket);
      }
      for (const match of clause.matchAll(/\{([WUBRGC])\}/g)) {
        present.add(match[1] as ManaBucket);
      }
    }
  }
  return present;
}

/**
 * Colors a card counts as for the mana filter. Lands use the mana they produce;
 * other cards use the colored symbols in their cost, or C when they have none.
 */
export function getManaFilterBuckets(entry?: { detail?: CardEntryDetail }): Set<ManaBucket> {
  if (!entry?.detail) return new Set();
  if (isLandEntry(entry.detail)) return getManaBucketsProducedByEntry(entry.detail);

  const colors = new Set<ManaBucket>(
    [...getManaBucketsInEntry(entry)].filter(bucket => bucket !== 'C'),
  );
  if (colors.size === 0) colors.add('C');
  return colors;
}

/**
 * `selected` with 'or': the card has at least one of them (it may have other colors too).
 * `selected` with 'and': the card has every one of them.
 * `excluded`: the card has none of them.
 */
export function entryMatchesManaFilter(
  entry: { detail?: CardEntryDetail; qty?: number } | undefined,
  selected: ManaBucket[],
  mode: ManaFilterMode = 'or',
  excluded: ManaBucket[] = [],
): boolean {
  if (!selected.length && !excluded.length) return true;
  if (!entry || entry.qty === 0) return false;

  const buckets = getManaFilterBuckets(entry);
  if (excluded.some(bucket => buckets.has(bucket))) return false;
  if (!selected.length) return true;
  return mode === 'and'
    ? selected.every(bucket => buckets.has(bucket))
    : selected.some(bucket => buckets.has(bucket));
}

type DetailWithMana = CardEntryDetail & { mana_cost?: string };

export function getCardManaCost(detail?: CardEntryDetail): string | undefined {
  if (!detail) return undefined;

  const withMana = detail as DetailWithMana;
  if (withMana.mana_cost) return withMana.mana_cost;

  const face = withMana.card_faces?.[0] as DetailWithMana | undefined;
  return face?.mana_cost;
}

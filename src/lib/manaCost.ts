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
  | { kind: 'symbol'; bucket: Exclude<ManaBucket, 'C'> };

export const MANA_ICON_BY_BUCKET: Record<Exclude<ManaBucket, 'C'>, string> = {
  W: '/plains.png',
  U: '/island.png',
  B: '/swamp.png',
  R: '/mountain.png',
  G: '/forest.png',
};

const MANA_COLORS: Record<ManaBucket, { color: string; textColor: string }> = {
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

    if (raw.includes('/')) {
      for (const part of raw.split('/').map(p => p.replace(/P$/, ''))) {
        if (/^\d+$/.test(part)) {
          counts.C += Number(part);
        } else if (part in MANA_COLORS && part !== 'C') {
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

    if (raw.includes('/')) {
      for (const part of raw.split('/').map(p => p.replace(/P$/, ''))) {
        if (/^\d+$/.test(part)) {
          items.push({ kind: 'generic', value: Number(part) });
        } else if (part in MANA_COLORS && part !== 'C') {
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

type DetailWithMana = CardEntryDetail & { mana_cost?: string };

export function getCardManaCost(detail?: CardEntryDetail): string | undefined {
  if (!detail) return undefined;

  const withMana = detail as DetailWithMana;
  if (withMana.mana_cost) return withMana.mana_cost;

  const face = withMana.card_faces?.[0] as DetailWithMana | undefined;
  return face?.mana_cost;
}

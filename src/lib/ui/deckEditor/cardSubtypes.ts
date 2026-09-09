import { getSimpleType } from './cardGroupings';
import { SUBTYPE_LIST_BY_CATEGORY } from './cardSubtypeLists';

export const SPECIAL_DECK_TAB_TYPES = [
  'scheme',
  'vanguard',
  'conspiracy',
  'phenomenon',
  'dungeon',
  'battle',
  'plane',
] as const;

export type SpecialDeckTabType = (typeof SPECIAL_DECK_TAB_TYPES)[number];

const TABS_WITHOUT_SUBTYPE_FILTER = new Set([
  'deck',
  'tokens',
  'scheme',
  'vanguard',
  'conspiracy',
  'phenomenon',
]);

interface GroupableEntry {
  detail?: { type?: string; type_line?: string; card_faces?: Array<{ type_line?: string }> };
  qty?: number;
}

function getTypeLineParts(entry: GroupableEntry | undefined) {
  const parts: string[] = [];
  const faces = entry?.detail?.card_faces;
  if (faces?.length) {
    for (const face of faces) {
      if (face?.type_line) parts.push(face.type_line);
    }
    return parts;
  }

  const typeText = entry?.detail?.type ?? entry?.detail?.type_line;
  if (!typeText) return parts;

  for (const face of typeText.split(/\s*\/\/\s*/)) {
    if (face.trim()) parts.push(face.trim());
  }
  return parts;
}

export function getCardSubtypeSections(entry: GroupableEntry | undefined) {
  return getTypeLineParts(entry)
    .map(line => line.split(/\s[-—–]\s/).slice(1).join(' — ').trim())
    .filter(Boolean);
}

export function getCardSubtypeHaystack(entry: GroupableEntry | undefined) {
  return getCardSubtypeSections(entry).join(' ').toLowerCase();
}

export function subtypeMatchesHaystack(haystack: string, subtype: string) {
  const escaped = subtype
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  if (!escaped) return false;
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i').test(haystack);
}

export function entryMatchesSubtypeFilter(
  entry: GroupableEntry | undefined,
  activeSubtypes: string[],
) {
  if (!activeSubtypes.length) return true;
  if (!entry) return false;
  if (entry.qty === 0) return false;

  const haystack = getCardSubtypeHaystack(entry);
  return activeSubtypes.every(subtype => subtypeMatchesHaystack(haystack, subtype));
}

export function getOfficialSubtypeList(category: string) {
  return SUBTYPE_LIST_BY_CATEGORY[category.toLowerCase()] ?? [];
}

export function getAllOfficialSubtypes() {
  const subtypes = new Set<string>();
  for (const list of Object.values(SUBTYPE_LIST_BY_CATEGORY)) {
    for (const subtype of list) subtypes.add(subtype);
  }
  return [...subtypes].sort((a, b) => a.localeCompare(b));
}

export function matchesSpecialDeckType(simpleType: string | undefined, candidate: string) {
  if (!simpleType) return false;
  const type = candidate.toLowerCase();

  if (type === 'plane') {
    return /\bplane\b/.test(simpleType) && !/\bplaneswalker\b/.test(simpleType);
  }

  return simpleType.split(/\s+/).includes(type) || simpleType.endsWith(` ${type}`);
}

export function getSpecialDeckType(entry: GroupableEntry | undefined) {
  const simpleType = getSimpleType(entry);
  return SPECIAL_DECK_TAB_TYPES.find(candidate => matchesSpecialDeckType(simpleType, candidate));
}

export function tabSupportsSubtypeFilter(tab: string) {
  return !TABS_WITHOUT_SUBTYPE_FILTER.has(tab);
}

export function getSubtypeOptionsForTab(
  tab: string,
  catalogType: string,
  entries: GroupableEntry[],
) {
  if (tab === 'deck') {
    return [];
  }

  if (tab === 'all') {
    if (catalogType !== 'all') {
      return [...getOfficialSubtypeList(catalogType)];
    }
    return getAllOfficialSubtypes();
  }

  if (tab === 'unsorted') {
    return uniqueSortedSubtypes(entries);
  }

  if (tab === 'sideboard') {
    if (catalogType !== 'all') {
      return [...getOfficialSubtypeList(catalogType)];
    }
    return uniqueSortedSubtypes(entries);
  }

  return [...getOfficialSubtypeList(tab)];
}

function uniqueSortedSubtypes(entries: GroupableEntry[]) {
  const subtypes = new Set<string>();
  for (const entry of entries) {
    if (!entry?.qty) continue;
    for (const section of getCardSubtypeSections(entry)) {
      for (const subtype of tokenizeSubtypeSection(section)) {
        subtypes.add(subtype);
      }
    }
  }
  return [...subtypes].sort((a, b) => a.localeCompare(b));
}

function tokenizeSubtypeSection(section: string) {
  const normalized = section.trim();
  if (!normalized) return [];

  const officialMatches = [...Object.values(SUBTYPE_LIST_BY_CATEGORY).flat()].filter(subtype =>
    subtypeMatchesHaystack(normalized.toLowerCase(), subtype),
  );

  if (officialMatches.length) {
    return officialMatches.sort((a, b) => b.length - a.length);
  }

  return normalized.split(/\s+/);
}

export function countSpecialDeckTabs(entries: GroupableEntry[]) {
  const counts = Object.fromEntries(SPECIAL_DECK_TAB_TYPES.map(type => [type, 0])) as Record<
    SpecialDeckTabType,
    number
  >;

  for (const entry of entries) {
    const specialType = getSpecialDeckType(entry);
    if (specialType) counts[specialType] += entry.qty ?? 1;
  }

  return counts;
}

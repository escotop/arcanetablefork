import capitalize from 'lodash-es/capitalize';
import { Accessor, createMemo } from 'solid-js';

interface GroupedEntry {
  name: string;
  items: GroupableEntry[];
  count: number;
}

export interface CardGrouping {
  types: Record<string, GroupedEntry>;
  unsorted: GroupedEntry;
  totalCount: number;
}

interface GroupableEntry {
  detail?: { type?: string; type_line?: string };
  qty?: number;
}

function normalizeTypeSegment(typeLine: string) {
  return typeLine.toLowerCase().split(/\s[-—–]\s/)[0]?.trim();
}

export function getSimpleType(entry: GroupableEntry) {
  const faces = entry?.detail?.card_faces;
  if (faces?.[0]?.type_line) {
    return normalizeTypeSegment(faces[0].type_line);
  }

  const typeText = entry?.detail?.type ?? entry?.detail?.type_line;
  if (!typeText) return undefined;

  const frontFace = typeText.split(/\s*\/\/\s*/)[0]?.trim() ?? typeText;
  return normalizeTypeSegment(frontFace);
}

export function matchesCardType(simpleType: string | undefined, candidate: string) {
  if (!simpleType) return false;
  const type = candidate.toLowerCase();
  if (type === 'land') return /\bland\b/.test(simpleType);
  return simpleType.endsWith(type) || simpleType.split(/\s+/).includes(type);
}

export function getCardTypeCategory(entry: GroupableEntry, lowerTypes: string[]) {
  const simpleType = getSimpleType(entry);
  return lowerTypes.find(candidate => matchesCardType(simpleType, candidate));
}

export default function useCardGrouping(types: string[], entries: Accessor<GroupableEntry[]>) {
  const lowerTypes = createMemo(() => (types || []).map(type => type.toLowerCase()));

  const grouped = createMemo(() => {
    const types = lowerTypes().map(t => [t, { items: [], name: capitalize(t), count: 0 }]);
    const result = {
      types: Object.fromEntries(types),
      unsorted: {
        name: 'Unsorted',
        items: [],
        count: 0,
      },
      totalCount: 0,
    } as CardGrouping;

    for (const entry of entries()) {
      const type = getCardTypeCategory(entry, lowerTypes());
      if (type) {
        result.types[type].items.push(entry);
        result.types[type].count += entry.qty ?? 1;
      } else {
        result.unsorted.items.push(entry);
        result.unsorted.count += entry.qty ?? 1;
      }
      result.totalCount += entry.qty ?? 1;
    }

    return result;
  });

  return grouped;
}

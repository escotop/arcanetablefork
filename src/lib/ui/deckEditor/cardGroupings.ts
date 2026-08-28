import capitalize from 'lodash-es/capitalize';
import { Accessor, createMemo } from 'solid-js';
import { DetailedCardEntry } from '~/lib/constants';


interface GroupedEntry {
  name: string;
  items: DetailedCardEntry[];
  count: number;
}

export interface CardGrouping {
  types: Record<string, GroupedEntry>;
  unsorted: GroupedEntry;
  totalCount: number;
}

export default function useCardGrouping(types: string[], entries: Accessor<DetailedCardEntry[]>) {
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
      const simpleType = getSimpleType(entry);
      const type = lowerTypes().find(type => simpleType?.endsWith(type));
      if (type) {
        result.types[type].items.push(entry);
        result.types[type].count += entry.qty;
      } else {
        result.unsorted.items.push(entry);
        result.unsorted.count += entry.qty;
      }
      result.totalCount += entry.qty;
    }

    return result;
  });

  return grouped
}

function getSimpleType(entry: DetailedCardEntry) {
  return entry?.detail?.type?.toLowerCase()?.split('—')?.[0]?.trim();
}

export { getSimpleType };

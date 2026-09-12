import type { CardModifiers } from './card';
import type { Card } from './constants';
import { counters } from './ui/counterDialog';

export type CardCounterChangeLog = {
  cardName?: string;
  counterId: string;
  counterName: string;
  previousValue?: number;
  value?: number;
};

function resolveCounterName(counterId: string) {
  return counters().find(counter => counter.id === counterId)?.name ?? counterId;
}

function resolveCardName(card: Card) {
  return card.mesh?.userData?.card?.detail?.name ?? card.detail?.name;
}

export function buildCardCounterChangeLogs(
  card: Card,
  prev: CardModifiers,
  next: CardModifiers,
): CardCounterChangeLog[] {
  const prevCounters = prev.counters ?? {};
  const nextCounters = next.counters ?? {};
  const counterIds = new Set([...Object.keys(prevCounters), ...Object.keys(nextCounters)]);
  const cardName = resolveCardName(card);
  const changes: CardCounterChangeLog[] = [];

  for (const counterId of counterIds) {
    const previousValue = prevCounters[counterId];
    const value = nextCounters[counterId];
    if (previousValue === value) continue;

    changes.push({
      cardName,
      counterId,
      counterName: resolveCounterName(counterId),
      previousValue,
      value,
    });
  }

  return changes;
}

export function buildPlayerCustomCounterChangeLog(
  counterId: string,
  previousValue: number | undefined,
  value: number,
) {
  if (previousValue === value) return undefined;

  return {
    counterId,
    counterName: resolveCounterName(counterId),
    previousValue,
    value,
  };
}

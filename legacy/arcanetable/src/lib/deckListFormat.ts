import { CardEntry, DetailedCardEntry } from './constants';

export function getCardCollectorNumber(card: CardEntry | DetailedCardEntry) {
  return (
    card.collector_number ??
    (card as DetailedCardEntry).detail?.collector_number ??
    undefined
  );
}

export function formatDeckListLine(card: CardEntry | DetailedCardEntry) {
  const parts = [`${card.qty}`, card.name];
  if (card.set) parts.push(`[${card.set}]`);
  const collectorNumber = getCardCollectorNumber(card);
  if (collectorNumber) parts.push(`#${collectorNumber}`);
  return parts.join(' ');
}

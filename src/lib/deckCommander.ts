import { CardEntry, CardEntryDetail, DetailedCardEntry } from './constants';

export const COMMANDER_CATEGORY = 'commander';
export const MAX_COMMANDERS = 2;

interface CommanderCheckFace {
  type_line?: string;
  oracle_text?: string;
  effect?: string;
  power?: string | number | null;
  toughness?: string | number | null;
}

function getCommanderFaces(detail: CardEntryDetail | undefined): CommanderCheckFace[] {
  if (!detail) return [];
  if (detail.card_faces?.length) return detail.card_faces;
  return [detail];
}

function getOracleText(face: CommanderCheckFace) {
  return face.oracle_text ?? face.effect ?? '';
}

function hasPowerToughness(face: CommanderCheckFace) {
  const { power, toughness } = face;
  return power != null && power !== '' && toughness != null && toughness !== '';
}

function hasLegendaryCreatureTypeLine(typeLine: string | undefined) {
  if (!typeLine) return false;
  const lower = typeLine.toLowerCase();
  return lower.includes('legendary') && lower.includes('creature');
}

function hasLegendaryVehicleOrSpacecraft(typeLine: string | undefined) {
  if (!typeLine) return false;
  const lower = typeLine.toLowerCase();
  return (
    lower.includes('legendary') &&
    (lower.includes('vehicle') || lower.includes('spacecraft'))
  );
}

function hasCommanderOracleText(text: string | undefined) {
  if (!text) return false;
  return text.toLowerCase().includes('can be your commander');
}

function canFaceBeCommander(face: CommanderCheckFace) {
  const typeLine = face.type_line;
  if (hasLegendaryCreatureTypeLine(typeLine)) return true;
  if (hasLegendaryVehicleOrSpacecraft(typeLine) && hasPowerToughness(face)) return true;
  if (hasCommanderOracleText(getOracleText(face))) return true;
  return false;
}

export function canBeCommander(entry: Pick<DetailedCardEntry, 'detail'> | undefined) {
  return getCommanderFaces(entry?.detail).some(canFaceBeCommander);
}

export function isCommanderCard(entry: Pick<CardEntry, 'categories'> | undefined) {
  return entry?.categories?.includes(COMMANDER_CATEGORY) ?? false;
}

export function compareCommanderFirst(
  a: Pick<CardEntry, 'categories'> | undefined,
  b: Pick<CardEntry, 'categories'> | undefined,
) {
  return Number(isCommanderCard(b)) - Number(isCommanderCard(a));
}

export function sortCommandersFirst<T extends Pick<CardEntry, 'categories'>>(entries: T[]) {
  return [...entries].sort(compareCommanderFirst);
}

export function countCommanders(cards: Iterable<DetailedCardEntry | undefined>) {
  let count = 0;
  for (const card of cards) {
    if (card?.qty && isCommanderCard(card)) count += 1;
  }
  return count;
}

export function toggleCommanderCategories(categories: string[] | undefined, enable: boolean) {
  const next = (categories ?? []).filter(category => category !== COMMANDER_CATEGORY);
  if (enable) next.push(COMMANDER_CATEGORY);
  return next;
}

export function getCommanderNames(cards: Iterable<DetailedCardEntry | undefined>) {
  return [...cards]
    .filter((card): card is DetailedCardEntry => !!card?.qty && isCommanderCard(card))
    .map(card => card.name);
}

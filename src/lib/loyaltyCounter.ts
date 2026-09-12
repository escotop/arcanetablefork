import type { Card, CardEntryDetail } from './constants';
import type { PlayArea } from './playArea';
import { colorHashLight, isHistoricalLogReplayInProgress, playAreas, sendEvent } from './globals';
import { getCardById } from './scryfall/client';
import { localCustomCounters, registerCustomCounter } from './ui/counterDialog';
import { sha1 } from './utils';

export const LOYALTY_COUNTER_NAME = 'Loyalty';

function parseLoyaltyValue(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getCardDetail(card: Card): CardEntryDetail | undefined {
  return card.detail ?? (card.mesh?.userData?.card as Card | undefined)?.detail;
}

function getFaceDetail(detail: CardEntryDetail | undefined, faceIndex: number) {
  if (!detail) return undefined;
  if (!detail.card_faces?.length) return faceIndex === 0 ? detail : undefined;
  return detail.card_faces[faceIndex] ?? (faceIndex === 0 ? detail : undefined);
}

export function getVisibleCardFaceIndex(card: Card): 0 | 1 {
  if (!card.mesh?.userData.isDoubleSided) return 0;
  return card.mesh.userData.isFlipped ? 1 : 0;
}

export function isPlaneswalkerFace(detail: CardEntryDetail | undefined, faceIndex: number): boolean {
  const face = getFaceDetail(detail, faceIndex);
  if (!face) return false;
  if (parseLoyaltyValue(face.loyalty) !== undefined) return true;
  return /planeswalker/i.test(face.type_line ?? '');
}

export function parseFaceLoyalty(detail: CardEntryDetail | undefined, faceIndex: number): number | undefined {
  if (!isPlaneswalkerFace(detail, faceIndex)) return undefined;

  const face = getFaceDetail(detail, faceIndex);
  const fromFace = parseLoyaltyValue(face?.loyalty);
  if (fromFace !== undefined) return fromFace;

  if (faceIndex === 0) {
    return parseLoyaltyValue(detail?.loyalty);
  }

  return undefined;
}

export function isPlaneswalkerFaceVisible(card: Card): boolean {
  if (!card.mesh || card.mesh.userData.location !== 'battlefield') return false;

  const detail = getCardDetail(card);
  const faceIndex = getVisibleCardFaceIndex(card);
  if (!isPlaneswalkerFace(detail, faceIndex)) return false;

  const { isDoubleSided, isFlipped, isPublic } = card.mesh.userData;

  // Single-faced cards: flipped shows the card back, hide loyalty until flipped again.
  if (!isDoubleSided && isFlipped) return false;

  // Double-faced cards played face down stay hidden until face up.
  if (isDoubleSided && isFlipped && !isPublic) return false;

  return true;
}

export function isLoyaltyCounter(counter: { name?: string } | undefined): boolean {
  return counter?.name === LOYALTY_COUNTER_NAME;
}

async function resolveCardLoyalty(
  card: Card,
  faceIndex = getVisibleCardFaceIndex(card),
): Promise<number | undefined> {
  const detail = getCardDetail(card);
  let loyalty = parseFaceLoyalty(detail, faceIndex);
  if (loyalty !== undefined) return loyalty;

  if (!isPlaneswalkerFace(detail, faceIndex)) return undefined;

  const scryfallId = (detail as { id?: string } | undefined)?.id;
  if (!scryfallId) return undefined;

  const fresh = await getCardById(scryfallId);
  if (fresh && detail) {
    if (Array.isArray(fresh.card_faces)) {
      detail.card_faces = fresh.card_faces;
    }
    if (faceIndex === 0 && fresh.loyalty !== undefined) {
      detail.loyalty = fresh.loyalty;
    }
  }

  return parseFaceLoyalty(fresh ?? detail, faceIndex);
}

export async function ensureLocalLoyaltyCounterType() {
  const existing = localCustomCounters().find(counter => counter.name === LOYALTY_COUNTER_NAME);
  if (existing) return existing;

  const id = await sha1(LOYALTY_COUNTER_NAME);
  const counter = {
    id,
    name: LOYALTY_COUNTER_NAME,
    color: colorHashLight.hex(LOYALTY_COUNTER_NAME),
  };

  registerCustomCounter(counter);
  sendEvent({ type: 'createCounter', payload: { counter } });
  return counter;
}

export async function ensureLoyaltyCounterOnCard(card: Card, playArea: PlayArea) {
  if (!playArea.isLocalPlayArea || !card.mesh || !isPlaneswalkerFaceVisible(card)) return;

  const loyalty = await resolveCardLoyalty(card);
  if (loyalty === undefined) return;

  const loyaltyCounter = await ensureLocalLoyaltyCounterType();
  if (card.mesh.userData.modifiers?.counters?.[loyaltyCounter.id] !== undefined) return;

  playArea.modifyCard(card, modifiers => ({
    ...modifiers,
    counters: {
      ...modifiers.counters,
      [loyaltyCounter.id]: loyalty,
    },
  }));
}

export async function syncLoyaltyCounterForCard(card: Card) {
  const playArea = playAreas[card.clientId];
  if (!playArea?.isLocalPlayArea || !card.mesh) return;
  if (!isPlaneswalkerFaceVisible(card) || isHistoricalLogReplayInProgress()) return;

  await ensureLoyaltyCounterOnCard(card, playArea);
}

/** @deprecated use ensureLoyaltyCounterOnCard */
export async function applyLoyaltyWhenPlayingToBattlefield(card: Card, playArea: PlayArea) {
  await ensureLoyaltyCounterOnCard(card, playArea);
}

export function shouldRenderLoyaltyCounterOnCard(
  card: Card,
  counter: { name?: string } | undefined,
): boolean {
  if (!isLoyaltyCounter(counter)) return true;
  return isPlaneswalkerFaceVisible(card);
}

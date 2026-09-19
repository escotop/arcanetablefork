/**
 * Convergence Validator
 *
 * During shadow mode we only bridge tap/flip/join — not createCard yet.
 * Comparisons are limited to cards that exist in BOTH systems and to
 * tap/flip fields we actually mirror in the engine.
 */

import { GameState, CardId } from '../types';
import { PlayArea } from '../../lib/playArea';

export interface ConvergenceError {
  type: string;
  message: string;
  cardId?: string;
  details?: unknown;
}

/** Errors that indicate a real sync bug (not incomplete migration). */
const ACTIONABLE_ERROR_TYPES = new Set([
  'tap_mismatch',
  'flip_mismatch',
  'validation_error',
]);

export function validateConvergence(
  playAreas: Record<number, PlayArea | undefined>,
  newState: GameState,
): ConvergenceError[] {
  const errors: ConvergenceError[] = [];

  try {
    for (const [, playArea] of Object.entries(playAreas)) {
      if (!playArea) continue;

      for (const card of playArea.battlefieldZone.cards) {
        const cardId = card.id;
        if (!cardId) continue;

        const newCard = newState.cards[CardId(cardId)];
        // Shadow mode: skip cards not yet mirrored in the engine (no CARD_CREATED bridge).
        if (!newCard) continue;

        const oldTapped = card.mesh?.userData.isTapped ?? false;
        if (oldTapped !== newCard.tapped) {
          errors.push({
            type: 'tap_mismatch',
            message: `Card ${cardId} tap mismatch`,
            cardId,
            details: { old: oldTapped, new: newCard.tapped },
          });
        }

        const oldFlipped = card.mesh?.userData.isFlipped ?? false;
        if (oldFlipped !== newCard.flipped) {
          errors.push({
            type: 'flip_mismatch',
            message: `Card ${cardId} flip mismatch`,
            cardId,
            details: { old: oldFlipped, new: newCard.flipped },
          });
        }
      }
    }
  } catch (error) {
    errors.push({
      type: 'validation_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return errors;
}

export function filterActionableConvergenceErrors(
  errors: ConvergenceError[],
): ConvergenceError[] {
  return errors.filter(err => ACTIONABLE_ERROR_TYPES.has(err.type));
}

export interface ConvergenceValidatorOptions {
  intervalMs?: number;
  /** Skip checks until gameplay/event replay is ready (avoids noise at join). */
  isReady?: () => boolean;
}

/**
 * Periodic convergence validation (dev mode only).
 */
export function startConvergenceValidator(
  getPlayAreas: () => Record<number, PlayArea | undefined>,
  getGameState: () => GameState,
  options: ConvergenceValidatorOptions | number = {},
): () => void {
  const opts =
    typeof options === 'number' ? { intervalMs: options } : options;
  const intervalMs = opts.intervalMs ?? 5000;
  const isReady = opts.isReady ?? (() => true);

  if (!import.meta.env.DEV) {
    return () => {};
  }

  let lastLoggedSignature = '';

  const intervalId = setInterval(() => {
    if (!isReady()) return;

    const state = getGameState();
    // Nothing bridged yet — no point comparing battlefield tap/flip.
    if (Object.keys(state.cards).length === 0) return;

    const actionable = filterActionableConvergenceErrors(
      validateConvergence(getPlayAreas(), state),
    );

    if (actionable.length === 0) return;

    const signature = actionable
      .map(e => `${e.type}:${e.cardId ?? ''}`)
      .sort()
      .join('|');
    if (signature === lastLoggedSignature) return;
    lastLoggedSignature = signature;

    console.warn('[Convergence] Actionable mismatches (tap/flip):', actionable);
  }, intervalMs);

  return () => {
    clearInterval(intervalId);
  };
}

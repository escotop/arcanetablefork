import { devLog } from './devLog';

/**
 * While active, skip Scryfall and use alternate providers. The window follows Scryfall's own
 * Retry-After (time until a route recovers), clamped to these bounds. It used to be a fixed
 * 5 minutes, which kept the whole app on the much weaker fallback long after Scryfall was fine.
 */
export const SCRYFALL_FALLBACK_MIN_MS = 10_000;
export const SCRYFALL_FALLBACK_MAX_MS = 2 * 60_000;
/** Used when the caller does not know how long Scryfall will be unavailable. */
export const SCRYFALL_FALLBACK_DURATION_MS = 60_000;

let fallbackUntil = 0;
let fallbackNotified = false;
const activationListeners = new Set<() => void>();

/** Notified each time the fallback window opens (e.g. to prepare the offline card index). */
export function onScryfallFallbackActivated(listener: () => void) {
  activationListeners.add(listener);
  return () => activationListeners.delete(listener);
}

export function isScryfallFallbackActive(now = Date.now()): boolean {
  return now < fallbackUntil;
}

export function getScryfallFallbackRemainingMs(now = Date.now()): number {
  return Math.max(0, fallbackUntil - now);
}

/** Call when Scryfall cannot be reached. Repeat calls only ever extend the window. */
export function activateScryfallFallback(
  source: string,
  reason?: string,
  durationMs = SCRYFALL_FALLBACK_DURATION_MS,
) {
  const wasActive = isScryfallFallbackActive();
  const clamped = Math.min(SCRYFALL_FALLBACK_MAX_MS, Math.max(SCRYFALL_FALLBACK_MIN_MS, durationMs));
  fallbackUntil = Math.max(fallbackUntil, Date.now() + clamped);
  if (!wasActive) {
    activationListeners.forEach(listener => {
      try {
        listener();
      } catch {
        // listeners must not break the caller
      }
    });
    devLog.warn(
      `[Scryfall fallback] ${source}${reason ? `: ${reason}` : ''} — alternate providers for ${Math.round(clamped / 1000)}s`,
    );
  }
}

export function consumeScryfallFallbackNotice(): boolean {
  if (!isScryfallFallbackActive() || fallbackNotified) return false;
  fallbackNotified = true;
  return true;
}

/** @internal */
export function resetScryfallFallbackForTests() {
  fallbackUntil = 0;
  fallbackNotified = false;
}

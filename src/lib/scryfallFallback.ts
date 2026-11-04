import { devLog } from './devLog';

/** After any Scryfall failure, avoid Scryfall batch/API calls and use alternate providers. */
export const SCRYFALL_FALLBACK_DURATION_MS = 5 * 60 * 1000;

let fallbackUntil = 0;
let fallbackNotified = false;

export function isScryfallFallbackActive(now = Date.now()): boolean {
  return now < fallbackUntil;
}

export function getScryfallFallbackRemainingMs(now = Date.now()): number {
  return Math.max(0, fallbackUntil - now);
}

/**
 * Call on the first (or any) Scryfall failure. Refreshes the 5-minute window on repeat calls.
 */
export function activateScryfallFallback(source: string, reason?: string) {
  const wasActive = isScryfallFallbackActive();
  fallbackUntil = Date.now() + SCRYFALL_FALLBACK_DURATION_MS;
  if (!wasActive) {
    devLog.warn(
      `[Scryfall fallback] ${source}${reason ? `: ${reason}` : ''} — alternate providers for 5 minutes`,
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

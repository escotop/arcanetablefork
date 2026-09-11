let suppressedUntil = 0;

export function suppressBoardInteractionAfterPing(ms = 400) {
  suppressedUntil = performance.now() + ms;
}

export function isBoardInteractionSuppressed() {
  return performance.now() < suppressedUntil;
}

import { createSignal } from 'solid-js';

export interface PendingBulkMove {
  cardCount: number;
  destination: string;
  execute: () => void;
}

const [pendingBulkMove, setPendingBulkMove] = createSignal<PendingBulkMove | null>(null);

export function requestBulkMoveConfirmation(
  destination: string,
  cardCount: number,
  execute: () => void,
  confirm: boolean | undefined,
) {
  if (confirm) {
    setPendingBulkMove({ destination, cardCount, execute });
    return;
  }
  execute();
}

export function confirmPendingBulkMove() {
  const move = pendingBulkMove();
  if (!move) return;
  setPendingBulkMove(null);
  move.execute();
}

export function cancelPendingBulkMove() {
  setPendingBulkMove(null);
}

export { pendingBulkMove };

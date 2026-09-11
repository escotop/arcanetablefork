import { gameState, provider } from './globals';
import type { SyncBarrier } from './worldSnapshot';

let traceSeq = 0;
let traceId = '';
let tracing = false;
let lastStep = '';
let lastStepAt = 0;

function getLocalSessionId(): string | undefined {
  return provider?.awareness?.getLocalState()?.playerSessionId as string | undefined;
}

function getActiveBarrier(): SyncBarrier | undefined {
  const barrier = gameState?.get?.('syncBarrier') as SyncBarrier | undefined;
  if (!barrier || barrier.status === 'released') return undefined;
  return barrier;
}

function isLocalJoiner(barrier?: SyncBarrier): boolean {
  const localSessionId = getLocalSessionId();
  return !!localSessionId && !!barrier && localSessionId === barrier.joinerSessionId;
}

function someoneElseIsJoining(): boolean {
  const localClientId = provider?.awareness?.clientID;
  if (!provider?.awareness) return false;
  for (const [clientId, entry] of provider.awareness.getStates()) {
    if (Number(clientId) === Number(localClientId)) continue;
    if (entry?.syncJoining) return true;
  }
  return false;
}

export function isReloadTraceActive(): boolean {
  return tracing;
}

export function shouldLogReloadOtherPlayer(): boolean {
  const barrier = getActiveBarrier();
  if (barrier && !isLocalJoiner(barrier)) return true;
  if (someoneElseIsJoining()) return true;
  return tracing;
}

export function beginReloadOtherTrace(reason: string, detail: Record<string, unknown> = {}) {
  if (tracing) {
    logReloadOther('trace-already-active', { reason, ...detail });
    return;
  }
  tracing = true;
  traceSeq = 0;
  traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  logReloadOther('trace-begin', { reason, traceId, ...detail });
}

export function endReloadOtherTrace(reason: string, detail: Record<string, unknown> = {}) {
  if (!tracing) return;
  logReloadOther('trace-end', { reason, traceId, ...detail }, { track: false });
  tracing = false;
  traceId = '';
}

export function logReloadOther(
  step: string,
  detail: Record<string, unknown> = {},
  options: { track?: boolean } = {},
) {
  if (!shouldLogReloadOtherPlayer() && step !== 'trace-begin' && step !== 'trace-end') {
    return;
  }

  traceSeq += 1;
  if (options.track !== false) {
    lastStep = step;
    lastStepAt = performance.now();
  }

  const barrier = getActiveBarrier();
  const role = barrier
    ? isLocalJoiner(barrier)
      ? 'joiner'
      : 'host-or-other'
    : someoneElseIsJoining()
      ? 'other'
      : 'unknown';

  console.log(`[reload-other:${String(traceSeq).padStart(3, '0')}:${step}]`, {
    traceId: traceId || 'no-trace',
    role,
    localSessionId: getLocalSessionId(),
    barrierStatus: barrier?.status,
    barrierId: barrier?.id,
    joinerSessionId: barrier?.joinerSessionId,
    ...detail,
  });
}

export function getLastReloadOtherStep() {
  return { step: lastStep, at: lastStepAt, traceId };
}

export function syncReloadOtherTraceFromState(reason: string) {
  const barrier = getActiveBarrier();
  const joining = someoneElseIsJoining();
  const otherPlayerReload = (barrier && !isLocalJoiner(barrier)) || joining;

  if (otherPlayerReload && !tracing) {
    beginReloadOtherTrace(reason, {
      barrierStatus: barrier?.status,
      barrierId: barrier?.id,
      joining,
    });
    return;
  }

  if (!otherPlayerReload && tracing) {
    endReloadOtherTrace(reason);
  }
}

export function initReloadOtherPlayerDebug() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', event => {
    if (!event.message?.includes('Maximum call stack size exceeded')) return;
    const last = getLastReloadOtherStep();
    console.error('[reload-other:STACK_OVERFLOW]', {
      message: event.message,
      lastStep: last.step,
      lastStepAt: last.at,
      traceId: last.traceId,
      tracing,
    });
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    if (!message.includes('Maximum call stack size exceeded')) return;
    const last = getLastReloadOtherStep();
    console.error('[reload-other:STACK_OVERFLOW_PROMISE]', {
      message,
      lastStep: last.step,
      lastStepAt: last.at,
      traceId: last.traceId,
      tracing,
    });
  });

  gameState?.observe?.(event => {
    for (const key of event.changes.keys.keys()) {
      if (key === 'worldSnapshot' || key === 'syncBarrier') {
        const change = event.changes.keys.get(key);
        logReloadOther(`gamestate-key-${key}`, {
          action: change?.action,
        });
      }
    }
    syncReloadOtherTraceFromState('gameState-observe');
  });

  provider?.awareness?.on?.('change', () => {
    syncReloadOtherTraceFromState('awareness-change');
  });

  logReloadOther('debug-init', { note: 'reload-other tracing ready' });
}

import { devLog } from './devLog';

const LOG_PREFIX = '[load]';

type Mark = {
  label: string;
  atMs: number;
  durationMs?: number;
  detail?: Record<string, unknown>;
};

type LoadSession = {
  label: string;
  start: number;
  marks: Mark[];
};

type ReplayStats = {
  start: number;
  processed: number;
  skippedCatchUp: number;
  skippedLocal: number;
  batched: number;
  delayMs: number;
  handleMs: number;
  byType: Record<string, number>;
};

let session: LoadSession | null = null;
let replayStats: ReplayStats | null = null;

function formatMs(ms: number) {
  return `${ms.toFixed(1)}ms`;
}

function logLine(message: string, detail?: Record<string, unknown>) {
  if (detail && Object.keys(detail).length > 0) {
    devLog.log(`${LOG_PREFIX} ${message}`, detail);
  } else {
    devLog.log(`${LOG_PREFIX} ${message}`);
  }
}

export function beginLoadProfile(label: string, detail?: Record<string, unknown>) {
  session = { label, start: performance.now(), marks: [] };
  replayStats = {
    start: performance.now(),
    processed: 0,
    skippedCatchUp: 0,
    skippedLocal: 0,
    batched: 0,
    delayMs: 0,
    handleMs: 0,
    byType: {},
  };
  logLine(`▶ ${label}`, detail);
}

export function markLoadProfile(label: string, detail?: Record<string, unknown>) {
  if (!session) {
    devLog.warn(`${LOG_PREFIX} mark without active session: ${label}`, detail);
    return;
  }

  const atMs = performance.now() - session.start;
  session.marks.push({ label, atMs, detail });
  logLine(`  +${formatMs(atMs)} ${label}`, detail);
}

export async function profileAsync<T>(
  label: string,
  fn: () => Promise<T>,
  detail?: Record<string, unknown>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - start;
    logLine(`  ⏱ ${label} ${formatMs(durationMs)}`, detail);
    if (session) {
      session.marks.push({
        label,
        atMs: performance.now() - session.start,
        durationMs,
        detail,
      });
    }
    return result;
  } catch (error) {
    const durationMs = performance.now() - start;
    devLog.error(`${LOG_PREFIX} ✗ ${label} failed after ${formatMs(durationMs)}`, error, detail);
    throw error;
  }
}

export function profileSync<T>(label: string, fn: () => T, detail?: Record<string, unknown>): T {
  const start = performance.now();
  try {
    const result = fn();
    const durationMs = performance.now() - start;
    logLine(`  ⏱ ${label} ${formatMs(durationMs)}`, detail);
    if (session) {
      session.marks.push({
        label,
        atMs: performance.now() - session.start,
        durationMs,
        detail,
      });
    }
    return result;
  } catch (error) {
    const durationMs = performance.now() - start;
    devLog.error(`${LOG_PREFIX} ✗ ${label} failed after ${formatMs(durationMs)}`, error, detail);
    throw error;
  }
}

export function isLoadProfiling() {
  return session !== null;
}

export function recordReplaySkip(kind: 'catchUp' | 'local') {
  if (!replayStats) return;
  if (kind === 'catchUp') replayStats.skippedCatchUp++;
  else replayStats.skippedLocal++;
}

export function recordReplayBatch(size: number) {
  if (!replayStats) return;
  replayStats.batched += size;
}

export function recordReplayDelay(ms: number) {
  if (!replayStats) return;
  replayStats.delayMs += ms;
}

export async function profileReplayHandle<T>(type: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    if (!replayStats) return;
    const handleMs = performance.now() - start;
    replayStats.processed++;
    replayStats.handleMs += handleMs;
    replayStats.byType[type] = (replayStats.byType[type] ?? 0) + 1;
    if (handleMs >= 16) {
      devLog.log(`${LOG_PREFIX}   replay ${type} ${formatMs(handleMs)}`);
    }
  }
}

export function endLoadProfile(detail?: Record<string, unknown>) {
  if (!session) return;

  const totalMs = performance.now() - session.start;
  logLine(`■ ${session.label} finished in ${formatMs(totalMs)}`, detail);

  if (session.marks.length > 0) {
    const rows = session.marks.map((mark, index) => ({
      '#': index + 1,
      at: formatMs(mark.atMs),
      duration: mark.durationMs !== undefined ? formatMs(mark.durationMs) : '',
      step: mark.label,
      ...flattenDetail(mark.detail),
    }));
    devLog.log(`${LOG_PREFIX} timeline "${session.label}"`);
    console.table(rows);
  }

  if (replayStats && replayStats.processed > 0) {
    const replayMs = performance.now() - replayStats.start;
    devLog.log(`${LOG_PREFIX} replay summary`, {
      wallMs: formatMs(replayMs),
      processed: replayStats.processed,
      skippedCatchUp: replayStats.skippedCatchUp,
      skippedLocal: replayStats.skippedLocal,
      batched: replayStats.batched,
      delayMs: Math.round(replayStats.delayMs),
      handleMs: Math.round(replayStats.handleMs),
      byType: replayStats.byType,
    });
  }

  session = null;
  replayStats = null;
}

function flattenDetail(detail?: Record<string, unknown>) {
  if (!detail) return {};
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;
    flat[key] =
      typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  }
  return flat;
}

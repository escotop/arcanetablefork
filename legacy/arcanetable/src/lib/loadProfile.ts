import { devLog } from './devLog';

const PREFIX = '[loadProfile]';

type Mark = {
  label: string;
  atMs: number;
  detail?: Record<string, unknown>;
};

type LoadSession = {
  label: string;
  start: number;
  marks: Mark[];
};

let session: LoadSession | null = null;

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

let replayStats: ReplayStats | null = null;

function formatDetail(detail?: Record<string, unknown>) {
  if (!detail || !Object.keys(detail).length) return '';
  return JSON.stringify(detail);
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
  devLog.log(`${PREFIX} ▶ ${label}`, formatDetail(detail));
}

export function markLoadProfile(label: string, detail?: Record<string, unknown>) {
  if (!session) return;
  const atMs = performance.now() - session.start;
  session.marks.push({ label, atMs, detail });
  devLog.log(`${PREFIX}   ${atMs.toFixed(0)}ms  ${label}`, formatDetail(detail));
}

export async function profileAsync<T>(
  label: string,
  fn: () => Promise<T>,
  detail?: Record<string, unknown>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    markLoadProfile(label, { ...detail, durationMs: Math.round(performance.now() - start) });
  }
}

export function profileSync<T>(label: string, fn: () => T, detail?: Record<string, unknown>): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    markLoadProfile(label, { ...detail, durationMs: Math.round(performance.now() - start) });
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

export async function profileReplayHandle<T>(
  type: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    if (!replayStats) return;
    const ms = performance.now() - start;
    replayStats.processed++;
    replayStats.handleMs += ms;
    replayStats.byType[type] = (replayStats.byType[type] ?? 0) + 1;
  }
}

export function endLoadProfile(detail?: Record<string, unknown>) {
  if (!session) return;

  const totalMs = performance.now() - session.start;
  devLog.log(`${PREFIX} ■ ${session.label}  ${totalMs.toFixed(0)}ms total`, formatDetail(detail));

  if (session.marks.length) {
    console.table(
      session.marks.map(mark => ({
        ms: Math.round(mark.atMs),
        step: mark.label,
        ...mark.detail,
      })),
    );
  }

  if (replayStats) {
    const replayWallMs = performance.now() - replayStats.start;
    const topTypes = Object.entries(replayStats.byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([type, count]) => `${type}:${count}`)
      .join(', ');
    devLog.log(`${PREFIX}   gameLog replay`, {
      wallMs: Math.round(replayWallMs),
      processed: replayStats.processed,
      skippedCatchUp: replayStats.skippedCatchUp,
      skippedLocal: replayStats.skippedLocal,
      batchedChildEvents: replayStats.batched,
      artificialDelayMs: Math.round(replayStats.delayMs),
      handleMs: Math.round(replayStats.handleMs),
      topEventTypes: topTypes || '(none)',
    });
  }

  session = null;
  replayStats = null;
}

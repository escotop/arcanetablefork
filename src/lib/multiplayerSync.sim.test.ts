import { vi } from 'vitest';

vi.mock('../main3d', () => ({
  readjustPlayAreas: () => {},
}));

vi.mock('./ui/counterDialog', () => ({
  registerCustomCounter: () => {},
}));

vi.mock('./ui/log', () => ({
  isLogMessageStackable: () => false,
}));

vi.mock('./sounds', () => ({
  playDrawSound: () => {},
  playPlayCardSound: () => {},
  playTapSound: () => {},
  playShuffleDeckSound: () => {},
  playCounterSoundForModifierChange: () => {},
}));

import { expect, test } from 'vitest';
import { runMultiplayerSyncStress, MAX_SYNC_STRESS_ACTIONS } from './multiplayerSync.sim.runner';

test(
  'two-player sync stress: draw, play, tap, graveyard (up to 200 actions)',
  async () => {
    const result = await runMultiplayerSyncStress(MAX_SYNC_STRESS_ACTIONS);
    if (!result.ok) {
      throw new Error(
        [
          `Desync after action #${result.actionIndex + 1} (${result.kind}, actor ${result.actorId}).`,
          result.diagnosis,
          result.lastEvent
            ? `Last entry: ${JSON.stringify(result.lastEvent).slice(0, 500)}`
            : '',
        ].join('\n\n'),
      );
    }
    expect(result.logLength).toBeGreaterThan(0);
  },
  180_000,
);

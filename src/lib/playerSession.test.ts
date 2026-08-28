import { expect, test, vi } from 'vitest';
import {
  findJoinClientIdForClientId,
  findJoinClientIdForSession,
  persistJoinBinding,
} from './playerSession';

function mockGameLog(entries: unknown[]) {
  return {
    length: entries.length,
    get(index: number) {
      return entries[index];
    },
  };
}

test('findJoinClientIdForSession', () => {
  const gameLog = mockGameLog([
    { type: 'join', clientID: 42, payload: { playerSessionId: 'session-a' } },
    {
      type: 'bulk',
      clientID: 99,
      events: [{ type: 'join', clientID: 7, payload: { playerSessionId: 'session-b' } }],
    },
  ]);

  expect(findJoinClientIdForSession(gameLog as never, 'session-a')).toBe(42);
  expect(findJoinClientIdForSession(gameLog as never, 'session-b')).toBe(7);
  expect(findJoinClientIdForSession(gameLog as never, 'missing')).toBeUndefined();
});

test('findJoinClientIdForClientId fallback', () => {
  const gameLog = mockGameLog([
    { type: 'join', clientID: 42, payload: {} },
  ]);

  expect(findJoinClientIdForClientId(gameLog as never, 42)).toBe(42);
  expect(findJoinClientIdForClientId(gameLog as never, 99)).toBeUndefined();
});

test('kick invalidates session and client reconnect lookup', () => {
  const gameLog = mockGameLog([
    { type: 'join', clientID: 42, payload: { playerSessionId: 'session-a' } },
    {
      type: 'kick',
      clientID: 7,
      payload: { targetClientId: 42, playerSessionId: 'session-a' },
    },
    { type: 'join', clientID: 99, payload: { playerSessionId: 'session-a' } },
  ]);

  expect(findJoinClientIdForSession(gameLog as never, 'session-a')).toBe(99);
  expect(findJoinClientIdForClientId(gameLog as never, 42)).toBeUndefined();
  expect(findJoinClientIdForClientId(gameLog as never, 99)).toBe(99);
});

test('persistJoinBinding roundtrip', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  persistJoinBinding('game-1', { playerSessionId: 's1', clientId: 42 });
  expect(storage.get('arcanetable-join-binding:game-1')).toContain('"clientId":42');
});

import { clearJoinBinding } from './playerSession';

export const GAME_DB_PREFIX = 'arcanetable-';
const LAST_ACCESSED_KEY = 'arcanetable-game-last-access';
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

function readLastAccessMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LAST_ACCESSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeLastAccessMap(map: Record<string, number>) {
  localStorage.setItem(LAST_ACCESSED_KEY, JSON.stringify(map));
}

export function gameIdFromDbName(name: string): string | undefined {
  if (!name.startsWith(GAME_DB_PREFIX)) return undefined;
  const gameId = name.slice(GAME_DB_PREFIX.length);
  return gameId || undefined;
}

/** Record that a saved game was opened (call when entering a game room). */
export function touchGameLastAccess(gameId: string) {
  const map = readLastAccessMap();
  map[gameId] = Date.now();
  writeLastAccessMap(map);
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete ${name}`));
    request.onblocked = () => resolve();
  });
}

function clearGameSideStorage(gameId: string) {
  clearJoinBinding(gameId);
  sessionStorage.removeItem(`arcanetable-game-meta:${gameId}`);
}

/** Remove IndexedDB saves not opened in the last 3 days. Safe to call on app startup. */
export async function pruneStaleGameDatabases() {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;

  const databases = await indexedDB.databases();
  const map = readLastAccessMap();
  const now = Date.now();
  let mapChanged = false;

  for (const db of databases) {
    const name = db.name;
    if (!name) continue;

    const gameId = gameIdFromDbName(name);
    if (!gameId) continue;

    const lastAccess = map[gameId];
    if (lastAccess === undefined) continue;
    if (now - lastAccess <= STALE_AFTER_MS) continue;

    await deleteIndexedDb(name);
    delete map[gameId];
    mapChanged = true;
    clearGameSideStorage(gameId);
  }

  if (mapChanged) writeLastAccessMap(map);
}

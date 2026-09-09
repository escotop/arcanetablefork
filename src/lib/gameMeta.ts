export interface StoredGameMeta {
  name: string;
  life: number;
  commanderLife?: number;
  cardSystemUri: string;
  deckId?: string;
}

function gameMetaKey(gameId: string) {
  return `arcanetable-game-meta:${gameId}`;
}

export function saveGameMeta(gameId: string, meta: StoredGameMeta) {
  sessionStorage.setItem(gameMetaKey(gameId), JSON.stringify(meta));
}

export function loadGameMeta(gameId: string): StoredGameMeta | null {
  const raw = sessionStorage.getItem(gameMetaKey(gameId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredGameMeta;
  } catch {
    return null;
  }
}

export function updateGameMetaLife(
  gameId: string,
  life: number,
  commanderLife?: number,
) {
  const existing = loadGameMeta(gameId);
  if (!existing) return;
  saveGameMeta(gameId, {
    ...existing,
    life,
    ...(commanderLife !== undefined ? { commanderLife } : {}),
  });
}

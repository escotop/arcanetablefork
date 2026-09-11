const LOG_OMITTED_USERDATA_KEYS = new Set([
  'cardBack',
  'publicCardBack',
  'resting',
  'spanishPreviewSavedMat',
  'spanishPreviewSavedUrl',
  // Three.js mesh references that would create circular refs
  'pt',
  'token',
  'handMana',
]);

const LOG_OMITTED_USERDATA_EPHEMERAL_KEYS = [
  'card_face_urls',
  'previousLocation',
  'previousZoneId',
  'previousValue',
  'wasPublic',
  'dragOffset',
  'dragQuat',
] as const;

const LOG_DETAIL_SCALAR_KEYS = [
  'id',
  'name',
  'oracle_id',
  'type_line',
  'mana_cost',
  'power',
  'toughness',
  'set',
  'collector_number',
  'layout',
  'oracle_text',
  'loyalty',
  'defense',
  'clientId',
] as const;

const LOG_IMAGE_URI_KEYS = ['small', 'normal', 'large', 'png', 'art_crop', 'border_crop'] as const;

const MAX_DETAIL_FACE_DEPTH = 3;

function pickImageUris(imageUris: Record<string, string> | undefined) {
  if (!imageUris) return undefined;

  const picked = Object.fromEntries(
    LOG_IMAGE_URI_KEYS.flatMap(key => {
      const value = imageUris[key];
      return value ? [[key, value]] : [];
    }),
  );

  return Object.keys(picked).length > 0 ? picked : undefined;
}

/** Keep only fields needed to render cards when replaying the game log. */
export function slimCardDetailForLog(
  detail: Record<string, unknown> | undefined,
  depth = 0,
): Record<string, unknown> | undefined {
  if (!detail || depth > MAX_DETAIL_FACE_DEPTH) return undefined;

  const slim: Record<string, unknown> = {};
  for (const key of LOG_DETAIL_SCALAR_KEYS) {
    if (detail[key] !== undefined) slim[key] = detail[key];
  }

  const imageUris = pickImageUris(detail.image_uris as Record<string, string> | undefined);
  if (imageUris) slim.image_uris = imageUris;

  const faces = detail.card_faces;
  if (Array.isArray(faces) && faces.length > 0) {
    slim.card_faces = faces
      .slice(0, 2)
      .map(face => slimCardDetailForLog(face as Record<string, unknown>, depth + 1))
      .filter((face): face is Record<string, unknown> => !!face);
  }

  return slim;
}

export function slimCardForLog(card: Record<string, unknown> | undefined) {
  if (!card) return undefined;

  return {
    id: card.id,
    clientId: card.clientId,
    customArtUrl: card.customArtUrl,
    detail: slimCardDetailForLog(card.detail as Record<string, unknown> | undefined),
  };
}

function cloneJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Strip Three.js materials and other non-JSON fields before persisting to Yjs. */
export function serializeCardUserDataForLog(userData: Record<string, unknown>) {
  const cloneable = Object.fromEntries(
    Object.entries(userData).filter(([key]) => !LOG_OMITTED_USERDATA_KEYS.has(key)),
  );

  for (const key of LOG_OMITTED_USERDATA_EPHEMERAL_KEYS) {
    delete cloneable[key];
  }

  if (cloneable.card) {
    cloneable.card = slimCardForLog(cloneable.card as Record<string, unknown>);
  }

  // Sanitizar modifiers para solo incluir datos serializables (power, toughness, counters)
  if (cloneable.modifiers && typeof cloneable.modifiers === 'object') {
    const mods = cloneable.modifiers as Record<string, unknown>;
    cloneable.modifiers = {
      power: typeof mods.power === 'number' ? mods.power : 0,
      toughness: typeof mods.toughness === 'number' ? mods.toughness : 0,
      counters: mods.counters && typeof mods.counters === 'object' 
        ? { ...mods.counters as Record<string, number> }
        : {},
    };
  }

  return cloneJsonSafe(cloneable);
}

function slimJoinCards(cards: unknown) {
  if (!Array.isArray(cards)) return cards;

  return cards.map(card => {
    if (!card || typeof card !== 'object') return card;
    const entry = card as Record<string, unknown>;
    return {
      ...entry,
      detail: slimCardDetailForLog(entry.detail as Record<string, unknown> | undefined),
    };
  });
}

function slimJoinDeck(deck: unknown) {
  if (!deck || typeof deck !== 'object') return deck;

  const entry = deck as Record<string, unknown>;
  if (!Array.isArray(entry.cards)) return deck;

  return {
    ...entry,
    cards: entry.cards.map(card => slimSerializedCardEntry(card)),
  };
}

export function slimSerializedCardEntry(card: unknown) {
  if (!card || typeof card !== 'object') return card;
  const entry = card as Record<string, unknown>;
  return {
    ...entry,
    detail: slimCardDetailForLog(entry.detail as Record<string, unknown> | undefined),
    userData:
      entry.userData && typeof entry.userData === 'object'
        ? serializeCardUserDataForLog(entry.userData as Record<string, unknown>)
        : entry.userData,
  };
}

function slimSerializedZone(zone: unknown) {
  if (!zone || typeof zone !== 'object') return zone;
  const entry = zone as Record<string, unknown>;
  if (!Array.isArray(entry.cards)) return zone;
  return {
    ...entry,
    cards: entry.cards.map(card => slimSerializedCardEntry(card)),
  };
}

/** Strip heavy Scryfall payloads before persisting world snapshots to Yjs. */
export function slimPlayAreaStateForSnapshot(state: Record<string, unknown>) {
  return {
    ...state,
    cards: Array.isArray(state.cards)
      ? state.cards.map(card => {
          if (!card || typeof card !== 'object') return card;
          const entry = card as Record<string, unknown>;
          return {
            ...entry,
            detail: slimCardDetailForLog(entry.detail as Record<string, unknown> | undefined),
          };
        })
      : state.cards,
    hand: slimSerializedZone(state.hand),
    deck: slimSerializedZone(state.deck),
    graveyard: slimSerializedZone(state.graveyard),
    exile: slimSerializedZone(state.exile),
    battlefield: slimSerializedZone(state.battlefield),
    peekZone: slimSerializedZone(state.peekZone),
    tokenSearchZone: slimSerializedZone(state.tokenSearchZone),
  };
}

function sanitizePayload(event: Record<string, unknown>, payload: Record<string, unknown>) {
  if (event.type === 'toggleTokenMenu' && Array.isArray(payload.availableTokens)) {
    payload.availableTokens = payload.availableTokens.map(token => {
      if (!token || typeof token !== 'object') return token;
      const entry = token as Record<string, unknown>;
      return {
        ...(slimCardDetailForLog(entry) ?? {}),
        clientId: entry.clientId,
      };
    });
  }

  if (event.type === 'join') {
    if (payload.cards) payload.cards = slimJoinCards(payload.cards);
    if (payload.battlefield) payload.battlefield = slimJoinDeck(payload.battlefield);
    if (payload.graveyard) payload.graveyard = slimJoinDeck(payload.graveyard);
    if (payload.exile) payload.exile = slimJoinDeck(payload.exile);
    if (payload.hand) payload.hand = slimJoinDeck(payload.hand);
    if (payload.deck) payload.deck = slimJoinDeck(payload.deck);
  }

  const userData = payload.userData;
  if (userData && typeof userData === 'object' && 'id' in userData) {
    payload.userData = serializeCardUserDataForLog(userData as Record<string, unknown>);
  }
}

export function sanitizeGameLogEvent(event: Record<string, unknown>) {
  if (!event || typeof event !== 'object') return event;

  if (event.type === 'bulk' && Array.isArray(event.events)) {
    for (const nested of event.events) {
      sanitizeGameLogEvent(nested as Record<string, unknown>);
    }
    return event;
  }

  const payload = event.payload as Record<string, unknown> | undefined;
  if (payload) {
    sanitizePayload(event, payload);
  }

  return event;
}

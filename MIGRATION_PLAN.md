# Plan de migración ejecutable

## Objetivo
Migrar de la arquitectura actual (eventos heterogéneos + mutaciones directas) a la nueva arquitectura (GameEngine + reducer puro) de forma incremental y segura.

---

## Fase 0: Preparación (COMPLETADO ✅)

- [x] Implementar tipos core (`types.ts`)
- [x] Implementar reducer puro (`reducer.ts`)
- [x] Implementar GameEngine (`engine.ts`)
- [x] Implementar RNG determinista (`rng.ts`)
- [x] Implementar YjsSyncProvider (`sync/YjsSyncProvider.ts`)
- [x] Tests comprehensivos (39 tests passing)
- [x] Ejemplo de migración (tap/untap)
- [x] Documentación completa

---

## Fase 1: Integración inicial (Semana 1)

### Día 1-2: Setup básico

```typescript
// src/main3d.ts

import { GameEngine, createYjsSyncProviderFromGlobals, PlayerId } from './game-engine';

// Después de inicializar Yjs (línea ~665)
let gameEngine: GameEngine | null = null;

async function initGameEngine(gameId: string, playerId: string) {
  const syncProvider = createYjsSyncProviderFromGlobals(
    gameId,
    ydoc,
    provider,
    indexeddbPersistence,
  );

  gameEngine = new GameEngine({
    gameId,
    playerId: PlayerId(playerId),
    syncProvider,
    onStateChange: (state) => {
      // TODO: Implementar en Fase 2
      console.log('[GameEngine] State changed, sequence:', state.sequence);
    },
    onError: (error) => {
      console.error('[GameEngine] Error:', error);
      Sentry.captureException(error);
    },
  });

  await gameEngine.initialize();
  console.log('[GameEngine] Initialized');
}

// En la función init() principal
export async function init({ gameId }) {
  // ... código existente ...
  
  // Inicializar game engine
  const playerSessionId = getOrCreatePlayerSessionId(gameId);
  await initGameEngine(gameId, playerSessionId);
  
  // Hacer accesible para debugging
  if (import.meta.env.DEV) {
    window.gameEngine = gameEngine;
  }
  
  // ... resto del código ...
}

// Export para uso en otros módulos
export { gameEngine };
```

**Checklist Día 1-2:**
- [ ] Agregar import del game-engine
- [ ] Crear función `initGameEngine`
- [ ] Llamar desde `init()`
- [ ] Verificar que inicializa sin errores
- [ ] Verificar en console: `window.gameEngine.getState()`

---

### Día 3-4: Event bridge (eventos actuales → engine)

```typescript
// src/game-engine/bridges/event-bridge.ts

import { GameEvent, EventId, PlayerId, CardId, ZoneId } from '../types';

/**
 * Convert old event format to new GameEvent
 */
export function bridgeOldEventToNew(
  oldEvent: any,
  sequence: number,
): GameEvent | null {
  const baseEvent = {
    eventId: EventId(oldEvent.eventId || nanoid()),
    sequence,
    timestamp: Date.now(),
    playerId: PlayerId(String(oldEvent.clientID)),
  };

  switch (oldEvent.type) {
    case 'tap': {
      return {
        ...baseEvent,
        type: 'CARD_TAPPED',
        payload: {
          cardId: CardId(oldEvent.payload?.userData?.id),
          tapped: oldEvent.payload?.userData?.isTapped ?? false,
        },
      };
    }

    case 'flip': {
      return {
        ...baseEvent,
        type: 'CARD_FLIPPED',
        payload: {
          cardId: CardId(oldEvent.payload?.userData?.id),
          flipped: oldEvent.payload?.userData?.isFlipped ?? false,
        },
      };
    }

    case 'join': {
      const payload = oldEvent.payload;
      return {
        ...baseEvent,
        type: 'PLAYER_JOINED',
        payload: {
          playerId: PlayerId(String(oldEvent.clientID)),
          name: payload?.name || 'Unknown',
          life: payload?.life || 20,
          commanderLife: payload?.commanderLife || 40,
          color: payload?.color || '#888888',
        },
      };
    }

    // TODO: Agregar más casos según migramos subsistemas
    default:
      return null;
  }
}

// In remoteEvents.ts handleEvent()
import { bridgeOldEventToNew } from './game-engine/bridges/event-bridge';

export async function handleEvent(event: Event, playArea: PlayArea) {
  // Existing code...
  
  // Bridge to new engine
  if (gameEngine && event.type !== 'bulk') {
    const newEvent = bridgeOldEventToNew(event, gameEngine.getState().sequence + 1);
    if (newEvent) {
      // Don't await - let it process async
      gameEngine['applyEvents']([newEvent]).catch(console.error);
    }
  }
  
  // Continue with old system
  await EVENTS[event.type](event, playArea, card);
}
```

**Checklist Día 3-4:**
- [ ] Crear `bridges/event-bridge.ts`
- [ ] Implementar conversiones para: tap, flip, join
- [ ] Integrar en `handleEvent()`
- [ ] Verificar que engine recibe eventos
- [ ] Log state sequences: viejo vs nuevo

---

### Día 5: Validación de convergencia

```typescript
// src/game-engine/validation/convergence-validator.ts

import { GameState, CardId, PlayerId } from '../types';

/**
 * Compare old system state with new GameEngine state
 */
export function validateConvergence(
  oldPlayAreas: Record<number, PlayArea>,
  newState: GameState,
): string[] {
  const errors: string[] = [];

  // Compare card tap states
  for (const playArea of Object.values(oldPlayAreas)) {
    if (!playArea) continue;
    
    for (const card of playArea.battlefieldZone.cards) {
      const cardId = CardId(card.id);
      const newCard = newState.cards[cardId];
      
      if (!newCard) {
        errors.push(`Card ${card.id} exists in old but not in new`);
        continue;
      }

      if (card.mesh?.userData.isTapped !== newCard.tapped) {
        errors.push(
          `Card ${card.id} tap mismatch: old=${card.mesh?.userData.isTapped} new=${newCard.tapped}`
        );
      }

      if (card.mesh?.userData.isFlipped !== newCard.flipped) {
        errors.push(
          `Card ${card.id} flip mismatch: old=${card.mesh?.userData.isFlipped} new=${newCard.flipped}`
        );
      }
    }
  }

  return errors;
}

// In main3d.ts - periodic validation
if (import.meta.env.DEV && gameEngine) {
  setInterval(() => {
    const errors = validateConvergence(playAreas, gameEngine!.getState());
    if (errors.length > 0) {
      console.warn('[Convergence] Mismatches detected:', errors);
    }
  }, 5000);
}
```

**Checklist Día 5:**
- [ ] Crear validador de convergencia
- [ ] Ejecutar cada 5 segundos en dev
- [ ] Verificar que no hay mismatches después de tap/flip
- [ ] Fix cualquier divergencia encontrada

---

## Fase 2: Migración Tap/Untap (Semana 2)

### Objetivo
Tap/untap completamente a través del engine, mantener backward compat.

```typescript
// src/lib/playArea.ts

import { gameEngine } from '../main3d';
import { CardId, PlayerId } from '../game-engine';

export class PlayArea {
  tap(cardMesh: Mesh, options: { skipAnimation?: boolean; syncOnly?: boolean } = {}) {
    const cardId = cardMesh.userData.id;
    
    if (!cardId) {
      console.warn('[PlayArea] Card has no ID');
      return;
    }

    // NEW SYSTEM
    if (gameEngine && this.isLocalPlayArea && !options.syncOnly) {
      // Dispatch command through engine
      gameEngine.dispatch({
        type: 'TAP_CARD',
        playerId: PlayerId(this.playerSessionId || 'unknown'),
        payload: { cardId: CardId(cardId) },
      }).catch(error => {
        console.error('[PlayArea] Failed to tap via engine:', error);
        // Fallback to old system
        this.oldTap(cardMesh, options);
      });
      
      // Optimistic update for immediate feedback
      if (!options.skipAnimation) {
        const currentTapped = cardMesh.userData.isTapped ?? false;
        cardMesh.userData.isTapped = !currentTapped;
        this.animateTap(cardMesh);
      }
      
      return;
    }

    // OLD SYSTEM (fallback + remote players)
    this.oldTap(cardMesh, options);
  }

  private oldTap(cardMesh: Mesh, options: any) {
    // Existing implementation
    setCardData(cardMesh, 'isTapped', !cardMesh.userData.isTapped);
    if (this.isLocalPlayArea && isEventCatchUpComplete()) {
      dispatchGameEvent(createTapEvent(cardMesh));
    }
    // ... animation code ...
  }
}
```

**Checklist Semana 2:**
- [ ] Modificar `PlayArea.tap()` para usar engine
- [ ] Mantener old system como fallback
- [ ] Optimistic update para feedback inmediato
- [ ] Tests: tap en local actualiza estado
- [ ] Tests: tap remoto se replica correctamente
- [ ] Verificar no hay regresiones
- [ ] Performance: medir latencia tap → visual

---

## Fase 3: State → View sync (Semana 3)

### Objetivo
Three.js se actualiza desde GameState, no al revés.

```typescript
// src/game-engine/view-sync/three-sync.ts

import { GameState, CardState } from '../types';
import { cardsById } from '../../lib/globals';
import { animateObject } from '../../lib/animations';

let lastSyncedSequence = 0;

export function syncThreeJsFromState(state: GameState) {
  // Skip if no changes
  if (state.sequence === lastSyncedSequence) return;
  
  const startTime = performance.now();

  // Sync all cards
  for (const [cardId, cardState] of Object.entries(state.cards)) {
    syncCard(cardId, cardState);
  }

  // Sync zones (counts, etc.)
  for (const [zoneId, zoneState] of Object.entries(state.zones)) {
    syncZone(zoneId, zoneState);
  }

  lastSyncedSequence = state.sequence;
  
  const elapsed = performance.now() - startTime;
  if (elapsed > 10) {
    console.warn('[ThreeSync] Slow sync:', elapsed.toFixed(2), 'ms');
  }
}

function syncCard(cardId: string, cardState: CardState) {
  const card = cardsById.get(cardId);
  if (!card?.mesh) return;

  const mesh = card.mesh;
  let needsUpdate = false;

  // Sync tap state
  if (mesh.userData.isTapped !== cardState.tapped) {
    mesh.userData.isTapped = cardState.tapped;
    animateCardTap(mesh, cardState.tapped);
    needsUpdate = true;
  }

  // Sync flip state
  if (mesh.userData.isFlipped !== cardState.flipped) {
    mesh.userData.isFlipped = cardState.flipped;
    animateCardFlip(mesh, cardState.flipped);
    needsUpdate = true;
  }

  // Sync position
  if (cardState.position && needsPositionUpdate(mesh, cardState.position)) {
    mesh.position.set(
      cardState.position.x,
      cardState.position.y,
      cardState.position.z,
    );
    needsUpdate = true;
  }

  // Sync counters
  syncCardCounters(mesh, cardState.counters);
}

function needsPositionUpdate(mesh: any, pos: { x: number; y: number; z: number }): boolean {
  const EPSILON = 0.01;
  return (
    Math.abs(mesh.position.x - pos.x) > EPSILON ||
    Math.abs(mesh.position.y - pos.y) > EPSILON ||
    Math.abs(mesh.position.z - pos.z) > EPSILON
  );
}

// Hook into engine
gameEngine.subscribe((state) => {
  syncThreeJsFromState(state);
});
```

**Checklist Semana 3:**
- [ ] Crear `view-sync/three-sync.ts`
- [ ] Implementar `syncCard` para tap/flip
- [ ] Implementar `syncZone` para counts
- [ ] Subscribe engine → sync
- [ ] Benchmark: debe ser < 5ms para 100 cartas
- [ ] Verificar animaciones siguen funcionando
- [ ] Tests visuales: cambiar state → ver actualización

---

## Fase 4: Contadores y más eventos (Semana 4-5)

### Día 1-2: Counters (+1/+1, loyalty, custom)

```typescript
// Agregar a reducer.ts
case 'CARD_COUNTER_CHANGED': {
  const { cardId, counterId, newValue } = event.payload;
  const card = state.cards[cardId];
  if (!card) return state;

  return {
    ...state,
    cards: {
      ...state.cards,
      [cardId]: {
        ...card,
        counters: {
          ...card.counters,
          [counterId]: newValue,
        },
      },
    },
  };
}

// Agregar comando al engine
case 'ADD_COUNTER': {
  const { cardId, counterId } = command.payload;
  const card = this.state.cards[cardId];
  const current = card?.counters[counterId] ?? 0;
  
  return [{
    ...baseEvent,
    type: 'CARD_COUNTER_CHANGED',
    payload: {
      cardId,
      counterId,
      delta: 1,
      newValue: current + 1,
    },
  }];
}
```

**Tests:**
```typescript
test('ADD_COUNTER increments counter', async () => {
  // Setup card with counter
  await engine.dispatch({
    type: 'ADD_COUNTER',
    playerId: PlayerId('p1'),
    payload: {
      cardId: CardId('card-1'),
      counterId: 'plusone',
    },
  });

  const card = engine.getCard(CardId('card-1'));
  expect(card?.counters['plusone']).toBe(1);
});
```

**Checklist Contadores:**
- [ ] Event: `CARD_COUNTER_CHANGED`
- [ ] Commands: `ADD_COUNTER`, `REMOVE_COUNTER`
- [ ] Reducer case
- [ ] Tests (5+ casos)
- [ ] Migrar `modifyCard` de PlayArea
- [ ] Sync counters en `three-sync.ts`

---

### Día 3-5: Card movement

```typescript
// Event
case 'CARD_MOVED': {
  const { cardId, fromZoneId, toZoneId, position, index } = event.payload;
  
  // Remove from old zone
  const fromZone = state.zones[fromZoneId];
  const toZone = state.zones[toZoneId];
  
  return {
    ...state,
    cards: {
      ...state.cards,
      [cardId]: {
        ...state.cards[cardId],
        zoneId: toZoneId,
        position,
        tapped: toZone.type === 'battlefield' ? state.cards[cardId].tapped : false,
      },
    },
    zones: {
      ...state.zones,
      [fromZoneId]: {
        ...fromZone,
        cardIds: fromZone.cardIds.filter(id => id !== cardId),
      },
      [toZoneId]: {
        ...toZone,
        cardIds: index !== undefined 
          ? insertAt(toZone.cardIds, cardId, index)
          : [...toZone.cardIds, cardId],
      },
    },
  };
}
```

**Checklist Movement:**
- [ ] Event: `CARD_MOVED`
- [ ] Command: `MOVE_CARD`
- [ ] Reducer case (zona a zona)
- [ ] Tests (hand→bf, bf→gy, etc.)
- [ ] Migrar `transferCard`
- [ ] Animations via three-sync

---

## Fase 5: Shuffle + RNG (Semana 6)

### RNG determinista

```typescript
// En engine commands
case 'SHUFFLE_ZONE': {
  const { zoneId } = command.payload;
  const zone = this.state.zones[zoneId];
  if (!zone) return [];

  const rngCounter = this.state.rng.counter + 1;
  const newOrder = seededShuffle(
    zone.cardIds,
    this.state.rng.seed,
    rngCounter,
  );

  return [{
    ...baseEvent,
    type: 'ZONE_SHUFFLED',
    payload: {
      zoneId,
      rngCounter,
      newOrder,
    },
  }];
}
```

**Verificación:**
```typescript
test('same seed produces same shuffle on all clients', () => {
  const deck = [CardId('c1'), CardId('c2'), ..., CardId('c52')];
  
  const client1 = seededShuffle(deck, 'game-seed', 1);
  const client2 = seededShuffle(deck, 'game-seed', 1);
  
  expect(client1).toEqual(client2);
});
```

**Checklist Shuffle:**
- [ ] Event: `ZONE_SHUFFLED`
- [ ] Command: `SHUFFLE_ZONE`
- [ ] Usa RNG determinista
- [ ] Tests de reproducibilidad
- [ ] Migrar `deck.shuffle()`
- [ ] Verificar mazos idénticos en todos los clientes

---

## Fase 6: Eliminar código viejo (Semana 7-8)

### Objetivo
Solo game engine, sin dualidad.

**Cambios:**
1. Remover `locallyApplied` de eventos
2. Remover `shouldSkipLocallyAppliedEvent`
3. Remover métodos `oldTap`, `oldFlip`, etc.
4. `PlayArea` solo lee, no escribe
5. `remoteEvents.ts` solo procesa eventos legacy para compat

**Checklist:**
- [ ] Feature flag: `USE_ONLY_GAME_ENGINE = true`
- [ ] Remove old event handlers
- [ ] Remove mutations from PlayArea
- [ ] Remove `processEvents` (replaced by engine)
- [ ] Cleanup globals
- [ ] Performance testing
- [ ] Regression testing (todas las features)

---

## Rollout checklist

### Pre-deployment
- [ ] All tests passing (100%)
- [ ] No console errors en dev
- [ ] Validación de convergencia sin errores
- [ ] Performance benchmarks dentro de rango
- [ ] Documentación actualizada

### Deployment
- [ ] Deploy con feature flag OFF
- [ ] Monitor Sentry errors
- [ ] Enable para 10% usuarios
- [ ] Monitor desync reports
- [ ] Enable para 50% usuarios
- [ ] Enable para 100% usuarios

### Post-deployment
- [ ] Cleanup old code tras 2 semanas sin issues
- [ ] Write retrospective
- [ ] Plan next improvements (zones, turn system, etc.)

---

## Métricas de éxito

| Métrica | Target | Current |
|---------|--------|---------|
| Tests passing | 100% | 100% ✅ |
| Reducer time/event | < 1ms | N/A |
| View sync time | < 5ms | N/A |
| Desync rate | < 0.1% | N/A |
| Shuffle determinism | 100% | 100% ✅ |
| Code coverage | > 80% | 100% ✅ |

---

## Contacto y soporte

Si encuentras blockers durante la migración:
1. Check `README.md` para patterns
2. Check tests para ejemplos
3. Check `tap-migration.ts` para reference
4. Añadir issue con label `game-engine-migration`

**Principio clave**: Incremental es mejor que perfecto. Cada subsistema migrado es un win, no necesitas hacer todo de golpe.

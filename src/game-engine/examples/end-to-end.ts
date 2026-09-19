/**
 * END-TO-END EXAMPLE
 * 
 * Ejemplo completo de cómo usar el game engine para una partida de MTG
 */

import {
  GameEngine,
  GameState,
  PlayerId,
  CardId,
  ZoneId,
  createYjsSyncProviderFromGlobals,
  createEmptyGameState,
  createZone,
} from '../src/game-engine';

// ============================================================================
// SETUP: Inicializar partida
// ============================================================================

async function setupGame() {
  // 1. Crear sync provider desde infraestructura Yjs existente
  const syncProvider = createYjsSyncProviderFromGlobals(
    'game-123',
    ydoc,
    provider,
    indexeddbPersistence,
  );

  // 2. Crear engine
  const engine = new GameEngine({
    gameId: 'game-123',
    playerId: PlayerId('alice'),
    syncProvider,
    onStateChange: (state) => {
      console.log('State updated, sequence:', state.sequence);
      updateThreeJsScene(state);
    },
    onError: (error) => {
      console.error('Engine error:', error);
    },
  });

  // 3. Inicializar (carga snapshot + replay events)
  await engine.initialize();

  return engine;
}

// ============================================================================
// EJEMPLO 1: Jugador se une a la partida
// ============================================================================

async function playerJoinsGame(engine: GameEngine, playerName: string) {
  await engine.dispatch({
    type: 'JOIN_GAME',
    playerId: engine.getState().gameId as any,
    payload: {
      name: playerName,
      life: 20,
      commanderLife: 40,
      color: '#ff0000',
    },
  });

  console.log('✅ Player joined:', playerName);
}

// ============================================================================
// EJEMPLO 2: Crear cartas en mesa
// ============================================================================

async function playCardFromHand(
  engine: GameEngine,
  playerId: string,
  cardName: string,
  scryfallId: string,
) {
  // 1. Crear la carta si no existe
  const cardId = CardId(`card-${Date.now()}`);
  const battlefieldZone = ZoneId(`battlefield-${playerId}`);

  await engine.dispatch({
    type: 'MOVE_CARD',
    playerId: PlayerId(playerId),
    payload: {
      cardId,
      fromZoneId: ZoneId(`hand-${playerId}`),
      toZoneId: battlefieldZone,
      position: { x: 100, y: 50, z: 0 },
    },
  });

  console.log(`✅ ${cardName} played to battlefield`);
  return cardId;
}

// ============================================================================
// EJEMPLO 3: Tap una carta
// ============================================================================

async function tapCard(engine: GameEngine, cardId: string, playerId: string) {
  await engine.dispatch({
    type: 'TAP_CARD',
    playerId: PlayerId(playerId),
    payload: { cardId: CardId(cardId) },
  });

  const card = engine.getCard(CardId(cardId));
  console.log(`✅ Card tapped: ${card?.name} (tapped=${card?.tapped})`);
}

// ============================================================================
// EJEMPLO 4: Agregar +1/+1 counter
// ============================================================================

async function addPlusOneCounter(
  engine: GameEngine,
  cardId: string,
  playerId: string,
) {
  await engine.dispatch({
    type: 'ADD_COUNTER',
    playerId: PlayerId(playerId),
    payload: {
      cardId: CardId(cardId),
      counterId: 'plusone',
    },
  });

  const card = engine.getCard(CardId(cardId));
  console.log(`✅ +1/+1 counter added: ${card?.counters['plusone'] ?? 0} counters`);
}

// ============================================================================
// EJEMPLO 5: Barajar el mazo (determinista)
// ============================================================================

async function shuffleDeck(engine: GameEngine, playerId: string) {
  const deckZone = ZoneId(`deck-${playerId}`);

  await engine.dispatch({
    type: 'SHUFFLE_ZONE',
    playerId: PlayerId(playerId),
    payload: { zoneId: deckZone },
  });

  const zone = engine.getZone(deckZone);
  console.log(`✅ Deck shuffled: ${zone?.cardIds.length} cards`);
  console.log('Order:', zone?.cardIds.slice(0, 5));
}

// ============================================================================
// EJEMPLO 6: Mover carta de una zona a otra
// ============================================================================

async function moveCardToGraveyard(
  engine: GameEngine,
  cardId: string,
  playerId: string,
) {
  const card = engine.getCard(CardId(cardId));
  if (!card) {
    console.error('Card not found');
    return;
  }

  await engine.dispatch({
    type: 'MOVE_CARD',
    playerId: PlayerId(playerId),
    payload: {
      cardId: CardId(cardId),
      fromZoneId: card.zoneId,
      toZoneId: ZoneId(`graveyard-${playerId}`),
    },
  });

  console.log(`✅ Card moved to graveyard: ${card.name}`);
}

// ============================================================================
// EJEMPLO 7: Leer el estado de la partida
// ============================================================================

function inspectGameState(engine: GameEngine) {
  const state = engine.getState();

  console.log('\n📊 GAME STATE INSPECTION:');
  console.log('Sequence:', state.sequence);
  console.log('Players:', Object.keys(state.players).length);
  console.log('Cards:', Object.keys(state.cards).length);
  console.log('Zones:', Object.keys(state.zones).length);

  // Ver todas las cartas en battlefield
  Object.values(state.zones)
    .filter(z => z.type === 'battlefield')
    .forEach(zone => {
      console.log(`\nBattlefield (${zone.ownerId}):`);
      const cards = engine.getCardsInZone(zone.id);
      cards.forEach(card => {
        console.log(`  - ${card.name} (tapped=${card.tapped})`);
      });
    });
}

// ============================================================================
// EJEMPLO 8: Subscribe a cambios de estado
// ============================================================================

function setupStateSubscriptions(engine: GameEngine) {
  // Subscribe general
  const unsubscribe = engine.subscribe((state) => {
    console.log('[State Change]', state.sequence);
    
    // Actualizar UI/Three.js
    updateThreeJsScene(state);
  });

  // Cleanup cuando se cierra la partida
  window.addEventListener('beforeunload', () => {
    unsubscribe();
  });
}

function updateThreeJsScene(state: GameState) {
  // Actualizar cada carta en Three.js
  for (const [cardId, cardState] of Object.entries(state.cards)) {
    const mesh = cardsById.get(cardId);
    if (!mesh) continue;

    // Sync tap state
    if (mesh.userData.tapped !== cardState.tapped) {
      mesh.userData.tapped = cardState.tapped;
      animateCardTap(mesh, cardState.tapped);
    }

    // Sync position
    if (cardState.position) {
      mesh.position.set(
        cardState.position.x,
        cardState.position.y,
        cardState.position.z,
      );
    }
  }
}

// ============================================================================
// EJEMPLO 9: Validar consistencia del estado
// ============================================================================

function validateGameConsistency(engine: GameEngine) {
  const errors = engine.validate();

  if (errors.length === 0) {
    console.log('✅ State is valid');
  } else {
    console.error('❌ State validation errors:');
    errors.forEach(err => console.error('  -', err));
  }

  return errors.length === 0;
}

// ============================================================================
// EJEMPLO 10: Crear y guardar snapshot
// ============================================================================

async function saveGameSnapshot(engine: GameEngine) {
  await engine.saveSnapshot();
  console.log('✅ Snapshot saved at sequence:', engine.getState().sequence);
}

// ============================================================================
// FLUJO COMPLETO: Partida de ejemplo
// ============================================================================

async function exampleGameFlow() {
  console.log('🎮 Starting game...\n');

  // 1. Setup
  const engine = await setupGame();

  // 2. Jugadores se unen
  await playerJoinsGame(engine, 'Alice');
  await playerJoinsGame(engine, 'Bob');

  // 3. Subscribe a cambios
  setupStateSubscriptions(engine);

  // 4. Alice juega una carta
  const aliceCard = await playCardFromHand(
    engine,
    'alice',
    'Lightning Bolt',
    'bolt-id',
  );

  // 5. Alice tappea la carta
  await tapCard(engine, aliceCard, 'alice');

  // 6. Bob agrega un counter a su carta
  const bobCard = await playCardFromHand(
    engine,
    'bob',
    'Tarmogoyf',
    'goyf-id',
  );
  await addPlusOneCounter(engine, bobCard, 'bob');

  // 7. Alice baraja su mazo
  await shuffleDeck(engine, 'alice');

  // 8. Carta de Alice va al cementerio
  await moveCardToGraveyard(engine, aliceCard, 'alice');

  // 9. Inspeccionar estado
  inspectGameState(engine);

  // 10. Validar
  validateGameConsistency(engine);

  // 11. Guardar snapshot
  await saveGameSnapshot(engine);

  console.log('\n✅ Game flow completed!');
}

// ============================================================================
// EJEMPLO 11: Replay de partida desde snapshot
// ============================================================================

async function replayGameFromSnapshot(snapshotSequence: number) {
  const engine = await setupGame();

  // El engine automáticamente carga snapshot y replay events
  const state = engine.getState();

  console.log('📼 Replayed to sequence:', state.sequence);
  console.log('Players:', Object.keys(state.players));
  console.log('Cards:', Object.keys(state.cards).length);

  return engine;
}

// ============================================================================
// EJEMPLO 12: Testing sin navegador
// ============================================================================

import { reduce, createEmptyGameState, replay } from '../src/game-engine';

function testableGameLogic() {
  // 1. Estado inicial
  let state = createEmptyGameState('test-game', 'test-seed');

  // 2. Agregar jugador
  state = reduce(state, {
    eventId: 'e1' as any,
    sequence: 1,
    timestamp: Date.now(),
    playerId: PlayerId('alice'),
    type: 'PLAYER_JOINED',
    payload: {
      playerId: PlayerId('alice'),
      name: 'Alice',
      life: 20,
      commanderLife: 40,
      color: '#ff0000',
    },
  });

  // 3. Verificar
  expect(state.players[PlayerId('alice')].name).toBe('Alice');
  expect(state.players[PlayerId('alice')].life).toBe(20);

  console.log('✅ Testable without browser!');
}

// ============================================================================
// EJEMPLO 13: Comparar estados entre clientes (debug desync)
// ============================================================================

function compareClientStates(engine1: GameEngine, engine2: GameEngine) {
  const state1 = engine1.getState();
  const state2 = engine2.getState();

  if (state1.sequence !== state2.sequence) {
    console.error('❌ Sequence mismatch:', state1.sequence, state2.sequence);
    return false;
  }

  const cards1 = Object.keys(state1.cards);
  const cards2 = Object.keys(state2.cards);

  if (cards1.length !== cards2.length) {
    console.error('❌ Card count mismatch:', cards1.length, cards2.length);
    return false;
  }

  for (const cardId of cards1) {
    const c1 = state1.cards[cardId as CardId];
    const c2 = state2.cards[cardId as CardId];

    if (!c2) {
      console.error(`❌ Card ${cardId} missing in client2`);
      return false;
    }

    if (c1.tapped !== c2.tapped) {
      console.error(`❌ Card ${cardId} tap mismatch: ${c1.tapped} vs ${c2.tapped}`);
      return false;
    }
  }

  console.log('✅ States are synchronized!');
  return true;
}

// ============================================================================
// RUN EXAMPLES
// ============================================================================

if (import.meta.env.DEV) {
  // Uncomment to run:
  // exampleGameFlow();
  // testableGameLogic();
}

export {
  setupGame,
  playerJoinsGame,
  playCardFromHand,
  tapCard,
  addPlusOneCounter,
  shuffleDeck,
  moveCardToGraveyard,
  inspectGameState,
  validateGameConsistency,
  saveGameSnapshot,
  replayGameFromSnapshot,
  compareClientStates,
};

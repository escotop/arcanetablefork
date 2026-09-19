# ✅ Checklist de integración - Game Engine

## 📋 Pre-integración

- [x] ✅ Core engine implementado (`types.ts`, `reducer.ts`, `engine.ts`, `rng.ts`)
- [x] ✅ YjsSyncProvider implementado
- [x] ✅ 35 tests passing (100%)
- [x] ✅ Documentación completa
- [x] ✅ Ejemplos funcionales
- [ ] Leer `GAME_ENGINE_IMPLEMENTATION.md`
- [ ] Leer `src/game-engine/README.md`
- [ ] Ejecutar `npm test src/game-engine/__tests__`

---

## 🚀 Fase 1: Integración inicial (Semana 1)

### Día 1-2: Setup básico

- [ ] Importar game engine en `main3d.ts`
- [ ] Crear función `initGameEngine(gameId, playerId)`
- [ ] Llamar desde `init()` después de Yjs
- [ ] Verificar inicialización sin errores
- [ ] Verificar en console: `window.gameEngine.getState()`
- [ ] Commit: "feat: integrate game engine (shadow mode)"

### Día 3-4: Event bridge

- [ ] Crear `src/game-engine/bridges/event-bridge.ts`
- [ ] Implementar `bridgeOldEventToNew()` para:
  - [ ] `tap` → `CARD_TAPPED`
  - [ ] `flip` → `CARD_FLIPPED`
  - [ ] `join` → `PLAYER_JOINED`
- [ ] Integrar bridge en `remoteEvents.ts` → `handleEvent()`
- [ ] Verificar que engine recibe eventos
- [ ] Log sequences: viejo vs nuevo
- [ ] Commit: "feat: bridge old events to game engine"

### Día 5: Validación

- [ ] Crear `src/game-engine/validation/convergence-validator.ts`
- [ ] Implementar `validateConvergence(oldState, newState)`
- [ ] Ejecutar cada 5 segundos en dev
- [ ] Verificar no hay mismatches después de tap/flip
- [ ] Fix divergencias si las hay
- [ ] Commit: "feat: add convergence validator"

**Resultado Fase 1**: Engine corre en paralelo validando estado ✅

---

## 🎯 Fase 2: Tap/Untap migration (Semana 2)

### Día 1-2: Modificar PlayArea

- [ ] Modificar `src/lib/playArea.ts` → `tap()`
- [ ] Agregar `if (gameEngine && !options.syncOnly)`
- [ ] Dispatch `TAP_CARD` command
- [ ] Mantener `oldTap()` como fallback
- [ ] Agregar optimistic update opcional
- [ ] Tests: tap local → state actualizado
- [ ] Tests: tap remoto → replicado
- [ ] Commit: "feat: route tap through game engine"

### Día 3-4: Right-click handler

- [ ] Modificar handler de right-click en cartas
- [ ] Usar `tapCardViaEngine()` helper
- [ ] Verificar feedback inmediato
- [ ] Verificar sincronización remota
- [ ] Tests visuales: tap → animación
- [ ] Commit: "feat: integrate tap with right-click"

### Día 5: Testing y fix

- [ ] Test con 2+ jugadores simultáneos
- [ ] Verificar no hay desync
- [ ] Verificar performance (latencia tap → visual)
- [ ] Fix cualquier issue encontrado
- [ ] Commit: "fix: tap synchronization issues"

**Resultado Fase 2**: Tap/untap 100% via engine ✅

---

## 🔄 Fase 3: State → View sync (Semana 3)

### Día 1-2: Crear three-sync

- [ ] Crear `src/game-engine/view-sync/three-sync.ts`
- [ ] Implementar `syncThreeJsFromState(state)`
- [ ] Implementar `syncCard()` para tap/flip
- [ ] Implementar `syncZone()` para counts
- [ ] Subscribe engine: `engine.subscribe(syncThreeJsFromState)`
- [ ] Commit: "feat: sync Three.js from game state"

### Día 3: Optimizaciones

- [ ] Track `lastSyncedSequence` para skip duplicados
- [ ] Solo actualizar lo que cambió (diff)
- [ ] Benchmark: debe ser < 5ms para 100 cartas
- [ ] Optimistic updates para feedback inmediato
- [ ] Commit: "perf: optimize view sync"

### Día 4-5: Testing

- [ ] Cambiar state manualmente → ver actualización
- [ ] Test animaciones siguen funcionando
- [ ] Test performance con muchas cartas
- [ ] Verificar no hay memory leaks
- [ ] Commit: "test: view sync validation"

**Resultado Fase 3**: Three.js se actualiza desde state ✅

---

## 🔢 Fase 4: Counters (Semana 4)

### Event + Reducer

- [ ] Agregar `CARD_COUNTER_CHANGED` a types
- [ ] Agregar payload type: `CardCounterChangedPayload`
- [ ] Implementar reducer case
- [ ] Tests: 5+ casos de counters
- [ ] Commit: "feat: counter events and reducer"

### Commands

- [ ] Implementar `ADD_COUNTER` command
- [ ] Implementar `REMOVE_COUNTER` command
- [ ] Tests: increment/decrement
- [ ] Commit: "feat: counter commands"

### Integration

- [ ] Migrar `modifyCard()` counters
- [ ] Sync counters en `three-sync.ts`
- [ ] Verificar loyalty counters planeswalkers
- [ ] Verificar +1/+1 counters
- [ ] Commit: "feat: migrate counters to engine"

**Resultado Fase 4**: Counters via engine ✅

---

## 🚚 Fase 5: Card movement (Semana 5)

### Event + Reducer

- [ ] Agregar `CARD_MOVED` to types
- [ ] Implementar `CardMovedPayload`
- [ ] Implementar reducer (zona → zona)
- [ ] Tests: hand→bf, bf→gy, gy→exile
- [ ] Commit: "feat: card movement events"

### Commands

- [ ] Implementar `MOVE_CARD` command
- [ ] Migrar `transferCard()`
- [ ] Tests: todas las transiciones
- [ ] Commit: "feat: card movement commands"

### Integration

- [ ] Sync positions en `three-sync.ts`
- [ ] Animations via view sync
- [ ] Verificar drag & drop
- [ ] Commit: "feat: migrate movement to engine"

**Resultado Fase 5**: Movement via engine ✅

---

## 🎲 Fase 6: Shuffle + RNG (Semana 6)

### RNG determinista

- [ ] Agregar `ZONE_SHUFFLED` event
- [ ] Implementar `ZoneShuffledPayload` con `newOrder`
- [ ] Usar `seededShuffle()` en command
- [ ] Tests: mismo seed → mismo orden
- [ ] Commit: "feat: deterministic shuffles"

### Integration

- [ ] Migrar `deck.shuffle()`
- [ ] Remover `Math.random()` de shuffles
- [ ] Tests con 2 clientes: orden idéntico
- [ ] Commit: "feat: migrate shuffles to engine"

### Validation

- [ ] Test secuencia de shuffles reproducible
- [ ] Test con 52 cartas (mazo completo)
- [ ] Verificar no hay bias
- [ ] Commit: "test: shuffle determinism validation"

**Resultado Fase 6**: Shuffles sincronizados ✅

---

## 🧹 Fase 7: Cleanup (Semana 7-8)

### Feature flag

- [ ] Crear `USE_ONLY_GAME_ENGINE = true`
- [ ] Testear con flag ON
- [ ] Verificar todas las features
- [ ] Commit: "feat: engine-only mode flag"

### Remove old code

- [ ] Remover `locallyApplied` logic
- [ ] Remover `shouldSkipLocallyAppliedEvent`
- [ ] Remover métodos `oldTap()`, `oldFlip()`, etc.
- [ ] Remover mutaciones directas en PlayArea
- [ ] Commit: "refactor: remove old sync system"

### Optimizations

- [ ] Profile reducer performance
- [ ] Optimize `syncThreeJsFromState`
- [ ] Add memoization donde aplique
- [ ] Commit: "perf: engine optimizations"

### Final testing

- [ ] Regression testing (todas las features)
- [ ] Performance benchmarks
- [ ] Load testing (10+ jugadores)
- [ ] Commit: "test: final validation"

**Resultado Fase 7**: Solo engine, código limpio ✅

---

## 🚀 Fase 8: Rollout (Semana 9)

### Pre-deployment

- [ ] All tests passing
- [ ] No console errors
- [ ] Convergence validator sin warnings
- [ ] Performance within targets
- [ ] Sentry setup para monitoring

### Gradual rollout

- [ ] Deploy con flag OFF
- [ ] Monitor Sentry 24h
- [ ] Enable para 10% usuarios
- [ ] Monitor 48h
- [ ] Enable para 50% usuarios
- [ ] Monitor 48h
- [ ] Enable para 100% usuarios

### Post-deployment

- [ ] Monitor desync reports
- [ ] Fix hotfixes si es necesario
- [ ] Cleanup old code tras 2 semanas
- [ ] Write retrospective
- [ ] Plan next improvements

**Resultado Fase 8**: Production deployment ✅

---

## 📊 Métricas de éxito

### Performance
- [ ] Reducer: < 1ms por evento
- [ ] View sync: < 5ms para 100 cartas
- [ ] Join time: < 2s con snapshot

### Quality
- [ ] Tests passing: 100%
- [ ] Desync rate: < 0.1%
- [ ] Shuffle determinism: 100%
- [ ] Code coverage: > 80%

### User experience
- [ ] No user-facing bugs
- [ ] Tap latency: < 100ms
- [ ] Smooth animations
- [ ] No visual glitches

---

## 🆘 Troubleshooting

### Si algo no funciona:

1. **Check tests**: `npm test src/game-engine/__tests__`
2. **Check console**: Buscar errors del engine
3. **Check convergence**: Ver validator warnings
4. **Check docs**: `src/game-engine/README.md`
5. **Check examples**: `examples/tap-migration.ts`

### Contacts

- Documentación: `GAME_ENGINE_IMPLEMENTATION.md`
- Arquitectura: `src/game-engine/README.md`
- Plan: `MIGRATION_PLAN.md`
- Tests: `src/game-engine/__tests__/`

---

## ✨ Progreso general

```
[████████████████████] 100% - Implementación core
[████░░░░░░░░░░░░░░░░]  20% - Integración
[░░░░░░░░░░░░░░░░░░░░]   0% - Migración
[░░░░░░░░░░░░░░░░░░░░]   0% - Cleanup
[░░░░░░░░░░░░░░░░░░░░]   0% - Rollout
```

**Next step**: Fase 1, Día 1 - Setup básico ⬆️

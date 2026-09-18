# Debug de sincronización de eventos

## Cómo verificar qué está fallando

### 1. Abrir consola del navegador en ambos jugadores

### 2. Pegar este código en la consola antes de jugar:

```javascript
// Monitorear envío de eventos
const originalDispatch = window.dispatchGameEvent || (() => {});
window.dispatchGameEvent = function(event, timing) {
  console.log('📤 ENVIANDO:', event.type, event);
  return originalDispatch.call(this, event, timing);
};

// Monitorear recepción de eventos
window.addEventListener('storage', (e) => {
  if (e.key?.includes('gameLog')) {
    console.log('📥 RECIBIDO evento en gameLog');
  }
});

// Estado de sincronización
setInterval(() => {
  const globals = window;
  console.log('🔄 Estado:', {
    syncPaused: globals.syncPaused,
    gameplayBlocked: globals.isGameplayBlocked?.(),
    eventCatchUpComplete: globals.isEventCatchUpComplete?.(),
    gameLogLength: globals.gameLog?.length || 0,
  });
}, 5000);
```

### 3. Hacer tap en una carta

Deberías ver:
- En el jugador que hace tap: `📤 ENVIANDO: tap`
- En el otro jugador: `📥 RECIBIDO evento en gameLog`

### 4. Si no ves `📤 ENVIANDO`:
Verifica que `syncPaused: false`, `gameplayBlocked: false`, `eventCatchUpComplete: true`

### 5. Si ves enviando pero no recibiendo:
Problema de conexión WebRTC/Yjs. Verifica:
- Ambos están en la misma partida (mismo URL)
- No hay errores de red en la consola
- El provider está conectado

## Posibles soluciones rápidas

1. **Recargar ambas páginas** - A veces el provider se desconecta
2. **Crear nueva partida** - Si el gameLog está corrupto
3. **Limpiar localStorage** y empezar de cero

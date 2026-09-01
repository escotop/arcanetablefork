# Contributing to Arcanetable

Thank you for helping improve Arcanetable. This guide describes the project structure and conventions so new changes stay consistent with the existing codebase.

## Project overview

Arcanetable is a browser-based 3D TCG playtesting simulator. The main app lives in `src/`. Card data is served by separate proxy servers in `scry-server-*/`. Multiplayer sync uses Yjs.

```
arcanetable/
├── src/                    # Main app (SolidJS + Three.js)
│   ├── app.tsx             # Root router and global providers
│   ├── main3d.ts           # 3D loop, input handling, game entry
│   ├── pages/              # Heavy pages (3D game)
│   ├── routes/             # SolidStart routes (landing, changelog)
│   ├── components/         # Generic UI (design system)
│   └── lib/                # Domain logic and game UI
├── scry-server-{mtg,...}/  # Card data proxies (Deno + Hono)
├── websocket-server/       # Yjs sync in production
├── yjs-signaling-server/   # WebRTC signaling in development
└── content/changes/        # MDX changelog entries
```

**Stack:** SolidJS, SolidStart, Three.js, Yjs, Tailwind CSS, Kobalte (solid-ui), Vitest, Bun.

## Layer responsibilities

| Layer | Location | What belongs here |
|-------|----------|-------------------|
| Design system | `src/components/ui/` | Reusable primitives (buttons, dialogs, sliders). No game logic. |
| Game UI | `src/lib/ui/` | Overlay, context menus, deck picker, peek UI, etc. |
| 3D domain | `src/lib/` | Cards, zones, decks, animations, events |
| 3D entry point | `src/main3d.ts` | Mouse listeners, render loop, window resize |
| Global 3D state | `src/lib/globals.ts` | Three.js singletons, Yjs doc, shared signals |
| Shared types | `src/lib/constants.ts` | `Card`, `Deck`, `CardZone`, `CardSystem`, etc. |
| Multiplayer | `src/remoteEvents.ts` | Remote event processing |
| Card proxies | `scry-server-*/` | Standalone APIs. Do not embed card-provider logic in the frontend. |

**Rule of thumb:** game logic does not belong in `components/ui/`. Game UI lives in `lib/ui/` and reads from `globals.ts` or contexts.

## File and naming conventions

### Files

- **Solid components:** `PascalCase.tsx` or `camelCase.tsx` (game UI often uses camelCase, e.g. `overlay.tsx`).
- **Domain logic / classes:** `camelCase.ts` (`playArea.ts`, `transferCard.ts`).
- **Domain classes:** `PascalCase` (`PlayArea`, `CardArea`, `Hand`).
- **Tests:** co-located with source (`deckParser.test.ts`).

### Styles

- **Tailwind** for layout and utilities in components.
- **CSS Modules** (`*.module.css`) for game overlay positioning, 3D→DOM tethering, canvas sizing.
- Use `cn()` from `~/lib/cnUtil` in UI components.

### Imports

```typescript
// Preferred alias for components and shared UI
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/cnUtil';

// Relative imports within lib/
import { transferCard } from '../transferCard';
import { Card } from './constants';
```

## SolidJS patterns

### State

- `createStore` for structured state (`deckStore`, settings, `playAreas`).
- `createSignal` for simple flags (`hoverSignal`, `isInitialized`).
- `createLocalStore` (`localStore.ts`) for `localStorage` persistence.
- Always clean up in `onCleanup` when mounting game resources (see `pages/game/[id].tsx` → `cleanup()`).

### Contexts

- Thin contexts: `CardSystemContext` with provider in `deckStore.tsx`.
- `CardSystemProviderClient` lazy-loads the provider for SSR compatibility.

### Client-only rendering

- 3D routes are wrapped in `<ClientOnly>` in `app.tsx`.
- Do not assume `document` / `window` in modules imported by tests or SSR.

### UI components (Kobalte)

Follow the pattern in `src/components/ui/`:

- `splitProps` for local props.
- `cva` for variants.
- `@kobalte/core` primitives.
- `class={cn(variants(), local.class)}`.

## 3D architecture

### PlayArea structure

```
PlayArea (per player)
  ├── deck (Deck)
  ├── hand (Hand)
  ├── battlefieldZone (CardArea)
  ├── graveyardZone / exileZone (CardStack)
  ├── peekZone / revealZone / tokenSearchZone (CardGrid)
  └── mesh (Group in Three.js scene)
```

### Card zones

When adding or modifying a zone:

1. Implement the `CardZone` interface from `constants.ts`.
2. Register the zone in `zonesById` in the constructor.
3. Use `createRoot` + `createStore` for `observable` (`cardCount`, `uiTether`).
4. Implement `addCard`, `removeCard`, `updatePositions`, `getSerializable`.
5. Store state on `mesh.userData` (`location`, `zoneId`, `clientId`, `isPublic`, `isTapped`, etc.).

### Cards

- Logical entity: `Card` (`id`, `detail`, `mesh`, `modifiers`).
- Global registry: `cardsById`.
- Update visual state via `setCardData(mesh, field, value)` — avoid writing `userData` directly.
- Load textures through `loadCardTextures` / `textureLoaderWorker.ts`.

### Physical constants

Reuse values from `constants.ts` — do not duplicate:

```typescript
CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS, CARD_STACK_OFFSET
```

## Multiplayer event system

Standard flow for actions visible to other players:

```
UI / input
  → createXxxEvent() in createEvents.ts
  → dispatchGameEvent(event)
  → gameLog (Yjs)
  → processEvents() in remoteEvents.ts
  → EVENTS[event.type](...)
  → transferCard / animateObject / etc.
```

### API choices

| Action | Function | When |
|--------|----------|------|
| New game action | `dispatchGameEvent` | Always prefer this |
| Legacy | `sendEvent` | Deprecated — avoid in new code |
| Local-only transfer | `transferCard(..., { preventTransmit: true })` | When the event is sent separately |
| Skip re-processing | `locallyApplied: true` | On the emitting client |

### Adding a new event

1. Add a factory in `createEvents.ts` with explicit `type` and `as const`.
2. Add a handler in `EVENTS` in `remoteEvents.ts`.
3. Add a log message in `addLogMessage` if players should see it.
4. Add tests in `remoteEvents.test.ts` for non-trivial behavior.

## Card systems

- Default system URI: `DEFAULT_CARD_SYSTEM_URI` in `globals.ts`.
- Custom systems via `?system=` URL parameter.
- `fetchCardInfo` in `deck.ts` is the single entry point for card resolution.
- Image formats: `standard` (`full` / `art` maps) or `scryfall` (`large` / `art_crop`).
- Proxies in `scry-server-*` handle caching and CORS. **Do not call Scryfall directly from the client.**

To support a new TCG, add a new `scry-server-*` implementing the same JSON contract — do not hardcode provider logic in the frontend.

## Overlay and 3D→DOM tethering

- `overlay.tsx` is the in-game HUD.
- Zone labels use `uiTether` + `getTetherCssVariables()`.
- The overlay root has `pointer-events: none`; interactive controls set `pointer-events: initial`.
- The card preview uses `focusRenderer` (a second Three.js canvas). Size changes must sync CSS and `focusRenderer.setSize()` (see `updateFocusPanelSize` in `globals.ts`).

## Shortcuts

- Definitions: `src/lib/shortcuts/hotkeys.ts` using `hotkeys-js`.
- Scopes follow zone: `hotkeys.setScope(location())`.
- Reusable commands: `shortcuts/commands/deck.ts`, `field.ts`.
- Update `hotkeys-table.tsx` when adding shortcuts.

## Persistence

| Data | Mechanism | Key |
|------|-----------|-----|
| Decks | `deckStore` | `localStorage.decks` |
| Card systems | `CardSystemProvider` | `localStorage.card-systems` |
| Settings | `createLocalStore` | `localStorage.settings` |
| Active game | Yjs (`gameLog`, `gameState`) | In-memory + remote sync |

When serializing decks, strip heavy `detail` objects (`serializeDeck` in `deckStore.tsx`).

## Code style

From `package.json` Prettier config:

- Single quotes, `arrowParens: 'avoid'`, `printWidth: 100`.
- TypeScript `strict` mode enabled.
- Shared entity types live in `constants.ts`.
- Use `expect()` from `globals.ts` for runtime invariants.
- Use `nanoid()` for IDs.
- Import from `lodash-es` by name (`uniqBy`, `get`, `set`).
- Report meaningful errors via `Sentry.captureException`.

## Testing

```bash
bun test
```

- Pure logic tests (parsers) need no DOM — see `deckParser.test.ts`.
- Tests importing `card.ts` or `globals.ts` may need a browser/jsdom environment.
- Prefer inline snapshots: `toMatchInlineSnapshot`.
- Prefer testing pure logic over Three.js rendering.

## Build and deployment

```bash
bun install
bun dev      # http://localhost:3000
bun run build
```

- Docker images and Kubernetes manifests are in the repo root and per-service folders.
- Build metadata is injected via `VITE_*` env vars in the makefile.

## Change checklists

### UI / settings change

- [ ] Persist user preference via `createLocalStore('settings', …)` if needed.
- [ ] Put shared sizing/render logic in `globals.ts` or an exported helper.
- [ ] Keep DOM (CSS) and Three.js canvas in sync.
- [ ] Wire a control in `settingsOverlay.tsx` when appropriate.
- [ ] Do not break existing handlers (`scrollTarget`, `hoverSignal`, etc.).

### New game action

- [ ] Factory in `createEvents.ts`.
- [ ] Handler in `remoteEvents.ts`.
- [ ] Use `dispatchGameEvent`, not `sendEvent`.
- [ ] Route through `transferCard` / existing zones when applicable.

### New zone or card behavior

- [ ] Implement `CardZone`.
- [ ] Register in `zonesById`.
- [ ] Integrate in `PlayArea`.
- [ ] Add serialization if network state is affected.

### New card system / TCG

- [ ] New or extended `scry-server-*`.
- [ ] Match the `CardSystem` JSON contract (documented in README).
- [ ] No direct provider coupling in the frontend.

## Anti-patterns

1. Putting 3D state outside `globals.ts` — renderer, scene, and shared signals are centralized there.
2. Using `sendEvent` in new code — use `dispatchGameEvent`.
3. Putting game logic in `components/ui/`.
4. Mutating `mesh.userData` directly — use `setCardData`.
5. Fetching Scryfall (or any card API) directly from the client.
6. Forgetting `cleanup()` when leaving a game — causes WebGL / Yjs leaks.
7. Duplicating `cn` or card dimension constants.
8. Large cross-layer changes that ignore the UI / 3D / network / card-data split.

## License

This project is licensed under the **GNU Affero General Public License (AGPL)**. Contributions must comply with AGPL requirements.

## Getting help

- [Discord](https://discord.gg/wzdj2W9vvf)
- [Bluesky](https://bsky.app/profile/sparkstonepdx.com)

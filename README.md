# Untapped Table

Mesa virtual 3D para jugar Magic: The Gathering en el navegador. Cartas vía [Scryfall](https://api.scryfall.com), editor de mazos y multijugador.

La app anterior multi-TCG (Arcanetable / SolidStart) vive en [`legacy/arcanetable/`](legacy/arcanetable/).

## Desarrollo

```bash
bun install
bun run dev
```

Abre `http://localhost:3001`.

## Build

```bash
bun run build
```

Salida en `dist/`. `vercel.json` incluye rewrite SPA y proxies de API.

## Cloudflare Pages

Build: `bun run build` · Output: `dist/`

Las funciones en `functions/` replican los proxies de Vercel (no hace falta env var de Scryfall):

| Ruta | Función |
|------|---------|
| `/api/scryfall/*` | Proxy a api.scryfall.com |
| `/api/moxfield/*` | Proxy a api.moxfield.com |
| `/api/commander-bracket` | Proxy a CommanderBracket |
| `/image-proxy` | Proxy de imágenes custom |

`wrangler.toml` usa `not_found_handling = "single-page-application"` para el fallback SPA (no hace falta `public/_redirects`; con Workers provoca bucle infinito en deploy). Las rutas `/api/*` e `/image-proxy` las atiende el Worker compilado desde `/functions`.

### Configuración en Cloudflare (Workers Builds)

Este repo usa **Workers Builds** (Git → Worker), no el CI clásico de Pages. El deploy command **no puede quedar vacío**; es normal.

| Campo | Valor |
|-------|-------|
| Build command | `bun install && bun run build:cloudflare` |
| Deploy command (rama `main`) | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |
| Root directory | `/` |

El build compila Vite (`dist/`) y las Pages Functions de `/functions` en `worker/` (ver `wrangler.toml`). **No uses** `wrangler pages deploy` aquí: el token de Workers Builds no suele tener permiso Pages Edit y falla con auth error 10000.

Deploy manual:

```bash
bun run build:cloudflare
bun run deploy:cloudflare
```

Opcional en el dashboard de Cloudflare: `VITE_YJS_WS_URL`, `VITE_SITE_URL`.

## Scryfall

Respeta los [requisitos de uso de Scryfall](https://scryfall.com/docs/api): no abuses de la API, incluye atribución si publicas la app, y ten en cuenta el rate limit en partidas con muchas cartas nuevas a la vez.

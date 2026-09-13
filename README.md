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

`public/_redirects` envía el resto de rutas a `index.html` (SPA). Las funciones se ejecutan **antes** que los redirects estáticos.

Opcional en el dashboard de Cloudflare: `VITE_YJS_WS_URL`, `VITE_SITE_URL`.

## Scryfall

Respeta los [requisitos de uso de Scryfall](https://scryfall.com/docs/api): no abuses de la API, incluye atribución si publicas la app, y ten en cuenta el rate limit en partidas con muchas cartas nuevas a la vez.

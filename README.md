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

Salida en `dist/`. `vercel.json` incluye rewrite SPA y `/image-proxy` para arte custom.

## Scryfall

Respeta los [requisitos de uso de Scryfall](https://scryfall.com/docs/api): no abuses de la API, incluye atribución si publicas la app, y ten en cuenta el rate limit en partidas con muchas cartas nuevas a la vez.

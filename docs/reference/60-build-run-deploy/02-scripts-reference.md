# 60.2 — Scripts reference

Every script in the root `package.json`, what it does, and when to use it.

## Dev

### `bun run dev`

Runs `mprocs` with `mprocs.yaml`. Brings up server + client + agent-dev simultaneously. This is the default dev command.

### `bun run start`

Builds the OSRS cache (if needed) via `scripts/ensure-cache.ts`, then starts the craco dev server on `:3000`. Just the client, no server.

### `bun run server:start`

Ensures the server's cache is available (`scripts/ensure-cache.ts --server`), then launches `server/src/index.ts` via `tsx`. Just the server, no client.

## Build

### `bun run build`

`craco build`. Produces a production client bundle in `build/`. The bundle is a static site — HTML, JS, CSS, WASM — that can be hosted anywhere (Vercel, Netlify, Cloudflare Pages, S3, a Caddy static block). Configure the WebSocket URL via the `REACT_APP_WS_URL` env var at build time:

```sh
REACT_APP_WS_URL=wss://game.example.com REACT_APP_SERVER_NAME="My Server" bun run build
```

### `bun run server:build`

Runs `tsc -p server/tsconfig.json`. Type-checks the server — useful in CI. In production you typically run the server via `bun server/src/index.ts` directly (Bun transpiles TypeScript on the fly) rather than pre-compiling.

### `bun run build:all`

Runs both the client and server builds in parallel via `mprocs --config mprocs.build.yaml`.

### `bun run server:build-collision`

Regenerates the baked collision cache at `server/cache/collision/` from the OSRS map + model data. Slow (minutes) — only run when you've changed how collision is computed or when the source cache version bumps.

## Cache export tools

### `bun run ensure-cache`

Runs `scripts/ensure-cache.ts`. Downloads and extracts the OSRS cache if missing. Safe to run repeatedly.

### `bun run export-textures`

Runs `scripts/cache/export-textures.ts`. Dumps the cache's textures to disk as PNGs. Used for debugging texture loading bugs and for making tooling that operates on the texture set.

### `bun run export-height-map`

Runs `scripts/cache/export-height-map.ts`. Dumps the per-tile height map as an image for map tooling.

### `bun run export-items`

Runs `scripts/cache/export-items.ts` with the cache revision `osrs-232_2025-08-27` pinned as the first argument. Dumps every item type into a JSON file — the basis for `server/data/items.json`. If you update the cache version, change the version string in the script.

### `bun run export-map-images`

Runs `scripts/cache/export-map-images.ts --force`. Dumps the world map as a tiled image set.

## Tests

### `bun run test:auth`

Runs `scripts/test-auth.ts` via Bun. A smoke-test for the authentication flow.

The broader test suite runs via `bun test` directly (no script alias). Tests live under `tests/` and inside subsystem directories as `*.test.ts`.

## Docs

### `bun run docs:dev`

Starts the VitePress dev server for the docs site (`docs/`). Hot reload on markdown changes.

### `bun run docs:build`

Builds the static docs site into `docs/.vitepress/dist/`.

### `bun run docs:preview`

Previews the built docs site locally.

## Lint

### `bun run lint`

Runs `prettier --write` over every `.js`, `.ts`, `.jsx`, `.tsx`, `.css`, and `.md` file in the repo. Auto-formats — no separate check mode.

## `prepare`

Runs `husky install` once after dependencies are installed, so git hooks are wired up.

## Canonical facts

- **Package file**: `package.json`.
- **Dev orchestrator**: `mprocs.yaml`.
- **Build orchestrator**: `mprocs.build.yaml`.
- **Cache ensurer**: `scripts/ensure-cache.ts`.
- **Cache exporters**: `scripts/cache/*.ts`.
- **Agent dev bot**: `scripts/agent-dev.ts`.
- **Auth smoke test**: `scripts/test-auth.ts`.
- **Rule**: prefer Bun — `bun run <script>` over `npm run <script>`.

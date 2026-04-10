# 60 — Build, run, deploy

This section covers the operational side: how to get a dev environment running, what the build outputs are, and how to deploy a production instance.

## Pages

| Page | Topic |
|---|---|
| [01 — Local development](./01-local-dev.md) | First-run setup, dev loop, hot reload |
| [02 — Scripts reference](./02-scripts-reference.md) | Every script in `package.json` |
| [03 — The OSRS cache](./03-cache.md) | Where the cache comes from, ensure-cache |
| [04 — mprocs orchestration](./04-mprocs.md) | Dev layout, build layout, commands |
| [05 — Production deploy](./05-deploy.md) | Caddy, env vars, process supervision |
| [06 — Observability](./06-observability.md) | Logs, profiling, dev overlay |

## Minimum requirements

- **Bun** ≥ 1.1 (per `CLAUDE.md`, Bun is the default runtime).
- **Node** is allowed as a fallback for a few legacy scripts; prefer Bun.
- **A filesystem** that can hold the OSRS cache (~1 GB extracted).
- **A browser** with WebGL 2 and WebAssembly. The client targets modern Chromium/Firefox/Safari.

The rest is handled by `bun install`.

## Rule of thumb

Run `bun run dev` and three processes come up: the game server on `:43594`, the React dev client on `:3000`, and a bot agent that random-walks around the world. Open `http://localhost:3000` and you're in.

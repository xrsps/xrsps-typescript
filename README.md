# XRSPS

A community-driven project inspired by Project Zanaris.
OSRS in the browser with a React/WebGL client and TypeScript WebSocket server.

## Packages

This repository contains:

- [`client/`](client/) — `@xrsps/client` (browser app)
- [`server/`](server/) — `@xrsps/server` (game server)
- [`docs/`](docs/) — documentation site

## Quick Start

Requires **Node.js v22.16+**. This repository uses Yarn `4.12.0`.

Verify the repository-pinned Yarn version:

```bash
yarn --version
```

It should print `4.12.0`. If `yarn` is not found, run `corepack enable` first (this may require an elevated terminal on Windows).

Install the server and client, then build collision data:

```bash
yarn setup
```

Start the server and client together:

```bash
yarn start
```

Start only the server:

```bash
yarn server
```

Start only the client:

```bash
yarn client
```

Start the documentation site (optional):

```bash
cd docs
yarn install
yarn dev
```

See [docs/setup.md](docs/setup.md) for details.

## Eyes for coding agents

`tools/eyes/` lets Claude Code (or any MCP host) *see* the running game: screenshots, live game state (tile, HP, NPCs, inventory, chat, open widgets), mouse/keyboard input and game actions, exposed as `game_*` MCP tools or a CLI. The repo's `.mcp.json` wires it into Claude Code automatically; run `yarn eyes:setup` once, then `yarn start` and ask Claude to open the game. See [tools/eyes/README.md](tools/eyes/README.md).

## Deploying (Vercel + Fly.io)

The browser client deploys to **Vercel** as a static site; the game server (WebSocket + OSRS cache) runs as a Docker container on **Fly.io** (or Railway / any Docker host). See [DEPLOY.md](DEPLOY.md) for the step-by-step guide — the client needs a single environment variable, `REACT_APP_GAME_HOST`, pointing at the server's hostname.

---

Fan project. Not affiliated with, endorsed by, or connected to Jagex Ltd.
Old School RuneScape and related assets/trademarks belong to their respective owners.

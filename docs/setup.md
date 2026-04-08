# Setup Guide

Get xRSPS running locally in a few minutes.

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| [Node.js](https://nodejs.org/) | v22.16+ | Runtime for both client and server |
| [Yarn](https://classic.yarnpkg.com/en/docs/install) | v1 (Classic) | Package manager |
| [Git](https://git-scm.com/) | Any recent | Clone the repo |

::: tip Node Version
Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage Node versions easily:
```bash
nvm install 22
nvm use 22
```
:::

## 1. Clone the Repository

```bash
git clone https://github.com/xrsps/xrsps-typescript.git
cd xrsps-typescript
```

## 2. Install Dependencies

```bash
yarn install
```

This pulls in everything for both the client and server.

## 3. Build Required Data

Before you can run the game, two offline build steps are needed. These only need to be done **once** (or when the cache version updates).

### Collision Cache

The server uses a precomputed collision map for pathfinding and movement:

```bash
yarn server:build-collision
```

::: info
This takes a few minutes on first run. It reads the game cache and writes collision data to `server/cache/collision/`.
:::

### World Map Images

The client renders the world map from pre-exported tile images:

```bash
yarn export-map-images
```

::: info
This can also take a few minutes. It exports tile images to `public/map/`.
:::

## 4. Start the Server

```bash
yarn server:start
```

The server will:
1. Automatically download the OSRS cache if it hasn't been fetched yet
2. Load collision data, spells, and game scripts
3. Start a WebSocket server on `0.0.0.0:43594`

You should see log output confirming the server is ready.

By default, the server runs the **vanilla** gamemode. To run a different gamemode:

```bash
# Environment variable
GAMEMODE=leagues-v yarn server:start

# Or set it in server/config.json
{ "gamemode": "leagues-v" }
```

## 5. Start the Client

Open a **second terminal** and run:

```bash
yarn start
```

This launches the React dev server (usually on `http://localhost:3000`). Your browser should open automatically. The client will also download the cache on first run if needed.

::: warning Two Terminals
The server and client run as separate processes. You need both running at the same time.
:::

## You're In

Log in with any username. You should spawn into the game world.

---

## Troubleshooting

### Cache download hangs or fails

The cache is downloaded from the [OpenRS2 Archive](https://archive.openrs2.org/). If it stalls:
- Check your internet connection
- Delete the `caches/` folder and try again
- The target cache version is defined in `target.txt` at the repo root

### `yarn server:build-collision` is slow

This is expected on first run. Subsequent runs are fast because results are cached in `server/cache/collision/`.

### Port 43594 already in use

Another instance of the server is likely running. Kill it or change the port in the server config.

### Client shows a blank screen

- Make sure the server is running first
- Check the browser console for WebSocket connection errors
- Ensure the cache download completed (check `caches/` folder)

### Node version errors

Ensure you're on Node v22.16+:
```bash
node -v
```

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `yarn start` | Start the client dev server |
| `yarn server:start` | Start the game server |
| `yarn server:build-collision` | Build collision cache (once) |
| `yarn export-map-images` | Export world map images (once) |
| `yarn download-caches` | Manually download the OSRS cache |
| `yarn lint` | Format code with Prettier |

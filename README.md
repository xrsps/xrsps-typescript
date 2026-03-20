# xrsps-typescript

xRSPS is intended to explore OSRS in a similar spirit to Jagex's abandoned Project Zanaris.

Discord: https://discord.gg/3dzttF2q73

This project contains:

- a React/WebGL game client
- a TypeScript WebSocket game server
- cache-driven widgets, CS2/UI behaviour, map loading, models, audio, and gameplay systems

## Status

This is an active work-in-progress community project, not intended to be a finished game.

## Tech Stack

- TypeScript
- React
- WebGL / PicoGL
- WebSockets
- Cache-driven client and server tooling

## Project Structure

- `src`: browser client, rendering, widgets, cache loaders, gameplay client logic
- `server`: WebSocket server, world logic, pathfinding, widgets, scripts
- `scripts`: cache utilities and export tools

## Requirements

Ensure you have these or you might run into weird issues.

- Node.js v22.16+
- Yarn

## Getting Started

Install dependencies:

```bash
yarn install
```

Download caches:

```bash
yarn download-caches
```

Build the server collision cache:

```bash
yarn server:build-collision
```

Build the world map into static images:

```bash
yarn export-map-images
```

Start the server:

```bash
yarn server:start
```

Start the client in another terminal:

```bash
yarn start
```

By default the WebSocket server runs on:

- host: `0.0.0.0`
- port: `43594`

## Useful Scripts

```bash
yarn start
yarn server:start
yarn server:build-collision
yarn download-caches
yarn export-textures
yarn export-map-images
yarn mcp
```

## Design Goals

- OSRS parity first
- shared systems over one-off feature hacks
- cache and CS2 driven UI behaviour
- browser-first gameplay with desktop and mobile support

## Notes

- This repository is under active development and internal tooling/debug paths may change frequently.
- Some systems are intentionally unfinished while parity work is still ongoing.
- Cache assets are not embedded in the repo and must be downloaded locally.
- Feel free to use your own AI tooling to submit any new features or contributions
- UI is entirely CS2 driven on the client side, typically trigger by serverside scripts

## Disclaimer

This is a fan project and is not affiliated with, endorsed by, or connected to Jagex Ltd.  
Old School RuneScape and related assets/trademarks belong to their respective owners.

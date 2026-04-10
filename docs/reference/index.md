# XRSPS Reference Documentation

> **This is the deep-dive reference for XRSPS.** Every subsystem, every public API, every file you'll need to touch. It complements the high-level guides ([Setup](/setup), [Architecture](/ARCHITECTURE), [Gamemodes](/gamemodes), [Extrascripts](/extrascripts)) by going one level below — to actual file paths, actual class names, actual packet opcodes.
>
> It is written for **two audiences** at once:
>
> - **Humans** — each page opens with a narrative orientation so you can read it front-to-back.
> - **LLMs / automated agents** — every page closes with a structured "Canonical facts" block containing absolute file paths, symbol names, and one-line summaries so a code assistant can find the right file on the first hop.

## How to read this

If you just want to run the game, start at [Setup](/setup) and come back here when you want to know _why_. If you're here to change or extend the engine, pick the section that owns the behaviour you want to modify.

The reference is organized in numbered sections so that cross-references read like a table of contents:

- [00 — Overview](./00-overview.md): what XRSPS is, how the pieces fit together, the mental model.
- [01 — Repo map](./01-repo-map.md): every top-level directory, what belongs where, where _not_ to put things.
- [02 — Full architecture](./02-architecture.md): the end-to-end data flow — browser → WebSocket → tick loop → broadcasts → browser again.
- [10 — Client reference](./10-client/index.md): the browser-side engine (cache, scene, WebGL, UI, input, login, audio, plugins, workers).
- [20 — Server reference](./20-server/index.md): the Node/Bun-side engine (tick loop, services, player state, persistence, pathfinding, combat).
- [30 — Shared code](./30-shared/index.md): `src/shared/` — the protocol contract between client and server.
- [40 — Protocol](./40-protocol/index.md): the wire format in detail. Connection lifecycle, opcodes, bit-packed sync, encoders/decoders.
- [50 — Gamemodes & scripts](./50-gamemodes-scripts/index.md): how gamemodes are loaded, the script registry API, extrascripts, hot reload.
- [60 — Build, run, deploy](./60-build-run-deploy/index.md): `bun run` targets, scripts/, mprocs, cache download, Caddy deployment.
- [70 — Worked examples](./70-examples/index.md): complete, copy-pasteable recipes for running, adding content, writing packets, rendering overlays.
- [80 — LLM machine index](./80-llm/index.md): file index, symbol map, glossary, and quick-lookup table designed for AI agents.

## Conventions used throughout

- **Paths** are written relative to the repo root, e.g. `server/src/index.ts`. Everything is relative to wherever you cloned `xrsps-typescript`.
- **Symbols** use `ClassName.method()` or `exportedFunction()` formatting. When a symbol lives in a surprising file, the path is given alongside.
- **Opcodes** are shown with both their enum name and numeric value, e.g. `ClientPacketId.LOGIN (204)`.
- **Canonical facts** blocks at the end of each page list files, symbols, and env vars in a structured way. Treat them as the source of truth if the prose and the block ever disagree — the block is scanned automatically by LLM agents.
- **Not-yet-implemented** caveats are marked explicitly with ⚠️ when a subsystem exists in the source but doesn't yet do what the name suggests.

## Scope boundary

This reference documents the _engine_ (the code in `src/`, `server/src/`, `scripts/`, and build config) and the _two shipped gamemodes_ (`vanilla` and `leagues-v`). It does **not** attempt to document every content script in `server/gamemodes/vanilla/scripts/content/` file-by-file — there are hundreds of them and they change constantly. Instead, the gamemode reference explains the patterns so you can read any one of them yourself.

It also does not document the OSRS cache format itself; that's documented externally by the OpenRS2 project and RuneLite. Where XRSPS interacts with the cache, the relevant loaders are documented here.

## Feedback

The canonical source for this reference lives at `docs/reference/` in the repo. If a path is wrong, a signature has drifted, or a page has gone stale, edit it and open a PR. Every page has an "Edit this page on GitHub" link at the bottom.

---

Continue to [00 — Overview](./00-overview.md) →

# Eyes — let your coding agent see the game

Claude (or any MCP-capable agent) can read this codebase but can't see the game
run. `eyes` fixes that: it drives the real browser client in headless Chromium
and exposes what's on screen **and** what the client knows, as tools.

- **Screenshots** of the live WebGL client (`game_look`, `game_screenshot`)
- **Structured state** straight from the client: player tile, HP, skills,
  inventory, nearby NPCs/players with names and on-screen positions, open
  widgets, chat history, the context menu under the mouse
- **Input**: click / right-click / hover / drag / scroll / keys / typing, click a
  world tile, pick a menu entry
- **Actions as packets**: walk, say, NPC option, open/close widget
- **Diagnostics**: browser console (regex filter), uncaught errors, network
  failures, WebSocket frame counters, `game_eval` for anything else

Two front-ends over the same core (`src/GameEyes.js`):

| | Use it when |
| --- | --- |
| **MCP server** `src/mcp.js` | Claude Code / Cursor / any MCP host. Tools are named `game_*`. Screenshots come back as images the model can look at. |
| **CLI** `src/cli.js` | Shell scripts, CI, or an agent that only has a Bash tool. A tiny daemon keeps the browser open between commands. |

## Setup (once)

```bash
cd tools/eyes
yarn install
yarn install-browser        # downloads Playwright's Chromium (~150 MB)
```

The game must be running: `yarn start` at the repo root (server on :43594,
client dev server on :3000). `eyes` opens `http://localhost:3000` by default;
override with `EYES_CLIENT_URL` (e.g. a production build served elsewhere).

### Claude Code

The repo ships a `.mcp.json`, so inside this repo Claude Code picks the server
up automatically (approve it once when asked). To add it manually instead:

```bash
claude mcp add xrsps-eyes -- node tools/eyes/src/mcp.js
```

Then just ask: *"open the game as testuser/testpass123, look around, walk to
the Lumbridge fountain and tell me if the NPCs animate."*

### Cursor / VS Code MCP

Point the host at `node tools/eyes/src/mcp.js` (stdio). Same tools.

## Tools (MCP)

| Tool | What it does |
| --- | --- |
| `game_open {url?, username?, password?}` | Launch Chromium, open the client, auto-login and wait for the world. |
| `game_login {username, password}` | Reload + auto-login. First login registers the account (password 8–20 chars). |
| `game_look` | **Screenshot + state in one call.** Use after every action. |
| `game_screenshot {format?, quality?, clip?}` | Just pixels. JPEG by default (small), PNG for pixel-exact. |
| `game_state` | gameState, loggedIn, tile, HP/prayer, camera, open widgets, modal/menu flags, last chat. |
| `game_npcs {radius?}` / `game_players {radius?}` | Nearby actors sorted by distance, with `serverId`, tile and `screen {x,y}`. |
| `game_inventory` / `game_skills` / `game_chat {count?}` | Backpack + equipment, all skills, recent chat lines. |
| `game_hover {x,y}` → `game_menu` → `game_menu_pick {index}` | See what a click would do, then do it. |
| `game_click {x,y,button?,double?}` / `game_click_tile {x,y,plane?}` | Mouse clicks by screen or world coordinates. |
| `game_key {key,hold?}` / `game_type {text,enter?}` / `game_drag` / `game_scroll` | Keyboard, camera drag (middle mouse), zoom. |
| `game_walk {x,y,run?}` / `game_say {text}` / `game_npc_action {serverId,op?}` / `game_widget` | Game actions sent as packets (no pixel hunting). |
| `game_wait {ms?}` or `{until: "<js>"}` | Sleep, or wait for a condition over `(client, eyes)` e.g. `eyes.tile().x === 3222`. |
| `game_console {pattern?, types?, last?}` / `game_network {failedOnly?}` | What the browser logged; failed requests; WebSocket counters. |
| `game_eval {expression}` | Escape hatch: run JS in the page with `client` (`window.osrsClient`) and `eyes` (`window.__eyes`) in scope. |
| `game_close` | Shut the browser. |

Screen coordinates are in a 1280×800 viewport (change with `EYES_WIDTH/HEIGHT`).
Hidden NPCs the cache names `"null"` are skipped unless asked for.

## CLI

```bash
yarn eyes serve            # start the daemon (add --headed to watch the browser)
eyes open user pass        # or: node tools/eyes/src/cli.js open user pass
eyes look shot.jpg         # state to stdout, screenshot to file
eyes npcs 10 | eyes inv | eyes skills | eyes chat 5 | eyes menu
eyes hover 556 162 && eyes pick 0        # "Attack Rat"
eyes click 640 300 right | eyes tile 3222 3218 | eyes key Escape | eyes type "hi" --enter
eyes walk 3222 3218 && eyes until "eyes.tile().x === 3222"
eyes say hello world | eyes npc 20004 1 | eyes widget open 149
eyes console "\[ws\]" | eyes net --failed | eyes eval "client.camera.yaw"
eyes stop
```

`eyes` with no arguments prints the full command list.

## How it works

- `client/game/debug/EyesBridge.ts` installs `window.__eyes` when the page URL has
  `?eyes=1` (or `localStorage.eyes = "1"`). It reads the client's own ECS,
  widget manager, chat store, skills map and inventories, and calls the same
  outgoing-packet helpers the UI uses. It's inert otherwise and ships in every
  build — there is nothing secret in a client the player already runs.
- `tools/eyes/src/GameEyes.js` launches Chromium with SwiftShader (WebGL2 with no
  GPU), opens the client with `?eyes=1&username=&password=` (the client's own
  auto-login path), and waits for `gameState === LOGGED_IN` so the first
  screenshot is the world, not the loading overlay.
- The MCP server and CLI are thin wrappers over that class.

## Env

| Variable | Default | |
| --- | --- | --- |
| `EYES_CLIENT_URL` | `http://localhost:3000` | Where the client is served. |
| `EYES_HEADED` | unset | Set to `1` to watch the browser. |
| `EYES_WIDTH` / `EYES_HEIGHT` | `1280` / `800` | Viewport. |
| `EYES_CHROMIUM` | Playwright's | Path to a Chromium binary. |
| `EYES_PORT` | `7788` | CLI daemon port. |
| `EYES_BOOT_TIMEOUT_MS` / `EYES_LOGIN_TIMEOUT_MS` / `EYES_SCENE_TIMEOUT_MS` | 180s / 120s / 90s | Patience for cache download, login, first scene. |

## Test

With the game running:

```bash
EYES_CLIENT_URL=http://localhost:3000 yarn test
```

Talks to `mcp.js` over stdio like a real host, logs in, walks, chats, hovers an
NPC and checks the answers. Screenshots land in `tests/out/`.

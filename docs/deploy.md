# Deploying XRSPS: client on Vercel, game server on Fly.io

XRSPS is three things, and only one of them can live on Vercel:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| **Client** (`client/`) | React + WebGL browser app. Static files after build. | **Vercel** |
| **Game server** (`server/`) | Node WebSocket server, 600 ms tick loop, SQLite saves. Must stay running. | **Fly.io** (or Railway / any Docker host) |
| **OSRS cache** (~200 MB) | Models, maps, animations… The browser streams it with HTTP Range requests. | Served by the game server at `/caches/` |

The whole flow takes about 20 minutes, most of it waiting on the first Docker build.

---

## 0. Prerequisites

- A [Fly.io](https://fly.io) account with a card on file (≈ $11–12/month for the 2 GB machine, see [pricing](https://fly.io/docs/about/pricing/)).
- A [Vercel](https://vercel.com) account.
- `flyctl` installed: `curl -L https://fly.io/install.sh | sh` (macOS/Linux) or `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"` (Windows).
- Optional, for local builds only: Node 22.16+, Yarn 4.12 (`corepack enable`).

---

## 1. Game server → Fly.io

From the repository root (the `Dockerfile` and `fly.toml` are there):

```bash
fly auth login

# 1. Pick a globally unique app name and put it in fly.toml (app = "...").
fly apps create xrsps-server            # use your own name

# 2. Persistent volume for player saves (SQLite). Same region as fly.toml's primary_region.
fly volumes create xrsps_data --region ams --size 1 -a xrsps-server

# 3. Build + deploy. First build ≈ 10–20 min: it downloads the OSRS cache from
#    OpenRS2 and precomputes collision data inside the image. Later deploys reuse
#    those layers and take ~1 min.
fly deploy -a xrsps-server
```

If the remote builder struggles (out of memory or slow), build locally with Docker instead:

```bash
fly deploy -a xrsps-server --local-only
```

Check it's alive:

```bash
fly status -a xrsps-server
fly logs   -a xrsps-server         # look for "WS listening" and "[cache-http] serving"
curl https://xrsps-server.fly.dev/status
# → {"serverName":"XRSPS","playerCount":0,"maxPlayers":2047}
curl -sI -H "Range: bytes=0-0" https://xrsps-server.fly.dev/caches/osrs-237_2026-03-25/main_file_cache.dat2 | head -1
# → HTTP/2 206
```

Your game host is now **`xrsps-server.fly.dev`** (WebSocket `wss://`, cache `https://…/caches/`).

### Server environment variables (fly.toml `[env]`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `GAMEMODE` | `vanilla` | `vanilla` (OSRS) or `leagues-v`. |
| `SERVER_NAME` | `XRSPS` | Name shown on the login screen. |
| `XRSPS_DATA_DIR` | `/data` | Where SQLite saves live (the mounted volume). |
| `SERVE_CACHE` | `true` | Serve the OSRS cache at `/caches/`. |
| `CORS_ORIGIN` | `*` | Lock cache/status CORS to your Vercel URL once you have it. |
| `ALLOW_ACCOUNT_REGISTRATION` | `true` | `false` to stop new usernames from registering. |
| `ALLOW_LEGACY_ACCOUNT_CLAIM` | unset | Migration-only, see [Setup](/setup). |

Change them with `fly secrets set KEY=value -a xrsps-server` (restarts the machine) or edit `[env]` and redeploy.

### Sizing

The server keeps the full cache + collision data in memory: ~1 GB RSS with zero players. `fly.toml` requests `shared-cpu-2x` / 2 GB. To scale: `fly scale memory 4096 -a xrsps-server` (and bump `NODE_OPTIONS=--max-old-space-size` in the Dockerfile accordingly).

---

## 2. Client → Vercel

The client is built by Vercel from the **repository root** (`vercel.json` points at `client/`). Everything it needs to know about the server is one environment variable.

### Option A — Git import (recommended)

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Vercel: **Add New → Project → Import** the repo. Leave the root directory as `/` — `vercel.json` already sets framework, install/build commands and the output directory.
3. Under **Environment Variables** add:

   | Name | Value |
   | --- | --- |
   | `REACT_APP_GAME_HOST` | `xrsps-server.fly.dev` (your Fly hostname, no `https://`) |

   Optional overrides (see `client/.env.example`): `REACT_APP_DEFAULT_SERVER_NAME`, `REACT_APP_SERVERS_JSON`, `REACT_APP_CACHE_BASE_URL`, `REACT_APP_DEFAULT_WS_URL`.

4. **Deploy.** Open the URL Vercel gives you — the login screen should show your server with a live player count.

### Option B — Vercel CLI from this folder

```bash
npm i -g vercel
vercel login
vercel link                      # creates the project
vercel env add REACT_APP_GAME_HOST production   # paste: xrsps-server.fly.dev
vercel --prod
```

### Why the headers in `vercel.json` matter

The client uses `SharedArrayBuffer` for its cache workers, which browsers only allow on **cross-origin-isolated** pages. `vercel.json` sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (Chromium only; Safari/Firefox fall back to plain ArrayBuffers). The game server answers with `Cross-Origin-Resource-Policy: cross-origin` plus CORS headers exposing `Content-Range`, so the cache can be loaded across origins. Don't remove either side.

### Lock CORS down (optional but recommended)

Once you know your Vercel URL:

```bash
fly secrets set CORS_ORIGIN=https://your-project.vercel.app -a xrsps-server
```

---

## 3. Custom domains (optional)

- **Client:** add the domain in Vercel → Project → Domains (e.g. `play.yourdomain.com`).
- **Server:** `fly certs add game.yourdomain.com -a xrsps-server`, add the CNAME it prints, then set `REACT_APP_GAME_HOST=game.yourdomain.com` in Vercel and redeploy the client.

---

## 4. Railway instead of Fly.io

The same `Dockerfile` works on Railway:

1. New Project → Deploy from GitHub repo.
2. Settings → Build: Builder **Dockerfile**, path `Dockerfile` (repo root).
3. Add a **Volume** mounted at `/data`.
4. Variables: `PORT=43594`, `HOST=0.0.0.0`, `GAMEMODE=vanilla`, `SERVER_NAME=XRSPS`, `XRSPS_DATA_DIR=/data`, `SERVE_CACHE=true`.
5. Settings → Networking → Generate Domain (target port 43594). Use that hostname as `REACT_APP_GAME_HOST`.
6. Give the service at least 2 GB RAM.

---

## 5. Playing

Open the Vercel URL, click the server button if you want to double-check the address, and log in with any username + a password of 8–20 characters. The first login registers the account. Player data persists on the Fly volume across deploys.

---

## Operations cheat-sheet

```bash
fly logs -a xrsps-server                   # live server log
fly ssh console -a xrsps-server            # shell inside the machine
fly ssh console -a xrsps-server -C "ls -la /data/vanilla"   # saves (game.sqlite)
fly volumes snapshots list <volume-id>     # Fly keeps daily volume snapshots
fly machine restart <machine-id> -a xrsps-server
```

Back up saves: `fly ssh sftp get /data/vanilla/game.sqlite ./game.sqlite -a xrsps-server`.

---

## What changed vs. upstream XRSPS

Small, self-contained additions so the client and server can live on different hosts:

- `server/src/network/CacheHttpHandler.ts` — serves `server/caches/` at `/caches/*` with HTTP Range, CORS and CORP headers (`SERVE_CACHE`, `CORS_ORIGIN`).
- `server/src/network/wsServer.ts` — wires the handler into the existing HTTP listener; `/status` and `/health` now also send `Cache-Control: no-store`.
- `server/src/game/gamemodes/GamemodeRegistry.ts` — `XRSPS_DATA_DIR` relocates per-gamemode saves (for mounted volumes); seed files are copied on first use.
- `client/config/clientEnv.ts` — `REACT_APP_GAME_HOST` one-knob config (explicit `REACT_APP_*` vars still win).
- `server/config.json` — gamemode set to `vanilla`, server name `XRSPS`.
- `Dockerfile`, `.dockerignore`, `fly.toml`, this guide.

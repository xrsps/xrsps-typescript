# Public Deployment Guide

Everything you need to run xRSPS as a public server — password-protected
accounts, TLS-terminated WebSockets, and proper origin allowlisting.

## What this guide gets you

- **Real password authentication.** First login with a username+password
  creates the account; every subsequent login must match. Passwords are
  hashed with scrypt (Node built-in — no external crypto deps).
- **TLS-terminated WebSockets (`wss://`).** Required so browsers on HTTPS
  pages can connect.
- **Origin allowlist.** Only your client domain can open WebSocket
  connections to your server.
- **IP-based rate limiting.** 5 login attempts / 60 seconds / IP
  (configurable).
- **Persistent accounts.** Stored as a JSON file at
  `server/data/accounts.json`, separate from gameplay state.

::: warning Scope
This guide covers the **code-level** hardening. It does NOT cover OS-level
hardening (firewall rules, fail2ban, unattended-upgrades, backups) which you
should also do before running anything public.
:::

---

## Prerequisites

You need:

1. A **Linux box** (VPS, home server, whatever) with:
   - Node.js v22.16+
   - [Bun](https://bun.sh/) v1.3+
   - Caddy (will be installed)
2. A **domain** (or subdomain) you control, with DNS pointing at the box.
3. Ports **80** and **443** open to the internet (Caddy uses them for
   automatic LetsEncrypt TLS).
4. The server code checked out on the box.

---

## 1. Configure the game server

Create or edit `server/config.json`:

```json
{
	"serverName": "My xRSPS Server",
	"maxPlayers": 200,
	"gamemode": "vanilla",
	"allowedOrigins": [
		"https://xrsps.example.com"
	],
	"minPasswordLength": 8
}
```

**Key fields:**

| Field               | What it does                                                                                       |
|---------------------|----------------------------------------------------------------------------------------------------|
| `allowedOrigins`    | Only these `Origin` headers can open a WebSocket. Empty = allow all (dev). Set this for public.    |
| `minPasswordLength` | Minimum password length at account creation. Existing accounts are not re-validated.              |
| `accountsFilePath`  | (Optional) Relative path to the accounts JSON file. Default: `data/accounts.json`.                 |

Equivalent env vars (env wins over `config.json`):

```bash
export ALLOWED_ORIGINS="https://xrsps.example.com"
export AUTH_MIN_PASSWORD_LENGTH=8
export ACCOUNTS_FILE_PATH=/var/lib/xrsps/accounts.json
```

Storing the accounts file outside the repo (`/var/lib/xrsps/...`) is a good
idea for production so a `git reset --hard` can't nuke your player database.

---

## 2. Build the game data (once)

```bash
bun install
bun run server:build-collision
bun run export-map-images
```

These are one-time setup steps. They read the OSRS cache and generate
collision + map image artifacts needed by the server and client. See the
[setup guide](setup.md) for details.

---

## 3. Build the client pointed at your domain

The client's default WebSocket URL is baked in at build time via CRA env
vars. Before building, create `.env.production` in the repo root:

```bash
REACT_APP_WS_URL=wss://game.example.com
REACT_APP_SERVER_NAME=My xRSPS Server
```

::: tip Path-based routing not supported
The client builds URLs as `scheme://host:port` with no path component. Use a
dedicated subdomain (e.g. `game.example.com`) for the WebSocket endpoint;
don't try to proxy it under `/ws` on your main domain.
:::

Then build:

```bash
bun run build
```

The output goes to `build/`. Host it wherever you like — Vercel, Netlify,
Cloudflare Pages, GitHub Pages, another Caddy site — as long as the hosting
domain is in `allowedOrigins` above.

---

## 4. Front the server with Caddy (TLS + WebSocket proxy)

Install Caddy: <https://caddyserver.com/docs/install>

Copy `deployment/Caddyfile` from this repo to `/etc/caddy/Caddyfile` and
replace `game.example.com` with your actual subdomain. The file already does:

- Automatic LetsEncrypt TLS provisioning and renewal
- WebSocket upgrade handling
- Forwarding of `Origin` / `X-Forwarded-For` headers so the server's rate
  limiter and origin allowlist see the real client

Start it:

```bash
sudo systemctl enable --now caddy
```

On first start Caddy will fetch a certificate from LetsEncrypt. Watch the
logs:

```bash
sudo journalctl -u caddy -f
```

Look for `certificate obtained successfully` — that means TLS is live.

---

## 5. Run the game server

```bash
GAMEMODE=vanilla bun run server:start
```

Look for these log lines confirming hardening is active:

```
[accounts] no existing account file at .../accounts.json — starting fresh
[ws] Origin allowlist active: https://xrsps.example.com
WS listening on ws://0.0.0.0:43594
```

If `Origin allowlist disabled — all origins accepted` shows instead, your
`allowedOrigins` config didn't load. Re-check `server/config.json` or the
`ALLOWED_ORIGINS` env var.

For production you should run it under a process manager. Minimal systemd
unit:

```ini
# /etc/systemd/system/xrsps.service
[Unit]
Description=xRSPS game server
After=network.target

[Service]
Type=simple
User=xrsps
WorkingDirectory=/home/xrsps/xrsps-typescript
ExecStart=/home/xrsps/.bun/bin/bun run server:start
Restart=on-failure
RestartSec=5
Environment=GAMEMODE=vanilla
Environment=ALLOWED_ORIGINS=https://xrsps.example.com
Environment=ACCOUNTS_FILE_PATH=/var/lib/xrsps/accounts.json

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now xrsps
```

---

## 6. Verify end-to-end

1. Open your client at `https://xrsps.example.com` (or wherever you hosted
   the build).
2. The server-select button should show **My xRSPS Server**
   (`game.example.com`) with a **secure** icon.
3. Type a username + password. First login → account auto-created.
4. Disconnect. Reconnect with the **wrong** password → "Incorrect username
   or password."
5. Reconnect with the **right** password → back in game with your saved
   state.
6. Check `server/data/accounts.json` (or wherever you pointed
   `ACCOUNTS_FILE_PATH`) — there should be an entry for your username.
   **Only the scrypt hash is stored, never the plaintext.**

---

## Account management

### View accounts

```bash
cat server/data/accounts.json | jq 'keys'
```

### Ban an account

Edit `accounts.json` and add `"banned": true, "banReason": "griefing"` to
the record. Restart the server (the in-memory store only loads at boot).

```bash
# Stop the server first
jq '."username" += {"banned": true, "banReason": "griefing"}' \
    server/data/accounts.json > server/data/accounts.tmp.json \
    && mv server/data/accounts.tmp.json server/data/accounts.json
# Restart the server
```

### Reset a password

There is no in-game password reset flow yet. Manual process: stop the
server, delete the account from `accounts.json`, restart. The user's
**next** login will re-create the account with whatever password they type,
preserving their in-game state (which is keyed by username in
`player-state.json`, not by account record).

### Back up regularly

`accounts.json` and `server/data/gamemodes/<gamemode>/player-state.json` are
your entire database. Put them in nightly backups.

---

## Threat model — what this setup protects against

| Attack                                            | Protection                                    |
|---------------------------------------------------|------------------------------------------------|
| Account takeover via guessed username             | scrypt password verification                   |
| Password database leak                            | scrypt hashing (16384 rounds, random salt)     |
| Brute-force login from one IP                     | 5 attempts / 60s / IP rate limit               |
| Rogue website embedding your server as a WS       | `allowedOrigins` check on WS upgrade          |
| MitM on the WebSocket                             | TLS via Caddy → `wss://`                       |
| Non-browser client scanning the port              | Empty Origin rejected when allowlist active    |

## What this setup does **not** protect against

- **Distributed brute-force** from many IPs. The rate limit is per-IP.
  For serious deployments add fail2ban or Cloudflare Turnstile.
- **Server compromise → accounts DB extraction.** Hashes can be
  offline-cracked if the passwords are weak. Enforce a 12+ char minimum
  for a public server.
- **In-game trust.** Password auth doesn't verify the player isn't a
  malicious actor. Build a moderator system for that.
- **Denial of service.** A flood of connection attempts can saturate your
  server. Put Cloudflare or a cheap L4 proxy in front if this matters.
- **Password recovery.** There is none. A forgotten password means a
  manual account delete-and-recreate.

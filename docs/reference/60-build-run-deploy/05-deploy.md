# 60.5 — Production deploy

The XRSPS deployment model separates the **game server** (stateful, long-lived, holds player state in memory) from the **client** (a static bundle, cacheable, hosted on any static host).

This page walks through a minimal production deploy. Everything here is a recipe — adapt to your infra.

## Architecture

```
browsers  ──HTTPS──►  static host (Vercel / Netlify / Cloudflare Pages / S3 / Caddy)
                            │
                            │ loads wss://game.example.com
                            ▼
                     Caddy (TLS terminator)
                            │  127.0.0.1:43594
                            ▼
                     XRSPS game server
                            │
                            └── writes server/data/accounts.json (or SQLite)
```

The game server and the client are intentionally separate hosts. The client has no "home" origin — it's a static bundle that connects out to whatever WebSocket URL was baked in at build time (`REACT_APP_WS_URL`).

## 1. Provision the game server host

Any Linux host with:

- Public IPv4 (and ideally IPv6).
- A DNS A/AAAA record pointing to it — say `game.example.com`.
- Ports 80 + 443 open (for Caddy's automatic LetsEncrypt cert issuance).
- Port 43594 **not** open externally — it's fronted by Caddy.

Minimum size for a small world is modest: 1 vCPU, 2 GB RAM is plenty for dozens of concurrent players. Memory grows with player count because the cache is held in memory.

## 2. Install the runtime

```sh
curl -fsSL https://bun.sh/install | bash
```

Bun is the recommended runtime; the server's `tsx`/`bun` invocation just needs a working `bun` binary on the PATH.

## 3. Clone and install

```sh
git clone https://github.com/xrsps/xrsps-typescript.git /opt/xrsps
cd /opt/xrsps
bun install
```

## 4. Fetch the cache

```sh
bun run ensure-cache
```

See [60.3](./03-cache.md). The cache is ~1 GB extracted. Keep it on the same disk as the game server.

Then build the collision cache once:

```sh
bun run server:build-collision
```

## 5. Configure the server

Edit `server/src/config/ServerConfig.ts` (or provide a config override — the server supports loading a JSON config via an env var). Key fields:

- **`host`** — bind address. Use `127.0.0.1` so only Caddy can reach it.
- **`port`** — `43594` (default).
- **`tickMs`** — `600` (default OSRS tick).
- **`serverName`** — shown to players.
- **`maxPlayers`** — `2047` (max OSRS player index).
- **`gamemode`** — `"vanilla"` or `"leagues-v"`.
- **`accountsFilePath`** — path to the JSON account store. Default is `server/data/accounts.json`.
- **`minPasswordLength`** — enforced at registration.
- **`allowedOrigins`** — list of Origin headers the WebSocket will accept. Put your client host here (e.g. `["https://xrsps.example.com"]`).

## 6. Run the server under a supervisor

A systemd unit (`/etc/systemd/system/xrsps.service`):

```ini
[Unit]
Description=XRSPS game server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=xrsps
WorkingDirectory=/opt/xrsps
Environment=LOG_LEVEL=info
Environment=BOT_SDK_TOKEN=__replace_with_real_secret__
ExecStart=/home/xrsps/.bun/bin/bun server/src/index.ts
Restart=on-failure
RestartSec=3

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/xrsps/server/data /opt/xrsps/caches

[Install]
WantedBy=multi-user.target
```

Enable:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now xrsps.service
sudo systemctl status xrsps.service
```

## 7. Install Caddy for TLS termination

```sh
# Debian/Ubuntu
sudo apt install -y caddy
```

Or grab the binary from caddyserver.com. XRSPS ships a Caddyfile in `deployment/Caddyfile`:

```
game.example.com {
    reverse_proxy 127.0.0.1:43594 {
        header_up Host {host}
        header_up Origin {http.request.header.Origin}
        header_up X-Forwarded-For {http.request.remote.host}
        header_up X-Forwarded-Proto https
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        -Server
    }
    log {
        output file /var/log/caddy/xrsps-access.log
        format json
    }
}
```

Copy to `/etc/caddy/Caddyfile`, replace `game.example.com` with your domain, then:

```sh
sudo systemctl enable --now caddy
```

Caddy will auto-issue a LetsEncrypt cert on first run. Check `/var/log/caddy/` for access logs.

## 8. Build and host the client

On a build machine (can be the same host, can be CI):

```sh
REACT_APP_WS_URL=wss://game.example.com \
REACT_APP_SERVER_NAME="My Server" \
bun run build
```

The output is a static site in `build/`. Host it anywhere:

- **Vercel / Netlify / Cloudflare Pages** — point at the repo, set the build command to `bun run build`, set the `REACT_APP_*` env vars, publish.
- **S3 / CloudFront** — upload `build/` behind a CloudFront distribution with `index.html` as the default root object.
- **Caddy** — add a second site block serving the static `build/` dir.

## 9. Test

Open the client URL in a browser. The login screen should appear. Try to connect — if Caddy logs show the WebSocket upgrade and the server logs show the login attempt, you're live.

## Operating notes

- **Backups** — `server/data/accounts.json` is the source of truth for player state. Back it up regularly (`cron` + `rclone` to object storage is plenty). If you lose it, all player progress is gone.
- **Updates** — XRSPS does not support rolling upgrades. To push a new build: stop the server (systemd-stop → graceful save), `git pull`, rebuild if needed, start again. Clients auto-reconnect after a short window.
- **Cache version** — make sure the client and server are built from the same git commit. See [40.2](../40-protocol/02-binary-encoding.md) — there is no protocol version byte; pairing is 1-to-1.
- **Scaling beyond one box** — XRSPS is single-process. For more players, scale vertically (more CPU) or run multiple separate worlds.
- **Persistence migration** — swap `JsonAccountStore` for a custom `PersistenceProvider` if you need SQLite or Postgres. See [20.10](../20-server/10-persistence.md).

## Firewall checklist

- **Inbound 80** — open (Caddy LE challenge).
- **Inbound 443** — open (client WebSocket via Caddy).
- **Inbound 22** — open (SSH).
- **Inbound 43594** — closed (Caddy proxies to loopback).
- **Inbound 43595** — closed unless you want to expose the bot-SDK to remote bots.

## Canonical facts

- **Reference Caddyfile**: `deployment/Caddyfile`.
- **Default bind**: `127.0.0.1:43594`.
- **Default bot-SDK port**: `43595`.
- **Client build command**: `bun run build`.
- **Required client env vars**: `REACT_APP_WS_URL`, optionally `REACT_APP_SERVER_NAME`.
- **Account storage default**: `server/data/accounts.json` (JSON file).
- **Rule**: client and server must be built from the same git commit.

# 60.4 — mprocs orchestration

[`mprocs`](https://github.com/pvolok/mprocs) is a multi-pane terminal process manager. XRSPS uses it for dev and build orchestration.

## Why mprocs

The dev loop needs three long-running processes (server, client, bot-agent) in parallel, with individual restart control and separate output panes. mprocs provides that in a single tty without the overhead of tmux scripts.

## `mprocs.yaml` (dev)

```yaml
procs:
  server:
    shell: "bun run server:start"
    autostart: true
    env:
      BOT_SDK_TOKEN: "dev-secret"

  client:
    shell: "BROWSER=none bun run start"
    autostart: true

  agent-dev:
    shell: "bun scripts/agent-dev.ts"
    autostart: true
    env:
      BOT_SDK_TOKEN: "dev-secret"
```

Run with:

```sh
bun run dev
# or:
mprocs
```

### Tabs

- **server** — the game server. Logs tick diagnostics, inbound packets, errors.
- **client** — the React dev server. Logs compile errors, HMR events.
- **agent-dev** — a headless bot connected to the bot-SDK. Random-walks around the spawn to generate traffic so you can see the server working without opening the browser client.

### Key bindings (all prefixed by Ctrl-A)

| Keys | Action |
|---|---|
| Ctrl-A Tab | Cycle procs |
| Ctrl-A ↑ / ↓ | Focus next / prev proc |
| Ctrl-A r | Restart focused proc |
| Ctrl-A s | Stop focused proc |
| Ctrl-A x | Start a stopped proc |
| Ctrl-A q | Quit mprocs (stops all procs) |

Full keymap: https://github.com/pvolok/mprocs#keymap

### Running one proc

If you only want the server:

```sh
mprocs -n server
```

Or the client:

```sh
mprocs -n client
```

### The dev bot agent

`scripts/agent-dev.ts` is a Bun script that connects to the bot-SDK port (`43595`), authenticates with `BOT_SDK_TOKEN`, and issues random walk commands. It retries on `ECONNREFUSED` so it survives a server restart. Handy for:

- Verifying the server is running without opening a browser.
- Generating incidental packet traffic.
- Sanity-checking that bot-SDK integrations (milady's app-scape plugin, for instance) work against your local server.

Remove the `agent-dev` block from `mprocs.yaml` if you don't want it.

## `mprocs.build.yaml` (parallel builds)

```yaml
procs:
  client-build:
    shell: "bun run build"
    autostart: true

  server-build:
    shell: "bun run server:build"
    autostart: true
```

Run with:

```sh
bun run build:all
```

Both procs exit when done. mprocs shows their exit codes in the tab titles. Review the output, then `Ctrl-A q` to quit.

Use this when you want a clean production-ish build of both the client and server for CI or a release.

## Tips

- **Auto-restart** — add `autorestart: true` under a proc to have mprocs relaunch it on crash. Only useful for server (the client dev server rarely dies).
- **Log files** — mprocs writes nothing to disk by default. If you want persistent logs, pipe through `tee`: `shell: "bun run server:start 2>&1 | tee mprocs.log"`. The repo already has `mprocs.log` in `.gitignore`.
- **Scrolling** — each pane has its own scrollback. Ctrl-A then arrow keys for pane scroll; see the mprocs keymap for buffer navigation.
- **Restart the server without losing the client** — Ctrl-A Tab to server, Ctrl-A r. The client stays up.

## Canonical facts

- **Dev config**: `mprocs.yaml`.
- **Build config**: `mprocs.build.yaml`.
- **Installed via**: `bun install` (transitive dep).
- **Default key prefix**: `Ctrl-A`.
- **Agent dev script**: `scripts/agent-dev.ts`.
- **Bot-SDK port**: `43595`.
- **Rule**: `bun run dev` is the default entrypoint; individual procs run with `mprocs -n <name>`.

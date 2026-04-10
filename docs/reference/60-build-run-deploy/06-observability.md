# 60.6 — Observability

How to see what's happening inside a running XRSPS instance.

## Server logs

The server uses a single logger (`server/src/utils/logger.ts`) that prints tagged messages to stdout. Tags look like `[tick]`, `[network]`, `[script]`, `[persistence]`, `[combat]`, etc. Output is plain text by default.

### Log levels

Set via env var:

```sh
LOG_LEVEL=debug bun run server:start   # very verbose
LOG_LEVEL=info                          # default
LOG_LEVEL=warn                          # quiet
LOG_LEVEL=error                         # only errors
```

### Useful tags

- `[tick]` — per-tick timing warnings when a tick takes > `driftWarnMs`.
- `[network]` — connect, disconnect, malformed packet warnings.
- `[persistence]` — account load/save events.
- `[script]` — handler registration warnings ("overwriting handler"), runtime script errors.
- `[extrascripts]` — load and reload events.
- `[combat]` — combat engagement start/stop and hit events (at debug level).

### Per-tick profiling

Set `TICK_PROFILE=1` to log the duration of each tick phase every N ticks. The output looks like:

```
[tick-profile] tick=12345 total=4.2ms broadcast=0.3 pre_movement=0.4 movement=1.1 ...
```

Use this when you suspect a phase is spiking (e.g. a script handler accidentally does O(n²) work).

### Sync packet dumps

Set `SYNC_DUMP=1` to print the raw bytes of every `PLAYER_SYNC` and `NPC_INFO` packet for a single tick, then disable. This is the nuclear option for debugging sync packet decoder errors. See [40.5](../40-protocol/05-sync-bitstreams.md).

## Client dev overlay

The client has a built-in dev overlay behind a keybind (default: the backtick key `` ` ``). It toggles a panel showing:

- **Frame timing** — per-frame milliseconds for the scene build, render, UI pass, and JS total.
- **Worker pool** — per-`RenderDataWorker` job throughput and queue depth.
- **Network** — latency from the last `PING`/`PONG` round-trip, connection state, last 10 packet opcodes with byte counts.
- **Sync state** — current player list, current NPC list, last sync packet size.
- **Cache stats** — IndexedDB hit/miss rates, loader wait times.
- **Render stats** — number of draw calls, number of visible regions, texture memory used.

The overlay components live under `src/ui/debug/` and are gated behind a dev flag.

### Dev-only controls

A `leva` control panel (library already bundled) exposes tweakable rendering knobs: fog distance, ambient intensity, camera speed, texture filter mode. See `src/ui/debug/LevaPanel.tsx` or equivalent.

## PerfSnapshot uploads

The client can capture a performance snapshot (the shape is defined in `src/shared/debug/PerfSnapshot.ts`) and upload it to the server via `CLIENT_DEBUG`. The server stashes it for operator review. Trigger from the dev overlay.

Use this to debug player reports of "it was slow at this time" without needing to be present.

## Server-side metrics

XRSPS doesn't ship a metrics exporter (no Prometheus endpoint out of the box). Rolling your own is straightforward:

1. Add a tick callback that samples per-phase timings and writes them to an in-memory ring buffer.
2. Expose an HTTP endpoint via `Bun.serve` on a separate port that returns the buffer as Prometheus exposition format.
3. Scrape it from your metrics stack.

An example skeleton lives in `server/src/debug/` (if enabled in the build).

## Crash diagnostics

On a server crash, systemd will log the stdout of the final seconds before the crash:

```sh
sudo journalctl -u xrsps.service -n 200
```

If the crash was a decoder error, the log line includes the opcode and raw bytes — enough to write a regression test.

## Log file rotation

If you're piping the server's stdout to a file, set up logrotate:

```
/var/log/xrsps.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
```

Caddy's access logs rotate automatically under systemd on most distros.

## Bot-SDK for automated observation

The bot-SDK (default port `43595`) accepts connections from headless clients authenticated with `BOT_SDK_TOKEN`. You can use this for:

- **Smoke tests** — a bot that logs in on every deploy and confirms the world loaded.
- **Synthetic monitoring** — a bot that runs a fixed script and reports timing.
- **Load tests** — dozens of bots that flood the server with traffic.

The dev bot at `scripts/agent-dev.ts` is a minimal example.

## Canonical facts

- **Server logger**: `server/src/utils/logger.ts`.
- **Log level env var**: `LOG_LEVEL`.
- **Tick profile env var**: `TICK_PROFILE=1`.
- **Sync dump env var**: `SYNC_DUMP=1`.
- **PerfSnapshot shape**: `src/shared/debug/PerfSnapshot.ts`.
- **Dev overlay toggle**: backtick key (configurable).
- **Bot-SDK port**: `43595`.
- **Bot token env var**: `BOT_SDK_TOKEN`.
- **Rule**: there's no built-in metrics endpoint; roll your own via `Bun.serve` on a side port.

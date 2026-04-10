# 20.2 — Tick system

The server uses a single fixed-rate tick (600 ms) to drive every simulation update. Everything — movement, combat, NPC AI, projectiles, chat, XP, networking — is organized around this cadence. This page is the _only_ thing you should ever need to read to understand how a tick works.

## `GameTicker` (`server/src/game/ticker.ts`)

A thin wrapper around `setTimeout` that fires a `tick` event at a fixed cadence and catches up if the loop falls behind.

Key fields:

- `tickMs: number` — tick duration (from config, default `600`).
- `maxCatchUpTicks: number` — if the loop falls behind by more than this many ticks, skip ahead instead of trying to catch up (default `5`).
- `driftWarnMs: number` — log a warning if a tick's wall-clock duration exceeds this (default `tickMs * 1.5`).
- `clock: () => number` — injectable time source for tests.

### `start()` and `scheduleNext()`

```ts
start() {
  this.lastScheduledAt = this.clock();
  this.scheduleNext();
}

scheduleNext() {
  const nextTarget = this.lastScheduledAt + this.tickMs;
  const delay = Math.max(0, nextTarget - this.clock());
  this.timer = setTimeout(() => this.tickLoop(), delay);
}
```

The ticker schedules itself against an absolute "next tick time", not relative to now. This means we don't accumulate drift — if a tick runs long, the next one fires sooner to compensate.

### Catch-up loop

Inside `tickLoop()`, we check if wall clock is already past the next tick boundary. If so, we dispatch another tick immediately — up to `maxCatchUpTicks` times. If we still haven't caught up after that, we skip ahead and log a warning. This is an anti-death-spiral mechanism: if the server is fundamentally slower than realtime, we don't want every tick to take longer than the last as we fall further behind.

### `dispatchTick(time)`

Emits the `tick` event to every listener, awaiting each one in turn. Listener exceptions are caught and logged so one misbehaving subsystem doesn't kill the loop.

The `WSServer` registers exactly one listener: a `TickPhaseOrchestrator.processTick` call.

## `TickPhaseOrchestrator` (`server/src/game/tick/TickPhaseOrchestrator.ts`)

This is where the actual tick work happens. It builds a list of phases and runs them in sequence for every tick.

### The phase list

```
1.  broadcast         — outbound packets from last tick's state  (yields after)
2.  pre_movement      — inbound packet processing, queued actions (yields after)
3.  movement          — player and NPC movement integration
4.  music             — music state updates
5.  scripts           — script/action dispatch
6.  combat            — combat state machine updates
7.  death             — handle deaths that occurred during combat
8.  post_scripts      — scripts that should run after combat resolves
9.  post_effects      — delayed/deferred visual effects
10. orphaned_players  — players disconnected mid-combat
11. broadcast_phase   — final prep for next tick's outbound
```

Each phase is a function on `TickPhaseService` (`server/src/game/services/TickPhaseService.ts`). The orchestrator calls them and times them.

### Why this order?

- **broadcast first.** The server sends players the _previous_ tick's state. This lets us process inbound packets with a consistent snapshot in hand: at the top of tick N, every player's reality is frozen as of the end of tick N-1.
- **pre_movement.** Inbound packets are handled here, queueing actions (walk requests, clicks, interactions, inventory actions) for later phases to consume.
- **movement.** Players and NPCs take one step. Any new tile reached here is visible to script/combat logic this same tick.
- **music → scripts → combat.** Scripts and combat logic run on post-movement positions. This matters for walking-into-range logic: a player who walked into attack range this tick should be able to attack this tick.
- **death.** Combat in step 6 may have killed someone. Deaths are processed now so their drops are in the world before the broadcast phase.
- **post_scripts, post_effects.** Catch-all for things that need to happen after the main loop: delayed teleports, timed effects, spell damage that was queued during combat.
- **orphaned_players.** If a player disconnected mid-combat, their entity stays in the world for a grace period. This phase advances that grace timer and removes them when it expires.
- **broadcast_phase.** Prepares outbound packet buffers for _next_ tick's broadcast step. Doesn't actually send; send happens in step 1 of the next tick.

### Phase yields

Phases marked `yieldAfter: true` (currently `broadcast` and `pre_movement`) yield to the event loop after running. This gives Node's I/O a chance to drain — incoming WebSocket frames get queued, outgoing frames actually flush. Without these yields, a long tick could hold the event loop for its entire duration and delay network I/O.

### Error handling

Each phase is wrapped in a try/catch inside `runTickStage`. If a phase throws:

1. The orchestrator calls `tickFrameService.restorePendingFrame(frame)` to roll back any half-applied frame state.
2. Logs the error with the phase name and tick number.
3. Returns `false`, aborting the rest of the tick.

The next tick will still fire. This is deliberate: one bad tick shouldn't take down the world. You'll see the stack trace in the logs and can fix it forward.

### Timing and profiling

At the end of a tick, if `elapsed > tickMs`, the orchestrator logs:

```
[tick] tick 12345 exceeded budget: 742.3ms > 600ms
[tick] breakdown tick=12345 total=742.3ms broadcast=210.1ms combat=180.4ms movement=105.2ms …
```

Set `TICK_PROFILE=1` in the environment to always log the top-5 slowest phases, not just when a tick overruns. Useful during optimization.

## `TickPhaseService` and `TickFrameService`

These are the services that own the actual per-phase implementations:

- **`TickPhaseService`** (`server/src/game/services/TickPhaseService.ts`) — holds the `runMovementPhase`, `runCombatPhase`, etc. methods. They're on the service rather than in the orchestrator because multiple things need to poke at them: tests, debug tools, and the orchestrator.
- **`TickFrameService`** (`server/src/game/services/TickFrameService.ts`) — creates and holds the `TickFrame` object, which is the per-tick scratchpad: list of dirty players, pending packets, pending broadcasts, etc.

### What's a `TickFrame`?

A mutable struct that lives for exactly one tick and collects everything that happened during that tick before broadcast. Think of it as the transaction for a single tick. It's defined in `server/src/network/wsServerTypes.ts` and includes:

- `tick: number`, `time: number`
- `dirtyPlayers: Set<PlayerId>`
- `pendingBroadcasts: Map<PlayerId, PacketBuffer>`
- ...and various other per-tick buffers.

`svc.activeFrame` is set at the top of `processTick` and cleared in the `finally`. During the tick, any service can access it via `ServerServices.activeFrame` and push state into it without needing to know who will consume it.

## Tick budget

With `tickMs = 600`:

- A typical tick processes in 20–80 ms for a moderate player count.
- Above 300 ms, log warnings kick in.
- Above 600 ms (full budget), the warning becomes "exceeded budget".
- Above 3000 ms (5 ticks), the ticker skips ahead and drops ticks.

If you routinely see "exceeded budget" warnings, profile with `TICK_PROFILE=1` and look at the breakdown line — the top phase is your bottleneck.

## Listener model

The ticker uses Node's `EventEmitter`. In principle, multiple listeners can subscribe. In practice only the `WSServer` does. This is intentional: we want every tick action to be centrally ordered through the phase list, not split across ad-hoc listeners.

---

## Canonical facts

- **Ticker**: `server/src/game/ticker.ts` → `class GameTicker extends EventEmitter`.
- **Orchestrator**: `server/src/game/tick/TickPhaseOrchestrator.ts` → `class TickPhaseOrchestrator`.
- **Phase service**: `server/src/game/services/TickPhaseService.ts`.
- **Frame service**: `server/src/game/services/TickFrameService.ts`.
- **TickFrame type**: `server/src/network/wsServerTypes.ts`.
- **Default tick**: `tickMs = 600` from `server/config.json`.
- **Catch-up cap**: `maxCatchUpTicks = 5`.
- **Profile env var**: `TICK_PROFILE=1`.
- **Phase order**: `broadcast → pre_movement → movement → music → scripts → combat → death → post_scripts → post_effects → orphaned_players → broadcast_phase`.
- **Rule**: no mutation happens outside a tick phase.
- **Rule**: no packet is sent outside the broadcast phase.

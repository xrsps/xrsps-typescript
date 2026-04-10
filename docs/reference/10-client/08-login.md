# 10.8 — Login (`src/client/login/`)

The login flow is the part of the client that runs before a player has entered the world. It renders its own background scene, plays its own music, shows a form, and drives a handful of network exchanges to authenticate. Once complete, it hands control over to the main `GameContainer` HUD.

## `GameState` (`src/client/login/GameState.ts`)

An enum tracking the top-level client state:

```
GameState.LOGIN       // login screen, accepting input
GameState.LOADING     // submitted, waiting for server
GameState.IN_GAME     // world is rendering
GameState.LOGIN_FAILED
GameState.LOGOUT
```

It's a simple enum rather than a full state machine. The transitions are driven imperatively from `LoginNetworkState` and `OsrsClient`.

## `LoginState` (`src/client/login/LoginState.ts`)

The client-side reactive state for the login screen:

- `username` / `password` text buffers,
- current focused field,
- error message text,
- "loading…" spinner state,
- progress fraction for the loading bar.

React components subscribe to `LoginState` and re-render on change. This is how the login UI stays in sync with the engine without the engine needing to know about React.

## `LoginNetworkState` (`src/client/login/LoginNetworkState.ts`)

Implements the login handshake:

1. `ServerConnection` is connected to the WebSocket (this may have happened already if the client is reconnecting).
2. Client sends a `LOGIN` packet with username, password, and client version info.
3. Server validates, creates or loads the account, and responds with either a `LOGIN_OK` with the player's initial state or a `LOGIN_FAILED` with a reason code.
4. On success, the client transitions `GameState` to `LOADING` while the initial world packets (map squares, inventory, etc.) stream in.
5. When the first sync packet arrives (the server has officially added the player to the world), state transitions to `IN_GAME`.

Errors are mapped to human-readable messages through the failure-reason enum defined in `src/shared/packets/` and displayed via `LoginState.error`.

## `LoginRenderer` (`src/client/login/LoginRenderer.ts`)

Draws the login background scene. Unlike the in-game renderer, this one draws a static 3D scene with the OSRS logo spinning over it, plus the login form widgets on top. It reuses the same `WebGLOsrsRenderer` context so we don't churn GL resources, but it's a separate render path with its own update hook.

### `LoginScreenAnimation`

Animates the background scene: the characters walking past, the banner waving, etc. Purely cosmetic; uses the same seq/skeletal animation path as the in-game renderer.

### `LoadingBarRenderer` (`src/client/login/LoadingBarRenderer.ts`)

Renders the "loading X%" bar that appears during `GameState.LOADING`. The percentage is driven by `LoginNetworkState` (which counts incoming initial-state packets).

## `LoginAction` (`src/client/login/LoginAction.ts`)

The set of user actions that can fire from the login form:

- Submit,
- Switch focus (tab / click another field),
- Cancel,
- Toggle remember-me,
- Open account creation,
- Open account recovery (not implemented — placeholder).

Each action is dispatched by `UiInput` or the React form component to the `LoginNetworkState`.

## `LoginMusicTransition` (`src/client/login/LoginMusicTransition.ts`)

Handles the musical handoff when you log in. The login theme fades out as the first in-world track fades in. This is important because the two may share instruments and an abrupt cut sounds wrong.

## `index.ts`

Barrel re-exports. Import `from '@/client/login'` and you get the main symbols.

## How it plugs into the rest of the client

- `OsrsClientApp` mounts `GameContainer`, which mounts `<LoginOverlay>` while `GameState === LOGIN`.
- `LoginOverlay` is a React component in `src/client/` or `src/ui/` that wraps the login form UI around the canvas.
- The canvas itself is shared with the in-game renderer.
- `LoginNetworkState` holds a reference to the same `ServerConnection` that the in-game code will later use, so there's no reconnect at the login → in-game transition.

## What survives a logout?

- `OsrsClient` itself (it's reused).
- `CacheSystem` and all loaders.
- The worker pool.
- Audio context.

What doesn't:

- Per-player state (position, inventory, widgets).
- The WebSocket session (a new handshake is required on reconnect).
- Login-rendered scene state (re-initialized each login).

---

## Canonical facts

- **Game state enum**: `src/client/login/GameState.ts`.
- **Login reactive state**: `src/client/login/LoginState.ts`.
- **Login network state**: `src/client/login/LoginNetworkState.ts`.
- **Login renderer**: `src/client/login/LoginRenderer.ts`.
- **Login screen animation**: `src/client/login/LoginScreenAnimation.ts`.
- **Loading bar renderer**: `src/client/login/LoadingBarRenderer.ts`.
- **Login actions**: `src/client/login/LoginAction.ts`.
- **Login music transition**: `src/client/login/LoginMusicTransition.ts`.
- **Barrel**: `src/client/login/index.ts`.
- **Login packet**: `LOGIN` (client → server) and `LOGIN_OK` / `LOGIN_FAILED` (server → client). See `src/shared/packets/`.

# 10.5 — Input, camera, interaction

Input flows from the browser's DOM events through `InputManager`, gets interpreted by the `Camera` (for viewpoint changes) and `SceneRaycaster` (for world picking), is routed through `MenuEngine` if a right-click menu is needed, and finally turns into a packet sent through `ServerConnection`. The boring version of this page is "DOM events in, packets out". The interesting part is the three or four places where client-side prediction gets involved.

## `InputManager` (`src/client/InputManager.ts`)

Owns the keyboard, mouse, and gamepad state. Registers listeners on the canvas element when the game container mounts, tears them down on dispose.

Key responsibilities:

- **Keycode normalization.** Maps DOM `KeyCode` values to the OSRS internal keycode space via an internal `OSRS_KEY_MAP` array. OSRS used its own numbering — 80 for Tab, 81 for Shift, 96–99 for arrows — and the chat/widget/input systems expect those numbers. If you need OSRS codes, use the normalized output, not `e.keyCode`.
- **Mouse position conversion.** The canvas's backing-store size can differ from its CSS size (DPR, UI scale), and on iOS Safari the whole canvas may be CSS-rotated in portrait. `getMousePos(container, event)` does the math to give you a pixel position in canvas-space, clamped to canvas bounds.
- **Click callbacks.** Subsystems register interest in clicks (`onLeftClick`, `onRightClick`, `onMove`) and the manager dispatches in registration order.
- **Gamepad support.** Reads `navigator.getGamepads()` each frame and emits normalized axis/button events. Deadzone handled by `getAxisDeadzone`.
- **Click modes.** A constant `ClickMode` object tracks whether the current click is a world pick, a UI click, a menu click, etc.

Some gotchas:

- **Do not attach your own DOM listeners.** If you need keyboard/mouse events, go through `InputManager`. The manager handles focus, iOS rotation, and zero-click-through to the HUD; duplicating that logic will lead to pain.
- **Text input goes through `src/ui/gl/ui-input.ts`.** When a text field is focused, keyboard events are re-routed there and other consumers should be suspended.
- **Touch.** Touch events are normalized to mouse events by `InputManager`. Multi-touch is not fully supported; this is an outstanding issue on mobile.

## `Camera` (`src/client/Camera.ts`)

The camera holds view and projection state and smoothly interpolates toward a target view. The interpolation is spring-physics–based, with configurable max speeds per axis (position and rotation tuned independently).

Fields you care about:

- `pos: vec3` — world-space position in tile-scale units.
- `pitch: number`, `yaw: number` — in OSRS 2048-unit rotation space.
- `projectionType: ProjectionType` — `PERSPECTIVE` or `ORTHO`.
- `orthoZoom: number` — for ortho mode.

Methods:

- `update(dt: number)` — advance the interpolation by `dt` seconds. Called from the renderer each frame.
- `lookAt(x, y, z)` — set a target look-at point.
- `setTarget(cameraView: CameraView)` — set a full target pose.
- `getViewProj(out?: mat4): mat4` — return the view-projection matrix used by the renderer.

The client defaults to `PERSPECTIVE` with an OSRS-matching FOV calculation (`FOV_SCRIPT_BASE = 7`, `FOV_SCRIPT_SCALE = 256`). `ORTHO` is there for isometric/editor-style views and is what the tile overlay debug tools use.

### Frustum

`Frustum` (`src/client/Frustum.ts`) holds the 6 frustum planes computed from a view-projection matrix. The renderer asks it `isPointVisible()` and `isAABBVisible()` for culling. Rebuild the frustum whenever the camera moves.

## `SceneRaycaster` (`src/client/scene/SceneRaycaster.ts`)

Picks against the 3D scene. Given a mouse position, it:

1. Constructs a ray from the camera through the mouse coordinate.
2. Resolves the ray against the terrain planes produced by `PlaneResolver` (`src/client/scene/PlaneResolver.ts`), which converts the scene geometry into ray-testable planes.
3. Also tests against loc bounding volumes and NPC bounding cylinders.
4. Returns the closest hit: `{ type: 'tile' | 'loc' | 'npc' | 'player', id, position }`.

The result feeds the menu engine, which builds candidate menu entries from it, and also drives hover highlighting.

## `PlayerInteractionSystem` (`src/client/interactions/PlayerInteractionSystem.ts`)

Keeps track of the current hover target, the current walk-to target, and dispatches the correct packet when the player left-clicks. This is where "click to walk" vs "click to attack" vs "click to interact" is decided on the client before a packet is sent; the server will re-validate.

## Menus

`MenuEngine` and `MenuBridge` live under `src/ui/menu/` and are documented in [10.4 — UI and widgets](./04-ui-widgets.md). The link between input and menus is this: `InputManager` captures the right-click, `SceneRaycaster` resolves what's under the cursor, `PlayerInteractionSystem` and the current widget hit combine to produce a list of candidate actions, and `MenuEngine` presents them.

## `DestinationMarker` (`src/client/DestinationMarker.ts`)

A small module that tracks the player's current walk destination (the OSRS click-flag marker). Renders a flag at the destination tile projected to screen space and clears it when the player arrives.

## `MouseCross` and `ClientState`

- **`MouseCross`** (`src/client/MouseCross.ts`) — renders the OSRS cursor cross (red for "can interact here", yellow for "walking"). `getMouseCrossColor()` picks the state.
- **`ClientState`** (`src/client/ClientState.ts`) — a tiny global store for runtime state that doesn't fit anywhere else: currently tracked entities, mouse state snapshots. Used mostly by the input and overlay systems.

## iOS landscape mode hook

iOS Safari in portrait forces a 90° rotation of the canvas. `useSafariLandscapeLock` (`src/client/useSafariLandscapeLock.ts`) is a React hook that watches `orientationchange` and `resize` and keeps the canvas dimensions correct. `InputManager`'s mouse math compensates by inverting the rotation for event coordinates. If you add new input surfaces, make sure they use the same path.

---

## Canonical facts

- **Input manager**: `src/client/InputManager.ts`.
- **OSRS keycode map**: `InputManager.ts` → `OSRS_KEY_MAP` array.
- **Mouse pos helper**: `InputManager.ts` → `getMousePos(container, event)`.
- **Camera**: `src/client/Camera.ts` → `class Camera`.
- **Frustum**: `src/client/Frustum.ts` → `class Frustum`.
- **Scene raycaster**: `src/client/scene/SceneRaycaster.ts`.
- **Plane resolver**: `src/client/scene/PlaneResolver.ts`.
- **Player interaction system**: `src/client/interactions/PlayerInteractionSystem.ts`.
- **Destination marker**: `src/client/DestinationMarker.ts`.
- **Mouse cross overlay**: `src/client/MouseCross.ts`.
- **Client state store**: `src/client/ClientState.ts`.
- **iOS landscape hook**: `src/client/useSafariLandscapeLock.ts`.
- **FOV constants**: `FOV_SCRIPT_BASE=7`, `FOV_SCRIPT_SCALE=256` (in `Camera.ts`).
- **Default camera rotation space**: 0..2047 (OSRS).

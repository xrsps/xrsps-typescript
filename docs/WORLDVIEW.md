# WorldView System

Complete reference of the OSRS WorldView system as reverse-engineered from the r235 deobfuscated client (`references/runescape-client`).

> **Note:** As of r237+, XTEA keys are no longer required for map region decryption. The `xteaKeys` field on WorldView still exists in the class structure but is unused in modern revisions.

---

## Overview

The WorldView system allows the client to manage multiple independent "views" of the game world simultaneously. Each WorldView is a self-contained unit with its own scene, collision data, tile heights, NPCs, players, ground items, world entities, and ambient sounds. This is the mechanism behind instanced content like Sailing, where a ship is a nested WorldView that moves within the top-level world.

There are two categories of WorldView:

- **Top-Level WorldView** (id = `-1`): The main game world. Always exists. Stored at `Occluder.topLevelWorldView`. Created via `WorldViewManager.createPrimaryWorldView()`. Uses `TileRenderMode.camera`. Has larger entity pools (512 players, 128 NPCs, 32 world entities).
- **Nested WorldView** (id >= `0`): Child views owned by a `WorldEntity` in the top-level view. Created via `WorldViewManager.createWorldView()`. Uses `TileRenderMode.target`. Has smaller entity pools (8 players, 8 NPCs, 1 world entity).

---

## Core Classes

### WorldView

**File:** `WorldView.java`
**Extends:** `RSNode`

The fundamental unit of world state. Each instance contains everything needed to represent a region of the game world.

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `int` | `-1` for top-level, otherwise a unique world entity ID |
| `sizeX` | `int` | Width in tiles |
| `sizeY` | `int` | Height in tiles |
| `baseX` | `int` | World X origin (absolute tile coordinate) |
| `baseY` | `int` | World Y origin (absolute tile coordinate) |
| `plane` | `int` | Current active plane (0-3) |
| `savedPlane` | `int` | Saved plane for restoration |
| `scene` | `Scene` | The 3D scene graph for this view |
| `collisionMaps` | `CollisionData[4]` | Collision flags per plane |
| `tileHeights` | `int[4][sizeX+1][sizeY+1]` | Terrain height map |
| `tileSettings` | `byte[4][sizeX][sizeY]` | Tile render/overlay flags |
| `tileDrawCycleMarkers` | `int[sizeX][sizeY]` | Tracks which cycle a tile was last drawn |
| `players` | `IndexedObjectSet` | Players visible in this view |
| `npcs` | `IndexedObjectSet` | NPCs in this view |
| `worldEntities` | `IterableNodeHashTable` | Child WorldEntities (and their nested WorldViews) |
| `groundItems` | `Deque2[4][sizeX][sizeY]` | Active ground items per plane/tile |
| `previousGroundItems` | `Deque2[4][sizeX][sizeY]` | Previous tick ground items (for diff) |
| `graphicsObjects` | `Deque2` | Active spot animations / graphics objects |
| `pendingSpawns` | `Deque2` | Object spawns pending application |
| `ambientSoundEffects` | `Deque2` | Active ambient sound emitters |
| `activeNpcIndices` | `IntList` | Currently active NPC indices (capacity 149) |
| `activeWorldEntityIds` | `IntList` | Currently active world entity IDs (capacity 25) |
| `runeLiteObjectControllers` | `Deque2` | RuneLite custom object controllers |
| `xteaKeys` | `int[][]` | XTEA decryption keys for loaded regions (unused r237+) |
| `mapRegions` | `int[]` | Region IDs currently loaded |
| `instance` | `boolean` | Whether this is an instanced region |
| `instanceTemplateChunks` | `int[][][]` | Instance template chunk mapping (for instanced regions) |

#### Constructor

```java
WorldView(int id, int sizeX, int sizeY, int drawDistance, TileRenderMode renderMode)
```

- Allocates all arrays based on `sizeX`/`sizeY`
- Player pool: 512 if top-level, 8 if nested
- NPC pool: 128 if top-level, 8 if nested
- World entity pool: 32 if top-level, 1 if nested
- Creates collision maps for all 4 planes with `isWorldEntity = (id != -1)`
- Creates the `Scene` and calls `linkScene()`

#### Key Methods

**`linkScene()`** — Wires the scene back to this WorldView:
```java
this.scene.worldView = this;
this.scene.extendedTileSettings = this.tileSettings;
```

**`isTopLevel()`** — Returns `true` if `id == -1`.

**`contains(LocalPoint)`** — Checks if a local point falls within this view's tile bounds (verifies worldView ID matches first).

**`contains(WorldPoint)`** — Checks if an absolute world coordinate falls within `[baseX, baseX+sizeX) x [baseY, baseY+sizeY)`.

**`savePlane()` / `plane`** — `savePlane()` stores current plane to `savedPlane`. Used before the server changes the active plane so the previous value is preserved.

**`resetActors()`** — Clears all players, resets NPC interaction state.

**`clearWorldViewState(worldView, guard)`** — Full reset: clears active NPC/entity lists, all players, NPCs, world entities, graphics objects, pending spawns, all ground items on every plane/tile, then clears the scene and collision maps.

**`getWorldView(id)`** — Static lookup: returns `topLevelWorldView` if id is `-1`, otherwise queries `WorldViewManager`.

**`postItemSpawnEvents()`** — Iterates ground items on the current plane and fires `ItemSpawned` events for each.

**`findPendingSpawnByTag(tag)`** — Searches pending spawns by packed scene tag (extracts x, y, plane, id from the 64-bit tag).

**`updateObjectAmbientSound(plane, x, y, objectComposition, orientation)`** — Finds and removes an existing ambient sound effect that matches the given parameters (used when an object is removed or changed).

**`addObjectAmbientSound(plane, x, y, objectComposition, orientation)`** — Creates a new `AmbientSoundEffect` and adds it to the linked list, then posts the `AmbientSoundEffectCreated` event.

**`clearAmbientSoundEffects()`** — Iterates all ambient sound effects and calls `ab()` (stop/release) on each.

**`worldViews()`** — Returns a `WorldEntityWorldViewSet` adapter that maps this view's child world entities to their nested WorldViews.

**`getYellowClickAction()`** — Returns the `WorldViewType` ordinal for this view (determines click behavior).

**`getSelectedSceneTile()`** — Returns the tile under the mouse cursor, accounting for menu-open state and scene padding.

**`getCanvasProjection()` / `getMainWorldProjection()`** — Returns the projection matrix for rendering, or `null` if identity.

---

### WorldViewManager

**File:** `WorldViewManager.java`
**Implements:** `Iterable`

Singleton manager that owns all WorldView instances and their lifecycle.

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `primaryWorldView` | `WorldView` | The top-level WorldView (id = -1) |
| `worldViews` | `IterableNodeHashTable(16)` | All WorldViews keyed by ID |
| `worldViewCount` | `int` | Total number of active WorldViews |
| `worldViewTypeById` | `HashMap<Integer, WorldViewType>` | Per-view click behavior overrides |
| `worldEntityActionFlagsById` | `HashMap<Integer, WorldEntityActionFlags>` | Per-view action flag overrides |
| `defaultWorldViewType` | `WorldViewType` | Default click behavior (initially `walk`) |
| `defaultWorldEntityActionFlags` | `WorldEntityActionFlags` | Default action flags (initially `at`) |

#### Lifecycle Methods

**`createPrimaryWorldView(sizeX, sizeY, drawDistance)`**
- Creates the top-level WorldView with `id = -1` and `TileRenderMode.camera`
- Stores as `primaryWorldView`
- Called once during client initialization

**`createWorldView(id, sizeX, sizeY, drawDistance, renderMode)`**
- Creates a new WorldView, inserts into the hash table keyed by `id`
- Increments `worldViewCount`
- For nested views, called from `WorldEntityUpdateParser` with `TileRenderMode.target`

**`removeWorldView(id)`**
- Posts NPC despawn events for all NPCs in the view
- Calls `removeWorldViewInternal()` for cleanup
- Posts `WorldEntityDespawned` event

**`removeWorldViewInternal(manager, worldView)`** (static)
- Posts `WorldViewUnloaded` event
- Notifies draw callbacks (`despawnWorldView`)
- Removes type/action flag overrides
- Clears ambient sound effects
- Unlinks the WorldView node from the hash table
- Decrements count

**`clear()`**
- Removes all WorldViews
- Clears hash table, resets count
- Resets defaults to `WorldViewType.walk` and `WorldEntityActionFlags.at`
- If `primaryWorldView` exists, clears its state and re-inserts it

#### Lookup Methods

**`getWorldView(id)` / `getWorldViewAlias(id)`** — Hash table lookup by ID.

**`getPrimaryWorldView()`** — Returns the top-level WorldView.

**`getCurrentWorldView()`** — Returns the WorldView matching `client.currentWorldViewId`. This is the view the local player is currently "inside" (could be a ship, etc).

**`findWorldViewAt(x, y)`** — Iterates all non-top-level WorldViews and returns the one whose bounds contain `(x, y)`. Falls back to `primaryWorldView` if none match.

**`getCurrentWorldEntity()`** — Looks up the WorldEntity in the primary view that matches `currentWorldViewId`.

**`getCurrentPlayerInternal()`** — Gets the local player from the current WorldView.

**`getCurrentPlayerTopLevelPosition()`** — Gets the local player's position transformed to top-level world coordinates.

#### Property Methods

**`setWorldViewProperties(worldViewId, worldViewType, actionFlags)`** — Stores per-view type and action flag overrides.

**`setDefaultWorldViewProperties(worldViewType, actionFlags)`** — Sets the fallback defaults.

**`getWorldViewType(id)`** — Returns the override for the given ID, or the default.

**`getWorldEntityActionFlags(id)`** — Returns the override for the given ID, or the default.

**`clearWorldViewOverride(manager, worldViewId)`** — Removes both the type and action flag overrides for a specific view.

---

### WorldViewType

**File:** `WorldViewType.java`
**Enum implementing:** `EnumOrdinal`

Determines what happens when the player clicks within a WorldView.

| Value | ID | Description |
|-------|----|-------------|
| `none` | 0 | No click action |
| `walk` | 1 | Yellow click / walk-here (default) |
| `setHeading` | 2 | Set heading (used for sailing, rotates the entity rather than walking) |

Returned by `WorldView.getYellowClickAction()` and used by the client menu/input system to determine click behavior.

---

### WorldEntityWorldViewSet

**File:** `WorldEntityWorldViewSet.java`
**Implements:** `IndexedObjectSet`

An adapter that wraps a WorldView's `worldEntities` hash table and presents the nested WorldViews (not the WorldEntities themselves). Used by `WorldView.worldViews()` to iterate child views.

- `byIndex(index)` — Gets the WorldEntity at the given index, returns its `.worldView`
- `iterator()` — Transforms each WorldEntity to its WorldView via `Iterators.transform`

---

## CameraFocusableEntity Interface

**File:** `CameraFocusableEntity.java`

Interface implemented by anything the camera can focus on (WorldEntity, Player, NPC). WorldEntity implements this to allow the camera system to track ships and other movable world entities.

```java
public interface CameraFocusableEntity {
   int getPlane();
   int getCameraFocusX();       // Fine X in parent world
   int getCameraFocusZ();       // Fine Z in parent world
   int getCameraFocusXAlias();  // Alias for getCameraFocusX
   float getCameraFocusXFloat();
   int getCameraFocusZAlias();  // Alias for getCameraFocusZ
   float getCameraFocusZFloat();
   int getCameraFocusPlaneAlias(); // Alias for getPlane
}
```

For WorldEntity, `getCameraFocusX()` and `getCameraFocusZ()` return `position.x` and `position.z` respectively — the entity's fine-coordinate position in the parent world.

---

## WorldEntity System

### WorldEntity

**File:** `WorldEntity.java`
**Extends:** `RSNode`
**Implements:** `CameraFocusableEntity`

Represents a movable entity in the game world that owns a nested WorldView. This is the container for things like ships — the WorldEntity holds the position/orientation in the parent world, while its `worldView` field holds the self-contained scene (deck, NPCs, objects, etc).

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `worldViewId` | `int` | The ID of the nested WorldView this entity owns |
| `worldView` | `WorldView` | Reference to the nested WorldView |
| `ownerWorldViewId` | `int` | ID of the parent WorldView (usually `-1` for top-level) |
| `config` | `WorldEntityConfig` | Cache config defining bounds, offsets, type, animations |
| `position` | `Position` | Current position (x, y, z, orientation) in parent world fine coords |
| `pathSteps` | `PathStep[10]` | Movement path queue |
| `pendingPathStepCount` | `int` | Number of queued path steps |
| `interpolator` | `WorldEntityInterpolator` | Movement interpolator (default: `LinearWorldEntityInterpolator`) |
| `interpolationInitialized` | `boolean` | Whether interpolation has started for current step |
| `drawMode` | `WorldEntityDrawMode` | How this entity is drawn |
| `actionMask` | `int` | Bitmask of enabled right-click actions (default: 31 = all 5 enabled) |
| `configAnimationState` | `AnimationState` | Animation from config (idle) |
| `sequenceAnimationState` | `AnimationState` | Currently playing sequence animation |
| `sequenceFrame` | `int` | Current frame of sequence animation |

#### Position & Coordinate Transform

WorldEntities exist in the parent world's coordinate space but own a nested scene in their own local coordinate space. The system provides bidirectional transforms:

**`transformToParentWorld(sourceFineX, sourceFineZ)`**
- Takes a point in the entity's local space
- Subtracts the fine base offset (`fineBaseX`, `fineBaseY`)
- Applies the entity's rotation and translation
- Returns the point in parent world coordinates

**`transformFromParentWorld(sourceFineX, sourceFineZ)`**
- Takes a point in the parent world
- Inverts the entity's rotation and translation matrix
- Adds the fine base offset back
- Returns the point in local entity space

**`getFineBaseX()` / `getFineBaseY()`**
- `worldView.sizeX * 64 + config.baseXOffset`
- `worldView.sizeY * 64 + config.baseYOffset`
- These are the fine-coordinate offsets that center the entity's local scene

**`getPlane()`**
- If `ownerWorldViewId != -1`, returns the owner view's plane
- Otherwise returns top-level plane

#### Movement

**`setPosition(position)`** — Hard-set position, resets interpolation.

**`queuePosition(position)`** — If within bounds (0-104 tile range), enqueues a path step. Otherwise hard-sets.

**`enqueuePathStep(position)`** — Shifts path array right, inserts new step at index 0 with current `gameCycle`.

**`interpolatePath(cycle)`** — Called each frame:
1. If no pending steps, hard-sets to step[0]
2. Otherwise initializes interpolation if needed, then advances
3. When interpolation completes (`progress >= 1.0`), decrements step count

**`translate(deltaX, deltaZ)`** — Shifts all path steps and current position by the delta.

#### Drawing

**`applyDrawState(skipOcclusionPass)`**
- Computes the scene transform matrix from animation state (maya animation bone 0)
- Sets scene plane, depth bias, alpha, and HSL tint
- If `skipOcclusionPass`: depth bias = -1200, alpha = 0.01, applies config tint
- If normal pass: depth bias = 0, alpha = 1.0, no tint

**`applyConfig(config)`** — Stores config, sets scene base offsets, starts idle animation.

**`isHiddenForOverlap()`** — Returns `true` if `scene.bu == 0.01F` (the entity is in occluded/hidden state).

---

### WorldEntityConfig

**File:** `WorldEntityConfig.java`
**Extends:** `DualNode`

Cache definition loaded from the game cache that configures a WorldEntity.

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `int` | Config ID |
| `name` | `String` | Display name (default: "null") |
| `category` | `int` | Category ID |
| `baseXOffset` | `int` | Fine-coord X offset for the nested scene origin |
| `baseYOffset` | `int` | Fine-coord Y offset for the nested scene origin |
| `basePlane` | `int` | Base plane |
| `boundsX` | `int` | Bounds center X offset |
| `boundsY` | `int` | Bounds center Y offset |
| `boundsWidth` | `int` | Interaction bounds width |
| `boundsHeight` | `int` | Interaction bounds height |
| `boundsTemplate` | `RotatedRectangleTemplate` | Precomputed bounds template |
| `rotatedBoundsTemplates` | `RotatedRectangleTemplate[4]` | Precomputed bounds for 4 cardinal rotations |
| `idleAnimationId` | `int` | Idle/bobbing animation ID (-1 = none) |
| `spriteId` | `int` | Minimap/world map sprite ID (-1 = none) |
| `sceneTintHsl` | `int` | HSL tint applied to the nested scene (default: 39188) |
| `type` | `WorldEntityType` | Entity type (default: `ag`) |
| `interactionPolicy` | `WorldEntityInteractionPolicy` | Interaction policy (default: `FULL`) |
| `isInteractable` | `boolean` | Whether the entity has right-click actions |
| `actions` | `String[5]` | Right-click action strings ("Hidden" = null) |

#### Decode Opcodes

| Opcode | Field | Format |
|--------|-------|--------|
| 2 | basePlane | UnsignedByte |
| 4 | baseXOffset | Short |
| 5 | baseYOffset | Short |
| 6 | boundsX | Short |
| 7 | boundsY | Short |
| 8 | boundsWidth | UnsignedShort |
| 9 | boundsHeight | UnsignedShort |
| 12 | name | String |
| 14 | isInteractable | (flag, no data) |
| 15-19 | actions[0-4] | String |
| 20 | category | UnsignedShort |
| 23 | type | UnsignedByte (enum lookup) |
| 24 | interactionPolicy | UnsignedByte (enum lookup) |
| 25 | idleAnimationId | UnsignedShort |
| 26 | spriteId | NullableLargeSmart |
| 27 | sceneTintHsl | UnsignedShort |

**`postDecode()`** — Builds the `boundsTemplate` and all 4 `rotatedBoundsTemplates` at different base sizes (256, 334, 362).

---

### WorldEntityDrawMode

**File:** `WorldEntityDrawMode.java`
**Enum implementing:** `EnumOrdinal`

| Value | ID | Description |
|-------|----|-------------|
| `mode0` | 0 | Standard draw — drawn during normal scene rendering |
| `mode1` | 1 | Conditional draw — only drawn if actors/entities overlap its bounds |
| `mode2` | 2 | Secondary draw pass |

Used by `WorldEntityDrawUtil.drawWorldEntitiesByMode()` which is called per draw mode to render entities in the correct order.

---

### WorldEntityType

**File:** `WorldEntityType.java`
**Enum implementing:** `EnumOrdinal`

| Value | ID | Description |
|-------|----|-------------|
| `av` | 0 | Type 0 — entity tag includes interactability |
| `at` | 1 | Type 1 — used when entity is current world view (overrides config type) |
| `ag` | 2 | Type 2 — default type |
| `an` | 3 | Type 3 — entity gets special scene tag (type=5, no position) |

The effective type is resolved by `WorldEntity.getEffectiveType(entity, isCurrentWorldView)`:
- If the entity IS the current world view → `at`
- Otherwise → uses `config.getType()`

---

### WorldEntityInteractionPolicy

**File:** `WorldEntityInteractionPolicy.java`
**Enum implementing:** `EnumOrdinal`

| Value | ID | allowInspectActions | allowInteractionActions |
|-------|----|--------------------|------------------------|
| `NONE` | 0 | false | false |
| `BASIC` | 1 | true | false |
| `FULL` | 2 | true | true |

Default is `FULL`. Controls whether entities within a WorldEntity's nested view can be examined and/or interacted with.

---

### WorldEntityActionFlags

**File:** `WorldEntityActionFlags.java`
**Enum implementing:** `EnumOrdinal`

Controls which entity types allow actions when inside a world entity context. Each variant defines flags for players, NPCs, objects, and ground items.

| Value | ID | objectFlags | groundItemFlags | npcFlags | playerFlags |
|-------|----|-------------|-----------------|----------|-------------|
| `av` | 0 | 0 | 0 | 0 | 0 |
| `at` | 1 | 507 | 507 | 507 | 507 |
| `ag` | 2 | 338 | 338 | 338 | 507 |
| `an` | 3 | 499 | 499 | 499 | 507 |

Default is `at` (all actions allowed for all entity types).

**Flag checking:**
- `hasPrimaryActionBit(flags, isSpecial)` — Checks bit 16 (special) or 64 (normal)
- `hasSecondaryActionBit(flags, isSpecial)` — Checks bit 8 (special) or 32 (normal)

Methods like `isObjectActionAllowed()`, `isNpcActionAllowed()`, `isPlayerActionAllowed()`, `isGroundItemActionAllowed()`, and their `*ExamineAllowed()` variants use these to determine menu entry filtering.

---

### WorldEntityInterpolator / LinearWorldEntityInterpolator

**Files:** `WorldEntityInterpolator.java`, `LinearWorldEntityInterpolator.java`

Abstract base + concrete implementation for smooth WorldEntity movement.

**LinearWorldEntityInterpolator** tracks:
- `startPosition` / `targetPosition` — Endpoints
- `startCycle` / `endCycle` — Time range

**`beginPathStepInterpolation(currentPos, step, cycle)`**
- Sets start = current position, target = step position
- Start cycle = `cycle - 1`
- End cycle = `step.cycle + (worldEntityInterpolationDurationTicks + 3)`

**`interpolateAtCycleFloat(outPos, cycle, stepCount)`**
- Computes progress = `(cycle - start) / (end - start)`
- Clamps progress to [0, 1]
- Linearly interpolates X, Z position
- Linearly interpolates orientation with proper wraparound (2048 units = full rotation)
- Returns `true` when progress >= 1.0 (step complete)

**`translate(deltaX, deltaZ)`** — Shifts both start and target positions.

---

### WorldEntity Mask Updates

**File:** `Fonts.java` — `readWorldEntityMaskUpdate()`

WorldEntities support a bitmask-based update system similar to NPC/player mask updates, read when protocol version >= 6.

**Mask byte:** `uint8` read from the packet buffer.

| Bit | Mask | Update | Data |
|-----|------|--------|------|
| 0 | `0x1` | Animation | `uint16` animationId, `uint8` sequenceFrame |
| 1 | `0x2` | Action mask | `uint8` actionMask (bitmask of 5 right-click actions) |

**Animation update logic:**
- If `animationId == 65535` → clear animation (set to -1, reset state)
- If same animation already playing:
  - `restartMode == 1` → reset animation from beginning
  - `restartMode == 2` → reset frame progress only (don't restart)
- If different animation → only override if new animation's `forcedPriority >= current.forcedPriority`

**Action mask update:**
- Sets `WorldEntity.actionMask` — controls which of the 5 right-click action slots are enabled
- Default is `31` (binary `11111` = all 5 enabled)
- Each bit corresponds to `actions[0]` through `actions[4]`
- Checked by `WorldEntity.isActionEnabledAt(index)`: `(actionMask & (1 << index)) != 0`

---

## Client Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `maxVisibleWorldEntities` | `30` | Maximum world entities drawn per frame |
| `worldEntityInterpolationDurationMs` | `600` | Interpolation duration in milliseconds |
| `worldEntityInterpolationDurationTicks` | `600 / clientTickDurationMs` | Interpolation duration in game ticks |
| `LinearWorldEntityInterpolator.av` | `durationTicks + 3` | Actual end cycle offset (adds 3 tick buffer) |

---

## Collision Data Padding

**File:** `CollisionData.java`

When creating collision maps, the `hasPaddingBorder` parameter (set to `true` for nested WorldViews where `id != -1`) affects bounds:

- **Top-level** (`hasPaddingBorder = false`): Bounds `(0, 0)` to `(sizeX, sizeY)` — no padding
- **Nested** (`hasPaddingBorder = true`): Bounds `(-1, -1)` to `(sizeX + 6, sizeY + 6)` — adds padding border

This padding accounts for the fact that nested WorldViews may need collision data slightly outside their tile boundary for edge cases (actors straddling boundaries, path calculations near edges).

---

## Server Packets

### loadWorldView

Loads map region data for the top-level WorldView.

**Processing flow:**
1. `client.beginRegionRebuild(worldView, buffer)` — Initializes `worldViewInstanceTemplateChunks` array, sets `isRebuildingRegion = true`
2. Reads base coordinates, chunk dimensions, region count
3. Processes instance template chunks for all 4 planes
4. `playerUpdateManager.syncWorldViewPlayers(loadedWorldView)` — Syncs players into the view
5. Sets `client.worldViewMapLoading = true`
6. `MapLoaderUtil.processMapLoader(worldView)` — Starts async map loading thread
7. `client.endRegionRebuild(worldView, buffer)` — Sets `isRebuildingRegion = false`

Map loading runs asynchronously on a separate thread (`MapLoader`), which decodes terrain and objects from the cache into the WorldView's scene, tile heights, tile settings, and collision maps.

### updateWorldEntities

Creates, updates, positions, and removes nested WorldViews via their WorldEntity wrappers.

**Packet structure:**
1. **Active count** (`uint8`) — How many existing entities remain active
2. For entities beyond active count → **removed** (players despawned, WorldView removed, WorldEntity unlinked)
3. For each active entity:
   - **Update type** (`uint8`):
     - `0` = Remove this entity
     - `1` = Keep, no position change
     - `2` = Queue position (smooth movement)
     - `3` = Set position (teleport)
   - If position update: reads delta (x, z, orientation change) via typed value tags
   - If protocol version >= 6: reads mask update
4. **New entities** (remaining bytes):
   - `worldViewId` (`uint16`)
   - `chunkSizeX` (`uint8`, multiplied by 8 for tiles)
   - `chunkSizeY` (`uint8`, multiplied by 8 for tiles)
   - Creates nested WorldView via `createWorldView(id, sizeX, sizeY)`
   - Creates `WorldEntity(id, worldView)`
   - Stores in parent's `worldEntities` hash table
   - Reads config ID (`short`) → `applyConfig()`
   - Reads initial position → `queuePosition()`
   - Reads draw mode (`uint8`)
   - If protocol version >= 6: reads mask update
5. Posts `WorldEntitySpawned` events for all pending spawns

### setCurrentWorldViewPlane

Sets the active plane for a specific WorldView.

- Reads `worldViewId` (`short`): `-1` = top-level, otherwise a nested view
- Reads `plane` (`uint8`)
- Calls `savePlane()` then sets `plane` on the target WorldView
- Sets `AsyncRestResponse.currentWorldView` to the target (used for subsequent packet processing)

### setWorldViewProperties

Configures click behavior and action filtering for a WorldView.

- Reads `worldViewId` (`short`): `-2` = set defaults, otherwise specific view
- Reads `worldViewType` (`uint8`) → `WorldViewType` enum
- Reads `actionFlags` (`uint8`) → `WorldEntityActionFlags` enum
- If id = -2: calls `setDefaultWorldViewProperties()`
- Otherwise: calls `setWorldViewProperties(id, type, flags)`

### clearWorldViewOverride

Removes property overrides for a specific WorldView, reverting to defaults.

- Reads `worldViewId` (`short`)
- Removes entries from both `worldViewTypeById` and `worldEntityActionFlagsById`

---

## Player Synchronization

### PlayerUpdateManager Integration

Players are distributed across WorldViews based on their absolute coordinates.

**`syncWorldViewPlayers(worldView)`** — For each active player slot:
1. Check if the player's coordinate falls within the WorldView's bounds (`baseX < x < baseX + sizeX`, etc.)
2. If the local player is within a non-top-level WorldView → sets `client.currentWorldViewId` to that view's ID
3. If player is within bounds but not yet in this view → creates a Player and adds it
4. If player is outside bounds but exists in this view (and isn't the local player) → removes it

**`syncAllWorldViews()`**
1. Resets `currentWorldViewId = -1`
2. Iterates all WorldViews and calls `syncWorldViewPlayers()` on each
3. The local player's `currentWorldViewId` gets set by whichever nested WorldView contains them

This means a player walking onto a ship's deck will automatically have their `currentWorldViewId` switched to the ship's WorldView.

---

## Rendering Pipeline

### Draw Order

The main render loop (`SoundEffectVorbisDecoder.java`) calls `drawWorldEntitiesByMode` three times in a specific order, interleaved with other entity rendering:

```
1. drawWorldEntitiesByMode(topLevelWorldView, mode2)   // Background entities
2. drawWorldEntitiesByMode(topLevelWorldView, mode0)   // Standard entities
3.   -- Draw NPCs (priority: first) --
4.   -- Draw Players --
5.   -- Draw NPCs (priority: default) --
6.   -- Draw NPCs (priority: last) --
7.   -- Advance Projectiles --
8.   -- Advance Graphics Objects --
9. drawWorldEntitiesByMode(topLevelWorldView, mode1)   // Conditional/overlay entities
```

This ordering means:
- **mode2** entities render behind everything (background/terrain patches)
- **mode0** entities render before actors (standard ships, platforms)
- **mode1** entities render on top of actors (only if actors overlap — used for translucent overlay effects)

### Drawing WorldEntities

**`WorldEntityDrawUtil.drawWorldEntitiesByMode(worldView, drawMode)`**

Called once per draw mode during the render pass. For each active WorldEntity:
1. Skip if it IS the current WorldView (you don't draw the world you're "inside")
2. Skip if draw mode doesn't match
3. Limit to `client.maxVisibleWorldEntities` (30)
4. For `mode1`: perform visibility check — only draw if:
   - Any active player is inside the entity's rotated bounds, OR
   - Any interactable NPC is inside the entity's rotated bounds, OR
   - Any other drawn world entity's bounds intersect this one
5. Call `drawWorldEntity()`

**`WorldMapLabelSize.drawWorldEntity(worldView, worldEntity, skipOcclusionPass)`**

1. Compute entity tag based on type and interactability
2. Set entity Y position from terrain height at its position
3. Mark scene as drawn this cycle
4. Call `applyDrawState()` to configure the nested scene's transform/tint
5. Call `Scene.hf()` to render the nested scene into the parent scene at the entity's position and orientation
6. If successfully drawn and not occluded:
   - Add local player to entity's scene
   - Add combat target player
   - Draw NPCs by priority (first, default, last)
   - Add remaining players
   - Advance graphics objects

### Actor Rendering Within Nested Scenes

When a WorldEntity is successfully drawn (not occluded), the client populates its nested scene with actors in a specific order:

1. **Local player** — added if `client.renderSelf` is true
2. **Combat target player** — added if `combatTargetPlayerIndex >= 0` and exists in the entity's WorldView
3. **NPCs (drawPriorityFirst)** — high-priority NPCs rendered first
4. **Other players** — all remaining players except local and combat target
5. **NPCs (drawPriorityDefault)** — normal-priority NPCs
6. **NPCs (drawPriorityLast)** — low-priority NPCs rendered last
7. **Graphics objects** — spot animations, projectile effects, etc.

This ensures the local player and combat target are always visible on deck, while other entities layer correctly.

### Scene-in-Scene Rendering

The nested WorldView's scene is composited into the parent scene via `Scene.hf()`:
- Parent scene: `worldView.scene` (top-level)
- Nested scene: `worldEntity.worldView.scene`
- Position: entity's `cameraFocusX`, `cameraFocusZ`, `cameraFocusY` (Y from terrain height)
- Orientation: entity's `currentOrientation`
- Entity tag: packed tag for click targeting (varies by WorldEntityType)
- Height offset: 60 (constant vertical offset parameter)

The nested scene's transform matrix (`Scene_cameraPitchSine`) is derived from the entity's maya animation bone 0, enabling bobbing/rocking effects from the idle animation.

### Bounds Checking

**`HttpHeaderQualityComparator.isActorInsideWorldEntityBounds(worldEntity, actor)`**

Uses rotated rectangle intersection testing:
1. Compute actor's AABB from position and `footprintSize * 64`
2. Create a `RotatedRectangleInstance` from the entity's bounds template, position, and orientation
3. Test intersection between the rotated rectangle and the actor's AABB

---

## Coordinate System

### Top-Level Coordinates
- `baseX`, `baseY`: absolute tile coordinates of the WorldView origin
- Scene coordinates: tiles relative to the WorldView origin (0 to sizeX/sizeY)
- Fine coordinates: scene tiles * 128 (128 fine units per tile)

### Nested WorldView Coordinates
- The nested scene has its own local coordinate system (0 to sizeX/sizeY tiles)
- `fineBaseX = worldView.sizeX * 64 + config.baseXOffset` — center offset in fine coords
- `fineBaseY = worldView.sizeY * 64 + config.baseYOffset`

### Transforms Between Coordinate Spaces
- **Local → Parent**: `WorldEntity.transformToParentWorld(fineX, fineZ)` — Subtracts fine base, applies rotation + translation
- **Parent → Local**: `WorldEntity.transformFromParentWorld(fineX, fineZ)` — Inverts rotation + translation, adds fine base
- **Local → Main World**: `WorldEntity.transformToMainWorld(localPoint)` — Wrapper that validates worldViewId match then delegates to `transformToParentWorld`
- **Any → Top-Level**: `client.toTopLevelWorldCoordinates(worldView, x, z)` — Transforms from any view to absolute top-level

---

## TileRenderMode

**File:** `TileRenderMode.java`

| Value | Usage |
|-------|-------|
| `camera` | Top-level WorldView — scene rendered from camera perspective |
| `target` | Nested WorldViews — scene rendered relative to parent at the entity's position |

---

## Events

The WorldView system fires the following events through the client callback system:

| Event | When Fired |
|-------|-----------|
| `WorldEntitySpawned` | After `updateWorldEntities` creates a new WorldEntity (batched via `pendingWorldEntitySpawns` list) |
| `WorldEntityDespawned` | When `removeWorldView()` is called for a nested view |
| `WorldViewUnloaded` | During `removeWorldViewInternal()`, before cleanup (only if `mapRegions != null`) |
| `NpcDespawned` | For every NPC in a WorldView being removed |
| `PlayerDespawned` | For players removed during WorldView player sync |
| `ItemSpawned` | During `postItemSpawnEvents()` for ground items on the current plane |
| `AmbientSoundEffectCreated` | When `addObjectAmbientSound()` creates a new ambient emitter |

The spawn events use a deferred pattern — `WorldEntity` constructors call `wt()` which adds `this` to `client.pendingWorldEntitySpawns`. After the full `updateWorldEntities` packet is processed, `postWorldEntitySpawns()` iterates the list and fires `WorldEntitySpawned` for each, then clears the list.

---

## Full Lifecycle Summary

### Initialization
1. `WorldViewManager` is created
2. `createPrimaryWorldView(104, 104, drawDistance)` creates the top-level view
3. Stored as both `primaryWorldView` and `Occluder.topLevelWorldView`

### Region Loading
1. Server sends `loadWorldView` packet
2. Client decodes region IDs, XTEA keys (r235; removed in r237+), instance template chunks
3. `MapLoader` thread asynchronously decodes terrain, objects, collision
4. Players sync into the loaded view

### WorldEntity Spawn (e.g., a ship appearing)
1. Server sends `updateWorldEntities` with new entity data
2. Client creates nested `WorldView(id, chunkSizeX*8, chunkSizeY*8, drawDistance, TileRenderMode.target)`
3. Client creates `WorldEntity(id, nestedWorldView)` with config, position, draw mode
4. Entity is stored in parent WorldView's `worldEntities` table
5. Server sends `setCurrentWorldViewPlane` to set the nested view's plane
6. Server sends `loadWorldView`-equivalent data to populate the nested scene
7. Server sends `setWorldViewProperties` to configure click/action behavior

### Player Enters WorldEntity (e.g., boarding a ship)
1. Player's coordinate moves into the WorldEntity's bounds
2. `syncAllWorldViews()` detects player inside nested view
3. `currentWorldViewId` switches to the nested view's ID
4. Client now renders from within the nested scene
5. Click behavior changes based on `WorldViewType` (e.g., `setHeading` for sailing)

### Movement
1. Server sends position updates via `updateWorldEntities`
2. `queuePosition()` enqueues path steps
3. Each frame, `interpolatePath()` smoothly moves the entity
4. `LinearWorldEntityInterpolator` performs linear position + orientation interpolation
5. All players within the view move with it (synced via `syncWorldViewPlayers`)

### WorldEntity Removal
1. Server sends `updateWorldEntities` with reduced active count or update type = 0
2. All players in the nested view are despawned
3. `WorldViewManager.removeWorldView()` cleans up
4. NPC despawn events, WorldEntity despawn event, WorldView unloaded event all fire
5. Ambient sounds cleared, node unlinked

### Disconnection / Reset
1. `WorldViewManager.clear()` removes all nested views
2. Primary view state is cleared and re-inserted
3. `currentWorldViewId` resets to `-1`

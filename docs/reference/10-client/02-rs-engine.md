# 10.2 — The RS engine layer (`src/rs/`)

Everything under `src/rs/` exists for exactly one reason: to read OSRS cache data and turn it into in-memory data structures the engine can use. It is format code, and it should be as dumb and pure as possible. Nothing in `src/rs/` should import from `src/client/`, `src/ui/`, or `src/network/`. The same code compiles on the server, which is why the server-side `CacheEnv` can re-use the loaders in `src/rs/cache/loader/` through `getCacheLoaderFactory()`.

This page is the tour of that tree.

## `src/rs/cache/` — the archive layer

The OSRS cache is a collection of indexed, compressed archives on disk (`main_file_cache.dat2` plus `main_file_cache.idxN` files, one per group). A `CacheSystem` wraps a particular backing store and exposes a uniform API for reading an archive, a container, or a raw file.

Key types:

- **`CacheSystem<A extends ApiType>`** (`src/rs/cache/CacheSystem.ts`) — the top-level handle. The `A` type parameter (`SYNC` | `ASYNC`) constrains whether reads return values or Promises. Browser builds use `ASYNC`; server builds use `SYNC`. Methods return index handles the code can then traverse.
- **`CacheIndex`** (`src/rs/cache/CacheIndex.ts`) — a single index file. Each index corresponds to one OSRS "group" (configs, sprites, textures, models, etc.). Provides file enumeration and archive lookup.
- **`Archive`** (`src/rs/cache/Archive.ts`) — a compressed, possibly XTEA-encrypted blob read from an index. Handles both the old and the new (`dat2`) formats. `decode()` returns a `Container`.
- **`Container`** (`src/rs/cache/Container.ts`) — the decoded archive contents: a list of named files.
- **`ArchiveFile`** — an entry in a `Container`.
- **`CacheType` / `IndexType` / `ConfigType`** — enumerations for the well-known groups and config subtypes. Use these constants instead of literal numbers.
- **`ApiType`** — the type-level switch between sync and async. Most application code parameterizes over this so it can live on either side.
- **`CacheInfo`** (`src/rs/cache/CacheInfo.ts`) — cache metadata loaded at boot: revision, name, environment, build date.

### Store backends

`src/rs/cache/store/` contains the different backing stores: an `IndexedDBStore` for the browser, a `MemoryStore` for tests, and the disk store the server uses. All of them expose the same read interface `CacheSystem` is parameterized on.

### Loaders

`src/rs/cache/loader/` is the _factory layer_. `getCacheLoaderFactory(info, cacheSystem)` returns an object that knows how to construct every typed loader the rest of the engine wants: `NpcTypeLoader`, `ObjTypeLoader`, `LocTypeLoader`, `SeqTypeLoader`, `BasTypeLoader`, `EnumTypeLoader`, `ParamTypeLoader`, and so on. The server calls this factory once at boot (`server/src/index.ts`); the client calls it once when `OsrsClient` is constructed. You should generally not instantiate loaders by hand.

## `src/rs/config/` — typed definitions

Every OSRS cache has a `configs` group containing typed definitions for items, NPCs, objects, animations, enums, scripts, and more. `src/rs/config/` has one subdirectory per type:

| Subdirectory | Loader | Purpose |
|---|---|---|
| `objtype/` | `ObjTypeLoader` | Items: names, models, equipment, stackable, examine text, params. |
| `loctype/` | `LocTypeLoader` | Scenery/objects in the world: models, wall flags, animations. |
| `npctype/` | `NpcTypeLoader` | NPCs: name, combat level, head icon, models. |
| `seqtype/` | `SeqTypeLoader` | Animations (sequences). Frame lengths, frame IDs. |
| `spotanimtype/` | `SpotAnimTypeLoader` | Spot animations (visual effects). |
| `idktype/` | `IdkTypeLoader` | Identikit (player model parts). |
| `floortype/` | `FloorTypeLoader` | Terrain tile types. |
| `bastype/` | `BasTypeLoader` | Base animations (walk/run/idle sequences per weapon). |
| `vartype/` | `VarManager` | Varps and varbits declarations. |
| `paramtype/` | `ParamTypeLoader` | Parameter definitions used by params on items/locs. |
| `healthbar/` | `HealthbarTypeLoader` | Health bar visuals. |
| `hitsplat/` | `HitsplatTypeLoader` | Hit splat visuals. |
| `enumtype/` | `EnumTypeLoader` | OSRS enum tables (key → value). |
| `db/` | `DbRepository` | Structured database rows (item sets, sometimes). |
| `player/` | `PlayerAppearance` | Player appearance rendering from IDK parts. |
| `defaults/` | — | Default configuration values. |

Each loader inherits from `TypeLoader` (`src/rs/config/TypeLoader.ts`), which wraps the details of reading the config archive, decoding bytes, and caching the resulting `Type` objects.

If you need to know "what's the model ID for item 4151", you'd do (roughly):

```ts
const objTypeLoader = cacheFactory.getObjTypeLoader();
const t = await objTypeLoader.load(4151);   // async in browser, sync on server
console.log(t.name, t.inventoryModel);
```

All type loaders are lazy and cache on read.

## `src/rs/model/` — 3D models

Models in OSRS are vertex/triangle lists with per-face texturing, per-vertex colors, and optional skeletal animation.

- **`Model.ts`** — the rendered-ready model. Has the vertex buffer, triangle indices, textures, color palette lookup, bounding volume, and a reference to its source `ModelData`.
- **`ModelData.ts`** — the raw decoded model (~113 kB; it's basically a big struct). Contains the source data before any render-specific processing.
- **`ModelLoader.ts`** — reads a model archive from the cache and returns a `ModelData`.
- **`TextureMapper.ts`** — maps face textures for the renderer (~26 kB).
- **`seq/`** — frame-based (classic) skeletal animation. Applies a sequence of frames to a model.
- **`skeletal/`** — modern skeletal animation with vertex weights.

The server doesn't need full models at runtime; it only uses model data for things like collision cap computation. The client uses models for everything it draws.

## `src/rs/scene/` — the 3D scene graph

Once models and location types are loaded, the scene builder stitches them together with the terrain into a 3D scene the renderer can walk over.

- **`SceneBuilder.ts`** — the scene assembler. Given a region, it generates terrain mesh data, places locs (scenery) with the correct rotation and elevation, builds wall and floor decoration geometry, and produces a `Scene`.
- **`Scene.ts`** — the in-memory scene graph. A grid of `SceneTile` entries with attached `Loc`, `Wall`, `FloorDecoration`, and `WallDecoration` data.
- **`SceneTile.ts`** — a single tile's contents.
- **`SceneTileModel.ts`** — the generated geometry for one tile (ground, overlays, underlays).
- **`CollisionMap.ts`** — per-tile collision flags computed during scene build. The server uses its own copy (`MapCollisionService`), but the client has this for local prediction.
- **`Loc.ts`, `Wall.ts`, `FloorDecoration.ts`, `WallDecoration.ts`** — scene entity classes, each with a typed reference back to the relevant config type.
- **`entity/`** — overlay entities that don't fit the tile model (dynamic spawn markers, etc.).

The flow from cache to frame is:

```
cache → SceneBuilder → Scene → WebGLMapSquare (GPU buffers) → draw
```

## `src/rs/cs2/` — the ClientScript 2 VM

OSRS uses a bytecode interpreter called CS2 for most of its interface logic. Interface buttons push values onto a stack, call subroutines, fire off UI actions, and generally drive the UI. To faithfully render OSRS widgets, XRSPS has to run these scripts.

- **`Cs2Vm.ts`** — the interpreter. Enormous file; implements a huge opcode table matching the cache format. Each opcode reads operands from the bytecode stream, pops/pushes the typed stacks (int/string/long/object), and may call engine hooks (open a widget, transmit a varp, play a sound, etc.).
- **`Script.ts`** — the script structure (locals, opcodes, operands).
- **`ChatHistory.ts`** — chat history buffer used by the chat CS2 scripts.

The widget manager (`src/ui/widgets/WidgetManager.ts`) calls into the VM whenever a widget event fires. A button click becomes `runCs1(scriptId, args)`, which compiles down to a VM run.

See [10.4 — UI and widgets](./04-ui-widgets.md) for where the VM plugs into the widget layer.

## `src/rs/compression/`

Two files, both WASM-backed:

- **`Bzip2.ts`** — wraps `@foxglove/wasm-bz2`. Used for old-format archive containers.
- **`Gzip.ts`** — wraps `wasm-gzip`. Used for modern containers.

They must be initialized before any cache read (done in `src/index.tsx`).

## `src/rs/sprite/`, `src/rs/texture/`, `src/rs/audio/`

Thin loaders for 2D assets:

- **`SpriteLoader.ts`** — 2D sprites (item icons, UI bits, minimap tiles). Decodes palette-indexed bitmaps.
- **`TextureLoader.ts`** — textures (32-bit RGBA). Also handles procedural texture variants for things like water animations.
- **`SoundEffectLoader.ts`** — sound effect audio data as decoded PCM.

## `src/rs/interaction/`, `src/rs/inventory/`, `src/rs/prayer/`, `src/rs/skill/`, `src/rs/chat/`

Smaller utilities that straddle "cache-y" and "engine-y":

- **`InteractionIndex.ts`** — packs an interaction type + target ID into a single integer, used by the menu system.
- **`Inventory.ts`** — the inventory slot data structure.
- **`prayers.ts`** — prayer definitions: varbit bits, icons, level requirements. Used by both client and server (indirectly via shared types).
- **`skill/skills.ts`** — skill ID constants and metadata.
- **`chat/`** — `PlayerType` enumeration (donor, mod, admin, etc.).

## `src/rs/MathConstants.ts` and `src/rs/MenuEntry.ts`

- **`MathConstants.ts`** — `DEGREES_TO_RADIANS`, coordinate-scale constants, etc.
- **`MenuEntry.ts`** — the data class for a single menu option (action text, target, priority, flags).

---

## Canonical facts

- **Cache system**: `src/rs/cache/CacheSystem.ts`.
- **Loader factory**: `src/rs/cache/loader/CacheLoaderFactory.ts` → `getCacheLoaderFactory(info, cacheSystem)`.
- **Object/item loader**: `src/rs/config/objtype/ObjTypeLoader.ts`.
- **Location/scenery loader**: `src/rs/config/loctype/LocTypeLoader.ts`.
- **NPC loader**: `src/rs/config/npctype/NpcTypeLoader.ts`.
- **Animation (sequence) loader**: `src/rs/config/seqtype/SeqTypeLoader.ts`.
- **Enum loader**: `src/rs/config/enumtype/EnumTypeLoader.ts`.
- **Var manager**: `src/rs/config/vartype/VarManager.ts`.
- **Model**: `src/rs/model/Model.ts`, raw `src/rs/model/ModelData.ts`.
- **Scene builder**: `src/rs/scene/SceneBuilder.ts`.
- **Scene graph**: `src/rs/scene/Scene.ts`.
- **Collision map**: `src/rs/scene/CollisionMap.ts`.
- **CS2 VM**: `src/rs/cs2/Cs2Vm.ts`.
- **Bzip2 / Gzip**: `src/rs/compression/Bzip2.ts`, `src/rs/compression/Gzip.ts`.
- **Sprite loader**: `src/rs/sprite/SpriteLoader.ts`.
- **Texture loader**: `src/rs/texture/TextureLoader.ts`.
- **Sound loader**: `src/rs/audio/SoundEffectLoader.ts`.
- **Interaction index**: `src/rs/interaction/InteractionIndex.ts`.
- **Inventory class**: `src/rs/inventory/Inventory.ts`.
- **Prayer data**: `src/rs/prayer/prayers.ts`.
- **Skill IDs**: `src/rs/skill/skills.ts`.
- **Menu entry type**: `src/rs/MenuEntry.ts`.

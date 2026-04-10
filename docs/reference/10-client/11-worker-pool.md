# 10.11 — Worker pool (`src/client/worker/`)

Building 3D scene geometry for a 64×64 map square is expensive: parsing tile heights, placing locs, resolving walls, generating terrain triangles, computing normals and UVs. Doing it on the main thread causes visible hitches every time the player walks into a new region. The worker pool offloads this work into a small pool of background workers that own their own `CacheSystem` and return flat GPU-ready vertex arrays to the main thread.

## `RenderDataWorkerPool` (`src/client/worker/RenderDataWorkerPool.ts`)

Creates N `RenderDataWorker` instances (N is chosen from `navigator.hardwareConcurrency`, clamped to a sane range). Tracks which workers are idle vs busy and round-robins new jobs.

Jobs are enqueued with `enqueueJob(job): Promise<Result>`. The pool resolves the promise when the corresponding worker responds with a `JOB_DONE` message.

The pool survives HMR in development via a nonce bumped by `OsrsClientApp`; see [10.1 — Entry and lifecycle](./01-entry-and-lifecycle.md) for why.

### Job types

The pool currently handles:

- **Build map square** — given region X/Y and flags, produces a `WebGLMapSquare`'s worth of buffers.
- **Build minimap tile** — produces a small bitmap for the minimap using `MinimapData`.
- **(Internal)** — cache warmup for the region surrounding the current tile.

## `RenderDataWorker` (`src/client/worker/RenderDataWorker.ts`)

The worker script. Web Worker entry point. On construction:

1. Initializes its own `CacheSystem` against the IndexedDB-backed store. Yes, every worker has its own handle; IndexedDB is safe to open from multiple workers and this is simpler than shuffling bytes over `postMessage`.
2. Initializes bzip2 and gzip WASM in the worker scope.
3. Creates a `SceneBuilder` and a set of loaders.
4. Listens for messages from the main thread.

When a `BUILD_MAP_SQUARE` message arrives:

1. Load the map region from the cache.
2. Run `SceneBuilder` to produce a `Scene`.
3. Flatten terrain and loc geometry into typed arrays (`Float32Array` for vertices, `Uint16Array` or `Uint32Array` for indices, etc.).
4. Transfer the typed arrays back to the main thread via `postMessage(..., [transferList])` so there's no copy.

The main thread picks them up in `WebGLOsrsRenderer` and uploads them to GPU buffers.

## `RenderDataLoader.ts`

Helper class that sits inside the worker and caches the per-region intermediate data it builds. If the worker is asked to re-process the same region (rare, but happens during region boundary crossings), it returns the cached result instead of rebuilding.

## `MinimapData.ts`

Pure data description of a minimap tile: its pixel buffer, dimensions, and which region it represents. `MinimapRenderer` in `src/ui/gl/MinimapRenderer.ts` consumes these to compose the sidebar minimap.

## `ServerConnection.ts` and `ServerConnectionShim.ts` (in this dir)

Yes, both of these file names also exist under `src/network/`. In `src/client/worker/` the files are lightweight re-exports or worker-safe variants — workers cannot use the main thread's `ServerConnection` directly. Usually you don't touch these; the main thread is the one that talks to the server, not the workers.

## `packet/` and `combat/` under worker

Same pattern — re-exports so worker code can `import` the same codec without pulling in main-thread-specific dependencies.

## Messaging contract

The main thread and worker exchange messages with this shape:

```ts
type Msg =
  | { type: 'BUILD_MAP_SQUARE'; jobId: number; regionX: number; regionY: number; /* … */ }
  | { type: 'JOB_DONE'; jobId: number; payload: ArrayBuffer[] }
  | { type: 'JOB_FAILED'; jobId: number; error: string };
```

The exact shape lives in `RenderDataWorkerPool.ts` — changes to the contract must be made in both ends in the same commit.

## Memory transfers

Every typed array returned by the worker is on the transfer list, so the main thread _owns_ the underlying `ArrayBuffer` after the `postMessage`. The worker should never hold on to those references after transferring — doing so results in `neutered ArrayBuffer` errors on the worker side.

## Profiling and tuning

- **Worker count.** More workers reduce latency for cache-miss paths but cost memory (each worker has its own cache loader caches). The default clamp is 4–8.
- **Job queue depth.** If the queue grows (e.g., the player teleports to a new area and we need ~25 map squares), the pool batches the work across workers. The visible effect is a brief delay in chunks loading — acceptable compared to a main-thread stall.
- **Flame graph.** Chrome devtools' worker flame graph attaches to workers automatically. Look for `SceneBuilder.build` dominating.

## Things not to do

- **Don't do blocking work in the worker's message handler.** It'll stall the worker and any subsequent jobs. If you need to fetch something, use the async cache API.
- **Don't hold DOM references.** Workers don't have a DOM.
- **Don't try to use `window.osrsClient` in a worker.** There's no global.
- **Don't `postMessage` huge non-transferable objects.** Anything other than a typed array or `ArrayBuffer` is a copy; large copies show up in the `Structured Clone` line of the profiler.

---

## Canonical facts

- **Worker pool**: `src/client/worker/RenderDataWorkerPool.ts` → `class RenderDataWorkerPool`.
- **Worker script**: `src/client/worker/RenderDataWorker.ts`.
- **Worker-side loader**: `src/client/worker/RenderDataLoader.ts`.
- **Minimap data type**: `src/client/worker/MinimapData.ts`.
- **Scene builder**: `src/rs/scene/SceneBuilder.ts` (runs inside the worker).
- **Cache backing store**: IndexedDB (`src/rs/cache/store/`) — safe for concurrent opens.
- **HMR nonce**: maintained in `src/client/OsrsClientApp.tsx`.
- **Worker count clamp**: `navigator.hardwareConcurrency`, bounded to a safe range inside the pool.

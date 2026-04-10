# 20.10 — Persistence

The server saves every player account as a JSON blob. That's the entire persistence story — no database, no migrations framework, no ORM. This page documents the mechanics.

## `AccountStore` (`server/src/game/state/AccountStore.ts`)

The main persistence surface. Provides:

- `load(username): AccountRecord | null` — read an account by username.
- `save(username, record)` — write an account.
- `exists(username): boolean`.
- `list(): string[]` — used by debug tools.

The default implementation is `JsonAccountStore` (also in the same file or a sibling) which reads and writes individual JSON files from a directory configured by `config.accountsFilePath`. One file per account.

### `AccountRecord`

The JSON shape on disk is the output of `PlayerStateSerializer.toJson(player)` plus account-level fields:

```json
{
  "version": 1,
  "account": {
    "username": "shaw",
    "passwordHash": "…",
    "createdAt": "2026-01-01T00:00:00Z",
    "lastLoginAt": "2026-04-09T…"
  },
  "character": {
    "position": { "x": 3222, "y": 3218, "plane": 0 },
    "inventory": { /* … */ },
    "bank": { /* … */ },
    "skills": { /* … */ },
    "equipment": { /* … */ },
    "prayers": { /* … */ },
    "varps": { /* … */ },
    "collectionLog": { /* … */ },
    // …
  }
}
```

Exact field layout is defined by each sub-state's `serialize()`. If you want to inspect a saved account, just `cat` its JSON.

## `PersistenceProvider` (`server/src/game/state/PersistenceProvider.ts`)

An interface above `AccountStore` that lets you swap the backing store. In theory you could drop in a Postgres implementation by writing one that implements the same shape. In practice, the JSON store is sufficient for current scale.

## `PlayerPersistence` (`server/src/game/state/PlayerPersistence.ts`)

The coordinator between `PlayerState` and `AccountStore`. Used by login (for load) and autosave (for save).

Load flow:

```
LoginHandshakeService
 └── PlayerPersistence.load(username)
      ├── AccountStore.load(username) → AccountRecord | null
      ├── PlayerStateSerializer.fromJson(record.character) → PlayerState
      ├── Attach account-level state
      └── Return ready-to-use PlayerState
```

Save flow:

```
TickFrameService.maybeRunAutosave
 └── for each dirty player:
      └── PlayerPersistence.save(player)
           ├── PlayerStateSerializer.toJson(player) → jsonCharacter
           ├── Merge with account-level fields → AccountRecord
           └── AccountStore.save(username, record)
```

## Autosave

Autosave runs during the tick, in the broadcast phase. It's gated on:

- Whether the player is dirty (tracked via `PersistentSubState.markDirty()`).
- How long it's been since the last save for that player (rate-limit to avoid pounding disk).
- A per-tick budget so saving doesn't exceed the tick's time budget.

If the save budget is exceeded for a tick, remaining dirty players are carried over to the next tick. The autosave loop is intentionally simple and non-reentrant.

## Passwords

Passwords are hashed before storage. The current hash is a salted bcrypt (or equivalent — check `AuthenticationService.ts` for the exact implementation). Verification happens in `AuthenticationService.verifyPassword(plain, hashed)`.

Never store, log, or echo the plaintext password. The login handler takes it as input, passes it to the authentication service, and never keeps it around.

## Versioning and migrations

Each sub-state writes a version number as part of its serialized output. On load:

```ts
if (saved.version === 1) {
    return { ...saved, version: 2, extraField: defaultValue };
}
```

Migrations are written case-by-case inside the sub-state's `deserialize` method. There's no central migration runner. If you add a field to a sub-state:

1. Bump the version number.
2. Add a migration branch for the previous version that fills in the new field with a sensible default.
3. Update tests.

## Backups

There is no automatic backup. The `server/data/` directory is the source of truth; if you need backups, use your preferred disk backup tool or container volume backup.

Some operators run the server inside a git repo so each tick's autosave is a commit-able diff — this is not recommended for production (account files grow quickly) but is useful for debugging regressions.

## Account deletion

There is no in-game account delete flow. Delete the JSON file from the disk. The next login will treat the account as nonexistent.

## Transactional concerns

Writes are **not** atomic with respect to multi-tick state changes. A crash mid-save can leave a JSON file partially written. To mitigate:

- The store writes to a temp file and renames on success. `rename()` is atomic on most filesystems.
- If you need stricter guarantees (e.g., bank + inventory consistency across a trade), save both players at the end of the trade in a single phase.

## Scaling

The JSON store works fine up to a few thousand players. Beyond that, per-account JSON files become a bottleneck (FS metadata cost, disk I/O on autosave). The intended path when this matters is to implement a `PersistenceProvider` backed by a real database (SQLite via `bun:sqlite` is the easy default given the project uses Bun).

---

## Canonical facts

- **Account store interface**: `server/src/game/state/AccountStore.ts`.
- **Persistence provider**: `server/src/game/state/PersistenceProvider.ts`.
- **Player persistence coordinator**: `server/src/game/state/PlayerPersistence.ts`.
- **Player serializer**: `server/src/game/state/PlayerStateSerializer.ts`.
- **Accounts directory**: `config.accountsFilePath` (default `server/data/accounts/`).
- **Dirty tracking**: `server/src/game/state/PersistentSubState.ts`.
- **Autosave hook**: `TickFrameService.maybeRunAutosave`.
- **Authentication**: `server/src/network/AuthenticationService.ts`.
- **Rule**: writes go to a temp file + rename for atomicity.
- **Rule**: password plaintext is never stored or logged.

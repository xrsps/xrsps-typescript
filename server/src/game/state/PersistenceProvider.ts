/**
 * Abstract persistence provider interface for player state storage.
 *
 * The server uses this interface for all player data persistence operations.
 * Implement this to plug in alternative storage backends:
 *   - SQLite (single-file database, good for small servers)
 *   - PostgreSQL / MySQL (production multi-instance deployments)
 *   - Redis (in-memory with optional persistence)
 *   - Custom binary format (optimized for large player counts)
 *
 * The default implementation is {@link PlayerPersistence} which uses a single
 * aggregate JSON file per gamemode.
 */

import type { PlayerState } from "../player";
import type { PlayerPersistentVars } from "../player";

export interface PersistenceProvider {
    /** Apply persisted state onto a player (merge defaults + player-specific data). */
    applyToPlayer(player: PlayerState, key: string): void;

    /** Check if a player has been persisted before (i.e. not a new account). */
    hasKey(key: string): boolean;

    /** Save a single player's state immediately. */
    saveSnapshot(key: string, player: PlayerState): void;

    /** Bulk save multiple players (used by autosave — implementations should batch/optimize). */
    savePlayers(entries: Array<{ key: string; player: PlayerState }>): void;
}

/**
 * Extended persistence provider with optional lifecycle hooks.
 * Implement these for backends that need setup/teardown (database connections, etc.).
 */
export interface ManagedPersistenceProvider extends PersistenceProvider {
    /** Called once during server boot. Use for connection setup, schema migration, etc. */
    initialize?(): Promise<void> | void;

    /** Called during graceful shutdown. Use for connection cleanup, final flush, etc. */
    dispose?(): Promise<void> | void;
}

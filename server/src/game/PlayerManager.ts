import type { WebSocket } from "ws";
import type { LocTypeLoader } from "../../../src/rs/config/loctype/LocTypeLoader";
import { PathService } from "../pathfinding/PathService";
import { logger } from "../utils/logger";
import { DoorStateManager } from "../world/DoorStateManager";
import { DEBUG_PLAYER_IDS, Tile } from "./actor";
import { PlayerInteractionSystem, PlayerRepository } from "./interactions/PlayerInteractionSystem";
import {
    FollowInteractionKind,
    GroundItemInteractionState,
    PlayerInteractionState,
} from "./interactions/types";
import { NpcState } from "./npc";
import type { GamemodeDefinition } from "./gamemodes/GamemodeDefinition";
import { PlayerState } from "./player";
import type { ScriptRuntime } from "./scripts/ScriptRuntime";
import { normalizePlayerAccountName } from "./state/PlayerSessionKeys";

/**
 * Orphaned player data - players who disconnected while in combat.
 * They remain in the game world and can be attacked until combat ends.
 */
export interface OrphanedPlayer {
    /** The player state (still in game world) */
    player: PlayerState;
    /** The tick when the player disconnected */
    disconnectTick: number;
    /** The save key for reconnection matching */
    saveKey: string;
}

/**
 * Maximum ticks an orphaned player stays in-game (100 ticks = 60 seconds).
 * After this, they are removed regardless of combat state.
 */
const ORPHAN_MAX_TICKS = 100;

// --- Player management / interaction delegation ---
export class PlayerManager implements PlayerRepository {
    private players = new Map<WebSocket, PlayerState>();
    private pathService: PathService;
    // Headless players (no websocket) for testing/simulation
    private bots: PlayerState[] = [];
    /**
     * Orphaned players - disconnected while in combat.
     * Key is saveKey (username), value is orphan data.
     * These players remain in the game world and can be attacked.
     */
    private orphanedPlayers = new Map<string, OrphanedPlayer>();
    /**
     * Player sync uses a 2048-slot index space on the client (0..2047).
     * The server currently uses {@link PlayerState.id} as that index, so we must
     * keep player IDs within this range to avoid client-side index collisions.
     */
    private static readonly MAX_SYNC_PLAYER_ID = 2047;
    private nextId: number = 1;
    private freeIds: number[] = [];
    /** O(1) lookup set for in-use player IDs */
    private usedIds = new Set<number>();
    private locTypeLoader?: LocTypeLoader;
    private doorManager?: DoorStateManager;
    private readonly interactionSystem: PlayerInteractionSystem;

    constructor(
        private readonly gamemode: GamemodeDefinition,
        pathService: PathService,
        locTypeLoader?: LocTypeLoader,
        doorManager?: DoorStateManager,
        scriptRuntime?: ScriptRuntime,
    ) {
        this.pathService = pathService;
        this.locTypeLoader = locTypeLoader;
        this.doorManager = doorManager;
        this.interactionSystem = new PlayerInteractionSystem(
            this,
            pathService,
            locTypeLoader,
            doorManager,
            scriptRuntime,
        );
    }

    setLocChangeCallback(
        callback: (
            oldId: number,
            newId: number,
            tile: { x: number; y: number },
            level: number,
            opts?: {
                oldTile?: { x: number; y: number };
                newTile?: { x: number; y: number };
                oldRotation?: number;
                newRotation?: number;
            },
        ) => void,
    ): void {
        this.interactionSystem.setLocChangeCallback(callback);
    }

    setTradeHandshakeCallback(
        callback: (initiator: PlayerState, target: PlayerState, tick: number) => void,
    ): void {
        this.interactionSystem.setTradeHandshakeCallback(callback);
    }

    setGroundItemInteractionCallback(
        callback: (player: PlayerState, interaction: GroundItemInteractionState) => void,
    ): void {
        this.interactionSystem.setGroundItemInteractionCallback(callback);
    }

    setGameMessageCallback(callback: (player: PlayerState, text: string) => void): void {
        this.interactionSystem.setGameMessageCallback(callback);
    }

    /**
     * Set callback for interrupting skill actions.
     * Called when player walks, starts new interaction, teleports, etc.
     */
    setInterruptSkillActionsCallback(callback: (playerId: number) => void): void {
        this.interactionSystem.setInterruptSkillActionsCallback(callback);
    }

    /**
     * Set callback to stop auto-attack in PlayerCombatManager when player walks.
     */
    setStopAutoAttackCallback(callback: (playerId: number) => void): void {
        this.interactionSystem.setStopAutoAttackCallback(callback);
    }

    /**
     * Set callback to validate whether NPC combat can start for single/multi rules.
     */
    setNpcCombatPermissionCallback(
        callback: (
            attacker: PlayerState,
            npc: NpcState,
            currentTick: number,
        ) => { allowed: boolean; reason?: string },
    ): void {
        this.interactionSystem.setNpcCombatPermissionCallback(callback);
    }

    private allocatePlayerId(): number | undefined {
        const reused = this.freeIds.pop();
        if (reused !== undefined) return reused;

        const next = this.nextId;
        if (next <= PlayerManager.MAX_SYNC_PLAYER_ID) {
            this.nextId = next + 1;
            return next;
        }

        // Fallback: find any gap (should be rare; mostly protects against bugs).
        for (let id = 1; id <= PlayerManager.MAX_SYNC_PLAYER_ID; id++) {
            if (!this.isPlayerIdInUse(id)) return id;
        }

        return undefined;
    }

    private isPlayerIdInUse(id: number): boolean {
        return this.usedIds.has(id);
    }

    add(ws: WebSocket, spawnX: number, spawnY: number, level: number = 0): PlayerState | undefined {
        const id = this.allocatePlayerId();
        if (id === undefined) {
            logger.warn(
                `[player] Refusing connection: player id pool exhausted (max=${PlayerManager.MAX_SYNC_PLAYER_ID})`,
            );
            return undefined;
        }
        const p = new PlayerState(id, spawnX, spawnY, level, this.gamemode);
        this.players.set(ws, p);
        this.usedIds.add(id);

        // Enable debug logging for this player
        DEBUG_PLAYER_IDS.add(id);
        logger.info(`[DEBUG] Player ID ${id} added to debug logging at (${spawnX},${spawnY})`);

        return p;
    }

    // Create a headless fake player (no websocket) at the given tile.
    addBot(spawnX: number, spawnY: number, level: number = 0): PlayerState | undefined {
        const id = this.allocatePlayerId();
        if (id === undefined) {
            logger.warn(
                `[bot] Failed to spawn bot: player id pool exhausted (max=${PlayerManager.MAX_SYNC_PLAYER_ID})`,
            );
            return undefined;
        }
        const p = new PlayerState(id, spawnX, spawnY, level, this.gamemode);
        // Assign a default Rune equipment appearance for bots so clients can
        // render a distinct look without guessing.
        // OSRS classic item ids used here; clients can ignore unknown slots.
        const botEquip = new Array<number>(14).fill(-1);
        botEquip[0] = 1163; // HEAD: rune full helm
        botEquip[3] = 1333; // WEAPON: rune scimitar
        botEquip[4] = 1127; // BODY: rune platebody
        botEquip[5] = 1201; // SHIELD: rune kiteshield
        botEquip[6] = 1079; // LEGS: rune platelegs
        botEquip[8] = 4131; // BOOTS: rune boots
        p.appearance = {
            gender: 0,
            headIcons: { prayer: -1 },
            equip: botEquip,
        };
        this.bots.push(p);
        this.usedIds.add(id);
        return p;
    }

    remove(ws: WebSocket): void {
        const p = this.players.get(ws);
        if (p) {
            p.visibleNpcIds.clear();
            p.clearInteraction();

            // Disable debug logging for this player
            DEBUG_PLAYER_IDS.delete(p.id);
            logger.info(`[DEBUG] Player ID ${p.id} removed from debug logging`);
            const id = p.id;
            if (id >= 1 && id <= PlayerManager.MAX_SYNC_PLAYER_ID) {
                this.freeIds.push(id);
                this.usedIds.delete(id);
            }
        }
        this.players.delete(ws);
        this.interactionSystem.removeSocket(ws);
    }

    /**
     * Agent-player attack entrypoint. Delegates to the interaction
     * system's `handleAgentNpcAttack` which types the player arg
     * correctly for headless bots / agents. Same return shape as the
     * ws-keyed `startNpcAttack` method.
     */
    attackNpcAsAgent(
        player: PlayerState,
        npc: import("./npc").NpcState,
        currentTick: number,
        modifierFlags?: number,
    ): { ok: boolean; message?: string; chatMessage?: string } {
        return this.interactionSystem.handleAgentNpcAttack(
            player,
            npc,
            currentTick,
            4,
            modifierFlags,
        );
    }

    /**
     * Remove a headless (bot / agent) player from the world.
     *
     * Complement to {@link addBot}. The bot-SDK calls this when an agent
     * disconnects and its save has been flushed: the PlayerState is pulled
     * out of `this.bots`, its id is returned to the pool, and any
     * interaction state is cleared so a subsequent spawn with the same
     * name isn't blocked by a lingering entity.
     *
     * Returns true if the bot was found and removed.
     */
    removeBot(player: PlayerState): boolean {
        const idx = this.bots.indexOf(player);
        if (idx < 0) return false;
        this.bots.splice(idx, 1);

        try {
            player.visibleNpcIds.clear();
            player.clearInteraction();
        } catch {
            // Defensive — if the player is already in a weird state,
            // don't let it block removal.
        }

        const id = player.id;
        if (id >= 1 && id <= PlayerManager.MAX_SYNC_PLAYER_ID) {
            this.freeIds.push(id);
            this.usedIds.delete(id);
        }
        return true;
    }

    get(ws: WebSocket): PlayerState | undefined {
        return this.players.get(ws);
    }

    /**
     * Get a player by their unique ID.
     * Used by PlayerCombatManager for player lookups.
     * Also checks orphaned players since they're still in the game world.
     */
    getPlayerById(playerId: number): PlayerState | undefined {
        const id = playerId;
        for (const p of this.players.values()) {
            if (p.id === id) return p;
        }
        for (const p of this.bots) {
            if (p.id === id) return p;
        }
        // Check orphaned players - they're still attackable
        for (const orphan of this.orphanedPlayers.values()) {
            if (orphan.player.id === id) return orphan.player;
        }
        return undefined;
    }

    /**
     * Orphan a player - keep them in the game world after disconnect.
     * Used when a player disconnects while in combat.
     * @param ws The websocket being disconnected
     * @param saveKey The player's save key for reconnection matching
     * @param currentTick The current game tick
     * @returns true if the player was orphaned, false if removed normally
     */
    orphanPlayer(ws: WebSocket, saveKey: string, currentTick: number): boolean {
        const player = this.players.get(ws);
        if (!player) return false;

        // Check if player should be orphaned (in combat)
        if (player.canLogout()) {
            // Safe to remove immediately - not in combat
            return false;
        }

        // Move to orphaned state
        this.orphanedPlayers.set(saveKey, {
            player,
            disconnectTick: currentTick,
            saveKey,
        });

        // Remove from active players map but keep player state alive
        this.players.delete(ws);
        this.interactionSystem.removeSocket(ws);

        logger.info(
            `[orphan] Player ${player.id} (${saveKey}) orphaned at tick ${currentTick} - in combat, staying in world`,
        );

        return true;
    }

    /**
     * Try to reconnect to an orphaned player.
     * @param ws The new websocket connection
     * @param saveKey The player's save key
     * @returns The orphaned player if found and reconnected, undefined otherwise
     */
    reconnectOrphanedPlayer(ws: WebSocket, saveKey: string): PlayerState | undefined {
        const orphan = this.orphanedPlayers.get(saveKey);
        if (!orphan) return undefined;

        // Reconnect - move player back to active
        this.players.set(ws, orphan.player);
        this.orphanedPlayers.delete(saveKey);

        logger.info(
            `[orphan] Player ${orphan.player.id} (${saveKey}) reconnected - resuming control`,
        );

        return orphan.player;
    }

    /**
     * Check if a player has an orphaned session.
     */
    hasOrphanedPlayer(saveKey: string): boolean {
        return this.orphanedPlayers.has(saveKey);
    }

    /**
     * Check if a username already has a live connected session.
     * Orphaned sessions are excluded so the same account can reclaim them.
     *
     * Bots (headless players, including agent-controlled ones) ARE included
     * so that a human login cannot hijack an agent's name while the agent
     * is active, and vice versa.
     */
    hasConnectedPlayer(username: string): boolean {
        const normalized = normalizePlayerAccountName(username);
        if (!normalized) return false;
        for (const player of this.players.values()) {
            if (normalizePlayerAccountName(player.name) === normalized) {
                return true;
            }
        }
        for (const bot of this.bots) {
            if (normalizePlayerAccountName(bot.name) === normalized) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get total player count (active + orphaned + bots).
     * Used for world capacity checks.
     */
    getTotalPlayerCount(): number {
        return this.players.size + this.orphanedPlayers.size + this.bots.length;
    }

    getRealPlayerCount(): number {
        return this.players.size + this.orphanedPlayers.size;
    }

    /**
     * Process orphaned players each tick.
     * Removes players who can now logout or have exceeded max orphan time.
     * @param currentTick The current game tick
     * @param onRemove Callback when an orphaned player is removed (for saving)
     */
    processOrphanedPlayers(
        currentTick: number,
        onRemove?: (player: PlayerState, saveKey: string) => void,
    ): void {
        const toRemove: string[] = [];

        for (const [saveKey, orphan] of this.orphanedPlayers) {
            const ticksSinceDisconnect = currentTick - orphan.disconnectTick;

            // Remove if: combat ended OR max timeout exceeded
            const canLogoutNow = orphan.player.canLogout();
            const maxTimeExceeded = ticksSinceDisconnect >= ORPHAN_MAX_TICKS;

            if (canLogoutNow || maxTimeExceeded) {
                toRemove.push(saveKey);
                const reason = maxTimeExceeded ? "max timeout" : "combat ended";
                logger.info(
                    `[orphan] Removing orphaned player ${orphan.player.id} (${saveKey}) - ${reason} after ${ticksSinceDisconnect} ticks`,
                );
            }
        }

        for (const saveKey of toRemove) {
            const orphan = this.orphanedPlayers.get(saveKey);
            if (orphan) {
                // Call removal callback (for saving state)
                onRemove?.(orphan.player, saveKey);

                // Free the player ID
                const id = orphan.player.id;
                if (id >= 1 && id <= PlayerManager.MAX_SYNC_PLAYER_ID) {
                    this.freeIds.push(id);
                    this.usedIds.delete(id);
                }

                // Clean up player state
                orphan.player.visibleNpcIds.clear();
                orphan.player.clearInteraction();
                DEBUG_PLAYER_IDS.delete(orphan.player.id);

                this.orphanedPlayers.delete(saveKey);
            }
        }
    }

    /**
     * Get all orphaned players (for iteration in game tick).
     */
    getOrphanedPlayers(): IterableIterator<OrphanedPlayer> {
        return this.orphanedPlayers.values();
    }

    getInteractionState(ws: WebSocket): PlayerInteractionState | undefined {
        return this.interactionSystem.getStateForSocket(ws);
    }

    // Expose whether a socket is following a specific player id (follow mode)
    isFollowingSocket(ws: WebSocket, targetId: number): boolean {
        return this.interactionSystem.isFollowingSocket(ws, targetId);
    }

    // Expose the interacting entity (target) for a given socket, if any
    getInteractingForSocket(
        ws: WebSocket,
    ): { targetId: number; mode: "follow" | "trade" | "combat" } | undefined {
        return this.interactionSystem.getInteractingForSocket(ws);
    }

    forEach(cb: (ws: WebSocket, p: PlayerState) => void): void {
        for (const [ws, p] of this.players.entries()) cb(ws, p);
    }

    /**
     * Iterate over all players including orphaned ones (for visibility/combat).
     * Orphaned players have null as their socket.
     */
    forEachIncludingOrphaned(cb: (ws: WebSocket | null, p: PlayerState) => void): void {
        for (const [ws, p] of this.players.entries()) cb(ws, p);
        for (const orphan of this.orphanedPlayers.values()) cb(null, orphan.player);
    }

    /**
     * Get all player states including orphaned (for player sync visibility).
     */
    getAllPlayersForSync(): PlayerState[] {
        const result: PlayerState[] = [];
        for (const p of this.players.values()) result.push(p);
        for (const orphan of this.orphanedPlayers.values()) result.push(orphan.player);
        for (const b of this.bots) result.push(b);
        return result;
    }

    forEachBot(cb: (p: PlayerState) => void): void {
        for (const p of this.bots) cb(p);
    }

    getById(id: number): PlayerState | undefined {
        let found: PlayerState | undefined;
        this.forEach((_, p) => {
            if (!found && p.id === id) found = p;
        });
        if (found) return found;
        for (const b of this.bots) if (b.id === id) return b;
        // Check orphaned players - they're still in the game world
        for (const orphan of this.orphanedPlayers.values()) {
            if (orphan.player.id === id) return orphan.player;
        }
        return undefined;
    }

    // Compute and assign a path for player's next walk command
    routePlayer(
        ws: WebSocket,
        to: Tile,
        run: boolean = false,
        currentTick?: number,
    ): { ok: boolean; message?: string; destinationCorrection?: Tile } {
        const p = this.players.get(ws);
        if (!p) return { ok: false, message: "player not found" };
        if (currentTick !== undefined && p.isMovementLocked(currentTick)) {
            return { ok: false, message: "movement_locked" };
        }
        if (!to || (to.x === p.tileX && to.y === p.tileY)) {
            p.clearWalkDestination();
            p.clearPath();
            return { ok: true };
        }
        // Note: Modal/dialog closing is now handled by closeInterruptibleInterfaces()
        // in wsServer before routePlayer() is called.
        p.setWalkDestination({ x: to.x, y: to.y }, !!run);
        // OSRS-style server-authoritative walking: pathfind in a local window and
        // re-run pathfinding as the player moves for long routes.
        const graphSize = Math.max(16, this.pathService.getGraphSize());
        const maxDelta = Math.max(1, (graphSize >> 1) - 3);
        const dxToDest = to.x - p.tileX;
        const dyToDest = to.y - p.tileY;
        const segmentDx = Math.max(-maxDelta, Math.min(maxDelta, dxToDest));
        const segmentDy = Math.max(-maxDelta, Math.min(maxDelta, dyToDest));
        const segmentTo: Tile = {
            x: p.tileX + segmentDx,
            y: p.tileY + segmentDy,
        };
        const t0 = Date.now();
        const res = this.pathService.findPathSteps(
            {
                from: { x: p.tileX, y: p.tileY, plane: p.level },
                to: segmentTo,
                size: 1,
                worldViewId: p.worldViewId,
            },
            { maxSteps: 128 },
        );
        const dt = Date.now() - t0;
        if (!res.ok || !res.steps || res.steps.length === 0) {
            p.clearWalkDestination();
            return { ok: false, message: res.message || "no path" };
        }

        // Optional debug logging: also compute the legacy "waypoints" view (turn-point compressed)
        // for easier inspection.
        let debugWaypoints: { x: number; y: number }[] | undefined;
        if (DEBUG_PLAYER_IDS.has(p.id)) {
            try {
                const wp = this.pathService.findPath({
                    from: { x: p.tileX, y: p.tileY, plane: p.level },
                    to: segmentTo,
                    size: 1,
                });
                if (wp.ok && wp.waypoints) debugWaypoints = wp.waypoints;
            } catch (err) { logger.warn("[player] failed to compute debug waypoints", err); }
        }

        if (DEBUG_PLAYER_IDS.has(p.id)) {
            try {
                const waypointStr = (debugWaypoints ?? [])
                    .map((wp) => `(${wp.x},${wp.y})`)
                    .join(" -> ");
                const tileStr = [`(${p.tileX},${p.tileY})`]
                    .concat(res.steps.map((step) => `(${step.x},${step.y})`))
                    .join(" -> ");
                logger.info(
                    `pathfind route: ${dt}ms ${p.tileX},${p.tileY} -> ${to.x},${to.y} waypoints=[${waypointStr}] tiles=[${tileStr}]`,
                );
            } catch (err) { logger.warn("[player] failed to log debug pathfind route", err); }
        }

        let destinationCorrection: Tile | undefined;
        const selectedEnd = res.end ?? res.steps[res.steps.length - 1]!;
        const isFinalSegment = segmentTo.x === to.x && segmentTo.y === to.y;
        if (isFinalSegment && (selectedEnd.x !== segmentTo.x || selectedEnd.y !== segmentTo.y)) {
            destinationCorrection = { x: selectedEnd.x, y: selectedEnd.y };
            p.setWalkDestination(destinationCorrection, !!run);
        }

        const shouldRun = p.energy.resolveRequestedRun(run);
        p.setPathPreservingWalkDestination(res.steps, shouldRun);
        this.interactionSystem.handleManualMovement(ws, { x: to.x, y: to.y });

        return { ok: true, destinationCorrection };
    }

    /**
     * Walk a headless agent player toward a tile.
     *
     * Parallel path to {@link routePlayer} for agents (which have no
     * WebSocket). Performs the same pathfinding + setPath work, then
     * delegates interaction cleanup to
     * {@link PlayerInteractionSystem.handleAgentMovement}. This keeps the
     * human walking code path completely untouched: a subtle regression
     * here affects only agent players.
     *
     * The logic intentionally duplicates `routePlayer`'s path-building.
     * Factoring out the shared core is a future refactor; for now the
     * copy is small and the parallel path is the safest option.
     */
    moveAgent(
        p: PlayerState,
        to: Tile,
        run: boolean = false,
        currentTick?: number,
    ): { ok: boolean; message?: string; destinationCorrection?: Tile } {
        if (currentTick !== undefined && p.isMovementLocked(currentTick)) {
            return { ok: false, message: "movement_locked" };
        }
        if (!to || (to.x === p.tileX && to.y === p.tileY)) {
            p.clearWalkDestination();
            p.clearPath();
            return { ok: true };
        }

        p.setWalkDestination({ x: to.x, y: to.y }, !!run);

        // Same segmented pathfinding window the human client uses.
        const graphSize = Math.max(16, this.pathService.getGraphSize());
        const maxDelta = Math.max(1, (graphSize >> 1) - 3);
        const dxToDest = to.x - p.tileX;
        const dyToDest = to.y - p.tileY;
        const segmentDx = Math.max(-maxDelta, Math.min(maxDelta, dxToDest));
        const segmentDy = Math.max(-maxDelta, Math.min(maxDelta, dyToDest));
        const segmentTo: Tile = {
            x: p.tileX + segmentDx,
            y: p.tileY + segmentDy,
        };

        const res = this.pathService.findPathSteps(
            {
                from: { x: p.tileX, y: p.tileY, plane: p.level },
                to: segmentTo,
                size: 1,
                worldViewId: p.worldViewId,
            },
            { maxSteps: 128 },
        );

        if (!res.ok || !res.steps || res.steps.length === 0) {
            p.clearWalkDestination();
            return { ok: false, message: res.message || "no path" };
        }

        let destinationCorrection: Tile | undefined;
        const selectedEnd = res.end ?? res.steps[res.steps.length - 1]!;
        const isFinalSegment = segmentTo.x === to.x && segmentTo.y === to.y;
        if (isFinalSegment && (selectedEnd.x !== segmentTo.x || selectedEnd.y !== segmentTo.y)) {
            destinationCorrection = { x: selectedEnd.x, y: selectedEnd.y };
            p.setWalkDestination(destinationCorrection, !!run);
        }

        const shouldRun = p.energy.resolveRequestedRun(run);
        p.setPathPreservingWalkDestination(res.steps, shouldRun);
        this.interactionSystem.handleAgentMovement(p);

        return { ok: true, destinationCorrection };
    }

    continueWalkToDestination(
        player: PlayerState,
        currentTick: number,
    ): { destinationCorrection?: Tile } | void {
        const target = player.getWalkDestination();
        if (!target) return;
        if (player.tileX === target.x && player.tileY === target.y) {
            player.clearWalkDestination();
            return;
        }
        if (player.hasPath()) {
            return;
        }
        if (player.isMovementLocked(currentTick)) {
            return;
        }
        if (currentTick < player.getWalkRepathAfterTick()) {
            return;
        }

        const graphSize = Math.max(16, this.pathService.getGraphSize());
        const maxDelta = Math.max(1, (graphSize >> 1) - 3);
        const dxToDest = target.x - player.tileX;
        const dyToDest = target.y - player.tileY;
        const segmentDx = Math.max(-maxDelta, Math.min(maxDelta, dxToDest));
        const segmentDy = Math.max(-maxDelta, Math.min(maxDelta, dyToDest));

        if (segmentDx === 0 && segmentDy === 0) {
            player.clearWalkDestination();
            return;
        }
        const segmentTo: Tile = {
            x: player.tileX + segmentDx,
            y: player.tileY + segmentDy,
        };

        const res = this.pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: segmentTo,
                size: 1,
            },
            { maxSteps: 128 },
        );
        if (!res.ok || !res.steps || res.steps.length === 0) {
            // Avoid hammering the pathfinder every tick if a segment is temporarily blocked.
            // A 1-tick backoff matches movement cadence better and avoids visible 1-tick stalls.
            player.setWalkRepathAfterTick(currentTick + 1);
            return;
        }

        let destinationCorrection: Tile | undefined;
        const selectedEnd = res.end ?? res.steps[res.steps.length - 1]!;
        const isFinalSegment = segmentTo.x === target.x && segmentTo.y === target.y;
        if (isFinalSegment && (selectedEnd.x !== segmentTo.x || selectedEnd.y !== segmentTo.y)) {
            destinationCorrection = { x: selectedEnd.x, y: selectedEnd.y };
            player.setWalkDestination(destinationCorrection, !!target.run);
        }

        const shouldRun = player.energy.resolveRequestedRun(!!target.run);
        player.setPathPreservingWalkDestination(res.steps, shouldRun);
        if (destinationCorrection) {
            return { destinationCorrection };
        }
    }

    routeBot(p: PlayerState, to: Tile, run: boolean = false): { ok: boolean; message?: string } {
        const res = this.pathService.findPathSteps(
            { from: { x: p.tileX, y: p.tileY, plane: p.level }, to, size: 1 },
            { maxSteps: 128 },
        );
        if (!res.ok || !res.steps || res.steps.length === 0)
            return { ok: false, message: res.message || "no path" };
        p.setPath(res.steps, run);
        return { ok: true };
    }

    tickBots(currentTick?: number): void {
        for (const p of this.bots) {
            if (currentTick !== undefined) {
                p.processTimersAndQueue();
                p.skillSystem.tickHitpoints(currentTick);
                p.skillSystem.tickSkillRestoration(currentTick);
                p.specEnergy.tick(currentTick);
                p.setMovementTick(currentTick);
            }
            p.tickStep();
        }
    }

    startFollowing(
        ws: WebSocket,
        targetId: number,
        mode: FollowInteractionKind,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        return this.interactionSystem.startFollowing(ws, targetId, mode, modifierFlags);
    }

    stopFollowing(ws: WebSocket): void {
        this.interactionSystem.stopFollowing(ws);
    }

    startNpcInteraction(
        ws: WebSocket,
        npc: NpcState,
        option?: string,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        return this.interactionSystem.startNpcInteraction(ws, npc, option, modifierFlags);
    }

    startNpcAttack(
        ws: WebSocket,
        npc: NpcState,
        currentTick: number,
        attackDelay: number = 4,
        modifierFlags?: number,
    ): { ok: boolean; message?: string; chatMessage?: string } {
        return this.interactionSystem.startNpcAttack(
            ws,
            npc,
            currentTick,
            attackDelay,
            modifierFlags,
        );
    }

    stopNpcAttack(ws: WebSocket): void {
        this.interactionSystem.stopNpcAttack(ws);
    }

    finishNpcCombatByPlayerId(playerId: number, npcId?: number): void {
        this.interactionSystem.finishNpcCombatByPlayerId(playerId, npcId);
    }

    stopNpcInteraction(ws: WebSocket): void {
        this.interactionSystem.stopNpcInteraction(ws);
    }

    /**
     * Clears all interaction state for a socket.
     * RSMod parity: Called when player walks to fully clear combat/interaction state.
     */
    clearAllInteractions(ws: WebSocket): void {
        this.interactionSystem.clearAllInteractions(ws);
    }

    updateFollowing(currentTick: number = 0): void {
        this.interactionSystem.updateFollowing(currentTick);
    }

    updateNpcInteractions(tick: number, npcLookup: (npcId: number) => NpcState | undefined): void {
        this.interactionSystem.updateNpcInteractions(tick, npcLookup);
    }

    applyInteractionFacing(
        ws: WebSocket,
        player: PlayerState,
        npcLookup: (npcId: number) => NpcState | undefined,
        currentTick?: number,
    ): void {
        this.interactionSystem.applyInteractionFacing(ws, player, npcLookup, currentTick);
    }

    startPlayerCombat(ws: WebSocket, targetPlayerId: number, untilTick?: number): void {
        this.interactionSystem.startPlayerCombat(ws, targetPlayerId, untilTick);
    }

    stopPlayerCombat(ws: WebSocket): void {
        this.interactionSystem.stopPlayerCombat(ws);
    }

    updatePlayerAttacks(
        tick: number,
        requestAttack: (
            player: PlayerState,
            target: PlayerState,
            attackDelay: number,
            currentTick: number,
        ) => boolean,
        opts?: {
            pickPlayerAttackDelay?: (player: PlayerState, target: PlayerState) => number;
        },
    ): void {
        this.interactionSystem.updatePlayerAttacks(tick, requestAttack, opts);
    }

    // Record a pending object (loc) interaction for a socket. Server will log upon proximity.
    startLocInteract(
        ws: WebSocket,
        data: {
            id: number;
            tile: { x: number; y: number };
            level?: number;
            action?: string;
            modifierFlags?: number;
        },
        currentTick?: number,
    ): void {
        this.interactionSystem.startLocInteractAtTick(ws, data, currentTick);
    }

    startGroundItemInteraction(
        ws: WebSocket,
        data: {
            itemId: number;
            stackId: number;
            tileX: number;
            tileY: number;
            tileLevel: number;
            option: string;
            modifierFlags?: number;
        },
    ): void {
        this.interactionSystem.startGroundItemInteraction(ws, data);
    }

    // Check pending object interactions; log when player is near enough (secure server-side check).
    updateLocInteractions(currentTick?: number): void {
        this.interactionSystem.updateLocInteractions(currentTick);
    }

    updateGroundItemInteractions(tick: number): void {
        this.interactionSystem.updateGroundItemInteractions(tick);
    }

    // Clear all player interactions with a specific NPC (e.g., when NPC dies)
    clearInteractionsWithNpc(npcId: number): void {
        this.interactionSystem.clearInteractionsWithNpc(npcId);
    }

    // Resolve reservations for up to two sub-steps (run) this tick to handle swaps/conflicts.
    resolveMoveReservations(): void {
        type Actor = {
            p: PlayerState;
            id: number;
            ws?: WebSocket;
            curX: number;
            curY: number;
            intends1?: { x: number; y: number };
            intends2?: { x: number; y: number };
            runningNow: boolean;
            isBot: boolean;
            pid: number;
        };
        const actors: Actor[] = [];
        const key = (x: number, y: number) => `${x},${y}`;
        // Helper to read queued steps safely
        const peek = (p: PlayerState, idx: number): { x: number; y: number } | undefined => {
            const q = p.getPathQueue();
            if (idx < 0 || idx >= q.length) return undefined;
            const s = q[idx];
            return s ? { x: s.x, y: s.y } : undefined;
        };
        // Collect socket-backed players
        for (const [ws, p] of this.players.entries()) {
            const runningNow = p.energy.resolveRequestedRun(!!p.running);
            const i1 = peek(p, 0);
            const i2 = runningNow ? peek(p, 1) : undefined;
            actors.push({
                p,
                id: p.id,
                ws,
                curX: p.tileX,
                curY: p.tileY,
                intends1: i1,
                intends2: i2,
                runningNow,
                isBot: false,
                pid: p.getPidPriority(),
            });
        }
        // Collect bots as well
        for (const p of this.bots) {
            const runningNow = p.energy.resolveRequestedRun(!!p.running);
            const i1 = peek(p, 0);
            const i2 = runningNow ? peek(p, 1) : undefined;
            actors.push({
                p,
                id: p.id,
                ws: undefined,
                curX: p.tileX,
                curY: p.tileY,
                intends1: i1,
                intends2: i2,
                runningNow,
                isBot: true,
                pid: p.getPidPriority(),
            });
        }

        const blocksActor = (blocker: Actor | undefined, target: Actor): boolean => {
            // Requirement: bots should never block player movement.
            if (blocker?.isBot && !!target.ws) return false;
            return !!blocker;
        };

        // Pass 1: resolve first sub-step
        const byCur1 = new Map<string, Actor>();
        const byDest1 = new Map<string, Actor[]>();
        for (const a of actors) {
            byCur1.set(key(a.curX, a.curY), a);
            if (a.intends1) {
                const arr = byDest1.get(key(a.intends1.x, a.intends1.y)) || [];
                arr.push(a);
                byDest1.set(key(a.intends1.x, a.intends1.y), arr);
            }
        }
        const allow1 = new Set<Actor>();
        const block1 = new Set<Actor>();
        // Swaps for step1
        for (const a of actors) {
            if (!a.intends1) continue;
            const b = byCur1.get(key(a.intends1.x, a.intends1.y));
            if (!b || !b.intends1) continue;
            if (b.intends1.x === a.curX && b.intends1.y === a.curY) {
                allow1.add(a);
                allow1.add(b);
            }
        }
        // Conflicts per dest for step1
        for (const [_, list] of byDest1.entries()) {
            const remaining = list.filter((a) => !allow1.has(a));
            if (remaining.length <= 0) continue;
            remaining.sort((a, b) => {
                // Prefer real players over bots, then running, then PID priority
                const pa = a.isBot ? 1 : 0;
                const pb = b.isBot ? 1 : 0;
                if (pa !== pb) return pa - pb;
                const ra = a.runningNow ? 1 : 0;
                const rb = b.runningNow ? 1 : 0;
                if (ra !== rb) return rb - ra;
                const pidDelta = a.pid - b.pid;
                if (pidDelta !== 0) return pidDelta;
                return a.id - b.id;
            });
            allow1.add(remaining[0]);
            for (let i = 1; i < remaining.length; i++) block1.add(remaining[i]);
        }
        // Occupancy for step1: allow stepping into tiles occupied by other players (stacking permitted).
        // Intentionally do not block when destination currently has an occupant.

        // Dynamic diagonal clipping for step1: block diagonals when side tiles remain occupied.
        for (const a of actors) {
            if (!a.intends1) continue;
            const dx = a.intends1.x - a.curX;
            const dy = a.intends1.y - a.curY;
            if (dx === 0 || dy === 0) continue;
            const sideKeys = [key(a.curX, a.intends1.y), key(a.intends1.x, a.curY)];
            let blocked = false;
            for (const sideKey of sideKeys) {
                const occ = byCur1.get(sideKey);
                if (!occ || occ === a) continue;
                if (!blocksActor(occ, a)) continue;
                const occMoves =
                    occ.intends1 &&
                    allow1.has(occ) &&
                    (occ.intends1.x !== occ.curX || occ.intends1.y !== occ.curY);
                if (!occMoves) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) {
                allow1.delete(a);
                block1.add(a);
            }
        }

        // Positions after first sub-step
        const after1Pos = new Map<Actor, { x: number; y: number }>();
        for (const a of actors) {
            if (a.intends1 && allow1.has(a)) after1Pos.set(a, { x: a.intends1.x, y: a.intends1.y });
            else after1Pos.set(a, { x: a.curX, y: a.curY });
        }

        // Pass 2: resolve second sub-step (runners only)
        const byCur2 = new Map<string, Actor>();
        const byDest2 = new Map<string, Actor[]>();
        for (const a of actors) {
            const pos = after1Pos.get(a)!;
            byCur2.set(key(pos.x, pos.y), a);
            if (a.intends2) {
                const arr = byDest2.get(key(a.intends2.x, a.intends2.y)) || [];
                arr.push(a);
                byDest2.set(key(a.intends2.x, a.intends2.y), arr);
            }
        }
        const allow2 = new Set<Actor>();
        const block2 = new Set<Actor>();
        // Swaps for step2 (using after1 positions)
        for (const a of actors) {
            if (!a.intends2) continue;
            const aPos = after1Pos.get(a)!;
            const b = byCur2.get(key(a.intends2.x, a.intends2.y));
            if (!b || !b.intends2) continue;
            const bPos = after1Pos.get(b)!;
            if (b.intends2.x === aPos.x && b.intends2.y === aPos.y) {
                allow2.add(a);
                allow2.add(b);
            }
        }
        // Conflicts per dest for step2
        for (const [_, list] of byDest2.entries()) {
            // Fast-path: if exactly one actor targets this dest and it wasn't already allowed by swap logic,
            // grant it now. This avoids needlessly blocking the second sub-step for lone runners.
            if (list.length === 1 && !allow2.has(list[0])) {
                allow2.add(list[0]);
                continue;
            }
            const remaining = list.filter((a) => !allow2.has(a));
            if (remaining.length <= 0) continue;
            // All are runners here; tie-break by PID priority
            remaining.sort((a, b) => {
                const pa = a.isBot ? 1 : 0;
                const pb = b.isBot ? 1 : 0;
                if (pa !== pb) return pa - pb;
                const pidDelta = a.pid - b.pid;
                if (pidDelta !== 0) return pidDelta;
                return a.id - b.id;
            });
            allow2.add(remaining[0]);
            for (let i = 1; i < remaining.length; i++) block2.add(remaining[i]);
        }
        // Occupancy for step2: allow stepping into tiles occupied by other players (stacking permitted).

        // Dynamic diagonal clipping for step2: block diagonals when side tiles remain occupied.
        for (const a of actors) {
            if (!a.intends2) continue;
            const pos = after1Pos.get(a)!;
            const dx = a.intends2.x - pos.x;
            const dy = a.intends2.y - pos.y;
            if (dx === 0 || dy === 0) continue;
            const sideKeys = [key(pos.x, a.intends2.y), key(a.intends2.x, pos.y)];
            let blocked = false;
            for (const sideKey of sideKeys) {
                const occ = byCur2.get(sideKey);
                if (!occ || occ === a) continue;
                if (!blocksActor(occ, a)) continue;
                const occPos = after1Pos.get(occ)!;
                const occMoves =
                    occ.intends2 &&
                    allow2.has(occ) &&
                    (occ.intends2.x !== occPos.x || occ.intends2.y !== occPos.y);
                if (!occMoves) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) {
                allow2.delete(a);
                block2.add(a);
            }
        }

        // Prevent running into an occupied tile when the occupant is not leaving this sub-step.
        for (const a of actors) {
            if (!a.intends2) continue;
            const destActor = byCur2.get(key(a.intends2.x, a.intends2.y));
            if (!destActor || destActor === a) continue;
            if (!blocksActor(destActor, a)) continue;
            const destPos = after1Pos.get(destActor)!;
            const destLeaves =
                destActor.intends2 &&
                allow2.has(destActor) &&
                (destActor.intends2.x !== destPos.x || destActor.intends2.y !== destPos.y);
            if (!destLeaves) {
                allow2.delete(a);
                block2.add(a);
            }
        }

        // Write reservations
        for (const a of actors) {
            if (a.intends1) {
                if (allow1.has(a)) a.p.nextStepReservation1 = { x: a.intends1.x, y: a.intends1.y };
                else if (block1.has(a)) a.p.nextStepReservation1 = null;
                else a.p.nextStepReservation1 = { x: a.intends1.x, y: a.intends1.y };
            } else {
                a.p.nextStepReservation1 = undefined;
            }
            if (a.intends2) {
                if (allow2.has(a)) a.p.nextStepReservation2 = { x: a.intends2.x, y: a.intends2.y };
                else if (block2.has(a)) a.p.nextStepReservation2 = null;
                else a.p.nextStepReservation2 = { x: a.intends2.x, y: a.intends2.y };
            } else {
                a.p.nextStepReservation2 = undefined;
            }
        }
    }

    getSocketByPlayerId(id: number): WebSocket | undefined {
        for (const [ws, p] of this.players.entries()) if (p.id === id) return ws;
        return undefined;
    }

    private routePlayerToNpc(player: PlayerState, npc: NpcState): boolean {
        return this.interactionSystem.routePlayerToNpc(player, npc);
    }

    private computeOrientationWorld(ox: number, oy: number, tx: number, ty: number): number {
        return this.interactionSystem.computeOrientationWorld(ox, oy, tx, ty);
    }
}

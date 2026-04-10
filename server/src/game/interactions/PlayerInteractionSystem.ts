import type { LocTypeLoader } from "../../../../src/rs/config/loctype/LocTypeLoader";
import { faceAngleRs } from "../../../../src/rs/utils/rotation";
import type { WebSocket } from "ws";
import {
    MODIFIER_FLAG_CTRL,
    MODIFIER_FLAG_CTRL_SHIFT,
} from "../../../../src/shared/input/modifierFlags";
import { hasDirectReachToArea } from "../../pathfinding/DirectReach";
import { PathService } from "../../pathfinding/PathService";
import {
    ExactRouteStrategy,
    RectAdjacentRouteStrategy,
} from "../../pathfinding/legacy/pathfinder/RouteStrategy";
import { CollisionFlag } from "../../pathfinding/legacy/pathfinder/flag/CollisionFlag";
import { logger } from "../../utils/logger";
import { DoorStateManager } from "../../world/DoorStateManager";
import { Actor } from "../actor";
import { NpcState } from "../npc";
import { PlayerState } from "../player";
import type { ScriptRuntime } from "../scripts/ScriptRuntime";
import { FollowingHandler } from "./FollowingHandler";
import { LocInteractionHandler } from "./LocInteractionHandler";
import { NpcCombatInteractionHandler } from "./NpcCombatInteractionHandler";
import {
    FollowInteractionKind,
    GroundItemInteractionState,
    InteractionTickNpcLookup,
    NpcInteractPassiveState,
    PendingLocInteraction,
    PlayerInteractionState,
} from "./types";

/**
 * Calculates the Chebyshev distance from a point to the nearest tile of a rectangular entity.
 *
 * For an NPC with size > 1, this finds the distance to the nearest tile of the NPC's
 * bounding box, not to its origin. This is essential for proper attack range checks.
 *
 * Example: 2x2 NPC at origin (10,10) occupies tiles (10,10), (11,10), (10,11), (11,11)
 * Player at (12,10) is distance 1 from tile (11,10), not distance 2 from origin.
 *
 * @returns The Chebyshev distance (max of dx, dy) to the nearest bounding box edge
 */
function distanceToNpcBounds(
    px: number,
    py: number,
    npcX: number,
    npcY: number,
    npcSize: number,
): number {
    const minX = npcX;
    const minY = npcY;
    const maxX = minX + Math.max(1, npcSize) - 1;
    const maxY = minY + Math.max(1, npcSize) - 1;

    // Clamp player position to NPC bounds to find nearest edge
    const clampedX = Math.max(minX, Math.min(px, maxX));
    const clampedY = Math.max(minY, Math.min(py, maxY));

    const dx = Math.abs(clampedX - px);
    const dy = Math.abs(clampedY - py);

    return Math.max(dx, dy);
}

export interface PlayerRepository {
    get(ws: WebSocket): PlayerState | undefined;
    getById(id: number): PlayerState | undefined;
    getSocketByPlayerId(id: number): WebSocket | undefined;
    forEach(cb: (ws: WebSocket, player: PlayerState) => void): void;
    forEachBot(cb: (player: PlayerState) => void): void;
}

export class PlayerInteractionSystem {
    private readonly interactions = new Map<WebSocket, PlayerInteractionState>();
    private readonly pendingLocInteractions = new Map<WebSocket, PendingLocInteraction>();
    private readonly locHandler: LocInteractionHandler;
    private readonly followingHandler: FollowingHandler;
    private readonly npcCombatHandler: NpcCombatInteractionHandler;
    private onLocChange?: (
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
    ) => void;
    private onTradeHandshake?: (initiator: PlayerState, target: PlayerState, tick: number) => void;
    private onGroundItemInteraction?: (
        player: PlayerState,
        interaction: GroundItemInteractionState,
    ) => void;
    private onGameMessage?: (player: PlayerState, text: string) => void;
    /**
     * Callback to interrupt/cancel all queued skill actions for a player.
     * Called when player walks, starts a new interaction, teleports, etc.
     */
    private onInterruptSkillActions?: (playerId: number) => void;
    /**
     * Callback to stop auto-attack in PlayerCombatManager when player walks.
     */
    private onStopAutoAttack?: (playerId: number) => void;
    /**
     * Callback to validate whether player can initiate NPC combat this tick.
     */
    private canStartNpcCombat?: (
        attacker: PlayerState,
        npc: NpcState,
        currentTick: number,
    ) => { allowed: boolean; reason?: string };

    constructor(
        private readonly players: PlayerRepository,
        private readonly pathService: PathService,
        private readonly locTypeLoader?: LocTypeLoader,
        private readonly doorManager?: DoorStateManager,
        private readonly scriptRuntime?: ScriptRuntime,
    ) {
        this.followingHandler = new FollowingHandler(players, pathService, this.interactions, {
            onTradeHandshake: (...args) => this.onTradeHandshake?.(...args),
            onStopAutoAttack: (id) => this.onStopAutoAttack?.(id),
            onInterruptSkillActions: (id) => this.onInterruptSkillActions?.(id),
        });

        this.locHandler = new LocInteractionHandler(
            players,
            pathService,
            locTypeLoader,
            doorManager,
            scriptRuntime,
            this.pendingLocInteractions,
            {
                onLocChange: (...args) => this.onLocChange?.(...args),
                onGameMessage: (...args) => this.onGameMessage?.(...args),
                onInterruptSkillActions: (id) => this.onInterruptSkillActions?.(id),
            },
            {
                replaceInteractionState: (ws, player) => this.replaceInteractionState(ws, player),
                interruptSkillActions: (id) => this.interruptSkillActions(id),
                normalizeModifierFlags: (raw) => this.normalizeModifierFlags(raw),
                resolveRunMode: (player, flags) => this.resolveRunMode(player, flags),
                extractValidatedStrategyPathSteps: (actor, res, strategy) =>
                    this.extractValidatedStrategyPathSteps(actor, res, strategy),
                applyPathSteps: (actor, steps, run) => this.applyPathSteps(actor, steps, run),
                routePlayerToTile: (player, tile, run) => this.routePlayerToTile(player, tile, run),
                findReachableAdjacency: (from, tile, sizeX, sizeY, level) =>
                    this.findReachableAdjacency(from, tile, sizeX, sizeY, level),
            },
        );

        this.npcCombatHandler = new NpcCombatInteractionHandler(
            players,
            pathService,
            this.interactions,
            (id) => this.onStopAutoAttack?.(id),
            (id) => this.onInterruptSkillActions?.(id),
            (attacker, npc, tick) => this.canStartNpcCombat?.(attacker, npc, tick) ?? { allowed: true },
            (raw) => this.normalizeModifierFlags(raw),
            (player, flags) => this.resolveRunMode(player, flags),
            (ws, player) => this.replaceInteractionState(ws, player),
            (player, tile, run) => this.routePlayerToTile(player, tile, run),
            (player, tile) => this.findPlayerPathToTile(player, tile),
            (player, steps, run) => this.applyPathSteps(player, steps, run),
            (actor, res, strategy) => this.extractValidatedStrategyPathSteps(actor, res, strategy),
            (from, to, sizeX, sizeY, level) =>
                this.hasDirectReach(from, to, sizeX, sizeY, level),
            (cb) => this.forEachInteraction(cb),
        );
    }

    private normalizeModifierFlags(raw: number | undefined): number {
        const normalized = raw ?? 0;
        if (normalized === MODIFIER_FLAG_CTRL_SHIFT) {
            return MODIFIER_FLAG_CTRL_SHIFT;
        }
        return (normalized & MODIFIER_FLAG_CTRL) !== 0 ? MODIFIER_FLAG_CTRL : 0;
    }

    private resolveRunMode(player: PlayerState, modifierFlags?: number): boolean {
        let run = player.energy.wantsToRun();
        const flags = this.normalizeModifierFlags(modifierFlags);
        if ((flags & MODIFIER_FLAG_CTRL) !== 0) {
            run = !run;
        }
        if (flags === MODIFIER_FLAG_CTRL_SHIFT) {
            run = true;
        }
        return player.energy.resolveRequestedRun(run);
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
        this.onLocChange = callback;
    }

    setTradeHandshakeCallback(
        callback: (initiator: PlayerState, target: PlayerState, tick: number) => void,
    ): void {
        this.onTradeHandshake = callback;
    }

    setGroundItemInteractionCallback(
        callback: (player: PlayerState, interaction: GroundItemInteractionState) => void,
    ): void {
        this.onGroundItemInteraction = callback;
    }

    setGameMessageCallback(callback: (player: PlayerState, text: string) => void): void {
        this.onGameMessage = callback;
    }

    /**
     * Set callback for interrupting skill actions.
     * This is called when player walks, starts new interaction, teleports, etc.
     */
    setInterruptSkillActionsCallback(callback: (playerId: number) => void): void {
        this.onInterruptSkillActions = callback;
    }

    /**
     * Set callback to stop auto-attack in PlayerCombatManager when player walks.
     * This is called when clearAllInteractions() is invoked during an active npcCombat.
     */
    setStopAutoAttackCallback(callback: (playerId: number) => void): void {
        this.onStopAutoAttack = callback;
    }

    /**
     * Set callback to validate NPC combat start eligibility (single/multi combat rules).
     */
    setNpcCombatPermissionCallback(
        callback: (
            attacker: PlayerState,
            npc: NpcState,
            currentTick: number,
        ) => { allowed: boolean; reason?: string },
    ): void {
        this.canStartNpcCombat = callback;
    }

    /**
     * Interrupt all queued skill actions for a player.
     * Called when any action that should cancel skilling occurs.
     */
    interruptSkillActions(playerId: number): void {
        this.onInterruptSkillActions?.(playerId);
    }

    isFollowingSocket(ws: WebSocket, targetId: number): boolean {
        return this.followingHandler.isFollowingSocket(ws, targetId);
    }

    getInteractingForSocket(
        ws: WebSocket,
    ): { targetId: number; mode: FollowInteractionKind | "combat" } | undefined {
        const player = this.players.get(ws);
        const interaction = player?.getInteractionTarget();
        if (!interaction) return undefined;
        const state = this.interactions.get(ws);
        let mode: FollowInteractionKind | "combat" = "combat";
        if (state && (state.kind === FollowInteractionKind.Follow || state.kind === FollowInteractionKind.Trade)) {
            mode = state.kind;
        }
        return { targetId: interaction.id, mode };
    }

    getInteraction(ws: WebSocket): PlayerInteractionState | undefined {
        return this.interactions.get(ws);
    }

    forEachInteraction(cb: (ws: WebSocket, state: PlayerInteractionState) => void): void {
        for (const [ws, state] of this.interactions.entries()) {
            cb(ws, state);
        }
    }

    removeSocket(ws: WebSocket): void {
        this.interactions.delete(ws);
        this.pendingLocInteractions.delete(ws);
    }

    /**
     * Clears all interaction state for a socket.
     * RSMod parity: Called alongside player.resetInteractions() when player walks
     * and whenever a new click intent replaces an old one.
     *
     * IMPORTANT: For NPC combat, we preserve the intent state here.
     * Walking away should stop auto-attack in PlayerCombatManager without immediately
     * deleting the combat-facing intent.
     */
    clearAllInteractions(ws: WebSocket): void {
        const st = this.interactions.get(ws);
        if (st) {
            // Clear RSMod-style attributes on the player
            const me = this.players.get(ws);
            if (me) {
                me.combat.removeCombatTarget();
                me.combat.setInteractingNpc(null);
                me.combat.setInteractingPlayer(null);
            }

            if (st.kind === "npcCombat") {
                if (me) {
                    this.onStopAutoAttack?.(me.id);
                }
                this.pendingLocInteractions.delete(ws);
                return;
            }
        }
        this.interactions.delete(ws);
        this.pendingLocInteractions.delete(ws);
    }

    /**
     * Replace any in-flight interaction intent with a new one.
     * Mirrors RSMod-style click semantics:
     * - interrupt queued tasks
     * - reset player interaction attributes
     * - clear interaction-system state maps
     */
    private replaceInteractionState(ws: WebSocket, player: PlayerState): void {
        try {
            player.interruptQueues();
        } catch (err) { logger.warn("[interaction] failed to interrupt queues", err); }
        try {
            player.resetInteractions();
        } catch (err) { logger.warn("[interaction] failed to reset interactions", err); }
        this.clearAllInteractions(ws);
    }

    clearInteractionsWithNpc(npcId: number): void {
        const toRemove: WebSocket[] = [];
        for (const [ws, interaction] of this.interactions.entries()) {
            if (interaction.kind === "npcCombat" && interaction.npcId === npcId) {
                toRemove.push(ws);
            } else if (interaction.kind === "npcInteract" && interaction.npcId === npcId) {
                toRemove.push(ws);
            }
        }
        for (const ws of toRemove) {
            const player = this.players.get(ws);
            if (player) {
                player.clearInteractionTarget();
                player.combat.removeCombatTarget();
                player.combat.setInteractingNpc(null);
            }
            this.interactions.delete(ws);
        }
    }

    getStateForSocket(ws: WebSocket): PlayerInteractionState | undefined {
        return this.interactions.get(ws);
    }

    startFollowing(
        ws: WebSocket,
        targetId: number,
        mode: FollowInteractionKind,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        return this.followingHandler.startFollowing(ws, targetId, mode, modifierFlags);
    }

    stopFollowing(ws: WebSocket): void {
        this.followingHandler.stopFollowing(ws);
    }

    startNpcInteraction(
        ws: WebSocket,
        npc: NpcState,
        option?: string,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        const me = this.players.get(ws);
        if (!me) return { ok: false, message: "player not found" };
        if (!npc) return { ok: false, message: "npc not found" };
        if (npc.getHitpoints() <= 0) return { ok: false, message: "npc_dead" };

        // Block interactions during tutorial (gamemode can override per NPC)
        if (!me.canInteract()) {
            const normalizedOption = String(option ?? "").trim().toLowerCase();
            const allowed = me.gamemode.canInteractWithNpc?.(
                me, npc.typeId, normalizedOption,
            ) ?? false;
            if (!allowed) {
                return { ok: false, message: "interaction_blocked" };
            }
        }

        // Starting a new NPC interaction cancels any active skill actions
        this.interruptSkillActions(me.id);
        this.replaceInteractionState(ws, me);

        logger.info?.(
            `[npc] start interaction player=${me.id} opt=${option ?? "Talk-to"} npc=${
                npc.id
            } type=${npc.typeId} playerPos=(${me.tileX},${me.tileY},${me.level}) npcPos=(${
                npc.tileX
            },${npc.tileY},${npc.level})`,
        );

        const existing = this.interactions.get(ws);
        if (existing) {
            if (existing.kind === "npcCombat") {
                this.stopNpcAttack(ws);
            } else if (existing.kind === FollowInteractionKind.Follow || existing.kind === FollowInteractionKind.Trade) {
                this.stopFollowing(ws);
            } else if (existing.kind === "npcInteract") {
                this.interactions.delete(ws);
            }
        }

        const state: NpcInteractPassiveState = {
            kind: "npcInteract",
            npcId: npc.id,
            option,
            modifierFlags: this.normalizeModifierFlags(modifierFlags),
            lastRouteTick: Number.MIN_SAFE_INTEGER,
            lastNpcTileX: npc.tileX,
            lastNpcTileY: npc.tileY,
            completedAt: undefined,
        };

        this.interactions.set(ws, state);

        const npcSize = Math.max(1, npc.size);
        const strategy = new RectAdjacentRouteStrategy(npc.tileX, npc.tileY, npcSize, npcSize);
        // Set collision getter so hasArrived() checks for walls
        strategy.setCollisionGetter(
            (x, y, p) => this.pathService.getCollisionFlagAt(x, y, p),
            me.level,
        );
        const arrived = strategy.hasArrived(me.tileX, me.tileY, me.level);
        if (arrived) {
            // Player is adjacent AND no wall blocks - can interact immediately
            me.clearPath();
            state.completedAt = Number.MIN_SAFE_INTEGER;
            return { ok: true };
        }

        const routed = this.routePlayerToNpc(
            me,
            npc,
            1,
            npc.hasPath(),
            this.resolveRunMode(me, state.modifierFlags),
        );
        if (routed) {
            state.lastRouteTick = 0;
            return { ok: true };
        }

        logger.info?.(
            `[npc] interaction routing failed player=${me.id} npc=${npc.id} reason=no_path`,
        );
        return { ok: false, message: "no_path" };
    }

    stopNpcInteraction(ws: WebSocket): void {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== "npcInteract") return;
        this.interactions.delete(ws);
        const me = this.players.get(ws);
        me?.clearInteraction();
        me?.clearPath();
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
        const me = this.players.get(ws);
        if (!me) return;

        // Block interactions during tutorial
        if (!me.canInteract()) {
            return;
        }

        // Ground-item interactions replace active click intents.
        this.interruptSkillActions(me.id);
        this.replaceInteractionState(ws, me);

        const state: GroundItemInteractionState = {
            kind: "groundItem",
            itemId: data.itemId,
            stackId: data.stackId,
            modifierFlags: this.normalizeModifierFlags(data.modifierFlags),
            tileX: data.tileX,
            tileY: data.tileY,
            tileLevel: data.tileLevel,
            option: data.option,
            lastRouteTick: Number.MIN_SAFE_INTEGER,
        };

        this.interactions.set(ws, state);

        if (me.tileX === state.tileX && me.tileY === state.tileY && me.level === state.tileLevel) {
            return;
        }

        this.routePlayerToTile(
            me,
            { x: state.tileX, y: state.tileY },
            this.resolveRunMode(me, state.modifierFlags),
        );
    }

    /**
     * Programmatic attack-NPC entrypoint for agent players.
     *
     * `NpcCombatInteractionHandler.startNpcAttack` already accepts a
     * `PlayerState` as its first argument (the `instanceof PlayerState`
     * branch at line ~86 of that file), but its declared type signature
     * is `WebSocket` for the normal human-client path. This wrapper
     * types the agent path correctly so `BotSdkActionRouter` doesn't
     * need an unsafe cast.
     *
     * Returns the same `{ok, message, chatMessage}` shape the human
     * handler returns.
     */
    handleAgentNpcAttack(
        player: PlayerState,
        npc: NpcState,
        currentTick: number,
        attackDelay: number = 4,
        modifierFlags?: number,
    ): { ok: boolean; message?: string; chatMessage?: string } {
        return this.npcCombatHandler.startNpcAttack(
            player as unknown as WebSocket,
            npc,
            currentTick,
            attackDelay,
            modifierFlags,
        );
    }

    /**
     * Agent-player counterpart to {@link handleManualMovement}.
     *
     * The bot-SDK doesn't own a WebSocket, so the ws-keyed lookups in
     * `handleManualMovement` (`interactions.get(ws)`, `pendingLocInteractions.get(ws)`,
     * etc.) don't apply. Agent movement goes through this method instead:
     * it performs the same "walking interrupts current activity" cleanup
     * (skill actions, forced orientation, pending interaction focus) directly
     * on the supplied {@link PlayerState}.
     *
     * Called by `PlayerManager.moveAgent()` after the path has been assigned.
     */
    handleAgentMovement(player: PlayerState): void {
        this.interruptSkillActions(player.id);
        player.clearInteraction();
        player.clearForcedOrientation();
    }

    handleManualMovement(ws: WebSocket, destination?: { x: number; y: number }): void {
        const interaction = this.interactions.get(ws);
        const me = this.players.get(ws);

        // Walking cancels all queued skill actions (woodcutting, mining, etc.)
        if (me) {
            this.interruptSkillActions(me.id);
        }

        const pendingLoc = this.pendingLocInteractions.get(ws);
        const preservePendingLoc =
            !!pendingLoc && this.locHandler.shouldPreservePendingLocInteraction(pendingLoc, destination, me);
        logger.info(
            "[manualMove]",
            JSON.stringify({
                player: me?.id,
                interaction: interaction?.kind,
                pendingLoc: this.pendingLocInteractions.has(ws),
                preservePendingLoc,
                destination,
                pos: me ? { x: me.tileX, y: me.tileY, level: me.level } : undefined,
            }),
        );
        if (interaction && interaction.kind === "npcCombat") {
            if (me) {
                this.onStopAutoAttack?.(me.id);
            }
        } else if (interaction) {
            this.interactions.delete(ws);
        }
        if (!preservePendingLoc) {
            this.pendingLocInteractions.delete(ws);
            me?.clearInteraction();
        } else if (pendingLoc && me) {
            this.locHandler.applyLocInteractionRoute(me, pendingLoc);
        }
        me?.clearForcedOrientation();
    }

    startNpcAttack(
        ws: WebSocket,
        npc: NpcState,
        currentTick: number,
        _attackDelay: number = 4,
        modifierFlags?: number,
    ): { ok: boolean; message?: string; chatMessage?: string } {
        return this.npcCombatHandler.startNpcAttack(ws, npc, currentTick, _attackDelay, modifierFlags);
    }

    stopNpcAttack(ws: WebSocket): void {
        this.npcCombatHandler.stopNpcAttack(ws);
    }

    /**
     * Fully ends preserved NPC combat focus after PlayerCombatManager drops the engagement.
     * This is distinct from `stopNpcAttack()`, which intentionally preserves the interaction
     * while the NPC is still allowed to chase/retaliate during the aggro hold window.
     */
    finishNpcCombatByPlayerId(playerId: number, npcId?: number): void {
        this.npcCombatHandler.finishNpcCombatByPlayerId(playerId, npcId);
    }

    updateFollowing(currentTick: number = 0): void {
        this.followingHandler.updateFollowing(currentTick);
    }

    updateNpcInteractions(tick: number, npcLookup: InteractionTickNpcLookup): void {
        this.forEachInteraction((ws, interaction) => {
            if (interaction.kind !== "npcInteract") return;
            const state = interaction as NpcInteractPassiveState;
            const me = this.players.get(ws);
            if (!me) {
                const npc = npcLookup(state.npcId);
                npc?.clearInteraction();
                this.interactions.delete(ws);
                return;
            }

            const npc = npcLookup(state.npcId);
            if (!npc) {
                me.clearInteraction();
                this.interactions.delete(ws);
                return;
            }

            // Passive NPC interactions (e.g., banking) should not mark the NPC as
            // "interacting with" the player. Setting the NPC's interaction index causes
            // clients to render combat-like targeting arrows. We only set NPC->player
            // interaction during actual combat (see PlayerCombatManager). For passive
            // interactions, keep the NPC's interaction index clear.
            npc.clearInteraction();

            if (npc.level !== me.level) {
                state.completedAt = undefined;
                if (tick - state.lastRouteTick >= 2) {
                    const routed = this.routePlayerToNpc(
                        me,
                        npc,
                        1,
                        npc.hasPath(),
                        this.resolveRunMode(me, state.modifierFlags),
                    );
                    if (routed) {
                        state.lastRouteTick = tick;
                    }
                }
                return;
            }

            const npcSize = Math.max(1, npc.size);
            const strategy = new RectAdjacentRouteStrategy(npc.tileX, npc.tileY, npcSize, npcSize);
            // Set collision getter so hasArrived() checks for walls.
            // Without this, player appears "arrived" when geometrically adjacent but
            // wall-blocked, causing an infinite re-routing loop.
            strategy.setCollisionGetter(
                (x, y, p) => this.pathService.getCollisionFlagAt(x, y, p),
                me.level,
            );
            const arrived = strategy.hasArrived(me.tileX, me.tileY, me.level);

            const npcMoved = state.lastNpcTileX !== npc.tileX || state.lastNpcTileY !== npc.tileY;
            if (npcMoved) {
                state.lastNpcTileX = npc.tileX;
                state.lastNpcTileY = npc.tileY;
                state.lastRouteTick = Number.MIN_SAFE_INTEGER;
                state.unreachableSinceTick = undefined;
            }

            const npcMoving = npcMoved || npc.hasPath();

            if (!arrived) {
                const shouldRoute =
                    !me.hasPath() ||
                    npcMoved ||
                    tick - state.lastRouteTick >= 2 ||
                    me.wasTeleported();
                if (shouldRoute) {
                    const routed = this.routePlayerToNpc(
                        me,
                        npc,
                        1,
                        npcMoving,
                        this.resolveRunMode(me, state.modifierFlags),
                    );
                    if (routed) {
                        state.lastRouteTick = tick;
                    }
                }
                state.completedAt = undefined;
                return;
            }

            // hasArrived() already verified no wall blocks - player can interact
            npc.clearPath();

            // Face each other using Face Coordinate mask (client-side turn)
            npc.faceTile(me.tileX, me.tileY);
            me.faceTile(npc.tileX, npc.tileY);

            me.clearPath();
            const firstArrival =
                state.completedAt === undefined || state.completedAt === Number.MIN_SAFE_INTEGER;
            if (firstArrival) {
                state.completedAt = tick;
                logger.info?.(
                    `[npc] arrived interaction player=${me.id} opt=${
                        state.option ?? "Talk-to"
                    } npc=${npc.id} type=${npc.typeId} playerPos=(${me.tileX},${me.tileY},${
                        me.level
                    }) npcPos=(${npc.tileX},${npc.tileY},${npc.level})`,
                );
                // Provide minimal payload; ScriptRuntime will attach services internally
                this.scriptRuntime?.queueNpcInteraction({
                    tick: tick,
                    player: me,
                    npc,
                    option: state.option,
                });
                return;
            }
            const completedAt = state.completedAt ?? Number.MIN_SAFE_INTEGER;
            if (tick - completedAt >= 1) {
                this.interactions.delete(ws);
                me.clearInteraction();
            }
        });
    }

    applyInteractionFacing(
        ws: WebSocket,
        player: PlayerState,
        npcLookup: InteractionTickNpcLookup,
        currentTick?: number,
    ): void {
        // Option A: client-authoritative for normal interaction-facing.
        // Server only applies one-tick "forced face" overrides (e.g., spell casts).

        // One-tick face override only
        let forced: number | undefined;
        try {
            const temp = player._pendingFace;
            if (temp) {
                forced = this.computeOrientationWorld(player.x, player.y, temp.x, temp.y);
                player._pendingFace = undefined; // consume
            }
        } catch (err) { logger.warn("[interaction] failed to compute pending face", err); }

        if (forced !== undefined) {
            player.setForcedOrientation(forced & 2047);
        } else {
            // Let client derive facing from interaction index while idle
            player.clearForcedOrientation();
        }
    }

    startPlayerCombat(ws: WebSocket, targetPlayerId: number, untilTick?: number): void {
        const me = this.players.get(ws);
        if (!me) return;

        // Block interactions during tutorial
        if (!me.canInteract()) {
            return;
        }

        const existing = this.interactions.get(ws);
        if (existing && existing.kind !== "playerCombat") {
            me.clearInteraction();
        }
        this.interactions.set(ws, {
            kind: "playerCombat",
            playerId: targetPlayerId,
            untilTick,
        });
        try {
            me.setInteraction("player", targetPlayerId);
        } catch (err) { logger.warn("[interaction] failed to set player interaction", err); }
        const target = this.players.getById(targetPlayerId);
        me.combat.setCombatTarget(target ?? null);
        me.combat.setInteractingPlayer(target ?? null);
    }

    stopPlayerCombat(ws: WebSocket): void {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== "playerCombat") return;
        this.interactions.delete(ws);
        const me = this.players.get(ws);
        if (me) {
            me.clearInteraction();
            me.combat.removeCombatTarget();
            me.combat.setInteractingPlayer(null);
            me.stopAnimation();
        }
    }

    updatePlayerAttacks(
        tick: number,
        schedulePlayerAttack: (
            player: PlayerState,
            target: PlayerState,
            attackDelay: number,
            currentTick: number,
        ) => boolean,
        opts?: {
            pickPlayerAttackDelay?: (player: PlayerState, target: PlayerState) => number;
        },
    ): void {
        this.npcCombatHandler.updatePlayerAttacks(tick, schedulePlayerAttack, opts);
    }

    startLocInteract(ws: WebSocket, data: PendingLocInteraction): void {
        this.locHandler.startLocInteract(ws, data);
    }

    startLocInteractAtTick(ws: WebSocket, data: PendingLocInteraction, currentTick?: number): void {
        this.locHandler.startLocInteractAtTick(ws, data, currentTick);
    }

    updateLocInteractions(currentTick?: number): void {
        this.locHandler.updateLocInteractions(currentTick);
    }

    updateGroundItemInteractions(tick: number): void {
        this.forEachInteraction((ws, interaction) => {
            if (interaction.kind !== "groundItem") return;
            const st = interaction as GroundItemInteractionState;
            const me = this.players.get(ws);
            if (!me) {
                this.interactions.delete(ws);
                return;
            }

            if (me.level !== st.tileLevel) {
                me.clearInteraction();
                this.interactions.delete(ws);
                return;
            }

            const arrived = me.tileX === st.tileX && me.tileY === st.tileY;

            if (arrived) {
                if (this.onGroundItemInteraction) {
                    this.onGroundItemInteraction(me, st);
                }
                me.clearInteraction();
                this.interactions.delete(ws);
                me.clearPath();
                return;
            }

            const shouldRoute = !me.hasPath() || tick - st.lastRouteTick >= 2 || me.wasTeleported();

            if (shouldRoute) {
                const routed = this.routePlayerToTile(
                    me,
                    { x: st.tileX, y: st.tileY },
                    this.resolveRunMode(me, st.modifierFlags),
                );
                if (routed) {
                    st.lastRouteTick = tick;
                }
            }
        });
    }

    private applyPathSteps(actor: Actor, steps: { x: number; y: number }[], run: boolean): boolean {
        const normalizedSteps = Array.isArray(steps) ? steps.map((s) => ({ x: s.x, y: s.y })) : [];

        let prevX = actor.tileX;
        let prevY = actor.tileY;
        for (const step of normalizedSteps) {
            const dx = Math.abs(step.x - prevX);
            const dy = Math.abs(step.y - prevY);
            // path buffers are per-tile steps (Chebyshev distance 1).
            if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
                return false;
            }
            prevX = step.x;
            prevY = step.y;
        }
        const currentQueue = actor.getPathQueue();
        const sameQueue =
            currentQueue.length === normalizedSteps.length &&
            currentQueue.every((step, idx) => {
                const other = normalizedSteps[idx];
                return other && step.x === other.x && step.y === other.y;
            });
        if (sameQueue) {
            actor.running = run;
            return false;
        }
        actor.setPath(normalizedSteps, run);
        return true;
    }

    private routePlayerToTile(player: PlayerState, tile: { x: number; y: number }, run: boolean) {
        const steps = this.findPlayerPathToTile(player, tile);
        if (!steps) {
            return false;
        }
        if (steps.length === 0) {
            return true;
        }
        this.applyPathSteps(player, steps, run);
        return true;
    }

    private findPlayerPathToTile(
        player: PlayerState,
        tile: { x: number; y: number },
    ): { x: number; y: number }[] | undefined {
        // OSRS semantics: walking to a specific tile uses exact routing, not
        // rectangle adjacency. Using adjacency here allows diagonal "corner hug"
        // arrivals which feel off for 1x1 destinations.
        const rs = new ExactRouteStrategy();
        rs.approxDestX = tile.x;
        rs.approxDestY = tile.y;
        rs.destSizeX = 1;
        rs.destSizeY = 1;

        const res = this.pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: tile,
                size: 1,
            },
            { maxSteps: 128, routeStrategy: rs },
        );
        if (!res.ok || !Array.isArray(res.steps)) {
            return undefined;
        }
        if (res.steps.length === 0 && !rs.hasArrived(player.tileX, player.tileY, player.level)) {
            return undefined;
        }
        return res.steps;
    }

    private extractValidatedStrategyPathSteps(
        actor: { tileX: number; tileY: number; level: number },
        res: { ok: boolean; steps?: { x: number; y: number }[]; end?: { x: number; y: number } },
        strategy: { hasArrived(x: number, y: number, level: number): boolean },
    ): { x: number; y: number }[] | undefined {
        if (!res.ok || !Array.isArray(res.steps)) {
            return undefined;
        }
        const selectedEnd =
            res.steps.length > 0
                ? res.end ?? res.steps[res.steps.length - 1]!
                : { x: actor.tileX, y: actor.tileY };
        if (!strategy.hasArrived(selectedEnd.x, selectedEnd.y, actor.level)) {
            return undefined;
        }
        return res.steps;
    }

    private hasDirectReach(
        from: { x: number; y: number },
        to: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level: number,
    ): boolean {
        return hasDirectReachToArea(this.pathService, from, to, sizeX, sizeY, level);
    }

    private findReachableAdjacency(
        from: { x: number; y: number },
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level: number,
    ): { x: number; y: number } | undefined {
        const minX = tile.x;
        const minY = tile.y;
        const maxX = minX + Math.max(1, sizeX) - 1;
        const maxY = minY + Math.max(1, sizeY) - 1;
        const candidates: Array<{
            tile: { x: number; y: number };
            target: { x: number; y: number };
        }> = [];
        for (let x = minX; x <= maxX; x++) {
            candidates.push({ tile: { x, y: minY - 1 }, target: { x, y: minY } });
            candidates.push({ tile: { x, y: maxY + 1 }, target: { x, y: maxY } });
        }
        for (let y = minY; y <= maxY; y++) {
            candidates.push({ tile: { x: minX - 1, y }, target: { x: minX, y } });
            candidates.push({ tile: { x: maxX + 1, y }, target: { x: maxX, y } });
        }
        const seen = new Set<string>();
        let best: { x: number; y: number } | undefined;
        let bestDist = Number.MAX_SAFE_INTEGER;
        const blockMask = CollisionFlag.OBJECT | CollisionFlag.FLOOR_BLOCKED;
        for (const cand of candidates) {
            const key = `${cand.tile.x},${cand.tile.y}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const flag = this.pathService.getCollisionFlagAt(cand.tile.x, cand.tile.y, level);
            if (flag === undefined || (flag & blockMask) !== 0) continue;
            if (this.pathService.edgeHasWallBetween(cand.tile.x, cand.tile.y, cand.target.x, cand.target.y, level)) continue;
            const dist = Math.abs(cand.tile.x - from.x) + Math.abs(cand.tile.y - from.y);
            if (dist < bestDist) {
                bestDist = dist;
                best = cand.tile;
            }
        }
        return best;
    }

    routePlayerToNpc(
        player: PlayerState,
        npc: NpcState,
        reach: number = 1,
        _allowOverlap: boolean = false,
        run?: boolean,
    ): boolean {
        return this.npcCombatHandler.routePlayerToNpc(player, npc, reach, _allowOverlap, run);
    }

    computeOrientationWorld(ox: number, oy: number, tx: number, ty: number): number {
        return faceAngleRs(ox, oy, tx, ty);
    }
}

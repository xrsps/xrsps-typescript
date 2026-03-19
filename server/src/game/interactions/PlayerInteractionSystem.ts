import { LocModelType } from "../../../../src/rs/config/loctype/LocModelType";
import { faceAngleRs } from "../../../../src/rs/utils/rotation";
import {
    MODIFIER_FLAG_CTRL,
    MODIFIER_FLAG_CTRL_SHIFT,
} from "../../../../src/shared/input/modifierFlags";
import { hasDirectReachToArea } from "../../pathfinding/DirectReach";
import { PathService } from "../../pathfinding/PathService";
import {
    CardinalAdjacentRouteStrategy,
    ExactRouteStrategy,
    RectAdjacentRouteStrategy,
    RectRouteStrategy,
    RectWithinRangeLineOfSightRouteStrategy,
    RectWithinRangeRouteStrategy,
    RouteStrategy,
} from "../../pathfinding/legacy/pathfinder/RouteStrategy";
import { CollisionFlag } from "../../pathfinding/legacy/pathfinder/flag/CollisionFlag";
import { logger } from "../../utils/logger";
import { DoorStateManager } from "../../world/DoorStateManager";
import { loadVisibleLocTypeForPlayer } from "../../world/LocTransforms";
import { Actor } from "../actor";
import { hasProjectileLineOfSightToNpc } from "../combat/CombatAction";
import {
    POWERED_STAFF_CATEGORIES,
    resolvePlayerAttackReach,
    resolvePlayerAttackType,
} from "../combat/CombatRules";
import { NpcState } from "../npc";
import { PlayerState } from "../player";
import type { ScriptRuntime } from "../scripts/ScriptRuntime";
import {
    FollowInteractionKind,
    FollowInteractionState,
    GroundItemInteractionState,
    InteractionTickNpcLookup,
    NpcCombatInteractionState,
    NpcInteractPassiveState,
    PendingLocInteraction,
    PlayerInteractionState,
} from "./types";

/**
 * Maximum distance (in tiles) the player can be from the NPC before combat disengages.
 * In OSRS, this is typically the view distance.
 */
const PLAYER_CHASE_DISTANCE_TILES = 32;

const LEAGUE_TUTOR_NPC_TYPE_ID = 315;

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

type LocRouteProfile =
    | { kind: "cardinal" }
    | { kind: "adjacent" }
    | { kind: "adjacent_overlap" }
    | { kind: "range"; distance: number }
    | { kind: "inside" };

type SizedLocDefinition = {
    sizeX?: unknown;
    sizeY?: unknown;
};

type VisibleLocRouteState = {
    locId: number;
    sizeX: number;
    sizeY: number;
};

function normalizePositiveInt(value: number | undefined, fallback = 1): number {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(1, Math.trunc(value));
}

function normalizeInt(value: number | undefined, fallback = 0): number {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.trunc(value);
}

const WALLISH_TYPES = new Set<LocModelType>([
    LocModelType.WALL,
    LocModelType.WALL_TRI_CORNER,
    LocModelType.WALL_CORNER,
    LocModelType.WALL_RECT_CORNER,
    LocModelType.WALL_DECORATION_INSIDE,
    LocModelType.WALL_DECORATION_OUTSIDE,
    LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE,
    LocModelType.WALL_DECORATION_DIAGONAL_INSIDE,
    LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
    LocModelType.WALL_DIAGONAL,
]);

export interface PlayerRepository {
    get(ws: any): PlayerState | undefined;
    getById(id: number): PlayerState | undefined;
    getSocketByPlayerId(id: number): any | undefined;
    forEach(cb: (ws: any, player: PlayerState) => void): void;
    forEachBot(cb: (player: PlayerState) => void): void;
}

export class PlayerInteractionSystem {
    private readonly interactions = new Map<any, PlayerInteractionState>();
    private readonly pendingLocInteractions = new Map<any, PendingLocInteraction>();
    private readonly locRouteProfileCache = new Map<number, LocRouteProfile>();
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
     * OSRS parity: Callback to interrupt/cancel all queued skill actions for a player.
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
        private readonly locTypeLoader?: any,
        private readonly doorManager?: DoorStateManager,
        private readonly scriptRuntime?: ScriptRuntime,
    ) {}

    private normalizeModifierFlags(raw: number | undefined): number {
        const normalized = raw ?? 0;
        if (normalized === MODIFIER_FLAG_CTRL_SHIFT) {
            return MODIFIER_FLAG_CTRL_SHIFT;
        }
        return (normalized & MODIFIER_FLAG_CTRL) !== 0 ? MODIFIER_FLAG_CTRL : 0;
    }

    private resolveRunMode(player: PlayerState, modifierFlags?: number): boolean {
        let run = player.wantsToRun();
        const flags = this.normalizeModifierFlags(modifierFlags);
        if ((flags & MODIFIER_FLAG_CTRL) !== 0) {
            run = !run;
        }
        if (flags === MODIFIER_FLAG_CTRL_SHIFT) {
            run = true;
        }
        return player.resolveRequestedRun(run);
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
     * OSRS parity: Set callback for interrupting skill actions.
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
     * OSRS parity: Interrupt all queued skill actions for a player.
     * Called when any action that should cancel skilling occurs.
     */
    interruptSkillActions(playerId: number): void {
        this.onInterruptSkillActions?.(playerId);
    }

    isFollowingSocket(ws: any, targetId: number): boolean {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== "follow") return false;
        return st.targetId === targetId;
    }

    getInteractingForSocket(
        ws: any,
    ): { targetId: number; mode: "follow" | "trade" | "combat" } | undefined {
        const player = this.players.get(ws);
        const interaction = player?.getInteractionTarget();
        if (!interaction) return undefined;
        const state = this.interactions.get(ws);
        let mode: "follow" | "trade" | "combat" = "combat";
        if (state && (state.kind === "follow" || state.kind === "trade")) {
            mode = state.kind;
        }
        return { targetId: interaction.id, mode };
    }

    getInteraction(ws: any): PlayerInteractionState | undefined {
        return this.interactions.get(ws);
    }

    forEachInteraction(cb: (ws: any, state: PlayerInteractionState) => void): void {
        for (const [ws, state] of this.interactions.entries()) {
            cb(ws, state);
        }
    }

    removeSocket(ws: any): void {
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
    clearAllInteractions(ws: any): void {
        const st = this.interactions.get(ws);
        if (st) {
            // Clear RSMod-style attributes on the player
            const me = this.players.get(ws);
            if (me) {
                me.removeCombatTarget();
                me.setInteractingNpc(null);
                me.setInteractingPlayer(null);
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
    private replaceInteractionState(ws: any, player: PlayerState): void {
        try {
            player.interruptQueues();
        } catch {}
        try {
            player.resetInteractions();
        } catch {}
        this.clearAllInteractions(ws);
    }

    clearInteractionsWithNpc(npcId: number): void {
        const toRemove: any[] = [];
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
                player.clearInteraction();
                player.stopAnimation();
                player.removeCombatTarget();
                player.setInteractingNpc(null);
                player.clearInteractionTarget();
            }
            this.interactions.delete(ws);
        }
    }

    getStateForSocket(ws: any): PlayerInteractionState | undefined {
        return this.interactions.get(ws);
    }

    startFollowing(
        ws: any,
        targetId: number,
        mode: FollowInteractionKind,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        const me = this.players.get(ws);
        if (!me) return { ok: false, message: "player not found" };
        const target = this.players.getById(targetId);
        if (!target) return { ok: false, message: "target not found" };

        // Block interactions during tutorial
        if (!me.canInteract()) {
            return { ok: false, message: "interaction_blocked" };
        }

        this.replaceInteractionState(ws, me);

        // CRITICAL: Clear any existing path that might walk onto the target's tile
        // This prevents the player from walking onto the target before following logic runs
        me.clearPath();

        const swirlDir: 1 | -1 = ((me.id ^ target.id) & 1) === 0 ? 1 : -1;
        this.interactions.set(ws, {
            kind: mode,
            targetId: target.id,
            modifierFlags: this.normalizeModifierFlags(modifierFlags),
            swirlDir,
            swirlIndex: 0,
        });
        return { ok: true };
    }

    stopFollowing(ws: any): void {
        const st = this.interactions.get(ws);
        if (!st) return;
        if (st.kind === "follow" || st.kind === "trade") {
            this.interactions.delete(ws);
            const me = this.players.get(ws);
            me?.clearInteraction();
        }
    }

    startNpcInteraction(
        ws: any,
        npc: NpcState,
        option?: string,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        const me = this.players.get(ws);
        if (!me) return { ok: false, message: "player not found" };
        if (!npc) return { ok: false, message: "npc not found" };
        if (npc.getHitpoints() <= 0) return { ok: false, message: "npc_dead" };

        // Block interactions during tutorial
        const normalizedOption = String(option ?? "")
            .trim()
            .toLowerCase();
        const leagueTutorTalkAllowed =
            npc.typeId === LEAGUE_TUTOR_NPC_TYPE_ID &&
            (normalizedOption === "" || normalizedOption === "talk-to");
        if (!me.canInteract() && !leagueTutorTalkAllowed) {
            return { ok: false, message: "interaction_blocked" };
        }

        // OSRS parity: Starting a new NPC interaction cancels any active skill actions
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
            } else if (existing.kind === "follow" || existing.kind === "trade") {
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
        // OSRS parity: Set collision getter so hasArrived() checks for walls
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

    stopNpcInteraction(ws: any): void {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== "npcInteract") return;
        this.interactions.delete(ws);
        const me = this.players.get(ws);
        me?.clearInteraction();
        me?.clearPath();
    }

    startGroundItemInteraction(
        ws: any,
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

        // OSRS parity: Ground-item interactions replace active click intents.
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

    handleManualMovement(ws: any, destination?: { x: number; y: number }): void {
        const interaction = this.interactions.get(ws);
        const me = this.players.get(ws);

        // OSRS parity: Walking cancels all queued skill actions (woodcutting, mining, etc.)
        if (me) {
            this.interruptSkillActions(me.id);
        }

        const pendingLoc = this.pendingLocInteractions.get(ws);
        const preservePendingLoc =
            !!pendingLoc && this.shouldPreservePendingLocInteraction(pendingLoc, destination, me);
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
            this.applyLocInteractionRoute(me, pendingLoc);
        }
        me?.clearForcedOrientation();
    }

    startNpcAttack(
        ws: any,
        npc: NpcState,
        currentTick: number,
        _attackDelay: number = 4,
        modifierFlags?: number,
    ): { ok: boolean; message?: string; chatMessage?: string } {
        // Support passing either a socket or a PlayerState directly (for bots)
        const me = ws instanceof PlayerState ? ws : this.players.get(ws);
        if (!me) return { ok: false, message: "player not found" };
        if (!npc) return { ok: false, message: "npc not found" };
        if (npc.getHitpoints() <= 0 || npc.isDead(currentTick)) {
            return { ok: false, message: "npc_dead" };
        }
        if (npc.isPlayerFollower?.() === true) {
            return { ok: false, message: "npc_unattackable" };
        }

        // Block interactions during tutorial
        if (!me.canInteract()) {
            return { ok: false, message: "interaction_blocked" };
        }

        const canStartCombat = this.canStartNpcCombat?.(me, npc, currentTick);
        if (canStartCombat && !canStartCombat.allowed) {
            return {
                ok: false,
                message: "combat_restricted",
                chatMessage: canStartCombat.reason ?? "You are already under attack!",
            };
        }

        // OSRS parity: Starting combat cancels any active skill actions
        this.interruptSkillActions(me.id);
        this.replaceInteractionState(ws, me);

        // Use the ws parameter as key (player object for bots, socket for regular players)
        const existing = this.interactions.get(ws);
        if (existing && existing.kind !== "npcCombat") {
            me.clearInteraction();
        }
        let state: NpcCombatInteractionState;
        if (existing && existing.kind === "npcCombat" && existing.npcId === npc.id) {
            state = existing;
            state.modifierFlags = this.normalizeModifierFlags(modifierFlags);
        } else {
            state = {
                kind: "npcCombat",
                npcId: npc.id,
                modifierFlags: this.normalizeModifierFlags(modifierFlags),
            };
        }

        state.modifierFlags = this.normalizeModifierFlags(state.modifierFlags);

        // OSRS parity: Do not force NPC to face/engage on click.
        // NPC retaliation/engagement begins when the first hit actually lands (confirmHitLanded),
        // not when the player clicks "Attack" or starts pathing.

        // RSMod parity: Set combat target on player (COMBAT_TARGET_FOCUS_ATTR)
        me.setCombatTarget(npc);

        this.interactions.set(ws, state);

        const attackReach = Math.max(1, this.getPlayerAttackReach(me));
        if (this.isWithinAttackReach(me, npc)) {
            me.clearPath();
            return { ok: true };
        }

        // If in range but blocked by wall, find a tile with LoS
        if (
            this.tryRouteToLineOfSight(
                me,
                npc,
                attackReach,
                this.resolveRunMode(me, state.modifierFlags),
            )
        ) {
            return { ok: true };
        }

        const routed = this.routePlayerToNpc(
            me,
            npc,
            attackReach,
            npc.hasPath(),
            this.resolveRunMode(me, state.modifierFlags),
        );
        const routedWithProgress = routed && (me.hasPath() || this.isWithinAttackReach(me, npc));
        if (routedWithProgress) {
            // OSRS parity: Allow attack on the same tick the player arrives in range.
            // If player walks into range during this tick's movement phase, they can
            // attack during the combat phase (same tick). The attack speed cooldown
            // only starts AFTER the first attack is executed, not when clicked.
            return { ok: true };
        }

        // RSMod parity: if we can't route directly into attack reach, still walk toward the NPC's
        // best reachable tile. If that also fails, only then begin unreachable timeout handling.
        const fallbackRouted = this.routePlayerToTile(
            me,
            { x: npc.tileX, y: npc.tileY },
            this.resolveRunMode(me, state.modifierFlags),
        );
        const fallbackWithProgress =
            fallbackRouted && (me.hasPath() || this.isWithinAttackReach(me, npc));
        if (fallbackWithProgress) {
            return { ok: true };
        }

        return { ok: false, message: "no_path" };
    }

    stopNpcAttack(ws: any): void {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== "npcCombat") return;
        const me = this.players.get(ws);
        if (me) {
            this.onStopAutoAttack?.(me.id);
            // RSMod parity: Clear combat target (COMBAT_TARGET_FOCUS_ATTR)
            me.removeCombatTarget();
            me.clearPath();
            me.clearInteraction();
            me.stopAnimation();
        }
    }

    /**
     * Fully ends preserved NPC combat focus after PlayerCombatManager drops the engagement.
     * This is distinct from `stopNpcAttack()`, which intentionally preserves the interaction
     * while the NPC is still allowed to chase/retaliate during the aggro hold window.
     */
    finishNpcCombatByPlayerId(playerId: number, npcId?: number): void {
        const player = this.players.getById(playerId);
        if (!player) return;

        const socket = this.players.getSocketByPlayerId(playerId);
        const keys = socket !== undefined ? [socket, player] : [player];

        for (const key of keys) {
            const state = this.interactions.get(key);
            if (!state || state.kind !== "npcCombat") continue;
            if (npcId !== undefined && state.npcId !== npcId) continue;

            this.interactions.delete(key);

            const interactionTarget = player.getInteractionTarget();
            if (
                interactionTarget &&
                interactionTarget.type === "npc" &&
                interactionTarget.id === state.npcId
            ) {
                player.clearInteractionTarget();
            }

            const combatTarget = player.getCombatTarget();
            if (combatTarget && !combatTarget.isPlayer && combatTarget.id === state.npcId) {
                player.removeCombatTarget();
            }

            if (player.getInteractingNpc()?.id === state.npcId) {
                player.setInteractingNpc(null);
            }
        }
    }

    updateFollowing(currentTick: number = 0): void {
        this.forEachInteraction((ws, interaction) => {
            if (interaction.kind !== "follow" && interaction.kind !== "trade") return;
            const st = interaction as FollowInteractionState;
            const me = this.players.get(ws);
            if (!me) {
                this.interactions.delete(ws);
                return;
            }
            const target = this.players.getById(st.targetId);
            if (!target) {
                this.interactions.delete(ws);
            }
            if (!target) {
                me.clearInteraction();
                return;
            }
            const px = me.tileX;
            const py = me.tileY;
            const tx = target.tileX;
            const ty = target.tileY;
            const trot = target.getOrientation() & 2047;
            const tsec = this.rotToSector(trot);

            const fwd = this.getTargetForward(target);
            const behind = { x: tx - fwd.dx, y: ty - fwd.dy };

            const dCheb = Math.max(Math.abs(tx - px), Math.abs(ty - py));
            const adjacent = dCheb <= 1;
            const edgeReachable =
                adjacent && this.hasDirectReach({ x: px, y: py }, { x: tx, y: ty }, 1, 1, me.level);
            if (st.kind === "trade" && adjacent) {
                if (edgeReachable) {
                    this.interactions.delete(ws);
                    me.clearInteraction();
                    try {
                        this.onTradeHandshake?.(me, target, currentTick);
                    } catch {}
                    return;
                }
                // Otherwise continue to re-route around the obstruction.
            }

            const targetMoved = st.lastTx !== tx || st.lastTy !== ty;
            const lastSector = st.lastSector ?? Number.MIN_SAFE_INTEGER;
            const targetTurned = lastSector !== tsec;
            const atSlot =
                me.tileX === (st.slotX ?? behind.x) && me.tileY === (st.slotY ?? behind.y);
            const wsTargetForAtSlot = this.players.getSocketByPlayerId(target.id);
            const mutualAtSlot =
                wsTargetForAtSlot != null &&
                this.isFollowingWithMode(wsTargetForAtSlot, me.id, "follow");
            if (!mutualAtSlot && !targetMoved && !targetTurned && atSlot && edgeReachable) {
                return;
            }

            let candidates: { x: number; y: number }[] = [];
            let enforceSingleStep = false;
            if (st.kind === "follow") {
                const ring = this.getFollowRing(tx, ty, tsec);
                const distCheb = Math.max(Math.abs(tx - px), Math.abs(ty - py));
                if (distCheb > 1) {
                    // Use Lost City's approach: path to where the target WAS (followX/followZ)
                    // This prevents pathing through the target's current tile
                    const lastStep = { x: target.followX, y: target.followZ };

                    // CRITICAL: Don't use followX/followZ if it's the target's current tile
                    // This happens when target is stationary
                    const lastStepIsCurrentTile = lastStep.x === tx && lastStep.y === ty;

                    // Start with the target's last position as primary candidate (if valid)
                    if (!lastStepIsCurrentTile) {
                        candidates = [lastStep];
                    } else {
                        candidates = [];
                    }

                    // Add calculated positions as fallbacks
                    const opts = this.getFollowCandidates(tx, ty, fwd.dx, fwd.dy);
                    candidates.push(opts.behind, opts.twoBehind, opts.backLeft, opts.backRight);

                    const key = (o: { x: number; y: number }) => `${o.x},${o.y}`;
                    const used = new Set<string>([
                        key(lastStep),
                        key(opts.behind),
                        key(opts.backLeft),
                        key(opts.backRight),
                    ]);
                    const extras = ring.filter((r) => !used.has(key(r)));
                    extras.sort(
                        (a, b) =>
                            Math.abs(a.x - px) +
                            Math.abs(a.y - py) -
                            (Math.abs(b.x - px) + Math.abs(b.y - py)),
                    );
                    candidates.push(...extras);
                    st.swirlIndex = 0;
                } else {
                    const wsTarget = this.players.getSocketByPlayerId(target.id);
                    const targetFollowingMe =
                        wsTarget != null && this.isFollowingWithMode(wsTarget, me.id, "follow");
                    if (!targetFollowingMe) {
                        st.swirlIndex = 0;

                        // CRITICAL: If we're on the target's tile, we need to move!
                        const onTargetTile = px === tx && py === ty;

                        const maintainFacing =
                            !onTargetTile &&
                            !targetMoved &&
                            !targetTurned &&
                            st.lastTx === tx &&
                            st.lastTy === ty &&
                            st.slotX === px &&
                            st.slotY === py;
                        if (maintainFacing && edgeReachable) return;

                        if (!edgeReachable || (behind.x === tx && behind.y === ty)) {
                            candidates = ring.slice();
                            enforceSingleStep = true;
                        } else {
                            st.slotX = behind.x;
                            st.slotY = behind.y;
                            const strategy = new RectAdjacentRouteStrategy(
                                behind.x,
                                behind.y,
                                1,
                                1,
                            );
                            const arrived = strategy.hasArrived(px, py, me.level);
                            if (!arrived || onTargetTile) {
                                const routed = this.routePlayerToTile(
                                    me,
                                    behind,
                                    this.resolveRunMode(me, st.modifierFlags),
                                );
                                if (!routed) {
                                    candidates = ring.slice();
                                    enforceSingleStep = true;
                                } else {
                                    st.lastTx = tx;
                                    st.lastTy = ty;
                                    st.lastRot = trot;
                                    st.lastSector = tsec;
                                    st.slotX = behind.x;
                                    st.slotY = behind.y;
                                    return;
                                }
                            } else {
                                st.lastTx = tx;
                                st.lastTy = ty;
                                st.lastRot = trot;
                                st.lastSector = tsec;
                                st.slotX = behind.x;
                                st.slotY = behind.y;
                                return;
                            }
                        }
                    } else {
                        const ringSwirl = this.getSwirlRing(tx, ty, st.swirlDir);
                        const slotIdx = st.swirlIndex % ringSwirl.length;
                        const slot = ringSwirl[slotIdx];
                        st.swirlIndex = (st.swirlIndex + 1) % ringSwirl.length;
                        candidates = [slot];
                        enforceSingleStep = true;
                    }
                }
            } else {
                candidates = this.getTradePositions(tx, ty);
                enforceSingleStep = true;
            }

            const wantsRun = this.resolveRunMode(me, st.modifierFlags);
            const maxAttempts = Math.min(8, candidates.length);
            let routed = false;

            // CRITICAL: If we're on the same tile, force a direct step without pathfinding
            // The pathfinder fails because collision is blocked by the target player
            if (px === tx && py === ty) {
                // Calculate "behind" position based on target's facing direction
                // This ensures we move behind them, not in front
                const forceTile = behind;

                // Verify behind is not the same as target tile (shouldn't happen but safety check)
                if (forceTile.x === tx && forceTile.y === ty && candidates.length > 0) {
                    // Fallback to first ring candidate if behind calculation failed
                    const fallback = candidates[0];
                    me.setPath([{ x: fallback.x, y: fallback.y }], wantsRun);
                    st.slotX = fallback.x;
                    st.slotY = fallback.y;
                } else {
                    // Apply a direct single-step path to behind position
                    me.setPath([{ x: forceTile.x, y: forceTile.y }], wantsRun);
                    st.slotX = forceTile.x;
                    st.slotY = forceTile.y;
                }

                st.lastTx = tx;
                st.lastTy = ty;
                st.lastRot = trot;
                st.lastSector = tsec;
                return;
            }

            for (let i = 0; i < maxAttempts; i++) {
                const tile = candidates[i];
                if (!tile) continue;

                // CRITICAL: Skip if this candidate is the target's current tile
                // This prevents followers from stopping on top of the target
                if (tile.x === tx && tile.y === ty) {
                    continue;
                }

                // Check if we're currently on the target's tile
                const onTargetTile = px === tx && py === ty;

                const strategy = new RectAdjacentRouteStrategy(tile.x, tile.y, 1, 1);
                // CRITICAL: If we're on the target's tile, force movement even if "arrived"
                // Don't use hasArrived check because it returns true for adjacent positions
                if (!onTargetTile && strategy.hasArrived(px, py, me.level)) {
                    st.slotX = tile.x;
                    st.slotY = tile.y;
                    routed = true;
                    break;
                }
                const path = this.pathService.findPathSteps(
                    {
                        from: { x: px, y: py, plane: me.level },
                        to: { x: tile.x, y: tile.y },
                        size: 1,
                    },
                    { maxSteps: 128, routeStrategy: strategy },
                );
                const steps = this.extractValidatedStrategyPathSteps(me, path, strategy);
                if (!steps) {
                    continue;
                }

                // Check if path goes through target's tile
                const pathThroughTarget = steps.some((step) => step.x === tx && step.y === ty);
                if (pathThroughTarget) {
                    continue; // Try next candidate
                }

                if (enforceSingleStep) {
                    if (steps.length > 1) {
                        return;
                    }
                }

                this.applyPathSteps(me, steps, wantsRun);
                st.slotX = tile.x;
                st.slotY = tile.y;
                routed = true;
                break;
            }

            if (!routed && st.kind === "follow" && st.slotX != null && st.slotY != null) {
                // Skip if fallback slot is target's current tile
                if (st.slotX === tx && st.slotY === ty) {
                    // Skip fallback
                } else {
                    const strategy = new RectAdjacentRouteStrategy(st.slotX, st.slotY, 1, 1);
                    const arrived = strategy.hasArrived(px, py, me.level);
                    if (!arrived) {
                        const lastPath = this.pathService.findPathSteps(
                            {
                                from: { x: px, y: py, plane: me.level },
                                to: { x: st.slotX, y: st.slotY },
                                size: 1,
                            },
                            { maxSteps: 128, routeStrategy: strategy },
                        );
                        const lastSteps = this.extractValidatedStrategyPathSteps(
                            me,
                            lastPath,
                            strategy,
                        );
                        if (lastSteps && lastSteps.length > 0) {
                            // Check if fallback path goes through target
                            const fallbackThroughTarget = lastSteps.some(
                                (step) => step.x === tx && step.y === ty,
                            );

                            if (!fallbackThroughTarget) {
                                this.applyPathSteps(me, lastSteps, wantsRun);
                                routed = true;
                            }
                        }
                    } else {
                        routed = true;
                    }
                }
            }

            st.lastTx = tx;
            st.lastTy = ty;
            st.lastRot = trot;
            st.lastSector = tsec;

            if (!routed && st.kind === "trade") {
                this.interactions.delete(ws);
                me.clearInteraction();
                me.clearPath();
            }
        });
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
            // OSRS parity: Set collision getter so hasArrived() checks for walls.
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
        ws: any,
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
        } catch {}

        if (forced !== undefined) {
            player.setForcedOrientation(forced & 2047);
        } else {
            // Let client derive facing from interaction index while idle
            player.clearForcedOrientation();
        }
    }

    startPlayerCombat(ws: any, targetPlayerId: number, untilTick?: number): void {
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
        } catch {}
    }

    stopPlayerCombat(ws: any): void {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== "playerCombat") return;
        this.interactions.delete(ws);
        const me = this.players.get(ws);
        if (me) {
            me.clearInteraction();
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
        this.forEachInteraction((ws, interaction) => {
            if (interaction.kind !== "playerCombat") return;
            const me = this.players.get(ws);
            if (!me) {
                this.interactions.delete(ws);
                return;
            }
            const target = this.players.getById(interaction.playerId);
            if (!target) {
                me.clearInteraction();
                me.stopAnimation();
                this.interactions.delete(ws);
                return;
            }
            if (target.level !== me.level) {
                me.clearInteraction();
                me.stopAnimation();
                this.interactions.delete(ws);
                return;
            }
            if (target.getHitpointsCurrent() <= 0) {
                me.clearInteraction();
                me.stopAnimation();
                this.interactions.delete(ws);
                return;
            }

            const chebyshevDistance = Math.max(
                Math.abs(target.tileX - me.tileX),
                Math.abs(target.tileY - me.tileY),
            );
            if (chebyshevDistance > PLAYER_CHASE_DISTANCE_TILES) {
                me.clearInteraction();
                me.stopAnimation();
                this.interactions.delete(ws);
                return;
            }

            const spellId = me.combatSpellId;
            if (!(me.autocastEnabled && spellId > 0)) return;

            const attackDelay = Math.max(1, opts?.pickPlayerAttackDelay?.(me, target) ?? 4);
            me.attackDelay = attackDelay;
            const last = me.lastSpellCastTick;
            if (tick < last + attackDelay) return;

            schedulePlayerAttack(me, target, attackDelay, tick);
        });
    }

    startLocInteract(ws: any, data: PendingLocInteraction): void {
        this.startLocInteractAtTick(ws, data);
    }

    startLocInteractAtTick(ws: any, data: PendingLocInteraction, currentTick?: number): void {
        const me = this.players.get(ws);
        if (!me) return;

        // Block interactions during tutorial
        if (!me.canInteract()) {
            return;
        }

        // OSRS parity: Starting a new loc interaction cancels any active skill actions
        this.interruptSkillActions(me.id);
        this.replaceInteractionState(ws, me);

        // OSRS parity: Clicking an object replaces any in-flight click-to-walk intent.
        // This also handles immediate interactions (already in range) where no new path is set.
        me.clearPath();
        me.clearWalkDestination();

        const pending: PendingLocInteraction = {
            id: data.id,
            tile: { x: data.tile.x, y: data.tile.y },
            level: data.level,
            action: data.action,
            modifierFlags: this.normalizeModifierFlags(data.modifierFlags),
        };
        const resolved = this.resolvePendingLocInteraction(me, pending);
        if (
            resolved.hasArrived &&
            Number.isFinite(currentTick) &&
            this.executeLocInteraction(
                me,
                pending,
                resolved.interactionLevel,
                resolved.rect.tile,
                resolved.routeSizeX,
                resolved.routeSizeY,
                currentTick as number,
                true,
            )
        ) {
            return;
        }

        this.applyLocInteractionRoute(me, pending, resolved);
        this.pendingLocInteractions.set(ws, pending);
    }

    private resolvePendingLocInteraction(
        player: PlayerState,
        pending: PendingLocInteraction,
    ): {
        interactionLevel: number;
        rect: { tile: { x: number; y: number }; sizeX: number; sizeY: number };
        routeSizeX: number;
        routeSizeY: number;
        strategy: RouteStrategy;
        hasArrived: boolean;
    } {
        const level = pending.level !== undefined ? normalizeInt(pending.level) : player.level;
        const visibleLoc = this.resolveVisibleLocRouteState(player, pending.id);
        const tile = this.resolveDoorRouteTile(
            visibleLoc.locId,
            {
                x: normalizeInt(pending.tile.x),
                y: normalizeInt(pending.tile.y),
            },
            level,
            pending.action,
        );
        const rect = this.resolveLocRouteRect(tile, visibleLoc.sizeX, visibleLoc.sizeY, level);
        const routeSizeX = Math.max(rect.sizeX, visibleLoc.sizeX);
        const routeSizeY = Math.max(rect.sizeY, visibleLoc.sizeY);
        const strategy = this.selectLocRouteStrategy(
            visibleLoc.locId,
            rect.tile,
            pending.action,
            routeSizeX,
            routeSizeY,
            level,
        );
        const hasArrived = strategy.hasArrived(player.tileX, player.tileY, player.level);
        return {
            interactionLevel: level,
            rect,
            routeSizeX,
            routeSizeY,
            strategy,
            hasArrived,
        };
    }

    private applyLocInteractionRoute(
        player: PlayerState,
        pending: PendingLocInteraction,
        resolved = this.resolvePendingLocInteraction(player, pending),
    ): void {
        if (!player) return;
        if (resolved.hasArrived) {
            return;
        }
        const res = this.pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: { x: resolved.rect.tile.x, y: resolved.rect.tile.y },
                size: 1,
            },
            { maxSteps: 128, routeStrategy: resolved.strategy },
        );
        const steps = this.extractValidatedStrategyPathSteps(player, res, resolved.strategy);
        if (steps && steps.length > 0) {
            const wantsRun = this.resolveRunMode(player, pending.modifierFlags);
            this.applyPathSteps(player, steps, wantsRun);
        }
    }

    private executeLocInteraction(
        player: PlayerState,
        info: PendingLocInteraction,
        interactionLevel: number,
        routeTile: { x: number; y: number },
        routeSizeX: number,
        routeSizeY: number,
        tick: number,
        immediate: boolean,
    ): boolean {
        player.clearPath();
        player.clearWalkDestination();
        this.faceLocOnInteraction(player, routeTile, routeSizeX, routeSizeY);

        const event = {
            tick: tick,
            player,
            locId: info.id,
            tile: { x: info.tile.x, y: info.tile.y },
            level: interactionLevel,
            action: info.action,
        };
        const scriptHandled = immediate
            ? this.scriptRuntime?.runLocInteractionNow(event) ?? false
            : this.scriptRuntime?.queueLocInteraction(event) ?? false;
        if (scriptHandled) {
            return true;
        }

        try {
            const action = info.action ? ` action="${info.action}"` : "";
            logger.info(
                `Player ${player.id} interacted with loc ${info.id} at (${info.tile.x},${info.tile.y},${interactionLevel})${action}`,
            );

            const actionLower = info.action?.toLowerCase() ?? "";
            const doorResult = this.doorManager?.toggleDoor({
                x: info.tile.x,
                y: info.tile.y,
                level: interactionLevel,
                currentId: info.id,
                action: info.action,
                currentTick: tick,
            });
            if (doorResult?.success && doorResult.newLocId !== undefined) {
                const level = interactionLevel;
                logger.info(
                    `[DOOR] Triggering loc change from ${info.id} to ${
                        doorResult.newLocId
                    } (action=${info.action ?? "unknown"})`,
                );
                if (this.onLocChange) {
                    this.onLocChange(info.id, doorResult.newLocId, info.tile, level, {
                        oldTile: info.tile,
                        newTile: doorResult.newTile ?? info.tile,
                        oldRotation: doorResult.oldRotation,
                        newRotation: doorResult.newRotation,
                    });
                    if (doorResult.partnerResult) {
                        this.onLocChange(
                            doorResult.partnerResult.oldLocId,
                            doorResult.partnerResult.newLocId,
                            doorResult.partnerResult.oldTile,
                            level,
                            {
                                oldTile: doorResult.partnerResult.oldTile,
                                newTile: doorResult.partnerResult.newTile,
                                oldRotation: doorResult.partnerResult.oldRotation,
                                newRotation: doorResult.partnerResult.newRotation,
                            },
                        );
                    }
                    logger.info("[DOOR] Loc change callback executed");
                } else {
                    logger.warn("[DOOR] No onLocChange callback set!");
                }
            } else if (
                actionLower &&
                Boolean(this.doorManager?.isDoorAction(info.action)) &&
                !doorResult?.success
            ) {
                logger.warn(`[DOOR] No reverse id found for loc ${info.id}`);
            }
        } catch {}

        return true;
    }

    updateLocInteractions(currentTick?: number): void {
        const tick = currentTick ?? 0;
        for (const [ws, info] of this.pendingLocInteractions.entries()) {
            const me = this.players.get(ws);
            if (!me) {
                this.pendingLocInteractions.delete(ws);
                return;
            }
            if (info.level !== undefined && me.level !== info.level) continue;
            const resolved = this.resolvePendingLocInteraction(me, info);
            const interactionLevel = resolved.interactionLevel;
            const rect = resolved.rect;
            const routeSizeX = resolved.routeSizeX;
            const routeSizeY = resolved.routeSizeY;
            const insideRect =
                me.tileX >= rect.tile.x &&
                me.tileX <= rect.tile.x + routeSizeX - 1 &&
                me.tileY >= rect.tile.y &&
                me.tileY <= rect.tile.y + routeSizeY - 1;

            const arrived = resolved.hasArrived;
            // If we've satisfied the route strategy (including wall checks), interact immediately.
            if (arrived) {
                this.executeLocInteraction(
                    me,
                    info,
                    interactionLevel,
                    rect.tile,
                    routeSizeX,
                    routeSizeY,
                    tick,
                    false,
                );
                this.pendingLocInteractions.delete(ws);
                continue;
            }

            // If we're standing inside the rect but the route strategy hasn't been satisfied,
            // move to the nearest reachable edge instead of bouncing around the tile.
            if (insideRect && !arrived) {
                const fallbackInside = this.findReachableAdjacency(
                    { x: me.tileX, y: me.tileY },
                    rect.tile,
                    routeSizeX,
                    routeSizeY,
                    interactionLevel,
                );
                if (fallbackInside) {
                    this.routePlayerToTile(
                        me,
                        fallbackInside,
                        this.resolveRunMode(me, info.modifierFlags),
                    );
                    continue;
                }
            }
        }
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

    /**
     * OSRS parity: Make the player face the loc when interaction triggers.
     * For normal objects (trees, rocks, etc.), face towards the center of the object.
     * This matches RSMod's faceObj behavior.
     */
    private faceLocOnInteraction(
        player: PlayerState,
        locTile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
    ): void {
        // Calculate the center of the object (using half-tile offsets like RSMod)
        // For a 1x1 object at (x, y), face tile (x, y)
        // For a 2x2 object at (x, y), face tile (x + 1, y + 1) - the center
        const centerX = locTile.x + (sizeX >> 1);
        const centerY = locTile.y + (sizeY >> 1);

        // Only face if we're not already on the same tile
        if (player.tileX !== centerX || player.tileY !== centerY) {
            player.faceTile(centerX, centerY);
        }
    }

    // Decide the route strategy for a loc interaction using the loc definition metadata.
    // OSRS parity: Sets collision getter on wall-aware strategies so hasArrived() checks walls.
    private selectLocRouteStrategy(
        id: number,
        tile: { x: number; y: number },
        action: string | undefined,
        sizeX: number,
        sizeY: number,
        level: number,
    ): RouteStrategy {
        const profile = this.getLocRouteProfile(id);
        const collisionGetter = (x: number, y: number, p: number) =>
            this.pathService.getCollisionFlagAt(x, y, p);
        const isDoorInteraction = this.isDoorAction(action);
        const doorBlockedSides = isDoorInteraction
            ? this.doorManager?.getDoorBlockedDirections(tile.x, tile.y, level, id)
            : undefined;

        if (profile.kind === "cardinal") {
            const allowDoorOverlap = isDoorInteraction;
            const strat = new CardinalAdjacentRouteStrategy(
                tile.x,
                tile.y,
                sizeX,
                sizeY,
                allowDoorOverlap,
                doorBlockedSides,
            );
            // Door interactions must be possible from either side of the closed wall edge.
            // Keep wall-edge blocking checks for non-door wall interactions.
            if (!isDoorInteraction) {
                strat.setCollisionGetter(collisionGetter, level);
            }
            return strat;
        }
        if (profile.kind === "range") {
            return new RectWithinRangeRouteStrategy(
                tile.x,
                tile.y,
                sizeX,
                sizeY,
                Math.max(1, profile.distance),
            );
        }
        if (profile.kind === "inside") {
            return new RectRouteStrategy(tile.x, tile.y, Math.max(1, sizeX), Math.max(1, sizeY));
        }
        if (profile.kind === "adjacent_overlap") {
            const strat = new RectAdjacentRouteStrategy(
                tile.x,
                tile.y,
                sizeX,
                sizeY,
                true, // allowOverlap
                false, // allowLargeDiagonal - OSRS blocks diagonal interactions
            );
            strat.setCollisionGetter(collisionGetter, level);
            return strat;
        }
        const strat = new RectAdjacentRouteStrategy(
            tile.x,
            tile.y,
            sizeX,
            sizeY,
            false, // allowOverlap
            false, // allowLargeDiagonal - OSRS blocks diagonal interactions
        );
        strat.setCollisionGetter(collisionGetter, level);
        return strat;
    }

    private isDoorAction(action: string | undefined): boolean {
        if (!action) return false;
        if (this.doorManager?.isDoorAction(action)) {
            return true;
        }
        const actionLower = action.toLowerCase();
        return (
            actionLower === "open" ||
            actionLower === "close" ||
            actionLower === "unlock" ||
            actionLower === "lock" ||
            actionLower.startsWith("pay-toll(")
        );
    }

    private getLocRouteProfile(locId: number): LocRouteProfile {
        const cached = this.locRouteProfileCache.get(locId);
        if (cached) return cached;
        const profile = this.deriveLocRouteProfile(locId);
        this.locRouteProfileCache.set(locId, profile);
        return profile;
    }

    private deriveLocRouteProfile(locId: number): LocRouteProfile {
        const fallback: LocRouteProfile = { kind: "adjacent" };
        const loader: any = this.locTypeLoader;
        if (!loader?.load) {
            return fallback;
        }
        let loc: any;
        try {
            loc = loader.load(locId);
        } catch {
            return fallback;
        }
        if (!loc) {
            return fallback;
        }
        const typeList: number[] =
            Array.isArray(loc.types) && loc.types.length > 0
                ? loc.types.map((t: number) => t)
                : [LocModelType.NORMAL];
        const isWallish = typeList.some((type) => WALLISH_TYPES.has(type as LocModelType));
        if (isWallish) {
            return { kind: "cardinal" };
        }
        const clipType = Number.isFinite(loc.clipType) ? (loc.clipType as number) : 0;
        const sizeX = Math.max(1, loc.sizeX);
        const sizeY = Math.max(1, loc.sizeY);
        if (clipType === 0) {
            // Floor decorations (e.g., traps, rugs) are interacted with by standing on them
            if (typeList.includes(LocModelType.FLOOR_DECORATION)) {
                return { kind: "inside" };
            }

            // Scenery with actions (e.g., flax, small plants) that doesn't block movement
            // should usually be interacted with from adjacent tiles, not by standing on top.
            if (
                loc.actions &&
                Array.isArray(loc.actions) &&
                loc.actions.some((action: string | undefined) =>
                    Boolean(action && action.length > 0),
                )
            ) {
                return { kind: "adjacent_overlap" };
            }

            return { kind: "inside" };
        }
        // Note: blocksProjectile is only relevant for ranged/magic attacks on NPCs,
        // not for loc interactions. All loc interactions require cardinal adjacency.
        return fallback;
    }

    private isFollowingWithMode(ws: any, targetId: number, mode: FollowInteractionKind): boolean {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== mode) return false;
        return st.targetId === targetId;
    }

    private getTargetForward(target: PlayerState): { dx: number; dy: number } {
        const queue = target.getPathQueue();
        if (queue.length > 0) {
            const next = queue[0];
            const dx = Math.sign(next.x - target.tileX);
            const dy = Math.sign(next.y - target.tileY);
            if (dx !== 0 || dy !== 0) return { dx, dy };
        }
        const sector = this.rotToSector(target.getOrientation() & 2047);
        const map: { dx: number; dy: number }[] = [
            { dx: 0, dy: -1 },
            { dx: -1, dy: -1 },
            { dx: -1, dy: 0 },
            { dx: -1, dy: 1 },
            { dx: 0, dy: 1 },
            { dx: 1, dy: 1 },
            { dx: 1, dy: 0 },
            { dx: 1, dy: -1 },
        ];
        return map[sector];
    }

    private rotToSector(rot: number): number {
        return Math.round((rot & 2047) / 256) & 7;
    }

    private getFollowCandidates(
        tx: number,
        ty: number,
        fdx: number,
        fdy: number,
    ): {
        behind: { x: number; y: number };
        backLeft: { x: number; y: number };
        backRight: { x: number; y: number };
        twoBehind: { x: number; y: number };
    } {
        const behind = { x: tx - fdx, y: ty - fdy };
        const backLeft = { x: behind.x - fdy, y: behind.y + fdx };
        const backRight = { x: behind.x + fdy, y: behind.y - fdx };
        const twoBehind = { x: tx - 2 * fdx, y: ty - 2 * fdy };
        return { behind, backLeft, backRight, twoBehind };
    }

    private getFollowRing(tx: number, ty: number, sector: number): { x: number; y: number }[] {
        const offsets = [
            { x: 0, y: -1 },
            { x: -1, y: -1 },
            { x: -1, y: 0 },
            { x: -1, y: 1 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: 0 },
            { x: 1, y: -1 },
        ];
        const rotated = offsets.map((offset, idx) => {
            const rel = offsets[(idx + sector) & 7];
            return { x: tx + rel.x, y: ty + rel.y };
        });
        return rotated;
    }

    private getSwirlRing(tx: number, ty: number, dir: 1 | -1): { x: number; y: number }[] {
        return dir === 1
            ? [
                  { x: tx, y: ty - 1 },
                  { x: tx + 1, y: ty - 1 },
                  { x: tx + 1, y: ty },
                  { x: tx + 1, y: ty + 1 },
                  { x: tx, y: ty + 1 },
                  { x: tx - 1, y: ty + 1 },
                  { x: tx - 1, y: ty },
                  { x: tx - 1, y: ty - 1 },
              ]
            : [
                  { x: tx, y: ty - 1 },
                  { x: tx - 1, y: ty - 1 },
                  { x: tx - 1, y: ty },
                  { x: tx - 1, y: ty + 1 },
                  { x: tx, y: ty + 1 },
                  { x: tx + 1, y: ty + 1 },
                  { x: tx + 1, y: ty },
                  { x: tx + 1, y: ty - 1 },
              ];
    }

    private getTradePositions(tx: number, ty: number): { x: number; y: number }[] {
        return [
            { x: tx, y: ty - 1 },
            { x: tx - 1, y: ty },
            { x: tx + 1, y: ty },
            { x: tx, y: ty + 1 },
            { x: tx - 1, y: ty - 1 },
            { x: tx + 1, y: ty - 1 },
            { x: tx - 1, y: ty + 1 },
            { x: tx + 1, y: ty + 1 },
        ];
    }

    private applyPathSteps(actor: Actor, steps: { x: number; y: number }[], run: boolean): boolean {
        const normalizedSteps = Array.isArray(steps) ? steps.map((s) => ({ x: s.x, y: s.y })) : [];

        let prevX = actor.tileX;
        let prevY = actor.tileY;
        for (const step of normalizedSteps) {
            const dx = Math.abs(step.x - prevX);
            const dy = Math.abs(step.y - prevY);
            // OSRS parity: path buffers are per-tile steps (Chebyshev distance 1).
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
        strategy: RouteStrategy,
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

    private shouldPreservePendingLocInteraction(
        pending: PendingLocInteraction,
        destination: { x: number; y: number } | undefined,
        player: PlayerState | undefined,
    ): boolean {
        if (!destination || !player) return false;
        const level = pending.level !== undefined ? normalizeInt(pending.level) : player.level;
        const visibleLoc = this.resolveVisibleLocRouteState(player, pending.id);
        const rect = this.resolveLocRouteRect(
            this.resolveDoorRouteTile(
                visibleLoc.locId,
                {
                    x: normalizeInt(pending.tile.x),
                    y: normalizeInt(pending.tile.y),
                },
                level,
                pending.action,
            ),
            visibleLoc.sizeX,
            visibleLoc.sizeY,
            level,
        );
        const routeSizeX = Math.max(rect.sizeX, visibleLoc.sizeX);
        const routeSizeY = Math.max(rect.sizeY, visibleLoc.sizeY);
        const destInside =
            destination.x >= rect.tile.x &&
            destination.x <= rect.tile.x + routeSizeX - 1 &&
            destination.y >= rect.tile.y &&
            destination.y <= rect.tile.y + routeSizeY - 1;
        if (destInside) return true;
        const strategy = this.selectLocRouteStrategy(
            visibleLoc.locId,
            rect.tile,
            pending.action,
            routeSizeX,
            routeSizeY,
            level,
        );
        return strategy.hasArrived(destination.x, destination.y, level);
    }

    private resolveVisibleLocRouteState(player: PlayerState, locId: number): VisibleLocRouteState {
        const visible = loadVisibleLocTypeForPlayer(this.locTypeLoader, player, locId);
        if (!visible) {
            return {
                locId: normalizeInt(locId),
                sizeX: 1,
                sizeY: 1,
            };
        }

        const routeType = visible.type as SizedLocDefinition | undefined;
        return {
            locId: visible.id,
            sizeX: normalizePositiveInt(routeType?.sizeX),
            sizeY: normalizePositiveInt(routeType?.sizeY),
        };
    }

    private resolveDoorRouteTile(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        action: string | undefined,
    ): { x: number; y: number } {
        const normalized = { x: tile.x, y: tile.y };
        if (!this.isDoorAction(action)) {
            return normalized;
        }
        const resolved = this.doorManager?.resolveDoorInteractionTile(
            normalized.x,
            normalized.y,
            level,
            locId,
        );
        if (!resolved) {
            return normalized;
        }
        return { x: resolved.x, y: resolved.y };
    }

    private hasDirectReach(
        from: { x: number; y: number },
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level: number,
    ): boolean {
        return hasDirectReachToArea(this.pathService, from, tile, sizeX, sizeY, level);
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
            candidates.push({
                tile: { x, y: minY - 1 },
                target: { x, y: minY },
            });
            candidates.push({
                tile: { x, y: maxY + 1 },
                target: { x, y: maxY },
            });
        }
        for (let y = minY; y <= maxY; y++) {
            candidates.push({
                tile: { x: minX - 1, y },
                target: { x: minX, y },
            });
            candidates.push({
                tile: { x: maxX + 1, y },
                target: { x: maxX, y },
            });
        }
        const seen = new Set<string>();
        let best: { x: number; y: number } | undefined;
        let bestDist = Number.MAX_SAFE_INTEGER;
        for (const cand of candidates) {
            const key = `${cand.tile.x},${cand.tile.y}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!this.isTileWalkable(cand.tile.x, cand.tile.y, level)) continue;
            if (
                this.pathService.edgeHasWallBetween(
                    cand.tile.x,
                    cand.tile.y,
                    cand.target.x,
                    cand.target.y,
                    level,
                )
            ) {
                continue;
            }
            const dist = Math.abs(cand.tile.x - from.x) + Math.abs(cand.tile.y - from.y);
            if (dist < bestDist) {
                bestDist = dist;
                best = cand.tile;
            }
        }
        return best;
    }

    private resolveLocRouteRect(
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level?: number,
    ): { tile: { x: number; y: number }; sizeX: number; sizeY: number } {
        const normalized = {
            tile: { x: tile.x, y: tile.y },
            sizeX: Math.max(1, sizeX),
            sizeY: Math.max(1, sizeY),
        };
        if (level === undefined || !Number.isFinite(level)) {
            return normalized;
        }
        const rect = this.deriveLocCollisionRect(
            normalized.tile,
            normalized.sizeX,
            normalized.sizeY,
            level,
        );
        return rect ?? normalized;
    }

    private deriveLocCollisionRect(
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level: number,
    ): { tile: { x: number; y: number }; sizeX: number; sizeY: number } | undefined {
        const mask = CollisionFlag.OBJECT | CollisionFlag.OBJECT_ROUTE_BLOCKER;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let found = false;
        for (let dx = 0; dx < sizeX; dx++) {
            for (let dy = 0; dy < sizeY; dy++) {
                const wx = tile.x + dx;
                const wy = tile.y + dy;
                const flag = this.pathService.getCollisionFlagAt(wx, wy, level);
                if (flag === undefined) continue;
                if ((flag & mask) === 0) continue;
                found = true;
                if (wx < minX) minX = wx;
                if (wy < minY) minY = wy;
                if (wx > maxX) maxX = wx;
                if (wy > maxY) maxY = wy;
            }
        }
        if (!found) return undefined;
        return {
            tile: { x: minX, y: minY },
            sizeX: Math.max(1, maxX - minX + 1),
            sizeY: Math.max(1, maxY - minY + 1),
        };
    }

    private isTileWalkable(x: number, y: number, level: number): boolean {
        const flag = this.pathService.getCollisionFlagAt(x, y, level);
        // If we don't have collision data for a tile, treat it as non-walkable.
        // This avoids routing to out-of-bounds tiles which would immediately fail.
        if (flag === undefined) return false;
        const mask = CollisionFlag.OBJECT | CollisionFlag.FLOOR_BLOCKED;
        return (flag & mask) === 0;
    }

    /**
     * Attempt to route player to a tile with line of sight for ranged/magic attacks.
     * Called when player is within range but blocked by a wall.
     *
     * @returns true if successfully routed, false if no valid tile found
     */
    private tryRouteToLineOfSight(
        player: PlayerState,
        npc: NpcState,
        reach: number,
        run?: boolean,
    ): boolean {
        if (reach <= 1 || !this.isWithinAttackDistance(player, npc)) {
            return false;
        }

        const npcSize = Math.max(1, npc.size);
        const npcMinX = npc.tileX;
        const npcMinY = npc.tileY;
        const npcMaxX = npcMinX + npcSize - 1;
        const npcMaxY = npcMinY + npcSize - 1;
        const px = player.tileX;
        const py = player.tileY;
        const level = player.level;
        const wantsRun = run ?? this.resolveRunMode(player);
        let bestSteps: { x: number; y: number }[] | undefined;
        let bestPathLength = Number.MAX_SAFE_INTEGER;
        let bestPlayerDistance = Number.MAX_SAFE_INTEGER;
        let bestNpcDistance = Number.MAX_SAFE_INTEGER;

        // Search every in-range LoS tile and choose the one with the shortest actual route.
        // The previous "first matching ring tile" scan could pick a candidate that required
        // a long detour even when a later candidate reached LoS in fewer steps.
        const maxSearchRadius =
            reach +
            Math.max(
                Math.abs(px - npcMinX),
                Math.abs(px - npcMaxX),
                Math.abs(py - npcMinY),
                Math.abs(py - npcMaxY),
            ) +
            1;

        for (let ring = 0; ring <= maxSearchRadius; ring++) {
            for (let dx = -ring; dx <= ring; dx++) {
                const dyAbs = ring - Math.abs(dx);
                const dys = dyAbs === 0 ? [0] : [-dyAbs, dyAbs];

                for (const dy of dys) {
                    const tx = px + dx;
                    const ty = py + dy;

                    // Skip if inside NPC bounds
                    if (tx >= npcMinX && tx <= npcMaxX && ty >= npcMinY && ty <= npcMaxY) {
                        continue;
                    }

                    // Check distance to NPC edge (Chebyshev)
                    const clampedX = Math.max(npcMinX, Math.min(tx, npcMaxX));
                    const clampedY = Math.max(npcMinY, Math.min(ty, npcMaxY));
                    const distToNpc = Math.max(Math.abs(tx - clampedX), Math.abs(ty - clampedY));
                    if (distToNpc > reach || distToNpc === 0) {
                        continue;
                    }

                    if (!this.isTileWalkable(tx, ty, level)) {
                        continue;
                    }

                    if (!hasProjectileLineOfSightToNpc(tx, ty, level, npc, this.pathService)) {
                        continue;
                    }

                    const steps = this.findPlayerPathToTile(player, { x: tx, y: ty });
                    if (!steps) {
                        continue;
                    }

                    const pathLength = steps.length;
                    const playerDistance = Math.abs(dx) + Math.abs(dy);
                    if (
                        pathLength < bestPathLength ||
                        (pathLength === bestPathLength && playerDistance < bestPlayerDistance) ||
                        (pathLength === bestPathLength &&
                            playerDistance === bestPlayerDistance &&
                            distToNpc < bestNpcDistance)
                    ) {
                        bestSteps = steps;
                        bestPathLength = pathLength;
                        bestPlayerDistance = playerDistance;
                        bestNpcDistance = distToNpc;
                    }
                }
            }
        }

        if (!bestSteps) {
            return false;
        }
        if (bestSteps.length === 0) {
            player.clearPath();
            return true;
        }
        this.applyPathSteps(player, bestSteps, wantsRun);
        return true;
    }

    routePlayerToNpc(
        player: PlayerState,
        npc: NpcState,
        reach: number = 1,
        _allowOverlap: boolean = false,
        run?: boolean,
    ): boolean {
        const normalizedReach = Math.max(1, reach);
        const attackType = resolvePlayerAttackType(player);
        // OSRS parity: Melee requires cardinal positioning (N/S/E/W), not diagonal
        const strategy =
            normalizedReach <= 1
                ? new CardinalAdjacentRouteStrategy(
                      npc.tileX,
                      npc.tileY,
                      Math.max(1, npc.size),
                      Math.max(1, npc.size),
                  )
                : attackType !== "melee"
                ? new RectWithinRangeLineOfSightRouteStrategy(
                      npc.tileX,
                      npc.tileY,
                      Math.max(1, npc.size),
                      Math.max(1, npc.size),
                      normalizedReach,
                  )
                : new RectWithinRangeRouteStrategy(
                      npc.tileX,
                      npc.tileY,
                      Math.max(1, npc.size),
                      Math.max(1, npc.size),
                      normalizedReach,
                  );
        // OSRS parity: Melee arrival checks must be wall-aware. Without this, routing can stop on
        // geometrically-adjacent tiles that are edge-blocked by walls, causing stuck combat pathing.
        if (strategy instanceof CardinalAdjacentRouteStrategy) {
            strategy.setCollisionGetter(
                (x, y, p) => this.pathService.getCollisionFlagAt(x, y, p),
                player.level,
            );
        } else if (strategy instanceof RectWithinRangeLineOfSightRouteStrategy) {
            strategy.setProjectileRaycast((from, to) =>
                this.pathService.projectileRaycast(from, to),
            );
        }
        // OSRS parity: use the step-by-step path reconstruction. The legacy pathfinder's
        // buffer output is turn-point compressed and must not be expanded via naive interpolation.
        const res = this.pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: { x: npc.tileX, y: npc.tileY },
                size: 1,
            },
            { routeStrategy: strategy, maxSteps: 128 },
        );
        const steps = this.extractValidatedStrategyPathSteps(player, res, strategy);
        if (!steps) {
            return false;
        }
        const wantsRun = !!(run ?? this.resolveRunMode(player));
        if (steps.length === 0) {
            player.clearPath();
            return true;
        }
        player.setPath(steps, wantsRun);
        return true;
    }

    private getPlayerAttackReach(player: PlayerState): number {
        return resolvePlayerAttackReach(player);
    }

    private shouldRepeatNpcAttack(player: PlayerState): boolean {
        const combatSpellId = player.combatSpellId;
        if (combatSpellId > 0) {
            // For regular staves/salamander magic, repeating requires autocast.
            // Powered staves always repeat and are handled separately by style resolution.
            const attackType = resolvePlayerAttackType(player);
            const category = player.combatWeaponCategory ?? 0;
            const isPoweredStaff = POWERED_STAFF_CATEGORIES.has(category);
            if (attackType === "magic" && !isPoweredStaff) {
                return !!player.autocastEnabled;
            }
        }
        return true;
    }

    /**
     * Checks if a player is within attack DISTANCE of an NPC (ignoring LoS/walls).
     * Used to determine if player needs to move closer or find LoS.
     */
    private isWithinAttackDistance(player: PlayerState, npc: NpcState): boolean {
        const reach = this.getPlayerAttackReach(player);
        const size = Math.max(1, npc.size);
        const minX = npc.tileX;
        const minY = npc.tileY;
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const px = player.tileX;
        const py = player.tileY;

        // Calculate distance to nearest edge of NPC bounding box (Chebyshev distance)
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        const distance = Math.max(Math.abs(px - clampedX), Math.abs(py - clampedY));

        // Player is inside the NPC bounding box - not a valid attack position
        if (distance === 0) {
            return false;
        }

        return distance <= reach;
    }

    /**
     * Checks if a player is within attack reach of an NPC.
     *
     * OSRS Parity Notes:
     * - For melee (reach <= 1), player must be adjacent to the NPC bounding box (not overlapping)
     * - For halberds (reach = 2), player can attack from 2 tiles away but walls block
     * - For ranged/magic, reach is typically 7-10 and only requires distance check
     *
     * The distance is calculated to the NEAREST tile of the NPC, not the origin.
     * For a 2x2 NPC at (10,10), a player at (12,10) is distance 1 from tile (11,10).
     */
    private isWithinAttackReach(player: PlayerState, npc: NpcState): boolean {
        const reach = this.getPlayerAttackReach(player);
        const size = Math.max(1, npc.size);
        const minX = npc.tileX;
        const minY = npc.tileY;
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const px = player.tileX;
        const py = player.tileY;

        // Calculate distance to nearest edge of NPC bounding box (Chebyshev distance)
        // If player is inside the NPC bounds, clampedX/Y equals px/py, giving distance 0
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        const toDx = clampedX - px;
        const toDy = clampedY - py;
        const distance = Math.max(Math.abs(toDx), Math.abs(toDy));

        // Player is inside the NPC bounding box - not a valid attack position
        if (distance === 0) {
            return false;
        }

        // Too far away
        if (distance > reach) {
            return false;
        }

        // For melee reach (1), check wall collision for adjacency
        if (reach <= 1) {
            // OSRS parity: Melee attacks require cardinal positioning (N/S/E/W)
            // Reject diagonal positions - player must share an X or Y coordinate with NPC bounds
            const onCardinalX = px >= minX && px <= maxX; // Player X is within NPC X range
            const onCardinalY = py >= minY && py <= maxY; // Player Y is within NPC Y range
            if (!onCardinalX && !onCardinalY) {
                // Player is on a diagonal corner - not valid for melee
                return false;
            }

            return this.hasDirectReach(
                { x: px, y: py },
                { x: npc.tileX, y: npc.tileY },
                size,
                size,
                player.level,
            );
        }

        // For reach > 1 (e.g., halberds), use attack type resolution to decide LoS vs wall-path checks.
        const isMelee = resolvePlayerAttackType(player) === "melee";

        // OSRS parity: Ranged/magic attacks require LINE OF SIGHT to the target.
        // Wall checks are different from LoS - walls block melee, but projectiles
        // require an unobstructed raycast path to the target.
        if (!isMelee) {
            return hasProjectileLineOfSightToNpc(px, py, player.level, npc, this.pathService);
        }

        // Halberd attack - verify no walls between player and nearest NPC tile
        let cx = px;
        let cy = py;
        let remX = toDx;
        let remY = toDy;
        const checkEdge = (ax: number, ay: number, bx: number, by: number) =>
            !this.pathService.edgeHasWallBetween(ax, ay, bx, by, player.level);

        for (let i = 0; i < distance; i++) {
            const stepX = remX === 0 ? 0 : Math.sign(remX);
            const stepY = remY === 0 ? 0 : Math.sign(remY);

            if (stepX === 0 || stepY === 0) {
                // Cardinal movement
                const nx = cx + stepX;
                const ny = cy + stepY;
                if (!checkEdge(cx, cy, nx, ny)) {
                    return false;
                }
                cx = nx;
                cy = ny;
            } else {
                // Diagonal movement - check both possible paths
                const horizFirst =
                    checkEdge(cx, cy, cx + stepX, cy) &&
                    checkEdge(cx + stepX, cy, cx + stepX, cy + stepY);
                const vertFirst =
                    checkEdge(cx, cy, cx, cy + stepY) &&
                    checkEdge(cx, cy + stepY, cx + stepX, cy + stepY);

                if (!horizFirst && !vertFirst) {
                    return false;
                }
                cx = cx + stepX;
                cy = cy + stepY;
            }
            remX = remX - stepX;
            remY = remY - stepY;
        }
        return true;
    }

    computeOrientationWorld(ox: number, oy: number, tx: number, ty: number): number {
        return faceAngleRs(ox, oy, tx, ty);
    }
}

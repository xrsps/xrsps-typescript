import fs from "fs";
import path from "path";

import { BasTypeLoader } from "../../../src/rs/config/bastype/BasTypeLoader";
import { NpcType } from "../../../src/rs/config/npctype/NpcType";
import { NpcTypeLoader } from "../../../src/rs/config/npctype/NpcTypeLoader";
import { DIRECTION_TO_ORIENTATION } from "../../../src/shared/Direction";
import { getNpcCombatStats } from "../data/npcCombatStats";
import { PathService } from "../pathfinding/PathService";
import { CollisionFlag } from "../pathfinding/legacy/pathfinder/flag/CollisionFlag";
import { logger } from "../utils/logger";
import { MapCollisionService } from "../world/MapCollisionService";
import { BossScript, createBossScript } from "./combat/BossCombatScript";
import { canNpcAttackPlayerFromCurrentPosition } from "./combat/CombatAction";
import { resolveNpcAttackRange, resolveNpcAttackType } from "./combat/CombatRules";
import { StatusHitsplat } from "./combat/HitEffects";
import { isInWilderness, multiCombatSystem } from "./combat/MultiCombatZones";
import {
    AGGRESSION_TIMER_TICKS,
    type PlayerAggressionState,
    TARGET_SEARCH_INTERVAL,
} from "./combat/NpcCombatAI";
import {
    DEFAULT_NPC_WANDER_RADIUS,
    DEFAULT_NPC_COMBAT_PROFILE,
    NpcCombatProfile,
    NpcSpawnConfig,
    NpcState,
    NpcUpdateDelta,
    NpcUpdateSnapshot,
} from "./npc";
import { StatusEffectSystem } from "./systems/StatusEffectSystem";

export type NpcStatusEvent = {
    npcId: number;
    hitsplat: StatusHitsplat;
};

/** Event emitted when an NPC wants to aggro a player */
export type NpcAggressionEvent = {
    npcId: number;
    targetPlayerId: number;
};

type GroundItemSpawner = (
    itemId: number,
    quantity: number,
    tile: { x: number; y: number; level: number },
    tick: number,
    options?: { ownerId?: number; isMonsterDrop?: boolean; privateTicks?: number },
    worldViewId?: number,
) => void;

export interface PendingNpcDrop {
    itemId: number;
    quantity: number;
    tile: { x: number; y: number; level: number };
    ownerId?: number;
    isMonsterDrop: boolean;
    worldViewId?: number;
    isWilderness: boolean;
}

/** Player data returned by playerLookup for NPC combat targeting. */
export interface CombatTargetPlayer {
    id: number;
    tileX: number;
    tileY: number;
    level: number;
    isAttacking(): boolean;
    isBeingAttacked(): boolean;
    getCombatTarget(): { id: number } | undefined;
}

type NearbyAggressionPlayer = {
    id: number;
    x: number;
    y: number;
    level: number;
    combatLevel: number;
    inCombat: boolean;
    aggressionState: PlayerAggressionState;
};

const REGION_SIZE = 32; // tiles; aligns to half a chunk for coarse spatial buckets

/**
 * Build NpcCombatProfile from loaded stats or use defaults.
 * Logs a warning once per NPC type when stats are missing.
 */
function buildCombatProfile(npcTypeId: number): NpcCombatProfile {
    const stats = getNpcCombatStats(npcTypeId);
    if (!stats) {
        return DEFAULT_NPC_COMBAT_PROFILE;
    }
    return {
        attackLevel: stats.attackLevel,
        strengthLevel: stats.strengthLevel,
        defenceLevel: stats.defenceLevel,
        magicLevel: stats.magicLevel,
        rangedLevel: stats.rangedLevel,
        attackBonus: stats.attackBonus ?? 0,
        strengthBonus: stats.strengthBonus ?? 0,
        magicBonus: stats.magicBonus ?? 0,
        rangedBonus: stats.rangedBonus ?? 0,
        defenceStab: stats.defenceBonuses?.stab ?? 0,
        defenceSlash: stats.defenceBonuses?.slash ?? 0,
        defenceCrush: stats.defenceBonuses?.crush ?? 0,
        defenceMagic: stats.defenceBonuses?.magic ?? 0,
        defenceRanged: stats.defenceBonuses?.ranged ?? 0,
        maxHit: stats.maxHit,
        attackSpeed: stats.attackSpeed,
        attackType: stats.attackType,
        species: stats.species ?? [],
    };
}

type RawNpcSpawn = {
    id: number;
    name?: string;
    x: number;
    y: number;
    level: number;
    wanderRadius?: number;
    /** Movement direction index (0=SW,1=S,2=SE,3=W,4=E,5=NW,6=N,7=NE). */
    direction?: number;
    /** Optional HealthBarDefinition id (HIT_MASK) for this NPC spawn. */
    healthBarDefId?: number;
};

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/** Numeric tile key: x (14 bits) | y (14 bits) | level (2 bits) = 30 bits */
function tileKey(x: number, y: number, level: number): number {
    return (x << 16) | (y << 2) | (level & 0x3);
}

function forEachFootprintTile(
    tileX: number,
    tileY: number,
    level: number,
    size: number,
    cb: (key: number) => void,
): void {
    const footprint = Math.max(1, size | 0);
    for (let ox = 0; ox < footprint; ox++) {
        for (let oy = 0; oy < footprint; oy++) {
            cb(tileKey(tileX + ox, tileY + oy, level));
        }
    }
}

/** Numeric region key: rx (11 bits) | ry (11 bits) | level (2 bits) = 24 bits */
function regionKey(x: number, y: number, level: number): number {
    const rx = Math.floor(x / REGION_SIZE) & 0x7ff;
    const ry = Math.floor(y / REGION_SIZE) & 0x7ff;
    return (rx << 13) | (ry << 2) | (level & 0x3);
}

export class NpcManager {
    private readonly pathService: PathService;
    private readonly npcTypeLoader: NpcTypeLoader;
    private readonly basTypeLoader: BasTypeLoader;

    private readonly npcs = new Map<number, NpcState>();
    private readonly occupancy = new Map<number, Set<number>>();
    private readonly regionIndex = new Map<number, Set<number>>();
    private readonly pendingUpdates: NpcUpdateDelta[] = [];
    private statusEffects?: StatusEffectSystem;
    private maxNpcSize = 1;
    private readonly pendingRespawns = new Map<number, { npc: NpcState; respawnTick: number }>();
    private readonly pendingDeaths = new Map<
        number,
        { despawnTick: number; respawnTick: number; pendingDrops?: PendingNpcDrop[] }
    >();
    private npcCombatStats?: Record<string, any>;

    // Boss scripts for NPCs with complex combat behaviors
    private readonly bossScripts = new Map<number, BossScript>();

    // NPC indices are 16-bit (0..65534, with 65535 reserved as a sentinel).
    private nextId = 1;

    private lifecycleHooks?: {
        onRemove?: (npcId: number) => void;
        onReset?: (npcId: number) => void;
    };

    private groundItemSpawner?: GroundItemSpawner;

    constructor(
        _mapService: MapCollisionService,
        pathService: PathService,
        npcTypeLoader: NpcTypeLoader,
        basTypeLoader: BasTypeLoader,
    ) {
        this.pathService = pathService;
        this.npcTypeLoader = npcTypeLoader;
        this.basTypeLoader = basTypeLoader;
    }

    setStatusEffectSystem(system: StatusEffectSystem): void {
        this.statusEffects = system;
    }

    setLifecycleHooks(hooks: {
        onRemove?: (npcId: number) => void;
        onReset?: (npcId: number) => void;
    }): void {
        this.lifecycleHooks = hooks;
    }

    setGroundItemSpawner(spawner: GroundItemSpawner | undefined): void {
        this.groundItemSpawner = spawner;
    }

    loadFromFile(filePath: string): void {
        const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
        let raw: RawNpcSpawn[] = [];
        try {
            const json = fs.readFileSync(absPath, "utf8");
            const parsed = JSON.parse(json);
            if (Array.isArray(parsed)) {
                raw = parsed as RawNpcSpawn[];
            } else {
                logger.warn(`[NpcManager] npc spawn file ${absPath} not array`);
                return;
            }
        } catch (err) {
            logger.error(`[NpcManager] failed to load npc spawns from ${absPath}`, err);
            return;
        }

        for (const spawn of raw) {
            try {
                this.spawnNpc({
                    id: spawn.id,
                    name: spawn.name,
                    x: spawn.x,
                    y: spawn.y,
                    level: spawn.level,
                    wanderRadius: spawn.wanderRadius,
                    direction: spawn.direction,
                    healthBarDefId:
                        spawn.healthBarDefId !== undefined ? spawn.healthBarDefId : undefined,
                });
            } catch (err) {
                logger.warn(`[NpcManager] failed to spawn npc ${spawn?.id}`, err);
            }
        }

        logger.info(`[NpcManager] spawned ${this.npcs.size} NPCs from ${absPath}`);
    }

    private spawnNpc(spawn: NpcSpawnConfig): NpcState | undefined {
        if (!(spawn.id >= 0)) return undefined;
        const npcType = this.loadNpcTypeById(spawn.id);
        if (!npcType) return;

        const idleSeqId = npcType.getIdleSeqId(this.basTypeLoader);
        const walkSeqId = npcType.getWalkSeqId(this.basTypeLoader);
        const size = Math.max(1, npcType.size);
        const rotationSpeed = Math.max(1, npcType.rotationSpeed);
        const wanderRadius = Math.max(0, spawn.wanderRadius ?? DEFAULT_NPC_WANDER_RADIUS);
        this.maxNpcSize = Math.max(this.maxNpcSize, size);

        const id = this.allocateNpcId();
        const maxHitpoints = this.deriveMaxHitpoints(npcType);
        const combatLevel = npcType.combatLevel ?? -1;
        // Attack speed is stored in cache param 14
        const attackSpeed = this.deriveAttackSpeed(npcType);
        const npcCombatStats = getNpcCombatStats(npcType.id);
        // Prefer server-authored combat stats for aggression metadata when present.
        const isAggressive = this.deriveIsAggressive(npcType, npcCombatStats);
        const aggressionRadius = this.deriveAggressionRadius(npcCombatStats, isAggressive);
        const aggressionToleranceTicks = this.deriveAggressionToleranceTicks(npcCombatStats);
        const aggressionSearchDelayTicks = this.deriveAggressionSearchDelayTicks(npcCombatStats);
        // Load combat profile (stats, bonuses, species) - logged warning if missing
        const combatProfile = buildCombatProfile(npcType.id);

        const npc = new NpcState(
            id,
            npcType.id,
            size,
            idleSeqId,
            walkSeqId,
            rotationSpeed,
            { x: spawn.x, y: spawn.y, level: spawn.level },
            {
                name: spawn.name,
                wanderRadius,
                maxHitpoints,
                combatLevel,
                // Use resolved combat profile attack type as the single source of truth.
                attackType: combatProfile.attackType,
                healthBarDefId: spawn.healthBarDefId,
                attackSpeed,
                combatProfile,
                isAggressive,
                aggressionRadius,
                aggressionToleranceTicks,
                aggressionSearchDelayTicks,
            },
        );
        // Use direction from spawn config if provided, otherwise fall back to NPC type config
        const resolvedDirection =
            spawn.direction !== undefined ? spawn.direction & 7 : npcType.spawnDirection & 7;
        npc.rot = DIRECTION_TO_ORIENTATION[resolvedDirection] ?? 0;
        npc.orientation = npc.rot & 2047;
        npc.markSent();

        this.npcs.set(id, npc);
        this.addOccupancyFootprint(npc);
        this.addToRegionIndex(npc);
        this.lifecycleHooks?.onReset?.(id);

        // Initialize boss script if this NPC has one registered
        const bossScript = createBossScript(npc);
        if (bossScript) {
            this.bossScripts.set(id, bossScript);
        }
        return npc;
    }

    private allocateNpcId(): number {
        // Allocate within 0..65534, skipping 65535 (used as the updateNpcs sentinel).
        // Keep ids stable for respawns: pendingRespawns retains the npcId key.
        const MAX = 0xffff; // 65535 sentinel excluded
        for (let i = 0; i < MAX; i++) {
            const candidate = this.nextId++ & 0xffff;
            if (candidate === 0) continue;
            if (candidate === 0xffff) continue;
            if (this.npcs.has(candidate)) continue;
            if (this.pendingRespawns.has(candidate)) continue;
            return candidate;
        }
        throw new Error("[NpcManager] NPC id space exhausted (0..65534)");
    }

    private deriveMaxHitpoints(npcType: NpcType): number {
        // Prefer explicit cache stats (NpcType opcode 77) when present.
        if (npcType.hitpoints > 0) {
            return npcType.hitpoints;
        }

        // Prefer server-side NPC combat stats (OSRS source of truth) when available.
        // This avoids guessing HP from combat level.
        this.loadNpcCombatStats();
        const stats = this.npcCombatStats?.[String(npcType.id)];
        const statsHp = stats?.hitpoints;
        if (statsHp !== undefined && Number.isFinite(statsHp) && statsHp > 0) {
            return statsHp;
        }
        try {
            const params = npcType.params;
            const hpParam = params?.get?.(50) as number | undefined;
            if (hpParam !== undefined && hpParam > 0) {
                return hpParam;
            }
        } catch (err) { logger.warn("[npc] failed to resolve npc hp from params", err); }
        const combat = npcType.combatLevel;
        if (combat > 0) {
            return Math.max(1, Math.round(combat * 3));
        }
        return 10;
    }

    private loadNpcCombatStats(): void {
        if (this.npcCombatStats) return;
        try {
            const filePath = path.resolve(__dirname, "../../../gamemodes/vanilla/data/npc-combat-stats.json");
            const json = fs.readFileSync(filePath, "utf8");
            const data = JSON.parse(json);
            this.npcCombatStats = data?.npcs ?? {};
        } catch (err) {
            logger.warn("[NpcManager] failed to load npc-combat-stats.json", err);
            this.npcCombatStats = {};
        }
    }

    /**
     * Derive attack speed from NPC cache definition.
     * OSRS attack speeds: 4 ticks is standard (men, goblins), 6 for dragons, varies by NPC.
     */
    private deriveAttackSpeed(npcType: NpcType): number {
        // Try direct attackSpeed property on NpcType (opcode may define it)
        if (npcType.attackSpeed > 0) {
            return npcType.attackSpeed;
        }
        // Try cache param 14 (attack speed param in some cache versions)
        try {
            const params = npcType.params;
            const speedParam = params?.get?.(14) as number | undefined;
            // Only use if it's a reasonable attack speed value (1-12 ticks)
            if (speedParam !== undefined && speedParam >= 1 && speedParam <= 12) {
                return speedParam;
            }
        } catch (err) { logger.warn("[npc] failed to resolve npc attack speed", err); }
        // Default fallback: 4 ticks (2.4s) - most common NPC attack speed
        return 4;
    }

    /**
     * Derive whether an NPC is aggressive from cache definition.
     * NPCs with combat level > 0 and an "Attack" action are considered aggressive.
     * This is a simplification; actual OSRS uses specific flags and hardcoded lists.
     */
    private deriveIsAggressive(
        npcType: NpcType,
        combatStats?: ReturnType<typeof getNpcCombatStats>,
    ): boolean {
        if (combatStats) {
            if (combatStats.aggressive !== undefined) {
                return !!combatStats.aggressive;
            }
            if ((combatStats.aggressiveRadius ?? 0) > 0) {
                return true;
            }
        }
        // Non-combat NPCs are not aggressive
        if (npcType.combatLevel <= 0) {
            return false;
        }
        // Check if NPC has an "Attack" action (typically action slot 1 or 2)
        try {
            const actions = Array.isArray(npcType.actions) ? npcType.actions : [];
            const hasAttack = actions.some((action) => action && action.toLowerCase() === "attack");
            if (hasAttack) {
                return true;
            }
        } catch (err) { logger.warn("[npc] failed to check npc attackable status", err); }
        return false;
    }

    private deriveAggressionRadius(
        combatStats: ReturnType<typeof getNpcCombatStats>,
        isAggressive: boolean,
    ): number {
        if (combatStats?.aggressiveRadius !== undefined) {
            return Math.max(0, combatStats.aggressiveRadius | 0);
        }
        return isAggressive ? 3 : 0;
    }

    private deriveAggressionToleranceTicks(
        combatStats: ReturnType<typeof getNpcCombatStats>,
    ): number {
        if (
            combatStats?.aggressiveTimer !== undefined &&
            Number.isFinite(combatStats.aggressiveTimer)
        ) {
            return Math.trunc(combatStats.aggressiveTimer);
        }
        return AGGRESSION_TIMER_TICKS;
    }

    private deriveAggressionSearchDelayTicks(
        combatStats: ReturnType<typeof getNpcCombatStats>,
    ): number {
        if (
            combatStats?.aggroTargetDelay !== undefined &&
            Number.isFinite(combatStats.aggroTargetDelay) &&
            combatStats.aggroTargetDelay > 0
        ) {
            return Math.trunc(combatStats.aggroTargetDelay);
        }
        return TARGET_SEARCH_INTERVAL;
    }

    getById(id: number): NpcState | undefined {
        return this.npcs.get(id);
    }

    loadNpcTypeById(typeId: number): NpcType | undefined {
        try {
            return this.npcTypeLoader.load(typeId);
        } catch (err) {
            logger.warn(`[NpcManager] failed to load npc type ${typeId}`, err);
            return undefined;
        }
    }

    spawnTransientNpc(spawn: NpcSpawnConfig): NpcState | undefined {
        return this.spawnNpc(spawn);
    }

    removeNpc(npcId: number): boolean {
        const normalizedId = npcId | 0;
        if (normalizedId <= 0) return false;
        this.pendingDeaths.delete(normalizedId);
        this.pendingRespawns.delete(normalizedId);
        const npc = this.npcs.get(normalizedId);
        if (!npc) return false;

        this.lifecycleHooks?.onRemove?.(normalizedId);
        this.npcs.delete(normalizedId);
        this.removeFromIndices(npc);
        npc.clearPath();
        npc.clearInteraction();

        const bossScript = this.bossScripts.get(normalizedId);
        if (bossScript) {
            bossScript.onDeath();
            this.bossScripts.delete(normalizedId);
        }
        return true;
    }

    canOccupyTile(
        tileX: number,
        tileY: number,
        level: number,
        size: number,
        ignoreNpcId?: number,
    ): boolean {
        const footprint = Math.max(1, size | 0);
        for (let ox = 0; ox < footprint; ox++) {
            for (let oy = 0; oy < footprint; oy++) {
                const worldX = tileX + ox;
                const worldY = tileY + oy;
                const flag = this.pathService.getCollisionFlagAt(worldX, worldY, level);
                if (flag === undefined) {
                    return false;
                }
                if ((flag & (CollisionFlag.FLOOR_BLOCKED | CollisionFlag.OBJECT)) !== 0) {
                    return false;
                }
                const bucket = this.occupancy.get(tileKey(worldX, worldY, level));
                if (!bucket || bucket.size === 0) continue;
                for (const occupantId of bucket) {
                    if (ignoreNpcId !== undefined && occupantId === ignoreNpcId) continue;
                    return false;
                }
            }
        }
        return true;
    }

    queueRespawn(npcId: number, respawnTick: number): boolean {
        const normalizedId = npcId;
        if (normalizedId <= 0) return false;
        this.pendingDeaths.delete(normalizedId);
        const existing = this.pendingRespawns.get(normalizedId);
        if (existing) {
            existing.respawnTick = Math.max(existing.respawnTick, respawnTick);
            return true;
        }
        const npc = this.npcs.get(normalizedId);
        if (!npc) return false;

        this.lifecycleHooks?.onRemove?.(normalizedId);
        this.npcs.delete(normalizedId);
        this.removeFromIndices(npc);
        npc.clearPath();
        npc.clearInteraction();

        // Clean up boss script and call death handler
        const bossScript = this.bossScripts.get(normalizedId);
        if (bossScript) {
            bossScript.onDeath();
            this.bossScripts.delete(normalizedId);
        }

        this.pendingRespawns.set(normalizedId, {
            npc,
            respawnTick: Math.max(respawnTick, 0),
        });
        return true;
    }

    queueDeath(
        npcId: number,
        despawnTick: number,
        respawnTick: number,
        drops?: PendingNpcDrop[],
    ): boolean {
        const id = npcId;
        if (id <= 0) return false;
        if (!this.npcs.has(id)) return false;
        const despawnAt = Math.max(0, despawnTick);
        const respawnAt = Math.max(0, respawnTick);
        const existing = this.pendingDeaths.get(id);
        if (existing) {
            existing.despawnTick = Math.max(existing.despawnTick, despawnAt);
            existing.respawnTick = Math.max(existing.respawnTick, respawnAt);
            if (drops && drops.length > 0) {
                existing.pendingDrops = [...(existing.pendingDrops ?? []), ...drops];
            }
            return true;
        }
        this.pendingDeaths.set(id, {
            despawnTick: despawnAt,
            respawnTick: respawnAt,
            pendingDrops: drops && drops.length > 0 ? drops : undefined,
        });
        return true;
    }

    cancelRespawn(npcId: number): boolean {
        return this.pendingRespawns.delete(npcId);
    }

    /** Return the cached type definition for an NPC or undefined if unavailable. */
    getNpcType(npc: NpcState | number): NpcType | undefined {
        const state = npc instanceof NpcState ? npc : this.getById(npc);
        if (!state) return undefined;
        return this.loadNpcTypeById(state.typeId);
    }

    /**
     * Check whether the NPC's cache-defined actions include the given option (case-insensitive).
     * Useful for validating interactions like "Bank" before applying custom behavior.
     */
    hasNpcOption(npc: NpcState | number, option: string): boolean {
        const type = this.getNpcType(npc);
        if (!type) return false;
        const target = (option ?? "").trim().toLowerCase();
        if (!target) return false;
        try {
            const actions = Array.isArray(type.actions) ? type.actions : [];
            for (const a of actions) {
                if (!a) continue;
                if (a.trim().toLowerCase() === target) return true;
            }
        } catch (err) { logger.warn("[npc] failed to check npc action", err); }
        return false;
    }

    getNearby(tileX: number, tileY: number, level: number, radius: number): NpcState[] {
        const r = Math.max(1, radius);
        const searchRadius = r + Math.max(0, this.maxNpcSize - 1);
        const out: NpcState[] = [];
        const seen = new Set<number>();
        const targetLevel = level;
        const cx = tileX;
        const cy = tileY;

        const minX = cx - searchRadius;
        const maxX = cx + searchRadius;
        const minY = cy - searchRadius;
        const maxY = cy + searchRadius;
        const minRegionX = Math.floor(minX / REGION_SIZE);
        const maxRegionX = Math.floor(maxX / REGION_SIZE);
        const minRegionY = Math.floor(minY / REGION_SIZE);
        const maxRegionY = Math.floor(maxY / REGION_SIZE);

        for (let rx = minRegionX; rx <= maxRegionX; rx++) {
            for (let ry = minRegionY; ry <= maxRegionY; ry++) {
                const key = ((rx & 0x7ff) << 13) | ((ry & 0x7ff) << 2) | (targetLevel & 0x3);
                const bucket = this.regionIndex.get(key);
                if (!bucket) continue;
                for (const npcId of bucket) {
                    if (seen.has(npcId)) continue;
                    const npc = this.npcs.get(npcId);
                    if (!npc || npc.level !== targetLevel) continue;

                    const size = Math.max(1, npc.size);
                    const minNx = npc.tileX;
                    const minNy = npc.tileY;
                    const maxNx = minNx + size - 1;
                    const maxNy = minNy + size - 1;

                    let distX = 0;
                    if (cx < minNx) distX = minNx - cx;
                    else if (cx > maxNx) distX = cx - maxNx;

                    let distY = 0;
                    if (cy < minNy) distY = minNy - cy;
                    else if (cy > maxNy) distY = cy - maxNy;

                    if (Math.max(distX, distY) <= r) {
                        out.push(npc);
                        seen.add(npcId);
                    }
                }
            }
        }

        return out;
    }

    /**
     * Collect NPC ids within a radius (coarse, region-bucket based) into `out`.
     * This is used to "activate" only nearby NPCs for ticking to keep server ticks fast.
     *
     * Note: this does not do exact distance checks; it may include NPCs slightly outside
     * the requested radius. The caller can use a conservative radius.
     */
    collectNearbyIds(
        tileX: number,
        tileY: number,
        level: number,
        radius: number,
        out: Set<number>,
    ): void {
        const r = Math.max(1, radius);
        const searchRadius = r + Math.max(0, this.maxNpcSize - 1);
        const targetLevel = level;
        const cx = tileX;
        const cy = tileY;

        const minX = cx - searchRadius;
        const maxX = cx + searchRadius;
        const minY = cy - searchRadius;
        const maxY = cy + searchRadius;
        const minRegionX = Math.floor(minX / REGION_SIZE);
        const maxRegionX = Math.floor(maxX / REGION_SIZE);
        const minRegionY = Math.floor(minY / REGION_SIZE);
        const maxRegionY = Math.floor(maxY / REGION_SIZE);

        for (let rx = minRegionX; rx <= maxRegionX; rx++) {
            for (let ry = minRegionY; ry <= maxRegionY; ry++) {
                const key = ((rx & 0x7ff) << 13) | ((ry & 0x7ff) << 2) | (targetLevel & 0x3);
                const bucket = this.regionIndex.get(key);
                if (!bucket) continue;
                for (const npcId of bucket) {
                    out.add(npcId);
                }
            }
        }
    }

    getSnapshot(): NpcUpdateSnapshot[] {
        const list: NpcUpdateSnapshot[] = [];
        for (const npc of this.npcs.values()) {
            list.push({
                id: npc.id,
                typeId: npc.typeId,
                name: npc.name,
                x: npc.x,
                y: npc.y,
                level: npc.level,
                rot: npc.rot,
                size: npc.size,
                idleSeqId: npc.idleSeqId >= 0 ? npc.idleSeqId : undefined,
                walkSeqId: npc.walkSeqId >= 0 ? npc.walkSeqId : undefined,
                spawnX: npc.spawnX,
                spawnY: npc.spawnY,
                spawnLevel: npc.spawnLevel,
            });
        }
        return list;
    }

    consumeUpdates(): NpcUpdateDelta[] {
        if (this.pendingUpdates.length === 0) return [];
        const out = this.pendingUpdates.slice();
        this.pendingUpdates.length = 0;
        return out;
    }

    /**
     * Player data for NPC aggression checks.
     */
    tick(
        currentTick: number,
        playerLookup?: (playerId: number) => CombatTargetPlayer | undefined,
        activeNpcIds?: ReadonlySet<number>,
        /**
         * Get nearby players for aggression checks.
         * Returns players within the given radius of the tile.
         */
        getNearbyPlayers?: (
            tileX: number,
            tileY: number,
            level: number,
            radius: number,
        ) => NearbyAggressionPlayer[],
    ): { statusEvents: NpcStatusEvent[]; aggressionEvents: NpcAggressionEvent[] } {
        this.pendingUpdates.length = 0;
        this.processNpcDeaths(currentTick);
        this.processNpcRespawns(currentTick);
        const statusEvents: NpcStatusEvent[] = [];
        const aggressionEvents: NpcAggressionEvent[] = [];
        const roamBudget = { remaining: 24 };

        // NPCs must be processed in NPC ID order (ascending)
        // Reference: docs/tick-cycle-order.md
        const iterNpcs = (function* (
            npcs: Map<number, NpcState>,
            ids: ReadonlySet<number> | undefined,
        ): IterableIterator<NpcState> {
            if (!ids) {
                // Sort all NPCs by ID for 
                const sortedNpcs = Array.from(npcs.values()).sort((a, b) => a.id - b.id);
                yield* sortedNpcs;
                return;
            }
            // Sort the active NPC IDs before iterating
            const sortedIds = Array.from(ids).sort((a, b) => a - b);
            for (const id of sortedIds) {
                const npc = npcs.get(id);
                if (npc) yield npc;
            }
        })(this.npcs, activeNpcIds);

        for (const npc of iterNpcs) {
            try {
                // NPC tick order is Timers → Queue → Movement → Combat
                // Reference: docs/game-engine.md lines 19-29, docs/tick-cycle-order.md

                // 1. Process status effects/timers FIRST (before movement)
                const statusHitsplats =
                    this.statusEffects?.processNpc(npc, currentTick) ??
                    npc.tickStatusEffects(currentTick);
                if (statusHitsplats) {
                    for (const hitsplat of statusHitsplats) {
                        statusEvents.push({ npcId: npc.id, hitsplat });
                    }
                }

                const shouldRecoverToSpawn = this.shouldRecoverToSpawn(npc);

                // 1.5. OSRS NPC Aggression: Check for players to target
                // Reference: docs/npc-behavior.md - Aggressive NPCs target nearby players
                if (
                    !shouldRecoverToSpawn &&
                    getNearbyPlayers &&
                    !npc.isInCombat(currentTick) &&
                    !npc.isDead?.(currentTick)
                ) {
                    if (npc.isAggressive) {
                        const aggroEvent = this.checkNpcAggression(
                            npc,
                            currentTick,
                            getNearbyPlayers,
                        );
                        if (aggroEvent) {
                            aggressionEvents.push(aggroEvent);
                        }
                    }
                }

                // 2. Movement processes AFTER timers but BEFORE combat
                // This allows NPCs to move into attack range before attempting to attack

                // 2a. If NPC has a combat target, pursue them using combat movement.
                const combatTargetId = npc.getCombatTargetPlayerId();
                if (shouldRecoverToSpawn) {
                    if (combatTargetId !== undefined) {
                        npc.disengageCombatPreservingInteraction();
                        npc.scheduleNextAggressionCheck(currentTick);
                    }
                    this.processRecoveryNpcMovement(npc);
                } else if (
                    combatTargetId !== undefined &&
                    npc.isInCombat(currentTick) &&
                    playerLookup
                ) {
                    const targetPlayer = npc.resolveCombatTargetPlayer(playerLookup);
                    if (targetPlayer) {
                        const attackType = resolveNpcAttackType(npc);
                        const attackRange = resolveNpcAttackRange(npc, attackType);
                        const canAttackFromCurrentPosition =
                            canNpcAttackPlayerFromCurrentPosition(
                                npc,
                                targetPlayer,
                                attackRange,
                                attackType,
                                { pathService: this.pathService },
                            );

                        if (!canAttackFromCurrentPosition) {
                            this.queueNpcPathToward(
                                npc,
                                { x: targetPlayer.tileX, y: targetPlayer.tileY },
                                { maxQueuedSteps: 2 },
                            );
                        }
                    } else {
                        npc.disengageCombat();
                        npc.scheduleNextAggressionCheck(currentTick);
                        this.processIdleNpcMovement(npc, currentTick, roamBudget);
                    }
                } else {
                    this.processIdleNpcMovement(npc, currentTick, roamBudget);
                }

                this.prunePathAgainstCurrentCollision(npc);
                npc.setMovementTick(currentTick);
                const moved = npc.tickStep();

                // 3. Combat processes AFTER movement
                npc.tickCombat(currentTick, playerLookup);

                // 3.5. NPC Attack Scheduling: If NPC is in combat, in range, and ready to attack
                const combatTarget = npc.getCombatTargetPlayerId();
                if (
                    combatTarget !== undefined &&
                    npc.isInCombat(currentTick) &&
                    playerLookup &&
                    npc.canAttack(currentTick)
                ) {
                    const target = playerLookup(combatTarget);
                    if (target) {
                        const attackType = resolveNpcAttackType(npc);
                        const attackRange = resolveNpcAttackRange(npc, attackType);
                        const canAttackFromCurrentPosition = canNpcAttackPlayerFromCurrentPosition(
                            npc,
                            target,
                            attackRange,
                            attackType,
                            { pathService: this.pathService },
                        );

                        if (canAttackFromCurrentPosition) {
                            // Check single-combat: can we attack this player?
                            const inMultiCombat = multiCombatSystem.isMultiCombat(
                                npc.tileX,
                                npc.tileY,
                                npc.level,
                            );
                            const playerInCombat = target.isAttacking() || target.isBeingAttacked();
                            const playerTarget = target.getCombatTarget();
                            const fightingThisNpc = playerTarget?.id === npc.id;
                            const blockedBySingleWay =
                                !inMultiCombat && playerInCombat && !fightingThisNpc;

                            if (blockedBySingleWay) {
                                // if an aggro swing fails because the player is
                                // already occupied in single combat, the NPC drops the chase
                                // instead of shadowing the player until they become free.
                                npc.disengageCombat();
                                npc.scheduleNextAggressionCheck(currentTick);
                            } else {
                                // Schedule attack
                                npc.recordAttack(currentTick);
                                aggressionEvents.push({
                                    npcId: npc.id,
                                    targetPlayerId: combatTarget,
                                });
                            }
                        }
                    }
                }

                // Tick boss script if present
                const bossScript = this.bossScripts.get(npc.id);
                if (bossScript) {
                    bossScript.tick(currentTick);
                }
                const stepPos = npc.drainStepPositions();
                const didMove = npc.didMove();
                const didTurn = npc.didTurn();
                const teleported = npc.wasTeleported();
                const pendingSeq = npc.popPendingSeq();
                let stepSeq: number | undefined;
                const interactionDirty = npc.isInteractionDirty();
                const forcedSync = npc.consumeForcedSync();
                const directions: number[] = [];
                const traversals: number[] = [];

                if (stepPos.length > 0) {
                    const last = stepPos[stepPos.length - 1];
                    if (last.seq !== undefined) {
                        stepSeq = last.seq;
                    }
                    for (const step of stepPos) {
                        if (step.direction !== undefined) {
                            directions.push(step.direction & 7);
                            traversals.push(step.traversal & 3);
                        }
                    }
                }

                if (didMove || teleported) {
                    this.updateOccupancy(npc);
                    // OSRS: Track successful movement for stuck detection
                    npc.recordMovement(currentTick);
                } else if (npc.hasPath() && !npc.isFrozen(currentTick)) {
                    // NPC has a path but didn't move and isn't frozen - it's blocked
                    npc.recordBlocked();
                }

                // walking NPCs should head back toward spawn when lured out,
                // not hard-teleport immediately. Reserve hard resets for genuinely stuck NPCs.
                if (!npc.isPlayerFollower() && npc.shouldResetDueToStuck()) {
                    npc.resetToSpawn();
                    this.updateOccupancy(npc);
                    continue; // Skip further processing this tick
                }

                // Skip update delta if nothing changed
                if (
                    !didMove &&
                    !didTurn &&
                    pendingSeq === undefined &&
                    stepSeq === undefined &&
                    !interactionDirty &&
                    !forcedSync
                ) {
                    continue;
                }

                const delta: NpcUpdateDelta = {
                    id: npc.id,
                    x: npc.x,
                    y: npc.y,
                    level: npc.level,
                    rot: npc.rot,
                    orientation: npc.getOrientation() & 2047,
                    moved: teleported || didMove,
                    turned: didTurn,
                    directions: directions.length > 0 ? directions : undefined,
                    traversals: traversals.length > 0 ? traversals : undefined,
                    typeId: npc.typeId,
                    size: npc.size,
                    spawnX: npc.spawnX,
                    spawnY: npc.spawnY,
                    spawnLevel: npc.spawnLevel,
                    snap: teleported,
                };

                if (pendingSeq && pendingSeq.seqId !== undefined) {
                    if (pendingSeq.delay > 0) {
                        // Delay not yet elapsed; requeue and skip this tick.
                        npc.queueOneShotSeq(pendingSeq.seqId, pendingSeq.delay - 1);
                    } else {
                        delta.seq = pendingSeq.seqId;
                    }
                }

                this.pendingUpdates.push(delta);
                npc.clearTeleportFlag();
                npc.consumeInteractionDirty();
                // Note: Status effects already processed at start of NPC tick ()
            } catch (err) {
                logger.warn(`[NpcManager] npc tick error`, err);
            }
        }
        return { statusEvents, aggressionEvents };
    }

    private prunePathAgainstCurrentCollision(npc: NpcState): void {
        const queuedSteps = npc.getPathQueue();
        if (queuedSteps.length === 0) {
            return;
        }

        const validSteps: { x: number; y: number }[] = [];
        let currentX = npc.tileX;
        let currentY = npc.tileY;

        for (const step of queuedSteps) {
            if (
                !this.pathService.canNpcStep(
                    { x: currentX, y: currentY, plane: npc.level },
                    step,
                    npc.size,
                )
            ) {
                break;
            }
            validSteps.push(step);
            currentX = step.x;
            currentY = step.y;
        }

        if (validSteps.length === queuedSteps.length) {
            return;
        }
        if (validSteps.length === 0) {
            npc.clearPath();
            return;
        }
        npc.setPath(validSteps, !!npc.running);
    }

    forEach(cb: (npc: NpcState) => void): void {
        for (const npc of this.npcs.values()) cb(npc);
    }

    private updateOccupancy(npc: NpcState): void {
        const prevKey = tileKey(npc.lastTileX, npc.lastTileY, npc.level);
        const currKey = tileKey(npc.tileX, npc.tileY, npc.level);
        if (prevKey !== currKey) {
            this.removeOccupancyFootprint(npc, npc.lastTileX, npc.lastTileY);
            this.addOccupancyFootprint(npc);
            this.updateRegionIndex(npc);
        }
    }

    private addOccupancyFootprint(
        npc: NpcState,
        tileX: number = npc.tileX,
        tileY: number = npc.tileY,
    ): void {
        forEachFootprintTile(tileX, tileY, npc.level, npc.size, (key) => {
            let bucket = this.occupancy.get(key);
            if (!bucket) {
                bucket = new Set<number>();
                this.occupancy.set(key, bucket);
            }
            bucket.add(npc.id);
        });
    }

    private removeOccupancyFootprint(
        npc: NpcState,
        tileX: number = npc.tileX,
        tileY: number = npc.tileY,
    ): void {
        forEachFootprintTile(tileX, tileY, npc.level, npc.size, (key) => {
            const bucket = this.occupancy.get(key);
            if (!bucket) return;
            bucket.delete(npc.id);
            if (bucket.size === 0) {
                this.occupancy.delete(key);
            }
        });
    }

    private hasOccupancyConflict(tileX: number, tileY: number, npc: NpcState): boolean {
        let blocked = false;
        forEachFootprintTile(tileX, tileY, npc.level, npc.size, (key) => {
            if (blocked) return;
            const bucket = this.occupancy.get(key);
            if (!bucket) return;
            for (const occupantId of bucket) {
                if (occupantId !== npc.id) {
                    blocked = true;
                    return;
                }
            }
        });
        return blocked;
    }

    private maybeStartRoam(
        npc: NpcState,
        currentTick: number,
        roamBudget?: { remaining: number },
    ): void {
        // RSMod parity: Timer-based roaming check
        // canRoam() checks if timer elapsed, not facing pawn, can move, etc.
        if (!npc.canRoam(currentTick)) {
            return;
        }

        // RSMod parity: Always reschedule timer after attempt, regardless of success
        // Reference: npc_random_walk.plugin.kts - timer is set at end of callback
        npc.scheduleNextRoam(currentTick);

        const target = this.pickRandomTarget(npc);
        if (!target) {
            return;
        }

        if (roamBudget) {
            if (roamBudget.remaining <= 0) {
                return;
            }
            roamBudget.remaining--;
        }

        this.queueNpcPathToward(npc, target, { maxQueuedSteps: 8 });
    }

    private processIdleNpcMovement(
        npc: NpcState,
        currentTick: number,
        roamBudget?: { remaining: number },
    ): void {
        if (npc.isFacingPawn()) {
            npc.clearInteractionTarget();
        }
        this.maybeStartRoam(npc, currentTick, roamBudget);
    }

    private processRecoveryNpcMovement(npc: NpcState): void {
        npc.beginSpawnRecovery();
        this.maybeRecoverToSpawn(npc);
    }

    private maybeRecoverToSpawn(npc: NpcState): void {
        if (npc.level !== npc.spawnLevel) {
            npc.resetToSpawn();
            return;
        }
        if (npc.tileX === npc.spawnX && npc.tileY === npc.spawnY) {
            npc.stopSpawnRecovery();
            return;
        }
        this.queueNpcPathToward(
            npc,
            { x: npc.spawnX, y: npc.spawnY },
            { maxQueuedSteps: 2 },
        );
    }

    private queueNpcPathToward(
        npc: NpcState,
        target: { x: number; y: number },
        options: { maxPathCalcSteps?: number; maxQueuedSteps?: number } = {},
    ): boolean {
        if (npc.hasPath()) return false;
        const maxPathCalcSteps = Math.max(1, options.maxPathCalcSteps ?? 8);
        const maxQueuedSteps = Math.max(1, options.maxQueuedSteps ?? maxPathCalcSteps);
        const steps: { x: number; y: number }[] = [];
        let currentX = npc.tileX;
        let currentY = npc.tileY;
        const plane = npc.level;

        // NPCs use a naive step-by-step chase path and do not
        // solve around obstacles, which preserves safespot behavior.
        for (let i = 0; i < maxPathCalcSteps && steps.length < maxQueuedSteps; i++) {
            if (currentX === target.x && currentY === target.y) {
                break;
            }
            const nextStep = this.pathService.findNpcPathStep(
                { x: currentX, y: currentY, plane },
                target,
                npc.size,
            );
            if (!nextStep) {
                break;
            }
            if (nextStep.x === currentX && nextStep.y === currentY) {
                break;
            }
            steps.push(nextStep);
            currentX = nextStep.x;
            currentY = nextStep.y;
        }

        if (steps.length === 0) {
            return false;
        }
        npc.setPath(steps, false);
        return true;
    }

    /**
     * Check if an aggressive NPC should target a nearby player.
     *
     * OSRS Aggression Rules:
     * 1. NPC must be aggressive (has aggressive flag)
     * 2. Player must be within aggression radius (using NPC's SW tile as origin)
     * 3. Player's combat level must be <= 2 * NPC's combat level (or NPC level >= 63)
     * 4. NPC must not already be in combat
     * 5. Player must not be in combat (unless multi-combat zone)
     * 6. Player must not have aggression expired (10-minute tolerance timer)
     * 7. Wilderness NPCs ignore combat level check and tolerance timer
     *
     * Reference: docs/npc-behavior.md, NpcCombatAI.ts
     */
    private checkNpcAggression(
        npc: NpcState,
        currentTick: number,
        getNearbyPlayers: (
            tileX: number,
            tileY: number,
            level: number,
            radius: number,
        ) => NearbyAggressionPlayer[],
    ): NpcAggressionEvent | undefined {
        const npcCombatLevel = npc.getCombatLevel();
        if (npcCombatLevel <= 0) return undefined;
        if (!npc.isAggressionCheckReady(currentTick)) {
            return undefined;
        }
        npc.scheduleNextAggressionCheck(currentTick);

        // Check if NPC is in wilderness (special rules apply)
        const npcInWilderness = isInWilderness(npc.tileX, npc.tileY);

        // Check if NPC is in multi-combat zone
        const npcInMultiCombat = multiCombatSystem.isMultiCombat(npc.tileX, npc.tileY, npc.level);

        // Get players within aggression radius
        const nearbyPlayers = getNearbyPlayers(
            npc.tileX,
            npc.tileY,
            npc.level,
            npc.aggressionRadius,
        );

        if (nearbyPlayers.length === 0) return undefined;
        const playersByTile = new Map<number, NearbyAggressionPlayer[]>();
        for (const player of nearbyPlayers) {
            if (player.level !== npc.level) continue;
            const key = tileKey(player.x, player.y, player.level);
            const existing = playersByTile.get(key);
            if (existing) {
                existing.push(player);
            } else {
                playersByTile.set(key, [player]);
            }
        }

        // RSMod parity: scan the square around the NPC in tile order and stop at the
        // first tile containing any valid targets, then choose randomly from that tile.
        const radius = Math.max(0, npc.aggressionRadius);
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                const bucket = playersByTile.get(tileKey(npc.tileX + dx, npc.tileY + dy, npc.level));
                if (!bucket || bucket.length === 0) {
                    continue;
                }
                const validTargets = bucket.filter((player) =>
                    this.canNpcAggroPlayer(
                        npc,
                        player,
                        currentTick,
                        npcCombatLevel,
                        npcInWilderness,
                        npcInMultiCombat,
                    ),
                );
                if (validTargets.length === 0) {
                    continue;
                }
                const target =
                    validTargets[Math.floor(Math.random() * validTargets.length)] ?? validTargets[0];
                npc.engageCombat(target.id, currentTick);
                npc.recordAttack(currentTick);
                return {
                    npcId: npc.id,
                    targetPlayerId: target.id,
                };
            }
        }

        return undefined;
    }

    private shouldRecoverToSpawn(npc: NpcState): boolean {
        // Player followers are transient companions, not ambient roamers.
        // Their summon tile is not a "home" that they should recover back to.
        if (npc.isPlayerFollower()) {
            return false;
        }
        if (npc.isRecoveringToSpawn()) {
            if (
                npc.level === npc.spawnLevel &&
                npc.tileX === npc.spawnX &&
                npc.tileY === npc.spawnY &&
                !npc.hasPath()
            ) {
                npc.stopSpawnRecovery();
                return false;
            }
            return (
                npc.level !== npc.spawnLevel ||
                npc.tileX !== npc.spawnX ||
                npc.tileY !== npc.spawnY ||
                npc.hasPath()
            );
        }
        return npc.level !== npc.spawnLevel || npc.isOutsideRoamArea();
    }

    private canNpcAggroPlayer(
        npc: NpcState,
        player: NearbyAggressionPlayer,
        currentTick: number,
        npcCombatLevel: number,
        npcInWilderness: boolean,
        npcInMultiCombat: boolean,
    ): boolean {
        const dx = Math.abs(player.x - npc.tileX);
        const dy = Math.abs(player.y - npc.tileY);
        const distance = Math.max(dx, dy);
        if (distance > npc.aggressionRadius) {
            return false;
        }

        if (!npcInWilderness && npcCombatLevel < 63 && player.combatLevel > npcCombatLevel * 2) {
            return false;
        }

        if (
            !npcInWilderness &&
            this.hasNpcAggressionToleranceExpired(npc, player.aggressionState, currentTick)
        ) {
            return false;
        }

        if (!npcInMultiCombat && player.inCombat) {
            return false;
        }

        return true;
    }

    private hasNpcAggressionToleranceExpired(
        npc: NpcState,
        state: PlayerAggressionState,
        currentTick: number,
    ): boolean {
        const timer = npc.aggressionToleranceTicks | 0;
        if (timer === 2147483647) {
            return false;
        }
        if (timer === -2147483648) {
            return true;
        }
        return currentTick - state.entryTick >= timer;
    }

    private processNpcDeaths(currentTick: number): void {
        if (this.pendingDeaths.size === 0) return;
        for (const [npcId, entry] of Array.from(this.pendingDeaths.entries())) {
            if (currentTick < entry.despawnTick) continue;
            this.pendingDeaths.delete(npcId);

            // Spawn pending drops at despawn time (RSMod parity)
            if (entry.pendingDrops && this.groundItemSpawner) {
                for (const drop of entry.pendingDrops) {
                    this.groundItemSpawner(drop.itemId, drop.quantity, drop.tile, currentTick, {
                        ownerId: drop.ownerId,
                        isMonsterDrop: drop.isMonsterDrop,
                        privateTicks: drop.isWilderness ? 0 : undefined,
                    }, drop.worldViewId);
                }
            }

            this.queueRespawn(npcId, entry.respawnTick);
        }
    }

    private pickRandomTarget(npc: NpcState): { x: number; y: number } | undefined {
        const radius = Math.max(0, npc.wanderRadius);
        if (radius <= 0) return undefined;
        for (let attempts = 0; attempts < 8; attempts++) {
            const dx = Math.floor(Math.random() * (radius * 2 + 1)) - radius;
            const dy = Math.floor(Math.random() * (radius * 2 + 1)) - radius;
            const tx = clamp(npc.spawnX + dx, npc.spawnX - radius, npc.spawnX + radius);
            const ty = clamp(npc.spawnY + dy, npc.spawnY - radius, npc.spawnY + radius);
            if (tx === npc.tileX && ty === npc.tileY) continue;
            if (this.hasOccupancyConflict(tx, ty, npc)) continue;
            return { x: tx, y: ty };
        }
        return undefined;
    }

    private addToRegionIndex(npc: NpcState): void {
        const key = regionKey(npc.tileX, npc.tileY, npc.level);
        let bucket = this.regionIndex.get(key);
        if (!bucket) {
            bucket = new Set<number>();
            this.regionIndex.set(key, bucket);
        }
        bucket.add(npc.id);
    }

    private updateRegionIndex(npc: NpcState): void {
        const prevKey = regionKey(npc.lastTileX, npc.lastTileY, npc.level);
        const nextKey = regionKey(npc.tileX, npc.tileY, npc.level);
        if (prevKey === nextKey) return;
        const prevBucket = this.regionIndex.get(prevKey);
        if (prevBucket) {
            prevBucket.delete(npc.id);
            if (prevBucket.size === 0) this.regionIndex.delete(prevKey);
        }
        let nextBucket = this.regionIndex.get(nextKey);
        if (!nextBucket) {
            nextBucket = new Set<number>();
            this.regionIndex.set(nextKey, nextBucket);
        }
        nextBucket.add(npc.id);
    }

    private removeFromIndices(npc: NpcState): void {
        this.removeOccupancyFootprint(npc);

        const region = regionKey(npc.tileX, npc.tileY, npc.level);
        const bucket = this.regionIndex.get(region);
        if (bucket) {
            bucket.delete(npc.id);
            if (bucket.size === 0) {
                this.regionIndex.delete(region);
            }
        }
    }

    private processNpcRespawns(currentTick: number): void {
        if (this.pendingRespawns.size === 0) return;
        for (const [npcId, entry] of Array.from(this.pendingRespawns.entries())) {
            if (currentTick < entry.respawnTick) continue;

            const npc = entry.npc;
            this.pendingRespawns.delete(npcId);
            npc.resetToSpawn();
            // Prevent roaming on the same tick as respawn — without this,
            // the NPC spawns and moves in the same update, appearing as a
            // teleport to the client.
            npc.scheduleNextRoam(currentTick);
            this.npcs.set(npc.id, npc);
            this.addOccupancyFootprint(npc);
            this.addToRegionIndex(npc);
            this.lifecycleHooks?.onReset?.(npc.id);

            // Re-initialize boss script if applicable
            const bossScript = createBossScript(npc);
            if (bossScript) {
                this.bossScripts.set(npc.id, bossScript);
            }
        }
    }
}

/**
 * Player Death Service
 *
 * Main orchestration for player death handling following OSRS/RSMod patterns.
 * Uses tick-based death sequence (not async) for proper game loop integration.
 *
 * Death Flow:
 * 1. HP reaches 0: Lock player, snapshot skull/prayer state, queue death
 * 2. Next tick: Play death animation, start death timer
 * 3. After animation (6 ticks): calculate items, drop to ground
 * 4. Restore stats, teleport to respawn
 * 5. Send death message, unlock player
 *
 * Note: In OSRS, the death animation plays on the tick AFTER HP reaches 0,
 * not the same tick. This is why we use the "queued" phase before "animation".
 *
 * Security Checkpoints:
 * - Snapshot skull state immediately (prevents toggle exploit)
 * - Snapshot prayer state immediately (prevents Protect Item toggle)
 * - Full lock before any work (prevents action queueing)
 * - Server-side item values only
 * - Validate respawn location (no wilderness respawns)
 */
import { logger } from "../../utils/logger";
import { SKILL_IDS, SkillId } from "../../../../src/rs/skill/skills";
import { RUN_ENERGY_MAX } from "../actor";
import { getWildernessLevel, isInWilderness } from "../combat/MultiCombatZones";
import { LockState } from "../model/LockState";
import type { PlayerState } from "../player";
import { DeathHookRegistry } from "./DeathHookRegistry";
import { ItemProtectionCalculator } from "./ItemProtectionCalculator";
import {
    DEATH_ANIMATION_ID,
    DEATH_ANIMATION_TICKS,
    DEATH_JINGLE_ID,
    DEFAULT_RESPAWN_LOCATIONS,
    type DeathContext,
    DeathType,
    type PlayerDeathServices,
    type RespawnLocation,
    type ValuedItem,
} from "./types";

/** Coins item ID for untradeable PvP conversion */
const COINS_ITEM_ID = 995;

/** Wilderness boundaries for respawn validation */
const WILDERNESS_MIN_Y = 3520;

/**
 * Pending death state for a player
 */
interface PendingDeath {
    player: PlayerState;
    context: DeathContext;
    ticksRemaining: number;
    phase: "queued" | "animation" | "complete";
}

export interface PlayerDeathServiceOptions {
    services: PlayerDeathServices;
    hookRegistry?: DeathHookRegistry;
    defaultRespawnLocation?: RespawnLocation;
}

export class PlayerDeathService {
    private readonly services: PlayerDeathServices;
    private readonly hookRegistry: DeathHookRegistry;
    private defaultRespawn: RespawnLocation;

    /** Players currently in death animation - maps playerId to death state */
    private readonly pendingDeaths: Map<number, PendingDeath> = new Map();

    constructor(options: PlayerDeathServiceOptions) {
        this.services = options.services;
        this.hookRegistry =
            options.hookRegistry ??
            new DeathHookRegistry({
                log: options.services.log,
            });
        this.defaultRespawn = options.defaultRespawnLocation ?? DEFAULT_RESPAWN_LOCATIONS.lumbridge;
    }

    /**
     * Check if a player is currently dying (in death animation).
     */
    isDying(player: PlayerState): boolean {
        return this.pendingDeaths.has(player.id);
    }

    /**
     * Start the death sequence for a player.
     * This is called when player HP reaches 0.
     * The death will complete after DEATH_ANIMATION_TICKS.
     */
    startPlayerDeath(
        player: PlayerState,
        options?: {
            killer?: PlayerState;
            deathType?: DeathType;
            customRespawn?: RespawnLocation;
        },
    ): boolean {
        const log = this.services.log ?? (() => {});

        // Skip if already dying
        if (this.pendingDeaths.has(player.id)) {
            return false;
        }

        // ========================================
        // Phase 1: Lock & Capture State
        // ========================================
        // CRITICAL: Lock player FIRST to prevent action queueing exploits
        player.lock = LockState.FULL;

        // SECURITY: Snapshot skull and prayer state IMMEDIATELY
        const appearance = player.appearance;
        const wasSkulled =
            appearance?.headIcons?.skull !== undefined && appearance.headIcons.skull >= 0;
        const hadProtectItem = player.prayer.hasPrayerActive("protect_item");

        // Capture death location
        const deathLocation = {
            x: player.tileX,
            y: player.tileY,
            level: player.level,
        };

        // Determine death type
        const wildernessLevel = getWildernessLevel(deathLocation.x, deathLocation.y);
        const deathType =
            options?.deathType ??
            this.determineDeathType(deathLocation, wildernessLevel, options?.killer);

        // Calculate item protection with snapshot state
        const itemProtection = new ItemProtectionCalculator({
            getItemDefinition: this.services.getItemDefinition,
            deathType,
        }).calculate(player, wasSkulled, hadProtectItem);

        // Create immutable death context
        const context: DeathContext = Object.freeze({
            player,
            deathType,
            wasSkulled,
            hadProtectItem,
            deathLocation: Object.freeze(deathLocation),
            wildernessLevel,
            deathTick: this.services.getCurrentTick(),
            killer: options?.killer ? new WeakRef(options.killer) : undefined,
            itemProtection,
        });

        log(
            "info",
            `Player death started: ${player.name ?? player.id} at (${deathLocation.x}, ${
                deathLocation.y
            }) - ${deathType}`,
        );

        // ========================================
        // Phase 2: Queue death for next tick
        // ========================================
        // In OSRS, the death animation plays on the tick AFTER HP reaches 0,
        // not the same tick. We queue the death and play animation on first tick().
        this.pendingDeaths.set(player.id, {
            player,
            context,
            ticksRemaining: DEATH_ANIMATION_TICKS,
            phase: "queued",
        });

        return true;
    }

    /**
     * Tick the death system - call this once per game tick.
     * Processes all pending deaths and completes them when animation finishes.
     */
    tick(): void {
        for (const [playerId, death] of this.pendingDeaths) {
            // On the first tick after death is queued, play the animation
            // This ensures the death animation plays on the tick AFTER HP reaches 0 (OSRS behavior)
            if (death.phase === "queued") {
                this.services.playAnimation(death.player, DEATH_ANIMATION_ID);
                death.phase = "animation";
                continue; // Don't decrement on the same tick we start the animation
            }

            death.ticksRemaining--;

            if (death.ticksRemaining <= 0) {
                this.completePlayerDeath(death);
                this.pendingDeaths.delete(playerId);
            }
        }
    }

    /**
     * Complete the death sequence after animation.
     */
    private completePlayerDeath(death: PendingDeath): void {
        const { player, context } = death;
        const log = this.services.log ?? (() => {});

        // ========================================
        // Phase 3: Drop Items
        // ========================================
        if (context.deathType !== DeathType.SAFE) {
            this.processItemsOnDeath(player, context);
        }

        // ========================================
        // Phase 4: Restore Player State
        // ========================================
        this.restorePlayerState(player);

        // Update inventory/equipment display
        this.services.sendInventoryUpdate(player);
        this.services.refreshAppearance(player);

        // ========================================
        // Phase 5: Teleport to Respawn
        // ========================================
        const respawn = this.validateRespawnLocation(this.defaultRespawn);
        this.services.teleportPlayer(player, respawn.x, respawn.y, respawn.level);

        // Clear animation
        this.services.clearAnimation(player);

        // ========================================
        // Phase 6: Jingle, Message & Unlock
        // ========================================
        // Play death jingle on respawn ("You Are Dead!" jingle)
        this.services.playJingle?.(player, DEATH_JINGLE_ID);

        this.services.sendMessage(player, "Oh dear, you are dead!");

        // Unlock player
        player.lock = LockState.NONE;

        log("info", `Death sequence complete for ${player.name ?? player.id}`);

        // Execute post-death hooks (fire and forget)
        this.hookRegistry.executePostDeathHooks(context).catch(() => {});
    }

    /**
     * Force complete death for a player (used on disconnect).
     */
    forceCompleteDeath(playerId: number): void {
        const death = this.pendingDeaths.get(playerId);
        if (death) {
            this.completePlayerDeath(death);
            this.pendingDeaths.delete(playerId);
        }
    }

    /**
     * Cancel death for a player (used if death was cancelled by hook).
     */
    cancelDeath(playerId: number): void {
        const death = this.pendingDeaths.get(playerId);
        if (death) {
            death.player.lock = LockState.NONE;
            this.services.clearAnimation(death.player);
            this.pendingDeaths.delete(playerId);
        }
    }

    /**
     * Legacy async method - wraps the tick-based approach.
     * @deprecated Use startPlayerDeath() and tick() instead
     */
    async executePlayerDeath(
        player: PlayerState,
        options?: {
            killer?: PlayerState;
            deathType?: DeathType;
            customRespawn?: RespawnLocation;
        },
    ): Promise<boolean> {
        // Start the death sequence
        if (!this.startPlayerDeath(player, options)) {
            return false;
        }

        // Wait for animation to complete (fallback for async usage)
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (!this.pendingDeaths.has(player.id)) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
            }, 100);

            // Safety timeout - force complete after 10 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                this.forceCompleteDeath(player.id);
                resolve(true);
            }, 10000);
        });
    }

    /**
     * Determine death type based on location and context.
     */
    private determineDeathType(
        location: { x: number; y: number; level: number },
        wildernessLevel: number,
        killer?: PlayerState,
    ): DeathType {
        if (killer) {
            return DeathType.PVP;
        }
        if (wildernessLevel > 0) {
            return DeathType.DANGEROUS;
        }
        return DeathType.DANGEROUS;
    }

    /**
     * Process items on death - move kept equipment to inventory, drop lost items to ground.
     */
    private processItemsOnDeath(player: PlayerState, context: DeathContext): void {
        const { itemProtection, deathLocation, deathType } = context;
        const currentTick = this.services.getCurrentTick();
        const inWilderness = context.wildernessLevel > 0;
        const log = this.services.log ?? (() => {});

        log(
            "info",
            `Processing ${itemProtection.lost.length} lost items, keeping ${itemProtection.kept.length} items`,
        );

        // OSRS behavior: All equipment is unequipped on death.
        // Kept equipment items are moved to inventory.
        for (const item of itemProtection.kept) {
            if (item.source.type === "equipment") {
                this.moveEquipmentToInventory(player, item);
                log(
                    "info",
                    `Moved kept item ${item.itemId} x${item.quantity} from equipment:${item.source.slot} to inventory`,
                );
            }
        }

        // Remove lost items from player
        for (const item of itemProtection.lost) {
            this.removeItemFromPlayer(player, item);
            log(
                "info",
                `Dropped item ${item.itemId} x${item.quantity} from ${item.source.type}:${item.source.slot}`,
            );

            // Handle untradeable coin conversion in PvP
            let dropItemId = item.itemId;
            let dropQuantity = item.quantity;

            if (deathType === DeathType.PVP && !item.tradeable && item.value > 0) {
                dropItemId = COINS_ITEM_ID;
                dropQuantity = item.value * item.quantity;
            }

            // In wilderness/PvP, items are immediately visible
            const privateTicks = inWilderness || deathType === DeathType.PVP ? 0 : 100;

            // Get killer reference if PvP
            let ownerId: number | undefined;
            if (deathType === DeathType.PVP && context.killer) {
                const killer = context.killer.deref();
                if (killer) {
                    ownerId = killer.id;
                }
            }

            this.services.groundItemManager.spawn(
                dropItemId,
                dropQuantity,
                {
                    x: deathLocation.x,
                    y: deathLocation.y,
                    level: deathLocation.level,
                },
                currentTick,
                {
                    ownerId,
                    privateTicks,
                    durationTicks: 300,
                },
            );
        }
    }

    /**
     * Remove an item from player inventory or equipment.
     */
    private removeItemFromPlayer(player: PlayerState, item: ValuedItem): void {
        if (item.source.type === "inventory") {
            const inventory = player.getInventoryEntries();
            const entry = inventory[item.source.slot];
            if (entry && entry.itemId === item.itemId) {
                entry.itemId = -1;
                entry.quantity = 0;
            }
            player.markInventoryDirty();
        } else {
            this.removeEquipmentSlot(player, item.source.slot);
            player.markEquipmentDirty();
        }
    }

    /**
     * Remove equipment from a specific slot.
     */
    private removeEquipmentSlot(player: PlayerState, slot: number): void {
        const appearance = player.appearance;
        if (!appearance) return;

        const equip = appearance.equip;
        const equipQty = appearance.equipQty;

        if (Array.isArray(equip) && slot < equip.length) {
            equip[slot] = -1;
        }
        if (Array.isArray(equipQty) && slot < equipQty.length) {
            equipQty[slot] = 0;
        }
    }

    /**
     * Move an equipment item to inventory (for kept items on death).
     */
    private moveEquipmentToInventory(player: PlayerState, item: ValuedItem): void {
        if (item.source.type !== "equipment") return;

        const inventory = player.getInventoryEntries();

        // Find an empty inventory slot
        let emptySlot = -1;
        for (let i = 0; i < inventory.length; i++) {
            const entry = inventory[i];
            if (!entry || entry.itemId <= 0 || entry.quantity <= 0) {
                emptySlot = i;
                break;
            }
        }

        if (emptySlot >= 0) {
            // Move to inventory
            const entry = inventory[emptySlot];
            if (entry) {
                entry.itemId = item.itemId;
                entry.quantity = item.quantity;
            }
        }
        // If no empty slot, item is lost (inventory full edge case)
        // In OSRS this shouldn't happen since inventory + equipment <= 28 + 11

        // Remove from equipment
        this.removeEquipmentSlot(player, item.source.slot);
        player.markInventoryDirty();
        player.markEquipmentDirty();
    }

    /**
     * Restore player state after death.
     */
    private restorePlayerState(player: PlayerState): void {
        // Clear all prayers
        player.prayer.clearActivePrayers();

        // Clear death-related timers (stuns, freezes, etc.)
        player.timers.clearOnDeath();

        // Restore HP to max
        const maxHp = player.skillSystem.getHitpointsMax();
        player.skillSystem.setHitpointsCurrent(maxHp);

        // Reset all skill boosts/drains to base level (OSRS behavior)
        // This includes prayer points, stat drains from monsters, and potion boosts
        for (const skillId of SKILL_IDS) {
            if (skillId === SkillId.Hitpoints) continue; // HP handled separately above
            const skill = player.skillSystem.getSkill(skillId);
            player.skillSystem.setSkillBoost(skillId, skill.baseLevel);
        }

        // Restore run energy to 100% (OSRS behavior)
        player.energy.setRunEnergyUnits(RUN_ENERGY_MAX);

        // Clear poison/venom/disease effects
        player.skillSystem.curePoison();
        player.skillSystem.cureVenom();
        player.skillSystem.cureDisease();

        // Reset special attack energy to 100%
        player.specEnergy.setPercent(1000);

        // Clear any queued actions
        player.interruptQueues();

        // Clear all combat and interaction state so the player does not auto-re-engage
        try { this.services.clearCombat?.(player); } catch (err) { logger.warn("[death] failed to clear combat", err); }
        try { player.resetInteractions(); } catch (err) { logger.warn("[death] failed to reset interactions", err); }
        try { player.clearInteraction(); } catch (err) { logger.warn("[death] failed to clear interaction", err); }
        try { player.clearPath(); } catch (err) { logger.warn("[death] failed to clear path", err); }
        // Clear any NPCs that are still targeting this player
        try { this.services.clearNpcTargetsForPlayer?.(player.id); } catch (err) { logger.warn("[death] failed to clear npc targets", err); }
    }

    /**
     * Validate respawn location - prevent wilderness respawns.
     */
    private validateRespawnLocation(location: RespawnLocation): RespawnLocation {
        if (location.y >= WILDERNESS_MIN_Y && isInWilderness(location.x, location.y)) {
            this.services.log?.(
                "warn",
                `Invalid respawn location in wilderness: (${location.x}, ${location.y})`,
            );
            return this.defaultRespawn;
        }

        if (location.x < 0 || location.y < 0 || location.level < 0 || location.level > 3) {
            this.services.log?.(
                "warn",
                `Invalid respawn location out of bounds: (${location.x}, ${location.y}, ${location.level})`,
            );
            return this.defaultRespawn;
        }

        return location;
    }

    /**
     * Get the hook registry for registering custom hooks.
     */
    getHookRegistry(): DeathHookRegistry {
        return this.hookRegistry;
    }

    /**
     * Set a custom default respawn location.
     */
    setDefaultRespawn(location: RespawnLocation): void {
        this.defaultRespawn = this.validateRespawnLocation(location);
    }
}

import { logger } from "../../../utils/logger";
import { AttackType } from "../../combat/AttackType";
import {
    DegradationSystem,
    getChargesUsed,
    setChargesUsed,
} from "../../combat/DegradationSystem";
import { HITMARK_DAMAGE } from "../../combat/HitEffects";
import type { NpcState } from "../../npc";
import type { PlayerState } from "../../player";
import type { ActionEffect, ActionExecutionResult } from "../types";
import type {
    CombatActionServices,
    HitPayload,
    ProjectileParams,
} from "./CombatActionHandler";

// Equipment slots (matches EquipmentSlot enum from Equipment.ts)
// Note: AMMO is 10, not 13 - 13 is EquipmentDisplaySlot.AMMO for widget indices
const EquipmentSlot = {
    WEAPON: 3,
    AMMO: 10,
    CAPE: 1,
} as const;

export function handleRangedAmmoConsumption(
    services: CombatActionServices,
    player: PlayerState,
    npc: NpcState,
    weaponItemId: number,
    hitCount: number,
    tick: number,
    effects: ActionEffect[],
): ActionExecutionResult {
    const equip = services.getEquipArray(player);
    const equipQty = services.getEquipQtyArray(player);

    // ========================================================================
    // Degradable Weapon Handling (Crystal Bow, Bow of Faerdhinen, etc.)
    // These weapons don't use ammo but degrade with each shot.
    // Historical crystal bow: Item ID changes every 250 shots (4212→4214→...→4223→seed)
    // ========================================================================
    if (DegradationSystem.isDegradable(weaponItemId)) {
        // Check if weapon was swapped (different item family) - reset charges if so
        const lastItemId = player.combat.degradationLastItemId.get(EquipmentSlot.WEAPON);
        const currentConfig = DegradationSystem.getConfig(weaponItemId);
        const lastConfig = lastItemId ? DegradationSystem.getConfig(lastItemId) : undefined;

        // Different base item (different config) = weapon was swapped, reset charges
        const weaponSwapped =
            lastItemId !== undefined &&
            currentConfig &&
            lastConfig &&
            currentConfig.baseItemId !== lastConfig.baseItemId;

        let currentCharges = weaponSwapped
            ? 0
            : getChargesUsed(player.combat.degradationCharges, EquipmentSlot.WEAPON);

        // Process each shot (for multi-hit attacks like dark bow spec)
        let currentItemId = weaponItemId;
        let chargesUsed = currentCharges;
        let depleted = false;

        for (let i = 0; i < hitCount; i++) {
            const result = DegradationSystem.processUse(currentItemId, chargesUsed);
            currentItemId = result.newItemId;
            chargesUsed = result.chargesUsed;
            depleted = result.depleted;

            if (depleted) break;
        }

        // Update weapon if it changed (degraded or transformed new→full)
        if (currentItemId !== weaponItemId) {
            equip[EquipmentSlot.WEAPON] = currentItemId;
            services.markEquipmentDirty(player);
            services.markAppearanceDirty(player);
            effects.push({ type: "appearanceUpdate", playerId: player.id });
        }

        // Update charge tracking (unless depleted)
        if (!depleted) {
            setChargesUsed(player.combat.degradationCharges, EquipmentSlot.WEAPON, chargesUsed);
            player.combat.degradationLastItemId.set(EquipmentSlot.WEAPON, currentItemId);
        }

        // Handle full depletion (e.g., crystal bow → crystal seed)
        if (depleted) {
            player.combat.degradationCharges.delete(EquipmentSlot.WEAPON);
            player.combat.degradationLastItemId.delete(EquipmentSlot.WEAPON);
            services.queueChatMessage({
                messageType: "game",
                text: "Your weapon has reverted to a seed.",
                targetPlayerIds: [player.id],
            });
        }

        // Degradable weapons don't need ammo - return success
        return { ok: true };
    }

    // ========================================================================
    // Standard Ammo Consumption (Bows, Crossbows, Ballistae)
    // ========================================================================
    const ammoId = equip[EquipmentSlot.AMMO];
    const ammoQty = Math.max(0, equipQty[EquipmentSlot.AMMO]);

    if (!(ammoId > 0) || ammoQty < hitCount) {
        services.queueChatMessage({
            messageType: "game",
            text: "You have no ammo left.",
            targetPlayerIds: [player.id],
        });
        return { ok: false, reason: "ammo_missing" };
    }

    // Consume ammo
    const capeId = equip[EquipmentSlot.CAPE];
    const result = services.calculateAmmoConsumption(
        weaponItemId,
        ammoId,
        ammoQty,
        capeId,
        npc.tileX,
        npc.tileY,
        Math.random,
    );

    if (result.error) {
        services.queueChatMessage({
            messageType: "game",
            text: "You have no ammo left.",
            targetPlayerIds: [player.id],
        });
        return { ok: false, reason: result.error ?? "ammo_missing" };
    }

    if (result.consumed && result.quantityUsed && result.quantityUsed > 0) {
        const remaining = Math.max(0, ammoQty - result.quantityUsed);
        if (remaining <= 0) {
            equip[EquipmentSlot.AMMO] = -1;
            equipQty[EquipmentSlot.AMMO] = 0;
        } else {
            equipQty[EquipmentSlot.AMMO] = remaining;
        }
        services.markEquipmentDirty(player);
        services.markAppearanceDirty(player);
        effects.push({ type: "appearanceUpdate", playerId: player.id });
    }

    if (result.dropped && result.quantityUsed && result.quantityUsed > 0) {
        const dropX = result.dropTileX ?? npc.tileX;
        const dropY = result.dropTileY ?? npc.tileY;
        const inWilderness = services.isInWilderness(dropX, dropY);
        services.spawnGroundItem(
            ammoId,
            result.quantityUsed,
            { x: dropX, y: dropY, level: npc.level },
            tick,
            {
                ownerId: player.id,
                privateTicks: inWilderness ? 0 : undefined,
            },
        );
    }

    return { ok: true };
}

export function handleAutocastRuneConsumption(
    services: CombatActionServices,
    player: PlayerState,
    npc: NpcState,
    weaponItemId: number,
): ActionExecutionResult {
    const autocastSpellId = player.combat.spellId;
    if (!(Number.isFinite(autocastSpellId) && autocastSpellId > 0)) {
        return { ok: true };
    }

    // Validate staff-spell compatibility
    const compatibility = services.canWeaponAutocastSpell(weaponItemId, autocastSpellId);
    if (!compatibility.compatible) {
        const message = services.getAutocastCompatibilityMessage(compatibility.reason);
        services.queueChatMessage({
            messageType: "game",
            text: message,
            targetPlayerIds: [player.id],
        });
        services.resetAutocast(player);
        return { ok: false, reason: compatibility.reason ?? "incompatible_weapon" };
    }

    // Validate and execute spell
    const validation = services.validateSpellCast({
        player,
        spellId: autocastSpellId,
        targetNpc: npc,
        isAutocast: true,
    });
    if (!validation.success) {
        if (validation.reason === "level_requirement") {
            services.queueChatMessage({
                messageType: "game",
                text: "Your Magic level is not high enough to cast this spell.",
                targetPlayerIds: [player.id],
            });
        } else if (validation.reason === "out_of_runes") {
            services.queueChatMessage({
                messageType: "game",
                text: "You do not have the runes to cast this spell.",
                targetPlayerIds: [player.id],
            });
        }
        services.resetAutocast(player);
        return { ok: false, reason: validation.reason ?? "spell_failed" };
    }

    const execution = services.executeSpellCast(
        { player, spellId: autocastSpellId, targetNpc: npc, isAutocast: true },
        validation,
    );
    if (!execution.success) {
        return { ok: false, reason: execution.reason ?? "spell_failed" };
    }

    player.markInventoryDirty();
    return { ok: true };
}

export function calculateMinimumProjectileHitDelay(
    services: CombatActionServices,
    player: PlayerState,
    npc: NpcState,
    projectileSpec: ProjectileParams | undefined,
    attackType: AttackType | undefined,
): number | undefined {
    const pathService = services.getPathService();

    if (projectileSpec && projectileSpec.projectileId) {
        const timing = services.estimateProjectileTiming({
            player,
            targetX: npc.tileX,
            targetY: npc.tileY,
            projectileDefaults: projectileSpec,
            pathService,
        });
        if (timing) {
            return Math.max(1, Math.ceil(timing.startDelay + timing.travelTime));
        }
    }

    if (attackType !== AttackType.Magic) {
        return undefined;
    }

    const spellId = player.combat.spellId ?? -1;
    const spellData = spellId > 0 ? services.getSpellData(spellId) : undefined;
    if (spellData && spellData.category === "combat") {
        const projectileDefaults = services.getProjectileParams(spellData.projectileId);
        const timing = services.estimateProjectileTiming({
            player,
            targetX: npc.tileX,
            targetY: npc.tileY,
            projectileDefaults,
            spellData,
            pathService,
        });
        if (timing) {
            return Math.max(1, Math.ceil(timing.startDelay + timing.travelTime));
        }
    }

    return undefined;
}

export function resolveHitLanded(landed: unknown, style: number, damage: number): boolean {
    return (
        landed === true ||
        landed === 1 ||
        landed === "true" ||
        (landed === undefined && style === HITMARK_DAMAGE) ||
        (landed === undefined && style !== HITMARK_DAMAGE && damage > 0)
    );
}

export function awardMagicBaseXpOnCast(
    services: CombatActionServices,
    player: PlayerState,
    attackType: AttackType | undefined,
    hitPayload: HitPayload | undefined,
    effects: ActionEffect[],
): void {
    if (attackType !== AttackType.Magic) return;

    const spellId = player.combat.spellId ?? -1;
    const spellData = spellId > 0 ? services.getSpellData(spellId) : undefined;
    if (!spellData || spellData.category !== "combat") return;

    const baseXp = services.getSpellBaseXp(spellId);
    if (baseXp <= 0) return;
    const multiplierRaw = services.getSkillXpMultiplier?.(player) ?? 1;
    const xpMultiplier =
        Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1;
    const awardedXp = baseXp * xpMultiplier;
    if (awardedXp <= 0) return;

    const skill = player.skillSystem.getSkill(6); // SkillId.Magic
    const currentXp = skill.xp;
    const MAX_XP = 200_000_000;
    const newXp = Math.min(MAX_XP, currentXp + awardedXp);

    if (newXp > currentXp) {
        const oldCombatLevel = player.skillSystem.combatLevel;
        const oldLevel = skill.baseLevel;
        player.skillSystem.setSkillXp(6, newXp);
        const newLevel = player.skillSystem.getSkill(6).baseLevel;
        if (newLevel > oldLevel) {
            effects.push({
                type: "levelUp",
                playerId: player.id,
                skillId: 6,
                newLevel,
                levelIncrement: Math.max(1, newLevel - oldLevel),
            });
        }
        const newCombatLevel = player.skillSystem.combatLevel;
        if (newCombatLevel > oldCombatLevel) {
            effects.push({
                type: "combatLevelUp",
                playerId: player.id,
                newLevel: newCombatLevel,
                levelIncrement: Math.max(1, newCombatLevel - oldCombatLevel),
            });
        }
        const sync = player.skillSystem.takeSkillSync();
        if (sync) {
            services.queueSkillSnapshot(player.id, sync);
        }
    }
}

export function disableAutocast(
    services: CombatActionServices,
    player: PlayerState,
    sock: unknown | undefined,
): void {
    try {
        services.resetAutocast(player);
    } catch (err) { logger.warn("[combat] failed to reset autocast", err); }
    try {
        if (sock) services.stopPlayerCombat(sock);
    } catch (err) { logger.warn("[combat] failed to stop combat after autocast disable", err); }
}

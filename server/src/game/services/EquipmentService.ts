import {
    EquipmentSlot
} from "../../../../src/rs/config/player/Equipment";
import {
    DEFAULT_WEAPON_CATEGORY,
    resolveWeaponCategoryFromObj,
} from "../../../../src/rs/config/player/WeaponCategory";
import { getItemDefinition } from "../../data/items";
import type { WeaponDataEntry } from "../../../data/weapons";
import { clearAutocastState } from "../combat/AutocastState";
import { getCategoryForWeaponInterface } from "../combat/WeaponInterfaces";
import type { CombatCategoryData } from "../combat/CombatCategoryData";
import {
    ensureEquipArrayOn,
    ensureEquipQtyArrayOn,
    inferEquipSlot,
    getSkillcapeSeqId,
    getSkillcapeSpotId,
} from "../equipment";
import type { PlayerState } from "../player";
import type { DataLoaderService } from "./DataLoaderService";
import { logger } from "../../utils/logger";

const EQUIP_SLOT_COUNT = 14;
const EQUIPMENT_STATS_BONUS_COUNT = 14;

export interface EquipmentServiceDeps {
    dataLoaders: DataLoaderService;
    equipmentHandler: any;
    weaponData: Map<number, WeaponDataEntry>;
    combatCategoryData: CombatCategoryData | undefined;
    queueVarbit: (playerId: number, varbitId: number, value: number) => void;
    queueCombatState: (player: PlayerState) => void;
    queueChatMessage: (msg: any) => void;
    enqueueSpotAnimation: (anim: any) => void;
    scriptRuntime: any;
    getCurrentTick: () => number;
    getOrCreateAppearance: (player: PlayerState) => any;
}

/**
 * Manages equipment operations: equip/unequip, stat bonuses, weapon categories.
 * Extracted from WSServer.
 */
export interface EquipmentServiceDeferredDeps {
    equipmentHandler?: any;
    scriptRuntime?: any;
    combatCategoryData?: CombatCategoryData;
}

export class EquipmentService {
    constructor(private readonly deps: EquipmentServiceDeps) {}

    setDeferredDeps(deferred: EquipmentServiceDeferredDeps): void {
        Object.assign(this.deps, deferred);
    }

    ensureEquipArray(p: PlayerState): number[] {
        if (this.deps.equipmentHandler) {
            return this.deps.equipmentHandler.ensureEquipArray(p);
        }
        const appearance = this.deps.getOrCreateAppearance(p);
        ensureEquipQtyArrayOn(appearance, EQUIP_SLOT_COUNT);
        return ensureEquipArrayOn(appearance, EQUIP_SLOT_COUNT);
    }

    ensureEquipQtyArray(p: PlayerState): number[] {
        if (this.deps.equipmentHandler) {
            return this.deps.equipmentHandler.ensureEquipQtyArray(p);
        }
        const appearance = this.deps.getOrCreateAppearance(p);
        return ensureEquipQtyArrayOn(appearance, EQUIP_SLOT_COUNT);
    }

    getEquippedItemIds(p: PlayerState): number[] {
        const equip = this.ensureEquipArray(p);
        return equip.filter((itemId) => itemId > 0);
    }

    resolveEquipSlot(itemId: number): number | undefined {
        return inferEquipSlot(itemId, (id) => this.deps.dataLoaders.getObjType(id));
    }

    equipItem(
        p: PlayerState,
        slotIndex: number,
        itemId: number,
        equipSlot: number,
        opts?: { playSound?: boolean },
    ): { ok: boolean; reason?: string; categoryChanged: boolean; weaponItemChanged: boolean } {
        if (!this.deps.equipmentHandler) {
            return {
                ok: false,
                reason: "equipment_handler_missing",
                categoryChanged: false,
                weaponItemChanged: false,
            };
        }
        return this.deps.equipmentHandler.equipItem(p, slotIndex, itemId, equipSlot, opts);
    }

    refreshCombatWeaponCategory(p: PlayerState): {
        categoryChanged: boolean;
        weaponItemChanged: boolean;
    } {
        const equip = this.ensureEquipArray(p);
        const weaponId = equip[EquipmentSlot.WEAPON];
        const normalizedWeaponId = weaponId > 0 ? weaponId : -1;
        const previousWeaponId = p.combatWeaponItemId ?? -1;

        const dataEntry = this.deps.weaponData.get(normalizedWeaponId);
        const obj = normalizedWeaponId > 0 ? this.deps.dataLoaders.getObjType(normalizedWeaponId) : undefined;
        const def = normalizedWeaponId > 0 ? getItemDefinition(normalizedWeaponId) : undefined;
        let derived: number | undefined = getCategoryForWeaponInterface(def?.weaponInterface);
        if (dataEntry?.combatCategory !== undefined) {
            derived = dataEntry.combatCategory;
        }
        if (derived === undefined) {
            const inferred = resolveWeaponCategoryFromObj(obj, {
                defaultCategory: DEFAULT_WEAPON_CATEGORY,
            });
            if (inferred !== undefined) derived = inferred;
        }
        const normalizedCategory = derived ?? DEFAULT_WEAPON_CATEGORY;
        const previousCategory = p.combatWeaponCategory;

        const categoryChanged = previousCategory !== normalizedCategory;
        const weaponItemChanged = previousWeaponId !== normalizedWeaponId;

        p.combatWeaponCategory = normalizedCategory;
        p.combatWeaponItemId = normalizedWeaponId;
        try {
            let baseRange = 0;
            if (normalizedWeaponId > 0) {
                const rawRange = obj?.params?.get(13) as number | undefined;
                if (rawRange !== undefined && rawRange > 0) {
                    baseRange = Math.max(1, rawRange);
                }
            }
            p.combatWeaponRange = baseRange;
        } catch {
            p.combatWeaponRange = 0;
        }
        if (categoryChanged) {
            const currentSlot = Math.max(0, Math.min(p.combatStyleSlot ?? 0, 3));
            p.setCombatStyle(currentSlot, normalizedCategory);
        } else if (p.combatStyleCategory !== normalizedCategory) {
            p.combatStyleCategory = normalizedCategory;
        }

        if (this.deps.combatCategoryData) {
            p.setCombatCategoryAttackTypes(
                this.deps.combatCategoryData.getAttackTypes(normalizedCategory),
            );
            p.setCombatCategoryMeleeBonusIndices(
                this.deps.combatCategoryData.getMeleeBonusIndices(normalizedCategory),
            );
        } else {
            p.setCombatCategoryAttackTypes(undefined);
            p.setCombatCategoryMeleeBonusIndices(undefined);
        }

        return { categoryChanged, weaponItemChanged };
    }

    resetAutocast(p: PlayerState): void {
        clearAutocastState(p, {
            sendVarbit: (player: PlayerState, varbitId: number, value: number) =>
                this.deps.queueVarbit(player.id, varbitId, value),
            queueCombatState: (player: PlayerState) => this.deps.queueCombatState(player),
        });
        logger.info(`[autocast] Reset autocast for player=${p.id} due to weapon change`);
    }

    computeEquipmentStatBonuses(player: PlayerState): number[] {
        const totals = new Array<number>(EQUIPMENT_STATS_BONUS_COUNT).fill(0);
        const equip = this.ensureEquipArray(player);
        for (const rawItemId of equip) {
            if (!(rawItemId > 0)) continue;
            const def = getItemDefinition(rawItemId);
            const itemBonuses = def?.bonuses;
            if (!itemBonuses) continue;
            for (let i = 0; i < EQUIPMENT_STATS_BONUS_COUNT; i++) {
                const bonus = itemBonuses[i] ?? 0;
                if (!Number.isFinite(bonus)) continue;
                totals[i] = (totals[i] ?? 0) + bonus;
            }
        }
        return totals;
    }

    performEquipmentAction(
        player: PlayerState,
        action: { slot: number; itemId: number; optionLabel: string },
    ): boolean {
        const optionLower = action.optionLabel.toLowerCase();
        let handled = false;
        let deferredFallback: (() => boolean) | undefined;
        switch (optionLower) {
            case "operate":
                handled = this.tryHandleOperateAction(player, action.slot, action.itemId);
                break;
            case "check":
                deferredFallback = () =>
                    this.tryHandleCheckAction(player, action.slot, action.itemId);
                break;
            default:
                break;
        }
        if (!handled) {
            handled = this.tryDispatchEquipmentActionScript(player, action, optionLower);
        }
        if (!handled && deferredFallback) {
            handled = deferredFallback();
        }
        return handled;
    }

    private tryHandleOperateAction(player: PlayerState, slot: number, itemId: number): boolean {
        if (this.tryHandleSkillcapeOperate(player, slot, itemId)) {
            return true;
        }
        return false;
    }

    private tryHandleCheckAction(player: PlayerState, slot: number, itemId: number): boolean {
        const obj = this.deps.dataLoaders.getObjType(itemId);
        const name = obj?.name && obj.name.length > 0 ? obj.name : "item";
        const examine = obj?.examine && obj.examine.length > 0 ? obj.examine : "It looks ordinary.";
        this.deps.queueChatMessage({
            messageType: "game",
            text: `You check the ${name.toLowerCase()}. ${examine}`,
            targetPlayerIds: [player.id],
        });
        return true;
    }

    private tryHandleSkillcapeOperate(
        player: PlayerState,
        slot: number,
        capeItemId: number,
    ): boolean {
        if (slot !== EquipmentSlot.CAPE) return false;
        const seqId = getSkillcapeSeqId(capeItemId);
        const rawSpotId = getSkillcapeSpotId(capeItemId);
        if (seqId === undefined && rawSpotId === undefined) return false;
        const spotIdResolved = rawSpotId !== undefined && rawSpotId >= 0 ? rawSpotId : 833;
        if (seqId !== undefined && seqId >= 0) {
            try {
                player.queueOneShotSeq(seqId);
            } catch (err) {
                logger.warn(
                    `[equipment] failed to queue skillcape sequence player=${player.id} seq=${seqId}`,
                    err,
                );
            }
        }
        if (spotIdResolved >= 0) {
            this.deps.enqueueSpotAnimation({
                tick: this.deps.getCurrentTick(),
                playerId: player.id,
                spotId: spotIdResolved,
                delay: 0,
                height: 120,
            });
        }
        const obj = this.deps.dataLoaders.getObjType(capeItemId);
        const capeName = obj?.name && obj.name.length > 0 ? obj.name : "cape";
        this.deps.queueChatMessage({
            messageType: "game",
            text: `You operate the ${capeName}.`,
            targetPlayerIds: [player.id],
        });
        logger.info(
            `[equipment] player=${player.id} operated skillcape item=${capeItemId} seq=${
                seqId ?? -1
            } spot=${spotIdResolved}`,
        );
        return true;
    }

    private tryDispatchEquipmentActionScript(
        player: PlayerState,
        action: { slot: number; itemId: number; optionLabel: string },
        optionLower: string,
    ): boolean {
        try {
            const tick = this.deps.getCurrentTick();
            return this.deps.scriptRuntime.queueEquipmentAction({
                tick,
                player,
                slot: action.slot,
                itemId: action.itemId,
                option: optionLower,
                rawOption: action.optionLabel,
            });
        } catch (err) {
            logger.warn("[equipment] failed to dispatch equipment action to scripts", err);
            return false;
        }
    }

    // Format utilities
    formatEquipmentSignedInt(value: number): string {
        const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
        return safe >= 0 ? `+${safe}` : String(safe);
    }

    formatEquipmentSignedPercent(value: number): string {
        const safe = Number.isFinite(value) ? value : 0;
        const sign = safe >= 0 ? "+" : "";
        return `${sign}${safe.toFixed(1)}%`;
    }

    formatEquipmentSignedIntPercent(value: number): string {
        return `${this.formatEquipmentSignedInt(value)}%`;
    }

    formatEquipmentAttackSpeedSeconds(ticks: number): string {
        const DEFAULT_ATTACK_SPEED = 4;
        const safeTicks = Math.max(1, Number.isFinite(ticks) ? ticks : DEFAULT_ATTACK_SPEED);
        return `${(safeTicks * 0.6).toFixed(1)}s`;
    }
}

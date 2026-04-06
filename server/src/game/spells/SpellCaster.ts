import { SkillId } from "../../../../src/rs/skill/skills";
import { SpellDataEntry, getSpellData } from "./SpellDataProvider";
import { NpcState } from "../npc";
import { PlayerState } from "../player";
import { InventoryItem, RuneValidationResult, RuneValidator } from "./RuneValidator";

export type SpellCastContext = {
    player: PlayerState;
    spellId: number;
    targetNpc?: NpcState;
    targetPlayer?: PlayerState;
    targetTile?: { x: number; y: number; plane: number };
    isAutocast?: boolean;
};

export type SpellCastOutcome = {
    success: boolean;
    reason?:
        | "invalid_spell"
        | "invalid_target"
        | "out_of_range"
        | "out_of_runes"
        | "level_requirement"
        | "cooldown"
        | "restricted_zone"
        | "immune_target"
        | "already_active"
        | "line_of_sight"
        | "server_error";
    spellData?: SpellDataEntry;
    runesConsumed?: Array<{ itemId: number; quantity: number }>;
    damage?: number;
    hitLanded?: boolean;
    experienceGained?: number;
    sideEffects?: {
        freezeDuration?: number;
        bindDuration?: number;
        teleblockDuration?: number;
    };
};

/**
 * Main spell casting service that handles validation, execution, and effects
 */
export class SpellCaster {
    /**
     * Validate if a player can cast a spell
     */
    static validate(ctx: SpellCastContext): SpellCastOutcome {
        // Get spell data
        const spellData = getSpellData(ctx.spellId);
        if (!spellData) {
            return { success: false, reason: "invalid_spell" };
        }

        // Check magic level requirement
        const magicSkill = ctx.player.getSkill(SkillId.Magic);
        const baseLevel = magicSkill.baseLevel;
        const boost = magicSkill.boost;
        const magicLevel = Math.max(1, baseLevel + boost);
        if (spellData.levelRequired && magicLevel < spellData.levelRequired) {
            return { success: false, reason: "level_requirement", spellData };
        }

        // Validate rune costs
        if (spellData.runeCosts && spellData.runeCosts.length > 0) {
            const inventory = this.getPlayerInventory(ctx.player);
            const equippedItems = this.getPlayerEquipment(ctx.player);

            const runeCheck = RuneValidator.validateAndCalculate(
                spellData.runeCosts,
                inventory,
                equippedItems,
            );

            if (!runeCheck.canCast) {
                return {
                    success: false,
                    reason: "out_of_runes",
                    spellData,
                };
            }

            return {
                success: true,
                spellData,
                runesConsumed: runeCheck.runesConsumed?.map((r) => ({
                    itemId: r.runeId,
                    quantity: r.quantity,
                })),
            };
        }

        // No runes required, spell is valid
        return { success: true, spellData };
    }

    /**
     * Execute a spell cast (after validation)
     * This consumes runes and returns the outcome
     */
    static execute(ctx: SpellCastContext, validationResult: SpellCastOutcome): SpellCastOutcome {
        if (!validationResult.success || !validationResult.spellData) {
            return validationResult;
        }

        const spellData = validationResult.spellData;

        // Consume runes if any
        if (validationResult.runesConsumed && validationResult.runesConsumed.length > 0) {
            const inventory = this.getPlayerInventoryMutable(ctx.player);
            RuneValidator.consumeRunes(
                inventory,
                validationResult.runesConsumed.map((r) => ({
                    runeId: r.itemId,
                    quantity: r.quantity,
                })),
            );
        }

        // For now, return success with basic outcome
        // Combat damage will be calculated by CombatEngine
        return {
            success: true,
            spellData,
            runesConsumed: validationResult.runesConsumed,
            experienceGained: spellData.experienceGained,
        };
    }

    /**
     * Get player inventory as read-only items
     */
    private static getPlayerInventory(player: PlayerState): InventoryItem[] {
        const inventory = player.getInventoryEntries();
        return inventory
            .filter((item) => item && item.itemId > 0 && item.quantity > 0)
            .map((item) => ({
                itemId: item.itemId,
                quantity: item.quantity,
            }));
    }

    /**
     * Get player inventory as mutable items (for consumption)
     */
    private static getPlayerInventoryMutable(player: PlayerState): InventoryItem[] {
        return player.getInventoryEntries();
    }

    /**
     * Get equipped item IDs
     */
    private static getPlayerEquipment(player: PlayerState): number[] {
        const equip = player.appearance?.equip;
        if (!Array.isArray(equip)) {
            return [];
        }

        return equip.filter((itemId) => itemId > 0).map((itemId) => itemId);
    }

    /**
     * Calculate spell cast distance
     */
    static getSpellRange(spellData: SpellDataEntry): number {
        // Default magic range is 10 tiles
        // This could be extended based on spell type or equipment
        return 10;
    }

    /**
     * Check if target is in range
     */
    static isTargetInRange(
        casterX: number,
        casterY: number,
        targetX: number,
        targetY: number,
        range: number,
    ): boolean {
        const dx = Math.abs(casterX - targetX);
        const dy = Math.abs(casterY - targetY);
        return dx <= range && dy <= range;
    }
}

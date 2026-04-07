import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import type { ScriptActionHandlerContext, ScriptServices } from "../../../../src/game/scripts/types";
import { buildMessageEffect, buildSkillFailure } from "./shared";

const BOLT_ENCHANT_BOLTS_PER_SET = 10;
const BOLT_ENCHANT_DELAY_TICKS = 3;
const BOLT_ENCHANT_ACTION_GROUP = "skill.bolt_enchant";
const BOLT_ENCHANT_DEFAULT_ANIMATION = 4462;

interface SkillBoltEnchantActionData {
    sourceItemId: number;
    enchantedItemId: number;
    enchantedName: string;
    runeCosts: Array<{ runeId: number; quantity: number }>;
    xp: number;
    count: number;
    animationId?: number;
}

export function executeBoltEnchantAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as SkillBoltEnchantActionData;
    const sourceItemId = data.sourceItemId;
    const enchantedItemId = data.enchantedItemId;
    const enchantedNameRaw = data.enchantedName.trim();
    const enchantedName = enchantedNameRaw.length > 0 ? enchantedNameRaw : "bolts";
    const requestedCount = Math.max(1, data.count);
    const animationId = data.animationId ?? BOLT_ENCHANT_DEFAULT_ANIMATION;
    const xpPerSet = Math.max(0, data.xp);

    if (!(sourceItemId > 0) || !(enchantedItemId > 0)) {
        return buildSkillFailure(player, "You can't enchant those bolts.", "bolt_enchant_invalid_items");
    }

    const runeCostsRaw = Array.isArray(data.runeCosts) ? data.runeCosts : [];
    const runeCosts: Array<{ runeId: number; quantity: number }> = [];
    for (const entry of runeCostsRaw) {
        if (!(entry.runeId > 0) || !(entry.quantity > 0)) continue;
        runeCosts.push({ runeId: entry.runeId, quantity: entry.quantity });
    }

    const inventory = services.inventory.getInventoryItems(player);
    let sourceQuantity = 0;
    const runeInventory: Array<{ itemId: number; quantity: number }> = [];
    for (const entry of inventory) {
        if (!entry || entry.itemId <= 0 || entry.quantity <= 0) continue;
        if (entry.itemId === sourceItemId) sourceQuantity += entry.quantity;
        runeInventory.push({ itemId: entry.itemId, quantity: entry.quantity });
    }
    if (sourceQuantity < BOLT_ENCHANT_BOLTS_PER_SET) {
        return buildSkillFailure(player, "You don't have enough bolts to enchant.", "bolt_enchant_missing_bolts");
    }

    const equipped = (services.equipment.getEquipArray(player) ?? []).filter((id) => id > 0);
    const runeValidation = services.combat.validateRunes(runeCosts, runeInventory, equipped) ?? { canCast: false };
    if (!runeValidation.canCast) {
        return buildSkillFailure(player, "You do not have the runes to cast this spell.", "bolt_enchant_missing_runes");
    }

    const consumedRunes = Array.isArray(runeValidation.runesConsumed) ? runeValidation.runesConsumed : [];

    const boltRemoval = services.production?.takeInventoryItems(player, [{ itemId: sourceItemId, quantity: BOLT_ENCHANT_BOLTS_PER_SET }]);
    if (!boltRemoval?.ok) {
        return buildSkillFailure(player, "You don't have enough bolts to enchant.", "bolt_enchant_missing_bolts");
    }

    let runeRemoval: { ok: boolean; removed: Map<number, { itemId: number; quantity: number }> } | undefined;
    if (consumedRunes.length > 0) {
        runeRemoval = services.production?.takeInventoryItems(player, consumedRunes.map((e) => ({ itemId: e.runeId, quantity: Math.max(1, e.quantity) })));
        if (!runeRemoval?.ok) {
            services.production?.restoreInventoryRemovals(player, boltRemoval.removed);
            return buildSkillFailure(player, "You do not have the runes to cast this spell.", "bolt_enchant_missing_runes");
        }
    }

    const addResult = services.inventory.addItemToInventory(player, enchantedItemId, BOLT_ENCHANT_BOLTS_PER_SET);
    if (addResult.added <= 0) {
        services.production?.restoreInventoryRemovals(player, boltRemoval.removed);
        if (runeRemoval?.ok) services.production?.restoreInventoryRemovals(player, runeRemoval.removed);
        return buildSkillFailure(player, "You don't have enough inventory space.", "bolt_enchant_inventory_full");
    }

    services.animation.playPlayerSeq(player, animationId);
    if (xpPerSet > 0) services.skills.addSkillXp(player, SkillId.Magic, xpPerSet);
    services.onItemCraft?.(player.id, enchantedItemId, BOLT_ENCHANT_BOLTS_PER_SET);

    const effects: ActionEffect[] = [
        { type: "inventorySnapshot", playerId: player.id },
        buildMessageEffect(player, `You enchant ${BOLT_ENCHANT_BOLTS_PER_SET} ${enchantedName}.`),
    ];

    const remaining = Math.max(0, requestedCount - 1);
    if (remaining > 0) {
        const reschedule = services.combat.scheduleAction(player.id, {
            kind: "skill.bolt_enchant",
            data: { sourceItemId, enchantedItemId, enchantedName, runeCosts, xp: xpPerSet, count: remaining, animationId },
            delayTicks: BOLT_ENCHANT_DELAY_TICKS, cooldownTicks: BOLT_ENCHANT_DELAY_TICKS,
            groups: [BOLT_ENCHANT_ACTION_GROUP],
        }, tick);
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop enchanting because you're already busy."));
        }
    }

    return { ok: true, cooldownTicks: BOLT_ENCHANT_DELAY_TICKS, groups: [BOLT_ENCHANT_ACTION_GROUP], effects };
}

import { SkillId } from "../../../../../src/rs/skill/skills";
import { ALTAR_LOC_IDS } from "../../../../src/data/locEffects";
import type { IScriptRegistry, ScriptServices } from "../../../../src/game/scripts/types";
import { triggerLocEffect } from "../../../../src/game/scripts/utils/locEffects";
import { BURIABLE_BONES_XP } from "./prayerData";
import { formatOfferMessage } from "./prayerMessages";

const ALTAR_LOC_ID_SET = new Set(ALTAR_LOC_IDS);
const POH_ALTAR_IDS = new Set<number>([
    13179, 13180, 13181, 13182, 13183, 13184, 13185, 13186, 13187, 13188, 13189, 13190, 13191,
    13192, 13193, 13194, 13195, 13196, 13197, 13198, 13199, 14860, 21893,
]);

const CHAOS_ALTAR_IDS = new Set<number>([6552, 3521]);

const PRAY_ACTIONS = ["pray-at", "pray", "worship"] as const;
const OFFER_ACTIONS = ["offer", "offer-all"] as const;

const PRAY_AT_ALTAR_ANIM = 645;
const OFFER_AT_ALTAR_ANIM = 713;

const PRAY_COOLDOWN_TICKS = 6;
const OFFER_COOLDOWN_TICKS = 4;

const OFFER_ALL_LIMIT = 28;
const FULL_PRAYER_MESSAGE = "You already have full Prayer points.";
const OFFER_NONE_MESSAGE = "You have no bones to offer.";
const OFFER_SUCCESS_MESSAGE = "The gods are pleased with your offering.";

const lastPrayTickByPlayer = new Map<number, number>();
const lastOfferTickByPlayer = new Map<number, number>();

const getMultiplierForAltar = (locId: number): number => {
    if (POH_ALTAR_IDS.has(locId)) return 3.5;
    if (CHAOS_ALTAR_IDS.has(locId)) return 3.5;
    return 2;
};

const resolveBoneName = (
    services: ScriptServices,
    itemId: number,
): string => {
    try {
        const obj = services.getObjType?.(itemId);
        return (obj?.name as string) || "bones";
    } catch {
        return "bones";
    }
};

const hasCooldown = (
    map: Map<number, number>,
    playerId: number,
    tick: number,
    cooldown: number,
): boolean => {
    const last = map.get(playerId) ?? -Infinity;
    return tick <= last + cooldown;
};

const markCooldown = (map: Map<number, number>, playerId: number, tick: number): void => {
    map.set(playerId, tick);
};

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    for (const action of PRAY_ACTIONS) {
        registry.registerLocAction(action, (event) => {
            if (!ALTAR_LOC_ID_SET.has(event.locId)) return;
            const player = event.player;
            const pid = player.id;
            const tick = event.tick;
            if (hasCooldown(lastPrayTickByPlayer, pid, tick, PRAY_COOLDOWN_TICKS)) return;
            services.playPlayerSeq?.(player, PRAY_AT_ALTAR_ANIM);
            const prayerSkill = services.getSkill?.(player, SkillId.Prayer);
            const baseLevel = Math.max(1, prayerSkill?.baseLevel ?? 1);
            const currentLevel = Math.max(0, baseLevel + (prayerSkill?.boost ?? 0));
            if (currentLevel >= baseLevel) {
                services.sendGameMessage(player, FULL_PRAYER_MESSAGE);
                markCooldown(lastPrayTickByPlayer, pid, tick);
                return;
            }
            player.setSkillBoost(SkillId.Prayer, baseLevel);
            player.resetPrayerDrainAccumulator();
            services.sendGameMessage(player, "You recharge your Prayer points.");
            markCooldown(lastPrayTickByPlayer, pid, tick);
        });
    }

    for (const action of OFFER_ACTIONS) {
        registry.registerLocAction(action, (event) => {
            if (!ALTAR_LOC_ID_SET.has(event.locId)) return;
            const player = event.player;
            const pid = player.id;
            const tick = event.tick;
            if (hasCooldown(lastOfferTickByPlayer, pid, tick, OFFER_COOLDOWN_TICKS)) return;
            const inventory = services.getInventoryItems(player);
            if (inventory.length === 0) {
                services.sendGameMessage(player, OFFER_NONE_MESSAGE);
                return;
            }
            const offerAll = (event.action ?? "").toLowerCase().includes("all");
            const maxBones = offerAll ? OFFER_ALL_LIMIT : 1;
            const offerings = new Map<number, number>();
            let processed = 0;
            let totalXp = 0;
            const consume = services.consumeItem;
            for (const entry of inventory) {
                const itemId = entry.itemId;
                if (!BURIABLE_BONES_XP.has(itemId)) continue;
                if (services.getObjType?.(itemId)?.noted) continue;
                let available = Math.max(0, entry.quantity);
                while (available > 0 && processed < maxBones) {
                    if (!consume(player, entry.slot)) {
                        available = 0;
                        break;
                    }
                    available--;
                    processed++;
                    const baseXp = BURIABLE_BONES_XP.get(itemId) ?? 0;
                    const multiplier = getMultiplierForAltar(event.locId);
                    totalXp += baseXp * multiplier;
                    offerings.set(itemId, (offerings.get(itemId) ?? 0) + 1);
                }
                if (processed >= maxBones) break;
            }

            if (processed === 0) {
                services.sendGameMessage(player, OFFER_NONE_MESSAGE);
                return;
            }

            services.playPlayerSeq?.(player, OFFER_AT_ALTAR_ANIM);
            const roundedXp = Math.round(totalXp);
            if (roundedXp > 0) {
                services.addSkillXp?.(player, SkillId.Prayer, roundedXp);
            }
            services.snapshotInventoryImmediate(player);
            for (const [itemId, count] of offerings) {
                const text = formatOfferMessage(resolveBoneName(services, itemId), count);
                services.sendGameMessage(player, text);
            }
            services.sendGameMessage(player, OFFER_SUCCESS_MESSAGE);
            triggerLocEffect(services, event.locId, event.tile, event.level);
            markCooldown(lastOfferTickByPlayer, pid, tick);
        });
    }
}

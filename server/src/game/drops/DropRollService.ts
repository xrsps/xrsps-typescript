import type { PendingNpcDrop } from "../npcManager";
import { NpcDropRegistry } from "./NpcDropRegistry";
import { getLeagueVReplacementItemId } from "./leagueDrops";
import type {
    DropConditionDefinition,
    DropContext,
    DropRecipient,
    NpcDropEntry,
    NpcDropPool,
    NpcDropTable,
} from "./types";

const VARP_QUEST_POINTS = 101;

function rollQuantity(entry: NpcDropEntry): number {
    const min = Math.max(1, entry.quantity.min);
    const max = Math.max(min, entry.quantity.max);
    if (min === max) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
}

function applyLeagueMultiplier(probability: number, multiplier: number, eligible: boolean): number {
    if (!eligible || multiplier <= 1) return probability;
    return Math.max(0, Math.min(1, probability * multiplier));
}

function matchesCondition(
    condition: DropConditionDefinition | undefined,
    context: DropContext,
    recipient: DropRecipient,
): boolean {
    if (!condition) return true;
    if (condition.wildernessOnly && !context.isWilderness) return false;
    if (condition.minimumQuestPoints !== undefined) {
        const questPoints = recipient.player?.getVarpValue(VARP_QUEST_POINTS) ?? 0;
        if (questPoints < condition.minimumQuestPoints) return false;
    }
    const requiredAnyEquippedItemIds = condition.requiredAnyEquippedItemIds ?? [];
    if (requiredAnyEquippedItemIds.length > 0) {
        const equipment = recipient.player?.exportEquipmentSnapshot() ?? [];
        const hasRequiredItem = equipment.some((entry) =>
            requiredAnyEquippedItemIds.includes(entry.itemId),
        );
        if (!hasRequiredItem) return false;
    }
    return true;
}

function resolveEntryProbability(
    entry: NpcDropEntry,
    context: DropContext,
    recipient: DropRecipient,
): number {
    if (!matchesCondition(entry.condition, context, recipient)) return 0;
    const probability =
        entry.altProbability !== undefined &&
        matchesCondition(entry.altCondition, context, recipient)
            ? entry.altProbability
            : entry.probability ?? 0;
    return applyLeagueMultiplier(
        probability,
        recipient.leagueDropRateMultiplier,
        entry.leagueBoostEligible,
    );
}

function pickWeightedEntry(
    pool: NpcDropPool,
    context: DropContext,
    recipient: DropRecipient,
): NpcDropEntry | undefined {
    let total = pool.nothingProbability;
    const weightedEntries = pool.entries.map((entry) => {
        const weight = resolveEntryProbability(entry, context, recipient);
        total += weight;
        return { entry, weight };
    });
    if (!(total > 0)) return undefined;
    let roll = Math.random() * total;
    if (roll < pool.nothingProbability) return undefined;
    roll -= pool.nothingProbability;
    for (const weighted of weightedEntries) {
        roll -= weighted.weight;
        if (roll <= 0) return weighted.entry;
    }
    return undefined;
}

function rollIndependentPool(
    pool: NpcDropPool,
    context: DropContext,
    recipient: DropRecipient,
): Array<{ itemId: number; quantity: number }> {
    const out: Array<{ itemId: number; quantity: number }> = [];
    for (let roll = 0; roll < pool.rolls; roll++) {
        for (const entry of pool.entries) {
            const chance = resolveEntryProbability(entry, context, recipient);
            if (chance <= 0 || Math.random() >= chance) continue;
            out.push({ itemId: entry.itemId, quantity: rollQuantity(entry) });
        }
    }
    return out;
}

function rollWeightedPool(
    pool: NpcDropPool,
    context: DropContext,
    recipient: DropRecipient,
): Array<{ itemId: number; quantity: number }> {
    const out: Array<{ itemId: number; quantity: number }> = [];
    for (let roll = 0; roll < pool.rolls; roll++) {
        const entry = pickWeightedEntry(pool, context, recipient);
        if (!entry) continue;
        out.push({ itemId: entry.itemId, quantity: rollQuantity(entry) });
    }
    return out;
}

function toPendingDrop(
    context: DropContext,
    recipient: DropRecipient,
    itemId: number,
    quantity: number,
): PendingNpcDrop {
    return {
        itemId: getLeagueVReplacementItemId(context.npcTypeId, itemId, recipient.isLeagueVWorld),
        quantity: quantity,
        tile: { ...context.tile },
        ownerId: recipient.ownerId,
        isMonsterDrop: true,
        isWilderness: context.isWilderness,
        worldViewId: context.worldViewId,
    };
}

export class DropRollService {
    constructor(private readonly registry: NpcDropRegistry) {}

    roll(context: DropContext): PendingNpcDrop[] {
        const table = this.registry.get(context.npcTypeId);
        if (!table) return [];
        const out: PendingNpcDrop[] = [];
        const recipients =
            context.recipients.length > 0
                ? context.recipients
                : [{ isLeagueVWorld: false, leagueDropRateMultiplier: 1 }];
        for (const recipient of recipients) {
            this.rollForRecipient(table, context, recipient, out);
        }
        return out;
    }

    private rollForRecipient(
        table: NpcDropTable,
        context: DropContext,
        recipient: DropRecipient,
        out: PendingNpcDrop[],
    ): void {
        for (const entry of table.always) {
            out.push(toPendingDrop(context, recipient, entry.itemId, rollQuantity(entry)));
        }
        for (const pool of table.pools) {
            const rolled =
                pool.kind === "independent"
                    ? rollIndependentPool(pool, context, recipient)
                    : rollWeightedPool(pool, context, recipient);
            for (const drop of rolled) {
                out.push(toPendingDrop(context, recipient, drop.itemId, drop.quantity));
            }
        }
    }
}

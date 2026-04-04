import type { SkillActionRequest, SkillFishingActionData } from "../../actions/skillActionPayloads";
import { findFishingMethodByAction } from "../../skills/fishing";
import { type NpcInteractionEvent, type ScriptModule, type ScriptServices } from "../types";

const FISHING_ACTIONS = [
    "small net",
    "net",
    "big net",
    "cage",
    "harpoon",
    "lure",
    "bait",
    "use-rod",
    "fish",
];

const KYLIE_MINNOW_IDS = [7727, 7728];
const MINNOW_ITEM_ID = 21356;
const RAW_SHARK_ITEM_ID = 383;
const MINNOWS_PER_SHARK = 40;

export const fishingModule: ScriptModule = {
    id: "skills.fishing",
    register(registry, services) {
        if (!services.getFishingSpot) {
            services.logger?.warn?.("[script:fishing] fishing spot lookup unavailable");
            return;
        }
        for (const action of FISHING_ACTIONS) {
            registry.registerNpcAction(action, (event) => {
                handleFishingAction(event.option ?? action, event, services);
            });
        }

        for (const npcId of KYLIE_MINNOW_IDS) {
            registry.registerNpcInteraction(npcId, (event) => {
                handleMinnowExchange(event, services);
            });
        }
    },
};

function handleFishingAction(option: string, event: NpcInteractionEvent, services: ScriptServices) {
    const spot = services.getFishingSpot?.(event.npc.typeId);
    if (!spot) {
        services.sendGameMessage(event.player, "Nothing interesting happens.");
        return;
    }
    const method = findFishingMethodByAction(spot, option);
    if (!method) {
        services.sendGameMessage(event.player, "You can't fish there.");
        return;
    }
    const delay = method.swingTicks;
    const request: SkillActionRequest<"skill.fish"> = {
        kind: "skill.fish",
        data: {
            npcId: event.npc.id,
            npcTypeId: event.npc.typeId,
            npcSize: event.npc.size,
            spotId: spot.id,
            methodId: method.id,
            level: event.npc.level,
            started: false,
        } satisfies SkillFishingActionData,
        delayTicks: delay,
        cooldownTicks: delay,
        groups: ["skill.fish"],
    };
    const result = services.requestAction(event.player, request, event.tick);
    if (!result.ok) {
        services.sendGameMessage(event.player, "You're too busy to do that right now.");
    }
}

function handleMinnowExchange(event: NpcInteractionEvent, services: ScriptServices): void {
    const getInventory = services.getInventoryItems;
    const setSlot = services.setInventorySlot;
    const addItem = services.addItemToInventory;
    const inventory = getInventory(event.player);
    const minnowCount = inventory
        .filter((entry) => entry.itemId === MINNOW_ITEM_ID)
        .reduce((sum, entry) => sum + Math.max(0, entry.quantity), 0);
    if (minnowCount < MINNOWS_PER_SHARK) {
        services.sendGameMessage(
            event.player,
            "You need at least 40 minnows to exchange for a raw shark.",
        );
        return;
    }
    const emptySlots = inventory.filter((entry) => entry.itemId <= 0 || entry.quantity <= 0).length;
    const maxConversions = Math.min(Math.floor(minnowCount / MINNOWS_PER_SHARK), emptySlots);
    if (maxConversions <= 0) {
        services.sendGameMessage(
            event.player,
            "You need some free inventory space before exchanging minnows.",
        );
        return;
    }

    let converted = 0;
    for (let i = 0; i < maxConversions; i++) {
        const removed = removeItemQuantity(
            event.player,
            MINNOW_ITEM_ID,
            MINNOWS_PER_SHARK,
            services,
        );
        if (!removed) break;
        const added = addItem(event.player, RAW_SHARK_ITEM_ID, 1);
        if (added.added < 1) {
            addItem(event.player, MINNOW_ITEM_ID, MINNOWS_PER_SHARK);
            break;
        }
        converted++;
    }

    if (converted > 0) {
        const totalMinnows = converted * MINNOWS_PER_SHARK;
        const suffix = converted === 1 ? "" : "s";
        services.sendGameMessage(
            event.player,
            `Kylie swaps ${totalMinnows} minnows for ${converted} raw shark${suffix}.`,
        );
        services.snapshotInventoryImmediate(event.player);
    } else {
        services.sendGameMessage(event.player, "No exchange occurred.");
    }
}

function removeItemQuantity(
    player: NpcInteractionEvent["player"],
    itemId: number,
    amount: number,
    services: ScriptServices,
): boolean {
    let remaining = amount;
    const inv = services.getInventoryItems(player);
    for (const entry of inv) {
        if (entry.itemId !== itemId) continue;
        if (remaining <= 0) break;
        const removeQty = Math.min(entry.quantity, remaining);
        const nextQty = Math.max(0, entry.quantity - removeQty);
        if (nextQty > 0) {
            services.setInventorySlot(player, entry.slot, itemId, nextQty);
        } else {
            services.setInventorySlot(player, entry.slot, -1, 0);
        }
        remaining -= removeQty;
    }
    return remaining <= 0;
}

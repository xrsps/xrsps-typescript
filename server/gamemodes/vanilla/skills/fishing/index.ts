import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    type FishingToolDefinition,
    type FishingToolId,
    buildFishingSpotMap,
    findFishingMethodByAction,
    getFishingMethodById,
    getFishingSpotById,
    getFishingToolDefinition,
    pickFishingCatch,
    selectFishingTool,
} from "./fishingData";
import { type IScriptRegistry, type NpcInteractionEvent, type ScriptActionHandlerContext, type ScriptServices } from "../../../../src/game/scripts/types";

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

const ECHO_HARPOON_ITEM_IDS = [25059, 25061, 25114, 25115, 25367, 25368, 25373, 25374];
const ECHO_HARPOON_SUBSTITUTABLE_TOOL_IDS = new Set([
    "small_net",
    "big_net",
    "fishing_rod",
    "fly_fishing_rod",
    "lobster_pot",
    "harpoon",
    "heavy_rod",
]);

interface FishingActionData {
    npcId: number;
    npcTypeId: number;
    npcSize: number;
    spotId?: string;
    methodId: string;
    level: number;
    started: boolean;
}

function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

function hasAnyCarriedItem(carriedItemIds: number[], candidateItemIds: number[]): boolean {
    if (carriedItemIds.length === 0 || candidateItemIds.length === 0) return false;
    const carried = new Set(carriedItemIds);
    return candidateItemIds.some((id) => carried.has(id));
}

function rollFishingSuccess(level: number, catchLevel: number, tool: FishingToolDefinition): boolean {
    const effective = Math.max(1, level);
    const difficulty = Math.max(1, catchLevel);
    const ratio = effective / difficulty;
    const baseChance = Math.min(0.85, Math.max(0.05, ratio * 0.3));
    return Math.random() < baseChance * tool.accuracy;
}

function describeItem(services: ScriptServices, itemId: number): string {
    return services.data.getObjType(itemId)?.name?.toLowerCase() ?? "item";
}

function failFishingPrecheck(
    player: PlayerState,
    services: ScriptServices,
    message: string,
): ActionExecutionResult {
    services.stopGatheringInteraction?.(player);
    const effects: ActionEffect[] = message ? [buildMessageEffect(player, message)] : [];
    return { ok: true, effects };
}

function executeFishAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as FishingActionData;
    const npcId = data.npcId;
    const npcTypeId = data.npcTypeId;
    const methodId = data.methodId;
    const priorSpotId = data.spotId;

    if (!(npcId > 0) || !(npcTypeId > 0) || !methodId) {
        return failFishingPrecheck(player, services, "You stop fishing.");
    }

    const npc = services.combat.getNpc(npcId);
    if (!npc || npc.typeId !== npcTypeId) {
        return failFishingPrecheck(player, services, "The fishing spot drifts out of reach.");
    }

    const spot = (priorSpotId ? getFishingSpotById(priorSpotId) : undefined) ??
        (services.getFishingSpot?.(npc.typeId));
    if (!spot) {
        return failFishingPrecheck(player, services, "You can't fish here.");
    }

    const method = getFishingMethodById(spot, methodId);
    if (!method) {
        return failFishingPrecheck(player, services, "You can't fish here.");
    }

    const tile = { x: npc.tileX, y: npc.tileY };
    const plane = npc.level;

    if (player.level !== plane) {
        return failFishingPrecheck(player, services, "You stop fishing.");
    }

    if (!services.isAdjacentToNpc?.(player, npc)) {
        return failFishingPrecheck(player, services, "You stop fishing.");
    }

    const skill = services.skills.getSkill(player, SkillId.Fishing);
    const effectiveLevel = Math.max(1, (skill?.baseLevel ?? 1) + (skill?.boost ?? 0));
    const catchDef = pickFishingCatch(method, effectiveLevel);

    if (!catchDef) {
        const minLevel = method.catches.reduce(
            (min, entry) => Math.min(min, entry.level),
            Number.MAX_SAFE_INTEGER,
        );
        return failFishingPrecheck(player, services, `You need Fishing level ${minLevel} to fish here.`);
    }

    const carriedIds = services.inventory.collectCarriedItemIds(player) ?? [];
    const hasEchoHarpoonPerk = hasAnyCarriedItem(carriedIds, ECHO_HARPOON_ITEM_IDS);
    const methodToolId = String(method.toolId ?? "").trim().toLowerCase();
    let tool = selectFishingTool(method.toolId, carriedIds);
    if (!tool && hasEchoHarpoonPerk && ECHO_HARPOON_SUBSTITUTABLE_TOOL_IDS.has(methodToolId)) {
        tool = getFishingToolDefinition("harpoon" as FishingToolId);
    }
    if (!tool) {
        const requiredTool = getFishingToolDefinition(method.toolId);
        return failFishingPrecheck(player, services, `You need a ${requiredTool?.name ?? "fishing tool"} to fish here.`);
    }

    let baitSlot: number | undefined;
    if (Array.isArray(method.baitItemIds) && method.baitItemIds.length > 0) {
        for (const baitId of method.baitItemIds) {
            const slot = services.inventory.findInventorySlotWithItem(player, baitId);
            if (slot !== undefined) {
                baitSlot = slot;
                break;
            }
        }
        if (baitSlot === undefined) {
            const baitLabel = method.baitName ?? "bait";
            return failFishingPrecheck(player, services, `You don't have any ${baitLabel}.`);
        }
    }

    const catchItemId = catchDef.itemId;
    if (!hasEchoHarpoonPerk && !services.inventory.canStoreItem(player, catchItemId)) {
        return failFishingPrecheck(player, services, "Your inventory is too full to hold any more fish.");
    }

    const effects: ActionEffect[] = [];

    if (!data.started) {
        effects.push(buildMessageEffect(player, "You attempt to catch some fish."));
    }

    services.faceGatheringTarget?.(player, tile);
    services.animation.playPlayerSeq(player, tool.animation);

    let inventorySnapshot = false;
    let bankSnapshot = false;
    let success = rollFishingSuccess(effectiveLevel, catchDef.level, tool);
    if (!success && hasEchoHarpoonPerk && Math.random() < 0.5) {
        success = true;
    }
    const quantity = catchDef.quantity !== undefined ? Math.max(1, catchDef.quantity) : 1;

    if (success) {
        let rewardItemId = catchItemId;
        let autoCooked = false;
        if (hasEchoHarpoonPerk) {
            const cookingRecipe = services.getCookingRecipeByRawItemId?.(catchItemId);
            if (cookingRecipe && Math.random() < 0.5) {
                rewardItemId = cookingRecipe.cookedItemId;
                autoCooked = true;
                services.skills.addSkillXp(player, SkillId.Cooking, cookingRecipe.xp);
            }
        }

        if (hasEchoHarpoonPerk) {
            const banked = services.addItemToBank?.(player, rewardItemId, quantity);
            if (!banked) {
                return failFishingPrecheck(player, services, "Your bank is too full to hold any more fish.");
            }
            bankSnapshot = true;
        } else {
            const result = services.inventory.addItemToInventory(player, rewardItemId, quantity);
            if (result.added <= 0) {
                return failFishingPrecheck(player, services, "Your inventory is too full to hold any more fish.");
            }
            inventorySnapshot = true;
        }

        const fishName = describeItem(services, rewardItemId);
        effects.push(
            buildMessageEffect(
                player,
                hasEchoHarpoonPerk && autoCooked
                    ? `You catch and cook some ${fishName}.`
                    : `You catch some ${fishName}.`,
            ),
        );
        if (hasEchoHarpoonPerk) {
            const capitalizedFishName = fishName.charAt(0).toUpperCase() + fishName.slice(1);
            effects.push(buildMessageEffect(player, `${quantity}x ${capitalizedFishName} were sent straight to your bank.`));
        }
        services.skills.addSkillXp(player, SkillId.Fishing, catchDef.xp);

        if (baitSlot !== undefined && Array.isArray(method.baitItemIds)) {
            if (!services.inventory.consumeItem(player, baitSlot)) {
                return failFishingPrecheck(player, services, "You fumble your bait and stop fishing.");
            }
            inventorySnapshot = true;
        }
    } else {
        effects.push(buildMessageEffect(player, "You fail to catch anything."));
    }

    if (inventorySnapshot) {
        effects.push({ type: "inventorySnapshot", playerId: player.id });
    }
    if (bankSnapshot) {
        services.queueBankSnapshot(player);
    }

    let continueFishing = true;
    if (!hasEchoHarpoonPerk && !services.inventory.canStoreItem(player, catchItemId)) {
        continueFishing = false;
        effects.push(buildMessageEffect(player, "Your inventory is too full to hold any more fish."));
    }

    if (continueFishing && Array.isArray(method.baitItemIds) && method.baitItemIds.length > 0) {
        const hasBait = method.baitItemIds.some((baitId) =>
            services.inventory.playerHasItem(player, baitId),
        );
        if (!hasBait) {
            continueFishing = false;
            const baitLabel = method.baitName ?? "bait";
            effects.push(buildMessageEffect(player, `You have run out of ${baitLabel}.`));
        }
    }

    const baseSwingTicks = method.swingTicks;
    const swingTicks = hasEchoHarpoonPerk && baseSwingTicks > 1 ? baseSwingTicks - 1 : baseSwingTicks;
    if (continueFishing) {
        const npcSize = npc.size;
        const reschedule = services.combat.scheduleAction(
            player.id,
            {
                kind: "skill.fish",
                data: {
                    npcId: npc.id,
                    npcTypeId: npc.typeId,
                    npcSize,
                    spotId: spot.id,
                    methodId: method.id,
                    level: plane,
                    started: true,
                },
                delayTicks: swingTicks,
                cooldownTicks: swingTicks,
                groups: ["skill.fish"],
            },
            tick,
        );
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop fishing."));
        }
    }

    return { ok: true, cooldownTicks: swingTicks, groups: ["skill.fish"], effects };
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.fish", executeFishAction);

    const npcTypeLoader = services.data.getNpcTypeLoader();
    if (npcTypeLoader) {
        const fishingMap = buildFishingSpotMap(npcTypeLoader);
        services.getFishingSpot = (npcTypeId) => {
            const spotId = fishingMap.map.get(npcTypeId);
            if (!spotId) return undefined;
            return getFishingSpotById(spotId);
        };
    }

    if (!services.getFishingSpot) {
        console.log("[script:fishing] fishing spot lookup unavailable");
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
}

function handleFishingAction(option: string, event: NpcInteractionEvent, services: ScriptServices) {
    const spot = services.getFishingSpot?.(event.npc.typeId);
    if (!spot) {
        services.messaging.sendGameMessage(event.player, "Nothing interesting happens.");
        return;
    }
    const method = findFishingMethodByAction(spot, option);
    if (!method) {
        services.messaging.sendGameMessage(event.player, "You can't fish there.");
        return;
    }
    const delay = method.swingTicks;
    const result = services.combat.requestAction(
        event.player,
        {
            kind: "skill.fish",
            data: {
                npcId: event.npc.id,
                npcTypeId: event.npc.typeId,
                npcSize: event.npc.size,
                spotId: spot.id,
                methodId: method.id,
                level: event.npc.level,
                started: false,
            },
            delayTicks: delay,
            cooldownTicks: delay,
            groups: ["skill.fish"],
        },
        event.tick,
    );
    if (!result.ok) {
        services.messaging.sendGameMessage(event.player, "You're too busy to do that right now.");
    }
}

function handleMinnowExchange(event: NpcInteractionEvent, services: ScriptServices): void {
    const getInventory = services.inventory.getInventoryItems;
    const setSlot = services.inventory.setInventorySlot;
    const addItem = services.inventory.addItemToInventory;
    const inventory = getInventory(event.player);
    const minnowCount = inventory
        .filter((entry) => entry.itemId === MINNOW_ITEM_ID)
        .reduce((sum, entry) => sum + Math.max(0, entry.quantity), 0);
    if (minnowCount < MINNOWS_PER_SHARK) {
        services.messaging.sendGameMessage(
            event.player,
            "You need at least 40 minnows to exchange for a raw shark.",
        );
        return;
    }
    const emptySlots = inventory.filter((entry) => entry.itemId <= 0 || entry.quantity <= 0).length;
    const maxConversions = Math.min(Math.floor(minnowCount / MINNOWS_PER_SHARK), emptySlots);
    if (maxConversions <= 0) {
        services.messaging.sendGameMessage(
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
        services.messaging.sendGameMessage(
            event.player,
            `Kylie swaps ${totalMinnows} minnows for ${converted} raw shark${suffix}.`,
        );
        services.inventory.snapshotInventoryImmediate(event.player);
    } else {
        services.messaging.sendGameMessage(event.player, "No exchange occurred.");
    }
}

function removeItemQuantity(
    player: NpcInteractionEvent["player"],
    itemId: number,
    amount: number,
    services: ScriptServices,
): boolean {
    let remaining = amount;
    const inv = services.inventory.getInventoryItems(player);
    for (const entry of inv) {
        if (entry.itemId !== itemId) continue;
        if (remaining <= 0) break;
        const removeQty = Math.min(entry.quantity, remaining);
        const nextQty = Math.max(0, entry.quantity - removeQty);
        if (nextQty > 0) {
            services.inventory.setInventorySlot(player, entry.slot, itemId, nextQty);
        } else {
            services.inventory.setInventorySlot(player, entry.slot, -1, 0);
        }
        remaining -= removeQty;
    }
    return remaining <= 0;
}

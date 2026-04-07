import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    type HatchetDefinition,
    buildWoodcuttingLocMap,
    getWoodcuttingTreeById,
    getWoodcuttingTreeFromMap,
    selectHatchetByLevel,
} from "./woodcuttingData";
import type { IScriptRegistry, ScriptActionHandlerContext, ScriptServices } from "../../../../src/game/scripts/types";
import { ResourceNodeTracker, buildTileKey } from "../../systems/ResourceNodeTracker";

const WOODCUT_ACTIONS = ["chop down", "chop-down"];
const WOODCUTTING_DEPLETE_SOUND = 2734;
const WOODCUTTING_INVENTORY_FULL_SOUND = 2277;
const ECHO_AXE_ITEM_IDS = [25110];

interface WoodcuttingActionData {
    treeLocId: number;
    treeId?: string;
    stumpId: number;
    tile: { x: number; y: number };
    level: number;
    started: boolean;
    ticksInSwing: number;
}

function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

function hasAnyCarriedItem(carriedItemIds: number[], candidateItemIds: number[]): boolean {
    if (carriedItemIds.length === 0 || candidateItemIds.length === 0) return false;
    const carried = new Set(carriedItemIds);
    return candidateItemIds.some((id) => carried.has(id));
}

function rollWoodcuttingSuccess(level: number, treeLevel: number, hatchet: HatchetDefinition): boolean {
    const effective = Math.max(1, level);
    const difficulty = Math.max(1, treeLevel);
    const ratio = effective / difficulty;
    const baseChance = Math.min(0.85, Math.max(0.05, ratio * 0.3));
    return Math.random() < baseChance * hatchet.accuracy;
}

function describeItem(services: ScriptServices, itemId: number): string {
    return services.data.getObjType(itemId)?.name?.toLowerCase() ?? "item";
}

function failGatheringPrecheck(
    player: PlayerState,
    services: ScriptServices,
    message: string,
): ActionExecutionResult {
    services.stopGatheringInteraction?.(player);
    const effects: ActionEffect[] = message ? [buildMessageEffect(player, message)] : [];
    return { ok: true, effects };
}

function executeWoodcutAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as WoodcuttingActionData;

    const locId = data.treeLocId;
    const treeId = data.treeId;
    const tree = (treeId ? getWoodcuttingTreeById(treeId) : undefined) ??
        (services.getWoodcuttingTree?.(locId));

    if (!tree) {
        return failGatheringPrecheck(player, services, "You can't chop that tree.");
    }

    const tile = { x: data.tile.x, y: data.tile.y };
    const plane = data.level;
    const nodeKey = buildTileKey(tile, plane);

    if (services.gathering?.getTracker("woodcutting")?.has(nodeKey)) {
        return failGatheringPrecheck(player, services, "The tree has no logs left.");
    }

    if (!services.isAdjacentToLoc?.(player, locId, tile, plane)) {
        return failGatheringPrecheck(player, services, "You stop chopping the tree.");
    }

    const skill = services.skills.getSkill(player, SkillId.Woodcutting);
    const effectiveLevel = Math.max(1, (skill?.baseLevel ?? 1) + (skill?.boost ?? 0));

    if (effectiveLevel < tree.level) {
        return failGatheringPrecheck(player, services, `You need Woodcutting level ${tree.level} to chop this tree.`);
    }

    const hatchetIds = services.inventory.collectCarriedItemIds(player) ?? [];
    const hatchet = selectHatchetByLevel(hatchetIds, effectiveLevel);
    if (!hatchet) {
        return failGatheringPrecheck(player, services, "You need an axe that you have the Woodcutting level to use.");
    }
    const hasEchoAxePerk = hasAnyCarriedItem(hatchetIds, ECHO_AXE_ITEM_IDS);

    if (!hasEchoAxePerk && !services.inventory.hasInventorySlot(player)) {
        const logName = describeItem(services, tree.logItemId);
        services.sound.sendSound(player, WOODCUTTING_INVENTORY_FULL_SOUND);
        return failGatheringPrecheck(player, services, `Your inventory is too full to hold any more ${logName}.`);
    }

    const stumpId = data.stumpId;
    const effects: ActionEffect[] = [];

    if (!data.started) {
        services.faceGatheringTarget?.(player, tile);
        services.animation.playPlayerSeq(player, hatchet.animation);
        effects.push(buildMessageEffect(player, "You swing your axe at the tree."));
        const reschedule = services.combat.scheduleAction(
            player.id,
            {
                kind: "skill.woodcut",
                data: {
                    treeId: tree.id,
                    treeLocId: locId,
                    stumpId,
                    tile: { x: tile.x, y: tile.y },
                    level: plane,
                    started: true,
                    ticksInSwing: 0,
                },
                delayTicks: 1,
                cooldownTicks: 1,
                groups: ["skill.woodcut"],
            },
            tick,
        );
        if (!reschedule?.ok) {
            services.stopGatheringInteraction?.(player);
            effects.push(buildMessageEffect(player, "You stop chopping the tree."));
        }
        return { ok: true, cooldownTicks: 1, groups: ["skill.woodcut"], effects };
    }

    const ticksInSwing = data.ticksInSwing + 1;
    const shouldRoll = ticksInSwing === 2;

    if (ticksInSwing === 0) {
        services.faceGatheringTarget?.(player, tile);
        services.animation.playPlayerSeq(player, hatchet.animation);
    }

    let treeDepleted = false;
    let inventorySnapshot = false;
    let bankSnapshot = false;

    let success = shouldRoll && rollWoodcuttingSuccess(effectiveLevel, tree.level, hatchet);
    if (!success && shouldRoll && hasEchoAxePerk && Math.random() < 0.5) {
        success = true;
    }
    if (success) {
        if (hasEchoAxePerk) {
            const banked = services.addItemToBank?.(player, tree.logItemId, 1);
            if (!banked) {
                const logName = describeItem(services, tree.logItemId);
                return failGatheringPrecheck(player, services, `Your bank is too full to hold any more ${logName}.`);
            }
            bankSnapshot = true;
        } else {
            const result = services.inventory.addItemToInventory(player, tree.logItemId, 1);
            if (result.added <= 0) {
                const logName = describeItem(services, tree.logItemId);
                services.sound.sendSound(player, WOODCUTTING_INVENTORY_FULL_SOUND);
                return failGatheringPrecheck(player, services, `Your inventory is too full to hold any more ${logName}.`);
            }
            inventorySnapshot = true;
        }

        const logName = describeItem(services, tree.logItemId);
        effects.push(buildMessageEffect(player, `You get some ${logName}.`));
        if (hasEchoAxePerk) {
            const capitalizedLogName = logName.charAt(0).toUpperCase() + logName.slice(1);
            effects.push(buildMessageEffect(player, `1x ${capitalizedLogName} were sent straight to your bank.`));
        }
        services.skills.addSkillXp(player, SkillId.Woodcutting, tree.xp);

        const depleteRoll = tree.depleteRoll ?? 1;
        const shouldDeplete = depleteRoll <= 1 || Math.random() < 1 / depleteRoll;
        if (shouldDeplete) {
            treeDepleted = true;
            if (locId > 0) {
                services.gathering?.getTracker<any>("woodcutting")?.addWithRandomDuration(
                    nodeKey, tile, plane, tick, tree.respawnTicks,
                    { locId, stumpId, treeId: tree.id },
                );
                services.location.emitLocChange(locId, stumpId, tile, plane);
                services.sound.enqueueSoundBroadcast(WOODCUTTING_DEPLETE_SOUND, tile.x, tile.y, plane);
                services.stopGatheringInteraction?.(player);
            }
            effects.push(buildMessageEffect(player, "The tree has run out of logs."));
        }
    }

    if (inventorySnapshot) {
        effects.push({ type: "inventorySnapshot", playerId: player.id });
    }
    if (bankSnapshot) {
        services.queueBankSnapshot(player);
    }

    let continueChopping = !treeDepleted && !services.gathering?.getTracker("woodcutting")?.has(nodeKey);
    if (continueChopping) {
        if (!hasEchoAxePerk && !services.inventory.hasInventorySlot(player)) {
            continueChopping = false;
            const logName = describeItem(services, tree.logItemId);
            services.sound.sendSound(player, WOODCUTTING_INVENTORY_FULL_SOUND);
            effects.push(buildMessageEffect(player, `Your inventory is too full to hold any more ${logName}.`));
        } else if (!services.isAdjacentToLoc?.(player, locId, tile, plane)) {
            continueChopping = false;
        }
    }

    if (!continueChopping) {
        services.stopGatheringInteraction?.(player);
    }

    if (continueChopping) {
        const nextTicksInSwing = ticksInSwing >= 3 ? -1 : ticksInSwing;
        const reschedule = services.combat.scheduleAction(
            player.id,
            {
                kind: "skill.woodcut",
                data: {
                    treeId: tree.id,
                    treeLocId: locId,
                    stumpId,
                    tile: { x: tile.x, y: tile.y },
                    level: plane,
                    started: true,
                    ticksInSwing: nextTicksInSwing,
                },
                delayTicks: 1,
                cooldownTicks: 1,
                groups: ["skill.woodcut"],
            },
            tick,
        );
        if (!reschedule?.ok) {
            services.stopGatheringInteraction?.(player);
            effects.push(buildMessageEffect(player, "You stop chopping the tree."));
        }
    }

    return { ok: true, cooldownTicks: 1, groups: ["skill.woodcut"], effects };
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.woodcut", executeWoodcutAction);

    const wcTracker = new ResourceNodeTracker<{ locId: number; stumpId: number; treeId: string }>();
    services.gathering?.registerTracker("woodcutting", wcTracker, (node, gatheringSvc) => {
        gatheringSvc.emitLocChange(node.data.stumpId, node.data.locId, node.tile, node.level);
    });

    const locTypeLoader = services.data.getLocTypeLoader();
    const wcLocMap = buildWoodcuttingLocMap(locTypeLoader);
    services.getWoodcuttingTree = (locId) => getWoodcuttingTreeFromMap(locId, wcLocMap);

    if (!services.getWoodcuttingTree) {
        console.log("[script:woodcutting] tree lookup unavailable; module disabled");
        return;
    }
    for (const action of WOODCUT_ACTIONS) {
        registry.registerLocAction(action, (event) => {
            const tree = services.getWoodcuttingTree?.(event.locId);
            if (!tree) return;
            const delay = 0;
            const result = services.combat.requestAction(
                event.player,
                {
                    kind: "skill.woodcut",
                    data: {
                        treeId: tree.id,
                        treeLocId: event.locId,
                        stumpId: tree.stumpId,
                        tile: { x: event.tile.x, y: event.tile.y },
                        level: event.level,
                        started: false,
                        ticksInSwing: 0,
                    },
                    delayTicks: delay,
                    cooldownTicks: delay,
                    groups: ["skill.woodcut"],
                },
                event.tick,
            );
            if (!result.ok) {
                services.messaging.sendGameMessage(event.player, "You're too busy to do that right now.");
            }
        });
    }
}

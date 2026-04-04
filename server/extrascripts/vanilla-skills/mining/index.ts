import { SkillId } from "../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../src/game/actions/types";
import type { PlayerState } from "../../../src/game/player";
import {
    type PickaxeDefinition,
    buildMiningTileKey,
    getMiningRockById,
    selectPickaxeByLevel,
} from "../../../src/game/skills/mining";
import type { ScriptActionHandlerContext, ScriptModule, ScriptServices } from "../../../src/game/scripts/types";

const MINING_ACTIONS = ["mine", "mine rocks"];
const ECHO_PICKAXE_ITEM_IDS = [25112, 25063, 25369, 25376];

interface MiningActionData {
    rockLocId: number;
    rockId?: string;
    depletedLocId?: number;
    tile: { x: number; y: number };
    level: number;
    started: boolean;
    echoMinedCount: number;
}

function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

function hasAnyCarriedItem(carriedItemIds: number[], candidateItemIds: number[]): boolean {
    if (carriedItemIds.length === 0 || candidateItemIds.length === 0) return false;
    const carried = new Set(carriedItemIds);
    return candidateItemIds.some((id) => carried.has(id));
}

function rollMiningSuccess(level: number, rockLevel: number, pickaxe: PickaxeDefinition): boolean {
    const effective = Math.max(1, level);
    const difficulty = Math.max(1, rockLevel);
    const ratio = effective / difficulty;
    const baseChance = Math.min(0.85, Math.max(0.05, ratio * 0.3));
    return Math.random() < baseChance * pickaxe.accuracy;
}

function describeItem(services: ScriptServices, itemId: number): string {
    return services.getObjType?.(itemId)?.name?.toLowerCase() ?? "item";
}

function failMiningPrecheck(
    player: PlayerState,
    services: ScriptServices,
    message: string,
): ActionExecutionResult {
    services.stopGatheringInteraction?.(player);
    const effects: ActionEffect[] = message ? [buildMessageEffect(player, message)] : [];
    return { ok: true, effects };
}

function executeMineAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as MiningActionData;

    const locId = data.rockLocId;
    const rockId = data.rockId;
    const rock = (rockId ? getMiningRockById(rockId) : undefined) ??
        (services.getMiningRock?.(locId));

    if (!rock) {
        return failMiningPrecheck(player, services, "You can't mine that rock.");
    }

    const tile = { x: data.tile.x, y: data.tile.y };
    const plane = data.level;
    const actionDepletedLocId = data.depletedLocId;
    const nodeKey = buildMiningTileKey(tile, plane);

    if (services.isMiningDepleted?.(nodeKey)) {
        return failMiningPrecheck(player, services, "The rock is depleted of ore.");
    }

    if (!services.isAdjacentToLoc?.(player, locId, tile, plane)) {
        return failMiningPrecheck(player, services, "You stop mining the rock.");
    }

    const skill = services.getSkill?.(player, SkillId.Mining);
    const effectiveLevel = Math.max(1, (skill?.baseLevel ?? 1) + (skill?.boost ?? 0));

    if (effectiveLevel < rock.level) {
        return failMiningPrecheck(player, services, `You need Mining level ${rock.level} to mine this rock.`);
    }

    const carriedIds = services.collectCarriedItemIds?.(player) ?? [];
    const pickaxe = selectPickaxeByLevel(carriedIds, effectiveLevel);
    if (!pickaxe) {
        return failMiningPrecheck(player, services, "You need a pickaxe that you have the Mining level to use.");
    }
    const hasEchoPickaxePerk = hasAnyCarriedItem(carriedIds, ECHO_PICKAXE_ITEM_IDS);

    if (!hasEchoPickaxePerk && !services.hasInventorySlot?.(player)) {
        return failMiningPrecheck(player, services, "Your inventory is too full to hold any more ore.");
    }

    const swingTicks = Math.max(rock.swingTicks, pickaxe.swingTicks);
    const effects: ActionEffect[] = [];

    if (!data.started) {
        effects.push(buildMessageEffect(player, "You swing your pickaxe at the rock."));
        services.faceGatheringTarget?.(player, tile);
        services.playPlayerSeq?.(player, pickaxe.animation);
        const initialSchedule = services.scheduleAction?.(
            player.id,
            {
                kind: "skill.mine",
                data: {
                    rockId: rock.id,
                    rockLocId: locId,
                    depletedLocId: actionDepletedLocId,
                    tile: { x: tile.x, y: tile.y },
                    level: plane,
                    started: true,
                    echoMinedCount: data.echoMinedCount,
                },
                delayTicks: swingTicks,
                cooldownTicks: swingTicks,
                groups: ["skill.mine"],
            },
            tick,
        );
        if (!initialSchedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop mining the rock."));
        }
        return { ok: true, cooldownTicks: 0, groups: ["skill.mine"], effects };
    }

    services.faceGatheringTarget?.(player, tile);
    services.playPlayerSeq?.(player, pickaxe.animation);

    let inventorySnapshot = false;
    let bankSnapshot = false;
    const echoMinedCount = data.echoMinedCount;
    let nextEchoMinedCount = echoMinedCount;

    let success = rollMiningSuccess(effectiveLevel, rock.level, pickaxe);
    if (!success && hasEchoPickaxePerk && Math.random() < 0.5) {
        success = true;
    }

    if (success) {
        if (hasEchoPickaxePerk) {
            const banked = services.addItemToBank?.(player, rock.oreItemId, 1);
            if (!banked) {
                return failMiningPrecheck(player, services, "Your bank is too full to hold any more ore.");
            }
            bankSnapshot = true;
        } else {
            const result = services.addItemToInventory(player, rock.oreItemId, 1);
            if (result.added <= 0) {
                return failMiningPrecheck(player, services, "Your inventory is too full to hold any more ore.");
            }
            inventorySnapshot = true;
        }

        const oreName = describeItem(services, rock.oreItemId);
        effects.push(buildMessageEffect(player, `You manage to mine some ${oreName}.`));
        if (hasEchoPickaxePerk) {
            const capitalizedOreName = oreName.charAt(0).toUpperCase() + oreName.slice(1);
            effects.push(buildMessageEffect(player, `1x ${capitalizedOreName} were sent straight to your bank.`));
        }
        services.addSkillXp?.(player, SkillId.Mining, rock.xp);

        if (locId > 0) {
            nextEchoMinedCount = hasEchoPickaxePerk ? echoMinedCount + 1 : 0;
            const canDeplete = !hasEchoPickaxePerk || nextEchoMinedCount >= 4;
            if (canDeplete) {
                const depletedLocId =
                    typeof actionDepletedLocId === "number" && actionDepletedLocId > 0
                        ? actionDepletedLocId
                        : undefined;

                services.markMiningDepleted?.({
                    key: nodeKey,
                    locId,
                    depletedLocId,
                    tile,
                    level: plane,
                    rockId: rock.id,
                    respawnTicks: rock.respawnTicks,
                }, tick);

                if (depletedLocId !== undefined) {
                    services.emitLocChange?.(locId, depletedLocId, tile, plane);
                }
                effects.push(buildMessageEffect(player, "The rock is depleted of its ore."));
                services.stopGatheringInteraction?.(player);
            }
        }
    }

    if (inventorySnapshot) {
        effects.push({ type: "inventorySnapshot", playerId: player.id });
    }
    if (bankSnapshot) {
        services.queueBankSnapshot(player);
    }

    let continueMining = !services.isMiningDepleted?.(nodeKey);
    if (continueMining) {
        if (!hasEchoPickaxePerk && !services.hasInventorySlot?.(player)) {
            continueMining = false;
            effects.push(buildMessageEffect(player, "Your inventory is too full to hold any more ore."));
        } else if (!services.isAdjacentToLoc?.(player, locId, tile, plane)) {
            continueMining = false;
        }
    }

    if (continueMining) {
        const reschedule = services.scheduleAction?.(
            player.id,
            {
                kind: "skill.mine",
                data: {
                    rockId: rock.id,
                    rockLocId: locId,
                    depletedLocId: actionDepletedLocId,
                    tile: { x: tile.x, y: tile.y },
                    level: plane,
                    started: true,
                    echoMinedCount: nextEchoMinedCount,
                },
                delayTicks: swingTicks,
                cooldownTicks: swingTicks,
                groups: ["skill.mine"],
            },
            tick,
        );
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop mining the rock."));
        }
    }

    return { ok: true, cooldownTicks: swingTicks, groups: ["skill.mine"], effects };
}

export const miningModule: ScriptModule = {
    id: "vanilla-skills.mining",
    register(registry, services) {
        registry.registerActionHandler("skill.mine", executeMineAction);

        if (!services.getMiningRock) {
            console.log("[script:mining] rock lookup unavailable; module disabled");
            return;
        }
        for (const action of MINING_ACTIONS) {
            registry.registerLocAction(action, (event) => {
                const rock = services.getMiningRock?.(event.locId);
                if (!rock) return;
                const delay = 0;
                const result = services.requestAction(
                    event.player,
                    {
                        kind: "skill.mine",
                        data: {
                            rockId: rock.id,
                            rockLocId: event.locId,
                            depletedLocId: rock.depletedLocId,
                            tile: { x: event.tile.x, y: event.tile.y },
                            level: event.level,
                            started: false,
                            echoMinedCount: 0,
                        },
                        delayTicks: delay,
                        cooldownTicks: delay,
                        groups: ["skill.mine"],
                    },
                    event.tick,
                );
                if (!result.ok) {
                    services.sendGameMessage(event.player, "You're too busy to do that right now.");
                }
            });
        }
    },
};

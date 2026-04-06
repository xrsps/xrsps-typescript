import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    ASHES_ITEM_ID,
    FIRE_LIGHTING_ANIMATION,
    FIREMAKING_LOG_IDS,
    TINDERBOX_ITEM_IDS,
    type FireNodeData,
    computeFireLightingDelayTicks,
    getFiremakingLogDefinition,
} from "./firemakingData";
import type { IScriptRegistry, ScriptActionHandlerContext, ScriptServices } from "../../../../src/game/scripts/types";
import { ResourceNodeTracker, buildTileKey } from "../../../../src/game/systems/ResourceNodeTracker";

const FIRE_LIT_SYNTH_SOUND = 2596;

interface FiremakingActionData {
    logItemId: number;
    logLevel?: number;
    tile: { x: number; y: number };
    level: number;
    slot?: number;
    started: boolean;
    attempts: number;
    previousLocId: number;
}

function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

function describeItem(services: ScriptServices, itemId: number): string {
    return services.getObjType?.(itemId)?.name?.toLowerCase() ?? "item";
}

function failFiremakingPrecheck(
    player: PlayerState,
    services: ScriptServices,
    message: string,
): ActionExecutionResult {
    services.stopGatheringInteraction?.(player);
    const effects: ActionEffect[] = message ? [buildMessageEffect(player, message)] : [];
    return { ok: true, effects };
}

function rollFiremakingSuccess(level: number, logLevel: number): boolean {
    const effective = Math.max(1, level);
    const difficulty = Math.max(1, logLevel);
    const ratio = effective / difficulty;
    const chance = Math.min(0.95, Math.max(0.25, ratio * 0.5));
    return Math.random() < chance;
}

function executeFiremakingAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as FiremakingActionData;
    const logId = data.logItemId;
    const logDef = getFiremakingLogDefinition(logId);
    if (!logDef) {
        return failFiremakingPrecheck(player, services, "You can't light that.");
    }

    const tile = { x: data.tile.x, y: data.tile.y };
    const plane = data.level;
    const slotIndex = data.slot;
    const attempts = Math.max(0, data.attempts);
    const effects: ActionEffect[] = [];

    if (!data.started) {
        effects.push(buildMessageEffect(player, "You attempt to light the logs."));
    }

    if (player.level !== plane) {
        return failFiremakingPrecheck(player, services, "You stop lighting the logs.");
    }

    if (player.tileX !== tile.x || player.tileY !== tile.y) {
        return failFiremakingPrecheck(player, services, "You stop lighting the logs.");
    }

    if (!services.playerHasTinderbox?.(player)) {
        return failFiremakingPrecheck(player, services, "You need a tinderbox to light these logs.");
    }

    const skill = services.getSkill?.(player, SkillId.Firemaking);
    const baseLevel = skill?.baseLevel ?? 1;
    if (baseLevel < logDef.level) {
        return failFiremakingPrecheck(player, services, `You need Firemaking level ${logDef.level} to light these logs.`);
    }

    if (services.gathering?.getTracker<FireNodeData>("firemaking")?.hasTile(tile, plane)) {
        return failFiremakingPrecheck(player, services, "There's already a fire here.");
    }

    if (services.isFiremakingTileBlocked?.(tile, plane)) {
        return failFiremakingPrecheck(player, services, "You can't light a fire here.");
    }

    services.faceGatheringTarget?.(player, tile);

    if (data.started) {
        services.playPlayerSeq?.(player, FIRE_LIGHTING_ANIMATION);
    }

    const success = rollFiremakingSuccess(baseLevel, logDef.level);
    if (!success) {
        effects.push(buildMessageEffect(player, "You fail to light the logs."));
        const delay = computeFireLightingDelayTicks(baseLevel);
        const reschedule = services.scheduleAction?.(
            player.id,
            {
                kind: "skill.firemaking",
                data: {
                    logItemId: logDef.logId,
                    logLevel: logDef.level,
                    tile: { ...tile },
                    level: plane,
                    slot: slotIndex,
                    started: true,
                    attempts: attempts + 1,
                    previousLocId: data.previousLocId,
                },
                delayTicks: delay,
                cooldownTicks: delay,
                groups: ["skill.firemaking"],
            },
            tick,
        );
        if (!reschedule?.ok) {
            return failFiremakingPrecheck(player, services, "You stop lighting the logs.");
        }
        return { ok: true, effects };
    }

    const consumedSlot = services.consumeFiremakingLog?.(player, logId, slotIndex);
    if (consumedSlot === undefined) {
        return failFiremakingPrecheck(player, services, "You need logs to light a fire.");
    }

    effects.push({ type: "inventorySnapshot", playerId: player.id });
    const logName = describeItem(services, logId);
    effects.push(buildMessageEffect(player, `The fire catches and the ${logName} begin to burn.`));

    services.addSkillXp?.(player, SkillId.Firemaking, logDef.xp);

    const fire = services.lightFire?.({
        tile,
        level: plane,
        logItemId: logId,
        currentTick: tick,
        burnTicks: logDef.burnTicks,
        fireObjectId: logDef.fireObjectId,
        previousLocId: data.previousLocId,
        ownerId: player.id,
    });

    if (fire) {
        services.emitLocChange?.(0, fire.fireObjectId, tile, plane);
    }

    services.stopPlayerAnimation?.(player);
    services.walkPlayerAwayFromFire?.(player, tile);
    services.sendSound?.(player, FIRE_LIT_SYNTH_SOUND);

    return { ok: true, effects };
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.firemaking", executeFiremakingAction);

    const fireTracker = new ResourceNodeTracker<FireNodeData>();
    services.gathering?.registerTracker("firemaking", fireTracker, (node, gatheringServices) => {
        gatheringServices.emitLocChange(node.data.fireObjectId, 0, node.tile, node.level);
        gatheringServices.spawnGroundItem(
            ASHES_ITEM_ID,
            1,
            { x: node.tile.x, y: node.tile.y, level: node.level },
            node.expiryTick,
            { privateTicks: 0 },
        );
    });

    services.isFiremakingTileBlocked = (tile, level) => {
        const pathService = services.getPathService?.();
        if (!pathService) return false;
        const flag = pathService.getCollisionFlagAt(tile.x, tile.y, level);
        if (flag === undefined || flag < 0) return false;
        return (flag & 0x100_0300) !== 0;
    };

    services.lightFire = (params) => {
        const key = buildTileKey(params.tile, params.level);
        const burnTicks = params.burnTicks ?? { min: 75, max: 120 };
        const min = Math.max(1, Math.floor(burnTicks.min));
        const max = Math.max(min, Math.floor(burnTicks.max));
        const span = max - min + 1;
        const duration = min + (span > 0 ? Math.floor(Math.random() * span) : 0);
        fireTracker.add(key, params.tile, params.level, params.currentTick + duration, {
            fireObjectId: params.fireObjectId,
            previousLocId: params.previousLocId,
            logItemId: params.logItemId,
            ownerId: params.ownerId,
        });
        return { fireObjectId: params.fireObjectId };
    };

    services.playerHasTinderbox = (player) => {
        for (const id of TINDERBOX_ITEM_IDS) {
            if (services.playerHasItem?.(player, id)) return true;
        }
        return false;
    };

    services.consumeFiremakingLog = (player, logId, slotIndex) => {
        const inv = services.getInventoryItems(player);
        if (
            slotIndex !== undefined &&
            slotIndex >= 0 &&
            slotIndex < inv.length &&
            inv[slotIndex]?.itemId === logId &&
            inv[slotIndex]!.quantity > 0
        ) {
            if (services.consumeItem(player, slotIndex)) return slotIndex;
        }
        const fallback = services.findInventorySlotWithItem?.(player, logId);
        if (fallback !== undefined && services.consumeItem(player, fallback)) return fallback;
        return undefined;
    };

    services.walkPlayerAwayFromFire = (player, fireTile) => {
        const westTile = { x: fireTile.x - 1, y: fireTile.y };
        const pathService = services.getPathService?.();
        const canStep = pathService?.canNpcStep?.(
            { x: player.tileX, y: player.tileY, plane: player.level },
            westTile,
        ) ?? true;
        if (canStep && (westTile.x !== player.tileX || westTile.y !== player.tileY)) {
            player.setPath([westTile], false);
        }
    };

    const requestAction = services.requestAction;
    for (const logId of FIREMAKING_LOG_IDS) {
        const logDef = getFiremakingLogDefinition(logId);
        if (!logDef) continue;
        for (const tinderboxId of TINDERBOX_ITEM_IDS) {
            registry.registerItemOnItem(
                tinderboxId,
                logDef.logId,
                ({ player, source, target, tick }) => {
                    const level = services.getSkill?.(player, SkillId.Firemaking)?.baseLevel ?? 1;
                    if (level < logDef.level) {
                        services.sendGameMessage(
                            player,
                            `You need Firemaking level ${logDef.level} to light these logs.`,
                        );
                        return;
                    }
                    const slot = source.itemId === logDef.logId ? source.slot : target.slot;
                    const delay = computeFireLightingDelayTicks(level);

                    services.playPlayerSeq?.(player, FIRE_LIGHTING_ANIMATION);

                    const result = requestAction(
                        player,
                        {
                            kind: "skill.firemaking",
                            data: {
                                logItemId: logDef.logId,
                                tile: { x: player.tileX, y: player.tileY },
                                level: player.level,
                                slot,
                                started: false,
                                attempts: 0,
                                previousLocId: 0,
                            },
                            delayTicks: delay,
                            cooldownTicks: delay,
                            groups: ["skill.firemaking"],
                        },
                        tick,
                    );
                    if (!result.ok) {
                        services.sendGameMessage(player, "You're too busy to do that right now.");
                    }
                },
            );
        }
    }
}

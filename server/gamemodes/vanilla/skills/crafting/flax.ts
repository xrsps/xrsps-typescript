import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    FLAX_LOC_IDS,
    FLAX_PICK_DELAY_TICKS,
    isFlaxLocId,
} from "./flaxData";
import type { IScriptRegistry, ScriptActionHandlerContext, ScriptServices } from "../../../../src/game/scripts/types";
import { ResourceNodeTracker, buildTileKey } from "../../../../src/game/systems/ResourceNodeTracker";

const FLAX_ACTIONS = ["pick", "pick-flax"];
const FLAX_GROUP = "skill.flax";
const FLAX_ITEM_ID = 1779;
const FLAX_PICK_ANIMATION = 827;
const FLAX_PICK_SOUND = 2581;
const FLAX_RESPAWN_TICKS = 25;

let flaxTracker: ResourceNodeTracker<{ locId: number }> | undefined;

interface FlaxActionData {
    locId: number;
    tile: { x: number; y: number };
    level: number;
}

function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

function executeFlaxAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as FlaxActionData;
    const tile = { x: data.tile.x, y: data.tile.y };
    const plane = data.level;
    const locId = data.locId;

    if (flaxTracker?.hasTile(tile, plane)) {
        services.stopGatheringInteraction?.(player);
        return { ok: true, effects: [] };
    }

    if (!services.hasInventorySlot?.(player)) {
        services.stopGatheringInteraction?.(player);
        return { ok: true, effects: [buildMessageEffect(player, "Your inventory is too full to hold any more flax.")] };
    }

    const effects: ActionEffect[] = [];

    services.faceGatheringTarget?.(player, tile);
    services.playPlayerSeq?.(player, FLAX_PICK_ANIMATION);

    services.enqueueSoundBroadcast?.(FLAX_PICK_SOUND, tile.x, tile.y, plane);

    flaxTracker?.add(buildTileKey(tile, plane), tile, plane, tick + FLAX_RESPAWN_TICKS, { locId });
    services.emitLocChange?.(locId, 0, tile, plane);

    const result = services.addItemToInventory(player, FLAX_ITEM_ID, 1);
    if (result.added > 0) {
        effects.push({ type: "inventorySnapshot", playerId: player.id });
    }

    effects.push(buildMessageEffect(player, "You pick some flax."));

    services.sendSound?.(player, FLAX_PICK_SOUND);

    return {
        ok: true,
        cooldownTicks: FLAX_PICK_DELAY_TICKS,
        groups: [FLAX_GROUP],
        effects,
    };
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.flax", executeFlaxAction);

    flaxTracker = new ResourceNodeTracker<{ locId: number }>();
    services.gathering?.registerTracker("flax", flaxTracker, (node, gatheringSvc) => {
        gatheringSvc.emitLocChange(0, node.data.locId, node.tile, node.level);
    });

    const requestAction = services.requestAction;
    const registerLoc = (locId: number, action: string) => {
        registry.registerLocInteraction(
            locId,
            (event) => {
                if (!isFlaxLocId(event.locId)) return;
                const result = requestAction(
                    event.player,
                    {
                        kind: "skill.flax",
                        data: {
                            locId: event.locId,
                            tile: { x: event.tile.x, y: event.tile.y },
                            level: event.level,
                        },
                        delayTicks: 0,
                        cooldownTicks: FLAX_PICK_DELAY_TICKS,
                        groups: [FLAX_GROUP],
                    },
                    event.tick,
                );
                if (!result.ok) {
                    services.sendGameMessage(
                        event.player,
                        "You're too busy to pick flax right now.",
                    );
                }
            },
            action,
        );
    };

    for (const locId of FLAX_LOC_IDS) {
        for (const action of FLAX_ACTIONS) {
            registerLoc(locId, action);
        }
    }
}

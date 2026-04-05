import type { ActionEffect, ActionExecutionResult } from "../../../src/game/actions/types";
import type { PlayerState } from "../../../src/game/player";
import type { IScriptRegistry, LocInteractionEvent, ScriptActionHandlerContext, ScriptServices } from "../../../src/game/scripts/types";

// ---------------------------------------------------------------------------
// Picklock System
//
// Handles multiloc-based locs that require a Thieving check before opening.
// Picklocking is a repeating skill action: the player keeps attempting on a
// cycle until they succeed or walk away.
//
// Success sets a varbit so the client resolves the multiloc to its "open"
// transform. The resulting "Climb-down" action is handled by a per-loc
// handler that overrides the generic climbing module.
// ---------------------------------------------------------------------------

// -- Sounds --
const TRAPDOOR_CLIMB_SOUND = 91;

// -- Action handler constants --
const PICKLOCK_FAIL_ANIM = 537;    // human_lockedchest
const PICKLOCK_SUCCESS_ANIM = 536;  // human_openchest
const PICKLOCK_SOUND = 2402;
const PICKLOCK_CYCLE_TICKS = 5;
const THIEVING_SKILL_ID = 17;

// -- Picklock definitions (multiloc + varbit) ---------------------------------
interface PicklockDef {
    locId: number;
    closedTransformId: number;
    openTransformId: number;
    varbitId: number;
    openValue: number;
    thievingLevel: number;
    xp: number;
}

const PICKLOCK_LOCS: PicklockDef[] = [
    // HAM Hideout trapdoor (west of Lumbridge)
    // Multiloc 5492: varbit 235 -> [5490 (closed), 5491 (open), 5490, 5490, -1]
    // Closed (5490) actions: ["Open", null, null, null, "Pick-Lock"]
    // Open   (5491) actions: ["Climb-down", "Close", null, null, null]
    {
        locId: 5492,
        closedTransformId: 5490,
        openTransformId: 5491,
        varbitId: 235,
        openValue: 1,
        thievingLevel: 1,
        xp: 4,
    },
];

// ---------------------------------------------------------------------------
// Picklock Action Data (self-contained)
// ---------------------------------------------------------------------------

interface PicklockActionData {
    locId: number;
    closedTransformId: number;
    openTransformId: number;
    varbitId: number;
    openValue: number;
    thievingLevel: number;
    xp: number;
    tile: { x: number; y: number };
    level: number;
    started: boolean;
}

// ---------------------------------------------------------------------------
// Picklock Action Execution
// ---------------------------------------------------------------------------

function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

function rollPicklockSuccess(playerLevel: number, reqLevel: number): boolean {
    const minChance = 50;
    const maxChance = 95;
    const range = 99 - reqLevel || 1;
    const chance = minChance + ((maxChance - minChance) * (playerLevel - reqLevel)) / range;
    const clamped = Math.min(maxChance, Math.max(minChance, chance));
    return Math.random() * 100 < clamped;
}

function executePicklockAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as PicklockActionData;
    const effects: ActionEffect[] = [];
    const thievingSkill = services.getSkill?.(player, THIEVING_SKILL_ID);
    const thievingLevel = thievingSkill?.baseLevel ?? 1;

    if (thievingLevel < data.thievingLevel) {
        effects.push(buildMessageEffect(player,
            `You need a Thieving level of ${data.thievingLevel} to pick this lock.`));
        return { ok: true, effects };
    }

    if (!data.started) {
        effects.push(buildMessageEffect(player,
            "You attempt to pick the lock on the trap door."));
        services.sendSound?.(player, PICKLOCK_SOUND);

        services.scheduleAction?.(
            player.id,
            {
                kind: "skill.picklock",
                data: { ...data, started: true },
                delayTicks: 1,
                cooldownTicks: 1,
                groups: ["skill.picklock"],
            },
            tick,
        );
        return { ok: true, cooldownTicks: 1, effects };
    }

    const success = rollPicklockSuccess(thievingLevel, data.thievingLevel);

    if (!success) {
        services.playPlayerSeq?.(player, PICKLOCK_FAIL_ANIM);
        services.sendSound?.(player, PICKLOCK_SOUND);

        services.scheduleAction?.(
            player.id,
            {
                kind: "skill.picklock",
                data: { ...data, started: true },
                delayTicks: PICKLOCK_CYCLE_TICKS,
                cooldownTicks: PICKLOCK_CYCLE_TICKS,
                groups: ["skill.picklock"],
            },
            tick,
        );
        return { ok: true, cooldownTicks: PICKLOCK_CYCLE_TICKS, effects };
    }

    // Success
    effects.push(buildMessageEffect(player, "You pick the lock on the trapdoor."));
    services.playPlayerSeq?.(player, PICKLOCK_SUCCESS_ANIM);
    services.sendSound?.(player, PICKLOCK_SOUND);
    services.addSkillXp?.(player, THIEVING_SKILL_ID, data.xp);

    // Open the trapdoor via varbit + scene rebuild trigger
    services.sendVarbit?.(player, data.varbitId, data.openValue);
    services.sendLocChangeToPlayer?.(player, data.locId, data.locId, data.tile, data.level);

    return { ok: true, effects };
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export function register(registry: IScriptRegistry, _services: ScriptServices): void {
    // Register picklock action handler
    registry.registerActionHandler("skill.picklock", executePicklockAction);

    // Register loc interactions for each picklock definition
    for (const def of PICKLOCK_LOCS) {
        const picklockHandler = (event: LocInteractionEvent) => {
            const { player, tile, level, services } = event;

            const actionData: PicklockActionData = {
                locId: def.locId,
                closedTransformId: def.closedTransformId,
                openTransformId: def.openTransformId,
                varbitId: def.varbitId,
                openValue: def.openValue,
                thievingLevel: def.thievingLevel,
                xp: def.xp,
                tile: { x: tile.x, y: tile.y },
                level,
                started: false,
            };

            services.requestAction(
                player,
                {
                    kind: "skill.picklock",
                    data: actionData,
                    delayTicks: 0,
                    cooldownTicks: 0,
                    groups: ["skill.picklock"],
                },
                event.tick,
            );
        };

        const openLockedHandler = (event: LocInteractionEvent) => {
            event.services.sendGameMessage(event.player, "The trapdoor is locked.");
        };

        for (const id of [def.locId, def.closedTransformId]) {
            registry.registerLocInteraction(id, picklockHandler, "pick-lock");
            registry.registerLocInteraction(id, openLockedHandler, "open");
        }

        registry.registerLocInteraction(def.openTransformId, (event) => {
            const { player, tile, level, services } = event;
            player.setVarbitValue(def.varbitId, 0);
            services.sendVarbit?.(player, def.varbitId, 0);
            services.sendLocChangeToPlayer?.(player, def.locId, def.locId, tile, level);
        }, "close");

        registry.registerLocInteraction(def.locId, (event) => {
            const { player, services } = event;

            services.sendGameMessage(player, "You climb down through the trapdoor...");

            player.setVarbitValue(def.varbitId, 0);
            services.sendVarbit?.(player, def.varbitId, 0);

            services.teleportPlayer?.(player, 3149, 9652, 0);
            services.sendSound?.(player, TRAPDOOR_CLIMB_SOUND);

            services.sendGameMessage(player, "... and enter a dimly lit cavern area.");
        }, "climb-down");
    }
}

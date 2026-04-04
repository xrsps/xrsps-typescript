import type { SkillPicklockActionData } from "../../actions/skillActionPayloads";
import { type LocInteractionEvent, type ScriptModule } from "../types";

// ---------------------------------------------------------------------------
// Picklock System
//
// Handles multiloc-based locs that require a Thieving check before opening.
// Picklocking is a repeating skill action (like woodcutting): the player
// keeps attempting on a cycle until they succeed or walk away.
//
// Success sets a varbit so the client resolves the multiloc to its "open"
// transform.  The resulting "Climb-down" action is handled by a per-loc
// handler that overrides the generic climbing module.
//
// Per-loc handlers (registerLocInteraction) take priority over the generic
// "open" door handler.
// ---------------------------------------------------------------------------

// -- Sounds --
const TRAPDOOR_CLIMB_SOUND = 91;

// -- Picklock definitions (multiloc + varbit) ---------------------------------
interface PicklockDef {
    /** Base multiloc ID that the client sends. */
    locId: number;
    /** Resolved loc ID shown when closed (transforms[0]). */
    closedTransformId: number;
    /** Resolved loc ID shown when open (transforms[openValue]). */
    openTransformId: number;
    /** Varbit that controls which transform the multiloc displays. */
    varbitId: number;
    /** Varbit value to set on success (index into transforms array). */
    openValue: number;
    /** Required Thieving level. */
    thievingLevel: number;
    /** Thieving XP awarded on success. */
    xp: number;
}

const PICKLOCK_LOCS: PicklockDef[] = [
    // HAM Hideout trapdoor (west of Lumbridge)
    // Multiloc 5492: varbit 235 → [5490 (closed), 5491 (open), 5490, 5490, -1]
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
// Module
// ---------------------------------------------------------------------------

export const picklockModule: ScriptModule = {
    id: "content.picklock",
    register(registry, _services) {
        for (const def of PICKLOCK_LOCS) {
            // "Pick-Lock" — queue a repeating skill action via the scheduler.
            const picklockHandler = (event: LocInteractionEvent) => {
                const { player, tile, level, services } = event;

                const actionData: SkillPicklockActionData = {
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

            // Register on both the multiloc container (5492) and the closed
            // transform (5490).
            for (const id of [def.locId, def.closedTransformId]) {
                registry.registerLocInteraction(id, picklockHandler, "pick-lock");
                registry.registerLocInteraction(id, openLockedHandler, "open");
            }

            // "Close" on open transform (5491).
            registry.registerLocInteraction(def.openTransformId, (event) => {
                const { player, tile, level, services } = event;
                player.setVarbitValue(def.varbitId, 0);
                services.sendVarbit?.(player, def.varbitId, 0);
                services.sendLocChangeToPlayer?.(player, def.locId, def.locId, tile, level);
            }, "close");

            // "Climb-down" on the multiloc container (5492) when varbit=1.
            // Overrides the generic climbing module (per-loc handlers have priority).
            // No climbing animation for trapdoors — just teleport + reset varbit.
            registry.registerLocInteraction(def.locId, (event) => {
                const { player, services } = event;

                services.sendGameMessage(player, "You climb down through the trapdoor...");

                // Close trapdoor behind the player
                player.setVarbitValue(def.varbitId, 0);
                services.sendVarbit?.(player, def.varbitId, 0);

                // Teleport to HAM dungeon
                services.teleportPlayer?.(player, 3149, 9652, 0);
                services.sendSound?.(player, TRAPDOOR_CLIMB_SOUND);

                services.sendGameMessage(player, "... and enter a dimly lit cavern area.");
            }, "climb-down");
        }
    },
};

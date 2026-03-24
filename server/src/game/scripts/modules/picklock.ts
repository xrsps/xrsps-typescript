import { SkillId } from "../../../../../src/rs/skill/skills";
import { type LocInteractionEvent, type ScriptModule } from "../types";

// ---------------------------------------------------------------------------
// Picklock System
//
// Handles multiloc-based locs that require a Thieving check before opening.
// Success sets a varbit so the client resolves the multiloc to its "open"
// transform.  The resulting "Climb-down" action is handled by the climbing
// module.
//
// Per-loc handlers (registerLocInteraction) take priority over the generic
// "open" door handler.
// ---------------------------------------------------------------------------

// -- Animations (from animation_names.txt) ------------------------------------
const PICKLOCK_ANIM = 3691; // human_picklock_chest

// -- Sounds (from osrs-synths.json) -------------------------------------------
const PICKLOCK_SOUND = 2407; // pick_lock

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
// Success roll
// ---------------------------------------------------------------------------

/**
 * OSRS picklock success rate: linear interpolation from ~50 % at the
 * required level to ~95 % at level 99.  Clamped to [50, 95].
 */
function rollPicklockSuccess(playerLevel: number, reqLevel: number): boolean {
    const minChance = 50;
    const maxChance = 95;
    const range = 99 - reqLevel || 1;
    const chance = minChance + ((maxChance - minChance) * (playerLevel - reqLevel)) / range;
    const clamped = Math.min(maxChance, Math.max(minChance, chance));
    return Math.random() * 100 < clamped;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function handlePicklock(event: LocInteractionEvent, def: PicklockDef): void {
    const { player, tile, level, services } = event;
    const thievingLevel = player.getSkill(SkillId.Thieving).baseLevel;

    if (thievingLevel < def.thievingLevel) {
        services.sendGameMessage(
            player,
            `You need a Thieving level of ${def.thievingLevel} to pick this lock.`,
        );
        return;
    }

    services.playPlayerSeq?.(player, PICKLOCK_ANIM);
    services.playAreaSound?.({
        soundId: PICKLOCK_SOUND,
        tile,
        level,
        radius: 1,
    });

    if (!rollPicklockSuccess(thievingLevel, def.thievingLevel)) {
        services.sendGameMessage(player, "You fail to pick the lock.");
        return;
    }

    services.sendGameMessage(player, "You manage to pick the lock.");
    services.addSkillXp?.(player, SkillId.Thieving, def.xp);

    // Update server-side state so subsequent interactions resolve the open transform.
    player.setVarbitValue(def.varbitId, def.openValue);
    // Send varbit to client so VarManager resolves the multiloc correctly on future map loads.
    services.sendVarbit?.(player, def.varbitId, def.openValue);
    // Send per-player loc_change to trigger an immediate map square reload so the
    // client swaps the scene model without a full map refresh.  Unlike emitLocChange
    // this does NOT broadcast to other players or persist in dynamicLocState.
    services.sendLocChangeToPlayer?.(player, def.locId, def.openTransformId, tile, level);
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const picklockModule: ScriptModule = {
    id: "content.picklock",
    register(registry, _services) {
        for (const def of PICKLOCK_LOCS) {
            const picklockHandler = (event: LocInteractionEvent) => {
                handlePicklock(event, def);
            };
            const openLockedHandler = (event: LocInteractionEvent) => {
                event.services.sendGameMessage(event.player, "The trapdoor is locked.");
            };

            // Register on both the multiloc container (5492, sent on initial map load)
            // and the closed transform (5490, sent after a close loc_change).
            for (const id of [def.locId, def.closedTransformId]) {
                registry.registerLocInteraction(id, picklockHandler, "pick-lock");
                registry.registerLocInteraction(id, openLockedHandler, "open");
            }

            // "Close" on open transform (5491).
            registry.registerLocInteraction(def.openTransformId, (event) => {
                const { player, tile, level, services } = event;
                console.log(`[picklock] Close handler fired for loc ${def.openTransformId} at (${tile.x},${tile.y},${level})`);
                player.setVarbitValue(def.varbitId, 0);
                services.sendVarbit?.(player, def.varbitId, 0);
                // Map back to the multiloc container so the scene re-resolves transforms.
                services.sendLocChangeToPlayer?.(player, def.openTransformId, def.locId, tile, level);
            }, "close");
        }
    },
};

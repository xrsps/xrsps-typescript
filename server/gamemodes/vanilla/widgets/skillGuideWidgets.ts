import {
    VARBIT_SKILL_GUIDE_SKILL,
    VARBIT_SKILL_GUIDE_SUBSECTION,
} from "../../../../src/shared/vars";
import { type IScriptRegistry, type ScriptServices, BaseComponentUids } from "../../../src/game/scripts/types";

/**
 * Skill guide widget handlers - opens skill guide overlay when skill tab is clicked.
 *
 * Interface 320 = skills tab, Interface 214 = skill guide overlay.
 * Mounted on toplevel_osrs_stretch:floater (161:18) as type=overlay.
 * Script 9340 populates titles/categories/detail list.
 */

// Widget/Interface IDs
const SKILLS_TAB_GROUP_ID = 320;
const SKILL_GUIDE_GROUP_ID = 214;
const SCRIPT_SKILL_GUIDE_BUILD = 9340;

type SkillGuideEntry = {
    childId: number;
    skillVarbitValue: number;
    skillName: string;
};

/**
 * Skill guide buttons in interface 320 mapped to their guide varbit values.
 * Based on RSMod's SkillGuide.kt enum.
 */
const SKILL_GUIDE_ENTRIES: readonly SkillGuideEntry[] = [
    { childId: 1, skillVarbitValue: 1, skillName: "Attack" },
    { childId: 2, skillVarbitValue: 2, skillName: "Strength" },
    { childId: 3, skillVarbitValue: 5, skillName: "Defence" },
    { childId: 4, skillVarbitValue: 3, skillName: "Ranged" },
    { childId: 5, skillVarbitValue: 7, skillName: "Prayer" },
    { childId: 6, skillVarbitValue: 4, skillName: "Magic" },
    { childId: 7, skillVarbitValue: 12, skillName: "Runecrafting" },
    { childId: 8, skillVarbitValue: 22, skillName: "Construction" },
    { childId: 9, skillVarbitValue: 6, skillName: "Hitpoints" },
    { childId: 10, skillVarbitValue: 8, skillName: "Agility" },
    { childId: 11, skillVarbitValue: 9, skillName: "Herblore" },
    { childId: 12, skillVarbitValue: 10, skillName: "Thieving" },
    { childId: 13, skillVarbitValue: 11, skillName: "Crafting" },
    { childId: 14, skillVarbitValue: 19, skillName: "Fletching" },
    { childId: 15, skillVarbitValue: 20, skillName: "Slayer" },
    { childId: 16, skillVarbitValue: 23, skillName: "Hunter" },
    { childId: 17, skillVarbitValue: 13, skillName: "Mining" },
    { childId: 18, skillVarbitValue: 14, skillName: "Smithing" },
    { childId: 19, skillVarbitValue: 15, skillName: "Fishing" },
    { childId: 20, skillVarbitValue: 16, skillName: "Cooking" },
    { childId: 21, skillVarbitValue: 17, skillName: "Firemaking" },
    { childId: 22, skillVarbitValue: 18, skillName: "Woodcutting" },
    { childId: 23, skillVarbitValue: 21, skillName: "Farming" },
    { childId: 24, skillVarbitValue: 24, skillName: "Sailing" },
];

export function registerSkillGuideWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    // Register a handler for each skill in the skills tab (interface 320)
    // Uses onButton since binary IF_BUTTON packets don't send option strings
    for (const { childId, skillVarbitValue, skillName } of SKILL_GUIDE_ENTRIES) {
        registry.onButton(SKILLS_TAB_GROUP_ID, childId, (event) => {
            const player = event.player;

            player.varps.setVarbitValue(VARBIT_SKILL_GUIDE_SUBSECTION, 0);
            player.varps.setVarbitValue(VARBIT_SKILL_GUIDE_SKILL, skillVarbitValue);

            services.queueVarbit?.(player.id, VARBIT_SKILL_GUIDE_SUBSECTION, 0);
            services.queueVarbit?.(player.id, VARBIT_SKILL_GUIDE_SKILL, skillVarbitValue);

            const floaterUid = BaseComponentUids.FLOATER_OVERLAY;

            services.openSubInterface?.(player, floaterUid, SKILL_GUIDE_GROUP_ID, 1, {
                varbits: {
                    [VARBIT_SKILL_GUIDE_SUBSECTION]: 0,
                    [VARBIT_SKILL_GUIDE_SKILL]: skillVarbitValue,
                },
                postScripts: [
                    {
                        scriptId: SCRIPT_SKILL_GUIDE_BUILD,
                        args: [skillVarbitValue, 0, 0, 0],
                    },
                ],
            });

            // Clear events on skill_guide:icons (214:32)
            const SKILL_GUIDE_ICONS_UID = (SKILL_GUIDE_GROUP_ID << 16) | 32;
            services.queueWidgetEvent?.(player.id, {
                action: "set_flags_range",
                uid: SKILL_GUIDE_ICONS_UID,
                fromSlot: -1,
                toSlot: -1,
                flags: 0,
            });
        });
    }

    // Sub-section button clicks (interface 214, children 11-24) are handled purely
    // by CS2 scripts on the client - no server handler needed.
}

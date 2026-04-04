import {
    VARBIT_SKILL_GUIDE_SKILL,
    VARBIT_SKILL_GUIDE_SUBSECTION,
} from "../../../../../src/shared/vars";
import { getMainmodalUid } from "../../../widgets/viewport";
import { type ScriptModule } from "../types";

/**
 * Skill guide widget handlers - opens skill guide interface when skill is clicked
 *
 * Based on RSMod's skill_guides.plugin.kts and OSRS CS2 scripts:
 * - Interface 320 is the skills tab
 * - Interface 214 is the skill guide display
 * - Varbit 4371 (SKILL_GUIDE_SKILL) controls which skill guide to show
 * - Varbit 4372 (SKILL_GUIDE_SUBSECTION) controls the sub-section within the guide
 *
 * Uses onButton registration since binary IF_BUTTON packets don't send option strings.
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

export const skillGuideWidgetModule: ScriptModule = {
    id: "content.skill-guide-widgets",
    register(registry, services) {
        // Register a handler for each skill in the skills tab (interface 320)
        // Uses onButton since binary IF_BUTTON packets don't send option strings
        for (const { childId, skillVarbitValue, skillName } of SKILL_GUIDE_ENTRIES) {
            registry.onButton(SKILLS_TAB_GROUP_ID, childId, (event) => {
                const player = event.player;

                // Update player's varbit state
                player.setVarbitValue(VARBIT_SKILL_GUIDE_SUBSECTION, 0);
                player.setVarbitValue(VARBIT_SKILL_GUIDE_SKILL, skillVarbitValue);

                // Send varbits to client
                services.queueVarbit?.(player.id, VARBIT_SKILL_GUIDE_SUBSECTION, 0);
                services.queueVarbit?.(player.id, VARBIT_SKILL_GUIDE_SKILL, skillVarbitValue);

                // Open the skill guide interface (214) in the mainmodal container
                const mainmodalUid = getMainmodalUid(player.displayMode);

                services.logger?.info?.(
                    `[skill-guide] Opening ${skillName} guide: targetUid=${mainmodalUid} (0x${mainmodalUid.toString(
                        16,
                    )}), ` +
                        `groupId=${SKILL_GUIDE_GROUP_ID}, varbits={${VARBIT_SKILL_GUIDE_SKILL}:${skillVarbitValue}, ${VARBIT_SKILL_GUIDE_SUBSECTION}:0}`,
                );

                services.openSubInterface?.(player, mainmodalUid, SKILL_GUIDE_GROUP_ID, 0, {
                    varbits: {
                        [VARBIT_SKILL_GUIDE_SUBSECTION]: 0,
                        [VARBIT_SKILL_GUIDE_SKILL]: skillVarbitValue,
                    },
                    // OSRS parity: opening 214 alone only mounts the shell. The client then runs
                    // script9340(skill, subsection, startLevel, endLevel) to populate titles,
                    // categories, and the detail list for the current skill.
                    postScripts: [
                        {
                            scriptId: SCRIPT_SKILL_GUIDE_BUILD,
                            args: [skillVarbitValue, 0, 0, 0],
                        },
                    ],
                });
            });
        }

        // Sub-section button clicks (interface 214, children 11-24) are handled purely
        // by CS2 scripts on the client - no server handler needed.
    },
};

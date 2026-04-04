import type { ScriptModule } from "../../src/game/scripts/types";
import { craftingSkillModule } from "./crafting/index";
import { firemakingModule } from "./firemaking/index";
import { fishingModule } from "./fishing/index";
import { fletchingModule } from "./fletching/index";
import { herbloreModule } from "./herblore/index";
import { miningModule } from "./mining/index";
import { prayerSkillModule } from "./prayer/index";
import { thievingModule } from "./thieving/index";
import { woodcuttingModule } from "./woodcutting/index";

const skillModules: ScriptModule[] = [
    thievingModule,
    herbloreModule,
    prayerSkillModule,
    fletchingModule,
    craftingSkillModule,
    firemakingModule,
    woodcuttingModule,
    miningModule,
    fishingModule,
];

export const module: ScriptModule = {
    id: "vanilla-skills",
    register(registry, services) {
        for (const skill of skillModules) {
            skill.register(registry, services);
        }
    },
};

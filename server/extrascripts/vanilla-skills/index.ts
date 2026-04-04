import type { ScriptModule } from "../../src/game/scripts/types";
import { herbloreModule } from "./herblore/index";
import { thievingModule } from "./thieving/index";

const skillModules: ScriptModule[] = [
    thievingModule,
    herbloreModule,
];

export const module: ScriptModule = {
    id: "vanilla-skills",
    register(registry, services) {
        for (const skill of skillModules) {
            skill.register(registry, services);
        }
    },
};

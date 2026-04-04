import type { ScriptModule } from "../../../src/game/scripts/types";
import { picklockModule } from "./picklock";
import { thievingModule as pickpocketModule } from "./pickpocket";

const thievingSubmodules: ScriptModule[] = [
    pickpocketModule,
    picklockModule,
];

export const thievingModule: ScriptModule = {
    id: "vanilla-skills.thieving",
    register(registry, services) {
        for (const sub of thievingSubmodules) {
            sub.register(registry, services);
        }
    },
};

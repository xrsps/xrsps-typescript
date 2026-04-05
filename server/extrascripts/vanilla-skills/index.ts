import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import { register as registerConsumables } from "./consumables/index";
import { register as registerCrafting } from "./crafting/index";
import { register as registerFiremaking } from "./firemaking/index";
import { register as registerFishing } from "./fishing/index";
import { register as registerFletching } from "./fletching/index";
import { register as registerHerblore } from "./herblore/index";
import { register as registerMining } from "./mining/index";
import { register as registerPrayer } from "./prayer/index";
import { register as registerProduction } from "./production/index";
import { register as registerThieving } from "./thieving/index";
import { register as registerWoodcutting } from "./woodcutting/index";
import { register as registerSailing } from "./sailing/index";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registerThieving(registry, services);
    registerHerblore(registry, services);
    registerPrayer(registry, services);
    registerFletching(registry, services);
    registerCrafting(registry, services);
    registerFiremaking(registry, services);
    registerWoodcutting(registry, services);
    registerMining(registry, services);
    registerFishing(registry, services);
    registerProduction(registry, services);
    registerConsumables(registry, services);
    registerSailing(registry, services);
}

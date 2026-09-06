import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import { registerBankingHandlers } from "../vanilla/banking";
import { registerEquipmentWidgetHandlers } from "../vanilla/equipment/equipmentWidgets";
import { registerCombatWidgetHandlers } from "../vanilla/widgets/combatWidgets";
import { registerEmoteWidgetHandlers } from "../vanilla/widgets/emoteWidgets";
import { registerMinimapWidgetHandlers } from "../vanilla/widgets/minimapWidgets";
import { registerMusicWidgetHandlers } from "../vanilla/widgets/musicWidgets";
import { registerSettingsWidgetHandlers } from "../vanilla/widgets/settingsWidgets";
import { registerSkillGuideWidgetHandlers } from "../vanilla/widgets/skillGuideWidgets";

export function registerDuelNativeUi(registry: IScriptRegistry, services: ScriptServices): void {
    registerBankingHandlers(registry, services);
    registerCombatWidgetHandlers(registry, services);
    registerEquipmentWidgetHandlers(registry, services);
    registerEmoteWidgetHandlers(registry, services);
    registerMinimapWidgetHandlers(registry, services);
    registerMusicWidgetHandlers(registry, services);
    registerSettingsWidgetHandlers(registry, services);
    registerSkillGuideWidgetHandlers(registry, services);
}

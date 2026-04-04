import path from "path";

import { type ScriptModule } from "./types";

export interface ScriptManifestEntry {
    id: string;
    load: () => ScriptModule;
    watch?: string[];
    enableWhen?: (env: NodeJS.ProcessEnv) => boolean;
}

const MODULE_DIR = __dirname;

const loadModule = (relativePath: string, exportName: string): (() => ScriptModule) => {
    const resolved = path.resolve(MODULE_DIR, relativePath);
    return () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(resolved);
        return mod[exportName] as ScriptModule;
    };
};

export const SCRIPT_MANIFEST: ScriptManifestEntry[] = [
    {
        id: "content.climbing",
        load: loadModule("modules/climbing", "climbingModule"),
        watch: [path.resolve(MODULE_DIR, "modules/climbing.ts")],
    },
    {
        id: "content.doors",
        load: loadModule("modules/doors", "doorInteractionsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/doors.ts")],
    },
    {
        id: "content.bankers",
        load: loadModule("modules/bankers", "bankerInteractionsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/bankers.ts")],
    },
    {
        id: "content.bank-widgets",
        load: loadModule("modules/bankWidgets", "bankWidgetActionsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/bankWidgets.ts")],
    },
    {
        id: "content.bankside-widgets",
        load: loadModule("modules/banksideWidgets", "banksideWidgetActionsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/banksideWidgets.ts")],
    },
    {
        id: "content.bank-locations",
        load: loadModule("modules/bankLocations", "bankLocationModule"),
        watch: [path.resolve(MODULE_DIR, "modules/bankLocations.ts")],
    },
    {
        id: "content.combat-widgets",
        load: loadModule("modules/combatWidgets", "combatWidgetModule"),
        watch: [path.resolve(MODULE_DIR, "modules/combatWidgets.ts")],
    },
    {
        id: "content.minimap-widgets",
        load: loadModule("modules/minimapWidgets", "minimapWidgetModule"),
        watch: [path.resolve(MODULE_DIR, "modules/minimapWidgets.ts")],
    },
    {
        id: "content.prayer-widgets",
        load: loadModule("modules/prayerWidgets", "prayerWidgetModule"),
        watch: [path.resolve(MODULE_DIR, "modules/prayerWidgets.ts")],
    },
    {
        id: "content.music-widgets",
        load: loadModule("modules/musicWidgets", "musicWidgetModule"),
        watch: [path.resolve(MODULE_DIR, "modules/musicWidgets.ts")],
    },
    {
        id: "content.emote-widgets",
        load: loadModule("modules/emoteWidgets", "emoteWidgetModule"),
        watch: [path.resolve(MODULE_DIR, "modules/emoteWidgets.ts")],
    },
    {
        id: "content.spellbook-widgets",
        load: loadModule("modules/spellbookWidgets", "spellbookWidgetModule"),
        watch: [path.resolve(MODULE_DIR, "modules/spellbookWidgets.ts")],
    },
    {
        id: "content.skill-guide-widgets",
        load: loadModule("modules/skillGuideWidgets", "skillGuideWidgetModule"),
        watch: [path.resolve(MODULE_DIR, "modules/skillGuideWidgets.ts")],
    },
    {
        id: "content.shops",
        load: loadModule("modules/shops", "shopInteractionsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/shops.ts")],
    },
    {
        id: "content.romeo",
        load: loadModule("modules/romeo", "romeoModule"),
        watch: [path.resolve(MODULE_DIR, "modules/romeo.ts")],
    },
    {
        id: "content.al-kharid-border",
        load: loadModule("modules/alKharidBorder", "alKharidBorderModule"),
        watch: [path.resolve(MODULE_DIR, "modules/alKharidBorder.ts")],
    },
    {
        id: "content.wilderness-access",
        load: loadModule("modules/wildernessAccess", "wildernessAccessModule"),
        watch: [path.resolve(MODULE_DIR, "modules/wildernessAccess.ts")],
    },
    {
        id: "content.default-talk",
        load: loadModule("modules/defaultTalk", "defaultTalkModule"),
        watch: [path.resolve(MODULE_DIR, "modules/defaultTalk.ts")],
    },
    {
        id: "content.shop-widgets",
        load: loadModule("modules/shopWidgets", "shopWidgetActionsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/shopWidgets.ts")],
    },
    {
        id: "content.settings-widgets",
        load: loadModule("modules/settingsWidgets", "settingsWidgetsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/settingsWidgets.ts")],
    },
    {
        id: "content.quest-journal-widgets",
        load: loadModule("modules/questJournalWidgets", "questJournalWidgetsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/questJournalWidgets.ts")],
    },
    {
        id: "content.account-summary-widgets",
        load: loadModule("modules/accountSummaryWidgets", "accountSummaryWidgetsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/accountSummaryWidgets.ts")],
    },
    {
        id: "content.collection-log-widgets",
        load: loadModule("modules/collectionLogWidgets", "collectionLogWidgetsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/collectionLogWidgets.ts")],
    },
    {
        id: "content.equipment",
        load: loadModule("modules/equipment", "equipmentActionsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/equipment.ts")],
    },
    {
        id: "content.equipment-widgets",
        load: loadModule("modules/equipmentWidgets", "equipmentWidgetModule"),
        watch: [path.resolve(MODULE_DIR, "modules/equipmentWidgets.ts")],
    },
    {
        id: "content.skill-surfaces",
        load: loadModule("modules/skills", "skillSurfaceModule"),
        watch: [path.resolve(MODULE_DIR, "modules/skills.ts")],
    },
    {
        id: "content.poh-pools",
        load: loadModule("modules/pohPools", "pohPoolModule"),
        watch: [path.resolve(MODULE_DIR, "modules/pohPools.ts")],
    },
    {
        id: "consumables",
        load: loadModule("modules/items/consumables", "consumablesModule"),
        watch: [path.resolve(MODULE_DIR, "modules/items/consumables.ts")],
    },
    {
        id: "followers",
        load: loadModule("modules/items/followers", "followerItemModule"),
        watch: [path.resolve(MODULE_DIR, "modules/items/followers.ts")],
    },
    {
        id: "quest.pandemonium",
        load: loadModule("modules/quests/pandemonium", "pandemoniumQuestModule"),
        watch: [path.resolve(MODULE_DIR, "modules/quests/pandemonium.ts")],
    },
    {
        id: "packs",
        load: loadModule("modules/items/packs", "packsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/items/packs.ts")],
    },
    {
        id: "demo.interactions",
        load: loadModule("modules/demoInteractions", "demoInteractionsModule"),
        watch: [path.resolve(MODULE_DIR, "modules/demoInteractions.ts")],
        enableWhen: (env) => env.ENABLE_DEMO_SCRIPTS === "1",
    },
];

import type { GamemodeDefinition, GamemodeInitContext, GamemodeServerServices } from "../../src/game/gamemodes/GamemodeDefinition";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import type { NpcLootConfig } from "../../src/game/combat/DamageTracker";
import type { PlayerState } from "../../src/game/player";
import type { BankingProviderServices } from "./banking/BankingProvider";

import { BaseGamemode } from "../../src/game/gamemodes/BaseGamemode";
import { getProviderRegistry, resetProviderRegistry } from "../../src/game/providers/ProviderRegistry";
import { getWeaponDataProvider } from "../../src/game/combat/WeaponDataProvider";
import { createDefaultAmmoDataProvider } from "../../src/game/combat/AmmoSystem";
import { encodeMessage } from "../../src/network/messages";

import { BankingManager, registerBankingHandlers, registerBankInterfaceHooks } from "./banking";
import { registerShopInterfaceHooks } from "./shops";
import { ShopService } from "./shops/ShopService";
import { registerShopInteractionHandlers } from "./shops/shopInteractions";
import { registerShopWidgetHandlers } from "./shops/shopWidgets";
import { registerZaffHandlers } from "./shops/zaff";
import { registerEquipmentHandlers } from "./equipment/equipment";
import { registerEquipmentWidgetHandlers } from "./equipment/equipmentWidgets";
import { registerEquipmentStatsInterfaceHooks } from "./equipment/EquipmentStatsInterfaceHooks";
import { computeTargetBonusPercentages } from "./equipment/targetBonuses";
import { createCombatFormulaProvider } from "./combat/CombatFormulas";
import { createCombatStyleSequenceProvider } from "./combat/CombatStyleSequences";
import { createEquipmentBonusProvider } from "./combat/EquipmentBonuses";
import { createSpecialAttackProvider } from "./combat/SpecialAttackRegistry";
import { createSpecialAttackVisualProvider } from "./combat/SpecialAttackVisuals";
import { createInstantUtilitySpecialProvider } from "./combat/RockKnockerSpecial";
import { createSpellXpProvider } from "./combat/SpellXpData";
import { createSkillConfiguration } from "./combat/SkillConfiguration";
import { createWeaponDataProvider } from "./data/weapons";
import { createSpellDataProvider } from "./data/spells";
import { createRuneDataProvider } from "./data/runes";
import { createProjectileParamsProvider } from "./data/projectileParams";
import { DEFAULT_LOGIN_VARBITS } from "./data/loginVarbits";
import { DEFAULT_LOGIN_VARPS } from "./data/loginVarps";
import { NPC_LOOT_CONFIGS } from "./data/lootDistribution";
import { handleSailingPlayerRestore } from "./skills/sailing";
import { register as registerSkillHandlers } from "./skills";
import { registerClimbingHandlers } from "./scripts/content/climbing";
import { registerDoorHandlers } from "./scripts/content/doors";
import { registerDefaultTalkHandlers } from "./scripts/content/defaultTalk";
import { registerPohPoolHandlers } from "./scripts/content/pohPools";
import { registerWildernessAccessHandlers } from "./scripts/content/wildernessAccess";
import { registerAlKharidBorderHandlers } from "./scripts/content/alKharidBorder";
import { registerRomeoHandlers } from "./scripts/content/romeo";
import { registerDemoInteractionHandlers } from "./scripts/content/demoInteractions";
import { registerFollowerItemHandlers } from "./scripts/items/followers";
import { registerPacksHandlers } from "./scripts/items/packs";
import { registerLevelUpHandlers, handleResumePauseButton, handleDismiss } from "./scripts/levelup";
import { registerCombatWidgetHandlers } from "./widgets/combatWidgets";
import { registerMinimapWidgetHandlers } from "./widgets/minimapWidgets";
import { registerPrayerWidgetHandlers } from "./widgets/prayerWidgets";
import { registerMusicWidgetHandlers } from "./widgets/musicWidgets";
import { registerEmoteWidgetHandlers } from "./widgets/emoteWidgets";
import { registerSpellbookWidgetHandlers } from "./widgets/spellbookWidgets";
import { registerSkillGuideWidgetHandlers } from "./widgets/skillGuideWidgets";
import { registerSettingsWidgetHandlers } from "./widgets/settingsWidgets";
import { registerQuestJournalWidgetHandlers } from "./widgets/questJournalWidgets";
import { registerAccountSummaryWidgetHandlers } from "./widgets/accountSummaryWidgets";
import { registerCollectionLogWidgetHandlers } from "./widgets/collectionLogWidgets";
import { registerWidgetCloseHandlers } from "./modals/widgetCloseHandlers";
import { registerWidgetOpenHandlers } from "./modals/widgetOpenHandlers";
import { registerSmithingBarModalHandler } from "./modals/smithingBarModalHandler";
import "./combat/BossCombatScript";

export class VanillaGamemode extends BaseGamemode {
    override readonly id = "vanilla";
    override readonly name = "Vanilla";

    private bankingManager: BankingManager | undefined;
    private shopService: ShopService | undefined;
    private serverServices: GamemodeServerServices | undefined;
    private scriptServices: ScriptServices | undefined;

    getLootDistributionConfig(npcTypeId: number): NpcLootConfig | undefined {
        return NPC_LOOT_CONFIGS.get(npcTypeId);
    }

    getLoginVarbits(_player: PlayerState): Array<[number, number]> {
        return DEFAULT_LOGIN_VARBITS;
    }

    getLoginVarps(_player: PlayerState): Array<[number, number]> {
        return DEFAULT_LOGIN_VARPS;
    }

    onPlayerRestore(player: PlayerState): void {
        const services = this.scriptServices;
        if (!services) return;

        handleSailingPlayerRestore(player, services);
    }

    getGamemodeServices(): Record<string, unknown> {
        return {
            banking: this.bankingManager,
            weaponDataProvider: getWeaponDataProvider(),
        };
    }

    private registerProviders(): void {
        const registry = getProviderRegistry();
        registry.spellXp = createSpellXpProvider();
        registry.specialAttackVisual = createSpecialAttackVisualProvider();
        registry.instantUtilitySpecial = createInstantUtilitySpecialProvider();
        registry.weaponData = createWeaponDataProvider();
        registry.specialAttack = createSpecialAttackProvider();
        registry.combatFormula = createCombatFormulaProvider();
        registry.combatStyleSequence = createCombatStyleSequenceProvider();
        registry.skillConfiguration = createSkillConfiguration();
        registry.equipmentBonus = createEquipmentBonusProvider();
        registry.projectileParams = createProjectileParamsProvider();
        registry.spellData = createSpellDataProvider();
        registry.runeData = createRuneDataProvider();
        registry.ammoData = createDefaultAmmoDataProvider();
    }

    contributeScriptServices(services: ScriptServices): void {
        this.scriptServices = services;
        const ss = this.serverServices;

        // Banking services
        const bm = this.bankingManager;
        if (bm) {
            services.banking = {
                openBank: (player, opts) => bm.openBank(player, opts),
                depositInventoryToBank: (player, tab) => bm.depositInventory(player, tab),
                depositEquipmentToBank: (player, tab) => bm.depositEquipment(player, tab),
                depositInventoryItemToBank: (player, slot, quantity, opts) => {
                    const slotIndex = Math.trunc(slot);
                    const amount = Math.trunc(quantity);
                    const itemIdHintRaw = opts?.itemIdHint;
                    const tabRaw = opts?.tab;
                    return bm.depositItem(
                        player,
                        slotIndex,
                        amount,
                        itemIdHintRaw !== undefined && Number.isFinite(itemIdHintRaw)
                            ? Math.trunc(itemIdHintRaw)
                            : undefined,
                        tabRaw !== undefined && Number.isFinite(tabRaw)
                            ? Math.trunc(tabRaw)
                            : undefined,
                    );
                },
                withdrawFromBankSlot: (player, slot, quantity, opts) =>
                    bm.withdraw(player, slot, quantity, { overrideNoted: opts?.noted }),
                getBankEntryAtClientSlot: (player, clientSlot) =>
                    bm.getBankEntryAtClientSlot(player, clientSlot),
                queueBankSnapshot: (player) => bm.queueBankSnapshot(player),
                sendBankTabVarbits: (player) => bm.sendBankTabVarbits(player),
                addItemToBank: (player, itemId, qty) => bm.addItemToBank(player, itemId, qty),
            };
        }

        // Shop services
        if (this.shopService) {
            services.shopping = this.shopService.createScriptServices();
        }

        // Equipment target-specific bonuses
        services.equipment.computeTargetBonusPercentages = (player) =>
            computeTargetBonusPercentages(player, services.equipment.getEquipArray(player));

        // Widget lifecycle handlers
        registerWidgetCloseHandlers(services, {
            closeModal: (player) => ss?.getInterfaceService()?.closeModal(player),
        });
        registerWidgetOpenHandlers(services);

        // Smithing bar modal handler
        registerSmithingBarModalHandler(services, {
            closeModal: (player) => ss?.getInterfaceService()?.closeModal(player),
        });
    }

    override registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
        // Banking, equipment, shops
        registerBankingHandlers(registry, services);
        registerEquipmentHandlers(registry, services);
        registerEquipmentWidgetHandlers(registry, services);
        registerShopInteractionHandlers(registry, services);
        registerShopWidgetHandlers(registry, services);
        registerZaffHandlers(registry, services);

        // Content
        registerClimbingHandlers(registry, services);
        registerDoorHandlers(registry, services);
        registerDefaultTalkHandlers(registry, services);
        registerPohPoolHandlers(registry, services);
        registerWildernessAccessHandlers(registry, services);
        registerAlKharidBorderHandlers(registry, services);
        registerRomeoHandlers(registry, services);
        registerDemoInteractionHandlers(registry, services);

        // Items
        registerFollowerItemHandlers(registry, services);
        registerPacksHandlers(registry, services);

        // Widgets
        registerCombatWidgetHandlers(registry, services);
        registerMinimapWidgetHandlers(registry, services);
        registerPrayerWidgetHandlers(registry, services);
        registerMusicWidgetHandlers(registry, services);
        registerEmoteWidgetHandlers(registry, services);
        registerSpellbookWidgetHandlers(registry, services);
        registerSkillGuideWidgetHandlers(registry, services);
        registerSettingsWidgetHandlers(registry, services);
        registerQuestJournalWidgetHandlers(registry, services);
        registerAccountSummaryWidgetHandlers(registry, services);
        registerCollectionLogWidgetHandlers(registry, services);

        // Skills
        registerSkillHandlers(registry, services);

        // Level-up display (event-driven from SkillService)
        if (services.system.eventBus) {
            registerLevelUpHandlers(services, services.system.eventBus);
        }
    }

    override initialize(context: GamemodeInitContext): void {
        const ss = context.serverServices;
        this.serverServices = ss;

        this.registerProviders();

        // === Banking ===
        const bankingServices: BankingProviderServices = {
            ...ss,
            queueBankSnapshot: (playerId, payload) =>
                ss.queueGamemodeSnapshot("bank", playerId, payload),
            sendBankSnapshot: (playerId, payload) =>
                ss.queueGamemodeSnapshot("bank", playerId, payload),
        };

        this.bankingManager = new BankingManager(bankingServices);

        const bm = this.bankingManager;
        ss.registerSnapshotEncoder(
            "bank",
            (_playerId, payload) => ({
                message: encodeMessage({ type: "bank", payload }),
                context: "bank_snapshot",
            }),
            (playerId, _payload) => {
                const player = ss.getPlayer(playerId);
                if (player) {
                    player.bank.setBankClientSlotMapping(bm.buildBankSlotMapping(player));
                }
            },
        );

        // === Shops ===
        this.shopService = new ShopService({ serverServices: ss });

        // === Interface hooks ===
        const interfaceService = ss.getInterfaceService();
        if (interfaceService) {
            registerBankInterfaceHooks(interfaceService);
            registerEquipmentStatsInterfaceHooks(interfaceService);
            registerShopInterfaceHooks(interfaceService);
        }
    }

    onResumePauseButton(player: PlayerState, widgetId: number, childIndex: number): boolean {
        if (!this.scriptServices) return false;
        return handleResumePauseButton(this.scriptServices, player, widgetId, childIndex);
    }

    onPlayerDisconnect(playerId: number): void {
        if (this.scriptServices) {
            handleDismiss(this.scriptServices, playerId);
        }
    }

    override dispose(): void {
        resetProviderRegistry();

        this.bankingManager = undefined;
        this.shopService = undefined;
        this.serverServices = undefined;
        this.scriptServices = undefined;
    }
}

export function createGamemode(): GamemodeDefinition {
    return new VanillaGamemode();
}

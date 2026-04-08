import type { BankingProviderServices } from "./banking/BankingProvider";
import type { PlayerState } from "../../src/game/player";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import type { ObjType } from "../../../src/rs/config/objtype/ObjType";
import type { GamemodeBridge, GamemodeDefinition, GamemodeInitContext, GamemodeServerServices, HandshakeBridge } from "../../src/game/gamemodes/GamemodeDefinition";
import { SHOP_INTERFACE_ID } from "./shops/shopConstants";
import { BankingManager, registerBankingHandlers } from "./banking";
import { registerBankInterfaceHooks } from "./banking";
import { registerEquipmentHandlers } from "./equipment/equipment";
import { registerEquipmentWidgetHandlers } from "./equipment/equipmentWidgets";
import { registerEquipmentStatsInterfaceHooks } from "./equipment/EquipmentStatsInterfaceHooks";
import { isPlayerOnDockedSailingBoat, restoreDockedSailingState, restoreSailingInstanceUi } from "./skills/sailing";
import { register as registerSkillHandlers } from "./skills";
import { ShopManager, type ShopStockEntry, type ShopOpenData } from "./shops";
import { registerShopInterfaceHooks } from "./shops";
import { registerShopInteractionHandlers } from "./shops/shopInteractions";
import { registerShopWidgetHandlers } from "./shops/shopWidgets";
import { registerZaffHandlers } from "./shops/zaff";
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
import { computeTargetBonusPercentages } from "./equipment/targetBonuses";
import { registerWidgetCloseHandlers } from "./modals/widgetCloseHandlers";
import { registerWidgetOpenHandlers } from "./modals/widgetOpenHandlers";
import { registerSmithingBarModalHandler } from "./modals/smithingBarModalHandler";
import type { NpcLootConfig } from "../../src/game/combat/DamageTracker";
import { DEFAULT_LOGIN_VARBITS } from "./data/loginVarbits";
import { DEFAULT_LOGIN_VARPS } from "./data/loginVarps";
import { NPC_LOOT_CONFIGS } from "./data/lootDistribution";
import { registerLevelUpHandlers, handleResumePauseButton, handleDismiss } from "./scripts/levelup";

const DEFAULT_SPAWN = { x: 3222, y: 3218, level: 0 };

export class VanillaGamemode implements GamemodeDefinition {
    readonly id = "vanilla";
    readonly name = "Vanilla";

    private bankingManager: BankingManager | undefined;
    private shopManager: ShopManager | undefined;
    private serverServices: GamemodeServerServices | undefined;
    private scriptServices: ScriptServices | undefined;

    getSkillXpMultiplier(_player: PlayerState): number {
        return 1;
    }

    getDropRateMultiplier(_player: PlayerState | undefined): number {
        return 1;
    }

    isDropBoostEligible(_entry: { dropBoostEligible?: boolean }): boolean {
        return false;
    }

    transformDropItemId(_npcTypeId: number, itemId: number, _player: PlayerState | undefined): number {
        return itemId;
    }

    getLootDistributionConfig(npcTypeId: number): NpcLootConfig | undefined {
        return NPC_LOOT_CONFIGS.get(npcTypeId);
    }

    hasInfiniteRunEnergy(_player: PlayerState): boolean {
        return false;
    }

    canInteract(_player: PlayerState): boolean {
        return true;
    }

    getLoginVarbits(_player: PlayerState): Array<[number, number]> {
        return DEFAULT_LOGIN_VARBITS;
    }

    getLoginVarps(_player: PlayerState): Array<[number, number]> {
        return DEFAULT_LOGIN_VARPS;
    }

    initializePlayer(_player: PlayerState): void {}

    serializePlayerState(_player: PlayerState): Record<string, unknown> | undefined {
        return undefined;
    }

    deserializePlayerState(_player: PlayerState, _data: Record<string, unknown>): void {}

    onNpcKill(_playerId: number, _npcTypeId: number): void {}

    isTutorialActive(_player: PlayerState): boolean {
        return false;
    }

    getSpawnLocation(_player: PlayerState): { x: number; y: number; level: number } {
        return DEFAULT_SPAWN;
    }

    onPlayerHandshake(_player: PlayerState, _bridge: HandshakeBridge): void {}

    onPlayerLogin(_player: PlayerState, _bridge: GamemodeBridge): void {}

    onPlayerRestore(player: PlayerState): void {
        const ss = this.serverServices;
        const services = this.scriptServices;
        if (!ss || !services) return;

        if (isPlayerOnDockedSailingBoat(player)) {
            restoreDockedSailingState(player, services);
        } else if (ss.isInSailingInstanceRegion?.(player)) {
            ss.initSailingInstance?.(player);
            restoreSailingInstanceUi(player, services);
        }
    }

    getDisplayName(_player: PlayerState, baseName: string, _isAdmin: boolean): string {
        return baseName;
    }

    getChatPlayerType(_player: PlayerState, _isAdmin: boolean): number {
        return 0;
    }

    getGamemodeServices(): Record<string, unknown> {
        const { getWeaponDataProvider } = require("../../src/game/combat/WeaponDataProvider") as typeof import("../../src/game/combat/WeaponDataProvider");
        return {
            banking: this.bankingManager,
            weaponDataProvider: getWeaponDataProvider(),
        };
    }

    contributeScriptServices(services: ScriptServices): void {
        this.scriptServices = services;

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
        const sm = this.shopManager;
        const ss = this.serverServices;
        if (sm && ss) {
            services.shopping = {
                openShop: (player, opts) => this.openShopInterface(player, opts),
                closeShop: (player) => this.closeShopInterface(player),
                buyFromShop: (player, params) => this.handleShopBuy(player, params),
                sellToShop: (player, params) => this.handleShopSell(player, params),
                setShopBuyMode: (player, mode) => this.updateShopMode(player, "buy", mode),
                setShopSellMode: (player, mode) => this.updateShopMode(player, "sell", mode),
                getShopSlotValue: (player, slotIndex) =>
                    sm.getShopSlotValue(player, slotIndex) ?? undefined,
                getInventoryItemSellValue: (player, itemId) =>
                    sm.getInventoryItemSellValue(player, itemId) ?? undefined,
            };
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

    registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
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

    initialize(context: GamemodeInitContext): void {
        const ss = context.serverServices;
        this.serverServices = ss;

        // === Spell XP Data ===
        const { SPELL_BASE_XP } = require("./combat/SpellXpData") as typeof import("./combat/SpellXpData");
        const { registerSpellXpProvider } = require("../../src/game/combat/SpellXpProvider") as typeof import("../../src/game/combat/SpellXpProvider");
        registerSpellXpProvider({ getSpellBaseXp: (spellId) => SPELL_BASE_XP[spellId] ?? 0 });

        // === Special Attack Visuals ===
        const { pickSpecialAttackVisualOverride } = require("./combat/SpecialAttackVisuals") as typeof import("./combat/SpecialAttackVisuals");
        const { registerSpecialAttackVisualProvider } = require("../../src/game/combat/SpecialAttackVisualProvider") as typeof import("../../src/game/combat/SpecialAttackVisualProvider");
        registerSpecialAttackVisualProvider({ pickSpecialAttackVisualOverride });

        // === Instant Utility Specials (Rock Knocker, Fishstabber, Lumber Up) ===
        const {
            getRockKnockerSpecialSequence,
            getFishstabberSpecialSequence,
            getLumberUpSpecialSequence,
            ROCK_KNOCKER_SOUND_ID,
            applyRockKnockerMiningBoost,
            applyFishstabberFishingBoost,
            applyLumberUpWoodcuttingBoost,
            markInstantUtilitySpecialHandledAtTick: markHandled,
            wasInstantUtilitySpecialHandledAtTick: wasHandled,
        } = require("./combat/RockKnockerSpecial") as typeof import("./combat/RockKnockerSpecial");
        const { registerInstantUtilitySpecialProvider } = require("../../src/game/combat/InstantUtilitySpecialProvider") as typeof import("../../src/game/combat/InstantUtilitySpecialProvider");
        registerInstantUtilitySpecialProvider({
            getInstantUtilitySpecial(weaponId) {
                const rkSeq = getRockKnockerSpecialSequence(weaponId);
                if (rkSeq !== undefined) return { kind: "rock_knocker", seqId: rkSeq, soundId: ROCK_KNOCKER_SOUND_ID };
                const fsSeq = getFishstabberSpecialSequence(weaponId);
                if (fsSeq !== undefined) return { kind: "fishstabber", seqId: fsSeq };
                const luSeq = getLumberUpSpecialSequence(weaponId);
                if (luSeq !== undefined) return { kind: "lumber_up", seqId: luSeq };
                return undefined;
            },
            applySpecialBoost(player, kind) {
                if (kind === "rock_knocker") applyRockKnockerMiningBoost(player);
                else if (kind === "fishstabber") applyFishstabberFishingBoost(player);
                else applyLumberUpWoodcuttingBoost(player);
            },
            markHandledAtTick: markHandled,
            wasHandledAtTick: wasHandled,
        });

        // === Boss Scripts ===
        require("./combat/BossCombatScript");

        // === Weapon Data ===
        const { createWeaponDataProvider } = require("./data/weapons") as typeof import("./data/weapons");
        const { registerWeaponDataProvider } = require("../../src/game/combat/WeaponDataProvider") as typeof import("../../src/game/combat/WeaponDataProvider");
        const weaponProvider = createWeaponDataProvider();
        registerWeaponDataProvider(weaponProvider);

        // === Special Attacks ===
        const { createSpecialAttackProvider } = require("./combat/SpecialAttackRegistry") as typeof import("./combat/SpecialAttackRegistry");
        const { registerSpecialAttackProvider } = require("../../src/game/combat/SpecialAttackProvider") as typeof import("../../src/game/combat/SpecialAttackProvider");
        const specialAttackProvider = createSpecialAttackProvider();
        registerSpecialAttackProvider(specialAttackProvider);

        // === Combat Formulas ===
        const { createCombatFormulaProvider } = require("./combat/CombatFormulas") as typeof import("./combat/CombatFormulas");
        const { registerCombatFormulaProvider } = require("../../src/game/combat/CombatFormulaProvider") as typeof import("../../src/game/combat/CombatFormulaProvider");
        const combatFormulaProvider = createCombatFormulaProvider();
        registerCombatFormulaProvider(combatFormulaProvider);

        // === Combat Style Sequences ===
        const { createCombatStyleSequenceProvider } = require("./combat/CombatStyleSequences") as typeof import("./combat/CombatStyleSequences");
        const { registerCombatStyleSequenceProvider } = require("../../src/game/combat/CombatStyleSequenceProvider") as typeof import("../../src/game/combat/CombatStyleSequenceProvider");
        const combatStyleSequenceProvider = createCombatStyleSequenceProvider();
        registerCombatStyleSequenceProvider(combatStyleSequenceProvider);

        // === Skill Configuration ===
        const { createSkillConfiguration } = require("./combat/SkillConfiguration") as typeof import("./combat/SkillConfiguration");
        const { registerSkillConfiguration } = require("../../src/game/combat/SkillConfigurationProvider") as typeof import("../../src/game/combat/SkillConfigurationProvider");
        const skillConfig = createSkillConfiguration();
        registerSkillConfiguration(skillConfig);

        // === Equipment Bonuses ===
        const { createEquipmentBonusProvider } = require("./combat/EquipmentBonuses") as typeof import("./combat/EquipmentBonuses");
        const { registerEquipmentBonusProvider } = require("../../src/game/combat/EquipmentBonusProvider") as typeof import("../../src/game/combat/EquipmentBonusProvider");
        const equipmentBonusProvider = createEquipmentBonusProvider();
        registerEquipmentBonusProvider(equipmentBonusProvider);

        // === Projectile Params ===
        const { createProjectileParamsProvider } = require("./data/projectileParams") as typeof import("./data/projectileParams");
        const { registerProjectileParamsProvider } = require("../../src/game/data/ProjectileParamsProvider") as typeof import("../../src/game/data/ProjectileParamsProvider");
        const projectileParamsProvider = createProjectileParamsProvider();
        registerProjectileParamsProvider(projectileParamsProvider);

        // === Spell Data ===
        const { createSpellDataProvider } = require("./data/spells") as typeof import("./data/spells");
        const { registerSpellDataProvider } = require("../../src/game/spells/SpellDataProvider") as typeof import("../../src/game/spells/SpellDataProvider");
        const spellDataProvider = createSpellDataProvider();
        registerSpellDataProvider(spellDataProvider);

        // === Rune Data ===
        const { createRuneDataProvider } = require("./data/runes") as typeof import("./data/runes");
        const { registerRuneDataProvider } = require("../../src/game/data/RuneDataProvider") as typeof import("../../src/game/data/RuneDataProvider");
        const runeDataProvider = createRuneDataProvider();
        registerRuneDataProvider(runeDataProvider);

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
            (_playerId, payload) => {
                const { encodeMessage } = require("../../src/network/messages");
                return {
                    message: encodeMessage({ type: "bank", payload }),
                    context: "bank_snapshot",
                };
            },
            (playerId, _payload) => {
                const player = ss.getPlayer(playerId);
                if (player) {
                    player.bank.setBankClientSlotMapping(bm.buildBankSlotMapping(player));
                }
            },
        );

        // === Shops ===
        const snapshotInventoryFn = (player: PlayerState) => {
            ss.sendInventorySnapshot(player.id);
        };
        this.shopManager = new ShopManager({
            logger: ss.logger,
            getObjType: (id) => ss.getObjType(id) as ObjType | undefined,
            addItemToInventory: (player, itemId, qty) =>
                ss.addItemToInventory(player, itemId, qty),
            snapshotInventory: snapshotInventoryFn,
            sendGameMessage: (player, text) =>
                ss.queueChatMessage({ messageType: "game", text, targetPlayerIds: [player.id] }),
        });

        ss.registerSnapshotEncoder("shop", (_playerId, payload) => {
            const { encodeMessage } = require("../../src/network/messages");
            return {
                message: encodeMessage({ type: "shop", payload }),
                context: "shop_event",
            };
        });

        // Shop restock tick callback
        const sm = this.shopManager;
        ss.registerTickCallback((tick) => {
            const updates = sm.tick(tick);
            for (const update of updates) {
                this.broadcastShopSlot(update.shopId, update.slot);
            }
        });

        // === Interface hooks ===
        const interfaceService = ss.getInterfaceService();
        if (interfaceService) {
            registerBankInterfaceHooks(interfaceService);
            registerEquipmentStatsInterfaceHooks(interfaceService);
            registerShopInterfaceHooks(interfaceService);
        }
    }

    // === Shop helpers (moved from wsServer) ===

    private openShopInterface(
        player: PlayerState,
        opts?: { npcTypeId?: number; shopId?: string },
    ): void {
        const sm = this.shopManager;
        const ss = this.serverServices;
        if (!sm || !ss) return;

        const interfaceService = ss.getInterfaceService();
        if (!interfaceService) return;

        let snapshot: ReturnType<ShopManager["openShopForNpc"]> | undefined;
        if (opts?.npcTypeId !== undefined) {
            snapshot = sm.openShopForNpc(player, opts.npcTypeId);
        } else if (opts?.shopId) {
            snapshot = sm.openShopById(player, opts.shopId);
        }

        if (!snapshot) {
            ss.queueChatMessage({
                messageType: "game",
                text: "Nothing interesting happens.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const shopData: ShopOpenData = {
            shopId: snapshot.shopId,
            name: snapshot.name,
            currencyItemId: snapshot.currencyItemId,
            generalStore: snapshot.generalStore,
            showBuy50: true,
            stock: snapshot.stock.map((entry) => ({
                itemId: entry.itemId,
                quantity: entry.quantity,
                baseStock: entry.defaultQuantity,
                basePrice: entry.priceEach,
            })),
        };

        interfaceService.openModal(player, SHOP_INTERFACE_ID, shopData);

        ss.queueGamemodeSnapshot("shop", player.id, {
            kind: "open",
            shopId: snapshot.shopId,
            name: snapshot.name,
            currencyItemId: snapshot.currencyItemId,
            generalStore: snapshot.generalStore,
            buyMode: player.bank.getShopBuyMode(),
            sellMode: player.bank.getShopSellMode(),
            stock: snapshot.stock.map((entry) => ({
                slot: entry.slot,
                itemId: entry.itemId,
                quantity: Math.max(0, entry.quantity),
                defaultQuantity: Math.max(0, entry.defaultQuantity),
                priceEach: entry.priceEach !== undefined ? Math.max(0, entry.priceEach) : undefined,
                sellPrice: entry.sellPrice !== undefined ? Math.max(0, entry.sellPrice) : undefined,
            })),
        });

        ss.queueChatMessage({
            messageType: "game",
            text: "You open the shop.",
            targetPlayerIds: [player.id],
        });
    }

    private closeShopInterface(player: PlayerState, opts: { silent?: boolean } = {}): void {
        const sm = this.shopManager;
        const ss = this.serverServices;
        if (!sm || !ss) return;

        const shop = sm.closeShopForPlayer(player);
        if (!shop) return;

        const interfaceService = ss.getInterfaceService();
        if (interfaceService) {
            interfaceService.closeModal(player, opts.silent);
        }

        ss.queueGamemodeSnapshot("shop", player.id, { kind: "close" });
    }

    private handleShopBuy(
        player: PlayerState,
        params: { slotIndex: number; quantity?: number } | undefined,
    ): void {
        const sm = this.shopManager;
        const ss = this.serverServices;
        if (!sm || !ss || !params || !Number.isFinite(params.slotIndex)) return;
        const result = sm.buyFromShop(
            player,
            params.slotIndex,
            params.quantity ?? 0,
            ss.getCurrentTick(),
        );
        if (!result?.shopId || !result.slot) return;
        this.broadcastShopSlot(result.shopId, result.slot);
    }

    private handleShopSell(
        player: PlayerState,
        params: { inventorySlot: number; itemId: number; quantity?: number } | undefined,
    ): void {
        const sm = this.shopManager;
        const ss = this.serverServices;
        if (
            !sm ||
            !ss ||
            !params ||
            !Number.isFinite(params.inventorySlot) ||
            !Number.isFinite(params.itemId)
        ) {
            return;
        }
        const result = sm.sellToShop(
            player,
            params.inventorySlot,
            params.quantity ?? 0,
            params.itemId,
            ss.getCurrentTick(),
        );
        if (!result?.shopId || !result.slot) return;
        this.broadcastShopSlot(result.shopId, result.slot);
    }

    private updateShopMode(player: PlayerState, kind: "buy" | "sell", mode: number): void {
        const sm = this.shopManager;
        const ss = this.serverServices;
        if (!sm || !ss) return;
        if (kind === "buy") {
            const result = sm.setBuyMode(player, mode);
            if (!result?.shopId) return;
            ss.queueGamemodeSnapshot("shop", player.id, {
                kind: "mode",
                shopId: result.shopId,
                buyMode: result.buyMode,
            });
        } else {
            const result = sm.setSellMode(player, mode);
            if (!result?.shopId) return;
            ss.queueGamemodeSnapshot("shop", player.id, {
                kind: "mode",
                shopId: result.shopId,
                sellMode: result.sellMode,
            });
        }
    }

    private broadcastShopSlot(shopId: string, entry: ShopStockEntry): void {
        const sm = this.shopManager;
        const ss = this.serverServices;
        if (!sm || !ss) return;
        const watchers = sm.getWatchers(shopId);
        if (!watchers.length) return;
        const slot = {
            slot: entry.slot,
            itemId: entry.itemId,
            quantity: Math.max(0, entry.quantity),
            defaultQuantity: Math.max(0, entry.defaultQuantity),
            priceEach: entry.priceEach !== undefined ? Math.max(0, entry.priceEach) : undefined,
            sellPrice: entry.sellPrice !== undefined ? Math.max(0, entry.sellPrice) : undefined,
        };
        for (const watcherId of watchers) {
            ss.queueGamemodeSnapshot("shop", watcherId, {
                kind: "slot",
                shopId,
                slot,
            });
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
}

export function createGamemode(): GamemodeDefinition {
    return new VanillaGamemode();
}

import path from "path";

import type { BankingProviderServices } from "./banking/BankingProvider";
import type { PlayerState } from "../../src/game/player";
import type { ScriptManifestEntry } from "../../src/game/scripts/manifest";
import type { ScriptModule, ScriptServices } from "../../src/game/scripts/types";
import type { GamemodeBridge, GamemodeDefinition, GamemodeInitContext, GamemodeServerServices, HandshakeBridge } from "../../src/game/gamemodes/GamemodeDefinition";
import { SHOP_INTERFACE_ID } from "../../src/widgets/InterfaceService";
import { BankingManager } from "./banking";
import { registerBankInterfaceHooks } from "./banking";
import { registerEquipmentStatsInterfaceHooks } from "./equipment/EquipmentStatsInterfaceHooks";
import { isPlayerOnDockedSailingBoat, restoreDockedSailingState, restoreSailingInstanceUi } from "../../extrascripts/vanilla-skills/sailing";
import { ShopManager, type ShopStockEntry, type ShopOpenData } from "./shops";
import { registerShopInterfaceHooks } from "./shops";

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

    hasInfiniteRunEnergy(_player: PlayerState): boolean {
        return false;
    }

    canInteract(_player: PlayerState): boolean {
        return true;
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
        return {
            banking: this.bankingManager,
        };
    }

    contributeScriptServices(services: ScriptServices): void {
        this.scriptServices = services;

        // Banking services
        const bm = this.bankingManager;
        if (bm) {
            services.openBank = (player, opts) => bm.openBank(player, opts);
            services.depositInventoryToBank = (player, tab) => bm.depositInventory(player, tab);
            services.depositEquipmentToBank = (player, tab) => bm.depositEquipment(player, tab);
            services.depositInventoryItemToBank = (player, slot, quantity, opts) => {
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
            };
            services.withdrawFromBankSlot = (player, slot, quantity, opts) =>
                bm.withdraw(player, slot, quantity, { overrideNoted: opts?.noted });
            services.getBankEntryAtClientSlot = (player, clientSlot) =>
                bm.getBankEntryAtClientSlot(player, clientSlot);
            services.queueBankSnapshot = (player) => bm.queueBankSnapshot(player);
            services.sendBankTabVarbits = (player) => bm.sendBankTabVarbits(player);
            services.addItemToBank = (player, itemId, qty) => bm.addItemToBank(player, itemId, qty);
        }

        // Shop services
        const sm = this.shopManager;
        const ss = this.serverServices;
        if (sm && ss) {
            services.openShop = (player, opts) => this.openShopInterface(player, opts);
            services.closeShop = (player) => this.closeShopInterface(player);
            services.buyFromShop = (player, params) => this.handleShopBuy(player, params);
            services.sellToShop = (player, params) => this.handleShopSell(player, params);
            services.setShopBuyMode = (player, mode) => this.updateShopMode(player, "buy", mode);
            services.setShopSellMode = (player, mode) => this.updateShopMode(player, "sell", mode);
            services.getShopSlotValue = (player, slotIndex) =>
                sm.getShopSlotValue(player, slotIndex) ?? undefined;
            services.getInventoryItemSellValue = (player, itemId) =>
                sm.getInventoryItemSellValue(player, itemId) ?? undefined;
        }
    }

    getScriptManifest(): ScriptManifestEntry[] {
        const loadModuleFrom = (dir: string, relativePath: string, exportName: string): (() => ScriptModule) => {
            const resolved = path.resolve(dir, relativePath);
            return () => {
                const mod = require(resolved);
                return mod[exportName] as ScriptModule;
            };
        };

        const BANKING_DIR = path.resolve(__dirname, "banking");
        const EQUIPMENT_DIR = path.resolve(__dirname, "equipment");
        const SHOPS_DIR = path.resolve(__dirname, "shops");

        return [
            {
                id: "vanilla.banking",
                load: loadModuleFrom(BANKING_DIR, "index", "bankingModule"),
                watch: [
                    path.resolve(BANKING_DIR, "index.ts"),
                    path.resolve(BANKING_DIR, "bankWidgets.ts"),
                    path.resolve(BANKING_DIR, "BankInterfaceHooks.ts"),
                    path.resolve(BANKING_DIR, "BankingManager.ts"),
                    path.resolve(BANKING_DIR, "bankConstants.ts"),
                ],
            },
            {
                id: "vanilla.equipment",
                load: loadModuleFrom(EQUIPMENT_DIR, "equipment", "equipmentActionsModule"),
                watch: [path.resolve(EQUIPMENT_DIR, "equipment.ts")],
            },
            {
                id: "vanilla.equipment-widgets",
                load: loadModuleFrom(EQUIPMENT_DIR, "equipmentWidgets", "equipmentWidgetModule"),
                watch: [path.resolve(EQUIPMENT_DIR, "equipmentWidgets.ts")],
            },
            {
                id: "vanilla.shops",
                load: loadModuleFrom(SHOPS_DIR, "shopInteractions", "shopInteractionsModule"),
                watch: [path.resolve(SHOPS_DIR, "shopInteractions.ts")],
            },
            {
                id: "vanilla.shop-widgets",
                load: loadModuleFrom(SHOPS_DIR, "shopWidgets", "shopWidgetActionsModule"),
                watch: [path.resolve(SHOPS_DIR, "shopWidgets.ts")],
            },
            {
                id: "vanilla.zaff",
                load: loadModuleFrom(SHOPS_DIR, "zaff", "zaffModule"),
                watch: [path.resolve(SHOPS_DIR, "zaff.ts")],
            },
        ];
    }

    initialize(context: GamemodeInitContext): void {
        const ss = context.serverServices;
        this.serverServices = ss;

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
                const { encodeMessage } = require("../../../src/network/messages");
                return {
                    message: encodeMessage({ type: "bank", payload }),
                    context: "bank_snapshot",
                };
            },
            (playerId, _payload) => {
                const player = ss.getPlayer(playerId);
                if (player) {
                    player.setBankClientSlotMapping(bm.buildBankSlotMapping(player));
                }
            },
        );

        // === Shops ===
        const snapshotInventoryFn = (player: PlayerState) => {
            ss.sendInventorySnapshot(player.id);
        };
        this.shopManager = new ShopManager({
            logger: ss.logger,
            getObjType: (id) => ss.getObjType(id) as any,
            addItemToInventory: (player, itemId, qty) =>
                ss.addItemToInventory(player, itemId, qty),
            snapshotInventory: snapshotInventoryFn,
            sendGameMessage: (player, text) =>
                ss.queueChatMessage({ messageType: "game", text, targetPlayerIds: [player.id] }),
        });

        ss.registerSnapshotEncoder("shop", (_playerId, payload) => {
            const { encodeMessage } = require("../../../src/network/messages");
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
            buyMode: player.getShopBuyMode(),
            sellMode: player.getShopSellMode(),
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
}

export function createGamemode(): GamemodeDefinition {
    return new VanillaGamemode();
}

import type { PlayerState } from "../../../src/game/player";
import type { GamemodeServerServices } from "../../../src/game/gamemodes/GamemodeDefinition";
import type { ObjType } from "../../../../src/rs/config/objtype/ObjType";
import type { ShoppingServices } from "../../../src/game/scripts/types";
import type { ShopStockEntry } from "./ShopManager";
import type { ShopOpenData } from "./ShopInterfaceHooks";

import { ShopManager } from "./ShopManager";
import { SHOP_INTERFACE_ID } from "./shopConstants";
import { encodeMessage } from "../../../src/network/messages";

export interface ShopServiceOptions {
    serverServices: GamemodeServerServices;
}

/**
 * Integrates {@link ShopManager} with server services (modals, snapshots, chat).
 *
 * Extracted from VanillaGamemode so the gamemode only needs to instantiate
 * and wire this service rather than implementing shop orchestration inline.
 */
export class ShopService {
    readonly manager: ShopManager;
    private readonly ss: GamemodeServerServices;

    constructor(opts: ShopServiceOptions) {
        this.ss = opts.serverServices;

        const snapshotInventoryFn = (player: PlayerState) => {
            this.ss.sendInventorySnapshot(player.id);
        };

        this.manager = new ShopManager({
            logger: this.ss.logger,
            getObjType: (id) => this.ss.getObjType(id) as ObjType | undefined,
            addItemToInventory: (player, itemId, qty) =>
                this.ss.addItemToInventory(player, itemId, qty),
            snapshotInventory: snapshotInventoryFn,
            sendGameMessage: (player, text) =>
                this.ss.queueChatMessage({ messageType: "game", text, targetPlayerIds: [player.id] }),
        });

        this.ss.registerSnapshotEncoder("shop", (_playerId, payload) => ({
            message: encodeMessage({ type: "shop", payload }),
            context: "shop_event",
        }));

        this.ss.registerTickCallback((tick) => {
            const updates = this.manager.tick(tick);
            for (const update of updates) {
                this.broadcastSlot(update.shopId, update.slot);
            }
        });
    }

    openShop(
        player: PlayerState,
        opts?: { npcTypeId?: number; shopId?: string },
    ): void {
        const sm = this.manager;
        const interfaceService = this.ss.getInterfaceService();
        if (!interfaceService) return;

        let snapshot: ReturnType<ShopManager["openShopForNpc"]> | undefined;
        if (opts?.npcTypeId !== undefined) {
            snapshot = sm.openShopForNpc(player, opts.npcTypeId);
        } else if (opts?.shopId) {
            snapshot = sm.openShopById(player, opts.shopId);
        }

        if (!snapshot) {
            this.ss.queueChatMessage({
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

        this.ss.queueGamemodeSnapshot("shop", player.id, {
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

        this.ss.queueChatMessage({
            messageType: "game",
            text: "You open the shop.",
            targetPlayerIds: [player.id],
        });
    }

    closeShop(player: PlayerState, opts: { silent?: boolean } = {}): void {
        const shop = this.manager.closeShopForPlayer(player);
        if (!shop) return;

        const interfaceService = this.ss.getInterfaceService();
        if (interfaceService) {
            interfaceService.closeModal(player, opts.silent);
        }

        this.ss.queueGamemodeSnapshot("shop", player.id, { kind: "close" });
    }

    buyFromShop(
        player: PlayerState,
        params: { slotIndex: number; quantity?: number } | undefined,
    ): void {
        if (!params || !Number.isFinite(params.slotIndex)) return;

        const result = this.manager.buyFromShop(
            player,
            params.slotIndex,
            params.quantity ?? 0,
            this.ss.getCurrentTick(),
        );
        if (!result?.shopId || !result.slot) return;
        this.broadcastSlot(result.shopId, result.slot);
    }

    sellToShop(
        player: PlayerState,
        params: { inventorySlot: number; itemId: number; quantity?: number } | undefined,
    ): void {
        if (
            !params ||
            !Number.isFinite(params.inventorySlot) ||
            !Number.isFinite(params.itemId)
        ) {
            return;
        }

        const result = this.manager.sellToShop(
            player,
            params.inventorySlot,
            params.quantity ?? 0,
            params.itemId,
            this.ss.getCurrentTick(),
        );
        if (!result?.shopId || !result.slot) return;
        this.broadcastSlot(result.shopId, result.slot);
    }

    setMode(player: PlayerState, kind: "buy" | "sell", mode: number): void {
        if (kind === "buy") {
            const result = this.manager.setBuyMode(player, mode);
            if (!result?.shopId) return;
            this.ss.queueGamemodeSnapshot("shop", player.id, {
                kind: "mode",
                shopId: result.shopId,
                buyMode: result.buyMode,
            });
        } else {
            const result = this.manager.setSellMode(player, mode);
            if (!result?.shopId) return;
            this.ss.queueGamemodeSnapshot("shop", player.id, {
                kind: "mode",
                shopId: result.shopId,
                sellMode: result.sellMode,
            });
        }
    }

    createScriptServices(): ShoppingServices {
        return {
            openShop: (player, opts) => this.openShop(player, opts),
            closeShop: (player) => this.closeShop(player),
            buyFromShop: (player, params) => this.buyFromShop(player, params),
            sellToShop: (player, params) => this.sellToShop(player, params),
            setShopBuyMode: (player, mode) => this.setMode(player, "buy", mode),
            setShopSellMode: (player, mode) => this.setMode(player, "sell", mode),
            getShopSlotValue: (player, slotIndex) =>
                this.manager.getShopSlotValue(player, slotIndex) ?? undefined,
            getInventoryItemSellValue: (player, itemId) =>
                this.manager.getInventoryItemSellValue(player, itemId) ?? undefined,
        };
    }

    private broadcastSlot(shopId: string, entry: ShopStockEntry): void {
        const watchers = this.manager.getWatchers(shopId);
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
            this.ss.queueGamemodeSnapshot("shop", watcherId, {
                kind: "slot",
                shopId,
                slot,
            });
        }
    }
}

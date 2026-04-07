/**
 * GroundItemHandler - Handles ground item operations.
 *
 * Extracted from wsServer.ts for better organization and testability.
 * Uses a service interface pattern to avoid circular dependencies.
 */
import type { WebSocket } from "ws";
import { logger } from "../../utils/logger";
import type { ServerServices } from "../../game/ServerServices";
import type { PlayerState } from "../../game/player";
import { encodeMessage } from "../messages";
import { isInWilderness } from "../../game/combat/MultiCombatZones";
import { getItemDefinition } from "../../data/items";

/** Pickup radius in tiles */
const GROUND_ITEM_PICKUP_RADIUS_TILES = 2;

/** Stream radius for ground items */
const GROUND_ITEM_STREAM_RADIUS_TILES = 20;
const TILE_ITEM_OWNERSHIP_NONE = 0;
const TILE_ITEM_OWNERSHIP_SELF = 1;
const TILE_ITEM_OWNERSHIP_OTHER = 2;

/** Ground item action payload from client */
export interface GroundItemActionPayload {
    option?: string;
    opNum?: number;
    itemId?: number;
    stackId?: number;
    modifierFlags?: number;
    tile?: { x?: number; y?: number; level?: number };
}

/** Ground items server payload */
type GroundItemStackPayload = {
    id: number;
    itemId: number;
    quantity: number;
    tile: { x: number; y: number; level: number };
    createdTick?: number;
    privateUntilTick?: number;
    expiresTick?: number;
    ownerId?: number;
    isPrivate?: boolean;
    ownership?: 0 | 1 | 2 | 3;
};

export type GroundItemsServerPayload =
    | {
          kind: "snapshot";
          serial: number;
          stacks: GroundItemStackPayload[];
      }
    | {
          kind: "delta";
          serial: number;
          upserts: GroundItemStackPayload[];
          removes: number[];
      };


/** Debug configuration */
interface DebugConfig {
    logTile: { x: number; y: number; level: number };
    logItemId: number;
    logStackQty: number;
}

/**
 * Handler for ground item operations.
 */
export class GroundItemHandler {
    private readonly lastVisibleStacksByPlayer = new Map<
        number,
        Map<number, GroundItemStackPayload>
    >();

    constructor(private readonly svc: ServerServices) {}

    static getGroundChunkKey(player: PlayerState): number {
        const mapX = player.tileX >> 6;
        const mapY = player.tileY >> 6;
        return (mapX << 16) | (mapY & 0xffff);
    }

    clearPlayerState(playerIdRaw: number): void {
        const playerId = playerIdRaw;
        if (playerId < 0) return;
        this.lastVisibleStacksByPlayer.delete(playerId);
        this.svc.playerGroundSerial.delete(playerId);
        this.svc.playerGroundChunk.delete(playerId);
    }

    private toPayloadStack(
        stack: {
            id: number;
            itemId: number;
            quantity: number;
            tile: { x: number; y: number; level: number };
            createdTick?: number;
            privateUntilTick?: number;
            expiresTick?: number;
            ownerId?: number;
        },
        currentTick: number,
        playerId: number,
    ): GroundItemStackPayload {
        return {
            id: stack.id,
            itemId: stack.itemId,
            quantity: Math.max(1, stack.quantity),
            tile: {
                x: stack.tile.x,
                y: stack.tile.y,
                level: stack.tile.level,
            },
            createdTick: Number.isFinite(stack.createdTick) ? (stack.createdTick as number) : 0,
            privateUntilTick:
                stack.privateUntilTick && stack.privateUntilTick > 0
                    ? stack.privateUntilTick
                    : undefined,
            expiresTick: stack.expiresTick && stack.expiresTick > 0 ? stack.expiresTick : undefined,
            ownerId:
                stack.ownerId !== undefined && Number.isFinite(stack.ownerId)
                    ? (stack.ownerId as number)
                    : undefined,
            isPrivate:
                !!stack.privateUntilTick &&
                stack.privateUntilTick > currentTick &&
                stack.ownerId !== undefined &&
                stack.ownerId === playerId,
            ownership:
                stack.ownerId === undefined
                    ? TILE_ITEM_OWNERSHIP_NONE
                    : stack.ownerId === playerId
                    ? TILE_ITEM_OWNERSHIP_SELF
                    : TILE_ITEM_OWNERSHIP_OTHER,
        };
    }

    private stackEquals(a: GroundItemStackPayload, b: GroundItemStackPayload): boolean {
        return (
            a.id === b.id &&
            a.itemId === b.itemId &&
            a.quantity === b.quantity &&
            a.tile.x === b.tile.x &&
            a.tile.y === b.tile.y &&
            a.tile.level === b.tile.level &&
            (a.createdTick ?? -1) === (b.createdTick ?? -1) &&
            (a.privateUntilTick ?? 0) === (b.privateUntilTick ?? 0) &&
            (a.expiresTick ?? 0) === (b.expiresTick ?? 0) &&
            (a.ownerId ?? -1) === (b.ownerId ?? -1) &&
            (a.isPrivate === true) === (b.isPrivate === true) &&
            (a.ownership ?? 0) === (b.ownership ?? 0)
        );
    }

    private getInventoryInsertCapacity(player: PlayerState, itemId: number): number {
        const inventory = player.getInventoryEntries();
        const itemDef = this.svc.dataLoaderService.getObjType(itemId) as any ?? getItemDefinition(itemId);
        const stackable = itemDef?.stackable === true;

        if (stackable) {
            for (const entry of inventory) {
                const entryItemId = entry.itemId;
                const quantity = entry.quantity;
                if (entryItemId === itemId && quantity > 0) {
                    if (!Number.isFinite(quantity)) return 0;
                    return Math.max(0, Number.MAX_SAFE_INTEGER - Math.max(0, quantity));
                }
            }
            const hasEmptySlot = inventory.some(
                (entry) => entry.itemId <= 0 || entry.quantity <= 0,
            );
            return hasEmptySlot ? Number.MAX_SAFE_INTEGER : 0;
        }

        let freeSlots = 0;
        for (const entry of inventory) {
            if (entry.itemId <= 0 || entry.quantity <= 0) {
                freeSlots++;
            }
        }
        return freeSlots;
    }
    /**
     * Maybe send ground item snapshot to player if changed.
     */
    maybeSendGroundItemSnapshot(ws: WebSocket, player: PlayerState): void {
        if (!ws || ws.readyState !== 1) return; // WebSocket.OPEN = 1

        const playerId = player.id;
        const groundItems = this.svc.groundItems;
        const currentSerial = groundItems.getSerial();
        const currentTick = this.svc.ticker.currentTick();
        const playerGroundSerial = this.svc.playerGroundSerial;
        const playerGroundChunk = this.svc.playerGroundChunk;

        const lastSerial = playerGroundSerial.get(playerId);
        // Include worldViewId in chunk key so switching views forces a snapshot
        const baseChunkKey = GroundItemHandler.getGroundChunkKey(player);
        const chunkKey = baseChunkKey ^ ((player.worldViewId & 0xffff) << 16);
        const lastChunk = playerGroundChunk.get(playerId);

        if (lastSerial === currentSerial && lastChunk === chunkKey) return;

        const stacks = groundItems
            .queryArea(
                player.tileX,
                player.tileY,
                player.level,
                GROUND_ITEM_STREAM_RADIUS_TILES,
                currentTick,
                player.id,
                player.worldViewId,
            )
            .map((stack) => this.toPayloadStack(stack, currentTick, playerId));

        const currentById = new Map<number, GroundItemStackPayload>();
        for (const stack of stacks) {
            currentById.set(stack.id, stack);
        }

        const previousById = this.lastVisibleStacksByPlayer.get(playerId);
        const shouldSendSnapshot =
            lastSerial === undefined || lastChunk !== chunkKey || previousById === undefined;

        if (shouldSendSnapshot) {
            const payload: GroundItemsServerPayload = {
                kind: "snapshot",
                serial: currentSerial,
                stacks,
            };
            this.svc.networkLayer.sendWithGuard(
                ws,
                encodeMessage({ type: "ground_items", payload }),
                "ground_items",
            );
        } else {
            const upserts: GroundItemStackPayload[] = [];
            const removes: number[] = [];

            for (const [stackId, stack] of currentById.entries()) {
                const prev = previousById.get(stackId);
                if (!prev || !this.stackEquals(prev, stack)) {
                    upserts.push(stack);
                }
            }
            for (const stackId of previousById.keys()) {
                if (!currentById.has(stackId)) {
                    removes.push(stackId);
                }
            }

            if (upserts.length > 0 || removes.length > 0) {
                const payload: GroundItemsServerPayload = {
                    kind: "delta",
                    serial: currentSerial,
                    upserts,
                    removes,
                };
                this.svc.networkLayer.sendWithGuard(
                    ws,
                    encodeMessage({ type: "ground_items", payload }),
                    "ground_items",
                );
            }
        }

        playerGroundSerial.set(playerId, currentSerial);
        playerGroundChunk.set(playerId, chunkKey);
        this.lastVisibleStacksByPlayer.set(playerId, currentById);
    }

    /**
     * Spawn debug ground item stack.
     */
    spawnDebugGroundItemStack(config: DebugConfig): void {
        const groundItems = this.svc.groundItems;
        if (!groundItems) return;

        try {
            const nowTick = this.svc.ticker.currentTick();
            const tile = config.logTile;
            const stack = groundItems.spawn(config.logItemId, config.logStackQty, tile, nowTick, {
                durationTicks: 0,
                privateTicks: 0,
            });
            if (stack) {
                logger.info(
                    `[ground] spawned debug log stack item=${stack.itemId} qty=${stack.quantity} tile=(${tile.x},${tile.y},${tile.level})`,
                );
            }
        } catch (err) {
            logger.warn("[ground] failed to spawn debug log stack");
        }
    }

    /**
     * Handle ground item action from client.
     */
    handleGroundItemAction(ws: WebSocket, payload: GroundItemActionPayload | undefined): void {
        if (!payload) return;

        const players = this.svc.players!;
        const player = players.get(ws);
        if (!player) return;

        const itemId = payload.itemId ?? -1;
        if (!(itemId > 0)) return;
        const tileX = payload.tile?.x;
        const tileY = payload.tile?.y;
        if (tileX === undefined || tileY === undefined) return;

        const tile = {
            x: tileX,
            y: tileY,
            level:
                payload.tile?.level !== undefined
                    ? Math.max(0, Math.min(3, payload.tile.level))
                    : player.level,
        };

        const opNum = payload.opNum ?? -1;
        const itemDef = (this.svc.dataLoaderService.getObjType(itemId) as any) ?? getItemDefinition(itemId);
        let option = payload.option?.trim().toLowerCase() ?? "";
        if (!option && opNum > 0) {
            const idx = opNum - 1;
            const raw =
                idx >= 0 && idx <= 4 && Array.isArray(itemDef?.groundActions)
                    ? itemDef.groundActions[idx]
                    : undefined;
            const normalizedRaw = raw?.trim();
            if (normalizedRaw) {
                option = normalizedRaw.toLowerCase();
            } else if (opNum === 3) {
                // OSRS default fallback: slot 3 is "Take" when no explicit action exists.
                option = "take";
            }
        }
        if (!option) option = "take";

        if (option === "examine") {
            if (itemDef?.examine) {
                this.svc.messagingService.queueChatMessage({
                    messageType: "game",
                    text: itemDef.examine,
                    targetPlayerIds: [player.id],
                });
            }
            return;
        }

        let stackId = payload.stackId ?? -1;
        if (!(stackId > 0)) {
            const visibleStacks = this.svc
                .groundItems
                .queryArea(
                    tile.x,
                    tile.y,
                    tile.level,
                    0,
                    this.svc.ticker.currentTick(),
                    player.id,
                    player.worldViewId,
                );
            const matchingStack = visibleStacks.find((stack) => stack.itemId === itemId);
            if (matchingStack) {
                stackId = matchingStack.id;
            }
        }
        if (!(stackId > 0)) return;

        if (option === "take" || option === "pick-up" || option === "pickup") {
            players.startGroundItemInteraction(ws, {
                itemId,
                stackId,
                tileX: tile.x,
                tileY: tile.y,
                tileLevel: tile.level,
                option,
                modifierFlags: payload.modifierFlags,
            });
            return;
        }
    }

    /**
     * Attempt to take a ground item.
     */
    attemptTakeGroundItem(
        player: PlayerState,
        tile: { x: number; y: number; level: number },
        itemId: number,
        stackId: number,
        requestedQuantity?: number,
    ): void {
        if (player.level !== tile.level) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "You can't reach that.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const dx = Math.abs(player.tileX - tile.x);
        const dy = Math.abs(player.tileY - tile.y);

        if (Math.max(dx, dy) > GROUND_ITEM_PICKUP_RADIUS_TILES) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "You are too far away to pick that up.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const qty = requestedQuantity !== undefined ? Math.max(1, requestedQuantity) : 2147483647;

        const nowTick = this.svc.ticker.currentTick();
        const groundItems = this.svc.groundItems;
        const targetStack = groundItems
            .queryArea(tile.x, tile.y, tile.level, 0, nowTick, player.id, player.worldViewId)
            .find((stack) => stack.id === stackId && stack.itemId === itemId);

        if (!targetStack) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "There is nothing interesting there.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const inventoryCapacity = this.getInventoryInsertCapacity(player, itemId);
        if (inventoryCapacity <= 0) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "Your inventory is too full to pick that up.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const quantityToTake = Math.max(
            0,
            Math.min(qty, Math.max(0, targetStack.quantity), inventoryCapacity),
        );
        if (quantityToTake <= 0) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "Your inventory is too full to pick that up.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const removed = groundItems.removeById(stackId, quantityToTake, nowTick, player.id);

        if (!removed) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "There is nothing interesting there.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const addResult = this.svc.inventoryService.addItemToInventory(player, itemId, removed.removed);
        const added = Math.max(0, addResult.added);

        if (added <= 0) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "Your inventory is too full to pick that up.",
                targetPlayerIds: [player.id],
            });

            // Respawn item - immediately visible in wilderness
            const inWilderness = isInWilderness(tile.x, tile.y);
            groundItems.spawn(itemId, removed.removed, tile, nowTick, {
                privateTicks: inWilderness ? 0 : undefined,
            }, player.worldViewId);
            return;
        }

        this.svc.networkLayer.withDirectSendBypass("pickup_sound", () =>
            this.svc.soundService.sendSound(player, 2582),
        );

        // Track for collection log (sends "new item" notification only for new collection log items)
        this.svc.collectionLogService.trackCollectionLogItem(player, itemId);

        // Force ground item update for this player
        this.svc.playerGroundSerial.delete(player.id);

        try {
            logger.info(
                `[ground] pickup player=${player.id} item=${itemId} qty=${added} tile=(${tile.x},${tile.y},${tile.level})`,
            );
        } catch (err) { logger.warn("[ground-item] failed to log pickup debug", err); }
    }
}

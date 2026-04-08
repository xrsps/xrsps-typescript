import type { WebSocket } from "ws";

import {
    COLLECTION_LOG_GROUP_ID,
    COLLECTION_OVERVIEW_GROUP_ID,
    type CollectionLogServices,
    buildCollectionOverviewOpenState,
    populateCollectionLogCategories,
    syncCollectionDisplayVarps,
    trackCollectionLogItem,
} from "../collectionlog";
import { encodeMessage } from "../../network/messages";
import type { PlayerState } from "../player";
import type { WidgetAction } from "../../widgets/WidgetManager";
import { getMainmodalUid } from "../../widgets/viewport";
import { logger } from "../../utils/logger";
import type { ServerServices } from "../ServerServices";

/**
 * Manages collection log snapshots, opening, category population, and item tracking.
 * Extracted from WSServer.
 */
export class CollectionLogService {
    constructor(private readonly services: ServerServices) {}

    sendCollectionLogSnapshot(player: PlayerState): void {
        const ws = this.services.players?.getSocketByPlayerId(player.id);
        if (!ws) return;

        const items = player.collectionLog.getObtainedItems();
        const slots = items.map((item: { itemId: number; quantity: number }, idx: number) => ({
            slot: idx,
            itemId: item.itemId,
            quantity: item.quantity,
        }));

        this.services.networkLayer.withDirectSendBypass("collection_log_snapshot", () =>
            this.services.networkLayer.sendWithGuard(
                ws,
                encodeMessage({
                    type: "collection_log",
                    payload: { kind: "snapshot", slots },
                } as Parameters<typeof encodeMessage>[0]),
                "collection_log_snapshot",
            ),
        );
    }

    getCollectionLogServices(): CollectionLogServices {
        return {
            queueVarp: (playerId: number, varpId: number, value: number) =>
                this.services.variableService.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId: number, varbitId: number, value: number) =>
                this.services.variableService.queueVarbit(playerId, varbitId, value),
            queueWidgetEvent: (playerId: number, event: WidgetAction) =>
                this.services.queueWidgetEvent(playerId, event),
            queueNotification: (playerId: number, payload: Record<string, unknown>) =>
                this.services.messagingService.queueNotification(playerId, payload),
            queueChatMessage: (request: { messageType: string; text: string; targetPlayerIds: number[] }) => this.services.messagingService.queueChatMessage(request),
            sendCollectionLogSnapshot: (player: PlayerState) =>
                this.sendCollectionLogSnapshot(player),
            getMainmodalUid,
            logger,
        };
    }

    openCollectionLog(player: PlayerState): void {
        const hookData = {
            sendCollectionLogSnapshot: (p: PlayerState) => this.sendCollectionLogSnapshot(p),
            queueVarp: (playerId: number, varpId: number, value: number) =>
                this.services.variableService.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId: number, varbitId: number, value: number) =>
                this.services.variableService.queueVarbit(playerId, varbitId, value),
            queueWidgetEvent: (playerId: number, event: WidgetAction) =>
                this.services.queueWidgetEvent(playerId, event),
            logger,
        };
        this.services.interfaceService?.openModal(player, COLLECTION_LOG_GROUP_ID, hookData);
    }

    openCollectionOverview(player: PlayerState): void {
        const openState = buildCollectionOverviewOpenState(player);
        this.services.interfaceService?.openModal(
            player,
            COLLECTION_OVERVIEW_GROUP_ID,
            undefined,
            {
                varps: openState.varps,
                varbits: openState.varbits,
            },
        );
    }

    populateCollectionLogCategories(player: PlayerState, tabIndex: number): void {
        populateCollectionLogCategories(player, tabIndex, this.getCollectionLogServices());
    }

    trackCollectionLogItem(player: PlayerState, itemId: number): void {
        trackCollectionLogItem(player, itemId, this.getCollectionLogServices());
    }

    /**
     * Send collection-log display varps on login/reconnect so summary/account UIs have the same
     * state they would get after opening the collection log itself.
     */
    sendCollectionLogDisplayVarps(sock: WebSocket, player: PlayerState): void {
        const displayVarps = syncCollectionDisplayVarps(player);
        for (const [varpIdRaw, valueRaw] of Object.entries(displayVarps)) {
            this.services.networkLayer.withDirectSendBypass("varp", () =>
                this.services.networkLayer.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: {
                            varpId: Number(varpIdRaw),
                            value: valueRaw | 0,
                        },
                    }),
                    "varp",
                ),
            );
        }
    }
}

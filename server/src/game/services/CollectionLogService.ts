import type { WebSocket } from "ws";

import {
    COLLECTION_LOG_GROUP_ID,
    COLLECTION_OVERVIEW_GROUP_ID,
    type CollectionLogServices,
    buildCollectionOverviewOpenState,
    populateCollectionLogCategories,
    trackCollectionLogItem,
} from "../collectionlog";
import { encodeMessage } from "../../network/messages";
import type { PlayerNetworkLayer } from "../../network/PlayerNetworkLayer";
import type { InterfaceService } from "../../widgets/InterfaceService";
import type { PlayerState } from "../player";
import { logger } from "../../utils/logger";

export interface CollectionLogServiceDeps {
    getSocketByPlayerId: (id: number) => WebSocket | undefined;
    networkLayer: PlayerNetworkLayer;
    interfaceService: InterfaceService | undefined;
    queueVarp: (playerId: number, varpId: number, value: number) => void;
    queueVarbit: (playerId: number, varbitId: number, value: number) => void;
    queueWidgetEvent: (playerId: number, event: any) => void;
    queueNotification: (playerId: number, payload: any) => void;
    queueChatMessage: (request: any) => void;
}

/**
 * Manages collection log snapshots, opening, category population, and item tracking.
 * Extracted from WSServer.
 */
export class CollectionLogService {
    constructor(private readonly deps: CollectionLogServiceDeps) {}

    setDeferredDeps(deferred: { interfaceService?: InterfaceService }): void {
        Object.assign(this.deps, deferred);
    }

    sendCollectionLogSnapshot(player: PlayerState): void {
        const ws = this.deps.getSocketByPlayerId(player.id);
        if (!ws) return;

        const items = player.getCollectionObtainedItems();
        const slots = items.map((item: any, idx: number) => ({
            slot: idx,
            itemId: item.itemId,
            quantity: item.quantity,
        }));

        this.deps.networkLayer.withDirectSendBypass("collection_log_snapshot", () =>
            this.deps.networkLayer.sendWithGuard(
                ws,
                encodeMessage({
                    type: "collection_log",
                    payload: { kind: "snapshot", slots },
                } as any),
                "collection_log_snapshot",
            ),
        );
    }

    getCollectionLogServices(): CollectionLogServices {
        const { getMainmodalUid } = require("../../widgets/viewport");
        return {
            queueVarp: (playerId: number, varpId: number, value: number) =>
                this.deps.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId: number, varbitId: number, value: number) =>
                this.deps.queueVarbit(playerId, varbitId, value),
            queueWidgetEvent: (playerId: number, event: any) =>
                this.deps.queueWidgetEvent(playerId, event),
            queueNotification: (playerId: number, payload: any) =>
                this.deps.queueNotification(playerId, payload),
            queueChatMessage: (request: any) => this.deps.queueChatMessage(request),
            sendCollectionLogSnapshot: (player: any) =>
                this.sendCollectionLogSnapshot(player as PlayerState),
            getMainmodalUid,
            logger,
        };
    }

    openCollectionLog(player: PlayerState): void {
        const hookData = {
            sendCollectionLogSnapshot: (p: any) => this.sendCollectionLogSnapshot(p),
            queueVarp: (playerId: number, varpId: number, value: number) =>
                this.deps.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId: number, varbitId: number, value: number) =>
                this.deps.queueVarbit(playerId, varbitId, value),
            queueWidgetEvent: (playerId: number, event: any) =>
                this.deps.queueWidgetEvent(playerId, event),
            logger,
        };
        this.deps.interfaceService?.openModal(player, COLLECTION_LOG_GROUP_ID, hookData);
    }

    openCollectionOverview(player: PlayerState): void {
        const openState = buildCollectionOverviewOpenState(player);
        this.deps.interfaceService?.openModal(
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
}

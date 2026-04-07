import type { WebSocket } from "ws";

import type { GamemodeServerServices } from "../gamemodes/GamemodeDefinition";
import type { GameEventBus } from "../events/GameEventBus";
import type { DataLoaderService } from "./DataLoaderService";
import type { VariableService } from "./VariableService";
import type { MessagingService } from "./MessagingService";
import type { InventoryService } from "./InventoryService";
import type { EquipmentService } from "./EquipmentService";
import type { AppearanceService } from "./AppearanceService";
import type { PlayerState } from "../player";
import type { InterfaceService } from "../../widgets/InterfaceService";
import type { SailingInstanceManager } from "../sailing/SailingInstanceManager";
import type { WidgetEvent } from "../../network/wsServerTypes";
import { logger } from "../../utils/logger";

export interface GamemodeServiceAdapterDeps {
    dataLoaders: DataLoaderService;
    variableService: VariableService;
    messagingService: MessagingService;
    inventoryService: InventoryService;
    equipmentService: EquipmentService;
    appearanceService: AppearanceService;
    getCurrentTick: () => number;
    getPlayerById: (id: number) => PlayerState | undefined;
    getSocketByPlayerId: (id: number) => WebSocket | undefined;
    refreshCombatWeaponCategory: (player: PlayerState) => { categoryChanged: boolean; weaponItemChanged: boolean };
    queueCombatSnapshot: (
        playerId: number,
        category: number,
        weaponItemId: number,
        autoRetaliate: boolean,
        styleSlot: number,
        activePrayers: string[],
        combatSpellId?: number,
    ) => void;
    queueWidgetEvent: (playerId: number, event: unknown) => void;
    queueGamemodeSnapshot: (key: string, playerId: number, payload: unknown) => void;
    registerSnapshotEncoder: (
        key: string,
        encoder: (playerId: number, payload: unknown) => { message: string | Uint8Array; context: string } | undefined,
        onSent?: (playerId: number, payload: unknown) => void,
    ) => void;
    gamemodeTickCallbacks: Array<(tick: number) => void>;
    interfaceService: InterfaceService | undefined;
    sailingInstanceManager: SailingInstanceManager | undefined;
    eventBus: GameEventBus;
}

/**
 * Builds the GamemodeServerServices bag from extracted services.
 * Replaces the buildGamemodeServerServices anonymous object from WSServer.
 */
export function buildGamemodeServices(deps: GamemodeServiceAdapterDeps): GamemodeServerServices {
    return {
        getPlayer: (playerId) => deps.getPlayerById(playerId),
        getInventory: (player) => deps.inventoryService.getInventory(player),
        getEquipArray: (player) => deps.equipmentService.ensureEquipArray(player),
        getEquipQtyArray: (player) => deps.equipmentService.ensureEquipQtyArray(player),
        addItemToInventory: (player, itemId, qty) =>
            deps.inventoryService.addItemToInventory(player, itemId, qty),
        sendInventorySnapshot: (playerId) => {
            const player = deps.getPlayerById(playerId);
            if (player) deps.inventoryService.snapshotInventory(player);
        },
        refreshAppearance: (player) => deps.appearanceService.refreshAppearanceKits(player),
        refreshCombatWeapon: (player) => deps.refreshCombatWeaponCategory(player),
        sendAppearanceUpdate: (playerId) => {
            const player = deps.getPlayerById(playerId);
            if (player) deps.appearanceService.sendAppearanceUpdate(player);
        },
        queueCombatSnapshot: (playerId, category, weaponItemId, autoRetaliate, styleSlot, activePrayers, combatSpellId) => {
            deps.queueCombatSnapshot(playerId, category, weaponItemId, autoRetaliate, styleSlot, activePrayers, combatSpellId);
        },
        queueChatMessage: (opts) => deps.messagingService.queueChatMessage(opts),
        queueVarbit: (playerId, varbitId, value) => deps.variableService.queueVarbit(playerId, varbitId, value),
        queueWidgetEvent: (playerId, event) => deps.queueWidgetEvent(playerId, event),
        queueGamemodeSnapshot: (key, playerId, payload) =>
            deps.queueGamemodeSnapshot(key, playerId, payload),
        registerSnapshotEncoder: (key, encoder, onSent) =>
            deps.registerSnapshotEncoder(key, encoder, onSent),
        getObjType: (itemId) => deps.dataLoaders.getObjType(itemId),
        getInterfaceService: () => deps.interfaceService,
        getCurrentTick: () => deps.getCurrentTick(),
        registerTickCallback: (callback) => deps.gamemodeTickCallbacks.push(callback),
        isInSailingInstanceRegion: (player) =>
            deps.sailingInstanceManager?.isInSailingInstanceRegion(player) ?? false,
        initSailingInstance: (player) =>
            deps.sailingInstanceManager?.initInstance(player),
        eventBus: deps.eventBus,
        logger,
    };
}

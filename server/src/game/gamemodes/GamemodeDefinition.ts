import type { GameEventBus } from "../events/GameEventBus";
import type { InterfaceService } from "../../widgets/InterfaceService";
import type { WidgetAction } from "../../widgets/WidgetManager";
import type { PlayerState } from "../player";
import type { IScriptRegistry, ScriptServices } from "../scripts/types";

export interface GamemodeUiController {
    normalizeSideJournalState(
        player: PlayerState,
        incomingStateVarp?: number,
    ): { tab: number; stateVarp: number };

    applySideJournalUi(player: PlayerState): void;

    queueTutorialOverlay(
        player: PlayerState,
        opts?: { queueFlashsideVarbitOnStep3?: boolean },
    ): void;

    handleWidgetClose(player: PlayerState, groupId: number): void;

    handleWidgetOpen(player: PlayerState, groupId: number): void;

    activateQuestTab(playerId: number): void;

    getSideJournalBootstrapState(player: PlayerState): {
        varps: Record<number, number>;
        varbits: Record<number, number>;
    };
}

export interface GamemodeBridge {
    getPlayer(playerId: number): PlayerState | undefined;
    queueVarp(playerId: number, varpId: number, value: number): void;
    queueVarbit(playerId: number, varbitId: number, value: number): void;
    queueNotification(playerId: number, notification: unknown): void;
    queueWidgetEvent(playerId: number, event: WidgetAction): void;
    queueClientScript(playerId: number, scriptId: number, ...args: (number | string)[]): void;
    sendGameMessage(player: PlayerState, text: string): void;
}

/**
 * Server-level services exposed to gamemodes during initialization.
 * Any gamemode feature (banking, shops, etc.) can use these to interact with
 * core server systems without importing server internals.
 */
export interface GamemodeServerServices {
    getPlayer(playerId: number): PlayerState | undefined;
    getInventory(player: PlayerState): Array<{ itemId: number; quantity: number }>;
    getEquipArray(player: PlayerState): number[];
    getEquipQtyArray(player: PlayerState): number[];
    addItemToInventory(
        player: PlayerState,
        itemId: number,
        quantity: number,
    ): { slot: number; added: number };
    sendInventorySnapshot(playerId: number): void;
    refreshAppearance(player: PlayerState): void;
    refreshCombatWeapon(player: PlayerState): {
        categoryChanged: boolean;
        weaponItemChanged: boolean;
    };
    sendAppearanceUpdate(playerId: number): void;
    queueCombatSnapshot(
        playerId: number,
        category: number,
        weaponItemId: number,
        autoRetaliate: boolean,
        styleSlot: number,
        activePrayers: string[],
        combatSpellId?: number,
    ): void;
    queueChatMessage(opts: {
        messageType: string;
        text: string;
        targetPlayerIds: number[];
    }): void;
    queueVarbit(playerId: number, varbitId: number, value: number): void;
    queueWidgetEvent(playerId: number, event: unknown): void;
    queueGamemodeSnapshot(key: string, playerId: number, payload: unknown): void;
    registerSnapshotEncoder(
        key: string,
        encoder: (playerId: number, payload: unknown) => {
            message: string | Uint8Array;
            context: string;
        } | undefined,
        onSent?: (playerId: number, payload: unknown) => void,
    ): void;
    getObjType(itemId: number): unknown;
    getInterfaceService(): InterfaceService | undefined;
    getCurrentTick(): number;
    registerTickCallback(callback: (tick: number) => void): void;
    isInSailingInstanceRegion?(player: PlayerState): boolean;
    initSailingInstance?(player: PlayerState): void;
    eventBus: GameEventBus;
    logger: {
        debug(message: string, ...args: unknown[]): void;
        info(message: string, ...args: unknown[]): void;
        warn(message: string, ...args: unknown[]): void;
    };
}

export interface GamemodeInitContext {
    npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined;
    objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined;
    bridge: GamemodeBridge;
    serverServices: GamemodeServerServices;
}

export interface HandshakeBridge {
    sendVarp(varpId: number, value: number): void;
    sendVarbit(varbitId: number, value: number): void;
    queueVarp(playerId: number, varpId: number, value: number): void;
    queueVarbit(playerId: number, varbitId: number, value: number): void;
    queueNotification(playerId: number, notification: unknown): void;
}

export interface XpAwardContext {
    source: "skill" | "combat" | "quest" | "other";
    actionId?: string;
    spellId?: number;
}

export interface GamemodeDefinition {
    readonly id: string;
    readonly name: string;

    // === XP ===
    getDefaultSkillXp?(skillId: number): number | undefined;
    getSkillXpMultiplier(player: PlayerState): number;
    /** Fine-grained XP adjustment. If defined, returns the final XP to award (not a multiplier). */
    getSkillXpAward?(player: PlayerState, skillId: number, baseXp: number, context?: XpAwardContext): number;

    // === Drops ===
    getDropRateMultiplier(player: PlayerState | undefined): number;
    isDropBoostEligible(entry: { dropBoostEligible?: boolean }): boolean;
    transformDropItemId(npcTypeId: number, itemId: number, player: PlayerState | undefined): number;
    /** Override or provide a custom drop table for an NPC type. */
    getDropTable?(npcTypeId: number): import("../drops/types").NpcDropTableDefinition | undefined;
    /** Provide additional drops beyond the base table. */
    getSupplementalDrops?(npcTypeId: number, player: PlayerState): import("../drops/types").NpcDropEntryDefinition[];
    /** Provide per-NPC loot distribution config (highest-damage, shared, etc.). */
    getLootDistributionConfig?(npcTypeId: number): import("../combat/DamageTracker").NpcLootConfig | undefined;

    // === Player Rules ===
    hasInfiniteRunEnergy(player: PlayerState): boolean;
    canInteract(player: PlayerState): boolean;
    canInteractWithNpc?(player: PlayerState, npcTypeId: number, option: string): boolean;

    // === Player Lifecycle ===
    initializePlayer(player: PlayerState): void;
    serializePlayerState(player: PlayerState): Record<string, unknown> | undefined;
    deserializePlayerState(player: PlayerState, data: Record<string, unknown>): void;
    onNpcKill(playerId: number, npcTypeId: number, combatLevel?: number): void;
    onItemCraft?(playerId: number, itemId: number, count: number): void;

    // === Login / Handshake ===
    /** Varbit defaults applied during login (diary unlocks, xp drops, etc.). */
    getLoginVarbits?(player: PlayerState): Array<[varbitId: number, value: number]>;
    /** Varp defaults applied during login (volume, music track, etc.). */
    getLoginVarps?(player: PlayerState): Array<[varpId: number, value: number]>;
    isTutorialActive(player: PlayerState): boolean;
    isTutorialPreStart?(player: PlayerState): boolean;
    getSpawnLocation(player: PlayerState): { x: number; y: number; level: number };
    onPlayerHandshake(player: PlayerState, bridge: HandshakeBridge): void;
    onPlayerLogin(player: PlayerState, bridge: GamemodeBridge): void;
    /** Called after player state is restored during reconnect handshake. */
    onPlayerRestore?(player: PlayerState): void;
    onPostDesignComplete?(player: PlayerState): void;
    resolveAccountStage?(player: PlayerState): void;

    // === Varp / Widget Events ===
    onVarpTransmit?(player: PlayerState, varpId: number, value: number, previousValue: number): void;
    onWidgetOpen?(player: PlayerState, groupId: number): void;
    /** Handle a resume_pausebutton click. Return true if consumed. */
    onResumePauseButton?(player: PlayerState, widgetId: number, childIndex: number): boolean;

    // === Tick ===
    onPlayerTick?(player: PlayerState, nowMs: number): void;
    onPlayerDisconnect?(playerId: number): void;

    // === Display ===
    getDisplayName(player: PlayerState, baseName: string, isAdmin: boolean): string;
    getChatPlayerType(player: PlayerState, isAdmin: boolean): number;

    // === Scripts ===
    registerHandlers(registry: IScriptRegistry, services: ScriptServices): void;
    getGamemodeServices?(): Record<string, unknown>;
    /** Mutate the ScriptServices object to add gamemode-provided methods. */
    contributeScriptServices?(services: ScriptServices): void;

    // === UI Controller ===
    createUiController?(bridge: GamemodeUiBridge): GamemodeUiController;

    // === Content Data ===
    getContentDataPacket?(): Uint8Array | null;

    // === Server Lifecycle ===
    initialize(context: GamemodeInitContext): void;
    dispose?(): void;
}

export interface GamemodeUiBridge {
    queueWidgetEvent(playerId: number, action: WidgetAction): void;
    queueVarp(playerId: number, varpId: number, value: number): void;
    queueVarbit(playerId: number, varbitId: number, value: number): void;
    isWidgetGroupOpenInLedger(playerId: number, groupId: number): boolean;
}

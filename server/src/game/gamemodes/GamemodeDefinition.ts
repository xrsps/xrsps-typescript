import type { WidgetAction } from "../../widgets/WidgetManager";
import type { PlayerState } from "../player";
import type { ScriptManifestEntry } from "../scripts/manifest";

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

export interface GamemodeInitContext {
    npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined;
    objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined;
    bridge: GamemodeBridge;
}

export interface HandshakeBridge {
    sendVarp(varpId: number, value: number): void;
    sendVarbit(varbitId: number, value: number): void;
    queueVarp(playerId: number, varpId: number, value: number): void;
    queueVarbit(playerId: number, varbitId: number, value: number): void;
    queueNotification(playerId: number, notification: unknown): void;
}

export interface GamemodeDefinition {
    readonly id: string;
    readonly name: string;

    // === XP ===
    getSkillXpMultiplier(player: PlayerState): number;

    // === Drops ===
    getDropRateMultiplier(player: PlayerState | undefined): number;
    isDropBoostEligible(entry: { dropBoostEligible?: boolean }): boolean;
    transformDropItemId(npcTypeId: number, itemId: number, player: PlayerState | undefined): number;

    // === Player Rules ===
    hasInfiniteRunEnergy(player: PlayerState): boolean;
    canInteract(player: PlayerState): boolean;
    canInteractWithNpc?(player: PlayerState, npcTypeId: number, option: string): boolean;

    // === Player Lifecycle ===
    initializePlayer(player: PlayerState): void;
    serializePlayerState(player: PlayerState): Record<string, unknown> | undefined;
    deserializePlayerState(player: PlayerState, data: Record<string, unknown>): void;
    onNpcKill(playerId: number, npcTypeId: number): void;

    // === Login / Handshake ===
    isTutorialActive(player: PlayerState): boolean;
    isTutorialPreStart?(player: PlayerState): boolean;
    getSpawnLocation(player: PlayerState): { x: number; y: number; level: number };
    onPlayerHandshake(player: PlayerState, bridge: HandshakeBridge): void;
    onPlayerLogin(player: PlayerState, bridge: GamemodeBridge): void;
    onPostDesignComplete?(player: PlayerState): void;
    resolveAccountStage?(player: PlayerState): void;

    // === Varp / Widget Events ===
    onVarpTransmit?(player: PlayerState, varpId: number, value: number, previousValue: number): void;
    onWidgetOpen?(player: PlayerState, groupId: number): void;

    // === Tick ===
    onPlayerTick?(player: PlayerState, nowMs: number): void;
    onPlayerDisconnect?(playerId: number): void;

    // === Display ===
    getDisplayName(player: PlayerState, baseName: string, isAdmin: boolean): string;
    getChatPlayerType(player: PlayerState, isAdmin: boolean): number;

    // === Scripts ===
    getScriptManifest(): ScriptManifestEntry[];
    getGamemodeServices?(): Record<string, unknown>;

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

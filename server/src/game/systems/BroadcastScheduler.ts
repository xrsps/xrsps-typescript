import type { SkillSyncUpdate } from "../player";
import type { HitsplatSourceType } from "../combat/OsrsHitsplatIds";

/**
 * Widget event queued for broadcast.
 */
export interface WidgetEventSnapshot {
    playerId: number;
    action: any;
}

/**
 * Combat state snapshot for broadcast.
 */
export interface CombatSnapshot {
    playerId: number;
    weaponCategory: number;
    weaponItemId: number;
    autoRetaliate: boolean;
    activeStyle?: number;
    activePrayers?: string[];
    activeSpellId?: number;
    specialEnergy?: number;
    specialActivated?: boolean;
    quickPrayers?: string[];
    quickPrayersEnabled?: boolean;
}

/**
 * Appearance snapshot for broadcast.
 */
export interface AppearanceSnapshot {
    playerId: number;
    payload: {
        x: number;
        y: number;
        level: number;
        rot: number;
        orientation: number;
        running: boolean;
        appearance: any;
        name?: string;
        anim?: PlayerAnimSet;
        moved: boolean;
        turned: boolean;
        snap: boolean;
        directions?: number[];
        worldViewId?: number;
    };
}

/**
 * Inventory snapshot request for broadcast.
 */
export interface InventorySnapshotRequest {
    playerId: number;
    slots?: Array<{ slot: number; itemId: number; quantity: number }>;
}

/**
 * Loc change payload for broadcast.
 */
export interface LocChangeSnapshot {
    oldId: number;
    newId: number;
    tile: { x: number; y: number };
    level: number;
    oldTile: { x: number; y: number };
    newTile: { x: number; y: number };
    oldRotation?: number;
    newRotation?: number;
    newShape?: number;
}

/**
 * Chat message types for broadcast scheduling.
 */
export interface ChatMessageSnapshot {
    messageType: "public" | "game" | "server" | "private";
    playerId?: number;
    from?: string;
    prefix?: string;
    text: string;
    playerType?: number;
    colorId?: number;
    effectId?: number;
    pattern?: number[];
    autoChat?: boolean;
    targetPlayerIds?: number[];
}

/**
 * Hitsplat broadcast data.
 */
export interface HitsplatBroadcast {
    targetType: "player" | "npc";
    targetId: number;
    damage: number;
    style: number;
    type2?: number;
    damage2?: number;
    sourceType?: HitsplatSourceType;
    sourcePlayerId?: number;
    hpCurrent: number;
    hpMax: number;
    tick?: number;
    delayTicks?: number;
}

/**
 * Forced chat broadcast data.
 */
export interface ForcedChatBroadcast {
    targetId: number;
    text: string;
}

/**
 * Forced movement broadcast data.
 */
export interface ForcedMovementBroadcast {
    targetId: number;
    startDeltaX: number;
    startDeltaY: number;
    endDeltaX: number;
    endDeltaY: number;
    startCycle: number;
    endCycle: number;
    direction: number;
}

/**
 * Spot animation broadcast data.
 */
export interface PendingSpotAnimation {
    tick: number;
    playerId?: number;
    npcId?: number;
    slot?: number;
    spotId: number;
    delay?: number;
    height?: number;
    tile?: { x: number; y: number; level?: number };
}

/**
 * Varp update data.
 */
export interface VarpUpdate {
    playerId: number;
    varpId: number;
    value: number;
}

/**
 * Varbit update data.
 */
export interface VarbitUpdate {
    playerId: number;
    varbitId: number;
    value: number;
}

/**
 * Client script invocation data.
 */
export interface ClientScriptInvocation {
    playerId: number;
    scriptId: number;
    args: (number | string)[];
}

/**
 * Player animation set data.
 */
export interface PlayerAnimSet {
    idle?: number;
    walk?: number;
    walkBack?: number;
    walkLeft?: number;
    walkRight?: number;
    run?: number;
    runBack?: number;
    runLeft?: number;
    runRight?: number;
    turnLeft?: number;
    turnRight?: number;
}

/**
 * Manages pending broadcast queues for tick-based message distribution.
 * Centralizes the queuing logic that was previously scattered across wsServer.
 */
export class BroadcastScheduler {
    // Chat and notifications
    private pendingChatMessages: ChatMessageSnapshot[] = [];
    private pendingNotifications: Array<{ playerId: number; payload: any }> = [];

    // Game state updates
    private pendingVarps: VarpUpdate[] = [];
    private pendingVarbits: VarbitUpdate[] = [];
    private pendingClientScripts: ClientScriptInvocation[] = [];

    // Combat broadcasts
    private pendingHitsplats: HitsplatBroadcast[] = [];
    private pendingForcedChats: ForcedChatBroadcast[] = [];
    private pendingForcedMovements: ForcedMovementBroadcast[] = [];
    private pendingSpotAnimations: PendingSpotAnimation[] = [];

    // Player state snapshots
    private pendingSkillSnapshots: Array<{ playerId: number; update: SkillSyncUpdate }> = [];
    private pendingAnimSnapshots: Array<{ playerId: number; anim: PlayerAnimSet }> = [];
    private pendingRunEnergySnapshots: Array<{
        playerId: number;
        percent: number;
        units: number;
        running: boolean;
        staminaTicks?: number;
        staminaMultiplier?: number;
        staminaTickMs?: number;
    }> = [];

    // ----- Chat & Notifications -----

    queueChatMessage(message: ChatMessageSnapshot): void {
        this.pendingChatMessages.push(message);
    }

    queueNotification(playerId: number, payload: any): void {
        this.pendingNotifications.push({ playerId: playerId, payload });
    }

    drainChatMessages(): ChatMessageSnapshot[] {
        const messages = this.pendingChatMessages;
        this.pendingChatMessages = [];
        return messages;
    }

    drainNotifications(): Array<{ playerId: number; payload: any }> {
        const notifications = this.pendingNotifications;
        this.pendingNotifications = [];
        return notifications;
    }

    // ----- Varps & Varbits -----

    queueVarp(playerId: number, varpId: number, value: number): void {
        this.pendingVarps.push({
            playerId: playerId,
            varpId: varpId,
            value: value,
        });
    }

    queueVarbit(playerId: number, varbitId: number, value: number): void {
        this.pendingVarbits.push({
            playerId: playerId,
            varbitId: varbitId,
            value: value,
        });
    }

    queueClientScript(playerId: number, scriptId: number, args: (number | string)[]): void {
        this.pendingClientScripts.push({
            playerId: playerId,
            scriptId: scriptId,
            args,
        });
    }

    drainVarps(): VarpUpdate[] {
        const varps = this.pendingVarps;
        this.pendingVarps = [];
        return varps;
    }

    drainVarbits(): VarbitUpdate[] {
        const varbits = this.pendingVarbits;
        this.pendingVarbits = [];
        return varbits;
    }

    drainClientScripts(): ClientScriptInvocation[] {
        const scripts = this.pendingClientScripts;
        this.pendingClientScripts = [];
        return scripts;
    }

    // ----- Combat Broadcasts -----

    queueHitsplat(hitsplat: HitsplatBroadcast): void {
        this.pendingHitsplats.push(hitsplat);
    }

    queueForcedChat(broadcast: ForcedChatBroadcast): void {
        this.pendingForcedChats.push(broadcast);
    }

    queueForcedMovement(broadcast: ForcedMovementBroadcast): void {
        this.pendingForcedMovements.push(broadcast);
    }

    queueSpotAnimation(animation: PendingSpotAnimation): void {
        this.pendingSpotAnimations.push(animation);
    }

    drainHitsplats(): HitsplatBroadcast[] {
        const hitsplats = this.pendingHitsplats;
        this.pendingHitsplats = [];
        return hitsplats;
    }

    drainForcedChats(): ForcedChatBroadcast[] {
        const chats = this.pendingForcedChats;
        this.pendingForcedChats = [];
        return chats;
    }

    drainForcedMovements(): ForcedMovementBroadcast[] {
        const movements = this.pendingForcedMovements;
        this.pendingForcedMovements = [];
        return movements;
    }

    drainSpotAnimations(): PendingSpotAnimation[] {
        const animations = this.pendingSpotAnimations;
        this.pendingSpotAnimations = [];
        return animations;
    }

    // ----- Player State Snapshots -----

    queueSkillSnapshot(playerId: number, update: SkillSyncUpdate): void {
        this.pendingSkillSnapshots.push({ playerId: playerId, update });
    }

    queueAnimSnapshot(playerId: number, anim: PlayerAnimSet): void {
        this.pendingAnimSnapshots.push({ playerId: playerId, anim });
    }

    queueRunEnergySnapshot(data: {
        playerId: number;
        percent: number;
        units: number;
        running: boolean;
        staminaTicks?: number;
        staminaMultiplier?: number;
        staminaTickMs?: number;
    }): void {
        this.pendingRunEnergySnapshots.push({
            ...data,
            playerId: data.playerId,
        });
    }

    drainSkillSnapshots(): Array<{ playerId: number; update: SkillSyncUpdate }> {
        const snapshots = this.pendingSkillSnapshots;
        this.pendingSkillSnapshots = [];
        return snapshots;
    }

    drainAnimSnapshots(): Array<{ playerId: number; anim: PlayerAnimSet }> {
        const snapshots = this.pendingAnimSnapshots;
        this.pendingAnimSnapshots = [];
        return snapshots;
    }

    drainRunEnergySnapshots(): Array<{
        playerId: number;
        percent: number;
        units: number;
        running: boolean;
        staminaTicks?: number;
        staminaMultiplier?: number;
        staminaTickMs?: number;
    }> {
        const snapshots = this.pendingRunEnergySnapshots;
        this.pendingRunEnergySnapshots = [];
        return snapshots;
    }

    // ----- Restoration (for tick failures) -----

    restoreChatMessages(messages: ChatMessageSnapshot[]): void {
        this.pendingChatMessages = messages.concat(this.pendingChatMessages);
    }

    restoreNotifications(notifications: Array<{ playerId: number; payload: any }>): void {
        this.pendingNotifications = notifications.concat(this.pendingNotifications);
    }

    restoreVarps(varps: VarpUpdate[]): void {
        this.pendingVarps = varps.concat(this.pendingVarps);
    }

    restoreVarbits(varbits: VarbitUpdate[]): void {
        this.pendingVarbits = varbits.concat(this.pendingVarbits);
    }

    restoreClientScripts(scripts: ClientScriptInvocation[]): void {
        this.pendingClientScripts = scripts.concat(this.pendingClientScripts);
    }

    restoreHitsplats(hitsplats: HitsplatBroadcast[]): void {
        this.pendingHitsplats = hitsplats.concat(this.pendingHitsplats);
    }

    restoreForcedChats(chats: ForcedChatBroadcast[]): void {
        this.pendingForcedChats = chats.concat(this.pendingForcedChats);
    }

    restoreForcedMovements(movements: ForcedMovementBroadcast[]): void {
        this.pendingForcedMovements = movements.concat(this.pendingForcedMovements);
    }

    restoreSpotAnimations(animations: PendingSpotAnimation[]): void {
        this.pendingSpotAnimations = animations.concat(this.pendingSpotAnimations);
    }

    restoreSkillSnapshots(snapshots: Array<{ playerId: number; update: SkillSyncUpdate }>): void {
        this.pendingSkillSnapshots = snapshots.concat(this.pendingSkillSnapshots);
    }

    restoreAnimSnapshots(snapshots: Array<{ playerId: number; anim: PlayerAnimSet }>): void {
        this.pendingAnimSnapshots = snapshots.concat(this.pendingAnimSnapshots);
    }

    restoreRunEnergySnapshots(
        snapshots: Array<{
            playerId: number;
            percent: number;
            units: number;
            running: boolean;
            staminaTicks?: number;
            staminaMultiplier?: number;
            staminaTickMs?: number;
        }>,
    ): void {
        this.pendingRunEnergySnapshots = snapshots.concat(this.pendingRunEnergySnapshots);
    }

    // ----- Widget Events -----

    private pendingWidgetEvents: WidgetEventSnapshot[] = [];

    queueWidgetEvent(event: WidgetEventSnapshot): void {
        this.pendingWidgetEvents.push(event);
    }

    drainWidgetEvents(): WidgetEventSnapshot[] {
        const events = this.pendingWidgetEvents;
        this.pendingWidgetEvents = [];
        return events;
    }

    restoreWidgetEvents(events: WidgetEventSnapshot[]): void {
        this.pendingWidgetEvents = events.concat(this.pendingWidgetEvents);
    }

    // ----- Keyed Message Queues (smithing, trade, etc.) -----

    private keyedMessages = new Map<string, Array<{ playerId: number; payload: any }>>();

    queueKeyedMessage(key: string, playerId: number, payload: any): void {
        let queue = this.keyedMessages.get(key);
        if (!queue) {
            queue = [];
            this.keyedMessages.set(key, queue);
        }
        queue.push({ playerId, payload });
    }

    drainKeyedMessages(key: string): Array<{ playerId: number; payload: any }> {
        const messages = this.keyedMessages.get(key) ?? [];
        this.keyedMessages.delete(key);
        return messages;
    }

    restoreKeyedMessages(key: string, messages: Array<{ playerId: number; payload: any }>): void {
        const existing = this.keyedMessages.get(key) ?? [];
        this.keyedMessages.set(key, messages.concat(existing));
    }

    drainAllKeyedMessages(): Map<string, Array<{ playerId: number; payload: any }>> {
        const all = this.keyedMessages;
        this.keyedMessages = new Map();
        return all;
    }

    restoreAllKeyedMessages(all: Map<string, Array<{ playerId: number; payload: any }>>): void {
        for (const [key, messages] of all.entries()) {
            this.restoreKeyedMessages(key, messages);
        }
    }

    // ----- Loc Changes -----

    private pendingLocChanges: LocChangeSnapshot[] = [];

    queueLocChange(payload: LocChangeSnapshot): void {
        this.pendingLocChanges.push(payload);
    }

    drainLocChanges(): LocChangeSnapshot[] {
        const changes = this.pendingLocChanges;
        this.pendingLocChanges = [];
        return changes;
    }

    restoreLocChanges(changes: LocChangeSnapshot[]): void {
        this.pendingLocChanges = changes.concat(this.pendingLocChanges);
    }

    // ----- Inventory Snapshots -----

    private pendingInventorySnapshots: InventorySnapshotRequest[] = [];

    queueInventorySnapshot(request: InventorySnapshotRequest): void {
        if (this.pendingInventorySnapshots.some((s) => s.playerId === request.playerId)) return;
        this.pendingInventorySnapshots.push(request);
    }

    drainInventorySnapshots(): InventorySnapshotRequest[] {
        const snapshots = this.pendingInventorySnapshots;
        this.pendingInventorySnapshots = [];
        return snapshots;
    }

    restoreInventorySnapshots(snapshots: InventorySnapshotRequest[]): void {
        this.pendingInventorySnapshots = snapshots.concat(this.pendingInventorySnapshots);
    }

    // ----- Combat Snapshots -----

    private pendingCombatSnapshots: CombatSnapshot[] = [];

    queueCombatSnapshot(snapshot: CombatSnapshot): void {
        this.pendingCombatSnapshots.push(snapshot);
    }

    drainCombatSnapshots(): CombatSnapshot[] {
        const snapshots = this.pendingCombatSnapshots;
        this.pendingCombatSnapshots = [];
        return snapshots;
    }

    restoreCombatSnapshots(snapshots: CombatSnapshot[]): void {
        this.pendingCombatSnapshots = snapshots.concat(this.pendingCombatSnapshots);
    }

    // ----- Appearance Snapshots -----

    private pendingAppearanceSnapshots: AppearanceSnapshot[] = [];

    queueAppearanceSnapshot(snapshot: AppearanceSnapshot): void {
        this.pendingAppearanceSnapshots.push(snapshot);
    }

    /**
     * Returns the live mutable array for direct manipulation by PlayerAppearanceManager.
     * Use drainAppearanceSnapshots() for tick frame creation.
     */
    getPendingAppearanceSnapshots(): AppearanceSnapshot[] {
        return this.pendingAppearanceSnapshots;
    }

    drainAppearanceSnapshots(): AppearanceSnapshot[] {
        const snapshots = this.pendingAppearanceSnapshots;
        this.pendingAppearanceSnapshots = [];
        return snapshots;
    }

    restoreAppearanceSnapshots(snapshots: AppearanceSnapshot[]): void {
        this.pendingAppearanceSnapshots = snapshots.concat(this.pendingAppearanceSnapshots);
    }

    // ----- Spell Results -----

    private pendingSpellResults: Array<{ playerId: number; payload: any }> = [];

    queueSpellResult(playerId: number, payload: any): void {
        this.pendingSpellResults.push({ playerId, payload });
    }

    drainSpellResults(): Array<{ playerId: number; payload: any }> {
        const results = this.pendingSpellResults;
        this.pendingSpellResults = [];
        return results;
    }

    restoreSpellResults(results: Array<{ playerId: number; payload: any }>): void {
        this.pendingSpellResults = results.concat(this.pendingSpellResults);
    }

    // ----- Gamemode Snapshots -----

    private pendingGamemodeSnapshots = new Map<string, Array<{ playerId: number; payload: unknown }>>();

    queueGamemodeSnapshot(key: string, playerId: number, payload: unknown): void {
        const queue = this.pendingGamemodeSnapshots.get(key) ?? [];
        const idx = queue.findIndex((entry) => entry.playerId === playerId);
        if (idx >= 0) {
            queue[idx] = { playerId, payload };
        } else {
            queue.push({ playerId, payload });
        }
        this.pendingGamemodeSnapshots.set(key, queue);
    }

    drainGamemodeSnapshots(): Map<string, Array<{ playerId: number; payload: unknown }>> {
        const snapshots = new Map(this.pendingGamemodeSnapshots);
        this.pendingGamemodeSnapshots = new Map();
        return snapshots;
    }

    restoreGamemodeSnapshots(snapshots: Map<string, Array<{ playerId: number; payload: unknown }>>): void {
        for (const [key, entries] of snapshots) {
            if (entries.length > 0) {
                const existing = this.pendingGamemodeSnapshots.get(key) ?? [];
                this.pendingGamemodeSnapshots.set(key, entries.concat(existing));
            }
        }
    }
}

import type { SkillSyncUpdate } from "../player";
import type { HitsplatSourceType } from "../combat/OsrsHitsplatIds";

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
}

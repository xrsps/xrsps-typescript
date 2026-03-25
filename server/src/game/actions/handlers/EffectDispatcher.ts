/**
 * Effect dispatcher handler.
 *
 * Handles dispatching of action effects extracted from wsServer:
 * - dispatchActionEffects (main effect dispatcher)
 *
 * Uses dependency injection via services interface to avoid tight coupling.
 */
import type { WebSocket } from "ws";

import type { ProjectileLaunch } from "../../../../../src/shared/projectiles/ProjectileLaunch";
import { HITMARK_BLOCK, HITMARK_HEAL, HITMARK_REGEN } from "../../combat/HitEffects";
import type { HitsplatSourceType } from "../../combat/OsrsHitsplatIds";
import type { PlayerState } from "../../player";
import type { ActionEffect, HitsplatEffect } from "../types";

// ============================================================================
// Types
// ============================================================================

/** Hitsplat broadcast event. */
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

/** Forced chat broadcast event. */
export interface ForcedChatBroadcast {
    targetId: number;
    text: string;
}

/** Forced movement broadcast event. */
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

/** Level-up popup. */
export type LevelUpPopup =
    | { kind: "skill"; skillId: number; newLevel: number; levelIncrement: number }
    | { kind: "combat"; newLevel: number; levelIncrement: number };

/** Chat message snapshot. */
export interface ChatMessageSnapshot {
    messageType: "game" | "server" | "public" | "private";
    playerId?: number;
    text: string;
    targetPlayerIds: number[];
}

/** Tick frame for batching effects. */
export interface TickFrame {
    hitsplats: HitsplatBroadcast[];
}

// ============================================================================
// Services Interface
// ============================================================================

/**
 * Services interface for effect dispatching.
 */
export interface EffectDispatcherServices {
    // --- Entity Access ---
    getPlayer(id: number): PlayerState | undefined;
    getPlayerSocket(playerId: number): WebSocket | undefined;
    isSocketOpen(socket: WebSocket | undefined): boolean;

    // --- Effect Queueing ---
    enqueueForcedChat(event: ForcedChatBroadcast): void;
    enqueueForcedMovement(event: ForcedMovementBroadcast): void;
    enqueueLevelUpPopup(player: PlayerState, popup: LevelUpPopup): void;
    queueHitsplat(hitsplat: HitsplatBroadcast, frame: TickFrame | undefined): void;

    // --- Snapshots ---
    checkAndSendSnapshots(player: PlayerState, socket: WebSocket): void;

    // --- Chat ---
    queueChatMessage(request: ChatMessageSnapshot): void;

    // --- Sound ---
    sendSound(player: PlayerState, soundId: number, options?: { delay?: number }): void;

    // --- Projectile ---
    queueProjectileForViewers(projectile: ProjectileLaunch): void;

    // --- Frame Access ---
    getActiveFrame(): TickFrame | undefined;

    // --- Constants ---
    getPlayerTakeDamageSound(): number;
    getPlayerZeroDamageSound(): number;
    getCombatSoundDelayMs(): number;

    // --- Logging ---
    log(level: "info" | "warn" | "error", message: string): void;
}

// ============================================================================
// EffectDispatcher
// ============================================================================

/**
 * Handles action effect dispatching.
 */
export class EffectDispatcher {
    constructor(private readonly services: EffectDispatcherServices) {}

    /**
     * Dispatch action effects to appropriate handlers.
     */
    dispatchActionEffects(effects: ActionEffect[], frame?: TickFrame): void {
        for (const effect of effects) {
            // Handle forced chat
            if (effect.type === "forcedChat") {
                const text = (effect.text ?? "").toString();
                if (text.length > 0) {
                    this.services.enqueueForcedChat({
                        targetId: effect.targetId,
                        text,
                    });
                }
                continue;
            }

            // Handle forced movement
            if (effect.type === "forcedMovement") {
                this.services.enqueueForcedMovement({
                    targetId: effect.targetId,
                    startDeltaX: effect.startDeltaX,
                    startDeltaY: effect.startDeltaY,
                    endDeltaX: effect.endDeltaX,
                    endDeltaY: effect.endDeltaY,
                    startCycle: effect.startCycle,
                    endCycle: effect.endCycle,
                    direction: effect.direction,
                });
                continue;
            }

            const player = this.services.getPlayer(effect.playerId);
            if (!player) continue;

            // Handle level-up popup (chat message is sent by enqueueLevelUpPopup)
            if (effect.type === "levelUp") {
                this.services.enqueueLevelUpPopup(player, {
                    kind: "skill",
                    skillId: effect.skillId as number,
                    newLevel: effect.newLevel as number,
                    levelIncrement: effect.levelIncrement as number,
                });
                continue;
            }

            // Handle combat level-up popup
            if (effect.type === "combatLevelUp") {
                this.services.enqueueLevelUpPopup(player, {
                    kind: "combat",
                    newLevel: effect.newLevel as number,
                    levelIncrement: effect.levelIncrement as number,
                });
                continue;
            }

            // Handle hitsplat
            if (effect.type === "hitsplat") {
                this.handleHitsplatEffect(effect, player, frame);
                continue;
            }

            // Handle effects that require socket
            const sock = this.services.getPlayerSocket(effect.playerId);
            if (!sock || !this.services.isSocketOpen(sock)) continue;

            switch (effect.type) {
                case "inventorySnapshot": {
                    this.services.checkAndSendSnapshots(player, sock);
                    break;
                }
                case "appearanceUpdate": {
                    this.services.checkAndSendSnapshots(player, sock);
                    break;
                }
                case "message": {
                    this.handleMessageEffect(effect, player);
                    break;
                }
                case "combatState": {
                    this.services.checkAndSendSnapshots(player, sock);
                    break;
                }
                case "log": {
                    this.handleLogEffect(effect, player);
                    break;
                }
                case "projectile": {
                    this.services.queueProjectileForViewers(effect.projectile);
                    break;
                }
            }
        }
    }

    // ========================================================================
    // Private Helper Methods
    // ========================================================================

    private handleHitsplatEffect(
        effect: HitsplatEffect,
        player: PlayerState,
        frame?: TickFrame,
    ): void {
        // Prefer provided HP values, fall back to live data for players only.
        let hpCurrent = effect.hpCurrent ?? 0;
        let hpMax = effect.hpMax ?? 0;

        if (effect.hpCurrent === undefined && effect.targetType === "player") {
            const target = this.services.getPlayer(effect.targetId);
            if (target) {
                hpCurrent = target.getHitpointsCurrent?.() ?? 0;
                hpMax = target.getHitpointsMax?.() ?? 0;
            }
        }

        // Play damage/block sounds for player targets
        if (
            effect.targetType === "player" &&
            effect.style !== HITMARK_HEAL &&
            effect.style !== HITMARK_REGEN &&
            !effect.skipAutoSound
        ) {
            const target = this.services.getPlayer(effect.targetId);
            if (target) {
                if (effect.damage > 0) {
                    this.services.sendSound(target, this.services.getPlayerTakeDamageSound(), {
                        delay: this.services.getCombatSoundDelayMs(),
                    });
                } else if (effect.style === HITMARK_BLOCK) {
                    this.services.sendSound(target, this.services.getPlayerZeroDamageSound(), {
                        delay: this.services.getCombatSoundDelayMs(),
                    });
                }
            }
        }

        const targetFrame = frame ?? this.services.getActiveFrame();
        const evt: HitsplatBroadcast = {
            targetType: effect.targetType,
            targetId: effect.targetId,
            damage: effect.damage,
            style: effect.style,
            type2: effect.type2,
            damage2: effect.damage2,
            sourceType: effect.sourceType,
            sourcePlayerId: effect.sourcePlayerId,
            hpCurrent,
            hpMax,
            tick: effect.tick,
            delayTicks: effect.delayTicks,
        };

        this.services.queueHitsplat(evt, targetFrame);
    }

    private handleMessageEffect(
        effect: ActionEffect & { type: "message" },
        player: PlayerState,
    ): void {
        const level = effect.severity ?? "info";
        const logLine = `[action:${level}] player=${player.id} ${effect.message}`.trim();

        if (level === "error") this.services.log("error", logLine);
        else if (level === "warn") this.services.log("warn", logLine);
        else this.services.log("info", logLine);

        const messageType: "game" | "server" =
            level === "warn" || level === "error" ? "server" : "game";

        this.services.queueChatMessage({
            messageType,
            playerId: player.id,
            text: effect.message,
            targetPlayerIds: [player.id],
        });
    }

    private handleLogEffect(effect: ActionEffect & { type: "log" }, player: PlayerState): void {
        const level = effect.level ?? "info";
        const meta = effect.meta ? JSON.stringify(effect.meta) : "";
        const message = `[action] player=${player.id} ${effect.message} ${meta}`;

        if (level === "error") this.services.log("error", message);
        else if (level === "warn") this.services.log("warn", message);
        else this.services.log("info", message);
    }
}

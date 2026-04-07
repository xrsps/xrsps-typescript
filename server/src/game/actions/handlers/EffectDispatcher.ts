/**
 * Effect dispatcher handler.
 *
 * Handles dispatching of action effects:
 * - dispatchActionEffects (main effect dispatcher)
 */
import { WebSocket } from "ws";

import type { ProjectileLaunch } from "../../../../../src/shared/projectiles/ProjectileLaunch";
import { HITMARK_BLOCK, HITMARK_HEAL, HITMARK_REGEN } from "../../combat/HitEffects";
import type { HitsplatSourceType } from "../../combat/OsrsHitsplatIds";
import type { PlayerState } from "../../player";
import type { ServerServices } from "../../ServerServices";
import type { ActionEffect, HitsplatEffect } from "../types";
import { logger } from "../../../utils/logger";
import {
    PLAYER_TAKE_DAMAGE_SOUND,
    PLAYER_ZERO_DAMAGE_SOUND,
} from "../../../network/wsServerTypes";

const COMBAT_SOUND_DELAY_MS = 150;

// ============================================================================
// Types
// ============================================================================

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

export interface ForcedChatBroadcast {
    targetId: number;
    text: string;
}

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

export type LevelUpPopup =
    | { kind: "skill"; skillId: number; newLevel: number; levelIncrement: number }
    | { kind: "combat"; newLevel: number; levelIncrement: number };

export interface ChatMessageSnapshot {
    messageType: "game" | "server" | "public" | "private";
    playerId?: number;
    text: string;
    targetPlayerIds: number[];
}

export interface TickFrame {
    hitsplats: HitsplatBroadcast[];
}

// ============================================================================
// EffectDispatcher
// ============================================================================

export class EffectDispatcher {
    constructor(private readonly svc: ServerServices) {}

    dispatchActionEffects(effects: ActionEffect[], frame?: TickFrame): void {
        for (const effect of effects) {
            if (effect.type === "forcedChat") {
                const text = (effect.text ?? "").toString();
                if (text.length > 0) {
                    this.svc.messagingService.enqueueForcedChat({
                        targetId: effect.targetId,
                        text,
                    });
                }
                continue;
            }

            if (effect.type === "forcedMovement") {
                this.svc.broadcastService.enqueueForcedMovement({
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

            const player = this.svc.players?.getById(effect.playerId);
            if (!player) continue;

            if (effect.type === "levelUp") {
                this.svc.interfaceManager.enqueueLevelUpPopup(player, {
                    kind: "skill",
                    skillId: effect.skillId as number,
                    newLevel: effect.newLevel as number,
                    levelIncrement: effect.levelIncrement as number,
                });
                continue;
            }

            if (effect.type === "combatLevelUp") {
                this.svc.interfaceManager.enqueueLevelUpPopup(player, {
                    kind: "combat",
                    newLevel: effect.newLevel as number,
                    levelIncrement: effect.levelIncrement as number,
                });
                continue;
            }

            if (effect.type === "hitsplat") {
                this.handleHitsplatEffect(effect, player, frame);
                continue;
            }

            const sock = this.svc.players?.getSocketByPlayerId(effect.playerId);
            if (!sock || sock.readyState !== WebSocket.OPEN) continue;

            switch (effect.type) {
                case "inventorySnapshot":
                case "appearanceUpdate":
                case "combatState": {
                    this.svc.tickPhaseService.checkAndSendSnapshots(player, sock);
                    break;
                }
                case "message": {
                    this.handleMessageEffect(effect, player);
                    break;
                }
                case "log": {
                    this.handleLogEffect(effect, player);
                    break;
                }
                case "projectile": {
                    this.svc.projectileTimingService!.queueProjectileForViewers(effect.projectile);
                    break;
                }
            }
        }
    }

    private handleHitsplatEffect(
        effect: HitsplatEffect,
        player: PlayerState,
        frame?: TickFrame,
    ): void {
        let hpCurrent = effect.hpCurrent ?? 0;
        let hpMax = effect.hpMax ?? 0;

        if (effect.hpCurrent === undefined && effect.targetType === "player") {
            const target = this.svc.players?.getById(effect.targetId);
            if (target) {
                hpCurrent = target.skillSystem.getHitpointsCurrent?.() ?? 0;
                hpMax = target.skillSystem.getHitpointsMax?.() ?? 0;
            }
        }

        if (
            effect.targetType === "player" &&
            effect.style !== HITMARK_HEAL &&
            effect.style !== HITMARK_REGEN &&
            !effect.skipAutoSound
        ) {
            const target = this.svc.players?.getById(effect.targetId);
            if (target) {
                if (effect.damage > 0) {
                    this.svc.soundService.sendSound(target, PLAYER_TAKE_DAMAGE_SOUND, {
                        delay: COMBAT_SOUND_DELAY_MS,
                    });
                } else if (effect.style === HITMARK_BLOCK) {
                    this.svc.soundService.sendSound(target, PLAYER_ZERO_DAMAGE_SOUND, {
                        delay: COMBAT_SOUND_DELAY_MS,
                    });
                }
            }
        }

        const targetFrame = frame ?? this.svc.activeFrame;
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

        if (targetFrame) {
            targetFrame.hitsplats.push(evt);
        } else {
            this.svc.broadcastScheduler.queueHitsplat(evt);
        }
    }

    private handleMessageEffect(
        effect: ActionEffect & { type: "message" },
        player: PlayerState,
    ): void {
        const level = effect.severity ?? "info";
        const logLine = `[action:${level}] player=${player.id} ${effect.message}`.trim();

        if (level === "error") logger.error(logLine);
        else if (level === "warn") logger.warn(logLine);
        else logger.info(logLine);

        const messageType: "game" | "server" =
            level === "warn" || level === "error" ? "server" : "game";

        this.svc.messagingService.queueChatMessage({
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

        if (level === "error") logger.error(message);
        else if (level === "warn") logger.warn(message);
        else logger.info(message);
    }
}

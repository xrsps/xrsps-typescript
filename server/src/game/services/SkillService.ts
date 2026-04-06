import type { WebSocket } from "ws";

import { logger } from "../../utils/logger";
import type { SkillId } from "../../../../src/rs/skill/skills";
import { getSpellBaseXp } from "../combat/SpellXpData";
import {
    type AttackType as CombatXpAttackType,
    type StyleMode,
    calculateCombatXp,
} from "../combat/CombatXp";
import { encodeMessage } from "../../network/messages";
import type { PlayerNetworkLayer } from "../../network/PlayerNetworkLayer";
import type { BroadcastScheduler } from "../systems/BroadcastScheduler";
import type { GamemodeDefinition } from "../gamemodes/GamemodeDefinition";
import type { PlayerState, SkillSyncUpdate } from "../player";
import type { ActionEffect, ActionExecutionResult } from "../actions";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";

export interface LevelUpPopup {
    kind: "skill" | "combat" | "hunter";
    skillId?: SkillId;
    newLevel: number;
    levelIncrement: number;
}

export interface SkillServiceDeps {
    getActiveFrame: () => TickFrame | undefined;
    broadcastScheduler: BroadcastScheduler;
    networkLayer: PlayerNetworkLayer;
    gamemode: GamemodeDefinition;
    enqueueLevelUpPopup: (player: PlayerState, popup: LevelUpPopup) => void;
}

/**
 * Manages skill XP awards, level-up detection, and skill snapshot broadcasting.
 * Extracted from WSServer.
 */
export class SkillService {
    constructor(private readonly deps: SkillServiceDeps) {}

    queueSkillSnapshot(playerId: number, update: SkillSyncUpdate): void {
        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.skillSnapshots.push({ playerId, update });
            return;
        }
        this.deps.broadcastScheduler.queueSkillSnapshot(playerId, update);
    }

    sendSkillsSnapshotImmediate(
        ws: WebSocket,
        player: PlayerState,
        update?: SkillSyncUpdate,
    ): void {
        const sync = update ?? player.skillSystem.takeSkillSync();
        if (!sync) return;
        const payload = {
            kind: sync.snapshot ? ("snapshot" as const) : ("delta" as const),
            skills: sync.skills,
            totalLevel: sync.totalLevel,
            combatLevel: sync.combatLevel,
        };
        this.deps.networkLayer.withDirectSendBypass("skills_snapshot_immediate", () =>
            this.deps.networkLayer.sendWithGuard(
                ws,
                encodeMessage({ type: "skills", payload }),
                "skills_snapshot_immediate",
            ),
        );
    }

    awardSkillXp(player: PlayerState, skillId: SkillId, xp: number): void {
        if (!(xp > 0)) return;
        try {
            const gamemode = this.deps.gamemode;
            const skill = player.skillSystem.getSkill(skillId);
            const prev = skill.xp;
            const oldLevel = skill.baseLevel;
            const oldCombatLevel = player.skillSystem.combatLevel;
            const baseDelta = Number.isFinite(xp) ? xp : 0;
            const delta = gamemode.getSkillXpAward
                ? gamemode.getSkillXpAward(player, skillId, baseDelta, { source: "skill" })
                : baseDelta * gamemode.getSkillXpMultiplier(player);
            if (!(delta > 0)) return;
            player.skillSystem.setSkillXp(skillId, prev + delta);
            const newLevel = player.skillSystem.getSkill(skillId).baseLevel;
            if (newLevel > oldLevel) {
                this.deps.enqueueLevelUpPopup(player, {
                    kind: "skill",
                    skillId,
                    newLevel,
                    levelIncrement: Math.max(1, newLevel - oldLevel),
                });
            }
            const newCombatLevel = player.skillSystem.combatLevel;
            if (newCombatLevel > oldCombatLevel) {
                this.deps.enqueueLevelUpPopup(player, {
                    kind: "combat",
                    newLevel: newCombatLevel,
                    levelIncrement: Math.max(1, newCombatLevel - oldCombatLevel),
                });
            }
            const update = player.skillSystem.takeSkillSync();
            if (update) {
                this.queueSkillSnapshot(player.id, update);
            }
        } catch (err) { logger.warn("[skill] failed to award xp and sync", err); }
    }

    awardCombatXp(
        player: PlayerState,
        damage: number,
        hitData: { attackType?: string; attackStyleMode?: string; spellId?: number; spellBaseXpAtCast?: boolean } | undefined,
        effects: ActionEffect[],
    ): void {
        if (!(damage > 0)) return;

        const attackType = hitData?.attackType as CombatXpAttackType | undefined;
        const styleMode = hitData?.attackStyleMode as StyleMode | string | undefined;
        const spellId = hitData?.spellId as number | undefined;
        const spellBaseXpAtCast = !!hitData?.spellBaseXpAtCast;

        const resolvedAttackType: CombatXpAttackType = attackType ?? "melee";
        const resolvedStyleMode: StyleMode | string = styleMode ?? "accurate";

        const spellBaseXp =
            resolvedAttackType === "magic" &&
            !spellBaseXpAtCast &&
            spellId !== undefined &&
            spellId > 0
                ? getSpellBaseXp(spellId)
                : 0;

        const awards = calculateCombatXp(
            damage,
            resolvedAttackType,
            resolvedStyleMode,
            spellBaseXp,
        );

        let xpChanged = false;
        const oldCombatLevel = player.skillSystem.combatLevel;
        const gamemode = this.deps.gamemode;
        const MAX_XP = 200_000_000;
        for (const award of awards) {
            const skill = player.skillSystem.getSkill(award.skillId);
            const currentXp = skill?.xp ?? 0;
            const scaledXp = gamemode.getSkillXpAward
                ? gamemode.getSkillXpAward(player, award.skillId, award.xp, { source: "combat", spellId: spellId })
                : award.xp * gamemode.getSkillXpMultiplier(player);
            const newXp = Math.min(MAX_XP, currentXp + scaledXp);

            if (newXp > currentXp) {
                const oldLevel = skill.baseLevel;
                player.skillSystem.setSkillXp(award.skillId, newXp);
                const newLevel = player.skillSystem.getSkill(award.skillId).baseLevel;
                xpChanged = true;

                if (newLevel > oldLevel) {
                    effects.push({
                        type: "levelUp",
                        playerId: player.id,
                        skillId: award.skillId,
                        newLevel,
                        levelIncrement: Math.max(1, newLevel - oldLevel),
                    });
                }
            }
        }

        const newCombatLevel = player.skillSystem.combatLevel;
        if (newCombatLevel > oldCombatLevel) {
            effects.push({
                type: "combatLevelUp",
                playerId: player.id,
                newLevel: newCombatLevel,
                levelIncrement: Math.max(1, newCombatLevel - oldCombatLevel),
            });
        }

        if (xpChanged) {
            const sync = player.skillSystem.takeSkillSync();
            if (sync) {
                this.queueSkillSnapshot(player.id, sync);
            }
        }
    }

    buildSkillMessageEffect(player: PlayerState, message: string): ActionEffect {
        return {
            type: "message",
            playerId: player.id,
            message,
        };
    }

    buildSkillFailure(
        player: PlayerState,
        message: string,
        reason: string,
    ): ActionExecutionResult {
        return {
            ok: false,
            reason,
            effects: [this.buildSkillMessageEffect(player, message)],
        };
    }
}

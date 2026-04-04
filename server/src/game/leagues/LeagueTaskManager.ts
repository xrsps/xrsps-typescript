/**
 * LeagueTaskManager - Handles game events and auto-completes matching tasks.
 */
import { VARBIT_MASTERY_POINT_UNLOCK_BASE } from "../../../../src/shared/leagues/leagueTypes";
import {
    VARBIT_LEAGUE_MASTERY_POINTS_EARNED,
    VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND,
} from "../../../../src/shared/vars";
import { SKILL_IDS, SkillId } from "../../../../src/rs/skill/skills";
import { logger } from "../../utils/logger";
import { LeagueTaskIndex, type ParsedChallenge, type ParsedTask } from "./LeagueTaskIndex";
import { type LeagueTaskPlayer, LeagueTaskService } from "./LeagueTaskService";
import { syncLeaguePackedVarps } from "./leaguePackedVarps";

export interface TaskManagerServices {
    getPlayer: (playerId: number) => LeagueTaskPlayer | undefined;
    queueVarp: (playerId: number, varpId: number, value: number) => void;
    queueVarbit: (playerId: number, varbitId: number, value: number) => void;
    queueNotification: (playerId: number, notification: unknown) => void;
}

type LevelAwareTaskPlayer = LeagueTaskPlayer & {
    skillTotal: number;
    combatLevel: number;
    getSkill: (skillId: number) => { baseLevel: number };
};

const LEAGUE_TASK_SKILL_IDS = SKILL_IDS.filter((skillId) => skillId !== SkillId.Sailing);

function normalizeProgressIncrement(value: number, fallback: number = 1): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.floor(value));
}

function normalizeQuestName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeLocAction(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return undefined;
    if (normalized.startsWith("steal")) return "steal";
    if (normalized.startsWith("check")) return "check";
    if (normalized.startsWith("open")) return "open";
    if (normalized.startsWith("bank")) return "bank";
    if (normalized.startsWith("pray")) return "pray";
    if (normalized.startsWith("activate")) return "activate";
    return normalized;
}

function queuePackedVarpUpdates(
    services: Pick<TaskManagerServices, "queueVarp">,
    playerId: number,
    updates: Array<{ id: number; value: number }>,
): void {
    for (const update of updates) {
        services.queueVarp(playerId, update.id, update.value);
    }
}

export class LeagueTaskManager {
    private index: LeagueTaskIndex;
    private services: TaskManagerServices;
    private initialized = false;

    private constructor(index: LeagueTaskIndex, services: TaskManagerServices) {
        this.index = index;
        this.services = services;
    }

    static create(
        npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        locTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        services: TaskManagerServices,
    ): LeagueTaskManager {
        logger.info("[LeagueTaskManager] Building task index...");

        const index = LeagueTaskIndex.build(npcTypeLoader, objTypeLoader, locTypeLoader);
        const stats = index.getStats();

        logger.info(
            `[LeagueTaskManager] Index built: ${stats.parsed}/${stats.total} tasks parsed (${stats.coverage}), ${stats.challenges} challenges`,
        );
        logger.info(
            `[LeagueTaskManager] Task index sizes: npcKill=${stats.indexSizes.npcKill}, npcPickpocket=${stats.indexSizes.npcPickpocket}, itemEquip=${stats.indexSizes.itemEquip}, itemObtain=${stats.indexSizes.itemObtain}, itemCraft=${stats.indexSizes.itemCraft}, locInteract=${stats.indexSizes.locInteract}, questComplete=${stats.indexSizes.questComplete}, prayerActivate=${stats.indexSizes.prayerActivate}, emoteUse=${stats.indexSizes.emoteUse}, levelReach=${stats.indexSizes.levelReach}, totalLevelReach=${stats.indexSizes.totalLevelReach}, baseLevelReach=${stats.indexSizes.baseLevelReach}, combatLevelReach=${stats.indexSizes.combatLevelReach}`,
        );
        if (stats.challenges > 0) {
            logger.info(
                `[LeagueTaskManager] Challenge index sizes: npcKill=${stats.challengeIndexSizes.npcKill}, npcPickpocket=${stats.challengeIndexSizes.npcPickpocket}, itemEquip=${stats.challengeIndexSizes.itemEquip}, itemObtain=${stats.challengeIndexSizes.itemObtain}, itemCraft=${stats.challengeIndexSizes.itemCraft}, locInteract=${stats.challengeIndexSizes.locInteract}, questComplete=${stats.challengeIndexSizes.questComplete}, prayerActivate=${stats.challengeIndexSizes.prayerActivate}, emoteUse=${stats.challengeIndexSizes.emoteUse}, levelReach=${stats.challengeIndexSizes.levelReach}, totalLevelReach=${stats.challengeIndexSizes.totalLevelReach}, baseLevelReach=${stats.challengeIndexSizes.baseLevelReach}, combatLevelReach=${stats.challengeIndexSizes.combatLevelReach}`,
            );
        }

        if (stats.sampleFailures.length > 0) {
            logger.debug(
                `[LeagueTaskManager] Sample unparsed tasks: ${stats.sampleFailures
                    .slice(0, 5)
                    .join(", ")}`,
            );
        }

        const manager = new LeagueTaskManager(index, services);
        manager.initialized = true;
        return manager;
    }

    onNpcKill(playerId: number, npcId: number): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const tasks = this.index.getTasksForNpcKill(npcId);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task, 1);
        }

        const challenges = this.index.getChallengesForNpcKill(npcId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onNpcPickpocket(playerId: number, npcId: number, count: number = 1): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const increment = normalizeProgressIncrement(count);
        if (increment <= 0) return;

        const tasks = this.index.getTasksForNpcPickpocket(npcId);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task, increment);
        }

        const challenges = this.index.getChallengesForNpcPickpocket(npcId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onItemEquip(playerId: number, itemId: number): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const tasks = this.index.getTasksForItemEquip(itemId);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task);
        }

        const challenges = this.index.getChallengesForItemEquip(itemId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onItemObtain(playerId: number, itemId: number, count: number = 1): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const increment = normalizeProgressIncrement(count);
        if (increment <= 0) {
            return;
        }

        const tasks = this.index.getTasksForItemObtain(itemId);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task, increment);
        }

        const challenges = this.index.getChallengesForItemObtain(itemId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onItemCraft(playerId: number, itemId: number, count: number = 1): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const increment = normalizeProgressIncrement(count);
        if (increment <= 0) {
            return;
        }

        const tasks = this.index.getTasksForItemCraft(itemId);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task, increment);
        }

        const challenges = this.index.getChallengesForItemCraft(itemId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onLocInteract(playerId: number, locId: number, action?: string, count: number = 1): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const increment = normalizeProgressIncrement(count);
        if (increment <= 0) return;

        const normalizedAction = normalizeLocAction(action);
        const tasks = this.index.getTasksForLocInteract(locId, normalizedAction);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task, increment);
        }

        const challenges = this.index.getChallengesForLocInteract(locId, normalizedAction);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onQuestComplete(playerId: number, questName: string): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const normalizedQuestName = normalizeQuestName(questName);
        const tasks = this.index.getTasksForQuestComplete(normalizedQuestName);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task);
        }

        const challenges = this.index.getChallengesForQuestComplete(normalizedQuestName);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onPrayerActivate(playerId: number, prayerName: string): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const tasks = this.index.getTasksForPrayerActivate(prayerName);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task);
        }

        const challenges = this.index.getChallengesForPrayerActivate(prayerName);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onEmoteUse(playerId: number, emoteId: number): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const tasks = this.index.getTasksForEmoteUse(emoteId);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task);
        }

        const challenges = this.index.getChallengesForEmoteUse(emoteId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    onLevelReach(playerId: number, skillId: number, oldLevel: number, newLevel: number): void {
        if (!this.initialized) return;
        if (newLevel <= oldLevel) return;

        const player = this.services.getPlayer(playerId) as LevelAwareTaskPlayer | undefined;
        if (!player) return;

        const tasks = this.index.getTasksForLevelReach(skillId, oldLevel, newLevel);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task);
        }

        const challenges = this.index.getChallengesForLevelReach(skillId, oldLevel, newLevel);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }

        const levelDelta = Math.max(0, newLevel - oldLevel);
        const newTotalLevel = this.getLeagueTaskTotalLevel(player);
        const oldTotalLevel = Math.max(0, newTotalLevel - levelDelta);
        this.onTotalLevelReach(player, playerId, oldTotalLevel, newTotalLevel);

        if (this.hasReachedBaseLevel(player, newLevel, skillId, oldLevel)) {
            this.onBaseLevelReach(player, playerId, newLevel);
        }
    }

    onCombatLevelReach(playerId: number, oldCombatLevel: number, newCombatLevel: number): void {
        if (!this.initialized) return;
        if (newCombatLevel <= oldCombatLevel) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const tasks = this.index.getTasksForCombatLevelReach(oldCombatLevel, newCombatLevel);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task);
        }

        const challenges = this.index.getChallengesForCombatLevelReach(
            oldCombatLevel,
            newCombatLevel,
        );
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    private awardMasteryPoint(player: LeagueTaskPlayer, playerId: number): void {
        const pointsToSpend = player.getVarbitValue?.(VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND) ?? 0;
        const pointsEarned = player.getVarbitValue?.(VARBIT_LEAGUE_MASTERY_POINTS_EARNED) ?? 0;
        const nextPointsToSpend = pointsToSpend + 1;
        const nextPointsEarned = pointsEarned + 1;

        player.setVarbitValue(VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND, nextPointsToSpend);
        player.setVarbitValue(VARBIT_LEAGUE_MASTERY_POINTS_EARNED, nextPointsEarned);

        const packedVarpUpdates = syncLeaguePackedVarps(player);
        queuePackedVarpUpdates(this.services, playerId, packedVarpUpdates);

        this.services.queueVarbit(
            playerId,
            VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND,
            nextPointsToSpend,
        );
        this.services.queueVarbit(playerId, VARBIT_LEAGUE_MASTERY_POINTS_EARNED, nextPointsEarned);

        logger.info(
            `[LeagueTaskManager] Awarded mastery point to player ${playerId} (now ${nextPointsToSpend} to spend, ${nextPointsEarned} earned)`,
        );
    }

    private tryCompleteTask(
        player: LeagueTaskPlayer,
        playerId: number,
        task: ParsedTask,
        increment: number = 1,
    ): void {
        if (LeagueTaskService.isTaskComplete(player, task.taskId)) {
            player.clearLeagueTaskProgress(task.taskId);
            return;
        }

        const requiredCount = this.getRequiredCount(task);
        if (requiredCount > 1) {
            const nextProgress = this.advanceTaskProgress(
                player,
                task.taskId,
                requiredCount,
                increment,
            );
            if (nextProgress < requiredCount) {
                return;
            }
            player.clearLeagueTaskProgress(task.taskId);
        }

        if (task.customTask) {
            this.tryCompleteCustomTask(player, playerId, task);
            return;
        }

        const result = LeagueTaskService.completeTask(player, task.taskId);

        if (result.changed) {
            for (const v of result.varpUpdates) {
                this.services.queueVarp(playerId, v.id, v.value);
            }

            for (const v of result.varbitUpdates) {
                this.services.queueVarbit(playerId, v.id, v.value);
            }

            if (result.notification) {
                this.services.queueNotification(playerId, result.notification);
            }

            logger.info(
                `[LeagueTaskManager] Completed task ${task.taskId} "${task.row.name}" for player ${playerId}`,
            );
        }
    }

    private tryCompleteCustomTask(
        player: LeagueTaskPlayer,
        playerId: number,
        task: ParsedTask,
    ): void {
        const customTask = task.customTask!;

        const result = LeagueTaskService.completeTask(player, customTask.taskId, {
            name: customTask.name,
            points: customTask.points,
        });

        if (result.changed) {
            for (const v of result.varpUpdates) {
                this.services.queueVarp(playerId, v.id, v.value);
            }

            for (const v of result.varbitUpdates) {
                this.services.queueVarbit(playerId, v.id, v.value);
            }

            if (result.notification) {
                this.services.queueNotification(playerId, result.notification);
            }

            logger.info(
                `[LeagueTaskManager] Completed custom task ${customTask.customIndex} "${customTask.name}" for player ${playerId}`,
            );
        }
    }

    private getRequiredCount(task: ParsedTask): number {
        switch (task.trigger.type) {
            case "npc_kill":
            case "npc_pickpocket":
            case "item_obtain":
            case "item_craft":
            case "loc_interact":
                return Math.max(1, task.trigger.count ?? 1);
            default:
                return 1;
        }
    }

    private advanceTaskProgress(
        player: LeagueTaskPlayer,
        taskId: number,
        requiredCount: number,
        increment: number,
    ): number {
        const delta = normalizeProgressIncrement(increment);
        if (delta <= 0) {
            return player.getLeagueTaskProgress(taskId);
        }
        const previous = player.getLeagueTaskProgress(taskId);
        const next = Math.min(requiredCount, previous + delta);
        if (next !== previous) {
            player.setLeagueTaskProgress(taskId, next);
        }
        return next;
    }

    private tryCompleteChallenge(
        player: LeagueTaskPlayer,
        playerId: number,
        parsed: ParsedChallenge,
    ): void {
        const challenge = parsed.challenge;
        const varbitId = VARBIT_MASTERY_POINT_UNLOCK_BASE + challenge.customIndex;

        const currentValue = player.getVarbitValue?.(varbitId) ?? 0;
        if (currentValue >= 1) {
            return;
        }

        player.setVarbitValue(varbitId, 1);
        const packedVarpUpdates = syncLeaguePackedVarps(player);
        queuePackedVarpUpdates(this.services, playerId, packedVarpUpdates);
        this.services.queueVarbit(playerId, varbitId, 1);

        logger.info(
            `[LeagueTaskManager] Completed challenge ${challenge.customIndex} "${challenge.description}" for player ${playerId} (varbit ${varbitId})`,
        );

        this.awardMasteryPoint(player, playerId);
    }

    private onTotalLevelReach(
        player: LeagueTaskPlayer,
        playerId: number,
        oldTotalLevel: number,
        newTotalLevel: number,
    ): void {
        if (newTotalLevel <= oldTotalLevel) {
            return;
        }

        const tasks = this.index.getTasksForTotalLevelReach(oldTotalLevel, newTotalLevel);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task);
        }

        const challenges = this.index.getChallengesForTotalLevelReach(
            oldTotalLevel,
            newTotalLevel,
        );
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    private onBaseLevelReach(
        player: LeagueTaskPlayer,
        playerId: number,
        level: number,
    ): void {
        const tasks = this.index.getTasksForBaseLevelReach(level);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task);
        }

        const challenges = this.index.getChallengesForBaseLevelReach(level);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    private hasReachedBaseLevel(
        player: LevelAwareTaskPlayer,
        threshold: number,
        skillId: number,
        oldLevel: number,
    ): boolean {
        if (oldLevel >= threshold) {
            return false;
        }
        if (player.getSkill(skillId).baseLevel < threshold) {
            return false;
        }
        return LEAGUE_TASK_SKILL_IDS.every((id) => player.getSkill(id).baseLevel >= threshold);
    }

    private getLeagueTaskTotalLevel(player: LevelAwareTaskPlayer): number {
        return LEAGUE_TASK_SKILL_IDS.reduce((sum, skillId) => {
            return sum + player.getSkill(skillId).baseLevel;
        }, 0);
    }

    getStats() {
        return this.index.getStats();
    }
}

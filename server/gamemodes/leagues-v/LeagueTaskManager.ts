/**
 * LeagueTaskManager - Handles game events and auto-completes matching tasks.
 *
 * Usage:
 * 1. Build index at server startup: LeagueTaskManager.create(loaders, services)
 * 2. Call event handlers from game systems: manager.onNpcKill(npcId, player)
 * 3. Tasks are automatically completed if player hasn't completed them yet
 */
import { VARBIT_MASTERY_POINT_UNLOCK_BASE } from "../../../src/shared/gamemode/GamemodeDataTypes";
import {
    VARBIT_LEAGUE_MASTERY_POINTS_EARNED,
    VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND,
} from "../../../src/shared/vars";
import { logger } from "../../src/utils/logger";
import { LeagueTaskIndex, type ParsedChallenge, type ParsedTask } from "./LeagueTaskIndex";
import { type LeagueTaskPlayer, LeagueTaskService, clearTaskProgress, getTaskProgress, setTaskProgress } from "./LeagueTaskService";
import { syncLeaguePackedVarps } from "./leaguePackedVarps";

export interface TaskManagerServices {
    getPlayer: (playerId: number) => LeagueTaskPlayer | undefined;
    queueVarp: (playerId: number, varpId: number, value: number) => void;
    queueVarbit: (playerId: number, varbitId: number, value: number) => void;
    queueNotification: (playerId: number, notification: unknown) => void;
}

function normalizeProgressIncrement(value: number, fallback: number = 1): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.floor(value));
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

    /**
     * Create and initialize the task manager.
     * Call once at server startup after cache loaders are ready.
     */
    static create(
        npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        services: TaskManagerServices,
    ): LeagueTaskManager {
        logger.info("[LeagueTaskManager] Building task index...");

        const index = LeagueTaskIndex.build(npcTypeLoader, objTypeLoader);
        const stats = index.getStats();

        logger.info(
            `[LeagueTaskManager] Index built: ${stats.parsed}/${stats.total} tasks parsed (${stats.coverage}), ${stats.challenges} challenges`,
        );
        logger.info(
            `[LeagueTaskManager] Task index sizes: npcKill=${stats.indexSizes.npcKill}, itemEquip=${stats.indexSizes.itemEquip}, itemObtain=${stats.indexSizes.itemObtain}, itemCraft=${stats.indexSizes.itemCraft}`,
        );
        if (stats.challenges > 0) {
            logger.info(
                `[LeagueTaskManager] Challenge index sizes: npcKill=${stats.challengeIndexSizes.npcKill}, itemEquip=${stats.challengeIndexSizes.itemEquip}, itemObtain=${stats.challengeIndexSizes.itemObtain}, itemCraft=${stats.challengeIndexSizes.itemCraft}`,
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

    /**
     * Called when a player kills an NPC.
     * Checks for and completes any matching tasks and challenges.
     * Also handles mastery unlocks for specific NPCs.
     */
    onNpcKill(playerId: number, npcId: number): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        // Check for task triggers
        const tasks = this.index.getTasksForNpcKill(npcId);
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task, 1);
        }

        // Check for challenge triggers (which award mastery points upon first completion)
        const challenges = this.index.getChallengesForNpcKill(npcId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    /**
     * Award a mastery point to a player.
     * Increments both points to spend and total points earned.
     */
    private awardMasteryPoint(player: LeagueTaskPlayer, playerId: number): void {
        // Get current points
        const pointsToSpend = player.getVarbitValue?.(VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND) ?? 0;
        const pointsEarned = player.getVarbitValue?.(VARBIT_LEAGUE_MASTERY_POINTS_EARNED) ?? 0;
        const nextPointsToSpend = pointsToSpend + 1;
        const nextPointsEarned = pointsEarned + 1;

        // Persist the new values before syncing them so later UI snapshots stay coherent.
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

    /**
     * Called when a player equips an item.
     */
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

    /**
     * Called when a player obtains an item (loot, gather, receive).
     */
    onItemObtain(playerId: number, itemId: number, count: number = 1): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const tasks = this.index.getTasksForItemObtain(itemId);
        const increment = normalizeProgressIncrement(count);
        if (increment <= 0) {
            return;
        }
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task, increment);
        }

        const challenges = this.index.getChallengesForItemObtain(itemId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    /**
     * Called when a player crafts an item.
     */
    onItemCraft(playerId: number, itemId: number, count: number = 1): void {
        if (!this.initialized) return;

        const player = this.services.getPlayer(playerId);
        if (!player) return;

        const tasks = this.index.getTasksForItemCraft(itemId);
        const increment = normalizeProgressIncrement(count);
        if (increment <= 0) {
            return;
        }
        for (const task of tasks) {
            this.tryCompleteTask(player, playerId, task, increment);
        }

        const challenges = this.index.getChallengesForItemCraft(itemId);
        for (const challenge of challenges) {
            this.tryCompleteChallenge(player, playerId, challenge);
        }
    }

    /**
     * Attempt to complete a task for a player.
     * Only completes if not already completed.
     */
    private tryCompleteTask(
        player: LeagueTaskPlayer,
        playerId: number,
        task: ParsedTask,
        increment: number = 1,
    ): void {
        if (LeagueTaskService.isTaskComplete(player, task.taskId)) {
            clearTaskProgress(player,task.taskId);
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
            clearTaskProgress(player,task.taskId);
        }

        // Check if this is a custom task - they use different varp tracking
        if (task.customTask) {
            this.tryCompleteCustomTask(player, playerId, task);
            return;
        }

        // Regular cache task - use LeagueTaskService
        const result = LeagueTaskService.completeTask(player, task.taskId);

        if (result.changed) {
            // Queue varp updates
            for (const v of result.varpUpdates) {
                this.services.queueVarp(playerId, v.id, v.value);
            }

            // Queue varbit updates
            for (const v of result.varbitUpdates) {
                this.services.queueVarbit(playerId, v.id, v.value);
            }

            // Queue notification
            if (result.notification) {
                this.services.queueNotification(playerId, result.notification);
            }

            logger.info(
                `[LeagueTaskManager] Completed task ${task.taskId} "${task.row.name}" for player ${playerId}`,
            );
        }
    }

    /**
     * Complete a custom task.
     * Custom task IDs are calculated to map to the custom varp range (7900+),
     * so LeagueTaskService.completeTask handles the varp correctly.
     */
    private tryCompleteCustomTask(
        player: LeagueTaskPlayer,
        playerId: number,
        task: ParsedTask,
    ): void {
        const customTask = task.customTask!;

        // Custom taskIds (169088+) map to varp 7900+ via the standard formula:
        // varpId = 2616 + (taskId / 32), so LeagueTaskService handles it correctly
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
            case "item_obtain":
            case "item_craft":
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
            return getTaskProgress(player,taskId);
        }
        const previous = getTaskProgress(player,taskId);
        const next = Math.min(requiredCount, previous + delta);
        if (next !== previous) {
            setTaskProgress(player,taskId, next);
        }
        return next;
    }

    /**
     * Attempt to complete a challenge for a player.
     * Sets the corresponding varbit to mark the challenge as complete.
     *
     * Challenge completion is tracked via varbits 11585-11594 (VARBIT_MASTERY_POINT_UNLOCK_1-10).
     * The CS2 script checks these varbits based on the challenge's position in enum 5695.
     *
     * Custom challenges are PREPENDED to the enum, so their positions are:
     * - Challenge 0 → position 1 → varbit 11585
     * - Challenge 1 → position 2 → varbit 11586
     * etc.
     *
     * The CS2 switch only handles positions 1-10, so max 10 custom challenges can be tracked.
     * Cache challenges are shifted down and may become untrackable (position > 10).
     */
    private tryCompleteChallenge(
        player: LeagueTaskPlayer,
        playerId: number,
        parsed: ParsedChallenge,
    ): void {
        const challenge = parsed.challenge;

        // Calculate the varbit ID for this challenge
        // Custom challenges are appended, so position = customIndex + 1 (assuming base count = 0)
        // Varbit = VARBIT_MASTERY_POINT_UNLOCK_BASE + (position - 1) = 11585 + customIndex
        const varbitId = VARBIT_MASTERY_POINT_UNLOCK_BASE + challenge.customIndex;

        // Check if already completed (varbit >= 1)
        const currentValue = player.getVarbitValue?.(varbitId) ?? 0;
        if (currentValue >= 1) {
            return; // Already complete
        }

        // Mark as complete by setting varbit to 1
        player.setVarbitValue(varbitId, 1);
        const packedVarpUpdates = syncLeaguePackedVarps(player);
        queuePackedVarpUpdates(this.services, playerId, packedVarpUpdates);
        this.services.queueVarbit(playerId, varbitId, 1);

        logger.info(
            `[LeagueTaskManager] Completed challenge ${challenge.customIndex} "${challenge.description}" for player ${playerId} (varbit ${varbitId})`,
        );

        // Award a mastery point for completing the challenge
        this.awardMasteryPoint(player, playerId);
    }

    /**
     * Get index statistics for debugging.
     */
    getStats() {
        return this.index.getStats();
    }
}

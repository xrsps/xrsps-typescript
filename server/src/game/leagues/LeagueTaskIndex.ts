/**
 * LeagueTaskIndex - Builds and maintains indexed lookups for efficient task matching.
 *
 * Instead of iterating all tasks on every event, we build reverse indexes:
 * - npcIdToTasks: Which tasks care about killing NPC X?
 * - itemIdToTasks: Which tasks care about obtaining/equipping item X?
 *
 * This gives O(1) lookup + O(m) checks where m is typically 1-5 tasks.
 */
import {
    type RegisteredCustomChallenge,
    type RegisteredCustomTask,
    getAllCustomChallenges,
    getAllCustomTasks,
} from "../../../../src/shared/leagues/custom";
import { LEAGUE_TASKS } from "../../../../src/shared/leagues/leagueTasks.data";
import type { LeagueTaskRow } from "../../../../src/shared/leagues/leagueTypes";
import {
    type TriggerParserLoaders,
    buildNameLookups,
    parseTaskTrigger,
} from "./triggers/TriggerParser";
import type { TaskTrigger } from "./triggers/TriggerTypes";

export interface ParsedTask {
    taskId: number;
    trigger: TaskTrigger;
    row: LeagueTaskRow;
    customTask?: RegisteredCustomTask;
}

export interface ParsedChallenge {
    trigger: TaskTrigger;
    challenge: RegisteredCustomChallenge;
}

export class LeagueTaskIndex {
    // Tier 1 indexes - O(1) lookup by ID
    private npcIdToTasks = new Map<number, ParsedTask[]>();
    private npcPickpocketToTasks = new Map<number, ParsedTask[]>();
    private itemEquipToTasks = new Map<number, ParsedTask[]>();
    private itemObtainToTasks = new Map<number, ParsedTask[]>();
    private itemCraftToTasks = new Map<number, ParsedTask[]>();
    private locIdToTasks = new Map<number, ParsedTask[]>();
    private questNameToTasks = new Map<string, ParsedTask[]>();
    private prayerActivateToTasks = new Map<string, ParsedTask[]>();
    private emoteUseToTasks = new Map<number, ParsedTask[]>();

    // Tier 2 indexes
    private levelReachTasks: ParsedTask[] = [];
    private totalLevelReachTasks: ParsedTask[] = [];
    private baseLevelReachTasks: ParsedTask[] = [];
    private combatLevelReachTasks: ParsedTask[] = [];

    // Challenge indexes - O(1) lookup by trigger ID
    private npcIdToChallenges = new Map<number, ParsedChallenge[]>();
    private npcPickpocketToChallenges = new Map<number, ParsedChallenge[]>();
    private itemEquipToChallenges = new Map<number, ParsedChallenge[]>();
    private itemObtainToChallenges = new Map<number, ParsedChallenge[]>();
    private itemCraftToChallenges = new Map<number, ParsedChallenge[]>();
    private locIdToChallenges = new Map<number, ParsedChallenge[]>();
    private questNameToChallenges = new Map<string, ParsedChallenge[]>();
    private prayerActivateToChallenges = new Map<string, ParsedChallenge[]>();
    private emoteUseToChallenges = new Map<number, ParsedChallenge[]>();

    // Tier 2 challenge indexes
    private levelReachChallenges: ParsedChallenge[] = [];
    private totalLevelReachChallenges: ParsedChallenge[] = [];
    private baseLevelReachChallenges: ParsedChallenge[] = [];
    private combatLevelReachChallenges: ParsedChallenge[] = [];

    // Stats for debugging
    private parsedCount = 0;
    private unparsedCount = 0;
    private parseFailures: string[] = [];
    private challengeCount = 0;

    static build(
        npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        locTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
    ): LeagueTaskIndex {
        const index = new LeagueTaskIndex();
        const loaders = buildNameLookups(npcTypeLoader, objTypeLoader, locTypeLoader);

        for (const task of LEAGUE_TASKS) {
            index.indexTask(task, loaders);
        }

        for (const customTask of getAllCustomTasks()) {
            index.indexCustomTask(customTask);
        }

        for (const challenge of getAllCustomChallenges()) {
            index.indexCustomChallenge(challenge);
        }

        return index;
    }

    private indexTask(task: LeagueTaskRow, loaders: TriggerParserLoaders): void {
        const manualTrigger = (task as any).trigger as TaskTrigger | undefined;
        const trigger =
            manualTrigger ?? parseTaskTrigger(task.name, task.description ?? "", loaders);

        if (!trigger) {
            this.unparsedCount++;
            if (this.parseFailures.length < 20) {
                this.parseFailures.push(`[${task.taskId}] ${task.name}`);
            }
            return;
        }

        this.parsedCount++;

        const parsed: ParsedTask = {
            taskId: task.taskId,
            trigger,
            row: task,
        };

        this.indexParsedTask(parsed);
    }

    private indexCustomTask(customTask: RegisteredCustomTask): void {
        const trigger = customTask.trigger;
        if (!trigger) {
            return;
        }

        this.parsedCount++;

        const row: LeagueTaskRow = {
            taskId: customTask.taskId,
            name: customTask.name,
            description: customTask.description,
            tier: customTask.tier,
            points: customTask.points,
            category: customTask.category,
            area: customTask.area,
            skill: customTask.skill,
            structId: customTask.structId,
        };

        const parsed: ParsedTask = {
            taskId: customTask.taskId,
            trigger,
            row,
            customTask,
        };

        this.indexParsedTask(parsed);
    }

    private indexParsedTask(parsed: ParsedTask): void {
        switch (parsed.trigger.type) {
            case "npc_kill":
                for (const npcId of parsed.trigger.npcIds) {
                    this.addToIndex(this.npcIdToTasks, npcId, parsed);
                }
                break;

            case "npc_pickpocket":
                for (const npcId of parsed.trigger.npcIds) {
                    this.addToIndex(this.npcPickpocketToTasks, npcId, parsed);
                }
                break;

            case "item_equip":
                for (const itemId of parsed.trigger.itemIds) {
                    this.addToIndex(this.itemEquipToTasks, itemId, parsed);
                }
                break;

            case "item_obtain":
                for (const itemId of parsed.trigger.itemIds) {
                    this.addToIndex(this.itemObtainToTasks, itemId, parsed);
                }
                break;

            case "item_craft":
                for (const itemId of parsed.trigger.itemIds) {
                    this.addToIndex(this.itemCraftToTasks, itemId, parsed);
                }
                break;

            case "loc_interact":
                for (const locId of parsed.trigger.locIds) {
                    this.addToIndex(this.locIdToTasks, locId, parsed);
                }
                break;

            case "quest_complete":
                this.addToIndex(this.questNameToTasks, parsed.trigger.questName, parsed);
                break;

            case "prayer_activate":
                this.addToIndex(this.prayerActivateToTasks, parsed.trigger.prayerName, parsed);
                break;

            case "emote_use":
                this.addToIndex(this.emoteUseToTasks, parsed.trigger.emoteId, parsed);
                break;

            case "level_reach":
                this.levelReachTasks.push(parsed);
                break;

            case "total_level_reach":
                this.totalLevelReachTasks.push(parsed);
                break;

            case "base_level_reach":
                this.baseLevelReachTasks.push(parsed);
                break;

            case "combat_level_reach":
                this.combatLevelReachTasks.push(parsed);
                break;

            default:
                break;
        }
    }

    private addToIndex<K extends number | string>(
        map: Map<K, ParsedTask[]>,
        key: K,
        task: ParsedTask,
    ): void {
        let tasks = map.get(key);
        if (!tasks) {
            tasks = [];
            map.set(key, tasks);
        }
        tasks.push(task);
    }

    private indexCustomChallenge(challenge: RegisteredCustomChallenge): void {
        const trigger = challenge.trigger;
        if (!trigger) {
            return;
        }

        this.challengeCount++;

        const parsed: ParsedChallenge = {
            trigger,
            challenge,
        };

        switch (trigger.type) {
            case "npc_kill":
                for (const npcId of trigger.npcIds) {
                    this.addToChallengeIndex(this.npcIdToChallenges, npcId, parsed);
                }
                break;

            case "npc_pickpocket":
                for (const npcId of trigger.npcIds) {
                    this.addToChallengeIndex(this.npcPickpocketToChallenges, npcId, parsed);
                }
                break;

            case "item_equip":
                for (const itemId of trigger.itemIds) {
                    this.addToChallengeIndex(this.itemEquipToChallenges, itemId, parsed);
                }
                break;

            case "item_obtain":
                for (const itemId of trigger.itemIds) {
                    this.addToChallengeIndex(this.itemObtainToChallenges, itemId, parsed);
                }
                break;

            case "item_craft":
                for (const itemId of trigger.itemIds) {
                    this.addToChallengeIndex(this.itemCraftToChallenges, itemId, parsed);
                }
                break;

            case "loc_interact":
                for (const locId of trigger.locIds) {
                    this.addToChallengeIndex(this.locIdToChallenges, locId, parsed);
                }
                break;

            case "quest_complete":
                this.addToChallengeIndex(this.questNameToChallenges, trigger.questName, parsed);
                break;

            case "prayer_activate":
                this.addToChallengeIndex(this.prayerActivateToChallenges, trigger.prayerName, parsed);
                break;

            case "emote_use":
                this.addToChallengeIndex(this.emoteUseToChallenges, trigger.emoteId, parsed);
                break;

            case "level_reach":
                this.levelReachChallenges.push(parsed);
                break;

            case "total_level_reach":
                this.totalLevelReachChallenges.push(parsed);
                break;

            case "base_level_reach":
                this.baseLevelReachChallenges.push(parsed);
                break;

            case "combat_level_reach":
                this.combatLevelReachChallenges.push(parsed);
                break;

            default:
                break;
        }
    }

    private addToChallengeIndex<K extends number | string>(
        map: Map<K, ParsedChallenge[]>,
        key: K,
        challenge: ParsedChallenge,
    ): void {
        let challenges = map.get(key);
        if (!challenges) {
            challenges = [];
            map.set(key, challenges);
        }
        challenges.push(challenge);
    }

    // === Lookup methods ===

    getTasksForNpcKill(npcId: number): ParsedTask[] {
        return this.npcIdToTasks.get(npcId) ?? [];
    }

    getTasksForNpcPickpocket(npcId: number): ParsedTask[] {
        return this.npcPickpocketToTasks.get(npcId) ?? [];
    }

    getTasksForItemEquip(itemId: number): ParsedTask[] {
        return this.itemEquipToTasks.get(itemId) ?? [];
    }

    getTasksForItemObtain(itemId: number): ParsedTask[] {
        return this.itemObtainToTasks.get(itemId) ?? [];
    }

    getTasksForItemCraft(itemId: number): ParsedTask[] {
        return this.itemCraftToTasks.get(itemId) ?? [];
    }

    getTasksForLocInteract(locId: number, action?: string): ParsedTask[] {
        return (this.locIdToTasks.get(locId) ?? []).filter((task) => {
            if (task.trigger.type !== "loc_interact") return false;
            return task.trigger.action === undefined || task.trigger.action === action;
        });
    }

    getTasksForQuestComplete(questName: string): ParsedTask[] {
        return this.questNameToTasks.get(questName) ?? [];
    }

    getTasksForPrayerActivate(prayerName: string): ParsedTask[] {
        return this.prayerActivateToTasks.get(prayerName) ?? [];
    }

    getTasksForEmoteUse(emoteId: number): ParsedTask[] {
        return this.emoteUseToTasks.get(emoteId) ?? [];
    }

    getTasksForLevelReach(skillId: number, oldLevel: number, newLevel: number): ParsedTask[] {
        const matches: ParsedTask[] = [];

        for (const task of this.levelReachTasks) {
            if (task.trigger.type !== "level_reach") continue;

            const skillMatches =
                task.trigger.skillId === undefined || task.trigger.skillId === skillId;
            const excludedSkill =
                task.trigger.excludedSkillIds?.includes(skillId) ?? false;
            const crossedThreshold =
                oldLevel < task.trigger.level && newLevel >= task.trigger.level;

            if (skillMatches && !excludedSkill && crossedThreshold) {
                matches.push(task);
            }
        }

        return matches;
    }

    getTasksForTotalLevelReach(oldTotalLevel: number, newTotalLevel: number): ParsedTask[] {
        return this.totalLevelReachTasks.filter((task) => {
            if (task.trigger.type !== "total_level_reach") return false;
            return oldTotalLevel < task.trigger.totalLevel && newTotalLevel >= task.trigger.totalLevel;
        });
    }

    getTasksForBaseLevelReach(level: number): ParsedTask[] {
        return this.baseLevelReachTasks.filter((task) => {
            if (task.trigger.type !== "base_level_reach") return false;
            return task.trigger.level === level;
        });
    }

    getTasksForCombatLevelReach(oldCombatLevel: number, newCombatLevel: number): ParsedTask[] {
        return this.combatLevelReachTasks.filter((task) => {
            if (task.trigger.type !== "combat_level_reach") return false;
            return (
                oldCombatLevel < task.trigger.combatLevel &&
                newCombatLevel >= task.trigger.combatLevel
            );
        });
    }

    // === Challenge Lookup methods ===

    getChallengesForNpcKill(npcId: number): ParsedChallenge[] {
        return this.npcIdToChallenges.get(npcId) ?? [];
    }

    getChallengesForNpcPickpocket(npcId: number): ParsedChallenge[] {
        return this.npcPickpocketToChallenges.get(npcId) ?? [];
    }

    getChallengesForItemEquip(itemId: number): ParsedChallenge[] {
        return this.itemEquipToChallenges.get(itemId) ?? [];
    }

    getChallengesForItemObtain(itemId: number): ParsedChallenge[] {
        return this.itemObtainToChallenges.get(itemId) ?? [];
    }

    getChallengesForItemCraft(itemId: number): ParsedChallenge[] {
        return this.itemCraftToChallenges.get(itemId) ?? [];
    }

    getChallengesForLocInteract(locId: number, action?: string): ParsedChallenge[] {
        return (this.locIdToChallenges.get(locId) ?? []).filter((challenge) => {
            if (challenge.trigger.type !== "loc_interact") return false;
            return challenge.trigger.action === undefined || challenge.trigger.action === action;
        });
    }

    getChallengesForQuestComplete(questName: string): ParsedChallenge[] {
        return this.questNameToChallenges.get(questName) ?? [];
    }

    getChallengesForPrayerActivate(prayerName: string): ParsedChallenge[] {
        return this.prayerActivateToChallenges.get(prayerName) ?? [];
    }

    getChallengesForEmoteUse(emoteId: number): ParsedChallenge[] {
        return this.emoteUseToChallenges.get(emoteId) ?? [];
    }

    getChallengesForLevelReach(
        skillId: number,
        oldLevel: number,
        newLevel: number,
    ): ParsedChallenge[] {
        const matches: ParsedChallenge[] = [];

        for (const challenge of this.levelReachChallenges) {
            if (challenge.trigger.type !== "level_reach") continue;

            const skillMatches =
                challenge.trigger.skillId === undefined || challenge.trigger.skillId === skillId;
            const excludedSkill =
                challenge.trigger.excludedSkillIds?.includes(skillId) ?? false;
            const crossedThreshold =
                oldLevel < challenge.trigger.level && newLevel >= challenge.trigger.level;

            if (skillMatches && !excludedSkill && crossedThreshold) {
                matches.push(challenge);
            }
        }

        return matches;
    }

    getChallengesForTotalLevelReach(
        oldTotalLevel: number,
        newTotalLevel: number,
    ): ParsedChallenge[] {
        return this.totalLevelReachChallenges.filter((challenge) => {
            if (challenge.trigger.type !== "total_level_reach") return false;
            return (
                oldTotalLevel < challenge.trigger.totalLevel &&
                newTotalLevel >= challenge.trigger.totalLevel
            );
        });
    }

    getChallengesForBaseLevelReach(level: number): ParsedChallenge[] {
        return this.baseLevelReachChallenges.filter((challenge) => {
            if (challenge.trigger.type !== "base_level_reach") return false;
            return challenge.trigger.level === level;
        });
    }

    getChallengesForCombatLevelReach(
        oldCombatLevel: number,
        newCombatLevel: number,
    ): ParsedChallenge[] {
        return this.combatLevelReachChallenges.filter((challenge) => {
            if (challenge.trigger.type !== "combat_level_reach") return false;
            return (
                oldCombatLevel < challenge.trigger.combatLevel &&
                newCombatLevel >= challenge.trigger.combatLevel
            );
        });
    }

    getStats(): {
        parsed: number;
        unparsed: number;
        total: number;
        coverage: string;
        challenges: number;
        indexSizes: {
            npcKill: number;
            npcPickpocket: number;
            itemEquip: number;
            itemObtain: number;
            itemCraft: number;
            locInteract: number;
            questComplete: number;
            prayerActivate: number;
            emoteUse: number;
            levelReach: number;
            totalLevelReach: number;
            baseLevelReach: number;
            combatLevelReach: number;
        };
        challengeIndexSizes: {
            npcKill: number;
            npcPickpocket: number;
            itemEquip: number;
            itemObtain: number;
            itemCraft: number;
            locInteract: number;
            questComplete: number;
            prayerActivate: number;
            emoteUse: number;
            levelReach: number;
            totalLevelReach: number;
            baseLevelReach: number;
            combatLevelReach: number;
        };
        sampleFailures: string[];
    } {
        const total = this.parsedCount + this.unparsedCount;
        return {
            parsed: this.parsedCount,
            unparsed: this.unparsedCount,
            total,
            coverage: total > 0 ? `${((this.parsedCount / total) * 100).toFixed(1)}%` : "0.0%",
            challenges: this.challengeCount,
            indexSizes: {
                npcKill: this.npcIdToTasks.size,
                npcPickpocket: this.npcPickpocketToTasks.size,
                itemEquip: this.itemEquipToTasks.size,
                itemObtain: this.itemObtainToTasks.size,
                itemCraft: this.itemCraftToTasks.size,
                locInteract: this.locIdToTasks.size,
                questComplete: this.questNameToTasks.size,
                prayerActivate: this.prayerActivateToTasks.size,
                emoteUse: this.emoteUseToTasks.size,
                levelReach: this.levelReachTasks.length,
                totalLevelReach: this.totalLevelReachTasks.length,
                baseLevelReach: this.baseLevelReachTasks.length,
                combatLevelReach: this.combatLevelReachTasks.length,
            },
            challengeIndexSizes: {
                npcKill: this.npcIdToChallenges.size,
                npcPickpocket: this.npcPickpocketToChallenges.size,
                itemEquip: this.itemEquipToChallenges.size,
                itemObtain: this.itemObtainToChallenges.size,
                itemCraft: this.itemCraftToChallenges.size,
                locInteract: this.locIdToChallenges.size,
                questComplete: this.questNameToChallenges.size,
                prayerActivate: this.prayerActivateToChallenges.size,
                emoteUse: this.emoteUseToChallenges.size,
                levelReach: this.levelReachChallenges.length,
                totalLevelReach: this.totalLevelReachChallenges.length,
                baseLevelReach: this.baseLevelReachChallenges.length,
                combatLevelReach: this.combatLevelReachChallenges.length,
            },
            sampleFailures: this.parseFailures,
        };
    }
}

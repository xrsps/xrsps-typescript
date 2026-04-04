/**
 * LeagueTaskIndex - Builds and maintains indexed lookups for efficient task matching.
 *
 * Instead of iterating all 1800+ tasks on every event, we build reverse indexes:
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
} from "./data/custom";
import { LEAGUE_TASKS } from "./data/leagueTasks.data";
import type { LeagueTaskRow } from "../../../src/shared/gamemode/GamemodeDataTypes";
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
    /** If this is a custom task, contains the custom task data */
    customTask?: RegisteredCustomTask;
}

export interface ParsedChallenge {
    trigger: TaskTrigger;
    challenge: RegisteredCustomChallenge;
}

export class LeagueTaskIndex {
    // Tier 1 indexes - O(1) lookup by ID
    private npcIdToTasks = new Map<number, ParsedTask[]>();
    private itemEquipToTasks = new Map<number, ParsedTask[]>();
    private itemObtainToTasks = new Map<number, ParsedTask[]>();
    private itemCraftToTasks = new Map<number, ParsedTask[]>();

    // Challenge indexes - O(1) lookup by trigger ID
    private npcIdToChallenges = new Map<number, ParsedChallenge[]>();
    private itemEquipToChallenges = new Map<number, ParsedChallenge[]>();
    private itemObtainToChallenges = new Map<number, ParsedChallenge[]>();
    private itemCraftToChallenges = new Map<number, ParsedChallenge[]>();

    // Stats for debugging
    private parsedCount = 0;
    private unparsedCount = 0;
    private parseFailures: string[] = [];
    private challengeCount = 0;

    /**
     * Build indexes from task definitions.
     * Call this once at server startup.
     */
    static build(
        npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
    ): LeagueTaskIndex {
        const index = new LeagueTaskIndex();
        const loaders = buildNameLookups(npcTypeLoader, objTypeLoader);

        // Index cache-defined tasks
        for (const task of LEAGUE_TASKS) {
            index.indexTask(task, loaders);
        }

        // Index custom tasks from the registry
        for (const customTask of getAllCustomTasks()) {
            index.indexCustomTask(customTask);
        }

        // Index custom challenges from the registry
        for (const challenge of getAllCustomChallenges()) {
            index.indexCustomChallenge(challenge);
        }

        return index;
    }

    private indexTask(task: LeagueTaskRow, loaders: TriggerParserLoaders): void {
        // Check if task has a manual trigger override
        const manualTrigger = (task as any).trigger as TaskTrigger | undefined;

        // Parse trigger from task name, or use manual override
        const trigger =
            manualTrigger ?? parseTaskTrigger(task.name, task.description ?? "", loaders);

        if (!trigger) {
            this.unparsedCount++;
            // Only log first 20 failures to avoid spam
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

        // Index by trigger type
        switch (trigger.type) {
            case "npc_kill":
                for (const npcId of trigger.npcIds) {
                    this.addToIndex(this.npcIdToTasks, npcId, parsed);
                }
                break;

            case "item_equip":
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemEquipToTasks, itemId, parsed);
                }
                break;

            case "item_obtain":
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemObtainToTasks, itemId, parsed);
                }
                break;

            case "item_craft":
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemCraftToTasks, itemId, parsed);
                }
                break;

            // Tier 2+ triggers - not indexed yet
            default:
                break;
        }
    }

    /**
     * Index a custom task from the registry.
     * Custom tasks have their trigger defined in the definition, no parsing needed.
     */
    private indexCustomTask(customTask: RegisteredCustomTask): void {
        const trigger = customTask.trigger;
        if (!trigger) {
            // Custom task without trigger - won't be auto-completed
            return;
        }

        this.parsedCount++;

        // Build a LeagueTaskRow-like object for the custom task
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

        // Index by trigger type
        switch (trigger.type) {
            case "npc_kill":
                for (const npcId of trigger.npcIds) {
                    this.addToIndex(this.npcIdToTasks, npcId, parsed);
                }
                break;

            case "item_equip":
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemEquipToTasks, itemId, parsed);
                }
                break;

            case "item_obtain":
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemObtainToTasks, itemId, parsed);
                }
                break;

            case "item_craft":
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemCraftToTasks, itemId, parsed);
                }
                break;

            default:
                break;
        }
    }

    private addToIndex(map: Map<number, ParsedTask[]>, key: number, task: ParsedTask): void {
        let tasks = map.get(key);
        if (!tasks) {
            tasks = [];
            map.set(key, tasks);
        }
        tasks.push(task);
    }

    /**
     * Index a custom challenge from the registry.
     * Custom challenges have their trigger defined in the definition.
     */
    private indexCustomChallenge(challenge: RegisteredCustomChallenge): void {
        const trigger = challenge.trigger;
        if (!trigger) {
            // Challenge without trigger - won't be auto-completed
            return;
        }

        this.challengeCount++;

        const parsed: ParsedChallenge = {
            trigger,
            challenge,
        };

        // Index by trigger type
        switch (trigger.type) {
            case "npc_kill":
                for (const npcId of trigger.npcIds) {
                    this.addToChallengeIndex(this.npcIdToChallenges, npcId, parsed);
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

            default:
                break;
        }
    }

    private addToChallengeIndex(
        map: Map<number, ParsedChallenge[]>,
        key: number,
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

    /**
     * Get tasks triggered by killing an NPC.
     */
    getTasksForNpcKill(npcId: number): ParsedTask[] {
        return this.npcIdToTasks.get(npcId) ?? [];
    }

    /**
     * Get tasks triggered by equipping an item.
     */
    getTasksForItemEquip(itemId: number): ParsedTask[] {
        return this.itemEquipToTasks.get(itemId) ?? [];
    }

    /**
     * Get tasks triggered by obtaining an item.
     */
    getTasksForItemObtain(itemId: number): ParsedTask[] {
        return this.itemObtainToTasks.get(itemId) ?? [];
    }

    /**
     * Get tasks triggered by crafting an item.
     */
    getTasksForItemCraft(itemId: number): ParsedTask[] {
        return this.itemCraftToTasks.get(itemId) ?? [];
    }

    // === Challenge Lookup methods ===

    /**
     * Get challenges triggered by killing an NPC.
     */
    getChallengesForNpcKill(npcId: number): ParsedChallenge[] {
        return this.npcIdToChallenges.get(npcId) ?? [];
    }

    /**
     * Get challenges triggered by equipping an item.
     */
    getChallengesForItemEquip(itemId: number): ParsedChallenge[] {
        return this.itemEquipToChallenges.get(itemId) ?? [];
    }

    /**
     * Get challenges triggered by obtaining an item.
     */
    getChallengesForItemObtain(itemId: number): ParsedChallenge[] {
        return this.itemObtainToChallenges.get(itemId) ?? [];
    }

    /**
     * Get challenges triggered by crafting an item.
     */
    getChallengesForItemCraft(itemId: number): ParsedChallenge[] {
        return this.itemCraftToChallenges.get(itemId) ?? [];
    }

    // === Stats ===

    getStats(): {
        parsed: number;
        unparsed: number;
        total: number;
        coverage: string;
        challenges: number;
        indexSizes: {
            npcKill: number;
            itemEquip: number;
            itemObtain: number;
            itemCraft: number;
        };
        challengeIndexSizes: {
            npcKill: number;
            itemEquip: number;
            itemObtain: number;
            itemCraft: number;
        };
        sampleFailures: string[];
    } {
        const total = this.parsedCount + this.unparsedCount;
        return {
            parsed: this.parsedCount,
            unparsed: this.unparsedCount,
            total,
            coverage: `${((this.parsedCount / total) * 100).toFixed(1)}%`,
            challenges: this.challengeCount,
            indexSizes: {
                npcKill: this.npcIdToTasks.size,
                itemEquip: this.itemEquipToTasks.size,
                itemObtain: this.itemObtainToTasks.size,
                itemCraft: this.itemCraftToTasks.size,
            },
            challengeIndexSizes: {
                npcKill: this.npcIdToChallenges.size,
                itemEquip: this.itemEquipToChallenges.size,
                itemObtain: this.itemObtainToChallenges.size,
                itemCraft: this.itemCraftToChallenges.size,
            },
            sampleFailures: this.parseFailures,
        };
    }
}

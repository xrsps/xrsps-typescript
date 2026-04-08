/**
 * League task trigger type definitions.
 * These define what event completes a task.
 */

export const TriggerType = {
    NpcKill: "npc_kill",
    NpcKillCombatLevel: "npc_kill_combat_level",
    ItemEquip: "item_equip",
    ItemObtain: "item_obtain",
    ItemCraft: "item_craft",
    QuestComplete: "quest_complete",
    LevelReach: "level_reach",
    XpGain: "xp_gain",
    AreaEnter: "area_enter",
    Custom: "custom",
} as const;
export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType];

// Tier 1 - Direct ID lookup triggers
export type NpcKillTrigger = {
    type: typeof TriggerType.NpcKill;
    npcIds: number[];
    count?: number; // For "Kill 10 Goblins" style tasks
};

export type NpcKillCombatLevelTrigger = {
    type: typeof TriggerType.NpcKillCombatLevel;
    minCombatLevel: number;
    count: number;
};

export type ItemEquipTrigger = {
    type: typeof TriggerType.ItemEquip;
    itemIds: number[];
};

export type ItemObtainTrigger = {
    type: typeof TriggerType.ItemObtain;
    itemIds: number[];
    count?: number;
};

export type ItemCraftTrigger = {
    type: typeof TriggerType.ItemCraft;
    itemIds: number[];
    count?: number;
};

export type QuestCompleteTrigger = {
    type: typeof TriggerType.QuestComplete;
    questId: number;
};

// Tier 2 - Stateful triggers (future)
export type LevelReachTrigger = {
    type: typeof TriggerType.LevelReach;
    skillId?: number; // undefined = any skill
    level: number;
};

export type XpGainTrigger = {
    type: typeof TriggerType.XpGain;
    skillId: number;
    amount: number;
};

export type AreaEnterTrigger = {
    type: typeof TriggerType.AreaEnter;
    regionIds: number[];
};

// Tier 3 - Custom validator
export type CustomTrigger = {
    type: typeof TriggerType.Custom;
    validator: string; // Name of registered validator function
};

// Union of all trigger types
export type TaskTrigger =
    | NpcKillTrigger
    | NpcKillCombatLevelTrigger
    | ItemEquipTrigger
    | ItemObtainTrigger
    | ItemCraftTrigger
    | QuestCompleteTrigger
    | LevelReachTrigger
    | XpGainTrigger
    | AreaEnterTrigger
    | CustomTrigger;

// Event types emitted by game systems
export type NpcKillEvent = {
    type: typeof TriggerType.NpcKill;
    npcId: number;
    npcName: string;
    playerId: number;
};

export type ItemEquipEvent = {
    type: typeof TriggerType.ItemEquip;
    itemId: number;
    playerId: number;
};

export type ItemObtainEvent = {
    type: typeof TriggerType.ItemObtain;
    itemId: number;
    count: number;
    playerId: number;
};

export type ItemCraftEvent = {
    type: typeof TriggerType.ItemCraft;
    itemId: number;
    count: number;
    playerId: number;
};

export type TaskEvent = NpcKillEvent | ItemEquipEvent | ItemObtainEvent | ItemCraftEvent;

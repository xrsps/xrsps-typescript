/**
 * League task trigger type definitions.
 * These define what event completes a task.
 */

// Tier 1 - Direct ID lookup triggers
export type NpcKillTrigger = {
    type: "npc_kill";
    npcIds: number[];
    count?: number; // For "Kill 10 Goblins" style tasks
};

export type ItemEquipTrigger = {
    type: "item_equip";
    itemIds: number[];
};

export type ItemObtainTrigger = {
    type: "item_obtain";
    itemIds: number[];
    count?: number;
};

export type ItemCraftTrigger = {
    type: "item_craft";
    itemIds: number[];
    count?: number;
};

export type NpcPickpocketTrigger = {
    type: "npc_pickpocket";
    npcIds: number[];
    count?: number;
};

export type QuestCompleteTrigger = {
    type: "quest_complete";
    questName: string;
};

// Tier 2 - Stateful triggers
export type LevelReachTrigger = {
    type: "level_reach";
    skillId?: number; // undefined = any skill
    excludedSkillIds?: number[];
    level: number;
};

export type TotalLevelReachTrigger = {
    type: "total_level_reach";
    totalLevel: number;
};

export type BaseLevelReachTrigger = {
    type: "base_level_reach";
    level: number;
};

export type CombatLevelReachTrigger = {
    type: "combat_level_reach";
    combatLevel: number;
};

export type PrayerActivateTrigger = {
    type: "prayer_activate";
    prayerName: string;
};

export type EmoteUseTrigger = {
    type: "emote_use";
    emoteId: number;
};

export type LocInteractTrigger = {
    type: "loc_interact";
    locIds: number[];
    action?: string;
    count?: number;
};

export type XpGainTrigger = {
    type: "xp_gain";
    skillId: number;
    amount: number;
};

export type AreaEnterTrigger = {
    type: "area_enter";
    regionIds: number[];
};

export type TutorialCompleteTrigger = {
    type: "tutorial_complete";
    tutorial: "leagues";
};

// Tier 3 - Custom validator
export type CustomTrigger = {
    type: "custom";
    validator: string; // Name of registered validator function
};

// Union of all trigger types
export type TaskTrigger =
    | NpcKillTrigger
    | ItemEquipTrigger
    | ItemObtainTrigger
    | ItemCraftTrigger
    | NpcPickpocketTrigger
    | QuestCompleteTrigger
    | LevelReachTrigger
    | TotalLevelReachTrigger
    | BaseLevelReachTrigger
    | CombatLevelReachTrigger
    | PrayerActivateTrigger
    | EmoteUseTrigger
    | LocInteractTrigger
    | XpGainTrigger
    | AreaEnterTrigger
    | TutorialCompleteTrigger
    | CustomTrigger;

// Event types emitted by game systems
export type NpcKillEvent = {
    type: "npc_kill";
    npcId: number;
    npcName: string;
    playerId: number;
};

export type ItemEquipEvent = {
    type: "item_equip";
    itemId: number;
    playerId: number;
};

export type ItemObtainEvent = {
    type: "item_obtain";
    itemId: number;
    count: number;
    playerId: number;
};

export type ItemCraftEvent = {
    type: "item_craft";
    itemId: number;
    count: number;
    playerId: number;
};

export type NpcPickpocketEvent = {
    type: "npc_pickpocket";
    npcId: number;
    count: number;
    playerId: number;
};

export type QuestCompleteEvent = {
    type: "quest_complete";
    questName: string;
    playerId: number;
};

export type LevelReachEvent = {
    type: "level_reach";
    skillId: number;
    oldLevel: number;
    newLevel: number;
    playerId: number;
};

export type TotalLevelReachEvent = {
    type: "total_level_reach";
    oldTotalLevel: number;
    newTotalLevel: number;
    playerId: number;
};

export type BaseLevelReachEvent = {
    type: "base_level_reach";
    level: number;
    playerId: number;
};

export type CombatLevelReachEvent = {
    type: "combat_level_reach";
    oldCombatLevel: number;
    newCombatLevel: number;
    playerId: number;
};

export type PrayerActivateEvent = {
    type: "prayer_activate";
    prayerName: string;
    playerId: number;
};

export type EmoteUseEvent = {
    type: "emote_use";
    emoteId: number;
    playerId: number;
};

export type LocInteractEvent = {
    type: "loc_interact";
    locId: number;
    action?: string;
    count: number;
    playerId: number;
};

export type TutorialCompleteEvent = {
    type: "tutorial_complete";
    tutorial: "leagues";
    playerId: number;
};

export type TaskEvent =
    | NpcKillEvent
    | ItemEquipEvent
    | ItemObtainEvent
    | ItemCraftEvent
    | NpcPickpocketEvent
    | QuestCompleteEvent
    | LevelReachEvent
    | TotalLevelReachEvent
    | BaseLevelReachEvent
    | CombatLevelReachEvent
    | PrayerActivateEvent
    | EmoteUseEvent
    | LocInteractEvent
    | TutorialCompleteEvent;

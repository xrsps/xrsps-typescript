export interface SkillMiningActionData {
    rockLocId: number;
    rockId?: string;
    depletedLocId?: number;
    tile: { x: number; y: number };
    level: number;
    started: boolean;
    echoMinedCount: number;
}

export interface SkillFishingActionData {
    npcId: number;
    npcTypeId: number;
    npcSize: number;
    spotId?: string;
    methodId: string;
    level: number;
    started: boolean;
}

export interface SkillFiremakingActionData {
    logItemId: number;
    logLevel?: number;
    tile: { x: number; y: number };
    level: number;
    slot?: number;
    started: boolean;
    attempts: number;
    previousLocId: number;
}

export interface SkillWoodcuttingActionData {
    treeLocId: number;
    treeId?: string;
    stumpId: number;
    tile: { x: number; y: number };
    level: number;
    started: boolean;
    ticksInSwing: number;
}

export interface SkillRecipeActionData {
    recipeId: string;
    count: number;
}

export interface SkillSmithActionData extends SkillRecipeActionData {}

export interface SkillCookActionData extends SkillRecipeActionData {
    heatSource?: "fire" | "range";
    slot?: number;
    tile?: { x: number; y: number };
    level?: number;
    quantity?: number;
    started?: boolean;
}

export interface SkillTanActionData extends SkillRecipeActionData {}

export interface SkillFletchActionData extends SkillRecipeActionData {}

export interface SkillSpinActionData extends SkillRecipeActionData {}

export interface SkillSinewActionData {
    itemId: number;
    slot?: number;
    locId?: number;
    tile?: { x: number; y: number };
    level?: number;
}

export interface SkillFlaxActionData extends SkillRecipeActionData {
    locId?: number;
    tile?: { x: number; y: number };
    level?: number;
}

export interface SkillSmeltActionData extends SkillRecipeActionData {}

export interface SkillPicklockActionData {
    locId: number;
    closedTransformId: number;
    openTransformId: number;
    varbitId: number;
    openValue: number;
    thievingLevel: number;
    xp: number;
    tile: { x: number; y: number };
    level: number;
    started: boolean;
}

export interface SkillPickpocketActionData {
    npcId: number;
    npcTypeId: number;
    reqLevel: number;
    xp: number;
    lootTable: Array<{
        itemId: number;
        minAmount: number;
        maxAmount: number;
        weight: number;
    }>;
    coinPouchId?: number;
    minDamage: number;
    maxDamage: number;
    stunTicks: number;
    displayName?: string;
    /** 0=attempt, 1=resolve, 2=stun_visual, 3=stun_damage */
    phase: number;
}

export interface SkillBoltEnchantActionData {
    sourceItemId: number;
    enchantedItemId: number;
    enchantedName: string;
    runeCosts: Array<{ runeId: number; quantity: number }>;
    xp: number;
    count: number;
    animationId?: number;
}

export type SkillActionPayloadByKind = {
    "skill.smith": SkillSmithActionData;
    "skill.cook": SkillCookActionData;
    "skill.tan": SkillTanActionData;
    "skill.fletch": SkillFletchActionData;
    "skill.spin": SkillSpinActionData;
    "skill.sinew": SkillSinewActionData;
    "skill.flax": SkillFlaxActionData;
    "skill.mine": SkillMiningActionData;
    "skill.fish": SkillFishingActionData;
    "skill.smelt": SkillSmeltActionData;
    "skill.bolt_enchant": SkillBoltEnchantActionData;
    "skill.firemaking": SkillFiremakingActionData;
    "skill.woodcut": SkillWoodcuttingActionData;
    "skill.picklock": SkillPicklockActionData;
    "skill.pickpocket": SkillPickpocketActionData;
};

export type SkillActionRequest<K extends keyof SkillActionPayloadByKind> = {
    kind: K;
    data: SkillActionPayloadByKind[K];
    delayTicks?: number;
    groups?: string[];
    cooldownTicks?: number;
};

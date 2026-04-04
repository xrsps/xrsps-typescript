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

export interface SkillSmeltActionData extends SkillRecipeActionData {}

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
    "skill.smelt": SkillSmeltActionData;
    "skill.bolt_enchant": SkillBoltEnchantActionData;
};

export type SkillActionRequest<K extends keyof SkillActionPayloadByKind> = {
    kind: K;
    data: SkillActionPayloadByKind[K];
    delayTicks?: number;
    groups?: string[];
    cooldownTicks?: number;
};

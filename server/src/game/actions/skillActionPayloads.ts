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
    // Skill actions are registered via the vanilla gamemode (skills/production).
    // Data interfaces above are retained for consumers that construct these payloads.
};

export type SkillActionRequest<K extends keyof SkillActionPayloadByKind> = {
    kind: K;
    data: SkillActionPayloadByKind[K];
    delayTicks?: number;
    groups?: string[];
    cooldownTicks?: number;
};

// League type definitions shared between client and server

export type LeagueTaskRow = {
    taskId: number;
    name: string;
    description?: string;
    tier: number;
    points: number;
    category?: number;
    area?: number;
    skill?: number;
    structId?: number;
    leagueStructId?: number;
};

// Relic data (param_879=name, param_880=description)
export type LeagueRelicRow = {
    structId: number;
    name: string;
    description: string;
    hasItem?: boolean; // param_1855 = 1 means it has an associated item
};

// Combat mastery tree node (structs 1153-1176, param_2026=name, param_2028=desc)
export type LeagueMasteryNodeRow = {
    structId: number;
    name: string;
    description: string;
    category?: number; // 3=melee, 4=ranged, 5=magic, undefined=shared
};

// Mastery challenge (structs 1177-1186, param_2028=desc only)
// These are challenges that grant mastery points when completed
export type LeagueMasteryChallengeRow = {
    structId: number;
    description: string;
};

// League type enum values (from varbit 10032)
export const LeagueType = {
    NONE: 0,
    TWISTED: 1,
    TRAILBLAZER: 2,
    SHATTERED_RELICS: 3,
    TRAILBLAZER_RELOADED: 4,
    RAGING_ECHOES: 5,
} as const;

export type LeagueTypeValue = (typeof LeagueType)[keyof typeof LeagueType];

// Mastery category enum (for combat mastery progress varbits 11580-11582)
export const MasteryCategory = {
    MELEE: 0,
    RANGED: 1,
    MAGIC: 2,
} as const;

export type MasteryCategoryValue = (typeof MasteryCategory)[keyof typeof MasteryCategory];

// Combat mastery varbits
export const VARBIT_MASTERY_MELEE_PROGRESS = 11580;
export const VARBIT_MASTERY_RANGED_PROGRESS = 11581;
export const VARBIT_MASTERY_MAGIC_PROGRESS = 11582;
export const VARBIT_MASTERY_POINTS_TO_SPEND = 11583;
export const VARBIT_MASTERY_POINTS_EARNED = 11584;
// Point unlock varbits (11585-11594) track which perks are unlocked
export const VARBIT_MASTERY_POINT_UNLOCK_BASE = 11585;

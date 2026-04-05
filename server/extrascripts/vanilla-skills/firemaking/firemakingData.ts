export type Vec2 = { x: number; y: number };

export interface FiremakingLogDefinition {
    logId: number;
    name: string;
    level: number;
    xp: number;
    burnTicks?: { min: number; max: number };
    fireObjectId?: number;
}

const DEFAULT_FIRE_OBJECT_ID = 26185;
const DEFAULT_BURN_TICKS = { min: 75, max: 120 }; // ≈45–72 seconds at 600ms ticks

const LOG_DEFINITIONS: FiremakingLogDefinition[] = [
    { logId: 1511, name: "logs", level: 1, xp: 40 },
    { logId: 2862, name: "achey logs", level: 1, xp: 40 },
    { logId: 1521, name: "oak logs", level: 15, xp: 60 },
    { logId: 1519, name: "willow logs", level: 30, xp: 90 },
    { logId: 6333, name: "teak logs", level: 35, xp: 105 },
    { logId: 10810, name: "arctic pine logs", level: 42, xp: 125 },
    { logId: 1517, name: "maple logs", level: 45, xp: 135 },
    { logId: 6332, name: "mahogany logs", level: 50, xp: 157.5 },
    { logId: 12581, name: "eucalyptus logs", level: 58, xp: 193.5 },
    { logId: 1515, name: "yew logs", level: 60, xp: 202.5 },
    { logId: 1513, name: "magic logs", level: 75, xp: 303.8 },
    { logId: 19669, name: "redwood logs", level: 90, xp: 350 },
].map((entry) => ({
    burnTicks: DEFAULT_BURN_TICKS,
    fireObjectId: DEFAULT_FIRE_OBJECT_ID,
    ...entry,
}));

const LOGS_BY_ID = new Map<number, FiremakingLogDefinition>();
for (const def of LOG_DEFINITIONS) {
    LOGS_BY_ID.set(def.logId, def);
}

export const FIREMAKING_LOG_IDS = LOG_DEFINITIONS.map((def) => def.logId);

export const FIRE_LIGHTING_ANIMATION = 733;

export const TINDERBOX_ITEM_IDS: number[] = [590, 2946];

export const ASHES_ITEM_ID = 592;

export function getFiremakingLogDefinition(itemId: number): FiremakingLogDefinition | undefined {
    return LOGS_BY_ID.get(itemId);
}

export function computeFireLightingDelayTicks(level: number): number {
    const normalized = Math.max(1, Math.floor(level));
    const deduction = Math.floor(Math.max(0, normalized - 15) / 20);
    return Math.max(2, 4 - deduction);
}

export interface FireNodeData {
    fireObjectId: number;
    previousLocId: number;
    logItemId: number;
    ownerId?: number;
}

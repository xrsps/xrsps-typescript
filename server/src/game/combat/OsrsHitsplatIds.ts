export const HITSPLAT_STYLE_BLOCK = 0;
export const HITSPLAT_STYLE_DAMAGE = 1;

// Cache-verified in this project: 26 = us blocking, 27 = other blocking.
export const OSRS_HITSPLAT_BLOCK_ME = 26;
export const OSRS_HITSPLAT_BLOCK_OTHER = 27;
// Cache-verified in this project: 28 = us hitting, 29 = other hitting.
export const OSRS_HITSPLAT_DAMAGE_ME = 28;
export const OSRS_HITSPLAT_DAMAGE_OTHER = 29;
export const OSRS_HITSPLAT_POISON = 65;
export const OSRS_HITSPLAT_POISON_ME = 68;
export const OSRS_HITSPLAT_POISON_OTHER = 69;
export const OSRS_HITSPLAT_POISON_MAX = 70;
export const OSRS_HITSPLAT_DISEASE = 4;
export const OSRS_HITSPLAT_DISEASE_BLOCKED = 3;
export const OSRS_HITSPLAT_VENOM = 5;
export const OSRS_HITSPLAT_HEAL = 6;
export const OSRS_HITSPLAT_CYAN_UP = 39;
export const OSRS_HITSPLAT_CYAN_DOWN = 41;
export const OSRS_HITSPLAT_DAMAGE_ME_CYAN = 18;
export const OSRS_HITSPLAT_DAMAGE_OTHER_CYAN = 19;
export const OSRS_HITSPLAT_DAMAGE_ME_ORANGE = 20;
export const OSRS_HITSPLAT_DAMAGE_OTHER_ORANGE = 21;
export const OSRS_HITSPLAT_DAMAGE_ME_YELLOW = 22;
export const OSRS_HITSPLAT_DAMAGE_OTHER_YELLOW = 23;
export const OSRS_HITSPLAT_DAMAGE_ME_WHITE = 24;
export const OSRS_HITSPLAT_DAMAGE_OTHER_WHITE = 25;
export const OSRS_HITSPLAT_DAMAGE_MAX_ME = 43;
export const OSRS_HITSPLAT_DAMAGE_MAX_ME_CYAN = 44;
export const OSRS_HITSPLAT_DAMAGE_MAX_ME_ORANGE = 45;
export const OSRS_HITSPLAT_DAMAGE_MAX_ME_YELLOW = 46;
export const OSRS_HITSPLAT_DAMAGE_MAX_ME_WHITE = 47;
export const OSRS_HITSPLAT_DAMAGE_ME_POISE = 53;
export const OSRS_HITSPLAT_DAMAGE_OTHER_POISE = 54;
export const OSRS_HITSPLAT_DAMAGE_MAX_ME_POISE = 55;
export const OSRS_HITSPLAT_CORRUPTION = 0;
export const OSRS_HITSPLAT_PRAYER_DRAIN = 60;
export const OSRS_HITSPLAT_BLEED = 67;
export const OSRS_HITSPLAT_SANITY_DRAIN = 71;
export const OSRS_HITSPLAT_SANITY_RESTORE = 72;
export const OSRS_HITSPLAT_DOOM = 73;
export const OSRS_HITSPLAT_BURN = 74;

import { EntityType } from "../collision/EntityCollisionService";

export type HitsplatSourceType = "player" | "npc" | "follower" | "status";

function isMinePerspective(
    viewerPlayerId: number | undefined,
    targetType: "player" | "npc" | undefined,
    targetId: number | undefined,
    sourcePlayerId: number | undefined,
    sourceType: HitsplatSourceType | undefined,
): boolean {
    const viewerId = viewerPlayerId ?? 0;
    const targetPlayerId = targetType === EntityType.Player ? targetId ?? 0 : 0;
    const sourceId = sourcePlayerId ?? 0;
    const isViewerTarget =
        viewerId > 0 && targetPlayerId > 0 && (viewerId | 0) === (targetPlayerId | 0);
    const isViewerSource =
        sourceType === EntityType.Player &&
        viewerId > 0 &&
        sourceId > 0 &&
        (viewerId | 0) === (sourceId | 0);
    return (
        isViewerTarget ||
        isViewerSource
    );
}

function downgradeMineHitsplat(style: number): number {
    switch (style | 0) {
        case OSRS_HITSPLAT_BLOCK_ME:
            return OSRS_HITSPLAT_BLOCK_OTHER;
        case OSRS_HITSPLAT_DAMAGE_ME:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME:
            return OSRS_HITSPLAT_DAMAGE_OTHER;
        case OSRS_HITSPLAT_DAMAGE_ME_CYAN:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_CYAN:
            return OSRS_HITSPLAT_DAMAGE_OTHER_CYAN;
        case OSRS_HITSPLAT_DAMAGE_ME_ORANGE:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_ORANGE:
            return OSRS_HITSPLAT_DAMAGE_OTHER_ORANGE;
        case OSRS_HITSPLAT_DAMAGE_ME_YELLOW:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_YELLOW:
            return OSRS_HITSPLAT_DAMAGE_OTHER_YELLOW;
        case OSRS_HITSPLAT_DAMAGE_ME_WHITE:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_WHITE:
            return OSRS_HITSPLAT_DAMAGE_OTHER_WHITE;
        case OSRS_HITSPLAT_DAMAGE_ME_POISE:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_POISE:
            return OSRS_HITSPLAT_DAMAGE_OTHER_POISE;
        case OSRS_HITSPLAT_POISON_ME:
            return OSRS_HITSPLAT_POISON_OTHER;
        default:
            return style | 0;
    }
}

export function resolveHitsplatTypeForObserver(
    styleRaw: number | undefined,
    viewerPlayerId?: number,
    targetType?: "player" | "npc",
    targetId?: number,
    sourcePlayerId?: number,
    sourceType?: HitsplatSourceType,
): number {
    const style =
        typeof styleRaw === "number" && Number.isFinite(styleRaw)
            ? styleRaw | 0
            : HITSPLAT_STYLE_DAMAGE;
    const mine = isMinePerspective(
        viewerPlayerId,
        targetType,
        targetId,
        sourcePlayerId,
        sourceType,
    );
    switch (style) {
        case HITSPLAT_STYLE_BLOCK:
            return mine ? OSRS_HITSPLAT_BLOCK_ME : OSRS_HITSPLAT_BLOCK_OTHER;
        case HITSPLAT_STYLE_DAMAGE:
            return mine ? OSRS_HITSPLAT_DAMAGE_ME : OSRS_HITSPLAT_DAMAGE_OTHER;
        case OSRS_HITSPLAT_POISON:
            return mine ? OSRS_HITSPLAT_POISON_ME : OSRS_HITSPLAT_POISON_OTHER;
        default:
            return mine ? style : downgradeMineHitsplat(style);
    }
}

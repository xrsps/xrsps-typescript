import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import type { ScriptInventoryEntry, ScriptServices } from "../../../../src/game/scripts/types";
import type { CookingHeatSource } from "./cookingData";

export type SkillSurfaceKind = "smith" | "cook" | "tan" | "smelt";

export type InventoryEntry = ScriptInventoryEntry;
export type RequestActionFn = NonNullable<ScriptServices["requestAction"]>;
export type SendMessageFn = (player: PlayerState, text: string) => void;
export type SkillDialogChoice<T> = {
    recipe: T;
    label: string;
    craftable: boolean;
    batch: number;
};

export const MAX_BATCH = 28;
export const MAX_DIALOG_OPTIONS = 5;

export const SKILL_DIALOG_META: Record<SkillSurfaceKind, { id: string; title: string }> = {
    smith: { id: "skill.smith", title: "What would you like to smith?" },
    cook: { id: "skill.cook", title: "What would you like to cook?" },
    tan: { id: "skill.tan", title: "Which hide would you like to tan?" },
    smelt: { id: "skill.smelt", title: "Which bar would you like to smelt?" },
};

export const ACTION_FAILURE_MESSAGES: Record<SkillSurfaceKind, string> = {
    smith: "You can't smith right now.",
    cook: "You can't cook that right now.",
    tan: "You can't tan that right now.",
    smelt: "You can't smelt that right now.",
};

export function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

export function buildSkillFailure(player: PlayerState, message: string, reason: string): ActionExecutionResult {
    return { ok: false, reason, effects: [buildMessageEffect(player, message)] };
}

export const clampBatchCount = (count: number): number => Math.max(0, Math.min(MAX_BATCH, count));

export const countItem = (entries: InventoryEntry[], itemId: number): number => {
    let total = 0;
    for (const entry of entries) {
        if (entry.itemId === itemId) total += Math.max(0, entry.quantity);
    }
    return total;
};

export const hasItem = (entries: InventoryEntry[], itemId: number, quantity: number = 1): boolean => {
    if (!(itemId > 0)) return false;
    let remaining = quantity;
    for (const entry of entries) {
        if (entry.itemId === itemId && entry.quantity > 0) {
            remaining -= Math.min(entry.quantity, remaining);
            if (remaining <= 0) return true;
        }
    }
    return false;
};

export const getInventory = (services: ScriptServices, player: PlayerState): InventoryEntry[] =>
    services.getInventoryItems(player);

export const resolveCookingHeatSource = (services: ScriptServices, locId?: number): CookingHeatSource => {
    if (locId === undefined || !(locId > 0)) return "range";
    const definition = services.getLocDefinition?.(locId);
    const supportItems = definition?.supportItems ?? 1;
    const name = definition?.name?.toLowerCase() ?? "";
    if (supportItems <= 0 || name === "fire") return "fire";
    return "range";
};

export const enqueueSkillAction = (
    requestAction: RequestActionFn,
    kind: SkillSurfaceKind,
    player: PlayerState,
    recipeId: string,
    count: number,
    delayTicks: number,
    tick: number | undefined,
    sendMessage: SendMessageFn,
    extraData?: { heatSource?: CookingHeatSource },
): boolean => {
    const normalizedCount = Math.max(1, count);
    const delay = Math.max(1, delayTicks);
    if (!(normalizedCount > 0)) {
        sendMessage(player, ACTION_FAILURE_MESSAGES[kind]);
        return false;
    }
    const resolvedTick = Number.isFinite(tick) ? (tick as number) : 0;

    const kindToAction: Record<SkillSurfaceKind, string> = {
        smith: "skill.smith",
        cook: "skill.cook",
        tan: "skill.tan",
        smelt: "skill.smelt",
    };
    const actionKind = kindToAction[kind];
    const data: Record<string, unknown> = { recipeId, count: normalizedCount };
    if (kind === "cook" && extraData?.heatSource) {
        data.heatSource = extraData.heatSource;
    }

    const result = requestAction(
        player,
        {
            kind: actionKind,
            data,
            delayTicks: delay,
            cooldownTicks: delay,
            groups: ["skill.surface", actionKind],
        },
        resolvedTick,
    );

    if (!result.ok) {
        sendMessage(player, ACTION_FAILURE_MESSAGES[kind]);
        return false;
    }
    return true;
};

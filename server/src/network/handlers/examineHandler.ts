// @ts-nocheck
import type { WebSocket } from "ws";

import {
    resolveLocExamineText,
    resolveNpcExamineText,
    resolveObjExamineText,
} from "../../game/interactions/ExamineText";
import { loadVisibleLocTypeForPlayer } from "../../world/LocTransforms";
import type { PlayerState } from "../../game/player";

export interface ExamineHandlerDeps {
    getPlayer: (ws: WebSocket) => PlayerState | undefined;
    queuePlayerGameMessage: (player: PlayerState, text: string) => void;
    queryGroundItemArea: (
        x: number,
        y: number,
        level: number,
        radius: number,
        tick: number,
        playerId: number,
        worldViewId?: number,
    ) => Array<{ itemId: number }>;
    getCurrentTick: () => number;
    locTypeLoader: { load(id: number): any } | undefined;
    npcTypeLoader: { load(id: number): any } | undefined;
    objTypeLoader: { load(id: number): any } | undefined;
    getNpcType: (npc: any) => any | undefined;
    getObjType: (itemId: number) => any | undefined;
}

export function handleExaminePacket(
    deps: ExamineHandlerDeps,
    ws: WebSocket,
    packet: any,
): boolean {
    const player = deps.getPlayer(ws);
    if (!player) {
        return false;
    }

    switch (packet.type) {
        case "examine_loc": {
            deps.queuePlayerGameMessage(
                player,
                resolveLocExamineText(deps.locTypeLoader, player, packet.locId),
            );
            return true;
        }

        case "examine_npc": {
            deps.queuePlayerGameMessage(
                player,
                resolveNpcExamineText(deps.npcTypeLoader, packet.npcId),
            );
            return true;
        }

        case "examine_obj": {
            const visible = deps
                .queryGroundItemArea(
                    packet.worldX,
                    packet.worldY,
                    player.level,
                    0,
                    deps.getCurrentTick(),
                    player.id,
                    player.worldViewId,
                )
                .some((stack) => stack.itemId === packet.itemId);
            if (!visible) {
                return true;
            }

            deps.queuePlayerGameMessage(
                player,
                resolveObjExamineText(deps.objTypeLoader, packet.itemId),
            );
            return true;
        }

        default:
            return false;
    }
}

export function resolveNpcOptionByOpNum(
    getNpcType: (npc: any) => any | undefined,
    npc: any,
    opNum: number,
): string | undefined {
    const idx = opNum - 1;
    if (idx < 0 || idx > 4) return undefined;
    try {
        const type = getNpcType(npc);
        const raw = Array.isArray(type?.actions) ? type.actions[idx] : undefined;
        if (!raw) return undefined;
        const normalized = raw.trim();
        return normalized.length > 0 ? normalized : undefined;
    } catch {
        return undefined;
    }
}

export function resolveLocActionByOpNum(
    locTypeLoader: { load(id: number): any } | undefined,
    locId: number,
    opNum: number,
    player?: PlayerState,
): string | undefined {
    const idx = opNum - 1;
    if (idx < 0 || idx > 4) return undefined;
    if (!(locId > 0)) return undefined;
    try {
        const visible = player
            ? loadVisibleLocTypeForPlayer(locTypeLoader, player, locId)
            : undefined;
        const def = visible?.type ?? locTypeLoader?.load?.(locId);
        const raw = Array.isArray(def?.actions) ? def.actions[idx] : undefined;
        if (!raw) return undefined;
        const normalized = raw.trim();
        return normalized.length > 0 ? normalized : undefined;
    } catch {
        return undefined;
    }
}

export function resolveGroundItemOptionByOpNum(
    getObjType: (itemId: number) => any | undefined,
    itemId: number,
    opNum: number,
): string | undefined {
    const idx = opNum - 1;
    if (idx < 0 || idx > 4) return undefined;
    if (!(itemId > 0)) return undefined;
    try {
        const obj = getObjType(itemId);
        const raw = Array.isArray(obj?.groundActions) ? obj.groundActions[idx] : undefined;
        if (!raw) return undefined;
        const normalized = raw.trim();
        return normalized.length > 0 ? normalized : undefined;
    } catch {
        return undefined;
    }
}

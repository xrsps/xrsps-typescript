import type { WebSocket } from "ws";

import {
    resolveLocExamineText,
    resolveNpcExamineText,
    resolveObjExamineText,
} from "../../game/interactions/ExamineText";
import { loadVisibleLocTypeForPlayer } from "../../world/LocTransforms";
import type { PlayerState } from "../../game/player";
import type { LocType } from "../../../../src/rs/config/loctype/LocType";
import type { NpcType } from "../../../../src/rs/config/npctype/NpcType";
import type { ObjType } from "../../../../src/rs/config/objtype/ObjType";
import type { TypeLoader } from "../../../../src/rs/config/TypeLoader";
import type { NpcState } from "../../game/npc";

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
    locTypeLoader: TypeLoader<LocType> | undefined;
    npcTypeLoader: TypeLoader<NpcType> | undefined;
    objTypeLoader: TypeLoader<ObjType> | undefined;
    getNpcType: (npc: NpcState) => NpcType | undefined;
    getObjType: (itemId: number) => ObjType | undefined;
}

export interface ExaminePacket {
    type: string;
    locId?: number;
    npcId?: number;
    itemId?: number;
    worldX?: number;
    worldY?: number;
}

export function handleExaminePacket(
    deps: ExamineHandlerDeps,
    ws: WebSocket,
    packet: ExaminePacket,
): boolean {
    const player = deps.getPlayer(ws);
    if (!player) {
        return false;
    }

    switch (packet.type) {
        case "examine_loc": {
            if (packet.locId === undefined) return false;
            const locText = resolveLocExamineText(deps.locTypeLoader, player, packet.locId);
            if (locText) deps.queuePlayerGameMessage(player, locText);
            return true;
        }

        case "examine_npc": {
            if (packet.npcId === undefined) return false;
            const npcText = resolveNpcExamineText(deps.npcTypeLoader, packet.npcId);
            if (npcText) deps.queuePlayerGameMessage(player, npcText);
            return true;
        }

        case "examine_obj": {
            if (packet.worldX === undefined || packet.worldY === undefined) return false;
            if (packet.itemId === undefined) return false;
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

            const objText = resolveObjExamineText(deps.objTypeLoader, packet.itemId);
            if (objText) deps.queuePlayerGameMessage(player, objText);
            return true;
        }

        default:
            return false;
    }
}

export function resolveNpcOptionByOpNum(
    getNpcType: (npc: NpcState) => NpcType | undefined,
    npc: NpcState,
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
    locTypeLoader: TypeLoader<LocType> | undefined,
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
        const def = (visible?.type ?? locTypeLoader?.load?.(locId)) as LocType | undefined;
        const raw = Array.isArray(def?.actions) ? def.actions[idx] : undefined;
        if (!raw) return undefined;
        const normalized = raw.trim();
        return normalized.length > 0 ? normalized : undefined;
    } catch {
        return undefined;
    }
}

export function resolveGroundItemOptionByOpNum(
    getObjType: (itemId: number) => ObjType | undefined,
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

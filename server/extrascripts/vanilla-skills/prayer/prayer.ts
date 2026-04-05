import { SkillId } from "../../../../src/rs/skill/skills";
import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import { BURIABLE_BONES_XP, DEMONIC_ASHES_XP } from "./prayerData";
import { formatBuryMessage, formatScatterMessage } from "./prayerMessages";

const BURY_BONE_SEQ = 827;
const BURY_BONE_SOUND = 2738;
const SCATTER_ASHES_SEQ = 2295;
const SCATTER_ASHES_SOUND = 2738;
const BURY_COOLDOWN_TICKS = 2;
const SCATTER_COOLDOWN_TICKS = 2;

const lastBuryTick: Map<number, number> = new Map();
const lastScatterTick: Map<number, number> = new Map();

type PendingBury = {
    at: number;
    player: any;
    itemId: number;
    xp: number;
    message?: string;
};
const pending: PendingBury[] = [];

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    const ids = Array.from(BURIABLE_BONES_XP.keys());
    const ashesIds = Array.from(DEMONIC_ASHES_XP.keys());

    registry.registerTickHandler(({ tick, services: svc }) => {
        if (pending.length === 0) return;
        for (let i = pending.length - 1; i >= 0; i--) {
            const job = pending[i];
            if (job.at <= tick) {
                try {
                    svc?.addSkillXp?.(job.player, SkillId.Prayer, job.xp);
                    const text = job.message ?? formatBuryMessage();
                    svc.sendGameMessage(job.player, text);
                } finally {
                    pending.splice(i, 1);
                }
            }
        }
    });

    const bury = (id: number) =>
        registry.registerItemAction(
            id,
            ({ tick, player, source, services: svc }) => {
                const slot = source.slot;
                const itemId = source.itemId;
                const xp = BURIABLE_BONES_XP.get(itemId) ?? 5;
                const consume = svc?.consumeItem;
                const pid = player?.id as number;
                const last = lastBuryTick.get(pid) ?? -Infinity;
                if (tick <= last + BURY_COOLDOWN_TICKS) return;

                if (!consume || !consume(player, slot)) return;
                lastBuryTick.set(pid, tick);

                svc?.playPlayerSeq?.(player, BURY_BONE_SEQ);
                svc?.playLocSound?.({
                    soundId: BURY_BONE_SOUND,
                    tile: { x: player.tileX, y: player.tileY },
                    level: player.level,
                });
                const name = (() => {
                    try {
                        const obj = svc?.getObjType?.(itemId);
                        return (obj?.name as string) || "bones";
                    } catch {
                        return "bones";
                    }
                })();
                pending.push({
                    at: tick + BURY_COOLDOWN_TICKS,
                    player,
                    itemId: itemId,
                    xp: xp,
                    message: formatBuryMessage(name),
                });
                if (svc) {
                    svc.snapshotInventoryImmediate(player);
                }
            },
            "bury",
        );

    const scatter = (id: number) =>
        registry.registerItemAction(
            id,
            ({ tick, player, source, services: svc }) => {
                const slot = source.slot;
                const itemId = source.itemId;
                const xp = DEMONIC_ASHES_XP.get(itemId) ?? 10;
                const consume = svc?.consumeItem;
                const pid = player?.id as number;
                const last = lastScatterTick.get(pid) ?? -Infinity;
                if (tick <= last + SCATTER_COOLDOWN_TICKS) return;

                if (!consume || !consume(player, slot)) return;
                lastScatterTick.set(pid, tick);

                svc?.playPlayerSeq?.(player, SCATTER_ASHES_SEQ);
                svc?.playLocSound?.({
                    soundId: SCATTER_ASHES_SOUND,
                    tile: { x: player.tileX, y: player.tileY },
                    level: player.level,
                });
                const name = (() => {
                    try {
                        const obj = svc?.getObjType?.(itemId);
                        return (obj?.name as string) || "ashes";
                    } catch {
                        return "ashes";
                    }
                })();
                pending.push({
                    at: tick + SCATTER_COOLDOWN_TICKS,
                    player,
                    itemId: itemId,
                    xp: xp,
                    message: formatScatterMessage(name),
                });
                if (svc) {
                    svc.snapshotInventoryImmediate(player);
                }
            },
            "scatter",
        );
    for (const id of ids) bury(id);
    for (const id of ashesIds) scatter(id);
}

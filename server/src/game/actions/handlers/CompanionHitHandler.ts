import { HITMARK_DAMAGE } from "../../combat/HitEffects";
import type { NpcState } from "../../npc";
import type { PlayerState } from "../../player";
import type { CombatCompanionHitActionData } from "../actionPayloads";
import type { ActionEffect, ActionExecutionResult } from "../types";
import type { CombatActionServices } from "./CombatActionHandler";

export type NpcDeathDelegate = (
    player: PlayerState,
    npc: NpcState,
    tick: number,
    effects: ActionEffect[],
) => ActionExecutionResult;

export class CompanionHitHandler {
    private readonly services: CombatActionServices;
    private readonly npcDeathDelegate: NpcDeathDelegate;

    constructor(services: CombatActionServices, npcDeathDelegate: NpcDeathDelegate) {
        this.services = services;
        this.npcDeathDelegate = npcDeathDelegate;
    }

    executeCombatCompanionHitAction(
        player: PlayerState,
        data: CombatCompanionHitActionData,
        tick: number,
    ): ActionExecutionResult {
        const companionNpcId = data.companionNpcId | 0;
        const targetNpcId = data.targetNpcId | 0;
        const companion = this.services.getNpc(companionNpcId);
        if (!companion) {
            return {
                ok: false,
                reason: companionNpcId > 0 ? "companion_not_found" : "invalid_companion",
            };
        }

        const follower = companion.getFollowerState();
        if (!follower || follower.ownerPlayerId !== player.id) {
            return { ok: false, reason: "not_owner" };
        }

        const npc = this.services.getNpc(targetNpcId);
        if (!npc) {
            return { ok: false, reason: targetNpcId > 0 ? "npc_not_found" : "invalid_npc" };
        }
        if (npc.level !== companion.level || npc.level !== player.level) {
            return { ok: false, reason: "different_plane" };
        }
        if (npc.isPlayerFollower?.() === true) {
            return { ok: false, reason: "npc_unattackable" };
        }
        if (npc.getHitpoints() <= 0 || npc.isDead(tick)) {
            return { ok: false, reason: "npc_dead" };
        }

        const effects: ActionEffect[] = [];
        const damage = Math.max(0, data.damage ?? 0);
        const maxHit = Math.max(0, data.maxHit ?? 0);
        const style = Number.isFinite(data.style) ? (data.style as number) : HITMARK_DAMAGE;
        const type2 = Number.isFinite(data.type2) ? data.type2 : undefined;
        const damage2 = Number.isFinite(data.damage2) ? data.damage2 : undefined;
        const attackTypeHint = this.services.normalizeAttackType(data.attackType) ?? "melee";

        const npcHitsplat = this.services.applyNpcHitsplat(npc, style, damage, tick, maxHit);
        if (npcHitsplat.hpCurrent > 0) {
            const npcCombatSeq = this.services.getNpcCombatSequences(npc.typeId);
            if (npcCombatSeq?.block !== undefined) {
                this.services.broadcastNpcSequence(npc, npcCombatSeq.block);
            }
        }

        npc.engageCombat(player.id, tick);

        const sock = this.services.getPlayerSocket(player.id);
        this.services.confirmHitLanded(
            player.id,
            tick,
            npc,
            Math.max(0, npcHitsplat.amount),
            attackTypeHint,
            player,
        );

        const hpFields =
            npcHitsplat.amount > 0
                ? { hpCurrent: npcHitsplat.hpCurrent, hpMax: npcHitsplat.hpMax }
                : {};
        effects.push({
            type: "hitsplat",
            playerId: player.id,
            targetType: "npc",
            targetId: npc.id,
            damage: npcHitsplat.amount,
            style: npcHitsplat.style,
            type2,
            damage2,
            sourceType: "follower",
            sourcePlayerId: player.id,
            tick,
            ...hpFields,
        });

        if (npcHitsplat.hpCurrent <= 0) {
            return this.npcDeathDelegate(player, npc, tick, effects);
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }
}

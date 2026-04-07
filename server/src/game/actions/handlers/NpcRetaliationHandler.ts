import {
    canNpcAttackPlayerFromCurrentPosition,
} from "../../combat/CombatAction";
import { HITMARK_DAMAGE } from "../../combat/HitEffects";
import type { NpcState } from "../../npc";
import type { PlayerState } from "../../player";
import type { CombatNpcRetaliateActionData } from "../actionPayloads";
import type { ActionEffect, ActionExecutionResult } from "../types";
import type { CombatActionServices, InteractionState } from "./CombatActionHandler";

const DEFAULT_BLOCK_SEQ = 403;
const COMBAT_SOUND_DELAY_MS = 150;

export class NpcRetaliationHandler {
    private readonly services: CombatActionServices;

    constructor(services: CombatActionServices) {
        this.services = services;
    }

    executeCombatNpcRetaliateAction(
        player: PlayerState,
        data: CombatNpcRetaliateActionData,
        tick: number,
    ): ActionExecutionResult {
        const npcId = data.npcId;

        const npc = this.services.getNpc(npcId);
        if (!npc) {
            return { ok: false, reason: npcId > 0 ? "npc_not_found" : "invalid_npc" };
        }
        if (npc.level !== player.level) {
            return { ok: false, reason: "different_plane" };
        }
        // Do not allow retaliation swings/hits from dead NPCs.
        // This prevents delayed retaliation hitsplats appearing after NPC death.
        if (npc.getHitpoints() <= 0 || npc.isDead(tick)) {
            return { ok: false, reason: "npc_dead" };
        }

        const effects: ActionEffect[] = [];
        const phase = data.phase === "swing" || data.phase === "hit" ? data.phase : "hit";

        if (phase === "swing") {
            return this.handleNpcRetaliateSwing(player, npc, data, tick, effects);
        }

        // Hit phase
        const {
            damage: rawDamage = 0,
            maxHit: rawMaxHit = 0,
            style = HITMARK_DAMAGE,
            type2: rawType2,
            damage2: rawDamage2,
            attackType: rawAttackType,
        } = data;
        const damage = Math.max(0, rawDamage);
        const maxHit = Math.max(0, rawMaxHit);
        const attackType = this.services.resolveNpcAttackType(
            npc,
            this.services.normalizeAttackType(rawAttackType) ?? undefined,
        );
        const mitigatedDamage = this.services.applyProtectionPrayers(
            player,
            damage,
            attackType,
            "npc",
        );
        const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
        const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;

        const playerHitsplat = this.services.applyPlayerHitsplat(
            player,
            style,
            mitigatedDamage,
            tick,
            maxHit,
        );
        this.services.tryActivateRedemption(player);
        this.services.closeInterruptibleInterfaces(player);

        npc.engageCombat(player.id, tick);

        // Player block animation - only play block animation if no other
        // animation is pending. This prevents block animations from interrupting attack
        // animations when the player attacks and gets hit on the same or adjacent tick.
        // In OSRS, attack animations have effective priority over block animations due
        // to timing, even though they may have the same forcedPriority value.
        if (!player.hasPendingSeq()) {
            const blockSeqCandidate = this.services.pickBlockSequence(player);
            const blockSeq = blockSeqCandidate >= 0 ? blockSeqCandidate : DEFAULT_BLOCK_SEQ;
            player.queueOneShotSeq(blockSeq, 0);
        }

        // Handle auto-retaliate
        const sock = this.services.getPlayerSocket(player.id);
        const interactionState = this.services.getInteractionState(sock);
        if (player.combat.autoRetaliate && sock) {
            this.handlePlayerAutoRetaliate(player, npc, sock, interactionState, tick);
        }

        this.services.log(
            "info",
            `[combat] NPC ${npc.id} retaliate on player ${player.id} - tick ${tick}, damage ${damage}`,
        );

        // Emit hitsplat effect
        // Note: blockSeq is intentionally NOT included here because it's already sent
        // via player sync (queueOneShotSeq above). Sending on both paths caused the
        // animation to restart/play partially when both arrived on the client.
        effects.push({
            type: "hitsplat",
            playerId: player.id,
            targetType: "player",
            targetId: player.id,
            damage: playerHitsplat.amount,
            style: playerHitsplat.style,
            type2,
            damage2,
            sourceType: "npc",
            tick,
            hpCurrent: playerHitsplat.hpCurrent,
            hpMax: playerHitsplat.hpMax,
        });

        // NPC attack sound
        const npcAttackSoundId = this.services.getNpcAttackSoundId(npc.typeId);
        this.services.withDirectSendBypass("combat_npc_sound", () =>
            this.services.broadcastSound(
                {
                    soundId: npcAttackSoundId,
                    x: npc.tileX,
                    y: npc.tileY,
                    level: npc.level,
                    delay: COMBAT_SOUND_DELAY_MS,
                },
                "combat_npc_sound",
            ),
        );

        // Keep the player-side combat focus alive after a successful retaliation.
        this.services.extendAggroHold(player.id, 6);

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    handleNpcRetaliateSwing(
        player: PlayerState,
        npc: NpcState,
        data: CombatNpcRetaliateActionData,
        tick: number,
        effects: ActionEffect[],
    ): ActionExecutionResult {
        const pathService = this.services.getPathService();
        const attackType = this.services.resolveNpcAttackType(
            npc,
            this.services.normalizeAttackType(data.attackType) ?? undefined,
        );
        const attackRange = this.services.resolveNpcAttackRange(npc, attackType);
        if (
            !canNpcAttackPlayerFromCurrentPosition(npc, player, attackRange, attackType, {
                pathService,
            })
        ) {
            return { ok: false, reason: "not_in_range" };
        }
        player.refreshActiveCombatTimer();

        // Play attack animation
        const npcCombatSeq = this.services.getNpcCombatSequences(npc.typeId);
        if (npcCombatSeq?.attack !== undefined) {
            npc.queueOneShotSeq(npcCombatSeq.attack, 0);
            this.services.broadcastNpcSequence(npc, npcCombatSeq.attack);
            npc.popPendingSeq();
        }

        // Schedule hit.
        // Melee retaliation hits resolve 1 tick after swing; ranged/magic keep their travel delay.

        // Compute damage if not provided (e.g., for aggression-initiated attacks)
        const {
            damage: rawDamage = 0,
            maxHit: rawMaxHit = 0,
            isAggression = false,
            style = HITMARK_DAMAGE,
            type2: rawType2,
            damage2: rawDamage2,
            hitDelay: rawHitDelay = 1,
        } = data;
        let damage = Math.max(0, rawDamage);
        const maxHit = Math.max(0, rawMaxHit);
        if (damage === 0 && isAggression) {
            // Roll NPC damage for aggression attack using actual NPC stats
            damage = this.services.rollRetaliateDamage(npc, player);
        }
        const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
        const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;
        const hitDelay = Math.max(1, rawHitDelay);
        const enqueueResult = this.services.scheduleAction(
            player.id,
            {
                kind: "combat.npcRetaliate",
                data: {
                    npcId: npc.id,
                    damage,
                    maxHit,
                    style,
                    type2,
                    damage2,
                    attackType,
                    phase: "hit",
                },
                groups: ["combat.retaliate"],
                cooldownTicks: 0,
                delayTicks: hitDelay,
            },
            tick,
        );
        if (!enqueueResult.ok) {
            this.services.log(
                "warn",
                `[combat] failed to schedule npc retaliation hit (player=${player.id}, npc=${
                    npc.id
                }): ${enqueueResult.reason ?? "unknown"}`,
            );
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    handlePlayerAutoRetaliate(
        player: PlayerState,
        npc: NpcState,
        sock: unknown,
        interactionState: InteractionState | undefined,
        tick: number,
    ): void {
        const npcId = npc.id;

        if (interactionState?.kind === "playerCombat") {
            // Do not interrupt PvP combat
            return;
        }
        if (interactionState?.kind === "npcCombat" && (interactionState.npcId ?? 0) !== npcId) {
            // Do not switch from existing NPC target
            return;
        }
        if (interactionState?.kind === "npcCombat" && (interactionState.npcId ?? 0) === npcId) {
            this.services.resumeAutoAttack(player.id);
            player.setInteraction("npc", npc.id);
            return;
        }

        // Start new combat
        const attackSpeed = this.services.pickAttackSpeed(player);
        const res = this.services.startNpcAttack(sock, npc, tick, attackSpeed);
        if (res.ok) {
            player.setInteraction("npc", npc.id);
            this.services.startNpcCombat(player, npc, tick, attackSpeed);
        } else {
            this.services.log(
                "info",
                `[combat] auto-retaliate failed (player=${player.id}, npc=${npc.id}): ${
                    res.message ?? "reason_unknown"
                }`,
            );
        }
    }
}

/**
 * PvP combat handler.
 *
 * Extracted from CombatActionHandler — handles PvP-specific combat methods:
 * - executeCombatAutocastAction (autocast spell attack in PvP)
 * - executePlayerVsPlayerHit (PvP hit resolution)
 * - handlePvpAutoRetaliate (auto-retaliation in PvP)
 * - handleMagicPvpEffects (magic spell effects in PvP)
 */
import { logger } from "../../../utils/logger";
import { getPoweredStaffSpellData } from "../../spells/SpellDataProvider";
import type { PoweredStaffSpellData } from "../../spells/SpellDataProvider";
import { HITMARK_DAMAGE } from "../../combat/HitEffects";
import type { PlayerState } from "../../player";
import type { CombatAutocastActionData, CombatPlayerHitActionData } from "../actionPayloads";
import type { ActionEffect, ActionExecutionResult } from "../types";
import type { CombatActionServices } from "./CombatActionHandler";

// ============================================================================
// Constants
// ============================================================================

const COMBAT_SOUND_DELAY_MS = 150;

// ============================================================================
// Handler Class
// ============================================================================

/**
 * Handles PvP combat action execution.
 */
export class PvpCombatHandler {
    constructor(private readonly services: CombatActionServices) {}

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Execute combat autocast action (PvP magic autocast).
     */
    executeCombatAutocastAction(
        player: PlayerState,
        data: CombatAutocastActionData,
        tick: number,
    ): ActionExecutionResult {
        // Keep autocast pacing consistent even on failure
        try {
            player.combat.lastSpellCastTick = tick;
        } catch (err) { logger.warn("[combat] failed to set last spell cast tick", err); }

        const targetId = data.targetId;
        const target = targetId > 0 ? this.services.getPlayer(targetId) : undefined;
        const sock = this.services.getPlayerSocket(player.id);
        const interactionState = sock ? this.services.getInteractionState(sock) : undefined;

        if (
            !target ||
            !interactionState ||
            interactionState.kind !== "playerCombat" ||
            (interactionState.playerId ?? 0) !== targetId
        ) {
            try {
                if (sock) this.services.stopPlayerCombat(sock);
            } catch (err) { logger.warn("[combat] failed to stop player combat on invalid target", err); }
            return { ok: true, cooldownTicks: 0, groups: [], effects: [] };
        }

        const spellIdRaw = data.spellId ?? -1;
        const spellId = spellIdRaw > 0 ? spellIdRaw : player.combat.spellId ?? -1;
        if (!(spellId > 0)) {
            this.services.log(
                "info",
                `[combat] disabling autocast (pvp) for player ${player.id}: missing spellId`,
            );
            this.disableAutocast(player, sock);
            return { ok: true, cooldownTicks: 0, groups: [], effects: [] };
        }

        const castModeRaw = String(data.castMode ?? "autocast");
        const castMode =
            castModeRaw === "defensive_autocast" ? "defensive_autocast" : ("autocast" as const);

        const outcome = this.services.processSpellCastRequest(player, {
            spellId: spellId,
            modifiers: { isAutocast: true, castMode },
            target: { type: "player", playerId: target.id },
        });
        this.services.queueSpellResult(player.id, outcome);

        const reason = outcome.reason;
        const shouldKeepAutocasting =
            reason === "out_of_range" || reason === "line_of_sight" || reason === "cooldown";
        if (outcome.outcome === "failure" && !shouldKeepAutocasting) {
            this.services.log(
                "info",
                `[combat] disabling autocast (pvp) for player ${
                    player.id
                }: spellId=${spellId} targetId=${targetId} reason=${String(reason ?? "unknown")}`,
            );
            this.disableAutocast(player, sock);
        }

        return { ok: true, cooldownTicks: 0, groups: [], effects: [] };
    }

    /**
     * Execute player-vs-player hit action.
     */
    executePlayerVsPlayerHit(
        player: PlayerState,
        data: CombatPlayerHitActionData,
        tick: number,
    ): ActionExecutionResult {
        const {
            targetId = -1,
            damage: rawDamage = 0,
            maxHit: rawMaxHit = 0,
            style = HITMARK_DAMAGE,
            type2: rawType2,
            damage2: rawDamage2,
            landed,
            expectedHitTick = 0,
            spellId: explicitSpellIdRaw,
            attackType: rawAttackType,
        } = data;
        const damage = Math.max(0, rawDamage);
        const maxHit = Math.max(0, rawMaxHit);
        const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
        const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;
        const providedAttackType = this.services.normalizeAttackType(rawAttackType);
        const attackType =
            providedAttackType ?? this.services.deriveAttackTypeFromStyle(style, player);

        const target = this.services.getPlayer(targetId);
        if (!target) {
            this.services.log(
                "warn",
                `[combat] Player-vs-player hit failed: target player ${targetId} not found`,
            );
            return { ok: false, reason: "target_not_found" };
        }

        const effects: ActionEffect[] = [];
        target.refreshActiveCombatTimer();

        // Apply damage with protection prayers
        const currentHp = target.skillSystem.getHitpointsCurrent?.() ?? 0;
        const actualDamage = Math.min(damage, currentHp);
        const mitigatedDamage = this.services.applyProtectionPrayers(
            target,
            actualDamage,
            attackType,
            "player",
        );
        const landedFlag = landed === true ? true : landed === false ? false : undefined;

        // Apply damage
        const targetHitsplat = this.services.applyPlayerHitsplat(
            target,
            style,
            mitigatedDamage,
            tick,
            maxHit,
        );
        this.services.applySmite(player, target, targetHitsplat.amount);
        this.services.tryActivateRedemption(target);
        this.services.closeInterruptibleInterfaces(target);

        this.services.log(
            "info",
            `[combat] Player ${player.id} hit player ${targetId} for ${targetHitsplat.amount} damage (style=${style}, attackType=${attackType})`,
        );

        // Stop one-shot spell interaction (keep for autocast)
        try {
            if (!player.combat.autocastEnabled) {
                const sock = this.services.getPlayerSocket(player.id);
                if (sock) this.services.stopPlayerCombat(sock);
            }
        } catch (err) { logger.warn("[combat] failed to stop combat after pvp hit", err); }

        // PvP auto-retaliate for target
        this.handlePvpAutoRetaliate(player, target, targetId);

        // Emit hitsplat
        const hitsplatTick = expectedHitTick > 0 ? expectedHitTick : tick;
        const isMagicAttack = attackType === "magic";
        const didLand = landedFlag ?? targetHitsplat.amount > 0;

        if (!(isMagicAttack && !didLand)) {
            const hpFields =
                targetHitsplat.amount > 0
                    ? {
                          hpCurrent: targetHitsplat.hpCurrent,
                          hpMax: targetHitsplat.hpMax,
                      }
                    : {};
            effects.push({
                type: "hitsplat",
                playerId: player.id,
                targetType: "player",
                targetId: targetId,
                damage: targetHitsplat.amount,
                style: targetHitsplat.style,
                type2,
                damage2,
                sourceType: "player",
                sourcePlayerId: player.id,
                tick: hitsplatTick,
                ...hpFields,
            });
        }

        // Magic-specific effects
        if (isMagicAttack) {
            const resolvedSpellId =
                typeof explicitSpellIdRaw === "number" &&
                Number.isFinite(explicitSpellIdRaw) &&
                explicitSpellIdRaw > 0
                    ? explicitSpellIdRaw
                    : player.combat.spellId ?? -1;
            this.handleMagicPvpEffects(
                player,
                target,
                targetId,
                didLand,
                hitsplatTick,
                effects,
                resolvedSpellId,
                targetHitsplat.amount,
            );
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    /**
     * Handle PvP auto-retaliate for the target player.
     */
    handlePvpAutoRetaliate(
        attacker: PlayerState,
        target: PlayerState,
        targetId: number,
    ): void {
        try {
            if (
                target.combat.autoRetaliate &&
                target.combat.autocastEnabled &&
                Number.isFinite(target.combat.spellId) &&
                target.combat.spellId > 0
            ) {
                const targetSock = this.services.getPlayerSocket(targetId);
                if (targetSock) {
                    const st = this.services.getInteractionState(targetSock);
                    const alreadyOnAttacker =
                        st?.kind === "playerCombat" && (st.playerId ?? 0) === attacker.id;
                    const isIdle = !st;
                    const isBusyNpc = st?.kind === "npcCombat";
                    const isBusyPlayer = st?.kind === "playerCombat" && !alreadyOnAttacker;
                    if (!isBusyNpc && !isBusyPlayer && (isIdle || alreadyOnAttacker)) {
                        this.services.startPlayerCombat(targetSock, attacker.id);
                    }
                }
            }
        } catch (err) { logger.warn("[combat] failed to handle pvp auto-retaliate", err); }
    }

    /**
     * Handle magic PvP effects (sounds, stat debuffs, spot anims, freeze, blood healing, poison).
     */
    handleMagicPvpEffects(
        player: PlayerState,
        target: PlayerState,
        targetId: number,
        landed: boolean,
        hitsplatTick: number,
        effects: ActionEffect[],
        spellIdOverride?: number,
        damageDealt?: number,
    ): void {
        const spellId =
            (Number.isFinite(spellIdOverride) ? spellIdOverride : undefined) ??
            player.combat.spellId ??
            -1;
        const spell = spellId > 0 ? this.services.getSpellData(spellId) : undefined;
        const weaponId = player.combat.weaponItemId ?? -1;
        const poweredStaffData = weaponId > 0 ? getPoweredStaffSpellData(weaponId) : undefined;

        const sfx = this.pickResolvedMagicSound(spellId, landed, poweredStaffData);
        if (sfx !== undefined) {
            this.services.withDirectSendBypass("combat_player_hit_sound", () =>
                this.services.broadcastSound(
                    {
                        soundId: sfx,
                        x: target.tileX,
                        y: target.tileY,
                        level: target.level,
                        delay: COMBAT_SOUND_DELAY_MS,
                    },
                    "combat_player_hit_sound",
                ),
            );
        }

        // Stat debuffs
        if (spell?.statDebuff && landed) {
            const targetSock = this.services.getPlayerSocket(targetId);
            const skillId =
                spell.statDebuff.stat === "attack"
                    ? 0
                    : spell.statDebuff.stat === "strength"
                    ? 2
                    : 1;
            const cur = target.skillSystem.getSkill(skillId);
            const currentLevel = Math.max(1, cur.baseLevel + cur.boost);
            const drop = Math.max(
                1,
                Math.floor((currentLevel * Math.max(0, spell.statDebuff.percent)) / 100),
            );
            const newLevel = Math.max(1, currentLevel - drop);
            target.skillSystem.setSkillBoost(skillId, newLevel);
            if (targetSock) this.services.sendSkillsMessage(targetSock, target);
        }

        // Spot animation
        const impactSpotAnim = spell?.impactSpotAnim ?? poweredStaffData?.impactSpotAnim;
        const splashSpotAnim = spell?.splashSpotAnim ?? poweredStaffData?.splashSpotAnim;
        const spotId = landed ? impactSpotAnim : splashSpotAnim ?? impactSpotAnim;
        if (spotId !== undefined && spotId >= 0) {
            this.services.enqueueSpotAnimation({
                tick: hitsplatTick,
                playerId: targetId,
                spotId: spotId,
                delay: 0,
                height: landed ? (spell?.impactSpotAnimHeight ?? 100) : 100,
            });
        }

        // Freeze
        if (spell?.freezeDuration && landed) {
            target.applyFreeze(spell.freezeDuration, hitsplatTick);
        }

        // Blood spell healing: heal caster for 25% of damage dealt
        const dealt = Math.max(0, damageDealt ?? 0);
        if (spell?.healPercent && landed && dealt > 0) {
            const healAmount = Math.floor(dealt * spell.healPercent);
            if (healAmount > 0) {
                player.skillSystem.applyHitpointsHeal(healAmount);
            }
        }

        // Smoke spell poison: apply poison to target on hit
        if (spell?.poisonDamage && landed && dealt > 0) {
            target.skillSystem.inflictPoison(spell.poisonDamage, hitsplatTick);
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private disableAutocast(player: PlayerState, sock: unknown | undefined): void {
        try {
            this.services.resetAutocast(player);
        } catch (err) { logger.warn("[combat] failed to reset autocast", err); }
        try {
            if (sock) this.services.stopPlayerCombat(sock);
        } catch (err) { logger.warn("[combat] failed to stop combat after autocast disable", err); }
    }

    private pickResolvedMagicSound(
        spellId: number,
        landed: boolean,
        poweredStaffData?: PoweredStaffSpellData,
    ): number | undefined {
        if (spellId > 0) {
            return this.services.pickSpellSound(spellId, landed ? "impact" : "splash");
        }
        if (!landed && poweredStaffData) {
            return this.services.pickSpellSound(0, "splash");
        }
        if (landed && poweredStaffData?.impactSoundId) {
            return poweredStaffData.impactSoundId;
        }
        return undefined;
    }
}

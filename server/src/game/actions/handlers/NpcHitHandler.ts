/**
 * NPC hit resolution handler.
 *
 * Extracted from CombatActionHandler — handles:
 * - executeCombatPlayerHitAction (NPC hit resolution path)
 * - handleNpcDeath (NPC death/drops/respawn)
 * - handleAmmoEffects (ammo bolt effects on NPC)
 * - handleSpecialAttackEffects (special attack effects)
 * - handleMagicNpcEffects (magic effects on NPC)
 * - playCombatSounds / pickResolvedMagicSound (sound helpers)
 */
import { logger } from "../../../utils/logger";
import { getPoweredStaffSpellData } from "../../spells/SpellDataProvider";
import type { PoweredStaffSpellData } from "../../spells/SpellDataProvider";
import type { AttackType } from "../../combat/AttackType";
import { HITMARK_DAMAGE } from "../../combat/HitEffects";
import type { NpcState } from "../../npc";
import type { PlayerState } from "../../player";
import type {
    CombatAttackActionData,
    CombatNpcRetaliateActionData,
    CombatPlayerHitActionData,
} from "../actionPayloads";
import type { ActionEffect, ActionExecutionResult } from "../types";
import type { CombatActionServices, SpecialAttackPayload } from "./CombatActionHandler";

// ============================================================================
// Constants
// ============================================================================

const COMBAT_SOUND_DELAY_MS = 150;

// ============================================================================
// Types
// ============================================================================

/** Delegate for PvP hit resolution (wired by the coordinator). */
export type PvpHitDelegate = (
    player: PlayerState,
    data: CombatPlayerHitActionData,
    tick: number,
) => ActionExecutionResult;

// ============================================================================
// Handler Class
// ============================================================================

/**
 * Handles NPC hit resolution, death, and related combat effects.
 */
export class NpcHitHandler {
    constructor(
        private readonly services: CombatActionServices,
        private readonly pvpHitDelegate?: PvpHitDelegate,
    ) {}

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Execute combat player hit action (damage resolution).
     */
    executeCombatPlayerHitAction(
        player: PlayerState,
        data: CombatPlayerHitActionData,
        tick: number,
    ): ActionExecutionResult {
        const targetPlayerId = data.targetId ?? -1;
        const npcId = data.npcId ?? -1;

        // Player-vs-player hit
        if (targetPlayerId > 0 && !npcId) {
            if (this.pvpHitDelegate) {
                return this.pvpHitDelegate(player, data, tick);
            }
            return { ok: false, reason: "pvp_not_supported" };
        }

        // NPC combat
        const npc = this.services.getNpc(npcId);
        if (!npc) {
            return { ok: false, reason: npcId > 0 ? "npc_not_found" : "invalid_npc" };
        }
        if (npc.level !== player.level) {
            return { ok: false, reason: "different_plane" };
        }
        if (npc.isPlayerFollower?.() === true) {
            return { ok: false, reason: "npc_unattackable" };
        }

        const effects: ActionEffect[] = [];

        // once the swing/cast action has executed and queued this delayed hit,
        // movement no longer cancels it. The only hard stop here is that the target is dead.
        // Dead attackers are already handled by ActionScheduler.processTick(), which skips
        // executing further queued actions for players with 0 HP.
        const attackTypeHint = this.services.normalizeAttackType(
            data.hit?.attackType ?? data.attackType,
        );
        const isMagicAttack = attackTypeHint === "magic";

        // Once an attack is initiated (animation starts), the hit always lands
        // regardless of whether the player switches targets or clicks away mid-attack.
        // The target NPC ID is baked into the delayed hit action, so we just apply damage.
        const sock = this.services.getPlayerSocket(player.id);

        // Validate NPC is still alive
        if (npc.getHitpoints() <= 0) {
            return { ok: false, reason: "target_already_dead" };
        }

        const {
            damage: rawDamage = 0,
            maxHit: rawMaxHit = 0,
            style = HITMARK_DAMAGE,
            type2: rawType2,
            damage2: rawDamage2,
            clientDelayTicks: rawClientDelayTicks = 0,
            expectedHitTick = 0,
            landed,
            spellId: explicitSpellIdRaw,
            special,
            hitIndex: rawHitIndex = 0,
        } = data;
        const damage = Math.max(0, rawDamage);
        const maxHit = Math.max(0, rawMaxHit);
        const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
        const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;
        const clientDelayTicks = Math.max(0, rawClientDelayTicks);
        const hitsplatTick = expectedHitTick > 0 ? expectedHitTick : tick;

        // A spell "lands" when the accuracy roll passes, regardless of damage.
        // The landed flag should be set by CombatEngine based on accuracy, not damage.
        // Accept truthy values (not just strict boolean) to handle serialization edge cases.
        const hitLanded = this.resolveHitLanded(landed, style, damage);

        // Apply hitsplat to NPC
        const npcHitsplat = this.services.applyNpcHitsplat(
            npc,
            style,
            damage,
            hitsplatTick,
            maxHit,
        );
        if (npcHitsplat.hpCurrent > 0) {
            const npcCombatSeq = this.services.getNpcCombatSequences(npc.typeId);
            if (npcCombatSeq?.block !== undefined) {
                this.services.broadcastNpcSequence(npc, npcCombatSeq.block);
            }
        }

        // Handle ammo effects
        this.handleAmmoEffects(player, npc, data, npcHitsplat, hitsplatTick);

        // Refresh NPC combat timer
        npc.engageCombat(player.id, tick);

        this.services.confirmHitLanded(
            player.id,
            tick,
            npc,
            Math.max(0, npcHitsplat.amount),
            attackTypeHint,
            player,
        );

        // Award combat XP
        const xpGrantedOnAttack =
            data.xpGrantedOnAttack === true || data.hit?.xpGrantedOnAttack === true;
        if (damage > 0 && hitLanded && !xpGrantedOnAttack) {
            this.services.awardCombatXp(player, damage, data.hit ?? data, effects);
        }

        // Apply special attack effects
        this.handleSpecialAttackEffects(player, npc, data, hitLanded, npcHitsplat, tick);

        // Emit hitsplat effect
        if (!(isMagicAttack && !hitLanded)) {
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
                sourceType: "player",
                sourcePlayerId: player.id,
                tick: hitsplatTick,
                delayTicks: clientDelayTicks,
                ...hpFields,
            });
        }

        // Magic spell effects
        if (isMagicAttack) {
            const resolvedSpellId =
                typeof explicitSpellIdRaw === "number" &&
                Number.isFinite(explicitSpellIdRaw) &&
                explicitSpellIdRaw > 0
                    ? explicitSpellIdRaw
                    : player.combat.spellId ?? -1;
            this.handleMagicNpcEffects(
                player,
                npc,
                hitLanded,
                npcHitsplat,
                hitsplatTick,
                tick,
                effects,
                resolvedSpellId,
            );
        }

        // Per-hit sounds for multi-hit specials (e.g., dragon claws)
        // Sounds are staggered by ~150ms per hit to match OSRS visual timing
        const hitIndex = Math.max(0, rawHitIndex);
        if (
            special?.hitSounds &&
            Array.isArray(special.hitSounds) &&
            special.hitSounds.length > 0
        ) {
            const hitSoundId = special.hitSounds[Math.min(hitIndex, special.hitSounds.length - 1)];
            if (hitSoundId && hitSoundId > 0) {
                // Stagger sounds: hit 0 = 0ms, hit 1 = 150ms, hit 2 = 300ms, hit 3 = 450ms
                const soundDelay = hitIndex * 150;
                this.services.withDirectSendBypass("special_hit_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: hitSoundId,
                            x: npc.tileX,
                            y: npc.tileY,
                            level: npc.level,
                            delay: soundDelay,
                        },
                        "special_hit_sound",
                    ),
                );
            }
        } else {
            // Combat sounds (includes ranged impact sound for projectile attacks)
            this.playCombatSounds(player, npc, hitLanded, style, attackTypeHint);
        }

        // Handle NPC death
        if (npcHitsplat.hpCurrent <= 0) {
            return this.handleNpcDeath(player, npc, tick, effects);
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    handleNpcDeath(
        player: PlayerState,
        npc: NpcState,
        tick: number,
        effects: ActionEffect[],
    ): ActionExecutionResult {
        if (npc.isDead(tick)) {
            if (!this.services.isActiveFrame() && effects.length > 0) {
                this.services.dispatchActionEffects(effects);
            }
            return { ok: true, cooldownTicks: 0, groups: [], effects };
        }

        this.services.log("info", `[combat] NPC ${npc.id} (type ${npc.typeId}) died`);
        npc.clearInteractionTarget();

        // Prepare drops for delayed spawning (RSMod parity)
        const eligibility = this.services.getDropEligibility(npc);
        const inWilderness = this.services.isInWilderness(npc.tileX, npc.tileY);
        const pendingDrops = this.services
            .rollNpcDrops(npc, eligibility)
            .map((drop) => ({ ...drop, isWilderness: inWilderness }));

        // Death sequence
        const deathSeq = this.services.getNpcCombatSequences(npc.typeId)?.death;
        if (deathSeq !== undefined && deathSeq >= 0) {
            npc.queueOneShotSeq(deathSeq);
            this.services.broadcastNpcSequence(npc, deathSeq);
            npc.popPendingSeq();
        }

        // Death sound
        const deathSoundId = this.services.getNpcDeathSoundId(npc.typeId);
        if (deathSoundId !== undefined && deathSoundId > 0) {
            this.services.withDirectSendBypass("combat_npc_death_sound", () =>
                this.services.broadcastSound(
                    {
                        soundId: deathSoundId,
                        x: npc.tileX,
                        y: npc.tileY,
                        level: npc.level,
                        delay: COMBAT_SOUND_DELAY_MS,
                    },
                    "combat_npc_death_sound",
                ),
            );
        }

        // Clear interactions
        this.services.clearInteractionsWithNpc(npc.id);

        // Cancel pending combat actions for any player queue this NPC could have queued into.
        const affectedPlayerIds = new Set<number>([player.id]);
        const npcTargetPlayerId = npc.getCombatTargetPlayerId();
        if (npcTargetPlayerId !== undefined && npcTargetPlayerId >= 0) {
            affectedPlayerIds.add(npcTargetPlayerId);
        }
        for (const affectedPlayerId of affectedPlayerIds) {
            this.services.cancelActions(affectedPlayerId, (action) => {
                const actionNpcId =
                    action.kind === "combat.attack" ||
                    action.kind === "combat.playerHit" ||
                    action.kind === "combat.npcRetaliate"
                        ? (
                              action.data as
                                  | CombatAttackActionData
                                  | CombatPlayerHitActionData
                                  | CombatNpcRetaliateActionData
                          ).npcId
                        : undefined;
                return (
                    actionNpcId === npc.id &&
                    (action.groups.includes("combat.attack") ||
                        action.groups.includes("combat.retaliate") ||
                        action.groups.includes("combat.hit"))
                );
            });
        }

        // Queue respawn with delayed drops (RSMod parity)
        const RESPAWN_DELAY_TICKS = 17;
        const deathDelayTicks = this.services.estimateNpcDespawnDelayTicksFromSeq(deathSeq);
        const despawnTick = tick + Math.max(1, deathDelayTicks);
        const respawnTick = Math.max(tick + RESPAWN_DELAY_TICKS, despawnTick + 1);
        try {
            npc.markDeadUntil(despawnTick, tick);
        } catch (err) { logger.warn("[combat] failed to mark npc dead", err); }
        const queued = this.services.queueNpcDeath(npc.id, despawnTick, respawnTick, pendingDrops);
        if (!queued) {
            this.services.log(
                "warn",
                `[combat] Failed to queue NPC respawn (npc=${npc.id}, respawnTick=${respawnTick})`,
            );
        }

        this.services.cleanupNpc(npc);

        // Gamemode event: notify of NPC kill
        const killerId = eligibility?.primaryLooter?.id ?? player.id;
        this.services.onNpcKill(killerId, npc.typeId, npc.getCombatLevel(), npc);

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    handleAmmoEffects(
        player: PlayerState,
        npc: NpcState,
        data: CombatPlayerHitActionData,
        npcHitsplat: { amount: number },
        hitsplatTick: number,
    ): void {
        const ammoEffect = data.ammoEffect as
            | {
                  effectType?: string;
                  graphicId?: number;
                  selfDamage?: number;
                  leechPercent?: number;
                  poison?: boolean;
              }
            | undefined;

        if (!ammoEffect) return;

        if (typeof ammoEffect.graphicId === "number" && ammoEffect.graphicId > 0) {
            this.services.enqueueSpotAnimation({
                tick: hitsplatTick,
                npcId: npc.id,
                spotId: ammoEffect.graphicId,
                delay: 0,
            });
        }

        const dealt = Math.max(0, npcHitsplat.amount);
        if (ammoEffect.poison && dealt > 0) {
            npc.inflictPoison(5, hitsplatTick);
        }
        if (ammoEffect.leechPercent && dealt > 0) {
            const heal = Math.floor(dealt * Math.max(0, ammoEffect.leechPercent));
            if (heal > 0) {
                player.skillSystem.applyHitpointsHeal(heal);
            }
        }
        if (ammoEffect.selfDamage && ammoEffect.selfDamage > 0) {
            player.skillSystem.applyHitpointsDamage(Math.max(0, ammoEffect.selfDamage));
        }
    }

    handleSpecialAttackEffects(
        player: PlayerState,
        npc: NpcState,
        data: CombatPlayerHitActionData,
        landed: boolean,
        npcHitsplat: { amount: number },
        tick: number,
    ): void {
        const special = data.special as SpecialAttackPayload | undefined;
        const se = special?.effects;
        if (!se || !landed) return;

        const dealt = npcHitsplat.amount;

        // Freeze
        const freezeTicks = se.freezeTicks;
        if (typeof freezeTicks === "number" && Number.isFinite(freezeTicks) && freezeTicks > 0) {
            npc.applyFreeze(freezeTicks, tick);
        }

        // Heal on damage
        const healFraction = se.healFraction;
        if (
            dealt > 0 &&
            typeof healFraction === "number" &&
            Number.isFinite(healFraction) &&
            healFraction > 0
        ) {
            player.skillSystem.applyHitpointsHeal(Math.floor(dealt * healFraction));
        }

        // Prayer restore
        const prayerFraction = se.prayerFraction;
        if (
            dealt > 0 &&
            typeof prayerFraction === "number" &&
            Number.isFinite(prayerFraction) &&
            prayerFraction > 0
        ) {
            const restore = Math.floor(dealt * prayerFraction);
            if (restore > 0) {
                const current = player.prayer.getPrayerLevel();
                const base = player.skillSystem.getSkill(5).baseLevel; // SkillId.Prayer
                const target = Math.min(base, current + restore);
                player.skillSystem.setSkillBoost(5, target);
            }
        }

        const sync = player.skillSystem.takeSkillSync();
        if (sync) {
            this.services.queueSkillSnapshot(player.id, sync);
        }
    }

    handleMagicNpcEffects(
        player: PlayerState,
        npc: NpcState,
        landed: boolean,
        npcHitsplat: { amount: number; style: number },
        hitsplatTick: number,
        tick: number,
        effects: ActionEffect[],
        spellIdOverride?: number,
    ): void {
        const spellId =
            (Number.isFinite(spellIdOverride) ? spellIdOverride : undefined) ??
            player.combat.spellId ??
            -1;
        const spell = spellId > 0 ? this.services.getSpellData(spellId) : undefined;

        // For powered staves (Trident, Tumeken's Shadow, etc.), get built-in spell data
        const weaponId = player.combat.weaponItemId ?? -1;
        const poweredStaffData = weaponId > 0 ? getPoweredStaffSpellData(weaponId) : undefined;

        // Determine impact/splash spot animation from either regular spell or powered staff
        let impactSpotAnim: number | undefined;
        let splashSpotAnim: number | undefined;

        if (spell) {
            impactSpotAnim = spell.impactSpotAnim;
            splashSpotAnim = spell.splashSpotAnim;
        } else if (poweredStaffData) {
            // Powered staff built-in spell (Tumeken's Shadow, Trident, Sanguinesti, etc.)
            impactSpotAnim = poweredStaffData.impactSpotAnim;
            splashSpotAnim = poweredStaffData.splashSpotAnim;
        }

        // Spot animation
        const spotId = landed ? impactSpotAnim : splashSpotAnim ?? impactSpotAnim;
        if (spotId !== undefined && spotId >= 0) {
            this.services.enqueueSpotAnimation({
                tick: hitsplatTick,
                npcId: npc.id,
                spotId: spotId,
                delay: 0,
                height: landed ? (spell?.impactSpotAnimHeight ?? 100) : 100,
            });
        }

        const spellSoundId = this.pickResolvedMagicSound(spellId, landed, poweredStaffData);
        if (spellSoundId !== undefined) {
            this.services.withDirectSendBypass("combat_spell_impact_sound", () =>
                this.services.broadcastSound(
                    {
                        soundId: spellSoundId,
                        x: npc.tileX,
                        y: npc.tileY,
                        level: npc.level,
                        delay: COMBAT_SOUND_DELAY_MS,
                    },
                    "combat_spell_impact_sound",
                ),
            );
        }

        // Freeze and multi-target
        if (spell?.freezeDuration && landed) {
            npc.applyFreeze(spell.freezeDuration, tick);
        }

        // Blood spell healing: heal caster for 25% of damage dealt
        let primaryDamageForHeal = 0;
        if (spell?.healPercent && landed && npcHitsplat.amount > 0) {
            primaryDamageForHeal = npcHitsplat.amount;
        }

        // Smoke spell poison: apply poison to target on hit
        if (spell?.poisonDamage && landed && npcHitsplat.amount > 0) {
            npc.inflictPoison(spell.poisonDamage, tick);
        }

        if (spell?.maxTargets && spell.maxTargets > 1 && landed && npcHitsplat.amount > 0) {
            const multiResult = this.services.applyMultiTargetSpellDamage({
                player,
                primary: npc,
                spell,
                baseDamage: npcHitsplat.amount,
                style: npcHitsplat.style,
                hitsplatTick,
                currentTick: tick,
                effects,
            });
            // Accumulate secondary target damage for blood spell healing
            if (spell.healPercent && typeof multiResult === "number" && multiResult > 0) {
                primaryDamageForHeal += multiResult;
            }
        }

        // Apply blood spell heal from all targets combined (primary + secondaries)
        if (spell?.healPercent && primaryDamageForHeal > 0) {
            const healAmount = Math.floor(primaryDamageForHeal * spell.healPercent);
            if (healAmount > 0) {
                player.skillSystem.applyHitpointsHeal(healAmount);
            }
        }
    }

    pickResolvedMagicSound(
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

    playCombatSounds(
        player: PlayerState,
        npc: NpcState,
        landed: boolean,
        style: number,
        attackType?: AttackType,
    ): void {
        // Weapon sound is already played at attack time in executeCombatAttackAction
        // Here we play the NPC reaction sounds and ranged impact sounds when the hit lands
        const isHitForSound = landed && style === HITMARK_DAMAGE;

        // Play ranged projectile impact sound at target location
        // This is the sound of arrows/bolts/darts hitting (separate from weapon fire sound)
        if (attackType === "ranged") {
            const impactSoundId = this.services.getRangedImpactSound?.(player);
            if (impactSoundId !== undefined && impactSoundId > 0) {
                this.services.withDirectSendBypass("combat_ranged_impact_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: impactSoundId,
                            x: npc.tileX,
                            y: npc.tileY,
                            level: npc.level,
                        },
                        "combat_ranged_impact_sound",
                    ),
                );
            }
        }

        if (isHitForSound) {
            // NPC got hit - play their hit/pain sound
            const npcHitSoundId = this.services.getNpcHitSoundId(npc.typeId);
            if (npcHitSoundId !== undefined && npcHitSoundId > 0) {
                this.services.withDirectSendBypass("combat_npc_hit_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: npcHitSoundId,
                            x: npc.tileX,
                            y: npc.tileY,
                            level: npc.level,
                        },
                        "combat_npc_hit_sound",
                    ),
                );
            }
        } else {
            // Player missed - play NPC defend/block sound
            const npcDefendSoundId = this.services.getNpcDefendSoundId(npc.typeId);
            if (npcDefendSoundId !== undefined && npcDefendSoundId > 0) {
                this.services.withDirectSendBypass("combat_npc_defend_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: npcDefendSoundId,
                            x: npc.tileX,
                            y: npc.tileY,
                            level: npc.level,
                        },
                        "combat_npc_defend_sound",
                    ),
                );
            }
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private resolveHitLanded(landed: unknown, style: number, damage: number): boolean {
        return (
            landed === true ||
            landed === 1 ||
            landed === "true" ||
            (landed === undefined && style === HITMARK_DAMAGE) ||
            (landed === undefined && style !== HITMARK_DAMAGE && damage > 0)
        );
    }
}

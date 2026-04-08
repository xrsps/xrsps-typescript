import { combatEffectApplicator } from "../combat/CombatEffectApplicator";
import {
    resolveNpcAttackRange as resolveNpcAttackRangeRule,
    resolveNpcAttackType as resolveNpcAttackTypeRule,
} from "../combat/CombatRules";
import { isInWilderness } from "../combat/MultiCombatZones";
import { HITMARK_DAMAGE, HITMARK_BLOCK } from "../combat/HitEffects";
import { CombatEngine } from "../systems/combat/CombatEngine";
import { DropRollService } from "../drops/DropRollService";
import { NpcDropRegistry } from "../drops/NpcDropRegistry";
import { SkillId } from "../../../../src/rs/skill/skills";
import type { PrayerName } from "../../../../src/rs/prayer/prayers";
import { AttackType } from "../combat/AttackType";
import type { ActionEffect, ScheduledAction } from "../actions/types";
import type { DamageType, DropEligibility } from "../combat/DamageTracker";
import { logger } from "../../utils/logger";
import type { PlayerState } from "../player";
import type { NpcState } from "../npc";
import type { PendingNpcDrop } from "../npcManager";
import type { ServerServices } from "../ServerServices";

export const COMBAT_SOUND_DELAY_MS = 50;
const RESPAWN_DELAY_TICKS = 17;

export const PROTECTION_PRAYER_MAP: Record<AttackType, PrayerName> = {
    melee: "protect_from_melee",
    ranged: "protect_from_missiles",
    magic: "protect_from_magic",
};

export const NPC_PROTECTION_REDUCTION = 1.0;
export const PVP_PROTECTION_REDUCTION = 0.4;

export class CombatEffectService {
    private npcDropRegistry?: NpcDropRegistry;
    private npcDropRollService?: DropRollService;

    constructor(private readonly svc: ServerServices) {}

    // ── Prayer Effects ──────────────────────────────────────────────

    handlePrayerDepleted(player: PlayerState, opts: { message?: string } = {}): void {
        const message =
            opts.message ?? "You have run out of Prayer points, you need to recharge at an altar.";
        this.svc.messagingService.queueChatMessage({
            messageType: "game",
            text: message,
            targetPlayerIds: [player.id],
        });
        player.prayer.resetDrainAccumulator();
        const hadPrayers = (player.prayer.getActivePrayers()?.size ?? 0) > 0;
        if (hadPrayers) {
            player.prayer.clearActivePrayers();
            this.svc.queueCombatState(player);
        }
    }

    tryActivateRedemption(player: PlayerState): boolean {
        if (!player.prayer.hasPrayerActive("redemption")) return false;
        const currentHp = player.skillSystem.getHitpointsCurrent();
        if (!(currentHp > 0)) return false;
        const maxHp = player.skillSystem.getHitpointsMax();
        const threshold = Math.max(1, Math.floor(maxHp / 10));
        if (currentHp > threshold) return false;
        const prayerSkill = player.skillSystem.getSkill(SkillId.Prayer);
        const currentPrayer = Math.max(0, prayerSkill.baseLevel + prayerSkill.boost);
        if (currentPrayer <= 0) return false;
        const healAmount = Math.max(1, Math.floor(prayerSkill.baseLevel * 0.25));
        if (!(healAmount > 0)) return false;
        player.skillSystem.setSkillBoost(SkillId.Prayer, 0);
        this.handlePrayerDepleted(player);
        player.skillSystem.applyHitpointsHeal(healAmount);
        return true;
    }

    applySmite(attacker: PlayerState, target: PlayerState, damage: number): void {
        if (!(damage > 0)) return;
        if (!attacker.prayer.hasPrayerActive("smite")) return;
        const drain = Math.max(0, Math.floor(damage / 4));
        if (!(drain > 0)) return;
        target.skillSystem.adjustSkillBoost(SkillId.Prayer, -drain);
        if (target.prayer.getPrayerLevel() <= 0) {
            target.skillSystem.setSkillBoost(SkillId.Prayer, 0);
            this.handlePrayerDepleted(target);
        }
    }

    tryActivateRetribution(player: PlayerState, tick: number): void {
        if (!player.prayer.hasPrayerActive("retribution")) return;
        const prayerSkill = player.skillSystem.getSkill(SkillId.Prayer);
        const baseDamage = Math.min(25, Math.max(1, Math.floor(prayerSkill.baseLevel * 0.25)));
        if (!(baseDamage > 0)) return;

        const playerX = player.tileX;
        const playerY = player.tileY;
        const playerLevel = player.level;

        const npcManager = this.svc.npcManager;
        if (npcManager) {
            const nearbyNpcs = npcManager.getNearby(playerX, playerY, playerLevel, 1);
            for (const npc of nearbyNpcs) {
                const result = this.applyPlayerDamageToNpc(
                    player,
                    npc,
                    baseDamage,
                    HITMARK_DAMAGE,
                    tick,
                    "other",
                    baseDamage,
                );
                if (!result) continue;
                const activeFrame = this.svc.activeFrame;
                if (activeFrame) {
                    activeFrame.hitsplats.push({
                        targetType: "npc",
                        targetId: npc.id,
                        damage: result.amount,
                        style: result.style,
                        sourceType: "player",
                        sourcePlayerId: player.id,
                        hpCurrent: result.hpCurrent,
                        hpMax: result.hpMax,
                    });
                }
            }
        }

        const players = this.svc.players;
        if (players) {
            players.forEach((_sock: unknown, target: PlayerState) => {
                if (target.id === player.id) return;
                if (target.level !== playerLevel) return;
                const dx = Math.abs(target.tileX - playerX);
                const dy = Math.abs(target.tileY - playerY);
                if (dx > 1 || dy > 1) return;
                const result = target.skillSystem.applyHitpointsDamage(baseDamage);
                const activeFrame = this.svc.activeFrame;
                if (activeFrame) {
                    activeFrame.hitsplats.push({
                        targetType: "player",
                        targetId: target.id,
                        damage: baseDamage,
                        style: HITMARK_DAMAGE,
                        sourceType: "player",
                        sourcePlayerId: player.id,
                        hpCurrent: result.current,
                        hpMax: result.max,
                    });
                }
            });
        }

        this.svc.broadcastService.enqueueSpotAnimation({
            tick,
            playerId: player.id,
            spotId: 437,
            delay: 0,
        });
    }

    // ── Damage Application ──────────────────────────────────────────

    applyProtectionPrayers(
        target: PlayerState,
        damage: number,
        attackType: AttackType,
        source: "npc" | "player",
    ): number {
        if (!(damage > 0)) return 0;
        const prayer = PROTECTION_PRAYER_MAP[attackType];
        if (!prayer || !target.prayer.hasPrayerActive(prayer)) return damage;
        const reduction = source === "npc" ? NPC_PROTECTION_REDUCTION : PVP_PROTECTION_REDUCTION;
        const remaining = Math.floor(damage * (1 - reduction));
        return Math.max(0, remaining);
    }

    applyMultiTargetSpellDamage(opts: {
        player: PlayerState;
        primary: NpcState;
        spell: { id: number; maxTargets?: number; freezeDuration?: number; impactSpotAnim?: number; impactSpotAnimHeight?: number; splashSpotAnim?: number; poisonDamage?: number };
        baseDamage: number;
        style: number;
        hitsplatTick: number;
        currentTick: number;
        effects: ActionEffect[];
    }): number {
        const npcManager = this.svc.npcManager;
        if (
            !npcManager ||
            !opts.spell.maxTargets ||
            opts.spell.maxTargets <= 1 ||
            !(opts.baseDamage > 0)
        ) {
            return 0;
        }
        const extras = npcManager
            .getNearby(opts.primary.tileX, opts.primary.tileY, opts.primary.level, 1)
            .filter((npc: NpcState) => npc.id !== opts.primary.id);
        if (extras.length === 0) return 0;
        let remaining = Math.max(0, opts.spell.maxTargets - 1);
        let totalSecondaryDamage = 0;
        for (const extra of extras) {
            if (remaining <= 0) break;
            if (extra.isPlayerFollower?.() === true) continue;
            if (extra.getHitpoints() <= 0 || extra.isDead(opts.currentTick)) continue;

            let hitLanded = false;
            let damage = 0;
            try {
                const engine = new CombatEngine();
                const magicCaster = Object.create(opts.player) as PlayerState;
                (magicCaster as any).combatSpellId = opts.spell.id;
                (magicCaster as any).autocastEnabled = false;
                (magicCaster as any).autocastMode = null;
                (magicCaster as any).getCurrentAttackType = () => "magic";
                const res = engine.planPlayerAttack({
                    player: magicCaster,
                    npc: extra,
                    attackSpeed: this.svc.playerCombatService!.pickAttackSpeed(opts.player),
                });
                hitLanded = !!res.hitLanded;
                damage = Math.max(0, res.damage);
            } catch {
                hitLanded = false;
                damage = 0;
            }

            const result = this.applyPlayerDamageToNpc(
                opts.player,
                extra,
                damage,
                hitLanded ? opts.style : HITMARK_BLOCK,
                opts.currentTick,
                "magic",
            );
            if (!result) continue;
            remaining--;
            totalSecondaryDamage += result.amount;
            const hpFields =
                result.amount > 0 ? { hpCurrent: result.hpCurrent, hpMax: result.hpMax } : {};
            opts.effects.push({
                type: "hitsplat",
                playerId: opts.player.id,
                targetType: "npc",
                targetId: extra.id,
                damage: result.amount,
                style: result.style,
                sourceType: "player",
                sourcePlayerId: opts.player.id,
                tick: opts.hitsplatTick,
                ...hpFields,
            });
            if (opts.spell.freezeDuration && result.amount > 0) {
                extra.applyFreeze(opts.spell.freezeDuration, opts.currentTick);
            }
            if (opts.spell.poisonDamage && result.amount > 0) {
                extra.inflictPoison(opts.spell.poisonDamage, opts.currentTick);
            }
            const spotId =
                result.amount > 0
                    ? opts.spell.impactSpotAnim ?? opts.spell.splashSpotAnim
                    : opts.spell.splashSpotAnim ?? opts.spell.impactSpotAnim;
            if (spotId !== undefined && spotId >= 0) {
                this.svc.broadcastService.enqueueSpotAnimation({
                    tick: opts.hitsplatTick,
                    npcId: extra.id,
                    spotId: spotId,
                    delay: 0,
                    height: result.amount > 0 ? (opts.spell.impactSpotAnimHeight ?? 100) : 100,
                });
            }
        }
        return totalSecondaryDamage;
    }

    applyPlayerDamageToNpc(
        player: PlayerState,
        npc: NpcState,
        damage: number,
        style: number,
        tick: number,
        damageType: DamageType,
        maxHit?: number,
    ): { amount: number; style: number; hpCurrent: number; hpMax: number } | undefined {
        if (npc.isPlayerFollower?.() === true) return undefined;
        if (npc.getHitpoints() <= 0 || npc.isDead(tick)) return undefined;

        const result = combatEffectApplicator.applyNpcHitsplat(npc, style, damage, tick, maxHit);
        if (result.amount > 0) {
            this.svc.playerCombatManager?.recordDamage(player, npc, result.amount, damageType, tick);
        }
        if (result.hpCurrent <= 0) {
            this.handleNpcDeathOutsidePrimaryCombat(player, npc, tick);
        }
        return result;
    }

    // ── NPC Death ───────────────────────────────────────────────────

    handleNpcDeathOutsidePrimaryCombat(
        player: PlayerState,
        npc: NpcState,
        tick: number,
    ): void {
        if (npc.isPlayerFollower?.() === true || npc.isDead(tick)) {
            return;
        }

        logger.info(`[combat] NPC ${npc.id} (type ${npc.typeId}) died`);
        npc.clearInteractionTarget();

        const playerCombatManager = this.svc.playerCombatManager;
        const eligibility = playerCombatManager?.getDropEligibility?.(npc);
        const inWilderness = isInWilderness(npc.tileX, npc.tileY);
        const pendingDrops = this.rollNpcDrops(npc, eligibility).map((drop) => ({
            ...drop,
            isWilderness: inWilderness,
        }));

        const combatDataService = this.svc.combatDataService;
        const deathSeq = combatDataService.getNpcCombatSequences(npc.typeId)?.death;
        if (deathSeq !== undefined && deathSeq >= 0) {
            npc.queueOneShotSeq(deathSeq);
            this.broadcastNpcSequence(npc, deathSeq);
            npc.popPendingSeq();
        }

        const deathSoundId = combatDataService.getNpcDeathSoundId(npc);
        if (deathSoundId !== undefined && deathSoundId > 0) {
            this.svc.networkLayer.withDirectSendBypass("combat_npc_death_sound", () =>
                this.svc.broadcastService.broadcastSound(
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

        const players = this.svc.players;
        players?.clearInteractionsWithNpc(npc.id);

        const affectedPlayerIds = new Set<number>([player.id]);
        const npcTargetPlayerId = npc.getCombatTargetPlayerId();
        if (npcTargetPlayerId !== undefined && npcTargetPlayerId >= 0) {
            affectedPlayerIds.add(npcTargetPlayerId);
        }
        const actionScheduler = this.svc.actionScheduler;
        for (const affectedPlayerId of affectedPlayerIds) {
            actionScheduler?.cancelActions(affectedPlayerId, (action: ScheduledAction) => {
                const actionData = action.data as Record<string, unknown> | undefined;
                const actionNpcId =
                    action.kind === "combat.attack" ||
                    action.kind === "combat.playerHit" ||
                    action.kind === "combat.npcRetaliate"
                        ? actionData?.npcId
                        : undefined;
                return (
                    actionNpcId === npc.id &&
                    (action.groups.includes("combat.attack") ||
                        action.groups.includes("combat.retaliate") ||
                        action.groups.includes("combat.hit"))
                );
            });
        }

        const deathDelayTicks = this.estimateNpcDespawnDelayTicksFromSeq(deathSeq);
        const despawnTick = tick + Math.max(1, deathDelayTicks);
        const respawnTick = Math.max(tick + RESPAWN_DELAY_TICKS, despawnTick + 1);
        try {
            npc.markDeadUntil(despawnTick, tick);
        } catch (err) { logger.warn("[npc] mark dead failed", err); }
        const npcManager = this.svc.npcManager;
        const queued =
            npcManager?.queueDeath?.(npc.id, despawnTick, respawnTick, pendingDrops) ?? false;
        if (!queued) {
            logger.warn(
                `[combat] Failed to queue NPC respawn (npc=${npc.id}, respawnTick=${respawnTick})`,
            );
        }

        playerCombatManager?.cleanupNpc?.(npc);

        const killerId = eligibility?.primaryLooter?.id ?? player.id;
        this.svc.gamemode.onNpcKill(killerId, npc.typeId);
    }

    // ── NPC Combat Resolution ───────────────────────────────────────

    resolveNpcAttackType(npc: NpcState, explicit?: AttackType): AttackType {
        return resolveNpcAttackTypeRule(npc, explicit);
    }

    resolveNpcAttackRange(npc: NpcState, attackType: AttackType): number {
        return resolveNpcAttackRangeRule(npc, attackType);
    }

    getDistanceToNpcBounds(player: PlayerState, npc: NpcState): number {
        const px = player.tileX;
        const py = player.tileY;
        const minX = npc.tileX;
        const minY = npc.tileY;
        const size = Math.max(1, npc.size);
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        return Math.max(Math.abs(clampedX - px), Math.abs(clampedY - py));
    }

    computeNpcHitDelay(
        npc: NpcState,
        player: PlayerState,
        attackType: AttackType,
        _attackSpeed: number,
    ): number {
        const distance = this.getDistanceToNpcBounds(player, npc);
        switch (attackType) {
            case AttackType.Magic:
                return Math.max(1, 1 + Math.floor((1 + distance) / 3));
            case AttackType.Ranged:
                return Math.max(1, 1 + Math.floor((3 + distance) / 6));
            case AttackType.Melee:
            default:
                return 1;
        }
    }

    pickNpcAttackSpeed(npc: NpcState, _player?: PlayerState): number {
        const paramSpeed = this.svc.combatDataService.getNpcParamValue(npc, 14);
        if (paramSpeed !== undefined && paramSpeed > 0) {
            return Math.max(1, paramSpeed);
        }
        return 4;
    }

    pickNpcHitDelay(npc: NpcState, _player: PlayerState, _attackSpeed: number): number {
        const paramHitDelay = this.svc.combatDataService.getNpcParamValue(npc, 286);
        if (paramHitDelay !== undefined && paramHitDelay > 0) {
            return Math.max(1, paramHitDelay);
        }
        const attackType = this.resolveNpcAttackType(npc);
        return this.computeNpcHitDelay(npc, _player, attackType, _attackSpeed);
    }

    // ── NPC Animation ───────────────────────────────────────────────

    broadcastNpcSequence(npc: NpcState, seqId: number | undefined): void {
        if (seqId === undefined || seqId < 0) return;
        const frame = this.svc.activeFrame;
        if (!frame) return;
        const id = npc.id;
        const existing = frame.npcUpdates.find((d: { id?: number; seq?: number }) => d?.id === id);
        if (existing?.seq !== undefined && existing.seq >= 0) {
            const existingPriority = this.getSeqForcedPriority(existing.seq);
            const newPriority = this.getSeqForcedPriority(seqId);
            if (newPriority >= existingPriority) {
                existing.seq = seqId;
            }
        } else if (existing) {
            existing.seq = seqId;
        } else {
            frame.npcUpdates.push({ id, seq: seqId });
        }
    }

    estimateNpcDespawnDelayTicksFromSeq(seqId: number | undefined): number {
        if (seqId === undefined || seqId < 0) return 1;
        const loader = this.svc.dataLoaderService.getSeqTypeLoader();
        if (!loader) return 1;
        try {
            const seq = loader.load(seqId);
            if (!seq) return 1;
            if (seq.isSkeletalSeq()) {
                const dur = Math.max(1, seq.getSkeletalDuration?.() ?? 1);
                return Math.max(1, Math.ceil(dur / 30));
            }
            const lengths = seq.frameLengths;
            if (!lengths || lengths.length === 0) return 1;
            let cycles = 0;
            for (let i = 0; i < lengths.length; i++) {
                let fl = lengths[i];
                if (fl <= 0) fl = 1;
                if (i === lengths.length - 1 && fl >= 200) continue;
                cycles += fl;
            }
            return Math.max(1, Math.ceil(cycles / 30));
        } catch {
            return 1;
        }
    }

    getSeqForcedPriority(seqId: number): number {
        return this.svc.dataLoaderService.getSeqTypeLoader()?.load?.(seqId)?.forcedPriority ?? 5;
    }

    // ── NPC Drops ───────────────────────────────────────────────────

    getNpcDropRollService(): DropRollService | undefined {
        const npcTypeLoader = this.svc.npcTypeLoader;
        if (!this.npcDropRollService && npcTypeLoader) {
            this.npcDropRegistry = new NpcDropRegistry(npcTypeLoader);
            this.npcDropRollService = new DropRollService(this.npcDropRegistry);
        }
        return this.npcDropRollService;
    }

    rollNpcDrops(
        npc: NpcState,
        eligibility: DropEligibility | undefined,
    ): PendingNpcDrop[] {
        const service = this.getNpcDropRollService();
        if (!service) return [];
        const recipients: Array<{
            ownerId?: number;
            player?: PlayerState;
            dropRateMultiplier: number;
        }> = [];
        const seen = new Set<number>();
        const gamemode = this.svc.gamemode;
        for (const looter of eligibility?.eligibleLooters ?? []) {
            const playerId = looter.id;
            if (seen.has(playerId)) continue;
            seen.add(playerId);
            recipients.push({
                ownerId: playerId,
                player: looter,
                dropRateMultiplier: gamemode.getDropRateMultiplier(looter),
            });
        }
        if (
            recipients.length === 0 &&
            eligibility?.primaryLooter &&
            !seen.has(eligibility.primaryLooter.id)
        ) {
            recipients.push({
                ownerId: eligibility.primaryLooter.id,
                player: eligibility.primaryLooter,
                dropRateMultiplier: gamemode.getDropRateMultiplier(
                    eligibility.primaryLooter,
                ),
            });
        }
        if (recipients.length === 0) {
            recipients.push({
                ownerId: undefined,
                player: undefined,
                dropRateMultiplier: 1,
            });
        }
        const npcTypeLoader = this.svc.npcTypeLoader;
        let npcName = "";
        try {
            npcName = npcTypeLoader?.load(npc.typeId)?.name ?? "";
        } catch (err) { logger.warn("[drop] npc name lookup failed", err); }
        return service.roll({
            npcTypeId: npc.typeId,
            npcName,
            tile: { x: npc.tileX, y: npc.tileY, level: npc.level },
            isWilderness: isInWilderness(npc.tileX, npc.tileY),
            recipients,
            worldViewId: npc.worldViewId,
            transformItemId: (npcTypeId: number, itemId: number, recipient: { player?: PlayerState }) =>
                gamemode.transformDropItemId(npcTypeId, itemId, recipient.player),
            tableOverride: gamemode.getDropTable?.(npc.typeId),
        });
    }
}

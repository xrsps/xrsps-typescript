// @ts-nocheck
import { combatEffectApplicator } from "../combat/CombatEffectApplicator";
import {
    resolveNpcAttackRange as resolveNpcAttackRangeRule,
    resolveNpcAttackType as resolveNpcAttackTypeRule,
} from "../combat/CombatRules";
import { isInWilderness } from "../combat/MultiCombatZones";
import { HITMARK_DAMAGE } from "../combat/HitEffects";
import { upsertNpcUpdateDelta } from "../../network/NpcExternalSync";
import { DropRollService } from "../drops/DropRollService";
import { NpcDropRegistry } from "../drops/NpcDropRegistry";
import { SkillId } from "../../../../src/rs/skill/skills";
import type { PrayerName } from "../../../../src/rs/prayer/prayers";
import { AttackType } from "../combat/AttackType";
import type { ActionEffect } from "../actions/types";
import type { DamageType, DropEligibility } from "../combat/DamageTracker";
import { logger } from "../../utils/logger";

export const COMBAT_SOUND_DELAY_MS = 50;
const RESPAWN_DELAY_TICKS = 17;

export const PROTECTION_PRAYER_MAP: Record<AttackType, PrayerName> = {
    melee: "protect_from_melee",
    ranged: "protect_from_missiles",
    magic: "protect_from_magic",
};

export const NPC_PROTECTION_REDUCTION = 1.0;
export const PVP_PROTECTION_REDUCTION = 0.4;

export interface CombatEffectServiceDeps {
    getActiveFrame: () => any | undefined;
    getCurrentTick: () => number;
    getPlayer: (id: number) => any | undefined;
    getNpcManager: () => any | undefined;
    getPlayerCombatManager: () => any | undefined;
    getCombatDataService: () => any;
    getActionScheduler: () => any;
    getSeqTypeLoader: () => any | undefined;
    getNpcTypeLoader: () => any | undefined;
    getGamemode: () => any;
    getBroadcastScheduler: () => any;
    getNetworkLayer: () => any;
    getPlayers: () => any | undefined;
    getGroundItems: () => any;
    queueCombatSnapshot: (playerId: number, ...args: any[]) => void;
    enqueueSpotAnimation: (event: any) => void;
    broadcastSound: (request: any, tag: string) => void;
    withDirectSendBypass: <T>(tag: string, fn: () => T) => T;
    messagingService: { queueChatMessage: (msg: any) => void };
}

export class CombatEffectService {
    private npcDropRegistry?: NpcDropRegistry;
    private npcDropRollService?: DropRollService;

    constructor(private readonly deps: CombatEffectServiceDeps) {}

    // ── Prayer Effects ──────────────────────────────────────────────

    handlePrayerDepleted(player: any, opts: { message?: string } = {}): void {
        const message =
            opts.message ?? "You have run out of Prayer points, you need to recharge at an altar.";
        this.deps.messagingService.queueChatMessage({
            messageType: "game",
            text: message,
            targetPlayerIds: [player.id],
        });
        player.prayer.resetDrainAccumulator();
        const hadPrayers = (player.prayer.getActivePrayers()?.size ?? 0) > 0;
        if (hadPrayers) {
            player.prayer.clearActivePrayers();
            this.deps.queueCombatSnapshot(
                player.id,
                player.combat.weaponCategory,
                player.combat.weaponItemId,
                !!player.combat.autoRetaliate,
                player.combat.styleSlot,
                Array.from(player.prayer.getActivePrayers() ?? []),
                player.combat.spellId > 0 ? player.combat.spellId : undefined,
            );
        }
    }

    tryActivateRedemption(player: any): boolean {
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

    applySmite(attacker: any, target: any, damage: number): void {
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

    tryActivateRetribution(player: any, tick: number): void {
        if (!player.prayer.hasPrayerActive("retribution")) return;
        const prayerSkill = player.skillSystem.getSkill(SkillId.Prayer);
        const baseDamage = Math.min(25, Math.max(1, Math.floor(prayerSkill.baseLevel * 0.25)));
        if (!(baseDamage > 0)) return;

        const playerX = player.tileX;
        const playerY = player.tileY;
        const playerLevel = player.level;

        const npcManager = this.deps.getNpcManager();
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
                const activeFrame = this.deps.getActiveFrame();
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

        const players = this.deps.getPlayers();
        if (players) {
            players.forEach((sock: any) => {
                const target = players.get(sock);
                if (!target) return;
                if (target.id === player.id) return;
                if (target.level !== playerLevel) return;
                const dx = Math.abs(target.tileX - playerX);
                const dy = Math.abs(target.tileY - playerY);
                if (dx > 1 || dy > 1) return;
                const result = target.skillSystem.applyHitpointsDamage(baseDamage);
                const activeFrame = this.deps.getActiveFrame();
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

        this.deps.enqueueSpotAnimation({
            tick,
            playerId: player.id,
            spotId: 437,
            delay: 0,
        });
    }

    // ── Damage Application ──────────────────────────────────────────

    applyProtectionPrayers(
        target: any,
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
        player: any;
        primary: any;
        spell: any;
        baseDamage: number;
        style: number;
        hitsplatTick: number;
        currentTick: number;
        effects: ActionEffect[];
    }): void {
        const npcManager = this.deps.getNpcManager();
        if (
            !npcManager ||
            !opts.spell.maxTargets ||
            opts.spell.maxTargets <= 1 ||
            !(opts.baseDamage > 0)
        ) {
            return;
        }
        const extras = npcManager
            .getNearby(opts.primary.tileX, opts.primary.tileY, opts.primary.level, 1)
            .filter((npc: any) => npc.id !== opts.primary.id);
        if (extras.length === 0) return;
        let remaining = Math.max(0, opts.spell.maxTargets - 1);
        const splashDamage = Math.max(1, Math.floor(opts.baseDamage / 2));
        if (!(splashDamage > 0)) return;
        for (const extra of extras) {
            if (remaining <= 0) break;
            const result = this.applyPlayerDamageToNpc(
                opts.player,
                extra,
                splashDamage,
                opts.style,
                opts.currentTick,
                "magic",
            );
            if (!result) continue;
            remaining--;
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
            const spotId =
                result.amount > 0
                    ? opts.spell.impactSpotAnim ?? opts.spell.splashSpotAnim
                    : opts.spell.splashSpotAnim ?? opts.spell.impactSpotAnim;
            if (spotId !== undefined && spotId >= 0) {
                this.deps.enqueueSpotAnimation({
                    tick: opts.hitsplatTick,
                    npcId: extra.id,
                    spotId: spotId,
                    delay: 0,
                    height: 100,
                });
            }
        }
    }

    applyPlayerDamageToNpc(
        player: any,
        npc: any,
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
            this.deps.getPlayerCombatManager()?.recordDamage(player, npc, result.amount, damageType, tick);
        }
        if (result.hpCurrent <= 0) {
            this.handleNpcDeathOutsidePrimaryCombat(player, npc, tick);
        }
        return result;
    }

    // ── NPC Death ───────────────────────────────────────────────────

    handleNpcDeathOutsidePrimaryCombat(
        player: any,
        npc: any,
        tick: number,
    ): void {
        if (npc.isPlayerFollower?.() === true || npc.isDead(tick)) {
            return;
        }

        logger.info(`[combat] NPC ${npc.id} (type ${npc.typeId}) died`);
        npc.clearInteractionTarget();

        const playerCombatManager = this.deps.getPlayerCombatManager();
        const eligibility = playerCombatManager?.getDropEligibility?.(npc);
        const inWilderness = isInWilderness(npc.tileX, npc.tileY);
        const pendingDrops = this.rollNpcDrops(npc, eligibility).map((drop: any) => ({
            ...drop,
            isWilderness: inWilderness,
        }));

        const combatDataService = this.deps.getCombatDataService();
        const deathSeq = combatDataService.getNpcCombatSequences(npc.typeId)?.death;
        if (deathSeq !== undefined && deathSeq >= 0) {
            npc.queueOneShotSeq(deathSeq);
            this.broadcastNpcSequence(npc, deathSeq);
            npc.popPendingSeq();
        }

        const deathSoundId = combatDataService.getNpcDeathSoundId(npc.typeId);
        if (deathSoundId !== undefined && deathSoundId > 0) {
            this.deps.withDirectSendBypass("combat_npc_death_sound", () =>
                this.deps.broadcastSound(
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

        const players = this.deps.getPlayers();
        players?.clearInteractionsWithNpc(npc.id);

        const affectedPlayerIds = new Set<number>([player.id]);
        const npcTargetPlayerId = npc.getCombatTargetPlayerId();
        if (npcTargetPlayerId !== undefined && npcTargetPlayerId >= 0) {
            affectedPlayerIds.add(npcTargetPlayerId);
        }
        const actionScheduler = this.deps.getActionScheduler();
        for (const affectedPlayerId of affectedPlayerIds) {
            actionScheduler.cancelActions(affectedPlayerId, (action: any) => {
                const actionNpcId =
                    action.kind === "combat.attack" ||
                    action.kind === "combat.playerHit" ||
                    action.kind === "combat.npcRetaliate"
                        ? action.data?.npcId
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
        const npcManager = this.deps.getNpcManager();
        const queued =
            npcManager?.queueDeath?.(npc.id, despawnTick, respawnTick, pendingDrops) ?? false;
        if (!queued) {
            logger.warn(
                `[combat] Failed to queue NPC respawn (npc=${npc.id}, respawnTick=${respawnTick})`,
            );
        }

        playerCombatManager?.cleanupNpc?.(npc);

        const killerId = eligibility?.primaryLooter?.id ?? player.id;
        this.deps.getGamemode().onNpcKill(killerId, npc.typeId);
    }

    // ── NPC Combat Resolution ───────────────────────────────────────

    resolveNpcAttackType(npc: any, explicit?: AttackType): AttackType {
        return resolveNpcAttackTypeRule(npc, explicit);
    }

    resolveNpcAttackRange(npc: any, attackType: AttackType): number {
        return resolveNpcAttackRangeRule(npc, attackType);
    }

    getDistanceToNpcBounds(player: any, npc: any): number {
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
        npc: any,
        player: any,
        attackType: AttackType,
        _attackSpeed: number,
    ): number {
        const distance = this.getDistanceToNpcBounds(player, npc);
        switch (attackType) {
            case "magic":
                return Math.max(1, 1 + Math.floor((1 + distance) / 3));
            case "ranged":
                return Math.max(1, 1 + Math.floor((3 + distance) / 6));
            case "melee":
            default:
                return 1;
        }
    }

    pickNpcAttackSpeed(npc: any, _player?: any): number {
        const paramSpeed = this.deps.getCombatDataService().getNpcParamValue(npc, 14);
        if (paramSpeed !== undefined && paramSpeed > 0) {
            return Math.max(1, paramSpeed);
        }
        return 4;
    }

    pickNpcHitDelay(npc: any, _player: any, _attackSpeed: number): number {
        const paramHitDelay = this.deps.getCombatDataService().getNpcParamValue(npc, 286);
        if (paramHitDelay !== undefined && paramHitDelay > 0) {
            return Math.max(1, paramHitDelay);
        }
        const attackType = this.resolveNpcAttackType(npc);
        return this.computeNpcHitDelay(npc, _player, attackType, _attackSpeed);
    }

    // ── NPC Animation ───────────────────────────────────────────────

    broadcastNpcSequence(npc: any, seqId: number | undefined): void {
        if (seqId === undefined || seqId < 0) return;
        const frame = this.deps.getActiveFrame();
        if (!frame) return;
        const id = npc.id;
        const existing = frame.npcUpdates.find((d: any) => d?.id === id);
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
        const loader = this.deps.getSeqTypeLoader();
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
        return this.deps.getSeqTypeLoader()?.load?.(seqId)?.forcedPriority ?? 5;
    }

    // ── NPC Drops ───────────────────────────────────────────────────

    getNpcDropRollService(): DropRollService | undefined {
        const npcTypeLoader = this.deps.getNpcTypeLoader();
        if (!this.npcDropRollService && npcTypeLoader) {
            this.npcDropRegistry = new NpcDropRegistry(npcTypeLoader);
            this.npcDropRollService = new DropRollService(this.npcDropRegistry);
        }
        return this.npcDropRollService;
    }

    rollNpcDrops(
        npc: any,
        eligibility: DropEligibility | undefined,
    ): any[] {
        const service = this.getNpcDropRollService();
        if (!service) return [];
        const recipients: Array<{
            ownerId?: number;
            player?: any;
            dropRateMultiplier: number;
        }> = [];
        const seen = new Set<number>();
        const gamemode = this.deps.getGamemode();
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
        const npcTypeLoader = this.deps.getNpcTypeLoader();
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
            transformItemId: (npcTypeId: number, itemId: number, recipient: any) =>
                gamemode.transformDropItemId(npcTypeId, itemId, recipient.player),
        });
    }
}

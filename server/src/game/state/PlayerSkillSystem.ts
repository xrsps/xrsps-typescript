import {
    MAX_REAL_LEVEL,
    MAX_VIRTUAL_LEVEL,
    MAX_XP,
    SKILL_COUNT,
    SKILL_IDS,
    SkillId,
    getLevelForXp,
    getXpForLevel,
} from "../../../../src/rs/skill/skills";
import { logger } from "../../utils/logger";
import {
    DEFAULT_DISEASE_INTERVAL_TICKS,
    DEFAULT_POISON_INTERVAL_TICKS,
    DEFAULT_REGEN_INTERVAL_TICKS,
    DEFAULT_VENOM_INTERVAL_TICKS,
    HITMARK_DISEASE,
    HITMARK_POISON,
    HITMARK_REGEN,
    HITMARK_VENOM,
    StatusHitsplat,
} from "../combat/HitEffects";
import {
    computeCombatLevel as computeCombatLevelFromConfig,
    getSkillRestoreIntervalTicks,
    getSkillBoostDecayIntervalTicks,
    getHitpointRegenIntervalTicks,
    getHitpointOverhealDecayIntervalTicks,
    getPreserveDecayMultiplier,
} from "../combat/SkillConfigurationProvider";
import type { PlayerStatusState } from "./PlayerStatusState";

export interface SkillEntry {
    id: SkillId;
    xp: number;
    baseLevel: number;
    virtualLevel: number;
    boost: number;
}

export interface SkillSyncState {
    id: number;
    xp: number;
    baseLevel: number;
    virtualLevel: number;
    boost: number;
    currentLevel: number;
}

export interface SkillSyncUpdate {
    snapshot: boolean;
    skills: SkillSyncState[];
    totalLevel: number;
    combatLevel: number;
}

export interface PlayerSkillPersistentEntry {
    id: number;
    xp: number;
    boost?: number;
}

const DEFAULT_SKILL_XP: Partial<Record<SkillId, number>> = {
    [SkillId.Hitpoints]: getXpForLevel(10),
};

const SKILL_XP_PRECISION = 10;

export const normalizeSkillXpValue = (xp: number): number => {
    if (!Number.isFinite(xp)) return 0;
    const clamped = Math.max(0, Math.min(MAX_XP, xp));
    return Math.round(clamped * SKILL_XP_PRECISION) / SKILL_XP_PRECISION;
};

const MAX_TEMP_HITPOINT_LEVEL = Math.max(MAX_VIRTUAL_LEVEL, 126);

const COMBAT_SKILL_IDS = new Set<SkillId>([
    SkillId.Attack,
    SkillId.Defence,
    SkillId.Strength,
    SkillId.Hitpoints,
    SkillId.Prayer,
    SkillId.Ranged,
    SkillId.Magic,
]);

/**
 * Callback for applying a color override effect on the player actor (e.g., poison green tint).
 * Matches Actor.setColorOverride signature.
 */
export type ColorOverrideCallback = (
    hue: number,
    saturation: number,
    luminance: number,
    opacity: number,
    durationTicks: number,
) => void;

/**
 * Optional callback to resolve gamemode-specific default skill XP.
 */
export type DefaultSkillXpResolver = (skillId: SkillId) => number | undefined;

export function createInitialSkills(
    gamemodeXpFn?: DefaultSkillXpResolver,
): SkillEntry[] {
    const skills: SkillEntry[] = new Array(SKILL_COUNT);
    for (const id of SKILL_IDS) {
        const xp = gamemodeXpFn?.(id) ?? DEFAULT_SKILL_XP[id] ?? 0;
        const baseLevel = getLevelForXp(xp, { virtual: false });
        const virtualLevel = getLevelForXp(xp, { virtual: true });
        skills[id] = {
            id,
            xp,
            baseLevel,
            virtualLevel,
            boost: 0,
        };
    }
    return skills;
}

export function computeTotalLevel(skills: SkillEntry[]): number {
    return skills.reduce((sum, skill) => sum + skill.baseLevel, 0);
}

export function computeCombatLevel(skills: SkillEntry[]): number {
    return computeCombatLevelFromConfig(skills);
}

/**
 * Encapsulates all skill-related state and behavior for a player:
 * skill levels/XP, dirty tracking, sync state, hitpoints management,
 * skill restoration/decay ticking, and status effect processing.
 */
export class PlayerSkillSystem {
    readonly skills: SkillEntry[];
    skillTotal: number;
    combatLevel: number;

    private readonly dirtySkills: Set<SkillId> = new Set();
    private skillSnapshotPending = true;
    private nextSkillRestoreTick: number = 0;
    private nextSkillBoostDecayTick: number = 0;

    constructor(
        private readonly status: PlayerStatusState,
        private readonly isPrayerActive: (name: string) => boolean,
        private readonly setColorOverride: ColorOverrideCallback,
        gamemodeXpFn?: DefaultSkillXpResolver,
    ) {
        this.skills = createInitialSkills(gamemodeXpFn);
        this.skillTotal = computeTotalLevel(this.skills);
        this.combatLevel = computeCombatLevel(this.skills);
        this.status.hitpointsCurrent = this.skills[SkillId.Hitpoints].baseLevel;
    }

    // ========================================================================
    // Skill accessor methods
    // ========================================================================

    getSkill(id: SkillId): SkillEntry {
        return this.skills[id];
    }

    setSkillXp(id: SkillId, xp: number): void {
        const skill = this.skills[id];
        const normalizedXp = normalizeSkillXpValue(xp);
        const prevXp = skill.xp;
        if (prevXp === normalizedXp) return;

        skill.xp = normalizedXp;
        const prevBase = skill.baseLevel;
        const prevVirtual = skill.virtualLevel;
        skill.baseLevel = getLevelForXp(normalizedXp, { virtual: false });
        skill.virtualLevel = getLevelForXp(normalizedXp, { virtual: true });
        if (skill.baseLevel > MAX_REAL_LEVEL) skill.baseLevel = MAX_REAL_LEVEL;
        if (skill.virtualLevel > MAX_VIRTUAL_LEVEL) skill.virtualLevel = MAX_VIRTUAL_LEVEL;

        const minLevel = this.getSkillMinLevel(id);
        if (skill.boost + skill.baseLevel < minLevel) {
            skill.boost = minLevel - skill.baseLevel;
        }

        const baseChanged = skill.baseLevel !== prevBase;
        const virtualChanged = skill.virtualLevel !== prevVirtual;

        if (baseChanged) {
            this.skillTotal = computeTotalLevel(this.skills);
        }
        if (baseChanged && COMBAT_SKILL_IDS.has(id)) {
            this.combatLevel = computeCombatLevel(this.skills);
        }

        if (normalizedXp !== prevXp || baseChanged || virtualChanged) {
            this.markSkillDirty(id);
        }

        if (id === SkillId.Hitpoints) {
            const maxHp = skill.baseLevel;
            this.status.hitpointsCurrent = Math.min(maxHp, Math.max(0, this.status.hitpointsCurrent));
            this.markSkillDirty(SkillId.Hitpoints);
        }
    }

    setSkillBoost(id: SkillId, boostedLevel: number): void {
        const skill = this.skills[id];
        const upperBound = id === SkillId.Hitpoints ? MAX_TEMP_HITPOINT_LEVEL : MAX_VIRTUAL_LEVEL;
        const minLevel = this.getSkillMinLevel(id);
        const clampedTarget = Math.min(upperBound, Math.max(minLevel, Math.floor(boostedLevel)));
        const nextBoost = clampedTarget - skill.baseLevel;
        if (nextBoost === skill.boost) return;
        skill.boost = nextBoost;
        if (id === SkillId.Hitpoints) {
            this.status.nextHitpointOverhealDecayTick = 0;
            const max = this.getHitpointsMax();
            if (this.status.hitpointsCurrent > max) {
                this.status.hitpointsCurrent = max;
            }
            this.markSkillDirty(SkillId.Hitpoints);
        } else {
            this.markSkillDirty(id);
        }
    }

    adjustSkillBoost(id: SkillId, delta: number): void {
        const skill = this.skills[id];
        const current = skill.baseLevel + skill.boost;
        this.setSkillBoost(id, current + delta);
    }

    // ========================================================================
    // Sync state
    // ========================================================================

    takeSkillSync(): SkillSyncUpdate | undefined {
        if (this.skillSnapshotPending) {
            this.skillSnapshotPending = false;
            const skills = SKILL_IDS.map((id) => this.buildSkillSyncState(id));
            this.dirtySkills.clear();
            return {
                snapshot: true,
                skills,
                totalLevel: this.skillTotal,
                combatLevel: this.combatLevel,
            };
        }
        if (this.dirtySkills.size === 0) return undefined;
        const skills: SkillSyncState[] = [];
        for (const id of this.dirtySkills) skills.push(this.buildSkillSyncState(id));
        this.dirtySkills.clear();
        return {
            snapshot: false,
            skills,
            totalLevel: this.skillTotal,
            combatLevel: this.combatLevel,
        };
    }

    requestFullSkillSync(): void {
        this.skillSnapshotPending = true;
        this.markAllSkillsDirty();
    }

    buildSkillSyncState(id: SkillId): SkillSyncState {
        const skill = this.skills[id];
        const currentLevel =
            id === SkillId.Hitpoints
                ? Math.max(0, Math.min(this.getHitpointsMax(), this.status.hitpointsCurrent))
                : Math.max(this.getSkillMinLevel(id), skill.baseLevel + skill.boost);
        return {
            id,
            xp: skill.xp,
            baseLevel: skill.baseLevel,
            virtualLevel: skill.virtualLevel,
            boost: skill.boost,
            currentLevel,
        };
    }

    markAllSkillsDirty(): void {
        for (const id of SKILL_IDS) this.dirtySkills.add(id);
    }

    markSkillDirty(id: SkillId): void {
        this.dirtySkills.add(id);
    }

    getSkillMinLevel(id: SkillId): number {
        return id === SkillId.Prayer ? 0 : 1;
    }

    // ========================================================================
    // Hitpoints methods
    // ========================================================================

    getHitpointsMax(): number {
        const skill = this.getSkill(SkillId.Hitpoints);
        const base = Math.max(1, skill.baseLevel);
        const boosted = base + skill.boost;
        const capped = Math.max(1, Math.min(MAX_TEMP_HITPOINT_LEVEL, boosted));
        return capped;
    }

    getHitpointsCurrent(): number {
        return this.status.hitpointsCurrent;
    }

    setHitpointsCurrent(value: number): void {
        const max = this.getHitpointsMax();
        const next = Math.max(0, Math.min(max, Math.floor(value)));
        if (next === this.status.hitpointsCurrent) return;
        const wasAlive = this.status.wasAlive;
        this.status.hitpointsCurrent = next;
        this.status.wasAlive = next > 0;
        this.markSkillDirty(SkillId.Hitpoints);
        if (wasAlive && next <= 0) {
            try {
                this.status.onDeath?.();
            } catch (err) { logger.warn("[player] death callback failed", err); }
        }
    }

    applyHitpointsDamage(amount: number): { current: number; max: number } {
        if (!(amount > 0)) return { current: this.status.hitpointsCurrent, max: this.getHitpointsMax() };
        this.setHitpointsCurrent(this.status.hitpointsCurrent - amount);
        return { current: this.status.hitpointsCurrent, max: this.getHitpointsMax() };
    }

    applyHitpointsHeal(amount: number): { current: number; max: number } {
        if (!(amount > 0)) return { current: this.status.hitpointsCurrent, max: this.getHitpointsMax() };
        const target = Math.max(0, Math.floor(this.status.hitpointsCurrent + amount));
        if (target > this.getHitpointsMax()) {
            this.ensureHitpointsTempMax(target);
        }
        this.setHitpointsCurrent(target);
        return { current: this.status.hitpointsCurrent, max: this.getHitpointsMax() };
    }

    ensureHitpointsTempMax(targetLevel: number): void {
        const normalizedTarget = Math.max(1, Math.floor(targetLevel));
        const skill = this.getSkill(SkillId.Hitpoints);
        const base = Math.max(1, skill.baseLevel);
        const desiredBoost = normalizedTarget - base;
        const lowerBound = 1 - base;
        const upperBound = MAX_TEMP_HITPOINT_LEVEL - base;
        const cappedBoost = Math.max(lowerBound, Math.min(upperBound, desiredBoost));
        if (cappedBoost === skill.boost) return;
        skill.boost = cappedBoost;
        if (cappedBoost > 0) {
            this.status.nextHitpointOverhealDecayTick = 0;
        }
        this.markSkillDirty(SkillId.Hitpoints);
        const max = this.getHitpointsMax();
        if (this.status.hitpointsCurrent > max) {
            this.status.hitpointsCurrent = max;
            this.markSkillDirty(SkillId.Hitpoints);
        }
    }

    getSlayerTaskInfo(slayerTask: any): {
        onTask: boolean;
        monsterName?: string;
        monsterSpecies?: string[];
    } {
        if (!slayerTask) return { onTask: false };
        let onTask = slayerTask.onTask ?? slayerTask.active;
        if (onTask === undefined) {
            onTask =
                (slayerTask.remaining !== undefined && slayerTask.remaining > 0) ||
                (slayerTask.amount !== undefined && slayerTask.amount > 0);
        }
        return {
            onTask: !!onTask,
            monsterName: slayerTask.monsterName,
            monsterSpecies: slayerTask.monsterSpecies,
        };
    }

    // ========================================================================
    // Status effect processing
    // ========================================================================

    inflictPoison(
        potency: number,
        currentTick: number,
        interval: number = DEFAULT_POISON_INTERVAL_TICKS,
    ): void {
        const nextPotency = Math.max(1, Math.floor(potency));
        if (!this.status.poisonEffect || nextPotency > this.status.poisonEffect.potency) {
            this.status.poisonEffect = {
                potency: nextPotency,
                interval: Math.max(1, interval),
                nextTick: currentTick + Math.max(1, interval),
            };
        } else {
            this.status.poisonEffect.nextTick = Math.min(
                this.status.poisonEffect.nextTick,
                currentTick + Math.max(1, interval),
            );
        }
    }

    curePoison(): void {
        this.status.poisonEffect = undefined;
    }

    inflictVenom(
        stage: number,
        currentTick: number,
        interval: number = DEFAULT_VENOM_INTERVAL_TICKS,
        ramp: number = 2,
        cap: number = 20,
    ): void {
        const nextStage = Math.max(1, Math.floor(stage));
        const effectiveRamp = Math.max(1, Math.floor(ramp));
        const effectiveCap = Math.max(nextStage, Math.floor(cap));
        const effect = this.status.venomEffect;
        if (!effect || nextStage > effect.stage) {
            this.status.venomEffect = {
                stage: nextStage,
                interval: Math.max(1, interval),
                nextTick: currentTick + Math.max(1, interval),
                ramp: effectiveRamp,
                cap: effectiveCap,
            };
        } else {
            effect.nextTick = Math.min(effect.nextTick, currentTick + Math.max(1, interval));
            effect.ramp = effectiveRamp;
            effect.cap = effectiveCap;
        }
    }

    cureVenom(): void {
        this.status.venomEffect = undefined;
    }

    inflictDisease(
        potency: number,
        currentTick: number,
        interval: number = DEFAULT_DISEASE_INTERVAL_TICKS,
    ): void {
        const nextPotency = Math.max(1, Math.floor(potency));
        const effect = this.status.diseaseEffect;
        if (!effect || nextPotency > effect.potency) {
            this.status.diseaseEffect = {
                potency: nextPotency,
                interval: Math.max(1, interval),
                nextTick: currentTick + Math.max(1, interval),
            };
        } else {
            effect.nextTick = Math.min(effect.nextTick, currentTick + Math.max(1, interval));
        }
    }

    cureDisease(): void {
        this.status.diseaseEffect = undefined;
    }

    startRegeneration(
        heal: number,
        durationTicks: number,
        currentTick: number,
        interval: number = DEFAULT_REGEN_INTERVAL_TICKS,
    ): void {
        const healAmount = Math.max(1, Math.floor(heal));
        const duration = Math.max(1, Math.floor(durationTicks));
        this.status.regenEffect = {
            heal: healAmount,
            remainingTicks: duration,
            interval: Math.max(1, interval),
            nextTick: currentTick + Math.max(1, interval),
        };
    }

    stopRegeneration(): void {
        this.status.regenEffect = undefined;
    }

    processPoison(currentTick: number): StatusHitsplat | undefined {
        const effect = this.status.poisonEffect;
        if (!effect) return undefined;
        if (this.status.hitpointsCurrent <= 0) {
            this.status.poisonEffect = undefined;
            return undefined;
        }
        if (currentTick < effect.nextTick) return undefined;
        const amount = Math.max(1, Math.floor(effect.potency));
        const result = this.applyHitpointsDamage(amount);
        this.setColorOverride(21, 7, 50, 40, 1);
        effect.potency = Math.max(0, effect.potency - 1);
        if (effect.potency <= 0 || result.current <= 0) {
            this.status.poisonEffect = undefined;
        } else {
            effect.nextTick = currentTick + effect.interval;
        }
        return {
            style: HITMARK_POISON,
            amount,
            hpCurrent: result.current,
            hpMax: result.max,
        };
    }

    processVenom(currentTick: number): StatusHitsplat | undefined {
        const effect = this.status.venomEffect;
        if (!effect) return undefined;
        if (this.status.hitpointsCurrent <= 0) {
            this.status.venomEffect = undefined;
            return undefined;
        }
        if (currentTick < effect.nextTick) return undefined;
        const amount = Math.max(1, Math.floor(effect.stage));
        const result = this.applyHitpointsDamage(amount);
        this.setColorOverride(21, 7, 30, 50, 1);
        if (result.current <= 0) {
            this.status.venomEffect = undefined;
        } else {
            const nextStage = Math.min(effect.cap, effect.stage + effect.ramp);
            effect.stage = nextStage;
            effect.nextTick = currentTick + effect.interval;
        }
        return {
            style: HITMARK_VENOM,
            amount,
            hpCurrent: result.current,
            hpMax: result.max,
        };
    }

    processDisease(currentTick: number): StatusHitsplat | undefined {
        const effect = this.status.diseaseEffect;
        if (!effect) return undefined;
        if (this.status.hitpointsCurrent <= 1) {
            this.status.diseaseEffect = undefined;
            return undefined;
        }
        if (currentTick < effect.nextTick) return undefined;
        const safeDamage = Math.max(0, this.status.hitpointsCurrent - 1);
        const amount = Math.min(safeDamage, Math.max(1, Math.floor(effect.potency)));
        if (amount <= 0) {
            this.status.diseaseEffect = undefined;
            return undefined;
        }
        const result = this.applyHitpointsDamage(amount);
        effect.potency = Math.max(0, effect.potency - 1);
        if (effect.potency <= 0 || result.current <= 1) {
            this.status.diseaseEffect = undefined;
        } else {
            effect.nextTick = currentTick + effect.interval;
        }
        return {
            style: HITMARK_DISEASE,
            amount,
            hpCurrent: result.current,
            hpMax: result.max,
        };
    }

    processRegeneration(currentTick: number): StatusHitsplat | undefined {
        const effect = this.status.regenEffect;
        if (!effect) return undefined;
        if (currentTick < effect.nextTick) return undefined;
        const before = this.status.hitpointsCurrent;
        const result = this.applyHitpointsHeal(effect.heal);
        const healed = result.current - before;
        effect.remainingTicks = Math.max(0, effect.remainingTicks - 1);
        if (effect.remainingTicks <= 0) {
            this.status.regenEffect = undefined;
        } else {
            effect.nextTick = currentTick + effect.interval;
        }
        if (healed <= 0) {
            return undefined;
        }
        return {
            style: HITMARK_REGEN,
            amount: healed,
            hpCurrent: result.current,
            hpMax: result.max,
        };
    }

    // ========================================================================
    // Skill restoration / decay ticking
    // ========================================================================

    tickSkillRestoration(currentTick: number): void {
        const hasRapidRestore = this.isPrayerActive("rapid_restore");
        const baseRestoreInterval = getSkillRestoreIntervalTicks();
        const restoreInterval = hasRapidRestore
            ? Math.max(1, Math.floor(baseRestoreInterval / 2))
            : baseRestoreInterval;
        if (this.nextSkillRestoreTick <= 0) {
            this.nextSkillRestoreTick = currentTick + restoreInterval;
        } else if (currentTick >= this.nextSkillRestoreTick) {
            this.nextSkillRestoreTick = currentTick + restoreInterval;
            this.restoreDrainedSkills();
        } else if (hasRapidRestore) {
            const remaining = this.nextSkillRestoreTick - currentTick;
            if (remaining > restoreInterval) {
                this.nextSkillRestoreTick = currentTick + restoreInterval;
            }
        }

        const preserveActive = this.isPrayerActive("preserve");
        const baseDecayInterval = getSkillBoostDecayIntervalTicks();
        const decayInterval = preserveActive
            ? Math.max(1, Math.floor(baseDecayInterval * getPreserveDecayMultiplier()))
            : baseDecayInterval;
        if (this.nextSkillBoostDecayTick <= 0) {
            this.nextSkillBoostDecayTick = currentTick + decayInterval;
        } else if (currentTick >= this.nextSkillBoostDecayTick) {
            this.nextSkillBoostDecayTick = currentTick + decayInterval;
            this.decayPositiveSkillBoosts();
        } else if (preserveActive) {
            const remaining = this.nextSkillBoostDecayTick - currentTick;
            if (remaining > decayInterval) {
                this.nextSkillBoostDecayTick = currentTick + decayInterval;
            }
        }
    }

    restoreDrainedSkills(): void {
        for (const skill of this.skills) {
            if (!skill) continue;
            if (skill.id === SkillId.Prayer || skill.id === SkillId.Hitpoints) continue;
            if (skill.boost < 0) {
                skill.boost = Math.min(0, skill.boost + 1);
                this.markSkillDirty(skill.id);
            }
        }
    }

    decayPositiveSkillBoosts(): void {
        for (const skill of this.skills) {
            if (!skill) continue;
            if (skill.id === SkillId.Prayer || skill.id === SkillId.Hitpoints) continue;
            if (skill.boost > 0) {
                skill.boost = Math.max(0, skill.boost - 1);
                this.markSkillDirty(skill.id);
            }
        }
    }

    tickHitpoints(currentTick: number): StatusHitsplat[] | undefined {
        const skill = this.getSkill(SkillId.Hitpoints);
        const baseLevel = Math.max(1, skill.baseLevel);

        const baseRegenInterval = getHitpointRegenIntervalTicks();
        const regenInterval = this.isPrayerActive("rapid_heal")
            ? Math.max(1, Math.floor(baseRegenInterval / 2))
            : baseRegenInterval;
        if (this.status.nextHitpointRegenTick <= 0) {
            this.status.nextHitpointRegenTick = currentTick + regenInterval;
        } else if (currentTick >= this.status.nextHitpointRegenTick) {
            this.status.nextHitpointRegenTick = currentTick + regenInterval;
            if (this.status.hitpointsCurrent < baseLevel) {
                this.setHitpointsCurrent(this.status.hitpointsCurrent + 1);
            }
        }

        if (skill.boost > 0) {
            if (this.status.nextHitpointOverhealDecayTick <= 0) {
                this.status.nextHitpointOverhealDecayTick =
                    currentTick + getHitpointOverhealDecayIntervalTicks();
            } else if (currentTick >= this.status.nextHitpointOverhealDecayTick) {
                const nextBoost = Math.max(0, skill.boost - 1);
                this.status.nextHitpointOverhealDecayTick =
                    currentTick + getHitpointOverhealDecayIntervalTicks();
                this.setSkillBoost(SkillId.Hitpoints, baseLevel + nextBoost);
            }
        } else {
            this.status.nextHitpointOverhealDecayTick = 0;
        }

        const events: StatusHitsplat[] = [];

        const poison = this.processPoison(currentTick);
        if (poison) events.push(poison);

        const venom = this.processVenom(currentTick);
        if (venom) events.push(venom);

        const disease = this.processDisease(currentTick);
        if (disease) events.push(disease);

        const regen = this.processRegeneration(currentTick);
        if (regen) events.push(regen);

        return events.length > 0 ? events : undefined;
    }

    // ========================================================================
    // Persistence helpers
    // ========================================================================

    exportSkillSnapshot(): PlayerSkillPersistentEntry[] {
        return SKILL_IDS.map((id) => {
            const skill = this.skills[id];
            return {
                id,
                xp: skill.xp,
                boost: skill.boost,
            };
        });
    }

    applySkillSnapshot(entries: Iterable<PlayerSkillPersistentEntry>): void {
        for (const entry of entries) {
            if (!entry) continue;
            const skillId = entry.id;
            if (!SKILL_IDS.includes(skillId as SkillId)) continue;
            if (!Number.isFinite(entry.xp)) continue;
            this.setSkillXp(skillId as SkillId, entry.xp);
            const boost = entry.boost ?? 0;
            const base = this.getSkill(skillId as SkillId).baseLevel;
            this.setSkillBoost(skillId as SkillId, base + boost);
        }
    }
}

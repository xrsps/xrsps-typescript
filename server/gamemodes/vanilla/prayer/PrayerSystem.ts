import {
    PRAYER_NAME_SET,
    PrayerDefinition,
    PrayerName,
    getPrayerDefinition,
} from "../../../../src/rs/prayer/prayers";
import { SkillId } from "../../../../src/rs/skill/skills";
import { getItemDefinition } from "../../../src/data/items";
import { PlayerState } from "../../../src/game/player";

export type PrayerSelectionError = { prayer: PrayerName; message: string };

export type PrayerSelectionResult = {
    changed: boolean;
    activePrayers: PrayerName[];
    errors: PrayerSelectionError[];
};

export type PrayerTickResult = {
    prayerDepleted?: boolean;
};

export class PrayerSystem {
    applySelection(player: PlayerState, requested: Iterable<string>): PrayerSelectionResult {
        const normalized = this.normalizeRequest(requested);
        const errors: PrayerSelectionError[] = [];
        const skill = player.getSkill(SkillId.Prayer);
        const currentLevel = Math.max(0, skill.baseLevel + skill.boost);
        if (currentLevel <= 0 && normalized.length > 0) {
            errors.push({
                prayer: normalized[0],
                message: "You need to recharge your Prayer at an altar before using that prayer.",
            });
            return {
                changed: false,
                activePrayers: Array.from(player.getActivePrayers()),
                errors,
            };
        }
        const next: PrayerName[] = [];
        for (const prayer of normalized) {
            const def = getPrayerDefinition(prayer);
            if (!this.meetsLevel(skill.baseLevel, def)) {
                errors.push({
                    prayer,
                    message: `You need a Prayer level of ${def.level} to use ${def.name}.`,
                });
                continue;
            }
            const unlock = this.checkUnlock(player, def);
            if (!unlock.ok) {
                errors.push({
                    prayer,
                    message:
                        unlock.message ??
                        `You must unlock ${def.name} before you can activate that prayer.`,
                });
                continue;
            }
            this.removeConflicts(next, def);
            next.push(prayer);
        }
        const changed = player.setActivePrayers(next);
        return {
            changed,
            activePrayers: Array.from(player.getActivePrayers()),
            errors,
        };
    }

    processPlayer(player: PlayerState): PrayerTickResult | undefined {
        const active = player.getActivePrayers();
        if (active.size === 0) {
            player.resetPrayerDrainAccumulator();
            return undefined;
        }
        const skill = player.getSkill(SkillId.Prayer);
        let current = Math.max(0, skill.baseLevel + skill.boost);
        if (current <= 0) {
            player.resetPrayerDrainAccumulator();
            return { prayerDepleted: active.size > 0 };
        }
        const drainRate = this.computeDrainRate(active);
        if (!(drainRate > 0)) {
            player.resetPrayerDrainAccumulator();
            return undefined;
        }
        const resistance = Math.max(1, 60 + this.computePrayerBonus(player) * 2);
        let accumulator = player.getPrayerDrainAccumulator();
        accumulator += drainRate;
        let drained = 0;
        while (accumulator >= resistance && current > 0) {
            accumulator -= resistance;
            drained++;
            current--;
        }
        player.setPrayerDrainAccumulator(accumulator);
        if (drained <= 0) return undefined;
        player.adjustSkillBoost(SkillId.Prayer, -drained);
        const remaining = player.getPrayerLevel();
        if (remaining <= 0) {
            player.resetPrayerDrainAccumulator();
            return { prayerDepleted: active.size > 0 };
        }
        return undefined;
    }

    private normalizeRequest(requested: Iterable<string>): PrayerName[] {
        const seen = new Set<PrayerName>();
        const out: PrayerName[] = [];
        for (const entry of requested) {
            const name = entry as PrayerName;
            if (!PRAYER_NAME_SET.has(name)) continue;
            if (seen.has(name)) continue;
            seen.add(name);
            out.push(name);
        }
        return out;
    }

    private meetsLevel(basePrayerLevel: number, def: PrayerDefinition): boolean {
        return basePrayerLevel >= def.level;
    }

    private removeConflicts(active: PrayerName[], def: PrayerDefinition): void {
        if (!def.groups && def.exclusiveGroups.length === 0) return;
        for (let i = active.length - 1; i >= 0; i--) {
            const candidate = getPrayerDefinition(active[i]);
            if (!candidate.groups) continue;
            if (def.groups && candidate.groups === def.groups) {
                active.splice(i, 1);
                continue;
            }
            if (def.exclusiveGroups.includes(candidate.groups)) {
                active.splice(i, 1);
            }
        }
    }

    private checkUnlock(
        player: PlayerState,
        def: PrayerDefinition,
    ): { ok: boolean; message?: string } {
        if (def.unlockVarbit !== undefined) {
            const value = player.getVarbitValue(def.unlockVarbit);
            if (!(value > 0)) {
                return {
                    ok: false,
                    message: `You must read the scroll to unlock ${def.name}.`,
                };
            }
        }
        if (def.questRequirement) {
            const current = player.getVarbitValue(def.questRequirement.varbit);
            if (current < def.questRequirement.minValue) {
                return {
                    ok: false,
                    message: def.questRequirement.hint,
                };
            }
        }
        return { ok: true };
    }

    private computeDrainRate(active: ReadonlySet<PrayerName>): number {
        let rate = 0;
        for (const prayer of active) {
            rate += getPrayerDefinition(prayer).drainRate;
        }
        return rate;
    }

    private computePrayerBonus(player: PlayerState): number {
        const equip = player.appearance?.equip;
        if (!equip) return 0;
        let total = 0;
        for (const itemId of equip) {
            if (!(itemId > 0)) continue;
            const def = getItemDefinition(itemId);
            const bonuses = def?.bonuses;
            if (!bonuses) continue;
            const prayerBonus = bonuses[13] ?? 0;
            total += prayerBonus;
        }
        return total;
    }
}

import {
    PRAYER_HEAD_ICON_IDS,
    PRAYER_NAME_SET,
    type PrayerHeadIcon,
    type PrayerName,
} from "../../../../src/rs/prayer/prayers";

export interface PlayerPrayerDeps {
    getPrayerSkillLevel: () => number;
    setHeadIconIndex: (index: number) => void;
}

export class PlayerPrayerState {
    activePrayers: Set<PrayerName> = new Set();
    quickPrayers: Set<PrayerName> = new Set();
    quickPrayersEnabled: boolean = false;
    drainAccumulator: number = 0;
    headIcon: PrayerHeadIcon | null = null;

    private deps?: PlayerPrayerDeps;

    setDeps(deps: PlayerPrayerDeps): void {
        this.deps = deps;
    }

    setActivePrayers(prayers: Iterable<PrayerName>): boolean {
        const next = new Set<PrayerName>();
        for (const prayer of prayers) {
            next.add(prayer);
        }
        let changed = next.size !== this.activePrayers.size;
        if (!changed) {
            for (const prayer of next) {
                if (!this.activePrayers.has(prayer)) {
                    changed = true;
                    break;
                }
            }
        }
        if (!changed) return false;
        this.activePrayers = next;
        this.updateHeadIcon();
        if (
            this.quickPrayersEnabled &&
            !this.areSetsEqual(this.quickPrayers, this.activePrayers)
        ) {
            this.quickPrayersEnabled = false;
        }
        return true;
    }

    getActivePrayers(): ReadonlySet<PrayerName> {
        return this.activePrayers;
    }

    clearActivePrayers(): boolean {
        if (this.activePrayers.size === 0) return false;
        this.activePrayers.clear();
        this.updateHeadIcon();
        return true;
    }

    getQuickPrayers(): ReadonlySet<PrayerName> {
        return this.quickPrayers;
    }

    setQuickPrayers(prayers: Iterable<PrayerName | string>): boolean {
        const next = new Set<PrayerName>();
        for (const entry of prayers) {
            const name = entry as PrayerName;
            if (!PRAYER_NAME_SET.has(name)) continue;
            next.add(name);
        }
        const changed = !this.areSetsEqual(next, this.quickPrayers);
        if (!changed) return false;
        this.quickPrayers = next;
        if (!this.areSetsEqual(this.quickPrayers, this.activePrayers)) {
            this.quickPrayersEnabled = false;
        }
        return true;
    }

    areQuickPrayersEnabled(): boolean {
        return this.quickPrayersEnabled;
    }

    setQuickPrayersEnabled(enabled: boolean): void {
        this.quickPrayersEnabled = !!enabled;
    }

    hasPrayerActive(prayer: PrayerName): boolean {
        return this.activePrayers.has(prayer);
    }

    getPrayerLevel(): number {
        return this.deps?.getPrayerSkillLevel() ?? 1;
    }

    getDrainAccumulator(): number {
        return this.drainAccumulator;
    }

    setDrainAccumulator(value: number): void {
        this.drainAccumulator = Math.max(0, value);
    }

    resetDrainAccumulator(): void {
        this.drainAccumulator = 0;
    }

    private areSetsEqual(a: ReadonlySet<PrayerName>, b: ReadonlySet<PrayerName>): boolean {
        if (a.size !== b.size) return false;
        for (const entry of a) {
            if (!b.has(entry)) return false;
        }
        return true;
    }

    private updateHeadIcon(): void {
        let icon: PrayerHeadIcon | null = null;
        if (this.activePrayers.has("protect_from_melee")) icon = "protect_melee";
        else if (this.activePrayers.has("protect_from_missiles")) icon = "protect_missiles";
        else if (this.activePrayers.has("protect_from_magic")) icon = "protect_magic";
        else if (this.activePrayers.has("retribution")) icon = "retribution";
        else if (this.activePrayers.has("smite")) icon = "smite";
        else if (this.activePrayers.has("redemption")) icon = "redemption";
        this.setHeadIcon(icon);
    }

    private setHeadIcon(icon: PrayerHeadIcon | null): void {
        if (this.headIcon === icon) return;
        this.headIcon = icon;
        const index = icon != null ? PRAYER_HEAD_ICON_IDS[icon] ?? -1 : -1;
        this.deps?.setHeadIconIndex(index);
    }
}

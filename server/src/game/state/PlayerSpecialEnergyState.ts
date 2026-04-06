import type { PlayerCombatState } from "./PlayerCombatState";

const SPECIAL_ENERGY_MAX = 100;
const SPECIAL_ENERGY_REGEN_CHUNK = 10;
const SPECIAL_ENERGY_REGEN_INTERVAL_TICKS = 50;

export class PlayerSpecialEnergyState {
    constructor(private readonly combat: PlayerCombatState) {}

    getUnits(): number {
        return Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(this.combat.specialEnergy)));
    }

    getPercent(): number {
        return Math.floor((this.getUnits() / SPECIAL_ENERGY_MAX) * 100);
    }

    setPercent(percent: number): void {
        const normalized = Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(percent)));
        if (normalized === this.getUnits()) return;
        this.combat.specialEnergy = normalized;
        this.combat.specialEnergyDirty = true;
        if (normalized === 0) {
            this.combat.specialActivatedFlag = false;
        }
    }

    setActivated(on: boolean): boolean {
        const normalized = !!on;
        if (normalized && this.getUnits() <= 0) {
            return false;
        }
        this.combat.specialActivatedFlag = normalized;
        return true;
    }

    isActivated(): boolean {
        return this.combat.specialActivatedFlag;
    }

    consume(costPercent: number): boolean {
        const cost = Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(costPercent)));
        if (cost <= 0) return true;
        if (this.getUnits() < cost) {
            this.combat.specialActivatedFlag = false;
            return false;
        }
        this.combat.specialEnergy = Math.max(0, this.getUnits() - cost);
        this.combat.specialActivatedFlag = false;
        this.combat.specialEnergyDirty = true;
        return true;
    }

    tick(currentTick: number): boolean {
        if (this.getUnits() >= SPECIAL_ENERGY_MAX) {
            this.combat.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            return false;
        }
        if (this.combat.nextSpecialRegenTick <= 0) {
            this.combat.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            return false;
        }
        if (currentTick >= this.combat.nextSpecialRegenTick) {
            this.combat.specialEnergy = Math.min(
                SPECIAL_ENERGY_MAX,
                this.getUnits() + SPECIAL_ENERGY_REGEN_CHUNK,
            );
            this.combat.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            this.combat.specialEnergyDirty = true;
            return true;
        }
        return false;
    }

    hasUpdate(): boolean {
        return this.combat.specialEnergyDirty;
    }

    markSynced(): void {
        this.combat.specialEnergyDirty = false;
    }
}

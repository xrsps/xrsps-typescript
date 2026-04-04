export type CombatStatePayload = {
    weaponCategory: number;
    weaponItemId?: number;
    autoRetaliate?: boolean;
    activeStyle?: number;
    activePrayers?: string[];
    activeSpellId?: number;
    specialEnergy?: number;
    specialActivated?: boolean;
    quickPrayers?: string[];
    quickPrayersEnabled?: boolean;
};

type CombatStateListener = (payload: CombatStatePayload) => void;

function cloneCombatPayload(payload: CombatStatePayload): CombatStatePayload {
    const clone: CombatStatePayload = { ...payload };
    if (payload.quickPrayers) {
        clone.quickPrayers = [...payload.quickPrayers];
    }
    return clone;
}

function normalizeCombatPayload(raw: CombatStatePayload | undefined): CombatStatePayload {
    return {
        weaponCategory: raw && typeof raw.weaponCategory === "number" ? raw.weaponCategory | 0 : 0,
        weaponItemId:
            raw && typeof raw.weaponItemId === "number" ? raw.weaponItemId | 0 : undefined,
        autoRetaliate: raw ? Boolean(raw.autoRetaliate) : undefined,
        activeStyle: raw && typeof raw.activeStyle === "number" ? raw.activeStyle | 0 : undefined,
        activePrayers: Array.isArray(raw?.activePrayers)
            ? (raw?.activePrayers as string[]).map((p) => String(p))
            : undefined,
        activeSpellId:
            raw && typeof raw.activeSpellId === "number" ? raw.activeSpellId | 0 : undefined,
        specialEnergy:
            raw && typeof raw.specialEnergy === "number"
                ? Math.max(0, Math.min(100, raw.specialEnergy | 0))
                : undefined,
        specialActivated:
            raw && typeof raw.specialActivated === "boolean" ? raw.specialActivated : undefined,
        quickPrayers: Array.isArray(raw?.quickPrayers)
            ? (raw?.quickPrayers as string[]).map((p) => String(p))
            : undefined,
        quickPrayersEnabled:
            raw && typeof raw.quickPrayersEnabled === "boolean"
                ? raw.quickPrayersEnabled
                : undefined,
    };
}

/**
 * Dedicated client combat state channel.
 * Subsystem ownership rather than embedding combat state handling inside
 * the global network transport file.
 */
export class CombatStateStore {
    private readonly listeners = new Set<CombatStateListener>();
    private latest: CombatStatePayload | undefined;

    ingest(raw: CombatStatePayload | undefined): void {
        const payload = normalizeCombatPayload(raw);
        this.latest = payload;
        for (const cb of this.listeners) {
            try {
                cb(cloneCombatPayload(payload));
            } catch (err) {
                console.warn("combat listener error", err);
            }
        }
    }

    subscribe(cb: CombatStateListener): () => void {
        this.listeners.add(cb);
        if (this.latest) {
            try {
                cb(cloneCombatPayload(this.latest));
            } catch (err) {
                console.warn("combat listener error", err);
            }
        }
        return () => this.listeners.delete(cb);
    }

    getLatest(): CombatStatePayload | undefined {
        return this.latest ? cloneCombatPayload(this.latest) : undefined;
    }
}

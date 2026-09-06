import { createIdleDuelSnapshot, DuelSnapshot, isDuelSnapshot } from "../../common/duel/DuelProtocol";

/** Stable snapshots and bound functions support React's useSyncExternalStore. */
export class DuelStore {
    private snapshot = createIdleDuelSnapshot();
    private listeners = new Set<() => void>();

    getSnapshot = (): DuelSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    update(value: unknown): boolean {
        if (!isDuelSnapshot(value)) return false;
        this.snapshot = freezeCopy(value);
        for (const listener of this.listeners) listener();
        return true;
    }

    reset(): void {
        this.update(createIdleDuelSnapshot());
    }
}

export const duelStore = new DuelStore();

/** Snapshots contain only validated JSON-shaped data; never share mutable network arrays. */
function freezeCopy<T>(value: T): T {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy)) as T;
    if (value && typeof value === "object") {
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freezeCopy(v)]))) as T;
    }
    return value;
}

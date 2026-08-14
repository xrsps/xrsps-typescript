import type { RememberLoginPluginConfig, RememberLoginPluginPersistence } from "./types";

export function createBrowserRememberLoginPluginPersistence(
    storageKey: string,
): RememberLoginPluginPersistence | undefined {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return undefined;
    }

    return {
        load: (): Partial<RememberLoginPluginConfig> | undefined => {
            try {
                const raw = window.localStorage.getItem(storageKey);
                return raw ? (JSON.parse(raw) as Partial<RememberLoginPluginConfig>) : undefined;
            } catch {
                return undefined;
            }
        },
        save: (config: RememberLoginPluginConfig): void => {
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(config));
            } catch {}
        },
    };
}

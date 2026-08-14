import type {
    LoginCredentialsTarget,
    RememberLoginPluginConfig,
    RememberLoginPluginPersistence,
    RememberLoginPluginState,
} from "./types";

type RememberLoginPluginListener = () => void;

const DEFAULT_CONFIG: RememberLoginPluginConfig = Object.freeze({
    enabled: false,
    username: "",
    password: "",
});

export class RememberLoginPlugin {
    private readonly listeners = new Set<RememberLoginPluginListener>();
    private readonly persistence?: RememberLoginPluginPersistence;
    private config: RememberLoginPluginConfig;
    private state: RememberLoginPluginState;
    private version = 0;

    constructor(persistence?: RememberLoginPluginPersistence) {
        this.persistence = persistence;
        this.config = this.sanitizeConfig(persistence?.load());
        this.state = { config: this.config, version: this.version };
    }

    subscribe(listener: RememberLoginPluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): RememberLoginPluginState {
        return this.state;
    }

    getConfig(): RememberLoginPluginConfig {
        return this.state.config;
    }

    setConfig(nextConfig: Partial<RememberLoginPluginConfig>): void {
        this.config = this.sanitizeConfig({ ...this.config, ...nextConfig });
        this.commit();
    }

    setEnabled(enabled: boolean, username = "", password = ""): void {
        if (!enabled) {
            this.setConfig({ enabled: false, username: "", password: "" });
            return;
        }
        this.setConfig({ enabled: true });
        this.remember(username, password);
    }

    remember(username: string, password: string): void {
        if (!this.config.enabled || username.trim().length === 0 || password.length === 0) return;
        this.setConfig({ username, password });
    }

    restore(target: LoginCredentialsTarget): void {
        if (!this.config.enabled || !this.config.username || !this.config.password) return;
        target.username = this.config.username;
        target.password = this.config.password;
        target.currentLoginField = 1;
    }

    private sanitizeConfig(
        input: Partial<RememberLoginPluginConfig> | undefined,
    ): RememberLoginPluginConfig {
        return {
            enabled: input?.enabled ?? DEFAULT_CONFIG.enabled,
            username:
                typeof input?.username === "string"
                    ? input.username.slice(0, 320)
                    : DEFAULT_CONFIG.username,
            password:
                typeof input?.password === "string"
                    ? input.password.slice(0, 20)
                    : DEFAULT_CONFIG.password,
        };
    }

    private commit(): void {
        this.version++;
        this.state = { config: this.config, version: this.version };
        this.persistence?.save(this.config);
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[remember-login-plugin] listener failed", err);
            }
        }
    }
}

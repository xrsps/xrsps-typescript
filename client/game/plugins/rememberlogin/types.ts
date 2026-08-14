export interface RememberLoginPluginConfig {
    enabled: boolean;
    username: string;
    password: string;
}

export interface RememberLoginPluginState {
    config: RememberLoginPluginConfig;
    version: number;
}

export interface RememberLoginPluginPersistence {
    load(): Partial<RememberLoginPluginConfig> | undefined;
    save(config: RememberLoginPluginConfig): void;
}

export interface LoginCredentialsTarget {
    username: string;
    password: string;
    currentLoginField: number;
}

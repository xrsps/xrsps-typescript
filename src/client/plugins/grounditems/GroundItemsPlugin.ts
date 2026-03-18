import type { ClientGroundItemStack } from "../../data/ground/GroundItemStore";
import type {
    GroundItemEvaluation,
    GroundItemsDespawnTimerMode,
    GroundItemsOwnershipFilterMode,
    GroundItemsPluginConfig,
    GroundItemsPluginPersistence,
    GroundItemsPluginState,
    GroundItemsTimingContext,
    GroundItemsValueCalculationMode,
} from "./types";

type GroundItemsListener = () => void;

type QuantityMatchOp = "lt" | "gt";

type CompiledPattern = {
    regex?: RegExp;
    exact?: string;
    quantityOp?: QuantityMatchOp;
    quantityValue?: number;
};

const DEFAULT_CONFIG: GroundItemsPluginConfig = Object.freeze({
    enabled: true,
    highlightedItems: "",
    hiddenItems: "Vial, Ashes, Coins, Bones, Bucket, Jug, Seaweed",
    showHighlightedOnly: false,
    rightClickHidden: false,
    recolorMenuHiddenItems: false,
    showMenuItemQuantities: true,
    dontHideUntradeables: true,
    hideUnderValue: 0,
    priceDisplayMode: "both",
    valueCalculationMode: "highest",
    defaultColor: 0xffffff,
    highlightedColor: 0xaa00ff,
    hiddenColor: 0x808080,
    lowValueColor: 0x66b2ff,
    lowValuePrice: 20_000,
    mediumValueColor: 0x99ff99,
    mediumValuePrice: 100_000,
    highValueColor: 0xff9600,
    highValuePrice: 1_000_000,
    insaneValueColor: 0xff66b2,
    insaneValuePrice: 10_000_000,
    ownershipFilterMode: "all",
    despawnTimerMode: "off",
});

const COINS_ITEM_ID = 995;
const TILE_ITEM_OWNERSHIP_OTHER = 2;
const ACCOUNT_TYPE_MAIN = 0;
const TIMER_COLOR_PUBLIC = 0xffff00;
const TIMER_COLOR_PRIVATE = 0x00ff00;

function sanitizeNumber(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.floor(numeric));
}

function sanitizeColor(value: unknown, fallback: number): number {
    const numeric = sanitizeNumber(value, fallback);
    return numeric & 0xffffff;
}

function sanitizeMode(value: unknown, fallback: GroundItemsPluginConfig["priceDisplayMode"]) {
    if (value === "ha" || value === "ge" || value === "both" || value === "off") {
        return value;
    }
    return fallback;
}

function sanitizeValueMode(
    value: unknown,
    fallback: GroundItemsValueCalculationMode,
): GroundItemsValueCalculationMode {
    if (value === "ha" || value === "ge" || value === "highest") {
        return value;
    }
    return fallback;
}

function sanitizeOwnershipFilterMode(
    value: unknown,
    fallback: GroundItemsOwnershipFilterMode,
): GroundItemsOwnershipFilterMode {
    if (value === "all" || value === "takeable" || value === "drops") {
        return value;
    }
    return fallback;
}

function sanitizeDespawnTimerMode(
    value: unknown,
    fallback: GroundItemsDespawnTimerMode,
): GroundItemsDespawnTimerMode {
    if (value === "off" || value === "ticks" || value === "seconds") {
        return value;
    }
    return fallback;
}

function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegex(source: string): string {
    return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseListToken(rawToken: string): CompiledPattern | undefined {
    const token = rawToken.trim();
    if (token.length === 0) return undefined;

    let base = token;
    let quantityOp: QuantityMatchOp | undefined;
    let quantityValue: number | undefined;

    // RuneLite syntax supports quantity operators with highlighted/hidden list entries:
    // item_name>10, item_name<5
    const quantityMatch = /(.*?)([<>])\s*(\d+)$/.exec(token);
    if (quantityMatch) {
        const quantityBase = quantityMatch[1];
        base = (typeof quantityBase === "string" ? quantityBase : "").trim();
        quantityOp = quantityMatch[2] === "<" ? "lt" : "gt";
        quantityValue = Math.max(0, Number(quantityMatch[3]) | 0);
    }

    if (base.length === 0) return undefined;

    // Exact match syntax: "item_name"
    const quoted = /^"(.*)"$/.exec(base);
    if (quoted) {
        const quotedName = quoted[1];
        const exact = normalizeName(typeof quotedName === "string" ? quotedName : "");
        if (exact.length === 0) return undefined;
        return { exact, quantityOp, quantityValue };
    }

    const normalized = normalizeName(base);
    if (normalized.length === 0) return undefined;
    const escaped = escapeRegex(normalized).replace(/\\\*/g, ".*");
    return {
        regex: new RegExp(`^${escaped}$`, "i"),
        quantityOp,
        quantityValue,
    };
}

function compileCsvList(raw: string): CompiledPattern[] {
    const entries = raw
        .split(/,|\n/)
        .map((part) => parseListToken(part))
        .filter((part): part is CompiledPattern => part !== undefined);
    const deduped = new Map<string, CompiledPattern>();
    for (const entry of entries) {
        const keyExact = entry.exact !== undefined ? entry.exact : entry.regex?.source || "";
        const keyQuantityOp = entry.quantityOp !== undefined ? entry.quantityOp : "";
        const keyQuantityValue = entry.quantityValue !== undefined ? entry.quantityValue : -1;
        const key = `${keyExact}|${keyQuantityOp}|${keyQuantityValue}`;
        deduped.set(key, entry);
    }
    return [...deduped.values()];
}

function formatWithCommas(value: number): string {
    const n = Math.max(0, Math.floor(value));
    return `${n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function matchesQuantity(
    pattern: Pick<CompiledPattern, "quantityOp" | "quantityValue">,
    quantity: number,
): boolean {
    if (!pattern.quantityOp) return true;
    const threshold = Math.max(0, pattern.quantityValue !== undefined ? pattern.quantityValue : 0);
    if (pattern.quantityOp === "lt") return quantity < threshold;
    return quantity > threshold;
}

function formatCompact(value: number): string {
    const n = Math.max(0, Math.floor(value));
    if (n >= 1_000_000_000) {
        const scaled = n / 1_000_000_000;
        return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}B`;
    }
    if (n >= 1_000_000) {
        const scaled = n / 1_000_000;
        return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}M`;
    }
    if (n >= 1_000) {
        const scaled = n / 1_000;
        return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}K`;
    }
    return `${n}`;
}

function valueByMode(
    geValue: number,
    haValue: number,
    mode: GroundItemsValueCalculationMode,
): number {
    if (mode === "ge") return geValue;
    if (mode === "ha") return haValue;
    return Math.max(geValue, haValue);
}

function buildLabel(stack: ClientGroundItemStack, config: GroundItemsPluginConfig): string {
    const qtyLabel =
        stack.quantity > 1 ? ` (${formatCompact(Math.max(1, stack.quantity | 0))})` : "";
    const baseLabel = `${stack.name}${qtyLabel}`;
    if (config.priceDisplayMode === "off" || (stack.itemId | 0) === COINS_ITEM_ID) {
        return baseLabel;
    }

    const geTotal = Math.max(0, (stack.gePrice | 0) * Math.max(1, stack.quantity | 0));
    const haTotal = Math.max(0, (stack.haPrice | 0) * Math.max(1, stack.quantity | 0));

    if (config.priceDisplayMode === "both") {
        const suffix: string[] = [];
        if (geTotal > 0) suffix.push(`GE: ${formatCompact(geTotal)} gp`);
        if (haTotal > 0) suffix.push(`HA: ${formatCompact(haTotal)} gp`);
        return suffix.length > 0 ? `${baseLabel} (${suffix.join(", ")})` : baseLabel;
    }

    const value = config.priceDisplayMode === "ge" ? geTotal : haTotal;
    if (value <= 0) return baseLabel;
    return `${baseLabel} (${formatCompact(value)} gp)`;
}

function getTicksRemaining(
    stack: ClientGroundItemStack,
    timing: GroundItemsTimingContext | undefined,
): number | undefined {
    if (!timing) return undefined;
    const expiresTick = Number(stack.expiresTick);
    if (!Number.isFinite(expiresTick) || expiresTick <= 0) return undefined;

    const currentTick = Math.max(0, timing.currentTick | 0);
    const tickPhaseRaw = Number.isFinite(timing.tickPhase) ? (timing.tickPhase as number) : 0;
    const tickPhase = Math.max(0, Math.min(0.999, tickPhaseRaw));
    const ticksRemaining = expiresTick - currentTick - tickPhase;
    if (!(ticksRemaining > 0)) return undefined;
    return ticksRemaining;
}

function formatTimerSuffix(
    config: GroundItemsPluginConfig,
    ticksRemaining: number | undefined,
    timing: GroundItemsTimingContext | undefined,
): string {
    if (config.despawnTimerMode === "off") return "";
    if (
        !(
            typeof ticksRemaining === "number" &&
            Number.isFinite(ticksRemaining) &&
            ticksRemaining > 0
        )
    ) {
        return "";
    }

    if (config.despawnTimerMode === "ticks") {
        return ` - ${Math.max(0, Math.ceil(ticksRemaining))}`;
    }

    const tickMsRaw = timing && Number.isFinite(timing.tickMs) ? (timing.tickMs as number) : 600;
    const tickMs = Math.max(1, tickMsRaw | 0);
    const seconds = Math.max(0, (ticksRemaining * tickMs) / 1000);
    return ` - ${seconds.toFixed(1)}`;
}

function getTimerPhaseColor(
    stack: ClientGroundItemStack,
    timing: GroundItemsTimingContext | undefined,
    ticksRemaining: number | undefined,
): number | undefined {
    if (
        !(
            typeof ticksRemaining === "number" &&
            Number.isFinite(ticksRemaining) &&
            ticksRemaining > 0
        )
    ) {
        return undefined;
    }
    if (!timing) return undefined;

    const currentTick = Math.max(0, timing.currentTick | 0);
    const tickPhaseRaw = Number.isFinite(timing.tickPhase) ? (timing.tickPhase as number) : 0;
    const tickPhase = Math.max(0, Math.min(0.999, tickPhaseRaw));
    const nowTick = currentTick + tickPhase;

    if (stack.isPrivate === true) {
        return TIMER_COLOR_PRIVATE;
    }

    const privateUntilTick = Number(stack.privateUntilTick);
    if (Number.isFinite(privateUntilTick) && privateUntilTick > nowTick) {
        return TIMER_COLOR_PRIVATE;
    }

    return TIMER_COLOR_PUBLIC;
}

function shouldDisplayByOwnership(
    mode: GroundItemsOwnershipFilterMode,
    ownership: number,
    accountType: number,
): boolean {
    if (mode === "drops") {
        return ownership === 1 || ownership === 3;
    }
    if (mode === "takeable") {
        // RuneLite parity:
        // mains (accountType=0) can take "other" ownership items once public.
        return ownership !== TILE_ITEM_OWNERSHIP_OTHER || accountType === ACCOUNT_TYPE_MAIN;
    }
    return true;
}

export class GroundItemsPlugin {
    private readonly listeners: Set<GroundItemsListener> = new Set();
    private readonly persistence?: GroundItemsPluginPersistence;

    private highlightedPatterns: CompiledPattern[] = [];
    private hiddenPatterns: CompiledPattern[] = [];
    private config: GroundItemsPluginConfig;
    private state: GroundItemsPluginState;
    private version = 0;

    constructor(persistence?: GroundItemsPluginPersistence) {
        this.persistence = persistence;
        const loaded = persistence?.load();
        this.config = this.sanitizeConfig(loaded);
        this.highlightedPatterns = compileCsvList(this.config.highlightedItems);
        this.hiddenPatterns = compileCsvList(this.config.hiddenItems);
        this.state = {
            config: this.config,
            version: this.version,
        };
    }

    subscribe(listener: GroundItemsListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getState(): GroundItemsPluginState {
        return this.state;
    }

    getConfig(): GroundItemsPluginConfig {
        return this.state.config;
    }

    getVersion(): number {
        return this.version | 0;
    }

    setConfig(nextConfig: Partial<GroundItemsPluginConfig>): void {
        this.config = this.sanitizeConfig({
            ...this.config,
            ...nextConfig,
        });
        this.highlightedPatterns = compileCsvList(this.config.highlightedItems);
        this.hiddenPatterns = compileCsvList(this.config.hiddenItems);
        this.commit();
    }

    evaluateStack(
        stack: ClientGroundItemStack,
        options?: {
            includeTimerLabel?: boolean;
            timing?: GroundItemsTimingContext;
            respectOwnershipFilter?: boolean;
            accountType?: number;
        },
    ): GroundItemEvaluation {
        const config = this.config;
        const ownership = Number.isFinite(stack.ownership) ? (stack.ownership as number) | 0 : 0;
        const accountTypeRaw = options?.accountType;
        const accountType = Number.isFinite(accountTypeRaw)
            ? (accountTypeRaw as number) | 0
            : ACCOUNT_TYPE_MAIN;
        const ownershipVisible = shouldDisplayByOwnership(
            config.ownershipFilterMode,
            ownership,
            accountType,
        );
        const respectOwnershipFilter = options?.respectOwnershipFilter !== false;
        if (respectOwnershipFilter && !ownershipVisible) {
            return {
                stack,
                label: "",
                baseLabel: "",
                color: config.hiddenColor,
                hidden: true,
                highlighted: false,
            };
        }

        const normalizedName = normalizeName(stack.name);
        const quantity = Math.max(1, stack.quantity | 0);
        const explicitHighlight = this.matches(this.highlightedPatterns, normalizedName, quantity);
        const explicitHidden = this.matches(this.hiddenPatterns, normalizedName, quantity);
        const geValue = Math.max(0, stack.gePrice | 0) * quantity;
        const haValue = Math.max(0, stack.haPrice | 0) * quantity;

        const canBeHidden = geValue > 0 || stack.tradeable === true || !config.dontHideUntradeables;
        const implicitHidden =
            !explicitHighlight &&
            canBeHidden &&
            geValue < config.hideUnderValue &&
            haValue < config.hideUnderValue;
        const hidden = explicitHidden || implicitHidden;

        let highlighted = false;
        let color = config.defaultColor;
        if (explicitHighlight) {
            highlighted = true;
            color = config.highlightedColor;
        } else if (!explicitHidden) {
            const tierColor = this.getTierColor(geValue, haValue, config);
            if (tierColor !== undefined) {
                highlighted = true;
                color = tierColor;
            } else if (hidden) {
                color = config.hiddenColor;
            }
        } else {
            color = config.hiddenColor;
        }

        const baseLabel = buildLabel(stack, config);
        const ticksRemaining = getTicksRemaining(stack, options?.timing);
        const timerLabel =
            options?.includeTimerLabel === true
                ? formatTimerSuffix(config, ticksRemaining, options?.timing)
                : "";
        const timerColor =
            timerLabel.length > 0
                ? getTimerPhaseColor(stack, options?.timing, ticksRemaining)
                : undefined;

        return {
            stack,
            label: `${baseLabel}${timerLabel}`,
            baseLabel,
            timerLabel: timerLabel.length > 0 ? timerLabel : undefined,
            timerColor,
            color,
            hidden,
            highlighted,
        };
    }

    shouldDisplayStack(
        stack: ClientGroundItemStack,
        options?: {
            accountType?: number;
        },
    ): boolean {
        if (!this.config.enabled) return false;
        const evalResult = this.evaluateStack(stack, { accountType: options?.accountType });
        if (!evalResult.highlighted) {
            if (evalResult.hidden) return false;
            if (this.config.showHighlightedOnly) return false;
        }
        return true;
    }

    getValueForStack(stack: ClientGroundItemStack): number {
        const quantity = Math.max(1, stack.quantity | 0);
        const geValue = Math.max(0, stack.gePrice | 0) * quantity;
        const haValue = Math.max(0, stack.haPrice | 0) * quantity;
        return valueByMode(geValue, haValue, this.config.valueCalculationMode);
    }

    getMenuTargetName(stack: ClientGroundItemStack, baseName?: string): string {
        const name = typeof baseName === "string" && baseName.length > 0 ? baseName : stack.name;
        if (!this.config.enabled) {
            return name;
        }
        if (!this.config.showMenuItemQuantities) {
            return name;
        }
        if ((stack.quantity | 0) <= 1) {
            return name;
        }
        return `${name} (${formatWithCommas(stack.quantity)})`;
    }

    getMenuTargetColorized(stack: ClientGroundItemStack, targetName: string): string {
        if (!this.config.enabled) {
            return targetName;
        }
        if (!this.config.recolorMenuHiddenItems) {
            return targetName;
        }
        const evaluation = this.evaluateStack(stack, { respectOwnershipFilter: false });
        if (!evaluation.hidden) {
            return targetName;
        }
        return `<col=${(evaluation.color >>> 0).toString(16).padStart(6, "0")}>${targetName}</col>`;
    }

    shouldDeprioritizeInMenu(stack: ClientGroundItemStack): boolean {
        if (!this.config.enabled) {
            return false;
        }
        if (!this.config.rightClickHidden) {
            return false;
        }
        return this.evaluateStack(stack, { respectOwnershipFilter: false }).hidden;
    }

    private getTierColor(
        geValue: number,
        haValue: number,
        config: GroundItemsPluginConfig,
    ): number | undefined {
        const value = valueByMode(geValue, haValue, config.valueCalculationMode);
        if (config.insaneValuePrice > 0 && value >= config.insaneValuePrice) {
            return config.insaneValueColor;
        }
        if (config.highValuePrice > 0 && value >= config.highValuePrice) {
            return config.highValueColor;
        }
        if (config.mediumValuePrice > 0 && value >= config.mediumValuePrice) {
            return config.mediumValueColor;
        }
        if (config.lowValuePrice > 0 && value >= config.lowValuePrice) {
            return config.lowValueColor;
        }
        return undefined;
    }

    private matches(
        patterns: CompiledPattern[],
        normalizedName: string,
        quantity: number,
    ): boolean {
        for (const pattern of patterns) {
            const nameMatches =
                pattern.exact !== undefined
                    ? pattern.exact === normalizedName
                    : pattern.regex
                    ? pattern.regex.test(normalizedName)
                    : false;
            if (!nameMatches) continue;
            if (!matchesQuantity(pattern, quantity)) continue;
            return true;
        }
        return false;
    }

    private sanitizeConfig(
        input: Partial<GroundItemsPluginConfig> | undefined,
    ): GroundItemsPluginConfig {
        const src = input ? input : {};
        return {
            enabled: src.enabled !== false,
            highlightedItems:
                typeof src.highlightedItems === "string"
                    ? src.highlightedItems
                    : DEFAULT_CONFIG.highlightedItems,
            hiddenItems:
                typeof src.hiddenItems === "string" ? src.hiddenItems : DEFAULT_CONFIG.hiddenItems,
            showHighlightedOnly:
                src.showHighlightedOnly === true ? true : DEFAULT_CONFIG.showHighlightedOnly,
            rightClickHidden:
                src.rightClickHidden === true ? true : DEFAULT_CONFIG.rightClickHidden,
            recolorMenuHiddenItems:
                src.recolorMenuHiddenItems === true ? true : DEFAULT_CONFIG.recolorMenuHiddenItems,
            showMenuItemQuantities: src.showMenuItemQuantities !== false,
            dontHideUntradeables:
                src.dontHideUntradeables !== false ? true : DEFAULT_CONFIG.dontHideUntradeables,
            hideUnderValue: sanitizeNumber(src.hideUnderValue, DEFAULT_CONFIG.hideUnderValue),
            priceDisplayMode: sanitizeMode(src.priceDisplayMode, DEFAULT_CONFIG.priceDisplayMode),
            valueCalculationMode: sanitizeValueMode(
                src.valueCalculationMode,
                DEFAULT_CONFIG.valueCalculationMode,
            ),
            defaultColor: sanitizeColor(src.defaultColor, DEFAULT_CONFIG.defaultColor),
            highlightedColor: sanitizeColor(src.highlightedColor, DEFAULT_CONFIG.highlightedColor),
            hiddenColor: sanitizeColor(src.hiddenColor, DEFAULT_CONFIG.hiddenColor),
            lowValueColor: sanitizeColor(src.lowValueColor, DEFAULT_CONFIG.lowValueColor),
            lowValuePrice: sanitizeNumber(src.lowValuePrice, DEFAULT_CONFIG.lowValuePrice),
            mediumValueColor: sanitizeColor(src.mediumValueColor, DEFAULT_CONFIG.mediumValueColor),
            mediumValuePrice: sanitizeNumber(src.mediumValuePrice, DEFAULT_CONFIG.mediumValuePrice),
            highValueColor: sanitizeColor(src.highValueColor, DEFAULT_CONFIG.highValueColor),
            highValuePrice: sanitizeNumber(src.highValuePrice, DEFAULT_CONFIG.highValuePrice),
            insaneValueColor: sanitizeColor(src.insaneValueColor, DEFAULT_CONFIG.insaneValueColor),
            insaneValuePrice: sanitizeNumber(src.insaneValuePrice, DEFAULT_CONFIG.insaneValuePrice),
            ownershipFilterMode: sanitizeOwnershipFilterMode(
                src.ownershipFilterMode,
                DEFAULT_CONFIG.ownershipFilterMode,
            ),
            despawnTimerMode: sanitizeDespawnTimerMode(
                src.despawnTimerMode,
                DEFAULT_CONFIG.despawnTimerMode,
            ),
        };
    }

    private commit(): void {
        this.version++;
        this.state = {
            config: this.config,
            version: this.version,
        };
        this.persistence?.save(this.config);
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[ground-items] listener failed", err);
            }
        }
    }
}

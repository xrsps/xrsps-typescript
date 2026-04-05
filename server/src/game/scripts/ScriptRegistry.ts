import {
    ANY_ITEM_ID,
    ANY_LOC_ID,
    type ClientMessageHandler,
    type CommandHandler,
    type EquipmentActionHandler,
    type IScriptRegistry,
    type ItemOnItemHandler,
    type ItemOnLocHandler,
    type LocInteractionHandler,
    type NpcInteractionHandler,
    type RegionEventHandler,
    type ScriptActionHandler,
    type ScriptRegistrationResult,
    type TickHandler,
    type WidgetActionHandler,
} from "./types";

type RegistryKey = string;

const normalizeOption = (value?: string): string => {
    if (!value) return "";
    return value.trim().toLowerCase();
};

const makeNpcKey = (npcId: number, option?: string): RegistryKey =>
    `${npcId}#${normalizeOption(option)}`;

const makeLocKey = (locId: number, action?: string): RegistryKey =>
    `${locId}#${normalizeOption(action)}`;

const makeItemKey = (sourceItemId: number, targetItemId?: number, option?: string): RegistryKey => {
    const secondary = targetItemId !== undefined ? `${targetItemId}` : "";
    return `${sourceItemId}#${secondary}#${normalizeOption(option)}`;
};

const ANY_WIDGET_OP = "*";
const ANY_WIDGET_ID = "*";
const makeWidgetKey = (
    widgetId: number | undefined,
    opId?: number,
    option?: string,
): RegistryKey => {
    const wid = Number.isFinite(widgetId) ? String(widgetId) : ANY_WIDGET_ID;
    const op = Number.isFinite(opId) ? String(opId) : ANY_WIDGET_OP;
    return `${wid}#${op}#${normalizeOption(option)}`;
};

const makeEquipmentKey = (itemId: number, option?: string): RegistryKey =>
    `${itemId}#${normalizeOption(option)}`;

const makeRegistrationResult = (
    map: Map<RegistryKey, NpcInteractionHandler | LocInteractionHandler>,
    key: RegistryKey,
): ScriptRegistrationResult => ({
    unregister: () => {
        map.delete(key);
    },
});

function warnOverwrite(map: Map<any, any>, key: any, label: string): void {
    if (map.has(key)) {
        console.log(`[script] warning: overwriting ${label} handler for key "${key}"`);
    }
}

export class ScriptRegistry implements IScriptRegistry {
    private readonly npcHandlers = new Map<RegistryKey, NpcInteractionHandler>();
    private readonly locHandlers = new Map<RegistryKey, LocInteractionHandler>();
    private readonly locActionHandlers = new Map<string, LocInteractionHandler>();
    private readonly npcActionHandlers = new Map<string, NpcInteractionHandler>();
    private readonly itemHandlers = new Map<RegistryKey, ItemOnItemHandler>();
    private readonly itemOnLocHandlers = new Map<RegistryKey, ItemOnLocHandler>();
    private readonly itemActionHandlers = new Map<string, ItemOnItemHandler>();
    private readonly equipmentHandlers = new Map<RegistryKey, EquipmentActionHandler>();
    private readonly equipmentOptionHandlers = new Map<string, EquipmentActionHandler>();
    private readonly regionHandlers = new Map<number, Set<RegionEventHandler>>();
    private readonly tickHandlers = new Set<TickHandler>();
    private readonly widgetHandlers = new Map<RegistryKey, WidgetActionHandler[]>();
    /** RSMod-style button handlers keyed by (interfaceId << 16) | componentId */
    private readonly buttonHandlers = new Map<number, WidgetActionHandler>();
    private readonly commandHandlers = new Map<string, CommandHandler>();
    private readonly clientMessageHandlers = new Map<string, ClientMessageHandler>();
    private readonly actionHandlers = new Map<string, ScriptActionHandler>();

    registerNpcInteraction(
        npcId: number,
        handler: NpcInteractionHandler,
        option?: string,
    ): ScriptRegistrationResult {
        const key = makeNpcKey(npcId, option);
        warnOverwrite(this.npcHandlers, key, "npc");
        this.npcHandlers.set(key, handler);
        return makeRegistrationResult(this.npcHandlers, key);
    }

    registerNpcScript(params: {
        npcId: number;
        option?: string;
        handler: NpcInteractionHandler;
    }): ScriptRegistrationResult {
        return this.registerNpcInteraction(params.npcId, params.handler, params.option);
    }

    registerLocInteraction(
        locId: number,
        handler: LocInteractionHandler,
        action?: string,
    ): ScriptRegistrationResult {
        const key = makeLocKey(locId, action);
        warnOverwrite(this.locHandlers, key, "loc");
        this.locHandlers.set(key, handler);
        return makeRegistrationResult(this.locHandlers, key);
    }

    registerLocScript(params: {
        locId: number;
        action?: string;
        handler: LocInteractionHandler;
    }): ScriptRegistrationResult {
        return this.registerLocInteraction(params.locId, params.handler, params.action);
    }

    registerLocAction(action: string, handler: LocInteractionHandler): ScriptRegistrationResult {
        const key = normalizeOption(action);
        warnOverwrite(this.locActionHandlers, key, "loc-action");
        this.locActionHandlers.set(key, handler);
        return {
            unregister: () => {
                this.locActionHandlers.delete(key);
            },
        };
    }

    registerItemOnItem(
        sourceItemId: number,
        targetItemId: number,
        handler: ItemOnItemHandler,
        option?: string,
    ): ScriptRegistrationResult {
        const forwardKey = makeItemKey(sourceItemId, targetItemId, option);
        const reverseKey = makeItemKey(targetItemId, sourceItemId, option);
        warnOverwrite(this.itemHandlers, forwardKey, "item-on-item");
        this.itemHandlers.set(forwardKey, handler);
        this.itemHandlers.set(reverseKey, handler);
        return {
            unregister: () => {
                this.itemHandlers.delete(forwardKey);
                this.itemHandlers.delete(reverseKey);
            },
        };
    }

    registerItemOnLoc(
        sourceItemId: number,
        locId: number,
        handler: ItemOnLocHandler,
        option?: string,
    ): ScriptRegistrationResult {
        const key = makeItemKey(sourceItemId, locId, option);
        warnOverwrite(this.itemOnLocHandlers, key, "item-on-loc");
        this.itemOnLocHandlers.set(key, handler);
        return {
            unregister: () => {
                this.itemOnLocHandlers.delete(key);
            },
        };
    }

    registerItemAction(
        itemId: number,
        handler: ItemOnItemHandler,
        option?: string,
    ): ScriptRegistrationResult {
        const key = makeItemKey(itemId, undefined, option);
        warnOverwrite(this.itemActionHandlers, key, "item-action");
        this.itemActionHandlers.set(key, handler);
        return {
            unregister: () => {
                this.itemActionHandlers.delete(key);
            },
        };
    }

    registerEquipmentAction(
        itemId: number,
        handler: EquipmentActionHandler,
        option?: string,
    ): ScriptRegistrationResult {
        const key = makeEquipmentKey(itemId, option);
        warnOverwrite(this.equipmentHandlers, key, "equipment");
        this.equipmentHandlers.set(key, handler);
        return {
            unregister: () => {
                this.equipmentHandlers.delete(key);
            },
        };
    }

    registerEquipmentOption(
        option: string,
        handler: EquipmentActionHandler,
    ): ScriptRegistrationResult {
        const key = normalizeOption(option);
        warnOverwrite(this.equipmentOptionHandlers, key, "equipment-option");
        this.equipmentOptionHandlers.set(key, handler);
        return {
            unregister: () => {
                this.equipmentOptionHandlers.delete(key);
            },
        };
    }

    registerWidgetAction(params: {
        widgetId?: number;
        opId?: number;
        option?: string;
        handler: WidgetActionHandler;
    }): ScriptRegistrationResult {
        const key = makeWidgetKey(params.widgetId, params.opId, params.option);
        const existing = this.widgetHandlers.get(key) ?? [];
        existing.push(params.handler);
        this.widgetHandlers.set(key, existing);
        return {
            unregister: () => {
                const arr = this.widgetHandlers.get(key);
                if (arr) {
                    const idx = arr.indexOf(params.handler);
                    if (idx >= 0) arr.splice(idx, 1);
                    if (arr.length === 0) this.widgetHandlers.delete(key);
                }
            },
        };
    }

    /**
     * RSMod-style button registration by (interfaceId, componentId) hash.
     * This is the preferred method for registering widget button handlers.
     */
    onButton(
        interfaceId: number,
        component: number,
        handler: WidgetActionHandler,
    ): ScriptRegistrationResult {
        const hash = (interfaceId << 16) | (component & 0xffff);
        warnOverwrite(this.buttonHandlers, hash, `button(${interfaceId}:${component})`);
        this.buttonHandlers.set(hash, handler);
        return {
            unregister: () => {
                this.buttonHandlers.delete(hash);
            },
        };
    }

    /**
     * RSMod-style button lookup by (interfaceId, componentId) hash.
     */
    findButton(interfaceId: number, component: number): WidgetActionHandler | undefined {
        const hash = (interfaceId << 16) | (component & 0xffff);
        return this.buttonHandlers.get(hash);
    }

    registerNpcAction(option: string, handler: NpcInteractionHandler): ScriptRegistrationResult {
        const key = normalizeOption(option);
        warnOverwrite(this.npcActionHandlers, key, "npc-action");
        this.npcActionHandlers.set(key, handler);
        return {
            unregister: () => {
                this.npcActionHandlers.delete(key);
            },
        };
    }

    registerRegionHandler(regionId: number, handler: RegionEventHandler): ScriptRegistrationResult {
        const key = regionId;
        const set = this.regionHandlers.get(key) ?? new Set<RegionEventHandler>();
        set.add(handler);
        this.regionHandlers.set(key, set);
        return {
            unregister: () => {
                const bucket = this.regionHandlers.get(key);
                if (!bucket) return;
                bucket.delete(handler);
                if (bucket.size === 0) {
                    this.regionHandlers.delete(key);
                }
            },
        };
    }

    registerTickHandler(handler: TickHandler): ScriptRegistrationResult {
        this.tickHandlers.add(handler);
        return {
            unregister: () => {
                this.tickHandlers.delete(handler);
            },
        };
    }

    registerCommand(name: string, handler: CommandHandler): ScriptRegistrationResult {
        const normalized = name.trim().toLowerCase();
        warnOverwrite(this.commandHandlers, normalized, "command");
        this.commandHandlers.set(normalized, handler);
        return {
            unregister: () => {
                this.commandHandlers.delete(normalized);
            },
        };
    }

    findCommand(name: string): CommandHandler | undefined {
        return this.commandHandlers.get(name.trim().toLowerCase());
    }

    registerClientMessageHandler(
        messageType: string,
        handler: ClientMessageHandler,
    ): ScriptRegistrationResult {
        const key = messageType.trim().toLowerCase();
        warnOverwrite(this.clientMessageHandlers, key, "client-message");
        this.clientMessageHandlers.set(key, handler);
        return {
            unregister: () => {
                this.clientMessageHandlers.delete(key);
            },
        };
    }

    findClientMessageHandler(messageType: string): ClientMessageHandler | undefined {
        return this.clientMessageHandlers.get(messageType.trim().toLowerCase());
    }

    registerActionHandler(
        kind: string,
        handler: ScriptActionHandler,
    ): ScriptRegistrationResult {
        warnOverwrite(this.actionHandlers, kind, "action");
        this.actionHandlers.set(kind, handler);
        return {
            unregister: () => {
                this.actionHandlers.delete(kind);
            },
        };
    }

    findActionHandler(kind: string): ScriptActionHandler | undefined {
        return this.actionHandlers.get(kind);
    }

    findItemAction(itemId: number, option?: string): ItemOnItemHandler | undefined {
        const key = makeItemKey(itemId, undefined, option);
        const direct = this.itemActionHandlers.get(key);
        if (direct) return direct;
        if (option) {
            const fallback = makeItemKey(itemId, undefined, undefined);
            return this.itemActionHandlers.get(fallback);
        }
        return undefined;
    }

    findNpcInteraction(npcId: number, option?: string): NpcInteractionHandler | undefined {
        const key = makeNpcKey(npcId, option);
        const direct = this.npcHandlers.get(key);
        if (direct) return direct;
        return this.npcActionHandlers.get(normalizeOption(option));
    }

    findNpcInteractionDirect(npcId: number, option?: string): NpcInteractionHandler | undefined {
        const key = makeNpcKey(npcId, option);
        return this.npcHandlers.get(key);
    }

    findNpcAction(option?: string): NpcInteractionHandler | undefined {
        return this.npcActionHandlers.get(normalizeOption(option));
    }

    findLocInteraction(locId: number, action?: string): LocInteractionHandler | undefined {
        const key = makeLocKey(locId, action);
        const handler = this.locHandlers.get(key);
        if (handler) return handler;
        const actionHandler = this.locActionHandlers.get(normalizeOption(action));
        return actionHandler;
    }

    findItemOnItem(
        sourceItemId: number,
        targetItemId: number,
        option?: string,
    ): ItemOnItemHandler | undefined {
        const key = makeItemKey(sourceItemId, targetItemId, option);
        const direct = this.itemHandlers.get(key);
        if (direct) return direct;
        const actionKey = makeItemKey(sourceItemId, undefined, option);
        const actionDirect = this.itemActionHandlers.get(actionKey);
        if (actionDirect) return actionDirect;
        if (option) {
            const fallback = makeItemKey(sourceItemId, undefined, undefined);
            return this.itemActionHandlers.get(fallback);
        }
        return undefined;
    }

    findItemOnLoc(
        sourceItemId: number,
        locId: number,
        option?: string,
    ): ItemOnLocHandler | undefined {
        const key = makeItemKey(sourceItemId, locId, option);
        const direct = this.itemOnLocHandlers.get(key);
        if (direct) return direct;
        const itemWildcard = makeItemKey(ANY_ITEM_ID, locId, option);
        const byItemWild = this.itemOnLocHandlers.get(itemWildcard);
        if (byItemWild) return byItemWild;
        const locWildcard = makeItemKey(sourceItemId, ANY_LOC_ID, option);
        return this.itemOnLocHandlers.get(locWildcard);
    }

    findEquipmentAction(itemId: number, option?: string): EquipmentActionHandler | undefined {
        const key = makeEquipmentKey(itemId, option);
        const direct = this.equipmentHandlers.get(key);
        if (direct) return direct;
        return this.equipmentOptionHandlers.get(normalizeOption(option));
    }

    findWidgetAction(
        widgetId: number,
        opId?: number,
        option?: string,
    ): WidgetActionHandler | undefined {
        // RSMod-style: First check hash-based button handlers
        // widgetId here is the full UID = (interfaceId << 16) | componentId
        const normalizedWidgetId = widgetId;
        const buttonHandler = this.buttonHandlers.get(normalizedWidgetId);
        if (buttonHandler) {
            return buttonHandler;
        }

        // Collect matching handlers from legacy option-based handlers
        // Specific option handlers take priority over generic handlers for the same widget/op
        const allHandlers: WidgetActionHandler[] = [];
        const normalizedOption = normalizeOption(option);
        const widgetKeys = [...new Set([`${normalizedWidgetId}`, ANY_WIDGET_ID])];
        const opKey = Number.isFinite(opId) ? `${opId as number}` : ANY_WIDGET_OP;
        const opKeys = [...new Set([opKey, ANY_WIDGET_OP])];
        for (const wid of widgetKeys) {
            for (const op of opKeys) {
                // Try specific option handler first
                const specificKey = `${wid}#${op}#${normalizedOption}`;
                const specificHandlers = normalizedOption
                    ? this.widgetHandlers.get(specificKey)
                    : undefined;
                if (specificHandlers && specificHandlers.length > 0) {
                    // Specific handler found - use it, skip generic for this widget/op
                    allHandlers.push(...specificHandlers);
                } else {
                    // No specific handler - fall back to generic
                    const genericKey = `${wid}#${op}#`;
                    const genericHandlers = this.widgetHandlers.get(genericKey);
                    if (genericHandlers && genericHandlers.length > 0) {
                        allHandlers.push(...genericHandlers);
                    }
                }
            }
        }
        if (allHandlers.length === 0) return undefined;
        if (allHandlers.length === 1) return allHandlers[0];
        // Return a composite handler that calls all matching handlers
        return (event) => {
            for (const handler of allHandlers) {
                handler(event);
            }
        };
    }

    getRegionHandlers(regionId: number): ReadonlySet<RegionEventHandler> | undefined {
        return this.regionHandlers.get(regionId);
    }

    getTickHandlers(): ReadonlySet<TickHandler> {
        return this.tickHandlers;
    }

    clearAll(): void {
        this.npcHandlers.clear();
        this.locHandlers.clear();
        this.locActionHandlers.clear();
        this.npcActionHandlers.clear();
        this.itemHandlers.clear();
        this.itemOnLocHandlers.clear();
        this.itemActionHandlers.clear();
        this.equipmentHandlers.clear();
        this.equipmentOptionHandlers.clear();
        this.regionHandlers.clear();
        this.tickHandlers.clear();
        this.widgetHandlers.clear();
        this.buttonHandlers.clear();
        this.commandHandlers.clear();
        this.clientMessageHandlers.clear();
        this.actionHandlers.clear();
    }
}

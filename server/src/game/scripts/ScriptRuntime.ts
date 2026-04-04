import { logger as defaultLogger } from "../../utils/logger";
import { ScriptScheduler } from "../systems/ScriptScheduler";
import { ScriptRegistry } from "./ScriptRegistry";
import {
    type EquipmentActionEvent,
    type EquipmentActionHandler,
    type IScriptRegistry,
    type ItemOnItemEvent,
    type ItemOnItemHandler,
    type ItemOnLocEvent,
    type ItemOnLocHandler,
    type LocInteractionEvent,
    type LocInteractionHandler,
    type NpcInteractionEvent,
    type NpcInteractionHandler,
    type RegionEvent,
    type RegionEventHandler,
    type ScriptModule,
    type ScriptRegistrationResult,
    type ScriptServices,
    type TickHandler,
    type TickScriptEvent,
    type WidgetActionEvent,
    type WidgetActionHandler,
} from "./types";

type LoggerLike = {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
};

interface ScriptRuntimeOptions {
    registry: ScriptRegistry;
    scheduler: ScriptScheduler;
    logger?: LoggerLike;
    services: ScriptServices;
}

export class ScriptRuntime {
    private readonly registry: ScriptRegistry;
    private readonly scheduler: ScriptScheduler;
    private readonly logger: LoggerLike;
    private readonly services: ScriptServices;
    private readonly loadedModuleIds = new Set<string>();
    private readonly moduleDisposers = new Map<string, ScriptRegistrationResult[]>();
    private readonly hotReloadEnabled: boolean;

    constructor(options: ScriptRuntimeOptions) {
        this.registry = options.registry;
        this.scheduler = options.scheduler;
        this.logger = options.logger ?? defaultLogger;
        const hostServices = options.services;
        const hotReloadFlag =
            hostServices.hotReloadEnabled ?? process.env.SCRIPT_HOT_RELOAD === "1";
        this.hotReloadEnabled = !!hotReloadFlag;
        this.services = {
            ...hostServices,
            logger: hostServices.logger ?? this.logger,
            hotReloadEnabled: this.hotReloadEnabled,
        };
    }

    getServices(): ScriptServices {
        return this.services;
    }

    loadModule(module: ScriptModule): void {
        if (!this.hotReloadEnabled && this.loadedModuleIds.has(module.id)) {
            this.logger.debug(`[script] module already loaded: ${module.id}`);
            return;
        }
        if (this.hotReloadEnabled && this.loadedModuleIds.has(module.id)) {
            this.unloadModule(module.id);
        }
        const disposers: ScriptRegistrationResult[] = [];
        const trackingRegistry = this.createTrackingRegistry(disposers);
        module.register(trackingRegistry, this.services);
        this.moduleDisposers.set(module.id, disposers);
        this.loadedModuleIds.add(module.id);
        this.logger.info(`[script] loaded module: ${module.id}`);
    }

    queueNpcInteraction(event: Omit<NpcInteractionEvent, "services">): boolean {
        const scriptEvent: NpcInteractionEvent = { ...event, services: this.services };
        const npcId = scriptEvent.npc.id;
        const npcTypeId = scriptEvent.npc.typeId;
        const playerId = scriptEvent.player.id;
        const tick = scriptEvent.tick;
        let handlerSource = "";
        let handler = this.registry.findNpcInteractionDirect(npcId, scriptEvent.option);
        if (handler) handlerSource = "instance";
        if (!handler) {
            handler = this.registry.findNpcInteractionDirect(npcTypeId, scriptEvent.option);
            if (handler) handlerSource = "type";
        }
        if (!handler) {
            handler = this.registry.findNpcAction(scriptEvent.option);
            if (handler) handlerSource = "action";
        }
        if (!handler) {
            this.logger.info(
                `[script] no NPC handler for id=${npcId} type=${npcTypeId} option=${
                    scriptEvent.option || "default"
                }`,
            );
            return false;
        }
        this.logger.info(
            `[script] queue npc handler id=${npcId} type=${npcTypeId} option=${
                scriptEvent.option || "default"
            } via=${handlerSource} player=${playerId}`,
        );
        this.scheduleHandler(
            tick,
            handler,
            scriptEvent,
            () => `[script] npc id=${npcId} option=${scriptEvent.option || "default"}`,
        );
        return true;
    }

    queueLocInteraction(event: Omit<LocInteractionEvent, "services">): boolean {
        const scriptEvent: LocInteractionEvent = { ...event, services: this.services };
        const locId = scriptEvent.locId;
        const tick = scriptEvent.tick;
        const handler = this.registry.findLocInteraction(locId, scriptEvent.action);
        if (!handler) {
            this.logger.debug(
                `[script] no loc handler for id=${locId} action=${scriptEvent.action || "default"}`,
            );
            return false;
        }
        this.scheduleHandler(
            tick,
            handler,
            scriptEvent,
            () => `[script] loc id=${locId} action=${scriptEvent.action || "default"}`,
        );
        return true;
    }

    runLocInteractionNow(event: Omit<LocInteractionEvent, "services">): boolean {
        const scriptEvent: LocInteractionEvent = { ...event, services: this.services };
        const locId = scriptEvent.locId;
        const handler = this.registry.findLocInteraction(locId, scriptEvent.action);
        if (!handler) {
            this.logger.debug(
                `[script] no loc handler for id=${locId} action=${scriptEvent.action || "default"}`,
            );
            return false;
        }
        try {
            const result = handler(scriptEvent);
            if (result instanceof Promise) {
                result.catch((err) => {
                    this.logger.warn(
                        `[script] immediate loc id=${locId} action=${
                            scriptEvent.action || "default"
                        } threw (async)`,
                        {
                            error: err instanceof Error ? err.stack ?? err.message : err,
                        },
                    );
                });
            }
        } catch (err) {
            this.logger.warn(
                `[script] immediate loc id=${locId} action=${
                    scriptEvent.action || "default"
                } threw`,
                {
                    error: err instanceof Error ? err.stack ?? err.message : err,
                },
            );
        }
        return true;
    }

    queueItemOnItem(event: Omit<ItemOnItemEvent, "services">): boolean {
        const scriptEvent: ItemOnItemEvent = { ...event, services: this.services };
        const sourceItemId = scriptEvent.source.itemId;
        const targetItemId = scriptEvent.target.itemId;
        const tick = scriptEvent.tick;
        const handler = this.registry.findItemOnItem(
            sourceItemId,
            targetItemId,
            scriptEvent.option,
        );
        if (!handler) {
            this.logger.debug(
                `[script] no item handler for source=${sourceItemId} target=${targetItemId} option=${
                    scriptEvent.option || "default"
                }`,
            );
            return false;
        }
        this.scheduleHandler(
            tick,
            handler,
            scriptEvent,
            () =>
                `[script] item ${sourceItemId} -> ${targetItemId} option=${
                    scriptEvent.option || "default"
                }`,
        );
        return true;
    }

    queueItemOnLoc(event: Omit<ItemOnLocEvent, "services">): boolean {
        const scriptEvent: ItemOnLocEvent = { ...event, services: this.services };
        const sourceItemId = scriptEvent.source.itemId;
        const locId = scriptEvent.target.locId;
        const tick = scriptEvent.tick;
        const handler = this.registry.findItemOnLoc(sourceItemId, locId, scriptEvent.option);
        if (!handler) {
            this.logger.debug(
                `[script] no item-on-loc handler for source=${sourceItemId} loc=${locId} option=${
                    scriptEvent.option || "default"
                }`,
            );
            return false;
        }
        this.scheduleHandler(
            tick,
            handler,
            scriptEvent,
            () =>
                `[script] item ${sourceItemId} -> loc ${locId} option=${
                    scriptEvent.option || "default"
                }`,
        );
        return true;
    }

    // Single-item action (e.g., bones -> "Bury"). Looks up registerItemAction handlers.
    queueItemAction(event: {
        tick: number;
        player: import("../player").PlayerState;
        itemId: number;
        slot: number;
        option?: string;
    }): boolean {
        const scriptEvent: ItemOnItemEvent = {
            tick: event.tick,
            services: this.services,
            player: event.player,
            source: { slot: event.slot, itemId: event.itemId },
            target: { slot: -1, itemId: -1 },
            option: event.option,
        };
        const sourceItemId = scriptEvent.source.itemId;
        const handler = this.registry.findItemOnItem(sourceItemId, -1, scriptEvent.option);
        if (!handler) {
            this.logger.debug(
                `[script] no item action for item=${sourceItemId} option=${
                    scriptEvent.option || "default"
                }`,
            );
            return false;
        }
        this.scheduleHandler(
            scriptEvent.tick,
            handler,
            scriptEvent,
            () => `[script] item action ${sourceItemId} option=${scriptEvent.option || "default"}`,
        );
        return true;
    }

    queueEquipmentAction(event: Omit<EquipmentActionEvent, "services">): boolean {
        const normalizedOption = (event.option || "").trim().toLowerCase();
        const scriptEvent: EquipmentActionEvent = {
            tick: event.tick,
            services: this.services,
            player: event.player,
            slot: event.slot,
            itemId: event.itemId,
            option: normalizedOption,
            rawOption: event.rawOption,
        };
        const itemId = scriptEvent.itemId;
        const handler = this.registry.findEquipmentAction(itemId, scriptEvent.option);
        if (!handler) {
            this.logger.debug(
                `[script] no equipment action for item=${itemId} option=${
                    scriptEvent.option || "default"
                }`,
            );
            return false;
        }
        this.scheduleHandler(
            scriptEvent.tick,
            handler,
            scriptEvent,
            () => `[script] equipment item=${itemId} option=${scriptEvent.option || "default"}`,
        );
        return true;
    }

    queueWidgetAction(event: {
        tick: number;
        player: import("../player").PlayerState;
        widgetId: number;
        groupId: number;
        childId: number;
        option?: string;
        target?: string;
        opId?: number;
        slot?: number;
        itemId?: number;
        isPrimary?: boolean;
        cursorX?: number;
        cursorY?: number;
    }): boolean {
        const widgetId = event.widgetId;
        const handler = this.registry.findWidgetAction(widgetId, event.opId, event.option);
        if (!handler) {
            this.logger.debug(
                `[script] no widget handler for widget=${widgetId} op=${event.opId ?? "*"} option=${
                    event.option || "default"
                }`,
            );
            return false;
        }
        const scriptEvent: WidgetActionEvent = {
            tick: event.tick,
            services: this.services,
            player: event.player,
            widgetId,
            groupId: event.groupId,
            childId: event.childId,
            option: event.option,
            target: event.target,
            opId: event.opId,
            slot: event.slot,
            itemId: event.itemId,
            isPrimary: event.isPrimary,
            cursorX: event.cursorX,
            cursorY: event.cursorY,
        };
        this.scheduleHandler(
            scriptEvent.tick,
            handler,
            scriptEvent,
            () =>
                `[script] widget=${scriptEvent.widgetId} op=${scriptEvent.opId ?? "*"} option=${
                    scriptEvent.option || "default"
                }`,
        );
        return true;
    }

    queueRegionEvent(event: RegionEvent): boolean {
        const scriptEvent: RegionEvent = { ...event, services: this.services };
        const regionId = scriptEvent.regionId;
        const tick = scriptEvent.tick;
        const handlers = this.registry.getRegionHandlers(scriptEvent.regionId);
        if (!handlers || handlers.size === 0) {
            this.logger.debug(
                `[script] no region handler for region=${regionId} type=${scriptEvent.type}`,
            );
            return false;
        }
        for (const handler of handlers) {
            this.scheduleHandler(
                tick,
                handler,
                scriptEvent,
                () => `[script] region=${regionId} type=${scriptEvent.type}`,
            );
        }
        return true;
    }

    queueTick(tick: number): void {
        if (this.registry.getTickHandlers().size === 0) return;
        const event: TickScriptEvent = { tick: tick, services: this.services };
        for (const handler of this.registry.getTickHandlers()) {
            this.scheduleHandler(
                event.tick,
                handler,
                event,
                () => `[script] tick handler (tick=${event.tick})`,
            );
        }
    }

    reset(): void {
        for (const [moduleId, disposers] of this.moduleDisposers.entries()) {
            for (const disposer of disposers.reverse()) {
                try {
                    disposer.unregister();
                } catch (err) {
                    this.logger.warn(`[script] disposer for module ${moduleId} threw`, err);
                }
            }
        }
        this.moduleDisposers.clear();
        this.registry.clearAll();
        this.scheduler.clear();
        this.loadedModuleIds.clear();
    }

    private unloadModule(moduleId: string): void {
        const disposers = this.moduleDisposers.get(moduleId);
        if (!disposers) return;
        for (const disposer of disposers.reverse()) {
            try {
                disposer.unregister();
            } catch (err) {
                this.logger.warn(`[script] disposer for module ${moduleId} threw`, err);
            }
        }
        this.moduleDisposers.delete(moduleId);
        this.loadedModuleIds.delete(moduleId);
    }

    private scheduleHandler<TEvent>(
        tick: number,
        handler: (event: TEvent) => void | Promise<void>,
        event: TEvent,
        describe: () => string,
    ): void {
        this.scheduler.scheduleAt(tick, () => {
            try {
                const result = handler(event);
                if (result instanceof Promise) {
                    result.catch((err) => {
                        this.logger.warn(`${describe()} threw (async)`, {
                            error: err instanceof Error ? err.stack ?? err.message : err,
                        });
                    });
                }
            } catch (err) {
                this.logger.warn(`${describe()} threw`, {
                    error: err instanceof Error ? err.stack ?? err.message : err,
                });
            }
        });
    }

    private createTrackingRegistry(disposers: ScriptRegistrationResult[]): IScriptRegistry {
        const track = (result: ScriptRegistrationResult | undefined): ScriptRegistrationResult => {
            const out: ScriptRegistrationResult = result ?? { unregister() {} };
            disposers.push(out);
            return out;
        };
        return {
            registerNpcInteraction: (npcId, handler, option) =>
                track(this.registry.registerNpcInteraction(npcId, handler, option)),
            registerNpcScript: (params) => track(this.registry.registerNpcScript(params)),
            registerLocInteraction: (locId, handler, action) =>
                track(this.registry.registerLocInteraction(locId, handler, action)),
            registerLocScript: (params) => track(this.registry.registerLocScript(params)),
            registerLocAction: (action, handler) =>
                track(this.registry.registerLocAction(action, handler)),
            registerItemOnItem: (
                sourceItemId: number,
                targetItemId: number,
                handler: ItemOnItemHandler,
                option?: string,
            ) =>
                track(
                    this.registry.registerItemOnItem(sourceItemId, targetItemId, handler, option),
                ),
            registerItemOnLoc: (
                sourceItemId: number,
                locId: number,
                handler: ItemOnLocHandler,
                option?: string,
            ) => track(this.registry.registerItemOnLoc(sourceItemId, locId, handler, option)),
            registerItemAction: (itemId: number, handler: ItemOnItemHandler, option?: string) =>
                track(this.registry.registerItemAction(itemId, handler, option)),
            registerEquipmentAction: (
                itemId: number,
                handler: EquipmentActionHandler,
                option?: string,
            ) => track(this.registry.registerEquipmentAction(itemId, handler, option)),
            registerEquipmentOption: (option: string, handler: EquipmentActionHandler) =>
                track(this.registry.registerEquipmentOption(option, handler)),
            registerWidgetAction: (params) => track(this.registry.registerWidgetAction(params)),
            onButton: (interfaceId: number, component: number, handler: WidgetActionHandler) =>
                track(this.registry.onButton(interfaceId, component, handler)),
            registerNpcAction: (option: string, handler: NpcInteractionHandler) =>
                track(this.registry.registerNpcAction(option, handler)),
            registerRegionHandler: (regionId: number, handler: RegionEventHandler) =>
                track(this.registry.registerRegionHandler(regionId, handler)),
            registerTickHandler: (handler: TickHandler) =>
                track(this.registry.registerTickHandler(handler)),
            findNpcInteraction: (npcId, option) => this.registry.findNpcInteraction(npcId, option),
            findLocInteraction: (locId, action) => this.registry.findLocInteraction(locId, action),
            findItemOnItem: (sourceItemId, targetItemId, option) =>
                this.registry.findItemOnItem(sourceItemId, targetItemId, option),
            findItemOnLoc: (sourceItemId, locId, option) =>
                this.registry.findItemOnLoc(sourceItemId, locId, option),
            findEquipmentAction: (itemId, option) =>
                this.registry.findEquipmentAction(itemId, option),
            findWidgetAction: (widgetId, opId, option) =>
                this.registry.findWidgetAction(widgetId, opId, option),
            findButton: (interfaceId, component) =>
                this.registry.findButton(interfaceId, component),
            findNpcAction: (option) => this.registry.findNpcAction(option),
        } as IScriptRegistry;
    }
}

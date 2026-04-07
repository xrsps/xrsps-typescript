import { performance } from "perf_hooks";
import { logger } from "../../utils/logger";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";
import type { ServerServices } from "../ServerServices";
import type { PlayerState } from "../player";
import { upsertNpcUpdateDelta } from "../../network/NpcExternalSync";
import { buildPlayerSaveKey } from "../state/PlayerSessionKeys";

export class TickFrameService {
    private autosaveIntervalTicks: number;
    private nextAutosaveTick: number;
    private autosaveRunning = false;

    constructor(
        private readonly svc: ServerServices,
        autosaveIntervalTicks: number,
    ) {
        this.autosaveIntervalTicks = autosaveIntervalTicks;
        this.nextAutosaveTick =
            autosaveIntervalTicks > 0 ? autosaveIntervalTicks : Number.MAX_SAFE_INTEGER;
    }

    async handleTick(data: { tick: number; time: number }): Promise<void> {
        const orchestrator = this.svc.tickOrchestrator;
        if (orchestrator) {
            await orchestrator.processTick(data.tick, data.time);
        }
    }

    createTickFrame(data: { tick: number; time: number }): TickFrame {
        const npcUpdates = this.svc.pendingNpcUpdates;
        const npcPackets = new Map(this.svc.pendingNpcPackets);
        const projectilePackets = this.svc.projectileSystem?.drainPendingPackets() ?? new Map();
        this.svc.pendingNpcPackets.clear();
        this.svc.pendingNpcUpdates = [];

        const scheduler = this.svc.broadcastScheduler;
        const widgetEvents = scheduler.drainWidgetEvents();
        const notifications = scheduler.drainNotifications();
        const keyedMessages = scheduler.drainAllKeyedMessages();
        const locChanges = scheduler.drainLocChanges();
        const chatMessages = scheduler.drainChatMessages();
        const inventorySnapshots = scheduler.drainInventorySnapshots();
        const gamemodeSnapshots = scheduler.drainGamemodeSnapshots();
        const appearanceSnapshots = scheduler.drainAppearanceSnapshots();
        const skillSnapshots = scheduler.drainSkillSnapshots();
        const combatSnapshots = scheduler.drainCombatSnapshots();
        const runEnergySnapshots = scheduler.drainRunEnergySnapshots();
        const animSnapshots = scheduler.drainAnimSnapshots();
        const spellResults = scheduler.drainSpellResults();
        const hitsplats = scheduler.drainHitsplats();
        const forcedChats = scheduler.drainForcedChats();
        const forcedMovements = scheduler.drainForcedMovements();
        const spotAnimations = scheduler.drainSpotAnimations();
        const varps = scheduler.drainVarps();
        const varbits = scheduler.drainVarbits();
        const clientScripts = scheduler.drainClientScripts();

        return {
            tick: data.tick,
            time: data.time,
            npcUpdates,
            npcEffectEvents: [],
            playerSteps: new Map(),
            hitsplats,
            forcedChats,
            forcedMovements,
            pendingSequences: new Map(),
            actionEffects: [],
            interactionIndices: new Map(),
            pendingFaceDirs: new Map(),
            playerViews: new Map(),
            npcViews: new Map(),
            widgetEvents,
            notifications,
            keyedMessages,
            locChanges,
            chatMessages,
            inventorySnapshots,
            gamemodeSnapshots,
            appearanceSnapshots,
            skillSnapshots,
            combatSnapshots,
            runEnergySnapshots,
            animSnapshots,
            npcPackets,
            projectilePackets,
            spotAnimations,
            spellResults,
            varps,
            varbits,
            clientScripts,
            colorOverrides: new Map(),
            npcColorOverrides: new Map(),
        };
    }

    restorePendingFrame(frame: TickFrame): void {
        if (frame.npcUpdates.length > 0) {
            const pendingNpcUpdates = this.svc.pendingNpcUpdates;
            for (const update of frame.npcUpdates) {
                upsertNpcUpdateDelta(pendingNpcUpdates, update);
            }
        }
        if (frame.npcPackets.size > 0) {
            const pendingNpcPackets = this.svc.pendingNpcPackets;
            for (const [playerId, packet] of frame.npcPackets.entries()) {
                const existing = pendingNpcPackets.get(playerId);
                if (existing) {
                    existing.snapshots.push(...packet.snapshots);
                    existing.updates.push(...packet.updates);
                    existing.despawns.push(...packet.despawns);
                } else {
                    pendingNpcPackets.set(playerId, packet);
                }
            }
        }
        const projectilePackets = frame.projectilePackets ?? new Map();
        if (projectilePackets.size > 0) {
            this.svc.projectileSystem?.restorePackets(projectilePackets);
        }

        const scheduler = this.svc.broadcastScheduler;
        if (frame.widgetEvents.length > 0) {
            scheduler.restoreWidgetEvents(frame.widgetEvents);
        }
        if (frame.notifications.length > 0) {
            scheduler.restoreNotifications(frame.notifications);
        }
        if (frame.keyedMessages.size > 0) {
            scheduler.restoreAllKeyedMessages(frame.keyedMessages);
        }
        if (frame.locChanges.length > 0) {
            scheduler.restoreLocChanges(frame.locChanges);
        }
        if (frame.chatMessages.length > 0) {
            scheduler.restoreChatMessages(frame.chatMessages);
        }
        if (frame.inventorySnapshots.length > 0) {
            scheduler.restoreInventorySnapshots(frame.inventorySnapshots);
        }
        if (frame.gamemodeSnapshots.size > 0) {
            scheduler.restoreGamemodeSnapshots(frame.gamemodeSnapshots);
        }
        if (frame.varps && frame.varps.length > 0) {
            scheduler.restoreVarps(frame.varps);
        }
        if (frame.varbits && frame.varbits.length > 0) {
            scheduler.restoreVarbits(frame.varbits);
        }
        if (frame.appearanceSnapshots.length > 0) {
            scheduler.restoreAppearanceSnapshots(frame.appearanceSnapshots);
        }
        if (frame.skillSnapshots.length > 0) {
            scheduler.restoreSkillSnapshots(frame.skillSnapshots);
        }
        if (frame.combatSnapshots.length > 0) {
            scheduler.restoreCombatSnapshots(frame.combatSnapshots);
        }
        if (frame.runEnergySnapshots.length > 0) {
            scheduler.restoreRunEnergySnapshots(frame.runEnergySnapshots);
        }
        if (frame.animSnapshots.length > 0) {
            scheduler.restoreAnimSnapshots(frame.animSnapshots);
        }
        if (frame.spellResults.length > 0) {
            scheduler.restoreSpellResults(frame.spellResults);
        }
        if (frame.hitsplats.length > 0) {
            scheduler.restoreHitsplats(frame.hitsplats);
        }
        if (frame.forcedChats.length > 0) {
            scheduler.restoreForcedChats(frame.forcedChats);
        }
        if (frame.forcedMovements.length > 0) {
            scheduler.restoreForcedMovements(frame.forcedMovements);
        }
        if (frame.spotAnimations.length > 0) {
            scheduler.restoreSpotAnimations(frame.spotAnimations);
        }
    }

    maybeRunAutosave(frame: TickFrame): void {
        if (this.autosaveIntervalTicks <= 0) return;
        if (this.autosaveRunning) return;
        if (frame.tick < this.nextAutosaveTick) return;
        this.nextAutosaveTick = frame.tick + this.autosaveIntervalTicks;
        this.autosaveRunning = true;
        setImmediate(() => {
            this.runAutosave(frame.tick)
                .catch((err) => {
                    logger.warn(`[autosave] tick=${frame.tick} failed`, err);
                })
                .finally(() => {
                    this.autosaveRunning = false;
                });
        });
    }

    async runAutosave(triggerTick: number): Promise<void> {
        const players = this.svc.players;
        if (!players) return;
        const entries: Array<{ key: string; player: PlayerState }> = [];
        players.forEach((_ws, player) => {
            const key = player.__saveKey ?? buildPlayerSaveKey(player.name, player.id);
            if (key && key.length > 0) {
                entries.push({ key, player });
            }
        });
        if (entries.length === 0) return;
        const started = performance.now();
        try {
            this.svc.playerPersistence.savePlayers(entries);
        } catch (err) {
            logger.warn(`[autosave] bulk save failed tick=${triggerTick}`, err);
        }
        const elapsed = performance.now() - started;
        logger.info(
            `[autosave] tick=${triggerTick} saved ${entries.length} player(s) in ${elapsed.toFixed(
                1,
            )}ms`,
        );
    }

    async runTickStage(
        name: string,
        fn: () => void | Promise<void>,
        frame: TickFrame,
    ): Promise<boolean> {
        try {
            await fn();
            return true;
        } catch (err) {
            this.restorePendingFrame(frame);
            logger.error(`[tick] stage ${name} failed (tick=${frame.tick})`, err);
            return false;
        }
    }

    async yieldToEventLoop(stage: string): Promise<void> {
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        this.svc.networkLayer.flushDirectSendWarnings(stage);
    }
}

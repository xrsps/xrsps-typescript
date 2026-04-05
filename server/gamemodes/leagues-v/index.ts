import { LEAGUE_TASK_COMPLETION_VARPS } from "./data/leagueTaskVarps";
import {
    MAP_FLAGS_LEAGUE_WORLD,
    VARBIT_FLASHSIDE,
    VARBIT_LEAGUE_AREA_LAST_VIEWED,
    VARBIT_LEAGUE_AREA_SELECTION_0,
    VARBIT_LEAGUE_AREA_SELECTION_1,
    VARBIT_LEAGUE_AREA_SELECTION_2,
    VARBIT_LEAGUE_AREA_SELECTION_3,
    VARBIT_LEAGUE_AREA_SELECTION_4,
    VARBIT_LEAGUE_AREA_SELECTION_5,
    VARBIT_LEAGUE_TUTORIAL_COMPLETED,
    VARBIT_LEAGUE_TYPE,
    VARP_LEAGUE_GENERAL,
    VARP_LEAGUE_POINTS_CLAIMED,
    VARP_LEAGUE_POINTS_COMPLETED,
    VARP_LEAGUE_POINTS_CURRENCY,
    VARP_MAP_FLAGS_CACHED,
    VARP_SIDE_JOURNAL_STATE,
} from "../../../src/shared/vars";
import type { PlayerState } from "../../src/game/player";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import { registerLeagueTutorHandlers } from "./scripts/leagueTutor";
import { registerLeagueWidgetHandlers } from "./scripts/leagueWidgets";
import { registerLeagueTutorialWidgetHandlers } from "./scripts/leagueTutorialWidgets";
import { getLeagueVDropRateMultiplier, getLeagueVReplacementItemId, isLeagueVWorldPlayer } from "./leagueDrops";
import { LeagueTaskManager } from "./LeagueTaskManager";
import { LeagueTaskService, setTaskProgress } from "./LeagueTaskService";
import { syncLeagueGeneralVarp } from "./leagueGeneral";
import { getLeaguePackedVarpsForPlayer } from "./leaguePackedVarps";
import { getLeagueSkillXpMultiplier } from "./leagueXp";
import { getActiveLeagueType, isLeagueVWorld, isLeagueWorld } from "./playerWorldRules";
import { LEAGUE_SUMMARY_GROUP_ID } from "../../../src/shared/ui/leagueSummary";
import { LeagueSummaryTracker } from "./leagueSummary";
import type {
    GamemodeBridge,
    GamemodeInitContext,
    GamemodeUiBridge,
    GamemodeUiController,
    HandshakeBridge,
} from "../../src/game/gamemodes/GamemodeDefinition";
import { VanillaGamemode } from "../vanilla/index";
import { LeagueContentProvider } from "./LeagueContentProvider";
import { LeaguesVUiController } from "./LeaguesVUiController";

const TUTORIAL_SPAWN = { x: 3094, y: 3107, level: 0 };
const VARP_LEAGUE_TASK_COUNT = 2612;

function getTutorialCompleteStep(player: PlayerState): number {
    const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
    return leagueType === 3 ? 14 : 12;
}

export class LeaguesVGamemode extends VanillaGamemode {
    override readonly id = "leagues-v";
    override readonly name = "Raging Echoes";

    private taskManager: LeagueTaskManager | undefined;
    private initBridge: GamemodeBridge | undefined;
    private leagueSummary: LeagueSummaryTracker | undefined;
    private uiBridge: GamemodeUiBridge | undefined;
    private contentProvider: LeagueContentProvider = new LeagueContentProvider();

    // === XP ===

    override getSkillXpMultiplier(player: PlayerState): number {
        if (!isLeagueWorld(player)) return 1;
        const leagueType = getActiveLeagueType(player);
        const pointsClaimed = player.getVarpValue(VARP_LEAGUE_POINTS_CLAIMED);
        return getLeagueSkillXpMultiplier(leagueType, pointsClaimed ?? 0);
    }

    // === Drops ===

    override getDropRateMultiplier(player: PlayerState | undefined): number {
        return getLeagueVDropRateMultiplier(player);
    }

    override isDropBoostEligible(entry: { dropBoostEligible?: boolean }): boolean {
        return entry.dropBoostEligible === true;
    }

    override transformDropItemId(npcTypeId: number, itemId: number, player: PlayerState | undefined): number {
        return getLeagueVReplacementItemId(npcTypeId, itemId, isLeagueVWorldPlayer(player));
    }

    // === Player Rules ===

    override hasInfiniteRunEnergy(player: PlayerState): boolean {
        return isLeagueVWorld(player);
    }

    override canInteract(player: PlayerState): boolean {
        const tutorialStep = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        return tutorialStep >= getTutorialCompleteStep(player);
    }

    canInteractWithNpc(player: PlayerState, npcTypeId: number, option: string): boolean {
        if (this.canInteract(player)) return true;
        const LEAGUE_TUTOR_NPC_TYPE_ID = 315;
        return npcTypeId === LEAGUE_TUTOR_NPC_TYPE_ID &&
            (option === "" || option === "talk-to");
    }

    // === Player Lifecycle ===

    override initializePlayer(player: PlayerState): void {
        if (player.getVarbitValue(VARBIT_LEAGUE_TYPE) === 0) {
            player.setVarbitValue(VARBIT_LEAGUE_TYPE, 5);
        }
        if (player.getVarpValue(VARP_LEAGUE_GENERAL) === 0) {
            syncLeagueGeneralVarp(player);
        }
        const a0 = player.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_0);
        const a1 = player.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_1);
        const a2 = player.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_2);
        const a3 = player.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_3);
        const a4 = player.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_4);
        const a5 = player.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_5);
        if ((a0 | a1 | a2 | a3 | a4 | a5) === 0) {
            player.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_0, 1);
            player.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_1, 0);
            player.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_2, 0);
            player.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_3, 0);
            player.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_4, 0);
            player.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_5, 0);
        }
        if (player.getVarbitValue(VARBIT_LEAGUE_AREA_LAST_VIEWED) === 0) {
            player.setVarbitValue(VARBIT_LEAGUE_AREA_LAST_VIEWED, 1);
        }
    }

    override serializePlayerState(player: PlayerState): Record<string, unknown> | undefined {
        const map = player.gamemodeState.get("taskProgress") as Map<number, number> | undefined;
        if (!map || map.size === 0) return undefined;
        const progress: Record<number, number> = {};
        for (const [taskId, value] of map.entries()) {
            if (value > 0) progress[taskId] = value;
        }
        return Object.keys(progress).length > 0 ? { progress } : undefined;
    }

    override deserializePlayerState(player: PlayerState, data: Record<string, unknown>): void {
        const raw = (data.progress ?? data.leagueTaskProgress) as Record<string, number> | undefined;
        if (!raw) return;
        for (const [key, value] of Object.entries(raw)) {
            const taskId = parseInt(key, 10);
            if (!Number.isNaN(taskId)) {
                setTaskProgress(player, taskId, value);
            }
        }
    }

    override onNpcKill(playerId: number, npcTypeId: number): void {
        this.taskManager?.onNpcKill(playerId, npcTypeId);
    }

    // === Login / Handshake ===

    override isTutorialActive(player: PlayerState): boolean {
        const tutorialStep = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        return tutorialStep < getTutorialCompleteStep(player);
    }

    isTutorialPreStart(player: PlayerState): boolean {
        const tutorialStep = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        return tutorialStep === 0;
    }

    override getSpawnLocation(_player: PlayerState): { x: number; y: number; level: number } {
        return TUTORIAL_SPAWN;
    }

    override onPlayerHandshake(player: PlayerState, bridge: HandshakeBridge): void {
        // Set map_flags_cached to indicate league world (bit 30 set)
        player.setVarpValue(VARP_MAP_FLAGS_CACHED, MAP_FLAGS_LEAGUE_WORLD);
        bridge.sendVarp(VARP_MAP_FLAGS_CACHED, MAP_FLAGS_LEAGUE_WORLD);

        // Set league type and packed league general state
        const leagueType = 5;
        player.setVarbitValue(VARBIT_LEAGUE_TYPE, leagueType);
        const { value: leagueGeneral } = syncLeagueGeneralVarp(player);
        bridge.sendVarp(VARP_LEAGUE_GENERAL, leagueGeneral);
        bridge.sendVarbit(VARBIT_LEAGUE_TYPE, leagueType);

        // Flash quest tab during tutorial step 3
        const tutorial = player.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);
        if (tutorial === 3 && player.getVarbitValue(VARBIT_FLASHSIDE) === 0) {
            player.setVarbitValue(VARBIT_FLASHSIDE, 3);
            bridge.sendVarbit(VARBIT_FLASHSIDE, 3);
        }

        // Send league points varps from saved state
        bridge.sendVarp(VARP_LEAGUE_POINTS_CLAIMED, player.getVarpValue(VARP_LEAGUE_POINTS_CLAIMED));
        bridge.sendVarp(VARP_LEAGUE_POINTS_COMPLETED, player.getVarpValue(VARP_LEAGUE_POINTS_COMPLETED));
        bridge.sendVarp(VARP_LEAGUE_POINTS_CURRENCY, player.getVarpValue(VARP_LEAGUE_POINTS_CURRENCY));

        // Send packed league varps (relic/mastery varbits)
        for (const [rawVarpId, rawValue] of Object.entries(getLeaguePackedVarpsForPlayer(player))) {
            const varpId = parseInt(rawVarpId, 10);
            bridge.sendVarp(varpId, rawValue);
        }

        // Send varp backing league_total_tasks_completed varbit
        const taskCountVarpValue = player.getVarpValue(VARP_LEAGUE_TASK_COUNT);
        if (taskCountVarpValue !== 0) {
            bridge.sendVarp(VARP_LEAGUE_TASK_COUNT, taskCountVarpValue);
        }

        // Send league task completion bitfield varps
        for (const varpId of LEAGUE_TASK_COMPLETION_VARPS) {
            const value = player.getVarpValue(varpId);
            if (value !== 0) {
                bridge.sendVarp(varpId, value);
            }
        }
    }

    onPostDesignComplete(player: PlayerState): void {
        if (this.isTutorialActive(player)) {
            player.teleport(TUTORIAL_SPAWN.x, TUTORIAL_SPAWN.y, TUTORIAL_SPAWN.level);
        }
    }

    resolveAccountStage(player: PlayerState): void {
        const tutorial = player.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);
        const completeStep = getTutorialCompleteStep(player);
        if (tutorial >= completeStep && player.accountStage < 2) {
            player.accountStage = 2;
        }
    }

    // === Varp / Widget Events ===

    onVarpTransmit(player: PlayerState, varpId: number, value: number, previousValue: number): void {
        if (varpId !== VARP_SIDE_JOURNAL_STATE) return;

        const { decodeSideJournalTabFromStateVarp } = require("../../../src/shared/ui/sideJournal");
        const previousTab = decodeSideJournalTabFromStateVarp(previousValue);
        const currentTab = decodeSideJournalTabFromStateVarp(value);
        const tabChanged = previousTab !== currentTab;

        if (!tabChanged) return;

        // Complete "Open the Leagues Menu" task when player opens Leagues tab
        if (currentTab === 4) {
            try {
                const result = LeagueTaskService.completeTask(player, 189);
                if (result.changed && this.initBridge) {
                    for (const v of result.varpUpdates) {
                        this.initBridge.queueVarp(player.id, v.id, v.value);
                    }
                    for (const v of result.varbitUpdates) {
                        this.initBridge.queueVarbit(player.id, v.id, v.value);
                    }
                    if (result.notification) {
                        this.initBridge.queueNotification(player.id, result.notification);
                    }
                }
            } catch {}
        }

        // Tutorial progression: opening Leagues tab advances step 3/4 → 5
        const tutorial = player.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);
        if (currentTab === 4 && (tutorial === 3 || tutorial === 4)) {
            player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, 5);
            this.initBridge?.queueVarbit(player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, 5);
            syncLeagueGeneralVarp(player);
            if (player.getVarbitValue(VARBIT_FLASHSIDE) !== 0) {
                player.setVarbitValue(VARBIT_FLASHSIDE, 0);
                this.initBridge?.queueVarbit(player.id, VARBIT_FLASHSIDE, 0);
            }
        }
    }

    // === Tick / Widget ===

    onPlayerTick(player: PlayerState, nowMs: number): void {
        this.leagueSummary?.syncPlayer(player, nowMs);
    }

    onPlayerDisconnect(playerId: number): void {
        this.leagueSummary?.clearPlayer(playerId);
    }

    onWidgetOpen(player: PlayerState, groupId: number): void {
        if (groupId === LEAGUE_SUMMARY_GROUP_ID) {
            this.leagueSummary?.syncPlayer(player, Date.now(), true);
        }
    }

    // === Display ===

    override getDisplayName(player: PlayerState, baseName: string, isAdmin: boolean): string {
        if (!baseName) return "";
        if (!isAdmin || !isLeagueWorld(player)) return baseName;
        const ADMIN_CROWN_ICON = 1;
        const prefix = `<img=${ADMIN_CROWN_ICON}>`;
        return baseName.startsWith(prefix) ? baseName : `${prefix}${baseName}`;
    }

    override getChatPlayerType(player: PlayerState, isAdmin: boolean): number {
        if (isLeagueWorld(player)) return 6;
        return isAdmin ? 2 : 0;
    }

    // === Scripts ===

    override getGamemodeServices(): Record<string, unknown> {
        return {
            ...super.getGamemodeServices(),
            completeLeagueTask: (player: PlayerState, taskId: number) =>
                LeagueTaskService.completeTask(player, taskId),
            syncLeagueGeneralVarp: (player: PlayerState) =>
                syncLeagueGeneralVarp(player),
            getLeaguePackedVarpsForPlayer: (player: PlayerState) =>
                getLeaguePackedVarpsForPlayer(player),
            getTaskCompletionVarps: () => LEAGUE_TASK_COMPLETION_VARPS,
        };
    }

    createUiController(bridge: GamemodeUiBridge): GamemodeUiController {
        this.uiBridge = bridge;
        this.leagueSummary = new LeagueSummaryTracker({
            queueWidgetEvent: (playerId, action) => bridge.queueWidgetEvent(playerId, action),
            isWidgetGroupOpenInLedger: (playerId, groupId) =>
                bridge.isWidgetGroupOpenInLedger(playerId, groupId),
        });
        return new LeaguesVUiController(bridge);
    }

    override registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
        super.registerHandlers(registry, services);
        registerLeagueTutorHandlers(registry, services);
        registerLeagueWidgetHandlers(registry, services);
        registerLeagueTutorialWidgetHandlers(registry, services);
    }

    // === Content Data ===

    getContentDataPacket(): Uint8Array | null {
        return this.contentProvider.getPacket();
    }

    // === Server Lifecycle ===

    override initialize(context: GamemodeInitContext): void {
        super.initialize(context);
        this.initBridge = context.bridge;
        this.contentProvider.build();
        try {
            this.taskManager = LeagueTaskManager.create(
                context.npcTypeLoader,
                context.objTypeLoader,
                {
                    getPlayer: (playerId) => context.bridge.getPlayer(playerId),
                    queueVarp: (playerId, varpId, value) =>
                        context.bridge.queueVarp(playerId, varpId, value),
                    queueVarbit: (playerId, varbitId, value) =>
                        context.bridge.queueVarbit(playerId, varbitId, value),
                    queueNotification: (playerId, notification) =>
                        context.bridge.queueNotification(playerId, notification),
                },
            );
        } catch (err) {
            console.log("[leagues-v] failed to initialize task manager", err);
        }
    }

    dispose(): void {
        this.taskManager = undefined;
        this.initBridge = undefined;
    }
}

export function createGamemode(): LeaguesVGamemode {
    return new LeaguesVGamemode();
}

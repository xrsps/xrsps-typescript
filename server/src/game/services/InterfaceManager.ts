import { MAX_REAL_LEVEL, getSkillName } from "../../../../src/rs/skill/skills";
import type { BroadcastScheduler } from "../systems/BroadcastScheduler";
import type { ActionScheduler } from "../actions";
import type { GamemodeDefinition } from "../gamemodes/GamemodeDefinition";
import type { PlayerState } from "../player";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";
import { logger } from "../../utils/logger";

export interface PlayerWidgetOpenLedger {
    byTargetUid: Map<number, number>;
    targetUidsByGroup: Map<number, Set<number>>;
    directGroups: Set<number>;
}

export interface LevelUpPopup {
    kind: "skill" | "combat" | "hunter";
    skillId?: any;
    newLevel: number;
    levelIncrement: number;
}

export interface WidgetAction {
    action: string;
    groupId?: number;
    targetUid?: number;
    [key: string]: any;
}

export interface InterfaceManagerDeps {
    getActiveFrame: () => TickFrame | undefined;
    getIsBroadcastPhase: () => boolean;
    broadcastScheduler: BroadcastScheduler;
    actionScheduler: ActionScheduler;
    queueChatMessage: (msg: any) => void;
    showLevelUpPopup: (player: PlayerState, popup: LevelUpPopup) => boolean;
    closeChatboxModalOverlay: (playerId: number) => void;
    getPlayerById: (id: number) => PlayerState | undefined;
}

/**
 * Manages widget open/close ledger tracking, level-up popup queue,
 * widget event queuing, and client script queuing.
 * Extracted from WSServer.
 */
export class InterfaceManager {
    private readonly widgetOpenLedgerByPlayer = new Map<number, PlayerWidgetOpenLedger>();
    private readonly levelUpPopupQueue = new Map<number, LevelUpPopup[]>();

    constructor(private readonly deps: InterfaceManagerDeps) {}

    // --- Widget Ledger ---

    getOrCreateWidgetLedger(playerId: number): PlayerWidgetOpenLedger {
        let ledger = this.widgetOpenLedgerByPlayer.get(playerId);
        if (!ledger) {
            ledger = {
                byTargetUid: new Map<number, number>(),
                targetUidsByGroup: new Map<number, Set<number>>(),
                directGroups: new Set<number>(),
            };
            this.widgetOpenLedgerByPlayer.set(playerId, ledger);
        }
        return ledger;
    }

    addOpenTargetToLedger(ledger: PlayerWidgetOpenLedger, targetUid: number, groupId: number): void {
        const prevGroupId = ledger.byTargetUid.get(targetUid);
        if (prevGroupId !== undefined) {
            const prevSet = ledger.targetUidsByGroup.get(prevGroupId);
            prevSet?.delete(targetUid);
            if (prevSet && prevSet.size === 0) {
                ledger.targetUidsByGroup.delete(prevGroupId);
            }
        }
        ledger.byTargetUid.set(targetUid, groupId);
        let groupTargets = ledger.targetUidsByGroup.get(groupId);
        if (!groupTargets) {
            groupTargets = new Set<number>();
            ledger.targetUidsByGroup.set(groupId, groupTargets);
        }
        groupTargets.add(targetUid);
    }

    removeOpenTargetFromLedger(ledger: PlayerWidgetOpenLedger, targetUid: number): void {
        const prevGroupId = ledger.byTargetUid.get(targetUid);
        if (prevGroupId === undefined) return;
        ledger.byTargetUid.delete(targetUid);
        const prevSet = ledger.targetUidsByGroup.get(prevGroupId);
        prevSet?.delete(targetUid);
        if (prevSet && prevSet.size === 0) {
            ledger.targetUidsByGroup.delete(prevGroupId);
        }
    }

    removeOpenGroupFromLedger(ledger: PlayerWidgetOpenLedger, groupId: number): void {
        ledger.directGroups.delete(groupId);
        const targets = ledger.targetUidsByGroup.get(groupId);
        if (targets) {
            for (const targetUid of targets) {
                ledger.byTargetUid.delete(targetUid);
            }
            ledger.targetUidsByGroup.delete(groupId);
        }
    }

    noteWidgetEventForLedger(playerId: number, action: WidgetAction): void {
        const ledger = this.getOrCreateWidgetLedger(playerId);
        switch (action.action) {
            case "open_sub":
                this.addOpenTargetToLedger(ledger, action.targetUid as number, action.groupId as number);
                break;
            case "close_sub":
                this.removeOpenTargetFromLedger(ledger, action.targetUid as number);
                break;
            case "open":
                ledger.directGroups.add(action.groupId!);
                break;
            case "close":
                this.removeOpenGroupFromLedger(ledger, action.groupId!);
                break;
            case "set_root":
                ledger.byTargetUid.clear();
                ledger.targetUidsByGroup.clear();
                ledger.directGroups.clear();
                break;
            default:
                break;
        }
    }

    isWidgetGroupOpenInLedger(playerId: number, groupId: number): boolean {
        const ledger = this.widgetOpenLedgerByPlayer.get(playerId);
        if (!ledger) return false;
        if (ledger.directGroups.has(groupId)) return true;
        const targetSet = ledger.targetUidsByGroup.get(groupId);
        return !!targetSet && targetSet.size > 0;
    }

    clearUiTrackingForPlayer(playerId: number): void {
        this.widgetOpenLedgerByPlayer.delete(playerId);
    }

    // --- Client Script Queuing ---

    queueClientScript(playerId: number, scriptId: number, ...args: (number | string)[]): void {
        logger.info?.(`[clientScript] queue player=${playerId} script=${scriptId} args=${JSON.stringify(args)}`);
        this.deps.broadcastScheduler.queueClientScript(playerId, scriptId, args);
    }

    // --- Level-Up Popup Queue ---

    hasModalOpen(playerId: number): boolean {
        const queue = this.levelUpPopupQueue.get(playerId);
        return queue !== undefined && queue.length > 0;
    }

    enqueueLevelUpPopup(player: PlayerState, popup: LevelUpPopup): void {
        const playerId = player.id;
        let queue = this.levelUpPopupQueue.get(playerId);
        if (!queue) {
            queue = [];
            this.levelUpPopupQueue.set(playerId, queue);
        }
        queue.push(popup);

        if (popup.kind === "skill") {
            const skillName = getSkillName(popup.skillId);
            const levelUpMessage =
                popup.newLevel === MAX_REAL_LEVEL
                    ? `Congratulations, you've reached the highest possible ${skillName} level of 99.`
                    : `Congratulations, you've just advanced your ${skillName} level. You are now level ${popup.newLevel}.`;
            this.deps.queueChatMessage({
                messageType: "game",
                playerId,
                text: levelUpMessage,
                targetPlayerIds: [playerId],
            });
        }

        if (queue.length === 1) {
            const shown = this.deps.showLevelUpPopup(player, popup);
            if (!shown) {
                queue.shift();
                if (queue.length < 1) {
                    this.levelUpPopupQueue.delete(playerId);
                }
            }
        }
    }

    advanceLevelUpPopupQueue(player: PlayerState): void {
        const playerId = player.id;
        const queue = this.levelUpPopupQueue.get(playerId);
        if (!queue || queue.length === 0) return;

        queue.shift();

        while (queue.length > 0) {
            if (this.deps.showLevelUpPopup(player, queue[0])) {
                return;
            }
            queue.shift();
        }

        this.levelUpPopupQueue.delete(playerId);
        this.deps.closeChatboxModalOverlay(playerId);
    }

    dismissLevelUpPopupQueue(playerId: number): boolean {
        const queue = this.levelUpPopupQueue.get(playerId);
        if (!queue || queue.length === 0) return false;
        this.levelUpPopupQueue.delete(playerId);
        this.deps.closeChatboxModalOverlay(playerId);
        return true;
    }

    interruptPlayerSkillActions(playerId: number): void {
        this.deps.actionScheduler.cancelInterruptibleActions(playerId);
    }
}

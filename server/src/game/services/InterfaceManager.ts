import type { PlayerState } from "../player";
import type { ServerServices } from "../ServerServices";
import { logger } from "../../utils/logger";

export interface PlayerWidgetOpenLedger {
    byTargetUid: Map<number, number>;
    targetUidsByGroup: Map<number, Set<number>>;
    directGroups: Set<number>;
}

export interface WidgetAction {
    action: string;
    groupId?: number;
    targetUid?: number;
    [key: string]: unknown;
}

/**
 * Manages widget open/close ledger tracking,
 * widget event queuing, and client script queuing.
 * Extracted from WSServer.
 */
export class InterfaceManager {
    private readonly widgetOpenLedgerByPlayer = new Map<number, PlayerWidgetOpenLedger>();

    constructor(private readonly svc: ServerServices) {}

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
        this.svc.accountSummary?.clearPlayer(playerId);
        this.svc.gamemode?.onPlayerDisconnect?.(playerId);
        this.svc.reportGameTime?.clearPlayer(playerId);
    }

    /**
     * Close all interfaces that should be interrupted by damage or movement.
     * Called when:
     * - Player takes combat damage (NPC or PvP hits)
     * - Player initiates movement (walk click)
     * - Player starts a new interaction (NPC click, attack, etc.)
     * - Player teleports
     *
     * NOTE: Passive damage (poison, venom, disease) does NOT close interfaces.
     * Those effects are processed in PlayerState.processPoison/processVenom/processDisease
     * and intentionally bypass this method to match OSRS behavior.
     */
    closeInterruptibleInterfaces(player: PlayerState): void {
        const playerId = player.id;

        const closedEntries = player.widgets.closeModalInterfaces();

        if (this.svc.interfaceService && closedEntries.length > 0) {
            this.svc.interfaceService.triggerCloseHooksForEntries(player, closedEntries);
        }

        this.svc.eventBus?.emit("interfaces:closeInterruptible", { player });

        this.svc.widgetDialogHandler?.closeAllPlayerDialogs(player);
        this.svc.cs2ModalManager?.clearPlayerState(player);
    }

    // --- Client Script Queuing ---

    queueClientScript(playerId: number, scriptId: number, ...args: (number | string)[]): void {
        logger.info?.(`[clientScript] queue player=${playerId} script=${scriptId} args=${JSON.stringify(args)}`);
        this.svc.broadcastScheduler.queueClientScript(playerId, scriptId, args);
    }

    interruptPlayerSkillActions(playerId: number): void {
        this.svc.actionScheduler.cancelInterruptibleActions(playerId);
    }
}

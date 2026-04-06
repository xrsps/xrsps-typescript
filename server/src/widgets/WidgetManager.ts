import { logger } from "../utils/logger";
import {
    ContainerChildIds,
    type DesktopInterfaceOptions,
    DisplayMode,
    InterfaceDestination,
    InterfaceMount,
    getChildId,
    getDesktopInterfaces,
    getInventoryTabUid,
    getMainmodalUid,
    getMobileInterfaces,
    getRemainingTabInterfaces,
    getRootInterfaceId,
} from "./viewport";

// Re-export viewport types and constants for backwards compatibility
export {
    ContainerChildIds,
    DisplayMode,
    InterfaceDestination,
    InterfaceMount,
    getChildId,
    getInventoryTabUid,
    getMainmodalUid,
    getRemainingTabInterfaces,
    getRootInterfaceId,
    type DesktopInterfaceOptions,
} from "./viewport";

export type WidgetScriptInvocation = { scriptId: number; args: (number | string)[] };

export type WidgetAction =
    | { action: "close" | "open"; groupId: number; modal?: boolean }
    | { action: "set_root"; groupId: number }
    | {
          action: "open_sub";
          targetUid: number;
          groupId: number;
          type: number;
          // Optional var snapshot applied client-side before opening (handy for CS2 init scripts).
          varps?: Record<number, number>;
          varbits?: Record<number, number>;
          // Optional widget UIDs to hide immediately after mount (same packet/frame).
          hiddenUids?: number[];
          // Scripts to run BEFORE the interface is fully mounted.
          preScripts?: WidgetScriptInvocation[];
          // Scripts to run AFTER the interface is fully loaded (widgets indexed).
          postScripts?: WidgetScriptInvocation[];
      }
    | { action: "close_sub"; targetUid: number }
    | { action: "set_text"; uid: number; text: string }
    | { action: "set_hidden"; uid: number; hidden: boolean }
    | { action: "set_item"; uid: number; itemId: number; quantity?: number }
    | { action: "set_npc_head"; uid: number; npcId: number }
    | { action: "set_flags"; uid: number; flags: number }
    | { action: "set_animation"; uid: number; animationId: number }
    | { action: "set_player_head"; uid: number }
    | {
          /**
           * OSRS parity: IF_SETEVENTS packet - set flags for a range of child indices.
           * Reference: player.setInterfaceEvents(interfaceId, component, from, to, setting)
           * Stores flags at keys (uid << 32) | childIndex for each childIndex in [fromSlot, toSlot].
           *
           * Key insight from OSRS client (class405.getWidgetFlags):
           * - Static widgets (loaded from cache) have childIndex=-1
           * - Dynamic children (CC_CREATE) have childIndex >= 0 (their slot index)
           *
           * Usage:
           * - For static widgets: fromSlot=-1, toSlot=-1
           * - For dynamic children: fromSlot=0, toSlot=N-1 (or whatever range)
           */
          action: "set_flags_range";
          uid: number;
          fromSlot: number;
          toSlot: number;
          flags: number;
      }
    | {
          /**
           * OSRS parity: RUNCLIENTSCRIPT packet - run a CS2 script with arguments.
           * Used for dynamic interface initialization (shops, collection log, etc.)
           * where the script needs runtime arguments from the server.
           */
          action: "run_script";
          scriptId: number;
          args: (number | string)[];
          varps?: Record<number, number>;
          varbits?: Record<number, number>;
      }
    | {
          action: "set_varbit";
          varbitId: number;
          value: number;
      };

/**
 * Get all default interfaces to open for a display mode
 * @param displayMode The display mode
 * @param options Optional settings (e.g., tutorialMode to only show Quest tab)
 */
export function getDefaultInterfaces(
    displayMode: DisplayMode,
    options?: DesktopInterfaceOptions,
): InterfaceMount[] {
    if (displayMode === DisplayMode.MOBILE) {
        return getMobileInterfaces();
    }
    return getDesktopInterfaces(displayMode, options);
}

export type WidgetScope = "modal" | "side_panel" | "sidemodal" | "chatbox_modal";

export type WidgetEntry = {
    key: string;
    groupId: number;
    modal: boolean;
    /** For sub-interfaces: the widget UID where it's mounted */
    targetUid?: number;
    /** For sub-interfaces: 0 = modal, 1 = overlay */
    type?: number;
    /** Optional var snapshot applied client-side before opening */
    varps?: Record<number, number>;
    /** Optional var snapshot applied client-side before opening */
    varbits?: Record<number, number>;
    /** Optional widget UIDs to hide immediately after mount (same packet/frame). */
    hiddenUids?: number[];
    /** Scripts to run BEFORE the interface is fully mounted. */
    preScripts?: WidgetScriptInvocation[];
    /** Scripts to run AFTER the interface is fully loaded (widgets indexed) */
    postScripts?: WidgetScriptInvocation[];
    /** Canonical interface slot owned by InterfaceService. */
    scope?: WidgetScope;
    /** Optional lifecycle data for InterfaceService hooks. */
    data?: unknown;
};

export class PlayerWidgetManager {
    private entries = new Map<string, WidgetEntry>();
    private groupIndex = new Map<number, Set<string>>();
    private targetIndex = new Map<number, Set<string>>();
    private scopeIndex = new Map<WidgetScope, string>();
    private dispatcher?: (action: WidgetAction) => void;

    private makeKey(entry: Omit<WidgetEntry, "key">): string {
        if (entry.scope) {
            return `scope:${entry.scope}`;
        }
        if (entry.targetUid !== undefined) {
            return `target:${Math.trunc(entry.targetUid)}:group:${Math.trunc(entry.groupId)}`;
        }
        return `group:${Math.trunc(entry.groupId)}`;
    }

    private indexEntry(entry: WidgetEntry): void {
        let groupKeys = this.groupIndex.get(entry.groupId);
        if (!groupKeys) {
            groupKeys = new Set<string>();
            this.groupIndex.set(entry.groupId, groupKeys);
        }
        groupKeys.add(entry.key);

        if (entry.targetUid !== undefined) {
            const targetUid = Math.trunc(entry.targetUid);
            let targetKeys = this.targetIndex.get(targetUid);
            if (!targetKeys) {
                targetKeys = new Set<string>();
                this.targetIndex.set(targetUid, targetKeys);
            }
            targetKeys.add(entry.key);
        }

        if (entry.scope) {
            this.scopeIndex.set(entry.scope, entry.key);
        }
    }

    private deleteEntry(key: string): WidgetEntry | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        this.entries.delete(key);

        const groupKeys = this.groupIndex.get(entry.groupId);
        if (groupKeys) {
            groupKeys.delete(key);
            if (groupKeys.size === 0) {
                this.groupIndex.delete(entry.groupId);
            }
        }

        if (entry.targetUid !== undefined) {
            const targetUid = Math.trunc(entry.targetUid);
            const targetKeys = this.targetIndex.get(targetUid);
            if (targetKeys) {
                targetKeys.delete(key);
                if (targetKeys.size === 0) {
                    this.targetIndex.delete(targetUid);
                }
            }
        }

        if (entry.scope && this.scopeIndex.get(entry.scope) === key) {
            this.scopeIndex.delete(entry.scope);
        }

        return entry;
    }

    private dispatchOpen(entry: WidgetEntry): void {
        if (!this.dispatcher) return;
        try {
            if (entry.targetUid !== undefined) {
                const targetUid = Math.trunc(entry.targetUid);
                const groupId = Math.trunc(entry.groupId);
                const type =
                    entry.type !== undefined ? Math.trunc(entry.type) : entry.modal ? 0 : 1;
                this.dispatcher({
                    action: "open_sub",
                    targetUid,
                    groupId,
                    type,
                    varps: entry.varps,
                    varbits: entry.varbits,
                    hiddenUids: entry.hiddenUids,
                    preScripts: entry.preScripts,
                    postScripts: entry.postScripts,
                });
                return;
            }
            this.dispatcher({
                action: "open",
                groupId: Math.trunc(entry.groupId),
                modal: entry.modal,
            });
        } catch (err) { logger.warn("[widget] failed to dispatch widget open", err); }
    }

    private dispatchClose(entry: WidgetEntry): void {
        if (!this.dispatcher) return;
        try {
            if (entry.targetUid !== undefined) {
                this.dispatcher({ action: "close_sub", targetUid: Math.trunc(entry.targetUid) });
                return;
            }
            this.dispatcher({ action: "close", groupId: Math.trunc(entry.groupId) });
        } catch (err) { logger.warn("[widget] failed to dispatch widget close", err); }
    }

    private closeKeys(keys: Iterable<string>, opts: { silent?: boolean } = {}): WidgetEntry[] {
        const closed: WidgetEntry[] = [];
        for (const key of Array.from(keys)) {
            const entry = this.deleteEntry(key);
            if (!entry) continue;
            closed.push(entry);
            logger.debug("[server-widget-manager] close", {
                groupId: entry.groupId,
                targetUid: entry.targetUid,
                scope: entry.scope,
            });
            if (!opts.silent) {
                this.dispatchClose(entry);
            }
        }
        return closed;
    }

    setDispatcher(fn: ((action: WidgetAction) => void) | undefined): void {
        this.dispatcher = fn;
        if (fn) {
            for (const entry of this.entries.values()) {
                this.dispatchOpen(entry);
            }
        }
    }

    open(
        groupId: number,
        opts: {
            modal?: boolean;
            targetUid?: number;
            type?: number;
            varps?: Record<number, number>;
            varbits?: Record<number, number>;
            hiddenUids?: number[];
            preScripts?: WidgetScriptInvocation[];
            postScripts?: WidgetScriptInvocation[];
            scope?: WidgetScope;
            data?: unknown;
        } = {},
    ): void {
        const normalizedGroupId = Math.trunc(groupId);
        const type = opts.type !== undefined ? Math.trunc(opts.type) : undefined;
        const recordWithoutKey: Omit<WidgetEntry, "key"> = {
            groupId: normalizedGroupId,
            modal: opts.modal ?? type === 0,
            targetUid: opts.targetUid,
            type,
            varps: opts.varps,
            varbits: opts.varbits,
            hiddenUids: opts.hiddenUids,
            preScripts: opts.preScripts,
            postScripts: opts.postScripts,
            scope: opts.scope,
            data: opts.data,
        };
        const key = this.makeKey(recordWithoutKey);
        const replacementKeys = new Set<string>();

        if (opts.scope) {
            const existingScopeKey = this.scopeIndex.get(opts.scope);
            if (existingScopeKey) {
                replacementKeys.add(existingScopeKey);
            }
        }

        if (opts.targetUid !== undefined) {
            const targetKeys = this.targetIndex.get(Math.trunc(opts.targetUid));
            if (targetKeys) {
                for (const targetKey of targetKeys) {
                    replacementKeys.add(targetKey);
                }
            }
        }

        if (opts.scope === undefined && opts.targetUid === undefined) {
            const existingGroupKeys = this.groupIndex.get(normalizedGroupId);
            if (existingGroupKeys) {
                for (const existingGroupKey of existingGroupKeys) {
                    replacementKeys.add(existingGroupKey);
                }
            }
        }

        if (this.entries.has(key)) {
            replacementKeys.delete(key);
            this.deleteEntry(key);
        }

        if (replacementKeys.size > 0) {
            this.closeKeys(replacementKeys);
        }

        const record: WidgetEntry = {
            key,
            ...recordWithoutKey,
        };
        this.entries.set(record.key, record);
        this.indexEntry(record);
        this.dispatchOpen(record);
    }

    close(groupId: number, opts: { silent?: boolean } = {}): WidgetEntry[] {
        const normalizedGroupId = Math.trunc(groupId);
        const keys = this.groupIndex.get(normalizedGroupId);
        if (!keys || keys.size === 0) return [];
        return this.closeKeys(keys, opts);
    }

    hasModalOpen(): boolean {
        for (const entry of this.entries.values()) {
            if (entry.modal) return true;
        }
        return false;
    }

    isOpen(groupId: number): boolean {
        const keys = this.groupIndex.get(Math.trunc(groupId));
        return !!keys && keys.size > 0;
    }

    getByScope(scope: WidgetScope): WidgetEntry | undefined {
        const key = this.scopeIndex.get(scope);
        if (!key) return undefined;
        return this.entries.get(key);
    }

    closeByScope(scope: WidgetScope, opts: { silent?: boolean } = {}): WidgetEntry[] {
        const key = this.scopeIndex.get(scope);
        if (!key) return [];
        return this.closeKeys([key], opts);
    }

    closeByTargetUid(
        targetUid: number,
        opts: { silent?: boolean; groupId?: number } = {},
    ): WidgetEntry[] {
        const normalizedTargetUid = Math.trunc(targetUid);
        const targetKeys = this.targetIndex.get(normalizedTargetUid);
        if (!targetKeys || targetKeys.size === 0) return [];
        const keysToClose = Array.from(targetKeys).filter((key) => {
            if (opts.groupId === undefined) return true;
            const entry = this.entries.get(key);
            return !!entry && entry.groupId === Math.trunc(opts.groupId);
        });
        if (keysToClose.length === 0) return [];
        return this.closeKeys(keysToClose, opts);
    }

    closeModalInterfaces(opts: { silent?: boolean } = {}): WidgetEntry[] {
        const keys = Array.from(this.entries.values())
            .filter((entry) => entry.modal)
            .map((entry) => entry.key);
        if (keys.length === 0) return [];
        return this.closeKeys(keys, opts);
    }

    forceClose(groupId: number): WidgetEntry[] {
        return this.close(groupId);
    }

    closeAll(opts: { silent?: boolean } = {}): WidgetEntry[] {
        if (this.entries.size === 0) return [];
        return this.closeKeys(Array.from(this.entries.keys()), opts);
    }
}

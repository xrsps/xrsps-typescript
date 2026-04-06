/**
 * TransmitCycles - widget event transmit system.
 *
 * The engine gates transmit handlers (onChatTransmit, onStatTransmit, etc.)
 * by comparing global "event cycles" to per-widget timestamps.
 *
 * Tracked cycles: cycleCntr, chatCycle, friendCycle, clanCycle, clanSettingsCycle,
 * clanChannelCycle, stockCycle, miscTransmitCycle, changedSkillsCount, and
 * per-widget lastTransmitCycle.
 *
 * Flow:
 * 1. Event occurs (chat message, skill update, etc.)
 * 2. Appropriate cycle is set to cycleCntr (e.g., chatCycle = cycleCntr)
 * 3. During widget tree update, engine checks: if (chatCycle > widget.lastTransmitCycle)
 * 4. If true, queue the onChatTransmit script event
 * 5. After all checks, set widget.lastTransmitCycle = cycleCntr
 */

export interface TransmitCycles {
    /**
     * Main game cycle counter. Increments every ~20ms (50 cycles/second).
     * OSRS: Client.cycleCntr
     */
    cycleCntr: number;

    /**
     * Chat transmit cycle. Set to cycleCntr when a chat message is added.
     * Triggers onChatTransmit handlers.
     * OSRS: Client.chatCycle
     */
    chatCycle: number;

    /**
     * Stat/skill transmit cycle. Set to cycleCntr when skills update.
     * Triggers onStatTransmit handlers.
     * OSRS: Uses Client.changedSkillsCount comparison
     */
    statCycle: number;

    /**
     * Friend list transmit cycle. Set to cycleCntr when friend list updates.
     * Triggers onFriendTransmit handlers.
     */
    friendCycle: number;

    /**
     * Clan transmit cycle. Set to cycleCntr when clan state updates.
     * Triggers onClanTransmit handlers.
     */
    clanCycle: number;

    /**
     * Clan settings transmit cycle. Set to cycleCntr when clan settings update.
     * Triggers onClanSettingsTransmit handlers.
     */
    clanSettingsCycle: number;

    /**
     * Clan channel transmit cycle. Set to cycleCntr when clan channel/profile updates.
     * Triggers onClanChannelTransmit handlers.
     */
    clanChannelCycle: number;

    /**
     * Stock transmit cycle. Set to cycleCntr when Grand Exchange offers update.
     * Triggers onStockTransmit handlers.
     */
    stockCycle: number;

    /**
     * Misc transmit cycle. Set to cycleCntr when miscellaneous UI state changes.
     * Triggers onMiscTransmit handlers.
     */
    miscCycle: number;

    /**
     * Var transmit cycle. Set to cycleCntr when varps change.
     * Triggers onVarTransmit handlers.
     * OSRS: Uses varp-specific tracking
     */
    varCycle: number;

    /**
     * Timer transmit cycle. For onTimer handlers.
     * OSRS: Separate timer system
     */
    timerCycle: number;

    /**
     * Inv transmit cycle. Set to cycleCntr when inventories change.
     * Triggers onInvTransmit handlers.
     * OSRS: Uses inventory-specific tracking
     */
    invCycle: number;

    /**
     * Last cycleCntr value for which widget transmit handlers were processed.
     * Used to ensure events raised after transmit processing still trigger next tick.
     */
    lastTransmitProcessCycle: number;

    /**
     * Monotonically increasing counter for varp changes.
     * Increments every time a varp changes. Never reset.
     * Widgets track their last seen changedVarpCount to detect new changes.
     * OSRS: Client.changedVarpCount
     */
    changedVarpCount: number;

    /**
     * Circular buffer of last 32 changed varp IDs.
     * Index = (changedVarpCount - 1) & 31
     * Used for trigger matching optimization.
     * OSRS: Client.changedVarps[32]
     */
    changedVarps: Int32Array;

    /**
     * Monotonically increasing counter for inventory changes.
     * Increments every time an inventory changes. Never reset.
     * Widgets track their last seen changedInvCount to detect new changes.
     */
    changedInvCount: number;

    /**
     * Circular buffer of last 32 changed inventory IDs.
     * Index = (changedInvCount - 1) & 31
     * Used for trigger matching optimization.
     */
    changedInvsBuffer: Int32Array;

    /**
     * Monotonically increasing counter for stat/skill changes.
     * Increments every time a stat changes. Never reset.
     * Widgets track their last seen changedStatCount to detect new changes.
     * OSRS: Client.changedSkillsCount
     */
    changedStatCount: number;

    /**
     * Circular buffer of last 32 changed stat IDs.
     * Index = (changedStatCount - 1) & 31
     * Used for trigger matching optimization.
     * OSRS: Client.changedSkills[32]
     */
    changedStatsBuffer: Int32Array;

    /**
     * Performance optimization: Set to true when any transmit event occurs.
     * Reset to false after processWidgetTransmits runs.
     * Allows early exit when no events have occurred this tick.
     */
    transmitDirty: boolean;

    /**
     * Performance optimization: Set to true when widgets with transmit handlers are loaded.
     * Reset to false after processWidgetTransmits runs.
     * Newly loaded widgets need initial transmit processing even without events.
     */
    widgetsLoadedDirty: boolean;
}

/**
 * Create initial transmit cycles state.
 * All event cycles start at -1 (no event yet), cycleCntr starts at 1.
 * This ensures transmit handlers don't fire until an actual event occurs.
 *
 *
 * - Event cycles (chatCycle, etc.) start at -1 meaning "no event"
 * - Widget lastTransmitCycle starts at -1 meaning "never processed"
 * - Comparison: eventCycle > lastTransmitCycle
 * - -1 > -1 = FALSE (no false trigger on first tick)
 * - When event occurs: eventCycle = cycleCntr (e.g., 5)
 * - 5 > -1 = TRUE (correctly triggers)
 */
export function createTransmitCycles(): TransmitCycles {
    return {
        cycleCntr: 1, // Main counter, increments every tick
        chatCycle: -1, // -1 = no chat event yet
        statCycle: -1,
        friendCycle: -1,
        clanCycle: -1,
        clanSettingsCycle: -1,
        clanChannelCycle: -1,
        stockCycle: -1,
        miscCycle: -1,
        varCycle: -1,
        timerCycle: -1,
        invCycle: -1,
        lastTransmitProcessCycle: -1,
        // Counter-based varp change tracking
        changedVarpCount: 0,
        changedVarps: new Int32Array(32),
        // Counter-based inventory change tracking
        changedInvCount: 0,
        changedInvsBuffer: new Int32Array(32),
        // Counter-based stat change tracking
        changedStatCount: 0,
        changedStatsBuffer: new Int32Array(32),
        // Performance optimization flags
        transmitDirty: false,
        widgetsLoadedDirty: false,
    };
}

function getEventCycle(cycles: TransmitCycles): number {
    const current = cycles.cycleCntr | 0;
    // If widget transmits already ran for this cycle, bump to next cycle so
    // (eventCycle > widget.lastTransmitCycle) will succeed next tick.
    return cycles.lastTransmitProcessCycle === current ? (current + 1) | 0 : current;
}

/**
 * Singleton instance for global access.
 * This mirrors how OSRS uses static fields on Client class.
 */
let globalTransmitCycles: TransmitCycles | null = null;

export function getTransmitCycles(): TransmitCycles {
    if (!globalTransmitCycles) {
        globalTransmitCycles = createTransmitCycles();
    }
    return globalTransmitCycles;
}

export function setTransmitCycles(cycles: TransmitCycles): void {
    globalTransmitCycles = cycles;
}

export function resetTransmitCycles(): void {
    globalTransmitCycles = createTransmitCycles();
}

/**
 * Get current client clock value (cycle counter).
 * Used by CLIENTCLOCK opcode and various timing systems.
 * OSRS: Client.cycleCntr
 */
export function getClientClock(): number {
    return getTransmitCycles().cycleCntr;
}

/**
 * Mark that a chat message was added.
 * Sets chatCycle = cycleCntr so widgets with onChatTransmit will be triggered.
 */
export function markChatTransmit(): void {
    const cycles = getTransmitCycles();
    cycles.chatCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
}

/**
 * Mark that stats/skills were updated.
 * Sets statCycle = cycleCntr so widgets with onStatTransmit will be triggered.
 *
 * Also increments changedStatCount and stores stat ID in circular buffer.
 * This allows widgets to detect changes even after being closed and reopened.
 *
 * @param statId - Optional specific stat ID that changed.
 */
export function markStatTransmit(statId?: number): void {
    const cycles = getTransmitCycles();
    cycles.statCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
    if (statId !== undefined) {
        // Counter-based tracking
        cycles.changedStatsBuffer[cycles.changedStatCount & 31] = statId;
        cycles.changedStatCount++;
    }
}

/**
 * Mark that Grand Exchange offers were updated.
 * Sets stockCycle = cycleCntr so widgets with onStockTransmit will be triggered.
 *
 * stockCycle = cycleCntr on GrandExchangeOffer updates.
 */
export function markStockTransmit(): void {
    const cycles = getTransmitCycles();
    cycles.stockCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
}

/**
 * Mark that an inventory was updated (alias for inv-specific transmit).
 * Sets invCycle = cycleCntr so widgets with onInvTransmit will be triggered.
 *
 * Also increments changedInvCount and stores inv ID in circular buffer.
 * This allows widgets to detect changes even after being closed and reopened.
 *
 * @param invId - Optional specific inventory ID that changed.
 */
export function markInvTransmit(invId?: number): void {
    const cycles = getTransmitCycles();
    cycles.invCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
    if (invId !== undefined) {
        // Counter-based tracking
        cycles.changedInvsBuffer[cycles.changedInvCount & 31] = invId;
        cycles.changedInvCount++;
    }
}

/**
 * Mark that miscellaneous UI state changed (misc transmit).
 * Sets miscCycle = cycleCntr so widgets with onMiscTransmit will be triggered.
 */
export function markMiscTransmit(): void {
    const cycles = getTransmitCycles();
    cycles.miscCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
}

/**
 * Mark that a varp changed.
 * Sets varCycle = cycleCntr so widgets with onVarTransmit will be triggered.
 *
 * Also increments changedVarpCount and stores varp ID in circular buffer.
 * This allows widgets to detect changes even after being closed and reopened.
 *
 * @param varId - Optional specific varp ID that changed. If provided, adds to circular buffer.
 */
export function markVarTransmit(varId?: number): void {
    const cycles = getTransmitCycles();
    cycles.varCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
    if (varId !== undefined) {
        // Counter-based tracking
        // Store varp ID in circular buffer at current index
        cycles.changedVarps[cycles.changedVarpCount & 31] = varId;
        cycles.changedVarpCount++;
    }
}

/**
 * Mark that friend list was updated.
 */
export function markFriendTransmit(): void {
    const cycles = getTransmitCycles();
    cycles.friendCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
}

/**
 * Mark that clan state was updated.
 */
export function markClanTransmit(): void {
    const cycles = getTransmitCycles();
    cycles.clanCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
}

/**
 * Mark that clan settings were updated (VARCLANSETTING state changed).
 * Triggers onClanSettingsTransmit handlers.
 */
export function markClanSettingsTransmit(): void {
    const cycles = getTransmitCycles();
    cycles.clanSettingsCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
}

/**
 * Mark that clan channel/profile were updated (VARCLAN state changed).
 * Triggers onClanChannelTransmit handlers.
 */
export function markClanChannelTransmit(): void {
    const cycles = getTransmitCycles();
    cycles.clanChannelCycle = getEventCycle(cycles);
    cycles.transmitDirty = true;
}

/**
 * Mark that widgets with transmit handlers were loaded.
 * This ensures they get initial processing even if no events occurred.
 */
export function markWidgetsLoaded(): void {
    getTransmitCycles().widgetsLoadedDirty = true;
}

/**
 * Check if transmit processing should run.
 * Returns true if events occurred or widgets were loaded since last reset.
 */
export function isTransmitProcessingNeeded(): boolean {
    const cycles = getTransmitCycles();
    return cycles.transmitDirty || cycles.widgetsLoadedDirty;
}

/**
 * Reset transmit dirty flags after processing.
 * Should be called at the end of processWidgetTransmits.
 */
export function resetTransmitDirtyFlags(): void {
    const cycles = getTransmitCycles();
    cycles.transmitDirty = false;
    cycles.widgetsLoadedDirty = false;
}

import type { WidgetManager, WidgetNode } from "../../ui/widgets/WidgetManager";
import { markWidgetInteractionDirty } from "../../ui/widgets/WidgetInteraction";
import type { TypeLoader } from "../config/TypeLoader";
import type { DbRepository } from "../config/db/DbRepository";
import type { EnumType } from "../config/enumtype/EnumType";
import type { LocType } from "../config/loctype/LocType";
import type { NpcType } from "../config/npctype/NpcType";
import type { ObjTypeLoader } from "../config/objtype/ObjTypeLoader";
import type { ParamTypeLoader } from "../config/paramtype/ParamTypeLoader";
import type { StructType } from "../config/structtype/StructType";
import type { VarManager } from "../config/vartype/VarManager";
import type { Inventory } from "../inventory/Inventory";
import { Opcodes } from "./Opcodes";
import { Script } from "./Script";
import {
    ExecutionState,
    type HandlerContext,
    type HandlerMap,
    type HandlerResult,
    type WidgetEventHandler,
    type WidgetEventType,
    createHandlerMap,
} from "./handlers";

// Re-export types for backward compatibility
export { ExecutionState, type WidgetEventType, type WidgetEventHandler };

/**
 * Magic number constants used in script args for runtime substitution
 * These are special values that get replaced with actual event data at execution time
 */
export const ScriptArgMagic = {
    MOUSE_X: -2147483647, // Integer.MIN_VALUE + 1
    MOUSE_Y: -2147483646, // Integer.MIN_VALUE + 2
    WIDGET_ID: -2147483645, // Integer.MIN_VALUE + 3
    OP_INDEX: -2147483644, // Integer.MIN_VALUE + 4
    WIDGET_CHILD_INDEX: -2147483643, // Integer.MIN_VALUE + 5
    DRAG_TARGET_ID: -2147483642, // Integer.MIN_VALUE + 6
    DRAG_TARGET_CHILD_INDEX: -2147483641, // Integer.MIN_VALUE + 7
    KEY_TYPED: -2147483640, // Integer.MIN_VALUE + 8
    KEY_PRESSED: -2147483639, // Integer.MIN_VALUE + 9
    OP_SUBINDEX: -2147483638, // Integer.MIN_VALUE + 10
} as const;

/** Magic string for target name substitution */
export const EVENT_OPBASE = "event_opbase";

/**
 * ScriptEvent holds all context for a widget event
 * Used for queueing and executing script handlers
 */
export interface ScriptEvent {
    /** The script args array (scriptId at [0], then args) */
    args: any[];
    /** The widget this event targets */
    widget: WidgetNode | null;
    /** Mouse X relative to widget */
    mouseX: number;
    /** Mouse Y relative to widget */
    mouseY: number;
    /** Op index for menu actions (1-based) */
    opIndex: number;
    /** Target widget for drag operations */
    dragTarget: WidgetNode | null;
    /** Key code typed */
    keyTyped: number;
    /** Key code pressed */
    keyPressed: number;
    /** Target name for spell/use actions */
    targetName: string;
    /** Event type ID */
    type: number;
    /** Additional op context used by opcode 2929 forwarding. */
    field526: number;
    /** If true, this event should be removed if widget state changes */
    isInteractive: boolean;
}

/**
 * Create a new ScriptEvent with default values
 */
export function createScriptEvent(partial?: Partial<ScriptEvent>): ScriptEvent {
    return {
        args: [],
        widget: null,
        mouseX: 0,
        mouseY: 0,
        opIndex: 0,
        dragTarget: null,
        keyTyped: 0,
        keyPressed: 0,
        targetName: "",
        type: 76,
        field526: 0,
        isInteractive: false,
        ...partial,
    };
}

/** Stack frame for nested script calls */
export interface ScriptFrame {
    script: Script;
    pc: number;
    localInts: Int32Array;
    localStrings: any[];
}

/** Error with stack trace information */
export class Cs2Error extends Error {
    scriptId: number;
    pc: number;
    opcode: number;
    callStack: Array<{ scriptId: number; scriptName: string | null; pc: number }>;

    constructor(
        message: string,
        scriptId: number,
        pc: number,
        opcode: number,
        callStack: Array<{ scriptId: number; scriptName: string | null; pc: number }>,
    ) {
        super(message);
        this.name = "Cs2Error";
        this.scriptId = scriptId;
        this.pc = pc;
        this.opcode = opcode;
        this.callStack = callStack;
    }

    getStackTrace(): string {
        const lines = [`Cs2Error: ${this.message}`];
        for (let i = 0; i < this.callStack.length; i++) {
            const frame = this.callStack[i];
            const name = frame.scriptName ?? `script_${frame.scriptId}`;
            lines.push(`  ${i}: [${frame.scriptId}] ${name} @ pc=${frame.pc}`);
        }
        return lines.join("\n");
    }
}

/** Friend entry for friend list */
export interface FriendEntry {
    name: string;
    previousName: string;
    world: number;
    rank: number;
    isOnline: boolean;
}

/** Ignore entry for ignore list */
export interface IgnoreEntry {
    name: string;
    previousName: string;
}

/** Clan member entry */
export interface ClanMember {
    name: string;
    world: number;
    rank: number;
}

export interface Cs2Context {
    widgetManager: WidgetManager;
    varManager: VarManager;
    loadScript: (id: number) => Script | null;

    /**
     * PARITY: OSRS Protocol Revision (e.g., 179, 220).
     * Essential for strict opcode behavior (e.g., CC_CREATE argument count).
     * Default to 220+ for modern revisions if not specified.
     */
    clientRevision?: number;
    objTypeLoader?: ObjTypeLoader;
    paramTypeLoader?: ParamTypeLoader;
    enumTypeLoader?: TypeLoader<EnumType>;
    structTypeLoader?: TypeLoader<StructType>;
    npcTypeLoader?: TypeLoader<NpcType>;
    locTypeLoader?: TypeLoader<LocType>;
    dbRepository?: DbRepository;
    openMobileTab?: (tab: number) => void;

    // Inventory system - supports multiple inventory types
    inventories?: Map<number, Inventory>;

    // Friend/Ignore/Clan lists
    friendList?: FriendEntry[];
    ignoreList?: IgnoreEntry[];
    clanMembers?: ClanMember[];
    clanName?: string;
    clanOwner?: string;
    clanRank?: number;

    // Stats/skills (indices 0-22 for OSRS skills)
    getStatLevel?: (skillId: number) => number;
    getStatBase?: (skillId: number) => number;
    getStatXp?: (skillId: number) => number;
    getStatBoosted?: (skillId: number) => number;

    // Run energy (0-10000 internal units)
    getRunEnergy?: () => number;

    /**
     * Milliseconds remaining until the client considers the session idle (AFK logout warning timer).
     * Used by `IDLETIMER_GET` (opcode 3328).
     */
    getIdleTimerRemainingMs?: () => number;

    /**
     * Request logout from the game.
     * Called by `LOGOUT` opcode (5630) when player clicks logout button.
     */
    requestLogout?: () => void;
    /**
     * Send IF_CLOSE packet to the server.
     * OSRS parity: class47.method910() sends IF_CLOSE when deferred close executes.
     */
    sendIfClose?: () => void;

    // Player weight in kg (can be negative)
    getWeight?: () => number;

    // Player position (for COORD opcode)
    getPlayerPlane?: () => number;
    getBaseX?: () => number;
    getBaseY?: () => number;
    getPlayerLocalX?: () => number;
    getPlayerLocalY?: () => number;

    // Player appearance
    getPlayerGender?: () => number;

    /** Minimap zoom value (2..8). Used by `MINIMAP_GETZOOM` (opcode 7253). */
    getMinimapZoom?: () => number;

    // Viewport state
    viewportZoom?: number;
    viewportFov?: number;
    getViewportZoomRange: () => { min: number; max: number };
    setViewportZoomRange: (min: number, max: number) => void;
    getViewportFovValues: () => { low: number; high: number };
    setViewportFovValues: (low: number, high: number) => void;
    setViewportClampFov?: (
        fovClampMin: number,
        fovClampMax: number,
        zoomClampMin: number,
        zoomClampMax: number,
    ) => void;

    // Canvas/window state
    canvasWidth?: number;
    canvasHeight?: number;
    windowMode?: number; // 1 = fixed, 2 = resizable
    setWindowMode?: (mode: number) => void;

    // Drag operations
    setDragSource?: (widget: WidgetNode) => void;

    // Text measurement
    getTextWidth?: (text: string, fontId: number) => number;
    getTextHeight?: (fontId: number) => number;
    splitTextLines?: (text: string, fontId: number, maxWidth: number) => string[];

    // Local player name (from server handshake, used by CHAT_PLAYERNAME)
    localPlayerName?: string;
    /**
     * Optional resolver for CHAT_PLAYERNAME (opcode 5015).
     * Allows script-specific display-name decoration while preserving the raw
     * localPlayerName for non-chat systems (friends/clan comparisons, etc.).
     */
    resolveChatPlayerName?: (scriptId: number) => string | undefined;

    // Input manager for keyboard state queries (KEYHELD, KEYPRESSED)
    inputManager?: {
        isKeyHeld: (osrsKeyCode: number) => boolean;
        wasKeyPressed: (osrsKeyCode: number) => boolean;
    };

    // Audio playback (for SOUND_SONG, SOUND_JINGLE, SOUND_SYNTH opcodes)
    // OSRS parity: SOUND_SONG takes 5 params (trackId, outDelay, outDur, inDelay, inDur)
    playSong?: (
        songId: number,
        fadeOutDelay: number,
        fadeOutDuration: number,
        fadeInDelay: number,
        fadeInDuration: number,
    ) => void;
    playJingle?: (jingleId: number, delay: number) => void;
    playSoundEffect?: (soundId: number, delay: number, loops: number) => void;

    // Extended music control (opcodes 3220-3222)
    stopMusic?: (fadeOutDelay: number, fadeOutDuration: number) => void;
    playDualTracks?: (
        track1: number,
        track2: number,
        fadeOutDelay: number,
        fadeOutDuration: number,
        fadeInDelay: number,
        fadeInDuration: number,
    ) => void;
    crossfadeTracks?: (
        fadeOutDelay: number,
        fadeOutDuration: number,
        fadeInDelay: number,
        fadeInDuration: number,
    ) => void;

    // Direct volume control (setvolumemusic, setvolumesounds, setvolumeareasounds)
    setMusicVolume?: (volume: number) => void;
    getMusicVolume?: () => number;
    setSoundVolume?: (volume: number) => void;
    getSoundVolume?: () => number;
    setAreaSoundVolume?: (volume: number) => void;
    getAreaSoundVolume?: () => number;

    // Client/Game/Device options (clientoption_set/get, gameoption_set/get, deviceoption_set/get)
    setClientOption?: (optionId: number, value: number) => void;
    getClientOption?: (optionId: number) => number;
    setGameOption?: (optionId: number, value: number) => void;
    getGameOption?: (optionId: number) => number;
    setDeviceOption?: (optionId: number, value: number) => void;
    getDeviceOption?: (optionId: number) => number;

    // Tile highlight overlays (highlight_tile_* opcodes)
    configureTileHighlight: (
        slot: number,
        colorRgb: number | undefined,
        thickness: number,
        alphaPercent: number,
        flags: number,
    ) => void;
    setTileHighlight: (coordPacked: number, slot: number, group: number) => void;
    removeTileHighlight: (coordPacked: number, slot: number, group: number) => void;
    clearTileHighlights: (slot: number) => void;
    hasTileHighlight: (coordPacked: number, slot: number, group: number) => boolean;

    // Callback when a sub-interface is opened via IF_OPENSUB
    onSubInterfaceOpened?: (groupId: number) => void;

    // Callback for cc_resume_pausebutton / if_resume_pausebutton - sends RESUME_PAUSEBUTTON packet
    sendResumePauseButton?: (widgetUid: number, childIndex: number) => void;

    /**
     * Callback to display a notification using the authentic OSRS CS2 notification system.
     * Called by NOTIFICATIONS_SENDLOCAL opcode (6800).
     * Invokes script 3343 (notification_display_init) with the title, body, and color.
     */
    onNotificationDisplay?: (title: string, body: string, color: number) => void;

    /**
     * Optional callback for IF_TRIGGEROPLOCAL (2929) forwarding.
     * Mirrors the client packet path (class7.method121 / ClientPacket id 30).
     */
    onIfTriggerOpLocal?: (
        widgetUid: number,
        childIndex: number,
        itemId: number,
        opcodeParam: number,
        args: any[],
    ) => void;
}

export class Cs2Vm {
    // Configuration constants
    static readonly MAX_OPCOUNT = 500_000;
    static readonly ONLOAD_MAX_OPCOUNT = 5_000_000;
    static readonly WARN_OPCOUNT = 475_000;
    static readonly INITIAL_STACK_SIZE = 1000; // OSRS uses fixed 1000-element stacks
    static readonly MAX_STACK_SIZE = 1000; // OSRS: Interpreter_intStack = new int[1000]
    static readonly MAX_CALL_DEPTH = 50; // OSRS: Interpreter_frames = new ScriptFrame[50]

    // Stacks
    intStack: Int32Array;
    stringStack: any[];
    intStackSize: number = 0;
    stringStackSize: number = 0;

    // Call stack for nested script invocations
    callStack: ScriptFrame[] = [];
    callStackDepth: number = 0;

    // Current frame's local strings (for handler access to array objects)
    // In modern OSRS, object locals are full Object[] (strings, arrays, null, etc).
    currentLocalStrings: any[] = [];

    // Execution state
    executionState: ExecutionState = ExecutionState.FINISHED;
    opcount: number = 0;
    lastError: Cs2Error | null = null;

    context: Cs2Context;
    activeWidget: WidgetNode | null = null;
    dotWidget: WidgetNode | null = null;

    // DB Query state
    dbRowQuery: number[] = [];
    dbRowIndex: number = -1;
    dbTableId: number = -1;

    // Item search state (for OC_FIND/FINDNEXT/FINDRESET)
    itemSearchResults: number[] = [];
    itemSearchIndex: number = 0;

    // Widget children iteration state (for IF/CC_CHILDREN_FIND/FINDNEXTID)
    childrenIterWidget: WidgetNode | null = null;
    childrenIterIndices: number[] = [];
    childrenIterIndex: number = 0;

    // Event context (for magic argument substitution)
    eventContext = {
        mouseX: 0,
        mouseY: 0,
        opIndex: 0,
        dragTarget: null as WidgetNode | null,
        keyTyped: 0,
        keyPressed: 0,
        targetName: "",
        componentId: -1,
        componentIndex: -1,
        field526: 0,
    };

    private resetEventContext(): void {
        this.eventContext.mouseX = 0;
        this.eventContext.mouseY = 0;
        this.eventContext.opIndex = 0;
        this.eventContext.dragTarget = null;
        this.eventContext.keyTyped = 0;
        this.eventContext.keyPressed = 0;
        this.eventContext.targetName = "";
        this.eventContext.componentId = -1;
        this.eventContext.componentIndex = -1;
        this.eventContext.field526 = 0;
    }

    private applyEventContextFromScriptEvent(event: ScriptEvent): void {
        const w = event.widget;
        this.eventContext.mouseX = event.mouseX | 0;
        this.eventContext.mouseY = event.mouseY | 0;
        this.eventContext.opIndex = event.opIndex | 0;
        this.eventContext.dragTarget = event.dragTarget ?? null;
        this.eventContext.keyTyped = event.keyTyped | 0;
        this.eventContext.keyPressed = event.keyPressed | 0;
        this.eventContext.targetName = event.targetName ?? "";
        this.eventContext.field526 = event.field526 | 0;

        // OSRS PARITY: event_com / event_comsubid semantics.
        // Dynamic children (CC_CREATE) report the PARENT's UID for event_com; scripts
        // use event_comsubid (child index) to find the dynamic child via cc_find.
        if (w?.fileId === -1 && (w as any).parentUid != null) {
            this.eventContext.componentId = ((w as any).parentUid as number) | 0;
        } else {
            this.eventContext.componentId = (w?.uid ?? -1) | 0;
        }
        this.eventContext.componentIndex = (w?.childIndex ?? -1) | 0;
    }

    // Current script ID for debugging
    currentScriptId: number = -1;

    // Current PC for debugging
    currentPc: number = 0;

    // Chat filter state (stored on VM, synced with server)
    publicChatMode: number = 0;
    privateChatMode: number = 0;
    tradeChatMode: number = 0;
    messageFilter: string = "";

    // Input dialog state (OSRS parity: Client.field798, Client.field673)
    // Type 0 = no dialog active (all widgets can receive input)
    // Type 1 = default/reset state
    // Type 2 = interface-scoped (only widgets in inputDialogWidgetId interface)
    // Type 3 = widget-scoped (only inputDialogWidgetId widget can receive input)
    inputDialogType: number = 0;
    inputDialogWidgetId: number = -1;
    // Current input string being typed by user
    inputDialogString: string = "";
    // Callback to send dialog result to server
    onInputDialogComplete?: (type: "count" | "name" | "string", value: string | number) => void;

    // Handler map for opcode dispatch
    private handlers: HandlerMap;

    // PERF: Fast array dispatch for low opcodes (0-255), Map for high opcodes
    private handlerArray: (
        | ((ctx: HandlerContext, intOp: number, stringOp: string | null) => any)
        | undefined
    )[];
    private static readonly HANDLER_ARRAY_SIZE = 256;

    // Track if we're in a top-level run() - used to defer callbacks
    private isExecuting: boolean = false;

    // PERF: Use Set for O(1) deduplication instead of Array.includes() O(n)
    private pendingVarcChanges: Set<number> = new Set();
    private pendingVarpChanges: Set<number> = new Set();

    // PERF: Cached handler context - reused across script executions
    private cachedHandlerContext: HandlerContext | null = null;

    // Symbols used for caches attached to handler context
    private static readonly WIDGET_CACHE_KEY = Symbol("__widgetLookupCache");
    private static readonly SET_OBJECT_QTY_MODE_CACHE_KEY = "__setObjectQtyModeCache";

    // PERF: Object pool for local arrays to reduce allocations
    private localIntPool: Int32Array[] = [];
    private localStringPool: any[][] = [];
    private static readonly MAX_POOL_SIZE = 16;

    private currentMaxOpcount: number = Cs2Vm.MAX_OPCOUNT;
    private currentWarnOpcount: number = Cs2Vm.WARN_OPCOUNT;

    private pendingResizeQueue: Array<{ widget: WidgetNode; depth: number }> = [];
    private pendingTriggerOpQueue: Array<{ widget: WidgetNode; opIndex: number }> = [];
    private pendingIfClose: boolean = false;
    private eventDepth: number = 0;

    private shouldTraceForCurrentContext(scriptId: number): boolean {
        const cfg: any = (globalThis as any).__cs2Trace;
        if (!cfg || cfg.enabled !== true) return false;

        // Optional per-script filtering:
        // - `scripts === null` => no script filter (trace everything)
        // - `scripts` array/Set => trace only those script ids
        const scripts = cfg.scripts;
        if (scripts !== undefined && scripts !== null) {
            const has = Array.isArray(scripts)
                ? scripts.includes(scriptId)
                : scripts instanceof Set
                ? scripts.has(scriptId)
                : false;
            if (!has) return false;
        }

        // Optional per-group filtering (based on active widget group during event runs)
        const groups = cfg.groups;
        if (groups) {
            const g = (this.activeWidget as any)?.groupId;
            const has = Array.isArray(groups)
                ? groups.includes(g)
                : groups instanceof Set
                ? groups.has(g)
                : false;
            if (!has) return false;
        }

        return true;
    }

    private traceScriptEnter(script: Script): void {
        if (!this.shouldTraceForCurrentContext(script.id)) return;
        const cfg: any = (globalThis as any).__cs2Trace;
        const maxLines: number = typeof cfg?.maxLines === "number" ? cfg.maxLines : 2000;
        cfg.lines = (cfg.lines | 0) + 1;
        if (cfg.lines > maxLines) {
            cfg.enabled = false;
            console.log(`[CS2] trace disabled after ${maxLines} lines`);
            return;
        }

        const depth = this.callStackDepth | 0;
        const indent = depth > 0 ? "  ".repeat(Math.min(25, depth)) : "";
        const name = script.name ?? "";
        const aw: any = this.activeWidget as any;
        const awStr =
            aw && typeof aw.uid === "number"
                ? ` aw=${(aw.uid >>> 16) & 0xffff}:${aw.uid & 0xffff}`
                : "";
        console.log(`${indent}[CS2] enter ${script.id}${name ? ` (${name})` : ""}${awStr}`);
    }

    // Callback to trigger when varcs change (set by OsrsClient)
    onVarcChange: ((varcId: number) => void) | null = null;

    // Callback to trigger when varps change (set by OsrsClient)
    onVarpChange: ((varpId: number) => void) | null = null;

    constructor(context: Cs2Context) {
        this.context = context;
        this.intStack = new Int32Array(Cs2Vm.INITIAL_STACK_SIZE);
        this.stringStack = new Array(Cs2Vm.INITIAL_STACK_SIZE);
        this.handlers = createHandlerMap();

        // PERF: Build fast array dispatch for low opcodes
        this.handlerArray = new Array(Cs2Vm.HANDLER_ARRAY_SIZE);
        for (let i = 0; i < Cs2Vm.HANDLER_ARRAY_SIZE; i++) {
            this.handlerArray[i] = this.handlers.get(i);
        }
    }

    /** PERF: Return local arrays to pool for reuse */
    private returnLocalArraysToPool(localInts: Int32Array, localStrings: any[]): void {
        if (this.localIntPool.length < Cs2Vm.MAX_POOL_SIZE) {
            this.localIntPool.push(localInts);
        }
        if (this.localStringPool.length < Cs2Vm.MAX_POOL_SIZE) {
            this.localStringPool.push(localStrings);
        }
    }

    /** Reset VM state for a new top-level execution */
    reset(): void {
        this.intStackSize = 0;
        this.stringStackSize = 0;
        this.callStackDepth = 0;
        this.opcount = 0;
        this.currentMaxOpcount = Cs2Vm.MAX_OPCOUNT;
        this.currentWarnOpcount = Cs2Vm.WARN_OPCOUNT;
        this.executionState = ExecutionState.RUNNING;
        this.lastError = null;
        this.pendingResizeQueue.length = 0;
        this.pendingTriggerOpQueue.length = 0;
        this.pendingIfClose = false;
        this.eventDepth = 0;
    }

    /**
     * PERF: Clear handler context caches to prevent memory leaks.
     * Call this periodically (e.g., when interfaces change) to free cached data.
     */
    clearHandlerCaches(): void {
        if (!this.cachedHandlerContext) return;

        const ctx = this.cachedHandlerContext as any;

        // Clear widget lookup cache
        const widgetCache = ctx[Cs2Vm.WIDGET_CACHE_KEY];
        if (widgetCache) {
            widgetCache.map?.clear();
            if (widgetCache.accessOrder) {
                widgetCache.accessOrder.length = 0;
            }
        }

        // Clear object quantity mode cache
        const qtyModeCache = ctx[Cs2Vm.SET_OBJECT_QTY_MODE_CACHE_KEY];
        if (qtyModeCache instanceof Map) {
            qtyModeCache.clear();
        }
    }

    // ============== Stack Operations with Bounds Checking ==============

    /** Push an integer onto the stack, growing if needed */
    pushInt(value: number): void {
        if (this.intStackSize >= this.intStack.length) {
            this.growIntStack();
        }
        this.intStack[this.intStackSize++] = value;
    }

    /** Pop an integer from the stack */
    popInt(): number {
        if (this.intStackSize <= 0) {
            throw new Error("RuntimeException");
        }
        return this.intStack[--this.intStackSize];
    }

    /** Peek at the top integer without popping */
    peekInt(): number {
        if (this.intStackSize <= 0) {
            throw new Error("RuntimeException");
        }
        return this.intStack[this.intStackSize - 1];
    }

    /** Push a string onto the stack, growing if needed */
    pushString(value: any): void {
        if (this.stringStackSize >= this.stringStack.length) {
            this.growStringStack();
        }
        this.stringStack[this.stringStackSize++] = value;
    }

    /** Pop a string from the stack */
    popString(): any {
        if (this.stringStackSize <= 0) {
            throw new Error("RuntimeException");
        }
        return this.stringStack[--this.stringStackSize];
    }

    /** Grow the integer stack */
    private growIntStack(): void {
        const newSize = Math.min(this.intStack.length * 2, Cs2Vm.MAX_STACK_SIZE);
        if (newSize <= this.intStack.length) {
            // Log the top values on the stack to help debug what's being pushed
            const topValues: number[] = [];
            for (let i = Math.max(0, this.intStackSize - 20); i < this.intStackSize; i++) {
                topValues.push(this.intStack[i]);
            }
            console.error(
                `[Cs2Vm] Stack overflow in script ${this.currentScriptId} at pc=${this.currentPc}. Top 20 stack values:`,
                topValues,
            );
            throw new Error(`Int stack overflow (max ${Cs2Vm.MAX_STACK_SIZE})`);
        }
        const newStack = new Int32Array(newSize);
        newStack.set(this.intStack);
        this.intStack = newStack;
    }

    /** Grow the string stack */
    private growStringStack(): void {
        const newSize = Math.min(this.stringStack.length * 2, Cs2Vm.MAX_STACK_SIZE);
        if (newSize <= this.stringStack.length) {
            throw new Error(`String stack overflow (max ${Cs2Vm.MAX_STACK_SIZE})`);
        }
        // PERF: Use slice() + length assignment instead of manual loop copy
        const newStack = this.stringStack.slice();
        newStack.length = newSize;
        this.stringStack = newStack;
    }

    // ============== Handler Context Implementation ==============

    /** Set the active widget */
    setActiveWidget(w: WidgetNode | null): void {
        this.activeWidget = w;
    }

    /** Set the dot widget (used by .cc_* operations) */
    setDotWidget(w: WidgetNode | null): void {
        this.dotWidget = w;
    }

    /** Set DB row query */
    setDbRowQuery(rows: number[]): void {
        this.dbRowQuery = rows;
    }

    /** Set DB row index */
    setDbRowIndex(index: number): void {
        this.dbRowIndex = index;
    }

    /** Set DB table ID (for filter operations) */
    setDbTableId(tableId: number): void {
        this.dbTableId = tableId;
    }

    /** Create handler context (returns this VM cast as HandlerContext) */
    private createHandlerContext(): HandlerContext {
        // Use closure to capture 'vm' reference for getters/setters
        const vm = this;

        return {
            // Reference to the VM for input dialog state access
            cs2Vm: vm,

            // Stacks - direct references to VM arrays
            get intStack() {
                return vm.intStack;
            },
            get stringStack() {
                return vm.stringStack;
            },
            get intStackSize() {
                return vm.intStackSize;
            },
            set intStackSize(v) {
                if (Number.isNaN(v)) {
                    console.error(
                        `[Cs2Vm] intStackSize set to NaN! Script ${vm.currentScriptId} pc ${vm.currentPc}`,
                    );
                    try {
                        throw new Error("NaN stack size");
                    } catch (e) {
                        console.error(e);
                    }
                    v = 0;
                }
                vm.intStackSize = Math.max(0, v);
            },
            get stringStackSize() {
                return vm.stringStackSize;
            },
            set stringStackSize(v) {
                vm.stringStackSize = Math.max(0, v);
            },

            // Stack operations
            pushInt: vm.pushInt.bind(vm),
            popInt: vm.popInt.bind(vm),
            peekInt: vm.peekInt.bind(vm),
            pushString: vm.pushString.bind(vm),
            popString: vm.popString.bind(vm),

            // Active widget
            get activeWidget() {
                return vm.activeWidget;
            },
            setActiveWidget: vm.setActiveWidget.bind(vm),

            // Dot widget (for .cc_* operations)
            get dotWidget() {
                return vm.dotWidget;
            },
            setDotWidget: vm.setDotWidget.bind(vm),

            // External context
            widgetManager: vm.context.widgetManager,
            varManager: vm.context.varManager,
            loadScript: vm.context.loadScript,
            objTypeLoader: vm.context.objTypeLoader,
            paramTypeLoader: vm.context.paramTypeLoader,
            enumTypeLoader: vm.context.enumTypeLoader,
            structTypeLoader: vm.context.structTypeLoader,
            npcTypeLoader: vm.context.npcTypeLoader,
            locTypeLoader: vm.context.locTypeLoader,
            dbRepository: vm.context.dbRepository,
            openMobileTab: vm.context.openMobileTab,

            // Inventory system - supports multiple inventory types
            get inventories() {
                return vm.context.inventories ?? new Map();
            },
            getInventory: (invId: number) => {
                return vm.context.inventories?.get(invId) ?? null;
            },

            // Friend/Ignore/Clan lists
            get friendList() {
                return vm.context.friendList ?? [];
            },
            get ignoreList() {
                return vm.context.ignoreList ?? [];
            },
            get clanMembers() {
                return vm.context.clanMembers ?? [];
            },
            get clanName() {
                return vm.context.clanName ?? "";
            },
            get clanOwner() {
                return vm.context.clanOwner ?? "";
            },
            get clanRank() {
                return vm.context.clanRank ?? 0;
            },

            // Event context (for magic argument substitution)
            get eventContext() {
                return vm.eventContext;
            },

            // Stats/skills
            getStatLevel: vm.context.getStatLevel,
            getStatBase: vm.context.getStatBase,
            getStatXp: vm.context.getStatXp,
            getStatBoosted: vm.context.getStatBoosted,

            // Run energy (0-10000 internal units)
            getRunEnergy: vm.context.getRunEnergy,

            // Idle timer (ms remaining until AFK logout)
            getIdleTimerRemainingMs: vm.context.getIdleTimerRemainingMs,

            // Player weight in kg
            getWeight: vm.context.getWeight,

            // Player position (for COORD opcode)
            getPlayerPlane: vm.context.getPlayerPlane,
            getBaseX: vm.context.getBaseX,
            getBaseY: vm.context.getBaseY,
            getPlayerLocalX: vm.context.getPlayerLocalX,
            getPlayerLocalY: vm.context.getPlayerLocalY,

            // Player appearance
            getPlayerGender: vm.context.getPlayerGender,

            // Minimap zoom
            getMinimapZoom: vm.context.getMinimapZoom,

            // Viewport state
            get viewportZoom() {
                return vm.context.viewportZoom;
            },
            get viewportFov() {
                return vm.context.viewportFov;
            },
            getViewportZoomRange: vm.context.getViewportZoomRange,
            setViewportZoomRange: vm.context.setViewportZoomRange,
            getViewportFovValues: vm.context.getViewportFovValues,
            setViewportFovValues: vm.context.setViewportFovValues,
            setViewportClampFov: vm.context.setViewportClampFov,

            // Canvas/window state
            get canvasWidth() {
                return vm.context.canvasWidth;
            },
            get canvasHeight() {
                return vm.context.canvasHeight;
            },
            get windowMode() {
                return vm.context.windowMode;
            },
            setWindowMode: vm.context.setWindowMode,

            // DB Query state
            get dbRowQuery() {
                return vm.dbRowQuery;
            },
            get dbRowIndex() {
                return vm.dbRowIndex;
            },
            get dbTableId() {
                return vm.dbTableId;
            },
            setDbRowQuery: vm.setDbRowQuery.bind(vm),
            setDbRowIndex: vm.setDbRowIndex.bind(vm),
            setDbTableId: vm.setDbTableId.bind(vm),

            // Item search state (for OC_FIND/FINDNEXT/FINDRESET)
            get itemSearchResults() {
                return vm.itemSearchResults;
            },
            set itemSearchResults(v: number[]) {
                vm.itemSearchResults = v;
            },
            get itemSearchIndex() {
                return vm.itemSearchIndex;
            },
            set itemSearchIndex(v: number) {
                vm.itemSearchIndex = v;
            },

            // Widget children iteration state (for IF/CC_CHILDREN_FIND/FINDNEXTID)
            get childrenIterWidget() {
                return vm.childrenIterWidget;
            },
            set childrenIterWidget(v: WidgetNode | null) {
                vm.childrenIterWidget = v;
            },
            get childrenIterIndices() {
                return vm.childrenIterIndices;
            },
            set childrenIterIndices(v: number[]) {
                vm.childrenIterIndices = v;
            },
            get childrenIterIndex() {
                return vm.childrenIterIndex;
            },
            set childrenIterIndex(v: number) {
                vm.childrenIterIndex = v;
            },

            // Script invocation (stub - handled in main loop)
            invokeScript: () => {},

            // Event handler invocation
            invokeEventHandler: vm.invokeEventHandler.bind(vm),

            // Event handler setting
            setEventHandler: vm.setEventHandler.bind(vm),
            setEventHandlerByUid: vm.setEventHandlerByUid.bind(vm),

            // Drag operations
            setDragSource: (w) => {
                if (!vm.context.setDragSource) {
                    throw new Error("RuntimeException");
                }
                vm.context.setDragSource(w);
            },

            // Text measurement
            getTextWidth: (text: string, fontId: number) => {
                if (!vm.context.getTextWidth) {
                    throw new Error("RuntimeException");
                }
                return vm.context.getTextWidth(text, fontId);
            },
            getTextHeight: (fontId: number) => {
                if (!vm.context.getTextHeight) {
                    throw new Error("RuntimeException");
                }
                return vm.context.getTextHeight(fontId);
            },
            splitTextLines: (text: string, fontId: number, maxWidth: number) => {
                if (!vm.context.splitTextLines) {
                    throw new Error("RuntimeException");
                }
                return vm.context.splitTextLines(text, fontId, maxWidth);
            },

            // Current script ID for debugging
            get currentScriptId() {
                return vm.currentScriptId;
            },

            // Current PC for debugging
            get currentPc() {
                return vm.currentPc;
            },

            // Local player name
            get localPlayerName() {
                return vm.context.localPlayerName;
            },
            resolveChatPlayerName: vm.context.resolveChatPlayerName,

            // Chat filter state
            get publicChatMode() {
                return vm.publicChatMode;
            },
            set publicChatMode(v: number) {
                vm.publicChatMode = v;
            },
            get privateChatMode() {
                return vm.privateChatMode;
            },
            set privateChatMode(v: number) {
                vm.privateChatMode = v;
            },
            get tradeChatMode() {
                return vm.tradeChatMode;
            },
            set tradeChatMode(v: number) {
                vm.tradeChatMode = v;
            },
            get messageFilter() {
                return vm.messageFilter;
            },
            set messageFilter(v: string) {
                vm.messageFilter = v;
            },

            // Console output
            writeConsole: (text: string) => {
                console.log(text);
            },

            // PARITY: Client revision for revision-specific opcode behavior
            // This project targets OSRS r235.
            get clientRevision() {
                return vm.context.clientRevision ?? 235;
            },

            // Local string access for array operations
            // In modern OSRS (R235+), arrays are objects stored in local string variables
            getLocalString: (index: number) => {
                if (index < 0 || index >= vm.currentLocalStrings.length) {
                    throw new Error("RuntimeException");
                }
                return vm.currentLocalStrings[index];
            },
            setLocalString: (index: number, value: any) => {
                if (index < 0 || index >= vm.currentLocalStrings.length) {
                    throw new Error("RuntimeException");
                }
                vm.currentLocalStrings[index] = value;
            },

            queueResize: (widget) => {
                vm.queueResize(widget);
            },
            queueTriggerOp: (widget, opIndex) => {
                vm.queueTriggerOp(widget, opIndex);
            },
            deferIfClose: () => {
                vm.deferIfClose();
            },
            forwardIfTriggerOpLocal: () => {
                vm.forwardIfTriggerOpLocal();
            },

            // Input manager for keyboard state queries (KEYHELD, KEYPRESSED)
            inputManager: vm.context.inputManager,

            // Audio playback
            playSong: vm.context.playSong,
            playJingle: vm.context.playJingle,
            playSoundEffect: vm.context.playSoundEffect,

            // Extended music control
            stopMusic: vm.context.stopMusic,
            playDualTracks: vm.context.playDualTracks,
            crossfadeTracks: vm.context.crossfadeTracks,

            // Direct volume control
            setMusicVolume: vm.context.setMusicVolume,
            getMusicVolume: vm.context.getMusicVolume,
            setSoundVolume: vm.context.setSoundVolume,
            getSoundVolume: vm.context.getSoundVolume,
            setAreaSoundVolume: vm.context.setAreaSoundVolume,
            getAreaSoundVolume: vm.context.getAreaSoundVolume,

            // Client/Game/Device options
            setClientOption: vm.context.setClientOption,
            getClientOption: vm.context.getClientOption,
            setGameOption: vm.context.setGameOption,
            getGameOption: vm.context.getGameOption,
            setDeviceOption: vm.context.setDeviceOption,
            getDeviceOption: vm.context.getDeviceOption,
            get configureTileHighlight() {
                return vm.context.configureTileHighlight;
            },
            get setTileHighlight() {
                return vm.context.setTileHighlight;
            },
            get removeTileHighlight() {
                return vm.context.removeTileHighlight;
            },
            get clearTileHighlights() {
                return vm.context.clearTileHighlights;
            },
            get hasTileHighlight() {
                return vm.context.hasTileHighlight;
            },

            // Callback when a sub-interface is opened via IF_OPENSUB
            onSubInterfaceOpened: vm.context.onSubInterfaceOpened,

            // Callback for cc_resume_pausebutton / if_resume_pausebutton - sends RESUME_PAUSEBUTTON packet
            sendResumePauseButton: vm.context.sendResumePauseButton,

            // Callback for notification display (NOTIFICATIONS_SENDLOCAL opcode)
            onNotificationDisplay: vm.context.onNotificationDisplay,

            // Logout request
            requestLogout: vm.context.requestLogout,
        } as HandlerContext;
    }

    // ============== Call Stack Management ==============

    /** Build current call stack for error reporting */
    private buildCallStack(
        currentScript: Script,
        currentPc: number,
    ): Array<{ scriptId: number; scriptName: string | null; pc: number }> {
        const stack: Array<{ scriptId: number; scriptName: string | null; pc: number }> = [];

        // Add frames from deepest to current
        for (let i = 0; i < this.callStackDepth; i++) {
            const frame = this.callStack[i];
            stack.push({
                scriptId: frame.script.id,
                scriptName: frame.script.name ?? null,
                pc: frame.pc,
            });
        }

        // Add current execution point
        stack.push({
            scriptId: currentScript.id,
            scriptName: currentScript.name ?? null,
            pc: currentPc,
        });

        return stack;
    }

    /** Create an error with full stack trace */
    private createError(message: string, script: Script, pc: number, opcode: number): Cs2Error {
        return new Cs2Error(message, script.id, pc, opcode, this.buildCallStack(script, pc));
    }

    /** Log an error with stack trace */
    private logError(error: Cs2Error): void {
        console.error(error.getStackTrace());
        this.lastError = error;
    }

    run(
        script: Script,
        intArgs?: number[],
        objectArgs?: any[],
        maxOpcount: number = Cs2Vm.MAX_OPCOUNT,
    ): void {
        // OSRS parity: For non-event top-level runs (no active widget context),
        // clear any previous event context so opcodes don't see stale event_* values.
        //
        // Event handlers set `activeWidget` (and populate eventContext) before calling into run().
        if (!this.activeWidget) {
            this.resetEventContext();
        }

        this.reset();
        this.currentMaxOpcount = maxOpcount;
        this.currentWarnOpcount = maxOpcount === Cs2Vm.MAX_OPCOUNT ? Cs2Vm.WARN_OPCOUNT : 0;
        this.isExecuting = true;

        // PERF: Batch widget invalidations during script execution
        // This defers cascading invalidations until the script completes
        this.context.widgetManager.beginBatch();

        try {
            this.executeInternal(script, intArgs, objectArgs);
        } finally {
            this.isExecuting = false;
            // PERF: Process batched invalidations
            this.context.widgetManager.endBatch();
            // Process any var changes that were queued during execution
            this.processPendingVarChanges();
        }
    }

    /** Check if VM is currently executing a script */
    isRunning(): boolean {
        return this.isExecuting;
    }

    /** Queue a varc change to be processed after current execution */
    queueVarcChange(varcId: number): void {
        // PERF: Set.add() is O(1) vs Array.includes() O(n)
        this.pendingVarcChanges.add(varcId);
    }

    /** Queue a varp change to be processed after current execution */
    queueVarpChange(varpId: number): void {
        // PERF: Set.add() is O(1) vs Array.includes() O(n)
        this.pendingVarpChanges.add(varpId);
    }

    /** Process queued var changes after script execution */
    private processPendingVarChanges(): void {
        // Process varp changes first
        if (this.pendingVarpChanges.size > 0) {
            // PERF: Iterate directly over Set, clear after
            if (this.onVarpChange) {
                for (const varpId of this.pendingVarpChanges) {
                    this.onVarpChange(varpId);
                }
            }
            this.pendingVarpChanges.clear();
        }

        // Process varc changes
        if (this.pendingVarcChanges.size > 0) {
            // PERF: Iterate directly over Set, clear after
            if (this.onVarcChange) {
                for (const varcId of this.pendingVarcChanges) {
                    this.onVarcChange(varcId);
                }
            }
            this.pendingVarcChanges.clear();
        }
    }

    queueResize(widget: WidgetNode): void {
        // OSRS parity: queueing resize from script depth 10+ throws.
        if (this.eventDepth >= 10) {
            throw new Error("RuntimeException");
        }
        this.pendingResizeQueue.push({
            widget,
            depth: this.eventDepth + 1,
        });
    }

    queueTriggerOp(widget: WidgetNode, opIndex: number): void {
        if (opIndex < 1 || opIndex > 10) {
            throw new Error("RuntimeException");
        }
        this.pendingTriggerOpQueue.push({ widget, opIndex });
    }

    deferIfClose(): void {
        this.pendingIfClose = true;
    }

    private performIfCloseNow(): void {
        this.context.sendIfClose?.();
        for (const [uid, parent] of this.context.widgetManager.interfaceParents) {
            if (parent.type !== 0 && parent.type !== 3) continue;
            this.context.widgetManager.closeSubInterface(uid);
            try {
                if ((parent.group | 0) === 12) {
                    const cfg: any = (globalThis as any).__cs2Trace;
                    if (cfg && cfg.enabled === true) {
                        cfg.enabled = false;
                        console.log("[CS2] trace disabled (bank close via IF_CLOSE)");
                    }
                }
            } catch {}
        }
        if (this.context.widgetManager.meslayerContinueWidget) {
            this.context.widgetManager.invalidateWidgetRender(
                this.context.widgetManager.meslayerContinueWidget,
            );
            this.context.widgetManager.meslayerContinueWidget = null;
        }
    }

    private flushDeferredActionsIfTopLevel(): void {
        if (this.callStackDepth !== 0) {
            return;
        }

        const prevState = this.executionState;
        if (prevState !== ExecutionState.ABORTED) {
            this.executionState = ExecutionState.RUNNING;
        }

        while (this.pendingResizeQueue.length > 0) {
            const entry = this.pendingResizeQueue.shift()!;
            const prevDepth = this.eventDepth;
            this.eventDepth = entry.depth | 0;
            try {
                this.invokeEventHandler(entry.widget, "onResize");
            } finally {
                this.eventDepth = prevDepth;
            }
            if (this.executionState === ExecutionState.ABORTED) {
                return;
            }
        }

        while (this.pendingTriggerOpQueue.length > 0) {
            const entry = this.pendingTriggerOpQueue.shift()!;
            this.invokeEventHandler(entry.widget, "onOp", {
                opIndex: entry.opIndex,
                field526: 0,
            });
            if (this.executionState === ExecutionState.ABORTED) {
                return;
            }
        }

        if (this.pendingIfClose) {
            this.pendingIfClose = false;
            this.performIfCloseNow();
        }

        if (this.executionState !== ExecutionState.ABORTED) {
            this.executionState = prevState;
        }
    }

    forwardIfTriggerOpLocal(): void {
        const argsArray = this.parseTriggerOpLocalArgs();
        if (this.intStackSize < 3) {
            throw new Error("RuntimeException");
        }

        const opcodeParam = this.intStack[this.intStackSize - 3] | 0;
        const widgetUid = this.intStack[this.intStackSize - 2] | 0;
        const childIndex = this.intStack[this.intStackSize - 1] | 0;
        this.intStackSize -= 3;

        // OSRS parity (class366.method8291):
        // - resolve parent by widget UID
        // - if childIndex != -1, resolve child from parent.children[childIndex]
        const groupId = (widgetUid >>> 16) & 0xffff;
        this.context.widgetManager.getGroup(groupId);
        const parent = this.context.widgetManager.getWidgetByUid(widgetUid);
        const widget =
            childIndex !== -1
                ? parent?.children && childIndex >= 0 && childIndex < parent.children.length
                    ? parent.children[childIndex]
                    : null
                : parent;
        if (!widget) {
            throw new Error("RuntimeException");
        }
        const itemId = (widget.itemId ?? -1) | 0;
        this.context.onIfTriggerOpLocal?.(widgetUid, childIndex, itemId, opcodeParam, argsArray);
    }

    /** Execute a script - internal method that supports nesting */
    private executeInternal(script: Script, intArgs?: number[], objectArgs?: any[]): void {
        this.traceScriptEnter(script);
        const rootScript = script;
        const prevLocalStrings = this.currentLocalStrings;

        const allocateFrameLocals = (
            frameScript: Script,
        ): { localInts: Int32Array; localStrings: any[] } => {
            let frameInts: Int32Array;
            let frameStrings: any[];
            const intCount = frameScript.localIntCount;
            const stringCount = frameScript.localObjCount;

            if (
                this.localIntPool.length > 0 &&
                this.localIntPool[this.localIntPool.length - 1].length >= intCount
            ) {
                frameInts = this.localIntPool.pop()!;
                frameInts.fill(0, 0, intCount);
            } else {
                frameInts = new Int32Array(intCount);
            }

            if (
                this.localStringPool.length > 0 &&
                this.localStringPool[this.localStringPool.length - 1].length >= stringCount
            ) {
                frameStrings = this.localStringPool.pop()!;
                for (let i = 0; i < stringCount; i++) {
                    frameStrings[i] = null;
                }
            } else {
                frameStrings = new Array(stringCount).fill(null);
            }

            return { localInts: frameInts, localStrings: frameStrings };
        };

        const loadArgsIntoLocals = (
            frameInts: Int32Array,
            frameStrings: any[],
            srcInts?: ArrayLike<number>,
            srcStrings?: ArrayLike<any>,
        ): void => {
            if (srcInts) {
                if (srcInts.length > frameInts.length) {
                    throw new Error("RuntimeException");
                }
                for (let i = 0; i < srcInts.length; i++) {
                    frameInts[i] = srcInts[i];
                }
            }
            if (srcStrings) {
                if (srcStrings.length > frameStrings.length) {
                    throw new Error("RuntimeException");
                }
                for (let i = 0; i < srcStrings.length; i++) {
                    frameStrings[i] = srcStrings[i];
                }
            }
        };

        // PERF: Reuse cached handler context instead of recreating each time
        if (!this.cachedHandlerContext) {
            this.cachedHandlerContext = this.createHandlerContext();
        }
        const ctx = this.cachedHandlerContext;

        let currentScript = script;
        let pc = 0;
        let { localInts, localStrings } = allocateFrameLocals(currentScript);
        loadArgsIntoLocals(localInts, localStrings, intArgs, objectArgs);

        this.currentScriptId = currentScript.id;
        this.currentLocalStrings = localStrings;

        let instructions = currentScript.instructions;
        let intOperands = currentScript.intOperands;
        let stringOperands = currentScript.stringOperands;
        let switches = currentScript.switches;

        const restoreCallerFrame = (): boolean => {
            if (this.callStackDepth === 0) {
                return false;
            }

            this.returnLocalArraysToPool(localInts, localStrings);
            const caller = this.callStack[--this.callStackDepth];

            currentScript = caller.script;
            localInts = caller.localInts;
            localStrings = caller.localStrings;
            instructions = currentScript.instructions;
            intOperands = currentScript.intOperands;
            stringOperands = currentScript.stringOperands;
            switches = currentScript.switches;
            pc = caller.pc + 1;

            this.currentScriptId = currentScript.id;
            this.currentLocalStrings = localStrings;
            this.executionState = ExecutionState.RUNNING;
            return true;
        };

        const finalizeSuccessfulTopLevel = (): void => {
            this.flushDeferredActionsIfTopLevel();
            if (
                this.callStackDepth === 0 &&
                this.executionState !== ExecutionState.ABORTED &&
                this.currentWarnOpcount > 0 &&
                this.opcount >= this.currentWarnOpcount
            ) {
                const scriptName = rootScript.name ?? `script_${rootScript.id}`;
                console.log(
                    `[Cs2Vm] Warning: Script ${scriptName} finished at opcount ${this.opcount} (max ${this.currentMaxOpcount})`,
                );
            }
        };

        const cleanupFrames = (): void => {
            this.returnLocalArraysToPool(localInts, localStrings);
            while (this.callStackDepth > 0) {
                const frame = this.callStack[--this.callStackDepth];
                this.returnLocalArraysToPool(frame.localInts, frame.localStrings);
            }
            this.currentLocalStrings = prevLocalStrings;
        };

        while (true) {
            if (this.executionState !== ExecutionState.RUNNING) {
                if (this.executionState === ExecutionState.FINISHED && restoreCallerFrame()) {
                    continue;
                }
                break;
            }

            if (pc < 0 || pc >= instructions.length) {
                const error = this.createError(
                    `Program counter out of bounds (${pc})`,
                    currentScript,
                    pc,
                    -1,
                );
                this.logError(error);
                this.executionState = ExecutionState.ABORTED;
                break;
            }

            this.currentPc = pc;

            this.opcount++;
            if (this.opcount > this.currentMaxOpcount) {
                const error = this.createError(
                    `Script exceeded maximum opcount (${this.currentMaxOpcount})`,
                    currentScript,
                    pc,
                    instructions[pc],
                );
                this.logError(error);
                this.executionState = ExecutionState.ABORTED;
                break;
            }

            const opcode = instructions[pc];
            const intOp = intOperands[pc];
            const stringOp = stringOperands[pc];

            try {
                // Handle special opcodes that need locals/switches/call stack directly
                switch (opcode) {
                    case Opcodes.ILOAD:
                        this.intStack[this.intStackSize++] = localInts[intOp];
                        break;

                    case Opcodes.ISTORE:
                        localInts[intOp] = this.intStack[--this.intStackSize];
                        break;

                    case Opcodes.OLOAD:
                        this.stringStack[this.stringStackSize++] = localStrings[intOp];
                        break;

                    case Opcodes.OSTORE:
                        localStrings[intOp] = this.stringStack[--this.stringStackSize];
                        break;

                    case Opcodes.SWITCH: {
                        const key = this.intStack[--this.intStackSize];
                        const table = switches ? switches[intOp] : undefined;
                        if (table && table.has(key)) {
                            pc += table.get(key)!;
                        }
                        break;
                    }

                    case Opcodes.RETURN:
                        this.executionState = ExecutionState.FINISHED;
                        break;

                    case Opcodes.INVOKE: {
                        // Script ID is in the operand, not on stack
                        const scriptId = intOp;
                        const subScript = this.context.loadScript(scriptId);

                        if (!subScript) {
                            throw new Error("RuntimeException");
                        }

                        if (this.callStackDepth >= Cs2Vm.MAX_CALL_DEPTH) {
                            throw new Error("RuntimeException");
                        }

                        const subFrame = allocateFrameLocals(subScript);
                        for (let i = subScript.intArgCount - 1; i >= 0; i--) {
                            subFrame.localInts[i] = this.intStack[--this.intStackSize];
                        }
                        for (let i = subScript.objArgCount - 1; i >= 0; i--) {
                            subFrame.localStrings[i] = this.stringStack[--this.stringStackSize];
                        }

                        if (this.callStackDepth >= this.callStack.length) {
                            this.callStack.push({
                                script: currentScript,
                                pc,
                                localInts,
                                localStrings,
                            });
                        } else {
                            this.callStack[this.callStackDepth] = {
                                script: currentScript,
                                pc,
                                localInts,
                                localStrings,
                            };
                        }
                        this.callStackDepth++;

                        currentScript = subScript;
                        localInts = subFrame.localInts;
                        localStrings = subFrame.localStrings;
                        instructions = currentScript.instructions;
                        intOperands = currentScript.intOperands;
                        stringOperands = currentScript.stringOperands;
                        switches = currentScript.switches;
                        pc = 0;
                        this.currentScriptId = currentScript.id;
                        this.currentLocalStrings = localStrings;
                        this.traceScriptEnter(currentScript);
                        continue;
                    }

                    default: {
                        // PERF: Hybrid dispatch - fast array for low opcodes, Map for high opcodes
                        const handler =
                            opcode < Cs2Vm.HANDLER_ARRAY_SIZE
                                ? this.handlerArray[opcode]
                                : this.handlers.get(opcode);
                        if (!handler) {
                            const error = this.createError(
                                `Unknown opcode ${opcode}`,
                                currentScript,
                                pc,
                                opcode,
                            );
                            this.logError(error);
                            this.executionState = ExecutionState.ABORTED;
                            break;
                        }

                        const result = handler(ctx, intOp, stringOp);
                        if (result) {
                            if (result.jump !== undefined) {
                                pc += result.jump;
                            }
                            if (result.return) {
                                this.executionState = ExecutionState.FINISHED;
                            } else if (result.state !== undefined) {
                                this.executionState = result.state;
                            }
                        }
                        break;
                    }
                }
            } catch (err) {
                const error = this.createError(
                    err instanceof Error ? err.message : String(err),
                    currentScript,
                    pc,
                    opcode,
                );
                this.logError(error);
                this.executionState = ExecutionState.ABORTED;
                break;
            }

            if (this.executionState === ExecutionState.FINISHED && restoreCallerFrame()) {
                continue;
            }
            if (this.executionState !== ExecutionState.RUNNING) {
                break;
            }

            pc++;
        }

        if (this.executionState === ExecutionState.FINISHED) {
            finalizeSuccessfulTopLevel();
        }
        cleanupFrames();
    }

    /** Public execute method for backward compatibility */
    execute(script: Script, intArgs?: number[], objectArgs?: any[], maxOpcount?: number): void {
        // If this is a nested call, use the internal method which preserves state
        if (this.executionState === ExecutionState.RUNNING) {
            this.executeInternal(script, intArgs, objectArgs);
        } else {
            // Top-level call - reset and run
            this.run(script, intArgs, objectArgs, maxOpcount ?? Cs2Vm.MAX_OPCOUNT);
        }
    }

    /**
     * Parse trigger arguments from the stack
     *
     * OSRS trigger hook stack layout (pushed in this order, so bottom-to-top):
     * - int stack: [scriptId, intArg1, intArg2, ...]
     * - string stack: [stringArg1, ..., signature]
     *
     * For transmit triggers (onInvTransmit, onStatTransmit, onVarTransmit, etc.):
     * - signature ends with 'Y' to indicate transmit triggers follow
     * - after 'Y': [triggerCount, trigger1, trigger2, ...] on int stack
     *
     * The signature string describes the argument types (e.g., "ii" = 2 ints, "si" = string then int)
     * Arguments are popped in reverse order (top first), then scriptId is popped.
     *
     * NOTE: For IF_SETON* opcodes, the widget UID is pushed BEFORE this trigger data,
     * so it remains on the stack after parseTriggerArgs completes.
     */
    private parseTriggerArgs(): {
        /** Parsed handler (null when clearing via scriptId=-1) */
        handler: WidgetEventHandler | null;
        /** OSRS-style Object[] args array (null when clearing via scriptId=-1) */
        argsArray: any[] | null;
        /** Optional transmit triggers (for onVar/onInv/onStat transmit) */
        transmitTriggers: number[] | null;
        /** True if this listener is explicitly being cleared */
        isClear: boolean;
    } {
        if (this.stringStackSize === 0) {
            throw new Error("RuntimeException");
        }

        const rawSignature = this.stringStack[--this.stringStackSize];
        if (typeof rawSignature !== "string") {
            throw new Error("RuntimeException");
        }
        let signature = rawSignature;

        // Check for 'Y' suffix indicating transmit triggers
        let transmitTriggers: number[] | null = null;
        if (signature && signature.length > 0 && signature.charAt(signature.length - 1) === "Y") {
            // Pop the count of triggers
            const triggerCount = this.intStack[--this.intStackSize];
            if (triggerCount > 0) {
                transmitTriggers = new Array<number>(triggerCount);
                for (let i = triggerCount - 1; i >= 0; i--) {
                    transmitTriggers[i] = this.intStack[--this.intStackSize];
                }
            }
            // Strip 'Y' from signature before parsing regular args
            signature = signature.substring(0, signature.length - 1);
        }

        const intArgs: number[] = [];
        const objectArgs: any[] = [];

        // Build OSRS-style args array (scriptId at index 0, then args in signature order).
        // Arguments are popped in reverse order (right-to-left) to match stack layout.
        const argsArray: any[] = new Array(signature.length + 1);
        if (signature) {
            for (let i = argsArray.length - 1; i >= 1; i--) {
                const c = signature.charAt(i - 1);
                if (c === "s" || c === "W" || c === "X") {
                    const v = this.stringStack[--this.stringStackSize];
                    argsArray[i] = v;
                    objectArgs.unshift(v);
                } else {
                    const v = this.intStack[--this.intStackSize];
                    argsArray[i] = v;
                    intArgs.unshift(v);
                }
            }
        }

        // Pop script ID (it was pushed before args)
        const scriptId = this.intStack[--this.intStackSize];

        // OSRS parity: scriptId == -1 means "clear listener" (store null).
        if (scriptId === -1) {
            return { handler: null, argsArray: null, transmitTriggers, isClear: true };
        }

        // Store scriptId at [0] like OSRS does.
        argsArray[0] = scriptId;
        return {
            handler: { scriptId, intArgs, objectArgs },
            argsArray,
            transmitTriggers,
            isClear: false,
        };
    }

    /**
     * Parse Object[] trigger args for IF_TRIGGEROPLOCAL (2929).
     * Matches class189.method4727: signature-driven args only, no scriptId and no 'Y' suffix handling.
     */
    private parseTriggerOpLocalArgs(): any[] {
        if (this.stringStackSize <= 0) {
            throw new Error("RuntimeException");
        }
        const rawSignature = this.stringStack[--this.stringStackSize];
        if (typeof rawSignature !== "string") {
            throw new Error("RuntimeException");
        }

        let intCount = 0;
        let objectCount = 0;
        for (let i = 0; i < rawSignature.length; i++) {
            if (rawSignature.charAt(i) === "i") {
                intCount++;
            } else {
                objectCount++;
            }
        }
        if (this.intStackSize < intCount || this.stringStackSize < objectCount) {
            throw new Error("RuntimeException");
        }

        const args = new Array(rawSignature.length);
        for (let i = rawSignature.length - 1; i >= 0; i--) {
            if (rawSignature.charAt(i) === "i") {
                args[i] = this.intStack[--this.intStackSize];
            } else {
                args[i] = this.stringStack[--this.stringStackSize];
            }
        }
        return args;
    }

    /**
     * Set event handler on the active widget (CC_SETON* opcodes)
     */
    setEventHandler(widget: WidgetNode | null, eventType: WidgetEventType): void {
        if (!widget) {
            throw new Error("RuntimeException");
        }
        const parsed = this.parseTriggerArgs();

        const { handler, argsArray, transmitTriggers, isClear } = parsed;

        // Initialize event handlers map if needed
        if (!widget.eventHandlers) {
            widget.eventHandlers = {};
        }

        // OSRS parity: setting/clearing any listener marks the widget as having listeners
        widget.hasListener = true;

        if (isClear) {
            delete widget.eventHandlers[eventType];
            // Shadow any cache-loaded listener of the same type (OSRS overwrites the field).
            (widget as any)[eventType] = null;
        } else if (handler) {
            // Store the handler
            widget.eventHandlers[eventType] = handler;
            // Keep legacy Object[] field in sync for parity/debugging
            (widget as any)[eventType] = argsArray;
        }

        // Store transmit triggers on widget based on event type
        // OSRS stores these as Widget.invTransmitTriggers, Widget.statTransmitTriggers, Widget.varTransmitTriggers
        if (eventType === "onInvTransmit") {
            (widget as any).invTransmitTriggers = transmitTriggers ?? undefined;
        } else if (eventType === "onStatTransmit") {
            (widget as any).statTransmitTriggers = transmitTriggers ?? undefined;
        } else if (eventType === "onVarTransmit") {
            (widget as any).varTransmitTriggers = transmitTriggers ?? undefined;
        }
        markWidgetInteractionDirty(widget);
    }

    /**
     * Set event handler by widget UID (IF_SETON* opcodes)
     *
     * OSRS stack layout for IF_SETON* trigger hooks (bottom to top):
     * - int stack: [scriptId, intArgs..., widgetUid]  <- UID is at TOP
     * - string stack: [stringArgs..., signature]
     *
     * The widget UID is pushed LAST (so it's at the top), then the signature.
     * We pop: UID first, then signature, then args (reverse order), then scriptId.
     */
    setEventHandlerByUid(eventType: WidgetEventType): void {
        // Pop widget UID FIRST (it's at the top of the int stack in OSRS)
        const uid = this.intStack[--this.intStackSize];

        // Parse trigger args (pops signature, args, scriptId, and transmit triggers if 'Y' suffix)
        const parsed = this.parseTriggerArgs();

        // OSRS parity (WidgetDefinition.method8293): UID lookup attempts group load first.
        const groupId = (uid >>> 16) & 0xffff;
        this.context.widgetManager.getGroup(groupId);
        const widget = this.context.widgetManager.getWidgetByUid(uid);
        if (!widget) {
            throw new Error("RuntimeException");
        }

        const { handler, argsArray, transmitTriggers, isClear } = parsed;

        // Initialize event handlers map if needed
        if (!widget.eventHandlers) {
            widget.eventHandlers = {};
        }

        widget.hasListener = true;

        if (isClear) {
            delete widget.eventHandlers[eventType];
            (widget as any)[eventType] = null;
        } else if (handler) {
            // Store the handler
            widget.eventHandlers[eventType] = handler;
            (widget as any)[eventType] = argsArray;
        }

        // Store transmit triggers on widget based on event type
        // OSRS stores these as Widget.invTransmitTriggers, Widget.statTransmitTriggers, Widget.varTransmitTriggers
        if (eventType === "onInvTransmit") {
            (widget as any).invTransmitTriggers = transmitTriggers ?? undefined;
        } else if (eventType === "onStatTransmit") {
            (widget as any).statTransmitTriggers = transmitTriggers ?? undefined;
        } else if (eventType === "onVarTransmit") {
            (widget as any).varTransmitTriggers = transmitTriggers ?? undefined;
        }
        markWidgetInteractionDirty(widget);
    }

    /**
     * Substitute magic number placeholders in script args with actual event values
     * This is how OSRS passes dynamic values like mouse coordinates to scripts
     */
    private substituteMagicArgs(
        intArgs: number[],
        objectArgs: any[],
        event: ScriptEvent,
    ): { intArgs: number[]; objectArgs: any[] } {
        // PERF: Check if any substitution is needed before creating new arrays
        // Magic numbers are all negative (Integer.MIN_VALUE + offset)
        let needsIntSubstitution = false;
        for (let i = 0; i < intArgs.length; i++) {
            if (intArgs[i] < -2147483630) {
                // All magic values are below this threshold
                needsIntSubstitution = true;
                break;
            }
        }

        let needsStringSubstitution = false;
        for (let i = 0; i < objectArgs.length; i++) {
            if (objectArgs[i] === EVENT_OPBASE) {
                needsStringSubstitution = true;
                break;
            }
        }

        // Fast path: no substitution needed, return original arrays
        if (!needsIntSubstitution && !needsStringSubstitution) {
            return { intArgs, objectArgs };
        }

        // Slow path: perform substitution
        const substitutedInts = needsIntSubstitution ? new Array<number>(intArgs.length) : intArgs;
        if (needsIntSubstitution) {
            for (let i = 0; i < intArgs.length; i++) {
                const value = intArgs[i];
                switch (value) {
                    case ScriptArgMagic.MOUSE_X:
                        substitutedInts[i] = event.mouseX;
                        break;
                    case ScriptArgMagic.MOUSE_Y:
                        substitutedInts[i] = event.mouseY;
                        break;
                    case ScriptArgMagic.WIDGET_ID: {
                        // PARITY: event_com returns the UID of the widget the event handler is on.
                        // For static widgets (defined in cache), this is their own UID.
                        // For dynamic children (created via CC_CREATE), return the PARENT's UID.
                        // The script uses cc_find(parentUid, childIndex) to access the child.
                        const w = event.widget;
                        // Dynamic children have fileId === -1 and parentUid set
                        if (w?.fileId === -1 && (w as any).parentUid != null) {
                            substitutedInts[i] = (w as any).parentUid;
                        } else {
                            substitutedInts[i] = w?.uid ?? -1;
                        }
                        break;
                    }
                    case ScriptArgMagic.OP_INDEX:
                        substitutedInts[i] = event.opIndex;
                        break;
                    case ScriptArgMagic.WIDGET_CHILD_INDEX:
                        substitutedInts[i] = event.widget?.childIndex ?? -1;
                        break;
                    case ScriptArgMagic.DRAG_TARGET_ID:
                        substitutedInts[i] = event.dragTarget?.uid ?? -1;
                        break;
                    case ScriptArgMagic.DRAG_TARGET_CHILD_INDEX:
                        substitutedInts[i] = event.dragTarget?.childIndex ?? -1;
                        break;
                    case ScriptArgMagic.KEY_TYPED:
                        // OSRS internal key code (e.g., 84 for Enter, 85 for Backspace)
                        substitutedInts[i] = event.keyTyped;
                        break;
                    case ScriptArgMagic.KEY_PRESSED:
                        // Character code for text input (ASCII value)
                        substitutedInts[i] = event.keyPressed;
                        break;
                    case ScriptArgMagic.OP_SUBINDEX:
                        substitutedInts[i] = event.field526;
                        break;
                    default:
                        substitutedInts[i] = value;
                        break;
                }
            }
        }

        const substitutedObjects = needsStringSubstitution
            ? new Array<any>(objectArgs.length)
            : objectArgs;
        if (needsStringSubstitution) {
            for (let i = 0; i < objectArgs.length; i++) {
                const value = objectArgs[i];
                substitutedObjects[i] =
                    typeof value === "string" && value === EVENT_OPBASE ? event.targetName : value;
            }
        }

        return { intArgs: substitutedInts, objectArgs: substitutedObjects };
    }

    /**
     * Invoke an event handler on a widget
     * @param widget The widget with the handler
     * @param eventType The event type to invoke
     * @param event Optional ScriptEvent with full event context for magic number substitution
     */
    invokeEventHandler(
        widget: WidgetNode,
        eventType: WidgetEventType,
        event?: Partial<ScriptEvent>,
    ): boolean {
        const handler = widget?.eventHandlers?.[eventType] as WidgetEventHandler | undefined;

        // Also check for cache-loaded raw listener array (e.g., widget.onResize, widget.onLoad)
        // Format: [scriptId, ...args] where scriptId is first element
        const rawListener = (widget as any)?.[eventType] as any[] | undefined;

        // If no runtime handler, try to use the cache-loaded listener
        if (!handler || handler.scriptId <= 0) {
            if (Array.isArray(rawListener) && rawListener.length > 0) {
                // Use the cache-loaded listener array
                const rawScriptId = rawListener[0];
                if (typeof rawScriptId !== "number" || rawScriptId <= 0) {
                    return false;
                }

                const script = this.context.loadScript(rawScriptId);
                if (!script) {
                    return false;
                }

                // Create full event context with defaults
                const fullEvent = createScriptEvent({
                    widget,
                    ...event,
                });

                // Parse args from raw listener (after script ID)
                const intArgs: number[] = [];
                const objectArgs: any[] = [];
                for (let i = 1; i < rawListener.length; i++) {
                    const arg = rawListener[i];
                    if (typeof arg === "number") {
                        intArgs.push(arg);
                    } else {
                        objectArgs.push(arg);
                    }
                }

                // Substitute magic numbers with actual event values
                const substituted = this.substituteMagicArgs(intArgs, objectArgs, fullEvent);

                // Set active widget and dot widget for the script
                const prevActiveWidget = this.activeWidget;
                const prevDotWidget = this.dotWidget;
                this.activeWidget = widget;
                this.dotWidget = widget;
                const prevMouseX = this.eventContext.mouseX;
                const prevMouseY = this.eventContext.mouseY;
                const prevOpIndex = this.eventContext.opIndex;
                const prevDragTarget = this.eventContext.dragTarget;
                const prevKeyTyped = this.eventContext.keyTyped;
                const prevKeyPressed = this.eventContext.keyPressed;
                const prevTargetName = this.eventContext.targetName;
                const prevComponentId = this.eventContext.componentId;
                const prevComponentIndex = this.eventContext.componentIndex;
                const prevField526 = this.eventContext.field526;
                this.applyEventContextFromScriptEvent(fullEvent);
                // BUGFIX: Save execution state before nested call - nested script completion
                // sets executionState=FINISHED which would prematurely terminate outer script
                const wasRunning = this.executionState === ExecutionState.RUNNING;
                try {
                    this.execute(
                        script,
                        substituted.intArgs,
                        substituted.objectArgs,
                        eventType === "onLoad" ? Cs2Vm.ONLOAD_MAX_OPCOUNT : undefined,
                    );
                    return true;
                } finally {
                    this.activeWidget = prevActiveWidget;
                    this.dotWidget = prevDotWidget;
                    this.eventContext.mouseX = prevMouseX;
                    this.eventContext.mouseY = prevMouseY;
                    this.eventContext.opIndex = prevOpIndex;
                    this.eventContext.dragTarget = prevDragTarget;
                    this.eventContext.keyTyped = prevKeyTyped;
                    this.eventContext.keyPressed = prevKeyPressed;
                    this.eventContext.targetName = prevTargetName;
                    this.eventContext.componentId = prevComponentId;
                    this.eventContext.componentIndex = prevComponentIndex;
                    this.eventContext.field526 = prevField526;
                    // Restore RUNNING state if nested script finished normally
                    // (ABORTED state must propagate to abort the outer script too)
                    if (wasRunning && this.executionState === ExecutionState.FINISHED) {
                        this.executionState = ExecutionState.RUNNING;
                    }
                }
            }
            return false;
        }

        // Create full event context with defaults
        const fullEvent = createScriptEvent({
            widget,
            ...event,
        });

        const scriptId = handler.scriptId;
        const intArgs = handler.intArgs;

        const script = this.context.loadScript(scriptId);
        if (!script) {
            // Don't spam warnings for missing scripts
            return false;
        }

        // Substitute magic numbers with actual event values
        const handlerObjectArgs = handler.objectArgs ?? handler.stringArgs ?? [];
        const substituted = this.substituteMagicArgs(intArgs, handlerObjectArgs, fullEvent);

        // Set active widget and dot widget for the script
        const prevActiveWidget = this.activeWidget;
        const prevDotWidget = this.dotWidget;
        this.activeWidget = widget;
        this.dotWidget = widget;
        const prevMouseX = this.eventContext.mouseX;
        const prevMouseY = this.eventContext.mouseY;
        const prevOpIndex = this.eventContext.opIndex;
        const prevDragTarget = this.eventContext.dragTarget;
        const prevKeyTyped = this.eventContext.keyTyped;
        const prevKeyPressed = this.eventContext.keyPressed;
        const prevTargetName = this.eventContext.targetName;
        const prevComponentId = this.eventContext.componentId;
        const prevComponentIndex = this.eventContext.componentIndex;
        const prevField526 = this.eventContext.field526;
        this.applyEventContextFromScriptEvent(fullEvent);
        // BUGFIX: Save execution state before nested call - nested script completion
        // sets executionState=FINISHED which would prematurely terminate outer script
        const wasRunning = this.executionState === ExecutionState.RUNNING;
        try {
            // Use execute() instead of run() to handle nested events safely.
            // execute() checks if already running and uses executeInternal without reset.
            this.execute(
                script,
                substituted.intArgs,
                substituted.objectArgs,
                eventType === "onLoad" ? Cs2Vm.ONLOAD_MAX_OPCOUNT : undefined,
            );
            return true;
        } catch (err) {
            console.error(`[Cs2Vm] Event handler script ${handler.scriptId} crashed:`, err);
            return false;
        } finally {
            this.activeWidget = prevActiveWidget;
            this.dotWidget = prevDotWidget;
            this.eventContext.mouseX = prevMouseX;
            this.eventContext.mouseY = prevMouseY;
            this.eventContext.opIndex = prevOpIndex;
            this.eventContext.dragTarget = prevDragTarget;
            this.eventContext.keyTyped = prevKeyTyped;
            this.eventContext.keyPressed = prevKeyPressed;
            this.eventContext.targetName = prevTargetName;
            this.eventContext.componentId = prevComponentId;
            this.eventContext.componentIndex = prevComponentIndex;
            this.eventContext.field526 = prevField526;
            // Restore RUNNING state if nested script finished normally
            // (ABORTED state must propagate to abort the outer script too)
            if (wasRunning && this.executionState === ExecutionState.FINISHED) {
                this.executionState = ExecutionState.RUNNING;
            }
        }
    }

    /**
     * Run a script event from an array-style handler (legacy format from cache)
     * The args array has scriptId at [0] followed by int/string args
     */
    runScriptEvent(event: ScriptEvent): boolean {
        if (!event.args || event.args.length === 0) {
            return false;
        }

        const scriptId = event.args[0];
        if (typeof scriptId !== "number" || scriptId <= 0) {
            return false;
        }

        const script = this.context.loadScript(scriptId);
        if (!script) {
            return false;
        }

        // Separate int/object args from the args array (starting at index 1)
        const intArgs: number[] = [];
        const objectArgs: any[] = [];
        for (let i = 1; i < event.args.length; i++) {
            const arg = event.args[i];
            if (typeof arg === "number") {
                intArgs.push(arg);
            } else {
                objectArgs.push(arg);
            }
        }

        // Substitute magic numbers with actual event values
        const substituted = this.substituteMagicArgs(intArgs, objectArgs, event);

        // Set active widget and dot widget for the script
        // OSRS PARITY: Save previous widgets and restore after the event handler finishes
        // This prevents varTransmit handlers from polluting widget context for subsequent scripts
        const prevActiveWidget = this.activeWidget;
        const prevDotWidget = this.dotWidget;
        this.activeWidget = event.widget;
        this.dotWidget = event.widget;
        const prevMouseX = this.eventContext.mouseX;
        const prevMouseY = this.eventContext.mouseY;
        const prevOpIndex = this.eventContext.opIndex;
        const prevDragTarget = this.eventContext.dragTarget;
        const prevKeyTyped = this.eventContext.keyTyped;
        const prevKeyPressed = this.eventContext.keyPressed;
        const prevTargetName = this.eventContext.targetName;
        const prevComponentId = this.eventContext.componentId;
        const prevComponentIndex = this.eventContext.componentIndex;
        const prevField526 = this.eventContext.field526;
        this.applyEventContextFromScriptEvent(event);

        try {
            this.run(script, substituted.intArgs, substituted.objectArgs, Cs2Vm.MAX_OPCOUNT);
            return true;
        } catch (err) {
            console.error(`[Cs2Vm] Script ${scriptId} crashed:`, err);
            return false;
        } finally {
            // OSRS PARITY: Restore previous widget context after event handler completes
            this.activeWidget = prevActiveWidget;
            this.dotWidget = prevDotWidget;
            this.eventContext.mouseX = prevMouseX;
            this.eventContext.mouseY = prevMouseY;
            this.eventContext.opIndex = prevOpIndex;
            this.eventContext.dragTarget = prevDragTarget;
            this.eventContext.keyTyped = prevKeyTyped;
            this.eventContext.keyPressed = prevKeyPressed;
            this.eventContext.targetName = prevTargetName;
            this.eventContext.componentId = prevComponentId;
            this.eventContext.componentIndex = prevComponentIndex;
            this.eventContext.field526 = prevField526;
        }
    }

    /**
     * Check if a widget has a specific event handler
     */
    hasEventHandler(widget: WidgetNode, eventType: WidgetEventType): boolean {
        const handler = widget?.eventHandlers?.[eventType] as WidgetEventHandler | undefined;
        return !!handler && handler.scriptId > 0;
    }
}

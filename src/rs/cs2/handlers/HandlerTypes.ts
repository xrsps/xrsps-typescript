import type { WidgetManager } from "../../../ui/widgets/WidgetManager";
import type {
    WidgetEventHandler,
    WidgetEventType,
    WidgetNode,
} from "../../../ui/widgets/WidgetNode";
import type { TypeLoader } from "../../config/TypeLoader";
import type { DbRepository } from "../../config/db/DbRepository";
import type { EnumType } from "../../config/enumtype/EnumType";
import type { LocType } from "../../config/loctype/LocType";
import type { NpcType } from "../../config/npctype/NpcType";
import type { ObjTypeLoader } from "../../config/objtype/ObjTypeLoader";
import type { ParamTypeLoader } from "../../config/paramtype/ParamTypeLoader";
import type { StructType } from "../../config/structtype/StructType";
import type { VarManager } from "../../config/vartype/VarManager";
import type { Inventory } from "../../inventory/Inventory";
import type { Script } from "../Script";

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

/** Clan member entry (legacy Friends Chat / Clan Chat) */
export interface ClanMember {
    name: string;
    world: number;
    rank: number;
}

/**
 * Clan Settings data structure (modern Clan system)
 * Contains persistent clan configuration and member list.
 * Accessed via ACTIVECLANSETTINGS_* opcodes.
 *
 * OSRS Architecture: ClanSettings stores its own parameters in an
 * IterableNodeHashTable, accessed via GET_VARCLANSETTING (opcode 74).
 */
export interface ClanSettings {
    /** Clan name */
    name: string;
    /** Allow unaffined (guest) users */
    allowGuests: boolean;
    /** Minimum rank required to talk */
    rankTalk: number;
    /** Minimum rank required to kick */
    rankKick: number;
    /** Minimum rank required to lootshare (unused in OSRS) */
    rankLootshare: number;
    /** Coinshare enabled */
    coinshare: boolean;
    /** Index of the current owner in members array */
    currentOwnerSlot: number;
    /** Index of the replacement owner in members array */
    replacementOwnerSlot: number;
    /** Affined (registered) member names */
    memberNames: string[];
    /** Affined member hashes (64-bit name hashes) - optional for hash-based lookups */
    memberHashes?: bigint[];
    /** Affined member ranks (0-127, see ClanRank) */
    memberRanks: number[];
    /** Affined member extra info flags */
    memberExtraInfo: number[];
    /** Affined member join runeday (days since epoch) */
    memberJoinDays: number[];
    /** Affined member muted status */
    memberMuted: boolean[];
    /** Banned member names */
    bannedNames: string[];
    /** Banned member hashes - optional for hash-based lookups */
    bannedHashes?: bigint[];
    /**
     * Clan settings parameters (VARCLANSETTING values).
     * In OSRS, this is an IterableNodeHashTable accessed via getTitleGroupValue().
     * Accessed by GET_VARCLANSETTING (opcode 74).
     * Returns undefined/-1 if key doesn't exist.
     */
    parameters?: Map<number, number>;
}

/**
 * Clan Channel data structure (modern Clan system)
 * Contains active clan channel state and online users.
 * Accessed via ACTIVECLANCHANNEL_* opcodes.
 *
 * OSRS Architecture: GET_VARCLAN (opcode 76) reads from a separate
 * "clan profile" object (class470/class505), not directly from ClanChannel.
 * We store these values in parameters for simplicity.
 */
export interface ClanChannel {
    /** Clan name (may differ from settings if guest clan) */
    name: string;
    /** Minimum rank required to talk */
    rankTalk: number;
    /** Minimum rank required to kick */
    rankKick: number;
    /** Online user display names */
    userNames: string[];
    /** Online user hashes (64-bit) - optional for hash-based lookups */
    userHashes?: bigint[];
    /** Online user ranks */
    userRanks: number[];
    /** Online user worlds */
    userWorlds: number[];
    /** Sorted indices for alphabetical display */
    sortedUserSlots?: number[];
    /**
     * Clan channel/profile parameters (VARCLAN values).
     * In OSRS, this is stored in a separate clan profile object (class470).
     * Accessed by GET_VARCLAN (opcode 76).
     * Returns undefined/-1 if key doesn't exist.
     */
    parameters?: Map<number, number>;
}

/** Event context - stores values for magic argument substitution */
export interface EventContext {
    mouseX: number;
    mouseY: number;
    opIndex: number;
    opSubIndex: number;
    dragTarget: WidgetNode | null;
    keyTyped: number;
    keyPressed: number;
    targetName: string;
    componentId: number;
    componentIndex: number;
}

// Re-export types for convenience
export { WidgetEventHandler, WidgetEventType };

/** Execution state of the VM */
export enum ExecutionState {
    RUNNING = 0,
    FINISHED = 1,
    SUSPENDED = 2,
    PAUSEBUTTON = 3, // Waiting for dialog button
    COUNTDIALOG = 4, // Waiting for count input
    STRINGDIALOG = 5, // Waiting for string input
    ABORTED = 6,
}

/** Result from a handler - controls VM execution flow */
export interface HandlerResult {
    /** If defined, jump PC by this offset */
    jump?: number;
    /** If true, handler signaled RETURN */
    return?: boolean;
    /** If set, change execution state */
    state?: ExecutionState;
}

/** Forward declaration for Cs2Vm to avoid circular imports */
export interface Cs2VmLike {
    inputDialogType: number;
    inputDialogWidgetId: number;
    inputDialogString: string;
    onInputDialogComplete?: (type: "count" | "name" | "string", value: string | number) => void;
    activeWidget: any | null;
    dotWidget: any | null;
    /** Clear handler caches to prevent memory leaks when interfaces change */
    clearHandlerCaches(): void;
}

/** Context passed to all handlers - gives access to VM state */
export interface HandlerContext {
    // Reference to the Cs2Vm instance
    cs2Vm: Cs2VmLike;

    // Stacks
    intStack: Int32Array;
    stringStack: any[];
    intStackSize: number;
    stringStackSize: number;

    // Stack operations
    pushInt(value: number): void;
    popInt(): number;
    peekInt(): number;
    pushString(value: any): void;
    popString(): any;

    // Active widget (used by regular cc_* ops when intOp=0)
    activeWidget: WidgetNode | null;
    setActiveWidget(w: WidgetNode | null): void;

    // Dot widget (used by .cc_* ops when intOp=1)
    dotWidget: WidgetNode | null;
    setDotWidget(w: WidgetNode | null): void;

    // External context
    widgetManager: WidgetManager;
    varManager: VarManager;
    loadScript: (id: number) => Script | null;
    objTypeLoader?: ObjTypeLoader;
    paramTypeLoader?: ParamTypeLoader;
    enumTypeLoader?: TypeLoader<EnumType>;
    structTypeLoader?: TypeLoader<StructType>;
    npcTypeLoader?: TypeLoader<NpcType>;
    locTypeLoader?: TypeLoader<LocType>;
    dbRepository?: DbRepository;
    openMobileTab?: (tab: number) => void;

    // Inventory system - supports multiple inventory types
    inventories: Map<number, Inventory>;
    getInventory(invId: number): Inventory | null;

    // Friend/Ignore/Clan lists (legacy Friends Chat / Clan Chat)
    friendList: FriendEntry[];
    ignoreList: IgnoreEntry[];
    clanMembers: ClanMember[];
    clanName: string;
    clanOwner: string;
    clanRank: number;

    // Modern Clan system (ACTIVECLANSETTINGS_* / ACTIVECLANCHANNEL_* opcodes)
    // Optional - if not provided, clan ops return default values (empty/0/-1)
    clanSettings?: ClanSettings | null;
    clanChannel?: ClanChannel | null;

    // Event context (for magic argument substitution)
    eventContext: EventContext;

    // Stats/skills
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

    // Player weight in kg (can be negative)
    getWeight?: () => number;

    // Player position
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
    windowMode?: number;
    setWindowMode?: (mode: number) => void;

    // DB Query state
    dbRowQuery: number[];
    dbRowIndex: number;
    dbTableId: number;
    setDbRowQuery(rows: number[]): void;
    setDbRowIndex(index: number): void;
    setDbTableId(tableId: number): void;

    // Item search state (for OC_FIND/FINDNEXT/FINDRESET)
    itemSearchResults: number[];
    itemSearchIndex: number;

    // Widget children iteration state (for IF/CC_CHILDREN_FIND/FINDNEXTID)
    childrenIterWidget: WidgetNode | null;
    childrenIterIndices: number[];
    childrenIterIndex: number;

    // Script invocation (for INVOKE opcode)
    invokeScript(scriptId: number): void;

    // Event handler invocation
    invokeEventHandler(
        widget: WidgetNode,
        eventType: WidgetEventType,
        event?: { ints?: number[]; strings?: string[]; opIndex?: number; opSubIndex?: number },
    ): boolean;

    // Event handler setting
    setEventHandler(widget: WidgetNode | null, eventType: WidgetEventType): void;
    setEventHandlerByUid(eventType: WidgetEventType): void;

    // Deferred widget actions (flushed on top-level return)
    queueResize(widget: WidgetNode): void;
    queueTriggerOp(widget: WidgetNode, opIndex: number): void;
    deferIfClose(): void;

    // IF_TRIGGEROPLOCAL (2929) forwarding
    forwardIfTriggerOpLocal(): void;

    // Drag operations
    setDragSource(widget: WidgetNode): void;

    // Text measurement
    getTextWidth(text: string, fontId: number): number;
    getTextHeight(fontId: number): number;
    splitTextLines(text: string, fontId: number, maxWidth: number): string[];

    // Current script ID (for debugging)
    currentScriptId?: number;

    // Current PC (for debugging)
    currentPc?: number;

    // Local player name (from server handshake)
    localPlayerName?: string;
    /**
     * Optional override for CHAT_PLAYERNAME (opcode 5015) so callers can resolve
     * a script-contextual chat display name without affecting other systems that
     * rely on the raw localPlayerName.
     */
    resolveChatPlayerName?: (scriptId: number) => string | undefined;

    // Chat filter state (stored locally, synced with server)
    publicChatMode: number;
    privateChatMode: number;
    tradeChatMode: number;
    messageFilter: string;
    setChatFilter?: (publicMode: number, privateMode: number, tradeMode: number) => void;

    // Console output (for WRITECONSOLE opcode)
    writeConsole?: (text: string) => void;

    // Audio playback (for SOUND_SONG, SOUND_JINGLE, SOUND_SYNTH opcodes)
    // SOUND_SONG takes 5 params (trackId, outDelay, outDur, inDelay, inDur)
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
    // MUSIC_STOP (3220): Stop/fade current music (outDelay, outDur)
    stopMusic?: (fadeOutDelay: number, fadeOutDuration: number) => void;
    // MUSIC_DUAL (3221): Preload two tracks for crossfade (outDelay, outDur, inDelay, inDur)
    playDualTracks?: (
        track1: number,
        track2: number,
        fadeOutDelay: number,
        fadeOutDuration: number,
        fadeInDelay: number,
        fadeInDuration: number,
    ) => void;
    // MUSIC_CROSSFADE (3222): Crossfade between the two loaded tracks (outDelay, outDur, inDelay, inDur)
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

    // Game/Device options (for gameoption_set/get, deviceoption_set/get opcodes)
    // These control engine-level settings like volume, brightness, etc.
    setGameOption?: (optionId: number, value: number) => void;
    getGameOption?: (optionId: number) => number;
    setDeviceOption?: (optionId: number, value: number) => void;
    getDeviceOption?: (optionId: number) => number;
    setClientOption?: (optionId: number, value: number) => void;
    getClientOption?: (optionId: number) => number;

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

    // Input manager for keyboard state queries (KEYHELD, KEYPRESSED)
    inputManager?: {
        isKeyHeld?: (keyCode: number) => boolean;
        wasKeyPressed?: (keyCode: number) => boolean;
    };

    // Callback when a sub-interface is opened (for triggering initial onVarTransmit)
    onSubInterfaceOpened?: (groupId: number) => void;

    // Callback for cc_resume_pausebutton / if_resume_pausebutton - sends RESUME_PAUSEBUTTON packet
    sendResumePauseButton?: (widgetUid: number, childIndex: number) => void;

    /**
     * Callback to display a notification using the authentic OSRS CS2 notification system.
     * Called by NOTIFICATIONS_SENDLOCAL opcode (6800).
     * Invokes script 3343 (notification_display_init) with the title, body, and color.
     * @param title The notification title
     * @param body The notification body text
     * @param color RGB color for the notification (e.g., 0xff981f for orange)
     */
    onNotificationDisplay?: (title: string, body: string, color: number) => void;

    /**
     * PARITY: OSRS Protocol Revision (e.g., 179, 220).
     * Essential for strict opcode behavior (e.g., CC_CREATE argument count).
     * Default to 220 for modern revisions if not specified.
     */
    clientRevision: number;

    /**
     * Local object variables for current script frame.
     * Used by OLOAD/OSTORE and array operations.
     * In modern OSRS, these store full Object[] values (strings, arrays, null).
     */
    getLocalString(index: number): any;
    setLocalString(index: number, value: any): void;
}

/** Handler function signature */
export type OpcodeHandler = (
    ctx: HandlerContext,
    intOp: number,
    stringOp: string | null,
) => HandlerResult | void;

/** Handler registration map */
export type HandlerMap = Map<number, OpcodeHandler>;

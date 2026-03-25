import { parseOutgoingPublicChat, sanitizeChatText } from "../chat/chatFormatting";
import { ClientState } from "../client/ClientState";
import { PlayerSyncContext } from "../client/sync/PlayerSyncContext";
import type { PlayerSyncFrame } from "../client/sync/PlayerSyncTypes";
import { PlayerUpdateDecoder } from "../client/sync/PlayerUpdateDecoder";
import { SkillId } from "../rs/skill/skills";
import type { ProjectileLaunch } from "../shared/projectiles/ProjectileLaunch";
import {
    VARP_AREA_SOUNDS_VOLUME,
    VARP_COMBAT_TARGET_PLAYER_INDEX,
    VARP_FOLLOWER_INDEX,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_VOLUME,
    VARP_OPTION_ATTACK_PRIORITY_NPC,
    VARP_OPTION_ATTACK_PRIORITY_PLAYER,
    VARP_SOUND_EFFECTS_VOLUME,
} from "../shared/vars";
import { type CombatStatePayload, CombatStateStore } from "./combat/CombatStateStore";
import { setPacketSocket } from "./packet";
import { encodeClientMessage } from "./packet/ClientBinaryEncoder";

/* Minimal client-side WebSocket connector to the game server */
// Ensure only one live WebSocket during React Fast Refresh/HMR
const WS_GLOBAL_KEY = "__OSRS_CLIENT_WS_SINGLETON__";
const WS_SUPPRESS_RECONNECT_KEY = "__OSRS_CLIENT_WS_SUPPRESS_RECONNECT__";

const INVENTORY_SLOT_COUNT = 28;
// Bank CS2 scripts index slots up to 1409 (bankmain_build uses 1410 constant).
const BANK_SLOT_COUNT_FALLBACK = 1410;
const CLIENT_TICK_MS = 20;
const RUN_ENERGY_MAX_UNITS = 10000;
const DEFAULT_SERVER_TICK_MS = 600;

export type InventorySlotMessage = { slot: number; itemId: number; quantity: number };
export type InventoryServerUpdate =
    | { kind: "snapshot"; slots: InventorySlotMessage[] }
    | { kind: "slot"; slot: InventorySlotMessage };

/** Collection log inventory update (ID 620 - collection_transmit) */
export type CollectionLogSlotMessage = { slot: number; itemId: number; quantity: number };
export type CollectionLogServerPayload = {
    kind: "snapshot";
    slots: CollectionLogSlotMessage[];
};

export type BankSlotMessage = { slot: number; itemId: number; quantity: number };

export type BankServerUpdate =
    | { kind: "snapshot"; capacity: number; slots: BankSlotMessage[] }
    | { kind: "slot"; slot: BankSlotMessage };

export type NpcInfoPayload = { loopCycle: number; large: boolean; packet: Uint8Array };

export type ShopStockEntryMessage = {
    slot: number;
    itemId: number;
    quantity: number;
    defaultQuantity?: number;
    priceEach?: number;
    sellPrice?: number;
};

export type GroundItemStackMessage = {
    id: number;
    itemId: number;
    quantity: number;
    tile: { x: number; y: number; level: number };
    createdTick?: number;
    privateUntilTick?: number;
    expiresTick?: number;
    ownerId?: number;
    isPrivate?: boolean;
    /** Mirrors RuneLite TileItem ownership constants: 0=none,1=self,2=other,3=group */
    ownership?: 0 | 1 | 2 | 3;
};

export type GroundItemsServerPayload =
    | {
          kind: "snapshot";
          serial: number;
          stacks: GroundItemStackMessage[];
      }
    | {
          kind: "delta";
          serial: number;
          upserts: GroundItemStackMessage[];
          removes: number[];
      };

type GroundItemsSnapshotPayload = Extract<GroundItemsServerPayload, { kind: "snapshot" }>;

export type GroundItemActionPayload = {
    stackId: number;
    tile: { x: number; y: number; level?: number };
    itemId: number;
    quantity?: number;
    option?: string;
};

export type ShopServerPayload =
    | {
          kind: "open";
          shopId: string;
          name: string;
          currencyItemId: number;
          generalStore?: boolean;
          buyMode?: number;
          sellMode?: number;
          stock: ShopStockEntryMessage[];
      }
    | {
          kind: "slot";
          shopId: string;
          slot: ShopStockEntryMessage;
      }
    | {
          kind: "close";
      }
    | {
          kind: "mode";
          shopId: string;
          buyMode?: number;
          sellMode?: number;
      };

export type SmithingOptionMessage = {
    recipeId: string;
    name: string;
    level: number;
    itemId: number;
    outputQuantity: number;
    available: number;
    canMake: boolean;
    xp?: number;
    ingredientsLabel?: string;
    mode?: "smelt" | "forge";
    barItemId?: number;
    barCount?: number;
    requiresHammer?: boolean;
    hasHammer?: boolean;
};

export type SmithingServerPayload =
    | {
          kind: "open" | "update";
          mode: "smelt" | "forge";
          title?: string;
          options: SmithingOptionMessage[];
          quantityMode: number;
          customQuantity?: number;
      }
    | {
          kind: "mode";
          quantityMode: number;
          customQuantity?: number;
      }
    | {
          kind: "close";
      };

export type SmithingWindowState = {
    open: boolean;
    mode: "smelt" | "forge";
    title?: string;
    options: SmithingOptionMessage[];
    quantityMode: number;
    customQuantity?: number;
};

export type ShopWindowState = {
    open: boolean;
    shopId?: string;
    name?: string;
    currencyItemId?: number;
    generalStore?: boolean;
    buyMode: number;
    sellMode: number;
    stock: ShopStockEntryMessage[];
};

export type TradeOfferEntryMessage = {
    slot: number;
    itemId: number;
    quantity: number;
};

export type TradePartyViewState = {
    playerId?: number;
    name?: string;
    offers: TradeOfferEntryMessage[];
    accepted?: boolean;
    confirmAccepted?: boolean;
};

export type TradeWindowState = {
    open: boolean;
    sessionId?: string;
    stage: "offer" | "confirm";
    self?: TradePartyViewState;
    other?: TradePartyViewState;
    infoMessage?: string;
    requestFrom?: { playerId: number; name?: string } | undefined;
};

export type TradePartyMessage = {
    playerId?: number;
    name?: string;
    offers: TradeOfferEntryMessage[];
    accepted?: boolean;
    confirmAccepted?: boolean;
};

export type TradeServerPayload =
    | { kind: "request"; fromId: number; fromName?: string }
    | {
          kind: "open" | "update";
          sessionId: string;
          stage: "offer" | "confirm";
          self: TradePartyMessage;
          other: TradePartyMessage;
          info?: string;
      }
    | { kind: "close"; reason?: string };

export type TradeActionClientPayload =
    | { action: "offer"; slot: number; quantity: number; itemId?: number }
    | { action: "remove"; slot: number; quantity: number }
    | { action: "accept" }
    | { action: "decline" }
    | { action: "confirm_accept" }
    | { action: "confirm_decline" };

export type ChatMessageEvent = {
    messageType: string;
    text: string;
    from?: string;
    prefix?: string;
    playerId?: number;
};

export type NotificationEvent = {
    kind:
        | "loot"
        | "league_task"
        | "collection_log"
        | "achievement"
        | "level_up"
        | "quest"
        | "warning"
        | "info";
    title?: string;
    message: string;
    itemId?: number;
    quantity?: number;
    durationMs?: number;
};

export type PlayerAnimPayload = {
    idle?: number;
    walk?: number;
    walkBack?: number;
    walkLeft?: number;
    walkRight?: number;
    run?: number;
    runBack?: number;
    runLeft?: number;
    runRight?: number;
    turnLeft?: number;
    turnRight?: number;
};

type WidgetServerPayload =
    | {
          action: "close" | "open";
          groupId: number;
          modal?: boolean;
      }
    | {
          action: "set_root";
          groupId: number;
      }
    | {
          action: "open_sub";
          targetUid: number;
          groupId: number;
          type: number;
          /** Optional varps to set before opening the interface */
          varps?: Record<number, number>;
          /** Optional varbits to set before opening the interface */
          varbits?: Record<number, number>;
          /** Optional widget UIDs to hide immediately after mount (same packet/frame). */
          hiddenUids?: number[];
          /** Optional scripts to run BEFORE mounting the interface (e.g., 2379 for chatbox setup) */
          preScripts?: Array<{ scriptId: number; args: (number | string)[] }>;
          /** Optional scripts to run AFTER the interface is fully loaded (widgets indexed) */
          postScripts?: Array<{ scriptId: number; args: (number | string)[] }>;
      }
    | {
          action: "close_sub";
          targetUid: number;
      }
    | {
          action: "set_text";
          uid: number;
          text: string;
      }
    | {
          action: "set_hidden";
          uid: number;
          hidden: boolean;
      }
    | {
          action: "set_item";
          uid: number;
          itemId: number;
          quantity?: number;
      }
    | {
          action: "set_npc_head";
          uid: number;
          npcId: number;
      }
    | {
          action: "set_flags";
          uid: number;
          flags: number;
      }
    | {
          action: "set_animation";
          uid: number;
          animationId: number;
      }
    | {
          action: "set_player_head";
          uid: number;
      }
    | {
          action: "set_flags_range";
          uid: number;
          fromSlot: number;
          toSlot: number;
          flags: number;
      }
    | {
          action: "run_script";
          scriptId: number;
          args?: (number | string)[];
          varps?: Record<number, number>;
          varbits?: Record<number, number>;
      }
    | {
          action: "set_model";
          uid: number;
          modelId?: number;
          itemId?: number;
          itemQuantity?: number;
          modelOrthog?: boolean;
      };

export type WidgetActionClientPayload = {
    widgetId: number;
    groupId: number;
    childId: number;
    option?: string;
    target?: string;
    /**
     * Matches OSRS "OP" numbering where 0 refers to the widget's target verb,
     * 1 is the first entry in actions[], etc. Undefined when the option
     * could not be mapped to a canonical slot.
     */
    opId?: number;
    /** Optional contextual coords relative to the widget surface (canvas pixels). */
    cursorX?: number;
    cursorY?: number;
    /** True when triggered via default left-click instead of an explicit menu selection. */
    isPrimary?: boolean;
    /** Optional slot/index metadata for item grids or list widgets. */
    slot?: number;
    itemId?: number;
};

export type HitsplatServerPayload = {
    targetType: "player" | "npc";
    targetId: number;
    damage: number;
    style?: number;
    type2?: number;
    damage2?: number;
    delayCycles?: number;
    tick?: number;
};

export type SpotAnimationPayload = {
    spotId: number;
    playerId?: number;
    npcId?: number;
    tile?: { x: number; y: number; level?: number };
    height?: number;
    delay?: number;
};

export type SkillEntryMessage = {
    id: number;
    xp: number;
    baseLevel: number;
    virtualLevel: number;
    boost: number;
    currentLevel: number;
};

export type SkillsServerPayload = {
    kind: "snapshot" | "delta";
    skills: SkillEntryMessage[];
    totalLevel: number;
    combatLevel: number;
};
export type { CombatStatePayload };

export type RunEnergyPayload = {
    percent: number;
    units?: number;
    running?: boolean;
    weight?: number;
    staminaTicks?: number;
    staminaMultiplier?: number;
    staminaTickMs?: number;
};

export type RunEnergyState = {
    percent: number;
    units: number;
    running: boolean;
    weight: number;
    stamina?: {
        ticks: number;
        msPerTick: number;
        multiplier: number;
        expiresAt: number;
    };
};

export type SpellCastModifiers = {
    isAutocast?: boolean;
    defensive?: boolean;
    queued?: boolean;
    castMode?: "manual" | "autocast" | "defensive_autocast";
};

export type SpellResultPayload = {
    casterId: number;
    spellId: number;
    outcome: "success" | "failure";
    reason?:
        | "invalid_spell"
        | "invalid_target"
        | "out_of_range"
        | "out_of_runes"
        | "level_requirement"
        | "cooldown"
        | "restricted_zone"
        | "immune_target"
        | "already_active"
        | "line_of_sight"
        | "server_error"
        | string;
    targetType: "npc" | "player" | "loc" | "obj" | "tile";
    targetId?: number;
    tile?: { x: number; y: number; plane?: number };
    modifiers?: SpellCastModifiers;
    runesConsumed?: { itemId: number; quantity: number }[];
    runesRefunded?: { itemId: number; quantity: number }[];
    hitDelay?: number;
    impactSpotAnim?: number;
    castSpotAnim?: number;
    splashSpotAnim?: number;
    damage?: number;
    maxHit?: number;
    accuracy?: number;
};

type ClientToServer =
    | { type: "hello"; payload: { client: string; version?: string } }
    | { type: "ping"; payload: { time: number } }
    | {
          type: "pathfind";
          payload: {
              id: number;
              from: { x: number; y: number; plane: number };
              to: { x: number; y: number };
              size?: number;
          };
      }
    | { type: "walk"; payload: { to: { x: number; y: number }; run?: boolean } }
    | { type: "face"; payload: { rot?: number; tile?: { x: number; y: number } } }
    | { type: "teleport"; payload: { to: { x: number; y: number }; level?: number } }
    | {
          type: "handshake";
          payload: {
              name?: string;
              appearance?: { gender: number; colors?: number[]; kits?: number[]; equip?: number[] };
              clientType?: number;
          };
      }
    | { type: "varp_transmit"; payload: { varpId: number; value: number } }
    | { type: "interact"; payload: { mode: "follow" | "trade"; targetId: number } }
    | { type: "interact_stop"; payload: {} }
    | { type: "npc_attack"; payload: { npcId: number } }
    | {
          type: "loc_interact";
          payload: {
              id: number;
              tile: { x: number; y: number };
              level?: number;
              action?: string;
          };
      }
    | { type: "emote"; payload: { index: number; loop?: boolean } }
    | {
          type: "inventory_use";
          payload: { slot: number; itemId: number; quantity?: number; option?: string };
      }
    | {
          type: "equipment_action";
          payload: { slot: number; itemId: number; option: string };
      }
    | { type: "equipment_unequip"; payload: { slot: number } }
    | { type: "equipment_clear"; payload: {} }
    | {
          type: "widget";
          payload: { action: "open" | "close"; groupId: number; modal?: boolean };
      }
    | { type: "widget_action"; payload: WidgetActionClientPayload }
    | { type: "item_spawner_search"; payload: { query: string } }
    | { type: "trade_action"; payload: TradeActionClientPayload }
    | { type: "bank_deposit_inventory"; payload?: Record<string, never> }
    | { type: "bank_deposit_equipment"; payload?: Record<string, never> }
    | { type: "bank_deposit_item"; payload: { slot: number; quantity: number; itemId?: number } }
    | { type: "resume_countdialog"; payload: { amount: number } }
    | { type: "resume_namedialog"; payload: { value: string } }
    | { type: "resume_stringdialog"; payload: { value: string } }
    | {
          type: "bank_move";
          payload: { from: number; to: number; mode?: "swap" | "insert"; tab?: number };
      }
    | {
          type: "if_buttond";
          payload: {
              sourceWidgetId: number;
              sourceSlot: number;
              sourceItemId: number;
              targetWidgetId: number;
              targetSlot: number;
              targetItemId: number;
          };
      }
    | {
          type: "debug";
          payload:
              | { kind: "projectiles_request"; requestId?: number }
              | { kind: "projectiles_snapshot"; requestId: number; snapshot: any }
              | { kind: "anim_request"; requestId?: number }
              | { kind: "anim_snapshot"; requestId: number; snapshot: any };
      }
    | { type: "logout"; payload?: Record<string, never> };
// Accessing process.env directly throws in browser-only bundles (e.g. toolkit/esbuild) where
// the Node `process` global is missing. Guard the lookup so we fall back safely.
const getEnv = (key: string): string | undefined =>
    typeof process !== "undefined" && process.env ? process.env[key] : undefined;

const DEFAULT_URL = "ws://localhost:43594";
const LOGIN_CONNECT_RETRY_DELAY_MS = 1000;

let socket: WebSocket | null = null;
let lastUrl: string = DEFAULT_URL;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 250;
const RECONNECT_DELAY_MAX_MS = 1000;
const RECONNECT_MAX_ATTEMPTS = 1; // OSRS only retries once
let reconnectAttempts = 0;
let isReconnecting = false;
let loginConnectRetryTimer: ReturnType<typeof setTimeout> | null = null;
let loginConnectAttemptId = 0;
// Session credentials for automatic re-login on reconnect
let sessionUsername: string | null = null;
let sessionPassword: string | null = null;
let sessionRevision: number = 0;
let currentTick = 0;
const tickListeners = new Set<(tick: number, time: number) => void>();
// Server-timing state for cross-client tick/phase alignment
let serverTickMs: number = 600;
let serverClockOffsetMs: number = 0; // localNow - serverNow
let lastTickServerTimeMs: number = 0;
let lastTickLocalRecvMs: number = 0;
let clientCycleProvider: (() => number | undefined | null) | undefined;
let clientCycleFallbackStartMs: number = 0;
let clientCycleFallbackBaseCycle: number = 0;
let nextReqId = 1;
const pending: Map<
    number,
    (res: { ok: boolean; waypoints?: { x: number; y: number }[]; message?: string }) => void
> = new Map();
const hitsplatListeners = new Set<(payload: HitsplatServerPayload) => void>();
const npcInfoListeners = new Set<(payload: NpcInfoPayload) => void>();
const spellResultListeners = new Set<(payload: SpellResultPayload) => void>();
const projectileListeners = new Set<(spawn: ProjectileLaunch) => void>();
const soundListeners = new Set<
    (payload: {
        soundId: number;
        x?: number;
        y?: number;
        level?: number;
        loops?: number;
        delay?: number;
        radius?: number;
        volume?: number;
    }) => void
>();
const playSongListeners = new Set<
    (payload: {
        trackId: number;
        fadeOutDelay?: number;
        fadeOutDuration?: number;
        fadeInDelay?: number;
        fadeInDuration?: number;
    }) => void
>();
const playJingleListeners = new Set<(payload: { jingleId: number; delay?: number }) => void>();
const animListeners = new Set<
    (anim: {
        idle?: number;
        walk?: number;
        walkBack?: number;
        walkLeft?: number;
        walkRight?: number;
        turnLeft?: number;
        turnRight?: number;
        run?: number;
        runBack?: number;
        runLeft?: number;
        runRight?: number;
    }) => void
>();
// Dev-only: server path debug listeners
const pathDebugListeners = new Set<(waypoints: { x: number; y: number }[] | undefined) => void>();
let lastServerPath: { x: number; y: number }[] | undefined;

export function subscribeServerPath(
    fn: (waypoints: { x: number; y: number }[] | undefined) => void,
): () => void {
    pathDebugListeners.add(fn);
    return () => pathDebugListeners.delete(fn);
}
export function getLastServerPath(): { x: number; y: number }[] | undefined {
    return lastServerPath ? lastServerPath.slice() : undefined;
}
const welcomeListeners = new Set<(info: { tickMs: number; serverTime: number }) => void>();
const loginResponseListeners = new Set<
    (info: { success: boolean; error?: string; displayName?: string }) => void
>();
const logoutResponseListeners = new Set<(info: { success: boolean; reason?: string }) => void>();
// Flag to control whether handshake is sent automatically on connect
let autoSendHandshake = true;
const handshakeListeners = new Set<
    (info: {
        id: number;
        appearance?: { gender: number; colors?: number[]; kits?: number[]; equip?: number[] };
        name?: string;
    }) => void
>();
const inventoryListeners = new Set<(update: InventoryServerUpdate) => void>();
const collectionLogListeners = new Set<(update: CollectionLogServerPayload) => void>();
const widgetListeners = new Set<(payload: WidgetServerPayload) => void>();
export type SkillsUpdateEvent = {
    kind: "snapshot" | "delta";
    totalLevel: number;
    combatLevel: number;
    skills: SkillEntryMessage[];
};
const skillsListeners = new Set<(update: SkillsUpdateEvent) => void>();
const runEnergyListeners = new Set<(state: RunEnergyState) => void>();
const bankListeners = new Set<(payload: BankServerUpdate) => void>();
const shopListeners = new Set<(state: ShopWindowState) => void>();
const tradeListeners = new Set<(state: TradeWindowState) => void>();
const chatMessageListeners = new Set<(msg: ChatMessageEvent) => void>();
const notificationListeners = new Set<(event: NotificationEvent) => void>();
const groundItemListeners = new Set<(payload: GroundItemsServerPayload) => void>();
const playerSyncListeners = new Set<(frame: PlayerSyncFrame) => void>();
const disconnectListeners = new Set<
    (evt: { code: number; reason: string; willReconnect: boolean }) => void
>();
const reconnectFailedListeners = new Set<() => void>();

let playerSyncContext: PlayerSyncContext | null = null;
let playerUpdateDecoder: PlayerUpdateDecoder | null = null;

type InternalSkillsState = {
    totalLevel: number;
    combatLevel: number;
    byId: Map<number, SkillEntryMessage>;
};

// Keep the latest values so late subscribers can get initial state immediately
let lastWelcome: { tickMs: number; serverTime: number } | undefined;
let lastAnim:
    | {
          idle?: number;
          walk?: number;
          walkBack?: number;
          walkLeft?: number;
          walkRight?: number;
          turnLeft?: number;
          turnRight?: number;
          run?: number;
          runBack?: number;
          runLeft?: number;
          runRight?: number;
      }
    | undefined;
let lastHandshake:
    | {
          id: number;
          appearance?: { gender: number; colors?: number[]; kits?: number[]; equip?: number[] };
          name?: string;
      }
    | undefined;
let lastInventorySnapshot: InventorySlotMessage[] | undefined;
let lastCollectionLogSnapshot: CollectionLogSlotMessage[] | undefined;
let lastBankState: { capacity: number; slots: BankSlotMessage[] } | undefined;
let lastShopState: ShopWindowState = createDefaultShopState();
let lastTradeState: TradeWindowState = createDefaultTradeState();
let lastSkillsState: InternalSkillsState | undefined;
let lastGroundItems: GroundItemsSnapshotPayload | undefined;
const combatStateStore = new CombatStateStore();
let lastRunEnergyState: RunEnergyState | undefined;
const cloneRunEnergyState = (state: RunEnergyState): RunEnergyState => ({
    ...state,
    stamina: state.stamina ? { ...state.stamina } : undefined,
});
let lastSpellResult: SpellResultPayload | undefined;

// Dev-only: animation debug provider
let animDebugProvider: (() => any) | null = null;
export function registerAnimDebugProvider(fn: (() => any) | null): void {
    animDebugProvider = fn;
}

function decodeBase64(input: string): Uint8Array {
    if (typeof input !== "string" || input.length === 0) return new Uint8Array();
    if (typeof atob === "function") {
        const binary = atob(input);
        const len = binary.length | 0;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
        return bytes;
    }
    try {
        const bufferCtor: any = (globalThis as any).Buffer;
        if (bufferCtor?.from) {
            return new Uint8Array(bufferCtor.from(input, "base64"));
        }
    } catch {}
    const fallback: number[] = [];
    for (let i = 0; i < input.length; i++) fallback.push(input.charCodeAt(i) & 0xff);
    return new Uint8Array(fallback);
}

function sanitizeInventorySlotMessage(raw: any): InventorySlotMessage {
    const slot = typeof raw?.slot === "number" ? raw.slot | 0 : 0;
    const itemId = typeof raw?.itemId === "number" ? raw.itemId | 0 : -1;
    const quantity = typeof raw?.quantity === "number" ? raw.quantity | 0 : 0;
    return {
        slot: Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, slot)),
        itemId,
        quantity,
    };
}

function sanitizeBankSlotMessage(raw: any, capacityHint?: number): InventorySlotMessage {
    const slot = typeof raw?.slot === "number" ? raw.slot | 0 : 0;
    const itemId = typeof raw?.itemId === "number" ? raw.itemId | 0 : -1;
    const quantity = typeof raw?.quantity === "number" ? raw.quantity | 0 : 0;
    const maxHint =
        typeof capacityHint === "number" && capacityHint > 0 ? Math.max(1, capacityHint | 0) : 0;
    const max = Math.max(BANK_SLOT_COUNT_FALLBACK, maxHint);
    return {
        slot: Math.max(0, Math.min(max - 1, slot)),
        itemId,
        quantity,
    };
}

function createDefaultShopState(): ShopWindowState {
    return {
        open: false,
        shopId: undefined,
        name: undefined,
        currencyItemId: undefined,
        generalStore: false,
        buyMode: 0,
        sellMode: 0,
        stock: [],
    };
}

function cloneShopState(state: ShopWindowState): ShopWindowState {
    return {
        open: !!state.open,
        shopId: state.shopId,
        name: state.name,
        currencyItemId:
            typeof state.currencyItemId === "number"
                ? (state.currencyItemId as number) | 0
                : undefined,
        generalStore: !!state.generalStore,
        buyMode: state.buyMode | 0,
        sellMode: state.sellMode | 0,
        stock: state.stock.map((entry) => ({ ...entry })),
    };
}

function createDefaultTradeState(): TradeWindowState {
    return {
        open: false,
        stage: "offer",
        self: undefined,
        other: undefined,
        infoMessage: undefined,
        requestFrom: undefined,
        sessionId: undefined,
    };
}

function cloneTradeState(state: TradeWindowState): TradeWindowState {
    const cloneParty = (party?: TradePartyViewState): TradePartyViewState | undefined => {
        if (!party) return undefined;
        return {
            playerId: party.playerId,
            name: party.name,
            accepted: party.accepted,
            confirmAccepted: party.confirmAccepted,
            offers: party.offers.map((offer) => ({ ...offer })),
        };
    };
    return {
        open: !!state.open,
        sessionId: state.sessionId,
        stage: state.stage,
        self: cloneParty(state.self),
        other: cloneParty(state.other),
        infoMessage: state.infoMessage,
        requestFrom: state.requestFrom ? { ...state.requestFrom } : undefined,
    };
}

function cloneGroundItemStack(stack: GroundItemStackMessage): GroundItemStackMessage {
    return {
        id: stack.id | 0,
        itemId: stack.itemId | 0,
        quantity: stack.quantity | 0,
        tile: {
            x: stack.tile?.x ?? 0,
            y: stack.tile?.y ?? 0,
            level: stack.tile?.level ?? 0,
        },
        createdTick:
            Number.isFinite(stack.createdTick) && (stack.createdTick as number) >= 0
                ? (stack.createdTick as number) | 0
                : undefined,
        privateUntilTick:
            Number.isFinite(stack.privateUntilTick) && (stack.privateUntilTick as number) > 0
                ? (stack.privateUntilTick as number) | 0
                : undefined,
        expiresTick:
            Number.isFinite(stack.expiresTick) && (stack.expiresTick as number) > 0
                ? (stack.expiresTick as number) | 0
                : undefined,
        ownerId:
            Number.isFinite(stack.ownerId) && (stack.ownerId as number) >= 0
                ? (stack.ownerId as number) | 0
                : undefined,
        isPrivate: stack.isPrivate === true,
        ownership:
            stack.ownership === 1 ||
            stack.ownership === 2 ||
            stack.ownership === 3 ||
            stack.ownership === 0
                ? (stack.ownership as 0 | 1 | 2 | 3)
                : 0,
    };
}

function cloneGroundItemsPayload(payload: GroundItemsServerPayload): GroundItemsServerPayload {
    if (payload.kind === "delta") {
        return {
            kind: "delta",
            serial: payload.serial | 0,
            upserts: (payload.upserts ?? []).map((stack) => cloneGroundItemStack(stack)),
            removes: Array.isArray(payload.removes)
                ? payload.removes
                      .map((stackId) => Number(stackId) | 0)
                      .filter((stackId) => stackId > 0)
                : [],
        };
    }
    return {
        kind: "snapshot",
        serial: payload.serial | 0,
        stacks: (payload.stacks ?? []).map((stack) => cloneGroundItemStack(stack)),
    };
}

function applyGroundItemsDelta(
    base: GroundItemsSnapshotPayload | undefined,
    delta: Extract<GroundItemsServerPayload, { kind: "delta" }>,
): GroundItemsSnapshotPayload {
    const byId = new Map<number, GroundItemStackMessage>();
    if (base && Array.isArray(base.stacks)) {
        for (const stack of base.stacks) {
            const id = stack.id | 0;
            if (id > 0) byId.set(id, cloneGroundItemStack(stack));
        }
    }
    for (const stack of delta.upserts ?? []) {
        const id = stack.id | 0;
        if (id <= 0) continue;
        byId.set(id, cloneGroundItemStack(stack));
    }
    for (const stackId of delta.removes ?? []) {
        byId.delete(stackId | 0);
    }
    return {
        kind: "snapshot",
        serial: delta.serial | 0,
        stacks: [...byId.values()],
    };
}

const clampShopMode = (mode: number | undefined): number => {
    if (!Number.isFinite(mode)) return 0;
    const normalized = Math.floor(mode as number);
    if (normalized < 0) return 0;
    if (normalized > 4) return 4;
    return normalized;
};

function sanitizeShopStockEntryMessage(raw: any): ShopStockEntryMessage {
    const slot = Number(raw?.slot);
    const itemId = Number(raw?.itemId);
    const quantity = Number(raw?.quantity);
    const defaultQuantity = Number(raw?.defaultQuantity);
    const priceEach = Number(raw?.priceEach);
    const sellPrice = Number(raw?.sellPrice);
    const normalized: ShopStockEntryMessage = {
        slot: Number.isFinite(slot) ? Math.max(0, slot | 0) : 0,
        itemId: Number.isFinite(itemId) ? itemId | 0 : -1,
        quantity: Number.isFinite(quantity) ? Math.max(0, quantity | 0) : 0,
    };
    if (Number.isFinite(defaultQuantity)) {
        normalized.defaultQuantity = Math.max(0, (defaultQuantity as number) | 0);
    }
    if (Number.isFinite(priceEach) && (priceEach as number) >= 0) {
        normalized.priceEach = Math.max(0, (priceEach as number) | 0);
    }
    if (Number.isFinite(sellPrice) && (sellPrice as number) >= 0) {
        normalized.sellPrice = Math.max(0, (sellPrice as number) | 0);
    }
    return normalized;
}

function handleShopPayload(payload: ShopServerPayload | undefined): void {
    if (!payload) return;
    if (payload.kind === "open") {
        const stock = Array.isArray(payload.stock)
            ? payload.stock.map((entry) => sanitizeShopStockEntryMessage(entry))
            : [];
        stock.sort((a, b) => a.slot - b.slot);
        lastShopState = {
            open: true,
            shopId: payload.shopId,
            name: payload.name,
            currencyItemId:
                typeof payload.currencyItemId === "number"
                    ? (payload.currencyItemId as number) | 0
                    : undefined,
            generalStore: !!payload.generalStore,
            buyMode: clampShopMode(payload.buyMode),
            sellMode: clampShopMode(payload.sellMode),
            stock,
        };
    } else if (payload.kind === "close") {
        lastShopState = createDefaultShopState();
    } else if (payload.kind === "slot") {
        if (lastShopState.shopId && payload.shopId && payload.shopId !== lastShopState.shopId) {
            return;
        }
        const entry = sanitizeShopStockEntryMessage(payload.slot);
        const idx = lastShopState.stock.findIndex((slot) => slot.slot === entry.slot);
        if (idx >= 0) lastShopState.stock[idx] = entry;
        else {
            lastShopState.stock.push(entry);
            lastShopState.stock.sort((a, b) => a.slot - b.slot);
        }
        if (!lastShopState.shopId && payload.shopId) {
            lastShopState.shopId = payload.shopId;
        }
        lastShopState.open = true;
    } else if (payload.kind === "mode") {
        if (lastShopState.shopId && payload.shopId && payload.shopId !== lastShopState.shopId) {
            return;
        }
        if (payload.buyMode !== undefined) {
            lastShopState.buyMode = clampShopMode(payload.buyMode);
        }
        if (payload.sellMode !== undefined) {
            lastShopState.sellMode = clampShopMode(payload.sellMode);
        }
    }
    const snapshot = cloneShopState(lastShopState);
    for (const listener of shopListeners) {
        try {
            listener(snapshot);
        } catch (err) {
            console.warn("shop listener error", err);
        }
    }
}

function createDefaultSmithingState(): SmithingWindowState {
    return {
        open: false,
        mode: "smelt",
        title: "Smelting",
        options: [],
        quantityMode: 0,
        customQuantity: 0,
    };
}

const smithingListeners = new Set<(state: SmithingWindowState) => void>();
let lastSmithingState: SmithingWindowState = createDefaultSmithingState();

function cloneSmithingState(state: SmithingWindowState): SmithingWindowState {
    return {
        open: state.open,
        mode: state.mode,
        title: state.title,
        quantityMode: state.quantityMode,
        customQuantity: state.customQuantity,
        options: state.options.map((opt) => ({ ...opt })),
    };
}

function clampSmithingMode(mode?: number): number {
    if (!Number.isFinite(mode)) return 0;
    return Math.max(0, Math.min(4, (mode as number) | 0));
}

function normalizeSmithingCustom(value?: number): number {
    if (!Number.isFinite(value) || (value as number) <= 0) return 0;
    return Math.max(0, Math.min(2147483647, (value as number) | 0));
}

function sanitizeSmithingOption(raw: any, fallbackIdx: number): SmithingOptionMessage {
    const recipeId =
        typeof raw?.recipeId === "string" && raw.recipeId.trim().length > 0
            ? raw.recipeId
            : `recipe_${fallbackIdx | 0}`;
    const name = typeof raw?.name === "string" && raw.name.trim().length > 0 ? raw.name : recipeId;
    const levelRaw = Number(raw?.level);
    const itemIdRaw = Number(raw?.itemId);
    const qtyRaw = Number(raw?.outputQuantity);
    const availableRaw = Number(raw?.available);
    const xpRaw = Number(raw?.xp);
    const requiresHammer = !!raw?.requiresHammer;
    const hasHammer = raw?.hasHammer === undefined ? true : !!raw?.hasHammer;
    return {
        recipeId,
        name,
        level: Number.isFinite(levelRaw) ? Math.max(1, levelRaw | 0) : 1,
        itemId: Number.isFinite(itemIdRaw) ? (itemIdRaw as number) | 0 : -1,
        outputQuantity: Number.isFinite(qtyRaw) ? Math.max(1, qtyRaw | 0) : 1,
        available: Number.isFinite(availableRaw) ? Math.max(0, availableRaw | 0) : 0,
        canMake: !!raw?.canMake,
        xp: Number.isFinite(xpRaw) && xpRaw > 0 ? xpRaw : undefined,
        ingredientsLabel:
            typeof raw?.ingredientsLabel === "string" && raw.ingredientsLabel.trim().length > 0
                ? raw.ingredientsLabel
                : undefined,
        mode: raw?.mode === "forge" ? "forge" : "smelt",
        barItemId: Number.isFinite(raw?.barItemId) ? (raw.barItemId as number) | 0 : undefined,
        barCount: Number.isFinite(raw?.barCount) ? (raw.barCount as number) | 0 : undefined,
        requiresHammer,
        hasHammer: requiresHammer ? hasHammer : true,
    };
}

function handleSmithingPayload(payload: SmithingServerPayload | undefined): void {
    if (!payload) return;
    if (payload.kind === "open" || payload.kind === "update") {
        const options = Array.isArray(payload.options)
            ? payload.options.map((entry, idx) => sanitizeSmithingOption(entry, idx))
            : [];
        lastSmithingState = {
            open: payload.kind === "open" ? true : lastSmithingState.open,
            mode: payload.mode,
            title: payload.title ?? (payload.mode === "forge" ? "Smithing" : "Smelting"),
            options,
            quantityMode: clampSmithingMode(payload.quantityMode),
            customQuantity: normalizeSmithingCustom(payload.customQuantity),
        };
    } else if (payload.kind === "mode") {
        lastSmithingState.quantityMode = clampSmithingMode(payload.quantityMode);
        const custom = normalizeSmithingCustom(payload.customQuantity);
        if (custom > 0 || payload.kind === "mode") {
            lastSmithingState.customQuantity = custom;
        }
    } else if (payload.kind === "close") {
        lastSmithingState = createDefaultSmithingState();
    }
    const snapshot = cloneSmithingState(lastSmithingState);
    for (const listener of smithingListeners) {
        try {
            listener(snapshot);
        } catch (err) {
            console.warn("smelting listener error", err);
        }
    }
}

function sanitizeTradeOfferEntry(raw: any, fallbackSlot: number): TradeOfferEntryMessage {
    const slotRaw = Number(raw?.slot);
    const itemIdRaw = Number(raw?.itemId);
    const quantityRaw = Number(raw?.quantity);
    return {
        slot: Number.isFinite(slotRaw) ? (slotRaw as number) | 0 : fallbackSlot | 0,
        itemId: Number.isFinite(itemIdRaw) ? (itemIdRaw as number) | 0 : -1,
        quantity: Number.isFinite(quantityRaw) ? Math.max(0, (quantityRaw as number) | 0) : 0,
    };
}

function sanitizeTradePartyMessage(
    raw: TradePartyMessage | undefined,
): TradePartyViewState | undefined {
    if (!raw) return undefined;
    const offers = Array.isArray(raw.offers)
        ? raw.offers.map((entry, idx) => sanitizeTradeOfferEntry(entry, idx))
        : [];
    return {
        playerId: typeof raw.playerId === "number" ? raw.playerId | 0 : undefined,
        name: raw.name ? String(raw.name) : undefined,
        offers,
        accepted: !!raw.accepted,
        confirmAccepted: !!raw.confirmAccepted,
    };
}

function handleTradePayload(payload: TradeServerPayload | undefined): void {
    if (!payload) return;
    if (payload.kind === "request") {
        lastTradeState = {
            ...createDefaultTradeState(),
            requestFrom: { playerId: payload.fromId | 0, name: payload.fromName },
        };
    } else if (payload.kind === "close") {
        lastTradeState = createDefaultTradeState();
        if (payload.reason) {
            lastTradeState.infoMessage = String(payload.reason);
        }
    } else if (payload.kind === "open" || payload.kind === "update") {
        const stage = payload.stage === "confirm" ? "confirm" : "offer";
        lastTradeState = {
            open: true,
            sessionId: payload.sessionId,
            stage,
            self: sanitizeTradePartyMessage(payload.self),
            other: sanitizeTradePartyMessage(payload.other),
            infoMessage: payload.info ? String(payload.info) : undefined,
            requestFrom: undefined,
        };
    }
    const snapshot = cloneTradeState(lastTradeState);
    for (const listener of tradeListeners) {
        try {
            listener(snapshot);
        } catch (err) {
            console.warn("trade listener error", err);
        }
    }
}

function emitInventory(update: InventoryServerUpdate): void {
    if (update.kind === "snapshot") {
        lastInventorySnapshot = update.slots.map((slot) => ({ ...slot }));
    } else if (update.kind === "slot") {
        if (!lastInventorySnapshot) lastInventorySnapshot = [];
        const idx = lastInventorySnapshot.findIndex((s) => (s.slot | 0) === (update.slot.slot | 0));
        if (idx >= 0) lastInventorySnapshot[idx] = { ...update.slot };
        else lastInventorySnapshot.push({ ...update.slot });
    }

    for (const listener of inventoryListeners) {
        try {
            if (update.kind === "snapshot") {
                listener({ kind: "snapshot", slots: update.slots.map((slot) => ({ ...slot })) });
            } else if (update.kind === "slot") {
                listener({ kind: "slot", slot: { ...update.slot } });
            }
        } catch (err) {
            console.warn("inventory listener error", err);
        }
    }
}

function emitCollectionLog(update: CollectionLogServerPayload): void {
    lastCollectionLogSnapshot = update.slots.map((slot) => ({ ...slot }));

    for (const listener of collectionLogListeners) {
        try {
            listener({ kind: "snapshot", slots: update.slots.map((slot) => ({ ...slot })) });
        } catch (err) {
            console.warn("collection log listener error", err);
        }
    }
}

function sanitizeSkillEntry(raw: any): SkillEntryMessage {
    const id = Number(raw?.id) | 0;
    const xp = Math.max(0, Number(raw?.xp) || 0);
    const baseLevel = Math.max(1, Number(raw?.baseLevel) || 1);
    const virtualLevel = Math.max(baseLevel, Number(raw?.virtualLevel) || baseLevel);
    const boost = Number.isFinite(raw?.boost) ? Number(raw.boost) : 0;
    const minCurrent = id === SkillId.Hitpoints ? 0 : 1;
    const fallbackCurrent = baseLevel + boost;
    const rawCurrent = Number(raw?.currentLevel);
    const currentLevel = Math.max(
        minCurrent,
        Number.isFinite(rawCurrent) ? (rawCurrent as number) : fallbackCurrent,
    );
    return {
        id,
        xp,
        baseLevel,
        virtualLevel,
        boost,
        currentLevel,
    };
}

function sanitizeSpellResult(raw: any): SpellResultPayload {
    const casterId = Number(raw?.casterId) | 0;
    const spellId = Number(raw?.spellId) | 0;
    const outcome = raw?.outcome === "success" ? "success" : "failure";
    const validTargetTypes = new Set(["npc", "player", "loc", "obj", "tile"]);
    const targetTypeRaw = typeof raw?.targetType === "string" ? raw.targetType : "npc";
    const targetType = validTargetTypes.has(targetTypeRaw) ? (targetTypeRaw as any) : "npc";
    const targetIdRaw = Number(raw?.targetId);
    const targetId = Number.isFinite(targetIdRaw) ? targetIdRaw | 0 : undefined;

    const tileRaw = raw?.tile;
    const tile =
        tileRaw && typeof tileRaw === "object"
            ? {
                  x: Number(tileRaw.x) | 0,
                  y: Number(tileRaw.y) | 0,
                  plane:
                      tileRaw.plane !== undefined && Number.isFinite(tileRaw.plane)
                          ? Number(tileRaw.plane) | 0
                          : undefined,
              }
            : undefined;

    const sanitizeRuneDelta = (entry: any): { itemId: number; quantity: number } | undefined => {
        const itemId = Number(entry?.itemId) | 0;
        const quantity = Number(entry?.quantity) || 0;
        if (!Number.isFinite(itemId) || itemId <= 0) return undefined;
        if (!Number.isFinite(quantity) || quantity === 0) return undefined;
        return { itemId, quantity: quantity | 0 };
    };

    const runesConsumed = Array.isArray(raw?.runesConsumed)
        ? (raw.runesConsumed as any[])
              .map((entry) => sanitizeRuneDelta(entry))
              .filter((entry): entry is { itemId: number; quantity: number } => !!entry)
        : undefined;
    const runesRefunded = Array.isArray(raw?.runesRefunded)
        ? (raw.runesRefunded as any[])
              .map((entry) => sanitizeRuneDelta(entry))
              .filter((entry): entry is { itemId: number; quantity: number } => !!entry)
        : undefined;

    const hitDelayRaw = Number(raw?.hitDelay);
    const impactSpotAnimRaw = Number(raw?.impactSpotAnim);
    const castSpotAnimRaw = Number(raw?.castSpotAnim);
    const splashSpotAnimRaw = Number(raw?.splashSpotAnim);
    const damageRaw = Number(raw?.damage);
    const maxHitRaw = Number(raw?.maxHit);
    const accuracyRaw = Number(raw?.accuracy);

    const modifiersRaw = raw?.modifiers;
    const modifiers =
        modifiersRaw && typeof modifiersRaw === "object"
            ? {
                  isAutocast: !!modifiersRaw.isAutocast,
                  defensive: !!modifiersRaw.defensive,
                  queued: !!modifiersRaw.queued,
                  castMode:
                      modifiersRaw.castMode === "autocast" ||
                      modifiersRaw.castMode === "defensive_autocast"
                          ? modifiersRaw.castMode
                          : "manual",
              }
            : undefined;

    const reason =
        typeof raw?.reason === "string" && raw.reason.length > 0
            ? (raw.reason as string)
            : undefined;

    return {
        casterId,
        spellId,
        outcome,
        targetType,
        targetId,
        tile,
        modifiers,
        reason,
        runesConsumed,
        runesRefunded,
        hitDelay: Number.isFinite(hitDelayRaw) ? Math.max(0, hitDelayRaw | 0) : undefined,
        impactSpotAnim: Number.isFinite(impactSpotAnimRaw) ? impactSpotAnimRaw | 0 : undefined,
        castSpotAnim: Number.isFinite(castSpotAnimRaw) ? castSpotAnimRaw | 0 : undefined,
        splashSpotAnim: Number.isFinite(splashSpotAnimRaw) ? splashSpotAnimRaw | 0 : undefined,
        damage: Number.isFinite(damageRaw) ? damageRaw | 0 : undefined,
        maxHit: Number.isFinite(maxHitRaw) ? maxHitRaw | 0 : undefined,
        accuracy: Number.isFinite(accuracyRaw) ? Math.max(0, Math.min(1, accuracyRaw)) : undefined,
    };
}

function emitSkills(payload: SkillsServerPayload): void {
    if (!lastSkillsState || payload.kind === "snapshot") {
        lastSkillsState = {
            totalLevel: Number(payload.totalLevel) || 0,
            combatLevel: Number(payload.combatLevel) || 0,
            byId: new Map(),
        };
    } else {
        lastSkillsState.totalLevel = Number(payload.totalLevel) || 0;
        lastSkillsState.combatLevel = Number(payload.combatLevel) || 0;
    }

    const changed: SkillEntryMessage[] = [];
    for (const raw of payload.skills || []) {
        const entry = sanitizeSkillEntry(raw);
        lastSkillsState.byId.set(entry.id, entry);
        changed.push({ ...entry });
    }

    const event: SkillsUpdateEvent = {
        kind: payload.kind,
        totalLevel: lastSkillsState.totalLevel,
        combatLevel: lastSkillsState.combatLevel,
        skills:
            payload.kind === "snapshot"
                ? Array.from(lastSkillsState.byId.values()).map((entry) => ({ ...entry }))
                : changed,
    };

    for (const listener of skillsListeners) {
        try {
            listener({
                kind: event.kind,
                totalLevel: event.totalLevel,
                combatLevel: event.combatLevel,
                skills: event.skills.map((entry) => ({ ...entry })),
            });
        } catch (err) {
            console.warn("skills listener error", err);
        }
    }
}

function emitPlayerSync(frame: PlayerSyncFrame): void {
    for (const listener of playerSyncListeners) {
        try {
            listener(frame);
        } catch (err) {
            console.warn("player sync listener error", err);
        }
    }
}

function clearLoginConnectRetryTimer(): void {
    if (!loginConnectRetryTimer) return;
    try {
        clearTimeout(loginConnectRetryTimer);
    } catch {}
    loginConnectRetryTimer = null;
}

export function initServerConnection(url: string = DEFAULT_URL) {
    lastUrl = url;
    // On HMR refresh, proactively close any previous live socket stored globally
    try {
        const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
        const existing: WebSocket | null | undefined = g[WS_GLOBAL_KEY];
        // If a prior cycle marked suppression (HMR), respect it until re-init is called
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _sup: boolean = !!g[WS_SUPPRESS_RECONNECT_KEY];
        if (
            existing &&
            (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
        ) {
            try {
                existing.close(1000, "refresh");
            } catch {}
        }
    } catch {}

    if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    )
        return;

    try {
        playerSyncContext = new PlayerSyncContext();
        playerUpdateDecoder = new PlayerUpdateDecoder();
        socket = new WebSocket(url);
        const ws = socket;
        try {
            ws.binaryType = "arraybuffer";
        } catch {}

        ws.addEventListener("open", () => {
            if (socket !== ws) return;

            // Capture reconnecting state before resetting
            const wasReconnecting = isReconnecting;
            // Reset reconnect backoff, attempts counter, and clear any timers
            try {
                if (reconnectTimer) clearTimeout(reconnectTimer);
            } catch {}
            reconnectTimer = null;
            reconnectDelayMs = 250;
            reconnectAttempts = 0;
            isReconnecting = false;
            clearLoginConnectRetryTimer();
            try {
                const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
                g[WS_SUPPRESS_RECONNECT_KEY] = false;
            } catch {}
            // Wire up the packet writer for binary protocol
            setPacketSocket(ws);
            send({
                type: "hello",
                payload: { client: "osrs-typescript", version: getEnv("REACT_APP_VERSION") },
            });

            // If reconnecting with stored credentials, automatically re-login
            if (wasReconnecting && sessionUsername && sessionPassword) {
                console.log("[ws] Reconnected - attempting session resumption...");
                send({
                    type: "login",
                    payload: { username: sessionUsername, password: sessionPassword, revision: sessionRevision },
                } as any);
            }
            // Only auto-send handshake if flag is set (for backwards compatibility)
            // When using login screen, handshake should be sent after login success
            else if (autoSendHandshake) {
                // Send handshake request with client type (mobile=1, desktop=0)
                // Server uses this to decide which root interface to send (601 mobile, 161 desktop)
                // isMobileMode combines actual touch detection + ?mobile=1 URL param override
                const { isMobileMode } = require("../util/DeviceUtil");
                const clientType = isMobileMode ? 1 : 0;
                // Send a default name so chat scripts work (server echoes it back)
                send({ type: "handshake", payload: { clientType, name: "Player" } });
            }
            // eslint-disable-next-line no-console
            console.log(`[ws] connected to ${url}`);
            // Track as global singleton so subsequent refreshes can close it before re-init
            try {
                const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
                g[WS_GLOBAL_KEY] = ws;
            } catch {}
        });

        ws.addEventListener("message", (evt) => {
            if (socket !== ws) return;

            try {
                const raw = evt.data;
                let messages: any[] = [];

                // Handle binary packets (ArrayBuffer) or JSON strings
                if (raw instanceof ArrayBuffer) {
                    // Binary protocol - may contain batched packets
                    const { decodeBatchedServerPackets } = require("./packet/ServerBinaryDecoder");
                    const decoded = decodeBatchedServerPackets(raw);
                    if (!decoded || decoded.length === 0) {
                        console.warn("[ws] Failed to decode binary packet(s)");
                        return;
                    }
                    messages = decoded;
                } else if (typeof raw === "string") {
                    // JSON protocol (legacy/fallback)
                    messages = [JSON.parse(raw) as any];
                } else {
                    return;
                }

                // Process all messages (may be multiple from batching)
                for (const msg of messages) {
                    processServerMessage(msg);
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn("[ws] parse error:", e);
            }
        });

        // Set up close handler
        initSocketCloseHandler(ws);

        // Set up error handler
        ws.addEventListener("error", (e) => {
            if (socket !== ws) return;
            // eslint-disable-next-line no-console
            console.warn("[ws] error", e);
        });

        // Close gracefully before page reload/navigation
        try {
            if (typeof window !== "undefined") {
                const onBeforeUnload = () => {
                    try {
                        const g: any = window as any;
                        g[WS_SUPPRESS_RECONNECT_KEY] = true;
                        socket?.close(1000, "page unload");
                    } catch {}
                };
                // Attach once per page lifetime using a global guard
                const g: any = window as any;
                if (!g.__OSRS_CLIENT_WS_UNLOAD_BOUND__) {
                    window.addEventListener("beforeunload", onBeforeUnload);
                    g.__OSRS_CLIENT_WS_UNLOAD_BOUND__ = true;
                }
            }
        } catch {}
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Failed to create WebSocket:", e);
        return;
    }
}

/**
 * Process a single server message
 */
function processServerMessage(msg: any): void {
    if (msg.type === "welcome") {
        // eslint-disable-next-line no-console
        console.log(
            `[ws] welcome tickMs=${msg.payload.tickMs} serverTime=${msg.payload.serverTime}`,
        );
        lastWelcome = msg.payload;
        try {
            serverTickMs = Math.max(1, (msg.payload.tickMs as number) | 0);
            const now = (performance?.now?.() as number) || Date.now();
            const serverNow = Number(msg.payload.serverTime) || 0;
            if (serverNow > 0) serverClockOffsetMs = now - serverNow;
        } catch {}
        for (const cb of welcomeListeners) cb(msg.payload);
    } else if (msg.type === "login_response") {
        // Handle login response from server
        console.log(`[ws] login_response success=${msg.payload.success}`);
        for (const cb of loginResponseListeners) {
            try {
                cb(msg.payload);
            } catch (e) {
                console.warn("[ws] login response listener error:", e);
            }
        }
    } else if (msg.type === "logout_response") {
        // Handle logout response from server
        console.log(`[ws] logout_response success=${msg.payload.success}`);
        for (const cb of logoutResponseListeners) {
            try {
                cb(msg.payload);
            } catch (e) {
                console.warn("[ws] logout response listener error:", e);
            }
        }
    } else if (msg.type === "tick") {
        currentTick = msg.payload.tick;
        try {
            const now = (performance?.now?.() as number) || Date.now();
            const serverNow = Number(msg.payload.time) || 0;
            if (serverNow > 0) {
                // Smooth clock offset to reduce jitter
                const off = now - serverNow;
                serverClockOffsetMs = serverClockOffsetMs * 0.9 + off * 0.1;
                lastTickServerTimeMs = serverNow;
                lastTickLocalRecvMs = now;
            }
        } catch {}
        for (const cb of tickListeners) {
            cb(msg.payload.tick, msg.payload.time);
        }
    } else if (msg.type === "destination") {
        const rawWorldX = Number(msg.payload?.worldX);
        const rawWorldY = Number(msg.payload?.worldY);
        if (!Number.isFinite(rawWorldX) || !Number.isFinite(rawWorldY)) {
            return;
        }
        const worldX = rawWorldX | 0;
        const worldY = rawWorldY | 0;
        const localX = (worldX - (ClientState.baseX | 0)) | 0;
        const localY = (worldY - (ClientState.baseY | 0)) | 0;
        ClientState.setDestination(localX, localY);
        // Keep authoritative world destination to avoid base-shift drift.
        ClientState.destinationWorldX = worldX;
        ClientState.destinationWorldY = worldY;
    } else if (msg.type === "path") {
        const { id, ok, waypoints, message } = msg.payload;
        const cb = pending.get(id);
        if (cb) {
            pending.delete(id);
            cb({ ok, waypoints, message });
        }
        try {
            lastServerPath = Array.isArray(waypoints)
                ? waypoints.map((w: any) => ({ x: Number(w.x) | 0, y: Number(w.y) | 0 }))
                : undefined;
            for (const fn of pathDebugListeners) fn(lastServerPath);
        } catch {}
    } else if (msg.type === "player_sync") {
        if (!playerSyncContext || !playerUpdateDecoder) return;
        try {
            const payload = msg.payload as any;
            const baseX = Number(payload?.baseX) | 0;
            const baseY = Number(payload?.baseY) | 0;
            if (!Number.isFinite(payload?.localIndex)) return;
            const localIndex = Number(payload.localIndex) | 0;
            if (localIndex < 0 || localIndex >= 2048) {
                console.warn("[ws] player_sync invalid localIndex", localIndex, "dropping frame");
                return;
            }
            const loopCycle = Number(payload?.loopCycle) | 0;
            const clientCycle = getClientCycle();

            let buffer: Uint8Array;
            const pkt = payload?.packet;
            if (pkt instanceof Uint8Array) {
                buffer = pkt;
            } else if (Array.isArray(pkt) || ArrayBuffer.isView(pkt)) {
                const arr = Array.from(pkt as ArrayLike<number>, (n) => Number(n) & 0xff);
                buffer = new Uint8Array(arr);
            } else {
                buffer = decodeBase64(typeof pkt === "string" ? pkt : String(pkt ?? ""));
            }

            if (!buffer || buffer.length === 0) return;

            playerSyncContext.setBase(baseX, baseY);
            playerSyncContext.setLocalIndex(localIndex);
            // OSRS parity: baseX/baseY are the scene base in *tiles* (8-aligned).
            // Local coords are in 0..103 and world = base + local.
            ClientState.baseX = baseX | 0;
            ClientState.baseY = baseY | 0;
            const frame = playerUpdateDecoder.decode(
                buffer ?? new Uint8Array(0),
                playerSyncContext,
                {
                    packetSize: buffer?.length ?? 0,
                    loopCycle,
                    clientCycle,
                },
            );
            (frame as any).sourcePacketSize = buffer?.length ?? 0;
            try {
                if ((globalThis as any).__syncDebug === true) {
                    const localState = playerSyncContext.stateFor(localIndex);
                    console.log("[sync-debug] player_sync", {
                        baseX,
                        baseY,
                        localIndex,
                        localTile: localState?.active
                            ? {
                                  x: localState.tileX | 0,
                                  y: localState.tileY | 0,
                                  level: localState.level | 0,
                              }
                            : undefined,
                        loopCycle,
                        packetSize: buffer.length | 0,
                    });
                }
            } catch {}

            if (Array.isArray(payload?.interactions)) {
                for (const entry of payload.interactions as any[]) {
                    const id = Number(entry?.id);
                    if (!Number.isFinite(id)) continue;
                    const rawIndex = Number(entry?.interactionIndex);
                    const block = frame.updateBlocks.get(id) ?? {};
                    block.faceEntity = Number.isFinite(rawIndex) ? rawIndex | 0 : -1;
                    frame.updateBlocks.set(id, block);
                }
            }

            emitPlayerSync(frame);
        } catch (err) {
            console.warn("failed to process player_sync payload", err);
            try {
                // OSRS parity: the reference client hard-fails on malformed updatePlayers streams.
                // In this dev client, force a reconnect to resynchronise player sync state.
                const message = (err as any)?.message?.toString?.() ?? "";
                if (
                    err instanceof RangeError ||
                    message.includes("Buffer exhausted") ||
                    message.includes("player sync:")
                ) {
                    socket?.close(1002, "player_sync_desync");
                }
            } catch {}
        }
    } else if (msg.type === "debug") {
        const payload: any = msg.payload;
        if (payload?.kind === "anim_request") {
            try {
                const reqId = Number(payload.requestId) | 0;
                const snap = animDebugProvider?.();
                if (snap) {
                    send({
                        type: "debug",
                        payload: {
                            kind: "anim_snapshot",
                            requestId: reqId,
                            snapshot: snap,
                        },
                    } as any);
                }
            } catch (err) {
                console.warn("[debug] anim snapshot failed", err);
            }
        }
    } else if (msg.type === "hitsplat") {
        for (const cb of hitsplatListeners) {
            try {
                cb(msg.payload);
            } catch (err) {
                console.warn("hitsplat listener error", err);
            }
        }
    } else if (msg.type === "npc_info") {
        try {
            const payload = msg.payload as any;
            const loopCycle = Number(payload?.loopCycle) | 0;
            const large = payload?.large === true;
            let buffer: Uint8Array;
            const pkt = payload?.packet;
            if (pkt instanceof Uint8Array) {
                buffer = pkt;
            } else if (Array.isArray(pkt) || ArrayBuffer.isView(pkt)) {
                const arr = Array.from(pkt as ArrayLike<number>, (n) => Number(n) & 0xff);
                buffer = new Uint8Array(arr);
            } else {
                buffer = decodeBase64(typeof pkt === "string" ? pkt : String(pkt ?? ""));
            }
            if (!buffer || buffer.length === 0) return;
            for (const cb of npcInfoListeners) {
                try {
                    cb({ loopCycle, large, packet: buffer });
                } catch (err) {
                    console.warn("npc_info listener error", err);
                }
            }
        } catch (err) {
            console.warn("failed to process npc_info payload", err);
        }
    } else if (msg.type === "spell_result") {
        const payload = sanitizeSpellResult(msg.payload);
        lastSpellResult = payload;
        for (const cb of spellResultListeners) {
            try {
                cb({
                    ...payload,
                    runesConsumed: payload.runesConsumed
                        ? payload.runesConsumed.map((entry) => ({ ...entry }))
                        : undefined,
                    runesRefunded: payload.runesRefunded
                        ? payload.runesRefunded.map((entry) => ({ ...entry }))
                        : undefined,
                    tile: payload.tile ? { ...payload.tile } : undefined,
                    modifiers: payload.modifiers ? { ...payload.modifiers } : undefined,
                });
            } catch (err) {
                console.warn("spell_result listener error", err);
            }
        }
    } else if (msg.type === "projectiles") {
        const list = msg.payload.list;
        for (const p of list) {
            for (const cb of projectileListeners) {
                try {
                    cb(p);
                } catch (err) {
                    console.warn("projectile listener error", err);
                }
            }
        }
    } else if (msg.type === "spot") {
        const raw = msg.payload as SpotAnimationPayload | undefined;
        if (!raw || typeof raw.spotId !== "number") return;
        const payload: SpotAnimationPayload = {
            spotId: raw.spotId | 0,
            delay: raw.delay,
            height: raw.height,
        };
        if (typeof raw.playerId === "number") payload.playerId = raw.playerId | 0;
        if (typeof raw.npcId === "number") payload.npcId = raw.npcId | 0;
        if (raw.tile && typeof raw.tile.x === "number" && typeof raw.tile.y === "number") {
            payload.tile = {
                x: raw.tile.x | 0,
                y: raw.tile.y | 0,
                level:
                    typeof raw.tile.level === "number" ? (raw.tile.level as number) | 0 : undefined,
            };
        }
        for (const cb of spotListeners) {
            try {
                cb(payload);
            } catch (err) {
                console.warn("spot listener error", err);
            }
        }
    } else if (msg.type === "anim") {
        lastAnim = msg.payload;
        for (const cb of animListeners) cb(msg.payload);
    } else if (msg.type === "handshake") {
        lastHandshake = msg.payload as any;
        for (const cb of handshakeListeners) cb(msg.payload as any);
        try {
            const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
            if (canvas) {
                const ui: any = ((canvas as any).__ui = (canvas as any).__ui || {});
                ui.chatbox = ui.chatbox || {};
                if (Array.isArray((msg.payload as any).chatIcons)) {
                    ui.chatbox.defaultIcons = (msg.payload as any).chatIcons.slice();
                }
                if (typeof (msg.payload as any).chatPrefix === "string") {
                    ui.chatbox.defaultPrefix = String((msg.payload as any).chatPrefix);
                }
            }
        } catch {}
    } else if (msg.type === "inventory") {
        const payload: any = msg.payload;
        if (!payload) return;
        if (payload.kind === "snapshot") {
            const slots = Array.isArray(payload.slots)
                ? payload.slots.map((slot: any) => sanitizeInventorySlotMessage(slot))
                : [];
            emitInventory({ kind: "snapshot", slots });
        } else if (payload.kind === "slot") {
            if (payload.slot) {
                emitInventory({
                    kind: "slot",
                    slot: sanitizeInventorySlotMessage(payload.slot),
                });
            }
        }
    } else if (msg.type === "collection_log") {
        const payload: any = msg.payload;
        if (!payload) return;
        if (payload.kind === "snapshot") {
            const slots = Array.isArray(payload.slots)
                ? payload.slots.map((slot: any) => sanitizeInventorySlotMessage(slot))
                : [];
            emitCollectionLog({ kind: "snapshot", slots });
        }
    } else if (msg.type === "bank") {
        const payload = msg.payload as BankServerUpdate;
        if (!payload) return;
        if (payload.kind === "snapshot") {
            const capacity = Math.max(1, Number(payload.capacity) | 0);
            const slots = Array.isArray(payload.slots)
                ? payload.slots.map((slot) => sanitizeBankSlotMessage(slot, capacity))
                : [];
            lastBankState = {
                capacity,
                slots: slots.map((slot) => ({ ...slot })),
            };
            const snapshotPayload: BankServerUpdate = {
                kind: "snapshot",
                capacity,
                slots: slots.map((slot) => ({ ...slot })),
            };
            for (const cb of bankListeners) {
                try {
                    cb(snapshotPayload);
                } catch (err) {
                    console.warn("bank listener error", err);
                }
            }
        } else if (payload.kind === "slot") {
            const capacityHint = lastBankState?.capacity ?? BANK_SLOT_COUNT_FALLBACK;
            const slot = sanitizeBankSlotMessage(payload.slot, capacityHint);
            if (lastBankState) {
                const idx = lastBankState.slots.findIndex((s) => (s.slot | 0) === (slot.slot | 0));
                if (idx >= 0) lastBankState.slots[idx] = { ...slot };
                else lastBankState.slots.push({ ...slot });
            }
            for (const cb of bankListeners) {
                try {
                    cb({ kind: "slot", slot: { ...slot } });
                } catch (err) {
                    console.warn("bank listener error", err);
                }
            }
        }
    } else if (msg.type === "shop") {
        handleShopPayload(msg.payload as ShopServerPayload);
    } else if (msg.type === "ground_items") {
        try {
            const normalized = cloneGroundItemsPayload(msg.payload as GroundItemsServerPayload);
            if (normalized.kind === "snapshot") {
                lastGroundItems = normalized;
            } else {
                lastGroundItems = applyGroundItemsDelta(lastGroundItems, normalized);
            }
            for (const cb of groundItemListeners) {
                try {
                    cb(cloneGroundItemsPayload(normalized));
                } catch (err) {
                    console.warn("ground item listener error", err);
                }
            }
        } catch (err) {
            console.warn("ground_items handler error", err);
        }
    } else if (msg.type === "smithing") {
        handleSmithingPayload(msg.payload as SmithingServerPayload);
    } else if (msg.type === "trade") {
        handleTradePayload(msg.payload as TradeServerPayload);
    } else if (msg.type === "skills") {
        emitSkills(msg.payload as SkillsServerPayload);
    } else if (msg.type === "combat") {
        combatStateStore.ingest(msg.payload as CombatStatePayload | undefined);
    } else if (msg.type === "run_energy") {
        const raw = msg.payload as RunEnergyPayload | undefined;
        const percentRaw = Number(raw?.percent);
        const percent = Number.isFinite(percentRaw)
            ? Math.max(0, Math.min(100, percentRaw | 0))
            : lastRunEnergyState?.percent ?? 100;
        const unitsRaw = Number(raw?.units);
        const units = Number.isFinite(unitsRaw)
            ? Math.max(0, Math.min(RUN_ENERGY_MAX_UNITS, unitsRaw | 0))
            : Math.round((percent / 100) * RUN_ENERGY_MAX_UNITS);
        const running =
            raw && Object.prototype.hasOwnProperty.call(raw, "running")
                ? !!raw?.running
                : lastRunEnergyState?.running ?? true;
        const weightRaw = Number(raw?.weight);
        const weight = Number.isFinite(weightRaw) ? weightRaw | 0 : lastRunEnergyState?.weight ?? 0;
        let stamina: RunEnergyState["stamina"] | undefined;
        const staminaTicksRaw = Number(raw?.staminaTicks);
        const staminaMultiplierRaw = Number(raw?.staminaMultiplier);
        if (
            Number.isFinite(staminaTicksRaw) &&
            staminaTicksRaw > 0 &&
            Number.isFinite(staminaMultiplierRaw) &&
            staminaMultiplierRaw > 0
        ) {
            const tickMsRaw = Number(raw?.staminaTickMs);
            const msPerTick =
                Number.isFinite(tickMsRaw) && tickMsRaw > 0 ? tickMsRaw : DEFAULT_SERVER_TICK_MS;
            stamina = {
                ticks: staminaTicksRaw | 0,
                msPerTick,
                multiplier: staminaMultiplierRaw,
                expiresAt: Date.now() + (staminaTicksRaw | 0) * msPerTick,
            };
        }
        const state: RunEnergyState = stamina
            ? { percent, units, running, weight, stamina }
            : { percent, units, running, weight };
        lastRunEnergyState = cloneRunEnergyState(state);
        for (const cb of runEnergyListeners) {
            try {
                cb(cloneRunEnergyState(state));
            } catch (err) {
                console.warn("run energy listener error", err);
            }
        }
    } else if (msg.type === "widget") {
        if (msg.payload.action !== "set_text" && (msg.payload as any).uid !== 10616865) {
            console.log("[ServerConnection] recv widget", msg.payload);
        }
        const payload = msg.payload as WidgetServerPayload;
        for (const cb of widgetListeners) cb(payload);
    } else if (msg.type === "chat") {
        const payload = msg.payload;
        try {
            const event: ChatMessageEvent = {
                messageType: payload.messageType,
                text: payload.text,
                from: payload.from,
                prefix: payload.prefix,
                playerId: payload.playerId,
            };
            for (const cb of chatMessageListeners) cb(event);
        } catch (err) {
            console.warn("chat listener error", err);
        }
    } else if (msg.type === "notification") {
        const payload = msg.payload as NotificationEvent;
        for (const cb of notificationListeners) cb(payload);
    } else if (msg.type === "loc_change") {
        const payload = msg.payload;
        try {
            // Notify osrs client to update the loc
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && typeof mv.onLocChange === "function") {
                // Pass extended info for doors that move when opened
                mv.onLocChange(payload.oldId, payload.newId, payload.tile, payload.level, {
                    oldTile: payload.oldTile ?? payload.tile,
                    newTile: payload.newTile ?? payload.tile,
                    oldRotation: payload.oldRotation,
                    newRotation: payload.newRotation,
                });
            }
        } catch (err) {
            console.warn("loc_change handler error", err);
        }
    } else if (msg.type === "vars") {
        const payload = msg.payload;
        try {
            // Update varps and varbits on the client's VarManager
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && mv.varManager) {
                const vm = mv.varManager;
                // Apply varp updates
                if (payload.varps) {
                    for (const [id, value] of Object.entries(payload.varps)) {
                        vm.setVarp?.(Number(id), Number(value));
                    }
                }
                // Apply varbit updates
                if (payload.varbits) {
                    for (const [id, value] of Object.entries(payload.varbits)) {
                        vm.setVarbit?.(Number(id), Number(value));
                    }
                }
            }
        } catch (err) {
            console.warn("vars handler error", err);
        }
    } else if (msg.type === "sound") {
        for (const cb of soundListeners) {
            try {
                cb(msg.payload);
            } catch (err) {
                console.warn("sound listener error", err);
            }
        }
    } else if (msg.type === "play_song") {
        for (const cb of playSongListeners) {
            try {
                cb(msg.payload);
            } catch (err) {
                console.warn("play_song listener error", err);
            }
        }
    } else if (msg.type === "play_jingle") {
        for (const cb of playJingleListeners) {
            try {
                cb(msg.payload);
            } catch (err) {
                console.warn("play_jingle listener error", err);
            }
        }
    } else if (msg.type === "varp") {
        // Server-pushed varp update
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && mv.varManager) {
                const payload = msg.payload as { varpId: number; value: number };
                const varpId = payload.varpId | 0;
                const value = payload.value | 0;
                // Use _serverVarpSync flag to prevent sending back to server
                mv._serverVarpSync = true;
                try {
                    mv.varManager.setVarp?.(varpId, value);
                } finally {
                    mv._serverVarpSync = false;
                }

                // Apply audio volume when sound varps are received from server
                // CS2 scripts normally do this via enum_981 lookup, but they only run when settings tab opens
                // enum_981 provides a non-linear (quadratic) curve: enum_981(50) ≈ 23, enum_981(100) = 100
                // We approximate this curve here to match CS2 behavior
                const applyVolumeCurve = (v: number): number => {
                    // Quadratic curve: output = input^2 / 100
                    // This matches OSRS enum_981 non-linear volume scaling
                    return Math.round((v * v) / 100);
                };

                if (varpId === VARP_MUSIC_VOLUME) {
                    const curved = applyVolumeCurve(value);
                    const scaled = Math.round((curved * 255) / 100);
                    const vol = Math.max(0, Math.min(1, scaled / 255));
                    mv._musicVolume = vol;
                    mv.musicSystem?.setVolume?.(vol * (mv.masterVolume ?? 1));
                } else if (varpId === VARP_SOUND_EFFECTS_VOLUME) {
                    const curved = applyVolumeCurve(value);
                    const scaled = Math.round((curved * 127) / 100);
                    const vol = Math.max(0, Math.min(1, scaled / 127));
                    mv._sfxVolume = vol;
                    mv.soundEffectSystem?.setVolume?.(vol * (mv.masterVolume ?? 1));
                } else if (varpId === VARP_AREA_SOUNDS_VOLUME) {
                    const curved = applyVolumeCurve(value);
                    const scaled = Math.round((curved * 127) / 100);
                    const vol = Math.max(0, Math.min(1, scaled / 127));
                    mv._ambientVolume = vol;
                    mv.soundEffectSystem?.setAmbientVolume?.(vol * (mv.masterVolume ?? 1));
                } else if (varpId === VARP_MASTER_VOLUME) {
                    const curved = applyVolumeCurve(value);
                    const masterVol = Math.max(0, Math.min(1, curved / 100));
                    mv.masterVolume = masterVol;
                    mv.applyMasterVolume?.();
                }

                // Apply attack option varps to ClientState for menu building
                if (varpId === VARP_OPTION_ATTACK_PRIORITY_PLAYER) {
                    ClientState.playerAttackOption = Math.max(0, Math.min(4, value | 0));
                    console.log(
                        `[varp] Player attack option set to ${ClientState.playerAttackOption}`,
                    );
                } else if (varpId === VARP_OPTION_ATTACK_PRIORITY_NPC) {
                    ClientState.npcAttackOption = Math.max(0, Math.min(3, value | 0));
                    console.log(`[varp] NPC attack option set to ${ClientState.npcAttackOption}`);
                } else if (varpId === VARP_FOLLOWER_INDEX) {
                    const followerIndex = value === 65535 ? -1 : value & 0xffff;
                    ClientState.followerIndex = followerIndex;
                    console.log(`[varp] Follower index set to ${ClientState.followerIndex}`);
                } else if (varpId === VARP_COMBAT_TARGET_PLAYER_INDEX) {
                    ClientState.combatTargetPlayerIndex = value === -1 ? -1 : value & 0x7ff;
                    console.log(
                        `[varp] Combat target player index set to ${ClientState.combatTargetPlayerIndex}`,
                    );
                }
            }
        } catch (err) {
            console.warn("varp handler error", err);
        }
    } else if (msg.type === "varbit") {
        // Server-pushed varbit update
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && mv.varManager) {
                const payload = msg.payload as { varbitId: number; value: number };
                // Use _serverVarpSync flag to prevent sending back to server
                mv._serverVarpSync = true;
                try {
                    const result = mv.varManager.setVarbit?.(
                        payload.varbitId | 0,
                        payload.value | 0,
                    );
                    if (result) {
                        // Trigger var transmit cycle so CS2 scripts with onVarTransmit will update
                        mv.updateVars?.();
                    }
                } finally {
                    mv._serverVarpSync = false;
                }
            }
        } catch (err) {
            console.warn("varbit handler error", err);
        }
    } else if (msg.type === "runClientScript") {
        // Server-pushed runClientScript - execute CS2 script (rsmod parity)
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            const payload = msg.payload as { scriptId: number; args: (number | string)[] };
            if (mv && mv.cs2Vm) {
                const scriptId = payload.scriptId | 0;
                const args = payload.args || [];
                console.log(`[runClientScript] executing script ${scriptId} with args:`, args);
                const script = mv.cs2Vm.context?.loadScript?.(scriptId);
                if (script) {
                    // Separate int and string args
                    const intArgs: number[] = [];
                    const strArgs: string[] = [];
                    for (const arg of args) {
                        if (typeof arg === "number") {
                            intArgs.push(arg | 0);
                        } else if (typeof arg === "string") {
                            strArgs.push(arg);
                        }
                    }
                    mv.cs2Vm.run(script, intArgs, strArgs);
                } else {
                    console.warn(`[runClientScript] script ${scriptId} not found`);
                }
            }
        } catch (err) {
            console.warn("runClientScript handler error", err);
        }
    } else if (msg.type === "if_settext") {
        // Server-pushed IF_SETTEXT - update widget text (OSRS parity)
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            const payload = msg.payload as { uid: number; text: string };
            if (mv && mv.widgetManager) {
                const widget = mv.widgetManager.getWidgetByUid(payload.uid | 0);
                if (widget) {
                    widget.text = payload.text ?? "";
                }
            }
        } catch (err) {
            console.warn("if_settext handler error", err);
        }
    }
}

function initSocketCloseHandler(ws: WebSocket): void {
    ws.addEventListener("close", (evt: CloseEvent) => {
        if (socket !== ws) {
            return;
        }

        socket = null;
        const reasonPart = evt.reason ? `, reason=${evt.reason}` : "";
        // eslint-disable-next-line no-console
        console.log(`[ws] disconnected (code=${evt.code}, clean=${evt.wasClean}${reasonPart})`);
        // Clear the packet writer socket
        setPacketSocket(null);
        lastSkillsState = undefined;
        playerSyncContext = null;
        playerUpdateDecoder = null;
        clearLoginConnectRetryTimer();
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            if (g[WS_GLOBAL_KEY] === ws) g[WS_GLOBAL_KEY] = null;
            const suppress: boolean = !!g[WS_SUPPRESS_RECONNECT_KEY];
            // Determine if we should attempt reconnection
            // Don't reconnect if: suppressed (HMR/logout), clean close with specific reasons, or max attempts reached
            const isIntentionalClose =
                evt.wasClean && (evt.reason === "logout" || evt.reason === "page unload");
            // Only reconnect if we have stored session credentials (were previously logged in)
            const hasSession = sessionUsername !== null && sessionPassword !== null;
            const shouldReconnect =
                hasSession &&
                !suppress &&
                !isIntentionalClose &&
                reconnectAttempts < RECONNECT_MAX_ATTEMPTS;

            console.log(
                `[ws] reconnect check: hasSession=${hasSession}, suppress=${suppress}, intentional=${isIntentionalClose}, attempts=${reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS}, willReconnect=${shouldReconnect}`,
            );

            // Attempt reconnection if appropriate - do this BEFORE notifying listeners
            // so isReconnecting is set correctly
            if (shouldReconnect && !reconnectTimer) {
                isReconnecting = true;
                reconnectAttempts++;
                const delay = Math.min(reconnectDelayMs | 0, RECONNECT_DELAY_MAX_MS);
                // eslint-disable-next-line no-console
                console.log(
                    `[ws] reconnecting in ${delay}ms... (attempt ${reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`,
                );
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    reconnectDelayMs = Math.min(delay * 2, RECONNECT_DELAY_MAX_MS);
                    try {
                        initServerConnection(lastUrl);
                    } catch {}
                }, delay);
            }

            // Notify disconnect listeners
            for (const cb of disconnectListeners) {
                try {
                    cb({
                        code: evt.code,
                        reason: evt.reason || "",
                        willReconnect: shouldReconnect,
                    });
                } catch {}
            }

            // If reconnection not possible and we were trying to reconnect, notify failure
            if (!shouldReconnect && isReconnecting) {
                // Reconnection attempts exhausted - notify failure
                isReconnecting = false;
                // eslint-disable-next-line no-console
                console.log("[ws] reconnection failed after max attempts");
                for (const cb of reconnectFailedListeners) {
                    try {
                        cb();
                    } catch {}
                }
            }
        } catch {}
    });
}

export function disposeServerConnection(reason: string = "hmr refresh"): void {
    try {
        // Prevent any in-flight reconnect timers
        try {
            if (reconnectTimer) clearTimeout(reconnectTimer);
        } catch {}
        reconnectTimer = null;
        clearLoginConnectRetryTimer();
        if (
            socket &&
            (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        ) {
            try {
                socket.close(1000, reason);
            } catch {}
        }
    } finally {
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            if (g[WS_GLOBAL_KEY] === socket) g[WS_GLOBAL_KEY] = null;
            g[WS_SUPPRESS_RECONNECT_KEY] = true;
        } catch {}
        lastInventorySnapshot = undefined;
        lastTradeState = createDefaultTradeState();
        lastGroundItems = undefined;
    }
}

function send(msg: ClientToServer) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // Use binary encoding for all client messages
    const binary = encodeClientMessage(msg as { type: string; payload: any });
    socket.send(binary);
}

export function subscribeTick(cb: (tick: number, time: number) => void): () => void {
    tickListeners.add(cb);
    return () => tickListeners.delete(cb);
}

export function getCurrentTick(): number {
    return currentTick;
}

export function setClientCycleProvider(provider?: () => number): void {
    clientCycleProvider = provider;
}

export function getClientCycle(): number {
    if (clientCycleProvider) {
        try {
            const value = clientCycleProvider();
            if (Number.isFinite(value)) {
                // OSRS PARITY: Never return 0. CS2 scripts use varcint vars that default to 0
                // for dedup checks (e.g., rebuildchatbox checks `if (%varcint1112 = clientclock)`).
                // If clientclock returns 0 and varcint1112 defaults to 0, the script returns early.
                return Math.max(1, (value as number) | 0);
            }
        } catch {
            // Provider errors should not break networking; fall back below.
        }
    }

    const perf = (globalThis as any)?.performance;
    const now =
        perf && typeof perf.now === "function" ? (perf.now.call(perf) as number) : Date.now();
    if (clientCycleFallbackStartMs === 0) {
        clientCycleFallbackStartMs = now;
        const cyclesPerTick = Math.max(1, Math.round((serverTickMs || 600) / CLIENT_TICK_MS));
        // OSRS PARITY: Start at 1, not 0, to avoid dedup collisions with default varcint values
        clientCycleFallbackBaseCycle = Math.max(1, (currentTick | 0) * cyclesPerTick);
    }
    const elapsedMs = Math.max(0, now - clientCycleFallbackStartMs);
    // OSRS PARITY: Never return 0 to avoid dedup collisions with default varcint values
    return Math.max(1, clientCycleFallbackBaseCycle + Math.floor(elapsedMs / CLIENT_TICK_MS));
}

export function getServerTickPhaseNow(): { tick: number; phase: number; tickMs: number } {
    const now = ((performance as any)?.now?.() as number) || Date.now();
    let phase = 0;
    if (serverTickMs > 0) {
        if (lastTickServerTimeMs > 0) {
            const serverNow = now - serverClockOffsetMs;
            const msSinceTick = Math.max(0, serverNow - lastTickServerTimeMs);
            phase = msSinceTick / serverTickMs;
        } else if (lastTickLocalRecvMs > 0) {
            // Fallback: use local time since last tick receive
            const msSinceTick = Math.max(0, now - lastTickLocalRecvMs);
            phase = msSinceTick / serverTickMs;
        } else {
            phase = 0;
        }
    }
    if (!(phase >= 0 && phase <= 1)) phase = Math.max(0, Math.min(1, phase));
    return { tick: currentTick, phase, tickMs: serverTickMs };
}

export async function requestPath(
    from: { x: number; y: number; plane: number },
    to: { x: number; y: number },
    size: number = 1,
    timeoutMs: number = 3000,
): Promise<{ ok: boolean; waypoints?: { x: number; y: number }[]; message?: string }> {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return { ok: false, message: "ws not connected" };
    }
    const id = nextReqId++;
    const payload = { id, from, to, size } as any;
    const p = new Promise<{
        ok: boolean;
        waypoints?: { x: number; y: number }[];
        message?: string;
    }>((resolve) => {
        pending.set(id, resolve);
    });
    send({ type: "pathfind", payload });
    const toPromise = new Promise<{
        ok: boolean;
        waypoints?: { x: number; y: number }[];
        message?: string;
    }>((resolve) => {
        const t = setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                resolve({ ok: false, message: "timeout" });
            }
        }, timeoutMs);
        p.then((r) => {
            clearTimeout(t);
            resolve(r);
        });
    });
    return toPromise;
}

export function sendWalk(to: { x: number; y: number }, run: boolean = false): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "walk", payload: { to, run } });
}

/**
 * Send a varp (player variable) update to the server.
 * Used for transmit varps that need server-side sync.
 */
export function sendVarpTransmit(varpId: number, value: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "varp_transmit", payload: { varpId: varpId | 0, value: value | 0 } } as any);
}

export function sendBankDepositInventory(tab?: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const payload: { tab?: number } = {};
    if (Number.isFinite(tab) && (tab as number) > 0) {
        payload.tab = Math.max(1, Math.min(9, Math.floor(tab as number)));
    }
    send({ type: "bank_deposit_inventory", payload } as any);
}

export function sendBankDepositEquipment(tab?: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const payload: { tab?: number } = {};
    if (Number.isFinite(tab) && (tab as number) > 0) {
        payload.tab = Math.max(1, Math.min(9, Math.floor(tab as number)));
    }
    send({ type: "bank_deposit_equipment", payload } as any);
}

export function sendBankDepositItem(
    slot: number,
    itemId: number,
    quantity: number,
    tab?: number,
): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const normalizedSlot = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, slot | 0));
    const normalizedQty = Math.max(1, Math.floor(Number(quantity) || 0));
    const payload: { slot: number; quantity: number; itemId?: number; tab?: number } = {
        slot: normalizedSlot,
        quantity: normalizedQty,
    };
    if (itemId > 0) {
        payload.itemId = itemId | 0;
    }
    if (Number.isFinite(tab) && (tab as number) > 0) {
        payload.tab = Math.max(1, Math.min(9, Math.floor(tab as number)));
    }
    send({ type: "bank_deposit_item", payload } as any);
}

export function sendBankMove(
    from: number,
    to: number,
    opts: { mode?: "swap" | "insert"; tab?: number } = {},
): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const payload = {
        from: Math.max(0, Math.floor(Number(from) || 0)),
        to: Math.max(0, Math.floor(Number(to) || 0)),
        mode: opts.mode,
        tab: opts.tab,
    };
    send({ type: "bank_move", payload } as any);
}

/**
 * OSRS parity: Send IF_BUTTOND binary packet for widget drag-to-widget operations.
 * Used for bank operations, item rearrangement, etc.
 *
 * Reference: Client.java line 6334 - onDragComplete sends field3250 packet
 *
 * Packet format (16 bytes):
 * - targetWidgetId: IntLE (4 bytes)
 * - sourceItemId: ShortAdd (2 bytes)
 * - targetSlot: Short (2 bytes)
 * - sourceWidgetId: Int (4 bytes)
 * - targetItemId: ShortAdd (2 bytes)
 * - sourceSlot: ShortAdd (2 bytes)
 */
export function sendWidgetDrag(
    sourceWidgetId: number,
    sourceSlot: number,
    sourceItemId: number,
    targetWidgetId: number,
    targetSlot: number,
    targetItemId: number,
): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    // Import packet functions dynamically to avoid circular dependencies
    const { createPacket, queuePacket } = require("./packet");
    const { ClientPacketId } = require("./packet/ClientPacket");

    const pkt = createPacket(ClientPacketId.IF_BUTTOND);
    pkt.packetBuffer.writeIntLE(targetWidgetId | 0);
    pkt.packetBuffer.writeShortAdd(sourceItemId | 0);
    pkt.packetBuffer.writeShort(targetSlot | 0);
    pkt.packetBuffer.writeInt(sourceWidgetId | 0);
    pkt.packetBuffer.writeShortAdd(targetItemId | 0);
    pkt.packetBuffer.writeShortAdd(sourceSlot | 0);
    queuePacket(pkt);
}

export function sendBankCustomQuantity(amount: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    sendResumeCountDialog(amount);
}

export function sendResumeCountDialog(amount: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const raw = Number(amount);
    const normalized = Number.isFinite(raw)
        ? Math.max(-2147483648, Math.min(2147483647, Math.floor(raw)))
        : 0;
    send({ type: "resume_countdialog", payload: { amount: normalized } } as any);
}

export function sendResumeNameDialog(value: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "resume_namedialog", payload: { value: String(value ?? "") } } as any);
}

export function sendResumeStringDialog(value: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "resume_stringdialog", payload: { value: String(value ?? "") } } as any);
}

function sendTradeActionMessage(payload: TradeActionClientPayload): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "trade_action", payload } as any);
}

export function sendTradeOffer(slot: number, itemId: number, quantity: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const normalizedSlot = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, slot | 0));
    const normalizedQty = Math.max(1, Math.floor(Number(quantity) || 0));
    const payload: TradeActionClientPayload = {
        action: "offer",
        slot: normalizedSlot,
        quantity: normalizedQty,
    };
    if (itemId > 0) payload.itemId = itemId | 0;
    sendTradeActionMessage(payload);
}

export function sendTradeRemove(slot: number, quantity: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const normalizedSlot = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, slot | 0));
    const normalizedQty = Math.max(1, Math.floor(Number(quantity) || 0));
    sendTradeActionMessage({ action: "remove", slot: normalizedSlot, quantity: normalizedQty });
}

export function sendTradeAccept(): void {
    sendTradeActionMessage({ action: "accept" });
}

export function sendTradeDecline(): void {
    sendTradeActionMessage({ action: "decline" });
}

export function sendTradeConfirmAccept(): void {
    sendTradeActionMessage({ action: "confirm_accept" });
}

export function sendTradeConfirmDecline(): void {
    sendTradeActionMessage({ action: "confirm_decline" });
}

export function sendTeleport(to: { x: number; y: number }, level?: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "teleport", payload: { to: { x: to.x | 0, y: to.y | 0 }, level } } as any);
}

export function isServerConnected(): boolean {
    return !!socket && socket.readyState === WebSocket.OPEN;
}

export function sendInteractFollow(targetId: number, mode: "follow" | "trade" = "follow"): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "interact", payload: { mode, targetId: targetId | 0 } } as any);
}
export function sendInteractStop(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "interact_stop", payload: {} } as any);
}

export function sendNpcAttack(npcId: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (npcId == null) return;
    send({ type: "npc_attack", payload: { npcId: npcId | 0 } } as any);
}

export function sendNpcInteract(npcId: number, option?: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (npcId == null) return;
    const payload: any = { npcId: npcId | 0 };
    if (option) payload.option = option;
    send({ type: "npc_interact", payload } as any);
}

export function sendLocInteract(
    id: number,
    tile: { x: number; y: number },
    level?: number,
    action?: string,
): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({
        type: "loc_interact",
        payload: { id: id | 0, tile: { x: tile.x | 0, y: tile.y | 0 }, level, action },
    } as any);
}

export function sendWidgetOpen(groupId: number, opts: { modal?: boolean } = {}): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({
        type: "widget",
        payload: { action: "open", groupId: groupId | 0, modal: !!opts.modal },
    } as any);
}

export function sendWidgetClose(groupId: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "widget", payload: { action: "close", groupId: groupId | 0 } } as any);
}

function normalizeWidgetActionPayload(
    payload: WidgetActionClientPayload,
): WidgetActionClientPayload | undefined {
    if (!payload) return undefined;
    const widgetId = Number(payload.widgetId);
    const groupId = Number(payload.groupId);
    const childId = Number(payload.childId);
    if (!Number.isFinite(widgetId) || !Number.isFinite(groupId) || !Number.isFinite(childId)) {
        return undefined;
    }
    const normalized: WidgetActionClientPayload = {
        widgetId: widgetId | 0,
        groupId: groupId | 0,
        childId: childId | 0,
    };
    if (payload.option !== undefined) normalized.option = String(payload.option ?? "");
    if (payload.target !== undefined) normalized.target = String(payload.target ?? "");
    if (typeof payload.isPrimary === "boolean") normalized.isPrimary = !!payload.isPrimary;
    if (Number.isFinite(payload.opId)) normalized.opId = Math.floor(payload.opId as number);
    if (Number.isFinite(payload.cursorX))
        normalized.cursorX = Math.floor(payload.cursorX as number);
    if (Number.isFinite(payload.cursorY))
        normalized.cursorY = Math.floor(payload.cursorY as number);
    if (Number.isFinite(payload.slot)) normalized.slot = Math.floor(payload.slot as number);
    if (Number.isFinite(payload.itemId)) normalized.itemId = Math.floor(payload.itemId as number);
    return normalized;
}

/**
 * OSRS parity: Map opId (1-10) to IF_BUTTON packet IDs.
 * Op0 (targetVerb) uses IF_BUTTONT, handled separately.
 */
const OP_TO_IF_BUTTON: Record<number, number> = {
    1: 23, // IF_BUTTON1
    2: 25, // IF_BUTTON2
    3: 31, // IF_BUTTON3
    4: 63, // IF_BUTTON4
    5: 69, // IF_BUTTON5
    6: 11, // IF_BUTTON6
    7: 14, // IF_BUTTON7
    8: 19, // IF_BUTTON8
    9: 20, // IF_BUTTON9
    10: 84, // IF_BUTTON10
};

/**
 * OSRS parity: Send widget action as binary IF_BUTTON packet.
 * Reference: class31.java menuAction method - sends IF_BUTTON1-10 packets for widget ops.
 *
 * Packet format (8 bytes):
 * - widgetId: int (4 bytes)
 * - slot: short (2 bytes)
 * - itemId: short (2 bytes)
 */
export function sendWidgetAction(payload: WidgetActionClientPayload): void {
    const normalized = normalizeWidgetActionPayload(payload);
    if (!normalized) {
        return;
    }
    // OSRS parity: PlayerDesign (group 679) is client-only. Only the final APPEARANCE_SET packet is sent.
    if ((((normalized.widgetId ?? 0) >>> 16) & 0xffff) === 679) {
        return;
    }

    const opId = normalized.opId ?? 1;
    const packetId = OP_TO_IF_BUTTON[opId];

    if (!packetId) {
        return;
    }

    // Import packet functions dynamically to avoid circular dependencies
    const { createPacket, queuePacket } = require("./packet");

    const pkt = createPacket(packetId);
    pkt.packetBuffer.writeInt(normalized.widgetId);
    // OSRS parity: For IF_BUTTON packets, slot is 65535 when unused.
    // Using 0 breaks server-side routing that distinguishes "no slot" (static component)
    // from "slot index" (inventory/dynamic child index).
    pkt.packetBuffer.writeShort(normalized.slot ?? 0xffff);
    pkt.packetBuffer.writeShort(normalized.itemId ?? -1);
    queuePacket(pkt);
}

/**
 * Direct widget_action transport for custom client-driven widget interactions that need
 * richer payload data than the IF_BUTTON packets carry, such as live text updates.
 */
export function sendWidgetActionMessage(payload: WidgetActionClientPayload): void {
    const normalized = normalizeWidgetActionPayload(payload);
    if (!normalized) {
        return;
    }
    send({ type: "widget_action", payload: normalized });
}

export function sendItemSpawnerSearchQuery(query: string): void {
    send({
        type: "item_spawner_search",
        payload: {
            query: String(query ?? ""),
        },
    });
}

/**
 * IF_TRIGGEROPLOCAL (2929) forwarding packet.
 * Payload format mirrors class7.method121 (ClientPacket id 30, var-short).
 */
export function sendIfTriggerOpLocal(
    widgetUid: number,
    childIndex: number,
    itemId: number,
    opcodeParam: number,
    args: any[],
): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!Number.isFinite(widgetUid) || !Number.isFinite(childIndex)) return;

    // Import packet functions dynamically to avoid circular dependencies
    const { createPacket, queuePacket } = require("./packet");
    const { ClientPacketId } = require("./packet/ClientPacket");

    const pkt = createPacket(ClientPacketId.IF_TRIGGEROPLOCAL);
    const buf = pkt.packetBuffer;

    // Inner var-short payload section for this packet's argument block.
    buf.writeShort(0);
    const blockStart = buf.offset;

    // Fixed fields: intLE, shortLE, intLE, shortLE
    buf.writeIntLE(opcodeParam | 0);
    buf.writeShortLE(childIndex | 0);
    buf.writeIntLE(widgetUid | 0);
    buf.writeShortLE(itemId | 0);

    const objectArgs = Array.isArray(args) ? args : [];
    for (let i = 0; i < objectArgs.length; i++) {
        const arg = objectArgs[i];
        if (typeof arg === "number" && Number.isFinite(arg)) {
            // method12408 parity: zigzag + LEB128-style varint.
            let v = (((arg | 0) << 1) ^ ((arg | 0) >> 31)) >>> 0;
            while ((v & ~0x7f) !== 0) {
                buf.writeByte((v & 0x7f) | 0x80);
                v >>>= 7;
            }
            buf.writeByte(v & 0x7f);
        } else if (typeof arg === "string") {
            buf.writeStringCp1252NullTerminated(arg);
        } else if (arg == null) {
            buf.writeByte(0);
        }
    }

    const blockLength = buf.offset - blockStart;
    buf.writeLengthShort(blockLength);
    queuePacket(pkt);
}

/**
 * PlayerDesign (679): send final appearance selection to server.
 * This mirrors OSRS behavior where the client mutates appearance locally while editing,
 * and only transmits the final selection on confirm.
 */
export function sendPlayerDesignConfirm(appearance: {
    gender: number;
    colors?: number[];
    kits?: number[];
}): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!appearance || !Number.isFinite(appearance.gender)) return;

    // Import packet functions dynamically to avoid circular dependencies
    const { createPacket, queuePacket } = require("./packet");
    const { ClientPacketId } = require("../shared/network/ClientPacketId");

    // OSRS parity: ClientPacket.field3200 (opcode 37, len 13)
    // Payload: gender (1), kits[7] (7, -1=0xff), colors[5] (5)
    const pkt = createPacket(ClientPacketId.APPEARANCE_SET);
    const gender = (appearance.gender | 0) === 1 ? 1 : 0;
    pkt.packetBuffer.writeByte(gender);

    const kits = Array.isArray(appearance.kits) ? appearance.kits : [];
    for (let i = 0; i < 7; i++) {
        const v = Number.isFinite(kits[i]) ? kits[i] | 0 : -1;
        pkt.packetBuffer.writeByte(v);
    }

    const colors = Array.isArray(appearance.colors) ? appearance.colors : [];
    for (let i = 0; i < 5; i++) {
        const v = Number.isFinite(colors[i]) ? colors[i] | 0 : 0;
        pkt.packetBuffer.writeByte(v);
    }

    queuePacket(pkt);
}

export function sendSmithingMake(recipeId: string, mode: "smelt" | "forge"): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (typeof recipeId !== "string" || recipeId.length === 0) return;
    send({ type: "smithing_make", payload: { recipeId, mode } } as any);
}

export function sendSmithingSetMode(mode: number, customAmount?: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!Number.isFinite(mode)) return;
    const payload: { mode: number; custom?: number } = { mode: Math.max(0, Math.min(4, mode | 0)) };
    if (Number.isFinite(customAmount) && (customAmount as number) > 0) {
        payload.custom = Math.max(1, Math.min(2147483647, (customAmount as number) | 0));
    }
    send({ type: "smithing_mode", payload } as any);
}

// Dev-only helper to request projectile snapshot from renderer clients
export function requestProjectileDebugSnapshot(
    requestId: number = Math.floor(Math.random() * 1e9),
): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "debug", payload: { kind: "projectiles_request", requestId } } as any);
}

export function subscribePlayerSync(cb: (frame: PlayerSyncFrame) => void): () => void {
    playerSyncListeners.add(cb);
    return () => playerSyncListeners.delete(cb);
}

export function subscribeHitsplats(cb: (payload: HitsplatServerPayload) => void): () => void {
    hitsplatListeners.add(cb);
    return () => hitsplatListeners.delete(cb);
}

export function subscribeNpcInfo(cb: (payload: NpcInfoPayload) => void): () => void {
    npcInfoListeners.add(cb);
    return () => npcInfoListeners.delete(cb);
}

export function subscribeSpellResults(cb: (payload: SpellResultPayload) => void): () => void {
    spellResultListeners.add(cb);
    if (lastSpellResult) {
        try {
            cb({
                ...lastSpellResult,
                runesConsumed: lastSpellResult.runesConsumed
                    ? lastSpellResult.runesConsumed.map((entry) => ({ ...entry }))
                    : undefined,
                runesRefunded: lastSpellResult.runesRefunded
                    ? lastSpellResult.runesRefunded.map((entry) => ({ ...entry }))
                    : undefined,
                tile: lastSpellResult.tile ? { ...lastSpellResult.tile } : undefined,
                modifiers: lastSpellResult.modifiers ? { ...lastSpellResult.modifiers } : undefined,
            });
        } catch {}
    }
    return () => spellResultListeners.delete(cb);
}

export function subscribeProjectiles(cb: (spawn: ProjectileLaunch) => void): () => void {
    projectileListeners.add(cb);
    return () => projectileListeners.delete(cb);
}

export function sendFaceRot(rot: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "face", payload: { rot: rot | 0 } } as any);
}
export function sendFaceTile(tile: { x: number; y: number }): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({ type: "face", payload: { tile: { x: tile.x | 0, y: tile.y | 0 } } } as any);
}

export function subscribeAnim(
    cb: (anim: {
        idle?: number;
        walk?: number;
        walkBack?: number;
        walkLeft?: number;
        walkRight?: number;
        turnLeft?: number;
        turnRight?: number;
        run?: number;
        runBack?: number;
        runLeft?: number;
        runRight?: number;
    }) => void,
): () => void {
    animListeners.add(cb);
    if (lastAnim) {
        try {
            cb(lastAnim);
        } catch {}
    }
    return () => animListeners.delete(cb);
}

export function subscribeWelcome(
    cb: (info: { tickMs: number; serverTime: number }) => void,
): () => void {
    welcomeListeners.add(cb);
    if (lastWelcome) {
        try {
            cb(lastWelcome);
        } catch {}
    }
    return () => welcomeListeners.delete(cb);
}

// ========== Login Functions ==========

/**
 * Set whether to auto-send handshake on connect.
 * When false, caller must manually call sendHandshake() after login success.
 */
export function setAutoSendHandshake(auto: boolean): void {
    autoSendHandshake = auto;
}

/**
 * Subscribe to login response events from server.
 */
export function subscribeLoginResponse(
    cb: (info: {
        success: boolean;
        error?: string;
        errorCode?: number;
        displayName?: string;
    }) => void,
): () => void {
    loginResponseListeners.add(cb);
    return () => loginResponseListeners.delete(cb);
}

/**
 * Subscribe to logout response events from server.
 */
export function subscribeLogoutResponse(
    cb: (info: { success: boolean; reason?: string }) => void,
): () => void {
    logoutResponseListeners.add(cb);
    return () => logoutResponseListeners.delete(cb);
}

/**
 * Send login credentials to server.
 * If the socket isn't open (e.g., after logout), this will reconnect first.
 */
export function sendLogin(username: string, password: string, revision: number = 0): void {
    // Store credentials for session resumption on reconnect
    sessionUsername = username;
    sessionPassword = password;
    sessionRevision = revision;
    const attemptId = ++loginConnectAttemptId;

    // Clear suppress flag - user is intentionally logging in
    try {
        const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
        g[WS_SUPPRESS_RECONNECT_KEY] = false;
    } catch {}

    const sendLoginPayload = () => {
        send({
            type: "login",
            payload: { username, password, revision },
        } as any);
    };

    const attachLoginOnOpen = (targetSocket: WebSocket) => {
        const sendLoginOnOpen = () => {
            targetSocket.removeEventListener("open", sendLoginOnOpen);
            if (attemptId !== loginConnectAttemptId) return;
            if (socket !== targetSocket || targetSocket.readyState !== WebSocket.OPEN) return;
            clearLoginConnectRetryTimer();
            sendLoginPayload();
        };

        targetSocket.addEventListener("open", sendLoginOnOpen);
    };

    const connectForLogin = (url: string, forceFreshSocket: boolean) => {
        const currentSocket = socket;
        if (
            forceFreshSocket &&
            currentSocket &&
            (currentSocket.readyState === WebSocket.OPEN ||
                currentSocket.readyState === WebSocket.CONNECTING)
        ) {
            socket = null;
            try {
                currentSocket.close(1000, "login retry");
            } catch {}
        }

        initServerConnection(url);
        if (socket) {
            if (socket.readyState === WebSocket.OPEN) {
                if (attemptId === loginConnectAttemptId) {
                    clearLoginConnectRetryTimer();
                    sendLoginPayload();
                }
            } else {
                attachLoginOnOpen(socket);
            }
        }
    };

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        // Socket not open - need to reconnect first
        console.log("[ws] Socket not open, reconnecting before login...");
        clearLoginConnectRetryTimer();
        connectForLogin(lastUrl, false);

        loginConnectRetryTimer = setTimeout(() => {
            loginConnectRetryTimer = null;
            if (attemptId !== loginConnectAttemptId) return;
            if (socket && socket.readyState === WebSocket.OPEN) return;

            console.log(
                `[ws] Login connect not established after ${LOGIN_CONNECT_RETRY_DELAY_MS}ms, retrying direct websocket connect...`,
            );
            connectForLogin(DEFAULT_URL, true);
        }, LOGIN_CONNECT_RETRY_DELAY_MS);
        return;
    }

    clearLoginConnectRetryTimer();
    sendLoginPayload();
}

/**
 * Send logout request to server.
 * Server will check if player can logout (not in combat, etc.) and respond.
 * If approved, server saves player state and closes connection.
 * Use subscribeLogoutResponse to handle the server's response.
 */
export function sendLogout(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn("[ws] Cannot send logout - socket not open");
        return;
    }
    send({ type: "logout", payload: {} });
}

/**
 * Suppress reconnection after server-approved logout.
 * Called by the client when logout is confirmed.
 */
export function suppressReconnection(): void {
    // Clear session credentials - user logged out intentionally
    sessionUsername = null;
    sessionPassword = null;
    clearLoginConnectRetryTimer();
    try {
        const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
        g[WS_SUPPRESS_RECONNECT_KEY] = true;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    } catch {}
}

/**
 * Manually send handshake (used after login success when autoSendHandshake is false).
 */
export function sendHandshake(name?: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn("[ws] Cannot send handshake - socket not open");
        return;
    }
    const { isMobileMode } = require("../util/DeviceUtil");
    const clientType = isMobileMode ? 1 : 0;
    send({
        type: "handshake",
        payload: { clientType, name: name || "Player" },
    });
}

export function sendEmote(index: number, loop: boolean = false): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const idx = Math.max(0, index | 0);
    send({ type: "emote", payload: { index: idx, loop: !!loop } } as any);
}

export function sendInventoryUse(
    slot: number,
    itemId: number,
    quantity: number = 1,
    option: string = "Use",
): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send({
        type: "inventory_use",
        payload: {
            slot: Math.max(0, slot | 0),
            itemId: itemId | 0,
            quantity: Math.max(0, quantity | 0),
            option,
        },
    } as any);
}

export function sendInventoryUseOn(payload: {
    slot: number;
    itemId: number;
    target:
        | { kind: "npc"; id?: number; tile?: { x: number; y: number }; plane?: number }
        | { kind: "loc"; id: number; tile?: { x: number; y: number }; plane?: number }
        | { kind: "obj"; id: number; tile?: { x: number; y: number }; plane?: number }
        | { kind: "player"; id?: number; tile?: { x: number; y: number }; plane?: number }
        | { kind: "inv"; slot: number; itemId: number };
}): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
        const clean: any = {
            slot: Math.max(0, payload.slot | 0),
            itemId: payload.itemId | 0,
        };
        const t: any = payload.target || {};
        if (t && typeof t.kind === "string") {
            clean.target = { kind: t.kind } as any;
            if (typeof t.id === "number") clean.target.id = t.id | 0;
            if (t.tile && typeof t.tile.x === "number" && typeof t.tile.y === "number") {
                clean.target.tile = { x: t.tile.x | 0, y: t.tile.y | 0 };
            }
            if (typeof t.plane === "number") clean.target.plane = t.plane | 0;
            if (t.kind === "inv") {
                clean.target.slot = Math.max(0, (t.slot as number) | 0);
                clean.target.itemId = (t.itemId as number) | 0;
            }
        }
        send({ type: "inventory_use_on", payload: clean } as any);
    } catch {}
}

export function sendInventoryMove(from: number, to: number): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const src = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, from | 0));
    const dst = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, to | 0));
    if (src === dst) return;
    send({ type: "inventory_move", payload: { from: src, to: dst } } as any);
}

export function sendGroundItemAction(payload: GroundItemActionPayload): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const clean: GroundItemActionPayload = {
        stackId: Math.max(1, payload.stackId | 0),
        itemId: payload.itemId | 0,
        tile: {
            x: Number(payload.tile?.x) | 0,
            y: Number(payload.tile?.y) | 0,
            level: Number.isFinite(payload.tile?.level) ? (payload.tile?.level as number) | 0 : 0,
        },
    };
    if (payload.quantity !== undefined) {
        clean.quantity = Math.max(1, payload.quantity | 0);
    }
    if (payload.option) {
        clean.option = String(payload.option);
    }
    send({ type: "ground_item_action", payload: clean } as any);
}

export function sendChat(
    text: string,
    messageType: "public" | "game" = "public",
    chatType: number = 0,
): void {
    console.log(`[sendChat] Attempting to send: "${text}"`);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.log("[sendChat] Socket not ready");
        return;
    }
    const filtered = sanitizeChatText(String(text ?? ""));
    if (!filtered) {
        console.log("[sendChat] Filtered text is empty");
        return;
    }

    const formatting = parseOutgoingPublicChat(filtered);
    const payloadText = formatting.text;
    if (!payloadText) {
        console.log("[sendChat] Payload text is empty after formatting");
        return;
    }

    console.log(`[sendChat] Sending to server: "${payloadText}"`);
    send({
        type: "chat",
        payload: {
            text: payloadText,
            messageType,
            chatType: chatType | 0,
            colorId: formatting.colorId | 0,
            effectId: formatting.effectId | 0,
            pattern: formatting.pattern ? Array.from(formatting.pattern) : undefined,
        },
    } as any);
}

export function subscribeHandshake(
    cb: (info: {
        id: number;
        appearance?: { gender: number; colors?: number[]; kits?: number[]; equip?: number[] };
        name?: string;
        chatIcons?: number[];
        chatPrefix?: string;
    }) => void,
): () => void {
    handshakeListeners.add(cb);
    if (lastHandshake) {
        try {
            cb(lastHandshake);
        } catch {}
    }
    return () => handshakeListeners.delete(cb);
}

export function subscribeInventory(cb: (update: InventoryServerUpdate) => void): () => void {
    inventoryListeners.add(cb);
    if (lastInventorySnapshot) {
        cb({
            kind: "snapshot",
            slots: lastInventorySnapshot.map((slot) => ({ ...slot })),
        });
    }
    return () => inventoryListeners.delete(cb);
}

export function subscribeCollectionLog(
    cb: (update: CollectionLogServerPayload) => void,
): () => void {
    collectionLogListeners.add(cb);
    if (lastCollectionLogSnapshot) {
        cb({
            kind: "snapshot",
            slots: lastCollectionLogSnapshot.map((slot) => ({ ...slot })),
        });
    }
    return () => collectionLogListeners.delete(cb);
}

export function subscribeBank(cb: (update: BankServerUpdate) => void): () => void {
    bankListeners.add(cb);
    if (lastBankState) {
        try {
            cb({
                kind: "snapshot",
                capacity: lastBankState.capacity,
                slots: lastBankState.slots.map((slot) => ({ ...slot })),
            });
        } catch (err) {
            console.warn("bank listener error", err);
        }
    }
    return () => bankListeners.delete(cb);
}

export function subscribeShop(cb: (state: ShopWindowState) => void): () => void {
    shopListeners.add(cb);
    try {
        cb(cloneShopState(lastShopState));
    } catch (err) {
        console.warn("shop listener error", err);
    }
    return () => shopListeners.delete(cb);
}

export function subscribeSmithing(cb: (state: SmithingWindowState) => void): () => void {
    smithingListeners.add(cb);
    try {
        cb(cloneSmithingState(lastSmithingState));
    } catch (err) {
        console.warn("smelting listener error", err);
    }
    return () => smithingListeners.delete(cb);
}

export function subscribeTrade(cb: (state: TradeWindowState) => void): () => void {
    tradeListeners.add(cb);
    try {
        cb(cloneTradeState(lastTradeState));
    } catch (err) {
        console.warn("trade listener error", err);
    }
    return () => tradeListeners.delete(cb);
}

export function subscribeGroundItems(cb: (payload: GroundItemsServerPayload) => void): () => void {
    groundItemListeners.add(cb);
    if (lastGroundItems) {
        try {
            cb(cloneGroundItemsPayload(lastGroundItems));
        } catch (err) {
            console.warn("ground item listener error", err);
        }
    }
    return () => groundItemListeners.delete(cb);
}

export function subscribeChatMessages(cb: (msg: ChatMessageEvent) => void): () => void {
    chatMessageListeners.add(cb);
    return () => chatMessageListeners.delete(cb);
}

export function subscribeNotifications(cb: (event: NotificationEvent) => void): () => void {
    notificationListeners.add(cb);
    return () => notificationListeners.delete(cb);
}

/**
 * Emit a client-side chat message (for testing purposes).
 * This triggers all chat message listeners as if a message came from the server.
 */
export function emitTestChatMessage(text: string, messageType: string = "game"): void {
    const event: ChatMessageEvent = {
        messageType,
        text,
    };
    for (const cb of chatMessageListeners) cb(event);
}

export function subscribeSkills(cb: (update: SkillsUpdateEvent) => void): () => void {
    skillsListeners.add(cb);
    if (lastSkillsState) {
        try {
            cb({
                kind: "snapshot",
                totalLevel: lastSkillsState.totalLevel,
                combatLevel: lastSkillsState.combatLevel,
                skills: Array.from(lastSkillsState.byId.values()).map((entry) => ({ ...entry })),
            });
        } catch (err) {
            console.warn("skills listener error", err);
        }
    }
    return () => skillsListeners.delete(cb);
}

export function getLatestSkills():
    | { totalLevel: number; combatLevel: number; skills: SkillEntryMessage[] }
    | undefined {
    if (!lastSkillsState) return undefined;
    return {
        totalLevel: lastSkillsState.totalLevel,
        combatLevel: lastSkillsState.combatLevel,
        skills: Array.from(lastSkillsState.byId.values()).map((entry) => ({ ...entry })),
    };
}

export function subscribeCombat(cb: (payload: CombatStatePayload) => void): () => void {
    return combatStateStore.subscribe(cb);
}

export function getLatestCombatState(): CombatStatePayload | undefined {
    return combatStateStore.getLatest();
}

export function subscribeRunEnergy(cb: (state: RunEnergyState) => void): () => void {
    runEnergyListeners.add(cb);
    if (lastRunEnergyState) {
        try {
            cb(cloneRunEnergyState(lastRunEnergyState));
        } catch (err) {
            console.warn("run energy listener error", err);
        }
    }
    return () => runEnergyListeners.delete(cb);
}

export function getLatestRunEnergy(): RunEnergyState | undefined {
    return lastRunEnergyState ? cloneRunEnergyState(lastRunEnergyState) : undefined;
}

export function getLatestShopState(): ShopWindowState {
    return cloneShopState(lastShopState);
}

export function getLatestSmithingState(): SmithingWindowState {
    return cloneSmithingState(lastSmithingState);
}

export function getLatestTradeState(): TradeWindowState {
    return cloneTradeState(lastTradeState);
}

export function getLatestSpellResult(): SpellResultPayload | undefined {
    if (!lastSpellResult) return undefined;
    return {
        ...lastSpellResult,
        runesConsumed: lastSpellResult.runesConsumed
            ? lastSpellResult.runesConsumed.map((entry) => ({ ...entry }))
            : undefined,
        runesRefunded: lastSpellResult.runesRefunded
            ? lastSpellResult.runesRefunded.map((entry) => ({ ...entry }))
            : undefined,
        tile: lastSpellResult.tile ? { ...lastSpellResult.tile } : undefined,
        modifiers: lastSpellResult.modifiers ? { ...lastSpellResult.modifiers } : undefined,
    };
}

export function subscribeWidgetEvents(cb: (payload: WidgetServerPayload) => void): () => void {
    widgetListeners.add(cb);
    return () => widgetListeners.delete(cb);
}

const spotListeners = new Set<(payload: SpotAnimationPayload) => void>();
export function subscribeSpot(cb: (payload: SpotAnimationPayload) => void): () => void {
    spotListeners.add(cb);
    return () => spotListeners.delete(cb);
}

export function subscribeSound(
    cb: (payload: {
        soundId: number;
        x?: number;
        y?: number;
        level?: number;
        loops?: number;
        delay?: number;
        /** SOUND_AREA: radius in tiles (0-15, default 0 = no distance falloff) */
        radius?: number;
        /** SOUND_AREA: volume (0-255, default 255 = full volume) */
        volume?: number;
    }) => void,
): () => void {
    soundListeners.add(cb);
    return () => soundListeners.delete(cb);
}

export function subscribePlaySong(
    cb: (payload: {
        trackId: number;
        fadeOutDelay?: number;
        fadeOutDuration?: number;
        fadeInDelay?: number;
        fadeInDuration?: number;
    }) => void,
): () => void {
    playSongListeners.add(cb);
    return () => playSongListeners.delete(cb);
}

export function subscribePlayJingle(
    cb: (payload: { jingleId: number; delay?: number }) => void,
): () => void {
    playJingleListeners.add(cb);
    return () => playJingleListeners.delete(cb);
}

export function subscribeDisconnect(
    cb: (evt: { code: number; reason: string; willReconnect: boolean }) => void,
): () => void {
    disconnectListeners.add(cb);
    return () => disconnectListeners.delete(cb);
}

export function subscribeReconnectFailed(cb: () => void): () => void {
    reconnectFailedListeners.add(cb);
    return () => reconnectFailedListeners.delete(cb);
}

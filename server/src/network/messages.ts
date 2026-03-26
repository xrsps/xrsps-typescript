import type { ProjectileLaunch } from "../../../src/shared/projectiles/ProjectileLaunch";
import type { WidgetAction } from "../widgets/WidgetManager";
import type { RoutedMessage } from "./MessageRouter";
import { sendMessage, serverEncoder } from "./packet/BinaryProtocol";

export type Appearance = {
    gender: number;
    colors?: number[];
    kits?: number[];
    equip?: number[];
    /** Equipment quantities; currently only meaningful for the AMMO slot. */
    equipQty?: number[];
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

export type InventorySlotMessage = { slot: number; itemId: number; quantity: number };

export type InventoryServerUpdate =
    | { kind: "snapshot"; slots: InventorySlotMessage[] }
    | { kind: "slot"; slot: InventorySlotMessage };

export type BankSlotMessage = {
    slot: number;
    itemId: number;
    quantity: number;
    placeholder?: boolean;
    tab?: number;
    filler?: boolean;
};

export type BankServerUpdate =
    | { kind: "snapshot"; capacity: number; slots: BankSlotMessage[] }
    | { kind: "slot"; slot: BankSlotMessage };

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

export type TradeOfferMessage = {
    slot: number;
    itemId: number;
    quantity: number;
};

export type TradePartyMessage = {
    playerId?: number;
    name?: string;
    offers: TradeOfferMessage[];
    accepted?: boolean;
    confirmAccepted?: boolean;
};

export type TradeServerPayload =
    | {
          kind: "request";
          fromId: number;
          fromName?: string;
      }
    | {
          kind: "open" | "update";
          sessionId: string;
          stage: "offer" | "confirm";
          self: TradePartyMessage;
          other: TradePartyMessage;
          info?: string;
      }
    | {
          kind: "close";
          reason?: string;
      };

export type WidgetActionRequest = {
    widgetId: number;
    groupId: number;
    childId: number;
    option?: string;
    target?: string;
    opId?: number;
    buttonNum?: number;
    cursorX?: number;
    cursorY?: number;
    isPrimary?: boolean;
    slot?: number;
    itemId?: number;
};

export type TradeActionClientPayload =
    | { action: "offer"; slot: number; quantity: number; itemId?: number }
    | { action: "remove"; slot: number; quantity: number }
    | { action: "accept" }
    | { action: "decline" }
    | { action: "confirm_accept" }
    | { action: "confirm_decline" };

export type GroundItemActionPayload = {
    stackId: number;
    tile: { x: number; y: number; level?: number };
    itemId: number;
    quantity?: number;
    option?: string; // deprecated, use opNum
    opNum?: number; // 1-5 maps to ObjType.groundActions[opNum-1]
    modifierFlags?: number;
};

export type WidgetServerPayload = WidgetAction;

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

export type CombatStatePayload = {
    weaponCategory: number;
    weaponItemId?: number;
    autoRetaliate?: boolean;
    activeStyle?: number;
    activePrayers?: string[];
    activeSpellId?: number;
    specialEnergy?: number;
    specialActivated?: boolean;
    quickPrayers?: string[];
    quickPrayersEnabled?: boolean;
};

export type RunEnergyPayload = {
    percent: number;
    units?: number;
    running?: boolean;
    staminaTicks?: number;
    staminaMultiplier?: number;
    staminaTickMs?: number;
};

export type SpellCastModifiers = {
    isAutocast?: boolean;
    defensive?: boolean;
    queued?: boolean;
    castMode?: "manual" | "autocast" | "defensive_autocast";
};

export type SpellCastPayloadBase = {
    // OSRS parity: Use widget references instead of hardcoded spell ID
    spellbookGroupId?: number;
    widgetChildId?: number;
    selectedSpellWidgetId?: number;
    selectedSpellChildIndex?: number;
    selectedSpellItemId?: number;
    spellId?: number; // Legacy fallback for compatibility
    tile?: { x: number; y: number };
    plane?: number;
    modifierFlags?: number;
    modifiers?: SpellCastModifiers;
};

export type SpellCastNpcPayload = SpellCastPayloadBase & { npcId: number };
export type SpellCastPlayerPayload = SpellCastPayloadBase & { playerId: number };
export type SpellCastLocPayload = SpellCastPayloadBase & { locId: number };
export type SpellCastObjPayload = SpellCastPayloadBase & { objId: number };
export type SpellCastItemPayload = {
    // OSRS parity: Use widget references instead of hardcoded spell ID
    spellbookGroupId?: number;
    widgetChildId?: number;
    selectedSpellWidgetId?: number;
    selectedSpellChildIndex?: number;
    selectedSpellItemId?: number;
    spellId?: number; // Legacy fallback for compatibility
    slot: number;
    itemId: number;
    widgetId?: number;
    tile?: { x: number; y: number };
    plane?: number;
    modifierFlags?: number;
    modifiers?: SpellCastModifiers;
};

export type SpellRuneDelta = { itemId: number; quantity: number };

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
    targetType: "npc" | "player" | "loc" | "obj" | "tile" | "item";
    targetId?: number;
    tile?: { x: number; y: number; plane?: number };
    modifiers?: SpellCastModifiers;
    runesConsumed?: SpellRuneDelta[];
    runesRefunded?: SpellRuneDelta[];
    hitDelay?: number;
    impactSpotAnim?: number;
    castSpotAnim?: number;
    splashSpotAnim?: number;
    damage?: number;
    maxHit?: number;
    accuracy?: number;
};

export type HitsplatServerPayload = {
    targetType: "player" | "npc";
    targetId: number;
    damage: number;
    style?: number;
    type2?: number;
    damage2?: number;
    /** Extra hitsplat delay in client cycles (20ms units). */
    delayCycles?: number;
    tick?: number;
};

export type SoundEffectPayload = {
    soundId: number;
    x?: number;
    y?: number;
    level?: number;
    loops?: number;
    delay?: number;
    /** SOUND_AREA: radius in tiles (0-15) for client-side distance falloff */
    radius?: number;
    /** SOUND_AREA: volume (0-255, default 255) */
    volume?: number;
};

export type LoginResponsePayload = {
    success: boolean;
    errorCode?: number;
    error?: string;
    displayName?: string;
};

export type LogoutResponsePayload = {
    success: boolean;
    reason?: string;
};

export type NotificationPayload = {
    kind?: string;
    title?: string;
    message?: string;
    itemId?: number;
    quantity?: number;
    durationMs?: number;
};

export type CollectionLogSlotMessage = {
    slot: number;
    itemId: number;
    quantity: number;
};

export type CollectionLogServerPayload = {
    kind: "snapshot";
    slots: CollectionLogSlotMessage[];
};

export type ServerToClient =
    | { type: "welcome"; payload: { tickMs: number; serverTime: number } }
    | { type: "tick"; payload: { tick: number; time: number } }
    | { type: "destination"; payload: { worldX: number; worldY: number } }
    | {
          type: "path";
          payload: {
              id: number;
              ok: boolean;
              waypoints?: { x: number; y: number }[];
              message?: string;
          };
      }
    | { type: "bank"; payload: BankServerUpdate }
    | {
          type: "player_sync";
          payload: {
              baseX: number;
              baseY: number;
              localIndex: number;
              loopCycle: number;
              packet?: string | number[];
          };
      }
    | {
          type: "anim";
          payload: PlayerAnimPayload;
      }
    | {
          type: "handshake";
          payload: {
              id: number;
              appearance?: Appearance;
              name?: string;
              chatIcons?: number[];
              chatPrefix?: string;
          };
      }
    | { type: "inventory"; payload: InventoryServerUpdate }
    | { type: "skills"; payload: SkillsServerPayload }
    | { type: "combat"; payload: CombatStatePayload }
    | { type: "run_energy"; payload: RunEnergyPayload }
    | { type: "hitsplat"; payload: HitsplatServerPayload }
    | {
          type: "spot";
          payload: {
              spotId: number;
              playerId?: number;
              npcId?: number;
              height?: number;
              delay?: number;
          };
      }
    | { type: "widget"; payload: WidgetServerPayload }
    | { type: "shop"; payload: ShopServerPayload }
    | { type: "ground_items"; payload: GroundItemsServerPayload }
    | { type: "trade"; payload: TradeServerPayload }
    | {
          type: "npc_info";
          payload: { loopCycle: number; large: boolean; packet: string | number[] };
      }
    | {
          type: "chat";
          payload: {
              messageType:
                  | "game"
                  | "public"
                  | "private_in"
                  | "private_out"
                  | "channel"
                  | "clan"
                  | "trade"
                  | "server";
              playerId?: number;
              from?: string;
              prefix?: string;
              text: string;
          };
      }
    | {
          type: "loc_change";
          payload: {
              oldId: number;
              newId: number;
              /** @deprecated Use oldTile instead. Kept for backward compatibility. */
              tile: { x: number; y: number };
              level: number;
              /** The tile where the old loc was (same as tile for backward compat) */
              oldTile?: { x: number; y: number };
              /** The tile where the new loc appears (for doors that shift position) */
              newTile?: { x: number; y: number };
              /** The rotation before the change */
              oldRotation?: number;
              /** The rotation after the change */
              newRotation?: number;
          };
      }
    | { type: "sound"; payload: SoundEffectPayload }
    | { type: "play_jingle"; payload: { jingleId: number; delay?: number } }
    | {
          type: "play_song";
          payload: {
              trackId: number;
              fadeOutDelay?: number;
              fadeOutDuration?: number;
              fadeInDelay?: number;
              fadeInDuration?: number;
          };
      }
    | { type: "projectiles"; payload: { list: ProjectileLaunch[] } }
    | { type: "spell_result"; payload: SpellResultPayload }
    | {
          type: "debug";
          payload:
              | { kind: "projectiles_request"; requestId: number }
              | {
                    kind: "projectiles_snapshot";
                    requestId: number;
                    fromId?: number;
                    snapshot: any;
                }
              | { kind: "anim_request"; requestId: number }
              | {
                    kind: "anim_snapshot";
                    requestId: number;
                    fromId?: number;
                    snapshot: any;
                };
      }
    | { type: "varp"; payload: { varpId: number; value: number } }
    | { type: "varbit"; payload: { varbitId: number; value: number } }
    | { type: "runClientScript"; payload: { scriptId: number; args: (number | string)[] } }
    | { type: "login_response"; payload: LoginResponsePayload }
    | { type: "logout_response"; payload: LogoutResponsePayload }
    | { type: "notification"; payload: NotificationPayload }
    | { type: "smithing"; payload: SmithingServerPayload }
    | { type: "collection_log"; payload: CollectionLogServerPayload };

export type ClientToServer =
    | { type: "hello"; payload: { client: string; version?: string } }
    | { type: "ping"; payload: { time: number } }
    | {
          type: "pathfind";
          payload: {
              id: number; // request id for correlation
              from: { x: number; y: number; plane: number };
              to: { x: number; y: number };
              size?: number; // tiles, default 1
          };
      }
    | {
          type: "walk";
          payload: {
              to: { x: number; y: number };
              run?: boolean;
              /**
               * Modifier key flags for walk command.
               * Reference: player-movement.md (Client.java:94)
               * - 0: Normal (no modifiers)
               * - 1: Control pressed (force run)
               * - 2: Control + Shift (debug/staff teleport to minimap)
               */
              modifierFlags?: number;
          };
      }
    | { type: "face"; payload: { rot?: number; tile?: { x: number; y: number } } }
    | { type: "teleport"; payload: { to: { x: number; y: number }; level?: number } }
    | {
          type: "handshake";
          payload: { name?: string; appearance?: Appearance; clientType?: number };
      }
    | { type: "varp_transmit"; payload: { varpId: number; value: number } }
    | { type: "spell_cast_npc"; payload: SpellCastNpcPayload }
    | { type: "spell_cast_player"; payload: SpellCastPlayerPayload }
    | { type: "spell_cast_loc"; payload: SpellCastLocPayload }
    | { type: "spell_cast_obj"; payload: SpellCastObjPayload }
    | { type: "spell_cast_item"; payload: SpellCastItemPayload }
    | {
          type: "interact";
          payload: { mode: "follow" | "trade"; targetId: number; modifierFlags?: number };
      }
    | { type: "interact_stop"; payload: {} }
    | { type: "npc_attack"; payload: { npcId: number } }
    | {
          type: "npc_interact";
          payload: { npcId: number; option?: string; opNum?: number; modifierFlags?: number };
      }
    | { type: "player_attack"; payload: { playerId: number; modifierFlags?: number } }
    | {
          type: "player_interact";
          payload: { playerId: number; opNum: number; modifierFlags?: number };
      }
    | {
          type: "loc_interact";
          payload: {
              id: number; // locType id
              tile: { x: number; y: number };
              level?: number;
              action?: string; // optional action label (e.g., "Open") - deprecated, use opNum
              opNum?: number; // 1-5 maps to LocType.actions[opNum-1]
              modifierFlags?: number;
          };
      }
    | { type: "emote"; payload: { index: number; loop?: boolean } }
    | {
          type: "inventory_use";
          payload: { slot: number; itemId: number; quantity?: number; option?: string };
      }
    | {
          type: "inventory_use_on";
          payload: {
              slot: number;
              itemId: number;
              modifierFlags?: number;
              target:
                  | { kind: "npc"; id?: number; tile?: { x: number; y: number }; plane?: number }
                  | { kind: "player"; id: number; tile?: { x: number; y: number }; plane?: number }
                  | { kind: "loc"; id: number; tile?: { x: number; y: number }; plane?: number }
                  | { kind: "obj"; id: number; tile?: { x: number; y: number }; plane?: number }
                  | { kind: "inv"; slot: number; itemId: number };
          };
      }
    | { type: "inventory_move"; payload: { from: number; to: number } }
    | {
          type: "widget";
          payload: { action: "open" | "close"; groupId: number; modal?: boolean };
      }
    | { type: "widget_action"; payload: WidgetActionRequest }
    | { type: "item_spawner_search"; payload: { query: string } }
    | { type: "resume_pausebutton"; payload: { widgetId: number; childIndex: number } }
    | { type: "resume_countdialog"; payload: { amount: number } }
    | { type: "resume_namedialog"; payload: { value: string } }
    | { type: "resume_stringdialog"; payload: { value: string } }
    | {
          type: "if_triggeroplocal";
          payload: {
              opcodeParam: number;
              widgetUid: number;
              childIndex: number;
              itemId: number;
              argsData?: Uint8Array;
          };
      }
    | { type: "trade_action"; payload: TradeActionClientPayload }
    | { type: "ground_item_action"; payload: GroundItemActionPayload }
    | { type: "bank_deposit_inventory"; payload?: Record<string, never> }
    | { type: "bank_deposit_equipment"; payload?: Record<string, never> }
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
    | { type: "if_close"; payload?: Record<string, never> }
    | {
          type: "chat";
          payload: {
              text: string;
              messageType?: "public" | "game";
              chatType?: number;
              colorId?: number;
              effectId?: number;
              pattern?: number[];
          };
      }
    | {
          type: "debug";
          payload:
              | { kind: "projectiles_request"; requestId?: number }
              | { kind: "projectiles_snapshot"; requestId: number; snapshot: any }
              | { kind: "anim_request"; requestId?: number }
              | { kind: "anim_snapshot"; requestId: number; snapshot: any }
              | { kind: "set_var"; value?: number; varbit?: number; varp?: number }
              | { kind: "raw"; raw: string };
      }
    | { type: "logout"; payload?: Record<string, never> };

/**
 * Encode a message to binary format
 * JSON protocol has been completely removed - all messages are binary encoded
 */
export function encodeMessage(msg: ServerToClient): Uint8Array {
    return encodeMessageToBinaryDirect(msg);
}

/**
 * Encode message directly to binary
 * All ServerToClient message types must have a binary encoder
 */
function encodeMessageToBinaryDirect(msg: ServerToClient): Uint8Array {
    const { type, payload } = msg as any;

    switch (type) {
        case "welcome":
            return serverEncoder.encodeWelcome(payload.tickMs, payload.serverTime);

        case "tick":
            return serverEncoder.encodeTick(payload.tick, payload.time);

        case "destination":
            return serverEncoder.encodeDestination(payload.worldX, payload.worldY);

        case "loc_add_change":
            return serverEncoder.encodeLocAddChange(
                payload.locId,
                payload.tile,
                payload.level,
                payload.shape,
                payload.rotation,
            );

        case "loc_del":
            return serverEncoder.encodeLocDel(
                payload.tile,
                payload.level,
                payload.shape,
                payload.rotation,
            );

        case "rebuild_region":
            return serverEncoder.encodeRebuildRegion(
                payload.regionX,
                payload.regionY,
                payload.templateChunks,
                payload.xteaKeys,
                payload.mapRegions,
                payload.extraLocs,
            );

        case "handshake":
            return serverEncoder.encodeHandshake(
                payload.id,
                payload.name,
                payload.appearance,
                payload.chatIcons,
                payload.chatPrefix,
            );

        case "varp":
            return serverEncoder.encodeVarp(payload.varpId, payload.value);

        case "varbit":
            return serverEncoder.encodeVarbit(payload.varbitId, payload.value);

        case "player_sync": {
            let packet: Uint8Array;
            if (payload.packet instanceof Uint8Array) {
                packet = payload.packet;
            } else if (Array.isArray(payload.packet)) {
                packet = new Uint8Array(payload.packet);
            } else if (payload.packet?.constructor === String) {
                const binary = Buffer.from(payload.packet, "base64");
                packet = new Uint8Array(binary);
            } else {
                throw new Error("player_sync packet missing payload");
            }
            return serverEncoder.encodePlayerSync(
                payload.baseX,
                payload.baseY,
                payload.localIndex,
                payload.loopCycle,
                packet,
            );
        }

        case "npc_info": {
            let packet: Uint8Array;
            if (payload.packet instanceof Uint8Array) {
                packet = payload.packet;
            } else if (Array.isArray(payload.packet)) {
                packet = new Uint8Array(payload.packet);
            } else if (payload.packet?.constructor === String) {
                const binary = Buffer.from(payload.packet, "base64");
                packet = new Uint8Array(binary);
            } else {
                throw new Error("npc_info packet missing payload");
            }
            return serverEncoder.encodeNpcInfo(payload.loopCycle, !!payload.large, packet);
        }

        case "inventory":
            if (payload.kind === "snapshot") {
                return serverEncoder.encodeInventorySnapshot(payload.slots ?? []);
            } else if (payload.kind === "slot" && payload.slot) {
                return serverEncoder.encodeInventorySlot(
                    payload.slot.slot,
                    payload.slot.itemId,
                    payload.slot.quantity,
                );
            }
            throw new Error(`Unknown inventory payload kind: ${payload.kind}`);

        case "skills":
            if (payload.kind === "snapshot") {
                return serverEncoder.encodeSkillsSnapshot(
                    payload.skills ?? [],
                    payload.totalLevel,
                    payload.combatLevel,
                );
            }
            if (payload.kind === "delta") {
                return serverEncoder.encodeSkillsDelta(
                    payload.skills ?? [],
                    payload.totalLevel,
                    payload.combatLevel,
                );
            }
            throw new Error(`Unknown skills payload kind: ${payload.kind}`);

        case "run_energy":
            return serverEncoder.encodeRunEnergy(payload.percent, !!payload.running);

        case "hitsplat":
            return serverEncoder.encodeHitsplat(
                payload.targetType,
                payload.targetId,
                payload.damage,
                payload.style,
                payload.type2,
                payload.damage2,
                payload.delayCycles,
            );

        case "spot":
            return serverEncoder.encodeSpotAnim(
                payload.spotId,
                payload.playerId,
                payload.npcId,
                payload.height,
                payload.delay,
            );

        case "chat":
            return serverEncoder.encodeChatMessage(
                payload.messageType,
                payload.text,
                payload.from,
                payload.prefix,
                payload.playerId,
            );

        case "sound":
            return serverEncoder.encodeSound(
                payload.soundId,
                payload.x,
                payload.y,
                payload.level,
                payload.loops,
                payload.delay,
                payload.radius,
                payload.volume,
            );

        case "play_jingle":
            return serverEncoder.encodePlayJingle(payload.jingleId, payload.delay);

        case "play_song":
            return serverEncoder.encodePlaySong(
                payload.trackId,
                payload.fadeOutDelay,
                payload.fadeOutDuration,
                payload.fadeInDelay,
                payload.fadeInDuration,
            );

        case "runClientScript":
            return serverEncoder.encodeRunClientScript(payload.scriptId, payload.args ?? []);

        case "bank":
            if (payload.kind === "snapshot") {
                return serverEncoder.encodeBankSnapshot(payload.capacity, payload.slots ?? []);
            } else if (payload.kind === "slot" && payload.slot) {
                return serverEncoder.encodeBankSlot(
                    payload.slot.slot,
                    payload.slot.itemId,
                    payload.slot.quantity,
                    payload.slot.placeholder,
                    payload.slot.tab,
                );
            }
            throw new Error(`Unknown bank payload kind: ${payload.kind}`);

        case "ground_items":
            if (payload.kind === "snapshot") {
                return serverEncoder.encodeGroundItems(payload.serial, payload.stacks ?? []);
            }
            if (payload.kind === "delta") {
                return serverEncoder.encodeGroundItemsDelta(
                    payload.serial,
                    payload.upserts ?? [],
                    payload.removes ?? [],
                );
            }
            throw new Error(`Unknown ground_items payload kind: ${payload.kind}`);

        case "projectiles":
            return serverEncoder.encodeProjectiles(payload.list ?? []);

        case "loc_change":
            return serverEncoder.encodeLocChange(
                payload.oldId,
                payload.newId,
                payload.tile ?? payload.oldTile,
                payload.level,
                payload.oldRotation,
                payload.newRotation,
                payload.newTile,
            );

        case "combat":
            return serverEncoder.encodeCombatState(payload);

        case "anim":
            return serverEncoder.encodeAnim(payload);

        case "path":
            return serverEncoder.encodePathResponse(
                payload.id,
                !!payload.ok,
                payload.waypoints,
                payload.message,
            );

        case "login_response":
            return serverEncoder.encodeLoginResponse(
                !!payload.success,
                payload.errorCode,
                payload.error,
                payload.displayName,
            );

        case "logout_response":
            return serverEncoder.encodeLogoutResponse(!!payload.success, payload.reason);

        case "widget":
            return encodeWidgetToBinary(payload);

        case "shop":
            return encodeShopToBinary(payload);

        case "trade":
            return encodeTradeToBinary(payload);

        case "spell_result":
            return serverEncoder.encodeSpellResult(payload);

        case "debug":
            return serverEncoder.encodeDebug(payload);

        case "notification":
            return serverEncoder.encodeNotification(
                payload.kind ?? "info",
                payload.title ?? "",
                payload.message ?? "",
                payload.itemId,
                payload.quantity,
                payload.durationMs,
            );

        case "smithing":
            return encodeSmithingToBinary(payload);

        case "collection_log":
            if (payload.kind === "snapshot") {
                return serverEncoder.encodeCollectionLogSnapshot(payload.slots ?? []);
            }
            throw new Error(`Unknown collection_log payload kind: ${payload.kind}`);

        default:
            // All message types should be handled above
            console.warn(`[BinaryProtocol] Unknown message type: ${type}`);
            throw new Error(`Binary encoder not implemented for message type: ${type}`);
    }
}

function encodeWidgetToBinary(payload: any): Uint8Array {
    switch (payload.action) {
        case "open":
            return serverEncoder.encodeWidgetOpen(payload.groupId, !!payload.modal);
        case "close":
            return serverEncoder.encodeWidgetClose(payload.groupId);
        case "set_root":
            return serverEncoder.encodeWidgetSetRoot(payload.groupId);
        case "open_sub":
            return serverEncoder.encodeWidgetOpenSub(
                payload.targetUid,
                payload.groupId,
                payload.type,
                payload.varps,
                payload.varbits,
                payload.hiddenUids,
                payload.preScripts,
                payload.postScripts,
            );
        case "close_sub":
            return serverEncoder.encodeWidgetCloseSub(payload.targetUid);
        case "set_text":
            return serverEncoder.encodeWidgetSetText(payload.uid, payload.text ?? "");
        case "set_hidden":
            return serverEncoder.encodeWidgetSetHidden(payload.uid, !!payload.hidden);
        case "set_item":
            return serverEncoder.encodeWidgetSetItem(payload.uid, payload.itemId, payload.quantity);
        case "set_npc_head":
            return serverEncoder.encodeWidgetSetNpcHead(payload.uid, payload.npcId);
        case "set_flags_range":
            return serverEncoder.encodeWidgetSetFlagsRange(
                payload.uid,
                payload.fromSlot,
                payload.toSlot,
                payload.flags,
            );
        case "run_script":
            return serverEncoder.encodeWidgetRunScript(payload.scriptId, payload.args ?? []);
        case "set_flags":
            return serverEncoder.encodeWidgetSetFlags(payload.uid, payload.flags);
        case "set_animation":
            return serverEncoder.encodeWidgetSetAnimation(payload.uid, payload.animationId);
        case "set_player_head":
            return serverEncoder.encodeWidgetSetPlayerHead(payload.uid);
        case "set_varbit":
            // Widget-channel varbit update - use existing varbit encoder
            return serverEncoder.encodeVarbit(payload.varbitId, payload.value);
        default:
            throw new Error(`Unknown widget action: ${payload.action}`);
    }
}

function encodeShopToBinary(payload: any): Uint8Array {
    switch (payload.kind) {
        case "open":
            return serverEncoder.encodeShopOpen(
                payload.shopId ?? "",
                payload.name ?? "",
                payload.currencyItemId,
                !!payload.generalStore,
                payload.buyMode,
                payload.sellMode,
                payload.stock ?? [],
            );
        case "slot":
            return serverEncoder.encodeShopSlot(payload.shopId ?? "", payload.slot);
        case "close":
            return serverEncoder.encodeShopClose();
        case "mode":
            return serverEncoder.encodeShopMode(
                payload.shopId ?? "",
                payload.buyMode,
                payload.sellMode,
            );
        default:
            throw new Error(`Unknown shop payload kind: ${payload.kind}`);
    }
}

function encodeSmithingToBinary(payload: any): Uint8Array {
    switch (payload.kind) {
        case "open":
        case "update":
            return serverEncoder.encodeSmithingOpen(
                payload.mode ?? "smelt",
                payload.title ?? "",
                payload.options ?? [],
                payload.quantityMode,
                payload.customQuantity,
            );
        case "mode":
            return serverEncoder.encodeSmithingMode(payload.quantityMode, payload.customQuantity);
        case "close":
            return serverEncoder.encodeSmithingClose();
        default:
            throw new Error(`Unknown smithing payload kind: ${payload.kind}`);
    }
}

function encodeTradeToBinary(payload: any): Uint8Array {
    switch (payload.kind) {
        case "request":
            return serverEncoder.encodeTradeRequest(payload.fromId, payload.fromName);
        case "open":
            return serverEncoder.encodeTradeOpen(
                payload.sessionId ?? "",
                payload.stage ?? "offer",
                payload.self ?? { offers: [] },
                payload.other ?? { offers: [] },
                payload.info,
            );
        case "update":
            return serverEncoder.encodeTradeUpdate(
                payload.sessionId ?? "",
                payload.stage ?? "offer",
                payload.self ?? { offers: [] },
                payload.other ?? { offers: [] },
                payload.info,
            );
        case "close":
            return serverEncoder.encodeTradeClose(payload.reason);
        default:
            throw new Error(`Unknown trade payload kind: ${payload.kind}`);
    }
}

export function decodeClientMessage(raw: string | Buffer | ArrayBuffer): RoutedMessage | null {
    // Handle binary packets
    if (raw instanceof Buffer || raw instanceof ArrayBuffer) {
        const {
            decodeClientPacket,
            isBinaryClientPacket,
        } = require("./packet/ClientBinaryDecoder");
        if (isBinaryClientPacket(raw)) {
            const decoded = decodeClientPacket(raw);
            return decoded;
        }
    }

    // JSON protocol removed - only binary is supported
    if (raw.constructor === String) {
        console.warn("[messages] JSON messages no longer supported");
        return null;
    }

    return null;
}

// Re-export binary protocol helpers
export { sendMessage };

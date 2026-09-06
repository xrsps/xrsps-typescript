import { ClientState } from "../../../game/ClientState";
import { duelStore } from "../../../game/duel/DuelStore";
import {
    VARP_AREA_SOUNDS_VOLUME,
    VARP_COMBAT_TARGET_PLAYER_INDEX,
    VARP_FOLLOWER_INDEX,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_VOLUME,
    VARP_OPTION_ATTACK_PRIORITY_NPC,
    VARP_OPTION_ATTACK_PRIORITY_PLAYER,
    VARP_SOUND_EFFECTS_VOLUME,
} from "../../../common/vars";
import { send } from "../connection/send";
import { emitCollectionLog, emitInventory } from "../domain/inventory";
import { handleShopPayload } from "../domain/shop";
import { handleSmithingPayload } from "../domain/smithing";
import { emitPlayerSync, emitSkills } from "../domain/skills";
import { handleTradePayload } from "../domain/trade";
import { getClientCycle } from "../timing";
import { cloneRunEnergyState, state } from "../state";
import {
    BANK_SLOT_COUNT_FALLBACK,
    DEFAULT_SERVER_TICK_MS,
    RUN_ENERGY_MAX_UNITS,
} from "../constants";
import type { CombatStatePayload } from "../../combat/CombatStateStore";
import type {
    BankServerUpdate,
    ChatMessageEvent,
    GroundItemsServerPayload,
    FriendsChatSnapshot,
    NotificationEvent,
    RunEnergyPayload,
    RunEnergyState,
    ShopServerPayload,
    SmithingServerPayload,
    SkillsServerPayload,
    SpotAnimationPayload,
    TradeServerPayload,
} from "../types";
import type { WidgetServerPayload } from "../types/widgets";
import { decodeBase64 } from "../utils/decodeBase64";
import { applyGroundItemsDelta, cloneGroundItemsPayload } from "../utils/groundItems";
import { sanitizeBankSlotMessage, sanitizeInventorySlotMessage, sanitizeSpellResult } from "../utils/sanitize";

export function handleInboundUi(msg: any): boolean {
    if (msg.type === "duel_snapshot") {
        duelStore.update(msg.payload);
        return true;
    }
    if (msg.type === "inventory") {
        const payload: any = msg.payload;
        if (!payload) return true;
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
        return true;
    }
    if (msg.type === "collection_log") {
        const payload: any = msg.payload;
        if (!payload) return true;
        if (payload.kind === "snapshot") {
            const slots = Array.isArray(payload.slots)
                ? payload.slots.map((slot: any) => sanitizeInventorySlotMessage(slot))
                : [];
            emitCollectionLog({ kind: "snapshot", slots });
        }
        return true;
    }
    if (msg.type === "bank") {
        const payload = msg.payload as BankServerUpdate;
        if (!payload) return true;
        if (payload.kind === "snapshot") {
            const capacity = Math.max(1, Number(payload.capacity) | 0);
            const slots = Array.isArray(payload.slots)
                ? payload.slots.map((slot) => sanitizeBankSlotMessage(slot, capacity))
                : [];
            state.lastBankState = {
                capacity,
                slots: slots.map((slot) => ({ ...slot })),
            };
            const snapshotPayload: BankServerUpdate = {
                kind: "snapshot",
                capacity,
                slots: slots.map((slot) => ({ ...slot })),
            };
            for (const cb of state.bankListeners) {
                try {
                    cb(snapshotPayload);
                } catch (err) {
                    console.warn("bank listener error", err);
                }
            }
        } else if (payload.kind === "slot") {
            const capacityHint = state.lastBankState?.capacity ?? BANK_SLOT_COUNT_FALLBACK;
            const slot = sanitizeBankSlotMessage(payload.slot, capacityHint);
            if (state.lastBankState) {
                const idx = state.lastBankState.slots.findIndex((s) => (s.slot | 0) === (slot.slot | 0));
                if (idx >= 0) state.lastBankState.slots[idx] = { ...slot };
                else state.lastBankState.slots.push({ ...slot });
            }
            for (const cb of state.bankListeners) {
                try {
                    cb({ kind: "slot", slot: { ...slot } });
                } catch (err) {
                    console.warn("bank listener error", err);
                }
            }
        }
        return true;
    }
    if (msg.type === "shop") {
        handleShopPayload(msg.payload as ShopServerPayload);
        return true;
    }
    if (msg.type === "ground_items") {
        try {
            const normalized = cloneGroundItemsPayload(msg.payload as GroundItemsServerPayload);
            if (normalized.kind === "snapshot") {
                state.lastGroundItems = normalized;
            } else {
                state.lastGroundItems = applyGroundItemsDelta(state.lastGroundItems, normalized);
            }
            for (const cb of state.groundItemListeners) {
                try {
                    cb(cloneGroundItemsPayload(normalized));
                } catch (err) {
                    console.warn("ground item listener error", err);
                }
            }
        } catch (err) {
            console.warn("ground_items handler error", err);
        }
        return true;
    }
    if (msg.type === "smithing") {
        handleSmithingPayload(msg.payload as SmithingServerPayload);
        return true;
    }
    if (msg.type === "trade") {
        handleTradePayload(msg.payload as TradeServerPayload);
        return true;
    }
    if (msg.type === "skills") {
        emitSkills(msg.payload as SkillsServerPayload);
        return true;
    }
    if (msg.type === "combat") {
        state.combatStateStore.ingest(msg.payload as CombatStatePayload | undefined);
        return true;
    }
    if (msg.type === "run_energy") {
        const raw = msg.payload as RunEnergyPayload | undefined;
        const percentRaw = Number(raw?.percent);
        const percent = Number.isFinite(percentRaw)
            ? Math.max(0, Math.min(100, percentRaw | 0))
            : (state.lastRunEnergyState?.percent ?? 100);
        const unitsRaw = Number(raw?.units);
        const units = Number.isFinite(unitsRaw)
            ? Math.max(0, Math.min(RUN_ENERGY_MAX_UNITS, unitsRaw | 0))
            : Math.round((percent / 100) * RUN_ENERGY_MAX_UNITS);
        const running =
            raw && Object.prototype.hasOwnProperty.call(raw, "running")
                ? !!raw?.running
                : (state.lastRunEnergyState?.running ?? true);
        const weightRaw = Number(raw?.weight);
        const weight = Number.isFinite(weightRaw)
            ? weightRaw | 0
            : (state.lastRunEnergyState?.weight ?? 0);
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
        const runEnergySnapshot: RunEnergyState = stamina
            ? { percent, units, running, weight, stamina }
            : { percent, units, running, weight };
        state.lastRunEnergyState = cloneRunEnergyState(runEnergySnapshot);
        for (const cb of state.runEnergyListeners) {
            try {
                cb(cloneRunEnergyState(runEnergySnapshot));
            } catch (err) {
                console.warn("run energy listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "widget") {
        if (msg.payload.action !== "set_text" && (msg.payload as any).uid !== 10616865) {
            console.log("[ServerConnection] recv widget", msg.payload);
        }
        const payload = msg.payload as WidgetServerPayload;
        for (const cb of state.widgetListeners) cb(payload);
        return true;
    }
    if (msg.type === "chat") {
        const payload = msg.payload;
        try {
            const event: ChatMessageEvent = {
                messageType: payload.messageType,
                // The standalone packet's public channel index is 1; CS2 uses 2.
                chatType: payload.messageType === "public" ? 2 : payload.chatType,
                text: payload.text,
                from: payload.from,
                prefix: payload.prefix,
                playerId: payload.playerId,
            };
            for (const cb of state.chatMessageListeners) cb(event);
        } catch (err) {
            console.warn("chat listener error", err);
        }
        return true;
    }
    if (msg.type === "friends_chat") {
        const snapshot = msg.payload as FriendsChatSnapshot;
        state.lastFriendsChat = snapshot;
        for (const cb of state.friendsChatListeners) {
            try {
                cb(snapshot);
            } catch (err) {
                console.warn("friends chat listener error", err);
            }
        }
        return true;
    }
    if (msg.type === "gamemode_data") {
        try {
            const { loadFromPayload } = require("../../../common/gamemode/GamemodeContentStore");
            loadFromPayload(msg.payload);
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            const mv = g?.__osrsClient;
            if (mv && typeof mv.refreshGamemodeWorldLocs === "function") {
                mv.refreshGamemodeWorldLocs();
            }
            console.log(`[ws] gamemode_data loaded: ${msg.payload?.gamemodeId ?? "unknown"}`);
        } catch (err) {
            console.log("[ws] failed to load gamemode_data", err);
        }
        return true;
    }
    if (msg.type === "notification") {
        const payload = msg.payload as NotificationEvent;
        for (const cb of state.notificationListeners) cb(payload);
        return true;
    }
    return false;
}

import type { WebSocket } from "ws";

import {
    EquipmentSlot,
} from "../../../../src/rs/config/player/Equipment";
import {
    VARP_ATTACK_STYLE,
    VARP_AUTO_RETALIATE,
    VARP_MUSICPLAY,
    VARP_MUSIC_VOLUME,
    VARP_OPTION_RUN,
    VARP_SIDE_JOURNAL_STATE,
    VARP_SPECIAL_ATTACK,
} from "../../../../src/shared/vars";
import { decodeSideJournalTabFromStateVarp } from "../../../../src/shared/ui/sideJournal";
import {
    getInstantUtilitySpecial,
    applyInstantUtilitySpecialBoost,
    markInstantUtilitySpecialHandledAtTick,
    wasInstantUtilitySpecialHandledAtTick,
} from "../../game/combat/InstantUtilitySpecialProvider";
import type { PlayerState } from "../../game/player";
import type { MessageHandler } from "../MessageRouter";
import type { MessageHandlerServices } from "../MessageHandlers";
import { encodeMessage } from "../messages";
import { logger } from "../../utils/logger";

function sendVarpCorrection(services: MessageHandlerServices, ws: WebSocket, varpId: number, value: number): void {
    services.withDirectSendBypass("varp", () =>
        services.sendWithGuard(ws, encodeMessage({ type: "varp", payload: { varpId, value } }), "varp"),
    );
}

export function createVarpTransmitHandler(services: MessageHandlerServices): MessageHandler<"varp_transmit"> {
    return (ctx) => {
        try {
            const p = services.getPlayer(ctx.ws);
            if (!p) return;
            const payload = ctx.payload;
            const varpId = payload.varpId;
            const value = payload.value;
            const previousVarpValue = p.varps.getVarpValue(varpId);

            p.varps.setVarpValue(varpId, value);
            const nextVarpValue = p.varps.getVarpValue(varpId);

            if (varpId === VARP_SIDE_JOURNAL_STATE) {
                handleSideJournalVarp(services, ctx.ws, p, value, previousVarpValue);
            }
            if (varpId === VARP_MUSICPLAY) {
                services.getGamemode()?.onVarpTransmit?.(p, varpId, value, previousVarpValue);
            }
            if (varpId === VARP_MUSIC_VOLUME) {
                // Music volume handled by sound manager via gamemode hook
            }
            if (varpId === VARP_OPTION_RUN) {
                p.setRunToggle(value !== 0);
                services.sendRunEnergyState(ctx.ws, p);
            } else if (varpId === VARP_SPECIAL_ATTACK) {
                handleSpecialAttackVarp(services, ctx.ws, p, value);
            } else if (varpId === VARP_ATTACK_STYLE) {
                handleAttackStyleVarp(services, ctx.ws, p, value);
            } else if (varpId === VARP_AUTO_RETALIATE) {
                handleAutoRetaliateVarp(services, ctx.ws, p, value);
            }
        } catch (err) { logger.warn("[varp] failed to handle varp transmit", err); }
    };
}

function handleSideJournalVarp(
    services: MessageHandlerServices,
    ws: WebSocket,
    p: PlayerState,
    value: number,
    previousVarpValue: number,
): void {
    const { tab: sideJournalTab, stateVarp: normalizedSideJournalVarp } =
        services.normalizeSideJournalState(p, value);
    if (normalizedSideJournalVarp !== value) {
        sendVarpCorrection(services, ws, VARP_SIDE_JOURNAL_STATE, normalizedSideJournalVarp);
    }
    const previousSideJournalTab = decodeSideJournalTabFromStateVarp(previousVarpValue);
    const sideJournalSelectionChanged = previousSideJournalTab !== sideJournalTab;
    if (sideJournalSelectionChanged) {
        services.queueSideJournalGamemodeUi(p);
    }
    services.getGamemode()?.onVarpTransmit?.(p, VARP_SIDE_JOURNAL_STATE, value, previousVarpValue);
    if (sideJournalSelectionChanged) {
        services.getGamemodeUi()?.applySideJournalUi(p);
    }
}

function handleSpecialAttackVarp(
    services: MessageHandlerServices,
    ws: WebSocket,
    p: PlayerState,
    value: number,
): void {
    const desired = value !== 0;
    const equip = services.ensureEquipArray(p);
    const weaponId = equip[EquipmentSlot.WEAPON];
    const weaponCost = weaponId > 0 ? services.getWeaponSpecialCostPercent(weaponId) : undefined;

    const utilitySpecial = desired ? getInstantUtilitySpecial(weaponId) : undefined;

    if (desired && utilitySpecial !== undefined) {
        handleInstantUtilitySpecial(services, ws, p, weaponId, weaponCost, utilitySpecial);
        return;
    }

    if (desired && weaponCost === undefined) {
        revertSpecialAttack(services, ws, p);
        return;
    }

    if (desired && typeof weaponCost === "number" && p.specEnergy.getUnits() < weaponCost) {
        revertSpecialAttack(services, ws, p);
        services.queueChatMessage({
            messageType: "game",
            text: "You do not have enough special attack energy.",
            targetPlayerIds: [p.id],
        });
        return;
    }

    const normalizedVarpValue = desired ? 1 : 0;
    p.specEnergy.setActivated(desired);
    p.varps.setVarpValue(VARP_SPECIAL_ATTACK, normalizedVarpValue);
    if (normalizedVarpValue !== value) {
        sendVarpCorrection(services, ws, VARP_SPECIAL_ATTACK, normalizedVarpValue);
    }
    services.queueCombatState(p);
}

function handleInstantUtilitySpecial(
    services: MessageHandlerServices,
    ws: WebSocket,
    p: PlayerState,
    weaponId: number,
    weaponCost: number | undefined,
    special: { kind: string; seqId: number; soundId?: number },
): void {
    const currentTick = services.getCurrentTick();

    if (wasInstantUtilitySpecialHandledAtTick(p as unknown as Record<string, number | undefined>, currentTick) || weaponCost === undefined) {
        revertSpecialAttack(services, ws, p);
        return;
    }

    if (p.specEnergy.getUnits() < (weaponCost ?? 0) || !p.specEnergy.consume(weaponCost ?? 0)) {
        markInstantUtilitySpecialHandledAtTick(p as unknown as Record<string, number | undefined>, currentTick);
        revertSpecialAttack(services, ws, p);
        services.queueChatMessage({
            messageType: "game",
            text: "You do not have enough special attack energy.",
            targetPlayerIds: [p.id],
        });
        return;
    }

    markInstantUtilitySpecialHandledAtTick(p as unknown as Record<string, number | undefined>, currentTick);
    applyInstantUtilitySpecialBoost(p, special.kind as "rock_knocker" | "fishstabber" | "lumber_up");

    p.specEnergy.setActivated(false);
    p.varps.setVarpValue(VARP_SPECIAL_ATTACK, 0);
    p.queueOneShotSeq(special.seqId, 0);
    if (special.soundId !== undefined) services.animation.sendSound(p, special.soundId);
    services.queueCombatState(p);
    sendVarpCorrection(services, ws, VARP_SPECIAL_ATTACK, 0);

    logger.info(
        `[combat] instant utility special activated: player=${p.id} weapon=${weaponId} kind=${special.kind} seq=${special.seqId}`,
    );
}

function revertSpecialAttack(services: MessageHandlerServices, ws: WebSocket, p: PlayerState): void {
    p.varps.setVarpValue(VARP_SPECIAL_ATTACK, 0);
    p.specEnergy.setActivated(false);
    services.queueCombatState(p);
    sendVarpCorrection(services, ws, VARP_SPECIAL_ATTACK, 0);
}

function handleAttackStyleVarp(
    services: MessageHandlerServices,
    ws: WebSocket,
    p: PlayerState,
    value: number,
): void {
    const requested = Math.max(0, Math.min(3, value));
    p.setCombatStyle(requested, p.combat.weaponCategory);
    const normalized = p.combat.styleSlot;
    p.varps.setVarpValue(VARP_ATTACK_STYLE, normalized);
    sendVarpCorrection(services, ws, VARP_ATTACK_STYLE, normalized);
    services.queueCombatState(p);
    logger.info(`[combat] attack style change: player=${p.id} slot=${normalized}`);
}

function handleAutoRetaliateVarp(
    services: MessageHandlerServices,
    ws: WebSocket,
    p: PlayerState,
    value: number,
): void {
    const on = value === 0;
    p.setAutoRetaliate(on);
    const normalized = on ? 0 : 1;
    if (normalized !== value) {
        p.varps.setVarpValue(VARP_AUTO_RETALIATE, normalized);
        sendVarpCorrection(services, ws, VARP_AUTO_RETALIATE, normalized);
    }
    services.queueCombatState(p);
}

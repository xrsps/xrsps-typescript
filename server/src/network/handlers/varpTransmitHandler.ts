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
    ROCK_KNOCKER_SOUND_ID,
    applyFishstabberFishingBoost,
    applyLumberUpWoodcuttingBoost,
    applyRockKnockerMiningBoost,
    getFishstabberSpecialSequence,
    getLumberUpSpecialSequence,
    getRockKnockerSpecialSequence,
    markInstantUtilitySpecialHandledAtTick,
    wasInstantUtilitySpecialHandledAtTick,
} from "../../game/combat/RockKnockerSpecial";
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
            const payload = ctx.payload as any;
            const varpId = payload?.varpId as number;
            const value = payload?.value as number;
            const previousVarpValue = p.getVarpValue(varpId);

            p.setVarpValue(varpId, value);
            const nextVarpValue = p.getVarpValue(varpId);

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
                (p as any).setRunToggle?.(value !== 0);
                services.sendRunEnergyState(ctx.ws, p);
            } else if (varpId === VARP_SPECIAL_ATTACK) {
                handleSpecialAttackVarp(services, ctx.ws, p, value);
            } else if (varpId === VARP_ATTACK_STYLE) {
                handleAttackStyleVarp(services, ctx.ws, p, value);
            } else if (varpId === VARP_AUTO_RETALIATE) {
                handleAutoRetaliateVarp(services, ctx.ws, p, value);
            }
        } catch {}
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

    const rockKnockerSeqId = desired ? getRockKnockerSpecialSequence(weaponId) : undefined;
    const fishstabberSeqId = desired ? getFishstabberSpecialSequence(weaponId) : undefined;
    const lumberUpSeqId = desired ? getLumberUpSpecialSequence(weaponId) : undefined;

    if (desired && (rockKnockerSeqId !== undefined || fishstabberSeqId !== undefined || lumberUpSeqId !== undefined)) {
        handleInstantUtilitySpecial(services, ws, p, weaponId, weaponCost, rockKnockerSeqId, fishstabberSeqId, lumberUpSeqId);
        return;
    }

    if (desired && weaponCost === undefined) {
        revertSpecialAttack(services, ws, p);
        return;
    }

    if (desired && typeof weaponCost === "number" && p.getSpecialEnergyUnits() < weaponCost) {
        revertSpecialAttack(services, ws, p);
        services.queueChatMessage({
            messageType: "game",
            text: "You do not have enough special attack energy.",
            targetPlayerIds: [p.id],
        });
        return;
    }

    const normalizedVarpValue = desired ? 1 : 0;
    p.setSpecialActivated(desired);
    p.setVarpValue(VARP_SPECIAL_ATTACK, normalizedVarpValue);
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
    rockKnockerSeqId: number | undefined,
    fishstabberSeqId: number | undefined,
    lumberUpSeqId: number | undefined,
): void {
    const seqId = (rockKnockerSeqId ?? fishstabberSeqId ?? lumberUpSeqId) as number;
    const currentTick = services.getCurrentTick();

    if (wasInstantUtilitySpecialHandledAtTick(p as any, currentTick) || weaponCost === undefined) {
        revertSpecialAttack(services, ws, p);
        return;
    }

    if (p.getSpecialEnergyUnits() < (weaponCost ?? 0) || !p.consumeSpecialEnergy(weaponCost ?? 0)) {
        markInstantUtilitySpecialHandledAtTick(p as any, currentTick);
        revertSpecialAttack(services, ws, p);
        services.queueChatMessage({
            messageType: "game",
            text: "You do not have enough special attack energy.",
            targetPlayerIds: [p.id],
        });
        return;
    }

    markInstantUtilitySpecialHandledAtTick(p as any, currentTick);
    if (rockKnockerSeqId !== undefined) applyRockKnockerMiningBoost(p);
    else if (fishstabberSeqId !== undefined) applyFishstabberFishingBoost(p);
    else applyLumberUpWoodcuttingBoost(p);

    p.setSpecialActivated(false);
    p.setVarpValue(VARP_SPECIAL_ATTACK, 0);
    p.queueOneShotSeq(seqId, 0);
    if (rockKnockerSeqId !== undefined) services.sendSound?.(p, ROCK_KNOCKER_SOUND_ID);
    services.queueCombatState(p);
    sendVarpCorrection(services, ws, VARP_SPECIAL_ATTACK, 0);

    logger.info(
        `[combat] instant utility special activated: player=${p.id} weapon=${weaponId} kind=${
            rockKnockerSeqId !== undefined ? "rock_knocker"
            : fishstabberSeqId !== undefined ? "fishstabber"
            : "lumber_up"
        } seq=${seqId}`,
    );
}

function revertSpecialAttack(services: MessageHandlerServices, ws: WebSocket, p: PlayerState): void {
    p.setVarpValue(VARP_SPECIAL_ATTACK, 0);
    p.setSpecialActivated(false);
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
    p.setCombatStyle(requested, p.combatWeaponCategory);
    const normalized = p.combatStyleSlot;
    p.setVarpValue(VARP_ATTACK_STYLE, normalized);
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
        p.setVarpValue(VARP_AUTO_RETALIATE, normalized);
        sendVarpCorrection(services, ws, VARP_AUTO_RETALIATE, normalized);
    }
    services.queueCombatState(p);
}

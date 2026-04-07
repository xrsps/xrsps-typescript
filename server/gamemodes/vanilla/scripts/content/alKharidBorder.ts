import { type DoorToggleResult, type GateDef, type IScriptRegistry, type ScriptServices, type LocInteractionEvent, type NpcInteractionEvent } from "../../../../src/game/scripts/types";

const GATE_LEVEL = 0;
const GATE_SOUND_ID = 71;
const COINS_ITEM_ID = 995;
const TOLL_AMOUNT = 10;
const WEST_TILE_X = 3267;
const EAST_TILE_X = 3268;
const SOUTH_GATE_Y = 3227;
const NORTH_GATE_Y = 3228;
const WEST_GUARD_NPC_ID = 4287;
const EAST_GUARD_NPC_ID = 4288;

type GatePartKey = "south" | "north";

type GatePartDef = {
    key: GatePartKey;
    baseId: number;
    tile: { x: number; y: number };
    freeClosedId: number;
    tollClosedId: number;
    openedId: number;
};

type PendingGateCrossing = {
    player: LocInteractionEvent["player"];
    closeTick: number;
    gateDef: GateDef;
    southOpenTile: { x: number; y: number };
};

type PendingGateApproach = {
    player: LocInteractionEvent["player"];
    part: GatePartDef;
    chargeToll: boolean;
    approachTile: { x: number; y: number; level: number };
    readyTick?: number;
};

type GateCrossingAttempt =
    | { ok: true }
    | { ok: false; reason: "busy" | "position" | "coins" | "toggle" };

type ToggleView = {
    newLocId: number;
    newTile: { x: number; y: number };
    oldRotation?: number;
    newRotation?: number;
};

const SOUTH_PART: GatePartDef = {
    key: "south",
    baseId: 44598,
    tile: { x: EAST_TILE_X, y: SOUTH_GATE_Y },
    freeClosedId: 44050,
    tollClosedId: 44052,
    openedId: 1571,
};

const NORTH_PART: GatePartDef = {
    key: "north",
    baseId: 44599,
    tile: { x: EAST_TILE_X, y: NORTH_GATE_Y },
    freeClosedId: 44051,
    tollClosedId: 44053,
    openedId: 1572,
};

const FREE_GATE_DEF: GateDef = {
    closed: {
        hinge: SOUTH_PART.freeClosedId,
        extension: NORTH_PART.freeClosedId,
    },
    opened: {
        hinge: SOUTH_PART.openedId,
        extension: NORTH_PART.openedId,
    },
    openStyle: "center",
};

const TOLL_GATE_DEF: GateDef = {
    closed: {
        hinge: SOUTH_PART.tollClosedId,
        extension: NORTH_PART.tollClosedId,
    },
    opened: {
        hinge: SOUTH_PART.openedId,
        extension: NORTH_PART.openedId,
    },
    openStyle: "center",
};

const REGISTERED_LOC_IDS = [
    SOUTH_PART.baseId,
    NORTH_PART.baseId,
    SOUTH_PART.freeClosedId,
    NORTH_PART.freeClosedId,
    SOUTH_PART.tollClosedId,
    NORTH_PART.tollClosedId,
];

function normalizeAction(action: string | undefined): string {
    return action?.trim().toLowerCase() ?? "";
}

function normalizeRotation(value: number | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    return ((value % 4) + 4) % 4;
}

function resolvePartByY(y: number): GatePartDef {
    return Math.abs(y - SOUTH_GATE_Y) <= Math.abs(y - NORTH_GATE_Y) ? SOUTH_PART : NORTH_PART;
}

function resolvePartForInteraction(
    event: LocInteractionEvent,
    locId: number,
): GatePartDef | undefined {
    switch (locId) {
        case SOUTH_PART.baseId:
        case SOUTH_PART.freeClosedId:
        case SOUTH_PART.tollClosedId:
        case SOUTH_PART.openedId:
            return SOUTH_PART;
        case NORTH_PART.baseId:
        case NORTH_PART.freeClosedId:
        case NORTH_PART.tollClosedId:
        case NORTH_PART.openedId:
            return NORTH_PART;
        default:
            break;
    }

    if (event.tile.y === SOUTH_GATE_Y) {
        return SOUTH_PART;
    }
    if (event.tile.y === NORTH_GATE_Y) {
        return NORTH_PART;
    }
    if (event.player.tileY === SOUTH_GATE_Y) {
        return SOUTH_PART;
    }
    if (event.player.tileY === NORTH_GATE_Y) {
        return NORTH_PART;
    }

    return undefined;
}

function extractToggleViews(
    part: GatePartDef,
    result: DoorToggleResult,
): { south: ToggleView; north: ToggleView } | undefined {
    if (
        !result.success ||
        result.newLocId === undefined ||
        !result.newTile ||
        !result.partnerResult
    ) {
        return undefined;
    }

    const main: ToggleView = {
        newLocId: result.newLocId,
        newTile: { x: result.newTile.x, y: result.newTile.y },
        oldRotation: normalizeRotation(result.oldRotation),
        newRotation: normalizeRotation(result.newRotation),
    };
    const partner: ToggleView = {
        newLocId: result.partnerResult.newLocId,
        newTile: {
            x: result.partnerResult.newTile.x,
            y: result.partnerResult.newTile.y,
        },
        oldRotation: normalizeRotation(result.partnerResult.oldRotation),
        newRotation: normalizeRotation(result.partnerResult.newRotation),
    };

    return part.key === "south" ? { south: main, north: partner } : { south: partner, north: main };
}

function removeCoins(
    player: LocInteractionEvent["player"],
    services: ScriptServices,
    amount: number,
): boolean {
    const getInventoryItems = services.getInventoryItems;
    const setInventorySlot = services.setInventorySlot;
    const coinStacks = getInventoryItems(player)
        .filter((entry) => entry.itemId === COINS_ITEM_ID && entry.quantity > 0)
        .sort((a, b) => a.slot - b.slot);
    const totalCoins = coinStacks.reduce((sum, entry) => sum + entry.quantity, 0);
    if (totalCoins < amount) {
        return false;
    }

    let remaining = amount;
    for (const stack of coinStacks) {
        if (remaining <= 0) {
            break;
        }
        const quantity = stack.quantity;
        const taken = Math.min(quantity, remaining);
        const left = quantity - taken;
        setInventorySlot(player, stack.slot, left > 0 ? COINS_ITEM_ID : -1, Math.max(0, left));
        remaining -= taken;
    }

    services.snapshotInventory(player);
    return remaining <= 0;
}

function hasCoins(
    player: LocInteractionEvent["player"],
    services: ScriptServices,
    amount: number,
): boolean {
    const getInventoryItems = services.getInventoryItems;
    const totalCoins = getInventoryItems(player)
        .filter((entry) => entry.itemId === COINS_ITEM_ID && entry.quantity > 0)
        .reduce((sum, entry) => sum + entry.quantity, 0);
    return totalCoins >= amount;
}

function refundCoins(
    player: LocInteractionEvent["player"],
    services: ScriptServices,
    amount: number,
): void {
    services.addItemToInventory(player, COINS_ITEM_ID, amount);
    services.snapshotInventory(player);
}

function emitOpenGateLocChanges(
    services: ScriptServices,
    views: { south: ToggleView; north: ToggleView },
): void {
    services.emitLocChange?.(SOUTH_PART.baseId, views.south.newLocId, SOUTH_PART.tile, GATE_LEVEL, {
        oldTile: SOUTH_PART.tile,
        newTile: views.south.newTile,
        oldRotation: views.south.oldRotation,
        newRotation: views.south.newRotation,
    });
    services.emitLocChange?.(NORTH_PART.baseId, views.north.newLocId, NORTH_PART.tile, GATE_LEVEL, {
        oldTile: NORTH_PART.tile,
        newTile: views.north.newTile,
        oldRotation: views.north.oldRotation,
        newRotation: views.north.newRotation,
    });
}

function emitCloseGateLocChanges(
    services: ScriptServices,
    southOpenTile: { x: number; y: number },
    result: DoorToggleResult,
): void {
    if (
        !result.success ||
        result.newLocId === undefined ||
        !result.newTile ||
        !result.partnerResult
    ) {
        return;
    }

    services.emitLocChange?.(SOUTH_PART.openedId, SOUTH_PART.baseId, southOpenTile, GATE_LEVEL, {
        oldTile: southOpenTile,
        newTile: SOUTH_PART.tile,
        oldRotation: normalizeRotation(result.oldRotation),
        newRotation: normalizeRotation(result.newRotation),
    });
    services.emitLocChange?.(
        NORTH_PART.openedId,
        NORTH_PART.baseId,
        result.partnerResult.oldTile,
        GATE_LEVEL,
        {
            oldTile: result.partnerResult.oldTile,
            newTile: NORTH_PART.tile,
            oldRotation: normalizeRotation(result.partnerResult.oldRotation),
            newRotation: normalizeRotation(result.partnerResult.newRotation),
        },
    );
}

function openNpcDialog(
    event: LocInteractionEvent,
    dialogId: string,
    npcId: number,
    lines: string[],
    onContinue?: () => void,
    closeOnContinue?: boolean,
): void {
    event.services.openDialog?.(event.player, {
        kind: "npc",
        id: dialogId,
        npcId,
        npcName: "Border Guard",
        lines,
        clickToContinue: true,
        closeOnContinue: closeOnContinue ?? !onContinue,
        onContinue,
    });
}

function openPlayerDialog(
    event: LocInteractionEvent,
    dialogId: string,
    lines: string[],
    onContinue?: () => void,
    closeOnContinue?: boolean,
): void {
    event.services.openDialog?.(event.player, {
        kind: "player",
        id: dialogId,
        playerName: event.player.name ?? "You",
        lines,
        clickToContinue: true,
        closeOnContinue: closeOnContinue ?? !onContinue,
        onContinue,
    });
}

function resolveGateSide(player: LocInteractionEvent["player"]): "west" | "east" | undefined {
    if (player.tileX <= WEST_TILE_X) {
        return "west";
    }
    if (player.tileX >= EAST_TILE_X) {
        return "east";
    }
    return undefined;
}

function resolveApproachTile(
    side: "west" | "east",
    part: GatePartDef,
): { x: number; y: number; level: number } {
    return {
        x: side === "west" ? WEST_TILE_X : EAST_TILE_X,
        y: part.tile.y,
        level: GATE_LEVEL,
    };
}

function isPlayerAtTile(
    player: LocInteractionEvent["player"],
    tile: { x: number; y: number; level: number },
): boolean {
    return player.tileX === tile.x && player.tileY === tile.y && player.level === tile.level;
}

function isWalkDestination(
    walkDestination: { x: number; y: number } | undefined,
    tile: { x: number; y: number; level: number },
): boolean {
    return !!walkDestination && walkDestination.x === tile.x && walkDestination.y === tile.y;
}

export function registerAlKharidBorderHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    const pendingApproaches = new Map<number, PendingGateApproach>();
    const pendingCrossings = new Map<number, PendingGateCrossing>();
    const getCurrentTick = services.getCurrentTick;
    const getPathService = services.getPathService;

    const resolveCurrentGateState = (event: LocInteractionEvent) => {
        const southVisible =
            services.resolveLocTransformId?.(
                event.player,
                services.getLocDefinition?.(SOUTH_PART.baseId),
            ) ?? SOUTH_PART.freeClosedId;
        const northVisible =
            services.resolveLocTransformId?.(
                event.player,
                services.getLocDefinition?.(NORTH_PART.baseId),
            ) ?? NORTH_PART.freeClosedId;
        const isTollGate =
            southVisible === SOUTH_PART.tollClosedId ||
            northVisible === NORTH_PART.tollClosedId;
        return {
            southVisible,
            northVisible,
            gateDef: isTollGate ? TOLL_GATE_DEF : FREE_GATE_DEF,
            requiresToll: isTollGate,
        };
    };

    const closeGate = (crossing: PendingGateCrossing, tick: number): void => {
        const closeResult = services.doorManager?.toggleExplicitGate({
            x: crossing.southOpenTile.x,
            y: crossing.southOpenTile.y,
            level: GATE_LEVEL,
            currentId: SOUTH_PART.openedId,
            action: "close",
            currentTick: tick,
            gateDef: crossing.gateDef,
        });
        if (!closeResult?.success) {
            return;
        }
        emitCloseGateLocChanges(services, crossing.southOpenTile, closeResult);
        services.playAreaSound?.({
            soundId: GATE_SOUND_ID,
            tile: SOUTH_PART.tile,
            level: GATE_LEVEL,
            radius: 5,
            volume: 255,
        });
    };

    const showNoMoneyDialog = (event: LocInteractionEvent): void => {
        const dialogBase = `al_kharid_gate_${event.player.id}`;
        openPlayerDialog(event, `${dialogBase}_no_money_player`, [
            "Oh dear, I don't actually seem to have enough money.",
        ]);
    };

    const beginApproachWait = (approach: PendingGateApproach, tick: number): void => {
        approach.player.clearWalkDestination();
        approach.player.holdMovementUntil(tick + 2);
        approach.readyTick = tick + 1;
    };

    const startGateCrossing = (
        event: LocInteractionEvent,
        part: GatePartDef,
        chargeToll: boolean,
    ): GateCrossingAttempt => {
        const currentTick = getCurrentTick ? getCurrentTick() : event.tick;
        const playerId = event.player.id;
        if (pendingCrossings.has(playerId) || pendingCrossings.size > 0) {
            return { ok: false, reason: "busy" };
        }

        const side = resolveGateSide(event.player);
        if (!side) {
            return { ok: false, reason: "position" };
        }
        if (Math.abs(event.player.tileY - part.tile.y) > 1) {
            return { ok: false, reason: "position" };
        }

        const gateState = resolveCurrentGateState(event);
        const currentVisibleId =
            part.key === "south" ? gateState.southVisible : gateState.northVisible;

        if (chargeToll && !removeCoins(event.player, services, TOLL_AMOUNT)) {
            return { ok: false, reason: "coins" };
        }

        const toggleResult = services.doorManager?.toggleExplicitGate({
            x: part.tile.x,
            y: part.tile.y,
            level: GATE_LEVEL,
            currentId: currentVisibleId,
            action: "open",
            currentTick,
            gateDef: gateState.gateDef,
        });

        if (!toggleResult?.success) {
            if (chargeToll) {
                refundCoins(event.player, services, TOLL_AMOUNT);
            }
            return { ok: false, reason: "toggle" };
        }

        const views = extractToggleViews(part, toggleResult);
        if (!views) {
            if (chargeToll) {
                refundCoins(event.player, services, TOLL_AMOUNT);
            }
            return { ok: false, reason: "toggle" };
        }

        emitOpenGateLocChanges(services, views);
        services.playAreaSound?.({
            soundId: GATE_SOUND_ID,
            tile: part.tile,
            level: GATE_LEVEL,
            radius: 5,
            volume: 255,
        });
        if (chargeToll) {
            services.sendGameMessage(
                event.player,
                "You pay 10 gold coins to pass through the gate.",
            );
        }

        const destination = {
            x: side === "west" ? EAST_TILE_X : WEST_TILE_X,
            y: part.tile.y,
            level: GATE_LEVEL,
        };
        const closeTick = currentTick + 2;

        event.player.resetInteractions();
        event.player.clearWalkDestination();
        event.player.setPath([{ x: destination.x, y: destination.y }], false);

        pendingCrossings.set(playerId, {
            player: event.player,
            closeTick,
            gateDef: gateState.gateDef,
            southOpenTile: views.south.newTile,
        });
        return { ok: true };
    };

    const queueGateApproach = (
        event: LocInteractionEvent,
        part: GatePartDef,
        chargeToll: boolean,
    ): GateCrossingAttempt => {
        const currentTick = getCurrentTick ? getCurrentTick() : event.tick;
        const playerId = event.player.id;
        const side = resolveGateSide(event.player);
        if (!side) {
            return { ok: false, reason: "position" };
        }
        if (pendingCrossings.has(playerId)) {
            return { ok: false, reason: "busy" };
        }
        const existingApproach = pendingApproaches.get(playerId);
        if (existingApproach) {
            existingApproach.player.releaseMovementHold();
            pendingApproaches.delete(playerId);
        }
        if (chargeToll && !hasCoins(event.player, services, TOLL_AMOUNT)) {
            return { ok: false, reason: "coins" };
        }

        const desiredApproachTile = resolveApproachTile(side, part);
        const pathService = getPathService?.();
        let approachTile = {
            x: desiredApproachTile.x,
            y: desiredApproachTile.y,
            level: desiredApproachTile.level,
        };

        if (!isPlayerAtTile(event.player, desiredApproachTile)) {
            if (!pathService) {
                return { ok: false, reason: "position" };
            }
            const result = pathService.findPathSteps(
                {
                    from: {
                        x: event.player.tileX,
                        y: event.player.tileY,
                        plane: event.player.level,
                    },
                    to: { x: desiredApproachTile.x, y: desiredApproachTile.y },
                    size: 1,
                },
                { maxSteps: 128 },
            );
            if (!result.ok) {
                return { ok: false, reason: "position" };
            }

            const selectedEnd =
                result.end ??
                (Array.isArray(result.steps) && result.steps.length > 0
                    ? result.steps[result.steps.length - 1]!
                    : { x: event.player.tileX, y: event.player.tileY });
            if (
                selectedEnd.x !== desiredApproachTile.x ||
                selectedEnd.y !== desiredApproachTile.y
            ) {
                return { ok: false, reason: "position" };
            }

            const wantsRun = event.player.energy.wantsToRun();
            const shouldRun = event.player.energy.resolveRequestedRun(wantsRun);
            event.player.setWalkDestination(
                { x: desiredApproachTile.x, y: desiredApproachTile.y },
                wantsRun,
            );
            if (Array.isArray(result.steps) && result.steps.length > 0) {
                event.player.setPathPreservingWalkDestination(result.steps, shouldRun);
            } else {
                event.player.clearPath();
            }
        }

        event.player.resetInteractions();
        const approach: PendingGateApproach = {
            player: event.player,
            part,
            chargeToll,
            approachTile,
        };
        if (isPlayerAtTile(event.player, approachTile)) {
            beginApproachWait(approach, currentTick);
        }
        pendingApproaches.set(playerId, approach);
        return { ok: true };
    };

    const showTollPrompt = (
        event: LocInteractionEvent,
        part: GatePartDef,
        guardNpcId: number,
    ): void => {
        const dialogBase = `al_kharid_gate_${event.player.id}`;

        openPlayerDialog(
            event,
            `${dialogBase}_intro`,
            ["Can I come through this gate?"],
            () => {
                openNpcDialog(
                    event,
                    `${dialogBase}_guard_intro`,
                    guardNpcId,
                    ["You must pay a toll of 10 gold coins to pass."],
                    () => {
                        services.openDialogOptions?.(event.player, {
                            id: `${dialogBase}_options`,
                            title: "Border Guard",
                            options: [
                                "No thank you, I'll walk around.",
                                "Who does my money go to?",
                                "Yes, ok.",
                            ],
                            onSelect: (choiceIndex) => {
                                if (choiceIndex === 0) {
                                    openPlayerDialog(
                                        event,
                                        `${dialogBase}_decline_player`,
                                        ["No, thank you. I'll walk around."],
                                        () => {
                                            openNpcDialog(
                                                event,
                                                `${dialogBase}_decline_guard`,
                                                guardNpcId,
                                                ["Ok suit yourself."],
                                            );
                                        },
                                    );
                                    return;
                                }

                                if (choiceIndex === 1) {
                                    openPlayerDialog(
                                        event,
                                        `${dialogBase}_city_player`,
                                        ["Who does my money go to?"],
                                        () => {
                                            openNpcDialog(
                                                event,
                                                `${dialogBase}_city_guard`,
                                                guardNpcId,
                                                ["The money goes to the city of Al-Kharid."],
                                            );
                                        },
                                    );
                                    return;
                                }

                                openPlayerDialog(
                                    event,
                                    `${dialogBase}_pay_player`,
                                    ["Yes, ok."],
                                    () => {
                                        services.closeDialog?.(
                                            event.player,
                                            `${dialogBase}_pay_player`,
                                        );
                                        const attempt = queueGateApproach(event, part, true);
                                        if (attempt.ok || attempt.reason !== "coins") {
                                            return;
                                        }
                                        showNoMoneyDialog(event);
                                    },
                                    true,
                                );
                            },
                        });
                    },
                );
            },
        );
    };

    const showFreePassPrompt = (
        event: LocInteractionEvent,
        part: GatePartDef,
        guardNpcId: number,
    ): void => {
        const dialogBase = `al_kharid_gate_${event.player.id}`;

        openPlayerDialog(
            event,
            `${dialogBase}_free_player`,
            ["Can I come through this gate?"],
            () => {
                openNpcDialog(
                    event,
                    `${dialogBase}_free_guard`,
                    guardNpcId,
                    ["You may pass for free, you are a friend of Al-Kharid."],
                    () => {
                        services.closeDialog?.(event.player, `${dialogBase}_free_guard`);
                        queueGateApproach(event, part, false);
                    },
                    true,
                );
            },
        );
    };

    const handleGateInteraction = (event: LocInteractionEvent): void => {
        const part = resolvePartForInteraction(event, event.locId);
        if (!part) {
            return;
        }

        const gateState = resolveCurrentGateState(event);
        const action = normalizeAction(event.action);
        if (action === "pay-toll(10gp)") {
            if (!gateState.requiresToll) {
                queueGateApproach(event, part, false);
                return;
            }
            const attempt = queueGateApproach(event, part, true);
            if (attempt.ok) {
                return;
            }
            if (attempt.reason !== "coins") {
                return;
            }
            showNoMoneyDialog(event);
            return;
        }

        if (gateState.requiresToll) {
            const guardNpcId =
                event.player.tileX >= EAST_TILE_X ? EAST_GUARD_NPC_ID : WEST_GUARD_NPC_ID;
            showTollPrompt(event, part, guardNpcId);
            return;
        }

        queueGateApproach(event, part, false);
    };

    const handleGuardInteraction = (event: NpcInteractionEvent): void => {
        const part = resolvePartByY(event.npc.tileY);
        const gateEvent: LocInteractionEvent = {
            tick: event.tick,
            services: event.services,
            player: event.player,
            locId: part.baseId,
            tile: part.tile,
            level: GATE_LEVEL,
            action: "open",
        };
        const gateState = resolveCurrentGateState(gateEvent);
        const guardNpcId =
            event.npc.typeId === WEST_GUARD_NPC_ID || event.npc.typeId === EAST_GUARD_NPC_ID
                ? event.npc.typeId
                : event.player.tileX >= EAST_TILE_X
                ? EAST_GUARD_NPC_ID
                : WEST_GUARD_NPC_ID;

        if (gateState.requiresToll) {
            showTollPrompt(gateEvent, part, guardNpcId);
            return;
        }

        showFreePassPrompt(gateEvent, part, guardNpcId);
    };

    registry.registerTickHandler(({ tick }) => {
        for (const [playerId, approach] of pendingApproaches.entries()) {
            const approachTick = tick;
            const atApproachTile = isPlayerAtTile(approach.player, approach.approachTile);
            if (!atApproachTile) {
                if (approach.readyTick !== undefined) {
                    pendingApproaches.delete(playerId);
                    approach.player.releaseMovementHold();
                    continue;
                }

                const walkDestination = approach.player.getWalkDestination();
                if (
                    (walkDestination &&
                        !isWalkDestination(walkDestination, approach.approachTile)) ||
                    (!walkDestination && !approach.player.hasPath())
                ) {
                    pendingApproaches.delete(playerId);
                }
                continue;
            }

            if (approach.readyTick === undefined) {
                beginApproachWait(approach, approachTick);
                continue;
            }
            if (approachTick < approach.readyTick) {
                continue;
            }

            pendingApproaches.delete(playerId);
            const gateEvent: LocInteractionEvent = {
                tick: approachTick,
                services,
                player: approach.player,
                locId: approach.part.baseId,
                tile: approach.part.tile,
                level: GATE_LEVEL,
                action: "open",
            };
            const attempt = startGateCrossing(gateEvent, approach.part, approach.chargeToll);
            if (attempt.ok) {
                continue;
            }
            if (attempt.reason === "busy") {
                beginApproachWait(approach, approachTick);
                pendingApproaches.set(playerId, approach);
                continue;
            }

            approach.player.releaseMovementHold();
            if (attempt.reason === "coins") {
                showNoMoneyDialog(gateEvent);
            }
        }

        for (const [playerId, crossing] of pendingCrossings.entries()) {
            if (tick < crossing.closeTick) {
                continue;
            }

            pendingCrossings.delete(playerId);
            crossing.player.releaseMovementHold();
            closeGate(crossing, tick);
        }
    });

    for (const locId of REGISTERED_LOC_IDS) {
        registry.registerLocScript({
            locId,
            action: "open",
            handler: handleGateInteraction,
        });
        registry.registerLocScript({
            locId,
            action: "pay-toll(10gp)",
            handler: handleGateInteraction,
        });
    }

    for (const npcId of [WEST_GUARD_NPC_ID, EAST_GUARD_NPC_ID]) {
        registry.registerNpcScript({
            npcId,
            option: "talk-to",
            handler: handleGuardInteraction,
        });
        registry.registerNpcScript({
            npcId,
            option: undefined,
            handler: handleGuardInteraction,
        });
    }
}

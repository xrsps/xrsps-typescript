import {
    NO_INTERACTION,
    encodeInteractionIndex,
    isValidInteractionIndex,
} from "../../rs/interaction/InteractionIndex";
import type { MovementUpdate } from "../movement/MovementSyncTypes";
import type {
    PlayerMovementEvent,
    PlayerSyncFrame,
    PlayerUpdateBlock,
    SpotAnimationUpdate,
} from "./PlayerSyncTypes";
import { toSubCoordinates } from "./PlayerSyncUtils";

export interface SpawnInstruction {
    serverId: number;
    tile: { x: number; y: number; level: number };
    preserveQueue: boolean;
    needsAppearance: boolean;
    subX: number;
    subY: number;
    worldViewId?: number;
}

export interface RemovalInstruction {
    serverId: number;
}

export interface PlayerSyncActions {
    movementsPre: MovementUpdate[];
    movementsPost: MovementUpdate[];
    spawns: SpawnInstruction[];
    removals: RemovalInstruction[];
    animations: Map<number, PlayerUpdateBlock["animation"]>;
    spotAnimations: Map<number, SpotAnimationUpdate[]>;
    forcedMovements: Map<number, PlayerUpdateBlock["forcedMovement"]>;
    faceEntities: Map<number, number>;
    faceDirs: Map<number, number>;
    hitsplats: Map<number, NonNullable<PlayerUpdateBlock["hitsplats"]>>;
    healthBars: Map<number, NonNullable<PlayerUpdateBlock["healthBars"]>>;
    appearances: Map<number, PlayerUpdateBlock["appearance"]>;
    chats: Map<number, PlayerUpdateBlock["chat"]>;
    forcedChats: Map<number, string>;
    colorOverrides: Map<number, NonNullable<PlayerUpdateBlock["field512"]>>;
}

function movementEventToUpdate(event: PlayerMovementEvent): MovementUpdate {
    const { x, y, level } = event.tile;
    const { subX, subY } = toSubCoordinates(x, y, event.subX, event.subY);
    return {
        serverId: event.index,
        ecsIndex: -1,
        subX,
        subY,
        level,
        running: !!event.running,
        moved: event.mode !== "idle",
        snap: !!event.snap,
        rotation: event.rotation,
        orientation: event.orientation,
        turned: !!event.turned,
        directions: Array.isArray(event.directions)
            ? event.directions.map((d) => (d | 0) & 7)
            : undefined,
        traversals: Array.isArray(event.traversals)
            ? event.traversals.map((t) => (t | 0) & 3)
            : undefined,
    };
}

export function frameToActions(frame: PlayerSyncFrame): PlayerSyncActions {
    const movementsPre: MovementUpdate[] = [];
    const movementsPost: MovementUpdate[] = [];
    for (const entry of frame.movements) {
        const mapped = movementEventToUpdate(entry);
        if (entry.applyAfterBlocks) movementsPost.push(mapped);
        else movementsPre.push(mapped);
    }
    const spawns = frame.spawns.map((spawn) => {
        const { subX, subY } = toSubCoordinates(spawn.tile.x, spawn.tile.y);
        return {
            serverId: spawn.index,
            tile: spawn.tile,
            preserveQueue: spawn.preserveQueue,
            needsAppearance: spawn.needsAppearance,
            subX,
            subY,
            worldViewId: spawn.worldViewId,
        };
    });
    const removals = frame.removals.map((r) => ({ serverId: r.index }));

    const animations = new Map<number, PlayerUpdateBlock["animation"]>();
    const spotAnimations = new Map<number, SpotAnimationUpdate[]>();
    const forcedMovements = new Map<number, PlayerUpdateBlock["forcedMovement"]>();
    const faceEntities = new Map<number, number>();
    const faceDirs = new Map<number, number>();
    const hitsplats = new Map<number, NonNullable<PlayerUpdateBlock["hitsplats"]>>();
    const healthBars = new Map<number, NonNullable<PlayerUpdateBlock["healthBars"]>>();
    const appearances = new Map<number, PlayerUpdateBlock["appearance"]>();
    const chats = new Map<number, PlayerUpdateBlock["chat"]>();
    const forcedChats = new Map<number, string>();
    const colorOverrides = new Map<number, NonNullable<PlayerUpdateBlock["field512"]>>();

    for (const [index, block] of frame.updateBlocks) {
        if (block.animation) animations.set(index, block.animation);
        const spots = Array.isArray(block.spotAnimations)
            ? block.spotAnimations
            : block.spotAnimation
            ? [block.spotAnimation]
            : [];
        if (spots.length > 0) spotAnimations.set(index, spots);
        if (block.forcedMovement) forcedMovements.set(index, block.forcedMovement);
        const normalizedFace = normalizeFaceEntity(block.faceEntity);
        if (normalizedFace !== undefined) faceEntities.set(index, normalizedFace);
        if (typeof block.faceDir === "number") faceDirs.set(index, (block.faceDir | 0) & 2047);
        const hsLegacy = [
            block.primaryHit,
            block.secondaryHit,
            block.tertiaryHit,
            block.quaternaryHit,
        ].filter((h): h is NonNullable<typeof h> => !!h);
        const hs: NonNullable<PlayerUpdateBlock["hitsplats"]> = Array.isArray(block.hitsplats)
            ? block.hitsplats
            : hsLegacy;
        if (hs.length > 0) hitsplats.set(index, hs);
        if (Array.isArray(block.healthBars) && block.healthBars.length > 0) {
            healthBars.set(index, block.healthBars);
        }
        if (block.appearance) appearances.set(index, block.appearance);
        if (block.chat) chats.set(index, block.chat);
        if (typeof block.forcedChat === "string" && block.forcedChat.length > 0)
            forcedChats.set(index, block.forcedChat);
        if (block.field512) colorOverrides.set(index, block.field512);
    }

    return {
        movementsPre,
        movementsPost,
        spawns,
        removals,
        animations,
        spotAnimations,
        forcedMovements,
        faceEntities,
        faceDirs,
        hitsplats,
        healthBars,
        appearances,
        chats,
        forcedChats,
        colorOverrides,
    };
}

function normalizeFaceEntity(face: number | undefined): number | undefined {
    if (typeof face !== "number" || !Number.isFinite(face)) return undefined;
    const raw = face | 0;
    if (raw < 0) return NO_INTERACTION;

    // Already in our interaction encoding (player offset 0x8000)?
    if (isValidInteractionIndex(raw)) {
        return raw;
    }

    // OSRS faceEntity uses bit 15 to distinguish NPC (bit set) vs player (bit clear).
    if ((raw & 0x8000) !== 0) {
        const npcId = raw & 0x7fff;
        return encodeInteractionIndex("npc", npcId);
    }

    // Player targets come through as zero-based indices; encode with the player offset.
    return encodeInteractionIndex("player", raw);
}

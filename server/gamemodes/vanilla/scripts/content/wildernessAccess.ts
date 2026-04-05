import { type IScriptRegistry, type ScriptServices, type LocInteractionEvent } from "../../../../src/game/scripts/types";

// Wilderness ditch loc ID (shared for all ditch segments — cross in both directions)
const WILDERNESS_DITCH_LOC_ID = 23271;

// RSPROX: sequence id=6132 — jump animation played on both directions
const DITCH_CROSS_ANIM_ID = 6132;

// RSPROX: synth_sound id=2462, delay=25 client cycles = 500ms
const DITCH_CROSS_SOUND_ID = 2462;
const DITCH_CROSS_SOUND_DELAY_MS = 500;

// RSPROX: exactmove delay=33, duration=27 client cycles → total=60=2 server ticks
// ForcedMovement endTick = deliveryTick + 2
const DITCH_FORCED_MOVE_TICKS = 2;

// RSPROX: angle=1024 heading north (south→north), angle=0 heading south (north→south)
// Also used for face_angle — both packets share the same angle value
const DITCH_ANGLE_NORTH = 1024;
const DITCH_ANGLE_SOUTH = 0;

// RSPROX tile decode for ditch at region (48,55) local (10,1):
//   absoluteX = 48*64 + 10 = 3082
//   absoluteY = 55*64 + 1  = 3521  ← ditch tile Y
//   south side (free world): Y = ditchY - 1 = 3520
//   north side (wilderness): Y = ditchY + 2 = 3523
// Destination offsets from ditch tile Y:
//   south→north: destY = ditchY + 2
//   north→south: destY = ditchY - 1
const DITCH_DEST_OFFSET_NORTH = 2; // when crossing south→north, land at ditchY+2
const DITCH_DEST_OFFSET_SOUTH = -1; // when crossing north→south, land at ditchY-1

function handleDitchCross(event: LocInteractionEvent): void {
    const { player, tile, services, tick } = event;
    const ditchY = tile.y;

    const goingNorth = player.tileY <= ditchY;

    const destX = player.tileX;
    const destY = goingNorth ? ditchY + DITCH_DEST_OFFSET_NORTH : ditchY + DITCH_DEST_OFFSET_SOUTH;
    const destLevel = player.level;

    const startTile = { x: player.tileX, y: player.tileY };
    const endTile = { x: destX, y: destY };
    const angle = goingNorth ? DITCH_ANGLE_NORTH : DITCH_ANGLE_SOUTH;

    // Teleport first — queueForcedMovement uses player.tileX/tileY after teleport as startTile
    services.teleportPlayer?.(player, destX, destY, destLevel);

    // ForcedMovement (exactmove): from old position to new position over 2 ticks
    services.queueForcedMovement?.(player, {
        startTile,
        endTile,
        endTick: tick + DITCH_FORCED_MOVE_TICKS,
        direction: angle,
    });

    // teleportPlayer() internally calls stopAnimation() which queues seqId=-1.
    // Clear it so the jump animation lands in the same player_info frame as the exactmove.
    player.clearPendingSeqs();

    // Jump animation: sequence id=6132
    services.playPlayerSeq?.(player, DITCH_CROSS_ANIM_ID);

    // face_angle: snap orientation to the crossing direction
    player.setForcedOrientation(angle);

    // Synth sound: id=2462, delay=25 client cycles = 500ms
    services.sendSound?.(player, DITCH_CROSS_SOUND_ID, { delayMs: DITCH_CROSS_SOUND_DELAY_MS });
}

export function registerWildernessAccessHandlers(registry: IScriptRegistry, _services: ScriptServices): void {
    registry.registerLocScript({
        locId: WILDERNESS_DITCH_LOC_ID,
        action: "cross",
        handler: handleDitchCross,
    });
}

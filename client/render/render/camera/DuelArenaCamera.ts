import { ARENA_CENTER, DUEL_LOBBY_CENTER } from "../../../common/duel/DuelProtocol";
import { duelStore } from "../../../game/duel/DuelStore";
import { getDuelCameraState } from "../../../game/duel/DuelCameraControls";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { ProjectionType } from "../../../game/Camera";
import { sampleBridgeHeightForWorldTile } from "../../../game/scene/BridgeHeightSampler";
import { LoadingRequirement } from "../../../game/state/LoadingTracker";
import type { WebGLOsrsRendererHost } from "../hostInterface";

/** Orbit the local player using the original camera axes and streamed ground height. */
export function updateDuelArenaCamera(host: WebGLOsrsRendererHost, timeSec?: number): void {
    const camera = host.osrsClient.camera;
    const lobby = duelStore.getSnapshot().location === "lobby";
    const center = lobby ? DUEL_LOBBY_CENTER : ARENA_CENTER;
    const index = host.getControlledPlayerEcsIndex();
    const player = host.osrsClient.playerEcs;
    const focusX = index === undefined ? center.x + .5 : player.getX(index) / 128;
    const focusY = index === undefined ? center.y + .5 : player.getY(index) / 128;
    const level = index === undefined ? center.level : player.getLevel(index);
    // A narrower lens keeps the frame on sand and arena walls instead of the horizon.
    camera.setViewportFovValues(512, 512);
    const distance = getDuelCameraState(host.osrsClient).distance;
    camera.setProjectionType(ProjectionType.PERSPECTIVE);
    const pitch = -camera.getScenePitchRadians();
    const yaw = camera.yaw * RS_TO_RADIANS;
    const ground = sampleBridgeHeightForWorldTile(
        host.mapManager,
        focusX, focusY, level,
    );
    camera.snapToPosition(
        focusX - Math.sin(yaw) * Math.cos(pitch) * distance,
        ground.valid ? ground.height - 0.7 - Math.sin(pitch) * distance : undefined,
        focusY - Math.cos(yaw) * Math.cos(pitch) * distance,
    );

    // The standard follow camera owns this loading milestone. Keep it in duel mode, too.
    if (ground.valid && !host.mapDataLoadedNotified && timeSec !== undefined) {
        if (host.heightValidAtTime === undefined) {
            host.heightValidAtTime = timeSec;
        } else if (timeSec - host.heightValidAtTime >= 1) {
            host.mapDataLoadedNotified = true;
            host.osrsClient.loadingTracker.markComplete(LoadingRequirement.MAP_DATA_LOADED);
        }
    }
}

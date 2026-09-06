import Denque from "denque";
import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import { button, folder } from "leva";
import { Schema } from "leva/dist/declarations/src/types";
import {
    DrawCall,
    Framebuffer,
    App as PicoApp,
    PicoGL,
    Program,
    Renderbuffer,
    Texture,
    Timer,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import {
    getClientCycle,
    getCurrentTick,
    getServerTickPhaseNow,
    isServerConnected,
    sendEmote,
    sendInteractFollow,
    sendInteractStop,
    subscribeTick,
} from "../../network/ServerConnection";
import { sendLogin } from "../../network/ServerConnection";
import { flushPackets } from "../../network/packet";
import { createTextureArray } from "../../picogl/PicoTexture";
import { RS_TO_RADIANS } from "../../rs/MathConstants";
import { CollisionFlag } from "../../common/CollisionFlag";
import { isInWilderness } from "../../common/world/Wilderness";
import {
    getWorldLocChanges,
    getWorldLocSpawns,
    getWorldTerrainOverrides,
} from "../../common/gamemode/GamemodeContentStore";
import { OsrsMenuEntry } from "../../rs/MenuEntry";
import { MenuTargetType } from "../../rs/MenuEntry";
import type { OverlayFloorType } from "../../rs/config/floortype/OverlayFloorType";
import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { NpcDrawPriority, NpcType } from "../../rs/config/npctype/NpcType";
import { PlayerAppearance } from "../../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../../rs/config/player/PlayerModelLoader";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { getMapIndexFromTile, getMapPlaneId, getMapSquareId } from "../../rs/map/MapFileIndex";
import { Model } from "../../rs/model/Model";
import { ModelData } from "../../rs/model/ModelData";
import { Scene } from "../../rs/scene/Scene";
import { getUiScale } from "../../ui/UiScale";
import { ClickCrossOverlay } from "../../ui/devoverlay/ClickCrossOverlay";
import { GroundItemOverlay } from "../../ui/devoverlay/GroundItemOverlay";
import { HealthBarOverlay } from "../../ui/devoverlay/HealthBarOverlay";
import { HitsplatOverlay } from "../../ui/devoverlay/HitsplatOverlay";
import {
    InteractHighlightDrawTarget,
    InteractHighlightOverlay,
} from "../../ui/devoverlay/InteractHighlightOverlay";
import { LoadingMessageOverlay } from "../../ui/devoverlay/LoadingMessageOverlay";
import { LoginOverlay } from "../../ui/devoverlay/LoginOverlay";
import { OverheadPrayerOverlay } from "../../ui/devoverlay/OverheadPrayerOverlay";
import { OverheadTextOverlay } from "../../ui/devoverlay/OverheadTextOverlay";
import {
    HealthBarEntry,
    HitsplatEntry,
    OverheadPrayerEntry,
    OverheadTextEntry,
    type OverlayUpdateArgs,
    RenderPhase,
} from "../../ui/devoverlay/Overlay";
import { OverlayManager } from "../../ui/devoverlay/OverlayManager";
import type { TileMarkerOverlay } from "../../ui/devoverlay/TileMarkerOverlay";
import { TileTextOverlay } from "../../ui/devoverlay/TileTextOverlay";
import { WidgetsOverlay } from "../../ui/devoverlay/WidgetsOverlay";
import { MENU_ACTION_DEPRIORITIZE_OFFSET, MenuAction, menuAction } from "../../ui/menu/MenuAction";
import { worldEntriesToSimple } from "../../ui/menu/MenuBridge";
import type { MenuClickContext, SimpleMenuEntry } from "../../ui/menu/MenuEngine";
import { chooseDefaultMenuEntry, shouldLeftClickOpenMenu } from "../../ui/menu/MenuEngine";
import { MenuOpcode } from "../../ui/menu/MenuState";
import { Model2DRenderer } from "../../ui/model/Model2DRenderer";
import {
    canTargetGroundItem,
    canTargetNpc,
    canTargetObject,
    canTargetPlayer,
} from "../../widgets/WidgetFlags";
import { WidgetLoader } from "../../widgets/WidgetLoader";
import { WidgetManager } from "../../widgets/WidgetManager";
import { layoutWidgets } from "../../widgets/layout/WidgetLayout";
import { collectWidgetsAtPoint } from "../../widgets/menu/utils";
import {
    getCanvasCssSize,
    isIos,
    isMobileMode,
    isTouchDevice,
    isWebGL2Supported,
} from "../../common/utils/DeviceUtil";
import { clamp } from "../../common/utils/MathUtil";
import { ClientState } from "../../game/ClientState";
import { GameRenderer } from "../../game/GameRenderer";
import type { HitsplatEventPayload } from "../../game/GameRenderer";
import { OsrsRendererType, WEBGL } from "../../game/GameRenderers";
import { ClickMode, getMousePos } from "../../game/InputManager";
import { OsrsClient } from "../../game/OsrsClient";
import { ActorAnimationClip } from "../../game/actor/ActorAnimation";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    MAX_HITSPLAT_SLOTS,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../../game/actor/ActorOverlayState";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../../game/data/ground/GroundItemStore";
import { NpcEcs } from "../../game/ecs/NpcEcs";
import type { PlayerAnimKey } from "../../game/ecs/PlayerEcs";
import { GameState, LoginIndex } from "../../game/login";
import { Ray, rayIntersectsBox } from "../../game/math/Raycast";
import { isMouseInUIRegion as checkMouseInUIRegion } from "../../game/menu/WorldMenuBuilder";
import {
    advanceAnimation,
    computeMovementOrientation,
    computeMovementStep,
    interpolateRotation,
    parseInteractionTarget,
} from "../../game/movement/NpcClientTick";
import type { TileMarkersPluginConfig } from "../../game/plugins/tilemarkers/types";
import { computeRoofPlaneLimit } from "../../game/roof/RoofVisibility";
import { sampleBridgeHeightForWorldTile } from "../../game/scene/BridgeHeightSampler";
import {
    BridgePlaneStrategy,
    resolveBridgePromotedPlane,
    resolveCollisionSamplePlaneForLocal,
    resolveCollisionSamplePlaneForWorldTile,
    resolveGroundItemStackPlane,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForLocal,
    resolveInteractionPlaneForWorldTile,
} from "../../game/scene/PlaneResolver";
import { SceneRaycastHit, SceneRaycaster } from "../../game/scene/SceneRaycaster";
import {
    TILE_FLAG_BRIDGE,
    getTileRenderFlagAt as lookupTileRenderFlagAt,
} from "../../game/scene/TileRenderFlags";
import { LoadingRequirement } from "../../game/state/LoadingTracker";
import type { PlayerSpotAnimationEvent } from "../../game/sync/PlayerSyncTypes";
import { RAD_TO_RS_UNITS, computeFacingRotation } from "../../game/utils/rotation";
import { AnimationFrames } from "../AnimationFrames";
import { ChatheadFactory } from "../ChatheadFactory";
import { type DrawBackend, createDrawBackend } from "../DrawBackend";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { profiler } from "../PerformanceProfiler";
import { PlayerChatheadFactory } from "../PlayerChatheadFactory";
import { resolveFogRange } from "../RenderDistancePolicy";
import { WebGLMapSquare } from "../WebGLMapSquare";
import { WorldEntityAnimator } from "../WorldEntityAnimator";
import { SceneBuffer } from "../buffer/SceneBuffer";
import { getModelFaces, isModelFaceTransparent } from "../buffer/SceneBuffer";
import { GfxManager } from "../gfx/GfxManager";
import { GfxRenderer } from "../gfx/GfxRenderer";
import { buildGroundItemGeometry } from "../ground/GroundItemMeshBuilder";
import { type MinimapIcon, SdMapData } from "../loader/SdMapData";
import { SdMapDataLoader } from "../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../loader/SdMapLoaderInput";
import { isDoorLocType } from "../loc/SceneLocs";
import {
    DynamicNpcAnimLoader,
    DynamicNpcFrameGeometry,
    DynamicNpcSequenceMeta,
} from "../npc/DynamicNpcAnimLoader";
import { PlayerRenderer } from "../player/PlayerRenderer";
import { ProjectileManager } from "../projectiles/ProjectileManager";
import { ProjectileRenderer } from "../projectiles/ProjectileRenderer";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
    createPlayerProgram,
    createProjectileProgram,
} from "../shaders/Shaders";
import { KNOWN_WATER_TEXTURE_IDS } from "../water/WaterTextureIds";
import type { WebGLOsrsRendererHost } from "./hostInterface";
import { RENDER_CONSTANTS } from "./constants";

export function updateCameraFollow(host: WebGLOsrsRendererHost, deltaTime?: number, timeSec?: number): void {

        const pe = host.osrsClient.playerEcs;
        const playerEcsIndex = host.getControlledPlayerEcsIndex();
        if (playerEcsIndex === undefined) return;

        const px = pe.getX(playerEcsIndex) | 0;
        const py = pe.getY(playerEcsIndex) | 0;
        const playerX = px / 128;
        const playerZ = py / 128;

        // Update player position for fog calculation (use actual player pos)
        host.playerPosUni[0] = playerX;
        host.playerPosUni[1] = playerZ;

        // OSRS follow camera uses a smoothed focal point (oculusOrbFocalPointX/Y) that eases toward the player.
        // Important: update is tick-based (integer math), not frame-delta based; otherwise the camera/focal timebase
        // diverges from the tick interpolation timebase and introduces visible jitter at high refresh rates.
        const clientCycle = getClientCycle() | 0;
        const targetSubX = px;
        const targetSubZ = py;

        let smoothingCycles = 0;
        if (!host.followCamFocalInitialized || host.followCamFocalLastClientCycle < 0) {
            host.followCamFocalXSub = targetSubX;
            host.followCamFocalZSub = targetSubZ;
            host.followCamFocalLastClientCycle = clientCycle;
            host.followCamFocalInitialized = true;
        } else {
            const cyclesElapsed = (clientCycle - host.followCamFocalLastClientCycle) | 0;
            // If we fell behind a lot (tab background / stall), just resync.
            if (cyclesElapsed < 0 || cyclesElapsed > 32) {
                host.followCamFocalXSub = targetSubX;
                host.followCamFocalZSub = targetSubZ;
                host.followCamFocalLastClientCycle = clientCycle;
                smoothingCycles = 1;
            } else if (cyclesElapsed > 0) {
                smoothingCycles = cyclesElapsed;
                for (let i = 0; i < cyclesElapsed; i++) {
                    const dxFocal = targetSubX - host.followCamFocalXSub;
                    const dzFocal = targetSubZ - host.followCamFocalZSub;
                    // OSRS: snap focal if >500 sub-units away.
                    if (dxFocal < -500 || dxFocal > 500 || dzFocal < -500 || dzFocal > 500) {
                        host.followCamFocalXSub = targetSubX;
                        host.followCamFocalZSub = targetSubZ;
                    } else {
                        // OSRS: focal += (target - focal) / 16 (integer division).
                        if (dxFocal !== 0) host.followCamFocalXSub += (dxFocal / 16) | 0;
                        if (dzFocal !== 0) host.followCamFocalZSub += (dzFocal / 16) | 0;
                    }
                }
                host.followCamFocalLastClientCycle = clientCycle;
            }
        }

        const focalSubX = host.followCamFocalXSub;
        const focalSubZ = host.followCamFocalZSub;
        const basePlane = pe.getLevel(playerEcsIndex) | 0;
        const onWorldEntity = host.getControlledPlayerWorldViewId() >= 0;
        // Pitch pressure eases on the client-cycle timebase like the focal point;
        // per-frame easing would converge several times faster than OSRS at high refresh rates.
        if (!onWorldEntity) {
            host.updateCameraTerrainPitchPressure(focalSubX, focalSubZ, basePlane, smoothingCycles);
        } else {
            // On a world entity (ship) the deck is flat; let pressure decay to the minimum
            // so it doesn't artificially restrict the camera pitch.
            for (let i = 0; i < smoothingCycles; i++) {
                const current = host.cameraTerrainPitchPressure | 0;
                if (current <= 32768) break;
                host.cameraTerrainPitchPressure = current + (((32768 - current) / 80) | 0);
            }
        }

        const targetX = focalSubX / 128;
        const targetZ = focalSubZ / 128;

        // OSRS: vertical follow uses the player's height, not the smoothed focal point height.
        // (X/Z lag slightly, Y follows the player with camFollowHeight-style offset).
        const playerHeightSample = sampleBridgeHeightForWorldTile(
            host.mapManager,
            playerX,
            playerZ,
            basePlane,
            BridgePlaneStrategy.RENDER,
        );

        const camera = host.osrsClient.camera;
        // OSRS uses the effective viewport height after viewport-shape clamping,
        // not the raw canvas height, to derive follow-camera distance.
        const sceneViewport = host.getSceneViewportWidgetRect();
        const viewportWidth = sceneViewport.width || camera.viewportWidth || host.app.width;
        const viewportHeight = sceneViewport.height || camera.viewportHeight || host.app.height;
        const { viewportHeight: effectiveViewportHeight } = camera.computeViewportMetricsForSize(
            viewportWidth,
            viewportHeight,
        );

        // OSRS pitch -> distance mapping, with viewport-dependent zoom scaling
        // zoom = (zoomWidth - zoomHeight) * clamp(viewportHeight - 334, 0..100) / 100 + zoomHeight
        const v = clamp(effectiveViewportHeight - 334, 0, 100);
        const zoom =
            (host.osrsClient.zoomWidth - host.osrsClient.zoomHeight) * (v / 100) +
            host.osrsClient.zoomHeight;
        let minimumCamAngleX = (host.cameraTerrainPitchPressure | 0) >> 8;
        // active pitch-shake also raises the minimum camera angle for orbit distance.
        if (host.cameraShakeEnabled[4]) {
            const shakeMinCamAngleX = (host.cameraShakeWaveAmplitude[4] | 0) + 128;
            if (shakeMinCamAngleX > minimumCamAngleX) {
                minimumCamAngleX = shakeMinCamAngleX;
            }
        }
        // Orbit and view must use the same terrain-limited pitch. Keeping the limit
        // separate from input pitch lets the user's angle return as pressure decays.
        camera.setMinimumScenePitchAngle(minimumCamAngleX);
        const camAngleX = camera.getScenePitchAngle();

        const yawRad = (camera.yaw - 1024) * RS_TO_RADIANS;
        const pitchRad = -camAngleX * RS_TO_RADIANS;

        // Build rotation matrix identical to the scene camera order (no translation).
        const rot = host.followCamRot;
        mat4.identity(rot);
        mat4.rotateY(rot, rot, yawRad);
        mat4.rotateZ(rot, rot, Math.PI);
        mat4.rotateX(rot, rot, pitchRad);

        // Camera forward in world space (camera looks down -Z).
        const forward = host.followCamForward;
        vec3.transformMat4(forward, host.followCamForwardAxis, rot);
        vec3.normalize(forward, forward);

        const baseRadius = 600 + 3 * camAngleX; // world units (1 tile = 128 units)
        const radius = (baseRadius * zoom) / 256; // world units
        const dist = radius / 128; // tiles
        let desiredPosX = targetX - forward[0] * dist;
        let desiredPosZ = targetZ - forward[2] * dist;
        // Keep camera in integer sub-tile units (1/128 tile) to match OSRS camera math and prevent shimmer.
        desiredPosX = Math.round(desiredPosX * 128) / 128;
        desiredPosZ = Math.round(desiredPosZ * 128) / 128;

        // Always snap X/Z for tight player follow (prevents stutter/drift vs player)
        camera.snapToPosition(desiredPosX, undefined, desiredPosZ);

        // If height data isn't valid yet (map not loaded), skip Y updates entirely.
        // This prevents the camera from snapping to height=0 then jumping when data loads.
        if (!playerHeightSample.valid) {
            return;
        }

        // Track when height data first became valid, then wait for fog animation to complete
        // (fog fade-in takes 1 second: smoothstep over u_currentTime - u_timeLoaded)
        if (!host.mapDataLoadedNotified && timeSec !== undefined) {
            if (host.heightValidAtTime === undefined) {
                // First frame with valid height - record the time
                host.heightValidAtTime = timeSec;
            } else if (timeSec - host.heightValidAtTime >= 1.0) {
                // Fog animation complete (1 second elapsed) - notify loading tracker
                host.mapDataLoadedNotified = true;
                host.osrsClient.loadingTracker.markComplete(LoadingRequirement.MAP_DATA_LOADED);
            }
        }

        const focusHeightTiles = (host.osrsClient.camFollowHeight | 0) / 128.0;
        const targetY = playerHeightSample.height - focusHeightTiles;
        // Camera Y is purely the orbit position around the focal point; terrain clipping is
        // handled by the pitch clamp pressure, never by raising the camera off its orbit.
        const desiredPosY = Math.round((targetY - forward[1] * dist) * 128) / 128;

        // Tight follow: snap camera height to the computed orbit position to keep the target stable in view.
        camera.snapToPosition(undefined, desiredPosY, undefined);
    
}

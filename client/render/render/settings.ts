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

export function setSkyColor(host: WebGLOsrsRendererHost, r: number, g: number, b: number) {

        host.skyColor[0] = r / 255;
        host.skyColor[1] = g / 255;
        host.skyColor[2] = b / 255;
    
}

export function setSceneHslOverride(host: WebGLOsrsRendererHost, hue: number, sat: number, lum: number, amount: number): void {

        host.sceneHslOverride[0] = hue;
        host.sceneHslOverride[1] = sat;
        host.sceneHslOverride[2] = lum;
        host.sceneHslOverride[3] = amount;
    
}

export function setSceneHslOverrideFromPacked(host: WebGLOsrsRendererHost, packedHsl: number, amount: number): void {

        const hue = (packedHsl >> 10) & 63;
        const sat = (packedHsl >> 7) & 7;
        const lum = packedHsl & 127;
        host.setSceneHslOverride(hue, sat, lum, amount);
    
}

export function clearSceneHslOverride(host: WebGLOsrsRendererHost, ): void {

        host.sceneHslOverride[0] = -1;
        host.sceneHslOverride[1] = -1;
        host.sceneHslOverride[2] = -1;
        host.sceneHslOverride[3] = 0;
    
}

export function setSmoothTerrain(host: WebGLOsrsRendererHost, enabled: boolean): void {

        const updated = host.smoothTerrain !== enabled;
        host.smoothTerrain = enabled;
        if (updated) {
            host.clearMaps();
        }
    
}

export function setMsaa(host: WebGLOsrsRendererHost, enabled: boolean): void {

        const updated = host.msaaEnabled !== enabled;
        host.msaaEnabled = enabled;
        if (updated) {
            host.needsFramebufferUpdate = true;
        }
    
}

export function setFxaa(host: WebGLOsrsRendererHost, enabled: boolean): void {

        host.fxaaEnabled = enabled;
    
}

export function finishRenderFrame(host: WebGLOsrsRendererHost, 
        camera: any,
        deltaTime: number,
        showDebugTimer: boolean,
        profileGpuTimer: boolean,
    ): void {

        profiler.endFrame(deltaTime);

        let geoBytes = 0;
        for (const map of host.mapManager.mapSquares.values()) {
            geoBytes += (map.interleavedBuffer as any)?.byteLength ?? 0;
            geoBytes += (map.indexBuffer as any)?.byteLength ?? 0;
        }
        try {
            const pr: any = host.playerRenderer as any;
            const vbo = pr.getInterleavedBuffer?.();
            const ibo = pr.getIndexBuffer?.();
            if (vbo) geoBytes += (vbo as any).byteLength ?? 0;
            if (ibo) geoBytes += (ibo as any).byteLength ?? 0;
        } catch {}
        host.stats.geometryGpuBytes = geoBytes;

        host.stats.texturesLoaded = host.loadedTextureIds.size;
        host.stats.texturesTotal = host.textureIds.length;
        host.stats.width = host.app.width | 0;
        host.stats.height = host.app.height | 0;
        host.stats.sceneWidth = host.sceneRenderWidth | 0;
        host.stats.sceneHeight = host.sceneRenderHeight | 0;

        host.stats.cameraPosX = camera.getPosX();
        host.stats.cameraPosY = camera.getPosY();
        host.stats.cameraPosZ = camera.getPosZ();
        host.stats.cameraPitchRS = camera.pitch | 0;
        host.stats.cameraYawRS = camera.getYaw() | 0;
        host.stats.cameraRollRS = 0;

        const debugPlayerIndex = host.getControlledPlayerEcsIndex();
        if (debugPlayerIndex !== undefined) {
            host.stats.playerTileX = (host.osrsClient.playerEcs.getX(debugPlayerIndex) / 128) | 0;
            host.stats.playerTileY = (host.osrsClient.playerEcs.getY(debugPlayerIndex) / 128) | 0;
            host.stats.playerLevel = host.osrsClient.playerEcs.getLevel(debugPlayerIndex) | 0;
        }

        if ((showDebugTimer || profileGpuTimer) && host.timer.ready()) {
            profiler.recordGpuTime(host.timer.gpuTime);
        }

        if (showDebugTimer && host.timer.ready()) {
            host.osrsClient.debugText = `Frame Time GL: ${host.timer.gpuTime.toFixed(
                2,
            )}ms\n JS: ${host.timer.cpuTime.toFixed(2)}ms`;
        }
    
}

export function setLoadNpcs(host: WebGLOsrsRendererHost, enabled: boolean): void {

        const updated = host.loadNpcs !== enabled;
        host.loadNpcs = enabled;
        if (updated) {
            host.clearMaps();
        }
    
}

export function onResize(host: WebGLOsrsRendererHost, width: number, height: number): void {

        try {
            // Guard against resize before init
            if (!host.app) {
                return;
            }

            host.app.resize(width, height);

            // Explicitly update app dimensions in case PicoGL doesn't
            (host.app as any).width = width;
            (host.app as any).height = height;

            // Sync widgetManager dimensions with the current UI layout space.
            const uiMetrics = host.computeUiRenderMetrics(width, height);
            host.osrsClient?.widgetManager?.resize(uiMetrics.layoutW, uiMetrics.layoutH);

            // All in-world overlays render in buffer pixel space, so their scale must match
            // renderScaleX (uiScale × DPR) so sprites/text appear the correct physical size.
            const overlayScale = uiMetrics.renderScaleX;
            if (host.overheadTextOverlay) host.overheadTextOverlay.scale = overlayScale;
            if (host.hitsplatOverlay) host.hitsplatOverlay.scale = overlayScale;
            if (host.overheadPrayerOverlay) host.overheadPrayerOverlay.scale = overlayScale;
            if (host.healthBarOverlay) {
                host.healthBarOverlay.scale =
                    overlayScale * RENDER_CONSTANTS.HEALTH_BAR_VISUAL_SCALE;
            }
            if (host.clickCrossOverlay) host.clickCrossOverlay.scale = overlayScale;
            if (host.groundItemOverlay) host.groundItemOverlay.scale = overlayScale;
            (host.canvas as any).__uiRenderScale = overlayScale;

            // Trigger framebuffer recreation
            host.needsFramebufferUpdate = true;

            host.initTextureFramebuffer(width, height);
        } catch (e) {
            console.warn("[webgl] onResize error", e);
        }
    
}

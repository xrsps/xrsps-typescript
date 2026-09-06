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
import { RENDER_CONSTANTS, BrowserQualityProfile, DESKTOP_QUALITY_PROFILE, IOS_SAFARI_QUALITY_PROFILE, MOBILE_TOUCH_QUALITY_PROFILE } from "./constants";

export function getUiSurfaceCssSize(host: WebGLOsrsRendererHost, 
        safeBufW: number,
        safeBufH: number,
    ): { cssW: number; cssH: number } {

        let cssW = 0;
        let cssH = 0;
        const canvas = host.canvas;
        if (canvas) {
            const cssSize = getCanvasCssSize(canvas);
            cssW = cssSize.width;
            cssH = cssSize.height;
        }
        if (!Number.isFinite(cssW) || cssW <= 0 || !Number.isFinite(cssH) || cssH <= 0) {
            cssW = safeBufW;
            cssH = safeBufH;
        }
        return { cssW, cssH };
    
}

export function getMobileGameplayUiScale(host: WebGLOsrsRendererHost, 
        cssW: number,
        cssH: number,
        _bufW: number,
        _bufH: number,
    ): number {

        const safeCssW = Math.max(1, cssW);
        const safeCssH = Math.max(1, cssH);
        const shortestCssEdge = Math.max(1, Math.min(safeCssW, safeCssH));
        const viewportT = clamp(
            (shortestCssEdge - RENDER_CONSTANTS.MOBILE_GAMEPLAY_UI_PHONE_EDGE) /
            (RENDER_CONSTANTS.MOBILE_GAMEPLAY_UI_TABLET_EDGE -
                RENDER_CONSTANTS.MOBILE_GAMEPLAY_UI_PHONE_EDGE),
            0,
            1,
        );
        const desiredUiScale =
            RENDER_CONSTANTS.MOBILE_GAMEPLAY_UI_MIN_SCALE +
            (RENDER_CONSTANTS.MOBILE_GAMEPLAY_UI_MAX_SCALE -
                RENDER_CONSTANTS.MOBILE_GAMEPLAY_UI_MIN_SCALE) *
            viewportT;
        return Math.max(1, desiredUiScale);
    
}

export function computeUiRenderMetrics(host: WebGLOsrsRendererHost, 
        bufW: number,
        bufH: number,
    ): {
        layoutW: number;
        layoutH: number;
        renderScaleX: number;
        renderScaleY: number;
        renderOffsetX: number;
        renderOffsetY: number;
    } {

        const safeBufW = Math.max(1, bufW | 0);
        const safeBufH = Math.max(1, bufH | 0);
        const gameState = host.osrsClient.gameState;
        const isLoginLikeState =
            gameState === GameState.DOWNLOADING || host.osrsClient.isOnLoginScreen();
        const rootInterface = host.osrsClient.widgetManager?.rootInterface ?? -1;
        const isMobileGameplayRoot = isMobileMode && !isLoginLikeState && rootInterface === 601;
        const { cssW, cssH } = host.getUiSurfaceCssSize(safeBufW, safeBufH);

        if (!isLoginLikeState) {
            if (!isMobileGameplayRoot) {
                const desktopUiScale = getUiScale(cssW, cssH);
                // RuneLite stretched mode reduces the logical resizable game size by the
                // configured factor, then stretches that real size back to the window.
                // The DPR component of the render scale is snapped to an integer so
                // bitmap sprites and fonts map 1:N onto device pixels at any OS or
                // browser scaling (110% -> 1, Retina -> 2, zoomed Retina 2.2 -> 2);
                // the manual interface-scaling factor stays unsnapped for OSRS parity.
                // Layout uses ceil so renderScale stays exact — up to one device pixel
                // at the right/bottom edge is clipped instead of letting the ratio
                // drift fractional (which made glyph widths uneven by 1px).
                const dprComponent = Math.max(1, Math.round(safeBufW / Math.max(1, cssW)));
                const renderScale = dprComponent * desktopUiScale;
                const layoutW = Math.max(1, Math.ceil(safeBufW / renderScale));
                const layoutH = Math.max(1, Math.ceil(safeBufH / renderScale));
                return {
                    layoutW,
                    layoutH,
                    renderScaleX: renderScale,
                    renderScaleY: renderScale,
                    renderOffsetX: 0,
                    renderOffsetY: 0,
                };
            }

            // Keep the mobile root in its own logical UI surface so handheld widgets can render
            // larger than pure scene-space widgets while still compositing into the full buffer.
            const uiScale = host.getMobileGameplayUiScale(cssW, cssH, safeBufW, safeBufH);
            const layoutW = Math.max(1, Math.round(cssW * uiScale));
            const layoutH = Math.max(1, Math.round(cssH * uiScale));
            return {
                layoutW,
                layoutH,
                renderScaleX: safeBufW / layoutW,
                renderScaleY: safeBufH / layoutH,
                renderOffsetX: 0,
                renderOffsetY: 0,
            };
        }

        // The title/login surface gets the same integer device-pixel snapping as the
        // gameplay branch above so NEAREST-sampled title sprites and bitmap fonts map
        // 1:N onto device pixels at any OS/browser scaling. The scene itself stays
        // authored at native fixed-mode size (no interface scaling on the title
        // screen, matching OSRS). Layout uses ceil so the scale stays exact — up to
        // one device pixel at the right/bottom edge is clipped instead of letting the
        // ratio drift fractional (which made login text resample unevenly).
        const dprComponent = Math.max(1, Math.round(safeBufW / Math.max(1, cssW)));
        const layoutW = Math.max(1, Math.ceil(safeBufW / dprComponent));
        const layoutH = Math.max(1, Math.ceil(safeBufH / dprComponent));

        return {
            layoutW,
            layoutH,
            renderScaleX: dprComponent,
            renderScaleY: dprComponent,
            renderOffsetX: 0,
            renderOffsetY: 0,
        };
    
}

export function getUiRenderMetrics(host: WebGLOsrsRendererHost, 
        bufW: number,
        bufH: number,
    ): {
        layoutW: number;
        layoutH: number;
        renderScaleX: number;
        renderScaleY: number;
        renderOffsetX: number;
        renderOffsetY: number;
    } {

        return host.computeUiRenderMetrics(bufW, bufH);
    
}

export function getCanvasResolutionScale(host: WebGLOsrsRendererHost, cssWidth: number, cssHeight: number): number {

        if (typeof window === "undefined") {
            return 1;
        }

        const dpr = window.devicePixelRatio || 1;
        if (!Number.isFinite(dpr) || dpr <= 1) {
            return 1;
        }

        const gameState = host.osrsClient.gameState;
        const isLoginLikeState =
            gameState === GameState.DOWNLOADING || host.osrsClient.isOnLoginScreen();

        // Render the backing store at the device's real pixel ratio, including
        // fractional values (125%/150% Windows scaling, browser zoom on Retina),
        // so the 3D scene is always native-resolution. computeUiRenderMetrics
        // snaps the widget render scale to an integer device-pixel ratio so
        // NEAREST-sampled sprites and bitmap fonts stay pixel-perfect.
        // Handhelds cap at 2 for fill-rate/memory; the iOS scene framebuffer is
        // compensated via its quality profile so 3D cost stays flat.
        const maxScale = isLoginLikeState ? 3 : isMobileMode ? 2 : 3;
        const targetScale = Math.min(dpr, maxScale);

        const safeCssWidth = Number.isFinite(cssWidth) ? Math.max(1, cssWidth) : 1;
        const safeCssHeight = Number.isFinite(cssHeight) ? Math.max(1, cssHeight) : 1;
        const maxPixelCount = isTouchDevice ? 6_000_000 : 12_000_000;
        const targetPixelCount = safeCssWidth * safeCssHeight * targetScale * targetScale;
        if (targetPixelCount <= maxPixelCount) {
            return targetScale;
        }

        const cappedScale = Math.sqrt(maxPixelCount / (safeCssWidth * safeCssHeight));
        return Math.max(1, Math.min(targetScale, cappedScale));
    
}

export function resolveBrowserQualityProfile(host: WebGLOsrsRendererHost, ): BrowserQualityProfile {

        if (!isTouchDevice) {
            return DESKTOP_QUALITY_PROFILE;
        }
        if (isIos) {
            return IOS_SAFARI_QUALITY_PROFILE;
        }
        return MOBILE_TOUCH_QUALITY_PROFILE;
    
}

export function syncBrowserQualityProfile(host: WebGLOsrsRendererHost, ): BrowserQualityProfile {

        const profile = host.resolveBrowserQualityProfile();
        host.activeQualityProfile = profile;
        if (host.activeQualityProfileKey !== profile.key) {
            host.activeQualityProfileKey = profile.key;
            host.fxaaEnabled = profile.fxaaEnabled;
            host.needsFramebufferUpdate = true;
        }
        return profile;
    
}

export function getActiveQualityProfileKey(host: WebGLOsrsRendererHost, ): string {

        return host.syncBrowserQualityProfile().key;
    
}

export function getActiveQualityProfileLabel(host: WebGLOsrsRendererHost, ): string {

        return host.syncBrowserQualityProfile().label;
    
}

export function getSceneResolutionScale(host: WebGLOsrsRendererHost, ): number {

        if (!isTouchDevice || host.osrsClient.isOnLoginScreen()) {
            host.osrsClient.mobileEffectiveResolutionScale = 1;
            return 1;
        }
        const profile = host.syncBrowserQualityProfile();
        const scale = Math.max(0.5, Math.min(1, profile.defaultSceneScale || 1));
        host.osrsClient.mobileEffectiveResolutionScale = scale;
        return scale;
    
}

export function getSceneRenderSize(host: WebGLOsrsRendererHost, ): { width: number; height: number } {

        const scale = host.getSceneResolutionScale();
        return {
            width: Math.max(1, Math.round(host.app.width * scale)),
            height: Math.max(1, Math.round(host.app.height * scale)),
        };
    
}

export function syncSceneFramebufferSize(host: WebGLOsrsRendererHost, ): void {

        if (!host.app) {
            return;
        }
        const desired = host.getSceneRenderSize();
        if (
            (desired.width | 0) !== (host.sceneRenderWidth | 0) ||
            (desired.height | 0) !== (host.sceneRenderHeight | 0)
        ) {
            host.needsFramebufferUpdate = true;
        }
    
}

export function scaleViewportRectToSceneBuffer(host: WebGLOsrsRendererHost, rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): { x: number; y: number; width: number; height: number } {

        const sceneWidth = Math.max(1, host.sceneRenderWidth | 0);
        const sceneHeight = Math.max(1, host.sceneRenderHeight | 0);
        const appWidth = Math.max(1, host.app.width | 0);
        const appHeight = Math.max(1, host.app.height | 0);
        return {
            x: Math.max(0, Math.round((rect.x / appWidth) * sceneWidth)),
            y: Math.max(0, Math.round((rect.y / appHeight) * sceneHeight)),
            width: Math.max(1, Math.round((rect.width / appWidth) * sceneWidth)),
            height: Math.max(1, Math.round((rect.height / appHeight) * sceneHeight)),
        };
    
}

export function shouldUseDirectTextureScenePass(host: WebGLOsrsRendererHost, ): boolean {

        return false;
    
}

export function getSceneViewportWidgetRect(host: WebGLOsrsRendererHost, ): { x: number; y: number; width: number; height: number } {

        const widgetManager = host.osrsClient.widgetManager;
        const viewport = widgetManager?.viewportWidget as any;
        const fallbackWidth = Math.max(1, (host.app.width || host.canvas.width || 1) | 0);
        const fallbackHeight = Math.max(1, (host.app.height || host.canvas.height || 1) | 0);
        const layoutWidth = Math.max(1, (widgetManager?.canvasWidth || fallbackWidth) | 0);
        const layoutHeight = Math.max(1, (widgetManager?.canvasHeight || fallbackHeight) | 0);
        const scaleX = fallbackWidth / layoutWidth;
        const scaleY = fallbackHeight / layoutHeight;
        const rawX =
            typeof viewport?._absLogicalX === "number"
                ? viewport._absLogicalX
                : typeof viewport?._absX === "number"
                    ? Math.round(viewport._absX / scaleX)
                    : typeof viewport?.x === "number"
                        ? viewport.x
                        : 0;
        const rawY =
            typeof viewport?._absLogicalY === "number"
                ? viewport._absLogicalY
                : typeof viewport?._absY === "number"
                    ? Math.round(viewport._absY / scaleY)
                    : typeof viewport?.y === "number"
                        ? viewport.y
                        : 0;
        const rawWidth = typeof viewport?.width === "number" ? viewport.width | 0 : fallbackWidth;
        const rawHeight =
            typeof viewport?.height === "number" ? viewport.height | 0 : fallbackHeight;

        return {
            x: Math.round(rawX * scaleX),
            y: Math.round(rawY * scaleY),
            width: Math.max(1, Math.round(rawWidth * scaleX)),
            height: Math.max(1, Math.round(rawHeight * scaleY)),
        };
    
}

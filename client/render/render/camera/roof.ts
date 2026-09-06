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
} from "../../../network/ServerConnection";
import { sendLogin } from "../../../network/ServerConnection";
import { flushPackets } from "../../../network/packet";
import { createTextureArray } from "../../../picogl/PicoTexture";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { CollisionFlag } from "../../../common/CollisionFlag";
import { isInWilderness } from "../../../common/world/Wilderness";
import {
    getWorldLocChanges,
    getWorldLocSpawns,
    getWorldTerrainOverrides,
} from "../../../common/gamemode/GamemodeContentStore";
import { OsrsMenuEntry } from "../../../rs/MenuEntry";
import { MenuTargetType } from "../../../rs/MenuEntry";
import type { OverlayFloorType } from "../../../rs/config/floortype/OverlayFloorType";
import { LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../../rs/config/loctype/LocModelType";
import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcDrawPriority, NpcType } from "../../../rs/config/npctype/NpcType";
import { PlayerAppearance } from "../../../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../../../rs/config/player/PlayerModelLoader";
import { decodeInteractionIndex } from "../../../rs/interaction/InteractionIndex";
import { getMapIndexFromTile, getMapPlaneId, getMapSquareId } from "../../../rs/map/MapFileIndex";
import { Model } from "../../../rs/model/Model";
import { ModelData } from "../../../rs/model/ModelData";
import { Scene } from "../../../rs/scene/Scene";
import { getUiScale } from "../../../ui/UiScale";
import { ClickCrossOverlay } from "../../../ui/devoverlay/ClickCrossOverlay";
import { GroundItemOverlay } from "../../../ui/devoverlay/GroundItemOverlay";
import { HealthBarOverlay } from "../../../ui/devoverlay/HealthBarOverlay";
import { HitsplatOverlay } from "../../../ui/devoverlay/HitsplatOverlay";
import {
    InteractHighlightDrawTarget,
    InteractHighlightOverlay,
} from "../../../ui/devoverlay/InteractHighlightOverlay";
import { LoadingMessageOverlay } from "../../../ui/devoverlay/LoadingMessageOverlay";
import { LoginOverlay } from "../../../ui/devoverlay/LoginOverlay";
import { OverheadPrayerOverlay } from "../../../ui/devoverlay/OverheadPrayerOverlay";
import { OverheadTextOverlay } from "../../../ui/devoverlay/OverheadTextOverlay";
import {
    HealthBarEntry,
    HitsplatEntry,
    OverheadPrayerEntry,
    OverheadTextEntry,
    type OverlayUpdateArgs,
    RenderPhase,
} from "../../../ui/devoverlay/Overlay";
import { OverlayManager } from "../../../ui/devoverlay/OverlayManager";
import type { TileMarkerOverlay } from "../../../ui/devoverlay/TileMarkerOverlay";
import { TileTextOverlay } from "../../../ui/devoverlay/TileTextOverlay";
import { WidgetsOverlay } from "../../../ui/devoverlay/WidgetsOverlay";
import { MENU_ACTION_DEPRIORITIZE_OFFSET, MenuAction, menuAction } from "../../../ui/menu/MenuAction";
import { worldEntriesToSimple } from "../../../ui/menu/MenuBridge";
import type { MenuClickContext, SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import { chooseDefaultMenuEntry, shouldLeftClickOpenMenu } from "../../../ui/menu/MenuEngine";
import { MenuOpcode } from "../../../ui/menu/MenuState";
import { Model2DRenderer } from "../../../ui/model/Model2DRenderer";
import {
    canTargetGroundItem,
    canTargetNpc,
    canTargetObject,
    canTargetPlayer,
} from "../../../widgets/WidgetFlags";
import { WidgetLoader } from "../../../widgets/WidgetLoader";
import { WidgetManager } from "../../../widgets/WidgetManager";
import { layoutWidgets } from "../../../widgets/layout/WidgetLayout";
import { collectWidgetsAtPoint } from "../../../widgets/menu/utils";
import {
    getCanvasCssSize,
    isIos,
    isMobileMode,
    isTouchDevice,
    isWebGL2Supported,
} from "../../../common/utils/DeviceUtil";
import { clamp } from "../../../common/utils/MathUtil";
import { ClientState } from "../../../game/ClientState";
import { GameRenderer } from "../../../game/GameRenderer";
import type { HitsplatEventPayload } from "../../../game/GameRenderer";
import { OsrsRendererType, WEBGL } from "../../../game/GameRenderers";
import { ClickMode, getMousePos } from "../../../game/InputManager";
import { OsrsClient } from "../../../game/OsrsClient";
import { ActorAnimationClip } from "../../../game/actor/ActorAnimation";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    MAX_HITSPLAT_SLOTS,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../../../game/actor/ActorOverlayState";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../../../game/data/ground/GroundItemStore";
import { NpcEcs } from "../../../game/ecs/NpcEcs";
import type { PlayerAnimKey } from "../../../game/ecs/PlayerEcs";
import { GameState, LoginIndex } from "../../../game/login";
import { Ray, rayIntersectsBox } from "../../../game/math/Raycast";
import { isMouseInUIRegion as checkMouseInUIRegion } from "../../../game/menu/WorldMenuBuilder";
import {
    advanceAnimation,
    computeMovementOrientation,
    computeMovementStep,
    interpolateRotation,
    parseInteractionTarget,
} from "../../../game/movement/NpcClientTick";
import type { TileMarkersPluginConfig } from "../../../game/plugins/tilemarkers/types";
import { computeRoofPlaneLimit } from "../../../game/roof/RoofVisibility";
import { sampleBridgeHeightForWorldTile } from "../../../game/scene/BridgeHeightSampler";
import {
    BridgePlaneStrategy,
    resolveBridgePromotedPlane,
    resolveCollisionSamplePlaneForLocal,
    resolveCollisionSamplePlaneForWorldTile,
    resolveGroundItemStackPlane,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForLocal,
    resolveInteractionPlaneForWorldTile,
} from "../../../game/scene/PlaneResolver";
import { SceneRaycastHit, SceneRaycaster } from "../../../game/scene/SceneRaycaster";
import {
    TILE_FLAG_BRIDGE,
    getTileRenderFlagAt as lookupTileRenderFlagAt,
} from "../../../game/scene/TileRenderFlags";
import { LoadingRequirement } from "../../../game/state/LoadingTracker";
import type { PlayerSpotAnimationEvent } from "../../../game/sync/PlayerSyncTypes";
import { RAD_TO_RS_UNITS, computeFacingRotation } from "../../../game/utils/rotation";
import { AnimationFrames } from "../../AnimationFrames";
import { ChatheadFactory } from "../../ChatheadFactory";
import { type DrawBackend, createDrawBackend } from "../../DrawBackend";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../../DrawRange";
import { InteractType } from "../../InteractType";
import { profiler } from "../../PerformanceProfiler";
import { PlayerChatheadFactory } from "../../PlayerChatheadFactory";
import { resolveFogRange } from "../../RenderDistancePolicy";
import { WebGLMapSquare } from "../../WebGLMapSquare";
import { WorldEntityAnimator } from "../../WorldEntityAnimator";
import { SceneBuffer } from "../../buffer/SceneBuffer";
import { getModelFaces, isModelFaceTransparent } from "../../buffer/SceneBuffer";
import { GfxManager } from "../../gfx/GfxManager";
import { GfxRenderer } from "../../gfx/GfxRenderer";
import { buildGroundItemGeometry } from "../../ground/GroundItemMeshBuilder";
import { type MinimapIcon, SdMapData } from "../../loader/SdMapData";
import { SdMapDataLoader } from "../../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../../loader/SdMapLoaderInput";
import { isDoorLocType } from "../../loc/SceneLocs";
import {
    DynamicNpcAnimLoader,
    DynamicNpcFrameGeometry,
    DynamicNpcSequenceMeta,
} from "../../npc/DynamicNpcAnimLoader";
import { PlayerRenderer } from "../../player/PlayerRenderer";
import { ProjectileManager } from "../../projectiles/ProjectileManager";
import { ProjectileRenderer } from "../../projectiles/ProjectileRenderer";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
    createPlayerProgram,
    createProjectileProgram,
} from "../../shaders/Shaders";
import { KNOWN_WATER_TEXTURE_IDS } from "../../water/WaterTextureIds";
import type { WebGLOsrsRendererHost } from "../hostInterface";
import { RENDER_CONSTANTS } from "../constants";

export function getControlledPlayerEcsIndex(host: WebGLOsrsRendererHost, ): number | undefined {

        const playerEcs = host.osrsClient.playerEcs;
        const controlledServerId = host.osrsClient.controlledPlayerServerId | 0;

        if (controlledServerId > 0) {
            try {
                const controlledIndex = playerEcs.getIndexForServerId(controlledServerId);
                if (controlledIndex !== undefined) {
                    return controlledIndex | 0;
                }
            } catch {}
        }

        try {
            const size = playerEcs.size?.() ?? (playerEcs as any).size?.() ?? 0;
            if (size > 0) {
                return 0;
            }
        } catch {}

        return undefined;
    
}

export function getPlayerBasePlane(host: WebGLOsrsRendererHost, ): number {

        let rawPlane = 0;
        const idx = host.getControlledPlayerEcsIndex();
        if (idx !== undefined) {
            rawPlane = host.osrsClient.playerEcs.getLevel(idx) | 0;
        }

        // If the plane above has the bridge flag, the player renders at that plane.
        const playerTile = host.getPlayerTileXY();
        if (!playerTile) {
            return rawPlane; // Can't check for bridges if we don't know the player's tile
        }

        return resolveBridgePromotedPlane(host.mapManager, rawPlane, playerTile);
    
}

export function getPlayerRawPlane(host: WebGLOsrsRendererHost, ): number {

        const idx = host.getControlledPlayerEcsIndex();
        if (idx !== undefined) return host.osrsClient.playerEcs.getLevel(idx) | 0;
        return 0;
    
}

export function getPlayerTileXY(host: WebGLOsrsRendererHost, ): { x: number; y: number } {

        const controlledIndex = host.getControlledPlayerEcsIndex();
        if (controlledIndex !== undefined) {
            return {
                x: (host.osrsClient.playerEcs.getX(controlledIndex) / 128) | 0,
                y: (host.osrsClient.playerEcs.getY(controlledIndex) / 128) | 0,
            };
        }
        // Fallback to camera tile if no player
        return {
            x: Math.floor(host.osrsClient.camera.getPosX()),
            y: Math.floor(host.osrsClient.camera.getPosZ()),
        };
    
}

export function getCameraTileXY(host: WebGLOsrsRendererHost, ): { x: number; y: number } {

        return {
            x: Math.floor(host.osrsClient.camera.getPosX()),
            y: Math.floor(host.osrsClient.camera.getPosZ()),
        };
    
}

export function clampCullTileToGridBounds(host: WebGLOsrsRendererHost, tile: { x: number; y: number }): { x: number; y: number } {

        const bounds = host.mapManager.getGridTileBounds();
        if (!bounds) {
            return { x: tile.x | 0, y: tile.y | 0 };
        }
        const minX = bounds.minX | 0;
        const minY = bounds.minY | 0;
        // Grid bounds use exclusive max edge in world tiles.
        const maxX = Math.max(minX, (bounds.maxX | 0) - 1);
        const maxY = Math.max(minY, (bounds.maxY | 0) - 1);
        return {
            x: Math.max(minX, Math.min(maxX, tile.x | 0)),
            y: Math.max(minY, Math.min(maxY, tile.y | 0)),
        };
    
}

export function getRenderCullTile(host: WebGLOsrsRendererHost, ): { x: number; y: number } {

        // Scene draw-distance is camera-anchored, then clamped to the loaded grid bounds.
        return host.clampCullTileToGridBounds(host.getCameraTileXY());
    
}

export function getRoofTargetTile(host: WebGLOsrsRendererHost, 
        playerTile: { x: number; y: number },
        cameraTile: { x: number; y: number },
    ): { x: number; y: number } {

        // In follow mode the camera focal point tracks the player tile. In free-camera
        // mode there is no focal state, so the camera tile stands in for it.
        return host.osrsClient.followPlayerCamera ? playerTile : cameraTile;
    
}

export function getCameraPitchRs(host: WebGLOsrsRendererHost, ): number {

        const pitch = clamp(host.osrsClient.camera.pitch | 0, 0, 512);
        return 128 + Math.floor((pitch * 255) / 512);
    
}

export function computeFrameRoofPlaneLimit(host: WebGLOsrsRendererHost, ): number {

        const cameraTile = host.getCameraTileXY();
        const playerTile = host.getPlayerTileXY();

        return computeRoofPlaneLimit(host.mapManager, host.maxLevel, {
            playerRawPlane: host.getPlayerBasePlane() | 0,
            cameraPitch: host.getCameraPitchRs(),
            roofsHidden: host.osrsClient.roofsHidden,
            cameraTile,
            playerTile,
            targetTile: host.getRoofTargetTile(playerTile, cameraTile),
        });
    
}

export function getRoofPlaneLimit(host: WebGLOsrsRendererHost, ): number {

        if (host.roofPlaneLimit === undefined) {
            host.roofPlaneLimit = host.computeFrameRoofPlaneLimit();
        }
        return host.roofPlaneLimit;
    
}

export function invalidateRoofState(host: WebGLOsrsRendererHost, ): void {

        host.roofPlaneLimit = undefined;
    
}

export function getControlledPlayerWorldViewId(host: WebGLOsrsRendererHost, ): number {

        const idx = host.osrsClient.playerEcs.getIndexForServerId(
            host.osrsClient.controlledPlayerServerId,
        );
        return idx !== undefined ? host.osrsClient.playerEcs.getWorldViewId(idx) | 0 : -1;
    
}

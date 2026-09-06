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

export function isBridgeSurfaceTile(host: WebGLOsrsRendererHost, tileX: number, tileY: number, plane: number): boolean {

        const map = host.getPreferredMapForWorldTile(tileX, tileY);
        if (!map || typeof map.isBridgeSurface !== "function") return false;
        const local = host.getMapLocalTile(map, tileX, tileY);
        if (!local) {
            return false;
        }
        return map.isBridgeSurface(plane, local.x, local.y);
    
}

export function toCssEvent(host: WebGLOsrsRendererHost, 
        gx?: number,
        gy?: number,
        frameCount?: number,
    ): { clientX: number; clientY: number } | undefined {

        if (typeof gx !== "number" || typeof gy !== "number") return undefined;
        // Update cached rect once per frame (or first call)
        if (frameCount !== undefined && frameCount !== host.cachedCanvasRectFrame) {
            host.cachedCanvasRect = host.canvas.getBoundingClientRect();
            host.cachedCanvasRectFrame = frameCount;
        } else if (!host.cachedCanvasRect) {
            host.cachedCanvasRect = host.canvas.getBoundingClientRect();
        }
        const rect = host.cachedCanvasRect;
        host.cachedCssEventResult.clientX = rect.left + gx;
        host.cachedCssEventResult.clientY = rect.top + gy;
        return host.cachedCssEventResult;
    
}

export function isMouseInUIRegion(host: WebGLOsrsRendererHost, mx: number, my: number): boolean {

        return checkMouseInUIRegion(mx, my, host.canvas.width, host.canvas.height);
    
}

export function screenToRay(host: WebGLOsrsRendererHost, mouseX: number, mouseY: number): Ray | null {

        if (!host.app || !host.osrsClient.camera?.viewProjMatrix) return null;

        const camera = host.osrsClient.camera;
        if (!camera.containsScreenPoint(mouseX, mouseY)) return null;
        const width = camera.screenWidth || host.app.width;
        const height = camera.screenHeight || host.app.height;
        if (width <= 0 || height <= 0) return null;

        // Normalize to NDC
        const nx = (2 * mouseX) / width - 1;
        const ny = 1 - (2 * mouseY) / height;

        // Unproject from NDC to world using inverse view-projection
        mat4.invert(host.tmpInvViewProj, camera.viewProjMatrix);
        host.tmpNear[0] = nx;
        host.tmpNear[1] = ny;
        host.tmpNear[2] = -1;
        host.tmpNear[3] = 1;
        host.tmpFar[0] = nx;
        host.tmpFar[1] = ny;
        host.tmpFar[2] = 1;
        host.tmpFar[3] = 1;
        vec4.transformMat4(host.tmpNear, host.tmpNear, host.tmpInvViewProj);
        vec4.transformMat4(host.tmpFar, host.tmpFar, host.tmpInvViewProj);

        // Perspective divide
        const nearW = host.tmpNear[3] || 1.0;
        const farW = host.tmpFar[3] || 1.0;
        host.tmpNear[0] /= nearW;
        host.tmpNear[1] /= nearW;
        host.tmpNear[2] /= nearW;
        host.tmpFar[0] /= farW;
        host.tmpFar[1] /= farW;
        host.tmpFar[2] /= farW;

        // Create ray
        const origin = vec3.fromValues(host.tmpNear[0], host.tmpNear[1], host.tmpNear[2]);
        const farPos = vec3.fromValues(host.tmpFar[0], host.tmpFar[1], host.tmpFar[2]);
        const direction = vec3.create();
        vec3.subtract(direction, farPos, origin);
        vec3.normalize(direction, direction);

        return new Ray(origin, direction);
    
}

export function appendGroundItemMenuEntries(host: WebGLOsrsRendererHost, 
        menuEntries: OsrsMenuEntry[],
        examineEntries: OsrsMenuEntry[],
    ): void {

        const focusTile = host.osrsClient.menuTile ?? host.osrsClient.hoveredTile;
        if (!focusTile) return;
        // Ground item stacks are stored on the raw client plane even when bridge tiles render above it.
        const plane = resolveGroundItemStackPlane(host.getPlayerRawPlane() | 0);
        const stacks = host.osrsClient.getGroundItemsAt(
            focusTile.tileX | 0,
            focusTile.tileY | 0,
            plane | 0,
        );
        if (!stacks || stacks.length === 0) return;
        for (const stack of stacks) {
            const label = stack.quantity > 1 ? `${stack.name} x ${stack.quantity}` : stack.name;
            const tile = {
                tileX: stack.tile.x | 0,
                tileY: stack.tile.y | 0,
                plane: stack.tile.level | 0,
            };
            menuEntries.push({
                option: "Take",
                targetId: stack.itemId,
                targetType: MenuTargetType.OBJ,
                targetName: label,
                targetLevel: stack.tile.level | 0,
                tile,
                onClick: () => host.osrsClient.takeGroundItem(stack),
            });
            examineEntries.push({
                option: "Examine",
                targetId: stack.itemId,
                targetType: MenuTargetType.OBJ,
                targetName: stack.name,
                targetLevel: stack.tile.level | 0,
                tile,
                onClick: () => host.osrsClient.examineGroundItem(stack),
            });
        }
    
}

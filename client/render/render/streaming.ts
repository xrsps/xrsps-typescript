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
import { RENDER_CONSTANTS, StreamMapBatch } from "./constants";

export function getPendingStreamMapCount(host: WebGLOsrsRendererHost, ): number {

        let count = 0;
        for (const batch of host.pendingStreamMapsByGeneration.values()) {
            count += batch.size;
        }
        return count | 0;
    
}

export function hasPendingMapStreamingWork(host: WebGLOsrsRendererHost, ): boolean {

        if (host.mapsToLoad.length > 0) return true;
        if (host.mapManager.loadingMapIds.size > 0) return true;
        return host.getPendingStreamMapCount() > 0;
    
}

export function syncStreamGenerationFromMapManager(host: WebGLOsrsRendererHost, ): void {

        const revision = host.mapManager.getGridRevision() | 0;
        if (revision === host.observedGridRevision) return;
        const nextExpected = new Set(host.mapManager.getGridMapIdsSnapshot());
        let carryForward: StreamMapBatch | undefined;
        for (const [generation, batch] of host.pendingStreamMapsByGeneration.entries()) {
            if ((generation | 0) >= revision) continue;
            for (const [mapId, mapData] of batch.entries()) {
                if (nextExpected.has(mapId)) {
                    if (!carryForward) carryForward = new Map<number, SdMapData>();
                    carryForward.set(mapId, mapData);
                } else {
                    host.mapManager.loadingMapIds.delete(mapId);
                }
            }
            host.pendingStreamMapsByGeneration.delete(generation);
        }
        host.observedGridRevision = revision;

        // Detect cross-region teleport: if none of the new maps are loaded,
        // skip the fog fade-in so they appear instantly.
        let hasOverlap = false;
        for (const mapId of nextExpected) {
            if (host.mapManager.mapSquares.has(mapId)) {
                hasOverlap = true;
                break;
            }
        }
        if (!hasOverlap && nextExpected.size > 0) {
            host.skipMapFadeIn = true;
        }

        host.activeStreamGeneration = revision;
        host.activeStreamExpectedMapIds = nextExpected;
        if (carryForward && carryForward.size > 0) {
            const active =
                host.pendingStreamMapsByGeneration.get(revision) ?? new Map<number, SdMapData>();
            for (const [mapId, mapData] of carryForward.entries()) {
                active.set(mapId, mapData);
            }
            host.pendingStreamMapsByGeneration.set(revision, active);
        }
    
}

export function queueStreamMapData(host: WebGLOsrsRendererHost, mapData: SdMapData, streamGeneration?: number): void {

        // Reject normal map data while an instance scene is active
        if (host.instanceActive) return;

        const mapId = getMapSquareId(mapData.mapX, mapData.mapY);
        const inTargetGrid = host.mapManager.isMapInTargetGrid(mapData.mapX, mapData.mapY);
        if (!inTargetGrid) {
            host.mapManager.loadingMapIds.delete(mapId);
            return;
        }

        const currentGeneration = host.activeStreamGeneration | 0;
        const queuedGeneration = typeof streamGeneration === "number" ? streamGeneration | 0 : 0;
        const targetGeneration =
            queuedGeneration > currentGeneration
                ? queuedGeneration
                : queuedGeneration > 0 && queuedGeneration < currentGeneration
                    ? currentGeneration
                    : Math.max(currentGeneration, queuedGeneration);

        let batch = host.pendingStreamMapsByGeneration.get(targetGeneration);
        if (!batch) {
            batch = new Map<number, SdMapData>();
            host.pendingStreamMapsByGeneration.set(targetGeneration, batch);
        }
        batch.set(mapId, mapData);
    
}

export function applyReadyStreamGenerationBatch(host: WebGLOsrsRendererHost, time: number): number {

        const generation = host.activeStreamGeneration | 0;
        const expected = host.activeStreamExpectedMapIds;
        const pending = host.pendingStreamMapsByGeneration.get(generation);
        if (!pending || expected.size === 0) return 0;
        if (
            !host.mainProgram ||
            !host.mainAlphaProgram ||
            !host.npcProgram ||
            !host.textureArray ||
            !host.textureMaterials ||
            !host.waterTextures ||
            !host.sceneUniformBuffer
        ) {
            return 0;
        }
        const mainProgram = host.mainProgram;
        const mainAlphaProgram = host.mainAlphaProgram;
        const npcProgram = host.npcProgram;
        const textureArray = host.textureArray;
        const textureMaterials = host.textureMaterials;
        const waterTextures = host.waterTextures;
        const sceneUniformBuffer = host.sceneUniformBuffer;

        // Apply maps as they arrive, but never apply surrounding chunks before
        // the player's own chunk (index 0 in the ordered grid).  This ensures the
        // map square the player is standing on always renders first.
        let applied = 0;
        let allReady = true;
        const orderedMapIds = host.mapManager.getGridMapIdsSnapshot();
        let playerChunkReady = false;
        if (orderedMapIds.length > 0) {
            const firstId = orderedMapIds[0];
            const firstMx = firstId >> 8;
            const firstMy = firstId & 0xff;
            playerChunkReady =
                !!pending.get(firstId) ||
                !!host.mapManager.getMap(firstMx, firstMy) ||
                host.mapManager.invalidMapIds.has(firstId);
        }
        for (const mapId of orderedMapIds) {
            const mapData = pending.get(mapId);
            if (!mapData) {
                const mx = mapId >> 8;
                const my = mapId & 0xff;
                if (!host.mapManager.getMap(mx, my) && !host.mapManager.invalidMapIds.has(mapId)) {
                    allReady = false;
                }
                continue;
            }
            if (!playerChunkReady) {
                allReady = false;
                continue;
            }
            if (!host.isValidMapData(mapData)) continue;
            pending.delete(mapId);
            applied++;
            host.loadMap(
                mainProgram,
                mainAlphaProgram,
                npcProgram,
                textureArray,
                textureMaterials,
                waterTextures,
                sceneUniformBuffer,
                mapData,
                time,
            );
        }
        if (allReady || pending.size === 0) {
            host.pendingStreamMapsByGeneration.delete(generation);
        }
        if (allReady) {
            host.skipMapFadeIn = false;
        }
        return applied | 0;
    
}

export function getMapIdForWorldTile(host: WebGLOsrsRendererHost, x: number, y: number): number {

        return getMapSquareId(Math.floor((x | 0) / 64), Math.floor((y | 0) / 64));
    
}

export function applyGamemodeWorldLocs(host: WebGLOsrsRendererHost, ): Set<number> {

        const affectedMapIds = new Set<number>();
        const nextOverrideKeys = new Set<string>();
        const nextSpawnKeys = new Set<string>();

        for (const change of getWorldLocChanges()) {
            const x = change.x | 0;
            const y = change.y | 0;
            const level = change.level | 0;
            const oldId = change.oldId | 0;
            const key = `${x},${y},${level},${oldId}`;
            nextOverrideKeys.add(key);
            affectedMapIds.add(host.getMapIdForWorldTile(x, y));

            host.locOverrides.set(key, {
                newId: change.newId | 0,
                newRotation:
                    typeof change.newRotation === "number" ? change.newRotation & 0x3 : undefined,
                moveToX: typeof change.moveToX === "number" ? change.moveToX | 0 : undefined,
                moveToY: typeof change.moveToY === "number" ? change.moveToY | 0 : undefined,
                matchType:
                    typeof change.matchType === "number"
                        ? (change.matchType as LocModelType)
                        : undefined,
                matchRotation:
                    typeof change.matchRotation === "number"
                        ? change.matchRotation & 0x3
                        : undefined,
            });
        }

        for (const spawn of getWorldLocSpawns()) {
            const x = spawn.x | 0;
            const y = spawn.y | 0;
            const level = spawn.level | 0;
            const key = `${x},${y},${level},${spawn.locId | 0},${spawn.shape | 0},${
                spawn.rotation & 0x3
            }`;
            nextSpawnKeys.add(key);
            affectedMapIds.add(host.getMapIdForWorldTile(x, y));

            host.locSpawns.set(key, {
                id: spawn.locId | 0,
                type: spawn.shape | 0,
                rotation: spawn.rotation & 0x3,
            });
        }

        const nextTerrainKeys = new Set<string>();
        for (const terrain of getWorldTerrainOverrides()) {
            const x = terrain.x | 0;
            const y = terrain.y | 0;
            const level = terrain.level | 0;
            const key = `${x},${y},${level}`;
            nextTerrainKeys.add(key);
            affectedMapIds.add(host.getMapIdForWorldTile(x, y));

            host.terrainOverrides.set(key, {
                height: Number.isFinite(terrain.height) ? terrain.height! | 0 : undefined,
                underlay:
                    typeof terrain.underlay === "number" ? terrain.underlay | 0 : undefined,
                overlay: typeof terrain.overlay === "number" ? terrain.overlay | 0 : undefined,
                shape: typeof terrain.shape === "number" ? terrain.shape | 0 : undefined,
                rotation:
                    typeof terrain.rotation === "number" ? terrain.rotation & 0x3 : undefined,
                renderFlags:
                    typeof terrain.renderFlags === "number"
                        ? terrain.renderFlags & 0xff
                        : undefined,
            });
        }

        for (const key of host.gamemodeWorldLocOverrideKeys) {
            if (nextOverrideKeys.has(key)) continue;
            host.locOverrides.delete(key);
            const [xRaw, yRaw] = key.split(",");
            affectedMapIds.add(host.getMapIdForWorldTile(Number(xRaw) | 0, Number(yRaw) | 0));
        }
        for (const key of host.gamemodeWorldLocSpawnKeys) {
            if (nextSpawnKeys.has(key)) continue;
            host.locSpawns.delete(key);
            const [xRaw, yRaw] = key.split(",");
            affectedMapIds.add(host.getMapIdForWorldTile(Number(xRaw) | 0, Number(yRaw) | 0));
        }
        for (const key of host.gamemodeWorldTerrainOverrideKeys) {
            if (nextTerrainKeys.has(key)) continue;
            host.terrainOverrides.delete(key);
            const [xRaw, yRaw] = key.split(",");
            affectedMapIds.add(host.getMapIdForWorldTile(Number(xRaw) | 0, Number(yRaw) | 0));
        }

        host.gamemodeWorldLocOverrideKeys = nextOverrideKeys;
        host.gamemodeWorldLocSpawnKeys = nextSpawnKeys;
        host.gamemodeWorldTerrainOverrideKeys = nextTerrainKeys;

        return affectedMapIds;
    
}

export function refreshGamemodeWorldLocs(host: WebGLOsrsRendererHost, ): void {

        const affectedMapIds = host.applyGamemodeWorldLocs();
        if (affectedMapIds.size === 0 || !host.osrsClient.loadedCache || host.instanceActive) {
            return;
        }

        for (const mapId of affectedMapIds) {
            if (!host.mapManager.mapSquares.has(mapId) && !host.mapManager.loadingMapIds.has(mapId)) {
                continue;
            }
            const mapX = mapId >> 8;
            const mapY = mapId & 0xff;
            host.pendingLocUpdates.add(mapId);
            host.scheduleLocReload(mapX, mapY);
        }
    
}

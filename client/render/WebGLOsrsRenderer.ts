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
} from "../network/ServerConnection";
import { sendLogin } from "../network/ServerConnection";
import { flushPackets } from "../network/packet";
import { createTextureArray } from "../picogl/PicoTexture";
import { RS_TO_RADIANS } from "../rs/MathConstants";
import { CollisionFlag } from "../common/CollisionFlag";
import { isInWilderness } from "../common/world/Wilderness";
import {
    getWorldLocChanges,
    getWorldLocSpawns,
    getWorldTerrainOverrides,
} from "../common/gamemode/GamemodeContentStore";
import { OsrsMenuEntry } from "../rs/MenuEntry";
import { MenuTargetType } from "../rs/MenuEntry";
import type { OverlayFloorType } from "../rs/config/floortype/OverlayFloorType";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { NpcModelLoader } from "../rs/config/npctype/NpcModelLoader";
import { NpcDrawPriority, NpcType } from "../rs/config/npctype/NpcType";
import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../rs/config/player/PlayerModelLoader";
import { decodeInteractionIndex } from "../rs/interaction/InteractionIndex";
import { getMapIndexFromTile, getMapPlaneId, getMapSquareId } from "../rs/map/MapFileIndex";
import { Model } from "../rs/model/Model";
import { ModelData } from "../rs/model/ModelData";
import { Scene } from "../rs/scene/Scene";
import { getUiScale } from "../ui/UiScale";
import { ClickCrossOverlay } from "../ui/devoverlay/ClickCrossOverlay";
import { GroundItemOverlay } from "../ui/devoverlay/GroundItemOverlay";
import { HealthBarOverlay } from "../ui/devoverlay/HealthBarOverlay";
import { HitsplatOverlay } from "../ui/devoverlay/HitsplatOverlay";
import {
    InteractHighlightDrawTarget,
    InteractHighlightOverlay,
} from "../ui/devoverlay/InteractHighlightOverlay";
import { LoadingMessageOverlay } from "../ui/devoverlay/LoadingMessageOverlay";
import { LoginOverlay } from "../ui/devoverlay/LoginOverlay";
import { OverheadPrayerOverlay } from "../ui/devoverlay/OverheadPrayerOverlay";
import { OverheadTextOverlay } from "../ui/devoverlay/OverheadTextOverlay";
import {
    HealthBarEntry,
    HitsplatEntry,
    OverheadPrayerEntry,
    OverheadTextEntry,
    type OverlayUpdateArgs,
    RenderPhase,
} from "../ui/devoverlay/Overlay";
import { OverlayManager } from "../ui/devoverlay/OverlayManager";
import type { TileMarkerOverlay } from "../ui/devoverlay/TileMarkerOverlay";
import { TileTextOverlay } from "../ui/devoverlay/TileTextOverlay";
import { WidgetsOverlay } from "../ui/devoverlay/WidgetsOverlay";
import { MENU_ACTION_DEPRIORITIZE_OFFSET, MenuAction, menuAction } from "../ui/menu/MenuAction";
import { worldEntriesToSimple } from "../ui/menu/MenuBridge";
import type { MenuClickContext, SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { chooseDefaultMenuEntry, shouldLeftClickOpenMenu } from "../ui/menu/MenuEngine";
import { MenuOpcode } from "../ui/menu/MenuState";
import { Model2DRenderer } from "../ui/model/Model2DRenderer";
import {
    canTargetGroundItem,
    canTargetNpc,
    canTargetObject,
    canTargetPlayer,
} from "../widgets/WidgetFlags";
import { WidgetLoader } from "../widgets/WidgetLoader";
import { WidgetManager } from "../widgets/WidgetManager";
import { layoutWidgets } from "../widgets/layout/WidgetLayout";
import { collectWidgetsAtPoint } from "../widgets/menu/utils";
import {
    getCanvasCssSize,
    isIos,
    isMobileMode,
    isTouchDevice,
    isWebGL2Supported,
} from "../common/utils/DeviceUtil";
import { clamp } from "../common/utils/MathUtil";
import { ClientState } from "../game/ClientState";
import { GameRenderer } from "../game/GameRenderer";
import type { HitsplatEventPayload } from "../game/GameRenderer";
import { OsrsRendererType, WEBGL } from "../game/GameRenderers";
import { ClickMode, getMousePos } from "../game/InputManager";
import { OsrsClient } from "../game/OsrsClient";
import { ActorAnimationClip } from "../game/actor/ActorAnimation";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    MAX_HITSPLAT_SLOTS,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../game/actor/ActorOverlayState";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../game/data/ground/GroundItemStore";
import { NpcEcs } from "../game/ecs/NpcEcs";
import type { PlayerAnimKey } from "../game/ecs/PlayerEcs";
import { GameState, LoginIndex } from "../game/login";
import { Ray, rayIntersectsBox } from "../game/math/Raycast";
import { isMouseInUIRegion as checkMouseInUIRegion } from "../game/menu/WorldMenuBuilder";
import {
    advanceAnimation,
    computeMovementOrientation,
    computeMovementStep,
    interpolateRotation,
    parseInteractionTarget,
} from "../game/movement/NpcClientTick";
import type { TileMarkersPluginConfig } from "../game/plugins/tilemarkers/types";
import { computeRoofPlaneLimit } from "../game/roof/RoofVisibility";
import { sampleBridgeHeightForWorldTile } from "../game/scene/BridgeHeightSampler";
import {
    BridgePlaneStrategy,
    resolveBridgePromotedPlane,
    resolveCollisionSamplePlaneForLocal,
    resolveCollisionSamplePlaneForWorldTile,
    resolveGroundItemStackPlane,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForLocal,
    resolveInteractionPlaneForWorldTile,
} from "../game/scene/PlaneResolver";
import { SceneRaycastHit, SceneRaycaster } from "../game/scene/SceneRaycaster";
import {
    TILE_FLAG_BRIDGE,
    getTileRenderFlagAt as lookupTileRenderFlagAt,
} from "../game/scene/TileRenderFlags";
import { LoadingRequirement } from "../game/state/LoadingTracker";
import type { PlayerSpotAnimationEvent } from "../game/sync/PlayerSyncTypes";
import { RAD_TO_RS_UNITS, computeFacingRotation } from "../game/utils/rotation";
import { AnimationFrames } from "./AnimationFrames";
import { ChatheadFactory } from "./ChatheadFactory";
import { type DrawBackend, createDrawBackend } from "./DrawBackend";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "./DrawRange";
import { InteractType } from "./InteractType";
import { profiler } from "./PerformanceProfiler";
import { PlayerChatheadFactory } from "./PlayerChatheadFactory";
import { resolveFogRange } from "./RenderDistancePolicy";
import { WebGLMapSquare } from "./WebGLMapSquare";
import { WorldEntityAnimator } from "./WorldEntityAnimator";
import { SceneBuffer } from "./buffer/SceneBuffer";
import { getModelFaces, isModelFaceTransparent } from "./buffer/SceneBuffer";
import { GfxManager } from "./gfx/GfxManager";
import { GfxRenderer } from "./gfx/GfxRenderer";
import { buildGroundItemGeometry } from "./ground/GroundItemMeshBuilder";
import { type MinimapIcon, SdMapData } from "./loader/SdMapData";
import { SdMapDataLoader } from "./loader/SdMapDataLoader";
import { SdMapLoaderInput } from "./loader/SdMapLoaderInput";
import { isDoorLocType } from "./loc/SceneLocs";
import {
    DynamicNpcAnimLoader,
    DynamicNpcFrameGeometry,
    DynamicNpcSequenceMeta,
} from "./npc/DynamicNpcAnimLoader";
import { PlayerRenderer } from "./player/PlayerRenderer";
import { ProjectileManager } from "./projectiles/ProjectileManager";
import { ProjectileRenderer } from "./projectiles/ProjectileRenderer";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
    createPlayerProgram,
    createProjectileProgram,
} from "./shaders/Shaders";
import { KNOWN_WATER_TEXTURE_IDS } from "./water/WaterTextureIds";

import * as render from "./render";
import { RENDER_CONSTANTS, TextureFilterMode, HD_SKY_COLOR_VEC4, HD_AUTO_FOG_DEPTH_FACTOR } from "./render/constants";
import type {
    BrowserQualityProfile,
    BrowserQualityProfileKey,
    ColorRgb,
    InteractHighlightTarget,
    LocHighlightTarget,
    LocReloadBatchState,
    NpcHighlightTarget,
    StreamMapBatch,
    WaterMaterialParams,
} from "./render/constants";

export { formatPlayerCombatLabel } from "./render/constants";
export type {
    BrowserQualityProfile,
    BrowserQualityProfileKey,
    ColorRgb,
    InteractHighlightTarget,
    LocHighlightTarget,
    NpcHighlightTarget,
    LocReloadBatchState,
    StreamMapBatch,
    TextureFilterMode,
    WaterMaterialParams,
} from "./render/constants";

export class WebGLOsrsRenderer extends GameRenderer<WebGLMapSquare> {
    type: OsrsRendererType = WEBGL;

    dataLoader = new SdMapDataLoader();

    // Track dynamic loc changes: Map<"x,y,level,oldId", {newId,newRotation?,moveToX?,moveToY?,seqId?,seqRandomStart?,matchType?,matchRotation?}>
    public locOverrides: Map<
        string,
        {
            newId: number;
            newRotation?: number;
            moveToX?: number;
            moveToY?: number;
            seqId?: number;
            seqRandomStart?: boolean;
            matchType?: LocModelType;
            matchRotation?: number;
        }
    > = new Map();
    public locAnimTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    /** When true, an instance scene is active and normal map streaming is suppressed. */
    public instanceActive: boolean = false;
    public instanceTemplateChunks: number[][][] | null = null;
    public instanceRegionX: number = 0;
    public instanceRegionY: number = 0;
    public instanceLocRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    /** Active world entity overlays (rendered on top of normal world). */
    public worldEntityOverlays: Map<
        number,
        {
            entityIndex: number;
            configId: number;
            templateChunks: number[][][];
            regionX: number;
            regionY: number;
            worldX: number;
            worldY: number;
            sizeX: number;
            sizeZ: number;
            extraLocs: Array<{
                id: number;
                x: number;
                y: number;
                level: number;
                shape: number;
                rotation: number;
            }>;
            extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>;
            basePlane: number;
            deckHeight?: number;
        }
    > = new Map();
    public worldEntityLocRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    public nextWorldEntityLoadToken: number = 1;
    public worldEntityLoadTokens: Map<number, number> = new Map();
    public worldEntityReloadAfterMs: Map<number, number> = new Map();
    worldEntityAnimator?: WorldEntityAnimator;
    /** Dynamically spawned locs (LOC_ADD_CHANGE). Keyed by "x,y,level,shape". */
    public addedLocs: Map<
        string,
        { locId: number; x: number; y: number; level: number; shape: number; rotation: number }
    > = new Map();
    // Track spawned locs not in base map data. The first three key fields are world x,y,level.
    public locSpawns: Map<string, { id: number; type: number; rotation: number }> = new Map();
    public terrainOverrides: Map<
        string,
        {
            underlay?: number;
            overlay?: number;
            shape?: number;
            rotation?: number;
            renderFlags?: number;
            height?: number;
        }
    > = new Map();
    public gamemodeWorldLocOverrideKeys: Set<string> = new Set();
    public gamemodeWorldLocSpawnKeys: Set<string> = new Set();
    public gamemodeWorldTerrainOverrideKeys: Set<string> = new Set();
    public pendingLocUpdates: Set<number> = new Set();
    // Ordinary objects are in their own GPU mesh, so their changes can avoid
    // rebuilding terrain, NPCs, minimap data, or door geometry.
    public pendingLocGeometryUpdates: Set<number> = new Set();
    // Doors have their own GPU geometry.  Keep these separate from general loc
    // updates so opening one does not recreate terrain and every static model
    // in its map square.
    public pendingDoorLocUpdates: Set<number> = new Set();
    public pendingLocReloadMaps: Map<number, { mapX: number; mapY: number }> = new Map();
    public pendingLocReloadFlushTimer?: ReturnType<typeof setTimeout>;
    public nextLocReloadBatchId: number = 1;
    public pendingLocReloadBatches: Map<number, LocReloadBatchState> = new Map();
    // Map-square -> loc reload batch id for maps that are queued and must be applied together.
    public queuedLocReloadBatchByMap: Map<number, number> = new Map();
    public observedGridRevision: number = -1;
    // Skip the 1-second fog fade-in for maps loaded after a cross-region
    // teleport so the destination appears instantly.
    public skipMapFadeIn: boolean = false;
    public activeStreamGeneration: number = 0;
    public activeStreamExpectedMapIds: Set<number> = new Set();
    public pendingStreamMapsByGeneration: Map<number, StreamMapBatch> = new Map();
    // Coalesce back-to-back loc changes (e.g. 2-piece gates) to avoid transient half-updates/flicker.
    public static readonly LOC_RELOAD_FLUSH_DELAY_MS = 25;
    public static readonly MOBILE_GAMEPLAY_UI_MIN_SCALE = 1.25;
    public static readonly MOBILE_GAMEPLAY_UI_MAX_SCALE = 1.5;
    public static readonly MOBILE_GAMEPLAY_UI_PHONE_EDGE = 390;
    public static readonly MOBILE_GAMEPLAY_UI_TABLET_EDGE = 768;
    app!: PicoApp;
    gl!: WebGL2RenderingContext;

    timer!: Timer;

    hasMultiDraw: boolean = false;

    quadPositions?: VertexBuffer;
    quadArray?: VertexArray;

    // Shaders
    shadersPromise?: Promise<Program[]>;
    mainProgram?: Program;
    mainAlphaProgram?: Program;
    npcProgram?: Program;
    npcProgramOpaque?: Program; // multi-draw variant (no alpha discard)
    projectileProgram?: Program;
    projectileProgramOpaque?: Program;
    playerProgram?: Program;
    playerProgramOpaque?: Program; // multi-draw variant (no alpha discard)
    frameProgram?: Program;
    frameFxaaProgram?: Program;
    // Hover devoverlay program
    hoverLineProgram?: Program;

    public roofPlaneLimit?: number;

    // Uniforms
    sceneUniformBuffer?: UniformBuffer;

    cameraPosUni: vec2 = vec2.fromValues(0, 0);
    playerPosUni: vec2 = vec2.fromValues(0, 0);
    resolutionUni: vec2 = vec2.fromValues(0, 0);

    // Framebuffers
    needsFramebufferUpdate: boolean = false;

    // Whether overlay scales have been initialized for the current session.
    public _overlaysScaleInitialized: boolean = false;
    // Track login-like state to detect login→gameplay transition and re-sync overlay scales.
    // null = not yet seen; true = was in login/download state; false = was in gameplay.
    public _lastLoginLikeState: boolean | null = null;

    colorTarget?: Renderbuffer;
    depthTarget?: Renderbuffer;
    framebuffer?: Framebuffer;
    public sceneRenderWidth: number = 1;
    public sceneRenderHeight: number = 1;

    textureColorTarget?: Texture;
    textureDepthTarget?: Renderbuffer;
    textureFramebuffer?: Framebuffer;

    // Textures
    textureFilterMode: TextureFilterMode = TextureFilterMode.DISABLED;

    textureArray?: Texture;
    textureMaterials?: Texture;
    waterTextures?: Texture;
    waterShadingUnavailable = false;
    waterOverlayColors = new Map<number, [number, number, number]>();

    textureIds: number[] = [];
    loadedTextureIds: Set<number> = new Set();
    public textureIdIndexMap: Map<number, number> = new Map();
    public textureFrameCounts: Map<number, number> = new Map();
    public textureLayerCount: number = 0;
    public textureMipmapsDirty: boolean = false;
    public textureMipmapsDirtyAtMs: number = 0;
    public textureMipmapsLastGenAtMs: number = 0;
    public textureMipmapsDirtyUpdates: number = 0;

    public drawBackend?: DrawBackend;
    // Reusable array for filtered draw ranges (avoids per-frame allocation)
    public drawSubsetBuffer: DrawRange[] = [];
    // Reusable arrays for tickPass (avoids per-frame allocation)
    public visibleMapsBuffer: WebGLMapSquare[] = [];
    public ambientSoundBuffer: import("../game/audio/SoundEffectSystem").AmbientSoundInstance[] = [];
    public ambientSoundBufferIndex: number = 0;
    // Reusable object for gfxRenderer.renderMapPass calls
    public gfxRenderPassOffsets: { player?: number; npc?: number; world?: number } = {};
    // Reusable object for seqSoundCallback to avoid nested object allocation
    public seqSoundPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    public seqSoundOptions: { position: { x: number; y: number; z: number } } = {
        position: this.seqSoundPosition,
    };
    // PERF: Cached seqSoundCallback to avoid closure allocation per frame
    public seqSoundCallback = (seqType: any, frame: number, ctx: any) => {
        this.seqSoundPosition.x = ctx.x;
        this.seqSoundPosition.y = ctx.y;
        this.seqSoundPosition.z = ctx.level * 128;
        this.osrsClient.handleSeqFrameSounds(seqType, frame, this.seqSoundOptions);
    };
    // Throttle ambient sound collection to every N frames (reduces tick cost)
    public ambientSoundFrameCounter: number = 0;
    public static readonly AMBIENT_SOUND_THROTTLE_FRAMES = 3;
    // Memoized "does this loc (or any of its transforms) emit ambient sound"
    public locSoundPotentialCache: Map<number, boolean> = new Map();
    public groundItemStacks: Map<number, ClientGroundItemStack[]> = new Map();
    public groundItemStackHashes: Map<number, string> = new Map();

    /** Minimap icons keyed by map square and plane. */
    public minimapIcons: Map<number, MinimapIcon[]> = new Map();

    // Player footprint size in fine units; NPC-transformed players inherit the NPC size.
    public static readonly PLAYER_FOOTPRINT_RADIUS = (0.4 * 128) | 0;

    // Per-actor running 2D element offset shared by overhead text, health bars and
    // head icons within a frame; cleared each frame before entry collection.
    public actor2dStacks: Map<number, number> = new Map();

    // PERF: Cached bound helper functions for overlay updates (avoid .bind() allocation each frame)
    public cachedOverlayHelpers: {
        getTileHeightAtPlane: (x: number, y: number, plane: number) => number;
        getMinTileHeightInRadius: (
            x: number,
            z: number,
            plane: number,
            radiusFine: number,
        ) => number;
        sampleHeightAtExactPlane: (x: number, y: number, plane: number) => number;
        getHeightSamplePlaneForTile: (x: number, y: number, basePlane: number) => number;
        getEffectivePlaneForTile: (x: number, y: number, basePlane: number) => number;
        getOccupancyPlaneForTile: (x: number, y: number, basePlane: number) => number;
        getTileRenderFlagAt: (level: number, tileX: number, tileY: number) => number;
        isBridgeSurfaceTile: (x: number, y: number, plane: number) => boolean;
        worldToScreen: (x: number, y: number, z: number) => Float32Array | number[] | undefined;
        getCollisionFlagAt: (plane: number, x: number, y: number) => number;
    } | null = null;

    // PERF: Cached overlay update args to avoid per-frame object allocation
    public cachedSceneOverlayUpdateArgs: OverlayUpdateArgs | null = null;
    public cachedOverlayUpdateArgs: OverlayUpdateArgs | null = null;

    mapsToLoad: Denque<SdMapData> = new Denque();

    frameDrawCall?: DrawCall;
    frameFxaaDrawCall?: DrawCall;
    // UI overlays
    public overlayManager?: OverlayManager;
    public gfxManager?: GfxManager;
    public gfxRenderer?: GfxRenderer;
    public projectileManager?: ProjectileManager;
    public projectileRenderer?: ProjectileRenderer;
    public projectileRenderDebugCounts: Map<string, number> = new Map();
    public projectileDebugSettings = {
        freeze: false,
    };
    public hitsplatOverlay?: HitsplatOverlay;
    public healthBarOverlay?: HealthBarOverlay;
    public clickCrossOverlay?: ClickCrossOverlay;
    public tileTextOverlay?: TileTextOverlay;
    public tileMarkerOverlay?: TileMarkerOverlay;
    public groundItemOverlay?: GroundItemOverlay;
    public interactHighlightOverlay?: InteractHighlightOverlay;
    public interactHighlightHoverTarget?: InteractHighlightTarget;
    public interactHighlightActiveTarget?: InteractHighlightTarget;
    public interactHighlightActiveFromInteraction: boolean = false;
    public interactHighlightClickTick: number = -1;
    public readonly interactHighlightDrawTargets: InteractHighlightDrawTarget[] = [];
    public loginOverlay?: LoginOverlay;
    public loadingMessageOverlay?: LoadingMessageOverlay;
    public objectIdOverlay?: any;
    public walkableOverlay?: any;
    public widgetsOverlay?: WidgetsOverlay;
    public model2DRenderer?: Model2DRenderer;
    public itemIconRenderer?: any;
    public chatheadFactory?: ChatheadFactory;
    public playerChatheadFactory?: PlayerChatheadFactory;
    public playerModelLoader2D?: PlayerModelLoader;
    public hitsplatPool: HitsplatEntry[] = [];
    public hitsplatOutput: HitsplatEntry[] = [];
    public healthBarPool: HealthBarEntry[] = [];
    public healthBarOutput: HealthBarEntry[] = [];
    public overheadPrayerPool: OverheadPrayerEntry[] = [];
    public overheadPrayerOutput: OverheadPrayerEntry[] = [];
    public npcHealthBars: Map<number, ActorHealthBarsState> = new Map();
    public playerHealthBars: Map<number, ActorHealthBarsState> = new Map();
    public pendingControlledPlayerServerId?: number;
    public hitsplatSeenNpc: Set<number> = new Set();
    public actorServerTilesSeenNpc: Set<number> = new Set();
    // PERF: Cached arrays/maps for overlay state to avoid per-frame allocations
    public cachedActorServerTiles: Array<{
        x: number;
        y: number;
        plane: number;
        kind: "player" | "npc";
        serverId: number;
        label: string;
    }> = [];
    public cachedActorServerTilesCount: number = 0;
    public actorServerTilesNameCounts: Map<string, number> = new Map();
    public npcHitsplats: Map<number, ActorHitsplatState> = new Map();
    public playerHitsplats: Map<number, ActorHitsplatState> = new Map();
    public hitsplatTickUnsub?: () => void;
    // Cache NPC type properties to avoid repeated loader calls per frame
    public npcDefaultHeightCache: Map<number, number> = new Map(); // Actual model height in OSRS units
    public npcNameCache: Map<number, string> = new Map();

    // Settings
    maxLevel: number = Scene.MAX_LEVELS - 1;

    // 117HD blue skybox (#B9D6FF). Clear color + fog tint share this.
    skyColor: vec4 = vec4.fromValues(
        HD_SKY_COLOR_VEC4[0],
        HD_SKY_COLOR_VEC4[1],
        HD_SKY_COLOR_VEC4[2],
        HD_SKY_COLOR_VEC4[3],
    );
    fogDepth: number = 24; // Manual fog start (tiles); used only when autoFogDepth is off
    /** Dynamic fog: fog start tracks render distance each frame. */
    autoFogDepth: boolean = true;
    autoFogDepthFactor: number = HD_AUTO_FOG_DEPTH_FACTOR;

    // Scene-level HSL override for tinting all rendered geometry.
    // Values: [hue (-1=no override, 0-63), sat (-1=no override, 0-7),
    //          lum (-1=no override, 0-127), amount (0-255, 0=disabled)]
    sceneHslOverride: vec4 = vec4.fromValues(-1, -1, -1, 0);

    brightness: number = 0.8;
    colorBanding: number = 255;

    smoothTerrain: boolean = false;

    cullBackFace: boolean = true;

    msaaEnabled: boolean = false;
    fxaaEnabled: boolean = false;

    loadNpcs: boolean = true;
    // RuneLite-style animation smoothing (non-) is applied to the local player only.

    // State
    lastClientTick: number = 0;
    clientTickPhase: number = 0; // 0..1 within the active client simulation tick
    public clientTickDurationMs: number = 20;
    public get clientTickDurationSec(): number {
        return this.clientTickDurationMs / 1000;
    }
    public pendingClientTicks: number = 0;
    public hasClientTickBaseline: boolean = false;
    lastTick: number = 0;

    // PERF: Cached objects for checkInteractions to avoid per-frame allocations
    public cachedMenuEntries: OsrsMenuEntry[] = [];
    public cachedActiveSpell: {
        spellId: number;
        spellName: string;
        actionName: string;
        spellLevel: number;
        runes: any;
        targetMask: number;
    } | null = null;
    public cachedExamineEntries: OsrsMenuEntry[] = [];
    public cachedLocIds: Set<string> = new Set();
    public cachedObjIds: Set<string> = new Set();
    public cachedNpcIds: Set<number> = new Set();
    public cachedPlayerIds: Set<number> = new Set(); // For player deduplication
    // OSRS X-ray menu: track sub-tile positions where entities were found
    // Key format: (x << 16) | y where x,y are sub-tile coordinates
    public cachedXRayPositions: Set<number> = new Set();
    // PERF: Separate array for client.menuEntries to avoid sharing reference with cachedMenuEntries
    public cachedClientMenuEntries: OsrsMenuEntry[] = [];
    // PERF: Cached object for toCssEvent return value to avoid per-call allocation
    public cachedCssEventResult: { clientX: number; clientY: number } = { clientX: 0, clientY: 0 };
    // PERF: Cached canvas rect - updated only when needed
    public cachedCanvasRect: DOMRect | null = null;
    public cachedCanvasRectFrame: number = -1;
    // PERF: Cached bound toCssEvent function to avoid creating closure each frame
    public boundToCssEvent: (
        gx?: number,
        gy?: number,
    ) => { clientX: number; clientY: number } | undefined;
    public currentFrameCount: number = 0; // Updated each frame for toCssEvent
    // Throttle world interaction/menu recomputation to client cycle cadence.
    public lastInteractionClientCycle: number = -1;
    public lastInteractionMenuOpen: boolean = false;
    public lastInteractionRaycastHitCount: number = 0;
    public lastInteractionMenuOptionCount: number = 0;
    public lastLodVisibleMapCount: number = 0;
    public lastFullDetailVisibleMapCount: number = 0;
    public lastLodThreshold: number = 0;
    public lastDistanceCulledVisibleMapCount: number = 0;
    public effectiveRenderDistanceTiles: number = 0;
    public effectiveRenderDistanceFrame: number = -1;
    public effectiveLodThresholdTiles: number = 0;
    public effectiveLodThresholdFrame: number = -1;
    public effectiveGroundItemOverlayMaxEntries: number = 40;
    public effectiveGroundItemOverlayFrame: number = -1;
    public effectiveGroundItemOverlayRadius: number = 12;
    public effectiveGroundItemOverlayRadiusFrame: number = -1;
    public activeQualityProfile: BrowserQualityProfile = RENDER_CONSTANTS.DESKTOP_QUALITY_PROFILE;
    public activeQualityProfileKey: BrowserQualityProfileKey = RENDER_CONSTANTS.DESKTOP_QUALITY_PROFILE.key;
    public frameRoofFilteredRangeCount: number = 0;
    public frameRoofTotalRangeCount: number = 0;
    public roofFilteredDrawIndices: number[] = [];

    // OSRS raycast-all menu: SceneRaycaster for Physics.RaycastAll-like behavior
    public sceneRaycaster: SceneRaycaster | null = null;

    // Unified actor instance data (NPCs + Players) when enabled
    unifiedActorData: boolean = true;
    // ECS is authoritative for actors (NPCs and Players migrated)
    actorRenderCount: number = 0;
    actorRenderData: Uint16Array = new Uint16Array(16 * 8);
    public readonly unbatchedNpcRenderEntries: Array<{
        map: WebGLMapSquare;
        ecsId: number;
        dataOffset: number;
    }> = [];
    // mirror sceneDrawCycleMarker/tileDrawCycleMarkers submission dedupe
    // for tile-centered single-tile actors.
    public frameActorTileSelectionId: number = -1;
    public frameActorTileSelectionBuilt: boolean = false;
    public frameWinningActorByTile: Map<
        number,
        { kind: "player" | "npc"; id: number; priority: number }
    > = new Map();
    // Double-buffered actor data textures to avoid GPU sync issues
    public actorDataTextures: [Texture | undefined, Texture | undefined] = [undefined, undefined];
    public actorDataCurrentIndex: number = 0;
    public actorDataChecksum: number = 0;
    public actorDataLastTexHeight: number = 0;
    // Legacy buffer for compatibility (some code may reference this)
    actorDataTextureBuffer: (Texture | undefined)[] = [];

    // Player rendering
    playerRenderer: PlayerRenderer = new PlayerRenderer(this);
    playerVertexArray?: VertexArray;
    playerVertexArrayAlpha?: VertexArray;
    playerIndexBuffer?: VertexBuffer;
    playerInterleavedBuffer?: VertexBuffer;
    playerIndexBufferAlpha?: VertexBuffer;
    playerInterleavedBufferAlpha?: VertexBuffer;
    playerDrawCall?: DrawCall;
    playerDrawCallAlpha?: DrawCall;
    playerDrawRanges?: DrawRange[];
    playerDrawRangesAlpha?: DrawRange[];

    // Dynamic NPC current-frame geometry (OSRS applies NPC sequences at render time)
    public dynamicNpcAnimLoader?: DynamicNpcAnimLoader;
    public interactLocModelLoader?: LocModelLoader;
    public interactNpcModelLoader?: NpcModelLoader;
    public dynamicNpcInterleavedBuffer?: VertexBuffer;
    public dynamicNpcIndexBuffer?: VertexBuffer;
    public dynamicNpcVertexArray?: VertexArray;
    public dynamicNpcDrawCall?: DrawCall;
    public dynamicNpcBufferVertexSize = 0;
    public dynamicNpcBufferIndexSize = 0;
    public dynamicNpcUploadedGeometryKey: string | undefined;
    public readonly dynamicNpcSingleDrawRange: DrawRange = newDrawRange(0, 0, 1);
    public readonly dynamicNpcSingleDrawRanges: DrawRange[] = [this.dynamicNpcSingleDrawRange];

    // Smoothed follow-cam focal point (OSRS: oculusOrbFocalPointX/Y). Stored in world sub-units (1 tile = 128).
    public followCamFocalXSub: number = 0;
    public followCamFocalZSub: number = 0;
    public followCamFocalLastClientCycle: number = -1;
    public followCamFocalInitialized: boolean = false;
    // Terrain-driven minimum pitch pressure (scaled by 256).
    public cameraTerrainPitchPressure: number = 0;

    // OSRS camera shake slots (0:X, 1:Y, 2:Z, 3:Yaw, 4:Pitch).
    public readonly cameraShakeEnabled: boolean[] = [false, false, false, false, false];
    public readonly cameraShakeRandomAmplitude: number[] = [0, 0, 0, 0, 0];
    public readonly cameraShakeWaveAmplitude: number[] = [0, 0, 0, 0, 0];
    public readonly cameraShakeWaveSpeed: number[] = [0, 0, 0, 0, 0];
    public readonly cameraShakeWavePhase: number[] = [0, 0, 0, 0, 0];
    public cameraShakeLastClientCycle: number = -1;

    // PERF: scratch objects for follow-cam math (avoid per-frame allocations)
    public followCamRot: mat4 = mat4.create();
    public followCamForward: vec3 = vec3.create();
    public followCamForwardAxis: vec3 = vec3.fromValues(0, 0, -1);

    // Track if we've notified LoadingTracker that map data is ready
    public mapDataLoadedNotified: boolean = false;
    // Time (in seconds) when height data first became valid (for fog fade-in delay)
    public heightValidAtTime: number | undefined = undefined;

    // Optional override: force a specific idle SeqType id for player animation
    playerIdleSeqId: number = -1;
    public playerIdleSeqMaxId: number = -1;
    // Player animation mode selector (controls which sequence to pre-bake)
    playerAnimMode: "idle" | "walk" | "run" | "crawl" = "walk";
    public playerIdleSeqOverrideActive = false;
    // Debug: dump animated player vertices per frame during pre-bake
    playerDebugDump: boolean = false;
    // Debug/control: freeze player frame
    playerFreezeFrame: boolean = false;
    playerFixedFrame: number = 0;

    // Reserve high-range ids in the interact buffer to represent players
    static readonly PLAYER_INTERACT_BASE = RENDER_CONSTANTS.PLAYER_INTERACT_BASE;

    // Model-space Y increases down the screen, so a negative value raises an
    // actor. Animated models can extend their soles below their resting bounds,
    // so retain a ten-unit clearance above the terrain to prevent clipping.
    public static readonly ACTOR_GROUND_CLEARANCE_MODEL_UNITS = -10;
    playerYOffset: number = RENDER_CONSTANTS.ACTOR_GROUND_CLEARANCE_MODEL_UNITS;

    // Hover tile devoverlay state
    hoverTileX: number = -1;
    hoverTileY: number = -1;
    hoverColor: vec4 = vec4.fromValues(1.0, 1.0, 0.0, 1.0);
    // Hover fill (solid quad) resources
    hoverFillColor: vec4 = vec4.fromValues(1.0, 1.0, 0.0, 0.25);

    // Destination tile devoverlay (for Player[0] run target)
    destColor: vec4 = vec4.fromValues(0.0, 1.0, 0.0, 1.0);
    destFillColor: vec4 = vec4.fromValues(0.0, 1.0, 0.0, 0.2);
    tmpInvViewProj: mat4 = mat4.create();
    tmpNear: vec4 = vec4.create();
    tmpFar: vec4 = vec4.create();
    tmpRayDir: vec3 = vec3.create();
    public tmpTerrainEntryPoint: vec3 = vec3.create();

    // Per-frame accumulators for stats
    public _frameIndices: number = 0;
    public _frameBatches: number = 0;

    // Phase bias configuration (applied to all players)
    // Animation phase bias constants for foot planting synchronization
    public static readonly WALK_PHASE_BIAS = 0.0;
    public static readonly RUN_PHASE_BIAS = 0.0;

    // Hitsplat sprite devoverlay shader (assets managed by HitsplatOverlay)
    hitsplatProgram?: Program;
    // Approximate player defaultHeight in tile units (model.height / 128)
    public playerDefaultHeightTiles: number = 200 / 128;
    public overheadTextOverlay?: OverheadTextOverlay;
    public overheadPrayerOverlay?: OverheadPrayerOverlay;
    public overheadTextOutput: OverheadTextEntry[] = [];
    public overheadTextPool: OverheadTextEntry[] = [];
    public mobileLoginInput?: HTMLInputElement;
    public mobileLoginInputFocused: boolean = false;
    public mobileLoginKeyboardOpen: boolean = false;
    public mobileLoginViewportBaselineWidth: number = 0;
    public mobileLoginViewportBaselineHeight: number = 0;
    public allowMobileLoginInputBlur: boolean = false;
    public preserveMobileLoginInputModeOnBlur: boolean = false;
    public readonly LOGIN_FIELD_BASE_Y = 201 + 15 + 15 + 10;

    // Player interaction state moved to PlayerInteractionSystem


    constructor(public osrsClient: OsrsClient) {
        super(osrsClient);
        // PERF: Initialize bound toCssEvent function once
        this.boundToCssEvent = (gx?: number, gy?: number) =>
            this.toCssEvent(gx, gy, this.currentFrameCount);
        // Initialize SceneRaycaster for raycast-all menu behavior
        this.sceneRaycaster = new SceneRaycaster(this.mapManager, osrsClient);
        this.sceneRaycaster.worldEntityTransformProvider = (map) =>
            this.getWorldEntityTransformForMap(map);
        const previousOnMapRemoved = this.mapManager.onMapRemoved;
        this.mapManager.onMapRemoved = (mapX: number, mapY: number) => {
            this.clearMinimapIconsForMap(mapX | 0, mapY | 0);
            if (!previousOnMapRemoved) return;
            try {
                previousOnMapRemoved(mapX | 0, mapY | 0);
            } catch (error) {
                console.log("[WebGLOsrsRenderer] onMapRemoved callback failed", {
                    mapX: mapX | 0,
                    mapY: mapY | 0,
                    error,
                });
            }
        };
    }

    getWidgetsGLCanvas(): HTMLCanvasElement | undefined {
        return render.getWidgetsGLCanvas(this);
    }

    public clearMinimapIconsForMap(mapX: number, mapY: number): void {
        return render.clearMinimapIconsForMap(this, mapX, mapY);
    }

    public registerMinimapData(mapData: SdMapData): void {
        return render.registerMinimapData(this, mapData);
    }

    public shouldUseMobileLoginInput(): boolean {
        return render.shouldUseMobileLoginInput(this);
    }

    public getCanvasTouchPos(touch: Touch): { x: number; y: number } {
        return render.getCanvasTouchPos(this, touch);
    }

    public getUiSurfaceCssSize(
        safeBufW: number,
        safeBufH: number,
    ): { cssW: number; cssH: number } {
        return render.getUiSurfaceCssSize(this, safeBufW, safeBufH);
    }

    public getMobileGameplayUiScale(
        cssW: number,
        cssH: number,
        _bufW: number,
        _bufH: number,
    ): number {
        return render.getMobileGameplayUiScale(this, cssW, cssH, _bufW, _bufH);
    }

    public computeUiRenderMetrics(
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
        return render.computeUiRenderMetrics(this, bufW, bufH);
    }

    getUiRenderMetrics(
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
        return render.getUiRenderMetrics(this, bufW, bufH);
    }

    override getCanvasResolutionScale(cssWidth: number, cssHeight: number): number {
        return render.getCanvasResolutionScale(this, cssWidth, cssHeight);
    }

    public resolveBrowserQualityProfile(): BrowserQualityProfile {
        return render.resolveBrowserQualityProfile(this);
    }

    public syncBrowserQualityProfile(): BrowserQualityProfile {
        return render.syncBrowserQualityProfile(this);
    }

    getActiveQualityProfileKey(): string {
        return render.getActiveQualityProfileKey(this);
    }

    getActiveQualityProfileLabel(): string {
        return render.getActiveQualityProfileLabel(this);
    }

    public getSceneResolutionScale(): number {
        return render.getSceneResolutionScale(this);
    }

    public getSceneRenderSize(): { width: number; height: number } {
        return render.getSceneRenderSize(this);
    }

    public syncSceneFramebufferSize(): void {
        return render.syncSceneFramebufferSize(this);
    }

    public scaleViewportRectToSceneBuffer(rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): { x: number; y: number; width: number; height: number } {
        return render.scaleViewportRectToSceneBuffer(this, rect);
    }

    shouldUseDirectTextureScenePass(): boolean {
        return render.shouldUseDirectTextureScenePass(this);
    }

    public resolveLoginFieldAt(y: number): 0 | 1 | undefined {
        return render.resolveLoginFieldAt(this, y);
    }

    public resolveLoginFieldAtCanvasPoint(x: number, y: number): 0 | 1 | undefined {
        return render.resolveLoginFieldAtCanvasPoint(this, x, y);
    }

    isMobileLoginInputActive(): boolean {
        return render.isMobileLoginInputActive(this);
    }

    public readMobileLoginViewportMetrics():
        | { width: number; height: number; offsetLeft: number; offsetTop: number }
        | undefined {
        return render.readMobileLoginViewportMetrics(this);
    }

    public updateMobileLoginViewportBaseline(force: boolean = false): void {
        return render.updateMobileLoginViewportBaseline(this, force);
    }

    public refreshMobileLoginKeyboardState(): boolean {
        return render.refreshMobileLoginKeyboardState(this);
    }

    public isMobileLoginKeyboardOpen(): boolean {
        return render.isMobileLoginKeyboardOpen(this);
    }

    public syncMobileLoginInputPosition(): void {
        return render.syncMobileLoginInputPosition(this);
    }

    public requestMobileLoginKeyboard(field: 0 | 1): void {
        return render.requestMobileLoginKeyboard(this, field);
    }

    public syncLoginRendererLayoutForCanvas(): void {
        return render.syncLoginRendererLayoutForCanvas(this);
    }

    public getActiveLoginFieldValue(): string {
        return render.getActiveLoginFieldValue(this);
    }

    public setActiveLoginFieldValue(raw: string): void {
        return render.setActiveLoginFieldValue(this, raw);
    }

    public ensureMobileLoginInput(): HTMLInputElement | undefined {
        return render.ensureMobileLoginInput(this);
    }

    public destroyMobileLoginInput(): void {
        return render.destroyMobileLoginInput(this);
    }

    public syncMobileLoginInput(focus: boolean): void {
        return render.syncMobileLoginInput(this, focus);
    }

    static isSupported(): boolean {
        return render.isSupported();
    }

    public acquireHitsplatEntry(): HitsplatEntry {
        return render.acquireHitsplatEntry(this);
    }

    public acquireHealthBarEntry(): HealthBarEntry {
        return render.acquireHealthBarEntry(this);
    }

    public acquireOverheadPrayerEntry(): OverheadPrayerEntry {
        return render.acquireOverheadPrayerEntry(this);
    }

    public acquireOverheadTextEntry(): OverheadTextEntry {
        return render.acquireOverheadTextEntry(this);
    }

    public resetHealthBarOutput(): void {
        return render.resetHealthBarOutput(this);
    }

    public resetOverheadPrayerOutput(): void {
        return render.resetOverheadPrayerOutput(this);
    }

    public resetOverheadTextOutput(): void {
        return render.resetOverheadTextOutput(this);
    }

    public resetHitsplatOutput(): void {
        return render.resetHitsplatOutput(this);
    }

    public getNpcDefaultHeight(npcTypeId: number): number {
        return render.getNpcDefaultHeight(this, npcTypeId);
    }

    public resolveNpcOverlayAnchor(
        ecsId: number,
        baseWorldX: number,
        baseWorldZ: number,
        npcTypeId: number | undefined,
    ): { worldX: number; worldZ: number; logicalHeightTiles: number } {
        return render.resolveNpcOverlayAnchor(this, ecsId, baseWorldX, baseWorldZ, npcTypeId);
    }

    public getEffectiveControlledPlayerId(): number {
        return render.getEffectiveControlledPlayerId(this);
    }

    public ensureHitsplatState(
        map: Map<number, ActorHitsplatState>,
        serverId: number,
    ): ActorHitsplatState {
        return render.ensureHitsplatState(this, map, serverId);
    }

    public addHitSplatOsrs(
        state: ActorHitsplatState,
        type: number,
        value: number,
        type2: number,
        value2: number,
        currentCycle: number,
        delayCycles: number,
    ): void {
        return render.addHitSplatOsrs(this, state, type, value, type2, value2, currentCycle, delayCycles);
    }

    public getHitsplatVisibility(
        state: ActorHitsplatState,
        slot: number,
        clientCycle: number,
    ): number | undefined {
        return render.getHitsplatVisibility(this, state, slot, clientCycle);
    }

    public trimHitsplats(tick: number): void {
        return render.trimHitsplats(this, tick);
    }

    public resolveHealthBarDefinition(defId: number): HealthBarDefinitionState {
        return render.resolveHealthBarDefinition(this, defId);
    }

    public ensureActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        serverId: number,
    ): ActorHealthBarsState {
        return render.ensureActorHealthBars(this, map, serverId);
    }

    public healthBarPut(bar: HealthBarBarState, update: HealthBarUpdateState): void {
        return render.healthBarPut(this, bar, update);
    }

    public healthBarGet(
        bar: HealthBarBarState,
        clientCycle: number,
    ): HealthBarUpdateState | undefined {
        return render.healthBarGet(this, bar, clientCycle);
    }

    public actorAddHealthBar(
        state: ActorHealthBarsState,
        defId: number,
        update: HealthBarUpdateState,
    ): void {
        return render.actorAddHealthBar(this, state, defId, update);
    }

    public actorRemoveHealthBar(state: ActorHealthBarsState, defId: number): void {
        return render.actorRemoveHealthBar(this, state, defId);
    }

    public trimActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        tick: number,
        opts: { kind: "player" | "npc" },
    ): void {
        return render.trimActorHealthBars(this, map, tick, opts);
    }

    public makeActorGroupKey(isNpc: boolean, serverId: number): number {
        return render.makeActorGroupKey(this, isNpc, serverId);
    }

    public appendPlayerOverheadText(
        index: number,
        output: OverheadTextEntry[],
        maxEntries: number,
        playerDefaultHeightTiles: number | undefined,
    ): void {
        return render.appendPlayerOverheadText(this, index, output, maxEntries, playerDefaultHeightTiles);
    }

    public appendActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        serverId: number,
        kind: "player" | "npc",
        worldX: number,
        worldZ: number,
        plane: number,
        footprintRadius: number,
        baseHeightTiles: number,
        output: HealthBarEntry[],
        clientCycle: number,
        maxOutput: number,
    ): void {
        return render.appendActorHealthBars(this, map, serverId, kind, worldX, worldZ, plane, footprintRadius, baseHeightTiles, output, clientCycle, maxOutput);
    }

    public mapOverheadColor(rawColor: number | undefined): number {
        return render.mapOverheadColor(this, rawColor);
    }

    public resolveModIcon(modIcon: number | undefined): number | undefined {
        return render.resolveModIcon(this, modIcon);
    }

    public getSequenceVerticalOffsetTiles(seqId: number | undefined): number {
        return render.getSequenceVerticalOffsetTiles(this, seqId);
    }

    public resolvePlayerAnimationHeightOffsetTiles(index: number): number {
        return render.resolvePlayerAnimationHeightOffsetTiles(this, index);
    }

    public resolvePlayerLogicalHeightTiles(index: number, fallback?: number): number {
        return render.resolvePlayerLogicalHeightTiles(this, index, fallback);
    }

    public resolvePlayerHitsplatOffset(index: number, fallback?: number): number {
        return render.resolvePlayerHitsplatOffset(this, index, fallback);
    }

    public resolvePlayerHeadIconOffset(index: number, fallback?: number): number {
        return render.resolvePlayerHeadIconOffset(this, index, fallback);
    }

    public computeOverheadAlpha(entry: OverheadTextEntry): number {
        return render.computeOverheadAlpha(this, entry);
    }

    public getNpcTypeIdForServer(serverId: number): number | undefined {
        return render.getNpcTypeIdForServer(this, serverId);
    }

    public estimateNpcMaxHp(npcTypeId: number | undefined): number {
        return render.estimateNpcMaxHp(this, npcTypeId);
    }

    public trimHealthBars(tick: number): void {
        return render.trimHealthBars(this, tick);
    }

    registerPlayerHealthBarUpdate(event: {
        serverId: number;
        bar: {
            id: number;
            cycle: number;
            health: number;
            health2: number;
            cycleOffset: number;
            removed?: boolean;
        };
    }): void {
        return render.registerPlayerHealthBarUpdate(this, event);
    }

    registerNpcHealthBarUpdate(event: {
        serverId: number;
        bar: {
            id: number;
            cycle: number;
            health: number;
            health2: number;
            cycleOffset: number;
            removed?: boolean;
        };
    }): void {
        return render.registerNpcHealthBarUpdate(this, event);
    }

    clearNpcHealthBars(serverId: number): void {
        return render.clearNpcHealthBars(this, serverId);
    }

    clearPlayerHealthBars(serverId: number): void {
        return render.clearPlayerHealthBars(this, serverId);
    }

    override registerHitsplat(event: HitsplatEventPayload): void {
        return render.registerHitsplat(this, event);
    }

    override registerSpotAnimation(event: PlayerSpotAnimationEvent): void {
        return render.registerSpotAnimation(this, event);
    }

    registerNpcSpotAnimation(event: {
        npcServerId: number;
        spotId: number;
        height: number;
        startCycle: number;
        slot?: number;
    }): void {
        return render.registerNpcSpotAnimation(this, event);
    }

    registerWorldSpotAnimation(event: {
        spotId: number;
        tile: { x: number; y: number; level?: number };
        height?: number;
        startCycle: number;
    }): void {
        return render.registerWorldSpotAnimation(this, event);
    }

    async init(): Promise<void> {
        return render.init(this);
    }

    public clearDynamicNpcAnimRuntimeState(): void {
        return render.clearDynamicNpcAnimRuntimeState(this);
    }

    public disposeDynamicNpcAnimState(): void {
        return render.disposeDynamicNpcAnimState(this);
    }

    public initDynamicNpcAnimLoader(): void {
        return render.initDynamicNpcAnimLoader(this);
    }

    async initPlayerGeometry(): Promise<void> {
        return render.initPlayerGeometry(this);
    }

    async initShaders(): Promise<Program[]> {
        return render.initShaders(this);
    }

    public _resolvePlayerSeqIdForMode(): number {
        return render._resolvePlayerSeqIdForMode(this);
    }

    public _buildAnimClipMeta(seqId: number): ActorAnimationClip | undefined {
        return render._buildAnimClipMeta(this, seqId);
    }

    public _resolveNpcAnimation(
        map: WebGLMapSquare,
        npcIndex: number,
        ecs: NpcEcs,
        ecsId: number,
    ): AnimationFrames {
        return render._resolveNpcAnimation(this, map, npcIndex, ecs, ecsId);
    }

    public resolveNpcMovementSequenceIds(
        ecs: NpcEcs,
        ecsId: number,
    ): { movementSeqId: number; idleSeqId: number; walkSeqId: number } {
        return render.resolveNpcMovementSequenceIds(this, ecs, ecsId);
    }

    public shouldLayerNpcMovementSequence(
        actionSeqId: number,
        movementSeqId: number,
        idleSeqId: number,
    ): boolean {
        return render.shouldLayerNpcMovementSequence(this, actionSeqId, movementSeqId, idleSeqId);
    }

    public stepNpcSequenceTrack(
        frameIndex: number,
        animTick: number,
        loopCount: number,
        frameCount: number,
        lengths: number[] | undefined,
        seqType: any,
        clearOnFinish: boolean,
    ): {
        frameIndex: number;
        animTick: number;
        loopCount: number;
        frameAdvanced: boolean;
        cleared: boolean;
    } {
        return render.stepNpcSequenceTrack(this, frameIndex, animTick, loopCount, frameCount, lengths, seqType, clearOnFinish);
    }

    public ensureNpcDynamicSequenceMeta(
        map: WebGLMapSquare,
        npcIndex: number,
        npcTypeId: number,
        seqId: number,
        forceDynamic: boolean = false,
    ): DynamicNpcSequenceMeta | undefined {
        return render.ensureNpcDynamicSequenceMeta(this, map, npcIndex, npcTypeId, seqId, forceDynamic);
    }

    public uploadDynamicNpcGeometry(
        geometry: DynamicNpcFrameGeometry,
        transparent: boolean,
    ): number {
        return render.uploadDynamicNpcGeometry(this, geometry, transparent);
    }

    public resolveUnbatchedNpcGeometry(ecsId: number): DynamicNpcFrameGeometry | undefined {
        return render.resolveUnbatchedNpcGeometry(this, ecsId);
    }

    initFramebuffers(): void {
        return render.initFramebuffers(this);
    }

    initFramebuffer(): void {
        return render.initFramebuffer(this);
    }

    public initTextureFramebuffer(
        width: number = this.app.width,
        height: number = this.app.height,
    ): void {
        return render.initTextureFramebuffer(this, width, height);
    }

    override initCache(): void {
        return render.initCache(this);
    }

    initOverlays(): void {
        return render.initOverlays(this);
    }

    initTextures(): void {
        return render.initTextures(this);
    }

    public async initWaterTextures(): Promise<void> {
        return render.initWaterTextures(this);
    }

    public async loadWaterTextureData(): Promise<Uint8Array> {
        return render.loadWaterTextureData(this);
    }

    public loadImageAsset(src: string): Promise<HTMLImageElement> {
        return render.loadImageAsset(this, src);
    }

    public collectWaterTextureIds(): Set<number> {
        return render.collectWaterTextureIds(this);
    }

    public collectWaterOverlayColors(): void {
        return render.collectWaterOverlayColors(this);
    }

    public getWaterMaterialParams(textureId: number): WaterMaterialParams {
        return render.getWaterMaterialParams(this, textureId);
    }

    initTextureArray() {
        return render.initTextureArray(this);
    }

    updateTextureFiltering(): void {
        return render.updateTextureFiltering(this);
    }

    updateTextureArray(textures: Map<number, Int32Array>): void {
        return render.updateTextureArray(this, textures);
    }

    public maybeRegenerateTextureMipmaps(nowMs: number): void {
        return render.maybeRegenerateTextureMipmaps(this, nowMs);
    }

    public getPendingStreamMapCount(): number {
        return render.getPendingStreamMapCount(this);
    }

    public hasPendingMapStreamingWork(): boolean {
        return render.hasPendingMapStreamingWork(this);
    }

    public syncStreamGenerationFromMapManager(): void {
        return render.syncStreamGenerationFromMapManager(this);
    }

    public queueStreamMapData(mapData: SdMapData, streamGeneration?: number): void {
        return render.queueStreamMapData(this, mapData, streamGeneration);
    }

    public applyReadyStreamGenerationBatch(time: number): number {
        return render.applyReadyStreamGenerationBatch(this, time);
    }

    initMaterialsTexture(): void {
        return render.initMaterialsTexture(this);
    }

    public clearControlledPlayerAppearanceCache(): void {
        return render.clearControlledPlayerAppearanceCache(this);
    }

    public resolvePlayerIdleSeqMaxId(): number {
        return render.resolvePlayerIdleSeqMaxId(this);
    }

    getProjectileManager(): ProjectileManager | undefined {
        return render.getProjectileManager(this);
    }

    getControls(): Schema {
        return render.getControls(this);
    }

    public getMapIdForWorldTile(x: number, y: number): number {
        return render.getMapIdForWorldTile(this, x, y);
    }

    public applyGamemodeWorldLocs(): Set<number> {
        return render.applyGamemodeWorldLocs(this);
    }

    refreshGamemodeWorldLocs(): void {
        return render.refreshGamemodeWorldLocs(this);
    }

    override async queueLoadMap(
        mapX: number,
        mapY: number,
        streamGeneration?: number,
        locReloadBatchId?: number,
    ): Promise<void> {
        return render.queueLoadMap(this, mapX, mapY, streamGeneration, locReloadBatchId);
    }

    async loadInstanceScene(
        templateChunks: number[][][],
        regionX: number,
        regionY: number,
    ): Promise<void> {
        return render.loadInstanceScene(this, templateChunks, regionX, regionY);
    }

    public async doInstanceSceneBuild(
        templateChunks: number[][][],
        regionX: number,
        regionY: number,
        playerMapX: number,
        playerMapY: number,
    ): Promise<void> {
        return render.doInstanceSceneBuild(this, templateChunks, regionX, regionY, playerMapX, playerMapY);
    }

    public getInstanceExtraLocs(
        playerMapX: number,
        playerMapY: number,
    ): SdMapLoaderInput["extraLocs"] {
        return render.getInstanceExtraLocs(this, playerMapX, playerMapY);
    }

    public scheduleInstanceLocRebuild(): void {
        return render.scheduleInstanceLocRebuild(this);
    }

    clearInstance(): void {
        return render.clearInstance(this);
    }

    async loadWorldEntityScene(
        entityIndex: number,
        templateChunks: number[][][],
        regionX: number,
        regionY: number,
        worldX: number,
        worldY: number,
        sizeX: number,
        sizeZ: number,
        extraLocs: Array<{
            id: number;
            x: number;
            y: number;
            level: number;
            shape: number;
            rotation: number;
        }>,
        configId: number = -1,
        extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>,
        basePlane: number = 0,
    ): Promise<void> {
        return render.loadWorldEntityScene(this, entityIndex, templateChunks, regionX, regionY, worldX, worldY, sizeX, sizeZ, extraLocs, configId, extraNpcs, basePlane);
    }

    public ensureWorldEntityOverlaysLoaded(nowMs: number): void {
        return render.ensureWorldEntityOverlaysLoaded(this, nowMs);
    }

    scheduleWorldEntityLocRebuild(entityIndex: number): void {
        return render.scheduleWorldEntityLocRebuild(this, entityIndex);
    }

    public ensureWorldEntityAnimator(): void {
        return render.ensureWorldEntityAnimator(this);
    }

    public getWorldEntityIndexForMapId(mapId: number): number | undefined {
        return render.getWorldEntityIndexForMapId(this, mapId);
    }

    getOverlayMapForEntity(entityIndex: number): WebGLMapSquare | undefined {
        return render.getOverlayMapForEntity(this, entityIndex);
    }

    getWorldEntityTransformForMap(map: WebGLMapSquare): Float32Array {
        return render.getWorldEntityTransformForMap(this, map);
    }

    getWorldEntityTransformForMapOrOverlap(map: WebGLMapSquare): Float32Array {
        return render.getWorldEntityTransformForMapOrOverlap(this, map);
    }

    getWorldEntityDeckHeight(_overworldTileX: number, _overworldTileY: number): number {
        return render.getWorldEntityDeckHeight(this, _overworldTileX, _overworldTileY);
    }

    public getNpcModelYOffset(deckHeight: number = 0): number {
        return render.getNpcModelYOffset(this, deckHeight);
    }

    getWorldEntityTransformForTile(tileX: number, tileY: number): Float32Array {
        return render.getWorldEntityTransformForTile(this, tileX, tileY);
    }

    clearWorldEntity(entityIndex: number): void {
        return render.clearWorldEntity(this, entityIndex);
    }

    clearAllWorldEntities(): void {
        return render.clearAllWorldEntities(this);
    }

    public resolveLocReloadBatchMap(
        batchId: number,
        mapId: number,
        mapData: SdMapData | undefined,
    ): void {
        return render.resolveLocReloadBatchMap(this, batchId, mapId, mapData);
    }

    public beginLocReloadBatch(maps: Array<{ mapX: number; mapY: number }>): void {
        return render.beginLocReloadBatch(this, maps);
    }

    loadMap(
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        waterTextures: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        time: number,
    ): void {
        return render.loadMap(this, mainProgram, mainAlphaProgram, npcProgram, textureArray, textureMaterials, waterTextures, sceneUniformBuffer, mapData, time);
    }

    isValidMapData(mapData: SdMapData): boolean {
        return render.isValidMapData(this, mapData);
    }

    override clearMaps(): void {
        return render.clearMaps(this);
    }

    getMinimapIcons(mapX: number, mapY: number, level: number = 0): MinimapIcon[] | undefined {
        return render.getMinimapIcons(this, mapX, mapY, level);
    }

    setMaxLevel(maxLevel: number): void {
        return render.setMaxLevel(this, maxLevel);
    }

    setSkyColor(r: number, g: number, b: number) {
        return render.setSkyColor(this, r, g, b);
    }

    setSceneHslOverride(hue: number, sat: number, lum: number, amount: number): void {
        return render.setSceneHslOverride(this, hue, sat, lum, amount);
    }

    setSceneHslOverrideFromPacked(packedHsl: number, amount: number): void {
        return render.setSceneHslOverrideFromPacked(this, packedHsl, amount);
    }

    clearSceneHslOverride(): void {
        return render.clearSceneHslOverride(this);
    }

    setSmoothTerrain(enabled: boolean): void {
        return render.setSmoothTerrain(this, enabled);
    }

    setMsaa(enabled: boolean): void {
        return render.setMsaa(this, enabled);
    }

    setFxaa(enabled: boolean): void {
        return render.setFxaa(this, enabled);
    }

    public finishRenderFrame(
        camera: any,
        deltaTime: number,
        showDebugTimer: boolean,
        profileGpuTimer: boolean,
    ): void {
        return render.finishRenderFrame(this, camera, deltaTime, showDebugTimer, profileGpuTimer);
    }

    setLoadNpcs(enabled: boolean): void {
        return render.setLoadNpcs(this, enabled);
    }

    override onResize(width: number, height: number): void {
        return render.onResize(this, width, height);
    }

    override render(time: number, deltaTime: number, resized: boolean): void {
        return render.render(this, time, deltaTime, resized);
    }

    public getControlledPlayerEcsIndex(): number | undefined {
        return render.getControlledPlayerEcsIndex(this);
    }

    public getPlayerBasePlane(): number {
        return render.getPlayerBasePlane(this);
    }

    public getPlayerRawPlane(): number {
        return render.getPlayerRawPlane(this);
    }

    public getPlayerTileXY(): { x: number; y: number } {
        return render.getPlayerTileXY(this);
    }

    public getCameraTileXY(): { x: number; y: number } {
        return render.getCameraTileXY(this);
    }

    public clampCullTileToGridBounds(tile: { x: number; y: number }): { x: number; y: number } {
        return render.clampCullTileToGridBounds(this, tile);
    }

    public getRenderCullTile(): { x: number; y: number } {
        return render.getRenderCullTile(this);
    }

    public getRoofTargetTile(
        playerTile: { x: number; y: number },
        cameraTile: { x: number; y: number },
    ): { x: number; y: number } {
        return render.getRoofTargetTile(this, playerTile, cameraTile);
    }

    public getCameraPitchRs(): number {
        return render.getCameraPitchRs(this);
    }

    public computeFrameRoofPlaneLimit(): number {
        return render.computeFrameRoofPlaneLimit(this);
    }

    public getRoofPlaneLimit(): number {
        return render.getRoofPlaneLimit(this);
    }

    override invalidateRoofState(): void {
        return render.invalidateRoofState(this);
    }

    public ensureOverlayUpdateArgs(scenePass: boolean): OverlayUpdateArgs {
        return render.ensureOverlayUpdateArgs(this, scenePass);
    }

    public syncTileMarkerOverlayConfig(tileMarkersConfig: TileMarkersPluginConfig): void {
        return render.syncTileMarkerOverlayConfig(this, tileMarkersConfig);
    }

    public populateTileMarkerOverlayState(
        state: OverlayUpdateArgs["state"],
        tileMarkersConfig: TileMarkersPluginConfig,
        playerLevel: number,
        playerRawLevel: number,
    ): void {
        return render.populateTileMarkerOverlayState(
            this,
            state,
            tileMarkersConfig,
            playerLevel,
            playerRawLevel,
        );
    }

    public drawSceneTileOverlays(time: number, deltaTime: number): void {
        return render.drawSceneTileOverlays(this, time, deltaTime);
    }

    public getOverlayHelpers(): NonNullable<WebGLOsrsRenderer["cachedOverlayHelpers"]> {
        return render.getOverlayHelpers(this);
    }

    public getTileRenderFlagAt(level: number, tileX: number, tileY: number): number {
        return render.getTileRenderFlagAt(this, level, tileX, tileY);
    }

    public updateCameraTerrainPitchPressure(
        focalSubX: number,
        focalSubZ: number,
        basePlane: number,
        cycles: number,
    ): void {
        return render.updateCameraTerrainPitchPressure(this, focalSubX, focalSubZ, basePlane, cycles);
    }

    public sampleTileVertexHeightWorldUnits(
        tileX: number,
        tileY: number,
        plane: number,
    ): number | undefined {
        return render.sampleTileVertexHeightWorldUnits(this, tileX, tileY, plane);
    }

    public setCameraShakeSlot(
        slot: number,
        randomAmplitude: number,
        waveAmplitude: number,
        waveSpeed: number,
        phase: number = 0,
    ): void {
        return render.setCameraShakeSlot(this, slot, randomAmplitude, waveAmplitude, waveSpeed, phase);
    }

    public clearCameraShakeSlot(slot: number): void {
        return render.clearCameraShakeSlot(this, slot);
    }

    public clearCameraShake(): void {
        return render.clearCameraShake(this);
    }

    public computeCameraShakeOffsets(clientCycle: number): {
        x: number;
        y: number;
        z: number;
        yaw: number;
        pitch: number;
        active: boolean;
    } {
        return render.computeCameraShakeOffsets(this, clientCycle);
    }

    public updateCameraFollow(deltaTime?: number, timeSec?: number): void {
        return render.updateCameraFollow(this, deltaTime, timeSec);
    }

    public getSceneViewportWidgetRect(): { x: number; y: number; width: number; height: number } {
        return render.getSceneViewportWidgetRect(this);
    }

    public clearSceneFramebuffer(viewportRect: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): void {
        return render.clearSceneFramebuffer(this, viewportRect);
    }

    public updateHoveredTile(): void {
        return render.updateHoveredTile(this);
    }

    public sampleHeightAtExactPlane(worldX: number, worldZ: number, plane: number): number {
        return render.sampleHeightAtExactPlane(this, worldX, worldZ, plane);
    }

    public getWorldEntityAdjustedTerrainRay(ray: Ray, map: WebGLMapSquare): Ray {
        return render.getWorldEntityAdjustedTerrainRay(this, ray, map);
    }

    public intersectTerrainPickTriangle(
        ray: Ray,
        vertices: Float32Array,
        vertexOffset: number,
        baseX: number,
        baseZ: number,
    ): number | undefined {
        return render.intersectTerrainPickTriangle(this, ray, vertices, vertexOffset, baseX, baseZ);
    }

    public computeTerrainTileAt(
        mouseX: number,
        mouseY: number,
    ): { tileX: number; tileY: number; plane: number } | undefined {
        return render.computeTerrainTileAt(this, mouseX, mouseY);
    }

    public computeTileAt(
        mouseX: number,
        mouseY: number,
    ): { tileX: number; tileY: number; plane: number } | undefined {
        return render.computeTileAt(this, mouseX, mouseY);
    }

    public worldToScreen(x: number, y: number, z: number): number[] | Float32Array | undefined {
        return render.worldToScreen(this, x, y, z);
    }

    public toGLClickXY(evt?: MouseEvent): { sx: number; sy: number } {
        return render.toGLClickXY(this, evt);
    }

    public getInteractHighlightDrawTargets(): ReadonlyArray<InteractHighlightDrawTarget> {
        return render.getInteractHighlightDrawTargets(this);
    }

    public syncInteractHighlightActiveTargetFromLocalInteraction(): void {
        return render.syncInteractHighlightActiveTargetFromLocalInteraction(this);
    }

    public resolveInteractHighlightTargetFromLocalInteraction():
        | InteractHighlightTarget
        | undefined {
        return render.resolveInteractHighlightTargetFromLocalInteraction(this);
    }

    public maybeExpireInteractHighlightTarget(): void {
        return render.maybeExpireInteractHighlightTarget(this);
    }

    public isLocHighlightTargetStillPresent(target: LocHighlightTarget): boolean {
        return render.isLocHighlightTargetStillPresent(this, target);
    }

    public hasActiveDestinationMarker(): boolean {
        return render.hasActiveDestinationMarker(this);
    }

    public isSameInteractHighlightTarget(
        a: InteractHighlightTarget | undefined,
        b: InteractHighlightTarget | undefined,
    ): boolean {
        return render.isSameInteractHighlightTarget(this, a, b);
    }

    public buildHighlightTrianglePoints(
        target: InteractHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        return render.buildHighlightTrianglePoints(this, target);
    }

    public getInteractLocModelLoader(): LocModelLoader | undefined {
        return render.getInteractLocModelLoader(this);
    }

    public getInteractNpcModelLoader(): NpcModelLoader | undefined {
        return render.getInteractNpcModelLoader(this);
    }

    public hasNoVisibleFaces(model: Model): boolean {
        return render.hasNoVisibleFaces(this, model);
    }

    public findVisualProxyModel(
        locModelLoader: LocModelLoader,
        target: LocHighlightTarget,
        modelType: number,
        modelRotation: number,
    ): Model | undefined {
        return render.findVisualProxyModel(this, locModelLoader, target, modelType, modelRotation);
    }

    public buildLocModelHighlightTriangles(
        target: LocHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        return render.buildLocModelHighlightTriangles(this, target);
    }

    public buildNpcModelHighlightTriangles(
        target: NpcHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        return render.buildNpcModelHighlightTriangles(this, target);
    }

    public buildModelTrianglePoints(
        model: Model,
        mapVertex: (index: number) => { x: number; y: number; z: number },
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        return render.buildModelTrianglePoints(this, model, mapVertex);
    }

    public clearInteractHighlightActiveTarget(): void {
        return render.clearInteractHighlightActiveTarget(this);
    }

    public clearInteractHighlightHoverTarget(): void {
        return render.clearInteractHighlightHoverTarget(this);
    }

    public resolveLocHighlightTargetFromEntry(
        entry: Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY"> | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): LocHighlightTarget | undefined {
        return render.resolveLocHighlightTargetFromEntry(this, entry, fallbackTile);
    }

    public getNpcWorldTile(ecsId: number): { x: number; y: number } {
        return render.getNpcWorldTile(this, ecsId);
    }

    public resolveNpcHighlightTargetFromEntry(
        entry: Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY"> | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): NpcHighlightTarget | undefined {
        return render.resolveNpcHighlightTargetFromEntry(this, entry, fallbackTile);
    }

    public resolveNpcHighlightTargetFromServerId(
        serverId: number,
    ): NpcHighlightTarget | undefined {
        return render.resolveNpcHighlightTargetFromServerId(this, serverId);
    }

    public resolveInteractHighlightTargetFromEntry(
        entry: Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY"> | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): InteractHighlightTarget | undefined {
        return render.resolveInteractHighlightTargetFromEntry(this, entry, fallbackTile);
    }

    public updateInteractHighlightHoverTarget(simpleEntries: SimpleMenuEntry[]): void {
        return render.updateInteractHighlightHoverTarget(this, simpleEntries);
    }

    public onInteractHighlightEntryInvoked(
        entry: SimpleMenuEntry | undefined,
        clickedTile?: { tileX: number; tileY: number; plane?: number },
    ): void {
        return render.onInteractHighlightEntryInvoked(this, entry, clickedTile);
    }

    public spawnClickCross(
        tile: { tileX: number; tileY: number; plane?: number } | undefined,
        xy: { sx: number; sy: number },
        color: "red" | "yellow",
    ): void {
        return render.spawnClickCross(this, tile, xy, color);
    }

    public performWorldEntryAction(
        e: OsrsMenuEntry,
        orig: ((entry?: any, evt?: MouseEvent, ctx?: unknown) => void) | undefined,
        evt?: MouseEvent,
        tileForMenu?: { tileX: number; tileY: number; plane?: number },
        menuCtx?: MenuClickContext,
    ): void {
        return render.performWorldEntryAction(this, e, orig);
    }

    public buildSimpleMenuEntries(
        entries: OsrsMenuEntry[],
        opts: {
            shouldFreeze: boolean;
            toCssEvent: (gx?: number, gy?: number) => any;
        },
    ): SimpleMenuEntry[] {
        return render.buildSimpleMenuEntries(this, entries, opts);
    }

    public getApproxTileHeight(worldX: number, worldY: number, basePlane?: number): number {
        return render.getApproxTileHeight(this, worldX, worldY, basePlane);
    }

    public getTileHeightAtPlane(worldX: number, worldY: number, plane: number): number {
        return render.getTileHeightAtPlane(this, worldX, worldY, plane);
    }

    public getBridgedTileHeight(worldX: number, worldY: number, plane: number): number {
        return render.getBridgedTileHeight(this, worldX, worldY, plane);
    }

    public getMinTileHeightInRadius(
        worldX: number,
        worldZ: number,
        plane: number,
        radius: number,
    ): number {
        return render.getMinTileHeightInRadius(this, worldX, worldZ, plane, radius);
    }

    public getNpcFootprintRadius(npcTypeId: number | undefined): number {
        return render.getNpcFootprintRadius(this, npcTypeId);
    }

    public getControlledPlayerWorldViewId(): number {
        return render.getControlledPlayerWorldViewId(this);
    }

    public getPreferredMapForWorldTile(tileX: number, tileY: number): WebGLMapSquare | undefined {
        return render.getPreferredMapForWorldTile(this, tileX, tileY);
    }

    public getMapLocalTile(
        map: WebGLMapSquare,
        tileX: number,
        tileY: number,
    ): { x: number; y: number } | undefined {
        return render.getMapLocalTile(this, map, tileX, tileY);
    }

    public getGroundItemLayerHeightTiles(tileX: number, tileY: number, level: number): number {
        return render.getGroundItemLayerHeightTiles(this, tileX, tileY, level);
    }

    public withGroundItemOverlayHeights(
        entries: GroundItemOverlayEntry[],
    ): GroundItemOverlayEntry[] {
        return render.withGroundItemOverlayHeights(this, entries);
    }

    public getEffectivePlaneForTile(tileX: number, tileY: number, basePlane: number): number {
        return render.getEffectivePlaneForTile(this, tileX, tileY, basePlane);
    }

    public getHeightSamplePlaneForTile(tileX: number, tileY: number, basePlane: number): number {
        return render.getHeightSamplePlaneForTile(this, tileX, tileY, basePlane);
    }

    public getOccupancyPlaneForTile(tileX: number, tileY: number, basePlane: number): number {
        return render.getOccupancyPlaneForTile(this, tileX, tileY, basePlane);
    }

    public isBridgeSurfaceTile(tileX: number, tileY: number, plane: number): boolean {
        return render.isBridgeSurfaceTile(this, tileX, tileY, plane);
    }

    public toCssEvent(
        gx?: number,
        gy?: number,
        frameCount?: number,
    ): { clientX: number; clientY: number } | undefined {
        return render.toCssEvent(this, gx, gy, frameCount);
    }

    public isMouseInUIRegion(mx: number, my: number): boolean {
        return render.isMouseInUIRegion(this, mx, my);
    }

    public screenToRay(mouseX: number, mouseY: number): Ray | null {
        return render.screenToRay(this, mouseX, mouseY);
    }

    override getCollisionFlagAt(level: number, tileX: number, tileY: number): number {
        return render.getCollisionFlagAt(this, level, tileX, tileY);
    }

    public getLocIdsAtTile(tileX: number, tileY: number, basePlane: number): number[] {
        return render.getLocIdsAtTile(this, tileX, tileY, basePlane);
    }

    public getLocIdsAtTileAllLevels(
        tileX: number,
        tileY: number,
    ): { id: number; level: number; typeRot?: number }[] {
        return render.getLocIdsAtTileAllLevels(this, tileX, tileY);
    }

    public resolveLocInteractionTile(
        locId: number,
        approx: { tileX: number; tileY: number; plane?: number },
    ): { tileX: number; tileY: number; plane?: number; typeRot?: number } {
        return render.resolveLocInteractionTile(this, locId, approx);
    }

    public isLocalPlayerAdjacentToLoc(
        locId: number,
        tile: { tileX: number; tileY: number },
    ): boolean {
        return render.isLocalPlayerAdjacentToLoc(this, locId, tile);
    }

    public getLocalPlayerTile(): { x: number; y: number } | undefined {
        return render.getLocalPlayerTile(this);
    }

    public getLocSize(locId: number): { sizeX: number; sizeY: number } | undefined {
        return render.getLocSize(this, locId);
    }

    public findNearestLocTile(
        locId: number,
        tileX: number,
        tileY: number,
        basePlane: number,
        maxRadius: number = 8,
    ): { tileX: number; tileY: number; plane: number; typeRot?: number } | undefined {
        return render.findNearestLocTile(this, locId, tileX, tileY, basePlane, maxRadius);
    }

    public resolveLocTypeRotAtTile(
        locId: number,
        tileX: number,
        tileY: number,
        plane: number,
    ): number | undefined {
        return render.resolveLocTypeRotAtTile(this, locId, tileX, tileY, plane);
    }

    public updateCustomLabels(): void {
        return render.updateCustomLabels(this);
    }

    tickPass(
        time: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        clientCycle: number,
    ): void {
        return render.tickPass(this, time, ticksElapsed, clientTicksElapsed, clientCycle);
    }

    public _ecsUpdatePlayerOccupancy(map: WebGLMapSquare): void {
        return render._ecsUpdatePlayerOccupancy(this, map);
    }

    public resetActorTileSelectionFrameIfNeeded(): void {
        return render.resetActorTileSelectionFrameIfNeeded(this);
    }

    public getActorTileSelectionKey(tileX: number, tileY: number, plane: number): number {
        return render.getActorTileSelectionKey(this, tileX, tileY, plane);
    }

    public shouldReplaceTileWinner(
        current: { kind: "player" | "npc"; id: number; priority: number },
        kind: "player" | "npc",
        id: number,
        priority: number,
    ): boolean {
        return render.shouldReplaceTileWinner(this, current, kind, id, priority);
    }

    public registerActorTileCandidate(
        kind: "player" | "npc",
        id: number,
        tileX: number,
        tileY: number,
        plane: number,
        priority: number,
    ): void {
        return render.registerActorTileCandidate(this, kind, id, tileX, tileY, plane, priority);
    }

    public ensureActorTileSelectionForFrame(): void {
        return render.ensureActorTileSelectionForFrame(this);
    }

    public registerPlayerSceneTileCandidate(pid: number, priority: number): void {
        return render.registerPlayerSceneTileCandidate(this, pid, priority);
    }

    public collectRenderableNpcIds(): Set<number> {
        return render.collectRenderableNpcIds(this);
    }

    public registerNpcSceneTileCandidatesByPriority(
        drawPriority: NpcDrawPriority,
        priority: number,
        renderableNpcIds: Set<number>,
    ): void {
        return render.registerNpcSceneTileCandidatesByPriority(this, drawPriority, priority, renderableNpcIds);
    }

    public isPlayerSceneTileMarkerCandidate(pid: number): boolean {
        return render.isPlayerSceneTileMarkerCandidate(this, pid);
    }

    public isNpcSceneTileMarkerCandidate(ecsId: number): boolean {
        return render.isNpcSceneTileMarkerCandidate(this, ecsId);
    }

    public getEffectiveNpcType(npcTypeId: number): NpcType | undefined {
        return render.getEffectiveNpcType(this, npcTypeId);
    }

    public getCombatTargetPlayerEcsIndex(): number | undefined {
        return render.getCombatTargetPlayerEcsIndex(this);
    }

    shouldRenderPlayerIndex(pid: number): boolean {
        return render.shouldRenderPlayerIndex(this, pid);
    }

    public shouldRenderNpcOwnershipFromMap(map: WebGLMapSquare, ecsId: number): boolean {
        return render.shouldRenderNpcOwnershipFromMap(this, map, ecsId);
    }

    shouldRenderNpcFromMap(map: WebGLMapSquare, ecsId: number): boolean {
        return render.shouldRenderNpcFromMap(this, map, ecsId);
    }

    public _ecsUpdateNpcClient(map: WebGLMapSquare, clientTicksElapsed: number): void {
        return render._ecsUpdateNpcClient(this, map, clientTicksElapsed);
    }

    public addAmbientSoundInstance(
        locId: number,
        soundType: any,
        x: number,
        y: number,
        z: number,
        orientation: number,
        sizeX: number,
        sizeY: number,
    ): void {
        return render.addAmbientSoundInstance(this, locId, soundType, x, y, z, orientation, sizeX, sizeY);
    }

    public static locTypeHasSound(locType: any): boolean {
        return render.locTypeHasSound(locType);
    }

    public locHasSoundPotential(locId: number): boolean {
        return render.locHasSoundPotential(this, locId);
    }

    public getMapSoundEmitters(
        map: WebGLMapSquare,
    ): { locId: number; x: number; y: number; level: number; rot: number }[] {
        return render.getMapSoundEmitters(this, map);
    }

    public addAmbientEmitter(
        locId: number,
        x: number,
        y: number,
        level: number,
        rot: number,
    ): void {
        return render.addAmbientEmitter(this, locId, x, y, level, rot);
    }

    collectAmbientSounds(map: WebGLMapSquare): void {
        return render.collectAmbientSounds(this, map);
    }

    addNpcRenderData(map: WebGLMapSquare) {
        return render.addNpcRenderData(this, map);
    }

    addUnbatchedNpcRenderData(): void {
        return render.addUnbatchedNpcRenderData(this);
    }

    addPlayerRenderData(map: WebGLMapSquare) {
        return render.addPlayerRenderData(this, map);
    }

    addProjectileRenderData(map: WebGLMapSquare) {
        return render.addProjectileRenderData(this, map);
    }

    addWorldGfxRenderData(map: WebGLMapSquare): void {
        return render.addWorldGfxRenderData(this, map);
    }

    public _ecsUpdatePlayerServer(): void {
        return render._ecsUpdatePlayerServer(this);
    }

    updateActorDataTexture() {
        return render.updateActorDataTexture(this);
    }

    public _accumulate(drawRanges: DrawRange[], length?: number): void {
        return render._accumulate(this, drawRanges, length);
    }

    configureDrawCall(drawCall: DrawCall): DrawCall {
        return render.configureDrawCall(this, drawCall);
    }

    draw(drawCall: DrawCall, drawRanges: DrawRange[], drawIndices?: number[]) {
        return render.draw(this, drawCall, drawRanges, drawIndices);
    }

    public drawWithRoofPlaneFilter(
        drawCall: DrawCall,
        drawRanges: DrawRange[],
        drawRangePlanes: Uint8Array | undefined,
        roofPlaneLimit: number,
    ): void {
        return render.drawWithRoofPlaneFilter(this, drawCall, drawRanges, drawRangePlanes, roofPlaneLimit);
    }

    public getMapTileDistanceFromPoint(map: WebGLMapSquare, tileX: number, tileY: number): number {
        return render.getMapTileDistanceFromPoint(this, map, tileX, tileY);
    }

    public getMapZoneDistanceFromPoint(map: WebGLMapSquare, tileX: number, tileY: number): number {
        return render.getMapZoneDistanceFromPoint(this, map, tileX, tileY);
    }

    public isMapWithinRenderDistance(
        map: WebGLMapSquare,
        tileX: number,
        tileY: number,
        renderDistanceTiles: number,
        renderDistancePadTiles: number,
    ): boolean {
        return render.isMapWithinRenderDistance(this, map, tileX, tileY, renderDistanceTiles, renderDistancePadTiles);
    }

    public resolveEffectiveRenderDistanceTiles(frameId: number): number {
        return render.resolveEffectiveRenderDistanceTiles(this, frameId);
    }

    public getFrameRenderDistanceTiles(): number {
        return render.getFrameRenderDistanceTiles(this);
    }

    public resolveEffectiveLodThresholdTiles(frameId: number): number {
        return render.resolveEffectiveLodThresholdTiles(this, frameId);
    }

    public getFrameLodThresholdTiles(): number {
        return render.getFrameLodThresholdTiles(this);
    }

    public resolveEffectiveGroundItemOverlayMaxEntries(frameId: number): number {
        return render.resolveEffectiveGroundItemOverlayMaxEntries(this, frameId);
    }

    public getFrameGroundItemOverlayMaxEntries(): number {
        return render.getFrameGroundItemOverlayMaxEntries(this);
    }

    public resolveEffectiveGroundItemOverlayRadius(frameId: number): number {
        return render.resolveEffectiveGroundItemOverlayRadius(this, frameId);
    }

    public getFrameGroundItemOverlayRadius(): number {
        return render.getFrameGroundItemOverlayRadius(this);
    }

    public getFrameHitsplatMaxEntries(): number {
        return render.getFrameHitsplatMaxEntries(this);
    }

    public getFrameHealthBarMaxEntries(): number {
        return render.getFrameHealthBarMaxEntries(this);
    }

    public getFrameOverheadTextMaxEntries(): number {
        return render.getFrameOverheadTextMaxEntries(this);
    }

    public getFrameOverheadPrayerMaxEntries(): number {
        return render.getFrameOverheadPrayerMaxEntries(this);
    }

    public updateAnimatedDrawRanges(
        map: WebGLMapSquare,
        drawCall: DrawCall,
        drawRanges: DrawRange[],
        transparent: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): void {
        return render.updateAnimatedDrawRanges(this, map, drawCall, drawRanges, transparent, isInteract, isLod);
    }

    public renderGeometryPass(transparent: boolean): void {
        return render.renderGeometryPass(this, transparent);
    }

    renderOpaquePass(): void {
        return render.renderOpaquePass(this);
    }

    renderTransparentPass(): void {
        return render.renderTransparentPass(this);
    }

    renderTransparentNpcPass(
        npcDataTextureIndex: number,
        npcDataTexture: Texture | undefined,
    ): void {
        return render.renderTransparentNpcPass(this, npcDataTextureIndex, npcDataTexture);
    }

    updateGroundItemMeshes(stacks: ClientGroundItemStack[]): boolean {
        return render.updateGroundItemMeshes(this, stacks);
    }

    public hashGroundStacks(stacks: ClientGroundItemStack[]): string {
        return render.hashGroundStacks(this, stacks);
    }

    public rebuildGroundItemsForMap(
        map: WebGLMapSquare,
        stacks: ClientGroundItemStack[] | undefined,
    ): boolean {
        return render.rebuildGroundItemsForMap(this, map, stacks);
    }

    renderOpaqueActorPass(
        actorDataTextureIndex: number,
        actorDataTexture: Texture | undefined,
    ): void {
        return render.renderOpaqueActorPass(this, actorDataTextureIndex, actorDataTexture);
    }

    renderTransparentPlayerPass(
        playerDataTextureIndex: number,
        playerDataTexture: Texture | undefined,
    ): void {
        return render.renderTransparentPlayerPass(this, playerDataTextureIndex, playerDataTexture);
    }

    checkInteractions(): void {
        return render.checkInteractions(this);
    }

    override clearSessionCaches(): void {
        return render.clearSessionCaches(this);
    }

    override async cleanUp(): Promise<void> {
        return render.cleanUp(this);
    }

    onLocChange(
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
        opts?: {
            oldTile?: { x: number; y: number };
            newTile?: { x: number; y: number };
            oldRotation?: number;
            newRotation?: number;
            newShape?: number;
        },
    ): void {
        return render.onLocChange(this, oldId, newId, tile, level, opts);
    }

    public getExtraLocsForMap(
        mapX: number,
        mapY: number,
    ):
        | Array<{
        id: number;
        x: number;
        y: number;
        level: number;
        shape: number;
        rotation: number;
    }>
        | undefined {
        return render.getExtraLocsForMap(this, mapX, mapY);
    }

    public scheduleLocGeometryUpdate(
        mapX: number,
        mapY: number,
        group: "loc" | "door" | "full",
    ): void {
        return render.scheduleLocGeometryUpdate(this, mapX, mapY, group);
    }

    onLocAddChange(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): void {
        return render.onLocAddChange(this, locId, tile, level, shape, rotation);
    }

    onLocDel(tile: { x: number; y: number }, level: number, shape: number, rotation: number): void {
        return render.onLocDel(this, tile, level, shape, rotation);
    }

    onLocAnim(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
        animId: number,
    ): void {
        return render.onLocAnim(this, locId, tile, level, shape, rotation, animId);
    }

    public reloadLocAnimationTile(tile: { x: number; y: number }, locId: number): void {
        return render.reloadLocAnimationTile(this, tile, locId);
    }

    public getLocAnimationDurationMs(seqId: number): number {
        return render.getLocAnimationDurationMs(this, seqId);
    }

    public scheduleLocReload(mapX: number, mapY: number): void {
        return render.scheduleLocReload(this, mapX, mapY);
    }

    public appendGroundItemMenuEntries(
        menuEntries: OsrsMenuEntry[],
        examineEntries: OsrsMenuEntry[],
    ): void {
        return render.appendGroundItemMenuEntries(this, menuEntries, examineEntries);
    }

    public onCanvasTouchStart = (event: TouchEvent): void => render.onCanvasTouchStart(this, event);
    public onMobileLoginViewportChange = (): void => render.onMobileLoginViewportChange(this);
    public onMobileLoginInput = (event: Event): void => render.onMobileLoginInput(this, event);
    public onMobileLoginKeyDown = (event: KeyboardEvent): void => render.onMobileLoginKeyDown(this, event);
    public onMobileLoginInputFocus = (): void => render.onMobileLoginInputFocus(this);
    public onMobileLoginInputBlur = (): void => render.onMobileLoginInputBlur(this);
    public onServerTick = (tick: number): void => render.onServerTick(this, tick);

    // Chathead model building moved to ChatheadFactory
}

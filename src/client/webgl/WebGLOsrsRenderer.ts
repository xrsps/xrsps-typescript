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
import { OsrsMenuEntry } from "../../rs/MenuEntry";
import { MenuTargetType } from "../../rs/MenuEntry";
import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { NpcDrawPriority } from "../../rs/config/npctype/NpcType";
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { PlayerAppearance } from "../../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../../rs/config/player/PlayerModelLoader";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { getMapIndexFromTile, getMapSquareId } from "../../rs/map/MapFileIndex";
import { Model } from "../../rs/model/Model";
import { ModelData } from "../../rs/model/ModelData";
import { Scene } from "../../rs/scene/Scene";
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
} from "../../ui/widgets/WidgetFlags";
import { WidgetLoader } from "../../ui/widgets/WidgetLoader";
import { WidgetManager } from "../../ui/widgets/WidgetManager";
import { layoutWidgets } from "../../ui/widgets/layout/WidgetLayout";
import { collectWidgetsAtPoint } from "../../ui/widgets/menu/utils";
import {
    getCanvasCssSize,
    isIos,
    isMobileMode,
    isTouchDevice,
    isWebGL2Supported,
} from "../../util/DeviceUtil";
import { computeDesktopCssZoom, getUiScale } from "../../ui/UiScale";
import { clamp } from "../../util/MathUtil";
import { ClientState } from "../ClientState";
import { GameRenderer } from "../GameRenderer";
import type { HitsplatEventPayload } from "../GameRenderer";
import { OsrsRendererType, WEBGL } from "../GameRenderers";
import { ClickMode, getMousePos } from "../InputManager";
import { OsrsClient } from "../OsrsClient";
import { ActorAnimationClip } from "../actor/ActorAnimation";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    MAX_HITSPLAT_SLOTS,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../actor/ActorOverlayState";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../data/ground/GroundItemStore";
import { NpcEcs } from "../ecs/NpcEcs";
import type { PlayerAnimKey } from "../ecs/PlayerEcs";
import { GameState, LoginIndex } from "../login";
import { Ray } from "../math/Raycast";
import { isMouseInUIRegion as checkMouseInUIRegion } from "../menu/WorldMenuBuilder";
import {
    advanceAnimation,
    computeMovementOrientation,
    computeMovementStep,
    interpolateRotation,
    parseInteractionTarget,
} from "../movement/NpcClientTick";
import type { TileMarkersPluginConfig } from "../plugins/tilemarkers/types";
import {
    BridgePlaneStrategy,
    RoofState,
    computeRoofState,
    getTileRenderFlagAt as lookupTileRenderFlagAt,
    resolveBridgePromotedPlane,
    sampleBridgeHeightForWorldTile,
} from "../roof/RoofVisibility";
import {
    resolveCollisionSamplePlaneForLocal,
    resolveCollisionSamplePlaneForWorldTile,
    resolveGroundItemStackPlane,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForWorldTile,
} from "../scene/PlaneResolver";
import { SceneRaycastHit, SceneRaycaster } from "../scene/SceneRaycaster";
import { LoadingRequirement } from "../state/LoadingTracker";
import type { PlayerSpotAnimationEvent } from "../sync/PlayerSyncTypes";
import { RAD_TO_RS_UNITS, computeFacingRotation } from "../utils/rotation";
import { AnimationFrames } from "./AnimationFrames";
import { ChatheadFactory } from "./ChatheadFactory";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "./DrawRange";
import { createDrawBackend, type DrawBackend } from "./DrawBackend";
import { InteractType } from "./InteractType";
import { profiler } from "./PerformanceProfiler";
import { PlayerChatheadFactory } from "./PlayerChatheadFactory";
import { WebGLMapSquare } from "./WebGLMapSquare";
import { SceneBuffer } from "./buffer/SceneBuffer";
import { getModelFaces, isModelFaceTransparent } from "./buffer/SceneBuffer";
import { GfxManager } from "./gfx/GfxManager";
import { GfxRenderer } from "./gfx/GfxRenderer";
import { buildGroundItemGeometry } from "./ground/GroundItemMeshBuilder";
import { SdMapData } from "./loader/SdMapData";
import { SdMapDataLoader } from "./loader/SdMapDataLoader";
import { SdMapLoaderInput } from "./loader/SdMapLoaderInput";
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
import { resolveFogRange } from "./RenderDistancePolicy";

const MAX_TEXTURES = 1024;
const TEXTURE_SIZE = 128;

const MAX_HIT_ENTRIES = 256;
const DEFAULT_NPC_HEALTH = 100;
const MAX_ESTIMATED_HEALTH = 4000;
const OVERHEAD_CHAT_COLOR_TABLE = [0xffff00, 0xff0000, 0x00ff00, 0x00ffff, 0xff00ff, 0xffffff];
const DEFAULT_OVERHEAD_CHAT_COLOR_ID = 0;
const DEFAULT_OVERHEAD_CHAT_COLOR = OVERHEAD_CHAT_COLOR_TABLE[DEFAULT_OVERHEAD_CHAT_COLOR_ID];
const OVERHEAD_CHAT_FADE_TICKS = 25;

// Limit how many 20ms client ticks we process per frame when catching up.
const MAX_CLIENT_TICKS_PER_FRAME = 25;
// Cap outstanding tick debt so we do not spiral on extremely long pauses.
const MAX_CLIENT_TICK_DEBT = 600;
interface ColorRgb {
    r: number;
    g: number;
    b: number;
}

interface LocHighlightTarget {
    kind: "loc";
    locId: number;
    tileX: number;
    tileY: number;
    plane: number;
    locModelType?: number;
    locRotation?: number;
}

interface NpcHighlightTarget {
    kind: "npc";
    ecsId: number;
    serverId: number;
    npcTypeId: number;
    plane: number;
}

type InteractHighlightTarget = LocHighlightTarget | NpcHighlightTarget;

type LocReloadBatchState = {
    id: number;
    mapIds: number[];
    pendingMapIds: Set<number>;
    loaded: Map<number, SdMapData>;
};

type StreamMapBatch = Map<number, SdMapData>;

// Hitsplat and health bar types moved to ../actor/ActorOverlayState.ts

enum TextureFilterMode {
    DISABLED,
    BILINEAR,
    TRILINEAR,
    ANISOTROPIC_2X,
    ANISOTROPIC_4X,
    ANISOTROPIC_8X,
    ANISOTROPIC_16X,
}

function getMaxAnisotropy(mode: TextureFilterMode): number {
    switch (mode) {
        case TextureFilterMode.ANISOTROPIC_2X:
            return 2;
        case TextureFilterMode.ANISOTROPIC_4X:
            return 4;
        case TextureFilterMode.ANISOTROPIC_8X:
            return 8;
        case TextureFilterMode.ANISOTROPIC_16X:
            return 16;
        default:
            return 1;
    }
}

type BrowserQualityProfileKey = "desktop" | "mobile-touch" | "ios-safari";

interface BrowserQualityProfile {
    key: BrowserQualityProfileKey;
    label: string;
    defaultSceneScale: number;
    fxaaEnabled: boolean;
    renderDistanceCap: number;
    lodThresholdCap: number;
    groundItemOverlayMaxEntries: number;
    groundItemOverlayRadius: number;
    hitsplatMaxEntries: number;
    healthBarMaxEntries: number;
    overheadTextMaxEntries: number;
    overheadPrayerMaxEntries: number;
}

const DESKTOP_QUALITY_PROFILE: BrowserQualityProfile = {
    key: "desktop",
    label: "Desktop",
    defaultSceneScale: 1,
    fxaaEnabled: false,
    renderDistanceCap: 90,
    lodThresholdCap: 90,
    groundItemOverlayMaxEntries: 40,
    groundItemOverlayRadius: 12,
    hitsplatMaxEntries: MAX_HIT_ENTRIES,
    healthBarMaxEntries: 256,
    overheadTextMaxEntries: 256,
    overheadPrayerMaxEntries: 256,
};

const MOBILE_TOUCH_QUALITY_PROFILE: BrowserQualityProfile = {
    key: "mobile-touch",
    label: "Mobile Browser",
    defaultSceneScale: 1,
    fxaaEnabled: false,
    renderDistanceCap: 20,
    lodThresholdCap: 14,
    groundItemOverlayMaxEntries: 24,
    groundItemOverlayRadius: 10,
    hitsplatMaxEntries: 128,
    healthBarMaxEntries: 96,
    overheadTextMaxEntries: 48,
    overheadPrayerMaxEntries: 32,
};

const IOS_SAFARI_QUALITY_PROFILE: BrowserQualityProfile = {
    key: "ios-safari",
    label: "iPhone Safari",
    defaultSceneScale: 1,
    fxaaEnabled: false,
    renderDistanceCap: 18,
    lodThresholdCap: 12,
    groundItemOverlayMaxEntries: 20,
    groundItemOverlayRadius: 8,
    hitsplatMaxEntries: 96,
    healthBarMaxEntries: 72,
    overheadTextMaxEntries: 32,
    overheadPrayerMaxEntries: 24,
};

function optimizeAssumingFlatsHaveSameFirstAndLastData(gl: WebGL2RenderingContext) {
    const epv = gl.getExtension("WEBGL_provoking_vertex");
    if (epv) {
        epv.provokingVertexWEBGL(epv.FIRST_VERTEX_CONVENTION_WEBGL);
    }
}

export class WebGLOsrsRenderer extends GameRenderer<WebGLMapSquare> {
    type: OsrsRendererType = WEBGL;

    /**
     * Get the GL canvas where the click registry is stored.
     * Used for cleaning up click targets when interfaces close.
     */
    getWidgetsGLCanvas(): HTMLCanvasElement | undefined {
        return this.widgetsOverlay?.getGLCanvas();
    }

    dataLoader = new SdMapDataLoader();

    // Track dynamic loc changes: Map<"x,y,level,oldId", {newId,newRotation?,moveToX?,moveToY?}>
    private locOverrides: Map<
        string,
        { newId: number; newRotation?: number; moveToX?: number; moveToY?: number }
    > = new Map();
    // Track spawned locs not in base map data: Map<"x,y,level", {id,type,rotation}>
    private locSpawns: Map<string, { id: number; type: number; rotation: number }> = new Map();
    private pendingLocUpdates: Set<number> = new Set();
    private pendingLocReloadMaps: Map<number, { mapX: number; mapY: number }> = new Map();
    private pendingLocReloadFlushTimer?: ReturnType<typeof setTimeout>;
    private nextLocReloadBatchId: number = 1;
    private pendingLocReloadBatches: Map<number, LocReloadBatchState> = new Map();
    // Map-square -> loc reload batch id for maps that are queued and must be applied together.
    private queuedLocReloadBatchByMap: Map<number, number> = new Map();
    private observedGridRevision: number = -1;
    // Skip the 1-second fog fade-in for maps loaded after a cross-region
    // teleport so the destination appears instantly.
    private skipMapFadeIn: boolean = false;
    private activeStreamGeneration: number = 0;
    private activeStreamExpectedMapIds: Set<number> = new Set();
    private pendingStreamMapsByGeneration: Map<number, StreamMapBatch> = new Map();
    // Coalesce back-to-back loc changes (e.g. 2-piece gates) to avoid transient half-updates/flicker.
    private static readonly LOC_RELOAD_FLUSH_DELAY_MS = 25;
    private static readonly MOBILE_GAMEPLAY_UI_MIN_SCALE = 1.25;
    private static readonly MOBILE_GAMEPLAY_UI_MAX_SCALE = 1.5;
    private static readonly MOBILE_GAMEPLAY_UI_PHONE_EDGE = 390;
    private static readonly MOBILE_GAMEPLAY_UI_TABLET_EDGE = 768;
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

    private roofState?: RoofState;

    // Uniforms
    sceneUniformBuffer?: UniformBuffer;

    cameraPosUni: vec2 = vec2.fromValues(0, 0);
    playerPosUni: vec2 = vec2.fromValues(0, 0);
    resolutionUni: vec2 = vec2.fromValues(0, 0);

    // Framebuffers
    needsFramebufferUpdate: boolean = false;

    // Whether overlay scales have been initialized for the current session.
    private _overlaysScaleInitialized: boolean = false;
    // Track login-like state to detect login→gameplay transition and re-sync overlay scales.
    // null = not yet seen; true = was in login/download state; false = was in gameplay.
    private _lastLoginLikeState: boolean | null = null;

    colorTarget?: Renderbuffer;
    depthTarget?: Renderbuffer;
    framebuffer?: Framebuffer;
    private sceneRenderWidth: number = 1;
    private sceneRenderHeight: number = 1;

    textureColorTarget?: Texture;
    textureDepthTarget?: Renderbuffer;
    textureFramebuffer?: Framebuffer;

    // Textures
    textureFilterMode: TextureFilterMode = TextureFilterMode.DISABLED;

    textureArray?: Texture;
    textureMaterials?: Texture;

    textureIds: number[] = [];
    loadedTextureIds: Set<number> = new Set();
    private textureIdIndexMap: Map<number, number> = new Map();
    private textureFrameCounts: Map<number, number> = new Map();
    private textureLayerCount: number = 0;
    private textureMipmapsDirty: boolean = false;
    private textureMipmapsDirtyAtMs: number = 0;
    private textureMipmapsLastGenAtMs: number = 0;
    private textureMipmapsDirtyUpdates: number = 0;

    private drawBackend?: DrawBackend;
    // Reusable array for filtered draw ranges (avoids per-frame allocation)
    private drawSubsetBuffer: DrawRange[] = [];
    // Reusable arrays for tickPass (avoids per-frame allocation)
    private visibleMapsBuffer: WebGLMapSquare[] = [];
    private ambientSoundBuffer: import("../audio/SoundEffectSystem").AmbientSoundInstance[] = [];
    private ambientSoundBufferIndex: number = 0;
    // Reusable object for gfxRenderer.renderMapPass calls
    private gfxRenderPassOffsets: { player?: number; npc?: number; world?: number } = {};
    // Reusable object for seqSoundCallback to avoid nested object allocation
    private seqSoundPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    private seqSoundOptions: { position: { x: number; y: number; z: number } } = {
        position: this.seqSoundPosition,
    };
    // PERF: Cached seqSoundCallback to avoid closure allocation per frame
    private seqSoundCallback = (seqType: any, frame: number, ctx: any) => {
        this.seqSoundPosition.x = ctx.x;
        this.seqSoundPosition.y = ctx.y;
        this.seqSoundPosition.z = ctx.level * 128;
        this.osrsClient.handleSeqFrameSounds(seqType, frame, this.seqSoundOptions);
    };
    // Throttle ambient sound collection to every N frames (reduces tick cost)
    private ambientSoundFrameCounter: number = 0;
    private static readonly AMBIENT_SOUND_THROTTLE_FRAMES = 3;
    // Max audio range in scene units for spatial culling (32 tiles = 4096 units)
    private static readonly MAX_AUDIO_RANGE = 4096;
    private groundItemStacks: Map<number, ClientGroundItemStack[]> = new Map();
    private groundItemStackHashes: Map<number, string> = new Map();

    /** Minimap icons keyed by mapId (mapX << 8 | mapY) */
    private minimapIcons: Map<number, Array<{ localX: number; localY: number; spriteId: number }>> =
        new Map();

    // PERF: Cached bound helper functions for overlay updates (avoid .bind() allocation each frame)
    private cachedOverlayHelpers: {
        getTileHeightAtPlane: (x: number, y: number, plane: number) => number;
        sampleHeightAtExactPlane: (x: number, y: number, plane: number) => number;
        getEffectivePlaneForTile: (x: number, y: number, basePlane: number) => number;
        getOccupancyPlaneForTile: (x: number, y: number, basePlane: number) => number;
        getTileRenderFlagAt: (level: number, tileX: number, tileY: number) => number;
        isBridgeSurfaceTile: (x: number, y: number, plane: number) => boolean;
        worldToScreen: (x: number, y: number, z: number) => Float32Array | number[] | undefined;
        getCollisionFlagAt: (plane: number, x: number, y: number) => number;
    } | null = null;

    // PERF: Cached overlay update args to avoid per-frame object allocation
    private cachedSceneOverlayUpdateArgs: OverlayUpdateArgs | null = null;
    private cachedOverlayUpdateArgs: OverlayUpdateArgs | null = null;

    mapsToLoad: Denque<SdMapData> = new Denque();

    frameDrawCall?: DrawCall;
    frameFxaaDrawCall?: DrawCall;
    // UI overlays
    private overlayManager?: OverlayManager;
    private gfxManager?: GfxManager;
    private gfxRenderer?: GfxRenderer;
    private projectileManager?: ProjectileManager;
    private projectileRenderer?: ProjectileRenderer;
    private projectileRenderDebugCounts: Map<string, number> = new Map();
    private projectileDebugSettings = {
        freeze: false,
    };
    private hitsplatOverlay?: HitsplatOverlay;
    private healthBarOverlay?: HealthBarOverlay;
    private clickCrossOverlay?: ClickCrossOverlay;
    private tileTextOverlay?: TileTextOverlay;
    private tileMarkerOverlay?: TileMarkerOverlay;
    private groundItemOverlay?: GroundItemOverlay;
    private interactHighlightOverlay?: InteractHighlightOverlay;
    private interactHighlightHoverTarget?: InteractHighlightTarget;
    private interactHighlightActiveTarget?: InteractHighlightTarget;
    private interactHighlightActiveFromInteraction: boolean = false;
    private interactHighlightClickTick: number = -1;
    private readonly interactHighlightDrawTargets: InteractHighlightDrawTarget[] = [];
    private loginOverlay?: LoginOverlay;
    private loadingMessageOverlay?: LoadingMessageOverlay;
    private objectIdOverlay?: any;
    private walkableOverlay?: any;
    private widgetsOverlay?: WidgetsOverlay;
    private model2DRenderer?: Model2DRenderer;
    private itemIconRenderer?: any;
    private chatheadFactory?: ChatheadFactory;
    private playerChatheadFactory?: PlayerChatheadFactory;
    private playerModelLoader2D?: PlayerModelLoader;
    private hitsplatPool: HitsplatEntry[] = [];
    private hitsplatOutput: HitsplatEntry[] = [];
    private healthBarPool: HealthBarEntry[] = [];
    private healthBarOutput: HealthBarEntry[] = [];
    private overheadPrayerPool: OverheadPrayerEntry[] = [];
    private overheadPrayerOutput: OverheadPrayerEntry[] = [];
    private npcHealthBars: Map<number, ActorHealthBarsState> = new Map();
    private playerHealthBars: Map<number, ActorHealthBarsState> = new Map();
    private pendingControlledPlayerServerId?: number;
    private hitsplatSeenNpc: Set<number> = new Set();
    private actorServerTilesSeenNpc: Set<number> = new Set();
    // PERF: Cached arrays/maps for overlay state to avoid per-frame allocations
    private cachedActorServerTiles: Array<{
        x: number;
        y: number;
        plane: number;
        kind: "player" | "npc";
        serverId: number;
        label: string;
    }> = [];
    private cachedActorServerTilesCount: number = 0;
    private actorServerTilesNameCounts: Map<string, number> = new Map();
    private npcHitsplats: Map<number, ActorHitsplatState> = new Map();
    private playerHitsplats: Map<number, ActorHitsplatState> = new Map();
    private hitsplatTickUnsub?: () => void;
    // Cache NPC type properties to avoid repeated loader calls per frame
    private npcDefaultHeightCache: Map<number, number> = new Map(); // Actual model height in OSRS units
    private npcNameCache: Map<number, string> = new Map();

    // Settings
    maxLevel: number = Scene.MAX_LEVELS - 1;

    skyColor: vec4 = vec4.fromValues(0, 0, 0, 1); // Black (OSRS parity — vanilla has no skybox)
    fogDepth: number = 24; // Fog starts at 24 tiles (OSRS fog is subtle until near max distance)
    autoFogDepth: boolean = true;
    autoFogDepthFactor: number = 0.7;

    // Scene-level HSL override matching OSRS Scene.Scene_cameraY / HslOverride.
    // Reference: HslOverride.java, Scene.java beginDraw, AbstractRasterizer.applyHslOverride
    // Values: [hue (-1=no override, 0-63), sat (-1=no override, 0-7),
    //          lum (-1=no override, 0-127), amount (0-255, 0=disabled)]
    sceneHslOverride: vec4 = vec4.fromValues(-1, -1, -1, 0);

    brightness: number = 0.8;
    colorBanding: number = 255;

    smoothTerrain: boolean = false;

    cullBackFace: boolean = true;

    msaaEnabled: boolean = false;
    fxaaEnabled: boolean = false;

    loadObjs: boolean = true;
    loadNpcs: boolean = true;
    // RuneLite-style animation smoothing (non-OSRS parity) is applied to the local player only.

    // State
    lastClientTick: number = 0;
    clientTickPhase: number = 0; // 0..1 within the active client simulation tick
    private clientTickDurationMs: number = 20;
    private get clientTickDurationSec(): number {
        return this.clientTickDurationMs / 1000;
    }
    private pendingClientTicks: number = 0;
    private hasClientTickBaseline: boolean = false;
    lastTick: number = 0;

    // PERF: Cached objects for checkInteractions to avoid per-frame allocations
    private cachedMenuEntries: OsrsMenuEntry[] = [];
    private cachedActiveSpell: {
        spellId: number;
        spellName: string;
        actionName: string;
        spellLevel: number;
        runes: any;
        targetMask: number;
    } | null = null;
    private cachedExamineEntries: OsrsMenuEntry[] = [];
    private cachedLocIds: Set<string> = new Set();
    private cachedObjIds: Set<string> = new Set();
    private cachedNpcIds: Set<number> = new Set();
    private cachedPlayerIds: Set<number> = new Set(); // For player deduplication
    // OSRS X-ray menu: track sub-tile positions where entities were found
    // Key format: (x << 16) | y where x,y are sub-tile coordinates
    private cachedXRayPositions: Set<number> = new Set();
    // PERF: Separate array for client.menuEntries to avoid sharing reference with cachedMenuEntries
    private cachedClientMenuEntries: OsrsMenuEntry[] = [];
    // PERF: Cached object for toCssEvent return value to avoid per-call allocation
    private cachedCssEventResult: { clientX: number; clientY: number } = { clientX: 0, clientY: 0 };
    // PERF: Cached canvas rect - updated only when needed
    private cachedCanvasRect: DOMRect | null = null;
    private cachedCanvasRectFrame: number = -1;
    // PERF: Cached bound toCssEvent function to avoid creating closure each frame
    private boundToCssEvent: (
        gx?: number,
        gy?: number,
    ) => { clientX: number; clientY: number } | undefined;
    private currentFrameCount: number = 0; // Updated each frame for toCssEvent
    // Throttle world interaction/menu recomputation to client cycle cadence.
    private lastInteractionClientCycle: number = -1;
    private lastInteractionMenuOpen: boolean = false;
    private lastInteractionRaycastHitCount: number = 0;
    private lastInteractionMenuOptionCount: number = 0;
    private lastLodVisibleMapCount: number = 0;
    private lastFullDetailVisibleMapCount: number = 0;
    private lastLodThreshold: number = 0;
    private lastRoofPlaneLimit: number = 3;
    private lastDistanceCulledVisibleMapCount: number = 0;
    private effectiveRenderDistanceTiles: number = 0;
    private effectiveRenderDistanceFrame: number = -1;
    private effectiveLodThresholdTiles: number = 0;
    private effectiveLodThresholdFrame: number = -1;
    private effectiveGroundItemOverlayMaxEntries: number = 40;
    private effectiveGroundItemOverlayFrame: number = -1;
    private effectiveGroundItemOverlayRadius: number = 12;
    private effectiveGroundItemOverlayRadiusFrame: number = -1;
    private activeQualityProfile: BrowserQualityProfile = DESKTOP_QUALITY_PROFILE;
    private activeQualityProfileKey: BrowserQualityProfileKey = DESKTOP_QUALITY_PROFILE.key;
    private frameRoofFilteredRangeCount: number = 0;
    private frameRoofTotalRangeCount: number = 0;
    private roofFilteredDrawIndices: number[] = [];

    // OSRS raycast-all menu: SceneRaycaster for Physics.RaycastAll-like behavior
    private sceneRaycaster: SceneRaycaster | null = null;

    // Unified actor instance data (NPCs + Players) when enabled
    unifiedActorData: boolean = true;
    // ECS is authoritative for actors (NPCs and Players migrated)
    actorRenderCount: number = 0;
    actorRenderData: Uint16Array = new Uint16Array(16 * 8);
    // OSRS parity: mirror sceneDrawCycleMarker/tileDrawCycleMarkers submission dedupe
    // for tile-centered single-tile actors. Submission order matches the deob actor pass.
    private frameActorTileSelectionId: number = -1;
    private frameActorTileSelectionBuilt: boolean = false;
    private frameWinningActorByTile: Map<
        number,
        { kind: "player" | "npc"; id: number; priority: number }
    > = new Map();
    private frameActorSelectionSeenNpcIds: Set<number> = new Set();
    // Double-buffered actor data textures to avoid GPU sync issues
    private actorDataTextures: [Texture | undefined, Texture | undefined] = [undefined, undefined];
    private actorDataCurrentIndex: number = 0;
    private actorDataChecksum: number = 0;
    private actorDataLastTexHeight: number = 0;
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
    private dynamicNpcAnimLoader?: DynamicNpcAnimLoader;
    private interactLocModelLoader?: LocModelLoader;
    private interactNpcModelLoader?: NpcModelLoader;
    private dynamicNpcInterleavedBuffer?: VertexBuffer;
    private dynamicNpcIndexBuffer?: VertexBuffer;
    private dynamicNpcVertexArray?: VertexArray;
    private dynamicNpcDrawCall?: DrawCall;
    private dynamicNpcBufferVertexSize = 0;
    private dynamicNpcBufferIndexSize = 0;
    private dynamicNpcUploadedGeometryKey: string | undefined;
    private readonly dynamicNpcSingleDrawRange: DrawRange = newDrawRange(0, 0, 1);
    private readonly dynamicNpcSingleDrawRanges: DrawRange[] = [this.dynamicNpcSingleDrawRange];

    private orbFocalTile?: { x: number; y: number };

    // Smoothed follow-cam focal point (OSRS: oculusOrbFocalPointX/Y). Stored in world sub-units (1 tile = 128).
    private followCamFocalXSub: number = 0;
    private followCamFocalZSub: number = 0;
    private followCamFocalLastClientCycle: number = -1;
    private followCamFocalInitialized: boolean = false;
    // OSRS field600-equivalent: terrain-driven minimum pitch pressure (scaled by 256).
    private cameraTerrainPitchPressure: number = 0;

    // OSRS camera shake slots (0:X, 1:Y, 2:Z, 3:Yaw, 4:Pitch).
    private readonly cameraShakeEnabled: boolean[] = [false, false, false, false, false];
    private readonly cameraShakeRandomAmplitude: number[] = [0, 0, 0, 0, 0];
    private readonly cameraShakeWaveAmplitude: number[] = [0, 0, 0, 0, 0];
    private readonly cameraShakeWaveSpeed: number[] = [0, 0, 0, 0, 0];
    private readonly cameraShakeWavePhase: number[] = [0, 0, 0, 0, 0];
    private cameraShakeLastClientCycle: number = -1;

    // PERF: scratch objects for follow-cam math (avoid per-frame allocations)
    private followCamRot: mat4 = mat4.create();
    private followCamForward: vec3 = vec3.create();
    private followCamForwardAxis: vec3 = vec3.fromValues(0, 0, -1);

    // Track if we've notified LoadingTracker that map data is ready
    private mapDataLoadedNotified: boolean = false;
    // Time (in seconds) when height data first became valid (for fog fade-in delay)
    private heightValidAtTime: number | undefined = undefined;

    // Optional override: force a specific idle SeqType id for player animation
    playerIdleSeqId: number = -1;
    private playerIdleSeqMaxId: number = -1;
    // Player animation mode selector (controls which sequence to pre-bake)
    playerAnimMode: "idle" | "walk" | "run" | "crawl" = "walk";
    private playerIdleSeqOverrideActive = false;
    // Debug: dump animated player vertices per frame during pre-bake
    playerDebugDump: boolean = false;
    // Debug/control: freeze player frame
    playerFreezeFrame: boolean = false;
    playerFixedFrame: number = 0;

    // Reserve high-range ids in the interact buffer to represent players
    static readonly PLAYER_INTERACT_BASE: number = 0x8000;

    // Temporary test: lift players above ground slightly (sub-tile units)
    // Default small lift above ground (not required when baseline aligned)
    playerYOffset: number = 0;

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

    // Per-frame accumulators for stats
    private _frameIndices: number = 0;
    private _frameBatches: number = 0;

    // Phase bias configuration (applied to all players)
    // Animation phase bias constants for foot planting synchronization
    private static readonly WALK_PHASE_BIAS = 0.0;
    private static readonly RUN_PHASE_BIAS = 0.0;

    // Hitsplat sprite devoverlay shader (assets managed by HitsplatOverlay)
    hitsplatProgram?: Program;
    // Approximate player defaultHeight in tile units (model.height / 128)
    private playerDefaultHeightTiles: number = 200 / 128;
    private overheadTextOverlay?: OverheadTextOverlay;
    private overheadPrayerOverlay?: OverheadPrayerOverlay;
    private overheadTextOutput: OverheadTextEntry[] = [];
    private overheadTextPool: OverheadTextEntry[] = [];
    private mobileLoginInput?: HTMLInputElement;
    private mobileLoginInputFocused: boolean = false;
    private mobileLoginKeyboardOpen: boolean = false;
    private mobileLoginViewportBaselineWidth: number = 0;
    private mobileLoginViewportBaselineHeight: number = 0;
    private allowMobileLoginInputBlur: boolean = false;
    private preserveMobileLoginInputModeOnBlur: boolean = false;
    private readonly LOGIN_FIELD_BASE_Y = 201 + 15 + 15 + 10;

    // Player interaction state moved to PlayerInteractionSystem

    constructor(public osrsClient: OsrsClient) {
        super(osrsClient);
        // PERF: Initialize bound toCssEvent function once
        this.boundToCssEvent = (gx?: number, gy?: number) =>
            this.toCssEvent(gx, gy, this.currentFrameCount);
        // Initialize SceneRaycaster for raycast-all menu behavior
        this.sceneRaycaster = new SceneRaycaster(this.mapManager, osrsClient);
        const previousOnMapRemoved = this.mapManager.onMapRemoved;
        this.mapManager.onMapRemoved = (mapX: number, mapY: number) => {
            this.minimapIcons.delete(getMapSquareId(mapX | 0, mapY | 0));
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

    private shouldUseMobileLoginInput(): boolean {
        const state = this.osrsClient.loginState;
        return (
            isMobileMode &&
            this.osrsClient.isOnLoginScreen() &&
            state.loginIndex === LoginIndex.LOGIN_FORM &&
            state.virtualKeyboardVisible === true
        );
    }

    private getCanvasTouchPos(touch: Touch): { x: number; y: number } {
        const [x, y] = getMousePos(this.canvas, touch);
        return {
            x: x | 0,
            y: y | 0,
        };
    }

    private getUiSurfaceCssSize(
        safeBufW: number,
        safeBufH: number,
    ): { cssW: number; cssH: number } {
        let cssW = 0;
        let cssH = 0;
        const canvas = this.canvas;
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

    private getMobileGameplayUiScale(
        cssW: number,
        cssH: number,
        _bufW: number,
        _bufH: number,
    ): number {
        const safeCssW = Math.max(1, cssW);
        const safeCssH = Math.max(1, cssH);
        const shortestCssEdge = Math.max(1, Math.min(safeCssW, safeCssH));
        const viewportT = clamp(
            (shortestCssEdge - WebGLOsrsRenderer.MOBILE_GAMEPLAY_UI_PHONE_EDGE) /
                (WebGLOsrsRenderer.MOBILE_GAMEPLAY_UI_TABLET_EDGE -
                    WebGLOsrsRenderer.MOBILE_GAMEPLAY_UI_PHONE_EDGE),
            0,
            1,
        );
        const desiredUiScale =
            WebGLOsrsRenderer.MOBILE_GAMEPLAY_UI_MIN_SCALE +
            (WebGLOsrsRenderer.MOBILE_GAMEPLAY_UI_MAX_SCALE -
                WebGLOsrsRenderer.MOBILE_GAMEPLAY_UI_MIN_SCALE) *
                viewportT;
        return Math.max(1, desiredUiScale);
    }

    private computeUiRenderMetrics(
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
        const gameState = this.osrsClient.gameState;
        const isLoginLikeState =
            gameState === GameState.DOWNLOADING || this.osrsClient.isOnLoginScreen();
        const rootInterface = this.osrsClient.widgetManager?.rootInterface ?? -1;
        const isMobileGameplayRoot = isMobileMode && !isLoginLikeState && rootInterface === 601;
        const { cssW, cssH } = this.getUiSurfaceCssSize(safeBufW, safeBufH);

        if (!isLoginLikeState) {
            if (!isMobileGameplayRoot) {
                const desktopUiScale = getUiScale(cssW, cssH);
                const cssZoom = computeDesktopCssZoom(cssW, cssH, desktopUiScale);
                // cssZoom > 1 (scale=1 boost): buffer is reduced to 1/cssZoom in getCanvasResolutionScale;
                //   layout divisor increases by cssZoom so renderScaleX stays at 1.0 (integer, crisp).
                // cssZoom < 1 (scale≥3 trim): buffer unchanged; layout divisor shrinks so each OSRS
                //   pixel spans slightly fewer CSS pixels — UI appears slightly smaller, no buffer change.
                // cssZoom = 1: no adjustment.
                const effectiveDivisor = desktopUiScale * cssZoom;
                const layoutW = Math.max(1, Math.round(cssW / effectiveDivisor));
                const layoutH = Math.max(1, Math.round(cssH / effectiveDivisor));
                return {
                    layoutW,
                    layoutH,
                    renderScaleX: safeBufW / layoutW,
                    renderScaleY: safeBufH / layoutH,
                    renderOffsetX: 0,
                    renderOffsetY: 0,
                };
            }

            // Keep the mobile root in its own logical UI surface so handheld widgets can render
            // larger than pure scene-space widgets while still compositing into the full buffer.
            const uiScale = this.getMobileGameplayUiScale(cssW, cssH, safeBufW, safeBufH);
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

        const layoutW = Math.max(1, Math.round(cssW));
        const layoutH = Math.max(1, Math.round(cssH));
        const renderScaleX = safeBufW / layoutW;
        const renderScaleY = safeBufH / layoutH;
        const renderOffsetX = 0;
        const renderOffsetY = 0;

        return {
            layoutW,
            layoutH,
            renderScaleX,
            renderScaleY,
            renderOffsetX,
            renderOffsetY,
        };
    }

    override getCanvasResolutionScale(cssWidth: number, cssHeight: number): number {
        if (typeof window === "undefined") {
            return 1;
        }

        const dpr = window.devicePixelRatio || 1;
        if (!Number.isFinite(dpr) || dpr <= 1) {
            // At DPR=1, the scale-1 zoom boost is achieved by rendering the canvas buffer at
            // 1/cssZoom of the CSS size. The browser's compositor then stretches the buffer to
            // fill the full CSS box (same quality as CSS zoom, no CSS DOM mutations needed,
            // no ResizeObserver loop, no layout-coverage gaps).
            const gameState = this.osrsClient.gameState;
            const isLoginLikeState =
                gameState === GameState.DOWNLOADING || this.osrsClient.isOnLoginScreen();
            if (!isLoginLikeState && !isMobileMode) {
                const intScale = getUiScale(cssWidth, cssHeight);
                const cssZoom = computeDesktopCssZoom(cssWidth, cssHeight, intScale);
                if (cssZoom > 1) return 1 / cssZoom;
            }
            return 1;
        }

        const gameState = this.osrsClient.gameState;
        const isLoginLikeState =
            gameState === GameState.DOWNLOADING || this.osrsClient.isOnLoginScreen();
        if (isLoginLikeState && !isMobileMode) {
            return 1;
        }

        // Only scale for clean integer DPR values (e.g. 2x Retina).
        // Fractional DPR (e.g. 1.25 from 125% Windows scaling) would cause
        // widgets to appear physically smaller since the layout system uses
        // buffer dimensions and sub-pixel interpolation blurs bitmap sprites.
        if (!isMobileMode) {
            const roundedDpr = Math.round(dpr);
            if (Math.abs(dpr - roundedDpr) >= 0.01 || roundedDpr < 2) {
                return 1;
            }
        }

        const maxScale = isLoginLikeState ? 3 : isIos ? 1 : 2;
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

    private resolveBrowserQualityProfile(): BrowserQualityProfile {
        if (!isTouchDevice) {
            return DESKTOP_QUALITY_PROFILE;
        }
        if (isIos) {
            return IOS_SAFARI_QUALITY_PROFILE;
        }
        return MOBILE_TOUCH_QUALITY_PROFILE;
    }

    private syncBrowserQualityProfile(): BrowserQualityProfile {
        const profile = this.resolveBrowserQualityProfile();
        this.activeQualityProfile = profile;
        if (this.activeQualityProfileKey !== profile.key) {
            this.activeQualityProfileKey = profile.key;
            this.fxaaEnabled = profile.fxaaEnabled;
            this.needsFramebufferUpdate = true;
        }
        return profile;
    }

    getActiveQualityProfileKey(): string {
        return this.syncBrowserQualityProfile().key;
    }

    getActiveQualityProfileLabel(): string {
        return this.syncBrowserQualityProfile().label;
    }

    private getSceneResolutionScale(): number {
        if (!isTouchDevice || this.osrsClient.isOnLoginScreen()) {
            this.osrsClient.mobileEffectiveResolutionScale = 1;
            return 1;
        }
        const profile = this.syncBrowserQualityProfile();
        const scale = Math.max(0.5, Math.min(1, profile.defaultSceneScale || 1));
        this.osrsClient.mobileEffectiveResolutionScale = scale;
        return scale;
    }

    private getSceneRenderSize(): { width: number; height: number } {
        const scale = this.getSceneResolutionScale();
        return {
            width: Math.max(1, Math.round(this.app.width * scale)),
            height: Math.max(1, Math.round(this.app.height * scale)),
        };
    }

    private syncSceneFramebufferSize(): void {
        if (!this.app) {
            return;
        }
        const desired = this.getSceneRenderSize();
        if (
            (desired.width | 0) !== (this.sceneRenderWidth | 0) ||
            (desired.height | 0) !== (this.sceneRenderHeight | 0)
        ) {
            this.needsFramebufferUpdate = true;
        }
    }

    private scaleViewportRectToSceneBuffer(rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): { x: number; y: number; width: number; height: number } {
        const sceneWidth = Math.max(1, this.sceneRenderWidth | 0);
        const sceneHeight = Math.max(1, this.sceneRenderHeight | 0);
        const appWidth = Math.max(1, this.app.width | 0);
        const appHeight = Math.max(1, this.app.height | 0);
        return {
            x: Math.max(0, Math.round((rect.x / appWidth) * sceneWidth)),
            y: Math.max(0, Math.round((rect.y / appHeight) * sceneHeight)),
            width: Math.max(1, Math.round((rect.width / appWidth) * sceneWidth)),
            height: Math.max(1, Math.round((rect.height / appHeight) * sceneHeight)),
        };
    }

    shouldUseDirectTextureScenePass(): boolean {
        return false;
    }

    private resolveLoginFieldAt(y: number): 0 | 1 | undefined {
        if (y >= this.LOGIN_FIELD_BASE_Y - 12 && y < this.LOGIN_FIELD_BASE_Y + 3) {
            return 0;
        }
        if (y >= this.LOGIN_FIELD_BASE_Y + 3 && y < this.LOGIN_FIELD_BASE_Y + 18) {
            return 1;
        }
        return undefined;
    }

    private resolveLoginFieldAtCanvasPoint(x: number, y: number): 0 | 1 | undefined {
        const loginRenderer = this.osrsClient.loginRenderer;
        const uiMetrics = this.computeUiRenderMetrics(this.canvas.width, this.canvas.height);
        loginRenderer.syncMobileViewportState(
            this.osrsClient.loginState,
            this.isMobileLoginKeyboardOpen(),
        );
        loginRenderer.updateLayout(
            uiMetrics.layoutW,
            uiMetrics.layoutH,
            this.canvas.width,
            this.canvas.height,
        );
        loginRenderer.setMousePosition(x, y);
        return this.resolveLoginFieldAt(loginRenderer.mouseY);
    }

    isMobileLoginInputActive(): boolean {
        return this.isMobileLoginKeyboardOpen();
    }

    private readMobileLoginViewportMetrics():
        | { width: number; height: number; offsetLeft: number; offsetTop: number }
        | undefined {
        if (typeof window === "undefined") {
            return undefined;
        }

        const viewport = window.visualViewport;
        const width = Math.round(viewport?.width ?? window.innerWidth ?? 0);
        const height = Math.round(viewport?.height ?? window.innerHeight ?? 0);
        if (!(width > 0) || !(height > 0)) {
            return undefined;
        }

        return {
            width,
            height,
            offsetLeft: Math.round(viewport?.offsetLeft ?? 0),
            offsetTop: Math.round(viewport?.offsetTop ?? 0),
        };
    }

    private updateMobileLoginViewportBaseline(force: boolean = false): void {
        const viewport = this.readMobileLoginViewportMetrics();
        if (!viewport) {
            return;
        }

        const widthChanged =
            this.mobileLoginViewportBaselineWidth <= 0 ||
            Math.abs(viewport.width - this.mobileLoginViewportBaselineWidth) > 40;
        if (
            force ||
            widthChanged ||
            !this.mobileLoginInputFocused ||
            !this.mobileLoginKeyboardOpen ||
            viewport.height > this.mobileLoginViewportBaselineHeight
        ) {
            this.mobileLoginViewportBaselineWidth = viewport.width;
            this.mobileLoginViewportBaselineHeight = viewport.height;
        }
    }

    private refreshMobileLoginKeyboardState(): boolean {
        if (!this.mobileLoginInputFocused) {
            this.mobileLoginKeyboardOpen = false;
            this.updateMobileLoginViewportBaseline(true);
            return false;
        }

        if (typeof window === "undefined") {
            this.mobileLoginKeyboardOpen = true;
            return true;
        }

        const viewport = window.visualViewport;
        if (!viewport) {
            this.mobileLoginKeyboardOpen = true;
            return true;
        }

        const width = Math.round(viewport.width);
        const height = Math.round(viewport.height);
        const offsetTop = Math.round(viewport.offsetTop ?? 0);
        const widthChanged =
            this.mobileLoginViewportBaselineWidth <= 0 ||
            Math.abs(width - this.mobileLoginViewportBaselineWidth) > 40;
        if (widthChanged) {
            this.mobileLoginViewportBaselineWidth = width;
            this.mobileLoginViewportBaselineHeight = height;
            this.mobileLoginKeyboardOpen = false;
            return false;
        }

        if (height >= this.mobileLoginViewportBaselineHeight - 20 && offsetTop < 20) {
            this.mobileLoginViewportBaselineHeight = height;
        }

        const heightDelta = this.mobileLoginViewportBaselineHeight - height;
        this.mobileLoginKeyboardOpen = heightDelta >= 80 || offsetTop >= 40;
        return this.mobileLoginKeyboardOpen;
    }

    private isMobileLoginKeyboardOpen(): boolean {
        return this.refreshMobileLoginKeyboardState();
    }

    private syncMobileLoginInputPosition(): void {
        const input = this.mobileLoginInput;
        if (!input) {
            return;
        }

        const viewport = this.readMobileLoginViewportMetrics();
        if (!viewport) {
            input.style.left = "50%";
            input.style.top = "46%";
            input.style.transform = "translate(-50%, -50%)";
            return;
        }

        const focusRatioY = 0.46;
        input.style.left = `${viewport.offsetLeft + Math.round(viewport.width / 2)}px`;
        input.style.top = `${viewport.offsetTop + Math.round(viewport.height * focusRatioY)}px`;
        input.style.transform = "translate(-50%, -50%)";
    }

    private requestMobileLoginKeyboard(field: 0 | 1): void {
        const state = this.osrsClient.loginState;
        state.currentLoginField = field;
        state.onMobile = true;
        state.virtualKeyboardVisible = true;
        if (!this.mobileLoginInputFocused && !this.mobileLoginKeyboardOpen) {
            this.updateMobileLoginViewportBaseline(true);
        }
        const input = this.ensureMobileLoginInput();
        if (
            input &&
            typeof document !== "undefined" &&
            document.activeElement === input &&
            !this.isMobileLoginKeyboardOpen()
        ) {
            this.allowMobileLoginInputBlur = true;
            this.preserveMobileLoginInputModeOnBlur = true;
            input.blur();
        }
        this.syncMobileLoginInput(true);
    }

    private onMobileLoginInputFocus = (): void => {
        this.mobileLoginInputFocused = true;
        this.mobileLoginKeyboardOpen = false;
        this.syncMobileLoginInputPosition();
        this.refreshMobileLoginKeyboardState();
    };

    private onMobileLoginInputBlur = (): void => {
        this.mobileLoginInputFocused = false;
        this.mobileLoginKeyboardOpen = false;

        const shouldRestoreFocus =
            !this.allowMobileLoginInputBlur && this.shouldUseMobileLoginInput();
        const preserveKeyboardMode = this.preserveMobileLoginInputModeOnBlur;
        this.allowMobileLoginInputBlur = false;
        this.preserveMobileLoginInputModeOnBlur = false;

        if (shouldRestoreFocus) {
            const refocus = () => {
                if (!this.shouldUseMobileLoginInput() || this.mobileLoginInputFocused) {
                    return;
                }
                this.syncMobileLoginInput(true);
            };

            if (
                typeof window !== "undefined" &&
                typeof window.requestAnimationFrame === "function"
            ) {
                window.requestAnimationFrame(refocus);
            } else {
                setTimeout(refocus, 0);
            }
        } else if (
            !preserveKeyboardMode &&
            this.osrsClient.isOnLoginScreen() &&
            this.osrsClient.loginState.loginIndex === LoginIndex.LOGIN_FORM
        ) {
            this.osrsClient.loginState.virtualKeyboardVisible = false;
        }

        this.updateMobileLoginViewportBaseline(true);
    };

    private onMobileLoginViewportChange = (): void => {
        this.refreshMobileLoginKeyboardState();
        this.syncMobileLoginInputPosition();
    };

    private syncLoginRendererLayoutForCanvas(): void {
        const loginRenderer = this.osrsClient.loginRenderer;
        const uiMetrics = this.computeUiRenderMetrics(this.canvas.width, this.canvas.height);
        loginRenderer.syncMobileViewportState(
            this.osrsClient.loginState,
            this.isMobileLoginKeyboardOpen(),
        );
        loginRenderer.updateLayout(
            uiMetrics.layoutW,
            uiMetrics.layoutH,
            this.canvas.width,
            this.canvas.height,
        );
    }

    private onCanvasTouchStart = (event: TouchEvent): void => {
        if (!isMobileMode) return;
        if (!this.osrsClient.isOnLoginScreen()) return;
        const state = this.osrsClient.loginState;
        if (!event.touches || event.touches.length < 1) return;

        const { x, y } = this.getCanvasTouchPos(event.touches[0]);
        if (state.loginIndex === LoginIndex.WELCOME) {
            this.syncLoginRendererLayoutForCanvas();
            const action = this.osrsClient.loginRenderer.handleMouseClick(
                state,
                x,
                y,
                ClickMode.LEFT,
                this.osrsClient.gameState,
            );
            if (action?.type === "existing_user") {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.osrsClient.handleLoginMouseClick(x, y, ClickMode.LEFT);
                this.requestMobileLoginKeyboard(0);
                return;
            }
        }

        if (state.loginIndex !== LoginIndex.LOGIN_FORM) return;
        const field = this.resolveLoginFieldAtCanvasPoint(x, y);
        if (field === undefined) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        this.requestMobileLoginKeyboard(field);
    };

    private getActiveLoginFieldValue(): string {
        const state = this.osrsClient.loginState;
        return state.currentLoginField === 0 ? state.username : state.password;
    }

    private setActiveLoginFieldValue(raw: string): void {
        const state = this.osrsClient.loginState;
        if (state.currentLoginField === 0) {
            state.username = raw.slice(0, 320);
        } else {
            state.password = raw.slice(0, 20);
        }
        state.savePersistedLoginState();
    }

    private onMobileLoginInput = (_event: Event): void => {
        const input = this.mobileLoginInput;
        if (!input) return;
        if (!this.shouldUseMobileLoginInput()) return;

        this.setActiveLoginFieldValue(input.value ?? "");
        const normalized = this.getActiveLoginFieldValue();
        if (input.value !== normalized) {
            input.value = normalized;
        }
    };

    private onMobileLoginKeyDown = (event: KeyboardEvent): void => {
        if (!this.shouldUseMobileLoginInput()) return;

        const state = this.osrsClient.loginState;
        if (event.key === "Tab") {
            event.preventDefault();
            state.currentLoginField = state.currentLoginField === 0 ? 1 : 0;
            this.syncMobileLoginInput(true);
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            if (state.currentLoginField === 0 && state.username.length > 0) {
                state.currentLoginField = 1;
                this.syncMobileLoginInput(true);
                return;
            }

            if (state.canAttemptLogin()) {
                state.virtualKeyboardVisible = false;
                this.syncMobileLoginInput(false);
                state.savePersistedLoginState();
                this.osrsClient.updateGameState(GameState.CONNECTING);
                sendLogin(state.username.trim(), state.password, this.osrsClient.loadedCache?.info?.revision ?? 0);
            } else {
                this.osrsClient.handleLoginKeyInput("Enter", "");
                this.syncMobileLoginInput(true);
            }
        }
    };

    private ensureMobileLoginInput(): HTMLInputElement | undefined {
        if (!isMobileMode) return undefined;

        const existing = this.mobileLoginInput;
        if (existing && existing.isConnected) {
            return existing;
        }

        if (typeof document === "undefined") return undefined;

        const input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
        input.autocapitalize = "none";
        input.setAttribute("autocorrect", "off");
        input.spellcheck = false;
        input.inputMode = "email";
        (input as any).enterKeyHint = "next";
        input.tabIndex = -1;
        input.style.position = "fixed";
        input.style.width = "16px";
        input.style.height = "16px";
        input.style.opacity = "0";
        input.style.pointerEvents = "none";
        input.style.border = "0";
        input.style.margin = "0";
        input.style.padding = "0";
        input.style.background = "transparent";
        input.style.color = "transparent";
        input.style.caretColor = "transparent";
        input.style.fontSize = "16px";

        input.addEventListener("input", this.onMobileLoginInput);
        input.addEventListener("keydown", this.onMobileLoginKeyDown);
        input.addEventListener("focus", this.onMobileLoginInputFocus);
        input.addEventListener("blur", this.onMobileLoginInputBlur);
        document.body.appendChild(input);
        this.mobileLoginInput = input;
        this.syncMobileLoginInputPosition();
        return input;
    }

    private destroyMobileLoginInput(): void {
        const input = this.mobileLoginInput;
        if (!input) return;
        input.removeEventListener("input", this.onMobileLoginInput);
        input.removeEventListener("keydown", this.onMobileLoginKeyDown);
        input.removeEventListener("focus", this.onMobileLoginInputFocus);
        input.removeEventListener("blur", this.onMobileLoginInputBlur);
        try {
            input.remove();
        } catch {}
        this.mobileLoginInput = undefined;
        this.mobileLoginInputFocused = false;
        this.mobileLoginKeyboardOpen = false;
    }

    private syncMobileLoginInput(focus: boolean): void {
        if (!this.shouldUseMobileLoginInput()) {
            const input = this.mobileLoginInput;
            if (input && document.activeElement === input) {
                this.allowMobileLoginInputBlur = true;
                this.preserveMobileLoginInputModeOnBlur = false;
                input.blur();
            }
            return;
        }

        const input = this.ensureMobileLoginInput();
        if (!input) return;

        const state = this.osrsClient.loginState;
        const wantsPassword = state.currentLoginField === 1;
        const nextType = wantsPassword ? "password" : "text";
        if (input.type !== nextType) {
            input.type = nextType;
        }
        input.inputMode = wantsPassword ? "text" : "email";
        (input as any).enterKeyHint = wantsPassword ? "go" : "next";

        const value = this.getActiveLoginFieldValue();
        if (input.value !== value) {
            input.value = value;
        }

        this.syncMobileLoginInputPosition();

        if (focus && document.activeElement !== input) {
            try {
                input.focus({ preventScroll: true });
            } catch {
                input.focus();
            }
        }
        if (focus) {
            const end = input.value.length;
            input.setSelectionRange(end, end);
        }
    }

    static isSupported(): boolean {
        return isWebGL2Supported;
    }

    private acquireHitsplatEntry(): HitsplatEntry {
        const entry = this.hitsplatPool.pop() ?? { worldX: 0, worldZ: 0, plane: 0 };
        entry.style = undefined;
        entry.spriteName = undefined;
        entry.type2 = undefined;
        entry.damage2 = undefined;
        return entry;
    }

    private acquireHealthBarEntry(): HealthBarEntry {
        return this.healthBarPool.pop() ?? { worldX: 0, worldZ: 0, plane: 0, ratio: 1 };
    }

    private acquireOverheadPrayerEntry(): OverheadPrayerEntry {
        return (
            this.overheadPrayerPool.pop() ?? {
                worldX: 0,
                worldZ: 0,
                plane: 0,
                heightOffsetTiles: 0.9,
                headIconPrayer: -1,
            }
        );
    }

    private acquireOverheadTextEntry(): OverheadTextEntry {
        const entry = this.overheadTextPool.pop() ?? {
            worldX: 0,
            worldZ: 0,
            plane: 0,
            heightOffsetTiles: 0.9,
            text: "",
            color: DEFAULT_OVERHEAD_CHAT_COLOR >>> 0,
            colorId: DEFAULT_OVERHEAD_CHAT_COLOR_ID,
            effect: 0,
            life: 1,
            remaining: 0,
            duration: 1,
        };
        entry.modIcon = undefined;
        entry.pattern = undefined;
        return entry;
    }

    private resetHealthBarOutput(): void {
        if (this.healthBarOutput.length === 0) return;
        for (const entry of this.healthBarOutput) {
            entry.alpha = undefined;
            entry.defId = undefined;
            entry.heightOffsetTiles = undefined;
            this.healthBarPool.push(entry);
        }
        this.healthBarOutput.length = 0;
    }

    private resetOverheadPrayerOutput(): void {
        if (this.overheadPrayerOutput.length === 0) return;
        for (const entry of this.overheadPrayerOutput) {
            entry.headIconPrayer = -1;
            entry.heightOffsetTiles = 0.9;
            this.overheadPrayerPool.push(entry);
        }
        this.overheadPrayerOutput.length = 0;
    }

    private resetOverheadTextOutput(): void {
        if (this.overheadTextOutput.length === 0) return;
        for (const entry of this.overheadTextOutput) {
            entry.text = "";
            entry.life = 0;
            entry.remaining = 0;
            entry.duration = 0;
            entry.modIcon = undefined;
            entry.pattern = undefined;
            entry.heightOffsetTiles = 0.9;
            entry.color = DEFAULT_OVERHEAD_CHAT_COLOR >>> 0;
            entry.colorId = DEFAULT_OVERHEAD_CHAT_COLOR_ID;
            this.overheadTextPool.push(entry);
        }
        this.overheadTextOutput.length = 0;
    }

    private resetHitsplatOutput(): void {
        if (this.hitsplatOutput.length === 0) return;
        for (const entry of this.hitsplatOutput) {
            entry.style = undefined;
            entry.spriteName = undefined;
            this.hitsplatPool.push(entry);
        }
        this.hitsplatOutput.length = 0;
    }

    /**
     * Get NPC defaultHeight in OSRS units by computing actual model bounding cylinder.
     * OSRS Parity: Actor.defaultHeight is set from model.height after calculateBoundsCylinder().
     * Reference: NPC.java line 94: super.defaultHeight = var3.height;
     */
    private getNpcDefaultHeight(npcTypeId: number): number {
        // Check cache first
        let defaultHeight = this.npcDefaultHeightCache.get(npcTypeId);
        if (defaultHeight !== undefined) {
            return defaultHeight;
        }

        // Default fallback (same as Actor constructor: this.defaultHeight = 200)
        defaultHeight = 200;

        try {
            const npcType = this.osrsClient.npcTypeLoader.load(npcTypeId | 0);
            if (npcType && npcType.modelIds && npcType.modelIds.length > 0) {
                // Load and merge model data
                const models: ModelData[] = [];
                for (const modelId of npcType.modelIds) {
                    const modelData = this.osrsClient.modelLoader.getModel(modelId);
                    if (modelData) {
                        models.push(modelData);
                    }
                }

                if (models.length > 0) {
                    const merged = ModelData.merge(models, models.length);

                    // Apply recoloring (needed for proper model construction)
                    if (npcType.recolorFrom) {
                        for (let i = 0; i < npcType.recolorFrom.length; i++) {
                            merged.recolor(npcType.recolorFrom[i], npcType.recolorTo[i]);
                        }
                    }

                    // Light the model to get a proper Model instance
                    const model = merged.light(
                        this.osrsClient.textureLoader,
                        (npcType.ambient ?? 0) + 64,
                        (npcType.contrast ?? 0) * 5 + 850,
                        -30,
                        -50,
                        -30,
                    );

                    // Apply height scaling (OSRS applies widthScale to X/Z, heightScale to Y)
                    const widthScale = npcType.widthScale ?? 128;
                    const heightScale = npcType.heightScale ?? 128;
                    if (widthScale !== 128 || heightScale !== 128) {
                        model.scale(widthScale, heightScale, widthScale);
                    }

                    // Calculate bounds cylinder to get actual height
                    model.calculateBoundsCylinder();
                    defaultHeight = model.height;
                }
            }
        } catch (e) {
            // Fall back to default on any error
            console.warn(`[renderer] Failed to compute NPC height for ${npcTypeId}:`, e);
        }

        // Cache and return
        this.npcDefaultHeightCache.set(npcTypeId, defaultHeight);
        return defaultHeight;
    }

    /**
     * Resolve NPC overlay anchor and logical height from the current animated model.
     * This mirrors Actor.logicalHeight / NPC.heightOffset semantics more closely than type-only lookup.
     */
    private resolveNpcOverlayAnchor(
        ecsId: number,
        baseWorldX: number,
        baseWorldZ: number,
        npcTypeId: number | undefined,
    ): { worldX: number; worldZ: number; logicalHeightTiles: number } {
        let worldX = baseWorldX;
        let worldZ = baseWorldZ;
        let defaultHeight = npcTypeId != null ? this.getNpcDefaultHeight(npcTypeId) : 200;
        let logicalHeightTiles = Math.max(0.5, defaultHeight / 128);

        try {
            if (npcTypeId == null || npcTypeId < 0) {
                return { worldX, worldZ, logicalHeightTiles };
            }
            const npcEcs = this.osrsClient.npcEcs;
            const npcTypeLoader = this.osrsClient.npcTypeLoader;
            const npcModelLoader = this.getInteractNpcModelLoader();
            if (!npcModelLoader || !npcTypeLoader) {
                return { worldX, worldZ, logicalHeightTiles };
            }

            let npcType = npcTypeLoader.load(npcTypeId | 0);
            if (!npcType) {
                return { worldX, worldZ, logicalHeightTiles };
            }
            if (npcType.transforms) {
                const transformed = npcType.transform(this.osrsClient.varManager, npcTypeLoader);
                if (transformed) npcType = transformed;
            }

            const actionSeqId = npcEcs.getSeqId(ecsId) | 0;
            const actionDelay = npcEcs.getSeqDelay?.(ecsId) | 0;
            const { movementSeqId, idleSeqId } = this.resolveNpcMovementSequenceIds(npcEcs, ecsId);
            const actionActive = actionSeqId >= 0 && actionDelay === 0;
            const seqId = actionActive ? actionSeqId : movementSeqId;
            const frame = Math.max(
                0,
                actionActive
                    ? npcEcs.getFrameIndex(ecsId) | 0
                    : npcEcs.getMovementFrameIndex?.(ecsId) | 0,
            );
            const movementFrame = Math.max(0, npcEcs.getMovementFrameIndex?.(ecsId) | 0);
            const overlaySeqId =
                actionActive &&
                this.shouldLayerNpcMovementSequence(
                    actionSeqId | 0,
                    movementSeqId | 0,
                    idleSeqId | 0,
                )
                    ? movementSeqId | 0
                    : -1;
            const overlayFrame = overlaySeqId >= 0 ? movementFrame | 0 : -1;
            const animHeightOffsetTiles = this.getSequenceVerticalOffsetTiles(seqId);

            let model =
                seqId >= 0
                    ? npcModelLoader.getModel(
                          npcType,
                          seqId,
                          frame,
                          overlaySeqId | 0,
                          overlayFrame | 0,
                      )
                    : undefined;
            if (!model) {
                model = npcModelLoader.getModel(npcType, -1, -1);
            }
            if (!model) {
                const baseLogicalHeight =
                    npcType.heightOffset >= 0 ? npcType.heightOffset : defaultHeight;
                return {
                    worldX,
                    worldZ,
                    logicalHeightTiles: Math.max(
                        0.5,
                        baseLogicalHeight / 128 + animHeightOffsetTiles,
                    ),
                };
            }

            try {
                model.calculateBoundsCylinder();
                defaultHeight = Math.max(1, model.height | 0);
            } catch {}
            const baseLogicalHeight =
                npcType.heightOffset >= 0 ? npcType.heightOffset : defaultHeight;
            logicalHeightTiles = Math.max(0.5, baseLogicalHeight / 128 + animHeightOffsetTiles);

            // Model-space center can be offset from origin; rotate it like npc.vert.glsl.
            try {
                model.calculateBounds();
                const midX = ((model as any).xMid | 0) as number;
                const midZ = ((model as any).zMid | 0) as number;
                const yaw = (npcEcs.getRotation(ecsId) | 0) * RS_TO_RADIANS;
                const cos = Math.cos(yaw);
                const sin = Math.sin(yaw);
                worldX += (midX * cos + midZ * sin) / 128.0;
                worldZ += (-midX * sin + midZ * cos) / 128.0;
            } catch {}
        } catch {}

        return {
            worldX,
            worldZ,
            logicalHeightTiles,
        };
    }

    private getEffectiveControlledPlayerId(): number {
        const actual = this.osrsClient.controlledPlayerServerId | 0;
        if (actual > 0) {
            if (
                this.pendingControlledPlayerServerId !== undefined &&
                this.pendingControlledPlayerServerId !== actual
            ) {
                this.pendingControlledPlayerServerId = undefined;
            }
            return actual;
        }
        if (this.pendingControlledPlayerServerId !== undefined) {
            return this.pendingControlledPlayerServerId | 0;
        }
        return 0;
    }

    private ensureHitsplatState(
        map: Map<number, ActorHitsplatState>,
        serverId: number,
    ): ActorHitsplatState {
        let state = map.get(serverId);
        if (state) return state;
        state = createActorHitsplatState();
        map.set(serverId, state);
        return state;
    }

    /**
     * Mirrors Actor.addHitSplat from references/runescape-client/src/main/java/Actor.java.
     *
     * OSRS Parity:
     * - All cycle values are in CLIENT CYCLES (20ms each), NOT server ticks
     * - hitSplatCycles stores: currentCycle + displayCycles + delayCycles (the END cycle)
     * - Start visibility is calculated at render time: hitSplatCycles - displayCycles
     * - delayCycles delays when the hitsplat becomes visible (syncs with animation impact)
     *
     * @param currentCycle Current client cycle (from getClientCycle(), 20ms per cycle)
     * @param delayCycles Additional delay in client cycles before visibility
     */
    private addHitSplatOsrs(
        state: ActorHitsplatState,
        type: number,
        value: number,
        type2: number,
        value2: number,
        currentCycle: number,
        delayCycles: number,
    ): void {
        // Mirror Actor.addHitSplat exactly
        let allExpired = true; // var7
        let allActive = true; // var8
        for (let i = 0; i < 4; i++) {
            if ((state.hitSplatCycles[i] | 0) > (currentCycle | 0)) {
                allExpired = false;
            } else {
                allActive = false;
            }
        }

        let slot = -1; // var9
        let compareType = -1; // var10 (HitSplatDefinition.field2071)
        let displayCycles = 0; // var11 (HitSplatDefinition.field2069)
        if ((type | 0) >= 0) {
            const def = this.hitsplatOverlay?.getDefinition?.(type | 0);
            if (def) {
                compareType = (def.compareType ?? -1) | 0;
                displayCycles = (def.displayCycles ?? 70) | 0;
            } else {
                compareType = -1;
                displayCycles = 70;
            }
        }

        if (allActive) {
            // All 4 slots are active, need to replace one based on compareType
            if ((compareType | 0) === -1) {
                return; // No replacement priority defined, skip this hitsplat
            }
            slot = 0;
            let best = 0;
            // compareType 0 = replace oldest (lowest cycle), 1 = replace lowest damage
            if ((compareType | 0) === 0) best = state.hitSplatCycles[0] | 0;
            else if ((compareType | 0) === 1) best = state.hitSplatValues[0] | 0;
            for (let i = 1; i < 4; i++) {
                if ((compareType | 0) === 0) {
                    const v = state.hitSplatCycles[i] | 0;
                    if (v < best) {
                        slot = i;
                        best = v;
                    }
                } else if ((compareType | 0) === 1) {
                    const v = state.hitSplatValues[i] | 0;
                    if (v < best) {
                        slot = i;
                        best = v;
                    }
                }
            }
            // If compareType=1 and new value is <= existing lowest, don't replace
            if ((compareType | 0) === 1 && (best | 0) >= (value | 0)) {
                return;
            }
        } else {
            // At least one slot is expired, find an empty one
            if (allExpired) {
                state.hitSplatCount = 0;
            }
            for (let i = 0; i < 4; i++) {
                const idx = state.hitSplatCount & 3;
                state.hitSplatCount = (state.hitSplatCount + 1) & 3;
                if ((state.hitSplatCycles[idx] | 0) <= (currentCycle | 0)) {
                    slot = idx;
                    break;
                }
            }
        }

        if (slot >= 0) {
            state.hitSplatTypes[slot] = type | 0;
            state.hitSplatValues[slot] = value | 0;
            state.hitSplatTypes2[slot] = type2 | 0;
            state.hitSplatValues2[slot] = value2 | 0;
            // OSRS: hitSplatCycles[slot] = currentCycle + displayCycles + delayCycles
            // This stores the END cycle (when hitsplat expires)
            // Start visibility = hitSplatCycles - displayCycles (calculated at render time)
            state.hitSplatCycles[slot] = (currentCycle + displayCycles + delayCycles) | 0;
        }
    }

    /**
     * Check if a hitsplat slot is visible and calculate its animation progress.
     *
     * OSRS Parity (class386.drawActor2d):
     * - Visibility: hitSplatCycles - displayCycles <= currentCycle < hitSplatCycles
     * - Animation progress: (displayCycles - remainingCycles) / displayCycles
     *
     * @returns undefined if not visible, or animProgress (0..1) if visible
     */
    private getHitsplatVisibility(
        state: ActorHitsplatState,
        slot: number,
        clientCycle: number,
    ): number | undefined {
        const endCycle = state.hitSplatCycles[slot] | 0;
        const type = state.hitSplatTypes[slot] | 0;

        // Type < 0 means unused slot
        if (type < 0) return undefined;

        // Check if expired: hitSplatCycles <= currentCycle
        if (endCycle <= clientCycle) return undefined;

        // Get displayCycles from definition
        const def = this.hitsplatOverlay?.getDefinition?.(type);
        const displayCycles = (def?.displayCycles ?? 70) | 0;

        // Calculate start cycle: endCycle - displayCycles
        const startCycle = endCycle - displayCycles;

        // Check if not yet visible: startCycle > currentCycle
        if (startCycle > clientCycle) return undefined;

        // Calculate animation progress (0 = just started, 1 = about to expire)
        // remainingCycles = endCycle - currentCycle
        // elapsedCycles = displayCycles - remainingCycles = currentCycle - startCycle
        // animProgress = elapsedCycles / displayCycles
        const remainingCycles = endCycle - clientCycle;
        const elapsedCycles = displayCycles - remainingCycles;
        const animProgress = Math.max(0, Math.min(1, elapsedCycles / displayCycles));

        return animProgress;
    }

    private trimHitsplats(tick: number): void {
        const playerEcs = this.osrsClient.playerEcs;
        const controlledId = this.getEffectiveControlledPlayerId();
        for (const [playerId, state] of this.playerHitsplats) {
            let active = false;
            for (let i = 0; i < 4; i++) {
                if ((state.hitSplatCycles[i] | 0) > (tick | 0)) {
                    active = true;
                    break;
                }
            }
            const isControlledPlayer = controlledId > 0 && (playerId | 0) === controlledId;
            const missingEcsEntry = playerEcs.getIndexForServerId(playerId) === undefined;
            if (!active || (missingEcsEntry && !isControlledPlayer)) {
                this.playerHitsplats.delete(playerId);
            }
        }
        const npcEcs = this.osrsClient.npcEcs;
        for (const [serverId, state] of this.npcHitsplats) {
            let active = false;
            for (let i = 0; i < 4; i++) {
                if ((state.hitSplatCycles[i] | 0) > (tick | 0)) {
                    active = true;
                    break;
                }
            }
            const ecsId = npcEcs.getEcsIdForServer(serverId);
            if (!active || ecsId === undefined || !npcEcs.isActive(ecsId)) {
                this.npcHitsplats.delete(serverId);
            }
        }
    }

    private resolveHealthBarDefinition(defId: number): HealthBarDefinitionState {
        const def = this.healthBarOverlay?.getDefinition?.(defId | 0);
        return {
            defId: defId | 0,
            int1: (def?.int1 ?? 255) | 0,
            int2: (def?.int2 ?? 255) | 0,
            int3: (def?.int3 ?? -1) | 0,
            field1885: (def?.field1885 ?? 1) | 0,
            int5: (def?.int5 ?? 70) | 0,
            width: Math.max(1, Math.min(255, def?.width ?? 30)) | 0,
            widthPadding: Math.max(0, def?.widthPadding ?? 0) | 0,
        };
    }

    private ensureActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        serverId: number,
    ): ActorHealthBarsState {
        let state = map.get(serverId);
        if (state) return state;
        state = createActorHealthBarsState();
        map.set(serverId, state);
        return state;
    }

    private healthBarPut(bar: HealthBarBarState, update: HealthBarUpdateState): void {
        const cycle = update.cycle | 0;
        // Update existing entry at the same cycle.
        for (let i = 0; i < bar.updates.length; i++) {
            if ((bar.updates[i].cycle | 0) === cycle) {
                bar.updates[i] = update;
                return;
            }
        }
        // Insert to keep ascending order by cycle (oldest first).
        let insert = bar.updates.length;
        for (let i = 0; i < bar.updates.length; i++) {
            if ((bar.updates[i].cycle | 0) > cycle) {
                insert = i;
                break;
            }
        }
        bar.updates.splice(insert, 0, update);
        // OSRS parity: keep at most 4 updates; drop the oldest.
        if (bar.updates.length > 4) bar.updates.shift();
    }

    private healthBarGet(
        bar: HealthBarBarState,
        clientCycle: number,
    ): HealthBarUpdateState | undefined {
        const now = clientCycle | 0;
        if (bar.updates.length === 0) return undefined;
        if ((bar.updates[0].cycle | 0) > now) return undefined;
        // Promote to the newest update with cycle <= now by removing older entries.
        while (bar.updates.length > 1 && (bar.updates[1].cycle | 0) <= now) {
            bar.updates.shift();
        }
        const current = bar.updates[0];
        const def = bar.def;
        // OSRS parity: HealthBarDefinition timings are defined in client cycles (20ms).
        if ((def.int5 | 0) + (current.cycleOffset | 0) + (current.cycle | 0) <= now) {
            bar.updates.shift();
            return undefined;
        }
        return current;
    }

    private actorAddHealthBar(
        state: ActorHealthBarsState,
        defId: number,
        update: HealthBarUpdateState,
    ): void {
        const bars = state.bars;
        // Existing bar -> update its timeline.
        for (const b of bars) {
            if ((b.def.defId | 0) === (defId | 0)) {
                this.healthBarPut(b, update);
                return;
            }
        }

        const def = this.resolveHealthBarDefinition(defId);
        const existingCount = bars.length | 0;
        // OSRS parity: only add a 5th bar if we can evict an existing bar with int2 > new.int2
        // (Actor.addHealthBar).
        let removable: HealthBarBarState | undefined = undefined;
        let maxInt2 = def.int2 | 0;
        for (const b of bars) {
            const int2 = b.def.int2 | 0;
            if (int2 > maxInt2) {
                maxInt2 = int2;
                removable = b;
            }
        }
        if (existingCount >= 4 && !removable) return;

        const newBar: HealthBarBarState = { def, updates: [] };
        // Keep bars sorted by definition.int1 descending (Actor.addHealthBar).
        let insertIndex = bars.length;
        for (let i = 0; i < bars.length; i++) {
            if ((bars[i].def.int1 | 0) <= (def.int1 | 0)) {
                insertIndex = i;
                break;
            }
        }
        bars.splice(insertIndex, 0, newBar);

        // If we exceeded the cap, remove the bar with the highest int2.
        if (existingCount >= 4 && removable) {
            const idx = bars.indexOf(removable);
            if (idx >= 0) bars.splice(idx, 1);
        }

        this.healthBarPut(newBar, update);
    }

    private actorRemoveHealthBar(state: ActorHealthBarsState, defId: number): void {
        const bars = state.bars;
        for (let i = 0; i < bars.length; i++) {
            if ((bars[i].def.defId | 0) === (defId | 0)) {
                bars.splice(i, 1);
                return;
            }
        }
    }

    private trimActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        tick: number,
        opts: { kind: "player" | "npc" },
    ): void {
        if (map.size === 0) return;
        const now = tick | 0;
        const playerEcs = this.osrsClient.playerEcs;
        const npcEcs = this.osrsClient.npcEcs;
        const controlledId = this.getEffectiveControlledPlayerId();

        const removeIds: number[] = [];
        for (const [serverId, state] of map) {
            // Drop entries for despawned actors.
            if (opts.kind === "player") {
                const isControlledPlayer =
                    controlledId > 0 && (serverId | 0) === (controlledId | 0);
                const missing = playerEcs.getIndexForServerId(serverId) === undefined;
                if (missing && !isControlledPlayer) {
                    removeIds.push(serverId);
                    continue;
                }
            } else {
                const ecsId = npcEcs.getEcsIdForServer(serverId);
                if (ecsId === undefined || !npcEcs.isActive(ecsId)) {
                    removeIds.push(serverId);
                    continue;
                }
            }

            const bars = state.bars;
            for (let i = bars.length - 1; i >= 0; i--) {
                const bar = bars[i];
                // Use `get` semantics to expire old updates; remove empty bars.
                const got = this.healthBarGet(bar, now);
                if (!got && bar.updates.length === 0) {
                    bars.splice(i, 1);
                }
            }
            if (state.bars.length === 0) {
                removeIds.push(serverId);
            }
        }
        for (const id of removeIds) {
            map.delete(id);
        }
    }

    private computeHealthBarVisual(
        def: HealthBarDefinitionState,
        update: HealthBarUpdateState,
        clientCycle: number,
    ): { ratio: number; alpha: number } | undefined {
        const now = clientCycle | 0;
        const cycle = update.cycle | 0;
        const elapsed = (now - cycle) | 0;
        if (elapsed < 0) return undefined;
        const width = Math.max(1, def.width | 0);
        const start = Math.max(0, Math.min(width, update.health | 0));
        const end = Math.max(0, Math.min(width, update.health2 | 0));
        const cycleOffset = Math.max(0, update.cycleOffset | 0);
        const int5 = Math.max(0, def.int5 | 0);
        const int3 = def.int3 | 0;
        const stepCycles = def.field1885 | 0;
        if (int5 + cycleOffset + cycle <= now) return undefined;

        let value = end;
        let alpha = 1;
        if (cycleOffset > elapsed) {
            // Mirror class386: quantize interpolation to multiples of field1885.
            const step = stepCycles === 0 ? 0 : stepCycles * Math.floor(elapsed / stepCycles);
            // OSRS parity: integer division truncates toward zero (Java semantics).
            value = (start + Math.trunc((step * (end - start)) / cycleOffset)) | 0;
        } else {
            value = end;
            const remaining = int5 + cycleOffset - elapsed;
            if (int3 >= 0) {
                const denom = Math.max(1, int5 - int3);
                // OSRS parity: alpha is computed via integer division, then treated as either
                // fully opaque (>= 255) or a 0..254 fractional alpha.
                const var81 = Math.trunc((remaining << 8) / denom);
                alpha = var81 >= 0 && var81 < 255 ? var81 / 255 : 1;
            }
        }
        if (end > 0 && value < 1) value = 1;
        const ratio = Math.max(0, Math.min(1, value / width));
        return { ratio, alpha };
    }

    private appendActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        serverId: number,
        kind: "player" | "npc",
        worldX: number,
        worldZ: number,
        plane: number,
        baseHeightTiles: number,
        output: HealthBarEntry[],
        clientCycle: number,
        maxOutput: number,
    ): void {
        if (output.length >= maxOutput) return;
        const state = map.get(serverId);
        if (!state) return;
        const groupKey = ((kind === "npc" ? 1 : 0) << 24) | ((serverId | 0) & 0xffffff) | 0;
        // Mirror class386: iterate from the tail of the deque.
        for (let i = state.bars.length - 1; i >= 0; i--) {
            if (output.length >= maxOutput) break;
            const bar = state.bars[i];
            const update = this.healthBarGet(bar, clientCycle);
            if (!update) {
                if (bar.updates.length === 0) {
                    state.bars.splice(i, 1);
                }
                continue;
            }
            const osrs = this.computeHealthBarVisual(bar.def, update, clientCycle);
            if (!osrs || osrs.alpha <= 0) continue;
            const entry = this.acquireHealthBarEntry();
            entry.worldX = worldX;
            entry.worldZ = worldZ;
            entry.plane = plane;
            // OSRS Parity: Health bar at logicalHeightWithAnimationOffset + 15 units.
            // No additional offset needed - baseHeightTiles already includes the +15 offset
            entry.heightOffsetTiles = baseHeightTiles ?? 0;
            entry.ratio = osrs.ratio;
            entry.alpha = osrs.alpha;
            entry.defId = bar.def.defId | 0;
            entry.groupKey = groupKey;
            output.push(entry);
        }
        if (state.bars.length === 0) {
            map.delete(serverId);
        }
    }

    private mapOverheadColor(rawColor: number | undefined): number {
        if (rawColor == null) return DEFAULT_OVERHEAD_CHAT_COLOR >>> 0;
        const colorId = rawColor | 0;
        if (colorId >= 0 && colorId < OVERHEAD_CHAT_COLOR_TABLE.length) {
            return OVERHEAD_CHAT_COLOR_TABLE[colorId] >>> 0;
        }
        if (colorId > 0) {
            return colorId >>> 0;
        }
        return DEFAULT_OVERHEAD_CHAT_COLOR >>> 0;
    }

    private resolveModIcon(modIcon: number | undefined): number | undefined {
        if (modIcon == null) return undefined;
        const idx = modIcon | 0;
        return idx >= 0 ? idx : undefined;
    }

    private getSequenceVerticalOffsetTiles(seqId: number | undefined): number {
        const id = seqId == null ? -1 : seqId | 0;
        if (id < 0) return 0;
        try {
            const seqType = this.osrsClient.seqTypeLoader?.load?.(id) as
                | { verticalOffset?: number }
                | undefined;
            const offset = (seqType?.verticalOffset ?? 0) | 0;
            return offset / 128.0;
        } catch {
            return 0;
        }
    }

    private resolvePlayerAnimationHeightOffsetTiles(index: number): number {
        const playerEcs = this.osrsClient.playerEcs;
        const actionSeqId =
            playerEcs.getAnimActionSeqId?.(index) ?? playerEcs.getAnimSeqId?.(index) ?? -1;
        const actionDelay = playerEcs.getAnimSeqDelay?.(index) ?? 0;
        if ((actionSeqId | 0) >= 0 && (actionDelay | 0) === 0) {
            return this.getSequenceVerticalOffsetTiles(actionSeqId);
        }
        const movementSeqId = playerEcs.getAnimMovementSeqId?.(index) ?? -1;
        return this.getSequenceVerticalOffsetTiles(movementSeqId);
    }

    private resolvePlayerLogicalHeightTiles(index: number, fallback?: number): number {
        const ecsHeight = this.osrsClient.playerEcs.getDefaultHeightTiles?.(index);
        const base =
            typeof ecsHeight === "number" && Number.isFinite(ecsHeight) && ecsHeight > 0
                ? ecsHeight
                : typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0
                ? fallback
                : this.playerDefaultHeightTiles;
        return Math.max(0.5, base + this.resolvePlayerAnimationHeightOffsetTiles(index));
    }

    private resolvePlayerHitsplatOffset(index: number, fallback?: number): number {
        return Math.max(0.25, this.resolvePlayerLogicalHeightTiles(index, fallback) * 0.5);
    }

    private resolvePlayerHeadIconOffset(index: number, fallback?: number): number {
        // OSRS actor2d draws player icons at logicalHeight + 15 world units.
        return this.resolvePlayerLogicalHeightTiles(index, fallback) + 15 / 128;
    }

    private computeOverheadAlpha(entry: OverheadTextEntry): number {
        if (entry.duration <= 0) return 1;
        if (entry.remaining <= 0) return 0;
        const fadeStart = Math.max(1, entry.duration - OVERHEAD_CHAT_FADE_TICKS);
        if (entry.remaining >= fadeStart) return 1;
        return Math.max(0, entry.remaining / Math.max(1, OVERHEAD_CHAT_FADE_TICKS));
    }

    private getNpcTypeIdForServer(serverId: number): number | undefined {
        try {
            const ecs = this.osrsClient.npcEcs;
            const ecsId = ecs.getEcsIdForServer(serverId);
            if (ecsId === undefined) return undefined;
            return ecs.getNpcTypeId(ecsId) | 0;
        } catch {
            return undefined;
        }
    }

    private estimateNpcMaxHp(npcTypeId: number | undefined): number {
        let estimate = DEFAULT_NPC_HEALTH;
        if (typeof npcTypeId === "number" && npcTypeId >= 0) {
            try {
                const loader = this.osrsClient.npcTypeLoader;
                const type = loader?.load?.(npcTypeId);
                if (type) {
                    const params = type.params;
                    const hpParam =
                        params && typeof params.get === "function" ? params.get(10) : undefined;
                    if (typeof hpParam === "number" && hpParam > 0) {
                        estimate = Math.max(estimate, hpParam | 0);
                    }
                    const combat = type.combatLevel | 0;
                    if (combat > 0) {
                        estimate = Math.max(estimate, Math.round(combat * 1.5 + 10));
                    }
                    const size = type.size | 0;
                    if (size > 1) {
                        estimate = Math.max(estimate, estimate + size * 10);
                    }
                }
            } catch {}
        }
        return Math.min(MAX_ESTIMATED_HEALTH, Math.max(10, estimate));
    }

    private trimHealthBars(tick: number): void {
        this.trimActorHealthBars(this.playerHealthBars, tick, { kind: "player" });
        this.trimActorHealthBars(this.npcHealthBars, tick, { kind: "npc" });
    }

    private onServerTick = (tick: number): void => {
        const clientCycle = getClientCycle() | 0;
        this.trimHitsplats(clientCycle);
        this.trimHealthBars(clientCycle);
    };

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
        const serverId = event.serverId | 0;
        if (serverId <= 0) return;
        const bar = event.bar;
        const defId = bar.id | 0;
        const actor = this.playerHealthBars.get(serverId);
        if (bar.removed === true) {
            if (!actor) return;
            this.actorRemoveHealthBar(actor, defId);
            if (actor.bars.length === 0) this.playerHealthBars.delete(serverId);
            return;
        }

        const state = actor ?? this.ensureActorHealthBars(this.playerHealthBars, serverId);
        this.actorAddHealthBar(state, defId, {
            cycle: bar.cycle | 0,
            health: bar.health | 0,
            health2: bar.health2 | 0,
            cycleOffset: bar.cycleOffset | 0,
        });
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
        const serverId = event.serverId | 0;
        if (serverId <= 0) return;
        const bar = event.bar;
        const defId = bar.id | 0;
        const actor = this.npcHealthBars.get(serverId);
        if (bar.removed === true) {
            if (!actor) return;
            this.actorRemoveHealthBar(actor, defId);
            if (actor.bars.length === 0) this.npcHealthBars.delete(serverId);
            return;
        }

        const state = actor ?? this.ensureActorHealthBars(this.npcHealthBars, serverId);
        this.actorAddHealthBar(state, defId, {
            cycle: bar.cycle | 0,
            health: bar.health | 0,
            health2: bar.health2 | 0,
            cycleOffset: bar.cycleOffset | 0,
        });
    }

    clearNpcHealthBars(serverId: number): void {
        this.npcHealthBars.delete(serverId | 0);
    }

    clearPlayerHealthBars(serverId: number): void {
        this.playerHealthBars.delete(serverId | 0);
    }

    override registerHitsplat(event: HitsplatEventPayload): void {
        // OSRS Parity: Use CLIENT CYCLES (20ms each) for hitsplat timing.
        // Client.cycle in OSRS is a client-side counter incrementing every 20ms.
        const clientCycle = getClientCycle() | 0;

        // OSRS parity: `delayCycles` is already in client-cycle units (see Actor.addHitSplat var6).
        const delayCycles =
            typeof event.delayCycles === "number" ? Math.max(0, event.delayCycles | 0) : 0;

        // Preserve raw value parity (`-1` is meaningful for sentinel no-type hitsplats).
        const damage = event.damage | 0;
        const type = typeof event.style === "number" ? event.style | 0 : -1;
        const type2 = typeof event.type2 === "number" ? event.type2 | 0 : -1;
        const damage2 = typeof event.damage2 === "number" ? event.damage2 | 0 : -1;
        const targetId = event.targetId | 0;
        if (event.targetType === "player") {
            if (targetId > 0) {
                const controlledId = this.osrsClient.controlledPlayerServerId | 0;
                if (controlledId <= 0) {
                    this.pendingControlledPlayerServerId = targetId;
                } else if (this.pendingControlledPlayerServerId !== undefined) {
                    this.pendingControlledPlayerServerId = undefined;
                }
            }
            const state = this.ensureHitsplatState(this.playerHitsplats, targetId);
            this.addHitSplatOsrs(state, type, damage, type2, damage2, clientCycle, delayCycles);
        } else {
            const state = this.ensureHitsplatState(this.npcHitsplats, targetId);
            this.addHitSplatOsrs(state, type, damage, type2, damage2, clientCycle, delayCycles);
        }
        // Use client cycle for trim operations too
        this.trimHitsplats(clientCycle);
        this.trimHealthBars(clientCycle);
    }

    override registerSpotAnimation(event: PlayerSpotAnimationEvent): void {
        try {
            const sid = event.serverId | 0;
            const spotId = event.spotId | 0;
            if (spotId < 0) {
                this.gfxManager?.clearAttachedSlotPlayer(
                    sid,
                    typeof event.slot === "number" ? (event.slot | 0) & 0xff : 0,
                );
                return;
            }
            const heightUnits = (event.height ?? 0) | 0;
            const offsetTiles = heightUnits / 128;
            this.gfxManager?.spawnAttachedToPlayer(
                spotId,
                sid,
                offsetTiles !== 0 ? "offset" : "ground",
                offsetTiles !== 0 ? offsetTiles : undefined,
                false,
                event.startCycle | 0,
                typeof event.slot === "number" ? (event.slot | 0) & 0xff : undefined,
            );
        } catch (err) {
            console.warn("[renderer] registerSpotAnimation error", err);
        }
    }

    registerNpcSpotAnimation(event: {
        npcServerId: number;
        spotId: number;
        height: number;
        startCycle: number;
        slot?: number;
    }): void {
        try {
            const sid = event.npcServerId | 0;
            const spotId = event.spotId | 0;
            const slot = typeof event.slot === "number" ? (event.slot | 0) & 0xff : 0;
            if (spotId < 0) {
                this.gfxManager?.clearAttachedSlotNpc(sid, slot);
                return;
            }
            const heightUnits = (event.height ?? 0) | 0;
            const offsetTiles = heightUnits / 128;
            this.gfxManager?.spawnAttachedToNpc(
                spotId,
                sid,
                offsetTiles !== 0 ? "offset" : "ground",
                offsetTiles !== 0 ? offsetTiles : undefined,
                false,
                event.startCycle | 0,
                slot,
            );
        } catch (err) {
            console.warn("[renderer] registerNpcSpotAnimation error", err);
        }
    }

    registerWorldSpotAnimation(event: {
        spotId: number;
        tile: { x: number; y: number; level?: number };
        height?: number;
        startCycle: number;
    }): void {
        try {
            const heightUnits = Number(event.height ?? 0) | 0;
            const heightTiles = heightUnits !== 0 ? heightUnits / 128 : undefined;
            this.gfxManager?.spawnAtTile(
                event.spotId | 0,
                {
                    x: event.tile.x | 0,
                    y: event.tile.y | 0,
                    level: event.tile.level ?? 0,
                },
                {
                    heightTiles,
                    startCycle: event.startCycle | 0,
                },
            );
        } catch (err) {
            console.warn("[renderer] registerWorldSpotAnimation error", err);
        }
    }

    async init(): Promise<void> {
        await super.init();
        this.canvas.addEventListener("touchstart", this.onCanvasTouchStart, {
            passive: false,
            capture: true,
        });
        if (isMobileMode) {
            this.ensureMobileLoginInput();
            this.updateMobileLoginViewportBaseline();
            window.addEventListener("resize", this.onMobileLoginViewportChange);
            window.addEventListener("orientationchange", this.onMobileLoginViewportChange);
            window.visualViewport?.addEventListener("resize", this.onMobileLoginViewportChange);
            window.visualViewport?.addEventListener("scroll", this.onMobileLoginViewportChange);
        }

        this.app = PicoGL.createApp(this.canvas);
        // Ensure app dimensions are initialized from canvas
        (this.app as any).width = this.canvas.width;
        (this.app as any).height = this.canvas.height;
        this.gl = this.app.gl as WebGL2RenderingContext;

        // Initialize widget manager with the active UI layout space.
        if (this.osrsClient.widgetManager) {
            const metrics = this.computeUiRenderMetrics(
                this.canvas.width | 0,
                this.canvas.height | 0,
            );
            this.osrsClient.widgetManager.resize(metrics.layoutW, metrics.layoutH);
        }

        this.hitsplatTickUnsub = subscribeTick((tick) => this.onServerTick(tick));

        // https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#use_webgl_provoking_vertex_when_its_available
        optimizeAssumingFlatsHaveSameFirstAndLastData(this.gl);

        this.timer = this.app.createTimer();

        // Prefer the multi-draw extension when available; fall back to explicit single draws otherwise.
        const state: any = this.app.state;
        const ext = this.gl.getExtension("WEBGL_multi_draw");
        PicoGL.WEBGL_INFO.MULTI_DRAW_INSTANCED = ext;
        state.extensions.multiDrawInstanced = ext;

        this.hasMultiDraw = !!ext;
        this.drawBackend?.dispose();
        this.drawBackend = createDrawBackend(this.hasMultiDraw);
        this.drawBackend.init(this.app, this.gl);

        if (!ext) {
            console.warn(
                "WEBGL_multi_draw extension not available! Rendering may not work correctly. " +
                    "Falling back to single-draw rendering; this is slower but supported.",
            );
        }

        this.osrsClient.workerPool.initLoader(this.dataLoader);

        this.gl.getExtension("EXT_float_blend");

        this.app.enable(PicoGL.CULL_FACE);
        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.depthFunc(PicoGL.LEQUAL);

        this.app.enable(PicoGL.BLEND);
        this.app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);
        this.app.clearColor(0.0, 0.0, 0.0, 1.0);

        this.quadPositions = this.app.createVertexBuffer(
            PicoGL.FLOAT,
            2,
            new Float32Array([-1, 1, -1, -1, 1, -1, -1, 1, 1, -1, 1, 1]),
        );
        this.quadArray = this.app.createVertexArray().vertexAttributeBuffer(0, this.quadPositions);

        this.shadersPromise = this.initShaders();

        this.sceneUniformBuffer = this.app.createUniformBuffer([
            PicoGL.FLOAT_MAT4, // mat4 u_viewProjMatrix;
            PicoGL.FLOAT_MAT4, // mat4 u_viewMatrix;
            PicoGL.FLOAT_MAT4, // mat4 u_projectionMatrix;
            PicoGL.FLOAT_VEC4, // vec4 u_skyColor;
            PicoGL.FLOAT_VEC4, // vec4 u_sceneHslOverride;
            PicoGL.FLOAT_VEC2, // vec2 u_cameraPos;
            PicoGL.FLOAT_VEC2, // vec2 u_playerPos;
            PicoGL.FLOAT, // float u_renderDistance;
            PicoGL.FLOAT, // float u_fogDepth;
            PicoGL.FLOAT, // float u_currentTime;
            PicoGL.FLOAT, // float u_brightness;
            PicoGL.FLOAT, // float u_colorBanding;
            PicoGL.FLOAT, // float u_isNewTextureAnim;
        ]);

        this.initFramebuffers();

        this.initTextures();

        console.log("Renderer init");

        // Build player geometry once (uses current cache + textures)
        try {
            await this.playerRenderer.initGeometry();
        } catch (e) {
            console.warn("Failed to init player geometry", e);
        }

        // Initialize dynamic NPC animation loader (OSRS parity - load animations at render time)
        this.initDynamicNpcAnimLoader();

        try {
            this.osrsClient.notifyRendererReady();
        } catch {}
    }

    private clearDynamicNpcAnimRuntimeState(): void {
        this.dynamicNpcAnimLoader?.clear();
        this.dynamicNpcDrawCall = undefined;
        this.dynamicNpcVertexArray?.delete();
        this.dynamicNpcVertexArray = undefined;
        this.dynamicNpcInterleavedBuffer?.delete();
        this.dynamicNpcInterleavedBuffer = undefined;
        this.dynamicNpcIndexBuffer?.delete();
        this.dynamicNpcIndexBuffer = undefined;
        this.dynamicNpcBufferVertexSize = 0;
        this.dynamicNpcBufferIndexSize = 0;
        this.dynamicNpcUploadedGeometryKey = undefined;
    }

    private disposeDynamicNpcAnimState(): void {
        this.clearDynamicNpcAnimRuntimeState();
        this.dynamicNpcAnimLoader = undefined;
    }

    private initDynamicNpcAnimLoader(): void {
        this.disposeDynamicNpcAnimState();
        try {
            this.dynamicNpcAnimLoader = new DynamicNpcAnimLoader(
                this.osrsClient.npcTypeLoader,
                this.osrsClient.modelLoader,
                this.osrsClient.textureLoader,
                this.osrsClient.seqTypeLoader,
                this.osrsClient.seqFrameLoader,
                this.osrsClient.skeletalSeqLoader,
                this.osrsClient.varManager,
            );
            this.dynamicNpcAnimLoader.setTextureIdIndexMap(this.textureIdIndexMap);
        } catch (e) {
            console.warn("Failed to init dynamic NPC animation loader", e);
        }
    }

    async initPlayerGeometry(): Promise<void> {
        if (!this.playerProgram || !this.textureArray || !this.textureMaterials) {
            await this.shadersPromise;
        }
        if (!this.playerProgram || !this.textureArray || !this.textureMaterials) {
            return;
        }
        // Prepare empty dynamic GPU resources for player rendering. Base-model building is
        // handled in PlayerEcs and PlayerRenderer uploads per-frame geometry.
        const interleavedBuffer = this.app.createInterleavedBuffer(12, new Int32Array(0));
        const indexBuffer = this.app.createIndexBuffer(PicoGL.UNSIGNED_INT, new Int32Array(0));
        const vertexArray = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(indexBuffer);

        const drawCall = this.app
            .createDrawCall(this.playerProgramOpaque ?? this.playerProgram!, vertexArray)
            .uniformBlock("SceneUniforms", this.sceneUniformBuffer!)
            .uniform("u_timeLoaded", -1.0)
            .texture("u_textures", this.textureArray!)
            .texture("u_textureMaterials", this.textureMaterials!);

        // Transparent path: keep separate buffers (initially empty)
        const interleavedBufferAlpha = this.app.createInterleavedBuffer(12, new Int32Array(0));
        const indexBufferAlpha = this.app.createIndexBuffer(PicoGL.UNSIGNED_INT, new Int32Array(0));
        const vertexArrayAlpha = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, interleavedBufferAlpha, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(indexBufferAlpha);
        const drawCallAlpha = this.app
            .createDrawCall(this.playerProgram!, vertexArrayAlpha)
            .uniformBlock("SceneUniforms", this.sceneUniformBuffer!)
            .uniform("u_timeLoaded", -1.0)
            .texture("u_textures", this.textureArray!)
            .texture("u_textureMaterials", this.textureMaterials!);

        this.playerVertexArray = vertexArray;
        this.playerInterleavedBuffer = interleavedBuffer as any;
        this.playerIndexBuffer = indexBuffer as any;
        this.playerInterleavedBufferAlpha = interleavedBufferAlpha as any;
        this.playerIndexBufferAlpha = indexBufferAlpha as any;
        this.playerVertexArrayAlpha = vertexArrayAlpha;
        this.playerDrawCall = drawCall;
        this.playerDrawCallAlpha = drawCallAlpha;
        this.playerDrawRanges = [newDrawRange(0, 0, 1)];
        this.playerDrawRangesAlpha = [newDrawRange(0, 0, 1)];
    }

    async initShaders(): Promise<Program[]> {
        const supportsMultiDraw = this.drawBackend?.supportsMultiDraw ?? false;
        const programs = await this.app.createPrograms(
            createMainProgram(false, supportsMultiDraw),
            createMainProgram(true, supportsMultiDraw),
            createNpcProgram(true, supportsMultiDraw),
            createNpcProgram(false, supportsMultiDraw),
            createProjectileProgram(true, supportsMultiDraw),
            createProjectileProgram(false, supportsMultiDraw),
            createPlayerProgram(true, supportsMultiDraw),
            createPlayerProgram(false, supportsMultiDraw),
            FRAME_PROGRAM,
            FRAME_FXAA_PROGRAM,
            // hover line program (added at end)
            [
                `#version 300 es\n\nlayout(std140, column_major) uniform;\n\nprecision highp float;\n\n// Inline SceneUniforms (can't use #include in runtime strings)\nuniform SceneUniforms {\n    mat4 u_viewProjMatrix;\n    mat4 u_viewMatrix;\n    mat4 u_projectionMatrix;\n    vec4 u_skyColor;\n    vec4 u_sceneHslOverride;\n    vec2 u_cameraPos;\n    vec2 u_playerPos;\n    float u_renderDistance;\n    float u_fogDepth;\n    float u_currentTime;\n    float u_brightness;\n    float u_colorBanding;\n    float u_isNewTextureAnim;\n};\n\nlayout(location=0) in vec3 a_position;\n\nvoid main(){\n    vec4 pos = u_viewMatrix * vec4(a_position, 1.0);\n    gl_Position = u_projectionMatrix * pos;\n}`,
                `#version 300 es\n\nprecision mediump float;\n\nuniform vec4 u_color;\n\nout vec4 fragColor;\nvoid main(){\n    fragColor = u_color;\n}`,
            ],
            // hitsplat textured quad anchored in world (clip-space offset)
            [
                `#version 300 es\n\nlayout(std140, column_major) uniform;\nprecision highp float;\n\nuniform SceneUniforms {\n    mat4 u_viewProjMatrix;\n    mat4 u_viewMatrix;\n    mat4 u_projectionMatrix;\n    vec4 u_skyColor;\n    vec4 u_sceneHslOverride;\n    vec2 u_cameraPos;\n    vec2 u_playerPos;\n    float u_renderDistance;\n    float u_fogDepth;\n    float u_currentTime;\n    float u_brightness;\n    float u_colorBanding;\n    float u_isNewTextureAnim;\n};\n\nlayout(location=0) in vec2 a_position; // pixel offset from anchor\nlayout(location=1) in vec2 a_texCoord;\n\nout vec2 v_uv;\n\nuniform vec2 u_screenSize;\nuniform vec3 u_centerWorld;\n\nvoid main(){\n    vec4 centerClip = u_projectionMatrix * (u_viewMatrix * vec4(u_centerWorld, 1.0));\n    if (centerClip.w <= 0.0) {\n        gl_Position = vec4(2.0, 2.0, 1.0, 1.0);\n        v_uv = a_texCoord;\n        return;\n    }\n\n    vec2 snappedOffset = floor(a_position + vec2(0.5, 0.5));\n    vec2 px = snappedOffset / u_screenSize;\n    vec2 ndcOffset = vec2(px.x * 2.0, -px.y * 2.0);\n    gl_Position = vec4(centerClip.xy + ndcOffset * centerClip.w, centerClip.z, centerClip.w);\n    v_uv = a_texCoord;\n}`,
                `#version 300 es\n\nprecision mediump float;\n\nin vec2 v_uv;\n\nuniform sampler2D u_sprite;\nuniform vec4 u_tint;\n\nout vec4 fragColor;\n\nvoid main(){\n    vec4 c = texture(u_sprite, v_uv);\n    if (c.a < 0.01) discard;\n    fragColor = vec4(c.rgb * u_tint.rgb, c.a * u_tint.a);\n}`,
            ],
            // screen-space textured quad for UI overlays
            [
                `#version 300 es\n\nlayout(location=0) in vec2 a_position;\nlayout(location=1) in vec2 a_texCoord;\n\nuniform vec2 u_screenSize;\n\nout vec2 v_uv;\n\nvoid main(){\n    vec2 px = (a_position + vec2(0.5, 0.5)) / u_screenSize;\n    vec2 ndc = vec2(px.x * 2.0 - 1.0, 1.0 - px.y * 2.0);\n    gl_Position = vec4(ndc, 0.0, 1.0);\n    v_uv = a_texCoord;\n}`,
                `#version 300 es\n\nprecision mediump float;\n\nin vec2 v_uv;\n\nuniform sampler2D u_sprite;\nuniform vec4 u_tint;\n\nout vec4 fragColor;\n\nvoid main(){\n    vec4 c = texture(u_sprite, v_uv);\n    if (c.a < 0.01) discard;\n    fragColor = vec4(c.rgb * u_tint.rgb, c.a * u_tint.a);\n}`,
            ],
        );

        const [
            mainProgram,
            mainAlphaProgram,
            npcProgram,
            npcProgramOpaque,
            projectileProgram,
            projectileProgramOpaque,
            playerProgram,
            playerProgramOpaque,
            frameProgram,
            frameFxaaProgram,
            hoverLineProgram,
            hitsplatProgram,
            uiTabsProgram,
        ] = programs;
        this.mainProgram = mainProgram;
        this.mainAlphaProgram = mainAlphaProgram;
        this.npcProgram = npcProgram;
        this.npcProgramOpaque = npcProgramOpaque;
        this.projectileProgram = projectileProgram;
        this.projectileProgramOpaque = projectileProgramOpaque;
        this.playerProgram = playerProgram;
        this.playerProgramOpaque = playerProgramOpaque;
        this.frameProgram = frameProgram;
        this.frameFxaaProgram = frameFxaaProgram;
        this.hoverLineProgram = hoverLineProgram;
        this.hitsplatProgram = hitsplatProgram;

        this.frameDrawCall = this.app.createDrawCall(frameProgram, this.quadArray);
        this.frameFxaaDrawCall = this.app.createDrawCall(frameFxaaProgram, this.quadArray);

        if (this.hoverLineProgram && this.sceneUniformBuffer) {
            this.overlayManager = new OverlayManager();
            this.overlayManager.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
        }

        // Init GFX manager/renderer (spot animations)
        try {
            this.gfxManager = new GfxManager(this);
            this.gfxRenderer = new GfxRenderer(this, this.gfxManager);
        } catch {}

        // Init projectile manager and renderer
        try {
            this.projectileManager = new ProjectileManager(this);
            this.projectileRenderer = new ProjectileRenderer(this, this.projectileManager);
        } catch {}

        // Create hitsplat overlay now; register it later so it renders after
        // the plugin/world post-present overlays but before widgets.
        try {
            if (this.overlayManager && this.hitsplatProgram && this.sceneUniformBuffer) {
                const hs = new HitsplatOverlay(this.hitsplatProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                    getLoadedCacheInfo: () => this.osrsClient.loadedCache?.info,
                    getVarValue: (varbitId: number, varpId: number) => {
                        try {
                            if (varbitId !== -1)
                                return this.osrsClient.varManager.getVarbit(varbitId) | 0;
                            if (varpId !== -1)
                                return this.osrsClient.varManager.getVarp(varpId) | 0;
                        } catch {}
                        return -1;
                    },
                });
                this.hitsplatOverlay = hs;
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    hs.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Create health bar overlay now; register it later so it renders after
        // the plugin/world post-present overlays but before widgets.
        try {
            if (this.overlayManager && this.hitsplatProgram && this.sceneUniformBuffer) {
                const hb = new HealthBarOverlay(this.hitsplatProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                    getLoadedCacheInfo: () => this.osrsClient.loadedCache?.info,
                });
                this.healthBarOverlay = hb;
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    hb.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Add overhead chat overlay to manager if available
        try {
            if (this.overlayManager && this.hitsplatProgram && this.sceneUniformBuffer) {
                const oh = new OverheadTextOverlay(this.hitsplatProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                });
                this.overheadTextOverlay = oh;
                this.overlayManager.add(oh);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    oh.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Add overhead prayer overlay to manager if available
        try {
            if (this.overlayManager && this.hitsplatProgram && this.sceneUniformBuffer) {
                const op = new OverheadPrayerOverlay(this.hitsplatProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                    getLoadedCacheInfo: () => this.osrsClient.loadedCache?.info,
                });
                this.overheadPrayerOverlay = op;
                this.overlayManager.add(op);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    op.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Spot animation overlay removed; will be reimplemented later.

        // Add login screen overlay
        try {
            if (this.overlayManager && this.sceneUniformBuffer) {
                this.loginOverlay = new LoginOverlay(this.osrsClient);
                this.overlayManager.add(this.loginOverlay);
                this.loginOverlay.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
            }
        } catch (e) {
            console.warn("[WebGLOsrsRenderer] Failed to init login overlay:", e);
        }

        // Add loading message overlay ("Loading - please wait." during LOADING_GAME state)
        // Pass state machine for synchronous state updates
        try {
            if (this.overlayManager && this.sceneUniformBuffer) {
                this.loadingMessageOverlay = new LoadingMessageOverlay(
                    this.osrsClient.stateMachine,
                );
                this.overlayManager.add(this.loadingMessageOverlay);
                this.loadingMessageOverlay.init({
                    app: this.app,
                    sceneUniforms: this.sceneUniformBuffer,
                });
            }
        } catch (e) {
            console.warn("[WebGLOsrsRenderer] Failed to init loading message overlay:", e);
        }

        // Add server-path overlay (numbers over tiles returned by pathfind)
        /*try {
            if (this.overlayManager && this.hoverLineProgram && this.sceneUniformBuffer) {
                const { PathOverlay } = await import("../../ui/devoverlay/PathOverlay");
                const pov = new PathOverlay(this.hoverLineProgram, {
                    getPath: () =>
                        this.osrsClient.showServerPathOverlay
                            ? this.osrsClient.getServerPathWaypoints()
                            : undefined,
                });
                this.overlayManager.add(pov);
                pov.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
            }
        } catch {}*/

        // Add object id devoverlay (labels for loc ids around player)
        try {
            if (this.overlayManager && this.hitsplatProgram && this.sceneUniformBuffer) {
                const { ObjectIdOverlay } = await import("../../ui/devoverlay/ObjectIdOverlay");
                const objOv = new ObjectIdOverlay(this.hitsplatProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                    getLocIdsAtTileAllLevels: (tx: number, ty: number) =>
                        this.getLocIdsAtTileAllLevels(tx, ty),
                    isLocInteractable: (id: number) => {
                        try {
                            let lt = this.osrsClient.locTypeLoader.load(id);
                            if (lt.transforms) {
                                const t = lt.transform(
                                    this.osrsClient.varManager,
                                    this.osrsClient.locTypeLoader,
                                );
                                if (t) lt = t;
                            }
                            if (lt.actions) {
                                for (const a of lt.actions) if (a && a.length > 0) return true;
                            }
                            return (lt.isInteractive | 0) === 1;
                        } catch {
                            return false;
                        }
                    },
                });
                objOv.scale = 1.0;
                objOv.color = 0xffffff;
                objOv.radius = Math.max(1, (this.osrsClient.renderDistance / 8) | 0);
                this.objectIdOverlay = objOv;
                this.overlayManager.add(objOv);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    objOv.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Add collision devoverlay (walkable tiles around player)
        try {
            if (this.overlayManager && this.hoverLineProgram && this.sceneUniformBuffer) {
                const { WalkableOverlay } = await import("../../ui/devoverlay/WalkableOverlay");
                const walk = new WalkableOverlay(this.hoverLineProgram);
                walk.radius = 12;
                walk.enabled = !!this.osrsClient.showCollisionOverlay;
                this.overlayManager.add(walk);
                walk.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                this.walkableOverlay = walk;
            }
        } catch {}

        // Add tile marker overlay (hover, destination, and current true tile outline)
        try {
            if (this.overlayManager && this.hoverLineProgram && this.sceneUniformBuffer) {
                const { TileMarkerOverlay } = await import("../../ui/devoverlay/TileMarkerOverlay");
                const marker = new TileMarkerOverlay(this.hoverLineProgram);
                this.tileMarkerOverlay = marker;
                this.overlayManager.add(marker);
                marker.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
            }
        } catch {}

        // Add tile text overlay (3D coordinate labels for hover/dest/player tiles)
        try {
            if (this.overlayManager && this.hitsplatProgram && this.sceneUniformBuffer) {
                const tileText = new TileTextOverlay(this.hitsplatProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                });
                this.tileTextOverlay = tileText;
                this.overlayManager.add(tileText);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    tileText.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Add click cross devoverlay (sprite id 299 frames 0..3)
        try {
            if (this.overlayManager && this.hitsplatProgram && this.sceneUniformBuffer) {
                const cross = new ClickCrossOverlay(this.hitsplatProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                });
                this.clickCrossOverlay = cross;
                this.overlayManager.add(cross);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    cross.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        try {
            if (this.overlayManager && this.hitsplatProgram && this.sceneUniformBuffer) {
                const ground = new GroundItemOverlay(this.hitsplatProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                });
                this.groundItemOverlay = ground;
                this.overlayManager.add(ground);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    ground.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        try {
            if (this.overlayManager && this.sceneUniformBuffer) {
                const interact = new InteractHighlightOverlay({
                    getTargets: () => this.getInteractHighlightDrawTargets(),
                });
                this.interactHighlightOverlay = interact;
                this.overlayManager.add(interact);
                try {
                    interact.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Draw actor damage overlays after the plugin/world post-present overlays so they
        // cannot cover them, but before widgets so game UI still stays on top. Keep
        // hitsplats after health bars so damage numbers stay on top when they overlap.
        try {
            if (this.overlayManager && this.healthBarOverlay) {
                this.overlayManager.add(this.healthBarOverlay);
            }
            if (this.overlayManager && this.hitsplatOverlay) {
                this.overlayManager.add(this.hitsplatOverlay);
            }
        } catch {}

        // Add widgets overlay for UI rendering
        console.log(
            "[WidgetsOverlay init] overlayManager:",
            !!this.overlayManager,
            "uiTabsProgram:",
            !!uiTabsProgram,
            "sceneUniformBuffer:",
            !!this.sceneUniformBuffer,
        );
        try {
            if (this.overlayManager && uiTabsProgram && this.sceneUniformBuffer) {
                // Import necessary modules dynamically
                const { BitmapFont } = await import("../../rs/font/BitmapFont");
                const { ItemIconRenderer } = await import("../../ui/item/ItemIconRenderer");
                const { WidgetLoader } = await import("../../ui/widgets/WidgetLoader");

                // Get required loaders from OsrsClient
                const objLoader = this.osrsClient.objTypeLoader;
                const modelLoader = this.osrsClient.modelLoader;
                const textureLoader = this.osrsClient.textureLoader;
                const idkLoader = this.osrsClient.idkTypeLoader;

                // Create item icon renderer if we have the necessary loaders
                // Will be reinitialized in initOverlays() if not available now
                if (objLoader && modelLoader && textureLoader && !this.itemIconRenderer) {
                    this.itemIconRenderer = new ItemIconRenderer(
                        objLoader,
                        modelLoader,
                        textureLoader,
                        this.osrsClient.cacheSystem,
                    );
                }
                if (modelLoader && textureLoader && idkLoader) {
                    this.playerChatheadFactory = new PlayerChatheadFactory(
                        modelLoader,
                        textureLoader,
                        idkLoader,
                    );
                }

                // Root interface is set by the server via set_root widget event
                let resolvedGroupId: number | undefined;
                if (!this.osrsClient.widgetManager && this.osrsClient.cacheSystem) {
                    this.osrsClient.widgetManager = new WidgetManager(this.osrsClient.cacheSystem);
                }

                const computeWidgetRoots = (): any[] => {
                    const manager = this.osrsClient.widgetManager;
                    const roots: any[] = [];

                    // NOTE: beginFrame() is now called at the END of draw, not here.
                    // This ensures dirty flags set during the frame are visible to the dirty check.

                    // Widget layout runs in renderer-defined UI space and renders directly into the
                    // canvas buffer.
                    const bufW = this.app.width;
                    const bufH = this.app.height;
                    const metrics = this.computeUiRenderMetrics(bufW, bufH);
                    const layoutW = metrics.layoutW;
                    const layoutH = metrics.layoutH;
                    const widgetRenderScaleX = metrics.renderScaleX;
                    const widgetRenderScaleY = metrics.renderScaleY;
                    const widgetRenderOffsetX = metrics.renderOffsetX;
                    const widgetRenderOffsetY = metrics.renderOffsetY;

                    // Keep CS2 IF_GETCANVASSIZE / widget manager dimensions aligned with the active
                    // widget layout space.
                    manager?.resize(layoutW, layoutH);

                    // Get the current root interface (set by server via IF_OPENTOPLEVEL)
                    // OSRS interfaces can have multiple root widgets (parentUid=-1)
                    // All of them need to be rendered as top-level layers
                    const currentRootInterface = manager?.rootInterface ?? -1;
                    if (currentRootInterface !== -1) {
                        const allRoots = manager?.getAllGroupRoots(currentRootInterface) ?? [];

                        // Helper to count children (both dynamic from children array AND static from parentUid)
                        const getChildCount = (w: any): number => {
                            const dynamicCount = w.children?.length ?? 0;
                            // OSRS parity: also count static children from parentUid filtering
                            const staticCount =
                                manager?.getStaticChildrenByParentUid(w.uid)?.length ?? 0;
                            return dynamicCount + staticCount;
                        };

                        for (const viewportRoot of allRoots) {
                            if (viewportRoot) {
                                // Layout each root independently in the current UI layout space.
                                // Pass static children callback for OSRS parity
                                const getStaticChildren = (uid: number) =>
                                    manager?.getStaticChildrenByParentUid(uid) ?? [];
                                layoutWidgets(
                                    viewportRoot,
                                    layoutW | 0,
                                    layoutH | 0,
                                    getStaticChildren,
                                );

                                // Skip empty layer roots from rendering
                                const childCount = getChildCount(viewportRoot);
                                const hasVisualContent =
                                    viewportRoot.type !== 0 ||
                                    childCount > 0 ||
                                    (typeof viewportRoot.spriteId === "number" &&
                                        viewportRoot.spriteId >= 0) ||
                                    (typeof viewportRoot.spriteId2 === "number" &&
                                        viewportRoot.spriteId2 >= 0) ||
                                    viewportRoot.filled;

                                if (!hasVisualContent) {
                                    continue;
                                }

                                // OSRS PARITY: Register root widget for dirty tracking
                                const rootAny = viewportRoot as any;
                                rootAny.__widgetRenderScale = widgetRenderScaleX;
                                rootAny.__widgetRenderScaleX = widgetRenderScaleX;
                                rootAny.__widgetRenderScaleY = widgetRenderScaleY;
                                rootAny.__widgetRenderOffsetX = widgetRenderOffsetX;
                                rootAny.__widgetRenderOffsetY = widgetRenderOffsetY;
                                const rootX = (viewportRoot.x ?? 0) | 0;
                                const rootY = (viewportRoot.y ?? 0) | 0;
                                const rootW = (viewportRoot.width ?? layoutW) | 0;
                                const rootH = (viewportRoot.height ?? layoutH) | 0;
                                const drawX = Math.round(
                                    rootX * widgetRenderScaleX + widgetRenderOffsetX,
                                );
                                const drawY = Math.round(
                                    rootY * widgetRenderScaleY + widgetRenderOffsetY,
                                );
                                const drawRight = Math.round(
                                    (rootX + rootW) * widgetRenderScaleX + widgetRenderOffsetX,
                                );
                                const drawBottom = Math.round(
                                    (rootY + rootH) * widgetRenderScaleY + widgetRenderOffsetY,
                                );
                                manager?.registerRootWidget(
                                    viewportRoot,
                                    drawX,
                                    drawY,
                                    Math.max(1, drawRight - drawX),
                                    Math.max(1, drawBottom - drawY),
                                );

                                roots.push(viewportRoot);
                            }
                        }
                        if (allRoots.length > 0 && resolvedGroupId !== currentRootInterface) {
                            resolvedGroupId = currentRootInterface;
                        }
                    }

                    return roots;
                };

                const widgets = new WidgetsOverlay(uiTabsProgram, {
                    getCacheSystem: () => this.osrsClient.cacheSystem,
                    getWidgetManager: () => this.osrsClient.widgetManager,
                    getGameContext: () => ({
                        osrsClient: this.osrsClient,
                        playerEcs: this.osrsClient.playerEcs,
                        controlledPlayerServerId: this.osrsClient.controlledPlayerServerId,
                        combatWeaponCategory: this.osrsClient.combatWeaponCategory,
                        combatWeaponItemId: this.osrsClient.combatWeaponItemId,
                        sendEmote,
                    }),
                    getFontLoader: () => {
                        // PERF: Cache loaded BitmapFonts (loading parses cache archives/sprites).
                        const cache = new Map<number, ReturnType<typeof BitmapFont.tryLoad>>();
                        return (id: number) => {
                            const cacheSystem = this.osrsClient.cacheSystem;
                            if (!cacheSystem) return undefined;
                            const key = id | 0;
                            if (cache.has(key)) return cache.get(key);
                            const font = BitmapFont.tryLoad(cacheSystem, key);
                            // Do not memoize missing fonts forever. During startup the widget overlay
                            // can probe a font before the cache data is fully ready, and a permanent
                            // cached undefined would make all later CS2 text for that font invisible.
                            if (font) {
                                cache.set(key, font);
                            }
                            return font;
                        };
                    },
                    getWidgetRoots: () => computeWidgetRoots(),
                    getWidgetRoot: () => {
                        const roots = computeWidgetRoots();
                        return roots.length > 0 ? roots[roots.length - 1] : undefined;
                    },
                    getItemIconCanvas:
                        () =>
                        (
                            itemId: number,
                            qty?: number,
                            outline?: number,
                            shadow?: number,
                            quantityMode?: number,
                        ) => {
                            // Use ItemIconRenderer to render item icons
                            if (this.itemIconRenderer) {
                                return this.itemIconRenderer.renderToCanvas(itemId, qty ?? 1, {
                                    outline,
                                    shadow,
                                    quantityMode,
                                });
                            }
                            return undefined;
                        },
                    getObjLoader: () => {
                        // Return the object loader from OsrsClient
                        return this.osrsClient.objTypeLoader;
                    },
                    getRenderModelCanvas:
                        () => (modelId: number, params: any, width: number, height: number) => {
                            if (!this.model2DRenderer) {
                                this.model2DRenderer = new Model2DRenderer(
                                    this.osrsClient.objTypeLoader,
                                    this.osrsClient.modelLoader,
                                    this.osrsClient.textureLoader,
                                    this.osrsClient.seqTypeLoader,
                                    this.osrsClient.seqFrameLoader,
                                    this.osrsClient.skeletalSeqLoader,
                                );
                            }

                            if (params.widget) {
                                const isPlayerModelWidget =
                                    ((params.widget.contentType ?? 0) | 0) === 328 ||
                                    ((params.widget.modelType ?? 0) | 0) === 7 ||
                                    (params.widget as any).isPlayerModel === true;
                                if (isPlayerModelWidget) {
                                    const haveLoaders =
                                        this.osrsClient.modelLoader &&
                                        this.osrsClient.textureLoader &&
                                        this.osrsClient.idkTypeLoader &&
                                        this.osrsClient.objTypeLoader;
                                    if (!this.playerModelLoader2D && haveLoaders) {
                                        this.playerModelLoader2D = new PlayerModelLoader(
                                            this.osrsClient.idkTypeLoader,
                                            this.osrsClient.objTypeLoader,
                                            this.osrsClient.modelLoader,
                                            this.osrsClient.textureLoader,
                                        );
                                    }

                                    const wAny = params.widget as any;
                                    const keepEquipment =
                                        typeof wAny.playerModelKeepEquipment === "boolean"
                                            ? (wAny.playerModelKeepEquipment as boolean)
                                            : true;
                                    // OSRS parity: contentType=328 renders the local player model.
                                    // Prefer the ECS local-player appearance so server-driven updates
                                    // (PlayerDesign arrows) reflect immediately, even if the widget
                                    // has a stale `playerAppearance` snapshot.
                                    const localAppearance = (() => {
                                        const idx = this.osrsClient.playerEcs.getIndexForServerId(
                                            this.osrsClient.controlledPlayerServerId,
                                        );
                                        return idx !== undefined
                                            ? this.osrsClient.playerEcs.getAppearance(idx)
                                            : undefined;
                                    })();
                                    const appearanceSrc =
                                        ((params.widget as any).contentType | 0) === 328
                                            ? localAppearance || wAny.playerAppearance
                                            : wAny.playerAppearance || localAppearance;

                                    if (this.playerModelLoader2D && appearanceSrc) {
                                        const gender =
                                            typeof appearanceSrc.gender === "number"
                                                ? appearanceSrc.gender | 0
                                                : 0;
                                        const colors = Array.isArray(appearanceSrc.colors)
                                            ? appearanceSrc.colors
                                                  .slice(0, 5)
                                                  .map((n: any) =>
                                                      Number.isFinite(n) ? (n | 0) & 0xff : 0,
                                                  )
                                            : [0, 0, 0, 0, 0];
                                        const kits = Array.isArray(appearanceSrc.kits)
                                            ? appearanceSrc.kits
                                                  .slice(0, 7)
                                                  .map((n: any) =>
                                                      Number.isFinite(n) ? n | 0 : -1,
                                                  )
                                            : new Array(7).fill(-1);
                                        const equip = Array.isArray(appearanceSrc.equip)
                                            ? appearanceSrc.equip
                                                  .slice(0, 14)
                                                  .map((n: any) =>
                                                      Number.isFinite(n) ? n | 0 : -1,
                                                  )
                                            : new Array(14).fill(-1);
                                        if (!keepEquipment) {
                                            for (let i = 0; i < equip.length; i++) equip[i] = -1;
                                        }
                                        const pa = new PlayerAppearance(
                                            gender,
                                            colors,
                                            kits,
                                            equip,
                                        );

                                        // OSRS parity: contentType=328 uses KeyHandler.localPlayer.getModel().
                                        // Our ECS base-model pipeline applies additional alignment (to NPC "man")
                                        // which is correct for in-world rendering, but skews UI preview offsets.
                                        // For widget rendering, prefer the raw PlayerComposition model build.
                                        let model: any | undefined;
                                        if (this.playerModelLoader2D) {
                                            model =
                                                this.playerModelLoader2D.buildStaticModelFromEquipment(
                                                    pa,
                                                    pa.equip,
                                                );
                                        }
                                        if (model) {
                                            // OSRS parity: Widget type-6 models render into the *parent clip*,
                                            // not the widget bounds. This means player models can overflow the
                                            // widget rectangle (e.g., equipment/league summary) and still be visible.
                                            //
                                            // Render to tight extents and let the widget scissor stack (container clip)
                                            // match the client's behaviour.
                                            return this.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                model,
                                                params,
                                            );
                                        }
                                    }
                                }

                                if (
                                    params.widget.isNpcChathead &&
                                    typeof params.widget.npcTypeId === "number"
                                ) {
                                    if (!this.chatheadFactory) {
                                        this.chatheadFactory = new ChatheadFactory(
                                            this.osrsClient.modelLoader,
                                            this.osrsClient.textureLoader,
                                        );
                                    }
                                    const npcTypeId = params.widget.npcTypeId;
                                    const baseNpcType =
                                        this.osrsClient.npcTypeLoader.load(npcTypeId);
                                    const npcType =
                                        baseNpcType?.transform?.(
                                            this.osrsClient.varManager,
                                            this.osrsClient.npcTypeLoader,
                                        ) ?? baseNpcType;
                                    if (
                                        npcType &&
                                        npcType.chatheadModelIds &&
                                        npcType.chatheadModelIds.length > 0
                                    ) {
                                        const chatModel = this.chatheadFactory.get(npcType);
                                        if (chatModel) {
                                            return this.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                chatModel,
                                                params,
                                            );
                                        }
                                    }
                                } else if (params.widget.isPlayerChathead) {
                                    const haveLoaders =
                                        this.osrsClient.modelLoader &&
                                        this.osrsClient.textureLoader &&
                                        this.osrsClient.idkTypeLoader &&
                                        this.osrsClient.objTypeLoader;

                                    // Recreate factory if missing or if it was built before objTypeLoader was ready
                                    if (
                                        !this.playerChatheadFactory ||
                                        !(this.playerChatheadFactory as any)["objTypeLoader"]
                                    ) {
                                        if (haveLoaders) {
                                            this.playerChatheadFactory = new PlayerChatheadFactory(
                                                this.osrsClient.modelLoader,
                                                this.osrsClient.textureLoader,
                                                this.osrsClient.idkTypeLoader,
                                                this.osrsClient.objTypeLoader,
                                            );
                                        }
                                    }
                                    const appearance =
                                        params.widget.playerAppearance ||
                                        (() => {
                                            const idx =
                                                this.osrsClient.playerEcs.getIndexForServerId(
                                                    this.osrsClient.controlledPlayerServerId,
                                                );
                                            return idx !== undefined
                                                ? this.osrsClient.playerEcs.getAppearance(idx)
                                                : undefined;
                                        })();
                                    if (this.playerChatheadFactory && appearance) {
                                        const chatModel =
                                            this.playerChatheadFactory.get(appearance);
                                        if (chatModel) {
                                            return this.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                chatModel,
                                                params,
                                            );
                                        }
                                    }
                                }
                            }

                            if (modelId < 0) {
                                const widgetAny = params.widget as any;
                                const itemId = widgetAny?.itemId;
                                if (typeof itemId === "number" && itemId >= 0) {
                                    try {
                                        const qty = (widgetAny?.itemQuantity ?? 0) | 0 || 1;
                                        return this.model2DRenderer.renderItemToCanvasExtents(
                                            itemId | 0,
                                            qty,
                                            params,
                                            width,
                                            height,
                                        );
                                    } catch {}
                                }
                                return undefined;
                            }

                            return this.model2DRenderer.renderToCanvasExtents(
                                modelId,
                                params,
                                width,
                                height,
                            );
                        },
                });
                this.widgetsOverlay = widgets;
                this.overlayManager.add(widgets);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    widgets.init({ app: this.app, sceneUniforms: this.sceneUniformBuffer });
                } catch {}
                console.log(
                    "WebGLOsrsClientRenderer: WidgetsOverlay initialized and added to overlay manager",
                );
            }
        } catch (e) {
            console.error("Failed to initialize WidgetsOverlay:", e);
        }

        return programs;
    }

    // ===== Dynamic Player Animation Helpers =====
    private _resolvePlayerSeqIdForMode(): number {
        try {
            const ecsIndex = this.osrsClient.playerEcs.getIndexForServerId(
                this.osrsClient.controlledPlayerServerId,
            );
            if (ecsIndex === undefined) return -1;
            if (this.osrsClient.playerEcs.size() <= ecsIndex) return -1;
            if (this.playerIdleSeqId >= 0) {
                return this.playerIdleSeqId | 0;
            }

            const pe: any = this.osrsClient.playerEcs as any;
            const animSeq = (key: PlayerAnimKey): number => {
                const specific = pe.getAnimSeq?.(ecsIndex, key);
                if (typeof specific === "number" && specific >= 0) return specific | 0;
                const global = this.osrsClient.serverPlayerSeqs?.[key];
                return typeof global === "number" && global >= 0 ? global | 0 : -1;
            };
            const pick = (...candidates: Array<number | undefined>): number => {
                for (const c of candidates) {
                    if (typeof c === "number" && c >= 0) return c | 0;
                }
                return -1;
            };
            const rotBase = pe.getRotation?.(ecsIndex);
            const rotFallback = rotBase ?? pe.rotation?.[ecsIndex];
            const rot: number = ((rotFallback ?? 0) as number) | 0;

            const resolveFromAnimSet = (): number => {
                // Movement blocking is handled in `PlayerEcs` (OSRS parity). This resolver is mode-only.
                if (this.playerAnimMode === "idle") {
                    const desired =
                        (pe.getTargetRotation?.(ecsIndex) ?? pe.targetRot?.[ecsIndex] ?? rot) | 0;
                    const delta = (desired - rot) & 2047;
                    if (delta !== 0) {
                        // OSRS turn animation delay: only play turn animation after 25 ticks of continuous rotation
                        // Reference: player-animation.md lines 474-475 (field1240 > 0 && field1239 > 25)
                        const rotationCounter = (pe.getRotationCounter?.(ecsIndex) ?? 0) | 0;
                        const rotationSpeed = (pe.getRotationSpeed?.(ecsIndex) ?? 32) | 0;
                        const shouldPlayTurnAnim = rotationCounter >= 25 && rotationSpeed > 0;

                        if (shouldPlayTurnAnim) {
                            const turnSeq = pick(
                                delta > 1024 ? animSeq("turnLeft") : animSeq("turnRight"),
                                delta > 1024 ? animSeq("turnRight") : animSeq("turnLeft"),
                            );
                            if (turnSeq >= 0) return turnSeq;
                        }
                    }
                    const idleSeq = animSeq("idle");
                    if (idleSeq >= 0) return idleSeq;
                    return -1;
                }

                const cx: number = (pe.getX?.(ecsIndex) ?? 0) | 0;
                const cy: number = (pe.getY?.(ecsIndex) ?? 0) | 0;
                const tx: number = (pe.getTargetX?.(ecsIndex) ?? cx) | 0;
                const ty: number = (pe.getTargetY?.(ecsIndex) ?? cy) | 0;
                let moveOri = rot | 0;
                if (cx < tx) {
                    if (cy < ty) moveOri = 1280;
                    else if (cy > ty) moveOri = 1792;
                    else moveOri = 1536;
                } else if (cx > tx) {
                    if (cy < ty) moveOri = 768;
                    else if (cy > ty) moveOri = 256;
                    else moveOri = 512;
                } else if (cy < ty) moveOri = 1024;
                else if (cy > ty) moveOri = 0;
                let delta = (moveOri - rot) & 2047;
                if (delta > 1024) delta -= 2048;
                const margin = 64;
                const straight = delta >= -256 - margin && delta <= 256 + margin;
                const right = delta >= 256 + margin && delta < 768 - margin;
                const left = delta <= -256 - margin && delta > -768 + margin;

                if (this.playerAnimMode === "run") {
                    return pick(
                        straight ? pick(animSeq("run"), animSeq("walk")) : undefined,
                        right
                            ? pick(
                                  animSeq("runRight"),
                                  animSeq("run"),
                                  animSeq("walkRight"),
                                  animSeq("walk"),
                              )
                            : undefined,
                        left
                            ? pick(
                                  animSeq("runLeft"),
                                  animSeq("run"),
                                  animSeq("walkLeft"),
                                  animSeq("walk"),
                              )
                            : undefined,
                        !straight && !right && !left
                            ? pick(
                                  animSeq("runBack"),
                                  animSeq("run"),
                                  animSeq("walkBack"),
                                  animSeq("walk"),
                              )
                            : undefined,
                    );
                }

                // OSRS crawl animation selection (speed <= 2)
                // Reference: player-animation.md lines 387-398
                if (this.playerAnimMode === "crawl") {
                    return pick(
                        straight ? pick(animSeq("crawl"), animSeq("walk")) : undefined,
                        right
                            ? pick(
                                  animSeq("crawlRight"),
                                  animSeq("crawl"),
                                  animSeq("walkRight"),
                                  animSeq("walk"),
                              )
                            : undefined,
                        left
                            ? pick(
                                  animSeq("crawlLeft"),
                                  animSeq("crawl"),
                                  animSeq("walkLeft"),
                                  animSeq("walk"),
                              )
                            : undefined,
                        !straight && !right && !left
                            ? pick(
                                  animSeq("crawlBack"),
                                  animSeq("crawl"),
                                  animSeq("walkBack"),
                                  animSeq("walk"),
                              )
                            : undefined,
                    );
                }

                return pick(
                    straight ? pick(animSeq("walk"), animSeq("run")) : undefined,
                    right
                        ? pick(
                              animSeq("walkRight"),
                              animSeq("walk"),
                              animSeq("runRight"),
                              animSeq("run"),
                          )
                        : undefined,
                    left
                        ? pick(
                              animSeq("walkLeft"),
                              animSeq("walk"),
                              animSeq("runLeft"),
                              animSeq("run"),
                          )
                        : undefined,
                    !straight && !right && !left
                        ? pick(
                              animSeq("walkBack"),
                              animSeq("walk"),
                              animSeq("runBack"),
                              animSeq("run"),
                          )
                        : undefined,
                );
            };

            try {
                const seqFromAnim = resolveFromAnimSet();
                if (seqFromAnim >= 0) return seqFromAnim;
            } catch {}
            try {
                const seqs = this.osrsClient.serverPlayerSeqs;
                if (seqs) {
                    // If idle but rotating, use turn sequences if provided
                    if (this.playerAnimMode === "idle") {
                        try {
                            const pe: any = this.osrsClient.playerEcs as any;
                            const rot: number =
                                (pe.getRotation?.(ecsIndex) ?? pe.rotation?.[ecsIndex] ?? 0) | 0;
                            const desired: number =
                                (pe.getTargetRotation?.(ecsIndex) ??
                                    pe.targetRot?.[ecsIndex] ??
                                    rot) | 0;
                            let delta = (desired - rot) & 2047;
                            if (delta !== 0 && typeof seqs.turnLeft === "number") {
                                const isRight = delta < 1024 && delta > 0;
                                const isLeft = !isRight;
                                if (isLeft && typeof seqs.turnLeft === "number")
                                    return seqs.turnLeft | 0;
                                if (isRight && typeof seqs.turnRight === "number")
                                    return (seqs.turnRight ?? seqs.turnLeft)! | 0;
                            }
                        } catch {}
                        if (typeof seqs.idle === "number") return seqs.idle | 0;
                    }
                    // Moving: prefer directional sequences when provided
                    try {
                        const pe: any = this.osrsClient.playerEcs as any;
                        const rot: number =
                            (pe.getRotation?.(ecsIndex) ?? pe.rotation?.[ecsIndex] ?? 0) | 0;
                        // Compute movement orientation from current position toward target step
                        const cx: number = (pe.getX?.(ecsIndex) ?? 0) | 0;
                        const cy: number = (pe.getY?.(ecsIndex) ?? 0) | 0;
                        const tx: number = (pe.getTargetX?.(ecsIndex) ?? cx) | 0;
                        const ty: number = (pe.getTargetY?.(ecsIndex) ?? cy) | 0;
                        let moveOri = rot | 0;
                        if (cx < tx) {
                            if (cy < ty) moveOri = 1280;
                            else if (cy > ty) moveOri = 1792;
                            else moveOri = 1536;
                        } else if (cx > tx) {
                            if (cy < ty) moveOri = 768;
                            else if (cy > ty) moveOri = 256;
                            else moveOri = 512;
                        } else if (cy < ty) moveOri = 1024;
                        else if (cy > ty) moveOri = 0;
                        // Direction classification with small hysteresis to reduce flicker
                        let delta = (moveOri - rot) & 2047;
                        if (delta > 1024) delta -= 2048; // [-1024,1024]
                        const margin = 64; // hysteresis margin in RS angle units
                        const straight = delta >= -256 - margin && delta <= 256 + margin;
                        const right = delta >= 256 + margin && delta < 768 - margin;
                        const left = delta <= -256 - margin && delta > -768 + margin;
                        const useRun = this.playerAnimMode === "run";
                        if (useRun) {
                            if (straight && typeof seqs.run === "number") return seqs.run | 0;
                            if (right && typeof seqs.runRight === "number")
                                return seqs.runRight | 0;
                            if (left && typeof seqs.runLeft === "number") return seqs.runLeft | 0;
                            if (typeof seqs.runBack === "number") return seqs.runBack | 0;
                        } else {
                            if (straight && typeof seqs.walk === "number") return seqs.walk | 0;
                            if (right && typeof seqs.walkRight === "number")
                                return seqs.walkRight | 0;
                            if (left && typeof seqs.walkLeft === "number") return seqs.walkLeft | 0;
                            if (typeof seqs.walkBack === "number") return seqs.walkBack | 0;
                        }
                    } catch {}
                }
            } catch {}
            try {
                const npcTypeLoader = this.osrsClient.npcTypeLoader;
                let manId = -1;
                const ncount = npcTypeLoader.getCount();
                for (let id = 0; id < ncount; id++) {
                    const t: any = npcTypeLoader.load(id);
                    if (t && typeof t.name === "string" && t.name.toLowerCase() === "man") {
                        manId = id;
                        break;
                    }
                }
                if (manId !== -1) {
                    const manType: any = npcTypeLoader.load(manId);
                    // Prefer directional sequences based on rotation delta (like deob NPC movement logic)
                    try {
                        const pe: any = this.osrsClient.playerEcs as any;
                        const has0 = (pe.size?.() ?? (pe as any).size?.() ?? 0) > 0;
                        if (has0) {
                            const rot: number =
                                (pe.getRotation?.(ecsIndex) ?? pe.rotation?.[ecsIndex] ?? 0) | 0;
                            // Movement orientation from step target vs current rotation
                            const cx: number = (pe.getX?.(ecsIndex) ?? 0) | 0;
                            const cy: number = (pe.getY?.(ecsIndex) ?? 0) | 0;
                            const tx: number = (pe.getTargetX?.(ecsIndex) ?? cx) | 0;
                            const ty: number = (pe.getTargetY?.(ecsIndex) ?? cy) | 0;
                            let moveOri = rot | 0;
                            if (cx < tx) {
                                if (cy < ty) moveOri = 1280;
                                else if (cy > ty) moveOri = 1792;
                                else moveOri = 1536;
                            } else if (cx > tx) {
                                if (cy < ty) moveOri = 768;
                                else if (cy > ty) moveOri = 256;
                                else moveOri = 512;
                            } else if (cy < ty) moveOri = 1024;
                            else if (cy > ty) moveOri = 0;
                            let delta = (moveOri - rot) & 2047;
                            if (delta > 1024) delta -= 2048; // [-1024,1024]
                            const margin = 64;
                            const useRun = this.playerAnimMode === "run";
                            const straight = delta >= -256 - margin && delta <= 256 + margin;
                            const right = delta >= 256 + margin && delta < 768 - margin;
                            const left = delta <= -256 - margin && delta > -768 + margin;
                            if (straight) {
                                const seq = useRun ? manType.runSeqId : manType.walkSeqId;
                                if (typeof seq === "number" && seq >= 0) return seq | 0;
                            } else if (right) {
                                const seq = useRun ? manType.runRightSeqId : manType.walkRightSeqId;
                                if (typeof seq === "number" && seq >= 0) return seq | 0;
                            } else if (left) {
                                const seq = useRun ? manType.runLeftSeqId : manType.walkLeftSeqId;
                                if (typeof seq === "number" && seq >= 0) return seq | 0;
                            } else {
                                const seq = useRun ? manType.runBackSeqId : manType.walkBackSeqId;
                                if (typeof seq === "number" && seq >= 0) return seq | 0;
                            }
                            // If idle but turning in place, prefer turn sequences where possible
                            if (!useRun) {
                                const desiredIdle = ((pe.getTargetRotation?.(ecsIndex) ??
                                    pe.targetRot?.[ecsIndex] ??
                                    rot) | 0) as number;
                                const deltaRaw = (desiredIdle - rot) & 2047;
                                if (deltaRaw !== 0) {
                                    const turnSeq =
                                        deltaRaw > 1024
                                            ? manType.turnLeftSeqId
                                            : manType.turnRightSeqId;
                                    if (typeof turnSeq === "number" && turnSeq >= 0)
                                        return turnSeq | 0;
                                }
                            }
                        }
                    } catch {}
                    if (this.playerAnimMode === "run") {
                        const runSeq = (manType as any).runSeqId ?? -1;
                        if (runSeq !== -1) return runSeq | 0;
                    }
                    if (this.playerAnimMode !== "idle") {
                        const walkSeq =
                            (manType as any).walkSeqId ??
                            manType.getWalkSeqId?.(this.osrsClient.basTypeLoader);
                        if (typeof walkSeq === "number" && walkSeq !== -1) return walkSeq | 0;
                    }
                    const idleSeq = manType.getIdleSeqId(this.osrsClient.basTypeLoader);
                    if (idleSeq !== -1) return idleSeq | 0;
                }
            } catch {}
        } catch {}
        return -1;
    }

    // Delegated to PlayerRenderer - kept for backwards compatibility
    private _buildAnimClipMeta(seqId: number): ActorAnimationClip | undefined {
        return this.playerRenderer.buildAnimClipMeta(seqId);
    }

    private _resolveNpcAnimation(
        map: WebGLMapSquare,
        npcIndex: number,
        ecs: NpcEcs,
        ecsId: number,
    ): AnimationFrames {
        const extraAnimMap = map.npcExtraAnims?.[npcIndex];
        const seqId = ecs.getSeqId(ecsId) | 0;
        const seqDelay = ecs.getSeqDelay?.(ecsId) | 0;
        if (seqId >= 0 && seqDelay === 0) {
            const extraAnim = extraAnimMap?.[seqId];
            if (extraAnim) {
                return extraAnim;
            }
        }
        const movementSeqId = this.resolveNpcMovementSequenceIds(ecs, ecsId).movementSeqId | 0;
        if (movementSeqId >= 0) {
            const extraMovementAnim = extraAnimMap?.[movementSeqId];
            if (extraMovementAnim) {
                return extraMovementAnim;
            }
        }
        const useWalk = ecs.isWalking(ecsId);
        return ((useWalk ? map.npcWalkFrames[npcIndex] : undefined) ??
            map.npcIdleFrames[npcIndex]) as AnimationFrames;
    }

    private resolveNpcMovementSequenceIds(
        ecs: NpcEcs,
        ecsId: number,
    ): { movementSeqId: number; idleSeqId: number; walkSeqId: number } {
        let movementSeqId = -1;
        let idleSeqId = -1;
        let walkSeqId = -1;
        const npcTypeId = ecs.getNpcTypeId?.(ecsId);
        if (typeof npcTypeId !== "number" || npcTypeId < 0) {
            return { movementSeqId, idleSeqId, walkSeqId };
        }

        try {
            const npcType = this.osrsClient.npcTypeLoader.load(npcTypeId | 0);
            if (!npcType) {
                return { movementSeqId, idleSeqId, walkSeqId };
            }

            const movementSet = npcType.getMovementSeqSet(this.osrsClient.basTypeLoader);
            idleSeqId = movementSet.idle | 0;
            walkSeqId = movementSet.walk | 0;
            const pathLength = ecs.getPathLengthLike?.(ecsId) | 0;
            if (pathLength <= 0) {
                movementSeqId = idleSeqId;
                return { movementSeqId, idleSeqId, walkSeqId };
            }

            const movementOrientation = ecs.getCurrentStepRot(ecsId);
            if (movementOrientation === undefined) {
                movementSeqId = walkSeqId >= 0 ? walkSeqId : idleSeqId;
                return { movementSeqId, idleSeqId, walkSeqId };
            }

            let yaw = ((movementOrientation | 0) - (ecs.getRotation(ecsId) | 0)) & 2047;
            if (yaw > 1024) yaw -= 2048;

            let nextSeq = movementSet.walkBack | 0;
            if (yaw >= -256 && yaw <= 256) nextSeq = movementSet.walk | 0;
            else if (yaw >= 256 && yaw < 768) nextSeq = movementSet.walkRight | 0;
            else if (yaw >= -768 && yaw <= -256) nextSeq = movementSet.walkLeft | 0;
            if (nextSeq === -1) {
                nextSeq = movementSet.walk | 0;
            }

            let speed = 4;
            if (!!npcType.isClipped) {
                if (
                    (movementOrientation | 0) !== (ecs.getRotation(ecsId) | 0) &&
                    (ecs.getInteractionIndex?.(ecsId) | 0) < 0 &&
                    (ecs.getRotationSpeed(ecsId) | 0) !== 0
                ) {
                    speed = 2;
                }
                if (pathLength > 2) speed = 6;
                if (pathLength > 3) speed = 8;
                if ((ecs.getMovementDelayCounter?.(ecsId) | 0) > 0 && pathLength > 1) {
                    speed = 8;
                }
            } else {
                if (pathLength > 1) speed = 6;
                if (pathLength > 2) speed = 8;
                if ((ecs.getMovementDelayCounter?.(ecsId) | 0) > 0 && pathLength > 1) {
                    speed = 8;
                }
            }

            const rawTraversal = ecs.getCurrentStepSpeed(ecsId) | 0;
            if (rawTraversal >= 8) speed <<= 1;
            else if (rawTraversal <= 2) speed >>= 1;

            if (speed >= 8) {
                if (nextSeq === (movementSet.walk | 0) && (movementSet.run | 0) !== -1) {
                    nextSeq = movementSet.run | 0;
                } else if (
                    nextSeq === (movementSet.walkBack | 0) &&
                    (movementSet.runBack | 0) !== -1
                ) {
                    nextSeq = movementSet.runBack | 0;
                } else if (
                    nextSeq === (movementSet.walkLeft | 0) &&
                    (movementSet.runLeft | 0) !== -1
                ) {
                    nextSeq = movementSet.runLeft | 0;
                } else if (
                    nextSeq === (movementSet.walkRight | 0) &&
                    (movementSet.runRight | 0) !== -1
                ) {
                    nextSeq = movementSet.runRight | 0;
                }
            } else if (speed <= 2) {
                if (nextSeq === (movementSet.walk | 0) && (movementSet.crawl | 0) !== -1) {
                    nextSeq = movementSet.crawl | 0;
                } else if (
                    nextSeq === (movementSet.walkBack | 0) &&
                    (movementSet.crawlBack | 0) !== -1
                ) {
                    nextSeq = movementSet.crawlBack | 0;
                } else if (
                    nextSeq === (movementSet.walkLeft | 0) &&
                    (movementSet.crawlLeft | 0) !== -1
                ) {
                    nextSeq = movementSet.crawlLeft | 0;
                } else if (
                    nextSeq === (movementSet.walkRight | 0) &&
                    (movementSet.crawlRight | 0) !== -1
                ) {
                    nextSeq = movementSet.crawlRight | 0;
                }
            }

            movementSeqId = nextSeq | 0;
            if (movementSeqId < 0) {
                movementSeqId = walkSeqId >= 0 ? walkSeqId : idleSeqId;
            }
        } catch {}

        return { movementSeqId, idleSeqId, walkSeqId };
    }

    private shouldLayerNpcMovementSequence(
        actionSeqId: number,
        movementSeqId: number,
        idleSeqId: number,
    ): boolean {
        if (
            (actionSeqId | 0) < 0 ||
            (movementSeqId | 0) < 0 ||
            (movementSeqId | 0) === (idleSeqId | 0)
        ) {
            return false;
        }

        try {
            const seqType = this.osrsClient.seqTypeLoader.load(actionSeqId | 0) as any;
            if (seqType?.isSkeletalSeq?.()) {
                return Array.isArray(seqType.skeletalMasks);
            }
            return Array.isArray(seqType?.masks) && seqType.masks.length > 0;
        } catch {
            return false;
        }
    }

    private stepNpcSequenceTrack(
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
        let fi = Math.max(0, frameIndex | 0);
        let tick = Math.max(0, animTick | 0);
        let loops = Math.max(0, loopCount | 0);
        const safeFrameCount = Math.max(1, frameCount | 0);
        let frameAdvanced = false;
        let cleared = false;

        if (fi >= safeFrameCount) {
            fi = 0;
        }

        if (!seqType) {
            const currLen = ((lengths ? lengths[fi] : 0) ?? 0) | 0;
            tick = (tick + 1) | 0;
            if (tick > currLen) {
                tick = 1;
                fi++;
                frameAdvanced = true;
            }
            if (fi >= safeFrameCount) {
                if (clearOnFinish) {
                    cleared = true;
                } else {
                    fi = 0;
                    tick = 0;
                    loops = 0;
                }
            }
            return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
        }

        if (!!seqType?.isSkeletalSeq?.() || (seqType?.skeletalId ?? -1) >= 0) {
            const frameStep = (seqType.frameStep ?? -1) | 0;
            const maxLoops = (seqType.maxLoops ?? 0) | 0;

            fi++;
            tick = 0;
            frameAdvanced = true;

            if (fi >= safeFrameCount) {
                if (frameStep > 0) {
                    fi -= frameStep;
                    if (clearOnFinish) {
                        loops++;
                        cleared = loops >= maxLoops || fi < 0 || fi >= safeFrameCount;
                    } else {
                        const looping = !!seqType.looping;
                        if (looping) loops++;
                        if (fi < 0 || fi >= safeFrameCount || (looping && loops >= maxLoops)) {
                            fi = 0;
                            tick = 0;
                            loops = 0;
                        }
                    }
                } else if (clearOnFinish) {
                    cleared = true;
                } else {
                    fi = 0;
                    tick = 0;
                    loops = 0;
                }
            }

            return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
        }

        const frameStep = (seqType.frameStep ?? -1) | 0;
        const maxLoops = (seqType.maxLoops ?? 0) | 0;
        tick = (tick + 1) | 0;
        const safeFrameIndex = lengths ? Math.min(fi, Math.max(0, lengths.length - 1)) : fi;
        const currLen = ((lengths ? lengths[safeFrameIndex] : 0) ?? 0) | 0;
        if (tick > currLen) {
            tick = 1;
            fi++;
            frameAdvanced = true;
        }

        if (fi >= safeFrameCount) {
            if (frameStep > 0) {
                fi -= frameStep;
                if (clearOnFinish) {
                    loops++;
                    cleared = loops >= maxLoops || fi < 0 || fi >= safeFrameCount;
                } else {
                    const looping = !!seqType.looping;
                    if (looping) loops++;
                    if (fi < 0 || fi >= safeFrameCount || (looping && loops >= maxLoops)) {
                        fi = 0;
                        tick = 0;
                        loops = 0;
                    }
                }
            } else if (clearOnFinish) {
                cleared = true;
            } else {
                fi = 0;
                tick = 0;
                loops = 0;
            }
        }

        return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
    }

    /**
     * Resolve dynamic sequence metadata for an NPC.
     * Dynamic NPC sequences are rendered from current-frame scratch geometry rather
     * than cached `AnimationFrames`.
     */
    private ensureNpcDynamicSequenceMeta(
        map: WebGLMapSquare,
        npcIndex: number,
        npcTypeId: number,
        seqId: number,
        forceDynamic: boolean = false,
    ): DynamicNpcSequenceMeta | undefined {
        const extraAnims = map.npcExtraAnims?.[npcIndex];
        if (!forceDynamic && extraAnims?.[seqId]) {
            return undefined;
        }

        if (!this.dynamicNpcAnimLoader?.isReady()) {
            return undefined;
        }

        const meta = this.dynamicNpcAnimLoader.getSequenceMeta(npcTypeId, seqId);
        if (!meta) {
            return undefined;
        }

        if (!map.npcExtraFrameLengths) {
            map.npcExtraFrameLengths = [];
        }
        const extraLengths = map.npcExtraFrameLengths[npcIndex] ?? {};
        extraLengths[seqId] = meta.frameLengths;
        map.npcExtraFrameLengths[npcIndex] = extraLengths;

        return meta;
    }

    /**
     * Upload current dynamic NPC frame geometry to the shared scratch GPU buffers.
     */
    private uploadDynamicNpcGeometry(
        geometry: DynamicNpcFrameGeometry,
        transparent: boolean,
    ): number {
        if (!this.npcProgram) return 0;

        const vertices = transparent ? geometry.alphaVertices : geometry.opaqueVertices;
        const indices = transparent ? geometry.alphaIndices : geometry.opaqueIndices;
        if (!vertices || !indices || vertices.length === 0 || indices.length === 0) return 0;

        const uploadKey = `${geometry.key}:${transparent ? "alpha" : "opaque"}`;

        const needsRecreate =
            !this.dynamicNpcInterleavedBuffer ||
            vertices.length > (this.dynamicNpcBufferVertexSize ?? 0) ||
            indices.length > (this.dynamicNpcBufferIndexSize ?? 0);

        if (needsRecreate) {
            if (this.dynamicNpcInterleavedBuffer) {
                this.dynamicNpcInterleavedBuffer.delete();
                this.dynamicNpcIndexBuffer?.delete();
                this.dynamicNpcVertexArray?.delete();
                this.dynamicNpcDrawCall = undefined;
            }

            this.dynamicNpcInterleavedBuffer = this.app.createInterleavedBuffer(12, vertices);
            this.dynamicNpcIndexBuffer = this.app.createIndexBuffer(PicoGL.UNSIGNED_INT, indices);
            this.dynamicNpcBufferVertexSize = vertices.length;
            this.dynamicNpcBufferIndexSize = indices.length;
            this.dynamicNpcUploadedGeometryKey = undefined;

            this.dynamicNpcVertexArray = this.app
                .createVertexArray()
                .vertexAttributeBuffer(0, this.dynamicNpcInterleavedBuffer, {
                    type: PicoGL.UNSIGNED_INT,
                    size: 3,
                    stride: 12,
                    integer: true as any,
                })
                .indexBuffer(this.dynamicNpcIndexBuffer);

            if (this.dynamicNpcVertexArray && this.sceneUniformBuffer) {
                this.dynamicNpcDrawCall = this.configureDrawCall(
                    this.app
                        .createDrawCall(this.npcProgram, this.dynamicNpcVertexArray)
                        .uniformBlock("SceneUniforms", this.sceneUniformBuffer)
                        .drawRanges(this.dynamicNpcSingleDrawRange),
                );
                if (this.textureArray) {
                    this.dynamicNpcDrawCall.texture("u_textures", this.textureArray);
                }
                if (this.textureMaterials) {
                    this.dynamicNpcDrawCall.texture("u_textureMaterials", this.textureMaterials);
                }
            }
        }

        if (this.dynamicNpcUploadedGeometryKey !== uploadKey) {
            (this.dynamicNpcInterleavedBuffer as any).data(vertices);
            (this.dynamicNpcIndexBuffer as any).data(indices);
            this.dynamicNpcUploadedGeometryKey = uploadKey;
        }

        return indices.length;
    }

    initFramebuffers(): void {
        this.initFramebuffer();
        this.initTextureFramebuffer();
    }

    initFramebuffer(): void {
        this.framebuffer?.delete();
        this.colorTarget?.delete();
        this.depthTarget?.delete();

        const sceneSize = this.getSceneRenderSize();
        this.sceneRenderWidth = sceneSize.width | 0;
        this.sceneRenderHeight = sceneSize.height | 0;

        let samples = 0;
        if (this.msaaEnabled) {
            samples = this.gl.getParameter(PicoGL.MAX_SAMPLES);
        }

        this.colorTarget = this.app.createRenderbuffer(
            this.sceneRenderWidth,
            this.sceneRenderHeight,
            PicoGL.RGBA8,
            samples,
        );
        this.depthTarget = this.app.createRenderbuffer(
            this.sceneRenderWidth,
            this.sceneRenderHeight,
            PicoGL.DEPTH_COMPONENT24,
            samples,
        );
        this.framebuffer = this.app
            .createFramebuffer()
            .colorTarget(0, this.colorTarget)
            .depthTarget(this.depthTarget);

        this.needsFramebufferUpdate = false;
    }

    private initTextureFramebuffer(width: number = this.app.width, height: number = this.app.height): void {
        this.textureFramebuffer?.delete();
        this.textureColorTarget?.delete();
        this.textureDepthTarget?.delete();
        this.textureColorTarget = this.app.createTexture2D(width, height, {
            minFilter: PicoGL.LINEAR,
            magFilter: PicoGL.LINEAR,
        });
        this.textureDepthTarget = this.app.createRenderbuffer(
            width,
            height,
            PicoGL.DEPTH_COMPONENT24,
            0,
        );
        this.textureFramebuffer = this.app
            .createFramebuffer()
            .colorTarget(0, this.textureColorTarget)
            .depthTarget(this.textureDepthTarget);
    }

    override initCache(): void {
        super.initCache();
        if (this.app) {
            this.initTextures();
            // Re-initialize player geometry now that textures are loaded
            // (initial attempt in init() fails because textures aren't ready yet)
            this.playerRenderer.initGeometry().catch((e) => {
                console.warn("Failed to reinit player geometry after initCache", e);
            });

            // Re-initialize DynamicNpcAnimLoader now that loaders are ready
            // (initial attempt in init() fails because loaders aren't set up yet)
            this.initDynamicNpcAnimLoader();
        }
    }

    /**
     * Initialize overlay assets from the cache.
     * Called during phased loading after cache is fully available.
     * Overlays are created during shader setup but can't load cache assets
     * until the cache is ready, so this re-initializes them.
     */
    initOverlays(): void {
        if (!this.app || !this.sceneUniformBuffer) return;
        const initArgs = { app: this.app, sceneUniforms: this.sceneUniformBuffer };
        try {
            this.hitsplatOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init hitsplat overlay", e);
        }
        try {
            this.healthBarOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init health bar overlay", e);
        }
        try {
            this.overheadTextOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init overhead text overlay", e);
        }
        try {
            this.overheadPrayerOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init overhead prayer overlay", e);
        }
        try {
            this.clickCrossOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init click cross overlay", e);
        }
        try {
            this.tileTextOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init tile text overlay", e);
        }
        try {
            this.groundItemOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init ground item overlay", e);
        }
        try {
            this.interactHighlightOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init interact highlight overlay", e);
        }
        try {
            this.objectIdOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init object id overlay", e);
        }
        try {
            this.widgetsOverlay?.init(initArgs);
        } catch (e) {
            console.warn("Failed to init widgets overlay", e);
        }
        // Initialize ItemIconRenderer if loaders are now available
        try {
            const objLoader = this.osrsClient.objTypeLoader;
            const modelLoader = this.osrsClient.modelLoader;
            const textureLoader = this.osrsClient.textureLoader;
            if (objLoader && modelLoader && textureLoader && !this.itemIconRenderer) {
                import("../../ui/item/ItemIconRenderer").then(({ ItemIconRenderer }) => {
                    if (!this.itemIconRenderer) {
                        this.itemIconRenderer = new ItemIconRenderer(
                            objLoader,
                            modelLoader,
                            textureLoader,
                            this.osrsClient.cacheSystem,
                        );
                    }
                });
            }
        } catch (e) {
            console.warn("Failed to init item icon renderer", e);
        }
    }

    initTextures(): void {
        const textureLoader = this.osrsClient.textureLoader;
        if (!textureLoader) return;

        const allTextureIds = textureLoader.getTextureIds();

        this.textureIds = allTextureIds
            .filter((id) => textureLoader.isSd(id))
            .slice(0, MAX_TEXTURES - 1);

        this.textureIdIndexMap.clear();
        this.textureFrameCounts.clear();
        for (let i = 0; i < this.textureIds.length; i++) {
            const id = this.textureIds[i];
            this.textureIdIndexMap.set(id, i + 1);
            this.textureFrameCounts.set(id, 1);
        }
        this.textureLayerCount = this.textureIds.length + 1;

        this.initTextureArray();
        this.initMaterialsTexture();

        // console.log("init textures", this.textureIds, allTextureIds.length);
    }

    initTextureArray() {
        if (this.textureArray) {
            this.textureArray.delete();
            this.textureArray = undefined;
        }
        this.loadedTextureIds.clear();
        this.textureLayerCount = this.textureIds.length + 1;

        console.time("load textures");

        const pixelCount = TEXTURE_SIZE * TEXTURE_SIZE;

        const textureCount = this.textureIds.length;
        const pixels = new Int32Array(this.textureLayerCount * pixelCount);

        // Initialize ALL layers to white so missing textures don't render black
        // Layer 0 remains white (non-textured faces sample this)
        pixels.fill(0xffffffff);

        const cacheInfo = this.osrsClient.loadedCache?.info;
        if (!cacheInfo) return;

        let maxPreloadTextures = textureCount;
        // we should check if the texture loader is procedural instead
        if (cacheInfo.game === "runescape" && cacheInfo.revision >= 508) {
            maxPreloadTextures = 64;
        }

        for (let i = 0; i < Math.min(textureCount, maxPreloadTextures); i++) {
            const textureId = this.textureIds[i];
            try {
                const texturePixels = this.osrsClient.textureLoader.getPixelsArgb(
                    textureId,
                    TEXTURE_SIZE,
                    true,
                    1.0,
                );
                pixels.set(texturePixels, (i + 1) * pixelCount);
            } catch (e) {
                console.error("Failed loading texture", textureId, e);
            }
            this.loadedTextureIds.add(textureId);
        }

        this.textureArray = createTextureArray(
            this.app,
            new Uint8Array(pixels.buffer),
            TEXTURE_SIZE,
            TEXTURE_SIZE,
            textureCount + 1,
            {},
        );

        this.updateTextureFiltering();

        console.timeEnd("load textures");
    }

    updateTextureFiltering(): void {
        if (!this.textureArray) {
            throw new Error("Texture array is not initialized");
        }

        this.textureArray.bind(0);

        if (this.textureFilterMode === TextureFilterMode.DISABLED) {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.NEAREST,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.NEAREST,
            );
        } else if (this.textureFilterMode === TextureFilterMode.BILINEAR) {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.LINEAR_MIPMAP_NEAREST,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.LINEAR,
            );
        } else {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.LINEAR_MIPMAP_LINEAR,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.LINEAR,
            );
        }

        const maxAnisotropy = Math.min(
            getMaxAnisotropy(this.textureFilterMode),
            PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY,
        );

        this.gl.texParameteri(
            PicoGL.TEXTURE_2D_ARRAY,
            PicoGL.TEXTURE_MAX_ANISOTROPY_EXT,
            maxAnisotropy,
        );
    }

    updateTextureArray(textures: Map<number, Int32Array>): void {
        if (!this.textureArray) {
            throw new Error("Texture array is not initialized");
        }
        let updatedCount = 0;
        this.textureArray.bind(0);
        for (const [id, pixels] of textures) {
            if (this.loadedTextureIds.has(id)) {
                continue;
            }
            const index = this.textureIdIndexMap.get(id) ?? 0;
            if (index <= 0) {
                // Unknown texture id for this array; skip to avoid overwriting the base white layer
                continue;
            }

            this.gl.texSubImage3D(
                PicoGL.TEXTURE_2D_ARRAY,
                0,
                0,
                0,
                index,
                TEXTURE_SIZE,
                TEXTURE_SIZE,
                1,
                PicoGL.RGBA,
                PicoGL.UNSIGNED_BYTE,
                new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
            );
            this.loadedTextureIds.add(id);
            updatedCount++;
        }
        if (updatedCount > 0) {
            // Mipmap generation for a large TEXTURE_2D_ARRAY is expensive and can stall hard.
            // Defer it and amortize across frames while maps are streaming in.
            const now = performance.now();
            this.textureMipmapsDirty = true;
            this.textureMipmapsDirtyAtMs = now;
            this.textureMipmapsDirtyUpdates += updatedCount;
        }
    }

    private maybeRegenerateTextureMipmaps(nowMs: number): void {
        if (!this.textureMipmapsDirty || !this.textureArray) return;
        if (this.textureFilterMode === TextureFilterMode.DISABLED) {
            // No mipmaps required for nearest sampling.
            this.textureMipmapsDirty = false;
            this.textureMipmapsDirtyUpdates = 0;
            return;
        }

        // Only regenerate when texture streaming settles a bit, or periodically if it never fully settles.
        const quietForMs = nowMs - this.textureMipmapsDirtyAtMs;
        const sinceLastGenMs = nowMs - this.textureMipmapsLastGenAtMs;
        const shouldGen =
            (quietForMs > 250 && !this.hasPendingMapStreamingWork()) ||
            (sinceLastGenMs > 750 && this.textureMipmapsDirtyUpdates >= 8);

        if (!shouldGen) return;

        try {
            this.textureArray.bind(0);
            this.gl.generateMipmap(PicoGL.TEXTURE_2D_ARRAY);
            this.textureMipmapsDirty = false;
            this.textureMipmapsDirtyUpdates = 0;
            this.textureMipmapsLastGenAtMs = nowMs;
        } catch (e) {
            // If mipmap regen fails for any reason, keep it dirty and try again later.
            console.warn("Texture mipmap regeneration failed", e);
        }
    }

    private getPendingStreamMapCount(): number {
        let count = 0;
        for (const batch of this.pendingStreamMapsByGeneration.values()) {
            count += batch.size;
        }
        return count | 0;
    }

    private hasPendingMapStreamingWork(): boolean {
        if (this.mapsToLoad.length > 0) return true;
        if (this.mapManager.loadingMapIds.size > 0) return true;
        return this.getPendingStreamMapCount() > 0;
    }

    private syncStreamGenerationFromMapManager(): void {
        const revision = this.mapManager.getGridRevision() | 0;
        if (revision === this.observedGridRevision) return;
        const nextExpected = new Set(this.mapManager.getGridMapIdsSnapshot());
        let carryForward: StreamMapBatch | undefined;
        for (const [generation, batch] of this.pendingStreamMapsByGeneration.entries()) {
            if ((generation | 0) >= revision) continue;
            for (const [mapId, mapData] of batch.entries()) {
                if (nextExpected.has(mapId)) {
                    if (!carryForward) carryForward = new Map<number, SdMapData>();
                    carryForward.set(mapId, mapData);
                } else {
                    this.mapManager.loadingMapIds.delete(mapId);
                }
            }
            this.pendingStreamMapsByGeneration.delete(generation);
        }
        this.observedGridRevision = revision;

        // Detect cross-region teleport: if none of the new maps are loaded,
        // skip the fog fade-in so they appear instantly.
        let hasOverlap = false;
        for (const mapId of nextExpected) {
            if (this.mapManager.mapSquares.has(mapId)) {
                hasOverlap = true;
                break;
            }
        }
        if (!hasOverlap && nextExpected.size > 0) {
            this.skipMapFadeIn = true;
        }

        this.activeStreamGeneration = revision;
        this.activeStreamExpectedMapIds = nextExpected;
        if (carryForward && carryForward.size > 0) {
            const active =
                this.pendingStreamMapsByGeneration.get(revision) ?? new Map<number, SdMapData>();
            for (const [mapId, mapData] of carryForward.entries()) {
                active.set(mapId, mapData);
            }
            this.pendingStreamMapsByGeneration.set(revision, active);
        }
    }

    private queueStreamMapData(mapData: SdMapData, streamGeneration?: number): void {
        const mapId = getMapSquareId(mapData.mapX, mapData.mapY);
        const inTargetGrid = this.mapManager.isMapInTargetGrid(mapData.mapX, mapData.mapY);
        if (!inTargetGrid) {
            this.mapManager.loadingMapIds.delete(mapId);
            return;
        }

        const currentGeneration = this.activeStreamGeneration | 0;
        const queuedGeneration = typeof streamGeneration === "number" ? streamGeneration | 0 : 0;
        const targetGeneration =
            queuedGeneration > currentGeneration
                ? queuedGeneration
                : queuedGeneration > 0 && queuedGeneration < currentGeneration
                ? currentGeneration
                : Math.max(currentGeneration, queuedGeneration);

        let batch = this.pendingStreamMapsByGeneration.get(targetGeneration);
        if (!batch) {
            batch = new Map<number, SdMapData>();
            this.pendingStreamMapsByGeneration.set(targetGeneration, batch);
        }
        batch.set(mapId, mapData);
    }

    private applyReadyStreamGenerationBatch(time: number): number {
        const generation = this.activeStreamGeneration | 0;
        const expected = this.activeStreamExpectedMapIds;
        const pending = this.pendingStreamMapsByGeneration.get(generation);
        if (!pending || expected.size === 0) return 0;
        if (
            !this.mainProgram ||
            !this.mainAlphaProgram ||
            !this.npcProgram ||
            !this.textureArray ||
            !this.textureMaterials ||
            !this.sceneUniformBuffer
        ) {
            return 0;
        }
        const mainProgram = this.mainProgram;
        const mainAlphaProgram = this.mainAlphaProgram;
        const npcProgram = this.npcProgram;
        const textureArray = this.textureArray;
        const textureMaterials = this.textureMaterials;
        const sceneUniformBuffer = this.sceneUniformBuffer;

        // Apply maps as they arrive, but never apply surrounding chunks before
        // the player's own chunk (index 0 in the ordered grid).  This ensures the
        // map square the player is standing on always renders first.
        let applied = 0;
        let allReady = true;
        const orderedMapIds = this.mapManager.getGridMapIdsSnapshot();
        let playerChunkReady = false;
        if (orderedMapIds.length > 0) {
            const firstId = orderedMapIds[0];
            const firstMx = firstId >> 8;
            const firstMy = firstId & 0xff;
            playerChunkReady =
                !!pending.get(firstId) ||
                !!this.mapManager.getMap(firstMx, firstMy) ||
                this.mapManager.invalidMapIds.has(firstId);
        }
        for (const mapId of orderedMapIds) {
            const mapData = pending.get(mapId);
            if (!mapData) {
                const mx = mapId >> 8;
                const my = mapId & 0xff;
                if (!this.mapManager.getMap(mx, my) && !this.mapManager.invalidMapIds.has(mapId)) {
                    allReady = false;
                }
                continue;
            }
            if (!playerChunkReady) {
                allReady = false;
                continue;
            }
            if (!this.isValidMapData(mapData)) continue;
            pending.delete(mapId);
            applied++;
            this.loadMap(
                mainProgram,
                mainAlphaProgram,
                npcProgram,
                textureArray,
                textureMaterials,
                sceneUniformBuffer,
                mapData,
                time,
            );
        }
        if (allReady || pending.size === 0) {
            this.pendingStreamMapsByGeneration.delete(generation);
        }
        if (allReady) {
            this.skipMapFadeIn = false;
        }
        return applied | 0;
    }

    initMaterialsTexture(): void {
        if (this.textureMaterials) {
            this.textureMaterials.delete();
            this.textureMaterials = undefined;
        }

        const textureCount = this.textureLayerCount || 1;

        // Row 0: animU, animV, alphaCutOff, frameCount
        // Row 1: animSpeed, (unused), (unused), (unused)
        const data = new Int8Array(textureCount * 2 * 4);
        data[3] = 1; // frameCount for fallback layer 0

        for (let i = 0; i < this.textureIds.length; i++) {
            const id = this.textureIds[i];
            try {
                const material = this.osrsClient.textureLoader.getMaterial(id);
                const frameCount = this.textureFrameCounts.get(id) ?? material.frameCount ?? 1;
                const baseLayer = this.textureIdIndexMap.get(id) ?? 0;

                for (
                    let frame = 0;
                    frame < frameCount && baseLayer + frame < textureCount;
                    frame++
                ) {
                    const layerIndex = baseLayer + frame;
                    const row0 = layerIndex * 4;
                    const row1 = (textureCount + layerIndex) * 4;

                    data[row0] = material.animU;
                    data[row0 + 1] = material.animV;
                    data[row0 + 2] = material.alphaCutOff * 255;
                    data[row0 + 3] = frameCount;

                    data[row1] = material.animSpeed;
                }
            } catch (e) {
                console.error("Failed loading texture", id, e);
            }
        }

        this.textureMaterials = this.app.createTexture2D(data, textureCount, 2, {
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            internalFormat: PicoGL.RGBA8I,
        });
    }

    private clearControlledPlayerAppearanceCache(): void {
        try {
            const controlledId = this.osrsClient.controlledPlayerServerId | 0;
            if (controlledId < 0) return;
            const pe = this.osrsClient.playerEcs;
            const idx = pe.getIndexForServerId(controlledId);
            if (idx === undefined) return;
            const app = pe.getAppearance(idx);
            if (!app) return;
            const equipKey =
                app.getEquipKey?.() ??
                (Array.isArray(app.equip) ? app.equip.slice(0, 14).join(",") : "");
            const key = app.getCacheKey?.() ?? `${app.getHash?.().toString() ?? "0"}|${equipKey}`;
            this.playerRenderer.cleanupAppearanceCache(key);
            pe.cleanupAppearanceCache(key);
        } catch {}
    }

    private resolvePlayerIdleSeqMaxId(): number {
        if (this.playerIdleSeqMaxId >= 0) return this.playerIdleSeqMaxId;
        const fallbackMax = 12000;
        let maxId = fallbackMax;
        try {
            const loader = this.osrsClient.seqTypeLoader;
            const count = loader?.getCount?.();
            if (typeof count === "number" && count > 0) {
                maxId = Math.max(0, (count | 0) - 1);
            }
        } catch {}
        this.playerIdleSeqMaxId = maxId;
        return maxId;
    }

    getProjectileManager(): ProjectileManager | undefined {
        return this.projectileManager;
    }

    getControls(): Schema {
        // Appearance (clothes + equipment) is server-driven; no local kit lists

        const queueRebuild = () => {
            this.playerRenderer
                .initGeometry()
                .catch((e) => console.warn("Player rebuild failed", e));
        };

        const schema: any = {
            Player: folder(
                {
                    Plane: {
                        value: (() => {
                            const idx = this.osrsClient.playerEcs.getIndexForServerId(
                                this.osrsClient.controlledPlayerServerId,
                            );
                            return idx !== undefined ? this.osrsClient.playerEcs.getLevel(idx) : 0;
                        })(),
                        min: 0,
                        max: 3,
                        step: 1,
                        label: "Plane",
                        onChange: (v: number) => {
                            const idx = this.osrsClient.playerEcs.getIndexForServerId(
                                this.osrsClient.controlledPlayerServerId,
                            );
                            if (idx === undefined) return;
                            const next = Math.max(0, Math.min(3, v | 0));
                            const currentLevel = this.osrsClient.playerEcs.getLevel(idx);
                            if (currentLevel !== next) {
                                this.osrsClient.playerEcs.setLevel(idx, next);
                                // Keep PlayerECS in sync if present so roof logic uses this plane
                                try {
                                    const pe = this.osrsClient.playerEcs as any;
                                    const n = pe?.size?.() ?? 0;
                                    if (n > 0) pe.setLevel?.(0, next);
                                } catch {}
                                // Ensure camera follow and height sampling react immediately
                                this.osrsClient.camera.updated = true;
                            }
                        },
                    },
                    AnimMode: {
                        value: this.playerAnimMode,
                        options: { Idle: "idle", Walk: "walk", Run: "run", Crawl: "crawl" },
                        label: "Player Animation",
                        onChange: (v: "idle" | "walk" | "run" | "crawl") => {
                            this.playerAnimMode = v;
                            // Also toggle server run mode to keep speed consistent with UI choice
                            try {
                                this.osrsClient.setRunMode(v === "run");
                            } catch {}
                            // Update local ECS run flag to reflect toggle immediately
                            try {
                                const idx = this.osrsClient.playerEcs.getIndexForServerId(
                                    this.osrsClient.controlledPlayerServerId,
                                );
                                if (idx !== undefined)
                                    (this.osrsClient.playerEcs as any).running[idx] =
                                        v === "run" ? 1 : 0;
                            } catch {}
                            // Reset frames when switching modes
                        },
                    },
                    DebugDumpVertices: {
                        value: this.playerDebugDump,
                        label: "Debug Dump Vertices",
                        onChange: (v: boolean) => {
                            this.playerDebugDump = !!v;
                            queueRebuild();
                        },
                    },
                    FreezeFrame: {
                        value: this.playerFreezeFrame,
                        label: "Freeze Frame",
                        onChange: (v: boolean) => (this.playerFreezeFrame = !!v),
                    },
                    FrameIndex: {
                        value: this.playerFixedFrame,
                        min: 0,
                        max: Math.max(this.playerRenderer.getFrameCount() - 1, 0),
                        step: 1,
                        onChange: (v: number) => (this.playerFixedFrame = v | 0),
                    },
                    IdleSeqId: {
                        value: this.playerIdleSeqId,
                        min: -1,
                        max: this.resolvePlayerIdleSeqMaxId(),
                        step: 1,
                        label: "Idle Seq ID (-1:auto)",
                        onChange: (v: number) => {
                            this.playerIdleSeqId = v | 0;
                            this.clearControlledPlayerAppearanceCache();
                            queueRebuild();
                        },
                    },
                    YOffset: {
                        value: this.playerYOffset,
                        min: -32,
                        max: 64,
                        step: 1,
                        label: "Y offset",
                        onChange: (v: number) => (this.playerYOffset = v | 0),
                    },
                    // No local appearance editing (head/torso/arms/hands)
                    // No local appearance editing (legs/feet)
                    // No local equip meta introspection
                },
                { collapsed: false },
            ),
            "Max Level": {
                value: this.maxLevel,
                min: 0,
                max: 3,
                step: 1,
                onChange: (v: number) => {
                    this.setMaxLevel(v);
                },
            },
            Sky: {
                r: this.skyColor[0] * 255,
                g: this.skyColor[1] * 255,
                b: this.skyColor[2] * 255,
                onChange: (v: ColorRgb) => {
                    this.setSkyColor(v.r, v.g, v.b);
                },
            },
            Fog: folder(
                {
                    Auto: {
                        value: this.autoFogDepth,
                        label: "Auto (fogDepth = renderDistance * factor)",
                        onChange: (v: boolean) => {
                            this.autoFogDepth = !!v;
                        },
                    },
                    Factor: {
                        value: this.autoFogDepthFactor,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v: number) => {
                            // Keep it sane; fogFactorOSRS clamps against renderDistance anyway.
                            this.autoFogDepthFactor = Math.max(0, Math.min(1, v));
                        },
                    },
                    Depth: {
                        value: this.fogDepth,
                        min: 0,
                        max: 400,
                        step: 5,
                        label: "Manual fog start (tiles)",
                        onChange: (v: number) => {
                            this.fogDepth = v;
                        },
                    },
                },
                { collapsed: true },
            ),
            Brightness: {
                value: 1,
                min: 0,
                max: 4,
                step: 1,
                onChange: (v: number) => {
                    this.brightness = 1.0 - v * 0.1;
                },
            },
            "Color Banding": {
                value: 50,
                min: 0,
                max: 100,
                step: 1,
                onChange: (v: number) => {
                    this.colorBanding = 255 - v * 2;
                },
            },
            "Texture Filtering": {
                value: this.textureFilterMode,
                options: {
                    Disabled: TextureFilterMode.DISABLED,
                    Bilinear: TextureFilterMode.BILINEAR,
                    Trilinear: TextureFilterMode.TRILINEAR,
                    "Anisotropic 2x": TextureFilterMode.ANISOTROPIC_2X,
                    "Anisotropic 4x": TextureFilterMode.ANISOTROPIC_4X,
                    "Anisotropic 8x": TextureFilterMode.ANISOTROPIC_8X,
                    "Anisotropic 16x": TextureFilterMode.ANISOTROPIC_16X,
                },
                onChange: (v: TextureFilterMode) => {
                    if (v === this.textureFilterMode) {
                        return;
                    }
                    this.textureFilterMode = v;
                    this.updateTextureFiltering();
                },
            },
            "Smooth Terrain": {
                value: this.smoothTerrain,
                onChange: (v: boolean) => {
                    this.setSmoothTerrain(v);
                },
            },
            "Cull Back-faces": {
                value: this.cullBackFace,
                onChange: (v: boolean) => {
                    this.cullBackFace = v;
                },
            },
            "Anti-Aliasing": folder(
                {
                    MSAA: {
                        value: this.msaaEnabled,
                        onChange: (v: boolean) => {
                            this.setMsaa(v);
                        },
                    },
                    FXAA: {
                        value: this.fxaaEnabled,
                        onChange: (v: boolean) => {
                            this.setFxaa(v);
                        },
                    },
                },
                { collapsed: true },
            ),
            Entity: folder(
                {
                    Items: {
                        value: this.loadObjs,
                        onChange: (v: boolean) => {
                            this.setLoadObjs(v);
                        },
                    },
                    Npcs: {
                        value: this.loadNpcs,
                        onChange: (v: boolean) => {
                            this.setLoadNpcs(v);
                        },
                    },
                },
                { collapsed: true },
            ),
        };

        return schema;
    }

    override async queueLoadMap(
        mapX: number,
        mapY: number,
        streamGeneration?: number,
        locReloadBatchId?: number,
    ): Promise<void> {
        // Don't try to load maps before cache is initialized
        if (!this.osrsClient.loadedCache) return;

        const input: SdMapLoaderInput = {
            mapX,
            mapY,
            maxLevel: Math.max(0, Math.min(Scene.MAX_LEVELS - 1, this.maxLevel | 0)),
            loadObjs: this.loadObjs,
            loadNpcs: this.loadNpcs,
            smoothTerrain: this.smoothTerrain,
            minimizeDrawCalls: !this.hasMultiDraw,
            loadedTextureIds: this.loadedTextureIds,
            locOverrides: this.locOverrides,
            locSpawns: this.locSpawns,
        };

        const mapData = await this.osrsClient.workerPool.queueLoad<
            SdMapLoaderInput,
            SdMapData | undefined,
            SdMapDataLoader
        >(this.dataLoader, input);

        const mapId = getMapSquareId(mapX, mapY);
        if (mapData && this.isValidMapData(mapData)) {
            if (typeof locReloadBatchId === "number") {
                this.resolveLocReloadBatchMap(locReloadBatchId, mapId, mapData);
                return;
            }
            this.queueStreamMapData(mapData, streamGeneration);
        } else {
            if (!mapData) {
                this.mapManager.addInvalidMap(mapX, mapY);
            } else {
                this.mapManager.loadingMapIds.delete(mapId);
            }
            this.pendingLocUpdates.delete(mapId);
            this.queuedLocReloadBatchByMap.delete(mapId);
            if (typeof locReloadBatchId === "number") {
                this.resolveLocReloadBatchMap(locReloadBatchId, mapId, undefined);
            }
        }
    }

    private resolveLocReloadBatchMap(
        batchId: number,
        mapId: number,
        mapData: SdMapData | undefined,
    ): void {
        const batch = this.pendingLocReloadBatches.get(batchId);
        if (!batch) {
            if (mapData) {
                this.mapsToLoad.push(mapData);
            }
            return;
        }

        if (mapData) {
            batch.loaded.set(mapId, mapData);
        }
        batch.pendingMapIds.delete(mapId);

        if (batch.pendingMapIds.size > 0) {
            return;
        }

        // Commit the whole loc-reload batch together so multi-square gates don't show half-updates.
        for (const expectedMapId of batch.mapIds) {
            const ready = batch.loaded.get(expectedMapId);
            if (!ready) continue;
            this.mapsToLoad.push(ready);
            this.queuedLocReloadBatchByMap.set(expectedMapId, batch.id);
        }
        this.pendingLocReloadBatches.delete(batchId);
    }

    private beginLocReloadBatch(maps: Array<{ mapX: number; mapY: number }>): void {
        if (maps.length === 0) return;

        const ordered = maps
            .map((map) => ({
                mapX: map.mapX | 0,
                mapY: map.mapY | 0,
                mapId: getMapSquareId(map.mapX, map.mapY),
            }))
            .sort((a, b) => a.mapId - b.mapId);
        const mapIds = ordered.map((entry) => entry.mapId);
        const batchId = this.nextLocReloadBatchId++;
        this.pendingLocReloadBatches.set(batchId, {
            id: batchId,
            mapIds,
            pendingMapIds: new Set<number>(mapIds),
            loaded: new Map<number, SdMapData>(),
        });

        for (const entry of ordered) {
            void this.queueLoadMap(entry.mapX, entry.mapY, undefined, batchId);
        }
    }

    loadMap(
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        time: number,
    ): void {
        const { mapX, mapY } = mapData;
        const mapId = getMapSquareId(mapX, mapY);
        const existing = this.mapManager.getMap(mapX, mapY);
        const isLocUpdate = this.pendingLocUpdates.has(mapId);

        if (isLocUpdate && existing instanceof WebGLMapSquare) {
            existing.refreshSceneGeometry(
                this.osrsClient.seqTypeLoader,
                this.osrsClient.seqFrameLoader,
                this.app,
                mainProgram,
                mainAlphaProgram,
                textureArray,
                textureMaterials,
                sceneUniformBuffer,
                mapData,
                getClientCycle() | 0,
                existing.timeLoaded,
            );

            this.osrsClient.setMapImageUrl(
                mapX,
                mapY,
                URL.createObjectURL(mapData.minimapBlob),
                true,
                false,
            );

            if (mapData.minimapIcons && mapData.minimapIcons.length > 0) {
                this.minimapIcons.set(mapId, mapData.minimapIcons);
            } else {
                this.minimapIcons.delete(mapId);
            }

            this.mapManager.addMap(mapX, mapY, existing);
            this.rebuildGroundItemsForMap(existing, this.groundItemStacks.get(mapId));
            this.pendingLocUpdates.delete(mapId);
            this.updateTextureArray(mapData.loadedTextures);
            return;
        }

        this.osrsClient.setMapImageUrl(
            mapX,
            mapY,
            URL.createObjectURL(mapData.minimapBlob),
            true,
            false,
        );

        // Store minimap icons for dynamic rendering
        if (mapData.minimapIcons && mapData.minimapIcons.length > 0) {
            this.minimapIcons.set(mapId, mapData.minimapIcons);
        } else {
            this.minimapIcons.delete(mapId);
        }

        const frameCount = this.stats.frameCount;
        // -1.0 makes loadAlpha = 1.0 immediately in the vertex shader,
        // skipping the 1-second fog fade-in for teleport-loaded maps.
        const reuseTime =
            existing instanceof WebGLMapSquare
                ? existing.timeLoaded
                : this.skipMapFadeIn
                  ? -1.0
                  : time;
        const reuseFrame =
            existing instanceof WebGLMapSquare ? existing.frameLoaded : frameCount;

        const loadedMap = WebGLMapSquare.load(
            this.osrsClient.seqTypeLoader,
            this.osrsClient.seqFrameLoader,
            this.osrsClient.npcTypeLoader,
            this.osrsClient.basTypeLoader,
            this.app,
            mainProgram,
            mainAlphaProgram,
            npcProgram,
            textureArray,
            textureMaterials,
            sceneUniformBuffer,
            mapData,
            reuseTime,
            getClientCycle() | 0,
            reuseFrame,
            this.osrsClient.npcEcs,
        );

        this.mapManager.addMap(mapX, mapY, loadedMap);
        this.rebuildGroundItemsForMap(loadedMap, this.groundItemStacks.get(mapId));

        this.updateTextureArray(mapData.loadedTextures);

        this.pendingLocUpdates.delete(mapId);
    }

    isValidMapData(mapData: SdMapData): boolean {
        return (
            mapData.cacheName === this.osrsClient.loadedCache?.info?.name &&
            mapData.loadObjs === this.loadObjs &&
            mapData.loadNpcs === this.loadNpcs &&
            mapData.smoothTerrain === this.smoothTerrain
        );
    }

    clearMaps(): void {
        this.mapManager.cleanUp();
        this.mapsToLoad.clear();
        this.pendingStreamMapsByGeneration.clear();
        this.observedGridRevision = -1;
        this.skipMapFadeIn = false;
        this.activeStreamGeneration = 0;
        this.activeStreamExpectedMapIds.clear();
        this.pendingLocUpdates.clear();
        this.pendingLocReloadMaps.clear();
        this.pendingLocReloadBatches.clear();
        this.queuedLocReloadBatchByMap.clear();
        this.nextLocReloadBatchId = 1;
        if (this.pendingLocReloadFlushTimer) {
            clearTimeout(this.pendingLocReloadFlushTimer);
            this.pendingLocReloadFlushTimer = undefined;
        }
        this.minimapIcons.clear();
        this.clearDynamicNpcAnimRuntimeState();
    }

    /**
     * Get minimap icons for a specific map square.
     * @param mapX Map square X coordinate
     * @param mapY Map square Y coordinate
     * @returns Array of icons with localX, localY, and spriteId, or undefined if not loaded
     */
    getMinimapIcons(
        mapX: number,
        mapY: number,
    ): Array<{ localX: number; localY: number; spriteId: number }> | undefined {
        const mapId = (mapX << 8) | mapY;
        return this.minimapIcons.get(mapId);
    }

    setMaxLevel(maxLevel: number): void {
        const updated = this.maxLevel !== maxLevel;
        this.maxLevel = maxLevel;
        if (updated) {
            this.clearMaps();
        }
    }

    setSkyColor(r: number, g: number, b: number) {
        this.skyColor[0] = r / 255;
        this.skyColor[1] = g / 255;
        this.skyColor[2] = b / 255;
    }

    /**
     * Set the scene-level HSL color override (OSRS Scene.Scene_cameraY).
     * Tints all rendered geometry by lerping HSL vertex colors toward the target.
     * Reference: HslOverride.java, AbstractRasterizer.applyHslOverride
     *
     * @param hue       Override hue target (-1 = no hue override, 0-63)
     * @param sat       Override saturation target (-1 = no sat override, 0-7)
     * @param lum       Override luminance target (-1 = no lum override, 0-127)
     * @param amount    Override strength (0 = disabled, 1-255 = lerp strength, 127 = full in OSRS)
     */
    setSceneHslOverride(hue: number, sat: number, lum: number, amount: number): void {
        this.sceneHslOverride[0] = hue;
        this.sceneHslOverride[1] = sat;
        this.sceneHslOverride[2] = lum;
        this.sceneHslOverride[3] = amount;
    }

    /**
     * Set the scene-level HSL override from a packed HSL short (as used by WorldEntityConfig.sceneTintHsl).
     * Reference: WorldEntity.java lines 221-226
     *
     * @param packedHsl  Packed 16-bit HSL value (hue[15:10], sat[9:7], lum[6:0])
     * @param amount     Override strength (0-255, typically 127 for full override)
     */
    setSceneHslOverrideFromPacked(packedHsl: number, amount: number): void {
        const hue = (packedHsl >> 10) & 63;
        const sat = (packedHsl >> 7) & 7;
        const lum = packedHsl & 127;
        this.setSceneHslOverride(hue, sat, lum, amount);
    }

    /**
     * Clear the scene-level HSL override (restore normal rendering).
     * Reference: HslOverride.clear()
     */
    clearSceneHslOverride(): void {
        this.sceneHslOverride[0] = -1;
        this.sceneHslOverride[1] = -1;
        this.sceneHslOverride[2] = -1;
        this.sceneHslOverride[3] = 0;
    }

    setSmoothTerrain(enabled: boolean): void {
        const updated = this.smoothTerrain !== enabled;
        this.smoothTerrain = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    setMsaa(enabled: boolean): void {
        const updated = this.msaaEnabled !== enabled;
        this.msaaEnabled = enabled;
        if (updated) {
            this.needsFramebufferUpdate = true;
        }
    }

    setFxaa(enabled: boolean): void {
        this.fxaaEnabled = enabled;
    }

    private finishRenderFrame(
        camera: any,
        deltaTime: number,
        showDebugTimer: boolean,
        profileGpuTimer: boolean,
    ): void {
        profiler.endFrame(deltaTime);

        let geoBytes = 0;
        for (const map of this.mapManager.mapSquares.values()) {
            geoBytes += (map.interleavedBuffer as any)?.byteLength ?? 0;
            geoBytes += (map.indexBuffer as any)?.byteLength ?? 0;
        }
        try {
            const pr: any = this.playerRenderer as any;
            const vbo = pr.getInterleavedBuffer?.();
            const ibo = pr.getIndexBuffer?.();
            if (vbo) geoBytes += (vbo as any).byteLength ?? 0;
            if (ibo) geoBytes += (ibo as any).byteLength ?? 0;
        } catch {}
        this.stats.geometryGpuBytes = geoBytes;

        this.stats.texturesLoaded = this.loadedTextureIds.size;
        this.stats.texturesTotal = this.textureIds.length;
        this.stats.width = this.app.width | 0;
        this.stats.height = this.app.height | 0;
        this.stats.sceneWidth = this.sceneRenderWidth | 0;
        this.stats.sceneHeight = this.sceneRenderHeight | 0;

        this.stats.cameraPosX = camera.getPosX();
        this.stats.cameraPosY = camera.getPosY();
        this.stats.cameraPosZ = camera.getPosZ();
        this.stats.cameraPitchRS = camera.pitch | 0;
        this.stats.cameraYawRS = camera.getYaw() | 0;
        this.stats.cameraRollRS = 0;

        const debugPlayerIndex = this.getControlledPlayerEcsIndex();
        if (debugPlayerIndex !== undefined) {
            this.stats.playerTileX = (this.osrsClient.playerEcs.getX(debugPlayerIndex) / 128) | 0;
            this.stats.playerTileY = (this.osrsClient.playerEcs.getY(debugPlayerIndex) / 128) | 0;
            this.stats.playerLevel = this.osrsClient.playerEcs.getLevel(debugPlayerIndex) | 0;
        }

        if ((showDebugTimer || profileGpuTimer) && this.timer.ready()) {
            profiler.recordGpuTime(this.timer.gpuTime);
        }

        if (showDebugTimer && this.timer.ready()) {
            this.osrsClient.debugText = `Frame Time GL: ${this.timer.gpuTime.toFixed(
                2,
            )}ms\n JS: ${this.timer.cpuTime.toFixed(2)}ms`;
        }
    }

    setLoadObjs(enabled: boolean): void {
        const updated = this.loadObjs !== enabled;
        this.loadObjs = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    setLoadNpcs(enabled: boolean): void {
        const updated = this.loadNpcs !== enabled;
        this.loadNpcs = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    override onResize(width: number, height: number): void {
        try {
            // Guard against resize before init
            if (!this.app) {
                return;
            }

            this.app.resize(width, height);

            // Explicitly update app dimensions in case PicoGL doesn't
            (this.app as any).width = width;
            (this.app as any).height = height;

            // Sync widgetManager dimensions with the current UI layout space.
            const uiMetrics = this.computeUiRenderMetrics(width, height);
            this.osrsClient?.widgetManager?.resize(uiMetrics.layoutW, uiMetrics.layoutH);

            // All in-world overlays render in buffer pixel space, so their scale must match
            // renderScaleX (uiScale × DPR) so sprites/text appear the correct physical size.
            const overlayScale = uiMetrics.renderScaleX;
            if (this.overheadTextOverlay) this.overheadTextOverlay.scale = overlayScale;
            if (this.hitsplatOverlay) this.hitsplatOverlay.scale = overlayScale;
            if (this.clickCrossOverlay) this.clickCrossOverlay.scale = overlayScale;
            if (this.groundItemOverlay) this.groundItemOverlay.scale = overlayScale;
            (this.canvas as any).__uiRenderScale = overlayScale;

            // Trigger framebuffer recreation
            this.needsFramebufferUpdate = true;

            this.initTextureFramebuffer(width, height);
        } catch (e) {
            console.warn("[webgl] onResize error", e);
        }
    }

    override render(time: number, deltaTime: number, resized: boolean): void {
        profiler.startFrame();

        // One-time initialization of overlay scales. onResize fires before this.app is
        // initialized (early-return guard at the top of onResize), so overlay scales may not
        // have been set yet. We set them here on the first render frame where this.app exists.
        if (!this._overlaysScaleInitialized && this.app) {
            const bufW = this.canvas.width;
            const bufH = this.canvas.height;
            if (bufW > 0 && bufH > 0) {
                const metrics = this.computeUiRenderMetrics(bufW, bufH);
                const overlayScale = metrics.renderScaleX;
                if (this.overheadTextOverlay) this.overheadTextOverlay.scale = overlayScale;
                if (this.hitsplatOverlay) this.hitsplatOverlay.scale = overlayScale;
                if (this.clickCrossOverlay) this.clickCrossOverlay.scale = overlayScale;
                if (this.groundItemOverlay) this.groundItemOverlay.scale = overlayScale;
                (this.canvas as any).__uiRenderScale = overlayScale;
                this._overlaysScaleInitialized = true;
            }
        }

        const onLoginScreen = this.osrsClient.isOnLoginScreen();
        const loggedIn = this.osrsClient.isLoggedIn();
        const loginLikeState = !loggedIn;
        // When transitioning from login→gameplay, re-sync overlay scales. The first-frame sync
        // runs during login state (renderScaleX≈1) but gameplay uses a different scale formula.
        // No onResize fires on this transition so we must re-compute here.
        if (this._lastLoginLikeState === true && !loginLikeState && this.app) {
            const bufW = this.canvas.width;
            const bufH = this.canvas.height;
            if (bufW > 0 && bufH > 0) {
                const metrics = this.computeUiRenderMetrics(bufW, bufH);
                const overlayScale = metrics.renderScaleX;
                if (this.overheadTextOverlay) this.overheadTextOverlay.scale = overlayScale;
                if (this.hitsplatOverlay) this.hitsplatOverlay.scale = overlayScale;
                if (this.clickCrossOverlay) this.clickCrossOverlay.scale = overlayScale;
                if (this.groundItemOverlay) this.groundItemOverlay.scale = overlayScale;
                (this.canvas as any).__uiRenderScale = overlayScale;
            }
        }
        this._lastLoginLikeState = loginLikeState;
        const desiredImageRendering = loginLikeState && isMobileMode ? "pixelated" : "";
        if (this.canvas.style.imageRendering !== desiredImageRendering) {
            this.canvas.style.imageRendering = desiredImageRendering;
        }

        // Reset frame accumulators
        this._frameIndices = 0;
        this._frameBatches = 0;
        const showDebugTimer = this.osrsClient.inputManager.isKeyDown("KeyY");
        const profileGpuTimer = profiler.enabled;

        if (showDebugTimer || profileGpuTimer) {
            this.timer.start();
        }

        const frameCount = this.stats.frameCount;

        const timeSec = time / 1000;

        // Use server tick index for cross-client alignment
        const serverTick = getCurrentTick() | 0;
        const ticksElapsed = Math.min(serverTick - this.lastTick, 1);
        if (ticksElapsed > 0) this.lastTick = serverTick;

        // OSRS Parity: Use client cycles (20ms each) for hitsplat timing
        const clientCycle = getClientCycle() | 0;

        // Use server-derived phase to anchor interpolation within the active client tick.
        // We map the server's millisecond offset onto the local tick cadence so that
        // render-time blending stays in sync without lagging one whole server cycle.
        let phaseFromServer = Number.NaN;
        try {
            const { phase, tickMs } = getServerTickPhaseNow();
            const tickLengthMs = Math.max(1, tickMs | 0);
            const clampedPhase = Math.max(0, Math.min(1, phase));
            const msIntoServerTick = clampedPhase * tickLengthMs;
            const clientTickMs = this.clientTickDurationMs;
            if (clientTickMs > 0) {
                const msIntoClientTick = msIntoServerTick % clientTickMs;
                phaseFromServer = msIntoClientTick / clientTickMs;
            }
        } catch {
            phaseFromServer = Number.NaN;
        }
        if (!Number.isFinite(phaseFromServer)) {
            const ticksF = timeSec / this.clientTickDurationSec;
            const clientTick = Math.floor(ticksF);
            phaseFromServer = ticksF - clientTick;
        }
        this.clientTickPhase = Math.max(0, Math.min(1, phaseFromServer));

        // Maintain local integration pace based on the authoritative client cycle (Client.cycle),
        // not wallclock-derived render time.
        const clientTick = clientCycle | 0;

        if (!this.hasClientTickBaseline) {
            this.lastClientTick = clientTick;
            this.hasClientTickBaseline = true;
            this.pendingClientTicks = 0;
        } else {
            const deltaTicks = clientTick - this.lastClientTick;
            if (deltaTicks < 0) {
                // Client cycle can reset on world hops/login; treat as a new baseline.
                this.lastClientTick = clientTick;
                this.pendingClientTicks = 0;
            } else if (deltaTicks > 0) {
                this.pendingClientTicks = Math.min(
                    MAX_CLIENT_TICK_DEBT,
                    this.pendingClientTicks + deltaTicks,
                );
                this.lastClientTick = clientTick;
            }
        }

        let clientTicksElapsed = 0;
        if (this.pendingClientTicks > 0) {
            clientTicksElapsed = Math.min(MAX_CLIENT_TICKS_PER_FRAME, this.pendingClientTicks);
            this.pendingClientTicks -= clientTicksElapsed;
        }

        // ========== Title/Login Rendering (before game resource checks) ==========
        // Non-game states only need title/login overlays, not world resources like textureArray.
        const inputManager = this.osrsClient.inputManager;
        this.syncMobileLoginInput(false);
        if (!loggedIn) {
            // Transfer click state for this frame (OSRS parity)
            inputManager.onFrameStart();
            const uiMetrics = this.computeUiRenderMetrics(this.app.width, this.app.height);
            this.osrsClient.loginRenderer.syncMobileViewportState(
                this.osrsClient.loginState,
                this.isMobileLoginKeyboardOpen(),
            );
            this.osrsClient.loginRenderer.updateLayout(
                uiMetrics.layoutW,
                uiMetrics.layoutH,
                this.app.width,
                this.app.height,
            );

            if (onLoginScreen) {
                // Keep login input mapping in sync with the current canvas dimensions before click handling.
                // Other non-game states (e.g. cache downloading/loading) still use the title overlay path
                // but must not drive login-form interaction.
                let char = inputManager.readChar();
                while (char !== -1) {
                    this.osrsClient.handleLoginKeyInput("", String.fromCharCode(char));
                    char = inputManager.readChar();
                }
                // Handle special keys from key events
                for (const keyEvent of inputManager.keyEvents) {
                    if (keyEvent.code === "Tab") {
                        this.osrsClient.handleLoginKeyInput("Tab", "");
                    } else if (keyEvent.code === "Enter" || keyEvent.code === "NumpadEnter") {
                        // Enter in login form = login button or field switch
                        const { loginState } = this.osrsClient;
                        if (loginState.canAttemptLogin()) {
                            // Update game state to CONNECTING (hides buttons)
                            loginState.savePersistedLoginState();
                            this.osrsClient.updateGameState(GameState.CONNECTING);
                            sendLogin(loginState.username.trim(), loginState.password, this.osrsClient.loadedCache?.info?.revision ?? 0);
                        } else {
                            this.osrsClient.handleLoginKeyInput("Enter", "");
                        }
                    } else if (keyEvent.code === "Backspace") {
                        this.osrsClient.handleLoginKeyInput("Backspace", "");
                    }
                }
                inputManager.keyEvents.length = 0; // Clear processed key events

                // Handle mouse clicks for login buttons
                if (
                    inputManager.clickMode3 !== 0 &&
                    inputManager.saveClickX !== -1 &&
                    inputManager.saveClickY !== -1
                ) {
                    const action = this.osrsClient.handleLoginMouseClick(
                        inputManager.saveClickX,
                        inputManager.saveClickY,
                        inputManager.clickMode3,
                    );
                    const shouldRefocusMobileLoginInput =
                        isMobileMode &&
                        this.osrsClient.loginState.loginIndex === LoginIndex.LOGIN_FORM &&
                        this.osrsClient.loginState.virtualKeyboardVisible &&
                        inputManager.isTouch;
                    if (shouldRefocusMobileLoginInput) {
                        this.syncMobileLoginInput(true);
                    } else {
                        this.syncMobileLoginInput(false);
                    }
                    if (action === "connect") {
                        // Send login message
                        const { loginState } = this.osrsClient;
                        loginState.savePersistedLoginState();
                        sendLogin(loginState.username.trim(), loginState.password, this.osrsClient.loadedCache?.info?.revision ?? 0);
                    }
                    // Clear click mode to prevent further processing
                    inputManager.clickMode3 = 0;
                    inputManager.saveClickX = -1;
                    inputManager.saveClickY = -1;
                }

                // Tick login animation
                this.osrsClient.tickLogin();
            } else {
                inputManager.keyEvents.length = 0;
            }

            // Skip normal world rendering while not logged in.
            // But still flush packets. The widget overlay lives on a separate canvas,
            // so explicitly blank it here before we skip the normal post-present pass.
            this.widgetsOverlay?.clearAndHide();
            flushPackets();

            // Clear default framebuffer for login screen overlay
            this.app.defaultDrawFramebuffer();
            this.app.clearColor(0.0, 0.0, 0.0, 1.0);
            this.app.clear();

            // Draw login screen overlay only
            try {
                if (!this.uiHidden && this.loginOverlay) {
                    this.loginOverlay.setGameState(this.osrsClient.gameState);
                    this.loginOverlay.update({
                        time,
                        delta: deltaTime,
                        resolution: { width: this.app.width, height: this.app.height },
                        state: {
                            hoverEnabled: false,
                            playerLevel: 0,
                            clientTickPhase: 0,
                        },
                        helpers: this.getOverlayHelpers(),
                    });
                    this.loginOverlay.draw(RenderPhase.PostPresent);
                }
            } catch (e) {
                console.warn("[WebGLOsrsRenderer] Login screen render error:", e);
            }

            // Also draw loading message overlay during login screen (for testing visibility)
            // Note: LoadingMessageOverlay subscribes to state machine, so no need to setGameState()
            try {
                if (!this.uiHidden && this.loadingMessageOverlay) {
                    this.loadingMessageOverlay.update({
                        time,
                        delta: deltaTime,
                        resolution: { width: this.app.width, height: this.app.height },
                        state: {
                            hoverEnabled: false,
                            playerLevel: 0,
                            clientTickPhase: 0,
                        },
                        helpers: this.getOverlayHelpers(),
                    });
                    this.loadingMessageOverlay.draw(RenderPhase.PostPresent);
                }
            } catch (e) {
                console.warn("[WebGLOsrsRenderer] Loading message overlay error:", e);
            }

            profiler.endFrame(deltaTime);
            return; // Skip rest of render while not logged in
        }

        // ========== Game Resource Checks ==========
        this.syncSceneFramebufferSize();
        if (this.needsFramebufferUpdate) {
            this.initFramebuffer();
        }

        if (
            !this.mainProgram ||
            !this.mainAlphaProgram ||
            !this.npcProgram ||
            !this.sceneUniformBuffer ||
            !this.framebuffer ||
            !this.textureFramebuffer ||
            !this.frameDrawCall ||
            !this.textureArray ||
            !this.textureMaterials
        ) {
            return;
        }

        if (resized) {
            this.resolutionUni[0] = this.app.width;
            this.resolutionUni[1] = this.app.height;
        }

        const camera = this.osrsClient.camera;

        profiler.startPhase("input");
        this.handleInput(deltaTime);

        // Tick mouse cross animation (OSRS-style visual feedback)
        ClientState.tickMouseCross();

        // Flush any queued binary packets to the server (OSRS-style)
        flushPackets();
        profiler.endPhase();

        // Defer follow-camera and matrices until after tick updates to keep player centered
        if (this.cullBackFace) {
            this.app.enable(PicoGL.CULL_FACE);
        } else {
            this.app.disable(PicoGL.CULL_FACE);
        }

        const directTextureScenePass = this.shouldUseDirectTextureScenePass();
        const sceneFramebuffer = directTextureScenePass
            ? this.textureFramebuffer!
            : this.framebuffer!;

        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.depthMask(true);

        this.app.drawFramebuffer(sceneFramebuffer);
        this.app.viewport(0, 0, this.sceneRenderWidth | 0, this.sceneRenderHeight | 0);

        profiler.startPhase("tick");
        // Dynamic path always uses current appearance; no NPC fallback rebuild
        // Always keep dynamic player animation enabled; do not switch to pre-baked clips.
        // This removes the prebake path entirely for players, even with multiple players present.
        this.tickPass(timeSec, ticksElapsed, clientTicksElapsed, clientCycle);
        profiler.endPhase();

        // Now update follow camera and matrices using up-to-date player position
        if (this.osrsClient.followPlayerCamera && this.osrsClient.playerEcs.size() > 0) {
            this.updateCameraFollow(deltaTime, timeSec);
        }
        camera.applySmoothing(deltaTime);
        let cameraShakeApplied = false;
        let restoreCameraX = 0;
        let restoreCameraY = 0;
        let restoreCameraZ = 0;
        let restoreCameraPitch = 0;
        let restoreCameraYaw = 0;
        // Ensure camera uses valid dimensions
        const camWidth = Math.max(1, this.app.width || this.canvas.width || 1);
        const camHeight = Math.max(1, this.app.height || this.canvas.height || 1);
        const sceneViewport = this.getSceneViewportWidgetRect();
        const sceneFramebufferViewport = this.scaleViewportRectToSceneBuffer(sceneViewport);
        camera.update(
            camWidth,
            camHeight,
            sceneViewport.x,
            sceneViewport.y,
            sceneViewport.width,
            sceneViewport.height,
        );
        this.clearSceneFramebuffer(sceneFramebufferViewport);
        // OSRS parity: keep CS2-visible viewport zoom in sync with the viewport widget size
        // (Client.viewportZoom; i.e., Rasterizer3D.get3dZoom()) so scripts and widget models scale correctly.
        try {
            this.osrsClient.cs2Vm.context.viewportZoom = camera.computeViewportZoomForSize(
                sceneViewport.width,
                sceneViewport.height,
            );
        } catch {}

        // OSRS camera shake is applied as a temporary render perturbation, then restored.
        try {
            const shake = this.computeCameraShakeOffsets(clientCycle);
            if (shake.active) {
                restoreCameraX = camera.getPosX();
                restoreCameraY = camera.getPosY();
                restoreCameraZ = camera.getPosZ();
                restoreCameraPitch = camera.pitch | 0;
                restoreCameraYaw = camera.yaw | 0;

                let shakenPitch = restoreCameraPitch;
                if ((shake.pitch | 0) !== 0) {
                    let camAngleX = 128 + Math.floor((clamp(shakenPitch, 0, 512) * 255) / 512);
                    camAngleX = Math.max(128, Math.min(383, camAngleX + (shake.pitch | 0)));
                    shakenPitch = clamp(Math.floor(((camAngleX - 128) * 512) / 255), 0, 512);
                }
                const shakenYaw = (restoreCameraYaw + (shake.yaw | 0)) & 2047;

                camera.snapToPosition(
                    restoreCameraX + shake.x / 128,
                    restoreCameraY + shake.y / 128,
                    restoreCameraZ + shake.z / 128,
                );
                camera.snapToPitch(shakenPitch);
                camera.snapToYaw(shakenYaw);
                camera.update(
                    camWidth,
                    camHeight,
                    sceneViewport.x,
                    sceneViewport.y,
                    sceneViewport.width,
                    sceneViewport.height,
                );
                cameraShakeApplied = true;
            }
        } catch {}

        // Update hovered tile using latest camera matrices
        profiler.startPhase("hover");
        this.updateHoveredTile();
        profiler.endPhase();

        // Map manager streaming/visibility update.
        profiler.startPhase("mapMgr");
        this.mapManager.update(
            this.playerPosUni[0],
            this.playerPosUni[1],
            camera,
            frameCount,
            this.osrsClient.mapRadius,
            ClientState.baseX | 0,
            ClientState.baseY | 0,
            this.osrsClient.expandedMapLoading | 0,
        );
        this.syncStreamGenerationFromMapManager();
        const renderDistance = this.resolveEffectiveRenderDistanceTiles(frameCount | 0);
        profiler.endPhase();

        // Keep fog tied to configured render distance.
        // Edge-based fog clamping causes over-aggressive fog collapse near stream boundaries.
        const { fogEnd, fogDepth } = resolveFogRange({
            renderDistance,
            autoFogDepth: this.autoFogDepth,
            autoFogDepthFactor: this.autoFogDepthFactor,
            manualFogDepth: this.fogDepth,
        });

        // Update scene uniform buffer
        profiler.startPhase("sceneUbo");
        this.cameraPosUni[0] = camera.getPosX();
        this.cameraPosUni[1] = camera.getPosZ();
        this.sceneUniformBuffer
            .set(0, camera.viewProjMatrix as Float32Array)
            .set(1, camera.viewMatrix as Float32Array)
            .set(2, camera.projectionMatrix as Float32Array)
            .set(3, this.skyColor as Float32Array)
            .set(4, this.sceneHslOverride as Float32Array)
            .set(5, this.cameraPosUni as Float32Array)
            .set(6, this.playerPosUni as Float32Array)
            .set(7, fogEnd as any)
            .set(8, fogDepth as any)
            .set(9, timeSec as any)
            .set(10, this.brightness as any)
            .set(11, this.colorBanding as any)
            .set(12, this.osrsClient.isNewTextureAnim as any)
            .update();
        profiler.endPhase();

        // CPU-side interactions with latest camera
        profiler.startPhase("interact");
        const leftClickedNow = inputManager.leftClickX !== -1 && inputManager.leftClickY !== -1;
        const pickedNow = inputManager.pickX !== -1 && inputManager.pickY !== -1;
        const cycleChanged = (clientCycle | 0) !== (this.lastInteractionClientCycle | 0);
        const menuStateChanged = this.lastInteractionMenuOpen !== this.osrsClient.menuOpen;
        const shouldRunInteractionPass =
            this.osrsClient.tooltips ||
            leftClickedNow ||
            pickedNow ||
            cycleChanged ||
            menuStateChanged;
        if (!inputManager.isPointerLock() && shouldRunInteractionPass) {
            this.checkInteractions();
            this.lastInteractionClientCycle = clientCycle | 0;
            this.lastInteractionMenuOpen = !!this.osrsClient.menuOpen;
        } else {
            this.lastInteractionRaycastHitCount = 0;
            this.lastInteractionMenuOptionCount = 0;
        }
        profiler.endPhase();

        profiler.startPhase("actorData");
        const actorIndex = this.updateActorDataTexture();
        profiler.endPhase();

        // Update projectiles
        profiler.startPhase("projectiles");
        this.projectileManager?.update(deltaTime);
        this.gfxManager?.update();
        profiler.endPhase();

        const npcDataTextureIndex = actorIndex;
        const playerDataTextureIndex = actorIndex;
        const npcDataTexture = this.actorDataTextureBuffer[actorIndex];
        const playerDataTexture = npcDataTexture;

        profiler.startPhase("roof");
        this.roofState = this.computeRoofState();
        this.lastRoofPlaneLimit = this.roofState.roofPlaneLimit | 0;
        profiler.endPhase();

        let opaqueIndices = 0;
        let opaqueBatches = 0;
        let opaqueActorIndices = 0;
        let opaqueActorBatches = 0;
        let transparentIndices = 0;
        let transparentBatches = 0;
        let transparentNpcIndices = 0;
        let transparentNpcBatches = 0;
        let transparentPlayerIndices = 0;
        let transparentPlayerBatches = 0;
        this.frameRoofFilteredRangeCount = 0;
        this.frameRoofTotalRangeCount = 0;

        let passStartIndices = this._frameIndices;
        let passStartBatches = this._frameBatches;
        this.app.disable(PicoGL.BLEND);
        profiler.startPhase("opaque");
        passStartIndices = this._frameIndices;
        passStartBatches = this._frameBatches;
        this.renderOpaquePass();
        opaqueIndices = Math.max(0, this._frameIndices - passStartIndices);
        opaqueBatches = Math.max(0, this._frameBatches - passStartBatches);
        profiler.endPhase();
        profiler.startPhase("opaqueActor");
        passStartIndices = this._frameIndices;
        passStartBatches = this._frameBatches;
        this.renderOpaqueActorPass(playerDataTextureIndex, playerDataTexture);
        opaqueActorIndices = Math.max(0, this._frameIndices - passStartIndices);
        opaqueActorBatches = Math.max(0, this._frameBatches - passStartBatches);
        profiler.endPhase();

        this.app.enable(PicoGL.BLEND);
        profiler.startPhase("transparent");
        passStartIndices = this._frameIndices;
        passStartBatches = this._frameBatches;
        this.renderTransparentPass();
        transparentIndices = Math.max(0, this._frameIndices - passStartIndices);
        transparentBatches = Math.max(0, this._frameBatches - passStartBatches);
        profiler.endPhase();
        profiler.startPhase("transpNpc");
        passStartIndices = this._frameIndices;
        passStartBatches = this._frameBatches;
        this.renderTransparentNpcPass(npcDataTextureIndex, npcDataTexture);
        transparentNpcIndices = Math.max(0, this._frameIndices - passStartIndices);
        transparentNpcBatches = Math.max(0, this._frameBatches - passStartBatches);
        profiler.endPhase();
        profiler.startPhase("transpPlayer");
        passStartIndices = this._frameIndices;
        passStartBatches = this._frameBatches;
        this.renderTransparentPlayerPass(playerDataTextureIndex, playerDataTexture);
        transparentPlayerIndices = Math.max(0, this._frameIndices - passStartIndices);
        transparentPlayerBatches = Math.max(0, this._frameBatches - passStartBatches);
        profiler.endPhase();

        try {
            this.drawSceneTileOverlays(time, deltaTime);
        } catch {}

        // Can't sample from the scene renderbuffer, so only blit when the scene pass
        // didn't already render directly into the texture framebuffer.
        profiler.startPhase("blit");
        if (!directTextureScenePass) {
            this.app.readFramebuffer(this.framebuffer);
            this.app.drawFramebuffer(this.textureFramebuffer);
            this.gl.readBuffer(PicoGL.COLOR_ATTACHMENT0);
            this.app.blitFramebuffer(PicoGL.COLOR_BUFFER_BIT, {
                srcStartX: 0,
                srcStartY: 0,
                srcEndX: this.sceneRenderWidth | 0,
                srcEndY: this.sceneRenderHeight | 0,
                dstStartX: 0,
                dstStartY: 0,
                dstEndX: this.app.width | 0,
                dstEndY: this.app.height | 0,
                filter: PicoGL.LINEAR,
            });
        }
        this.app.viewport(0, 0, this.app.width | 0, this.app.height | 0);
        profiler.endPhase();

        // Restore baseline camera before actor2d-style overlays (OSRS drawEntities restore semantics).
        if (cameraShakeApplied) {
            camera.snapToPosition(restoreCameraX, restoreCameraY, restoreCameraZ);
            camera.snapToPitch(restoreCameraPitch);
            camera.snapToYaw(restoreCameraYaw);
            camera.update(
                camWidth,
                camHeight,
                sceneViewport.x,
                sceneViewport.y,
                sceneViewport.width,
                sceneViewport.height,
            );
        }

        // Update overlays and draw pre-present overlays (e.g., hitsplats) into frame texture.
        profiler.startPhase("overlayFrame");
        try {
            this.resetHealthBarOutput();
            this.resetHitsplatOutput();
            this.resetOverheadTextOutput();
            this.resetOverheadPrayerOutput();
            let playerWorldX: number | undefined = undefined;
            let playerWorldZ: number | undefined = undefined;
            let playerLevel = resolveGroundItemStackPlane(this.getPlayerRawPlane() | 0);
            let playerRawLevel = this.getPlayerRawPlane() | 0;
            let playerAnchorIdx = 0;
            const playerFrameCount = this.playerRenderer.getFrameCount();
            const playerFrameHeights = this.playerRenderer.getFrameHeights();
            const playerDefaultHeightTiles = this.playerRenderer.getDefaultHeightTiles();
            const hitsplats = this.hitsplatOutput;
            const healthBars = this.healthBarOutput;
            const overheadTexts = this.overheadTextOutput;
            const overheadPrayers = this.overheadPrayerOutput;
            const hitsplatMaxEntries = this.getFrameHitsplatMaxEntries();
            const healthBarMaxEntries = this.getFrameHealthBarMaxEntries();
            const overheadTextMaxEntries = this.getFrameOverheadTextMaxEntries();
            const overheadPrayerMaxEntries = this.getFrameOverheadPrayerMaxEntries();
            const groundOverlayMaxEntries = this.getFrameGroundItemOverlayMaxEntries();
            const groundOverlayRadius = this.getFrameGroundItemOverlayRadius();
            let groundOverlayEntries: GroundItemOverlayEntry[] | undefined;

            try {
                const peHs = this.osrsClient.playerEcs;
                const nHs = peHs.size?.() ?? (peHs as any).size?.() ?? 0;
                if (nHs > 0) {
                    const controlledId = this.osrsClient.controlledPlayerServerId | 0;
                    const controlledIdx = peHs.getIndexForServerId(controlledId);
                    playerAnchorIdx = controlledIdx !== undefined ? controlledIdx : 0;
                    if (this.shouldRenderPlayerIndex(playerAnchorIdx)) {
                        const px = peHs.getX(playerAnchorIdx) | 0;
                        const py = peHs.getY(playerAnchorIdx) | 0;
                        playerWorldX = px / 128.0;
                        playerWorldZ = py / 128.0;
                        playerLevel = peHs.getLevel(playerAnchorIdx) | 0;
                        playerRawLevel = playerLevel;
                    }
                }
            } catch {}

            if (
                playerWorldX != null &&
                playerWorldZ != null &&
                hitsplats.length < hitsplatMaxEntries
            ) {
                const localPlayerHeightFallback =
                    this.osrsClient.playerEcs.getDefaultHeightTiles?.(playerAnchorIdx) ??
                    playerDefaultHeightTiles ??
                    this.playerDefaultHeightTiles ??
                    200 / 128;
                const hitsplatOffset = this.resolvePlayerHitsplatOffset(
                    playerAnchorIdx,
                    localPlayerHeightFallback,
                );
                const healthBarOffset =
                    this.resolvePlayerLogicalHeightTiles(
                        playerAnchorIdx,
                        localPlayerHeightFallback,
                    ) +
                    15 / 128;
                const playerServerId = this.getEffectiveControlledPlayerId();
                const state =
                    playerServerId > 0 ? this.playerHitsplats.get(playerServerId) : undefined;
                if (state) {
                    for (
                        let slot = 0;
                        slot < 4 && hitsplats.length < hitsplatMaxEntries;
                        slot++
                    ) {
                        // OSRS Parity: Use client cycles and calculate visibility from end cycle
                        const animProgress = this.getHitsplatVisibility(state, slot, clientCycle);
                        if (animProgress === undefined) continue;
                        const entry = this.acquireHitsplatEntry();
                        entry.worldX = playerWorldX;
                        entry.worldZ = playerWorldZ;
                        entry.plane = playerLevel;
                        entry.heightOffsetTiles = hitsplatOffset;
                        entry.damage = state.hitSplatValues[slot] | 0;
                        entry.count = 1;
                        entry.color = undefined;
                        entry.scale = 1.0;
                        entry.variant = slot & 3;
                        entry.style = state.hitSplatTypes[slot] | 0;
                        entry.type2 = state.hitSplatTypes2[slot] | 0;
                        entry.damage2 = state.hitSplatValues2[slot] | 0;
                        entry.animProgress = animProgress;
                        hitsplats.push(entry);
                    }
                }
                if (playerServerId > 0) {
                    this.appendActorHealthBars(
                        this.playerHealthBars,
                        playerServerId,
                        "player",
                        playerWorldX,
                        playerWorldZ,
                        playerLevel,
                        healthBarOffset,
                        healthBars,
                        clientCycle,
                        healthBarMaxEntries,
                    );
                }
            }

            try {
                const pe = this.osrsClient.playerEcs;
                const count = pe.size?.() ?? (pe as any).size?.() ?? 0;
                if (count > 0) {
                    for (let i = 0; i < count; i++) {
                        if (overheadTexts.length >= overheadTextMaxEntries) break;
                        if (!this.shouldRenderPlayerIndex(i)) continue;
                        const chatState = pe.getOverheadChat(i);
                        if (!chatState) continue;
                        const px = pe.getX(i) | 0;
                        const py = pe.getY(i) | 0;
                        const worldX = px / 128.0;
                        const worldZ = py / 128.0;
                        const plane = pe.getLevel(i) | 0;
                        const overhead = this.acquireOverheadTextEntry();
                        overhead.worldX = worldX;
                        overhead.worldZ = worldZ;
                        overhead.plane = plane;
                        const text = chatState.text;
                        if (!text || text.length === 0) {
                            this.overheadTextPool.push(overhead);
                            continue;
                        }

                        overhead.text = text;
                        overhead.color = this.mapOverheadColor(chatState.color);
                        overhead.colorId =
                            typeof chatState.color === "number" &&
                            chatState.color >= 0 &&
                            chatState.color < 0x100
                                ? chatState.color | 0
                                : undefined;
                        overhead.effect = chatState.effect ?? 0;
                        overhead.modIcon = this.resolveModIcon(chatState.modIcon);
                        overhead.pattern = chatState.pattern;
                        const duration =
                            chatState.duration && chatState.duration > 0 ? chatState.duration : 1;
                        const remaining = Math.max(
                            0,
                            Math.min(duration, chatState.remaining ?? duration),
                        );
                        overhead.duration = duration;
                        overhead.remaining = remaining;
                        overhead.life = this.computeOverheadAlpha(overhead);
                        overhead.heightOffsetTiles = this.resolvePlayerLogicalHeightTiles(
                            i,
                            playerDefaultHeightTiles,
                        );
                        overheadTexts.push(overhead);
                    }
                }
            } catch {}

            // NPC overhead text (forced chat / say)
            try {
                const ne = this.osrsClient.npcEcs;
                ne.forEachActive((ecsId: number) => {
                    const chatState = ne.getOverheadText(ecsId);
                    if (!chatState) return;
                    if (overheadTexts.length >= overheadTextMaxEntries) return;
                    const text = chatState.text;
                    if (!text || text.length === 0) return;
                    const localX = ne.getX(ecsId) | 0;
                    const localY = ne.getY(ecsId) | 0;
                    const mid = (ne as any).mapId?.[ecsId] ?? 0;
                    const mapX = (mid >> 8) & 0xff;
                    const mapY = mid & 0xff;
                    const worldX = mapX * 64 + localX / 128.0;
                    const worldZ = mapY * 64 + localY / 128.0;
                    const plane = ne.getLevel(ecsId) | 0;
                    const overhead = this.acquireOverheadTextEntry();
                    overhead.worldX = worldX;
                    overhead.worldZ = worldZ;
                    overhead.plane = plane;
                    overhead.text = text;
                    overhead.color = this.mapOverheadColor(0);
                    overhead.colorId = 0;
                    overhead.effect = 0;
                    overhead.modIcon = undefined;
                    overhead.pattern = undefined;
                    const duration = 100;
                    const remaining = Math.max(0, Math.min(duration, chatState.remaining));
                    overhead.duration = duration;
                    overhead.remaining = remaining;
                    overhead.life = this.computeOverheadAlpha(overhead);
                    const npcTypeId = ne.getNpcTypeId(ecsId) | 0;
                    const npcHeight = npcTypeId > 0 ? this.getNpcDefaultHeight(npcTypeId) : 200;
                    overhead.heightOffsetTiles = Math.max(0.5, npcHeight / 128.0);
                    overheadTexts.push(overhead);
                });
            } catch {}

            // Render overhead prayer icons for all players
            // Reference: class386.java lines 345-356 in deobfuscated client
            try {
                const pe = this.osrsClient.playerEcs;
                const count = pe.size?.() ?? (pe as any).size?.() ?? 0;
                if (count > 0) {
                    for (let i = 0; i < count; i++) {
                        if (overheadPrayers.length >= overheadPrayerMaxEntries) break;
                        if (!this.shouldRenderPlayerIndex(i)) continue;
                        const headIconPrayer = pe.getHeadIconPrayer(i);
                        if (headIconPrayer < 0) continue;

                        const px = pe.getX(i) | 0;
                        const py = pe.getY(i) | 0;
                        const worldX = px / 128.0;
                        const worldZ = py / 128.0;
                        const plane = pe.getLevel(i) | 0;

                        const entry = this.acquireOverheadPrayerEntry();
                        entry.worldX = worldX;
                        entry.worldZ = worldZ;
                        entry.plane = plane;
                        entry.headIconPrayer = headIconPrayer;
                        // Position above the player head, above any health bars/hitsplats
                        entry.heightOffsetTiles = this.resolvePlayerHeadIconOffset(
                            i,
                            playerDefaultHeightTiles,
                        );
                        overheadPrayers.push(entry);
                    }
                }
            } catch {}

            // Render hitsplats for other players
            try {
                const pe = this.osrsClient.playerEcs;
                const count = pe.size?.() ?? (pe as any).size?.() ?? 0;
                if (count > 0 && this.playerHitsplats.size > 0) {
                    const controlledId = this.getEffectiveControlledPlayerId();
                    for (let i = 0; i < count; i++) {
                        if (
                            hitsplats.length >= hitsplatMaxEntries &&
                            healthBars.length >= healthBarMaxEntries
                        ) {
                            break;
                        }
                        if (!this.shouldRenderPlayerIndex(i)) continue;

                        // Get server ID for this player
                        const serverId = pe.getServerIdForIndex?.(i);
                        if (!serverId || serverId === controlledId) continue; // Skip controlled player (already rendered above)

                        // Check if this player has hitsplats
                        const state = this.playerHitsplats.get(serverId);
                        if (!state) continue;

                        const px = pe.getX(i) | 0;
                        const py = pe.getY(i) | 0;
                        const worldX = px / 128.0;
                        const worldZ = py / 128.0;
                        const plane = pe.getLevel(i) | 0;

                        const playerHeightFallback = pe.getDefaultHeightTiles?.(i) ?? 200 / 128;
                        const hitsplatOffset = this.resolvePlayerHitsplatOffset(
                            i,
                            playerHeightFallback,
                        );
                        const healthBarOffset =
                            this.resolvePlayerLogicalHeightTiles(i, playerHeightFallback) +
                            15 / 128;

                        for (
                            let slot = 0;
                            slot < 4 && hitsplats.length < hitsplatMaxEntries;
                            slot++
                        ) {
                            // OSRS Parity: Use client cycles and calculate visibility from end cycle
                            const animProgress = this.getHitsplatVisibility(
                                state,
                                slot,
                                clientCycle,
                            );
                            if (animProgress === undefined) continue;
                            const entry = this.acquireHitsplatEntry();
                            entry.worldX = worldX;
                            entry.worldZ = worldZ;
                            entry.plane = plane;
                            entry.heightOffsetTiles = hitsplatOffset;
                            entry.damage = state.hitSplatValues[slot] | 0;
                            entry.count = 1;
                            entry.color = undefined;
                            entry.scale = 1.0;
                            entry.variant = slot & 3;
                            entry.style = state.hitSplatTypes[slot] | 0;
                            entry.type2 = state.hitSplatTypes2[slot] | 0;
                            entry.damage2 = state.hitSplatValues2[slot] | 0;
                            entry.animProgress = animProgress;
                            hitsplats.push(entry);
                        }

                        // Add health bar for this player
                        if (serverId > 0 && healthBars.length < healthBarMaxEntries) {
                            this.appendActorHealthBars(
                                this.playerHealthBars,
                                serverId,
                                "player",
                                worldX,
                                worldZ,
                                plane,
                                healthBarOffset,
                                healthBars,
                                clientCycle,
                                healthBarMaxEntries,
                            );
                        }
                    }
                }
            } catch {}

            try {
                if (this.objectIdOverlay) {
                    this.objectIdOverlay.radius = Math.max(
                        1,
                        (this.osrsClient.renderDistance / 8) | 0,
                    );
                    this.objectIdOverlay.enabled = !!this.osrsClient.showObjectTileIds;
                }
                if (this.walkableOverlay) {
                    this.walkableOverlay.radius = Math.max(
                        1,
                        this.osrsClient.collisionOverlayRadius | 0 || 12,
                    );
                    this.walkableOverlay.enabled = !!this.osrsClient.showCollisionOverlay;
                }
            } catch {}

            const seen = this.hitsplatSeenNpc;
            seen.clear();
            const shouldProcessNpcOverlays =
                !!this.overlayManager &&
                (this.npcHitsplats.size > 0 || this.npcHealthBars.size > 0);
            if (shouldProcessNpcOverlays) {
                try {
                    const npcEcs = this.osrsClient.npcEcs;
                    for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
                        if (
                            hitsplats.length >= hitsplatMaxEntries &&
                            healthBars.length >= healthBarMaxEntries
                        ) {
                            break;
                        }
                        const map = this.mapManager.visibleMaps[i];
                        if (!map?.npcEntityIds || map.npcEntityIds.length === 0) continue;
                        for (let j = 0; j < map.npcEntityIds.length; j++) {
                            if (
                                hitsplats.length >= hitsplatMaxEntries &&
                                healthBars.length >= healthBarMaxEntries
                            ) {
                                break;
                            }
                            const ecsId = map.npcEntityIds[j] | 0;
                            if (ecsId <= 0 || seen.has(ecsId)) continue;
                            if (!this.shouldRenderNpcFromMap(map, ecsId)) continue;
                            if (!npcEcs.isActive(ecsId)) continue;
                            seen.add(ecsId);
                            const localX = npcEcs.getX(ecsId) | 0;
                            const localY = npcEcs.getY(ecsId) | 0;
                            const serverId = npcEcs.getServerId(ecsId) | 0;
                            if (serverId <= 0) continue;
                            const state = this.npcHitsplats.get(serverId);
                            const hb = this.npcHealthBars.get(serverId);
                            const hasHealth = !!hb && hb.bars.length > 0;
                            if (!hasHealth && !state) continue;
                            const npcMapId = npcEcs.getMapId(ecsId) | 0;
                            const npcMapX = (npcMapId >> 8) & 0xff;
                            const npcMapY = npcMapId & 0xff;
                            const baseWorldX = npcMapX * 64 + localX / 128.0;
                            const baseWorldZ = npcMapY * 64 + localY / 128.0;
                            // Use the NPC's raw render plane for height sampling.
                            // Height sampling (BridgePlaneStrategy.RENDER) already applies OSRS bridge promotion;
                            // using the pre-promoted occupancy plane here would double-apply it on bridge tiles,
                            // causing overhead overlays (health bars/hitsplats) to render at the wrong Y.
                            const plane = npcEcs.getLevel(ecsId) | 0;
                            const npcTypeId = npcEcs.getNpcTypeId?.(ecsId);
                            const overlayAnchor = this.resolveNpcOverlayAnchor(
                                ecsId,
                                baseWorldX,
                                baseWorldZ,
                                npcTypeId,
                            );
                            const worldX = overlayAnchor.worldX;
                            const worldZ = overlayAnchor.worldZ;
                            const hitsplatOffset = Math.max(
                                0.25,
                                overlayAnchor.logicalHeightTiles * 0.5,
                            );
                            const healthBarOffset = overlayAnchor.logicalHeightTiles + 15 / 128;
                            if (hasHealth && healthBars.length < healthBarMaxEntries) {
                                this.appendActorHealthBars(
                                    this.npcHealthBars,
                                    serverId,
                                    "npc",
                                    worldX,
                                    worldZ,
                                    plane,
                                    healthBarOffset,
                                    healthBars,
                                    clientCycle,
                                    healthBarMaxEntries,
                                );
                            }
                            if (!state) continue;
                            for (
                                let slot = 0;
                                slot < 4 && hitsplats.length < hitsplatMaxEntries;
                                slot++
                            ) {
                                // OSRS Parity: Use client cycles and calculate visibility from end cycle
                                const animProgress = this.getHitsplatVisibility(
                                    state,
                                    slot,
                                    clientCycle,
                                );
                                if (animProgress === undefined) continue;
                                const entry = this.acquireHitsplatEntry();
                                entry.worldX = worldX;
                                entry.worldZ = worldZ;
                                entry.plane = plane;
                                entry.heightOffsetTiles = hitsplatOffset;
                                entry.damage = state.hitSplatValues[slot] | 0;
                                entry.count = 1;
                                entry.color = undefined;
                                entry.scale = 1.0;
                                entry.variant = slot & 3;
                                entry.style = state.hitSplatTypes[slot] | 0;
                                entry.type2 = state.hitSplatTypes2[slot] | 0;
                                entry.damage2 = state.hitSplatValues2[slot] | 0;
                                entry.animProgress = animProgress;
                                hitsplats.push(entry);
                            }
                        }
                    }
                } catch {}
            }

            // Spot animations were previously collected from SpotAnimationManager; no-op now.

            if (playerWorldX != null && playerWorldZ != null) {
                const overlayEntries = this.osrsClient.getGroundItemOverlayEntries(
                    Math.floor(playerWorldX),
                    Math.floor(playerWorldZ),
                    playerLevel,
                    { radius: groundOverlayRadius, maxEntries: groundOverlayMaxEntries },
                );
                if (overlayEntries.length > 0) {
                    groundOverlayEntries = overlayEntries;
                } else {
                    try {
                        const camX = Math.floor(this.osrsClient.camera.getPosX());
                        const camY = Math.floor(this.osrsClient.camera.getPosZ());
                        const camLevel = resolveGroundItemStackPlane(this.getPlayerRawPlane() | 0);
                        const camEntries = this.osrsClient.getGroundItemOverlayEntries(
                            camX,
                            camY,
                            camLevel,
                            { radius: groundOverlayRadius, maxEntries: groundOverlayMaxEntries },
                        );
                        if (camEntries.length > 0) {
                            groundOverlayEntries = camEntries;
                        }
                    } catch {}
                }
            } else {
                try {
                    const peHs = this.osrsClient.playerEcs;
                    const idx = peHs.getIndexForServerId(this.osrsClient.controlledPlayerServerId);
                    if (idx !== undefined) {
                        const fallbackX = (peHs.getX(idx) / 128.0) | 0;
                        const fallbackY = (peHs.getY(idx) / 128.0) | 0;
                        const fallbackLevel = peHs.getLevel(idx) | 0;
                        const overlayEntries = this.osrsClient.getGroundItemOverlayEntries(
                            fallbackX,
                            fallbackY,
                            fallbackLevel,
                            { radius: groundOverlayRadius, maxEntries: groundOverlayMaxEntries },
                        );
                        if (overlayEntries.length > 0) {
                            groundOverlayEntries = overlayEntries;
                        }
                    }
                } catch {}
            }

            // Update login overlay game state
            if (this.loginOverlay) {
                this.loginOverlay.setGameState(this.osrsClient.gameState);
            }

            // Note: LoadingMessageOverlay subscribes to state machine directly,
            // so no need to manually call setGameState() here

            if (!this.uiHidden) {
                this.overlayManager?.update({
                    time,
                    delta: deltaTime,
                    resolution: { width: this.app.width, height: this.app.height },
                    state: {
                        hoverEnabled: !!this.osrsClient.hoverOverlayEnabled,
                        hoverTile: undefined,
                        playerLevel,
                        playerRawLevel,
                        destTile: undefined,
                        clientTickPhase: this.clientTickPhase,
                        playerFrameCount,
                        playerFreezeFrame: this.playerFreezeFrame,
                        playerFixedFrame: this.playerFixedFrame,
                        playerFrameHeightTiles: playerFrameHeights,
                        playerDefaultHeightTiles,
                        playerWorldX,
                        playerWorldZ,
                        hitsplats,
                        healthBars: healthBars.length > 0 ? healthBars : undefined,
                        overheadTexts: overheadTexts.length > 0 ? overheadTexts : undefined,
                        overheadPrayers: overheadPrayers.length > 0 ? overheadPrayers : undefined,
                        groundItems: groundOverlayEntries,
                        // spotAnimations removed
                    },
                    helpers: this.getOverlayHelpers(),
                });
                this.overlayManager?.draw(RenderPhase.ToFrameTexture);
            }
        } catch {}
        profiler.endPhase();

        this.app.disable(PicoGL.DEPTH_TEST);
        this.app.depthMask(false);

        this.app.disable(PicoGL.BLEND);

        profiler.startPhase("present");
        this.app.clearMask(PicoGL.COLOR_BUFFER_BIT | PicoGL.DEPTH_BUFFER_BIT);
        this.app.clearColor(0.0, 0.0, 0.0, 1.0);
        this.app.defaultDrawFramebuffer().clear();

        if (this.frameFxaaDrawCall && this.fxaaEnabled) {
            this.frameFxaaDrawCall.uniform("u_resolution", this.resolutionUni);
            this.frameFxaaDrawCall.texture("u_frame", this.textureFramebuffer.colorAttachments[0]);
            this.frameFxaaDrawCall.draw();
        } else {
            this.frameDrawCall.texture("u_frame", this.textureFramebuffer.colorAttachments[0]);
            this.frameDrawCall.draw();
        }
        profiler.endPhase();

        // Update and draw overlays (post-present).
        profiler.startPhase("overlayPost");
        try {
            const playerLevel = this.getPlayerBasePlane() | 0;
            const playerRawLevel = this.getPlayerRawPlane() | 0;
            const tileMarkersConfig = this.osrsClient.tileMarkersPlugin.getConfig();
            // Compute player world position for post-present overlays
            // Use current position (no interpolation) to match player model rendering
            let postPlayerWorldX: number | undefined = undefined;
            let postPlayerWorldZ: number | undefined = undefined;
            try {
                const idx = this.getControlledPlayerEcsIndex();
                if (idx !== undefined) {
                    const px = this.osrsClient.playerEcs.getX(idx) | 0;
                    const py = this.osrsClient.playerEcs.getY(idx) | 0;
                    postPlayerWorldX = px / 128.0;
                    postPlayerWorldZ = py / 128.0;
                }
            } catch {}
            // Keep devoverlay state synced
            try {
                if (this.objectIdOverlay) {
                    this.objectIdOverlay.radius = Math.max(
                        1,
                        (this.osrsClient.renderDistance / 8) | 0,
                    );
                    this.objectIdOverlay.enabled = !!this.osrsClient.showObjectTileIds;
                }
                if (this.walkableOverlay) {
                    this.walkableOverlay.radius = Math.max(
                        1,
                        this.osrsClient.collisionOverlayRadius | 0 || 12,
                    );
                    this.walkableOverlay.enabled = !!this.osrsClient.showCollisionOverlay;
                }
                this.syncTileMarkerOverlayConfig(tileMarkersConfig);
            } catch {}
            const args = this.ensureOverlayUpdateArgs(false);
            args.time = time;
            args.delta = deltaTime;
            args.resolution.width = this.app.width;
            args.resolution.height = this.app.height;
            this.populateTileMarkerOverlayState(
                args.state,
                tileMarkersConfig,
                playerLevel,
                playerRawLevel,
            );
            args.state.clientTickPhase = this.clientTickPhase;
            args.state.playerWorldX = postPlayerWorldX;
            args.state.playerWorldZ = postPlayerWorldZ;
            // Dev overlay: show non-interpolated server tiles for all actors (NPCs + Players)
            if (args.state.hoverEnabled) {
                // PERF: Reuse cached array instead of creating new one each frame
                const actorServerTiles = this.cachedActorServerTiles;
                this.cachedActorServerTilesCount = 0;

                // Players
                try {
                    const pe = this.osrsClient.playerEcs;
                    const n = pe.size() | 0;
                    const ms = this.osrsClient.playerMovementSync;
                    for (let i = 0; i < n; i++) {
                        const serverId = pe.getServerIdForIndex(i);
                        if (serverId === undefined || (serverId | 0) <= 0) continue;
                        const st = ms.getState(serverId | 0);
                        if (!st) continue;
                        // PERF: Reuse existing entry or create new one
                        const idx = this.cachedActorServerTilesCount++;
                        let entry = actorServerTiles[idx];
                        if (!entry) {
                            entry = {
                                x: 0,
                                y: 0,
                                plane: 0,
                                kind: "player",
                                serverId: 0,
                                label: "",
                            };
                            actorServerTiles[idx] = entry;
                        }
                        entry.x = st.tileX | 0;
                        entry.y = st.tileY | 0;
                        entry.plane = st.level | 0;
                        entry.kind = "player";
                        entry.serverId = serverId | 0;
                        entry.label = "";
                    }
                } catch {}

                // NPCs (visible maps only, like other devoverlays)
                try {
                    const npcEcs = this.osrsClient.npcEcs;
                    const seen = this.actorServerTilesSeenNpc;
                    seen.clear();
                    for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
                        const map = this.mapManager.visibleMaps[i];
                        if (!map?.npcEntityIds || map.npcEntityIds.length === 0) continue;
                        for (let j = 0; j < map.npcEntityIds.length; j++) {
                            const ecsId = map.npcEntityIds[j] | 0;
                            if (ecsId <= 0) continue;
                            if (!npcEcs.isActive(ecsId)) continue;
                            const serverId = npcEcs.getServerId(ecsId) | 0;
                            if (serverId <= 0) continue;
                            if (seen.has(serverId)) continue;
                            seen.add(serverId);
                            const st = npcEcs.getServerState(ecsId);
                            if (!st) continue;
                            let label = "";
                            try {
                                const tid = npcEcs.getNpcTypeId?.(ecsId) | 0;
                                if (tid > 0 && this.osrsClient.npcTypeLoader) {
                                    const base = this.osrsClient.npcTypeLoader.load(tid);
                                    let resolved = base;
                                    try {
                                        resolved =
                                            base.transform(
                                                this.osrsClient.varManager,
                                                this.osrsClient.npcTypeLoader,
                                            ) ?? base;
                                    } catch {}
                                    const resolvedId = resolved?.id | 0;
                                    const cached = this.npcNameCache.get(resolvedId);
                                    if (cached !== undefined) {
                                        label = cached;
                                    } else {
                                        const name =
                                            typeof resolved?.name === "string" &&
                                            resolved.name.length > 0 &&
                                            resolved.name !== "null"
                                                ? resolved.name
                                                : "";
                                        this.npcNameCache.set(resolvedId, name);
                                        label = name;
                                    }
                                }
                            } catch {}
                            // PERF: Reuse existing entry or create new one
                            const idx = this.cachedActorServerTilesCount++;
                            let entry = actorServerTiles[idx];
                            if (!entry) {
                                entry = {
                                    x: 0,
                                    y: 0,
                                    plane: 0,
                                    kind: "npc",
                                    serverId: 0,
                                    label: "",
                                };
                                actorServerTiles[idx] = entry;
                            }
                            entry.x = st.tileX | 0;
                            entry.y = st.tileY | 0;
                            entry.plane = st.plane | 0;
                            entry.kind = "npc";
                            entry.serverId = serverId;
                            entry.label = label;
                        }
                    }
                } catch {}

                // If multiple NPCs share the same name, append server id so each label is trackable.
                try {
                    // PERF: Reuse cached Map instead of creating new one each frame
                    const nameCounts = this.actorServerTilesNameCounts;
                    nameCounts.clear();
                    const count = this.cachedActorServerTilesCount;
                    for (let i = 0; i < count; i++) {
                        const e = actorServerTiles[i];
                        if (e.kind !== "npc") continue;
                        const name = e.label;
                        if (!name || name.length === 0) continue;
                        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
                    }
                    for (let i = 0; i < count; i++) {
                        const e = actorServerTiles[i];
                        if (e.kind !== "npc") continue;
                        const name = e.label;
                        if (!name || name.length === 0) continue;
                        if ((nameCounts.get(name) ?? 0) > 1) {
                            e.label = `${name} (${e.serverId | 0})`;
                        }
                    }
                } catch {}

                // PERF: Set array length directly instead of .slice() to avoid allocation
                const activeCount = this.cachedActorServerTilesCount;
                if (activeCount > 0) {
                    // Truncate array length to active count (reused entries beyond this are ignored)
                    actorServerTiles.length = activeCount;
                    args.state.actorServerTiles = actorServerTiles;
                } else {
                    args.state.actorServerTiles = undefined;
                }
            } else {
                args.state.actorServerTiles = undefined;
            }
            if (!this.uiHidden) {
                this.overlayManager?.update(args);
                this.overlayManager?.draw(RenderPhase.PostPresent);
            }
        } catch {}
        profiler.endPhase();

        let mapApplyCount = 0;
        // Load new map squares
        profiler.startPhase("mapApply");
        mapApplyCount += this.applyReadyStreamGenerationBatch(timeSec);
        const mapData = this.mapsToLoad.shift();
        if (mapData) {
            const firstMapId = getMapSquareId(mapData.mapX, mapData.mapY);
            const firstBatchId = this.queuedLocReloadBatchByMap.get(firstMapId);
            const toApply: SdMapData[] = [mapData];
            if (typeof firstBatchId === "number") {
                this.queuedLocReloadBatchByMap.delete(firstMapId);
                while (this.mapsToLoad.length > 0) {
                    const next = this.mapsToLoad.peekFront();
                    if (!next) break;
                    const nextMapId = getMapSquareId(next.mapX, next.mapY);
                    const nextBatchId = this.queuedLocReloadBatchByMap.get(nextMapId);
                    if (nextBatchId !== firstBatchId) break;
                    this.mapsToLoad.shift();
                    this.queuedLocReloadBatchByMap.delete(nextMapId);
                    toApply.push(next);
                }
            }

            for (const pendingMap of toApply) {
                if (!this.isValidMapData(pendingMap)) continue;
                mapApplyCount++;
                this.loadMap(
                    this.mainProgram,
                    this.mainAlphaProgram,
                    this.npcProgram,
                    this.textureArray,
                    this.textureMaterials,
                    this.sceneUniformBuffer,
                    pendingMap,
                    this.skipMapFadeIn ? -1.0 : timeSec,
                );
            }
        }
        profiler.endPhase();

        // Amortize expensive texture mipmap rebuilds outside the hot map-load path.
        profiler.startPhase("mipmaps");
        this.maybeRegenerateTextureMipmaps(time);
        profiler.endPhase();

        // Update positions for custom labels
        profiler.startPhase("labels");
        this.updateCustomLabels();
        profiler.endPhase();

        if (showDebugTimer || profileGpuTimer) {
            this.timer.end();
        }

        // Update public stats for devoverlay
        this.stats.drawBatches = this._frameBatches;
        this.stats.indicesSubmitted = this._frameIndices | 0;
        this.stats.trianglesSubmitted = (this._frameIndices / 3) | 0;
        this.stats.verticesSubmitted = this.stats.indicesSubmitted;
        this.stats.visibleMaps = this.mapManager.visibleMapCount | 0;
        this.stats.loadedMaps = this.mapManager.mapSquares.size | 0;

        const trackedPassIndices =
            opaqueIndices +
            opaqueActorIndices +
            transparentIndices +
            transparentNpcIndices +
            transparentPlayerIndices;
        const trackedPassBatches =
            opaqueBatches +
            opaqueActorBatches +
            transparentBatches +
            transparentNpcBatches +
            transparentPlayerBatches;
        const untrackedPassIndices = Math.max(0, this._frameIndices - trackedPassIndices);
        const untrackedPassBatches = Math.max(0, this._frameBatches - trackedPassBatches);

        // Record stats for profiler
        profiler.recordDrawCall(this.stats.drawBatches | 0, this.stats.trianglesSubmitted);
        profiler.recordGauge("visibleMaps", this.stats.visibleMaps);
        profiler.recordGauge("loadedMaps", this.stats.loadedMaps);
        profiler.recordGauge("fpsLimit", this.stats.frameBudgetMs > 0 ? 1000 / this.stats.frameBudgetMs : 0);
        profiler.recordGauge("frameBudgetMs", this.stats.frameBudgetMs);
        profiler.recordGauge("callbackDeltaMs", this.stats.callbackDeltaMs);
        profiler.recordGauge("estimatedRefreshHz", this.stats.estimatedRefreshHz);
        profiler.recordGauge("limiterSkippedCallbacks", this.stats.limiterSkippedCallbacks);
        profiler.recordGauge("limiterSkipDebtMs", this.stats.limiterSkipDebtMs);
        profiler.recordGauge("timeoutScheduler", this.stats.usedTimeoutScheduler ? 1 : 0);
        profiler.recordGauge("frameJsMs", Math.max(0, performance.now() - this.stats.frameTimeStart));
        profiler.recordGauge("resolutionScale", this.osrsClient.mobileEffectiveResolutionScale || 1);
        profiler.recordGauge("canvasPixelsMp", (this.app.width * this.app.height) / 1_000_000);
        profiler.recordGauge(
            "scenePixelsMp",
            (this.sceneRenderWidth * this.sceneRenderHeight) / 1_000_000,
        );
        profiler.recordGauge(
            "queuedMaps",
            ((this.mapsToLoad.length | 0) + (this.getPendingStreamMapCount() | 0)) | 0,
        );
        profiler.recordGauge("mapApplyCount", mapApplyCount | 0);
        profiler.recordGauge("pendingLocUpdates", this.pendingLocUpdates.size | 0);
        profiler.recordGauge("interactionHits", this.lastInteractionRaycastHitCount | 0);
        profiler.recordGauge("menuOptions", this.lastInteractionMenuOptionCount | 0);
        profiler.recordGauge("actorRenderCount", this.actorRenderCount | 0);
        profiler.recordGauge("groundItemMaps", this.groundItemStacks.size | 0);
        profiler.recordGauge("lodVisibleMaps", this.lastLodVisibleMapCount | 0);
        profiler.recordGauge("fullDetailVisibleMaps", this.lastFullDetailVisibleMapCount | 0);
        profiler.recordGauge(
            "distanceCulledVisibleMaps",
            this.lastDistanceCulledVisibleMapCount | 0,
        );
        profiler.recordGauge("renderDistanceTiles", this.getFrameRenderDistanceTiles() | 0);
        profiler.recordGauge("renderDistanceBaseTiles", this.osrsClient.renderDistance | 0);
        profiler.recordGauge("lodThreshold", this.lastLodThreshold | 0);
        profiler.recordGauge("roofPlaneLimit", this.lastRoofPlaneLimit | 0);
        profiler.recordGauge("roofFilteredRanges", this.frameRoofFilteredRangeCount | 0);
        profiler.recordGauge("roofTotalRanges", this.frameRoofTotalRangeCount | 0);
        profiler.recordGauge(
            "roofFilterPct",
            (this.frameRoofFilteredRangeCount / Math.max(1, this.frameRoofTotalRangeCount)) * 100,
        );
        profiler.recordGauge("triOpaque", (opaqueIndices / 3) | 0);
        profiler.recordGauge("triOpaqueActor", (opaqueActorIndices / 3) | 0);
        profiler.recordGauge("triTransparent", (transparentIndices / 3) | 0);
        profiler.recordGauge("triTranspNpc", (transparentNpcIndices / 3) | 0);
        profiler.recordGauge("triTranspPlayer", (transparentPlayerIndices / 3) | 0);
        profiler.recordGauge("triUntracked", (untrackedPassIndices / 3) | 0);
        profiler.recordGauge("batchOpaque", opaqueBatches | 0);
        profiler.recordGauge("batchOpaqueActor", opaqueActorBatches | 0);
        profiler.recordGauge("batchTransparent", transparentBatches | 0);
        profiler.recordGauge("batchTranspNpc", transparentNpcBatches | 0);
        profiler.recordGauge("batchTranspPlayer", transparentPlayerBatches | 0);
        profiler.recordGauge("batchUntracked", untrackedPassBatches | 0);
        this.finishRenderFrame(camera, deltaTime, showDebugTimer, profileGpuTimer);

        // Emote timers are advanced per-tick above.
    }

    private getControlledPlayerEcsIndex(): number | undefined {
        const playerEcs = this.osrsClient.playerEcs;
        const controlledServerId = this.osrsClient.controlledPlayerServerId | 0;

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

    // Prefer PlayerECS level if available; fallback to Player[0].level
    private getPlayerBasePlane(): number {
        let rawPlane = 0;
        const idx = this.getControlledPlayerEcsIndex();
        if (idx !== undefined) {
            rawPlane = this.osrsClient.playerEcs.getLevel(idx) | 0;
        }

        // OSRS-accurate: Promote plane based on bridge flags
        // If plane above has bridge flag (0x2), player renders at that plane
        const playerTile = this.getPlayerTileXY();
        if (!playerTile) {
            return rawPlane; // Can't check for bridges if we don't know the player's tile
        }

        return resolveBridgePromotedPlane(this.mapManager, rawPlane, playerTile);
    }

    private getPlayerRawPlane(): number {
        const idx = this.getControlledPlayerEcsIndex();
        if (idx !== undefined) return this.osrsClient.playerEcs.getLevel(idx) | 0;
        return 0;
    }

    // Player current tile (integer), prefer controlled player ECS position.
    private getPlayerTileXY(): { x: number; y: number } {
        const controlledIndex = this.getControlledPlayerEcsIndex();
        if (controlledIndex !== undefined) {
            return {
                x: (this.osrsClient.playerEcs.getX(controlledIndex) / 128) | 0,
                y: (this.osrsClient.playerEcs.getY(controlledIndex) / 128) | 0,
            };
        }
        // Fallback to camera tile if no player
        return {
            x: Math.floor(this.osrsClient.camera.getPosX()),
            y: Math.floor(this.osrsClient.camera.getPosZ()),
        };
    }

    private getCameraTileXY(): { x: number; y: number } {
        return {
            x: Math.floor(this.osrsClient.camera.getPosX()),
            y: Math.floor(this.osrsClient.camera.getPosZ()),
        };
    }

    private clampCullTileToGridBounds(tile: { x: number; y: number }): { x: number; y: number } {
        const bounds = this.mapManager.getGridTileBounds();
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

    private getRenderCullTile(_roofState?: RoofState): { x: number; y: number } {
        // OSRS scene draw-distance is camera-anchored (Scene_viewport tile), then clamped
        // to the current scene min/max bounds.
        return this.clampCullTileToGridBounds(this.getCameraTileXY());
    }

    private getRoofTargetTile(
        playerTile: { x: number; y: number },
        cameraTile: { x: number; y: number },
    ): { x: number; y: number } {
        if (this.osrsClient.followPlayerCamera) {
            // OSRS follow mode (oculusOrbState == 0): roof trace target is the immediate focal point,
            // which tracks the player tile, not the smoothed focal accumulator.
            this.orbFocalTile = { ...playerTile };
            return this.orbFocalTile;
        }

        // Free-camera mode fallback: no explicit orb focal state in this client path, so use camera tile.
        this.orbFocalTile = { ...cameraTile };
        return this.orbFocalTile;
    }

    private computeRoofState(): RoofState {
        const cameraTile = this.getCameraTileXY();
        const playerTile = this.getPlayerTileXY();
        const targetTile = this.getRoofTargetTile(playerTile, cameraTile);

        return computeRoofState(
            {
                mapManager: this.mapManager,
                osrsClient: this.osrsClient,
                maxLevel: this.maxLevel,
            },
            {
                playerRawPlane: this.getPlayerBasePlane() | 0,
                cameraTile,
                playerTile,
                targetTile,
            },
        );
    }

    private getRoofState(): RoofState {
        if (!this.roofState) {
            this.roofState = this.computeRoofState();
        }
        return this.roofState;
    }

    private ensureOverlayUpdateArgs(scenePass: boolean): OverlayUpdateArgs {
        const key = scenePass ? "cachedSceneOverlayUpdateArgs" : "cachedOverlayUpdateArgs";
        let args = this[key];
        if (!args) {
            args = {
                time: 0,
                delta: 0,
                resolution: { width: 0, height: 0 },
                state: {
                    hoverEnabled: false,
                    hoverTile: { x: 0, y: 0 },
                    playerLevel: 0,
                    playerRawLevel: 0,
                    destTile: undefined,
                    currentTile: undefined,
                    tileHighlights: undefined,
                    clientTickPhase: 0,
                    playerWorldX: undefined,
                    playerWorldZ: undefined,
                    actorServerTiles: undefined,
                },
                helpers: this.getOverlayHelpers(),
            };
            this[key] = args;
        }
        return args;
    }

    private syncTileMarkerOverlayConfig(tileMarkersConfig: TileMarkersPluginConfig): void {
        if (!this.tileMarkerOverlay) {
            return;
        }
        this.tileMarkerOverlay.setDestinationColor(tileMarkersConfig.destinationTileColor);
        this.tileMarkerOverlay.setCurrentTileColor(tileMarkersConfig.currentTileColor);
    }

    private populateTileMarkerOverlayState(
        state: OverlayUpdateArgs["state"],
        tileMarkersConfig: TileMarkersPluginConfig,
        playerLevel: number,
        playerRawLevel: number,
    ): void {
        state.hoverEnabled = !!this.osrsClient.hoverOverlayEnabled;
        if (this.hoverTileX !== -1 && this.hoverTileY !== -1) {
            if (!state.hoverTile) {
                state.hoverTile = { x: 0, y: 0 };
            }
            state.hoverTile.x = this.hoverTileX | 0;
            state.hoverTile.y = this.hoverTileY | 0;
        } else {
            state.hoverTile = undefined;
        }

        state.playerLevel = playerLevel;
        state.playerRawLevel = playerRawLevel;
        state.destTile = undefined;
        state.currentTile = undefined;

        const nativeTileHighlights = this.osrsClient.tileHighlightManager.getRenderEntries();
        state.tileHighlights = nativeTileHighlights.length > 0 ? nativeTileHighlights : undefined;

        if (!tileMarkersConfig.enabled) {
            return;
        }

        const nativeHasCurrentTile = this.osrsClient.tileHighlightManager.hasRenderableSlot(3);
        const nativeHasDestinationTile = this.osrsClient.tileHighlightManager.hasRenderableSlot(4);
        if (tileMarkersConfig.showDestinationTile && !nativeHasDestinationTile) {
            const destWorldX = ClientState.destinationWorldX | 0;
            const destWorldY = ClientState.destinationWorldY | 0;
            if (destWorldX !== 0 || destWorldY !== 0) {
                if (!state.destTile) {
                    state.destTile = { x: 0, y: 0 };
                }
                // Use stored world destination directly. Re-deriving from local destination
                // against a changing scene base causes marker drift during movement sync.
                state.destTile.x = destWorldX;
                state.destTile.y = destWorldY;
            } else {
                // Fallback for older state where only local destination may be populated.
                const destLocalX = ClientState.destinationX | 0;
                const destLocalY = ClientState.destinationY | 0;
                if (destLocalX !== 0 || destLocalY !== 0) {
                    if (!state.destTile) {
                        state.destTile = { x: 0, y: 0 };
                    }
                    state.destTile.x = ClientState.localToWorldX(destLocalX) | 0;
                    state.destTile.y = ClientState.localToWorldY(destLocalY) | 0;
                }
            }
        }

        if (!tileMarkersConfig.showCurrentTile || nativeHasCurrentTile) {
            return;
        }

        const controlledServerId = this.osrsClient.controlledPlayerServerId | 0;
        if (controlledServerId <= 0) {
            return;
        }

        const movementState = this.osrsClient.playerMovementSync?.getState?.(controlledServerId);
        if (!movementState) {
            return;
        }

        const ecsIndex = movementState.ecsIndex | 0;
        const isMoving = ecsIndex >= 0 && this.osrsClient.playerEcs.isMoving(ecsIndex);
        if (!isMoving) {
            return;
        }

        if (!state.currentTile) {
            state.currentTile = { x: 0, y: 0, plane: 0 };
        }
        state.currentTile.x = movementState.tileX | 0;
        state.currentTile.y = movementState.tileY | 0;
        state.currentTile.plane = movementState.level | 0;
    }

    private drawSceneTileOverlays(time: number, deltaTime: number): void {
        if (this.uiHidden || !this.overlayManager || !this.tileMarkerOverlay) {
            return;
        }

        const tileMarkersConfig = this.osrsClient.tileMarkersPlugin.getConfig();
        this.syncTileMarkerOverlayConfig(tileMarkersConfig);

        const playerLevel = this.getPlayerBasePlane() | 0;
        const playerRawLevel = this.getPlayerRawPlane() | 0;
        const args = this.ensureOverlayUpdateArgs(true);
        args.time = time;
        args.delta = deltaTime;
        args.resolution.width = this.app.width;
        args.resolution.height = this.app.height;
        this.populateTileMarkerOverlayState(
            args.state,
            tileMarkersConfig,
            playerLevel,
            playerRawLevel,
        );
        args.state.clientTickPhase = this.clientTickPhase;
        args.state.playerWorldX = undefined;
        args.state.playerWorldZ = undefined;
        args.state.actorServerTiles = undefined;
        args.state.hitsplats = undefined;
        args.state.healthBars = undefined;
        args.state.overheadTexts = undefined;
        args.state.overheadPrayers = undefined;
        args.state.groundItems = undefined;
        this.overlayManager.update(args);
        this.overlayManager.draw(RenderPhase.ToSceneFramebuffer);
    }

    // PERF: Lazily create and cache bound helper functions for overlay updates
    private getOverlayHelpers() {
        if (!this.cachedOverlayHelpers) {
            this.cachedOverlayHelpers = {
                getTileHeightAtPlane: this.getTileHeightAtPlane.bind(this),
                sampleHeightAtExactPlane: this.sampleHeightAtExactPlane.bind(this),
                getEffectivePlaneForTile: this.getEffectivePlaneForTile.bind(this),
                getOccupancyPlaneForTile: this.getOccupancyPlaneForTile.bind(this),
                getTileRenderFlagAt: this.getTileRenderFlagAt.bind(this),
                isBridgeSurfaceTile: this.isBridgeSurfaceTile.bind(this),
                worldToScreen: this.worldToScreen.bind(this),
                getCollisionFlagAt: this.getCollisionFlagAt.bind(this),
            };
        }
        return this.cachedOverlayHelpers;
    }

    // Expose raw tileRenderFlags for overlays (debug)
    private getTileRenderFlagAt(level: number, tileX: number, tileY: number): number {
        return lookupTileRenderFlagAt(this.mapManager, level, tileX, tileY);
    }

    /**
     * Mirror Client.field600 pressure update:
     * derive a terrain-driven minimum camera pitch from the focal point surroundings.
     */
    private updateCameraTerrainPitchPressure(
        focalSubX: number,
        focalSubZ: number,
        basePlane: number,
    ): void {
        const focalHeight = sampleBridgeHeightForWorldTile(
            this.mapManager,
            focalSubX / 128,
            focalSubZ / 128,
            basePlane,
            BridgePlaneStrategy.RENDER,
        );
        if (!focalHeight.valid) {
            return;
        }

        const focalTileX = focalSubX >> 7;
        const focalTileY = focalSubZ >> 7;
        const focalHeightWorldUnits = Math.round(focalHeight.height * 128);
        let maxDelta = 0;

        for (let tileX = focalTileX - 4; tileX <= focalTileX + 4; tileX++) {
            for (let tileY = focalTileY - 4; tileY <= focalTileY + 4; tileY++) {
                let samplePlane = Math.max(0, Math.min(3, basePlane | 0));
                if (
                    samplePlane < 3 &&
                    (lookupTileRenderFlagAt(this.mapManager, 1, tileX, tileY) & 0x2) === 0x2
                ) {
                    samplePlane++;
                }
                const tileHeightWorldUnits = this.sampleTileVertexHeightWorldUnits(
                    tileX,
                    tileY,
                    samplePlane,
                );
                if (tileHeightWorldUnits === undefined) continue;

                const delta = focalHeightWorldUnits - tileHeightWorldUnits;
                if (delta > maxDelta) {
                    maxDelta = delta;
                }
            }
        }

        let target = maxDelta * 192;
        if (target > 98048) target = 98048;
        if (target < 32768) target = 32768;

        const current = this.cameraTerrainPitchPressure | 0;
        if (target > current) {
            this.cameraTerrainPitchPressure = current + (((target - current) / 24) | 0);
        } else if (target < current) {
            this.cameraTerrainPitchPressure = current + (((target - current) / 80) | 0);
        }
    }

    private sampleTileVertexHeightWorldUnits(
        tileX: number,
        tileY: number,
        plane: number,
    ): number | undefined {
        const mapX = getMapIndexFromTile(tileX);
        const mapY = getMapIndexFromTile(tileY);
        const map = this.mapManager.getMap(mapX, mapY) as WebGLMapSquare | undefined;
        if (!map) return undefined;

        const localX = tileX - mapX * Scene.MAP_SQUARE_SIZE;
        const localY = tileY - mapY * Scene.MAP_SQUARE_SIZE;
        if (
            localX < 0 ||
            localY < 0 ||
            localX >= Scene.MAP_SQUARE_SIZE ||
            localY >= Scene.MAP_SQUARE_SIZE
        ) {
            return undefined;
        }

        const size = map.heightMapSize | 0;
        if (size <= 0) return undefined;
        const samplePlane = Math.max(0, Math.min(3, plane | 0));
        const base = samplePlane * size * size;
        const ix = localX + map.borderSize;
        const iz = localY + map.borderSize;
        const data = map.heightMapData as Int16Array;
        const texel = data[base + iz * size + ix] ?? 0;
        const worldUnits = (texel * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
        // World Y is negative-up.
        return -worldUnits;
    }

    public setCameraShakeSlot(
        slot: number,
        randomAmplitude: number,
        waveAmplitude: number,
        waveSpeed: number,
        phase: number = 0,
    ): void {
        const idx = slot | 0;
        if (idx < 0 || idx >= 5) return;
        this.cameraShakeEnabled[idx] = true;
        this.cameraShakeRandomAmplitude[idx] = randomAmplitude | 0;
        this.cameraShakeWaveAmplitude[idx] = waveAmplitude | 0;
        this.cameraShakeWaveSpeed[idx] = waveSpeed | 0;
        this.cameraShakeWavePhase[idx] = phase | 0;
        this.cameraShakeLastClientCycle = -1;
    }

    public clearCameraShakeSlot(slot: number): void {
        const idx = slot | 0;
        if (idx < 0 || idx >= 5) return;
        this.cameraShakeEnabled[idx] = false;
        this.cameraShakeRandomAmplitude[idx] = 0;
        this.cameraShakeWaveAmplitude[idx] = 0;
        this.cameraShakeWaveSpeed[idx] = 0;
        this.cameraShakeWavePhase[idx] = 0;
    }

    public clearCameraShake(): void {
        for (let i = 0; i < 5; i++) {
            this.clearCameraShakeSlot(i);
        }
        this.cameraShakeLastClientCycle = -1;
    }

    private computeCameraShakeOffsets(clientCycle: number): {
        x: number;
        y: number;
        z: number;
        yaw: number;
        pitch: number;
        active: boolean;
    } {
        if (this.cameraShakeLastClientCycle < 0) {
            this.cameraShakeLastClientCycle = clientCycle;
        }
        let cyclesElapsed = (clientCycle - this.cameraShakeLastClientCycle) | 0;
        if (cyclesElapsed < 0 || cyclesElapsed > 200) {
            cyclesElapsed = 1;
        }
        if (cyclesElapsed > 0) {
            this.cameraShakeLastClientCycle = clientCycle;
        }

        let x = 0;
        let y = 0;
        let z = 0;
        let yaw = 0;
        let pitch = 0;
        let active = false;

        for (let i = 0; i < 5; i++) {
            if (!this.cameraShakeEnabled[i]) continue;
            active = true;
            if (cyclesElapsed > 0) {
                this.cameraShakeWavePhase[i] = (this.cameraShakeWavePhase[i] + cyclesElapsed) | 0;
            }
            const randomAmp = this.cameraShakeRandomAmplitude[i] | 0;
            const waveAmp = this.cameraShakeWaveAmplitude[i] | 0;
            const waveSpeed = this.cameraShakeWaveSpeed[i] | 0;
            const randomTerm = Math.random() * (randomAmp * 2 + 1) - randomAmp;
            const waveTerm = Math.sin((this.cameraShakeWavePhase[i] * waveSpeed) / 100.0) * waveAmp;
            const value = (randomTerm + waveTerm) | 0;

            switch (i) {
                case 0:
                    x += value;
                    break;
                case 1:
                    y += value;
                    break;
                case 2:
                    z += value;
                    break;
                case 3:
                    yaw += value;
                    break;
                case 4:
                    pitch += value;
                    break;
            }
        }

        return { x, y, z, yaw, pitch, active };
    }

    private updateCameraFollow(deltaTime?: number, timeSec?: number): void {
        const pe = this.osrsClient.playerEcs;
        const playerEcsIndex = this.getControlledPlayerEcsIndex();
        if (playerEcsIndex === undefined) return;

        const px = pe.getX(playerEcsIndex) | 0;
        const py = pe.getY(playerEcsIndex) | 0;
        const playerX = px / 128;
        const playerZ = py / 128;

        // Update player position for fog calculation (use actual player pos)
        this.playerPosUni[0] = playerX;
        this.playerPosUni[1] = playerZ;

        // OSRS follow camera uses a smoothed focal point (oculusOrbFocalPointX/Y) that eases toward the player.
        // Important: update is tick-based (integer math), not frame-delta based; otherwise the camera/focal timebase
        // diverges from the tick interpolation timebase and introduces visible jitter at high refresh rates.
        const clientCycle = getClientCycle() | 0;
        const targetSubX = px;
        const targetSubZ = py;

        if (!this.followCamFocalInitialized || this.followCamFocalLastClientCycle < 0) {
            this.followCamFocalXSub = targetSubX;
            this.followCamFocalZSub = targetSubZ;
            this.followCamFocalLastClientCycle = clientCycle;
            this.followCamFocalInitialized = true;
        } else {
            const cyclesElapsed = (clientCycle - this.followCamFocalLastClientCycle) | 0;
            // If we fell behind a lot (tab background / stall), just resync.
            if (cyclesElapsed < 0 || cyclesElapsed > 32) {
                this.followCamFocalXSub = targetSubX;
                this.followCamFocalZSub = targetSubZ;
                this.followCamFocalLastClientCycle = clientCycle;
            } else if (cyclesElapsed > 0) {
                for (let i = 0; i < cyclesElapsed; i++) {
                    const dxFocal = targetSubX - this.followCamFocalXSub;
                    const dzFocal = targetSubZ - this.followCamFocalZSub;
                    // OSRS: snap focal if >500 sub-units away.
                    if (dxFocal < -500 || dxFocal > 500 || dzFocal < -500 || dzFocal > 500) {
                        this.followCamFocalXSub = targetSubX;
                        this.followCamFocalZSub = targetSubZ;
                    } else {
                        // OSRS: focal += (target - focal) / 16 (integer division).
                        if (dxFocal !== 0) this.followCamFocalXSub += (dxFocal / 16) | 0;
                        if (dzFocal !== 0) this.followCamFocalZSub += (dzFocal / 16) | 0;
                    }
                }
                this.followCamFocalLastClientCycle = clientCycle;
            }
        }

        const focalSubX = this.followCamFocalXSub;
        const focalSubZ = this.followCamFocalZSub;
        const basePlane = pe.getLevel(playerEcsIndex) | 0;
        this.updateCameraTerrainPitchPressure(focalSubX, focalSubZ, basePlane);

        const targetX = focalSubX / 128;
        const targetZ = focalSubZ / 128;

        // OSRS: vertical follow uses the player's height, not the smoothed focal point height.
        // (X/Z lag slightly, Y follows the player with camFollowHeight-style offset).
        const playerHeightSample = sampleBridgeHeightForWorldTile(
            this.mapManager,
            playerX,
            playerZ,
            basePlane,
            BridgePlaneStrategy.RENDER,
        );

        const camera = this.osrsClient.camera;
        // OSRS uses the effective viewport height after viewport-shape clamping,
        // not the raw canvas height, to derive follow-camera distance.
        const sceneViewport = this.getSceneViewportWidgetRect();
        const viewportWidth = sceneViewport.width || camera.viewportWidth || this.app.width;
        const viewportHeight = sceneViewport.height || camera.viewportHeight || this.app.height;
        const { viewportHeight: effectiveViewportHeight } = camera.computeViewportMetricsForSize(
            viewportWidth,
            viewportHeight,
        );

        // OSRS pitch -> distance mapping, with viewport-dependent zoom scaling
        // zoom = (zoomWidth - zoomHeight) * clamp(viewportHeight - 334, 0..100) / 100 + zoomHeight
        const v = clamp(effectiveViewportHeight - 334, 0, 100);
        const zoom =
            (this.osrsClient.zoomWidth - this.osrsClient.zoomHeight) * (v / 100) +
            this.osrsClient.zoomHeight;
        let camAngleX = camera.getScenePitchAngle();
        const terrainMinCamAngleX = (this.cameraTerrainPitchPressure | 0) >> 8;
        if (terrainMinCamAngleX > camAngleX) {
            camAngleX = terrainMinCamAngleX;
        }
        // OSRS parity: active pitch-shake also raises the minimum camera angle for orbit distance.
        if (this.cameraShakeEnabled[4]) {
            const shakeMinCamAngleX = (this.cameraShakeWaveAmplitude[4] | 0) + 128;
            if (shakeMinCamAngleX > camAngleX) {
                camAngleX = shakeMinCamAngleX;
            }
        }

        const yawRad = (camera.yaw - 1024) * RS_TO_RADIANS;
        const pitchRad = -camAngleX * RS_TO_RADIANS;

        // Build rotation matrix identical to the scene camera order (no translation).
        const rot = this.followCamRot;
        mat4.identity(rot);
        mat4.rotateY(rot, rot, yawRad);
        mat4.rotateZ(rot, rot, Math.PI);
        mat4.rotateX(rot, rot, pitchRad);

        // Camera forward in world space (camera looks down -Z).
        const forward = this.followCamForward;
        vec3.transformMat4(forward, this.followCamForwardAxis, rot);
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
        if (!this.mapDataLoadedNotified && timeSec !== undefined) {
            if (this.heightValidAtTime === undefined) {
                // First frame with valid height - record the time
                this.heightValidAtTime = timeSec;
            } else if (timeSec - this.heightValidAtTime >= 1.0) {
                // Fog animation complete (1 second elapsed) - notify loading tracker
                this.mapDataLoadedNotified = true;
                this.osrsClient.loadingTracker.markComplete(LoadingRequirement.MAP_DATA_LOADED);
            }
        }

        const focusHeightTiles = (this.osrsClient.camFollowHeight | 0) / 128.0;
        const targetY = playerHeightSample.height - focusHeightTiles;
        const desiredPosY = targetY - forward[1] * dist;

        // Prevent camera from going "behind" the ground (underground). World Y is negative-up,
        // so ensure camera Y target stays just above sampled ground height.
        const camHeightSample = sampleBridgeHeightForWorldTile(
            this.mapManager,
            desiredPosX,
            desiredPosZ,
            basePlane,
            BridgePlaneStrategy.RENDER,
        );
        // Use camera position height only if valid, otherwise use target height as fallback
        const groundAtCam = camHeightSample.valid
            ? camHeightSample.height
            : playerHeightSample.height;
        const eps = 0.05; // ~6.4 px in heightmap
        const minAllowedY = groundAtCam - eps;
        const clampedPosY = Math.round(Math.min(desiredPosY, minAllowedY) * 128) / 128;

        // Tight follow: snap camera height to the computed orbit position to keep the target stable in view.
        camera.snapToPosition(undefined, clampedPosY, undefined);
    }

    private getSceneViewportWidgetRect(): { x: number; y: number; width: number; height: number } {
        const widgetManager = this.osrsClient.widgetManager;
        const viewport = widgetManager?.viewportWidget as any;
        const fallbackWidth = Math.max(1, (this.app.width || this.canvas.width || 1) | 0);
        const fallbackHeight = Math.max(1, (this.app.height || this.canvas.height || 1) | 0);
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

    private clearSceneFramebuffer(viewportRect: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): void {
        this.app.clearColor(0.0, 0.0, 0.0, 1.0);
        this.app.clear();

        const left = Math.max(0, viewportRect.x | 0);
        const top = Math.max(0, viewportRect.y | 0);
        const right = Math.min(this.sceneRenderWidth | 0, (viewportRect.x + viewportRect.width) | 0);
        const bottom = Math.min(
            this.sceneRenderHeight | 0,
            (viewportRect.y + viewportRect.height) | 0,
        );
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        if (width <= 0 || height <= 0) {
            return;
        }

        this.gl.enable(this.gl.SCISSOR_TEST);
        this.gl.scissor(left, (this.sceneRenderHeight | 0) - bottom, width, height);
        this.gl.clearColor(this.skyColor[0], this.skyColor[1], this.skyColor[2], this.skyColor[3]);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.disable(this.gl.SCISSOR_TEST);
    }

    private updateHoveredTile(): void {
        const input = this.osrsClient.inputManager;
        if (!this.osrsClient.hoverOverlayEnabled) {
            this.hoverTileX = -1;
            this.hoverTileY = -1;
            this.osrsClient.hoveredTile = undefined;
            this.osrsClient.hoveredTileScreen = undefined;
            return;
        }
        if (input.isPointerLock()) {
            this.hoverTileX = -1;
            this.hoverTileY = -1;
            this.osrsClient.hoveredTile = undefined;
            this.osrsClient.hoveredTileScreen = undefined;
            return;
        }
        // While the context menu is visible, lock hover to the right-click position
        const useMenuAnchor = !!this.osrsClient.menuOpen;

        const mouseX = useMenuAnchor ? this.osrsClient.menuX : input.mouseX;
        const mouseY = useMenuAnchor ? this.osrsClient.menuY : input.mouseY;
        if ((mouseX === -1 || mouseY === -1) && !useMenuAnchor) {
            this.hoverTileX = -1;
            this.hoverTileY = -1;
            this.osrsClient.hoveredTile = undefined;
            this.osrsClient.hoveredTileScreen = undefined;
            return;
        }
        if (!this.osrsClient.camera.containsScreenPoint(mouseX, mouseY)) {
            this.hoverTileX = -1;
            this.hoverTileY = -1;
            this.osrsClient.hoveredTile = undefined;
            this.osrsClient.hoveredTileScreen = undefined;
            return;
        }

        // Build world ray from mouse (mouseX/mouseY already in canvas coordinates)
        const camera = this.osrsClient.camera;
        const width = camera.screenWidth || this.app.width;
        const height = camera.screenHeight || this.app.height;
        const nx = (2 * mouseX) / width - 1;
        const ny = 1 - (2 * mouseY) / height;

        // unproject from NDC to world using inverse view-projection
        mat4.invert(this.tmpInvViewProj, camera.viewProjMatrix);
        this.tmpNear[0] = nx;
        this.tmpNear[1] = ny;
        this.tmpNear[2] = -1;
        this.tmpNear[3] = 1;
        this.tmpFar[0] = nx;
        this.tmpFar[1] = ny;
        this.tmpFar[2] = 1;
        this.tmpFar[3] = 1;
        vec4.transformMat4(this.tmpNear, this.tmpNear, this.tmpInvViewProj);
        vec4.transformMat4(this.tmpFar, this.tmpFar, this.tmpInvViewProj);
        // perspective divide
        const nearW = this.tmpNear[3] || 1.0;
        const farW = this.tmpFar[3] || 1.0;
        this.tmpNear[0] /= nearW;
        this.tmpNear[1] /= nearW;
        this.tmpNear[2] /= nearW;
        this.tmpFar[0] /= farW;
        this.tmpFar[1] /= farW;
        this.tmpFar[2] /= farW;

        // Ray
        const origin = vec3.fromValues(this.tmpNear[0], this.tmpNear[1], this.tmpNear[2]);
        const farPos = vec3.fromValues(this.tmpFar[0], this.tmpFar[1], this.tmpFar[2]);
        vec3.subtract(this.tmpRayDir, farPos, origin);
        vec3.normalize(this.tmpRayDir, this.tmpRayDir);

        // Intersect the ray with the terrain heightfield instead of a flat plane.
        // March along the ray, bracket the crossing against y = height(x, z), then refine with binary search.
        const maxT = Math.max(1.0, vec3.distance(origin, farPos));
        // Fixed small step to robustly bracket intersections even at shallow angles
        const stepT = 0.25; // quarter-tile steps

        let lastT = 0.0;
        const basePlane = this.getPlayerBasePlane() | 0;
        // Use consistent height sampling that matches the effective plane we'll resolve to
        let lastYMinusH =
            origin[1] - this.getHeightForTileSelection(origin[0], origin[2], basePlane);
        let bestT = 0.0;
        let bestAbs = Math.abs(lastYMinusH);
        let hitX = Number.NaN;
        let hitZ = Number.NaN;

        for (let t = stepT, it = 0; t <= maxT && it < 32768; t += stepT, it++) {
            const x = origin[0] + this.tmpRayDir[0] * t;
            const y = origin[1] + this.tmpRayDir[1] * t;
            const z = origin[2] + this.tmpRayDir[2] * t;
            const yMinusH = y - this.getHeightForTileSelection(x, z, basePlane);

            // Detect a sign change crossing (either above->below or below->above)
            if ((lastYMinusH > 0 && yMinusH <= 0) || (lastYMinusH < 0 && yMinusH >= 0)) {
                // Bracketed: [lastT, t]. Binary search for better precision.
                let lo = lastT;
                let hi = t;
                for (let i = 0; i < 12; i++) {
                    const mid = (lo + hi) * 0.5;
                    const mx = origin[0] + this.tmpRayDir[0] * mid;
                    const my = origin[1] + this.tmpRayDir[1] * mid;
                    const mz = origin[2] + this.tmpRayDir[2] * mid;
                    const f = my - this.getHeightForTileSelection(mx, mz, basePlane);
                    if (f > 0) {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
                const finalT = hi;
                hitX = origin[0] + this.tmpRayDir[0] * finalT;
                hitZ = origin[2] + this.tmpRayDir[2] * finalT;
                break;
            }

            lastT = t;
            lastYMinusH = yMinusH;
        }

        if (Number.isNaN(hitX) || Number.isNaN(hitZ)) {
            // Fallback to nearest approach instead of flat y=0 plane
            const t = bestT;
            hitX = origin[0] + this.tmpRayDir[0] * t;
            hitZ = origin[2] + this.tmpRayDir[2] * t;
        }

        const resolved = this.resolveTileAndPlane(hitX, hitZ, basePlane);
        const tileX = resolved.tileX;
        const tileY = resolved.tileY;
        const effPlane = resolved.plane;
        this.hoverTileX = tileX;
        this.hoverTileY = tileY;

        // Update screen-space label position using tile center
        const centerX = tileX + 0.5;
        const centerY = tileY + 0.5;
        // Use exact plane height without promotion to match the tile we resolved
        const centerWorldY = this.sampleHeightAtExactPlane(centerX, centerY, effPlane);
        const screen = this.worldToScreen(centerX, centerWorldY - 0.1, centerY); // small offset up
        if (screen) {
            this.osrsClient.hoveredTile = { tileX, tileY, plane: effPlane };
            this.osrsClient.hoveredTileScreen = {
                x: screen[0],
                y: screen[1],
            };
        } else {
            this.osrsClient.hoveredTile = undefined;
            this.osrsClient.hoveredTileScreen = undefined;
        }
    }

    // Helper to get height at a position using the effective plane (not render plane)
    // This ensures height sampling matches the plane we'll resolve to for tile selection
    private getHeightForTileSelection(worldX: number, worldZ: number, basePlane: number): number {
        const tileX = Math.floor(worldX);
        const tileY = Math.floor(worldZ);
        const effectivePlane = this.getEffectivePlaneForTile(tileX, tileY, basePlane);
        // Sample height at the exact effective plane without any further promotion
        return this.sampleHeightAtExactPlane(worldX, worldZ, effectivePlane);
    }

    // Sample height at an exact plane without any bridge promotion
    private sampleHeightAtExactPlane(worldX: number, worldZ: number, plane: number): number {
        const mapX = getMapIndexFromTile(worldX);
        const mapY = getMapIndexFromTile(worldZ);
        const map = this.mapManager.getMap(mapX, mapY);
        if (!map || !map.heightMapData) {
            return 0;
        }

        const localPxX = Math.floor((worldX - mapX * 64) * 128);
        const localPxZ = Math.floor((worldZ - mapY * 64) * 128);

        let tileX = localPxX >> 7;
        let tileZ = localPxZ >> 7;
        tileX = Math.max(0, Math.min(63, tileX));
        tileZ = Math.max(0, Math.min(63, tileZ));

        const offX = localPxX & 0x7f;
        const offZ = localPxZ & 0x7f;

        const size = map.heightMapSize as number;
        // Use the plane directly without any promotion - this is the key difference
        const samplePlane = Math.max(0, Math.min(3, plane | 0));
        const base = samplePlane * size * size;

        const ix = tileX + map.borderSize;
        const iz = tileZ + map.borderSize;
        const ix1 = Math.min(ix + 1, size - 1);
        const iz1 = Math.min(iz + 1, size - 1);

        const data = map.heightMapData as Int16Array;
        // Match GPU height sampling (see `height-map.glsl`): texel * 8 gives world-unit magnitude.
        // Scale into world units before interpolation to preserve OSRS integer truncation behavior.
        const h00 = ((data[base + iz * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
        const h10 = ((data[base + iz * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
        const h01 = ((data[base + iz1 * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
        const h11 = ((data[base + iz1 * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;

        const delta0 = (h00 * (128 - offX) + h10 * offX) >> 7;
        const delta1 = (h01 * (128 - offX) + h11 * offX) >> 7;
        const hWorld = (delta0 * (128 - offZ) + delta1 * offZ) >> 7;
        return -(hWorld / 128.0);
    }

    // Compute tile from a given screen-space position (in canvas coordinates)
    private computeTileAt(
        mouseX: number,
        mouseY: number,
    ): { tileX: number; tileY: number; plane: number } | undefined {
        if (mouseX === -1 || mouseY === -1) return undefined;
        const camera = this.osrsClient.camera;
        if (!camera.containsScreenPoint(mouseX, mouseY)) return undefined;
        const width = camera.screenWidth || this.app.width;
        const height = camera.screenHeight || this.app.height;
        // mouseX/mouseY are in canvas coordinates, same as width/height
        const nx = (2 * mouseX) / width - 1;
        const ny = 1 - (2 * mouseY) / height;

        // unproject from NDC to world using inverse view-projection
        mat4.invert(this.tmpInvViewProj, camera.viewProjMatrix);
        this.tmpNear[0] = nx;
        this.tmpNear[1] = ny;
        this.tmpNear[2] = -1;
        this.tmpNear[3] = 1;
        this.tmpFar[0] = nx;
        this.tmpFar[1] = ny;
        this.tmpFar[2] = 1;
        this.tmpFar[3] = 1;
        vec4.transformMat4(this.tmpNear, this.tmpNear, this.tmpInvViewProj);
        vec4.transformMat4(this.tmpFar, this.tmpFar, this.tmpInvViewProj);
        // perspective divide
        const nearW = this.tmpNear[3] || 1.0;
        const farW = this.tmpFar[3] || 1.0;
        this.tmpNear[0] /= nearW;
        this.tmpNear[1] /= nearW;
        this.tmpNear[2] /= nearW;
        this.tmpFar[0] /= farW;
        this.tmpFar[1] /= farW;
        this.tmpFar[2] /= farW;

        const origin = vec3.fromValues(this.tmpNear[0], this.tmpNear[1], this.tmpNear[2]);
        const farPos = vec3.fromValues(this.tmpFar[0], this.tmpFar[1], this.tmpFar[2]);
        vec3.subtract(this.tmpRayDir, farPos, origin);
        vec3.normalize(this.tmpRayDir, this.tmpRayDir);

        // Heightfield intersection
        const maxT = Math.max(1.0, vec3.distance(origin, farPos));
        const stepT = 0.25;
        let lastT = 0.0;
        const basePlane2 = this.getPlayerBasePlane() | 0;
        // Use consistent height sampling that matches the effective plane we'll resolve to
        let lastYMinusH =
            origin[1] - this.getHeightForTileSelection(origin[0], origin[2], basePlane2);
        let bestT = 0.0;
        let bestAbs = Math.abs(lastYMinusH);
        let hitX = Number.NaN;
        let hitZ = Number.NaN;
        for (let t = stepT, it = 0; t <= maxT && it < 32768; t += stepT, it++) {
            const x = origin[0] + this.tmpRayDir[0] * t;
            const y = origin[1] + this.tmpRayDir[1] * t;
            const z = origin[2] + this.tmpRayDir[2] * t;
            const yMinusH = y - this.getHeightForTileSelection(x, z, basePlane2);
            // Track nearest approach as robust fallback
            const absVal = Math.abs(yMinusH);
            if (absVal < bestAbs) {
                bestAbs = absVal;
                bestT = t;
            }
            if ((lastYMinusH > 0 && yMinusH <= 0) || (lastYMinusH < 0 && yMinusH >= 0)) {
                let lo = lastT;
                let hi = t;
                for (let i = 0; i < 12; i++) {
                    const mid = (lo + hi) * 0.5;
                    const mx = origin[0] + this.tmpRayDir[0] * mid;
                    const my = origin[1] + this.tmpRayDir[1] * mid;
                    const mz = origin[2] + this.tmpRayDir[2] * mid;
                    const f = my - this.getHeightForTileSelection(mx, mz, basePlane2);
                    if (f > 0) lo = mid;
                    else hi = mid;
                }
                const finalT = hi;
                hitX = origin[0] + this.tmpRayDir[0] * finalT;
                hitZ = origin[2] + this.tmpRayDir[2] * finalT;
                break;
            }
            lastT = t;
            lastYMinusH = yMinusH;
        }
        if (Number.isNaN(hitX) || Number.isNaN(hitZ)) {
            // Fallback: take nearest approach to height surface along the ray
            const t = bestT;
            hitX = origin[0] + this.tmpRayDir[0] * t;
            hitZ = origin[2] + this.tmpRayDir[2] * t;
        }
        const tileCoords = this.resolveTileAndPlane(hitX, hitZ, basePlane2);
        return { tileX: tileCoords.tileX, tileY: tileCoords.tileY, plane: tileCoords.plane };
    }

    private worldToScreen(x: number, y: number, z: number): number[] | Float32Array | undefined {
        const camera = this.osrsClient.camera;
        const p = vec4.fromValues(x, y, z, 1);
        const out = vec4.create();
        vec4.transformMat4(out, p, camera.viewMatrix);
        vec4.transformMat4(out, out, camera.projectionMatrix);
        if (out[3] === 0) return undefined;
        const ndcX = out[0] / out[3];
        const ndcY = out[1] / out[3];
        const screenWidth = camera.screenWidth || this.app.width;
        const screenHeight = camera.screenHeight || this.app.height;
        const sx = (ndcX + 1) * 0.5 * screenWidth;
        const sy = (1 - (ndcY + 1) * 0.5) * screenHeight;
        // Return as array instead of vec2
        return [sx, sy];
    }

    // Convert a DOM mouse event or current menu/input anchor to canvas coords.
    private toGLClickXY(evt?: MouseEvent): { sx: number; sy: number } {
        if (evt) {
            const rect = this.canvas.getBoundingClientRect();
            const cx = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
            const cy = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
            return {
                sx: cx | 0,
                sy: cy | 0,
            };
        }
        // Prefer pinned menu anchor; else current mouse position
        // These values are already in canvas coordinates from InputManager.
        const px =
            this.osrsClient.menuOpen && this.osrsClient.menuX >= 0
                ? this.osrsClient.menuX
                : this.osrsClient.inputManager.leftClickX !== -1
                ? this.osrsClient.inputManager.leftClickX
                : this.osrsClient.inputManager.mouseX;
        const py =
            this.osrsClient.menuOpen && this.osrsClient.menuY >= 0
                ? this.osrsClient.menuY
                : this.osrsClient.inputManager.leftClickY !== -1
                ? this.osrsClient.inputManager.leftClickY
                : this.osrsClient.inputManager.mouseY;
        return { sx: px | 0, sy: py | 0 };
    }

    private getInteractHighlightDrawTargets(): ReadonlyArray<InteractHighlightDrawTarget> {
        const out = this.interactHighlightDrawTargets;
        out.length = 0;

        const config = this.osrsClient.interactHighlightPlugin.getConfig();
        if (!config.enabled) return out;

        this.syncInteractHighlightActiveTargetFromLocalInteraction();
        this.maybeExpireInteractHighlightTarget();

        if (config.showInteract && this.interactHighlightActiveTarget) {
            const trianglePoints = this.buildHighlightTrianglePoints(
                this.interactHighlightActiveTarget,
            );
            if (trianglePoints && trianglePoints.length >= 3) {
                out.push({
                    trianglePoints,
                    color: config.interactColor,
                    alpha: 0.45,
                });
            }
        }

        if (config.showHover && this.interactHighlightHoverTarget) {
            const showingActive =
                config.showInteract &&
                this.isSameInteractHighlightTarget(
                    this.interactHighlightHoverTarget,
                    this.interactHighlightActiveTarget,
                );
            if (!showingActive) {
                const trianglePoints = this.buildHighlightTrianglePoints(
                    this.interactHighlightHoverTarget,
                );
                if (trianglePoints && trianglePoints.length >= 3) {
                    out.push({
                        trianglePoints,
                        color: config.hoverColor,
                        alpha: 0.45,
                    });
                }
            }
        }

        return out;
    }

    private syncInteractHighlightActiveTargetFromLocalInteraction(): void {
        const interactionTarget = this.resolveInteractHighlightTargetFromLocalInteraction();
        if (interactionTarget) {
            if (
                !this.isSameInteractHighlightTarget(
                    interactionTarget,
                    this.interactHighlightActiveTarget,
                )
            ) {
                this.interactHighlightActiveTarget = interactionTarget;
            }
            this.interactHighlightClickTick = -1;
            this.interactHighlightActiveFromInteraction = true;
            return;
        }

        if (this.interactHighlightActiveFromInteraction) {
            this.clearInteractHighlightActiveTarget();
        }
    }

    private resolveInteractHighlightTargetFromLocalInteraction():
        | InteractHighlightTarget
        | undefined {
        const controlledServerId = this.osrsClient.controlledPlayerServerId | 0;
        if (controlledServerId < 0) return undefined;

        const playerEcs = this.osrsClient.playerEcs;
        const controlledEcsId = playerEcs.getIndexForServerId(controlledServerId);
        if (controlledEcsId === undefined) return undefined;

        const interactionIndex = playerEcs.getInteractionIndex(controlledEcsId) | 0;
        if (interactionIndex < 0) return undefined;

        const decoded = decodeInteractionIndex(interactionIndex);
        if (!decoded) return undefined;
        if (decoded.type !== "npc") return undefined;

        return this.resolveNpcHighlightTargetFromServerId(decoded.id | 0);
    }

    private maybeExpireInteractHighlightTarget(): void {
        if (!this.interactHighlightActiveTarget) return;
        if (this.interactHighlightActiveTarget.kind === "loc") {
            if (!this.isLocHighlightTargetStillPresent(this.interactHighlightActiveTarget)) {
                this.clearInteractHighlightActiveTarget();
                return;
            }
        }
        if (this.interactHighlightActiveFromInteraction) return;
        const clickTick = this.interactHighlightClickTick | 0;
        if (clickTick < 0) return;
        if (!this.hasActiveDestinationMarker() && (getCurrentTick() | 0) > clickTick) {
            this.clearInteractHighlightActiveTarget();
        }
    }

    private isLocHighlightTargetStillPresent(target: LocHighlightTarget): boolean {
        // Clear highlight if the player changed planes (e.g. climbing stairs)
        if ((this.getPlayerBasePlane() | 0) !== (target.plane | 0)) {
            return false;
        }
        const typeRot = this.resolveLocTypeRotAtTile(
            target.locId | 0,
            target.tileX | 0,
            target.tileY | 0,
            target.plane | 0,
        );
        if (typeof typeRot !== "number") {
            return false;
        }
        target.locModelType = (typeRot & 0x3f) | 0;
        target.locRotation = ((typeRot >> 6) & 0x3) | 0;
        return true;
    }

    private hasActiveDestinationMarker(): boolean {
        return (ClientState.destinationX | 0) !== 0 || (ClientState.destinationY | 0) !== 0;
    }

    private isSameInteractHighlightTarget(
        a: InteractHighlightTarget | undefined,
        b: InteractHighlightTarget | undefined,
    ): boolean {
        if (!a || !b) return false;
        if (a.kind !== b.kind) return false;
        if (a.kind === "loc" && b.kind === "loc") {
            return (
                (a.locId | 0) === (b.locId | 0) &&
                (a.tileX | 0) === (b.tileX | 0) &&
                (a.tileY | 0) === (b.tileY | 0) &&
                (a.plane | 0) === (b.plane | 0)
            );
        }
        if (a.kind === "npc" && b.kind === "npc") {
            return (a.serverId | 0) === (b.serverId | 0);
        }
        return false;
    }

    private buildHighlightTrianglePoints(
        target: InteractHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        if (target.kind === "loc") {
            return this.buildLocModelHighlightTriangles(target);
        }
        return this.buildNpcModelHighlightTriangles(target);
    }

    private getInteractLocModelLoader(): LocModelLoader | undefined {
        if (this.interactLocModelLoader) {
            return this.interactLocModelLoader;
        }
        const textureLoader = this.osrsClient.textureLoader;
        const modelLoader = this.osrsClient.modelLoader;
        const locTypeLoader = this.osrsClient.locTypeLoader;
        const seqTypeLoader = this.osrsClient.seqTypeLoader;
        const seqFrameLoader = this.osrsClient.seqFrameLoader;
        if (!textureLoader || !modelLoader || !locTypeLoader || !seqTypeLoader || !seqFrameLoader) {
            return undefined;
        }
        this.interactLocModelLoader = new LocModelLoader(
            locTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            this.osrsClient.skeletalSeqLoader,
        );
        return this.interactLocModelLoader;
    }

    private getInteractNpcModelLoader(): NpcModelLoader | undefined {
        if (this.interactNpcModelLoader) {
            return this.interactNpcModelLoader;
        }
        const textureLoader = this.osrsClient.textureLoader;
        const modelLoader = this.osrsClient.modelLoader;
        const npcTypeLoader = this.osrsClient.npcTypeLoader;
        const seqTypeLoader = this.osrsClient.seqTypeLoader;
        const seqFrameLoader = this.osrsClient.seqFrameLoader;
        if (!textureLoader || !modelLoader || !npcTypeLoader || !seqTypeLoader || !seqFrameLoader) {
            return undefined;
        }
        this.interactNpcModelLoader = new NpcModelLoader(
            npcTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            this.osrsClient.skeletalSeqLoader,
            this.osrsClient.varManager,
        );
        return this.interactNpcModelLoader;
    }

    private buildLocModelHighlightTriangles(
        target: LocHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        const locModelLoader = this.getInteractLocModelLoader();
        if (!locModelLoader) return undefined;

        let locType = this.osrsClient.locTypeLoader.load(target.locId | 0);
        if (!locType) return undefined;
        let sizeX = Math.max(1, Number(locType.sizeX ?? 1));
        let sizeY = Math.max(1, Number(locType.sizeY ?? 1));
        if (locType.transforms) {
            const transformed = locType.transform(
                this.osrsClient.varManager,
                this.osrsClient.locTypeLoader,
            );
            if (transformed) {
                locType = transformed;
            }
        }

        const rawType =
            typeof target.locModelType === "number" ? (target.locModelType | 0) & 0x3f : undefined;
        const rawRotation =
            typeof target.locRotation === "number" ? (target.locRotation | 0) & 0x3 : undefined;
        if (rawType === undefined || rawRotation === undefined) {
            return undefined;
        }

        let modelType = rawType;
        let modelRotation = rawRotation;
        if (modelType === LocModelType.NORMAL_DIAGIONAL) {
            modelType = LocModelType.NORMAL;
            modelRotation = (rawRotation + 4) & 0x7;
        }

        const model = locModelLoader.getModelAnimated(
            locType,
            modelType as LocModelType,
            modelRotation,
            -1,
            -1,
        );
        if (!model || !model.verticesX || !model.verticesY || !model.verticesZ) {
            return undefined;
        }

        if (rawRotation === 1 || rawRotation === 3) {
            const tmp = sizeX;
            sizeX = sizeY;
            sizeY = tmp;
        }
        const entityX = (target.tileX << 7) + (sizeX << 6);
        const entityZ = (target.tileY << 7) + (sizeY << 6);
        // Match SceneLoc rendering: loc geometry stays on its map level, but bridge tiles sample
        // height from the promoted render surface. Using exact plane height here puts highlights
        // under bridge walkways.
        const baseY = sampleBridgeHeightForWorldTile(
            this.mapManager,
            entityX / 128.0,
            entityZ / 128.0,
            target.plane | 0,
            BridgePlaneStrategy.RENDER,
        ).height;
        return this.buildModelTrianglePoints(model, (i) => ({
            x: (entityX + model.verticesX[i]) / 128.0,
            y: baseY + model.verticesY[i] / 128.0,
            z: (entityZ + model.verticesZ[i]) / 128.0,
        }));
    }

    private buildNpcModelHighlightTriangles(
        target: NpcHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        const npcEcs = this.osrsClient.npcEcs;
        const ecsId = target.ecsId | 0;
        if (!npcEcs.isActive(ecsId) || !npcEcs.isLinked(ecsId)) return undefined;
        if ((npcEcs.getServerId(ecsId) | 0) !== (target.serverId | 0)) return undefined;

        const npcModelLoader = this.getInteractNpcModelLoader();
        if (!npcModelLoader) return undefined;

        const npcTypeId = npcEcs.getNpcTypeId(ecsId) | 0;
        const npcType = this.osrsClient.npcTypeLoader.load(npcTypeId);
        if (!npcType) return undefined;

        const actionSeqId = npcEcs.getSeqId(ecsId) | 0;
        const actionDelay = npcEcs.getSeqDelay?.(ecsId) | 0;
        const { movementSeqId, idleSeqId } = this.resolveNpcMovementSequenceIds(npcEcs, ecsId);
        const actionActive = actionSeqId >= 0 && actionDelay === 0;
        const seqId = actionActive ? actionSeqId : movementSeqId;
        const frame = Math.max(
            0,
            actionActive
                ? npcEcs.getFrameIndex(ecsId) | 0
                : npcEcs.getMovementFrameIndex?.(ecsId) | 0,
        );
        const movementFrame = Math.max(0, npcEcs.getMovementFrameIndex?.(ecsId) | 0);
        const overlaySeqId =
            actionActive &&
            this.shouldLayerNpcMovementSequence(actionSeqId | 0, movementSeqId | 0, idleSeqId | 0)
                ? movementSeqId | 0
                : -1;

        let model =
            seqId >= 0
                ? npcModelLoader.getModel(
                      npcType,
                      seqId | 0,
                      frame | 0,
                      overlaySeqId | 0,
                      (overlaySeqId >= 0 ? movementFrame : -1) | 0,
                  )
                : undefined;
        if (!model) {
            model = npcModelLoader.getModel(npcType, -1, -1);
        }
        if (!model || !model.verticesX || !model.verticesY || !model.verticesZ) {
            return undefined;
        }
        const modelForTriangles = model;

        const mapId = npcEcs.getMapId(ecsId) | 0;
        const mapX = (mapId >> 8) & 0xff;
        const mapY = mapId & 0xff;
        const centerSceneX = (mapX << 13) + (npcEcs.getX(ecsId) | 0);
        const centerSceneZ = (mapY << 13) + (npcEcs.getY(ecsId) | 0);
        const plane = npcEcs.getLevel(ecsId) | 0;
        target.plane = plane;
        // Match NPC rendering/overlay height sampling on bridge tiles.
        const baseY = sampleBridgeHeightForWorldTile(
            this.mapManager,
            centerSceneX / 128.0,
            centerSceneZ / 128.0,
            plane | 0,
            BridgePlaneStrategy.RENDER,
        ).height;
        const angle = (npcEcs.getRotation(ecsId) | 0) * RS_TO_RADIANS;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        return this.buildModelTrianglePoints(modelForTriangles, (i) => {
            const vx = modelForTriangles.verticesX[i] | 0;
            const vz = modelForTriangles.verticesZ[i] | 0;
            // Match npc.vert.glsl exactly:
            // vec4(vertex.pos, 1.0) * rotationY(angle)
            const rx = vx * cos + vz * sin;
            const rz = -vx * sin + vz * cos;
            return {
                x: (centerSceneX + rx) / 128.0,
                y: baseY + modelForTriangles.verticesY[i] / 128.0,
                z: (centerSceneZ + rz) / 128.0,
            };
        });
    }

    private buildModelTrianglePoints(
        model: Model,
        mapVertex: (index: number) => { x: number; y: number; z: number },
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        if (!model.indices1 || !model.indices2 || !model.indices3) {
            return undefined;
        }
        const vertexCount = model.verticesCount | 0;
        if (vertexCount <= 0) return undefined;
        const faceCount = Math.min(
            model.faceCount | 0,
            model.indices1.length | 0,
            model.indices2.length | 0,
            model.indices3.length | 0,
        );
        if (faceCount <= 0) return undefined;

        const cachedX = new Float32Array(vertexCount);
        const cachedY = new Float32Array(vertexCount);
        const cachedZ = new Float32Array(vertexCount);
        const cachedState = new Uint8Array(vertexCount); // 0 unknown, 1 valid, 2 invalid
        const getWorldVertex = (index: number): { x: number; y: number; z: number } | undefined => {
            const state = cachedState[index] | 0;
            if (state === 1) {
                return {
                    x: cachedX[index],
                    y: cachedY[index],
                    z: cachedZ[index],
                };
            }
            if (state === 2) {
                return undefined;
            }
            const v = mapVertex(index);
            if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
                cachedState[index] = 2;
                return undefined;
            }
            cachedX[index] = v.x;
            cachedY[index] = v.y;
            cachedZ[index] = v.z;
            cachedState[index] = 1;
            return v;
        };

        const out: Array<readonly [number, number, number]> = [];
        for (let i = 0; i < faceCount; i++) {
            if (
                (model.faceColors3 && model.faceColors3[i] === -2) ||
                (model.faceAlphas && (model.faceAlphas[i] & 0xff) >= 254)
            ) {
                continue;
            }
            const a = model.indices1[i] | 0;
            const b = model.indices2[i] | 0;
            const c = model.indices3[i] | 0;
            if (
                a < 0 ||
                b < 0 ||
                c < 0 ||
                a >= vertexCount ||
                b >= vertexCount ||
                c >= vertexCount
            ) {
                continue;
            }

            const va = getWorldVertex(a);
            const vb = getWorldVertex(b);
            const vc = getWorldVertex(c);
            if (!va || !vb || !vc) continue;

            const abx = vb.x - va.x;
            const aby = vb.y - va.y;
            const abz = vb.z - va.z;
            const acx = vc.x - va.x;
            const acy = vc.y - va.y;
            const acz = vc.z - va.z;
            const nx = aby * acz - abz * acy;
            const ny = abz * acx - abx * acz;
            const nz = abx * acy - aby * acx;
            if (nx * nx + ny * ny + nz * nz <= 1e-10) continue;

            out.push([va.x, va.y, va.z], [vb.x, vb.y, vb.z], [vc.x, vc.y, vc.z]);
        }

        return out.length >= 3 ? out : undefined;
    }

    private clearInteractHighlightActiveTarget(): void {
        this.interactHighlightActiveTarget = undefined;
        this.interactHighlightActiveFromInteraction = false;
        this.interactHighlightClickTick = -1;
    }

    private clearInteractHighlightHoverTarget(): void {
        this.interactHighlightHoverTarget = undefined;
    }

    private resolveLocHighlightTargetFromEntry(
        entry: Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY"> | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): LocHighlightTarget | undefined {
        if (!entry) return undefined;
        if (entry.targetType !== MenuTargetType.LOC) return undefined;
        if (typeof entry.targetId !== "number") return undefined;

        const baseX = ClientState.baseX | 0;
        const baseY = ClientState.baseY | 0;
        const fallback =
            fallbackTile ??
            (this.osrsClient.menuTile
                ? {
                      tileX: this.osrsClient.menuTile.tileX | 0,
                      tileY: this.osrsClient.menuTile.tileY | 0,
                      plane:
                          typeof this.osrsClient.menuTile.plane === "number"
                              ? this.osrsClient.menuTile.plane | 0
                              : undefined,
                  }
                : undefined);
        let approx: { tileX: number; tileY: number; plane?: number } | undefined;
        if (typeof entry.mapX === "number" && typeof entry.mapY === "number") {
            approx = {
                tileX: (baseX + (entry.mapX | 0)) | 0,
                tileY: (baseY + (entry.mapY | 0)) | 0,
                plane:
                    typeof fallback?.plane === "number"
                        ? fallback.plane | 0
                        : this.getPlayerBasePlane() | 0,
            };
        } else if (fallback) {
            approx = {
                tileX: fallback.tileX | 0,
                tileY: fallback.tileY | 0,
                plane:
                    typeof fallback.plane === "number"
                        ? fallback.plane | 0
                        : this.getPlayerBasePlane() | 0,
            };
        }

        if (!approx) return undefined;

        const locId = entry.targetId | 0;
        const resolved = this.resolveLocInteractionTile(locId, approx);
        const plane =
            typeof resolved.plane === "number" ? resolved.plane | 0 : this.getPlayerBasePlane();
        const resolvedTypeRot =
            typeof resolved.typeRot === "number"
                ? (resolved.typeRot | 0) & 0xff
                : this.resolveLocTypeRotAtTile(
                      locId,
                      resolved.tileX | 0,
                      resolved.tileY | 0,
                      plane | 0,
                  );
        return {
            kind: "loc",
            locId,
            tileX: resolved.tileX | 0,
            tileY: resolved.tileY | 0,
            plane: plane | 0,
            locModelType:
                typeof resolvedTypeRot === "number" ? (resolvedTypeRot & 0x3f) | 0 : undefined,
            locRotation:
                typeof resolvedTypeRot === "number"
                    ? ((resolvedTypeRot >> 6) & 0x3) | 0
                    : undefined,
        };
    }

    private getNpcWorldTile(ecsId: number): { x: number; y: number } {
        const npcEcs = this.osrsClient.npcEcs;
        const mapId = npcEcs.getMapId(ecsId) | 0;
        const mapX = (mapId >> 8) & 0xff;
        const mapY = mapId & 0xff;
        const worldSubX = (mapX << 13) + (npcEcs.getX(ecsId) | 0);
        const worldSubY = (mapY << 13) + (npcEcs.getY(ecsId) | 0);
        return {
            x: (worldSubX >> 7) | 0,
            y: (worldSubY >> 7) | 0,
        };
    }

    private resolveNpcHighlightTargetFromEntry(
        entry: Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY"> | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): NpcHighlightTarget | undefined {
        if (!entry) return undefined;
        if (entry.targetType !== MenuTargetType.NPC) return undefined;
        const desiredNpcTypeId =
            typeof entry.targetId === "number" ? entry.targetId | 0 : undefined;
        const npcEcs = this.osrsClient.npcEcs;

        const baseX = ClientState.baseX | 0;
        const baseY = ClientState.baseY | 0;
        const fallback = fallbackTile ?? this.osrsClient.menuTile;
        const targetTile =
            typeof entry.mapX === "number" && typeof entry.mapY === "number"
                ? { x: (baseX + (entry.mapX | 0)) | 0, y: (baseY + (entry.mapY | 0)) | 0 }
                : fallback
                ? { x: fallback.tileX | 0, y: fallback.tileY | 0 }
                : undefined;

        let bestEcsId: number | undefined;
        let bestScore = Number.POSITIVE_INFINITY;
        const evaluateCandidate = (ecsId: number, enforceTypeMatch: boolean): void => {
            const id = ecsId | 0;
            if (!npcEcs.isActive(id) || !npcEcs.isLinked(id)) return;
            const typeId = npcEcs.getNpcTypeId(id) | 0;
            if (
                enforceTypeMatch &&
                desiredNpcTypeId !== undefined &&
                typeId !== (desiredNpcTypeId | 0)
            ) {
                return;
            }
            let distPenalty = 0;
            if (targetTile) {
                const worldTile = this.getNpcWorldTile(id);
                distPenalty =
                    Math.max(
                        Math.abs((worldTile.x | 0) - (targetTile.x | 0)),
                        Math.abs((worldTile.y | 0) - (targetTile.y | 0)),
                    ) * 10;
            }
            const score = distPenalty;
            if (score < bestScore) {
                bestScore = score;
                bestEcsId = id;
            }
        };

        if (targetTile) {
            const tileCandidates = npcEcs.queryByTile(targetTile.x | 0, targetTile.y | 0);
            for (const id of tileCandidates) {
                evaluateCandidate(id | 0, true);
            }
            if (bestEcsId === undefined && desiredNpcTypeId !== undefined) {
                for (const id of tileCandidates) {
                    evaluateCandidate(id | 0, false);
                }
            }
        }
        if (bestEcsId === undefined) {
            for (const id of npcEcs.getAllActiveIds()) {
                evaluateCandidate(id | 0, true);
            }
            if (bestEcsId === undefined && desiredNpcTypeId !== undefined) {
                for (const id of npcEcs.getAllActiveIds()) {
                    evaluateCandidate(id | 0, false);
                }
            }
        }
        if (bestEcsId === undefined) return undefined;

        const serverId = npcEcs.getServerId(bestEcsId) | 0;
        if (serverId <= 0) return undefined;
        return {
            kind: "npc",
            ecsId: bestEcsId | 0,
            serverId,
            npcTypeId: npcEcs.getNpcTypeId(bestEcsId) | 0,
            plane: npcEcs.getLevel(bestEcsId) | 0,
        };
    }

    private resolveNpcHighlightTargetFromServerId(
        serverId: number,
    ): NpcHighlightTarget | undefined {
        const sid = serverId | 0;
        if (sid <= 0) return undefined;

        const npcEcs = this.osrsClient.npcEcs;
        const ecsId = npcEcs.getEcsIdForServer(sid);
        if (ecsId === undefined) return undefined;
        if (!npcEcs.isActive(ecsId) || !npcEcs.isLinked(ecsId)) return undefined;
        if ((npcEcs.getServerId(ecsId) | 0) !== sid) return undefined;

        return {
            kind: "npc",
            ecsId: ecsId | 0,
            serverId: sid,
            npcTypeId: npcEcs.getNpcTypeId(ecsId) | 0,
            plane: npcEcs.getLevel(ecsId) | 0,
        };
    }

    private resolveInteractHighlightTargetFromEntry(
        entry: Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY"> | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): InteractHighlightTarget | undefined {
        if (!entry) return undefined;
        if (entry.targetType === MenuTargetType.LOC) {
            return this.resolveLocHighlightTargetFromEntry(entry, fallbackTile);
        }
        if (entry.targetType === MenuTargetType.NPC) {
            return this.resolveNpcHighlightTargetFromEntry(entry, fallbackTile);
        }
        return undefined;
    }

    private updateInteractHighlightHoverTarget(simpleEntries: SimpleMenuEntry[]): void {
        const config = this.osrsClient.interactHighlightPlugin.getConfig();
        if (!config.enabled || !config.showHover) {
            this.clearInteractHighlightHoverTarget();
            return;
        }

        const entry = chooseDefaultMenuEntry(simpleEntries, {
            hasSelectedSpell: ClientState.isSpellSelected,
            hasSelectedItem: ClientState.isItemSelected === 1,
        });
        const target = this.resolveInteractHighlightTargetFromEntry(
            entry,
            this.osrsClient.menuTile,
        );
        if (!target) {
            this.clearInteractHighlightHoverTarget();
            return;
        }
        this.interactHighlightHoverTarget = target;
    }

    private onInteractHighlightEntryInvoked(
        entry: SimpleMenuEntry | undefined,
        clickedTile?: { tileX: number; tileY: number; plane?: number },
    ): void {
        const config = this.osrsClient.interactHighlightPlugin.getConfig();
        if (!config.enabled) {
            this.clearInteractHighlightActiveTarget();
            return;
        }
        if (!entry) return;

        const optionLower = String(entry.option || "").toLowerCase();
        if (entry.targetType === MenuTargetType.LOC || entry.targetType === MenuTargetType.NPC) {
            if (optionLower === "examine") {
                return;
            }
            const target = this.resolveInteractHighlightTargetFromEntry(entry, clickedTile);
            if (target) {
                this.interactHighlightActiveTarget = target;
                this.interactHighlightActiveFromInteraction = false;
                this.interactHighlightClickTick = getCurrentTick() | 0;
            } else {
                this.clearInteractHighlightActiveTarget();
            }
            return;
        }

        if (
            optionLower === "walk here" ||
            entry.targetType === MenuTargetType.OBJ ||
            entry.targetType === MenuTargetType.PLAYER
        ) {
            this.clearInteractHighlightActiveTarget();
            return;
        }

        if (entry.action === MenuAction.Use || entry.action === MenuAction.Cast) {
            this.clearInteractHighlightActiveTarget();
        }
    }

    private spawnClickCross(
        tile: { tileX: number; tileY: number; plane?: number } | undefined,
        xy: { sx: number; sy: number },
        color: "red" | "yellow",
    ): void {
        if (!tile) return;
        const playerPlane = this.getPlayerBasePlane() | 0;
        const plane = tile.plane ?? playerPlane;
        this.clickCrossOverlay?.spawn(
            tile.tileX | 0,
            tile.tileY | 0,
            xy.sx,
            xy.sy,
            plane,
            undefined,
            color,
        );
    }

    private performWorldEntryAction(
        e: OsrsMenuEntry,
        orig: ((entry?: any, evt?: MouseEvent, ctx?: unknown) => void) | undefined,
        evt?: MouseEvent,
        tileForMenu?: { tileX: number; tileY: number; plane?: number },
        menuCtx?: MenuClickContext,
    ): void {
        const approxTile = this.osrsClient.menuTile ?? tileForMenu;
        const isLocEntry = e.targetType === MenuTargetType.LOC && typeof e.targetId === "number";
        const resolvedLocTile =
            approxTile && isLocEntry
                ? this.resolveLocInteractionTile((e.targetId as number) | 0, approxTile)
                : undefined;
        const effectiveTile = resolvedLocTile ?? approxTile;
        const shouldSkipClientWalk =
            isLocEntry && effectiveTile
                ? this.isLocalPlayerAdjacentToLoc((e.targetId as number) | 0, effectiveTile)
                : false;
        const optionLower = String(e.option || "").toLowerCase();
        const isWalk = optionLower === "walk here";
        this.onInteractHighlightEntryInvoked(
            {
                option: e.option,
                targetType: e.targetType,
                targetId: typeof e.targetId === "number" ? e.targetId | 0 : undefined,
                mapX: typeof e.mapX === "number" ? e.mapX | 0 : undefined,
                mapY: typeof e.mapY === "number" ? e.mapY | 0 : undefined,
            },
            effectiveTile,
        );
        try {
            const xy = this.toGLClickXY(evt);
            // Red cross for targeted actions; Yellow for walk
            this.spawnClickCross(effectiveTile as any, xy, isWalk ? "yellow" : "red");
        } catch {}

        const spellMeta = e.spellCast;
        console.log("[menu] Entry clicked:", {
            option: e.option,
            targetType: e.targetType,
            spellMeta,
            entry: e,
        });
        if (spellMeta) {
            try {
                const ctx: {
                    tile?: { tileX: number; tileY: number; plane?: number };
                    mapX?: number;
                    mapY?: number;
                    npcServerId?: number;
                    playerServerId?: number;
                } = { tile: effectiveTile };
                const metaMapX =
                    typeof spellMeta.mapX === "number"
                        ? spellMeta.mapX
                        : typeof e.mapX === "number"
                        ? e.mapX
                        : undefined;
                const metaMapY =
                    typeof spellMeta.mapY === "number"
                        ? spellMeta.mapY
                        : typeof e.mapY === "number"
                        ? e.mapY
                        : undefined;
                if (typeof metaMapX === "number") ctx.mapX = metaMapX;
                if (typeof metaMapY === "number") ctx.mapY = metaMapY;
                if (typeof spellMeta.npcServerId === "number")
                    ctx.npcServerId = spellMeta.npcServerId | 0;
                if (typeof spellMeta.playerServerId === "number")
                    ctx.playerServerId = spellMeta.playerServerId | 0;
                console.log("[menu] Calling castSpellFromMenu with ctx:", ctx);
                this.osrsClient.castSpellFromMenu(e, ctx);
            } catch (err) {
                console.warn?.("[menu] failed to cast spell", err);
            }
            return;
        }

        // Facing is server-authoritative via the face direction update mask.
        // Invoke original handler
        if (!menuCtx?.worldMenuStateDispatch) {
            try {
                orig?.(e as any, evt, menuCtx);
            } catch {}
        }
    }

    private buildSimpleMenuEntries(
        entries: OsrsMenuEntry[],
        opts: {
            shouldFreeze: boolean;
            toCssEvent: (gx?: number, gy?: number) => any;
        },
    ): SimpleMenuEntry[] {
        const client = this.osrsClient;
        if (
            opts.shouldFreeze &&
            client.menuFrozenSimpleEntries &&
            client.menuFrozenSimpleEntriesVersion === client.menuPinnedEntriesVersion
        ) {
            client.menuActiveSimpleEntries = client.menuFrozenSimpleEntries;
            return client.menuFrozenSimpleEntries;
        }
        const menuState = client.menuState;
        menuState.reset();
        const simple = worldEntriesToSimple(entries, {
            label: {
                includeExamineIds: !!this.osrsClient.debugId,
                localPlayerCombatLevel: ClientState.localPlayerCombatLevel | 0,
            },
            toCssEvent: opts.toCssEvent,
            menuState,
            registerWithState: true,
            resetMenuState: false,
        });
        client.menuActiveSimpleEntries = simple;
        if (opts.shouldFreeze) {
            client.menuFrozenSimpleEntries = simple;
            client.menuFrozenSimpleEntriesVersion = client.menuPinnedEntriesVersion;
        } else {
            client.menuFrozenSimpleEntries = undefined;
            client.menuFrozenSimpleEntriesVersion = 0;
        }
        return simple;
    }

    // chooseDefaultEntry moved to ui/menu/MenuEngine.ts

    private getApproxTileHeight(worldX: number, worldY: number, basePlane?: number): number {
        const resolvedBasePlane =
            basePlane ??
            (() => {
                const idx = this.osrsClient.playerEcs.getIndexForServerId(
                    this.osrsClient.controlledPlayerServerId,
                );
                return idx !== undefined ? this.osrsClient.playerEcs.getLevel(idx) : 0;
            })();

        return sampleBridgeHeightForWorldTile(
            this.mapManager,
            worldX,
            worldY,
            resolvedBasePlane,
            BridgePlaneStrategy.RENDER,
        ).height;
    }

    // Compute height sampling at a fixed plane without applying bridge promotion per-sample.
    private getTileHeightAtPlane(worldX: number, worldY: number, plane: number): number {
        return sampleBridgeHeightForWorldTile(
            this.mapManager,
            worldX,
            worldY,
            plane,
            BridgePlaneStrategy.RENDER,
        ).height;
    }

    // Derive the effective surface plane for a given world tile based on basePlane and bridge flag.
    private getEffectivePlaneForTile(tileX: number, tileY: number, basePlane: number): number {
        return resolveInteractionPlaneForWorldTile(this.mapManager, basePlane, tileX, tileY);
    }

    // Derive occupancy plane matching collision map demotion rules.
    private getOccupancyPlaneForTile(tileX: number, tileY: number, basePlane: number): number {
        return resolveCollisionSamplePlaneForWorldTile(this.mapManager, basePlane, tileX, tileY);
    }

    private isBridgeSurfaceTile(tileX: number, tileY: number, plane: number): boolean {
        const map = this.mapManager.getMap(
            getMapIndexFromTile(tileX),
            getMapIndexFromTile(tileY),
        ) as WebGLMapSquare | undefined;
        if (!map || typeof map.isBridgeSurface !== "function") return false;
        const localX = tileX - map.mapX * Scene.MAP_SQUARE_SIZE;
        const localY = tileY - map.mapY * Scene.MAP_SQUARE_SIZE;
        if (
            localX < 0 ||
            localY < 0 ||
            localX >= Scene.MAP_SQUARE_SIZE ||
            localY >= Scene.MAP_SQUARE_SIZE
        ) {
            return false;
        }
        return map.isBridgeSurface(plane, localX, localY);
    }

    // PERF: Helper method to convert game coordinates to CSS event (avoids closure per frame)
    private toCssEvent(
        gx?: number,
        gy?: number,
        frameCount?: number,
    ): { clientX: number; clientY: number } | undefined {
        if (typeof gx !== "number" || typeof gy !== "number") return undefined;
        // Update cached rect once per frame (or first call)
        if (frameCount !== undefined && frameCount !== this.cachedCanvasRectFrame) {
            this.cachedCanvasRect = this.canvas.getBoundingClientRect();
            this.cachedCanvasRectFrame = frameCount;
        } else if (!this.cachedCanvasRect) {
            this.cachedCanvasRect = this.canvas.getBoundingClientRect();
        }
        const rect = this.cachedCanvasRect;
        this.cachedCssEventResult.clientX = rect.left + gx;
        this.cachedCssEventResult.clientY = rect.top + gy;
        return this.cachedCssEventResult;
    }

    // PERF: Helper method to check if mouse is in UI region (avoids IIFE allocation per frame)
    private isMouseInUIRegion(mx: number, my: number): boolean {
        return checkMouseInUIRegion(mx, my, this.canvas.width, this.canvas.height);
    }

    /**
     * Create a Ray from screen coordinates for raycast-all menu building.
     * Uses the same unprojection logic as tile selection.
     * @param mouseX Screen X coordinate in canvas coordinates
     * @param mouseY Screen Y coordinate in canvas coordinates
     * @returns Ray from camera through the screen point, or null if invalid
     */
    private screenToRay(mouseX: number, mouseY: number): Ray | null {
        if (!this.app || !this.osrsClient.camera?.viewProjMatrix) return null;

        const camera = this.osrsClient.camera;
        if (!camera.containsScreenPoint(mouseX, mouseY)) return null;
        const width = camera.screenWidth || this.app.width;
        const height = camera.screenHeight || this.app.height;
        if (width <= 0 || height <= 0) return null;

        // Normalize to NDC
        const nx = (2 * mouseX) / width - 1;
        const ny = 1 - (2 * mouseY) / height;

        // Unproject from NDC to world using inverse view-projection
        mat4.invert(this.tmpInvViewProj, camera.viewProjMatrix);
        this.tmpNear[0] = nx;
        this.tmpNear[1] = ny;
        this.tmpNear[2] = -1;
        this.tmpNear[3] = 1;
        this.tmpFar[0] = nx;
        this.tmpFar[1] = ny;
        this.tmpFar[2] = 1;
        this.tmpFar[3] = 1;
        vec4.transformMat4(this.tmpNear, this.tmpNear, this.tmpInvViewProj);
        vec4.transformMat4(this.tmpFar, this.tmpFar, this.tmpInvViewProj);

        // Perspective divide
        const nearW = this.tmpNear[3] || 1.0;
        const farW = this.tmpFar[3] || 1.0;
        this.tmpNear[0] /= nearW;
        this.tmpNear[1] /= nearW;
        this.tmpNear[2] /= nearW;
        this.tmpFar[0] /= farW;
        this.tmpFar[1] /= farW;
        this.tmpFar[2] /= farW;

        // Create ray
        const origin = vec3.fromValues(this.tmpNear[0], this.tmpNear[1], this.tmpNear[2]);
        const farPos = vec3.fromValues(this.tmpFar[0], this.tmpFar[1], this.tmpFar[2]);
        const direction = vec3.create();
        vec3.subtract(direction, farPos, origin);
        vec3.normalize(direction, direction);

        return new Ray(origin, direction);
    }

    private resolveTileAndPlane(
        worldX: number,
        worldY: number,
        basePlane: number,
    ): { tileX: number; tileY: number; plane: number } {
        const tileX = Math.floor(worldX);
        const tileY = Math.floor(worldY);
        const plane = this.getEffectivePlaneForTile(tileX, tileY, basePlane);
        return { tileX, tileY, plane };
    }

    override getCollisionFlagAt(level: number, tileX: number, tileY: number): number {
        const map = this.mapManager.getMap(
            getMapIndexFromTile(tileX),
            getMapIndexFromTile(tileY),
        ) as any;
        // OSRS parity: missing/unloaded tiles are treated as blocked via the 0x1000000 sentinel bit
        // (see CollisionMap.clear + class142.method3226 terrain decode step).
        if (!map || typeof (map as any).getCollisionFlag !== "function") return 0x1000000;
        const localX = tileX & 63;
        const localY = tileY & 63;
        return (map as any).getCollisionFlag(level | 0, localX, localY) | 0;
    }

    // Return loc ids anchored at the origin of the given world tile,
    // resolving effective plane using the same bridge logic as heights.
    private getLocIdsAtTile(tileX: number, tileY: number, basePlane: number): number[] {
        try {
            const mapX = getMapIndexFromTile(tileX);
            const mapY = getMapIndexFromTile(tileY);
            const map = this.mapManager.getMap(mapX, mapY) as any;
            if (!map || typeof (map as any).getLocIdsAtLocal !== "function") return [];
            const localX = tileX & 63;
            const localY = tileY & 63;
            const effPlane = this.getEffectivePlaneForTile(tileX, tileY, basePlane) | 0;
            return (map as any).getLocIdsAtLocal(effPlane, localX, localY) as number[];
        } catch {
            return [];
        }
    }

    private getLocIdsAtTileAllLevels(
        tileX: number,
        tileY: number,
    ): { id: number; level: number; typeRot?: number }[] {
        try {
            const mapX = getMapIndexFromTile(tileX);
            const mapY = getMapIndexFromTile(tileY);
            const map = this.mapManager.getMap(mapX, mapY) as any;
            if (!map || typeof (map as any).getLocIdsAtLocal !== "function") return [];
            const localX = tileX & 63;
            const localY = tileY & 63;
            const out: { id: number; level: number; typeRot?: number }[] = [];
            for (let lvl = 0; lvl < 4; lvl++) {
                const ids = (map as any).getLocIdsAtLocal(lvl, localX, localY) as number[];
                const typeRots =
                    typeof (map as any).getLocTypeRotsAtLocal === "function"
                        ? ((map as any).getLocTypeRotsAtLocal(lvl, localX, localY) as number[])
                        : undefined;
                if (!ids) continue;
                for (let i = 0; i < ids.length; i++) {
                    const id = ids[i] | 0;
                    const typeRot =
                        typeRots && i < typeRots.length ? (typeRots[i] | 0) & 0xff : undefined;
                    out.push({ id, level: lvl | 0, typeRot });
                }
            }
            return out;
        } catch {
            return [];
        }
    }

    private resolveLocInteractionTile(
        locId: number,
        approx: { tileX: number; tileY: number; plane?: number },
    ): { tileX: number; tileY: number; plane?: number; typeRot?: number } {
        const basePlane = this.getPlayerBasePlane() | 0;
        const fallbackPlane =
            typeof approx.plane === "number" ? (approx.plane as number) | 0 : basePlane;
        const match = this.findNearestLocTile(locId, approx.tileX | 0, approx.tileY | 0, basePlane);
        if (match) {
            return match;
        }
        return {
            tileX: approx.tileX | 0,
            tileY: approx.tileY | 0,
            plane: fallbackPlane,
            typeRot: this.resolveLocTypeRotAtTile(
                locId | 0,
                approx.tileX | 0,
                approx.tileY | 0,
                fallbackPlane | 0,
            ),
        };
    }

    private isLocalPlayerAdjacentToLoc(
        locId: number,
        tile: { tileX: number; tileY: number },
    ): boolean {
        const playerTile = this.getLocalPlayerTile();
        if (!playerTile) return false;
        const size = this.getLocSize(locId | 0);
        if (!size) return false;
        const minX = tile.tileX | 0;
        const minY = tile.tileY | 0;
        const maxX = minX + Math.max(1, size.sizeX | 0) - 1;
        const maxY = minY + Math.max(1, size.sizeY | 0) - 1;
        const clampedX = clamp(playerTile.x | 0, minX, maxX);
        const clampedY = clamp(playerTile.y | 0, minY, maxY);
        const dx = Math.abs((playerTile.x | 0) - clampedX);
        const dy = Math.abs((playerTile.y | 0) - clampedY);
        return dx <= 1 && dy <= 1;
    }

    private getLocalPlayerTile(): { x: number; y: number } | undefined {
        const serverId = this.osrsClient.controlledPlayerServerId | 0;
        if (!(serverId >= 0)) return undefined;
        const state = this.osrsClient.playerMovementSync?.getState?.(serverId);
        if (!state) return undefined;
        return { x: state.tileX | 0, y: state.tileY | 0 };
    }

    private getLocSize(locId: number): { sizeX: number; sizeY: number } | undefined {
        const loader: any = (this.osrsClient as any)?.locTypeLoader;
        if (!loader?.load) return undefined;
        try {
            const loc = loader.load(locId | 0);
            if (!loc) return undefined;
            const sizeX = Math.max(1, Number(loc.sizeX ?? 1));
            const sizeY = Math.max(1, Number(loc.sizeY ?? 1));
            return { sizeX, sizeY };
        } catch {
            return undefined;
        }
    }

    private findNearestLocTile(
        locId: number,
        tileX: number,
        tileY: number,
        basePlane: number,
        maxRadius: number = 8,
    ): { tileX: number; tileY: number; plane: number; typeRot?: number } | undefined {
        const targetId = locId | 0;
        for (let radius = 0; radius <= maxRadius; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                    const cx = tileX + dx;
                    const cy = tileY + dy;
                    const locs = this.getLocIdsAtTileAllLevels(cx, cy);
                    if (!locs.length) continue;
                    let bestPlane: number | undefined;
                    let bestTypeRot: number | undefined;
                    let bestScore = Number.POSITIVE_INFINITY;
                    for (const loc of locs) {
                        if ((loc.id | 0) !== targetId) continue;
                        const diff = Math.abs((loc.level | 0) - (basePlane | 0));
                        if (diff < bestScore) {
                            bestScore = diff;
                            bestPlane = loc.level | 0;
                            bestTypeRot =
                                typeof loc.typeRot === "number"
                                    ? (loc.typeRot | 0) & 0xff
                                    : undefined;
                        }
                    }
                    if (bestPlane !== undefined) {
                        return { tileX: cx, tileY: cy, plane: bestPlane, typeRot: bestTypeRot };
                    }
                }
            }
        }
        return undefined;
    }

    private resolveLocTypeRotAtTile(
        locId: number,
        tileX: number,
        tileY: number,
        plane: number,
    ): number | undefined {
        try {
            const mapX = getMapIndexFromTile(tileX);
            const mapY = getMapIndexFromTile(tileY);
            const map = this.mapManager.getMap(mapX, mapY) as any;
            if (!map || typeof map.getLocIdsAtLocal !== "function") return undefined;
            if (typeof map.getLocTypeRotsAtLocal !== "function") return undefined;
            const localX = tileX & 63;
            const localY = tileY & 63;
            const level = Math.max(0, Math.min(Scene.MAX_LEVELS - 1, plane | 0));
            const ids = map.getLocIdsAtLocal(level, localX, localY) as number[];
            const typeRots = map.getLocTypeRotsAtLocal(level, localX, localY) as number[];
            for (let i = 0; i < ids.length; i++) {
                if ((ids[i] | 0) !== (locId | 0)) continue;
                if (i < typeRots.length) {
                    return (typeRots[i] | 0) & 0xff;
                }
                break;
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    // Tile devoverlay rendering delegated to OverlayManager

    private updateCustomLabels(): void {
        const labels = this.osrsClient.customLabels;
        const screens: { x: number; y: number; text: string }[] = [];
        const basePlane = this.getPlayerRawPlane() | 0;
        for (const label of labels) {
            const h = this.getApproxTileHeight(label.x + 0.5, label.y + 0.5, basePlane);
            const screen = this.worldToScreen(label.x + 0.5, h - 0.3, label.y + 0.5);
            if (screen) {
                screens.push({
                    x: screen[0],
                    y: screen[1],
                    text: label.text,
                });
            }
        }

        // Destination tile label now rendered via TileTextOverlay using bitmap font
        this.osrsClient.customLabelScreens = screens;
    }

    tickPass(
        time: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        clientCycle: number,
    ): void {
        const seqFrameLoader = this.osrsClient.seqFrameLoader;

        this.actorRenderCount = 0;

        // Core client-cycle ticking is handled by OsrsClient's tick loop so it continues even when
        // rendering is throttled (e.g., alt-tab/background). This pass is render-focused only.

        // Reuse buffers instead of allocating new arrays each frame
        const visibleMaps = this.visibleMapsBuffer;
        visibleMaps.length = 0;
        // Reset ambient sound buffer index for object reuse
        this.ambientSoundBufferIndex = 0;

        this.gfxManager?.resetWorldBindings?.();
        // PERF: Use cached callback to avoid per-frame closure allocation
        // Throttle ambient sound collection to reduce tick cost
        this.ambientSoundFrameCounter++;
        const shouldCollectAmbient =
            this.ambientSoundFrameCounter >= WebGLOsrsRenderer.AMBIENT_SOUND_THROTTLE_FRAMES;
        if (shouldCollectAmbient) {
            this.ambientSoundFrameCounter = 0;
        }
        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            const map = this.mapManager.visibleMaps[i];
            visibleMaps.push(map);

            for (const loc of map.locsAnimated) {
                // OSRS parity: DynamicObject/loc animation timing is based on Client.cycle (20ms each).
                loc.update(seqFrameLoader, clientCycle | 0, this.seqSoundCallback);
            }

            // Collect ambient sounds only every N frames (throttled)
            if (shouldCollectAmbient) {
                this.collectAmbientSounds(map);
            }

            this._ecsUpdateNpcClient(map, clientTicksElapsed);
            this._ecsUpdatePlayerOccupancy(map);

            // ECS is authoritative; legacy sync removed

            // Fully clear per-map actor offset rings to avoid any stale indices leaking
            for (let r = 0; r < map.playerDataTextureOffsets.length; r++)
                map.playerDataTextureOffsets[r] = -1;
            for (let r = 0; r < map.npcDataTextureOffsets.length; r++)
                map.npcDataTextureOffsets[r] = -1;
            for (let r = 0; r < map.worldGfxDataTextureOffsets.length; r++)
                map.worldGfxDataTextureOffsets[r] = -1;

            this.addNpcRenderData(map);
            this.addPlayerRenderData(map);
            this.addProjectileRenderData(map);
            this.addWorldGfxRenderData(map);
        }

        // Propagate listener position for positional audio and advance ambient loops.
        const soundSystem = this.osrsClient.soundEffectSystem;
        if (soundSystem) {
            try {
                const peListener = this.osrsClient.playerEcs;
                const idxListener = peListener.getIndexForServerId(
                    this.osrsClient.controlledPlayerServerId,
                );
                if (idxListener !== undefined) {
                    const px = peListener.getX(idxListener) | 0;
                    const py = peListener.getY(idxListener) | 0;
                    const level = peListener.getLevel(idxListener) | 0;
                    soundSystem.updateListenerPosition(px, py, level * 128);
                } else {
                    soundSystem.updateListenerPosition(
                        this.osrsClient.camera.getPosX() * 128,
                        this.osrsClient.camera.getPosZ() * 128,
                        this.osrsClient.camera.getPosY() * 128,
                    );
                }
            } catch {
                soundSystem.updateListenerPosition(
                    this.osrsClient.camera.getPosX() * 128,
                    this.osrsClient.camera.getPosZ() * 128,
                    this.osrsClient.camera.getPosY() * 128,
                );
            }
            // Truncate buffer to actual size and pass to sound system
            this.ambientSoundBuffer.length = this.ambientSoundBufferIndex;
            soundSystem.updateAmbientSounds(this.ambientSoundBuffer);
        }

        // OSRS parity: animation stepping is handled by the client tick loop (`PlayerEcs` + `PlayerAnimController`).
    }
    // Update dynamic BLOCK_PLAYERS occupancy using per-cell counters when players cross tiles.
    private _ecsUpdatePlayerOccupancy(map: WebGLMapSquare): void {
        const pe = this.osrsClient.playerEcs;
        const n = pe.size?.() ?? (pe as any).size?.() ?? 0;
        if (!n) return;
        for (let i = 0; i < n; i++) {
            const px = pe.getX(i) | 0;
            const py = pe.getY(i) | 0;
            const tileX = (px / 128) | 0;
            const tileY = (py / 128) | 0;
            const mapX = getMapIndexFromTile(tileX);
            const mapY = getMapIndexFromTile(tileY);
            // Only update if the player's current map square is loaded and matches this map
            if (mapX !== map.mapX || mapY !== map.mapY) continue;

            // Compute effective plane using bridge flag
            const localTileX = tileX - map.mapX * 64;
            const localTileY = tileY - map.mapY * 64;
            const tx = clamp(localTileX, 0, 63);
            const ty = clamp(localTileY, 0, 63);
            const plane = resolveCollisionSamplePlaneForLocal(map, pe.getLevel(i) | 0, tx, ty);

            const oldPlane = pe.getOccPlane(i) | 0;
            const oldMapX = pe.getOccMapX?.(i) ?? 255;
            const oldMapY = pe.getOccMapY?.(i) ?? 255;
            const oldTileX = pe.getOccTileX(i) | 0;
            const oldTileY = pe.getOccTileY(i) | 0;

            // First-time init: set occ to current and inc
            if (oldPlane === 255) {
                map.incPlayerOcc(plane, localTileX, localTileY);
                pe.setOccTileWithMap?.(i, mapX, mapY, localTileX, localTileY, plane);
                continue;
            }

            // If map changed, dec on old map (if loaded), inc on new
            if (oldMapX !== mapX || oldMapY !== mapY) {
                const oldMap = this.mapManager.getMap(oldMapX as number, oldMapY as number) as
                    | WebGLMapSquare
                    | undefined;
                if (oldMap) oldMap.decPlayerOcc(oldPlane, oldTileX, oldTileY);
                map.incPlayerOcc(plane, localTileX, localTileY);
                pe.setOccTileWithMap?.(i, mapX, mapY, localTileX, localTileY, plane);
                continue;
            }

            // Same map: if plane and tile the same, nothing to do
            if (
                oldPlane === (plane | 0) &&
                oldTileX === (localTileX | 0) &&
                oldTileY === (localTileY | 0)
            ) {
                continue;
            }

            // Same map: delta row/column if single-tile and same plane, else full
            if (
                oldPlane === (plane | 0) &&
                Math.abs(localTileX - oldTileX) <= 1 &&
                Math.abs(localTileY - oldTileY) <= 1 &&
                (localTileX !== oldTileX || localTileY !== oldTileY)
            ) {
                const dx = localTileX - oldTileX;
                const dy = localTileY - oldTileY;
                if (dx !== 0) {
                    const trailX = oldTileX; // size 1: trailing is the whole old footprint
                    map.decPlayerOcc(oldPlane, trailX, oldTileY);
                    const leadX = localTileX;
                    map.incPlayerOcc(plane, leadX, localTileY);
                }
                if (dy !== 0) {
                    const trailY = oldTileY;
                    map.decPlayerOcc(oldPlane, oldTileX, trailY);
                    const leadY = localTileY;
                    map.incPlayerOcc(plane, localTileX, leadY);
                }
            } else {
                map.decPlayerOcc(oldPlane, oldTileX, oldTileY);
                map.incPlayerOcc(plane, localTileX, localTileY);
            }
            pe.setOccTileWithMap?.(i, mapX, mapY, localTileX, localTileY, plane);
        }
    }

    private resetActorTileSelectionFrameIfNeeded(): void {
        const frameId = (this.stats?.frameCount ?? 0) | 0;
        if (frameId === this.frameActorTileSelectionId) {
            return;
        }

        this.frameActorTileSelectionId = frameId;
        this.frameActorTileSelectionBuilt = false;
        this.frameWinningActorByTile.clear();
        this.frameActorSelectionSeenNpcIds.clear();
    }

    private getActorTileSelectionKey(tileX: number, tileY: number, plane: number): number {
        return (
            ((plane & 0x3) * 0x40000000 + ((tileX & 0x7fff) * 0x8000 + (tileY & 0x7fff))) >>>
            0
        );
    }

    private shouldReplaceTileWinner(
        current: { kind: "player" | "npc"; id: number; priority: number },
        kind: "player" | "npc",
        id: number,
        priority: number,
    ): boolean {
        return (priority | 0) > (current.priority | 0);
    }

    private registerActorTileCandidate(
        kind: "player" | "npc",
        id: number,
        tileX: number,
        tileY: number,
        plane: number,
        priority: number,
    ): void {
        const key = this.getActorTileSelectionKey(tileX | 0, tileY | 0, plane | 0);
        const current = this.frameWinningActorByTile.get(key);
        if (
            current &&
            !this.shouldReplaceTileWinner(current, kind, id | 0, priority | 0)
        ) {
            return;
        }

        this.frameWinningActorByTile.set(key, {
            kind: kind,
            id: id | 0,
            priority: priority | 0,
        });
    }

    private ensureActorTileSelectionForFrame(): void {
        this.resetActorTileSelectionFrameIfNeeded();
        if (this.frameActorTileSelectionBuilt) {
            return;
        }

        this.frameActorTileSelectionBuilt = true;

        const pe = this.osrsClient.playerEcs;
        const playerCount = pe.size?.() ?? (pe as any).size?.() ?? 0;
        const renderSelf = this.osrsClient.renderSelf !== false;
        const controlledServerId = this.osrsClient.controlledPlayerServerId | 0;
        const controlledPid =
            controlledServerId > 0 ? pe.getIndexForServerId(controlledServerId) : undefined;

        if (
            renderSelf &&
            controlledPid !== undefined &&
            this.isPlayerSceneTileMarkerCandidate(controlledPid | 0)
        ) {
            this.registerPlayerSceneTileCandidate(controlledPid | 0, 5);
        }

        const combatTargetPid = this.getCombatTargetPlayerEcsIndex();
        if (
            combatTargetPid !== undefined &&
            (combatTargetPid | 0) !== (controlledPid ?? -1) &&
            this.isPlayerSceneTileMarkerCandidate(combatTargetPid | 0)
        ) {
            this.registerPlayerSceneTileCandidate(combatTargetPid | 0, 4);
        }

        const combatTargetNpcEcsId = this.getCombatTargetNpcEcsId();
        if (
            combatTargetNpcEcsId !== undefined &&
            this.isNpcSceneTileMarkerCandidate(combatTargetNpcEcsId | 0)
        ) {
            const npcEcs = this.osrsClient.npcEcs;
            this.frameActorSelectionSeenNpcIds.add(combatTargetNpcEcsId | 0);
            this.registerActorTileCandidate(
                "npc",
                combatTargetNpcEcsId | 0,
                (npcEcs.getWorldX(combatTargetNpcEcsId) >> 7) | 0,
                (npcEcs.getWorldY(combatTargetNpcEcsId) >> 7) | 0,
                npcEcs.getLevel(combatTargetNpcEcsId) | 0,
                4,
            );
        }

        this.registerNpcSceneTileCandidatesByPriority(NpcDrawPriority.DRAW_PRIORITY_FIRST, 3);

        for (let pid = 0; pid < playerCount; pid++) {
            if (controlledPid !== undefined && (pid | 0) === (controlledPid | 0)) {
                continue;
            }
            if (combatTargetPid !== undefined && (pid | 0) === (combatTargetPid | 0)) {
                continue;
            }
            if (!this.isPlayerSceneTileMarkerCandidate(pid)) {
                continue;
            }

            this.registerPlayerSceneTileCandidate(pid | 0, 2);
        }

        this.registerNpcSceneTileCandidatesByPriority(NpcDrawPriority.DRAW_PRIORITY_DEFAULT, 1);
        this.registerNpcSceneTileCandidatesByPriority(NpcDrawPriority.DRAW_PRIORITY_LAST, 0);
    }

    private registerPlayerSceneTileCandidate(pid: number, priority: number): void {
        const pe = this.osrsClient.playerEcs;
        this.registerActorTileCandidate(
            "player",
            pid | 0,
            (pe.getX(pid) >> 7) | 0,
            (pe.getY(pid) >> 7) | 0,
            pe.getLevel(pid) | 0,
            priority | 0,
        );
    }

    private registerNpcSceneTileCandidatesByPriority(
        drawPriority: NpcDrawPriority,
        priority: number,
    ): void {
        const npcEcs = this.osrsClient.npcEcs;
        const seenNpcIds = this.frameActorSelectionSeenNpcIds;
        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            const map = this.mapManager.visibleMaps[i];
            const ids = map?.npcEntityIds;
            if (!ids || ids.length === 0) {
                continue;
            }

            for (let j = 0; j < ids.length; j++) {
                const ecsId = ids[j] | 0;
                if (seenNpcIds.has(ecsId)) {
                    continue;
                }
                if (!this.shouldRenderNpcOwnershipFromMap(map, ecsId)) {
                    continue;
                }
                if (!this.isNpcSceneTileMarkerCandidate(ecsId)) {
                    continue;
                }
                if ((this.getNpcSceneDrawPriority(ecsId) | 0) !== (drawPriority | 0)) {
                    continue;
                }

                seenNpcIds.add(ecsId);
                this.registerActorTileCandidate(
                    "npc",
                    ecsId,
                    (npcEcs.getWorldX(ecsId) >> 7) | 0,
                    (npcEcs.getWorldY(ecsId) >> 7) | 0,
                    npcEcs.getLevel(ecsId) | 0,
                    priority | 0,
                );
            }
        }
    }

    private isPlayerSceneTileMarkerCandidate(pid: number): boolean {
        const pe = this.osrsClient.playerEcs;
        const px = pe.getX(pid) | 0;
        const py = pe.getY(pid) | 0;
        return (px & 127) === 64 && (py & 127) === 64;
    }

    private isNpcSceneTileMarkerCandidate(ecsId: number): boolean {
        const npcEcs = this.osrsClient.npcEcs;
        if ((npcEcs.getSize(ecsId) | 0) !== 1) {
            return false;
        }

        const worldX = npcEcs.getWorldX(ecsId) | 0;
        const worldY = npcEcs.getWorldY(ecsId) | 0;
        return (worldX & 127) === 64 && (worldY & 127) === 64;
    }

    private getNpcSceneDrawPriority(ecsId: number): NpcDrawPriority {
        const npcTypeId = this.osrsClient.npcEcs.getNpcTypeId(ecsId) | 0;
        if (npcTypeId < 0) {
            return NpcDrawPriority.DRAW_PRIORITY_DEFAULT;
        }

        try {
            const base = this.osrsClient.npcTypeLoader.load(npcTypeId);
            const transformed =
                base.transform(this.osrsClient.varManager, this.osrsClient.npcTypeLoader) ?? base;
            return transformed.drawPriority ?? NpcDrawPriority.DRAW_PRIORITY_DEFAULT;
        } catch {
            return NpcDrawPriority.DRAW_PRIORITY_DEFAULT;
        }
    }

    private getCombatTargetPlayerEcsIndex(): number | undefined {
        const targetServerId = ClientState.combatTargetPlayerIndex | 0;
        if ((targetServerId | 0) < 0) {
            return undefined;
        }

        return this.osrsClient.playerEcs.getIndexForServerId(targetServerId | 0);
    }

    private getCombatTargetNpcEcsId(): number | undefined {
        const controlledServerId = this.osrsClient.controlledPlayerServerId | 0;
        if (controlledServerId <= 0) {
            return undefined;
        }

        const controlledPid =
            this.osrsClient.playerEcs.getIndexForServerId(controlledServerId);
        if (controlledPid === undefined) {
            return undefined;
        }

        const rawIdx = this.osrsClient.playerEcs.getInteractionIndex(controlledPid) | 0;
        const decoded = decodeInteractionIndex(rawIdx);
        if (!decoded || decoded.type !== "npc") {
            return undefined;
        }

        return this.osrsClient.npcEcs.getEcsIdForServer(decoded.id | 0);
    }

    shouldRenderPlayerIndex(pid: number): boolean {
        const renderSelf = this.osrsClient.renderSelf !== false;
        const controlledServerId = this.osrsClient.controlledPlayerServerId | 0;
        const controlledPid =
            controlledServerId > 0
                ? this.osrsClient.playerEcs.getIndexForServerId(controlledServerId)
                : undefined;
        if (!renderSelf && controlledPid !== undefined && (pid | 0) === (controlledPid | 0)) {
            return false;
        }
        if (!this.isPlayerSceneTileMarkerCandidate(pid)) {
            return true;
        }

        this.ensureActorTileSelectionForFrame();
        const pe = this.osrsClient.playerEcs;
        const tileKey = this.getActorTileSelectionKey(
            (pe.getX(pid) >> 7) | 0,
            (pe.getY(pid) >> 7) | 0,
            pe.getLevel(pid) | 0,
        );
        const winner = this.frameWinningActorByTile.get(tileKey);
        return winner?.kind === "player" && (winner.id | 0) === (pid | 0);
    }

    private shouldRenderNpcOwnershipFromMap(map: WebGLMapSquare, ecsId: number): boolean {
        const ecs = this.osrsClient.npcEcs;
        if (!ecs.isActive(ecsId) || !ecs.isLinked(ecsId)) return false;

        const ownerMapX = ecs.getMapX(ecsId) | 0;
        const ownerMapY = ecs.getMapY(ecsId) | 0;
        if ((ownerMapX | 0) === (map.mapX | 0) && (ownerMapY | 0) === (map.mapY | 0)) {
            return true;
        }

        const ownerMap = this.mapManager.getMap(ownerMapX, ownerMapY) as WebGLMapSquare | undefined;
        if (!ownerMap?.npcEntityIds || ownerMap.npcEntityIds.indexOf(ecsId | 0) === -1) {
            return true;
        }

        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            if (this.mapManager.visibleMaps[i] === ownerMap) {
                return false;
            }
        }

        return true;
    }

    shouldRenderNpcFromMap(map: WebGLMapSquare, ecsId: number): boolean {
        if (!this.shouldRenderNpcOwnershipFromMap(map, ecsId)) {
            return false;
        }
        if (!this.isNpcSceneTileMarkerCandidate(ecsId)) {
            return true;
        }

        this.ensureActorTileSelectionForFrame();
        const npcEcs = this.osrsClient.npcEcs;
        const tileKey = this.getActorTileSelectionKey(
            (npcEcs.getWorldX(ecsId) >> 7) | 0,
            (npcEcs.getWorldY(ecsId) >> 7) | 0,
            npcEcs.getLevel(ecsId) | 0,
        );
        const winner = this.frameWinningActorByTile.get(tileKey);
        return winner?.kind === "npc" && (winner.id | 0) === (ecsId | 0);
    }

    /**
     * Render-side NPC updates that depend on loaded animation frames (per-map caches).
     *
     * Movement stepping is handled in the core client tick loop (NpcEcs.updateClient) so that
     * NPC positions remain in sync even when rendering is throttled (alt-tab/background).
     */
    private _ecsUpdateNpcClient(map: WebGLMapSquare, clientTicksElapsed: number): void {
        const ids: number[] = map.npcEntityIds || ([] as any);
        if (ids.length === 0 || clientTicksElapsed <= 0) return;
        const ecs = this.osrsClient.npcEcs;
        const pe = this.osrsClient.playerEcs;

        for (let t = 0; t < clientTicksElapsed; t++) {
            for (let j = 0; j < ids.length; j++) {
                const id = ids[j] | 0;
                if (!ecs.isActive(id) || !ecs.isLinked(id)) continue;
                if (!this.shouldRenderNpcOwnershipFromMap(map, id)) continue;

                const walkingNow = ecs.shouldUseWalkAnim(id);
                const movementOrientation = walkingNow ? ecs.getCurrentStepRot(id) : undefined;
                ecs.setWalking(id, walkingNow);

                const npcWorldX = ecs.getWorldX(id) | 0;
                const npcWorldY = ecs.getWorldY(id) | 0;
                let desiredFacing: number | undefined;

                const npcInteractionIndex = ecs.getInteractionIndex?.(id);
                const npcInteraction =
                    typeof npcInteractionIndex === "number" && npcInteractionIndex >= 0
                        ? decodeInteractionIndex(npcInteractionIndex)
                        : null;
                if (npcInteraction) {
                    if (npcInteraction.type === "player") {
                        const targetIdx = pe.getIndexForServerId?.(npcInteraction.id | 0);
                        if (targetIdx != null) {
                            const px = pe.getX(targetIdx) | 0;
                            const py = pe.getY(targetIdx) | 0;
                            const dxFacing = (npcWorldX - px) | 0;
                            const dyFacing = (npcWorldY - py) | 0;
                            const facing = computeFacingRotation(dxFacing, dyFacing);
                            if (facing !== undefined) desiredFacing = facing;
                        }
                    } else if (npcInteraction.type === "npc") {
                        const targetEcs = ecs.getEcsIdForServer?.(npcInteraction.id | 0);
                        if (targetEcs != null && ecs.isLinked(targetEcs | 0)) {
                            const targetMapId = ecs.getMapId(targetEcs | 0) | 0;
                            const targetMapX = (targetMapId >> 8) & 0xff;
                            const targetMapY = targetMapId & 0xff;
                            const targetWorldX =
                                ((targetMapX << 13) + (ecs.getX(targetEcs | 0) | 0)) | 0;
                            const targetWorldY =
                                ((targetMapY << 13) + (ecs.getY(targetEcs | 0) | 0)) | 0;
                            const dxFacing = (npcWorldX - targetWorldX) | 0;
                            const dyFacing = (npcWorldY - targetWorldY) | 0;
                            const facing = computeFacingRotation(dxFacing, dyFacing);
                            if (facing !== undefined) desiredFacing = facing;
                        }
                    }
                }
                if (
                    desiredFacing === undefined &&
                    walkingNow &&
                    movementOrientation !== undefined
                ) {
                    desiredFacing = movementOrientation;
                }
                if (desiredFacing !== undefined) {
                    ecs.setTargetRot(id, desiredFacing);
                }

                // Rotate toward target orientation with rotation speed
                const rot = ecs.getRotation(id) | 0;
                const targetRot = ecs.getTargetRot(id) | 0;
                if (rot !== targetRot) {
                    const step = ecs.getRotationSpeed(id) | 0;
                    const newRot = interpolateRotation(rot, targetRot, step);
                    ecs.setRotation(id, newRot);
                }

                const seqId = ecs.getSeqId(id) | 0;
                const seqDelay = ecs.getSeqDelay?.(id) | 0;
                const extraAnimMap = map.npcExtraAnims?.[j];
                const extraLenMap = map.npcExtraFrameLengths?.[j];
                const { movementSeqId, idleSeqId, walkSeqId } = this.resolveNpcMovementSequenceIds(
                    ecs,
                    id,
                );
                const movementAnim =
                    (movementSeqId | 0) === (idleSeqId | 0)
                        ? (map.npcIdleFrames[j] as AnimationFrames | undefined)
                        : (movementSeqId | 0) === (walkSeqId | 0)
                        ? ((map.npcWalkFrames[j] ?? map.npcIdleFrames[j]) as AnimationFrames) ??
                          undefined
                        : undefined;
                let movementLengths =
                    (movementSeqId | 0) === (idleSeqId | 0)
                        ? (map.npcIdleFrameLengths[j] as number[] | undefined)
                        : (movementSeqId | 0) === (walkSeqId | 0)
                        ? ((map.npcWalkFrameLengths[j] ??
                              map.npcIdleFrameLengths[j]) as number[]) ?? undefined
                        : undefined;
                const currentMovementSeqId = ecs.getMovementSeqId?.(id) | 0;

                if ((movementSeqId | 0) !== (currentMovementSeqId | 0)) {
                    ecs.setMovementSeqId?.(id, movementSeqId | 0);
                    ecs.setMovementFrameIndex?.(id, 0);
                    ecs.setMovementAnimTick?.(id, 0);
                    ecs.setMovementLoopCount?.(id, 0);
                }

                let movementSeqType: any | undefined;
                if (movementSeqId >= 0) {
                    try {
                        movementSeqType = this.osrsClient.seqTypeLoader.load(movementSeqId | 0);
                    } catch {}
                }

                let movementFrameCount = Math.max(1, (movementAnim?.frames.length ?? 0) | 0);
                if (movementFrameCount <= 1 && movementSeqId >= 0) {
                    if (
                        !!movementSeqType?.isSkeletalSeq?.() ||
                        (movementSeqType?.skeletalId ?? -1) >= 0
                    ) {
                        movementFrameCount = Math.max(
                            1,
                            movementSeqType?.getSkeletalDuration?.() | 0,
                        );
                    } else if (Array.isArray(movementSeqType?.frameIds)) {
                        movementFrameCount = Math.max(1, movementSeqType.frameIds.length | 0);
                        if (!movementLengths) {
                            movementLengths = new Array<number>(movementFrameCount).fill(1);
                            for (let k = 0; k < movementFrameCount; k++) {
                                try {
                                    movementLengths[k] =
                                        movementSeqType.getFrameLength(
                                            this.osrsClient.seqFrameLoader,
                                            k | 0,
                                        ) | 0;
                                } catch {}
                            }
                        }
                    }
                }
                const movementStep = this.stepNpcSequenceTrack(
                    ecs.getMovementFrameIndex?.(id) | 0,
                    ecs.getMovementAnimTick?.(id) | 0,
                    ecs.getMovementLoopCount?.(id) | 0,
                    movementFrameCount | 0,
                    movementLengths,
                    movementSeqType,
                    false,
                );
                ecs.setMovementFrameIndex?.(id, movementStep.frameIndex | 0);
                ecs.setMovementAnimTick?.(id, movementStep.animTick | 0);
                ecs.setMovementLoopCount?.(id, movementStep.loopCount | 0);

                if (movementStep.frameAdvanced && movementSeqType?.frameSounds?.size) {
                    try {
                        this.osrsClient.handleSeqFrameSounds(
                            movementSeqType,
                            movementStep.frameIndex | 0,
                            {
                                position: {
                                    x: npcWorldX,
                                    y: npcWorldY,
                                    z: (ecs.getLevel(id) | 0) * 128,
                                },
                                isLocalPlayer: false,
                            },
                        );
                    } catch {}
                }

                if (seqId >= 0 && seqDelay === 0) {
                    let actionLengths = extraLenMap?.[seqId];
                    let actionFrameCount = 1;
                    let actionSeqType: any | undefined;
                    try {
                        actionSeqType = this.osrsClient.seqTypeLoader.load(seqId | 0);
                    } catch {}

                    const seqAnim = extraAnimMap?.[seqId];
                    if (seqAnim) {
                        actionFrameCount = Math.max(1, seqAnim.frames.length | 0);
                    } else if (
                        !!actionSeqType?.isSkeletalSeq?.() ||
                        (actionSeqType?.skeletalId ?? -1) >= 0
                    ) {
                        actionFrameCount = Math.max(1, actionSeqType?.getSkeletalDuration?.() | 0);
                    } else if (Array.isArray(actionSeqType?.frameIds)) {
                        actionFrameCount = Math.max(1, actionSeqType.frameIds.length | 0);
                        if (!actionLengths) {
                            actionLengths = new Array<number>(actionFrameCount).fill(1);
                            for (let k = 0; k < actionFrameCount; k++) {
                                try {
                                    actionLengths[k] =
                                        actionSeqType.getFrameLength(
                                            this.osrsClient.seqFrameLoader,
                                            k | 0,
                                        ) | 0;
                                } catch {}
                            }
                        }
                    }

                    const actionStep = this.stepNpcSequenceTrack(
                        ecs.getFrameIndex(id) | 0,
                        ecs.getAnimTick(id) | 0,
                        ecs.getLoopCount(id) | 0,
                        actionFrameCount | 0,
                        actionLengths,
                        actionSeqType,
                        true,
                    );

                    // OSRS parity: When a one-shot animation finishes, hold the
                    // last frame while seqTicksLeft > 0 instead of immediately
                    // reverting to idle. This prevents the NPC from flashing back
                    // to its idle pose between the death animation ending and the
                    // server despawn packet arriving.
                    // NOTE: In OSRS, death animations have a very long hold frame
                    // (65535 cycles) on their final frame in the cache data, which
                    // keeps the corpse pose visible until the server removes the NPC.
                    // This client-side seqTicksLeft buffer is a workaround for
                    // animations that lack proper cache hold frames. The proper fix
                    // is adding hold frames to death SeqTypes in the cache.
                    const ticksLeft = ecs.getSeqTicksLeft(id) | 0;
                    if (ticksLeft > 0) {
                        ecs.setSeqTicksLeft(id, (ticksLeft - 1) | 0);
                    }

                    if (actionStep.cleared) {
                        if (ticksLeft > 0) {
                            // Hold last frame until seqTicksLeft expires
                            ecs.setFrameIndex(id, Math.max(0, (actionFrameCount - 1) | 0));
                            ecs.setAnimTick(id, 0);
                            ecs.setLoopCount(id, actionStep.loopCount | 0);
                        } else {
                            ecs.clearSeq(id);
                        }
                    } else {
                        ecs.setFrameIndex(id, actionStep.frameIndex | 0);
                        ecs.setAnimTick(id, actionStep.animTick | 0);
                        ecs.setLoopCount(id, actionStep.loopCount | 0);
                    }

                    if (actionStep.frameAdvanced && actionSeqType?.frameSounds?.size) {
                        try {
                            this.osrsClient.handleSeqFrameSounds(
                                actionSeqType,
                                actionStep.frameIndex | 0,
                                {
                                    position: {
                                        x: npcWorldX,
                                        y: npcWorldY,
                                        z: (ecs.getLevel(id) | 0) * 128,
                                    },
                                    isLocalPlayer: false,
                                },
                            );
                        } catch {}
                    }
                }
            }
        }
    }

    // Helper to add ambient sound instance with object pooling
    private addAmbientSoundInstance(
        locId: number,
        locType: any,
        x: number,
        y: number,
        z: number,
        orientation: number = 0,
    ): void {
        const idx = this.ambientSoundBufferIndex;
        const buffer = this.ambientSoundBuffer;

        // Reuse existing object or create new one
        let inst = buffer[idx];
        if (!inst) {
            inst = {} as import("../audio/SoundEffectSystem").AmbientSoundInstance;
            buffer[idx] = inst;
        }

        // Update all properties
        inst.locId = locId;
        inst.soundId = locType.ambientSoundId;
        inst.x = x;
        inst.y = y;
        inst.z = z;
        inst.maxDistance = locType.soundMaxDistance;
        inst.minDistance = locType.soundMinDistance;
        inst.changeTicksMin = locType.ambientSoundChangeTicksMin;
        inst.changeTicksMax = locType.ambientSoundChangeTicksMax;
        inst.soundIds = locType.ambientSoundIds;
        inst.sizeX = locType.sizeX;
        inst.sizeY = locType.sizeY;
        inst.orientation = orientation;
        inst.fadeInDurationMs = locType.soundFadeInDuration || undefined;
        inst.fadeOutDurationMs = locType.soundFadeOutDuration || undefined;
        inst.fadeInCurve = locType.soundFadeInCurve || undefined;
        inst.fadeOutCurve = locType.soundFadeOutCurve || undefined;
        inst.distanceFadeCurve = locType.soundDistanceFadeCurve || undefined;
        inst.distanceOverride = locType.soundAreaRadiusOverride ?? undefined;
        inst.loopSequentially = locType.loopMultiSoundSequentially;
        inst.deferSwap = locType.deferredAmbientSwap;
        inst.exactPosition = locType.useExactSoundPosition;
        inst.resetOnLoop = locType.resetAmbientOnLoopRestart;

        this.ambientSoundBufferIndex = idx + 1;
    }

    collectAmbientSounds(map: WebGLMapSquare): void {
        const mapBaseX = map.mapX * 64;
        const mapBaseY = map.mapY * 64;

        // Use the player's position for distance filtering (matches reference).
        // The reference uses playerTopLevelPosition for 2D distance; plane is filtered separately.
        let playerX: number;
        let playerY: number;
        let playerLevel: number;
        try {
            const pe = this.osrsClient.playerEcs;
            const idx = pe.getIndexForServerId(this.osrsClient.controlledPlayerServerId);
            if (idx !== undefined) {
                playerX = pe.getX(idx) | 0;
                playerY = pe.getY(idx) | 0;
                playerLevel = pe.getLevel(idx) | 0;
            } else {
                playerX = this.osrsClient.camera.getPosX() * 128;
                playerY = this.osrsClient.camera.getPosZ() * 128;
                playerLevel = 0;
            }
        } catch {
            playerX = this.osrsClient.camera.getPosX() * 128;
            playerY = this.osrsClient.camera.getPosZ() * 128;
            playerLevel = 0;
        }

        const playerTileX = (playerX / 128) | 0;
        const playerTileY = (playerY / 128) | 0;
        const playerLocalX = playerTileX - mapBaseX;
        const playerLocalY = playerTileY - mapBaseY;

        // Max audio range in tiles (MAX_AUDIO_RANGE / 128)
        const maxRangeTiles = (WebGLOsrsRenderer.MAX_AUDIO_RANGE / 128) | 0;

        // Collect from animated locs (these are sparse, iterate all)
        // Only include locs on the player's current level.
        if (map.locsAnimated) {
            for (const loc of map.locsAnimated) {
                if (loc.level !== playerLevel) continue;

                const locType = this.osrsClient.locTypeLoader.load(loc.id);
                if (!locType) continue;

                if (
                    locType.ambientSoundId !== -1 ||
                    (locType.ambientSoundIds && locType.ambientSoundIds.length > 0)
                ) {
                    // 2D distance check (reference uses 2D only; plane is binary)
                    const dx = loc.x - playerX;
                    const dy = loc.y - playerY;
                    const distSq = dx * dx + dy * dy;
                    const distTiles = Math.max(
                        0,
                        locType.soundAreaRadiusOverride !== undefined &&
                            locType.soundAreaRadiusOverride >= 0
                            ? locType.soundAreaRadiusOverride
                            : locType.soundMaxDistance,
                    );
                    const filterBase = distTiles * 128;
                    const filterDist = filterBase > 0 ? filterBase + 2048 : 4096;

                    if (distSq <= filterDist * filterDist) {
                        this.addAmbientSoundInstance(
                            loc.id,
                            locType,
                            loc.x,
                            loc.y,
                            loc.level * 128,
                            loc.rotation,
                        );
                    }
                }
            }
        }

        // Collect from static locs — only on the player's current level.
        const minLocalX = Math.max(0, playerLocalX - maxRangeTiles);
        const maxLocalX = Math.min(63, playerLocalX + maxRangeTiles);
        const minLocalY = Math.max(0, playerLocalY - maxRangeTiles);
        const maxLocalY = Math.min(63, playerLocalY + maxRangeTiles);

        if (minLocalX > 63 || maxLocalX < 0 || minLocalY > 63 || maxLocalY < 0) {
            return;
        }

        const maxDistSq = WebGLOsrsRenderer.MAX_AUDIO_RANGE * WebGLOsrsRenderer.MAX_AUDIO_RANGE;
        const level = playerLevel;

        for (let localX = minLocalX; localX <= maxLocalX; localX++) {
            const worldSceneX = (mapBaseX + localX) * 128 + 64;
            const dxTile = worldSceneX - playerX;
            const dxSqTile = dxTile * dxTile;

            if (dxSqTile > maxDistSq) continue;

            for (let localY = minLocalY; localY <= maxLocalY; localY++) {
                const locIds = map.getLocIdsAtLocal(level, localX, localY);
                if (locIds.length === 0) continue;
                const locTypeRots = map.getLocTypeRotsAtLocal(level, localX, localY);

                const worldSceneY = (mapBaseY + localY) * 128 + 64;
                const dyTile = worldSceneY - playerY;
                const distSqTile = dxSqTile + dyTile * dyTile;

                if (distSqTile > maxDistSq) continue;

                for (let li = 0; li < locIds.length; li++) {
                    const locId = locIds[li];
                    const locType = this.osrsClient.locTypeLoader.load(locId);
                    if (!locType) continue;

                    if (
                        locType.ambientSoundId !== -1 ||
                        (locType.ambientSoundIds && locType.ambientSoundIds.length > 0)
                    ) {
                        const distTiles2 = Math.max(
                            0,
                            locType.soundAreaRadiusOverride !== undefined &&
                                locType.soundAreaRadiusOverride >= 0
                                ? locType.soundAreaRadiusOverride
                                : locType.soundMaxDistance,
                        );
                        const filterBase2 = distTiles2 * 128;
                        const filterDist = filterBase2 > 0 ? filterBase2 + 2048 : 4096;

                        if (distSqTile <= filterDist * filterDist) {
                            const packed = li < locTypeRots.length ? locTypeRots[li] : 0;
                            const rot = (packed >> 6) & 3;
                            this.addAmbientSoundInstance(
                                locId,
                                locType,
                                worldSceneX,
                                worldSceneY,
                                level * 128,
                                rot,
                            );
                        }
                    }
                }
            }
        }
    }

    addNpcRenderData(map: WebGLMapSquare) {
        if (!map.drawCallNpc || !map.npcEntityIds || map.npcEntityIds.length === 0) return;

        // Always use slot 0 for double-buffered actor data
        const sampleIdx = 0;

        if (this.unifiedActorData) {
            const ids: number[] = map.npcEntityIds as any;
            const ecs = this.osrsClient.npcEcs;
            const npcCount = ids.length | 0;

            if (npcCount === 0) {
                map.npcDataTextureOffsets[sampleIdx] = -1;
                return;
            }

            const baseOffset = this.actorRenderCount;
            const required = baseOffset + npcCount;
            if (this.actorRenderData.length / 8 < required) {
                const newData = new Uint16Array(Math.ceil((required * 2) / 16) * 16 * 8);
                newData.set(this.actorRenderData);
                this.actorRenderData = newData;
            }

            map.npcDataTextureOffsets[sampleIdx] = baseOffset;

            for (let i = 0; i < npcCount; i++) {
                const id = ids[i] | 0;
                const offset = (baseOffset + i) * 8;
                if (!this.shouldRenderNpcFromMap(map, id)) {
                    this.actorRenderData[offset + 0] = 0;
                    this.actorRenderData[offset + 1] = 0;
                    this.actorRenderData[offset + 2] = 0;
                    this.actorRenderData[offset + 3] = 0;
                    this.actorRenderData[offset + 4] = 0;
                    this.actorRenderData[offset + 5] = 0;
                    this.actorRenderData[offset + 6] = 0;
                    this.actorRenderData[offset + 7] = 0;
                    continue;
                }
                // NPC geometry ownership can lag one map refresh behind ECS ownership while an NPC
                // crosses a 64x64 map-square boundary. Convert from world space back into the
                // currently drawn map so the existing draw batch remains stable until refresh.
                const npcX = ecs.getLocalXForMap(id, map.mapX);
                const npcY = ecs.getLocalYForMap(id, map.mapY);
                const localTileX = clamp((npcX >> 7) | 0, 0, 63);
                const localTileY = clamp((npcY >> 7) | 0, 0, 63);
                const renderPlane = resolveHeightSamplePlaneForLocal(
                    map,
                    ecs.getLevel(id) | 0,
                    localTileX,
                    localTileY,
                );
                // Texel 0: position, plane|rotation, interactionId
                this.actorRenderData[offset + 0] = npcX;
                this.actorRenderData[offset + 1] = npcY;
                this.actorRenderData[offset + 2] = renderPlane | (ecs.getRotation(id) << 2);
                this.actorRenderData[offset + 3] = ecs.getServerId(id);
                // Texel 1: per-actor HSL override
                const npcOverride = ecs.getColorOverride(id);
                const clientCycle = getClientCycle() | 0;
                if (
                    npcOverride.amount !== 0 &&
                    clientCycle >= npcOverride.startCycle &&
                    clientCycle < npcOverride.endCycle
                ) {
                    this.actorRenderData[offset + 4] =
                        (npcOverride.hue & 0x7f) | ((npcOverride.sat & 0x7f) << 7);
                    this.actorRenderData[offset + 5] =
                        (npcOverride.lum & 0x7f) | ((npcOverride.amount & 0xff) << 7);
                } else {
                    this.actorRenderData[offset + 4] = 0;
                    this.actorRenderData[offset + 5] = 0;
                }
                this.actorRenderData[offset + 6] = 0;
                this.actorRenderData[offset + 7] = 0;
            }

            this.actorRenderCount = required;
        }
    }

    addPlayerRenderData(map: WebGLMapSquare) {
        this.playerRenderer.addPlayerRenderData(map);
    }

    addProjectileRenderData(map: WebGLMapSquare) {
        if (!this.projectileManager) return;

        const projectiles = this.projectileManager.getProjectilesForMap(map.mapX, map.mapY);
        const projCount = projectiles.length;
        const key = `${map.mapX},${map.mapY}`;
        const prevCount = this.projectileRenderDebugCounts.get(key) ?? 0;
        if (prevCount !== projCount) {
            /*console.info(
                `[ProjectileRenderer] Map (${map.mapX}, ${map.mapY}) render queue changed from ${prevCount} to ${projCount}`,
            );*/
            this.projectileRenderDebugCounts.set(key, projCount);
        }

        if (projCount === 0) {
            if (map.projectileDataTextureOffsets) {
                map.projectileDataTextureOffsets[0] = -1;
            }
            return;
        }

        // Store the starting offset for this map's projectiles
        const baseOffset = this.actorRenderCount;
        const required = baseOffset + projCount;

        // Ensure buffer capacity (8 uint16s per entry = 2 texels - shared with NPCs/Players)
        if (required * 8 > this.actorRenderData.length) {
            const newCap = Math.max(required * 8, this.actorRenderData.length * 2);
            const newBuf = new Uint16Array(newCap);
            newBuf.set(this.actorRenderData);
            this.actorRenderData = newBuf;
        }

        // Store base offset for rendering
        if (!map.projectileDataTextureOffsets) {
            map.projectileDataTextureOffsets = new Array(2);
        }
        map.projectileDataTextureOffsets[0] = baseOffset;

        // Write projectile data
        const mapWorldX = map.mapX << 13;
        const mapWorldY = map.mapY << 13;

        for (let i = 0; i < projCount; i++) {
            const proj = projectiles[i];
            const offset = (baseOffset + i) * 8;
            const pos = proj.getPosition();

            // Convert from 128-unit coordinates to sub-tile coordinates (relative to map)
            // Map coords are in world 128-units, need to make them relative to this map square
            const relativeXf = pos.x - mapWorldX;
            const relativeYf = pos.y - mapWorldY;
            const baseRelativeX = Math.floor(relativeXf);
            const baseRelativeY = Math.floor(relativeYf);

            const localTileX = clamp((baseRelativeX >> 7) | 0, 0, 63);
            const localTileY = clamp((baseRelativeY >> 7) | 0, 0, 63);
            const renderPlane = resolveHeightSamplePlaneForLocal(
                map,
                proj.plane | 0,
                localTileX,
                localTileY,
            );

            // Get rotation (yaw, pitch, and roll in OSRS units 0-2047)
            const rotation = proj.getRotation();
            const yawOsrs = (rotation.yaw & 2047) | 0; // Clamp to 0-2047
            const pitchOsrs = (rotation.pitch & 2047) | 0; // Clamp to 0-2047
            const rollOsrs = (rotation.roll & 2047) | 0; // Clamp to 0-2047

            // Pack angles: pitch gets 7 bits (original precision), roll gets 3 bits, projectileId gets 9 bits
            const pitchShifted = (pitchOsrs >> 4) & 0x7f; // 7 bits for pitch (128 values, 16-unit precision)
            const pitchHi = (pitchShifted >> 4) & 0x7; // 3 high bits
            const pitchLo = pitchShifted & 0xf; // 4 low bits
            const rollShifted = (rollOsrs >> 8) & 0x7; // 3 bits for roll (8 values, 256-unit precision)

            const plane = renderPlane & 0x3;

            // Texel 0: position, rotation, projectile ID
            this.actorRenderData[offset + 0] = baseRelativeX & 0xffff;
            this.actorRenderData[offset + 1] = baseRelativeY & 0xffff;
            this.actorRenderData[offset + 2] = (plane | (yawOsrs << 2) | (pitchHi << 13)) & 0xffff;
            this.actorRenderData[offset + 3] =
                ((proj.projectileId & 0x1ff) | (pitchLo << 9) | (rollShifted << 13)) & 0xffff;
            // Texel 1: unused for projectiles
            this.actorRenderData[offset + 4] = 0;
            this.actorRenderData[offset + 5] = 0;
            this.actorRenderData[offset + 6] = 0;
            this.actorRenderData[offset + 7] = 0;
        }

        this.actorRenderCount = required;
    }

    addWorldGfxRenderData(map: WebGLMapSquare): void {
        if (!this.gfxManager) return;
        const instances = this.gfxManager.listWorldInstancesForMap(map.mapX, map.mapY);
        // Always use slot 0 for double-buffered actor data
        const sampleIdx = 0;
        if (instances.length === 0) {
            map.worldGfxDataTextureOffsets[sampleIdx] = -1;
            return;
        }
        const baseOffset = this.actorRenderCount;
        const required = baseOffset + instances.length;
        if (this.actorRenderData.length / 8 < required) {
            const newData = new Uint16Array(Math.ceil((required * 2) / 16) * 16 * 8);
            newData.set(this.actorRenderData);
            this.actorRenderData = newData;
        }
        map.worldGfxDataTextureOffsets[sampleIdx] = baseOffset;
        const mapBaseX = map.mapX * 64;
        const mapBaseY = map.mapY * 64;
        for (let i = 0; i < instances.length; i++) {
            const inst = instances[i];
            const world = inst.world;
            if (!world) continue;
            const worldX = (world.tileX | 0) * 128 + 64;
            const worldY = (world.tileY | 0) * 128 + 64;
            const localX = worldX - mapBaseX * 128;
            const localY = worldY - mapBaseY * 128;
            const localTileX = clamp((world.tileX | 0) - mapBaseX, 0, 63);
            const localTileY = clamp((world.tileY | 0) - mapBaseY, 0, 63);
            const renderPlane = resolveHeightSamplePlaneForLocal(
                map,
                world.level | 0,
                localTileX,
                localTileY,
            );
            const offset = (baseOffset + i) * 8;
            this.actorRenderData[offset + 0] = localX;
            this.actorRenderData[offset + 1] = localY;
            this.actorRenderData[offset + 2] = renderPlane;
            this.actorRenderData[offset + 3] = 0;
            // Texel 1: HSL override (zeroed — world GFX have no actor override)
            this.actorRenderData[offset + 4] = 0;
            this.actorRenderData[offset + 5] = 0;
            this.actorRenderData[offset + 6] = 0;
            this.actorRenderData[offset + 7] = 0;
            world.mapId = map.id;
            world.slot = i;
        }
        this.actorRenderCount = required;
    }

    // Commit one server step per tick for each player following a planned path.
    private _ecsUpdatePlayerServer(): void {
        return;
    }

    updateActorDataTexture() {
        const texWidth = 16;
        // 2 texels per actor (position + HSL override data)
        const texelCount = this.actorRenderCount * 2;
        const texHeight = Math.max(Math.ceil(texelCount / texWidth), 1);

        // PicoGL allocates immutable storage via texStorage2D, so the upload buffer must be large enough
        // for the full texture (including padding to the 16-wide grid), not just actorRenderCount entries.
        const requiredU16 = texWidth * texHeight * 4;
        if (this.actorRenderData.length < requiredU16) {
            const newData = new Uint16Array(requiredU16);
            newData.set(this.actorRenderData);
            this.actorRenderData = newData;
        }
        // Ensure padding texels (up to the next 16-wide row) don't leak stale values.
        const writtenU16 = (this.actorRenderCount * 8) | 0;
        if (writtenU16 < requiredU16) {
            this.actorRenderData.fill(0, writtenU16, requiredU16);
        }

        // Compute checksum over actual actor data to detect changes
        let checksum = this.actorRenderCount | 0;
        const data = this.actorRenderData;
        const len = writtenU16 | 0;
        for (let i = 0; i < len; i++) {
            checksum = (checksum * 31 + data[i]) | 0;
        }

        // If data hasn't changed and texture size matches, reuse current texture
        const currentTex = this.actorDataTextures[this.actorDataCurrentIndex];
        if (
            checksum === this.actorDataChecksum &&
            texHeight === this.actorDataLastTexHeight &&
            currentTex
        ) {
            // Keep legacy buffer in sync for any code that references it
            this.actorDataTextureBuffer[0] = currentTex;
            return 0;
        }

        // Data changed - write to the OTHER texture, then swap
        this.actorDataChecksum = checksum;
        this.actorDataLastTexHeight = texHeight;

        const writeIndex = 1 - this.actorDataCurrentIndex;
        const uploadView = this.actorRenderData.subarray(0, requiredU16);

        let writeTex = this.actorDataTextures[writeIndex];
        if (!writeTex) {
            writeTex = this.app.createTexture2D(uploadView, texWidth, texHeight, {
                internalFormat: PicoGL.RGBA16UI,
                type: PicoGL.UNSIGNED_SHORT,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
                wrapS: PicoGL.CLAMP_TO_EDGE,
                wrapT: PicoGL.CLAMP_TO_EDGE,
            });
            this.actorDataTextures[writeIndex] = writeTex;
        } else {
            writeTex.resize(texWidth, texHeight);
            writeTex.data(uploadView);
        }

        // Swap: the texture we just wrote becomes the current one
        this.actorDataCurrentIndex = writeIndex;

        // Keep legacy buffer in sync for any code that references it
        this.actorDataTextureBuffer[0] = writeTex;
        return 0;
    }

    private _accumulate(drawRanges: DrawRange[], length?: number): void {
        // Count batches and indices
        const len = length ?? drawRanges.length;
        this._frameBatches += len;
        for (let i = 0; i < len; i++) {
            const r = drawRanges[i] as DrawRange;
            const count = (r?.[1] ?? 0) * (r?.[2] ?? 1);
            this._frameIndices += count;
        }
    }

    configureDrawCall(drawCall: DrawCall): DrawCall {
        return this.drawBackend ? this.drawBackend.configureDrawCall(drawCall) : drawCall;
    }

    draw(drawCall: DrawCall, drawRanges: DrawRange[], drawIndices?: number[]) {
        // Accumulate stats regardless of draw path
        if (drawIndices && drawIndices.length > 0) {
            // Reuse buffer to avoid per-frame allocation
            const len = drawIndices.length;
            if (this.drawSubsetBuffer.length < len) {
                this.drawSubsetBuffer.length = len;
            }
            for (let i = 0; i < len; i++) this.drawSubsetBuffer[i] = drawRanges[drawIndices[i]];
            this._accumulate(this.drawSubsetBuffer, len);
        } else {
            this._accumulate(drawRanges);
        }

        if (this.drawBackend) {
            this.drawBackend.draw(drawCall, drawRanges, drawIndices);
        } else {
            drawCall.draw();
        }
    }

    private drawWithRoofPlaneFilter(
        drawCall: DrawCall,
        drawRanges: DrawRange[],
        drawRangePlanes: Uint8Array | undefined,
        roofPlaneLimit: number,
    ): void {
        const totalRanges = drawRanges.length | 0;
        this.frameRoofTotalRangeCount += totalRanges;
        if (totalRanges <= 0) {
            return;
        }

        if (!drawRangePlanes || roofPlaneLimit >= 3) {
            this.draw(drawCall, drawRanges);
            return;
        }

        const cullLimit = Math.floor(roofPlaneLimit + 0.5);
        const filtered = this.roofFilteredDrawIndices;
        filtered.length = 0;

        for (let i = 0; i < totalRanges; i++) {
            // Missing plane metadata should never happen, but default to visible to avoid
            // accidentally dropping geometry.
            const plane = i < drawRangePlanes.length ? drawRangePlanes[i] : 0;
            if (plane <= cullLimit) {
                filtered.push(i);
            }
        }

        const visibleRanges = filtered.length | 0;
        this.frameRoofFilteredRangeCount += Math.max(0, totalRanges - visibleRanges);
        if (visibleRanges <= 0) {
            return;
        }
        if (visibleRanges >= totalRanges) {
            this.draw(drawCall, drawRanges);
            return;
        }
        this.draw(drawCall, drawRanges, filtered);
    }

    private getMapTileDistanceFromPoint(map: WebGLMapSquare, tileX: number, tileY: number): number {
        const mapMinTileX = map.mapX * Scene.MAP_SQUARE_SIZE;
        const mapMinTileY = map.mapY * Scene.MAP_SQUARE_SIZE;
        const mapMaxTileX = mapMinTileX + Scene.MAP_SQUARE_SIZE - 1;
        const mapMaxTileY = mapMinTileY + Scene.MAP_SQUARE_SIZE - 1;
        const dx =
            tileX < mapMinTileX
                ? mapMinTileX - tileX
                : tileX > mapMaxTileX
                ? tileX - mapMaxTileX
                : 0;
        const dy =
            tileY < mapMinTileY
                ? mapMinTileY - tileY
                : tileY > mapMaxTileY
                ? tileY - mapMaxTileY
                : 0;
        return Math.max(dx, dy);
    }

    private getMapZoneDistanceFromPoint(map: WebGLMapSquare, tileX: number, tileY: number): number {
        // OSRS scene visibility is zone-based (8x8 tiles), not map-square based.
        const zoneX = tileX >> 3;
        const zoneY = tileY >> 3;
        const mapMinZoneX = map.mapX << 3;
        const mapMinZoneY = map.mapY << 3;
        const mapMaxZoneX = mapMinZoneX + 7;
        const mapMaxZoneY = mapMinZoneY + 7;
        const dx =
            zoneX < mapMinZoneX
                ? mapMinZoneX - zoneX
                : zoneX > mapMaxZoneX
                ? zoneX - mapMaxZoneX
                : 0;
        const dy =
            zoneY < mapMinZoneY
                ? mapMinZoneY - zoneY
                : zoneY > mapMaxZoneY
                ? zoneY - mapMaxZoneY
                : 0;
        return Math.max(dx, dy);
    }

    private isMapWithinRenderDistance(
        map: WebGLMapSquare,
        tileX: number,
        tileY: number,
        renderDistanceTiles: number,
        renderDistancePadTiles: number,
    ): boolean {
        const zoneDistance = this.getMapZoneDistanceFromPoint(map, tileX, tileY);
        const renderDistanceZones = Math.max(
            0,
            Math.ceil((renderDistanceTiles + renderDistancePadTiles) / 8),
        );
        return zoneDistance <= renderDistanceZones;
    }

    private resolveEffectiveRenderDistanceTiles(frameId: number): number {
        const base = clamp(this.osrsClient.renderDistance | 0, 25, 90);
        if ((this.effectiveRenderDistanceFrame | 0) === (frameId | 0)) {
            return this.effectiveRenderDistanceTiles | 0;
        }
        const profile = this.syncBrowserQualityProfile();
        const target = isTouchDevice ? Math.min(base, profile.renderDistanceCap | 0) : base;
        this.effectiveRenderDistanceTiles = Math.max(0, target | 0);
        this.effectiveRenderDistanceFrame = frameId | 0;
        return this.effectiveRenderDistanceTiles | 0;
    }

    private getFrameRenderDistanceTiles(): number {
        return this.resolveEffectiveRenderDistanceTiles(this.stats.frameCount | 0);
    }

    private resolveEffectiveLodThresholdTiles(frameId: number): number {
        const renderDistance = this.getFrameRenderDistanceTiles() | 0;
        const base = clamp(this.osrsClient.lodDistance | 0, 0, Math.max(0, renderDistance));
        if ((this.effectiveLodThresholdFrame | 0) === (frameId | 0)) {
            return this.effectiveLodThresholdTiles | 0;
        }
        const profile = this.syncBrowserQualityProfile();
        const target = isTouchDevice
            ? Math.min(base, Math.max(0, Math.min(renderDistance, profile.lodThresholdCap | 0)))
            : base;
        this.effectiveLodThresholdTiles = Math.max(0, target | 0);
        this.effectiveLodThresholdFrame = frameId | 0;
        return this.effectiveLodThresholdTiles | 0;
    }

    private getFrameLodThresholdTiles(): number {
        return this.resolveEffectiveLodThresholdTiles(this.stats.frameCount | 0);
    }

    private resolveEffectiveGroundItemOverlayMaxEntries(frameId: number): number {
        if ((this.effectiveGroundItemOverlayFrame | 0) === (frameId | 0)) {
            return this.effectiveGroundItemOverlayMaxEntries | 0;
        }
        const profile = this.syncBrowserQualityProfile();
        const target = isTouchDevice ? profile.groundItemOverlayMaxEntries | 0 : 40;
        this.effectiveGroundItemOverlayMaxEntries = target;
        this.effectiveGroundItemOverlayFrame = frameId | 0;
        return target;
    }

    private getFrameGroundItemOverlayMaxEntries(): number {
        return this.resolveEffectiveGroundItemOverlayMaxEntries(this.stats.frameCount | 0);
    }

    private resolveEffectiveGroundItemOverlayRadius(frameId: number): number {
        if ((this.effectiveGroundItemOverlayRadiusFrame | 0) === (frameId | 0)) {
            return this.effectiveGroundItemOverlayRadius | 0;
        }
        const profile = this.syncBrowserQualityProfile();
        const target = isTouchDevice ? profile.groundItemOverlayRadius | 0 : 12;
        this.effectiveGroundItemOverlayRadius = target;
        this.effectiveGroundItemOverlayRadiusFrame = frameId | 0;
        return target;
    }

    private getFrameGroundItemOverlayRadius(): number {
        return this.resolveEffectiveGroundItemOverlayRadius(this.stats.frameCount | 0);
    }

    private getFrameHitsplatMaxEntries(): number {
        if (!isTouchDevice) return MAX_HIT_ENTRIES;
        return this.syncBrowserQualityProfile().hitsplatMaxEntries | 0;
    }

    private getFrameHealthBarMaxEntries(): number {
        if (!isTouchDevice) return 256;
        return this.syncBrowserQualityProfile().healthBarMaxEntries | 0;
    }

    private getFrameOverheadTextMaxEntries(): number {
        if (!isTouchDevice) return 256;
        return this.syncBrowserQualityProfile().overheadTextMaxEntries | 0;
    }

    private getFrameOverheadPrayerMaxEntries(): number {
        if (!isTouchDevice) return 256;
        return this.syncBrowserQualityProfile().overheadPrayerMaxEntries | 0;
    }

    private updateAnimatedDrawRanges(
        map: WebGLMapSquare,
        drawCall: DrawCall,
        drawRanges: DrawRange[],
        transparent: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): void {
        if (!map.locsAnimated.length) {
            return;
        }

        for (const loc of map.locsAnimated) {
            const frames = transparent ? loc.anim.framesAlpha : loc.anim.frames;
            if (!frames) {
                continue;
            }

            const frame = frames[loc.frame | 0];
            if (!frame) {
                continue;
            }

            const index = loc.getDrawRangeIndex(transparent, isInteract, isLod);
            if (index === -1) {
                continue;
            }

            drawCall.offsets[index] = frame[0];
            (drawCall as any).numElements[index] = frame[1];
            drawRanges[index] = frame;
        }
    }

    private renderGeometryPass(transparent: boolean): void {
        const roofState = this.getRoofState();
        const { roofPlaneLimit } = roofState;
        const cullTile = this.getRenderCullTile(roofState);

        const count = this.mapManager.visibleMapCount;
        if (count === 0) {
            if (!transparent) {
                this.lastLodVisibleMapCount = 0;
                this.lastFullDetailVisibleMapCount = 0;
                this.lastDistanceCulledVisibleMapCount = 0;
            }
            return;
        }

        const start = transparent ? count - 1 : 0;
        const end = transparent ? -1 : count;
        const step = transparent ? -1 : 1;
        const renderDistanceTiles = Math.max(0, this.getFrameRenderDistanceTiles() | 0);
        const renderDistancePadTiles = 0;
        // LOD threshold in tiles from player tile to map bounds.
        const lodThresholdTiles = Math.max(0, this.getFrameLodThresholdTiles() | 0);
        let lodVisibleMapCount = 0;
        let fullDetailVisibleMapCount = 0;
        let distanceCulledVisibleMapCount = 0;

        for (let i = start; i !== end; i += step) {
            const map = this.mapManager.visibleMaps[i];
            const tileDistance = this.getMapTileDistanceFromPoint(map, cullTile.x, cullTile.y);
            if (
                !this.isMapWithinRenderDistance(
                    map,
                    cullTile.x,
                    cullTile.y,
                    renderDistanceTiles,
                    renderDistancePadTiles,
                )
            ) {
                distanceCulledVisibleMapCount++;
                continue;
            }

            // GPU interaction readback removed - always use non-interact draw calls
            const isInteract = false;
            const isLod = tileDistance > lodThresholdTiles;
            if (isLod) {
                lodVisibleMapCount++;
            } else {
                fullDetailVisibleMapCount++;
            }

            const { drawCall, drawRanges } = map.getDrawCall(transparent, isInteract, isLod);
            const drawRangePlanes = map.getDrawRangesPlanes(transparent, isInteract, isLod);

            drawCall.uniform("u_roofPlaneLimit", roofPlaneLimit);
            this.updateAnimatedDrawRanges(
                map,
                drawCall,
                drawRanges,
                transparent,
                isInteract,
                isLod,
            );

            this.drawWithRoofPlaneFilter(drawCall, drawRanges, drawRangePlanes, roofPlaneLimit);

            const groundBatch = map.getGroundItemDrawCall(transparent, isInteract, isLod);
            if (groundBatch) {
                const groundDrawRangePlanes = map.getGroundItemDrawRangesPlanes(
                    transparent,
                    isInteract,
                    isLod,
                );
                groundBatch.drawCall.uniform("u_roofPlaneLimit", roofPlaneLimit);
                this.drawWithRoofPlaneFilter(
                    groundBatch.drawCall,
                    groundBatch.drawRanges,
                    groundDrawRangePlanes,
                    roofPlaneLimit,
                );
            }

            const doorBatch = map.getDoorDrawCall(transparent, isInteract, isLod);
            if (doorBatch) {
                const doorDrawRangePlanes = map.getDoorDrawRangesPlanes(
                    transparent,
                    isInteract,
                    isLod,
                );
                doorBatch.drawCall.uniform("u_roofPlaneLimit", roofPlaneLimit);
                this.drawWithRoofPlaneFilter(
                    doorBatch.drawCall,
                    doorBatch.drawRanges,
                    doorDrawRangePlanes,
                    roofPlaneLimit,
                );
            }
        }

        if (!transparent) {
            this.lastLodVisibleMapCount = lodVisibleMapCount;
            this.lastFullDetailVisibleMapCount = fullDetailVisibleMapCount;
            this.lastLodThreshold = lodThresholdTiles | 0;
            this.lastDistanceCulledVisibleMapCount = distanceCulledVisibleMapCount;
        }
    }

    renderOpaquePass(): void {
        this.renderGeometryPass(false);
    }

    renderTransparentPass(): void {
        this.renderGeometryPass(true);
    }

    renderTransparentNpcPass(
        npcDataTextureIndex: number,
        npcDataTexture: Texture | undefined,
    ): void {
        if (!npcDataTexture || !this.loadNpcs) {
            return;
        }
        const cullTile = this.getRenderCullTile();
        const renderDistanceTiles = Math.max(0, this.getFrameRenderDistanceTiles() | 0);
        const renderDistancePadTiles = 0;

        // Collect dynamic NPCs for second pass
        const dynamicNpcs: Array<{
            map: WebGLMapSquare;
            npcIndex: number;
            ecsId: number;
            npcTypeId: number;
            seqId: number;
            overlaySeqId: number;
            overlayFrameId: number;
            dataOffset: number;
            frameId: number;
        }> = [];

        for (let i = this.mapManager.visibleMapCount - 1; i >= 0; i--) {
            const map = this.mapManager.visibleMaps[i];
            if (
                !this.isMapWithinRenderDistance(
                    map,
                    cullTile.x,
                    cullTile.y,
                    renderDistanceTiles,
                    renderDistancePadTiles,
                )
            ) {
                continue;
            }
            const npcCount = map.npcEntityIds?.length ?? 0;
            if (npcCount === 0) continue;

            const dataOffset = map.npcDataTextureOffsets[npcDataTextureIndex];
            if (dataOffset === -1) {
                continue;
            }

            const npcBatch = map.drawCallNpc;
            if (!npcBatch) continue;
            const { drawCall, drawRanges } = npcBatch;

            drawCall.uniform("u_npcDataOffset", dataOffset);
            drawCall.texture("u_npcDataTexture", npcDataTexture);

            {
                const ecs = this.osrsClient.npcEcs;
                const ids: number[] = map.npcEntityIds as any;
                for (let j = 0; j < npcCount; j++) {
                    const id = ids[j] | 0;
                    if (!this.shouldRenderNpcFromMap(map, id)) {
                        (drawCall as any).offsets[j] = 0;
                        (drawCall as any).numElements[j] = 0;
                        drawRanges[j] = NULL_DRAW_RANGE;
                        continue;
                    }

                    const seqId = ecs.getSeqId(id) | 0;
                    const seqDelay = ecs.getSeqDelay?.(id) | 0;
                    const npcTypeId = (ecs.getNpcTypeId?.(id) ?? -1) | 0;
                    const { movementSeqId, idleSeqId, walkSeqId } =
                        this.resolveNpcMovementSequenceIds(ecs, id);
                    const actionActive = seqId >= 0 && seqDelay === 0;
                    const renderSeqId = actionActive ? seqId | 0 : movementSeqId | 0;
                    const overlaySeqId =
                        actionActive &&
                        this.shouldLayerNpcMovementSequence(
                            seqId | 0,
                            movementSeqId | 0,
                            idleSeqId | 0,
                        )
                            ? movementSeqId | 0
                            : -1;
                    const frameId = actionActive
                        ? ecs.getFrameIndex(id) | 0
                        : ecs.getMovementFrameIndex?.(id) | 0;
                    const overlayFrameId =
                        overlaySeqId >= 0 ? ecs.getMovementFrameIndex?.(id) | 0 : -1;
                    const hasStaticMovementAnim =
                        (movementSeqId | 0) === (idleSeqId | 0) ||
                        (movementSeqId | 0) === (walkSeqId | 0) ||
                        !!map.npcExtraAnims?.[j]?.[movementSeqId | 0];
                    const forceDynamic =
                        overlaySeqId >= 0 || (!actionActive && !hasStaticMovementAnim);
                    const dynamicMeta =
                        renderSeqId >= 0 && npcTypeId >= 0
                            ? this.ensureNpcDynamicSequenceMeta(
                                  map,
                                  j,
                                  npcTypeId,
                                  renderSeqId,
                                  forceDynamic,
                              )
                            : undefined;

                    if (
                        renderSeqId >= 0 &&
                        (forceDynamic || !actionActive || !map.npcExtraAnims?.[j]?.[seqId]) &&
                        dynamicMeta
                    ) {
                        (drawCall as any).offsets[j] = 0;
                        (drawCall as any).numElements[j] = 0;
                        drawRanges[j] = NULL_DRAW_RANGE;
                        dynamicNpcs.push({
                            map,
                            npcIndex: j,
                            ecsId: id,
                            npcTypeId,
                            seqId: renderSeqId | 0,
                            overlaySeqId: overlaySeqId | 0,
                            overlayFrameId: overlayFrameId | 0,
                            dataOffset,
                            frameId,
                        });
                        continue;
                    }

                    const anim = this._resolveNpcAnimation(map, j, ecs, id);
                    let frame: DrawRange = NULL_DRAW_RANGE;
                    if (anim.framesAlpha) {
                        frame =
                            anim.framesAlpha[
                                Math.max(0, Math.min((anim.framesAlpha.length - 1) | 0, frameId))
                            ];
                    }
                    (drawCall as any).offsets[j] = frame[0];
                    (drawCall as any).numElements[j] = frame[1];
                    drawRanges[j] = frame;
                }
            }

            this.draw(drawCall, drawRanges);

            try {
                if (this.gfxRenderer) {
                    // Reuse object to avoid per-call allocation
                    this.gfxRenderPassOffsets.player = undefined;
                    this.gfxRenderPassOffsets.npc = dataOffset;
                    this.gfxRenderPassOffsets.world =
                        map.worldGfxDataTextureOffsets[npcDataTextureIndex];
                    this.gfxRenderer.renderMapPass(
                        map,
                        npcDataTexture,
                        "alpha",
                        this.gfxRenderPassOffsets,
                    );
                }
            } catch {}
        }

        if (dynamicNpcs.length > 0 && npcDataTexture) {
            for (const dyn of dynamicNpcs) {
                const geometry = this.dynamicNpcAnimLoader?.getFrameGeometry(
                    dyn.npcTypeId,
                    dyn.seqId,
                    dyn.frameId,
                    dyn.overlaySeqId,
                    dyn.overlayFrameId,
                );
                if (!geometry) {
                    continue;
                }

                const indexCount = this.uploadDynamicNpcGeometry(geometry, true);
                if (indexCount <= 0 || !this.dynamicNpcDrawCall) {
                    continue;
                }

                const dynDrawCall = this.dynamicNpcDrawCall;
                dynDrawCall.texture("u_npcDataTexture", npcDataTexture);
                const npcDataOffset = dyn.dataOffset + dyn.npcIndex;

                dynDrawCall.uniform("u_npcDataOffset", npcDataOffset);
                dynDrawCall.uniform("u_mapPos", [dyn.map.mapX, dyn.map.mapY]);
                dynDrawCall.uniform("u_timeLoaded", dyn.map.timeLoaded);
                dynDrawCall.uniform("u_modelYOffset", 0.0);

                // Set height map texture from the map
                const heightMapTex = (dyn.map as any).heightMapTexture;
                if (heightMapTex) {
                    dynDrawCall.texture("u_heightMap", heightMapTex);
                }

                this.dynamicNpcSingleDrawRange[0] = 0;
                this.dynamicNpcSingleDrawRange[1] = indexCount | 0;
                this.dynamicNpcSingleDrawRange[2] = 1;
                (dynDrawCall as any).offsets[0] = 0;
                (dynDrawCall as any).numElements[0] = indexCount | 0;
                this.draw(dynDrawCall, this.dynamicNpcSingleDrawRanges);
            }
        }
    }

    updateGroundItemMeshes(stacks: ClientGroundItemStack[]): void {
        const grouped = new Map<number, ClientGroundItemStack[]>();
        for (const stack of stacks) {
            const tileX = stack.tile.x | 0;
            const tileY = stack.tile.y | 0;
            const mapX = tileX >> 6;
            const mapY = tileY >> 6;
            if (mapX < 0 || mapY < 0) continue;
            const mapId = getMapSquareId(mapX, mapY);
            const clone: ClientGroundItemStack = {
                ...stack,
                itemId: stack.itemId | 0,
                quantity: Math.max(1, stack.quantity | 0),
                tile: { x: tileX, y: tileY, level: stack.tile.level | 0 },
            };
            const list = grouped.get(mapId);
            if (list) list.push(clone);
            else grouped.set(mapId, [clone]);
        }

        const allKeys = new Set<number>([...this.groundItemStacks.keys(), ...grouped.keys()]);
        for (const key of allKeys) {
            const next = grouped.get(key) ?? [];
            const hashNext = next.length > 0 ? this.hashGroundStacks(next) : "";
            const prevHash = this.groundItemStackHashes.get(key) ?? "";
            if (hashNext !== prevHash) {
                if (next.length > 0) {
                    this.groundItemStacks.set(key, next);
                    this.groundItemStackHashes.set(key, hashNext);
                } else {
                    this.groundItemStacks.delete(key);
                    this.groundItemStackHashes.delete(key);
                }

                const mapX = key >> 16;
                let mapY = key & 0xffff;
                if (mapY & 0x8000) mapY = mapY - 0x10000;
                const map = this.mapManager.getMap(mapX, mapY) as WebGLMapSquare | undefined;
                if (map) {
                    this.rebuildGroundItemsForMap(map, next);
                }
            }
        }
    }

    private hashGroundStacks(stacks: ClientGroundItemStack[]): string {
        return stacks
            .slice()
            .sort(
                (a, b) =>
                    a.tile.x - b.tile.x ||
                    a.tile.y - b.tile.y ||
                    a.tile.level - b.tile.level ||
                    a.itemId - b.itemId ||
                    a.quantity - b.quantity ||
                    (a.id | 0) - (b.id | 0),
            )
            .map(
                (stack) =>
                    `${stack.tile.x},${stack.tile.y},${stack.tile.level},${stack.itemId},${stack.quantity},${stack.id}`,
            )
            .join("|");
    }

    private rebuildGroundItemsForMap(
        map: WebGLMapSquare,
        stacks: ClientGroundItemStack[] | undefined,
    ): void {
        if (!this.mainProgram || !this.mainAlphaProgram) return;
        if (!this.textureArray || !this.textureMaterials || !this.sceneUniformBuffer) return;
        const objModelLoader = this.osrsClient.objModelLoader;
        const textureLoader = this.osrsClient.textureLoader;
        if (!objModelLoader || !textureLoader) return;

        const data = buildGroundItemGeometry(
            map,
            stacks && stacks.length > 0 ? stacks : undefined,
            objModelLoader,
            textureLoader,
            this.textureIdIndexMap,
        );

        if (!data) {
            map.clearGroundItemGeometry();
            return;
        }

        const textureUpdates = new Map<number, Int32Array>();
        for (const texId of data.usedTextureIds) {
            if (this.loadedTextureIds.has(texId)) continue;
            try {
                const pixels = textureLoader.getPixelsArgb(texId, TEXTURE_SIZE, true, 1.0);
                textureUpdates.set(texId, pixels);
                this.loadedTextureIds.add(texId);
            } catch (err) {
                console.warn("[ground] failed to load texture", texId, err);
            }
        }
        if (textureUpdates.size > 0) {
            this.updateTextureArray(textureUpdates);
        }

        map.updateGroundItemGeometry(
            this.app,
            this.mainProgram,
            this.mainAlphaProgram,
            this.textureArray,
            this.textureMaterials,
            this.sceneUniformBuffer,
            data,
        );
    }

    // Unified opaque actor pass that draws NPCs and Players for each visible map
    renderOpaqueActorPass(
        actorDataTextureIndex: number,
        actorDataTexture: Texture | undefined,
    ): void {
        if (!actorDataTexture) return;

        const cullTile = this.getRenderCullTile();
        const renderDistanceTiles = Math.max(0, this.getFrameRenderDistanceTiles() | 0);
        const renderDistancePadTiles = 0;

        // Collect dynamic NPCs for second pass
        const dynamicNpcs: Array<{
            map: WebGLMapSquare;
            npcIndex: number;
            ecsId: number;
            npcTypeId: number;
            seqId: number;
            overlaySeqId: number;
            overlayFrameId: number;
            dataOffset: number;
            frameId: number;
        }> = [];

        // Iterate maps front-to-back (same as opaque ordering for map chunks)
        for (let i = 0; i < this.mapManager.visibleMapCount; i++) {
            const map = this.mapManager.visibleMaps[i];
            if (
                !this.isMapWithinRenderDistance(
                    map,
                    cullTile.x,
                    cullTile.y,
                    renderDistanceTiles,
                    renderDistancePadTiles,
                )
            ) {
                continue;
            }
            const npcCount = map.npcEntityIds?.length ?? 0;

            // Draw NPCs in this map using map-specific geometry
            if (this.loadNpcs && npcCount > 0) {
                const baseOffsetNpc = map.npcDataTextureOffsets[actorDataTextureIndex];
                if (baseOffsetNpc !== -1) {
                    const npcBatch = map.drawCallNpc;
                    if (!npcBatch) {
                        continue;
                    }
                    const { drawCall, drawRanges } = npcBatch;
                    drawCall
                        .uniform("u_npcDataOffset", baseOffsetNpc)
                        .uniform("u_modelYOffset", 0.0)
                        .texture("u_npcDataTexture", actorDataTexture);
                    const ecs = this.osrsClient.npcEcs;
                    const ids: number[] = map.npcEntityIds as any;
                    for (let j = 0; j < npcCount; j++) {
                        const id = ids[j] | 0;
                        if (!this.shouldRenderNpcFromMap(map, id)) {
                            (drawCall as any).offsets[j] = 0;
                            (drawCall as any).numElements[j] = 0;
                            drawRanges[j] = NULL_DRAW_RANGE;
                            continue;
                        }

                        const seqId = ecs.getSeqId(id) | 0;
                        const seqDelay = ecs.getSeqDelay?.(id) | 0;
                        const npcTypeId = (ecs.getNpcTypeId?.(id) ?? -1) | 0;
                        const { movementSeqId, idleSeqId, walkSeqId } =
                            this.resolveNpcMovementSequenceIds(ecs, id);
                        const actionActive = seqId >= 0 && seqDelay === 0;
                        const renderSeqId = actionActive ? seqId | 0 : movementSeqId | 0;
                        const overlaySeqId =
                            actionActive &&
                            this.shouldLayerNpcMovementSequence(
                                seqId | 0,
                                movementSeqId | 0,
                                idleSeqId | 0,
                            )
                                ? movementSeqId | 0
                                : -1;
                        const frameId = actionActive
                            ? ecs.getFrameIndex(id) | 0
                            : ecs.getMovementFrameIndex?.(id) | 0;
                        const overlayFrameId =
                            overlaySeqId >= 0 ? ecs.getMovementFrameIndex?.(id) | 0 : -1;
                        const hasStaticMovementAnim =
                            (movementSeqId | 0) === (idleSeqId | 0) ||
                            (movementSeqId | 0) === (walkSeqId | 0) ||
                            !!map.npcExtraAnims?.[j]?.[movementSeqId | 0];
                        const forceDynamic =
                            overlaySeqId >= 0 || (!actionActive && !hasStaticMovementAnim);
                        const dynamicMeta =
                            renderSeqId >= 0 && npcTypeId >= 0
                                ? this.ensureNpcDynamicSequenceMeta(
                                      map,
                                      j,
                                      npcTypeId,
                                      renderSeqId,
                                      forceDynamic,
                                  )
                                : undefined;

                        if (
                            renderSeqId >= 0 &&
                            (forceDynamic || !actionActive || !map.npcExtraAnims?.[j]?.[seqId]) &&
                            dynamicMeta
                        ) {
                            (drawCall as any).offsets[j] = 0;
                            (drawCall as any).numElements[j] = 0;
                            drawRanges[j] = NULL_DRAW_RANGE;
                            dynamicNpcs.push({
                                map,
                                npcIndex: j,
                                ecsId: id,
                                npcTypeId,
                                seqId: renderSeqId | 0,
                                overlaySeqId: overlaySeqId | 0,
                                overlayFrameId: overlayFrameId | 0,
                                dataOffset: baseOffsetNpc,
                                frameId,
                            });
                            continue;
                        }

                        const anim = this._resolveNpcAnimation(map, j, ecs, id);
                        const frame =
                            anim.frames[
                                Math.max(0, Math.min((anim.frames.length - 1) | 0, frameId))
                            ];
                        (drawCall as any).offsets[j] = frame[0];
                        (drawCall as any).numElements[j] = frame[1];
                        drawRanges[j] = frame;
                    }
                    this.draw(drawCall, drawRanges);
                }
            }

            // Draw Players in this map using player geometry
            this.playerRenderer.renderOpaqueForMap(map, actorDataTextureIndex, actorDataTexture);
            // GFX pass (opaque) for attached player/NPC effects
            try {
                const baseOffsetPlayer = map.playerDataTextureOffsets[actorDataTextureIndex];
                const baseOffsetNpcForGfx = map.npcDataTextureOffsets[actorDataTextureIndex];
                if (this.gfxRenderer && (baseOffsetPlayer !== -1 || baseOffsetNpcForGfx !== -1)) {
                    // Reuse object to avoid per-call allocation
                    this.gfxRenderPassOffsets.player =
                        baseOffsetPlayer !== -1 ? baseOffsetPlayer : undefined;
                    this.gfxRenderPassOffsets.npc =
                        baseOffsetNpcForGfx !== -1 ? baseOffsetNpcForGfx : undefined;
                    this.gfxRenderPassOffsets.world =
                        map.worldGfxDataTextureOffsets[actorDataTextureIndex];
                    this.gfxRenderer.renderMapPass(
                        map,
                        actorDataTexture,
                        "opaque",
                        this.gfxRenderPassOffsets,
                    );
                }
            } catch {}
            // Render projectiles (opaque pass)
            try {
                if (map.projectileDataTextureOffsets) {
                    const baseOffsetProjectile = map.projectileDataTextureOffsets[0];
                    if (baseOffsetProjectile !== undefined && baseOffsetProjectile !== -1) {
                        this.projectileRenderer?.renderMapPass(
                            map,
                            baseOffsetProjectile,
                            actorDataTexture,
                            "opaque",
                        );
                    }
                }
            } catch {}
        }

        if (dynamicNpcs.length > 0 && actorDataTexture) {
            for (const dyn of dynamicNpcs) {
                const geometry = this.dynamicNpcAnimLoader?.getFrameGeometry(
                    dyn.npcTypeId,
                    dyn.seqId,
                    dyn.frameId,
                    dyn.overlaySeqId,
                    dyn.overlayFrameId,
                );
                if (!geometry) {
                    continue;
                }

                const indexCount = this.uploadDynamicNpcGeometry(geometry, false);
                if (indexCount <= 0 || !this.dynamicNpcDrawCall) {
                    continue;
                }

                const dynDrawCall = this.dynamicNpcDrawCall;
                dynDrawCall.texture("u_npcDataTexture", actorDataTexture);
                const npcDataOffset = dyn.dataOffset + dyn.npcIndex;

                dynDrawCall.uniform("u_npcDataOffset", npcDataOffset);
                dynDrawCall.uniform("u_mapPos", [dyn.map.mapX, dyn.map.mapY]);
                dynDrawCall.uniform("u_timeLoaded", dyn.map.timeLoaded);
                dynDrawCall.uniform("u_modelYOffset", 0.0);

                // Set height map texture from the map
                const heightMapTex = (dyn.map as any).heightMapTexture;
                if (heightMapTex) {
                    dynDrawCall.texture("u_heightMap", heightMapTex);
                }

                this.dynamicNpcSingleDrawRange[0] = 0;
                this.dynamicNpcSingleDrawRange[1] = indexCount | 0;
                this.dynamicNpcSingleDrawRange[2] = 1;
                (dynDrawCall as any).offsets[0] = 0;
                (dynDrawCall as any).numElements[0] = indexCount | 0;
                this.draw(dynDrawCall, this.dynamicNpcSingleDrawRanges);
            }
        }
    }

    renderTransparentPlayerPass(
        playerDataTextureIndex: number,
        playerDataTexture: Texture | undefined,
    ): void {
        const cullTile = this.getRenderCullTile();
        const renderDistanceTiles = Math.max(0, this.getFrameRenderDistanceTiles() | 0);
        const renderDistancePadTiles = 0;
        this.playerRenderer.renderTransparentPlayerPass(playerDataTextureIndex, playerDataTexture);
        // GFX pass (alpha)
        try {
            if (playerDataTexture) {
                for (let i = this.mapManager.visibleMapCount - 1; i >= 0; i--) {
                    const map = this.mapManager.visibleMaps[i];
                    if (
                        !this.isMapWithinRenderDistance(
                            map,
                            cullTile.x,
                            cullTile.y,
                            renderDistanceTiles,
                            renderDistancePadTiles,
                        )
                    ) {
                        continue;
                    }
                    const baseOffsetPlayer = map.playerDataTextureOffsets[playerDataTextureIndex];
                    // Alpha player phase should only render player-attached effects.
                    // NPC/world alpha effects are handled in renderTransparentNpcPass.
                    if (this.gfxRenderer && baseOffsetPlayer !== -1) {
                        // Reuse object to avoid per-call allocation
                        this.gfxRenderPassOffsets.player = baseOffsetPlayer;
                        this.gfxRenderPassOffsets.npc = undefined;
                        this.gfxRenderPassOffsets.world = undefined;
                        this.gfxRenderer.renderMapPass(
                            map,
                            playerDataTexture,
                            "alpha",
                            this.gfxRenderPassOffsets,
                        );
                    }
                }
            }
        } catch {}
        // Projectile pass (alpha)
        try {
            if (playerDataTexture) {
                for (let i = this.mapManager.visibleMapCount - 1; i >= 0; i--) {
                    const map = this.mapManager.visibleMaps[i];
                    if (
                        !this.isMapWithinRenderDistance(
                            map,
                            cullTile.x,
                            cullTile.y,
                            renderDistanceTiles,
                            renderDistancePadTiles,
                        )
                    ) {
                        continue;
                    }
                    if (map.projectileDataTextureOffsets) {
                        const baseOffsetProjectile = map.projectileDataTextureOffsets[0];
                        if (baseOffsetProjectile !== undefined && baseOffsetProjectile !== -1) {
                            this.projectileRenderer?.renderMapPass(
                                map,
                                baseOffsetProjectile,
                                playerDataTexture,
                                "alpha",
                            );
                        }
                    }
                }
            }
        } catch {}
    }

    checkInteractions(): void {
        const frameCount = this.stats.frameCount;
        this.lastInteractionRaycastHitCount = 0;
        this.lastInteractionMenuOptionCount = 0;
        let raycastHitCount = 0;

        const inputManager = this.osrsClient.inputManager;
        const isMouseDown = inputManager.dragX !== -1 || inputManager.dragY !== -1;
        const pickX = inputManager.pickX;
        const pickY = inputManager.pickY;
        const picked = pickX !== -1 && pickY !== -1;
        const leftClicked = inputManager.leftClickX !== -1 && inputManager.leftClickY !== -1;

        // If the click is inside the bottom-right UI tabs region, consume it (don't interact with world).
        if (leftClicked) {
            const contW = 241;
            const contH = 37 + 261 + 37; // strip + panel + strip
            const contX = this.app.width - 8 - contW; // right margin 8
            const contY = this.app.height - 8 - contH; // bottom margin 8
            const mx = inputManager.leftClickX;
            const my = inputManager.leftClickY;
            if (mx >= contX && mx <= contX + contW && my >= contY && my <= contY + contH) {
                this.clearInteractHighlightHoverTarget();
                return;
            }
        }

        const menuCooldown = isTouchDevice ? 50 : 10;

        if (
            (inputManager.mouseX === -1 ||
                inputManager.mouseY === -1 ||
                frameCount - this.osrsClient.menuOpenedFrame < menuCooldown) &&
            !leftClicked
        ) {
            if (inputManager.mouseX === -1 || inputManager.mouseY === -1) {
                this.clearInteractHighlightHoverTarget();
            }
            return;
        }

        // Don't auto close menu on touch devices
        if (this.osrsClient.menuOpen && !picked && !isMouseDown && isTouchDevice) {
            return;
        }

        if (!picked && !leftClicked && !this.osrsClient.tooltips) {
            this.osrsClient.closeMenu();
            this.clearInteractHighlightHoverTarget();
            return;
        }

        const usingPinnedMenu =
            this.osrsClient.menuOpen &&
            !!this.osrsClient.menuPinnedEntries &&
            this.osrsClient.menuPinnedEntries.length > 0;
        // PERF: Reuse cached array and copy entries in-place instead of .slice()
        const menuEntries = this.cachedMenuEntries;
        menuEntries.length = 0;
        if (usingPinnedMenu) {
            for (let i = 0; i < this.osrsClient.menuPinnedEntries!.length; i++) {
                menuEntries.push(this.osrsClient.menuPinnedEntries![i]);
            }
        }

        const hasActiveSpell = ClientState.isSpellSelected;
        // PERF: Reuse cached spell object instead of creating new one each frame
        let activeSpell = this.cachedActiveSpell;
        if (hasActiveSpell) {
            if (!activeSpell) {
                activeSpell = {
                    spellId: 0,
                    spellName: "",
                    actionName: "",
                    spellLevel: 0,
                    runes: null,
                    targetMask: 0,
                };
                this.cachedActiveSpell = activeSpell;
            }
            activeSpell.spellId = ClientState.selectedSpellId;
            activeSpell.spellName = ClientState.selectedSpellName;
            activeSpell.actionName = ClientState.selectedSpellActionName;
            activeSpell.spellLevel = ClientState.selectedSpellLevel;
            activeSpell.runes = ClientState.selectedSpellRunes;
            activeSpell.targetMask = ClientState.selectedSpellTargetMask;
        } else {
            activeSpell = null;
        }
        // OSRS parity: world "Use" targeting is driven by ClientState.isItemSelected (not inventory UI selection).
        const hasSelectedItem =
            ClientState.isItemSelected === 1 && (ClientState.selectedItemId | 0) > 0;
        const selectedItemName = String(ClientState.selectedSpellName || "");
        const anchorX = picked ? pickX : inputManager.mouseX;
        const anchorY = picked ? pickY : inputManager.mouseY;
        const anchorInSceneViewport = this.osrsClient.camera.containsScreenPoint(anchorX, anchorY);

        // OSRS parity: Only build world menu entries (NPCs, objects, Walk here) when mouse is NOT
        // over an interactive widget. In resizable mode, viewport covers the whole screen but
        // widgets (inventory, chat, etc.) are layered on top and should capture clicks.
        // OSRS parity: Check if mouse is in a UI region (chatbox, minimap, sidebar)
        // The Java client uses dynamic region checks based on frame dimensions
        // See elvarg Client.java getMousePositions() for the reference implementation
        // PERF: Inline check instead of IIFE to avoid per-frame function allocation
        const mouseInUIRegion = this.isMouseInUIRegion(anchorX, anchorY);
        // OSRS parity: Also treat any visible widget/modal capture under the pointer as UI.
        // This prevents world hover/menu fallbacks ("Walk here") from leaking through modal overlays.
        const mouseOverWidget =
            anchorX !== -1 && anchorY !== -1
                ? this.osrsClient.isPointOverWidget(anchorX, anchorY)
                : false;

        // Build world menu entries only if:
        // 1. Not using a pinned menu
        // 2. Mouse is not in a static UI region (chatbox, minimap, sidebar)
        // 3. Mouse is not over any blocking widget/modal capture
        if (!usingPinnedMenu && !mouseInUIRegion && !mouseOverWidget) {
            // OSRS parity: base menu always starts with Cancel (class365.addCancelMenuEntry).
            menuEntries.push({
                option: "Cancel",
                targetId: -1,
                targetType: MenuTargetType.NONE,
                targetName: "",
                targetLevel: -1,
            });
        }

        if (!usingPinnedMenu && !mouseInUIRegion && !mouseOverWidget && anchorInSceneViewport) {
            // PERF: Reuse cached arrays/sets instead of allocating new ones each frame
            const locIds = this.cachedLocIds;
            locIds.clear();
            const objIds = this.cachedObjIds;
            objIds.clear();
            const npcIds = this.cachedNpcIds;
            npcIds.clear();
            const playerIds = this.cachedPlayerIds;
            playerIds.clear();
            const hoveredTile = this.osrsClient.hoveredTile;

            // OSRS parity: add Walk here only when no item/spell is selected (class414.addSceneMenuOptions).
            const baseX = (ClientState.baseX | 0) as number;
            const baseY = (ClientState.baseY | 0) as number;
            const anchorTile = this.computeTileAt(anchorX, anchorY);
            let walkHereEntry: OsrsMenuEntry | undefined = undefined;
            if (ClientState.isItemSelected === 0 && !ClientState.isSpellSelected) {
                const walkTile = anchorTile ?? this.osrsClient.menuTile ?? hoveredTile;
                const tileX = (walkTile?.tileX ?? 0) | 0;
                const tileY = (walkTile?.tileY ?? 0) | 0;
                const localX = (tileX - baseX) | 0;
                const localY = (tileY - baseY) | 0;
                walkHereEntry = {
                    option: "Walk here",
                    targetId: -1,
                    targetType: MenuTargetType.NONE,
                    targetName: "",
                    targetLevel: -1,
                    mapX: localX,
                    mapY: localY,
                    tile: walkTile ? { tileX, tileY, plane: (walkTile as any)?.plane } : undefined,
                    onClick: (_entry, evt?: MouseEvent) => {
                        // Cancel any active follow/interact
                        try {
                            this.osrsClient.playerInteractionSystem.cancel("walk here");
                        } catch {}
                        try {
                            if (isServerConnected()) sendInteractStop();
                        } catch {}
                        // OSRS parity: use the tile determined at menu creation
                        // time, not a re-raycast.  The camera may have shifted
                        // while the menu was open, making a second computeTileAt
                        // return the wrong tile.
                        const wx = tileX;
                        const wy = tileY;
                        if (wx > 0 && wy > 0) {
                            const xy = this.toGLClickXY(evt);
                            menuAction(
                                (wx - baseX) | 0,
                                (wy - baseY) | 0,
                                MenuOpcode.WalkHere,
                                0,
                                -1,
                                "Walk here",
                                "",
                                xy.sx,
                                xy.sy,
                            );
                            try {
                                this.spawnClickCross({ tileX: wx, tileY: wy }, xy, "yellow");
                            } catch {}
                        }
                        this.osrsClient.closeMenu();
                    },
                };
                menuEntries.push(walkHereEntry);
            }

            const ray = this.screenToRay(anchorX, anchorY);
            // OSRS parity: scene interactions are filtered by the current client plane
            // (raw server plane), not the bridge-promoted render plane.
            const interactionPlane = this.getPlayerRawPlane() | 0;
            const raycastHits =
                ray && this.sceneRaycaster
                    ? this.sceneRaycaster.raycast(ray, {
                          maxHits: 1000,
                          basePlane: interactionPlane,
                      })
                    : [];
            raycastHitCount = raycastHits.length | 0;

            const npcEcs = this.osrsClient.npcEcs;
            const playerEcs = this.osrsClient.playerEcs;
            const normalizePlayerName = (name: string | undefined): string => {
                return String(name ?? "")
                    .replace(/<[^>]*>/g, "")
                    .trim()
                    .toLowerCase();
            };
            const clanMemberNames = new Set<string>();
            try {
                const cs2Ctx: any = this.osrsClient.cs2Vm?.context;
                const addName = (raw: unknown): void => {
                    if (typeof raw !== "string") return;
                    const normalized = normalizePlayerName(raw);
                    if (normalized.length > 0) clanMemberNames.add(normalized);
                };
                const addListByField = (list: unknown, fieldName: string): void => {
                    if (!Array.isArray(list)) return;
                    for (const entry of list) {
                        addName((entry as any)?.[fieldName]);
                    }
                };
                const addNameList = (list: unknown): void => {
                    if (!Array.isArray(list)) return;
                    for (const entry of list) addName(entry);
                };
                addListByField(cs2Ctx?.clanMembers, "name");
                addNameList(cs2Ctx?.clanSettings?.memberNames);
                addNameList(cs2Ctx?.clanChannel?.userNames);
            } catch {}
            const isClanMemberName = (name: string | undefined): boolean => {
                const normalized = normalizePlayerName(name);
                return normalized.length > 0 && clanMemberNames.has(normalized);
            };

            const addPlayerMenuEntries = (
                ecsIndex: number,
                worldTileX: number,
                worldTileY: number,
            ): void => {
                const idx = ecsIndex | 0;
                if (idx < 0) return;
                if (playerIds.has(idx)) return;
                playerIds.add(idx);

                const sidRaw = playerEcs.getServerIdForIndex?.(idx);
                const sid = (typeof sidRaw === "number" ? sidRaw | 0 : idx | 0) | 0;
                const myId = this.osrsClient.controlledPlayerServerId | 0;
                if ((sid | 0) === (myId | 0)) return;

                const displayName = playerEcs.getName(idx);
                const playerLabel = displayName || "Player";
                const localX = (worldTileX - baseX) | 0;
                const localY = (worldTileY - baseY) | 0;
                const playerPlane = playerEcs.getLevel(idx) | 0;
                const targetCombatLevel = playerEcs.getCombatLevel(idx) | 0;
                const targetTeam = playerEcs.getTeam(idx) | 0;
                const localEcsIndex = playerEcs.getIndexForServerId?.(myId);
                const localCombatLevelFromEcs =
                    typeof localEcsIndex === "number"
                        ? playerEcs.getCombatLevel(localEcsIndex | 0) | 0
                        : 0;
                const localCombatLevel =
                    localCombatLevelFromEcs > 0
                        ? localCombatLevelFromEcs
                        : ClientState.localPlayerCombatLevel | 0;
                const localTeam =
                    typeof localEcsIndex === "number"
                        ? playerEcs.getTeam(localEcsIndex | 0) | 0
                        : 0;
                const targetIsClanMember = isClanMemberName(playerLabel);

                // OSRS parity: When hovering a player, Walk here target becomes the player's label.
                if (walkHereEntry) {
                    walkHereEntry.targetName = `<col=ffffff>${playerLabel}`;
                }

                // Item selection: Use only (HttpHeaders.addPlayerToMenu).
                if (ClientState.isItemSelected === 1) {
                    const itemName =
                        selectedItemName || `Item ${ClientState.selectedItemId | 0 || 0}`;
                    menuEntries.push({
                        option: "Use",
                        targetId: -1,
                        targetType: MenuTargetType.PLAYER,
                        targetName: `${itemName} -> ${playerLabel}`,
                        targetLevel: -1,
                        mapX: localX,
                        mapY: localY,
                        playerServerId: sid | 0,
                        tile: { tileX: worldTileX, tileY: worldTileY, plane: playerPlane },
                        onClick: (entry?: any) =>
                            this.osrsClient.useSelectedItemOnFromMenu(
                                (entry as any) ?? ({} as any),
                                {
                                    playerServerId: sid | 0,
                                    mapX: localX,
                                    mapY: localY,
                                    tile: {
                                        tileX: worldTileX,
                                        tileY: worldTileY,
                                        plane: playerPlane,
                                    },
                                },
                            ),
                    });
                    return;
                }

                // Spell selection: Cast only when targetable (HttpHeaders.addPlayerToMenu).
                if (ClientState.isSpellSelected) {
                    if (hasActiveSpell && activeSpell && canTargetPlayer(activeSpell.targetMask)) {
                        menuEntries.push({
                            option: activeSpell.actionName || "Cast",
                            targetId: -1,
                            targetType: MenuTargetType.PLAYER,
                            targetName: `${activeSpell.spellName} -> ${playerLabel}`,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                            playerServerId: sid | 0,
                            spellCast: {
                                spellId: activeSpell.spellId,
                                spellName: activeSpell.spellName,
                                spellLevel: activeSpell.spellLevel,
                                runes: activeSpell.runes,
                                playerServerId: sid | 0,
                            },
                        });
                    }
                    return;
                }

                // No selection: insert player actions in 7..0 order.
                for (let actionIdx = 7; actionIdx >= 0; actionIdx--) {
                    if (actionIdx === 2) {
                        menuEntries.push({
                            option: "Follow",
                            targetId: sid | 0,
                            targetType: MenuTargetType.PLAYER,
                            targetName: playerLabel,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                            playerServerId: sid | 0,
                            actionIndex: 2, // OPPLAYER3 - Follow
                            onClick: () => {
                                try {
                                    this.osrsClient.playerInteractionSystem.beginFollow(sid | 0);
                                    if (isServerConnected()) sendInteractFollow(sid | 0, "follow");
                                } catch {}
                            },
                        });
                    } else if (actionIdx === 1) {
                        // OSRS: Trade is typically a low-priority player option from the server.
                        menuEntries.push({
                            option: "Trade with",
                            targetId: sid | 0,
                            targetType: MenuTargetType.PLAYER,
                            targetName: playerLabel,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                            playerServerId: sid | 0,
                            actionIndex: 1, // OPPLAYER2 - Trade with
                            deprioritized: true,
                            onClick: () => {
                                try {
                                    this.osrsClient.playerInteractionSystem.beginTrade(sid | 0);
                                    if (isServerConnected()) sendInteractFollow(sid | 0, "trade");
                                } catch {}
                            },
                        });
                    } else if (actionIdx === 0) {
                        const attackOption = ClientState.playerAttackOption | 0;
                        if (attackOption === 3) continue;

                        let deprioritized = false;
                        if (attackOption === 1) {
                            deprioritized = true;
                        } else if (attackOption === 0) {
                            deprioritized = targetCombatLevel > localCombatLevel;
                        } else if (attackOption === 4) {
                            deprioritized = targetIsClanMember;
                        }

                        // Team logic overrides attack option priority when both players have teams.
                        if (localTeam !== 0 && targetTeam !== 0) {
                            deprioritized = localTeam === targetTeam;
                        }

                        menuEntries.push({
                            option: "Attack",
                            targetId: sid | 0,
                            targetType: MenuTargetType.PLAYER,
                            targetName: playerLabel,
                            targetLevel: targetCombatLevel,
                            mapX: localX,
                            mapY: localY,
                            playerServerId: sid | 0,
                            actionIndex: 0, // OPPLAYER1 - Attack
                            deprioritized,
                            onClick: () => {
                                try {
                                    this.osrsClient.playerInteractionSystem.beginCombat(sid | 0, {
                                        targetType: "player",
                                        tile: { x: localX | 0, y: localY | 0 },
                                    });
                                } catch {}
                            },
                        });
                    }
                }
            };

            const addNpcMenuEntries = (
                npcTypeId: number,
                npcServerId: number,
                npcEcsId: number,
                worldTileX: number,
                worldTileY: number,
            ): void => {
                const sid = npcServerId | 0;
                const ecsId = npcEcsId | 0;
                if (sid <= 0 || ecsId <= 0) return;
                if (npcIds.has(sid)) return;
                npcIds.add(sid);

                let npcType = this.osrsClient.npcTypeLoader.load(npcTypeId | 0);
                if (npcType.transforms) {
                    const transformed = npcType.transform(
                        this.osrsClient.varManager,
                        this.osrsClient.npcTypeLoader,
                    );
                    if (transformed) npcType = transformed;
                }
                if (npcType.name === "null" && !this.osrsClient.debugId) return;
                if (npcType.isFollower && (ClientState.followerIndex | 0) !== (sid | 0)) {
                    return;
                }

                const localX = (worldTileX - baseX) | 0;
                const localY = (worldTileY - baseY) | 0;
                const npcPlane = npcEcs.getLevel(ecsId) | 0;
                const isFollowerLowPriority =
                    npcType.isFollower && ClientState.followerOpsLowPriority;

                // OSRS: For followers with low priority, insert Examine first (opcode 1003).
                if (isFollowerLowPriority) {
                    menuEntries.push({
                        option: "Examine",
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                    });
                }

                // Item selection: Use only (opcode 7), except follower examine above remains.
                if (ClientState.isItemSelected === 1) {
                    const itemName =
                        selectedItemName || `Item ${ClientState.selectedItemId | 0 || 0}`;
                    menuEntries.push({
                        option: "Use",
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: `${itemName} -> ${npcType.name}`,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                        tile: { tileX: worldTileX, tileY: worldTileY, plane: npcPlane },
                        onClick: (entry?: any) =>
                            this.osrsClient.useSelectedItemOnFromMenu(
                                (entry as any) ?? ({} as any),
                                {
                                    npcServerId: sid | 0,
                                    mapX: localX,
                                    mapY: localY,
                                    tile: { tileX: worldTileX, tileY: worldTileY, plane: npcPlane },
                                },
                            ),
                    });
                    return;
                }

                // Spell selection: Cast only when targetable (opcode 8), except follower examine above remains.
                if (ClientState.isSpellSelected) {
                    if (hasActiveSpell && activeSpell && canTargetNpc(activeSpell.targetMask)) {
                        menuEntries.push({
                            option: activeSpell.actionName || "Cast",
                            targetId: npcType.id,
                            targetType: MenuTargetType.NPC,
                            npcServerId: sid | 0,
                            targetName: `${activeSpell.spellName} -> ${npcType.name}`,
                            targetLevel: npcType.combatLevel,
                            mapX: localX,
                            mapY: localY,
                            spellCast: {
                                spellId: activeSpell.spellId,
                                spellName: activeSpell.spellName,
                                spellLevel: activeSpell.spellLevel,
                                runes: activeSpell.runes,
                                npcServerId: sid | 0,
                                mapX: localX,
                                mapY: localY,
                            },
                        });
                    }
                    return;
                }

                const actions = npcType.actions ?? [];
                const followerDeprioritized = isFollowerLowPriority;

                // OSRS: Non-attack options first (4..0).
                for (let actionIdx = 4; actionIdx >= 0; actionIdx--) {
                    const option = actions[actionIdx];
                    if (!option) continue;
                    if (option.toLowerCase() === "attack") continue;
                    const opt = option;
                    menuEntries.push({
                        option: opt,
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                        actionIndex: actionIdx,
                        deprioritized: followerDeprioritized,
                        onClick: (_entry?: any, _evt?: any, ctx?: any) => {
                            // When called as a side-effect by MenuState.invoke (worldMenuStateDispatch),
                            // menuAction already handles packet dispatch via sendNpcInteract.
                            if (ctx?.worldMenuStateDispatch) return;
                            try {
                                this.osrsClient.interactNpc({
                                    npcServerId: sid | 0,
                                    option: opt,
                                    mapX: localX | 0,
                                    mapY: localY | 0,
                                    tile: { tileX: worldTileX | 0, tileY: worldTileY | 0 },
                                });
                            } catch {}
                            this.osrsClient.closeMenu();
                        },
                    });
                }

                // OSRS: Attack options after non-attack (4..0) with npcAttackOption deprioritization.
                for (let actionIdx = 4; actionIdx >= 0; actionIdx--) {
                    const option = actions[actionIdx];
                    if (!option) continue;
                    if (option.toLowerCase() !== "attack") continue;
                    if (ClientState.npcAttackOption === 3) continue;

                    let deprioritized = false;
                    const attackOption = ClientState.npcAttackOption | 0;
                    if (attackOption === 1) {
                        deprioritized = true;
                    } else if (attackOption === 0) {
                        const npcLevel = (npcType.combatLevel ?? 0) | 0;
                        const playerLevel = ClientState.localPlayerCombatLevel | 0 | 0;
                        if (npcLevel > playerLevel) deprioritized = true;
                    }

                    menuEntries.push({
                        option,
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                        actionIndex: actionIdx,
                        deprioritized,
                        onClick: (_entry?: any, _evt?: any, ctx?: any) => {
                            if (ctx?.worldMenuStateDispatch) return;
                            try {
                                this.osrsClient.attackNpc({
                                    npcServerId: sid | 0,
                                    mapX: localX | 0,
                                    mapY: localY | 0,
                                    tile: { tileX: worldTileX | 0, tileY: worldTileY | 0 },
                                });
                            } catch {}
                            this.osrsClient.closeMenu();
                        },
                    });
                }

                // OSRS: Examine at the bottom for non-followers / normal priority followers.
                if (!isFollowerLowPriority) {
                    menuEntries.push({
                        option: "Examine",
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                    });
                }
            };

            // Process raycast hits to build menu entries
            let lastTagKey: string | null = null;
            for (let hitIndex = raycastHits.length - 1; hitIndex >= 0; hitIndex--) {
                const hit = raycastHits[hitIndex];
                const interactId = hit.interactId | 0;
                const interactType = hit.interactType;
                const tagKey = `${interactType}|${interactId}|${hit.tileX ?? ""}|${
                    hit.tileY ?? ""
                }|${hit.npcServerId ?? ""}|${hit.playerEcsIndex ?? ""}`;
                if (tagKey === lastTagKey) continue;
                lastTagKey = tagKey;

                if (interactType === InteractType.LOC) {
                    const baseLocType = this.osrsClient.locTypeLoader.load(interactId);
                    if (!baseLocType) continue;
                    let resolvedLocType = baseLocType;
                    if (baseLocType?.transforms) {
                        const transformed = baseLocType.transform(
                            this.osrsClient.varManager,
                            this.osrsClient.locTypeLoader,
                        );
                        if (transformed) {
                            resolvedLocType = transformed;
                        }
                    }
                    if (resolvedLocType.name === "null" && !this.osrsClient.debugId) continue;

                    const worldTileX = (hit.tileX ?? 0) | 0;
                    const worldTileY = (hit.tileY ?? 0) | 0;
                    const localX = (worldTileX - baseX) | 0;
                    const localY = (worldTileY - baseY) | 0;

                    const dedupeKey = `${interactId | 0}|${localX | 0}|${localY | 0}`;
                    if (locIds.has(dedupeKey)) continue;
                    locIds.add(dedupeKey);

                    // OSRS parity: Item selection suppresses normal actions/examine.
                    if (ClientState.isItemSelected === 1) {
                        const itemName =
                            selectedItemName || `Item ${ClientState.selectedItemId | 0 || 0}`;
                        menuEntries.push({
                            option: "Use",
                            targetId: interactId,
                            targetType: MenuTargetType.LOC,
                            targetName: `${itemName} -> ${resolvedLocType.name}`,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                            onClick: (entry?: any) =>
                                this.osrsClient.useSelectedItemOnFromMenu(
                                    (entry as any) ?? ({} as any),
                                    { mapX: localX, mapY: localY },
                                ),
                        });
                        continue;
                    }

                    // OSRS parity: Spell selection suppresses normal actions/examine.
                    if (ClientState.isSpellSelected) {
                        if (
                            hasActiveSpell &&
                            activeSpell &&
                            canTargetObject(activeSpell.targetMask)
                        ) {
                            menuEntries.push({
                                option: activeSpell.actionName || "Cast",
                                targetId: interactId,
                                targetType: MenuTargetType.LOC,
                                targetName: `${activeSpell.spellName} -> ${resolvedLocType.name}`,
                                targetLevel: -1,
                                mapX: localX,
                                mapY: localY,
                                spellCast: {
                                    spellId: activeSpell.spellId,
                                    spellName: activeSpell.spellName,
                                    spellLevel: activeSpell.spellLevel,
                                    runes: activeSpell.runes,
                                    mapX: localX,
                                    mapY: localY,
                                },
                            });
                        }
                        continue;
                    }

                    // OSRS parity: LOC actions inserted 4..0, then Examine.
                    for (let actionIdx = 4; actionIdx >= 0; actionIdx--) {
                        const option = resolvedLocType.actions?.[actionIdx];
                        if (!option) continue;
                        menuEntries.push({
                            option,
                            targetId: interactId,
                            targetType: MenuTargetType.LOC,
                            targetName: resolvedLocType.name,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                            actionIndex: actionIdx,
                        });
                    }

                    menuEntries.push({
                        option: "Examine",
                        targetId: interactId,
                        targetType: MenuTargetType.LOC,
                        targetName: resolvedLocType.name,
                        targetLevel: -1,
                        mapX: localX,
                        mapY: localY,
                    });
                } else if (interactType === InteractType.OBJ) {
                    // Ground items: build options for all stacks at the hovered tile (OSRS: type=3 tag).
                    const worldTileX = (hit.tileX ?? 0) | 0;
                    const worldTileY = (hit.tileY ?? 0) | 0;
                    const localX = (worldTileX - baseX) | 0;
                    const localY = (worldTileY - baseY) | 0;

                    // Ground items stay indexed by the raw client plane; bridge promotion is render-only.
                    const plane = resolveGroundItemStackPlane(this.getPlayerRawPlane() | 0);
                    const stacks = this.osrsClient.groundItems.getStacksAt(
                        worldTileX,
                        worldTileY,
                        plane,
                    );
                    if (!stacks || stacks.length === 0) continue;
                    const groundItemsPlugin = this.osrsClient.groundItemsPlugin;

                    const tileKey = `${localX}:${localY}`;
                    if (objIds.has(tileKey)) continue;
                    objIds.add(tileKey);

                    // Item selection: Use only (OSRS: opcode 16 per item, suppresses normal ops).
                    if (ClientState.isItemSelected === 1) {
                        const itemName =
                            selectedItemName || `Item ${ClientState.selectedItemId | 0 || 0}`;
                        for (const stack of stacks) {
                            const objType = this.osrsClient.objTypeLoader.load(stack.itemId);
                            if (!objType || objType.name === "null") continue;
                            const menuName = groundItemsPlugin.getMenuTargetName(
                                stack,
                                objType.name,
                            );
                            menuEntries.push({
                                option: "Use",
                                targetId: stack.itemId,
                                targetType: MenuTargetType.OBJ,
                                targetName: `${itemName} -> ${menuName}`,
                                targetLevel: -1,
                                mapX: localX,
                                mapY: localY,
                                tile: { tileX: worldTileX, tileY: worldTileY, plane },
                                onClick: (entry?: any) =>
                                    this.osrsClient.useSelectedItemOnFromMenu(
                                        (entry as any) ?? ({} as any),
                                        { tile: { tileX: worldTileX, tileY: worldTileY, plane } },
                                    ),
                            });
                        }
                        continue;
                    }

                    // Spell selection: Cast only when targetable (OSRS: opcode 17 per item).
                    if (ClientState.isSpellSelected) {
                        if (
                            hasActiveSpell &&
                            activeSpell &&
                            canTargetGroundItem(activeSpell.targetMask)
                        ) {
                            for (const stack of stacks) {
                                const objType = this.osrsClient.objTypeLoader.load(stack.itemId);
                                if (!objType || objType.name === "null") continue;
                                const menuName = groundItemsPlugin.getMenuTargetName(
                                    stack,
                                    objType.name,
                                );
                                menuEntries.push({
                                    option: activeSpell.actionName || "Cast",
                                    targetId: stack.itemId,
                                    targetType: MenuTargetType.OBJ,
                                    targetName: `${activeSpell.spellName} -> ${menuName}`,
                                    targetLevel: -1,
                                    mapX: localX,
                                    mapY: localY,
                                    spellCast: {
                                        spellId: activeSpell.spellId,
                                        spellName: activeSpell.spellName,
                                        spellLevel: activeSpell.spellLevel,
                                        runes: activeSpell.runes,
                                        mapX: localX,
                                        mapY: localY,
                                    },
                                });
                            }
                        }
                        continue;
                    }

                    // No selection: insert ground actions 4..0 with Take fallback at index 2, then Examine.
                    for (const stack of stacks) {
                        const objType = this.osrsClient.objTypeLoader.load(stack.itemId);
                        if (!objType || objType.name === "null") continue;
                        const menuName = groundItemsPlugin.getMenuTargetName(stack, objType.name);
                        const menuTarget = groundItemsPlugin.getMenuTargetColorized(
                            stack,
                            menuName,
                        );
                        const deprioritized = groundItemsPlugin.shouldDeprioritizeInMenu(stack);

                        const actions = objType.groundActions ?? [];
                        for (let actionIdx = 4; actionIdx >= 0; actionIdx--) {
                            const option = actions[actionIdx];
                            if (option) {
                                const capturedStack = stack;
                                menuEntries.push({
                                    option,
                                    targetId: stack.itemId,
                                    targetType: MenuTargetType.OBJ,
                                    targetName: menuTarget,
                                    targetLevel: -1,
                                    mapX: localX,
                                    mapY: localY,
                                    actionIndex: actionIdx,
                                    deprioritized,
                                    onClick:
                                        option.toLowerCase() === "take"
                                            ? () => this.osrsClient.takeGroundItem(capturedStack)
                                            : () => this.osrsClient.closeMenu(),
                                });
                            } else if (actionIdx === 2) {
                                const capturedStack = stack;
                                menuEntries.push({
                                    option: "Take",
                                    targetId: stack.itemId,
                                    targetType: MenuTargetType.OBJ,
                                    targetName: menuTarget,
                                    targetLevel: -1,
                                    mapX: localX,
                                    mapY: localY,
                                    actionIndex: 2,
                                    deprioritized,
                                    onClick: () => this.osrsClient.takeGroundItem(capturedStack),
                                });
                            }
                        }

                        menuEntries.push({
                            option: "Examine",
                            targetId: stack.itemId,
                            targetType: MenuTargetType.OBJ,
                            targetName: menuTarget,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                        });
                    }
                } else if (interactType === InteractType.NPC) {
                    // SceneRaycaster encodes players as InteractType.NPC with a high interactId offset.
                    const PLAYER_INTERACT_BASE = 0x8000;
                    if (interactId >= PLAYER_INTERACT_BASE) {
                        const ecsIndex = hit.playerEcsIndex;
                        if (ecsIndex == null) continue;

                        const playerSubX = playerEcs.getX(ecsIndex) | 0;
                        const playerSubY = playerEcs.getY(ecsIndex) | 0;
                        const worldTileX = (hit.tileX ?? (playerSubX >> 7) | 0) | 0;
                        const worldTileY = (hit.tileY ?? (playerSubY >> 7) | 0) | 0;

                        // OSRS X-ray menu: when centered on a tile, also add all entities at same coords.
                        if ((playerSubX & 127) === 64 && (playerSubY & 127) === 64) {
                            // NPCs at same coords (size=1)
                            const npcsAtTile = npcEcs.queryByTile(worldTileX, worldTileY);
                            for (const otherNpcEcsId of npcsAtTile) {
                                const otherId = otherNpcEcsId | 0;
                                if (otherId <= 0) continue;
                                if (!npcEcs.isActive(otherId) || !npcEcs.isLinked(otherId))
                                    continue;
                                if ((npcEcs.getSize(otherId) | 0) !== 1) continue;

                                const otherMapId = npcEcs.getMapId(otherId) | 0;
                                const otherMapX = (otherMapId >> 8) & 0xff;
                                const otherMapY = otherMapId & 0xff;
                                const otherLocalSubX = npcEcs.getX(otherId) | 0;
                                const otherLocalSubY = npcEcs.getY(otherId) | 0;
                                const otherWorldSubX = (otherMapX << 13) + otherLocalSubX;
                                const otherWorldSubY = (otherMapY << 13) + otherLocalSubY;
                                if (otherWorldSubX !== playerSubX || otherWorldSubY !== playerSubY)
                                    continue;

                                addNpcMenuEntries(
                                    npcEcs.getNpcTypeId(otherId) | 0,
                                    npcEcs.getServerId(otherId) | 0,
                                    otherId,
                                    worldTileX,
                                    worldTileY,
                                );
                            }

                            // Other players at same coords
                            for (const otherPlayerIndex of playerEcs.getAllActiveIndices()) {
                                const otherIdx = otherPlayerIndex | 0;
                                if (otherIdx === (ecsIndex | 0)) continue;
                                if ((playerEcs.getX(otherIdx) | 0) !== playerSubX) continue;
                                if ((playerEcs.getY(otherIdx) | 0) !== playerSubY) continue;
                                addPlayerMenuEntries(otherIdx, worldTileX, worldTileY);
                            }
                        }

                        addPlayerMenuEntries(ecsIndex, worldTileX, worldTileY);
                    } else {
                        const npcServerId = hit.npcServerId;
                        const npcEcsId = hit.npcEcsId;
                        if (npcServerId == null || npcEcsId == null) continue;

                        const worldTileX = (hit.tileX ?? 0) | 0;
                        const worldTileY = (hit.tileY ?? 0) | 0;

                        const ecsId = npcEcsId | 0;
                        const localSubX = npcEcs.getX(ecsId) | 0;
                        const localSubY = npcEcs.getY(ecsId) | 0;
                        const npcSize = npcEcs.getSize(ecsId) | 0;

                        // OSRS X-ray menu: when a size-1 NPC is centered on a tile, add all entities at same coords.
                        if (npcSize === 1 && (localSubX & 127) === 64 && (localSubY & 127) === 64) {
                            // Other NPCs on the same coords
                            const npcsAtTile = npcEcs.queryByTile(worldTileX, worldTileY);
                            for (const otherNpcEcsId of npcsAtTile) {
                                const otherId = otherNpcEcsId | 0;
                                if (otherId <= 0 || otherId === ecsId) continue;
                                if (!npcEcs.isActive(otherId) || !npcEcs.isLinked(otherId))
                                    continue;
                                if ((npcEcs.getSize(otherId) | 0) !== 1) continue;
                                const otherLocalSubX = npcEcs.getX(otherId) | 0;
                                const otherLocalSubY = npcEcs.getY(otherId) | 0;
                                if (otherLocalSubX !== localSubX || otherLocalSubY !== localSubY)
                                    continue;

                                addNpcMenuEntries(
                                    npcEcs.getNpcTypeId(otherId) | 0,
                                    npcEcs.getServerId(otherId) | 0,
                                    otherId,
                                    worldTileX,
                                    worldTileY,
                                );
                            }

                            // Players on the same coords
                            const hitMapId = hit.mapId | 0;
                            const hitMapX = (hitMapId >> 8) & 0xff;
                            const hitMapY = hitMapId & 0xff;
                            const npcWorldSubX = (hitMapX << 13) + localSubX;
                            const npcWorldSubY = (hitMapY << 13) + localSubY;

                            for (const otherPlayerIndex of playerEcs.getAllActiveIndices()) {
                                const otherIdx = otherPlayerIndex | 0;
                                if ((playerEcs.getX(otherIdx) | 0) !== npcWorldSubX) continue;
                                if ((playerEcs.getY(otherIdx) | 0) !== npcWorldSubY) continue;
                                addPlayerMenuEntries(otherIdx, worldTileX, worldTileY);
                            }
                        }

                        addNpcMenuEntries(
                            interactId | 0,
                            npcServerId | 0,
                            npcEcsId | 0,
                            worldTileX,
                            worldTileY,
                        );
                    }
                }
            }

            // Wrap NPC/LOC/PLAYER/OBJ entries to spawn a red cross when selected
            try {
                const tileForMenu = this.osrsClient.menuTile ?? hoveredTile;
                for (const e of menuEntries) {
                    if (
                        (e.targetType === MenuTargetType.NPC ||
                            e.targetType === MenuTargetType.LOC ||
                            e.targetType === MenuTargetType.PLAYER ||
                            e.targetType === MenuTargetType.OBJ) &&
                        e.option !== "Examine"
                    ) {
                        const orig = e.onClick;
                        e.onClick = (entry, evt?: MouseEvent, ctx?: unknown) =>
                            this.performWorldEntryAction(
                                e,
                                orig,
                                evt,
                                tileForMenu,
                                ctx as MenuClickContext | undefined,
                            );
                    }
                }
            } catch {}
        }
        const effectiveEntries =
            this.osrsClient.menuOpen &&
            this.osrsClient.menuPinnedEntries &&
            this.osrsClient.menuPinnedEntries.length > 0
                ? this.osrsClient.menuPinnedEntries
                : menuEntries;
        this.lastInteractionRaycastHitCount = raycastHitCount | 0;
        this.lastInteractionMenuOptionCount = effectiveEntries.length | 0;
        // PERF: Copy entries into cached array to avoid sharing reference with cachedMenuEntries
        // This prevents the array from being cleared at the start of the next frame
        const clientEntries = this.cachedClientMenuEntries;
        clientEntries.length = 0;
        for (let i = 0; i < effectiveEntries.length; i++) {
            clientEntries.push(effectiveEntries[i]);
        }
        this.osrsClient.menuEntries = clientEntries;
        let shouldFreeze = !!(
            this.osrsClient.menuOpen &&
            this.osrsClient.menuPinnedEntries &&
            this.osrsClient.menuPinnedEntries.length > 0
        );
        // PERF: Use cached bound toCssEvent function instead of creating closure each frame
        this.currentFrameCount = frameCount;
        let simpleEntries = this.buildSimpleMenuEntries(effectiveEntries, {
            shouldFreeze,
            toCssEvent: this.boundToCssEvent,
        });
        // OSRS parity: Use shouldLeftClickOpenMenu which checks:
        // 1) leftClickOpensMenu setting && menuOptionsCount > 2
        // 2) OR top entry opcode is CC_OP_LowPriority (1007)
        // AND top entry is not shiftClickable
        const leftClickMenuToggle = !!(
            leftClicked &&
            !this.osrsClient.menuOpen &&
            shouldLeftClickOpenMenu(simpleEntries, !!this.osrsClient.settings?.leftClickOpensMenu)
        );
        if (leftClickMenuToggle) {
            this.osrsClient.menuOpen = true;
            this.osrsClient.menuOpenedFrame = frameCount;
            this.osrsClient.menuX = inputManager.leftClickX;
            this.osrsClient.menuY = inputManager.leftClickY;
            const clickedFromLeft = this.computeTileAt(
                inputManager.leftClickX,
                inputManager.leftClickY,
            );
            if (clickedFromLeft) {
                this.osrsClient.menuTile = clickedFromLeft;
                this.hoverTileX = clickedFromLeft.tileX;
                this.hoverTileY = clickedFromLeft.tileY;
                const cx = clickedFromLeft.tileX + 0.5;
                const cy = clickedFromLeft.tileY + 0.5;
                const clickedPlane = clickedFromLeft.plane;
                const h = this.sampleHeightAtExactPlane(cx, cy, clickedPlane);
                const scr = this.worldToScreen(cx, h - 0.1, cy);
                if (scr) {
                    this.osrsClient.hoveredTile = {
                        tileX: clickedFromLeft.tileX,
                        tileY: clickedFromLeft.tileY,
                    };
                    this.osrsClient.hoveredTileScreen = {
                        x: scr[0],
                        y: scr[1],
                    };
                }
            }
            try {
                this.osrsClient.menuPinnedEntries = menuEntries.slice();
                this.osrsClient.menuPinnedEntriesVersion++;
            } catch {}
            this.osrsClient.menuEntries = menuEntries.slice();
            shouldFreeze = true;
            simpleEntries = this.buildSimpleMenuEntries(menuEntries, {
                shouldFreeze: true,
                toCssEvent: this.boundToCssEvent,
            });
        }

        this.updateInteractHighlightHoverTarget(simpleEntries);

        // Handle left-click default action via the same menu interface as right-click
        // Skip if menu is open (choose-option.ts handles menu clicks)
        // Skip if click is in a UI region (OSRS parity: region-based checks)
        // PERF: Reuse helper method instead of IIFE to avoid per-click function allocation
        const leftClickInUIRegion = leftClicked
            ? this.isMouseInUIRegion(inputManager.leftClickX, inputManager.leftClickY)
            : false;

        // OSRS parity: block world interaction when a widget at the click point captures input.
        const hasUIClickTarget = leftClicked
            ? this.osrsClient.isPointOverWidget(inputManager.leftClickX, inputManager.leftClickY)
            : false;

        if (
            leftClicked &&
            !leftClickMenuToggle &&
            !this.osrsClient.menuOpen &&
            !leftClickInUIRegion &&
            !hasUIClickTarget
        ) {
            const clicked = this.computeTileAt(inputManager.leftClickX, inputManager.leftClickY);
            if (clicked) {
                this.osrsClient.menuTile = clicked;
                this.hoverTileX = clicked.tileX;
                this.hoverTileY = clicked.tileY;
            }
            const defaultEntry = chooseDefaultMenuEntry(simpleEntries, {
                hasSelectedSpell: ClientState.isSpellSelected,
                hasSelectedItem: ClientState.isItemSelected === 1,
            });
            // If an item/spell is selected and the default left-click is not Use/Cast, cancel selection like OSRS.
            const hasSelectedItem = ClientState.isItemSelected === 1;
            const hasSelectedSpell = ClientState.isSpellSelected;
            const act = defaultEntry?.action;

            // Cancel item selection if action is not Use/Cast
            if (hasSelectedItem && (!act || (act !== MenuAction.Use && act !== MenuAction.Cast))) {
                this.osrsClient.inventory?.setSelectedSlot?.(null);
                ClientState.clearItemSelection();
            }

            // Cancel spell selection if action is not Cast (clicking on non-targetable area)
            if (hasSelectedSpell && (!act || act !== MenuAction.Cast)) {
                this.osrsClient.clearSelectedSpell();
            }
            if (defaultEntry) {
                this.onInteractHighlightEntryInvoked(defaultEntry, clicked);
                const xy = this.toGLClickXY();
                const idx = defaultEntry.menuStateIndex;
                // For "Walk here", handle directly using clicked tile (menu coords may be stale)
                const isWalk = defaultEntry.option === "Walk here";
                if (isWalk && clicked) {
                    try {
                        this.osrsClient.playerInteractionSystem.cancel("walk here");
                    } catch {}
                    try {
                        if (isServerConnected()) sendInteractStop();
                    } catch {}
                    menuAction(
                        ((clicked.tileX | 0) - (ClientState.baseX | 0)) | 0,
                        ((clicked.tileY | 0) - (ClientState.baseY | 0)) | 0,
                        MenuOpcode.WalkHere,
                        0,
                        -1,
                        "Walk here",
                        "",
                        xy.sx,
                        xy.sy,
                    );
                    // OSRS parity: No client prediction on click - wait for server
                    try {
                        this.spawnClickCross(clicked, xy, "yellow");
                    } catch {}
                    this.osrsClient.closeMenu();
                } else if (typeof idx === "number") {
                    try {
                        this.osrsClient.menuState.invoke(idx, xy.sx, xy.sy, {
                            source: "primary",
                        });
                    } catch {}
                } else if (typeof defaultEntry.onClick === "function") {
                    try {
                        defaultEntry.onClick(xy.sx, xy.sy);
                    } catch {}
                }
            } else if (clicked) {
                this.clearInteractHighlightActiveTarget();
                try {
                    // Fallback: route like Walk here
                    const sx = inputManager.leftClickX | 0;
                    const sy = inputManager.leftClickY | 0;
                    menuAction(
                        ((clicked.tileX | 0) - (ClientState.baseX | 0)) | 0,
                        ((clicked.tileY | 0) - (ClientState.baseY | 0)) | 0,
                        MenuOpcode.WalkHere,
                        0,
                        -1,
                        "Walk here",
                        "",
                        sx,
                        sy,
                    );
                    // OSRS parity: No client prediction on click - wait for server
                    const playerPlane = this.getPlayerBasePlane() | 0;
                    const clickedPlane = clicked.plane ?? playerPlane;
                    this.clickCrossOverlay?.spawn(
                        clicked.tileX | 0,
                        clicked.tileY | 0,
                        sx,
                        sy,
                        clickedPlane,
                        undefined,
                        "yellow",
                    );
                } catch {}
            }
            this.osrsClient.menuOpen = false;
            this.osrsClient.menuPinnedEntries = undefined;
            this.osrsClient.menuEntries = [];
            return;
        }

        if (picked) {
            this.osrsClient.menuOpen = true;
            this.osrsClient.menuOpenedFrame = frameCount;
        }
        // If a pick event happened, anchor menu to the true click position and compute exact tile at click
        if (picked) {
            this.osrsClient.menuX = pickX;
            this.osrsClient.menuY = pickY;
            const clicked = this.computeTileAt(pickX, pickY);
            if (clicked) {
                this.osrsClient.menuTile = clicked;
                // Immediately reflect in hover devoverlay for this frame
                this.hoverTileX = clicked.tileX;
                this.hoverTileY = clicked.tileY;
                const cx = clicked.tileX + 0.5;
                const cy = clicked.tileY + 0.5;
                // Use the clicked plane directly and sample at exact height without promotion
                const clickedPlane = clicked.plane;
                const h = this.sampleHeightAtExactPlane(cx, cy, clickedPlane);
                const scr = this.worldToScreen(cx, h - 0.1, cy);
                if (scr) {
                    this.osrsClient.hoveredTile = { tileX: clicked.tileX, tileY: clicked.tileY };
                    this.osrsClient.hoveredTileScreen = {
                        x: scr[0],
                        y: scr[1],
                    };
                }
            }
            // Pin the current entries so moving targets don't change the list while the menu is open
            try {
                this.osrsClient.menuPinnedEntries = menuEntries.slice();
                this.osrsClient.menuPinnedEntriesVersion++;
                this.osrsClient.menuFrozenSimpleEntries = undefined;
                this.osrsClient.menuFrozenSimpleEntriesVersion = 0;
            } catch {}
            inputManager.clearPick();
        } else if (!this.osrsClient.menuOpen) {
            // No pick this frame and menu not open: update hover anchor to follow mouse
            this.osrsClient.menuX = inputManager.mouseX;
            this.osrsClient.menuY = inputManager.mouseY;
            this.osrsClient.menuTile = undefined;
        }
        const pinnedActive =
            this.osrsClient.menuOpen &&
            !!this.osrsClient.menuPinnedEntries &&
            this.osrsClient.menuPinnedEntries.length > 0;
        if (pinnedActive && !shouldFreeze && this.osrsClient.menuPinnedEntries) {
            simpleEntries = this.buildSimpleMenuEntries(this.osrsClient.menuPinnedEntries, {
                shouldFreeze: true,
                toCssEvent: this.boundToCssEvent,
            });
            shouldFreeze = true;
        }

        // Handle UI hotkeys in the world interaction pass (ESC selection/menu cancel parity).
        try {
            const im = this.osrsClient.inputManager;
            if (im?.isKeyDownEvent?.("Escape")) {
                let escapeConsumed = false;
                if (ClientState.isItemSelected === 1) {
                    this.osrsClient.inventory?.setSelectedSlot?.(null);
                    ClientState.clearItemSelection();
                    escapeConsumed = true;
                }
                if (ClientState.isSpellSelected) {
                    this.osrsClient.clearSelectedSpell();
                    escapeConsumed = true;
                }
                if (this.osrsClient.menuOpen) {
                    this.osrsClient.closeMenu();
                    escapeConsumed = true;
                }
                if (!escapeConsumed) {
                    const closedGroupId = this.osrsClient.widgetSessionManager?.closeTopModal?.();
                    if (typeof closedGroupId === "number") {
                        escapeConsumed = true;
                    }
                }
            }
        } catch {}

        // Bridge menu entries to the GL UI overlay (Choose Option) so it shows
        // the actual list of options at the cursor/pinned position.
        try {
            const canvas: any = this.app.gl.canvas as any;
            const ui = (canvas.__ui = canvas.__ui || {});
            // Provide a callback so the GL menu can close the world menu when clicking outside
            try {
                ui.closeWorldMenu = () => this.osrsClient.closeMenu();
            } catch {}
            const existing = ui.menu as any;
            // If not in menuOpen state and a map-driven menu is visible, hide it (right-click activation only)
            if (!this.osrsClient.menuOpen) {
                if (existing && existing.source === "map") {
                    existing.open = false;
                }
                return;
            }
            // If a pinned widget-driven menu is open, do not override it with map entries
            if (
                existing &&
                existing.open &&
                existing.follow === false &&
                existing.source === "widgets"
            ) {
                return;
            }
            const simpleList = this.osrsClient.menuActiveSimpleEntries.length
                ? this.osrsClient.menuActiveSimpleEntries
                : simpleEntries;
            // menuX/menuY are already in canvas coordinates from InputManager
            const mx = (this.osrsClient.menuX | 0) as number;
            const my = (this.osrsClient.menuY | 0) as number;
            ui.menu = {
                open: simpleList.length > 0,
                follow: false,
                x: mx,
                y: my,
                entries: simpleList,
                source: "map",
                menuState: this.osrsClient.menuState,
                onEntryInvoke: (entry: SimpleMenuEntry) => {
                    this.onInteractHighlightEntryInvoked(entry, this.osrsClient.menuTile);
                },
            };
        } catch {}
    }

    /**
     * Clear session-specific caches to prevent memory leaks on logout/disconnect.
     * Does NOT dispose GL resources - only clears accumulated session data.
     */
    override clearSessionCaches(): void {
        // Clear NPC type caches (grow with each unique NPC type seen)
        this.npcDefaultHeightCache.clear();
        this.npcNameCache.clear();

        // Clear hitsplat/health bar state
        this.npcHitsplats.clear();
        this.playerHitsplats.clear();
        this.npcHealthBars.clear();
        this.playerHealthBars.clear();
        this.hitsplatSeenNpc.clear();
        this.actorServerTilesSeenNpc.clear();

        // Clear loc overrides and spawns (door state changes accumulate)
        this.locOverrides.clear();
        this.locSpawns.clear();
        this.mapsToLoad.clear();
        this.pendingStreamMapsByGeneration.clear();
        this.observedGridRevision = -1;
        this.activeStreamGeneration = 0;
        this.activeStreamExpectedMapIds.clear();
        this.pendingLocUpdates.clear();
        this.pendingLocReloadMaps.clear();
        this.pendingLocReloadBatches.clear();
        this.queuedLocReloadBatchByMap.clear();
        this.nextLocReloadBatchId = 1;
        if (this.pendingLocReloadFlushTimer) {
            clearTimeout(this.pendingLocReloadFlushTimer);
            this.pendingLocReloadFlushTimer = undefined;
        }

        // Clear ground item rendering caches
        this.groundItemStacks.clear();
        this.groundItemStackHashes.clear();
        this.clearInteractHighlightActiveTarget();
        this.clearInteractHighlightHoverTarget();
        this.interactHighlightDrawTargets.length = 0;

        // Clear minimap icons
        this.minimapIcons.clear();

        // Clear cached overlay state
        this.cachedSceneOverlayUpdateArgs = null;
        this.cachedOverlayUpdateArgs = null;

        // Clear debug counts
        this.projectileRenderDebugCounts.clear();

        // Clear cached type IDs
        this.cachedLocIds.clear();
        this.cachedObjIds.clear();
        this.cachedNpcIds.clear();
        this.interactLocModelLoader?.clearCache();
        this.interactNpcModelLoader?.clearCache();
        this.sceneRaycaster?.clearCache();
        this.clearDynamicNpcAnimRuntimeState();

        // Reset camera follow state for next login
        this.followCamFocalInitialized = false;
        this.followCamFocalLastClientCycle = -1;
        this.cameraTerrainPitchPressure = 0;
        this.clearCameraShake();
        this.mapDataLoadedNotified = false;
        this.heightValidAtTime = undefined;
    }

    override async cleanUp(): Promise<void> {
        super.cleanUp();
        this.canvas.removeEventListener("touchstart", this.onCanvasTouchStart, true);
        if (isMobileMode && typeof window !== "undefined") {
            window.removeEventListener("resize", this.onMobileLoginViewportChange);
            window.removeEventListener("orientationchange", this.onMobileLoginViewportChange);
            window.visualViewport?.removeEventListener("resize", this.onMobileLoginViewportChange);
            window.visualViewport?.removeEventListener("scroll", this.onMobileLoginViewportChange);
        }
        this.destroyMobileLoginInput();
        this.playerHealthBars.clear();
        try {
            this.overlayManager?.dispose();
            this.hitsplatTickUnsub?.();
            this.hitsplatTickUnsub = undefined;
        } catch {}
        this.overlayManager = undefined;
        this.interactHighlightOverlay = undefined;
        this.healthBarOverlay = undefined;
        this.tileMarkerOverlay = undefined;
        this.clearInteractHighlightActiveTarget();
        this.clearInteractHighlightHoverTarget();
        this.interactHighlightDrawTargets.length = 0;
        this.interactLocModelLoader = undefined;
        this.interactNpcModelLoader = undefined;
        this.npcHealthBars.clear();
        this.osrsClient.workerPool.resetLoader(this.dataLoader);

        this.quadArray?.delete();
        this.quadArray = undefined;

        this.quadPositions?.delete();
        this.quadPositions = undefined;

        // Uniforms
        this.sceneUniformBuffer?.delete();
        this.sceneUniformBuffer = undefined;

        // Framebuffers
        this.framebuffer?.delete();
        this.framebuffer = undefined;

        this.colorTarget?.delete();
        this.colorTarget = undefined;

        this.depthTarget?.delete();
        this.depthTarget = undefined;

        this.textureFramebuffer?.delete();
        this.textureFramebuffer = undefined;

        this.textureColorTarget?.delete();
        this.textureColorTarget = undefined;

        this.textureDepthTarget?.delete();
        this.textureDepthTarget = undefined;

        // Textures
        this.textureArray?.delete();
        this.textureArray = undefined;

        this.textureMaterials?.delete();
        this.textureMaterials = undefined;

        this.drawBackend?.dispose();
        this.drawBackend = undefined;

        // Unified actor texture cleanup handled by actorDataTextureBuffer below
        for (const texture of this.actorDataTextureBuffer) {
            texture?.delete();
        }

        this.clearMaps();
        this.disposeDynamicNpcAnimState();

        if (this.shadersPromise) {
            for (const shader of await this.shadersPromise) {
                shader.delete();
            }
            this.shadersPromise = undefined;
        }
        console.log("Renderer cleaned up");
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
        try {
            console.log(
                `[WebGLRenderer] Loc change: ${oldId} -> ${newId} at (${tile.x}, ${tile.y}, ${level})`,
            );

            const oldTile = opts?.oldTile ?? tile;
            const newTile = opts?.newTile;
            const matchesChangedTile = (target: {
                tileX: number;
                tileY: number;
                plane: number;
            }): boolean => {
                if ((target.plane | 0) !== (level | 0)) return false;
                if (
                    (target.tileX | 0) === (oldTile.x | 0) &&
                    (target.tileY | 0) === (oldTile.y | 0)
                ) {
                    return true;
                }
                if (
                    newTile &&
                    (target.tileX | 0) === (newTile.x | 0) &&
                    (target.tileY | 0) === (newTile.y | 0)
                ) {
                    return true;
                }
                return false;
            };

            if (
                this.interactHighlightActiveTarget?.kind === "loc" &&
                matchesChangedTile(this.interactHighlightActiveTarget)
            ) {
                this.clearInteractHighlightActiveTarget();
            }
            if (
                this.interactHighlightHoverTarget?.kind === "loc" &&
                matchesChangedTile(this.interactHighlightHoverTarget)
            ) {
                this.clearInteractHighlightHoverTarget();
            }
            const overrideRotation =
                typeof opts?.newRotation === "number"
                    ? opts.newRotation & 0x3
                    : undefined;

            const spawnKey = `${oldTile.x | 0},${oldTile.y | 0},${level | 0}`;
            const existingSpawn = this.locSpawns.get(spawnKey);
            // Use locSpawns for: locs spawned on empty ground (oldId===0) or ongoing lifecycle of a spawned loc
            const isSpawnedLoc = (oldId | 0) === 0 || (existingSpawn !== undefined && existingSpawn.id === (oldId | 0));

            const clearOverridesAtTile = (tileX: number, tileY: number): void => {
                const keyPrefix = `${tileX | 0},${tileY | 0},${level},`;
                for (const key of Array.from(this.locOverrides.keys())) {
                    if (key.startsWith(keyPrefix)) {
                        this.locOverrides.delete(key);
                    }
                }
            };
            clearOverridesAtTile(oldTile.x, oldTile.y);
            if (newTile) {
                clearOverridesAtTile(newTile.x, newTile.y);
            }

            if (isSpawnedLoc) {
                // Manage via locSpawns
                if ((newId | 0) === 0) {
                    this.locSpawns.delete(spawnKey);
                } else {
                    // Use the shape from the server (matches loc_add_change_v2 OSRS packet),
                    // or inherit from the existing spawn, or default to NORMAL (10).
                    const spawnType =
                        typeof opts?.newShape === "number"
                            ? (opts.newShape as LocModelType)
                            : existingSpawn?.type ?? LocModelType.NORMAL;
                    this.locSpawns.set(spawnKey, {
                        id: newId | 0,
                        type: spawnType,
                        rotation: overrideRotation ?? 0,
                    });
                }
            } else {
                // Regular map loc override
                const overrideKey = `${oldTile.x},${oldTile.y},${level},${oldId}`;
                this.locOverrides.set(overrideKey, {
                    newId: newId | 0,
                    newRotation: overrideRotation,
                    moveToX:
                        newTile &&
                        ((newTile.x | 0) !== (oldTile.x | 0) || (newTile.y | 0) !== (oldTile.y | 0))
                            ? newTile.x | 0
                            : undefined,
                    moveToY:
                        newTile &&
                        ((newTile.x | 0) !== (oldTile.x | 0) || (newTile.y | 0) !== (oldTile.y | 0))
                            ? newTile.y | 0
                            : undefined,
                });
            }

            // Moving locs can cross map-square boundaries (e.g., edge gates).
            // Reload both affected map squares so moved geometry can appear on the new side.
            const oldMapX = Math.floor(oldTile.x / 64);
            const oldMapY = Math.floor(oldTile.y / 64);
            const newMapX = Math.floor((newTile?.x ?? oldTile.x) / 64);
            const newMapY = Math.floor((newTile?.y ?? oldTile.y) / 64);
            const mapKeys = new Set<string>([`${oldMapX}:${oldMapY}`, `${newMapX}:${newMapY}`]);

            for (const mapKey of mapKeys) {
                const [mxRaw, myRaw] = mapKey.split(":");
                const mx = Number(mxRaw) | 0;
                const my = Number(myRaw) | 0;
                const mapId = getMapSquareId(mx, my);
                this.pendingLocUpdates.add(mapId);
                this.scheduleLocReload(mx, my);
            }

            const mapSummary = [...mapKeys]
                .map((entry) => {
                    const [mxRaw, myRaw] = entry.split(":");
                    return `(${Number(mxRaw) | 0}, ${Number(myRaw) | 0})`;
                })
                .join(", ");
            console.log(
                `Refreshing map square(s) ${mapSummary} via loc geometry refresh`,
            );
        } catch (err) {
            console.warn("onLocChange error", err);
        }
    }

    private scheduleLocReload(mapX: number, mapY: number): void {
        const id = getMapSquareId(mapX, mapY);
        this.pendingLocReloadMaps.set(id, { mapX: mapX | 0, mapY: mapY | 0 });
        if (this.pendingLocReloadFlushTimer) return;
        const flush = () => {
            this.pendingLocReloadFlushTimer = undefined;
            if (this.pendingLocReloadMaps.size === 0) return;
            const batch = Array.from(this.pendingLocReloadMaps.values());
            this.pendingLocReloadMaps.clear();
            this.beginLocReloadBatch(batch);
        };
        this.pendingLocReloadFlushTimer = setTimeout(
            flush,
            WebGLOsrsRenderer.LOC_RELOAD_FLUSH_DELAY_MS,
        );
    }

    private appendGroundItemMenuEntries(
        menuEntries: OsrsMenuEntry[],
        examineEntries: OsrsMenuEntry[],
    ): void {
        const focusTile = this.osrsClient.menuTile ?? this.osrsClient.hoveredTile;
        if (!focusTile) return;
        // Ground item stacks are stored on the raw client plane even when bridge tiles render above it.
        const plane = resolveGroundItemStackPlane(this.getPlayerRawPlane() | 0);
        const stacks = this.osrsClient.getGroundItemsAt(
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
                onClick: () => this.osrsClient.takeGroundItem(stack),
            });
            examineEntries.push({
                option: "Examine",
                targetId: stack.itemId,
                targetType: MenuTargetType.OBJ,
                targetName: stack.name,
                targetLevel: stack.tile.level | 0,
                tile,
                onClick: () => this.osrsClient.examineGroundItem(stack),
            });
        }
    }

    // Chathead model building moved to ChatheadFactory
}

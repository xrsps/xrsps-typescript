import { App as PicoApp, UniformBuffer } from "picogl";

import type { GroundItemOverlayEntry } from "../../client/data/ground/GroundItemStore";
import type { TileHighlightRenderEntry } from "../../client/highlights/TileHighlightManager";

export enum RenderPhase {
    ToSceneFramebuffer = "toSceneFramebuffer",
    ToFrameTexture = "toFrameTexture",
    PostPresent = "postPresent",
}

export interface OverlayInitArgs {
    app: PicoApp;
    sceneUniforms: UniformBuffer;
}

export interface HitsplatEntry {
    worldX: number;
    worldZ: number;
    plane: number;
    /** Height offset relative to tile units; defaults to 0.5 tiles. */
    heightOffsetTiles?: number;
    /** Damage number to render; falls back to overlay default when omitted. */
    damage?: number;
    /** How many stacked splats to render (clamped to 1..4). */
    count?: number;
    /** Optional tint override for text (0xRRGGBB). */
    color?: number;
    /** Optional per-entry scale multiplier. */
    scale?: number;
    /** Variant used to rotate default offset pattern. */
    variant?: number;
    /** Optional hitsplat style or sprite name override from the source event. */
    style?: number;
    spriteName?: string;
    /**
     * OSRS Parity: Secondary hitsplat type (e.g., poison icon displayed alongside damage).
     * Maps to Actor.hitSplatTypes2[slot] in OSRS.
     */
    type2?: number;
    /**
     * OSRS Parity: Secondary hitsplat value (e.g., poison damage amount).
     * Maps to Actor.hitSplatValues2[slot] in OSRS.
     */
    damage2?: number;
    /**
     * OSRS Parity: Animation progress ratio from 0..1.
     * 0 = just became visible, 1 = about to expire.
     * Used to animate xOffset (from xOffset to 0), yOffset (from 0 to -yOffset),
     * and fade alpha (from 255 to 0 after fadeStartCycle).
     */
    animProgress?: number;
}

export interface HealthBarEntry {
    worldX: number;
    worldZ: number;
    plane: number;
    /** Height offset relative to tile units; defaults to 0.5 tiles (player head). */
    heightOffsetTiles?: number;
    /** Ratio of current health to maximum (0..1). */
    ratio: number;
    /** Optional transparency multiplier (0..1). */
    alpha?: number;
    /** Optional override for the definition id to pick sprites/timing. */
    defId?: number;
    /** Optional group key used to stack multiple bars for the same actor. */
    groupKey?: number;
}

export interface OverheadTextEntry {
    worldX: number;
    worldZ: number;
    plane: number;
    heightOffsetTiles: number;
    text: string;
    color: number;
    colorId?: number;
    effect: number;
    modIcon?: number;
    /** Per-character palette for extended colours. */
    pattern?: Int32Array;
    life: number;
    remaining: number;
    duration: number;
}

export interface OverheadPrayerEntry {
    worldX: number;
    worldZ: number;
    plane: number;
    heightOffsetTiles: number;
    /** Prayer head icon index (0 = Protect from Melee, 1 = Protect from Missiles, 2 = Protect from Magic, etc.) */
    headIconPrayer: number;
}

export interface OverlayUpdateArgs {
    time: number;
    delta: number;
    resolution: { width: number; height: number };
    state: {
        // Hover marker
        hoverEnabled: boolean;
        hoverTile?: { x: number; y: number };
        // Player
        playerLevel: number;
        playerRawLevel?: number;
        // Destination marker
        destTile?: { x: number; y: number };
        // Current true tile marker
        currentTile?: { x: number; y: number; plane?: number };
        tileHighlights?: ReadonlyArray<TileHighlightRenderEntry>;
        // Animation / timing
        clientTickPhase: number;
        // Player frame sampling (for overlays that need it)
        playerFrameCount?: number;
        playerFreezeFrame?: boolean;
        playerFixedFrame?: number;
        playerFrameIndex?: number;
        playerFrameHeightTiles?: number[];
        playerDefaultHeightTiles?: number;
        // Player position (world tile units)
        playerWorldX?: number;
        playerWorldZ?: number;
        /**
         * Dev overlay: non-interpolated server tiles for actors (NPCs + Players).
         * Values are in world tile coords (not local-to-map).
         */
        actorServerTiles?: Array<{
            x: number;
            y: number;
            plane: number;
            kind: "player" | "npc";
            serverId: number;
            label: string;
        }>;
        // Hitsplat entries to render this frame
        hitsplats?: HitsplatEntry[];
        healthBars?: HealthBarEntry[];
        overheadTexts?: OverheadTextEntry[];
        overheadPrayers?: OverheadPrayerEntry[];
        groundItems?: GroundItemOverlayEntry[];
    };
    helpers: {
        getTileHeightAtPlane: (worldX: number, worldY: number, plane: number) => number;
        sampleHeightAtExactPlane: (worldX: number, worldZ: number, plane: number) => number;
        getEffectivePlaneForTile: (tileX: number, tileY: number, basePlane: number) => number;
        getOccupancyPlaneForTile?: (tileX: number, tileY: number, basePlane: number) => number;
        getTileRenderFlagAt: (level: number, tileX: number, tileY: number) => number;
        isBridgeSurfaceTile?: (tileX: number, tileY: number, plane: number) => boolean;
        worldToScreen?: (x: number, y: number, z: number) => Float32Array | number[] | undefined;
        getCollisionFlagAt?: (level: number, tileX: number, tileY: number) => number;
    };
}

export interface Overlay {
    init(args: OverlayInitArgs): void;
    update(args: OverlayUpdateArgs): void;
    draw(phase: RenderPhase): void;
    dispose(): void;
}

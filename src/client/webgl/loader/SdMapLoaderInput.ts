import type { ObjSpawn } from "../../data/obj/ObjSpawn";

export type SdMapLoaderInput = {
    mapX: number;
    mapY: number;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    minimizeDrawCalls: boolean;

    loadedTextureIds: Set<number>;

    // Dynamic loc overrides: Map<"x,y,level,oldId", {newId,newRotation?,moveToX?,moveToY?}>
    locOverrides?: Map<
        string,
        { newId: number; newRotation?: number; moveToX?: number; moveToY?: number }
    >;
    // Dynamic loc spawns: Map<"x,y,level", {id,type,rotation}> - locs not in base map data
    locSpawns?: Map<string, { id: number; type: number; rotation: number }>;
    extraObjSpawns?: ObjSpawn[];

    /**
     * Instance mode: when present, the loader uses buildInstanceScene() instead
     * of buildScene(). The SceneBuilder loads required cache regions internally.
     */
    instance?: {
        templateChunks: number[][][];
        regionX: number;
        regionY: number;
    };

    /**
     * Extra locs to bake into the scene (normal or instance builds).
     * Sourced from LOC_ADD_CHANGE packets for dynamically spawned objects.
     */
    extraLocs?: Array<{
        id: number;
        x: number;
        y: number;
        level: number;
        shape: number;
        rotation: number;
    }>;

    /**
     * Extra NPCs to inject into the scene (world entity overlays).
     * These are added as NPC spawns alongside any cache-defined NPCs.
     */
    extraNpcs?: Array<{
        id: number;
        x: number;
        y: number;
        level: number;
    }>;

    /**
     * Override the render position for world entity overlays.
     * When set, the scene is built at source coordinates but rendered
     * at the entity's world position via shader u_mapPos offset.
     */
    overrideRenderPos?: {
        x: number;
        y: number;
    };
};

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
    extraObjSpawns?: ObjSpawn[];

    /**
     * Instance mode: when present, the loader uses buildInstanceScene() instead
     * of buildScene(). The SceneBuilder loads required cache regions internally.
     */
    instance?: {
        templateChunks: number[][][];
    };

    /**
     * Extra locs to add to the scene (not in cache data).
     * Used for dynamically spawned objects like boat parts.
     */
    extraLocs?: Array<{
        id: number;
        x: number;
        y: number;
        level: number;
        shape: number;
        rotation: number;
    }>;
};

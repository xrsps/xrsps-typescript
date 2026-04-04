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
};

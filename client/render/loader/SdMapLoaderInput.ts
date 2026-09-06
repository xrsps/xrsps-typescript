export type SdMapLoaderInput = {
    mapX: number;
    mapY: number;

    maxLevel: number;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    minimizeDrawCalls: boolean;

    /**
     * Rebuild only door geometry and the scene data required to interact with
     * it. Used for open/close updates on an already loaded map square.
     */
    doorOnly?: boolean;

    /**
     * Rebuild only non-door location geometry and the scene data required to
     * interact with it. Used for ordinary LOC_ADD_CHANGE updates.
     */
    locOnly?: boolean;

    loadedTextureIds: Set<number>;

    // Dynamic loc overrides: Map<"x,y,level,oldId", {newId,newRotation?,moveToX?,moveToY?,seqId?,seqRandomStart?,matchType?,matchRotation?}>
    locOverrides?: Map<
        string,
        {
            newId: number;
            newRotation?: number;
            moveToX?: number;
            moveToY?: number;
            seqId?: number;
            seqRandomStart?: boolean;
            matchType?: number;
            matchRotation?: number;
        }
    >;
    // Dynamic loc spawns: first key fields are "x,y,level"; extra fields may distinguish stacked spawns.
    locSpawns?: Map<string, { id: number; type: number; rotation: number }>;
    terrainOverrides?: Map<
        string,
        {
            underlay?: number;
            overlay?: number;
            shape?: number;
            rotation?: number;
            renderFlags?: number;
            height?: number;
        }
    >;

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

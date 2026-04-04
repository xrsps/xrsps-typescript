import { getMapSquareId } from "../../rs/map/MapFileIndex";

export class WorldView {
    readonly id: number;
    sizeX: number;
    sizeY: number;
    baseX: number;
    baseY: number;
    plane: number = 0;

    readonly overlayMapId: number;

    configId: number;
    templateChunks: number[][][];
    regionX: number;
    regionY: number;
    worldX: number;
    worldY: number;
    sizeXEntity: number;
    sizeZEntity: number;
    extraLocs: Array<{
        id: number;
        x: number;
        y: number;
        level: number;
        shape: number;
        rotation: number;
    }>;
    extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>;

    /** NPC ECS IDs belonging to this WorldView. */
    readonly npcIds: Set<number> = new Set();
    /** Player ECS IDs belonging to this WorldView. */
    readonly playerIds: Set<number> = new Set();

    /** Per-plane collision flags (4 planes, sizeX * sizeY per plane). */
    collisionFlags: Int32Array[] | null = null;

    constructor(
        id: number,
        sizeX: number,
        sizeY: number,
        opts: {
            baseX?: number;
            baseY?: number;
            configId?: number;
            templateChunks?: number[][][];
            regionX?: number;
            regionY?: number;
            worldX?: number;
            worldY?: number;
            sizeXEntity?: number;
            sizeZEntity?: number;
            extraLocs?: WorldView["extraLocs"];
            extraNpcs?: WorldView["extraNpcs"];
        } = {},
    ) {
        this.id = id;
        this.sizeX = sizeX;
        this.sizeY = sizeY;
        this.baseX = opts.baseX ?? 0;
        this.baseY = opts.baseY ?? 0;
        this.configId = opts.configId ?? -1;
        this.templateChunks = opts.templateChunks ?? [];
        this.regionX = opts.regionX ?? 0;
        this.regionY = opts.regionY ?? 0;
        this.worldX = opts.worldX ?? 0;
        this.worldY = opts.worldY ?? 0;
        this.sizeXEntity = opts.sizeXEntity ?? 0;
        this.sizeZEntity = opts.sizeZEntity ?? 0;
        this.extraLocs = opts.extraLocs ?? [];
        this.extraNpcs = opts.extraNpcs;

        if (id >= 0) {
            const overlayMapX = 200 + id;
            const overlayMapY = 200 + id;
            this.overlayMapId = getMapSquareId(overlayMapX, overlayMapY);
        } else {
            this.overlayMapId = -1;
        }

        // Initialize collision for non-primary views (4 planes)
        if (id >= 0) {
            this.collisionFlags = new Array(4);
            for (let p = 0; p < 4; p++) {
                this.collisionFlags[p] = new Int32Array(sizeX * sizeY);
            }
        }
    }

    isTopLevel(): boolean {
        return this.id === -1;
    }

    containsTile(tileX: number, tileY: number): boolean {
        return (
            tileX >= this.baseX &&
            tileX < this.baseX + this.sizeX &&
            tileY >= this.baseY &&
            tileY < this.baseY + this.sizeY
        );
    }

    getOverlayMapCoords(): { mapX: number; mapY: number } {
        return { mapX: 200 + this.id, mapY: 200 + this.id };
    }

    getCollisionFlag(plane: number, localX: number, localY: number): number {
        if (!this.collisionFlags || plane < 0 || plane > 3) return 0xffffff;
        if (localX < 0 || localX >= this.sizeX || localY < 0 || localY >= this.sizeY) {
            return 0xffffff;
        }
        return this.collisionFlags[plane][localX * this.sizeY + localY] | 0;
    }

    setCollisionFlag(plane: number, localX: number, localY: number, flags: number): void {
        if (!this.collisionFlags || plane < 0 || plane > 3) return;
        if (localX < 0 || localX >= this.sizeX || localY < 0 || localY >= this.sizeY) return;
        this.collisionFlags[plane][localX * this.sizeY + localY] = flags | 0;
    }

    resetActors(): void {
        this.npcIds.clear();
        this.playerIds.clear();
    }
}

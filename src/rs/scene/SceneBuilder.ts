import {
    CHUNK_SIZE,
    INSTANCE_CHUNK_COUNT,
    INSTANCE_SIZE,
    PLANE_COUNT,
    deriveRegionsFromTemplates,
    rotateChunkX,
    rotateChunkY,
    rotateObjectChunkX,
    rotateObjectChunkY,
    unpackTemplateChunk,
} from "../../shared/instance/InstanceTypes";
import { CacheInfo } from "../cache/CacheInfo";
import { FloorTypeLoader, OverlayFloorTypeLoader } from "../config/floortype/FloorTypeLoader";
import { ContourGroundInfo, LocModelLoader } from "../config/loctype/LocModelLoader";
import { LocModelType } from "../config/loctype/LocModelType";
import { LocType } from "../config/loctype/LocType";
import { LocTypeLoader } from "../config/loctype/LocTypeLoader";
import { ByteBuffer } from "../io/ByteBuffer";
import { getMapSquareId } from "../map/MapFileIndex";
import { MapFileLoader } from "../map/MapFileLoader";
import { Model } from "../model/Model";
import { HSL_RGB_MAP, adjustOverlayLight, adjustUnderlayLight, packHsl } from "../util/ColorUtil";
import { generateHeight } from "../util/HeightCalc";
import { CollisionMap } from "./CollisionMap";
import { Scene } from "./Scene";
import { SceneTileModel } from "./SceneTileModel";
import { Entity } from "./entity/Entity";
import { EntityType, calculateEntityTag, getIdFromTag } from "./entity/EntityTag";
import { LocEntity } from "./entity/LocEntity";

export enum LocLoadType {
    MODELS,
    NO_MODELS,
}

function readTerrainValue(buffer: ByteBuffer, newFormat: boolean, signed: boolean = false): number {
    if (newFormat) {
        return signed ? buffer.readShort() : buffer.readUnsignedShort();
    } else {
        return signed ? buffer.readByte() : buffer.readUnsignedByte();
    }
}

export class SceneBuilder {
    static readonly BLEND_RADIUS = 5;

    private static readonly displacementX: number[] = [1, 0, -1, 0];
    private static readonly displacementY: number[] = [0, -1, 0, 1];
    private static readonly diagonalDisplacementX: number[] = [1, -1, -1, 1];
    private static readonly diagonalDisplacementY: number[] = [-1, -1, 1, 1];

    static readonly WATER_OVERLAY_ID = 5;

    newTerrainFormat: boolean;
    centerLocHeightWithSize: boolean;

    // Dynamic loc overrides: Map<"x,y,level,oldId", {newId,newRotation?,moveToX?,moveToY?}>
    private locOverrides: Map<
        string,
        { newId: number; newRotation?: number; moveToX?: number; moveToY?: number }
    > = new Map();

    // Dynamic loc spawns: Map<"x,y,level", {id,type,rotation}> - locs not in base map data
    private locSpawns: Map<string, { id: number; type: LocModelType; rotation: number }> = new Map();

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly mapFileLoader: MapFileLoader,
        readonly underlayTypeLoader: FloorTypeLoader,
        readonly overlayTypeLoader: OverlayFloorTypeLoader,
        readonly locTypeLoader: LocTypeLoader,
        readonly locModelLoader: LocModelLoader,
        readonly xteasMap: Map<number, number[]>,
    ) {
        this.newTerrainFormat =
            this.cacheInfo.game === "oldschool" && this.cacheInfo.revision >= 209;
        this.centerLocHeightWithSize =
            this.cacheInfo.game === "oldschool" || this.cacheInfo.revision >= 465;
    }

    setLocOverride(
        x: number,
        y: number,
        level: number,
        oldId: number,
        newId: number,
        newRotation?: number,
        moveToX?: number,
        moveToY?: number,
    ): void {
        const key = `${x},${y},${level},${oldId}`;
        this.locOverrides.set(key, { newId, newRotation, moveToX, moveToY });
        console.log(
            `[SceneBuilder] setLocOverride: key="${key}" -> {id: ${newId}, rot: ${
                newRotation ?? "unchanged"
            }, move: ${
                typeof moveToX === "number" && typeof moveToY === "number"
                    ? `${moveToX},${moveToY}`
                    : "unchanged"
            }}`,
        );
    }

    clearLocOverrides(): void {
        this.locOverrides.clear();
    }

    setLocSpawn(x: number, y: number, level: number, id: number, type: LocModelType, rotation: number): void {
        const key = `${x},${y},${level}`;
        this.locSpawns.set(key, { id, type, rotation });
    }

    clearLocSpawns(): void {
        this.locSpawns.clear();
    }

    static fillEmptyTerrain(info: CacheInfo): boolean {
        return info.game === "runescape" && info.revision <= 225;
    }

    getTerrainData(mapX: number, mapY: number): Int8Array | undefined {
        return this.mapFileLoader.getTerrainData(mapX, mapY, this.xteasMap);
    }

    getLocData(mapX: number, mapY: number): Int8Array | undefined {
        return this.mapFileLoader.getLocData(mapX, mapY, this.xteasMap);
    }

    buildScene(
        baseX: number,
        baseY: number,
        sizeX: number,
        sizeY: number,
        smoothUnderlays: boolean = false,
        locLoadType: LocLoadType = LocLoadType.MODELS,
    ): Scene {
        const scene = new Scene(Scene.MAX_LEVELS, sizeX, sizeY);

        const mapStartX = Math.floor(baseX / Scene.MAP_SQUARE_SIZE);
        const mapStartY = Math.floor(baseY / Scene.MAP_SQUARE_SIZE);

        const mapEndX = Math.ceil((baseX + sizeX) / Scene.MAP_SQUARE_SIZE);
        const mapEndY = Math.ceil((baseY + sizeY) / Scene.MAP_SQUARE_SIZE);

        const emptyTerrainIds = new Set<number>();

        for (let mx = mapStartX; mx < mapEndX; mx++) {
            for (let my = mapStartY; my < mapEndY; my++) {
                const terrainData = this.getTerrainData(mx, my);
                if (terrainData) {
                    const offsetX = mx * Scene.MAP_SQUARE_SIZE - baseX;
                    const offsetY = my * Scene.MAP_SQUARE_SIZE - baseY;
                    this.decodeTerrain(scene, terrainData, offsetX, offsetY, baseX, baseY, mx, my);
                } else {
                    emptyTerrainIds.add(getMapSquareId(mx, my));
                }
            }
        }

        for (let mx = mapStartX; mx < mapEndX; mx++) {
            for (let my = mapStartY; my < mapEndY; my++) {
                if (!emptyTerrainIds.has(getMapSquareId(mx, my))) {
                    continue;
                }
                const endX = (mx + 1) * Scene.MAP_SQUARE_SIZE;
                const endY = (my + 1) * Scene.MAP_SQUARE_SIZE;
                const offsetX = mx * Scene.MAP_SQUARE_SIZE - baseX;
                const offsetY = my * Scene.MAP_SQUARE_SIZE - baseY;
                const tileX = Math.max(offsetX, 0);
                const tileY = Math.max(offsetY, 0);
                const emptySizeX = endX - baseX - tileX;
                const emptySizeY = endY - baseY - tileY;
                for (let level = 0; level < scene.levels; level++) {
                    this.loadEmptyTerrain(scene, level, tileX, tileY, emptySizeX, emptySizeY);
                }
            }
        }

        for (let mx = mapStartX; mx < mapEndX; mx++) {
            for (let my = mapStartY; my < mapEndY; my++) {
                const locData = this.getLocData(mx, my);
                if (!locData) {
                    continue;
                }
                const offsetX = mx * Scene.MAP_SQUARE_SIZE - baseX;
                const offsetY = my * Scene.MAP_SQUARE_SIZE - baseY;
                this.decodeLocs(scene, locData, offsetX, offsetY, locLoadType);
            }
        }

        this.addTileModels(scene, smoothUnderlays);
        scene.setTileMinLevels();

        // Set floor collision BEFORE bridge demotion (matches OSRS client order)
        this.setFloorCollision(scene);

        // OSRS-accurate: Physically relink/shift bridge columns between planes and
        // attach the original base tile as linkedBelow for correct roof/bridge culling.
        scene.applyBridgeLinks();
        scene.setTileMinLevels();

        if (locLoadType === LocLoadType.MODELS) {
            scene.light(this.locModelLoader.textureLoader, -50, -10, -50);
        }

        return scene;
    }

    loadEmptyTerrain(
        scene: Scene,
        level: number,
        tileX: number,
        tileY: number,
        sizeX: number,
        sizeY: number,
    ): void {
        const fillEmptyTerrain = SceneBuilder.fillEmptyTerrain(this.cacheInfo);
        for (let ty = tileY; ty < tileY + sizeY; ty++) {
            for (let tx = tileX; tx < tileX + sizeX; tx++) {
                if (tx >= 0 && tx < scene.sizeX && ty >= 0 && ty < scene.sizeY) {
                    if (level === 0) {
                        scene.tileHeights[level][tx][ty] = 0;
                        if (fillEmptyTerrain) {
                            scene.tileOverlays[level][tx][ty] = SceneBuilder.WATER_OVERLAY_ID + 1;
                        }
                    } else {
                        scene.tileHeights[level][tx][ty] =
                            scene.tileHeights[level - 1][tx][ty] - Scene.UNITS_LEVEL_HEIGHT;
                    }
                }
            }
        }
        if (tileX > 0 && scene.sizeX > tileX) {
            for (let ty = tileY + 1; ty < tileY + sizeY; ty++) {
                if (ty >= 0 && ty < scene.sizeY) {
                    scene.tileHeights[level][tileX][ty] = scene.tileHeights[level][tileX - 1][ty];
                }
            }
        }
        if (tileY > 0 && scene.sizeY > tileY) {
            for (let tx = tileX + 1; tx < tileX + sizeX; tx++) {
                if (tx >= 0 && tx < scene.sizeX) {
                    scene.tileHeights[level][tx][tileY] = scene.tileHeights[level][tx][tileY - 1];
                }
            }
        }
        if (tileX >= 0 && tileY >= 0 && tileX < scene.sizeX && tileY < scene.sizeY) {
            if (level !== 0) {
                if (
                    tileX > 0 &&
                    scene.tileHeights[level][tileX - 1][tileY] !==
                        scene.tileHeights[level - 1][tileX - 1][tileY]
                ) {
                    scene.tileHeights[level][tileX][tileY] =
                        scene.tileHeights[level][tileX - 1][tileY];
                } else if (
                    tileY <= 0 ||
                    scene.tileHeights[level][tileX][tileY - 1] ===
                        scene.tileHeights[level - 1][tileX][tileY - 1]
                ) {
                    if (
                        tileX > 0 &&
                        tileY > 0 &&
                        scene.tileHeights[level][tileX - 1][tileY - 1] !==
                            scene.tileHeights[level - 1][tileX - 1][tileY - 1]
                    ) {
                        scene.tileHeights[level][tileX][tileY] =
                            scene.tileHeights[level][tileX - 1][tileY - 1];
                    }
                } else {
                    scene.tileHeights[level][tileX][tileY] =
                        scene.tileHeights[level][tileX][tileY - 1];
                }
            } else if (tileX > 0 && scene.tileHeights[level][tileX - 1][tileY] !== 0) {
                scene.tileHeights[level][tileX][tileY] = scene.tileHeights[level][tileX - 1][tileY];
            } else if (tileY > 0 && scene.tileHeights[level][tileX][tileY - 1] !== 0) {
                scene.tileHeights[level][tileX][tileY] = scene.tileHeights[level][tileX][tileY - 1];
            } else if (
                tileX > 0 &&
                tileY > 0 &&
                scene.tileHeights[level][tileX - 1][tileY - 1] !== 0
            ) {
                scene.tileHeights[level][tileX][tileY] =
                    scene.tileHeights[level][tileX - 1][tileY - 1];
            }
        }
    }

    decodeTerrain(
        scene: Scene,
        data: Int8Array,
        offsetX: number,
        offsetY: number,
        baseX: number,
        baseY: number,
        mapX: number,
        mapY: number,
    ): void {
        const buffer = new ByteBuffer(data);

        for (let level = 0; level < Scene.MAX_LEVELS; level++) {
            for (let x = 0; x < Scene.MAP_SQUARE_SIZE; x++) {
                for (let y = 0; y < Scene.MAP_SQUARE_SIZE; y++) {
                    const sceneX = x + offsetX;
                    const sceneY = y + offsetY;

                    // Determine if this map file is authoritative for this world tile
                    // A map is authoritative for tiles within its 64x64 core region (no borders)
                    const worldX = mapX * Scene.MAP_SQUARE_SIZE + x;
                    const worldY = mapY * Scene.MAP_SQUARE_SIZE + y;
                    const authMapX = Math.floor(worldX / Scene.MAP_SQUARE_SIZE);
                    const authMapY = Math.floor(worldY / Scene.MAP_SQUARE_SIZE);
                    const isAuthoritative = mapX === authMapX && mapY === authMapY;

                    this.decodeTerrainTile(
                        scene,
                        buffer,
                        level,
                        sceneX,
                        sceneY,
                        baseX,
                        baseY,
                        0,
                        isAuthoritative,
                    );
                }
            }
        }
    }

    // OSRS-accurate: Set floor collision based on tileRenderFlags.
    // Must be called BEFORE applyBridgeLinks() to match OSRS client order.
    setFloorCollision(scene: Scene): void {
        for (let level = 0; level < Scene.MAX_LEVELS; level++) {
            for (let x = 0; x < scene.sizeX; x++) {
                for (let y = 0; y < scene.sizeY; y++) {
                    if ((scene.tileRenderFlags[level][x][y] & 0x1) === 1) {
                        let collisionLevel = level;
                        if ((scene.tileRenderFlags[1][x][y] & 0x2) === 0x2) {
                            collisionLevel = level - 1;
                        }

                        if (collisionLevel >= 0 && scene.collisionMaps[collisionLevel]) {
                            scene.collisionMaps[collisionLevel].setBlockedByFloor(x, y);
                        }
                    }
                }
            }
        }
    }

    decodeTerrainTile(
        scene: Scene,
        buffer: ByteBuffer,
        level: number,
        x: number,
        y: number,
        baseX: number,
        baseY: number,
        rotOffset: number,
        isAuthoritative: boolean = true,
    ): void {
        if (scene.isWithinBounds(level, x, y)) {
            // Clear render flags and track what we read from the terrain data
            scene.tileRenderFlags[level][x][y] = 0;
            let readRenderFlags = 0;

            while (true) {
                const v = readTerrainValue(buffer, this.newTerrainFormat);
                if (v === 0) {
                    if (level === 0) {
                        const worldX = baseX + x + 932731;
                        const worldY = baseY + y + 556238;
                        scene.tileHeights[level][x][y] =
                            -generateHeight(worldX, worldY) * Scene.UNITS_TILE_HEIGHT_BASIS;
                    } else {
                        scene.tileHeights[level][x][y] =
                            scene.tileHeights[level - 1][x][y] - Scene.UNITS_LEVEL_HEIGHT;
                    }
                    break;
                }

                if (v === 1) {
                    let height = buffer.readUnsignedByte();
                    if (height === 1) {
                        height = 0;
                    }

                    if (level === 0) {
                        scene.tileHeights[0][x][y] = -height * Scene.UNITS_TILE_HEIGHT_BASIS;
                    } else {
                        scene.tileHeights[level][x][y] =
                            scene.tileHeights[level - 1][x][y] -
                            height * Scene.UNITS_TILE_HEIGHT_BASIS;
                    }
                    break;
                }

                if (v <= 49) {
                    scene.tileOverlays[level][x][y] = readTerrainValue(
                        buffer,
                        this.newTerrainFormat,
                        true,
                    );
                    scene.tileShapes[level][x][y] = (v - 2) / 4;
                    scene.tileRotations[level][x][y] = (v - 2 + rotOffset) & 3;
                } else if (v <= 81) {
                    readRenderFlags = v - 49;
                    // Only persist render flags if this map is authoritative for this tile
                    // But always use the read value for loc building below
                    if (isAuthoritative) {
                        scene.tileRenderFlags[level][x][y] = readRenderFlags;
                    } else {
                        // Non-authoritative: temporarily set the flags so loc building
                        // uses the correct values, but they won't be persisted
                        scene.tileRenderFlags[level][x][y] = readRenderFlags;
                    }
                } else {
                    scene.tileUnderlays[level][x][y] = v - 81;
                }
            }
        } else {
            while (true) {
                const v = readTerrainValue(buffer, this.newTerrainFormat);
                if (v === 0) {
                    break;
                }

                if (v === 1) {
                    buffer.readUnsignedByte();
                    break;
                }

                if (v <= 49) {
                    readTerrainValue(buffer, this.newTerrainFormat);
                }
            }
        }
    }

    decodeLocs(
        scene: Scene,
        data: Int8Array,
        offsetX: number,
        offsetY: number,
        locLoadType: LocLoadType,
    ): void {
        const buffer = new ByteBuffer(data);
        const movedLocs: Array<{
            level: number;
            x: number;
            y: number;
            id: number;
            type: LocModelType;
            rotation: number;
        }> = [];

        let id = -1;
        let idDelta: number;
        while ((idDelta = buffer.readSmart3()) !== 0) {
            id += idDelta;

            let pos = 0;
            let posDelta: number;
            while ((posDelta = buffer.readUnsignedSmart()) !== 0) {
                pos += posDelta - 1;

                const localX = (pos >> 6) & 0x3f;
                const localY = pos & 0x3f;
                const level = pos >> 12;

                const attributes = buffer.readUnsignedByte();

                const type: LocModelType = attributes >> 2;
                const rotation = attributes & 0x3;

                const sceneX = localX + offsetX;
                const sceneY = localY + offsetY;

                if (
                    sceneX > 0 &&
                    sceneY > 0 &&
                    sceneX < scene.sizeX - 1 &&
                    sceneY < scene.sizeY - 1
                ) {
                    let collisionMap: CollisionMap | undefined = scene.collisionMaps[level];

                    // Check for dynamic loc override
                    const overrideKey = `${sceneX},${sceneY},${level},${id}`;
                    const override = this.locOverrides.get(overrideKey);
                    const finalId = override?.newId ?? id;
                    const finalRotation = override?.newRotation ?? rotation;
                    const moveToX = override?.moveToX;
                    const moveToY = override?.moveToY;

                    if (
                        typeof moveToX === "number" &&
                        Number.isFinite(moveToX) &&
                        typeof moveToY === "number" &&
                        Number.isFinite(moveToY) &&
                        ((moveToX | 0) !== (sceneX | 0) || (moveToY | 0) !== (sceneY | 0))
                    ) {
                        movedLocs.push({
                            level: level | 0,
                            x: moveToX | 0,
                            y: moveToY | 0,
                            id: finalId | 0,
                            type,
                            rotation: finalRotation & 0x3,
                        });
                        continue;
                    }

                    this.addLoc(
                        scene,
                        level,
                        sceneX,
                        sceneY,
                        finalId,
                        type,
                        finalRotation,
                        collisionMap,
                        locLoadType,
                    );
                }
            }
        }

        // Process loc spawns (locs not present in base map data, e.g. fires placed on empty ground)
        for (const [key, spawn] of this.locSpawns.entries()) {
            const parts = key.split(",");
            if (parts.length !== 3) continue;
            const sx = parseInt(parts[0]);
            const sy = parseInt(parts[1]);
            const sl = parseInt(parts[2]);
            if (
                sx > 0 && sy > 0 &&
                sx < scene.sizeX - 1 && sy < scene.sizeY - 1 &&
                sl >= 0 && sl < scene.levels
            ) {
                this.addLoc(scene, sl, sx, sy, spawn.id, spawn.type, spawn.rotation, scene.collisionMaps[sl], locLoadType);
            }
        }

        for (const moved of movedLocs) {
            if (
                (moved.level | 0) < 0 ||
                (moved.level | 0) >= scene.levels ||
                (moved.x | 0) <= 0 ||
                (moved.y | 0) <= 0 ||
                (moved.x | 0) >= scene.sizeX - 1 ||
                (moved.y | 0) >= scene.sizeY - 1
            ) {
                continue;
            }

            this.addLoc(
                scene,
                moved.level | 0,
                moved.x | 0,
                moved.y | 0,
                moved.id | 0,
                moved.type,
                moved.rotation & 0x3,
                scene.collisionMaps[moved.level | 0],
                locLoadType,
            );
        }
    }

    addLoc(
        scene: Scene,
        level: number,
        tileX: number,
        tileY: number,
        id: number,
        type: LocModelType,
        rotation: number,
        collisionMap: CollisionMap | undefined,
        locLoadType: LocLoadType,
    ): void {
        const locType = this.locTypeLoader.load(id);

        let sizeX = locType.sizeX;
        let sizeY = locType.sizeY;
        if (rotation === 1 || rotation === 3) {
            sizeX = locType.sizeY;
            sizeY = locType.sizeX;
        }
        let startX: number;
        let endX: number;
        if (tileX + sizeX <= scene.sizeX) {
            startX = (sizeX >> 1) + tileX;
            endX = ((sizeX + 1) >> 1) + tileX;
        } else {
            startX = tileX;
            endX = tileX + 1;
        }

        let startY: number;
        let endY: number;
        if (tileY + sizeY <= scene.sizeY) {
            startY = (sizeY >> 1) + tileY;
            endY = tileY + ((sizeY + 1) >> 1);
        } else {
            startY = tileY;
            endY = tileY + 1;
        }

        if (!this.centerLocHeightWithSize) {
            startX = tileX;
            endX = tileX + 1;
            startY = tileY;
            endY = tileY + 1;
        }

        const heightMap = scene.tileHeights[level];
        let heightMapAbove: Int32Array[] | undefined;
        if (level < scene.levels - 1) {
            heightMapAbove = scene.tileHeights[level + 1];
        }

        const centerHeight =
            (heightMap[endX][endY] +
                heightMap[startX][endY] +
                heightMap[startX][startY] +
                heightMap[endX][startY]) >>
            2;
        const entityX = (tileX << 7) + (sizeX << 6);
        const entityY = (tileY << 7) + (sizeY << 6);

        const tag = calculateEntityTag(
            tileX,
            tileY,
            EntityType.LOC,
            locType.isInteractive === 0,
            id,
        );

        let flags = (rotation << 6) | type;
        if (locType.supportItems === 1) {
            flags += 256;
        }

        const contourGroundInfo: ContourGroundInfo = {
            type: locType.contourGroundType,
            param: locType.contourGroundParam,
            heightMap,
            heightMapAbove,
            entityX: entityX,
            entityY: centerHeight,
            entityZ: entityY,
        };

        let seqId = locType.seqId;
        if (seqId === -1 && locType.randomSeqIds && locType.randomSeqIds.length > 0) {
            seqId = locType.randomSeqIds[0];
            // seqId = locType.randomSeqIds[(Math.random() * locType.randomSeqIds.length) | 0];
        }

        const isEntity =
            seqId !== -1 ||
            locType.transforms !== undefined ||
            locLoadType === LocLoadType.NO_MODELS;

        if (type === LocModelType.FLOOR_DECORATION) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newFloorDecoration(level, tileX, tileY, centerHeight, entity, tag, flags);
            if (locType.clipType === 1 && collisionMap) {
                collisionMap.setBlockedByFloorDec(tileX, tileY);
            }
        } else if (type === LocModelType.NORMAL || type === LocModelType.NORMAL_DIAGIONAL) {
            const locRotation = type === LocModelType.NORMAL ? rotation : rotation + 4;
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.NORMAL,
                    locRotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.NORMAL,
                    locRotation,
                    contourGroundInfo,
                );
            }

            if (entity) {
                const added = scene.newLoc(
                    level,
                    tileX,
                    tileY,
                    centerHeight,
                    sizeX,
                    sizeY,
                    entity,
                    0,
                    tag,
                    flags,
                );
                if (added && locType.clipped) {
                    let lightOcclusion = 15;
                    if (entity instanceof Model) {
                        lightOcclusion = (entity.getXZRadius() / 4) | 0;
                        if (lightOcclusion > 30) {
                            lightOcclusion = 30;
                        }
                    }

                    for (let sx = tileX; sx <= tileX + sizeX; sx++) {
                        for (let sy = tileY; sy <= tileY + sizeY; sy++) {
                            const currentOcclusion = scene.tileLightOcclusions[level][sx][sy];
                            if (lightOcclusion > currentOcclusion) {
                                scene.tileLightOcclusions[level][sx][sy] = lightOcclusion;
                            }
                        }
                    }
                }
            }

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addLoc(tileX, tileY, sizeX, sizeY, locType.blocksProjectile);
            }
        } else if (type >= LocModelType.ROOF_SLOPED) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newLoc(level, tileX, tileY, centerHeight, 1, 1, entity, 0, tag, flags);
        } else if (type === LocModelType.WALL) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newWall(level, tileX, tileY, centerHeight, entity, undefined, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addWall(tileX, tileY, type, rotation, locType.blocksProjectile);
            }

            if (rotation === 0) {
                if (locType.clipped) {
                    scene.tileLightOcclusions[level][tileX][tileY] = 50;
                    scene.tileLightOcclusions[level][tileX][tileY + 1] = 50;
                }
            } else if (rotation === 1) {
                if (locType.clipped) {
                    scene.tileLightOcclusions[level][tileX][tileY + 1] = 50;
                    scene.tileLightOcclusions[level][tileX + 1][tileY + 1] = 50;
                }
            } else if (rotation === 2) {
                if (locType.clipped) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY] = 50;
                    scene.tileLightOcclusions[level][tileX + 1][tileY + 1] = 50;
                }
            } else if (rotation === 3) {
                if (locType.clipped) {
                    scene.tileLightOcclusions[level][tileX][tileY] = 50;
                    scene.tileLightOcclusions[level][tileX + 1][tileY] = 50;
                }
            }
        } else if (type === LocModelType.WALL_TRI_CORNER) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newWall(level, tileX, tileY, centerHeight, entity, undefined, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addWall(tileX, tileY, type, rotation, locType.blocksProjectile);
            }

            if (locType.clipped) {
                if (rotation === 0) {
                    scene.tileLightOcclusions[level][tileX][tileY + 1] = 50;
                } else if (rotation === 1) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY + 1] = 50;
                } else if (rotation === 2) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY] = 50;
                } else if (rotation === 3) {
                    scene.tileLightOcclusions[level][tileX][tileY] = 50;
                }
            }
        } else if (type === LocModelType.WALL_CORNER) {
            let entity0: Entity | undefined;
            let entity1: Entity | undefined;
            if (isEntity) {
                entity0 = new LocEntity(
                    id,
                    type,
                    rotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
                entity1 = new LocEntity(
                    id,
                    type,
                    (rotation + 1) & 3,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity0 = this.locModelLoader.getModel(
                    locType,
                    type,
                    rotation + 4,
                    contourGroundInfo,
                );
                entity1 = this.locModelLoader.getModel(
                    locType,
                    type,
                    (rotation + 1) & 3,
                    contourGroundInfo,
                );
            }

            scene.newWall(level, tileX, tileY, centerHeight, entity0, entity1, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addWall(tileX, tileY, type, rotation, locType.blocksProjectile);
            }
        } else if (type === LocModelType.WALL_RECT_CORNER) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newWall(level, tileX, tileY, centerHeight, entity, undefined, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addWall(tileX, tileY, type, rotation, locType.blocksProjectile);
            }

            if (locType.clipped) {
                if (rotation === 0) {
                    scene.tileLightOcclusions[level][tileX][tileY + 1] = 50;
                } else if (rotation === 1) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY + 1] = 50;
                } else if (rotation === 2) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY] = 50;
                } else if (rotation === 3) {
                    scene.tileLightOcclusions[level][tileX][tileY] = 50;
                }
            }
        } else if (type === LocModelType.WALL_DIAGONAL) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newLoc(level, tileX, tileY, centerHeight, 1, 1, entity, 0, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addLoc(tileX, tileY, sizeX, sizeY, locType.blocksProjectile);
            }
        } else if (type === LocModelType.WALL_DECORATION_INSIDE) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation,
                    contourGroundInfo,
                );
            }

            // Apply a small positional offset so the decoration sits against the wall
            // rather than at the tile center. This mirrors the displacement used by
            // other wall decoration types and fixes banners appearing unshifted.
            let displacement = LocType.DEFAULT_DECOR_DISPLACEMENT;
            const wallTag = scene.getWallTag(level, tileX, tileY);
            if (wallTag !== 0n) {
                try {
                    const wallLoc = this.locTypeLoader.load(getIdFromTag(wallTag));
                    if (wallLoc?.decorDisplacement) displacement = wallLoc.decorDisplacement;
                } catch {}
            }
            const displacementX = displacement * SceneBuilder.displacementX[rotation & 3];
            const displacementY = displacement * SceneBuilder.displacementY[rotation & 3];

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity,
                undefined,
                displacementX,
                displacementY,
                tag,
                flags,
            );
        } else if (type === LocModelType.WALL_DECORATION_OUTSIDE) {
            let displacement = LocType.DEFAULT_DECOR_DISPLACEMENT;
            const wallTag = scene.getWallTag(level, tileX, tileY);
            if (wallTag !== 0n) {
                displacement = this.locTypeLoader.load(getIdFromTag(wallTag)).decorDisplacement;
            }

            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation,
                    contourGroundInfo,
                );
            }

            const displacementX = displacement * SceneBuilder.displacementX[rotation];
            const displacementY = displacement * SceneBuilder.displacementY[rotation];

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity,
                undefined,
                displacementX,
                displacementY,
                tag,
                flags,
            );
        } else if (type === LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE) {
            let displacement = LocType.DEFAULT_DECOR_DISPLACEMENT / 2;
            const wallTag = scene.getWallTag(level, tileX, tileY);
            if (wallTag !== 0n) {
                displacement =
                    (this.locTypeLoader.load(getIdFromTag(wallTag)).decorDisplacement / 2) | 0;
            }

            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation + 4,
                    contourGroundInfo,
                );
            }

            const displacementX = displacement * SceneBuilder.diagonalDisplacementX[rotation];
            const displacementY = displacement * SceneBuilder.diagonalDisplacementY[rotation];

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity,
                undefined,
                displacementX,
                displacementY,
                tag,
                flags,
            );
        } else if (type === LocModelType.WALL_DECORATION_DIAGONAL_INSIDE) {
            const insideRotation = (rotation + 2) & 3;

            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    insideRotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    insideRotation + 4,
                    contourGroundInfo,
                );
            }

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity,
                undefined,
                0,
                0,
                tag,
                flags,
            );
        } else if (type === LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE) {
            let displacement = LocType.DEFAULT_DECOR_DISPLACEMENT / 2;
            const wallTag = scene.getWallTag(level, tileX, tileY);
            if (wallTag !== 0n) {
                displacement =
                    (this.locTypeLoader.load(getIdFromTag(wallTag)).decorDisplacement / 2) | 0;
            }

            const insideRotation = (rotation + 2) & 3;

            let entity0: Entity | undefined;
            let entity1: Entity | undefined;
            if (isEntity) {
                entity0 = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
                entity1 = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    insideRotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity0 = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation + 4,
                    contourGroundInfo,
                );
                entity1 = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    insideRotation + 4,
                    contourGroundInfo,
                );
            }

            const displacementX = displacement * SceneBuilder.diagonalDisplacementX[rotation];
            const displacementY = displacement * SceneBuilder.diagonalDisplacementY[rotation];

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity0,
                entity1,
                displacementX,
                displacementY,
                tag,
                flags,
            );
        }
    }

    blendUnderlays(scene: Scene, level: number): Int32Array[] {
        const colors: Int32Array[] = new Array(scene.sizeX);
        for (let i = 0; i < scene.sizeX; i++) {
            colors[i] = new Int32Array(scene.sizeY).fill(-1);
        }

        const maxSize = Math.max(scene.sizeX, scene.sizeY);

        const hues = new Int32Array(maxSize);
        const sats = new Int32Array(hues.length);
        const light = new Int32Array(hues.length);
        const mul = new Int32Array(hues.length);
        const num = new Int32Array(hues.length);

        const blendStartX = -SceneBuilder.BLEND_RADIUS;
        const blendStartY = -SceneBuilder.BLEND_RADIUS;
        const blendEndX = scene.sizeX + SceneBuilder.BLEND_RADIUS;
        const blendEndY = scene.sizeY + SceneBuilder.BLEND_RADIUS;

        for (let xi = blendStartX; xi < blendEndX; xi++) {
            for (let yi = 0; yi < scene.sizeY; yi++) {
                const xEast = xi + SceneBuilder.BLEND_RADIUS;
                if (xEast >= 0 && xEast < scene.sizeX) {
                    const underlayId = scene.tileUnderlays[level][xEast][yi];
                    if (underlayId > 0) {
                        const underlay = this.underlayTypeLoader.load(underlayId - 1);
                        hues[yi] += underlay.getHueBlend();
                        sats[yi] += underlay.saturation;
                        light[yi] += underlay.lightness;
                        mul[yi] += underlay.getHueMultiplier();
                        num[yi]++;
                    }
                }
                const xWest = xi - SceneBuilder.BLEND_RADIUS;
                if (xWest >= 0 && xWest < scene.sizeX) {
                    const underlayId = scene.tileUnderlays[level][xWest][yi];
                    if (underlayId > 0) {
                        const underlay = this.underlayTypeLoader.load(underlayId - 1);
                        hues[yi] -= underlay.getHueBlend();
                        sats[yi] -= underlay.saturation;
                        light[yi] -= underlay.lightness;
                        mul[yi] -= underlay.getHueMultiplier();
                        num[yi]--;
                    }
                }
            }

            if (xi < 0 || xi >= scene.sizeX) {
                continue;
            }

            let runningHues = 0;
            let runningSat = 0;
            let runningLight = 0;
            let runningMultiplier = 0;
            let runningNumber = 0;

            for (let yi = blendStartY; yi < blendEndY; yi++) {
                const yNorth = yi + SceneBuilder.BLEND_RADIUS;
                if (yNorth >= 0 && yNorth < scene.sizeY) {
                    runningHues += hues[yNorth];
                    runningSat += sats[yNorth];
                    runningLight += light[yNorth];
                    runningMultiplier += mul[yNorth];
                    runningNumber += num[yNorth];
                }
                const ySouth = yi - SceneBuilder.BLEND_RADIUS;
                if (ySouth >= 0 && ySouth < scene.sizeY) {
                    runningHues -= hues[ySouth];
                    runningSat -= sats[ySouth];
                    runningLight -= light[ySouth];
                    runningMultiplier -= mul[ySouth];
                    runningNumber -= num[ySouth];
                }

                if (yi < 0 || yi >= scene.sizeX) {
                    continue;
                }

                const underlayId = scene.tileUnderlays[level][xi][yi];

                if (underlayId > 0) {
                    const avgHue = ((runningHues * 256) / runningMultiplier) | 0;
                    const avgSat = (runningSat / runningNumber) | 0;
                    const avgLight = (runningLight / runningNumber) | 0;

                    colors[xi][yi] = packHsl(avgHue, avgSat, avgLight);
                }
            }
        }

        return colors;
    }

    addTileModels(scene: Scene, smoothUnderlays: boolean): void {
        const heights = scene.tileHeights;
        const underlayIds = scene.tileUnderlays;
        const overlayIds = scene.tileOverlays;
        const tileShapes = scene.tileShapes;
        const tileRotations = scene.tileRotations;

        for (let level = 0; level < scene.levels; level++) {
            const blendedColors = this.blendUnderlays(scene, level);
            const lights = scene.calculateTileLights(level);

            for (let x = 1; x < scene.sizeX - 1; x++) {
                for (let y = 1; y < scene.sizeY - 1; y++) {
                    const underlayId = underlayIds[level][x][y] - 1;

                    // Overlay id can have the high bit set with extra flags; mask to 15 bits like RuneLite
                    const overlayId = (overlayIds[level][x][y] & 0x7fff) - 1;

                    if (underlayId === -1 && overlayId === -1) {
                        continue;
                    }

                    const heightSw = heights[level][x][y];
                    const heightSe = heights[level][x + 1][y];
                    const heightNe = heights[level][x + 1][y + 1];
                    const heightNw = heights[level][x][y + 1];

                    const lightSw = lights[x][y];
                    const lightSe = lights[x + 1][y];
                    const lightNe = lights[x + 1][y + 1];
                    const lightNw = lights[x][y + 1];

                    let underlayHslSw = -1;
                    let underlayHslSe = -1;
                    let underlayHslNe = -1;
                    let underlayHslNw = -1;
                    if (underlayId !== -1) {
                        underlayHslSw = blendedColors[x][y];
                        underlayHslSe = blendedColors[x + 1][y];
                        underlayHslNe = blendedColors[x + 1][y + 1];
                        underlayHslNw = blendedColors[x][y + 1];
                        if (underlayHslSe === -1 || !smoothUnderlays) {
                            underlayHslSe = underlayHslSw;
                        }
                        if (underlayHslNe === -1 || !smoothUnderlays) {
                            underlayHslNe = underlayHslSw;
                        }
                        if (underlayHslNw === -1 || !smoothUnderlays) {
                            underlayHslNw = underlayHslSw;
                        }
                    }

                    let underlayRgb = 0;
                    if (underlayHslSw !== -1) {
                        underlayRgb = HSL_RGB_MAP[adjustUnderlayLight(underlayHslSw, 96)];
                    }

                    let tileModel: SceneTileModel;
                    if (overlayId === -1) {
                        tileModel = new SceneTileModel(
                            0,
                            0,
                            -1,
                            x,
                            y,
                            heightSw,
                            heightSe,
                            heightNe,
                            heightNw,
                            lightSw,
                            lightSe,
                            lightNe,
                            lightNw,
                            underlayHslSw,
                            underlayHslSe,
                            underlayHslNe,
                            underlayHslNw,
                            0,
                            0,
                            underlayRgb,
                            0,
                        );
                    } else {
                        const shape = tileShapes[level][x][y] + 1;
                        const rotation = tileRotations[level][x][y];

                        const overlay = this.overlayTypeLoader.load(overlayId);

                        let overlayHsl: number;
                        let overlayMinimapHsl: number;
                        if (
                            overlay.textureId !== -1 &&
                            this.locModelLoader.textureLoader.isSd(overlay.textureId)
                        ) {
                            overlayMinimapHsl = this.locModelLoader.textureLoader.getAverageHsl(
                                overlay.textureId,
                            );
                            overlayHsl = -1;
                        } else if (overlay.primaryRgb === 0xff00ff) {
                            overlayHsl = overlayMinimapHsl = -2;
                        } else {
                            overlayHsl = overlayMinimapHsl = packHsl(
                                overlay.hue,
                                overlay.saturation,
                                overlay.lightness,
                            );
                        }

                        if (overlay.secondaryRgb !== -1) {
                            overlayMinimapHsl = packHsl(
                                overlay.secondaryHue,
                                overlay.secondarySaturation,
                                overlay.secondaryLightness,
                            );
                        }

                        let overlayRgb = 0;
                        if (overlayMinimapHsl !== -2) {
                            overlayRgb = HSL_RGB_MAP[adjustOverlayLight(overlayMinimapHsl, 96)];
                        }

                        // if (overlayMinimapHsl === -2) {
                        //     overlayMinimapHsl = overlayHsl;
                        // }

                        tileModel = new SceneTileModel(
                            shape,
                            rotation,
                            overlay.textureId,
                            x,
                            y,
                            heightSw,
                            heightSe,
                            heightNe,
                            heightNw,
                            lightSw,
                            lightSe,
                            lightNe,
                            lightNw,
                            underlayHslSw,
                            underlayHslSe,
                            underlayHslNe,
                            underlayHslNw,
                            overlayHsl,
                            overlayMinimapHsl,
                            underlayRgb,
                            overlayRgb,
                        );
                    }

                    scene.newTileModel(level, x, y, tileModel);
                }
            }
        }
    }

    // ====================================================================
    // REBUILD_REGION — Instance scene building
    // Ported from MapLoader.java lines 301-386, 959-1035
    // ====================================================================

    /**
     * Build a scene from instance template chunks.
     *
     * Each template chunk maps an 8×8 destination area to an 8×8 source area
     * in the cache, optionally rotated. The scene is built as one monolithic
     * 104×104 tile grid (13 chunks × 8 tiles).
     *
     * @param templateChunks 4×13×13 grid of packed template references (-1 = empty)
     * @param smoothUnderlays Whether to smooth underlay colors
     * @param locLoadType Whether to load loc models
     * @param xteas Optional XTEA keys to merge (from REBUILD_REGION packet)
     */
    buildInstanceScene(
        templateChunks: number[][][],
        _baseX: number,
        _baseY: number,
        sizeX: number,
        sizeY: number,
        smoothUnderlays: boolean = false,
        locLoadType: LocLoadType = LocLoadType.MODELS,
    ): Scene {
        const scene = new Scene(Scene.MAX_LEVELS, INSTANCE_SIZE, INSTANCE_SIZE);

        // Phase 1: Load all source region archives referenced by the template grid
        const archives = this.loadInstanceRegionArchives(templateChunks, this.xteasMap);

        // Phase 2: Decode terrain chunk-by-chunk
        for (let plane = 0; plane < PLANE_COUNT; plane++) {
            for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
                for (let cy = 0; cy < INSTANCE_CHUNK_COUNT; cy++) {
                    const packed = templateChunks[plane]?.[cx]?.[cy] ?? -1;
                    if (packed === -1) {
                        this.clearTerrainChunk(scene, plane, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
                        continue;
                    }
                    const { plane: sourcePlane, chunkX, chunkY, rotation } =
                        unpackTemplateChunk(packed);
                    const regionId = ((chunkX >> 3) << 8) | (chunkY >> 3);
                    const archive = archives.get(regionId);
                    if (!archive?.terrain) {
                        this.clearTerrainChunk(scene, plane, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
                        continue;
                    }
                    const sourceChunkX = (chunkX & 7) * CHUNK_SIZE;
                    const sourceChunkY = (chunkY & 7) * CHUNK_SIZE;
                    const noiseXOffset = (chunkX - cx) * CHUNK_SIZE;
                    const noiseYOffset = (chunkY - cy) * CHUNK_SIZE;
                    this.decodeInstanceTerrainChunk(
                        scene,
                        archive.terrain,
                        plane,
                        cx * CHUNK_SIZE,
                        cy * CHUNK_SIZE,
                        sourcePlane,
                        sourceChunkX,
                        sourceChunkY,
                        rotation,
                        noiseXOffset,
                        noiseYOffset,
                    );
                }
            }
        }

        // Phase 2b: Fill missing terrain for plane 0 empty chunks
        for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
            for (let cy = 0; cy < INSTANCE_CHUNK_COUNT; cy++) {
                const packed = templateChunks[0]?.[cx]?.[cy] ?? -1;
                if (packed === -1) {
                    this.fillMissingTerrain(scene, cx * CHUNK_SIZE, cy * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
                }
            }
        }

        // Phase 3: Decode locs chunk-by-chunk
        for (let plane = 0; plane < PLANE_COUNT; plane++) {
            for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
                for (let cy = 0; cy < INSTANCE_CHUNK_COUNT; cy++) {
                    const packed = templateChunks[plane]?.[cx]?.[cy] ?? -1;
                    if (packed === -1) continue;
                    const { plane: sourcePlane, chunkX, chunkY, rotation } =
                        unpackTemplateChunk(packed);
                    const regionId = ((chunkX >> 3) << 8) | (chunkY >> 3);
                    const archive = archives.get(regionId);
                    if (!archive?.loc) continue;
                    const sourceChunkX = (chunkX & 7) * CHUNK_SIZE;
                    const sourceChunkY = (chunkY & 7) * CHUNK_SIZE;
                    this.decodeInstanceLocs(
                        scene,
                        archive.loc,
                        plane,
                        cx * CHUNK_SIZE,
                        cy * CHUNK_SIZE,
                        sourcePlane,
                        sourceChunkX,
                        sourceChunkY,
                        rotation,
                        locLoadType,
                    );
                }
            }
        }

        // Phase 4: Post-processing (same as buildScene)
        this.addTileModels(scene, smoothUnderlays);
        scene.setTileMinLevels();
        this.setFloorCollision(scene);
        scene.applyBridgeLinks();
        scene.setTileMinLevels();
        if (locLoadType === LocLoadType.MODELS) {
            scene.light(this.locModelLoader.textureLoader, -50, -10, -50);
        }

        return scene;
    }

    /**
     * Load all cache region archives referenced by the template chunks.
     */
    private loadInstanceRegionArchives(
        templateChunks: number[][][],
        xteas: Map<number, number[]>,
    ): Map<number, { terrain?: Int8Array; loc?: Int8Array }> {
        const regions = deriveRegionsFromTemplates(templateChunks);
        const archives = new Map<number, { terrain?: Int8Array; loc?: Int8Array }>();

        for (const regionId of regions) {
            const mapX = (regionId >> 8) & 0xff;
            const mapY = regionId & 0xff;
            const terrain = this.mapFileLoader.getTerrainData(mapX, mapY, xteas);
            const loc = this.mapFileLoader.getLocData(mapX, mapY, xteas);
            console.log(`[SceneBuilder] loadInstanceRegion ${regionId} (m${mapX}_${mapY}): terrain=${terrain?.length ?? 'null'} loc=${loc?.length ?? 'null'}`);
            archives.set(regionId, { terrain: terrain ?? undefined, loc: loc ?? undefined });
        }

        return archives;
    }

    /**
     * Decode an 8×8 terrain chunk from a source region archive with rotation.
     * Reads the full 4×64×64 terrain buffer but only applies tiles within the
     * source chunk bounds. Ported from MapLoader.decodeInstanceTerrainChunk.
     */
    private decodeInstanceTerrainChunk(
        scene: Scene,
        regionMapData: Int8Array,
        targetPlane: number,
        chunkSceneX: number,
        chunkSceneY: number,
        sourcePlane: number,
        sourceChunkX: number,
        sourceChunkY: number,
        rotation: number,
        noiseXOffset: number,
        noiseYOffset: number,
    ): void {
        // Clear bridge collision flags in the chunk area before decoding
        const collisionMap = scene.collisionMaps[targetPlane];
        if (collisionMap) {
            for (let x = chunkSceneX; x < chunkSceneX + CHUNK_SIZE; x++) {
                for (let y = chunkSceneY; y < chunkSceneY + CHUNK_SIZE; y++) {
                    if (collisionMap.isWithinBounds(x, y)) {
                        collisionMap.unflag(x, y, 0x40000000);
                    }
                }
            }
        }

        const buffer = new ByteBuffer(regionMapData);

        for (let level = 0; level < Scene.MAX_LEVELS; level++) {
            for (let x = 0; x < Scene.MAP_SQUARE_SIZE; x++) {
                for (let y = 0; y < Scene.MAP_SQUARE_SIZE; y++) {
                    if (
                        level === sourcePlane &&
                        x >= sourceChunkX &&
                        x < sourceChunkX + CHUNK_SIZE &&
                        y >= sourceChunkY &&
                        y < sourceChunkY + CHUNK_SIZE
                    ) {
                        const localX = x & 7;
                        const localY = y & 7;
                        const destX = chunkSceneX + rotateChunkX(localX, localY, rotation);
                        const destY = chunkSceneY + rotateChunkY(localX, localY, rotation);
                        const noiseX = chunkSceneX + localX + noiseXOffset;
                        const noiseY = chunkSceneY + localY + noiseYOffset;
                        this.decodeTerrainTile(
                            scene,
                            buffer,
                            targetPlane,
                            destX,
                            destY,
                            noiseX - destX,
                            noiseY - destY,
                            rotation,
                            true,
                        );
                    } else {
                        // Skip this tile's data without applying it
                        this.decodeTerrainTile(scene, buffer, -1, -1, -1, 0, 0, 0, false);
                    }
                }
            }
        }
    }

    /**
     * Clear an 8×8 terrain chunk with edge blending from adjacent chunks.
     * Ported from MapLoader.clearTerrainChunk (lines 886-915).
     */
    private clearTerrainChunk(
        scene: Scene,
        level: number,
        chunkSceneX: number,
        chunkSceneY: number,
    ): void {
        // Zero all heights in the chunk (reference does NOT clear tileRenderFlags here)
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                const x = lx + chunkSceneX;
                const y = ly + chunkSceneY;
                if (x >= 0 && x < scene.sizeX && y >= 0 && y < scene.sizeY) {
                    scene.tileHeights[level][x][y] = 0;
                }
            }
        }

        // Copy left edge heights from west neighbor
        if (chunkSceneX > 0) {
            for (let ly = 1; ly < CHUNK_SIZE; ly++) {
                const x = chunkSceneX;
                const y = ly + chunkSceneY;
                if (x < scene.sizeX && y >= 0 && y < scene.sizeY) {
                    scene.tileHeights[level][x][y] = scene.tileHeights[level][x - 1][y];
                }
            }
        }

        // Copy top edge heights from south neighbor
        if (chunkSceneY > 0) {
            for (let lx = 1; lx < CHUNK_SIZE; lx++) {
                const x = lx + chunkSceneX;
                const y = chunkSceneY;
                if (x >= 0 && x < scene.sizeX && y < scene.sizeY) {
                    scene.tileHeights[level][x][y] = scene.tileHeights[level][x][y - 1];
                }
            }
        }

        // Copy corner from diagonal neighbor
        if (chunkSceneX > 0 && chunkSceneY >= 0 && chunkSceneX < scene.sizeX && chunkSceneY < scene.sizeY) {
            if (chunkSceneX > 0 && scene.tileHeights[level][chunkSceneX - 1][chunkSceneY] !== 0) {
                scene.tileHeights[level][chunkSceneX][chunkSceneY] = scene.tileHeights[level][chunkSceneX - 1][chunkSceneY];
            } else if (chunkSceneY > 0 && scene.tileHeights[level][chunkSceneX][chunkSceneY - 1] !== 0) {
                scene.tileHeights[level][chunkSceneX][chunkSceneY] = scene.tileHeights[level][chunkSceneX][chunkSceneY - 1];
            } else if (chunkSceneX > 0 && chunkSceneY > 0 && scene.tileHeights[level][chunkSceneX - 1][chunkSceneY - 1] !== 0) {
                scene.tileHeights[level][chunkSceneX][chunkSceneY] = scene.tileHeights[level][chunkSceneX - 1][chunkSceneY - 1];
            }
        }
    }

    /**
     * Fill missing terrain for empty chunks on plane 0 by smoothing edge heights.
     * Ported from MapLoader.fillMissingTerrain (lines 859-884).
     */
    private fillMissingTerrain(
        scene: Scene,
        startSceneX: number,
        startSceneY: number,
        width: number,
        height: number,
    ): void {
        for (let sceneY = startSceneY; sceneY <= startSceneY + height; sceneY++) {
            for (let sceneX = startSceneX; sceneX <= width + startSceneX; sceneX++) {
                if (sceneX >= 0 && sceneX < scene.sizeX && sceneY >= 0 && sceneY < scene.sizeY) {
                    scene.tileLightOcclusions[0][sceneX][sceneY] = 127;
                    if (sceneX === startSceneX && sceneX > 0) {
                        scene.tileHeights[0][sceneX][sceneY] = scene.tileHeights[0][sceneX - 1][sceneY];
                    }
                    if (sceneX === width + startSceneX && sceneX < scene.sizeX - 1) {
                        scene.tileHeights[0][sceneX][sceneY] = scene.tileHeights[0][sceneX + 1][sceneY];
                    }
                    if (sceneY === startSceneY && sceneY > 0) {
                        scene.tileHeights[0][sceneX][sceneY] = scene.tileHeights[0][sceneX][sceneY - 1];
                    }
                    if (sceneY === startSceneY + height && sceneY < scene.sizeY - 1) {
                        scene.tileHeights[0][sceneX][sceneY] = scene.tileHeights[0][sceneX][sceneY + 1];
                    }
                }
            }
        }
    }

    /**
     * Decode locs for an 8×8 instance chunk from a source region with rotation.
     * Ported from MapLoader.decodeInstanceObjects.
     */
    private decodeInstanceLocs(
        scene: Scene,
        regionLocData: Int8Array,
        targetPlane: number,
        chunkSceneX: number,
        chunkSceneY: number,
        sourcePlane: number,
        sourceChunkX: number,
        sourceChunkY: number,
        rotation: number,
        locLoadType: LocLoadType,
    ): void {
        const buffer = new ByteBuffer(regionLocData);
        let id = -1;
        let locsMatched = 0;
        let locsTotal = 0;
        let idDelta: number;
        while ((idDelta = buffer.readSmart3()) !== 0) {
            id += idDelta;

            let pos = 0;
            let posDelta: number;
            while ((posDelta = buffer.readUnsignedSmart()) !== 0) {
                pos += posDelta - 1;

                const localY = pos & 0x3f;
                const localX = (pos >> 6) & 0x3f;
                const localPlane = pos >> 12;

                const attributes = buffer.readUnsignedByte();
                const type: LocModelType = attributes >> 2;
                const orientation = attributes & 0x3;
                locsTotal++;

                if (
                    localPlane === sourcePlane &&
                    localX >= sourceChunkX &&
                    localX < sourceChunkX + CHUNK_SIZE &&
                    localY >= sourceChunkY &&
                    localY < sourceChunkY + CHUNK_SIZE
                ) {
                    locsMatched++;
                    const locType = this.locTypeLoader.load(id);
                    const sizeX = locType.sizeX;
                    const sizeY = locType.sizeY;

                    const sceneX =
                        chunkSceneX +
                        rotateObjectChunkX(
                            localX & 7,
                            localY & 7,
                            rotation,
                            sizeX,
                            sizeY,
                            orientation,
                        );
                    const sceneY =
                        chunkSceneY +
                        rotateObjectChunkY(
                            localX & 7,
                            localY & 7,
                            rotation,
                            sizeX,
                            sizeY,
                            orientation,
                        );

                    if (
                        sceneX > 0 &&
                        sceneY > 0 &&
                        sceneX < scene.sizeX - 1 &&
                        sceneY < scene.sizeY - 1
                    ) {
                        let collisionLevel = targetPlane;
                        if (
                            (scene.tileRenderFlags[1]?.[sceneX]?.[sceneY] & 0x2) === 0x2
                        ) {
                            collisionLevel = targetPlane - 1;
                        }

                        const collisionMap =
                            collisionLevel >= 0
                                ? scene.collisionMaps[collisionLevel]
                                : undefined;

                        this.addLoc(
                            scene,
                            targetPlane,
                            sceneX,
                            sceneY,
                            id,
                            type,
                            (orientation + rotation) & 3,
                            collisionMap,
                            locLoadType,
                        );
                    }
                }
            }
        }
        if (locsMatched > 0 || locsTotal > 100) {
            console.log(`[SceneBuilder] decodeInstanceLocs: plane=${targetPlane} chunk=(${chunkSceneX},${chunkSceneY}) src=(${sourceChunkX},${sourceChunkY}) srcPlane=${sourcePlane}: ${locsMatched}/${locsTotal} matched`);
        }
    }
}

import { LocModelType } from "../../../rs/config/loctype/LocModelType";
import { LocType } from "../../../rs/config/loctype/LocType";
import { LocTypeLoader } from "../../../rs/config/loctype/LocTypeLoader";
import { Model } from "../../../rs/model/Model";
import { Loc } from "../../../rs/scene/Loc";
import { Scene } from "../../../rs/scene/Scene";
import { SceneLoc } from "../../../rs/scene/SceneLoc";
import { SceneTile } from "../../../rs/scene/SceneTile";
import { getIdFromTag } from "../../../rs/scene/entity/EntityTag";
import { LocEntity } from "../../../rs/scene/entity/LocEntity";
import { INVALID_HSL_COLOR } from "../../../rs/util/ColorUtil";
import {
    clampPlane,
    getBridgeAdjustedPlane,
    getBridgeLinkedBelow,
} from "../../roof/RoofVisibility";
import { InteractType } from "../../webgl/InteractType";
import { ContourGroundType, SceneModel } from "../buffer/SceneBuffer";
import { SceneLocEntity } from "./SceneLocEntity";

export type SceneLocs = {
    locs: SceneModel[];
    locEntities: SceneLocEntity[];
};

const FIRST_ROOF_TYPE = LocModelType.ROOF_SLOPED;
const LAST_ROOF_TYPE = LocModelType.ROOF_SLOPED_OVERHANG_HARD_OUTER_CORNER;

function isRoofLocModelType(modelType: number): boolean {
    return modelType >= FIRST_ROOF_TYPE && modelType <= LAST_ROOF_TYPE;
}

function getLocPlaneCullLevel(
    basePlaneCullLevel: number,
    renderLevel: number,
    originalLevel: number,
    modelType: number,
): number {
    if (!isRoofLocModelType(modelType)) {
        return basePlaneCullLevel;
    }

    const clampedOriginal = clampPlane(originalLevel);
    const clampedRender = clampPlane(renderLevel);

    // Roofs demoted to ground/first floor should sit one plane higher for culling,
    // matching OSRS behaviour where the roof plane is hidden when the player is below it.
    const baseTarget = clampedRender <= 1 ? Math.min(3, clampedRender + 1) : clampedRender;

    const desiredPlane = Math.max(baseTarget, clampedOriginal);
    return Math.max(basePlaneCullLevel, desiredPlane);
}

const DOOR_NAME_KEYWORDS = ["door", "gate", "trapdoor", "portcullis", "grill"];
const DOOR_ACTION_KEYWORDS = ["open", "close", "unlock", "lock"];

export function isDoorLocType(locType: LocType): boolean {
    // Quick string-based heuristics that cover doors, gates, trapdoors, portcullis, etc.
    const name = locType.name?.toLowerCase?.() ?? "";
    let hasDoorName = false;
    for (const keyword of DOOR_NAME_KEYWORDS) {
        if (name.includes(keyword)) {
            hasDoorName = true;
            break;
        }
    }

    let hasDoorAction = false;
    if (Array.isArray(locType.actions)) {
        for (const action of locType.actions) {
            if (!action) continue;
            const lower = action.toLowerCase();
            for (const keyword of DOOR_ACTION_KEYWORDS) {
                if (lower === keyword) {
                    hasDoorAction = true;
                    break;
                }
            }
            if (hasDoorAction) break;
        }
    }

    return hasDoorName || hasDoorAction;
}

export function isLowDetail(
    scene: Scene,
    level: number,
    tileX: number,
    tileY: number,
    locType: LocType,
    locModelType: LocModelType,
): boolean {
    const tile = scene.tiles[level][tileX][tileY];
    const tileModel = tile?.tileModel;
    // no tile model, or tile model has invis faces
    const hasTileModel =
        tileModel && tileModel.faceColorsA.findIndex((c) => c === INVALID_HSL_COLOR) === -1;

    if (
        locModelType === LocModelType.FLOOR_DECORATION &&
        locType.isInteractive === 0 &&
        locType.clipType !== 1 &&
        !locType.obstructsGround &&
        hasTileModel
    ) {
        return true;
    }

    const isWallDecoration =
        locModelType >= LocModelType.WALL_DECORATION_INSIDE &&
        locModelType <= LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE;
    if (
        (locModelType === LocModelType.NORMAL ||
            locModelType === LocModelType.NORMAL_DIAGIONAL ||
            isWallDecoration) &&
        locType.isInteractive === 1
    ) {
        return scene.isInside(level, tileX, tileY);
    }

    return false;
}

export function createSceneModel(
    locTypeLoader: LocTypeLoader,
    scene: Scene,
    model: Model,
    sceneLoc: SceneLoc,
    offsetX: number,
    offsetY: number,
    level: number,
    tileX: number,
    tileY: number,
    priority: number,
    planeCullLevel?: number,
): SceneModel {
    const id = getIdFromTag(sceneLoc.tag);
    const type: LocModelType = sceneLoc.flags & 0x3f;
    const locType = locTypeLoader.load(id);

    const sceneX = sceneLoc.x + offsetX;
    const sceneZ = sceneLoc.y + offsetY;
    const sceneHeight = sceneLoc.height;

    const contourGroundType = model.contourVerticesY
        ? ContourGroundType.VERTEX
        : ContourGroundType.CENTER_TILE;

    return {
        model,
        sceneHeight,
        lowDetail: isLowDetail(scene, level, tileX, tileY, locType, type),
        forceMerge: locType.contourGroundType > 1,

        sceneX,
        sceneZ,
        heightOffset: 0,
        level,
        planeCullLevel,
        contourGround: contourGroundType,
        priority,
        interactType: InteractType.LOC,
        interactId: id,
    };
}

export function createSceneLocEntity(
    locTypeLoader: LocTypeLoader,
    entity: LocEntity,
    sceneLoc: SceneLoc,
    offsetX: number,
    offsetY: number,
    level: number,
    priority: number,
    planeCullLevel?: number,
): SceneLocEntity {
    const id = getIdFromTag(sceneLoc.tag);
    const locType = locTypeLoader.load(id);

    const contourGroundType =
        locType.contourGroundType > 0 ? ContourGroundType.VERTEX : ContourGroundType.CENTER_TILE;

    const sceneX = sceneLoc.x + offsetX;
    const sceneZ = sceneLoc.y + offsetY;

    return {
        entity,
        sceneLoc,
        lowDetail: false,

        sceneX,
        sceneZ,
        heightOffset: 0,
        level,
        planeCullLevel,
        contourGround: contourGroundType,
        priority,
        interactType: InteractType.LOC,
        interactId: id,
    };
}

export function getSceneLocs(
    locTypeLoader: LocTypeLoader,
    scene: Scene,
    borderSize: number,
    maxLevel: number,
    coreSize: number = Scene.MAP_SQUARE_SIZE,
    worldTileOffset: number = borderSize,
): SceneLocs {
    const locs: SceneModel[] = [];
    const locEntities: SceneLocEntity[] = [];

    const startX = borderSize;
    const startY = borderSize;
    const endX = borderSize + coreSize;
    const endY = borderSize + coreSize;

    const sceneOffset = worldTileOffset * -128;

    const addTileLocs = (tile: SceneTile, tileLevel: number, tileX: number, tileY: number) => {
        const originalLevel = tile.originalLevel ?? tileLevel;
        const isReplicaTile = tile.skipRender === true;
        const roofVisible = maxLevel >= originalLevel;

        if (isReplicaTile) {
            // Only render replica tiles for higher-plane roofs when those planes are visible
            if (originalLevel <= 1 || !roofVisible) {
                return;
            }
        } else {
            const demoted = originalLevel > tileLevel;
            const hasReplicaAtOriginal = scene.getBridgeReplicaTile(originalLevel, tileX, tileY);
            if (demoted && originalLevel >= 2 && roofVisible && hasReplicaAtOriginal) {
                return;
            }
        }

        // For bridge-demoted tiles, use originalLevel for visibility checks
        const checkLevel = isReplicaTile ? originalLevel : tileLevel;
        const isAccessible = scene.isPlayerLevel(checkLevel, tileX, tileY, maxLevel);
        const startLocs = tile.locs.filter((loc) => loc.startX === tileX && loc.startY === tileY);
        const isBlocked = (scene.tileRenderFlags[tileLevel][tileX][tileY] & 0x10) !== 0;
        const hasForcedRenderAttachment =
            startLocs.some((loc) => {
                const locType = loc.flags & 0x3f;
                return isRoofLocModelType(locType) || loc.level > tileLevel;
            }) ||
            (isBlocked && startLocs.length > 0) ||
            !!tile.wall ||
            !!tile.wallDecoration ||
            !!tile.floorDecoration;

        // Ensure walls/decoration anchored to blocked planes still render even when the plane
        // is not strictly accessible (matches OSRS bridge parapet behavior).
        if (!isAccessible && !hasForcedRenderAttachment) {
            return;
        }

        const defaultPlaneCullLevel = getBridgeAdjustedPlane(scene, tile, tileLevel, tileX, tileY);

        const emitTileContents = (
            sourceTile: SceneTile,
            sourceLevel: number,
            planeCullLevel: number,
            startLocsOverride?: Loc[],
        ) => {
            // Use originalLevel for rendering bridge-demoted tiles
            const renderLevel = sourceTile.originalLevel ?? sourceLevel;
            const startLocList =
                startLocsOverride ??
                sourceTile.locs.filter((loc) => loc.startX === tileX && loc.startY === tileY);

            if (sourceTile.floorDecoration) {
                if (sourceTile.floorDecoration.entity instanceof Model) {
                    locs.push(
                        createSceneModel(
                            locTypeLoader,
                            scene,
                            sourceTile.floorDecoration.entity,
                            sourceTile.floorDecoration,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            tileX,
                            tileY,
                            3,
                            planeCullLevel,
                        ),
                    );
                } else if (sourceTile.floorDecoration.entity instanceof LocEntity) {
                    locEntities.push(
                        createSceneLocEntity(
                            locTypeLoader,
                            sourceTile.floorDecoration.entity,
                            sourceTile.floorDecoration,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            3,
                            planeCullLevel,
                        ),
                    );
                }
            }

            if (sourceTile.wall) {
                if (sourceTile.wall.entity0 instanceof Model) {
                    locs.push(
                        createSceneModel(
                            locTypeLoader,
                            scene,
                            sourceTile.wall.entity0,
                            sourceTile.wall,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            tileX,
                            tileY,
                            1,
                            planeCullLevel,
                        ),
                    );
                } else if (sourceTile.wall.entity0 instanceof LocEntity) {
                    locEntities.push(
                        createSceneLocEntity(
                            locTypeLoader,
                            sourceTile.wall.entity0,
                            sourceTile.wall,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            1,
                            planeCullLevel,
                        ),
                    );
                }

                if (sourceTile.wall.entity1 instanceof Model) {
                    locs.push(
                        createSceneModel(
                            locTypeLoader,
                            scene,
                            sourceTile.wall.entity1,
                            sourceTile.wall,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            tileX,
                            tileY,
                            1,
                            planeCullLevel,
                        ),
                    );
                } else if (sourceTile.wall.entity1 instanceof LocEntity) {
                    locEntities.push(
                        createSceneLocEntity(
                            locTypeLoader,
                            sourceTile.wall.entity1,
                            sourceTile.wall,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            1,
                            planeCullLevel,
                        ),
                    );
                }
            }

            if (sourceTile.wallDecoration) {
                const offsetX = sourceTile.wallDecoration.offsetX;
                const offsetY = sourceTile.wallDecoration.offsetY;
                if (sourceTile.wallDecoration.entity0 instanceof Model) {
                    locs.push(
                        createSceneModel(
                            locTypeLoader,
                            scene,
                            sourceTile.wallDecoration.entity0,
                            sourceTile.wallDecoration,
                            offsetX + sceneOffset,
                            offsetY + sceneOffset,
                            renderLevel,
                            tileX,
                            tileY,
                            10,
                            planeCullLevel,
                        ),
                    );
                } else if (sourceTile.wallDecoration.entity0 instanceof LocEntity) {
                    locEntities.push(
                        createSceneLocEntity(
                            locTypeLoader,
                            sourceTile.wallDecoration.entity0,
                            sourceTile.wallDecoration,
                            offsetX + sceneOffset,
                            offsetY + sceneOffset,
                            renderLevel,
                            10,
                            planeCullLevel,
                        ),
                    );
                }

                if (sourceTile.wallDecoration.entity1 instanceof Model) {
                    locs.push(
                        createSceneModel(
                            locTypeLoader,
                            scene,
                            sourceTile.wallDecoration.entity1,
                            sourceTile.wallDecoration,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            tileX,
                            tileY,
                            10,
                            planeCullLevel,
                        ),
                    );
                } else if (sourceTile.wallDecoration.entity1 instanceof LocEntity) {
                    locEntities.push(
                        createSceneLocEntity(
                            locTypeLoader,
                            sourceTile.wallDecoration.entity1,
                            sourceTile.wallDecoration,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            10,
                            planeCullLevel,
                        ),
                    );
                }
            }

            const originalLevel = sourceTile.originalLevel ?? renderLevel;

            for (const loc of startLocList) {
                const locModelType = loc.flags & 0x3f;
                const locPlaneCullLevel = getLocPlaneCullLevel(
                    planeCullLevel,
                    renderLevel,
                    originalLevel,
                    locModelType,
                );
                if (loc.entity instanceof Model) {
                    locs.push(
                        createSceneModel(
                            locTypeLoader,
                            scene,
                            loc.entity,
                            loc,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            tileX,
                            tileY,
                            1,
                            locPlaneCullLevel,
                        ),
                    );
                } else if (loc.entity instanceof LocEntity) {
                    locEntities.push(
                        createSceneLocEntity(
                            locTypeLoader,
                            loc.entity,
                            loc,
                            sceneOffset,
                            sceneOffset,
                            renderLevel,
                            1,
                            locPlaneCullLevel,
                        ),
                    );
                } else {
                    const tname = (loc.entity as any)?.constructor?.name ?? typeof loc.entity;
                    console.error(
                        `[SceneLocs] Unknown loc.entity type at ${tileX},${tileY}, level ${renderLevel}: ${tname}`,
                        loc.entity,
                    );
                }
            }
        };

        emitTileContents(tile, tileLevel, defaultPlaneCullLevel, startLocs);

        const linkedTile = getBridgeLinkedBelow(tile);
        if (linkedTile) {
            const linkedLevel = linkedTile.level | 0;
            const linkedStartLocs = linkedTile.locs.filter(
                (loc) => loc.startX === tileX && loc.startY === tileY,
            );
            const linkedBlocked = (scene.tileRenderFlags[linkedLevel][tileX][tileY] & 0x10) !== 0;
            const linkedHasRoofLikeLoc =
                linkedStartLocs.some((loc) => isRoofLocModelType(loc.flags & 0x3f)) ||
                (linkedBlocked && linkedStartLocs.length > 0);
            const linkedAccessible = scene.isPlayerLevel(linkedLevel, tileX, tileY, maxLevel);

            if (linkedAccessible || linkedHasRoofLikeLoc) {
                emitTileContents(
                    linkedTile,
                    linkedLevel,
                    getBridgeAdjustedPlane(scene, linkedTile, linkedLevel, tileX, tileY),
                    linkedStartLocs,
                );
            }
        }
    };

    for (let level = 0; level < scene.levels; level++) {
        for (let tileX = startX; tileX < endX; tileX++) {
            for (let tileY = startY; tileY < endY; tileY++) {
                const tile = scene.tiles[level][tileX][tileY];
                const replicaTile = scene.getBridgeReplicaTile(level, tileX, tileY);
                if (!tile && !replicaTile) {
                    continue;
                }

                if (tile) {
                    addTileLocs(tile, level, tileX, tileY);
                }
                if (replicaTile) {
                    addTileLocs(replicaTile, replicaTile.level ?? level, tileX, tileY);
                }
            }
        }
    }

    return {
        locs: locs,
        locEntities: locEntities,
    };
}

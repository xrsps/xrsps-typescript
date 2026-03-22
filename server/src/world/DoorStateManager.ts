/**
 * Door state management with OSRS 1:1 parity.
 * Handles single doors, double doors, collision updates, and auto-close tracking.
 */
import { CollisionFlag } from "../pathfinding/legacy/pathfinder/flag/CollisionFlag";
import { logger } from "../utils/logger";
import { DoorCollisionService, LocModelType, LocModelTypeValue } from "./DoorCollisionService";
import { DoorDefinitionLoader } from "./DoorDefinitionLoader";
import {
    DOOR_ACTION_KEYWORDS,
    DOOR_AUTO_CLOSE_TICKS,
    DOOR_NAME_KEYWORDS,
    DOOR_SOUND_CLOSE,
    DOOR_SOUND_OPEN,
    DoorPartnerResult,
    DoorTileState,
    DoorToggleParams,
    DoorToggleResult,
    GateDef,
    GateOpenStyle,
} from "./DoorDefinitions";
import { DoorRuntimeTileMappingStore } from "./DoorRuntimeTileMappingStore";

/** DoorToggleParams with all optional fields resolved to required */
type ResolvedDoorToggleParams = DoorToggleParams & {
    rotation: number;
    locType: number;
    currentTick: number;
};

interface LocInfo {
    x: number;
    y: number;
    level: number;
    locId: number;
    rotation: number;
    locType: number;
}

type DoorLocChangeObservation = {
    oldId: number;
    newId: number;
    level: number;
    oldTile: { x: number; y: number };
    newTile: { x: number; y: number };
};

type DoorLocLookupResult = {
    id: number;
    type: number;
    rotation: number;
};

type GateToggleTransform = {
    hingeTile: { x: number; y: number };
    extensionTile: { x: number; y: number };
    hingeRotation: number;
    extensionRotation: number;
};

/** Info needed to auto-close an open door */
type OpenDoorEntry = {
    key: string;
    closedX: number;
    closedY: number;
    currentX: number;
    currentY: number;
    level: number;
    closedId: number;
    openedId: number;
    rotation: number;
    locType: number;
    openedAtTick: number;
    /** Whether the door opened clockwise (true) or counter-clockwise (false). */
    openCw: boolean;
    partnerKey?: string; // For double doors
};

export class DoorStateManager {
    // Per-tile door state tracking
    private stateByTile: Map<string, DoorTileState> = new Map();

    // OSRS parity: Track open doors for auto-close after 300 seconds (500 ticks)
    private openDoors: Map<string, OpenDoorEntry> = new Map();

    constructor(
        private readonly locTypeLoader?: any,
        private readonly doorDefLoader?: DoorDefinitionLoader,
        private readonly doorCollisionService?: DoorCollisionService,
        private readonly collisionFlagGetter?: (
            x: number,
            y: number,
            level: number,
        ) => number | undefined,
        private readonly runtimeTileMappings?: DoorRuntimeTileMappingStore,
        private readonly locLookup?: (
            x: number,
            y: number,
            level: number,
            idHint?: number,
        ) => DoorLocLookupResult | undefined,
    ) {}

    /**
     * Toggle a door and return the result including collision updates.
     * Uses explicit door definitions and runtime tile mappings only.
     */
    toggleDoor(params: DoorToggleParams): DoorToggleResult | undefined {
        const currentId = params.currentId;
        const key = this.makeKey(params.x, params.y, params.level);

        // Apply defaults for optional parameters
        const fullParams: ResolvedDoorToggleParams = {
            ...params,
            rotation: this.resolveDoorRotation(
                params.x,
                params.y,
                params.level,
                params.currentId,
                key,
                params.rotation,
            ),
            locType: this.resolveDoorLocType(
                params.x,
                params.y,
                params.level,
                params.currentId,
                key,
                params.locType,
            ),
            currentTick: params.currentTick ?? 0,
        };

        // Gates are a distinct mechanic (hinge + extension), not regular double doors.
        if (this.doorDefLoader) {
            const gateDef = this.doorDefLoader.getGateDef(currentId);
            if (gateDef) {
                return this.handleGate(fullParams, gateDef);
            }
        }

        // Check for double door first
        if (this.doorDefLoader) {
            const doubleDef = this.doorDefLoader.getDoubleDoorDef(currentId);
            if (doubleDef) {
                return this.handleDoubleDoor(fullParams, doubleDef, key);
            }
        }

        // Try explicit single door definition
        if (this.doorDefLoader) {
            const singleDef = this.doorDefLoader.getSingleDoorPair(currentId);
            if (singleDef) {
                return this.handleSingleDoorExplicit(fullParams, singleDef, key);
            }
        }

        const runtimeSingleDef = this.runtimeTileMappings?.getPairForTile(
            params.level,
            params.x,
            params.y,
            currentId,
        );
        if (runtimeSingleDef) {
            return this.handleSingleDoorExplicit(fullParams, runtimeSingleDef, key);
        }

        return undefined;
    }

    toggleExplicitGate(
        params: DoorToggleParams & {
            gateDef: GateDef;
        },
    ): DoorToggleResult | undefined {
        const key = this.makeKey(params.x, params.y, params.level);
        const { gateDef, ...toggleParams } = params;
        const fullParams: ResolvedDoorToggleParams = {
            ...toggleParams,
            rotation: this.resolveDoorRotation(
                params.x,
                params.y,
                params.level,
                params.currentId,
                key,
                params.rotation,
            ),
            locType: this.resolveDoorLocType(
                params.x,
                params.y,
                params.level,
                params.currentId,
                key,
                params.locType,
            ),
            currentTick: params.currentTick ?? 0,
        };
        return this.handleGate(fullParams, gateDef);
    }

    /**
     * Observe a world loc change and capture runtime tile-scoped door mappings.
     * This lets ambiguous door IDs become deterministic over time from real gameplay transitions.
     */
    observeLocChange(change: DoorLocChangeObservation): void {
        if (!this.runtimeTileMappings) {
            return;
        }

        const oldId = change.oldId;
        const newId = change.newId;
        if (oldId <= 0 || newId <= 0 || oldId === newId) {
            return;
        }

        const normalized = this.classifyObservedDoorPair(oldId, newId);
        if (!normalized) {
            return;
        }

        if (this.isKnownStaticPair(normalized.closed, normalized.opened)) {
            // Only persist runtime capture for pairs not already in deterministic static catalogs.
            return;
        }

        const level = change.level;
        const oldTile = {
            x: change.oldTile.x,
            y: change.oldTile.y,
        };
        const newTile = {
            x: change.newTile.x,
            y: change.newTile.y,
        };

        this.runtimeTileMappings.recordObservedPair(
            level,
            oldTile.x,
            oldTile.y,
            normalized.closed,
            normalized.opened,
        );
        this.runtimeTileMappings.recordObservedPair(
            level,
            newTile.x,
            newTile.y,
            normalized.closed,
            normalized.opened,
        );
    }

    /**
     * Handle a gate toggle (hinge + extension pieces move as one object).
     */
    private handleGate(
        params: ResolvedDoorToggleParams,
        gateDef: GateDef,
    ): DoorToggleResult | undefined {
        const { x, y, level, currentId, rotation, locType } = params;

        const isClosed =
            currentId === gateDef.closed.hinge || currentId === gateDef.closed.extension;
        const isHinge = currentId === gateDef.closed.hinge || currentId === gateDef.opened.hinge;

        const oldHingeId = isClosed ? gateDef.closed.hinge : gateDef.opened.hinge;
        const oldExtensionId = isClosed ? gateDef.closed.extension : gateDef.opened.extension;
        const newHingeId = isClosed ? gateDef.opened.hinge : gateDef.closed.hinge;
        const newExtensionId = isClosed ? gateDef.opened.extension : gateDef.closed.extension;
        const oldPartnerId = isHinge ? oldExtensionId : oldHingeId;

        const partnerLoc = this.findGatePartner(x, y, level, oldPartnerId, rotation);
        if (!partnerLoc) {
            return undefined;
        }

        const partnerKey = this.makeKey(partnerLoc.x, partnerLoc.y, level);
        const partnerLocType = this.resolveDoorLocType(
            partnerLoc.x,
            partnerLoc.y,
            level,
            oldPartnerId,
            partnerKey,
            partnerLoc.locType,
        );

        const hingeOldLoc: LocInfo = isHinge
            ? { x, y, level, locId: oldHingeId, rotation, locType }
            : {
                  x: partnerLoc.x,
                  y: partnerLoc.y,
                  level,
                  locId: oldHingeId,
                  rotation: partnerLoc.rotation,
                  locType: partnerLocType,
              };
        const extensionOldLoc: LocInfo = isHinge
            ? {
                  x: partnerLoc.x,
                  y: partnerLoc.y,
                  level,
                  locId: oldExtensionId,
                  rotation: partnerLoc.rotation,
                  locType: partnerLocType,
              }
            : { x, y, level, locId: oldExtensionId, rotation, locType };

        const gateOpenStyle = this.resolveGateOpenStyle(gateDef);
        const transform =
            gateOpenStyle === "center"
                ? isClosed
                    ? this.computeGateCenterOpenTransform(hingeOldLoc, extensionOldLoc)
                    : this.computeGateCenterCloseTransform(hingeOldLoc, extensionOldLoc)
                : isClosed
                ? this.computeGateHingeOpenTransform(
                      hingeOldLoc.x,
                      hingeOldLoc.y,
                      hingeOldLoc.rotation,
                  )
                : this.computeGateHingeCloseTransform(
                      hingeOldLoc.x,
                      hingeOldLoc.y,
                      hingeOldLoc.rotation,
                  );

        if (!transform) {
            return undefined;
        }

        const hingeNewLoc: LocInfo = {
            x: transform.hingeTile.x,
            y: transform.hingeTile.y,
            level,
            locId: newHingeId,
            rotation: transform.hingeRotation,
            locType: hingeOldLoc.locType,
        };
        const extensionNewLoc: LocInfo = {
            x: transform.extensionTile.x,
            y: transform.extensionTile.y,
            level,
            locId: newExtensionId,
            rotation: transform.extensionRotation,
            locType: extensionOldLoc.locType,
        };

        this.transitionLocCollision(hingeOldLoc, hingeNewLoc);
        this.transitionLocCollision(extensionOldLoc, extensionNewLoc);

        const hingeNewKey = this.makeKey(transform.hingeTile.x, transform.hingeTile.y, level);
        const extensionNewKey = this.makeKey(
            transform.extensionTile.x,
            transform.extensionTile.y,
            level,
        );
        this.stateByTile.delete(this.makeKey(hingeOldLoc.x, hingeOldLoc.y, level));
        this.stateByTile.delete(this.makeKey(extensionOldLoc.x, extensionOldLoc.y, level));
        this.stateByTile.set(hingeNewKey, {
            closedId: gateDef.closed.hinge,
            openedId: gateDef.opened.hinge,
            currentId: newHingeId,
            rotation: transform.hingeRotation,
            locType: hingeOldLoc.locType,
        });
        this.stateByTile.set(extensionNewKey, {
            closedId: gateDef.closed.extension,
            openedId: gateDef.opened.extension,
            currentId: newExtensionId,
            rotation: transform.extensionRotation,
            locType: extensionOldLoc.locType,
        });

        if (isHinge) {
            return {
                success: true,
                newLocId: newHingeId,
                oldRotation: hingeOldLoc.rotation,
                newTile: transform.hingeTile,
                newRotation: transform.hingeRotation,
                soundId: isClosed ? DOOR_SOUND_OPEN : DOOR_SOUND_CLOSE,
                partnerResult: {
                    oldLocId: oldExtensionId,
                    newLocId: newExtensionId,
                    oldTile: { x: extensionOldLoc.x, y: extensionOldLoc.y },
                    newTile: transform.extensionTile,
                    oldRotation: extensionOldLoc.rotation,
                    newRotation: transform.extensionRotation,
                },
            };
        }

        return {
            success: true,
            newLocId: newExtensionId,
            oldRotation: extensionOldLoc.rotation,
            newTile: transform.extensionTile,
            newRotation: transform.extensionRotation,
            soundId: isClosed ? DOOR_SOUND_OPEN : DOOR_SOUND_CLOSE,
            partnerResult: {
                oldLocId: oldHingeId,
                newLocId: newHingeId,
                oldTile: { x: hingeOldLoc.x, y: hingeOldLoc.y },
                newTile: transform.hingeTile,
                oldRotation: hingeOldLoc.rotation,
                newRotation: transform.hingeRotation,
            },
        };
    }

    /**
     * Handle a double door toggle (both left and right halves move together).
     */
    private handleDoubleDoor(
        params: ResolvedDoorToggleParams,
        doubleDef: {
            closed: { left: number; right: number };
            opened: { left: number; right: number };
        },
        key: string,
    ): DoorToggleResult | undefined {
        const { x, y, level, currentId, rotation, locType, currentTick } = params;

        // Determine if currently open or closed
        const isClosed =
            currentId === doubleDef.closed.left || currentId === doubleDef.closed.right;
        const isLeft = currentId === doubleDef.closed.left || currentId === doubleDef.opened.left;

        // Calculate new IDs
        const newMainId = isClosed
            ? isLeft
                ? doubleDef.opened.left
                : doubleDef.opened.right
            : isLeft
            ? doubleDef.closed.left
            : doubleDef.closed.right;

        const newPartnerId = isClosed
            ? isLeft
                ? doubleDef.opened.right
                : doubleDef.opened.left
            : isLeft
            ? doubleDef.closed.right
            : doubleDef.closed.left;

        const oldPartnerId = isClosed
            ? isLeft
                ? doubleDef.closed.right
                : doubleDef.closed.left
            : isLeft
            ? doubleDef.opened.right
            : doubleDef.opened.left;

        // Find partner door location (adjacent tile)
        const partnerLoc = this.findDoubleDoorPartner(x, y, level, oldPartnerId, rotation);
        if (!partnerLoc) {
            return undefined;
        }

        // RS parity: double-door leaves rotate in opposite directions based on left/right side.
        const newRotation = this.getDoubleDoorLeafRotationAfterToggle(rotation, isClosed, isLeft);

        const mainNewTile = isClosed ? this.getOpenedTilePosition(x, y, rotation) : { x, y }; // Closing returns to original position
        const mainNewKey = this.makeKey(mainNewTile.x, mainNewTile.y, level);
        const mainOldLoc: LocInfo = { x, y, level, locId: currentId, rotation, locType };
        const mainNewLoc: LocInfo = {
            x: mainNewTile.x,
            y: mainNewTile.y,
            level,
            locId: newMainId,
            rotation: newRotation,
            locType,
        };

        this.transitionLocCollision(mainOldLoc, mainNewLoc);

        // Build partner result if found
        let partnerResult: DoorPartnerResult | undefined;
        let partnerLocType = partnerLoc?.locType ?? LocModelType.WALL;
        let partnerNewKey: string | undefined;
        if (partnerLoc) {
            const partnerKey = this.makeKey(partnerLoc.x, partnerLoc.y, level);
            partnerLocType = this.resolveDoorLocType(
                partnerLoc.x,
                partnerLoc.y,
                level,
                oldPartnerId,
                partnerKey,
                partnerLoc.locType,
            );
            const partnerIsLeft = !isLeft;
            const partnerNewRotation = this.getDoubleDoorLeafRotationAfterToggle(
                partnerLoc.rotation,
                isClosed,
                partnerIsLeft,
            );

            const partnerNewTile = isClosed
                ? this.getOpenedTilePosition(partnerLoc.x, partnerLoc.y, partnerLoc.rotation)
                : { x: partnerLoc.x, y: partnerLoc.y };
            partnerNewKey = this.makeKey(partnerNewTile.x, partnerNewTile.y, level);

            this.transitionLocCollision(
                {
                    x: partnerLoc.x,
                    y: partnerLoc.y,
                    level,
                    locId: oldPartnerId,
                    rotation: partnerLoc.rotation,
                    locType: partnerLocType,
                },
                {
                    x: partnerNewTile.x,
                    y: partnerNewTile.y,
                    level,
                    locId: newPartnerId,
                    rotation: partnerNewRotation,
                    locType: partnerLocType,
                },
            );

            partnerResult = {
                oldLocId: oldPartnerId,
                newLocId: newPartnerId,
                oldTile: { x: partnerLoc.x, y: partnerLoc.y },
                newTile: partnerNewTile,
                oldRotation: partnerLoc.rotation,
                newRotation: partnerNewRotation,
            };
        }

        // Persist state for both door tiles so future toggles can resolve rotation/loc type.
        this.stateByTile.delete(key);
        this.stateByTile.set(mainNewKey, {
            closedId: isLeft ? doubleDef.closed.left : doubleDef.closed.right,
            openedId: isLeft ? doubleDef.opened.left : doubleDef.opened.right,
            currentId: newMainId,
            rotation: newRotation,
            locType,
        });
        if (partnerLoc && partnerResult) {
            const partnerKey = this.makeKey(partnerLoc.x, partnerLoc.y, level);
            this.stateByTile.delete(partnerKey);
            this.stateByTile.set(partnerNewKey ?? partnerKey, {
                closedId: isLeft ? doubleDef.closed.right : doubleDef.closed.left,
                openedId: isLeft ? doubleDef.opened.right : doubleDef.opened.left,
                currentId: newPartnerId,
                rotation: partnerResult.newRotation,
                locType: partnerLocType,
            });
        }

        // Track open/closed state for auto-close
        if (isClosed) {
            // Door was opened - track for auto-close
            const openPartnerKey = partnerResult ? partnerNewKey : undefined;
            this.trackOpenDoor(
                mainNewKey,
                x,
                y,
                mainNewTile.x,
                mainNewTile.y,
                level,
                currentId,
                newMainId,
                newRotation,
                locType,
                currentTick,
                true,
                openPartnerKey,
            );
            // Track partner door too
            if (partnerLoc && partnerResult) {
                this.trackOpenDoor(
                    openPartnerKey!,
                    partnerLoc.x,
                    partnerLoc.y,
                    partnerResult.newTile.x,
                    partnerResult.newTile.y,
                    level,
                    oldPartnerId,
                    newPartnerId,
                    partnerResult.newRotation,
                    partnerLocType,
                    currentTick,
                    true,
                    mainNewKey,
                );
            }
        } else {
            // Door was closed - untrack
            this.untrackOpenDoor(key);
            if (partnerLoc) {
                this.untrackOpenDoor(this.makeKey(partnerLoc.x, partnerLoc.y, level));
            }
        }

        return {
            success: true,
            newLocId: newMainId,
            oldRotation: rotation,
            newTile: mainNewTile,
            newRotation,
            soundId: isClosed ? DOOR_SOUND_OPEN : DOOR_SOUND_CLOSE,
            partnerResult,
        };
    }

    /**
     * Handle a single door toggle using explicit definition.
     */
    private handleSingleDoorExplicit(
        params: ResolvedDoorToggleParams,
        singleDef: { closed: number; opened: number; openDir?: "cw" | "ccw" },
        key: string,
    ): DoorToggleResult {
        const { x, y, level, currentId, rotation, locType, currentTick } = params;

        const isClosed = currentId === singleDef.closed;
        const newLocId = isClosed ? singleDef.opened : singleDef.closed;
        const trackedOpen = !isClosed
            ? this.findTrackedOpenDoorEntry(x, y, level, currentId)
            : undefined;

        // OSRS parity: doors can swing clockwise (default) or counter-clockwise.
        const openCw = singleDef.openDir !== "ccw";
        const newRotation = isClosed
            ? openCw ? (rotation + 1) & 3 : (rotation - 1 + 4) & 3
            : openCw ? (rotation - 1 + 4) & 3 : (rotation + 1) & 3;

        const newTile = isClosed
            ? this.getOpenedTilePosition(x, y, rotation, openCw)
            : trackedOpen
            ? { x: trackedOpen.entry.closedX, y: trackedOpen.entry.closedY }
            : this.getClosedTilePositionFromOpened(x, y, rotation, openCw);
        const newKey = this.makeKey(newTile.x, newTile.y, level);
        const oldLoc: LocInfo = { x, y, level, locId: currentId, rotation, locType };
        const newLoc: LocInfo = {
            x: newTile.x,
            y: newTile.y,
            level,
            locId: newLocId,
            rotation: newRotation,
            locType,
        };

        this.transitionLocCollision(oldLoc, newLoc);

        // Track current tile state for future rotation/loc-type resolution.
        this.stateByTile.delete(key);
        this.stateByTile.set(newKey, {
            closedId: singleDef.closed,
            openedId: singleDef.opened,
            currentId: newLocId,
            rotation: newRotation,
            locType,
        });

        // Track open/closed state for auto-close
        if (isClosed) {
            // Door was opened - track for auto-close
            this.trackOpenDoor(
                newKey,
                x,
                y,
                newTile.x,
                newTile.y,
                level,
                singleDef.closed,
                singleDef.opened,
                newRotation,
                locType,
                currentTick,
                openCw,
            );
        } else {
            // Door was closed - untrack
            this.untrackOpenDoor(trackedOpen?.key ?? key);
        }

        return {
            success: true,
            newLocId,
            oldRotation: rotation,
            newTile,
            newRotation,
            soundId: isClosed ? DOOR_SOUND_OPEN : DOOR_SOUND_CLOSE,
        };
    }

    private removeLocCollision(loc: LocInfo): void {
        if (!this.doorCollisionService) {
            return;
        }
        this.doorCollisionService.removeWallCollision(
            loc.x,
            loc.y,
            loc.level,
            loc.rotation,
            loc.locType as LocModelTypeValue,
            this.blocksProjectile(loc.locId),
        );
    }

    private addLocCollision(loc: LocInfo): void {
        if (!this.doorCollisionService) {
            return;
        }
        this.doorCollisionService.addWallCollision(
            loc.x,
            loc.y,
            loc.level,
            loc.rotation,
            loc.locType as LocModelTypeValue,
            this.blocksProjectile(loc.locId),
        );
    }

    private transitionLocCollision(oldLoc: LocInfo, newLoc: LocInfo): void {
        this.removeLocCollision(oldLoc);
        this.addLocCollision(newLoc);
    }

    /**
     * Calculate the new tile position when a door opens.
     * Doors shift in the direction they're facing when opened.
     */
    private getOpenedTilePosition(
        x: number,
        y: number,
        rotation: number,
        openCw: boolean = true,
    ): { x: number; y: number } {
        if (openCw) {
            switch (rotation & 3) {
                case 0: return { x: x - 1, y };
                case 1: return { x, y: y + 1 };
                case 2: return { x: x + 1, y };
                case 3: return { x, y: y - 1 };
                default: return { x, y };
            }
        } else {
            switch (rotation & 3) {
                case 0: return { x: x + 1, y };
                case 1: return { x, y: y + 1 };   // ← changed
                case 2: return { x: x - 1, y };
                case 3: return { x, y: y + 1 };
                default: return { x, y };
            }
        }
    }

    /**
     * Infer closed tile from an opened single-door tile using current opened rotation.
     * Used when a door starts opened in map data and has no runtime tracking entry yet.
     */
    private getClosedTilePositionFromOpened(
        x: number,
        y: number,
        openedRotation: number,
        openCw: boolean = true,
    ): { x: number; y: number } {
        if (openCw) {
            const closedRotation = (openedRotation - 1 + 4) & 3;
            switch (closedRotation) {
                case 0: return { x: x + 1, y };
                case 1: return { x, y: y - 1 };
                case 2: return { x: x - 1, y };
                case 3: return { x, y: y + 1 };
                default: return { x, y };
            }
        } else {
            const closedRotation = (openedRotation + 1) & 3;
            switch (closedRotation) {
                case 0: return { x: x - 1, y };
                case 1: return { x, y: y + 1 };
                case 2: return { x, y: y - 1 };   // ← changed
                case 3: return { x, y: y - 1 };
                default: return { x, y };
            }
        }
    }

    private resolveGateOpenStyle(gateDef: GateDef): GateOpenStyle {
        return gateDef.openStyle === "center" ? "center" : "hinge";
    }

    private computeGateHingeOpenTransform(
        hingeX: number,
        hingeY: number,
        rotation: number,
    ): GateToggleTransform | undefined {
        switch (rotation & 0x3) {
            case 0:
                return {
                    hingeTile: { x: hingeX - 1, y: hingeY },
                    extensionTile: { x: hingeX - 2, y: hingeY },
                    hingeRotation: 3,
                    extensionRotation: 3,
                };
            case 1:
                return {
                    hingeTile: { x: hingeX, y: hingeY + 1 },
                    extensionTile: { x: hingeX, y: hingeY + 2 },
                    hingeRotation: 0,
                    extensionRotation: 0,
                };
            case 2:
                return {
                    hingeTile: { x: hingeX + 1, y: hingeY },
                    extensionTile: { x: hingeX + 2, y: hingeY },
                    hingeRotation: 1,
                    extensionRotation: 1,
                };
            case 3:
                return {
                    hingeTile: { x: hingeX, y: hingeY - 1 },
                    extensionTile: { x: hingeX, y: hingeY - 2 },
                    hingeRotation: 2,
                    extensionRotation: 2,
                };
            default:
                return undefined;
        }
    }

    private computeGateHingeCloseTransform(
        hingeX: number,
        hingeY: number,
        rotation: number,
    ): GateToggleTransform | undefined {
        switch (rotation & 0x3) {
            case 0:
                return {
                    hingeTile: { x: hingeX, y: hingeY - 1 },
                    extensionTile: { x: hingeX + 1, y: hingeY - 1 },
                    hingeRotation: 1,
                    extensionRotation: 1,
                };
            case 1:
                return {
                    hingeTile: { x: hingeX - 1, y: hingeY },
                    extensionTile: { x: hingeX - 1, y: hingeY - 1 },
                    hingeRotation: 2,
                    extensionRotation: 2,
                };
            case 2:
                return {
                    hingeTile: { x: hingeX, y: hingeY + 1 },
                    extensionTile: { x: hingeX - 1, y: hingeY + 1 },
                    hingeRotation: 3,
                    extensionRotation: 3,
                };
            case 3:
                return {
                    hingeTile: { x: hingeX + 1, y: hingeY },
                    extensionTile: { x: hingeX + 1, y: hingeY + 1 },
                    hingeRotation: 0,
                    extensionRotation: 0,
                };
            default:
                return undefined;
        }
    }

    private computeGateCenterOpenTransform(
        hinge: LocInfo,
        extension: LocInfo,
    ): GateToggleTransform | undefined {
        const closedRotation = hinge.rotation & 0x3;
        return {
            hingeTile: this.getOpenedTilePosition(hinge.x, hinge.y, closedRotation),
            extensionTile: this.getOpenedTilePosition(extension.x, extension.y, closedRotation),
            hingeRotation: (closedRotation - 1 + 4) & 0x3,
            extensionRotation: (closedRotation + 1) & 0x3,
        };
    }

    private computeGateCenterCloseTransform(
        hinge: LocInfo,
        extension: LocInfo,
    ): GateToggleTransform | undefined {
        const closedRotation = (hinge.rotation + 1) & 0x3;
        return {
            hingeTile: this.getCenterGateClosedTilePosition(hinge.x, hinge.y, closedRotation),
            extensionTile: this.getCenterGateClosedTilePosition(
                extension.x,
                extension.y,
                closedRotation,
            ),
            hingeRotation: closedRotation,
            extensionRotation: closedRotation,
        };
    }

    private getCenterGateClosedTilePosition(
        x: number,
        y: number,
        closedRotation: number,
    ): { x: number; y: number } {
        switch (closedRotation & 0x3) {
            case 0:
                return { x: x + 1, y };
            case 1:
                return { x, y: y - 1 };
            case 2:
                return { x: x - 1, y };
            case 3:
                return { x, y: y + 1 };
            default:
                return { x, y };
        }
    }

    private getDoubleDoorLeafRotationAfterToggle(
        currentRotation: number,
        opening: boolean,
        isLeftLeaf: boolean,
    ): number {
        const delta = opening ? (isLeftLeaf ? -1 : 1) : isLeftLeaf ? 1 : -1;
        return (currentRotation + delta + 4) & 3;
    }

    private findGatePartner(
        x: number,
        y: number,
        level: number,
        partnerId: number,
        rotation: number,
    ): LocInfo | undefined {
        const offsets = this.getGatePartnerSearchOffsets(rotation);

        for (const [dx, dy] of offsets) {
            const px = x + dx;
            const py = y + dy;
            const partnerKey = this.makeKey(px, py, level);
            const state = this.stateByTile.get(partnerKey);
            if (state) {
                const matchesId =
                    state.currentId === partnerId ||
                    state.closedId === partnerId ||
                    state.openedId === partnerId;
                if (matchesId) {
                    return {
                        x: px,
                        y: py,
                        level,
                        locId: state.currentId,
                        rotation: state.rotation & 0x3,
                        locType: state.locType,
                    };
                }
            }

            const mapLoc = this.locLookup?.(px, py, level, partnerId);
            if (mapLoc) {
                return {
                    x: px,
                    y: py,
                    level: level,
                    locId: mapLoc.id,
                    rotation: mapLoc.rotation & 0x3,
                    locType: mapLoc.type,
                };
            }
        }

        return undefined;
    }

    private getGatePartnerSearchOffsets(rotation: number): [number, number][] {
        const cardinal = this.getPartnerSearchOffsets(rotation);
        const diagonal: [number, number][] = [
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
        ];
        return [...cardinal, ...diagonal];
    }

    /**
     * Find the partner door for a double door set.
     * Searches adjacent tiles for a door with the matching ID.
     */
    private findDoubleDoorPartner(
        x: number,
        y: number,
        level: number,
        partnerId: number,
        rotation: number,
    ): LocInfo | undefined {
        const searchOffsets = this.getPartnerSearchOffsets(rotation);

        for (const [dx, dy] of searchOffsets) {
            const px = x + dx;
            const py = y + dy;
            const partnerKey = this.makeKey(px, py, level);
            const state = this.stateByTile.get(partnerKey);
            if (state) {
                const matchesId =
                    state.currentId === partnerId ||
                    state.closedId === partnerId ||
                    state.openedId === partnerId;
                if (matchesId) {
                    return {
                        x: px,
                        y: py,
                        level,
                        locId: state.currentId,
                        rotation: state.rotation & 0x3,
                        locType: state.locType,
                    };
                }
            }

            const mapLoc = this.locLookup?.(px, py, level, partnerId);
            if (mapLoc) {
                return {
                    x: px,
                    y: py,
                    level: level,
                    locId: mapLoc.id,
                    rotation: mapLoc.rotation & 0x3,
                    locType: mapLoc.type,
                };
            }
        }

        return undefined;
    }

    /**
     * Get search offsets for finding double door partner.
     */
    private getPartnerSearchOffsets(rotation: number): [number, number][] {
        switch (rotation & 3) {
            case 0: // West-facing: partner is north or south
            case 2: // East-facing: partner is north or south
                return [
                    [0, 1],
                    [0, -1],
                    [1, 0],
                    [-1, 0],
                ];
            case 1: // North-facing: partner is east or west
            case 3: // South-facing: partner is east or west
                return [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ];
            default:
                return [
                    [0, 1],
                    [0, -1],
                    [1, 0],
                    [-1, 0],
                ];
        }
    }

    /**
     * Check if a loc blocks projectiles (for collision updates).
     */
    private blocksProjectile(locId: number): boolean {
        const loc = this.safeLoadLoc(locId) as { blocksProjectile?: boolean } | undefined;
        // Cache object definitions expose `blocksProjectile` (plural).
        // If the property is absent, default to blocking to preserve wall-door behavior.
        return loc?.blocksProjectile !== false;
    }

    private resolveDoorRotation(
        x: number,
        y: number,
        level: number,
        currentId: number,
        key: string,
        fallback?: number,
    ): number {
        if (fallback !== undefined && Number.isFinite(fallback)) {
            return fallback & 0x3;
        }

        const state = this.stateByTile.get(key);
        if (state) {
            return state.rotation & 0x3;
        }

        const tracked = this.openDoors.get(key);
        if (tracked) {
            if (tracked.openedId === currentId) {
                return tracked.rotation & 0x3;
            }
            if (tracked.closedId === currentId) {
                return (tracked.rotation - 1 + 4) & 0x3;
            }
        }

        const mapLoc = this.locLookup?.(x, y, level, currentId);
        if (mapLoc) {
            return mapLoc.rotation & 0x3;
        }

        const inferred = this.inferDoorRotationFromCollision(x, y, level);
        if (inferred !== undefined) {
            return inferred & 0x3;
        }

        return 0;
    }

    private resolveDoorLocType(
        x: number,
        y: number,
        level: number,
        currentId: number,
        key: string,
        fallback?: number,
    ): number {
        if (fallback !== undefined && Number.isFinite(fallback)) {
            return fallback;
        }

        const state = this.stateByTile.get(key);
        if (state) {
            return state.locType;
        }

        const tracked = this.openDoors.get(key);
        if (tracked) {
            return tracked.locType;
        }

        const mapLoc = this.locLookup?.(x, y, level, currentId);
        if (mapLoc && this.isSupportedDoorLocType(mapLoc.type)) {
            return mapLoc.type;
        }

        const loc = this.safeLoadLoc(currentId);
        const types = Array.isArray(loc?.types) ? loc.types : undefined;
        if (types && types.length > 0) {
            for (const rawType of types) {
                const type = rawType;
                if (this.isSupportedDoorLocType(type)) {
                    return type;
                }
            }
        }

        return LocModelType.WALL;
    }

    private isSupportedDoorLocType(type: number): boolean {
        switch (type) {
            case LocModelType.WALL:
            case LocModelType.WALL_DIAGONAL:
            case LocModelType.WALL_CORNER:
            case LocModelType.WALL_TRI_CORNER:
            case LocModelType.WALL_RECT_CORNER:
                return true;
            default:
                return false;
        }
    }

    private resolveDoorClipMask(currentId: number): number {
        const loc = this.safeLoadLoc(currentId) as { clipMask?: number } | undefined;
        const rawMask = loc?.clipMask ?? 0;
        if (!Number.isFinite(rawMask)) {
            return 0;
        }
        return rawMask & 0xf;
    }

    private rotateDoorClipMask(mask: number, rotation: number): number {
        const normalizedMask = mask & 0xf;
        const rot = rotation & 0x3;
        return (
            (((normalizedMask << rot) & 0xf) | ((normalizedMask >>> ((4 - rot) & 0x3)) & 0xf)) & 0xf
        );
    }

    private inferDoorRotationFromCollision(
        x: number,
        y: number,
        level: number,
    ): number | undefined {
        if (!this.collisionFlagGetter) {
            return undefined;
        }

        const self = this.collisionFlagGetter(x, y, level);
        if (self === undefined) {
            return undefined;
        }

        const west = this.collisionFlagGetter(x - 1, y, level) ?? 0;
        const east = this.collisionFlagGetter(x + 1, y, level) ?? 0;
        const north = this.collisionFlagGetter(x, y + 1, level) ?? 0;
        const south = this.collisionFlagGetter(x, y - 1, level) ?? 0;

        const candidates: number[] = [];
        if (
            this.hasWallEdge(
                self,
                west,
                CollisionFlag.WALL_WEST,
                CollisionFlag.WALL_EAST,
                CollisionFlag.WALL_WEST_ROUTE_BLOCKER,
                CollisionFlag.WALL_EAST_ROUTE_BLOCKER,
            )
        ) {
            candidates.push(0);
        }
        if (
            this.hasWallEdge(
                self,
                north,
                CollisionFlag.WALL_NORTH,
                CollisionFlag.WALL_SOUTH,
                CollisionFlag.WALL_NORTH_ROUTE_BLOCKER,
                CollisionFlag.WALL_SOUTH_ROUTE_BLOCKER,
            )
        ) {
            candidates.push(1);
        }
        if (
            this.hasWallEdge(
                self,
                east,
                CollisionFlag.WALL_EAST,
                CollisionFlag.WALL_WEST,
                CollisionFlag.WALL_EAST_ROUTE_BLOCKER,
                CollisionFlag.WALL_WEST_ROUTE_BLOCKER,
            )
        ) {
            candidates.push(2);
        }
        if (
            this.hasWallEdge(
                self,
                south,
                CollisionFlag.WALL_SOUTH,
                CollisionFlag.WALL_NORTH,
                CollisionFlag.WALL_SOUTH_ROUTE_BLOCKER,
                CollisionFlag.WALL_NORTH_ROUTE_BLOCKER,
            )
        ) {
            candidates.push(3);
        }

        if (candidates.length === 1) {
            return candidates[0];
        }

        const selfOnly: number[] = [];
        if ((self & (CollisionFlag.WALL_WEST | CollisionFlag.WALL_WEST_ROUTE_BLOCKER)) !== 0) {
            selfOnly.push(0);
        }
        if ((self & (CollisionFlag.WALL_NORTH | CollisionFlag.WALL_NORTH_ROUTE_BLOCKER)) !== 0) {
            selfOnly.push(1);
        }
        if ((self & (CollisionFlag.WALL_EAST | CollisionFlag.WALL_EAST_ROUTE_BLOCKER)) !== 0) {
            selfOnly.push(2);
        }
        if ((self & (CollisionFlag.WALL_SOUTH | CollisionFlag.WALL_SOUTH_ROUTE_BLOCKER)) !== 0) {
            selfOnly.push(3);
        }

        if (selfOnly.length === 1) {
            return selfOnly[0];
        }

        return candidates.length > 0 ? candidates[0] : undefined;
    }

    private hasWallEdge(
        selfFlags: number,
        neighborFlags: number,
        selfWallMask: number,
        neighborWallMask: number,
        selfRouteMask: number,
        neighborRouteMask: number,
    ): boolean {
        return (
            (selfFlags & (selfWallMask | selfRouteMask)) !== 0 ||
            (neighborFlags & (neighborWallMask | neighborRouteMask)) !== 0
        );
    }

    // === Helper Methods ===

    isDoorAction(action?: string): boolean {
        if (!action) return false;
        const lower = action.toLowerCase();
        return DOOR_ACTION_KEYWORDS.includes(lower) || lower.startsWith("pay-toll(");
    }

    getDoorBlockedDirections(
        x: number,
        y: number,
        level: number,
        currentId: number,
    ): { north: boolean; east: boolean; south: boolean; west: boolean } | undefined {
        const key = this.makeKey(x, y, level);
        const rotation = this.resolveDoorRotation(x, y, level, currentId, key) & 0x3;
        const locType = this.resolveDoorLocType(x, y, level, currentId, key);
        const blocked = {
            north: false,
            east: false,
            south: false,
            west: false,
        };

        // OSRS wall-door interaction: one side is non-interactable based on orientation.
        switch (rotation) {
            case 0:
                blocked.east = true;
                break;
            case 1:
                blocked.south = true;
                break;
            case 2:
                blocked.west = true;
                break;
            case 3:
                blocked.north = true;
                break;
            default:
                break;
        }

        // Diagonal walls block one additional side to avoid invalid overlap interactions.
        if (locType === LocModelType.WALL_DIAGONAL) {
            switch (rotation) {
                case 0:
                    blocked.north = true;
                    break;
                case 1:
                    blocked.east = true;
                    break;
                case 2:
                    blocked.south = true;
                    break;
                case 3:
                    blocked.west = true;
                    break;
                default:
                    break;
            }
        }

        // Object clip mask can define additional blocked interaction sides.
        // Bit layout after rotation: 0x1=N, 0x2=E, 0x4=S, 0x8=W.
        const clipMask = this.resolveDoorClipMask(currentId);
        if (clipMask !== 0) {
            const rotatedClipMask = this.rotateDoorClipMask(clipMask, rotation);
            if ((rotatedClipMask & 0x1) !== 0) blocked.north = true;
            if ((rotatedClipMask & 0x2) !== 0) blocked.east = true;
            if ((rotatedClipMask & 0x4) !== 0) blocked.south = true;
            if ((rotatedClipMask & 0x8) !== 0) blocked.west = true;
        }

        if (!blocked.north && !blocked.east && !blocked.south && !blocked.west) {
            return undefined;
        }
        return blocked;
    }

    resolveDoorInteractionTile(
        x: number,
        y: number,
        level: number,
        currentId: number,
    ): { x: number; y: number } | undefined {
        const targetX = x;
        const targetY = y;
        const targetLevel = level;
        const targetId = currentId;
        const tracked = this.findTrackedOpenDoorEntry(targetX, targetY, targetLevel, targetId);
        return tracked?.openedTile;
    }

    private makeKey(x: number, y: number, level: number): string {
        return `${level}:${x}:${y}`;
    }

    private getOpenedTileFromTrackedEntry(entry: OpenDoorEntry): { x: number; y: number } {
        const originalRotation = (entry.rotation - 1 + 4) & 0x3;
        return this.getOpenedTilePosition(entry.closedX, entry.closedY, originalRotation);
    }

    private findTrackedOpenDoorEntry(
        x: number,
        y: number,
        level: number,
        openedId: number,
    ): { key: string; entry: OpenDoorEntry; openedTile: { x: number; y: number } } | undefined {
        const targetX = x;
        const targetY = y;
        const targetLevel = level;
        const targetOpenedId = openedId;

        const key = this.makeKey(targetX, targetY, targetLevel);
        const direct = this.openDoors.get(key);
        if (direct && direct.openedId === targetOpenedId) {
            return {
                key,
                entry: direct,
                openedTile: this.getOpenedTileFromTrackedEntry(direct),
            };
        }

        // Fallback for legacy entries keyed by the original closed tile.
        for (const [entryKey, entry] of this.openDoors.entries()) {
            if (entry.level !== targetLevel) continue;
            if (entry.openedId !== targetOpenedId) continue;
            const openedTile = this.getOpenedTileFromTrackedEntry(entry);
            if (openedTile.x === targetX && openedTile.y === targetY) {
                return {
                    key: entryKey,
                    entry,
                    openedTile,
                };
            }
        }

        return undefined;
    }

    private safeLoadLoc(id: number): any | undefined {
        try {
            return this.locTypeLoader?.load?.(id);
        } catch (err) {
            logger.warn(`[Door] Failed to load loc ${id}`, err);
            return undefined;
        }
    }

    private isDoorCandidate(loc: any): boolean {
        if (!loc) return false;
        const name = this.normalizeName(loc);
        const hasDoorName =
            name.length > 0 && DOOR_NAME_KEYWORDS.some((keyword) => name.includes(keyword));
        const hasDoorAction =
            Array.isArray(loc.actions) &&
            loc.actions.some((action: string | undefined) => {
                const normalized = action?.toLowerCase();
                return normalized ? DOOR_ACTION_KEYWORDS.includes(normalized) : false;
            });
        return hasDoorName || hasDoorAction;
    }

    private normalizeName(loc: any): string {
        const name = loc?.name as string | undefined;
        return name ? name.toLowerCase() : "";
    }

    private hasAction(loc: any, keyword: string): boolean {
        if (!loc || !Array.isArray(loc.actions)) return false;
        const target = keyword.toLowerCase();
        for (const action of loc.actions) {
            if (action?.toLowerCase() === target) return true;
        }
        return false;
    }

    private isDoorPair(a: any, b: any): boolean {
        if (!this.isDoorCandidate(a) || !this.isDoorCandidate(b)) {
            return false;
        }
        const nameA = this.normalizeName(a);
        const nameB = this.normalizeName(b);
        if (!nameA || nameA !== nameB) {
            return false;
        }
        const sizeMatch = a?.sizeX === b?.sizeX && a?.sizeY === b?.sizeY;
        if (!sizeMatch) return false;
        const openCloseOpposite =
            (this.hasAction(a, "open") && this.hasAction(b, "close")) ||
            (this.hasAction(a, "close") && this.hasAction(b, "open"));
        return openCloseOpposite;
    }

    private classifyObservedDoorPair(
        oldId: number,
        newId: number,
    ): { closed: number; opened: number } | undefined {
        const oldLoc = this.safeLoadLoc(oldId);
        const newLoc = this.safeLoadLoc(newId);
        if (!oldLoc || !newLoc) {
            return undefined;
        }
        if (!this.isDoorPair(oldLoc, newLoc)) {
            return undefined;
        }

        const oldHasOpen = this.hasAction(oldLoc, "open");
        const oldHasClose = this.hasAction(oldLoc, "close");
        const newHasOpen = this.hasAction(newLoc, "open");
        const newHasClose = this.hasAction(newLoc, "close");

        if (oldHasOpen && !newHasOpen && newHasClose) {
            return { closed: oldId, opened: newId };
        }
        if (newHasOpen && !oldHasOpen && oldHasClose) {
            return { closed: newId, opened: oldId };
        }
        if (oldHasOpen && newHasClose && !oldHasClose) {
            return { closed: oldId, opened: newId };
        }
        if (newHasOpen && oldHasClose && !newHasClose) {
            return { closed: newId, opened: oldId };
        }

        return undefined;
    }

    private isKnownStaticPair(closed: number, opened: number): boolean {
        if (!this.doorDefLoader) {
            return false;
        }

        const singleClosed = this.doorDefLoader.getSingleDoorPair(closed);
        if (singleClosed && singleClosed.closed === closed && singleClosed.opened === opened) {
            return true;
        }
        const singleOpened = this.doorDefLoader.getSingleDoorPair(opened);
        if (singleOpened && singleOpened.closed === closed && singleOpened.opened === opened) {
            return true;
        }

        const gateClosed = this.doorDefLoader.getGateDef(closed);
        if (gateClosed) {
            const matchesHinge =
                gateClosed.closed.hinge === closed && gateClosed.opened.hinge === opened;
            const matchesExtension =
                gateClosed.closed.extension === closed && gateClosed.opened.extension === opened;
            if (matchesHinge || matchesExtension) {
                return true;
            }
        }

        const gateOpened = this.doorDefLoader.getGateDef(opened);
        if (gateOpened) {
            const matchesHinge =
                gateOpened.closed.hinge === closed && gateOpened.opened.hinge === opened;
            const matchesExtension =
                gateOpened.closed.extension === closed && gateOpened.opened.extension === opened;
            if (matchesHinge || matchesExtension) {
                return true;
            }
        }

        const ddClosed = this.doorDefLoader.getDoubleDoorDef(closed);
        if (ddClosed) {
            const matchesLeft = ddClosed.closed.left === closed && ddClosed.opened.left === opened;
            const matchesRight =
                ddClosed.closed.right === closed && ddClosed.opened.right === opened;
            if (matchesLeft || matchesRight) {
                return true;
            }
        }

        const ddOpened = this.doorDefLoader.getDoubleDoorDef(opened);
        if (ddOpened) {
            const matchesLeft = ddOpened.closed.left === closed && ddOpened.opened.left === opened;
            const matchesRight =
                ddOpened.closed.right === closed && ddOpened.opened.right === opened;
            if (matchesLeft || matchesRight) {
                return true;
            }
        }

        return false;
    }

    /**
     * Legacy toggle method for backwards compatibility.
     * Returns just the new loc ID (use toggleDoor() for full result).
     */
    toggleDoorLegacy(params: {
        x: number;
        y: number;
        level: number;
        currentId: number;
        action?: string;
    }): number | undefined {
        const result = this.toggleDoor({
            ...params,
            rotation: 0,
            locType: LocModelType.WALL,
            currentTick: 0,
        });
        return result?.success ? result.newLocId : undefined;
    }

    // === Auto-Close Tracking ===

    /**
     * Track a door that was just opened for auto-close.
     */
    private trackOpenDoor(
        key: string,
        closedX: number,
        closedY: number,
        currentX: number,
        currentY: number,
        level: number,
        closedId: number,
        openedId: number,
        rotation: number,
        locType: number,
        currentTick: number,
        openCw: boolean = true,
        partnerKey?: string,
    ): void {
        this.openDoors.set(key, {
            key, closedX, closedY, currentX, currentY,
            level, closedId, openedId, rotation, locType,
            openedAtTick: currentTick,
            openCw,
            partnerKey,
        });
    }

    /**
     * Untrack a door that was just closed (either manually or by auto-close).
     */
    private untrackOpenDoor(key: string): void {
        this.openDoors.delete(key);
    }

    /**
     * OSRS parity: Process auto-close for doors that have been open for 300 seconds (500 ticks).
     * Returns list of doors that were auto-closed (for broadcasting loc updates).
     */
    tick(currentTick: number): Array<{
        x: number;
        y: number;
        level: number;
        newLocId: number;
        newRotation: number;
        newTile: { x: number; y: number };
    }> {
        const closedDoors: Array<{
            x: number;
            y: number;
            level: number;
            newLocId: number;
            newRotation: number;
            newTile: { x: number; y: number };
        }> = [];

        for (const [key, entry] of this.openDoors.entries()) {
            if (currentTick - entry.openedAtTick >= DOOR_AUTO_CLOSE_TICKS) {
                // Auto-close this door
                const newRotation = entry.openCw
                    ? (entry.rotation - 1 + 4) & 3  // CW open → CCW close
                    : (entry.rotation + 1) & 3;     // CCW open → CW close
                const newTile = { x: entry.closedX, y: entry.closedY }; // Closing returns to original position
                this.transitionLocCollision(
                    {
                        x: entry.currentX,
                        y: entry.currentY,
                        level: entry.level,
                        locId: entry.openedId,
                        rotation: entry.rotation,
                        locType: entry.locType,
                    },
                    {
                        x: newTile.x,
                        y: newTile.y,
                        level: entry.level,
                        locId: entry.closedId,
                        rotation: newRotation,
                        locType: entry.locType,
                    },
                );

                closedDoors.push({
                    x: entry.currentX,
                    y: entry.currentY,
                    level: entry.level,
                    newLocId: entry.closedId,
                    newRotation,
                    newTile,
                });

                // Remove from tracking
                this.openDoors.delete(key);

                // Also close partner door if this is a double door
                if (entry.partnerKey) {
                    const partnerEntry = this.openDoors.get(entry.partnerKey);
                    if (partnerEntry) {
                        const partnerNewRotation = (partnerEntry.openCw ?? true)
                            ? (partnerEntry.rotation - 1 + 4) & 3
                            : (partnerEntry.rotation + 1) & 3;
                        const partnerNewTile = {
                            x: partnerEntry.closedX,
                            y: partnerEntry.closedY,
                        };
                        this.transitionLocCollision(
                            {
                                x: partnerEntry.currentX,
                                y: partnerEntry.currentY,
                                level: partnerEntry.level,
                                locId: partnerEntry.openedId,
                                rotation: partnerEntry.rotation,
                                locType: partnerEntry.locType,
                            },
                            {
                                x: partnerNewTile.x,
                                y: partnerNewTile.y,
                                level: partnerEntry.level,
                                locId: partnerEntry.closedId,
                                rotation: partnerNewRotation,
                                locType: partnerEntry.locType,
                            },
                        );

                        closedDoors.push({
                            x: partnerEntry.currentX,
                            y: partnerEntry.currentY,
                            level: partnerEntry.level,
                            newLocId: partnerEntry.closedId,
                            newRotation: partnerNewRotation,
                            newTile: partnerNewTile,
                        });

                        this.openDoors.delete(entry.partnerKey);
                    }
                }
            }
        }

        return closedDoors;
    }

    /**
     * Get the number of currently tracked open doors (for debugging/stats).
     */
    getOpenDoorCount(): number {
        return this.openDoors.size;
    }
}

import fs from "fs";
import path from "path";

import { CollisionFlag } from "../../../../../src/shared/CollisionFlag";
import { type IScriptRegistry, type ScriptServices, type LocInteractionEvent } from "../../../../src/game/scripts/types";

// ---------------------------------------------------------------------------
// OSRS Loc Traversal System
//
// Handles all generic loc-based player movement: stairs, ladders, dungeon
// entrances, trapdoors, etc.
//
// Resolution layers (checked in order by ScriptRegistry.findLocInteraction):
//   1. Per-loc overrides   – registerLocInteraction(locId, handler)
//      Use for quest-gated, skill-gated, or otherwise special-case locs.
//   2. Intermap link table – loaded from server/data/intermap-links.json
//      Parsed from CS2 script 1705. Covers all world map traversals
//      (trapdoors, ladders, stairs, dungeons) via proximity tile lookup.
//      Destinations are resolved to walkable adjacent tiles on first use.
//   3. Generic defaults    – registerLocAction("climb-up" | "climb-down" | ...)
//      Handles simple stairs/ladders: same tile, plane +/- 1.
// ---------------------------------------------------------------------------

interface CollisionChecker {
    getCollisionFlagAt(x: number, y: number, plane: number): number | undefined;
}

// -- Animations (from animation_names.txt) -----------------------------------
const LADDER_CLIMB_UP_ANIM = 828; // human_reachforladder
const LADDER_CLIMB_DOWN_ANIM = 827; // human_pickupfloor

// -- Intermap link table (CS2 script 1705) -----------------------------------
interface TraversalDestination {
    x: number;
    y: number;
    level: number;
}

interface IntermapLinkEntry {
    fromX: number;
    fromY: number;
    fromLevel: number;
    to: TraversalDestination;
}

interface IntermapLinksFile {
    links: Record<string, TraversalDestination>;
}

// Max tile distance between a world map intermap icon and the actual loc.
// World map icons are placed near but not exactly on locs.
const INTERMAP_SEARCH_RADIUS = 5;

/** Mask for tiles that block player movement (solid object or blocked floor). */
const TILE_BLOCKED = CollisionFlag.OBJECT | CollisionFlag.FLOOR_BLOCKED;

/** Cardinal offsets in OSRS priority order: south, west, north, east. */
const CARDINAL_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
    { dx: 0, dy: -1 }, // south
    { dx: -1, dy: 0 }, // west
    { dx: 0, dy: 1 },  // north
    { dx: 1, dy: 0 },  // east
];

/**
 * Spatial index for fast proximity lookup of intermap links.
 * Groups entries into 8x8 tile buckets keyed by "level:bucketX:bucketY".
 *
 * On first access with a PathService, all destinations are resolved to
 * walkable adjacent tiles (floodfill) so subsequent lookups are free.
 */
class IntermapLinkIndex {
    private readonly buckets = new Map<string, IntermapLinkEntry[]>();
    private readonly allEntries: IntermapLinkEntry[] = [];
    private resolved = false;

    constructor(links: Map<string, TraversalDestination>) {
        for (const [key, to] of links) {
            const [x, y, level] = key.split(",").map(Number);
            const entry: IntermapLinkEntry = { fromX: x, fromY: y, fromLevel: level, to };
            this.allEntries.push(entry);
            const bk = IntermapLinkIndex.bucketKey(level, x, y);
            const bucket = this.buckets.get(bk);
            if (bucket) {
                bucket.push(entry);
            } else {
                this.buckets.set(bk, [entry]);
            }
        }
    }

    get size(): number {
        return this.allEntries.length;
    }

    private static bucketKey(level: number, x: number, y: number): string {
        return `${level}:${(x >> 3)}:${(y >> 3)}`;
    }

    /**
     * Resolve all destination tiles to walkable adjacent tiles using collision data.
     * Called once on first interaction when PathService is available.
     */
    resolveWalkableDestinations(pathService: CollisionChecker): void {
        if (this.resolved) return;
        this.resolved = true;

        let adjusted = 0;
        for (const entry of this.allEntries) {
            const dest = entry.to;
            const destFlag = pathService.getCollisionFlagAt(dest.x, dest.y, dest.level);

            // If the destination tile itself is walkable, keep it.
            if (destFlag !== undefined && (destFlag & TILE_BLOCKED) === 0) {
                continue;
            }

            // Find first walkable cardinal-adjacent tile.
            for (const { dx, dy } of CARDINAL_OFFSETS) {
                const nx = dest.x + dx;
                const ny = dest.y + dy;
                const flag = pathService.getCollisionFlagAt(nx, ny, dest.level);
                if (flag !== undefined && (flag & TILE_BLOCKED) === 0) {
                    entry.to = { x: nx, y: ny, level: dest.level };
                    adjusted++;
                    break;
                }
            }
        }

        console.log(
            `[climbing] Resolved intermap link destinations: ${adjusted}/${this.allEntries.length} adjusted to adjacent walkable tiles`,
        );
    }

    /**
     * Find the closest intermap link within INTERMAP_SEARCH_RADIUS of (tileX, tileY, level).
     */
    find(tileX: number, tileY: number, level: number): TraversalDestination | undefined {
        const r = INTERMAP_SEARCH_RADIUS;
        const minBX = (tileX - r) >> 3;
        const maxBX = (tileX + r) >> 3;
        const minBY = (tileY - r) >> 3;
        const maxBY = (tileY + r) >> 3;

        let bestDist = r + 1;
        let bestEntry: IntermapLinkEntry | undefined;

        for (let bx = minBX; bx <= maxBX; bx++) {
            for (let by = minBY; by <= maxBY; by++) {
                const bucket = this.buckets.get(`${level}:${bx}:${by}`);
                if (!bucket) continue;
                for (const entry of bucket) {
                    const dx = Math.abs(entry.fromX - tileX);
                    const dy = Math.abs(entry.fromY - tileY);
                    const dist = Math.max(dx, dy); // Chebyshev distance
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestEntry = entry;
                    }
                }
            }
        }

        return bestEntry?.to;
    }

    /**
     * Find the source (from) position of the closest intermap link near (tileX, tileY, level).
     * Used to locate the return loc at a destination so the player can face it.
     */
    findSourceTile(tileX: number, tileY: number, level: number): { x: number; y: number } | undefined {
        const r = INTERMAP_SEARCH_RADIUS;
        const minBX = (tileX - r) >> 3;
        const maxBX = (tileX + r) >> 3;
        const minBY = (tileY - r) >> 3;
        const maxBY = (tileY + r) >> 3;

        let bestDist = r + 1;
        let bestEntry: IntermapLinkEntry | undefined;

        for (let bx = minBX; bx <= maxBX; bx++) {
            for (let by = minBY; by <= maxBY; by++) {
                const bucket = this.buckets.get(`${level}:${bx}:${by}`);
                if (!bucket) continue;
                for (const entry of bucket) {
                    const dx = Math.abs(entry.fromX - tileX);
                    const dy = Math.abs(entry.fromY - tileY);
                    const dist = Math.max(dx, dy);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestEntry = entry;
                    }
                }
            }
        }

        return bestEntry ? { x: bestEntry.fromX, y: bestEntry.fromY } : undefined;
    }
}

function loadIntermapLinks(): IntermapLinkIndex {
    const filePath = path.resolve(__dirname, "../../../../data/intermap-links.json");

    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data: IntermapLinksFile = JSON.parse(raw);
        return new IntermapLinkIndex(new Map(Object.entries(data.links)));
    } catch (e) {
        console.log(`[climbing] Failed to load intermap-links.json: ${e}`);
        return new IntermapLinkIndex(new Map());
    }
}

const intermapLinks = loadIntermapLinks();
console.log(`[climbing] Loaded ${intermapLinks.size} intermap links from CS2 script 1705`);

// ---------------------------------------------------------------------------
// Stair floor-count table (server/data/stair-floors.json)
// ---------------------------------------------------------------------------

interface StairFloorEntry {
    floors: number;
    /** Fixed destination XY at the target level (OSRS-accurate, from packet dump). */
    dest?: { x: number; y: number };
}

function loadStairFloors(): Map<number, StairFloorEntry> {
    const filePath = path.resolve(__dirname, "../../../../data/stair-floors.json");
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        const map = new Map<number, StairFloorEntry>();
        for (const [key, value] of Object.entries(data)) {
            if (key.startsWith("_")) continue;
            const locId = parseInt(key, 10);
            if (isNaN(locId)) continue;
            if (typeof value === "number") {
                map.set(locId, { floors: value });
            } else if (value && typeof value === "object" && "floors" in value) {
                const entry = value as { floors: number; dest?: { x: number; y: number } };
                map.set(locId, { floors: entry.floors, dest: entry.dest });
            }
        }
        return map;
    } catch (e) {
        console.log(`[climbing] Failed to load stair-floors.json: ${e}`);
        return new Map();
    }
}

const stairFloors = loadStairFloors();
console.log(`[climbing] Loaded ${stairFloors.size} stair floor entries`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure intermap link destinations have been resolved to walkable tiles.
 * Called lazily on first interaction when PathService is available.
 */
function ensureResolved(services: LocInteractionEvent["services"]): void {
    const pathService = services.movement.getPathService();
    if (pathService) {
        intermapLinks.resolveWalkableDestinations(pathService);
    }
}

function resolveDestination(
    event: LocInteractionEvent,
    defaultLevelOffset: number,
): TraversalDestination | null {
    ensureResolved(event.services);

    // 1. Check intermap link table (CS2 script 1705) by proximity to loc tile
    const link = intermapLinks.find(event.tile.x, event.tile.y, event.level);
    if (link) return link;

    // 2. Fall back to plane offset
    const targetLevel = event.level + defaultLevelOffset;
    if (targetLevel < 0 || targetLevel > 3) return null;

    return { x: event.player.tileX, y: event.player.tileY, level: targetLevel };
}

// ---------------------------------------------------------------------------
// Multi-floor traversal helpers (top-floor / bottom-floor)
// ---------------------------------------------------------------------------

/**
 * Resolve the stair floor entry for a loc.
 *
 * Priority:
 *  1. stair-floors.json explicit entry (authoritative, from OSRS packet dump).
 *  2. `_N` suffix in the internal cache name if exposed (e.g. "spiralstairsbottom_3").
 *     Note: the display name (e.g. "Staircase") never contains this suffix.
 */
function getStairEntry(
    services: LocInteractionEvent["services"],
    locId: number,
): StairFloorEntry | undefined {
    // 1. Data file — highest priority
    const fromFile = stairFloors.get(locId);
    if (fromFile !== undefined) return fromFile;

    // 2. Internal name suffix fallback (rarely populated via getLocDefinition)
    const def = services.data.getLocDefinition(locId);
    if (!def?.name) return undefined;
    const match = (def.name as string).match(/_(\d+)$/);
    if (match) {
        const count = parseInt(match[1], 10);
        if (count >= 2 && count <= 4) return { floors: count };
    }
    return undefined;
}

interface MultiFloorTarget {
    level: number;
    /** Fixed XY destination from stair-floors.json, if configured. */
    fixedDest?: { x: number; y: number };
}

/**
 * Resolve the target level and optional fixed destination for a multi-floor traversal.
 *
 * OSRS sends a fixed destination tile per staircase (from packet dump),
 * independent of where the player was standing. When configured in stair-floors.json
 * that dest is used directly. Otherwise falls back to nearest-walkable scan.
 */
function resolveMultiFloorTarget(
    event: LocInteractionEvent,
    direction: "top" | "bottom",
): MultiFloorTarget {
    const { level, services, locId } = event;
    const entry = getStairEntry(services, locId);
    const floorCount = entry?.floors;

    let targetLevel: number;
    if (direction === "top") {
        targetLevel = floorCount !== undefined
            ? Math.min(level + (floorCount - 1), 3)
            : Math.min(level + 2, 3);
    } else {
        targetLevel = floorCount !== undefined
            ? Math.max(level - (floorCount - 1), 0)
            : 0;
    }

    return { level: targetLevel, fixedDest: entry?.dest };
}

/**
 * Resolve a destination tile to the nearest walkable tile using an
 * expanding-ring search (Chebyshev distance 0 → MAX_WALKABLE_SEARCH_RADIUS).
 *
 * Handles cases where a large object (e.g. the Lighthouse cog wheel) blocks
 * the staircase exit tile and all immediate cardinal neighbors.
 */
/**
 * Search offsets for walkable destination resolution, ordered so that
 * cardinal-adjacent tiles are preferred over diagonals at each radius.
 * Capped at radius 2 to avoid escaping building walls.
 *
 * Priority: r=1 cardinals → r=1 diagonals → r=2 cardinals → r=2 diagonals.
 * OSRS staircase exits are always directly adjacent (N/S/E/W) to the
 * staircase object, so cardinals resolve correctly in the common case.
 */
const WALKABLE_SEARCH_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
    // Radius 1 — cardinals first (OSRS SWNE order)
    { dx: 0, dy: -1 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 0 },
    // Radius 1 — diagonals
    { dx: -1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 1 },
    // Radius 2 — cardinals
    { dx: 0, dy: -2 }, { dx: -2, dy: 0 }, { dx: 0, dy: 2 }, { dx: 2, dy: 0 },
    // Radius 2 — diagonals and edges
    { dx: -1, dy: -2 }, { dx: 1, dy: -2 }, { dx: -2, dy: -1 }, { dx: 2, dy: -1 },
    { dx: -2, dy: 1 }, { dx: 2, dy: 1 }, { dx: -1, dy: 2 }, { dx: 1, dy: 2 },
    { dx: -2, dy: -2 }, { dx: -2, dy: 2 }, { dx: 2, dy: -2 }, { dx: 2, dy: 2 },
];

function resolveWalkableDest(
    services: LocInteractionEvent["services"],
    dest: TraversalDestination,
): TraversalDestination {
    const pathService = services.movement.getPathService();
    if (!pathService) return dest;

    // Check the destination tile itself first.
    const destFlag = pathService.getCollisionFlagAt(dest.x, dest.y, dest.level);
    if (destFlag !== undefined && (destFlag & TILE_BLOCKED) === 0) {
        return dest;
    }

    for (const { dx, dy } of WALKABLE_SEARCH_OFFSETS) {
        const nx = dest.x + dx;
        const ny = dest.y + dy;
        const flag = pathService.getCollisionFlagAt(nx, ny, dest.level);
        if (flag !== undefined && (flag & TILE_BLOCKED) === 0) {
            return { x: nx, y: ny, level: dest.level };
        }
    }

    return dest;
}

/**
 * Execute an instant multi-floor traversal (no climb animation).
 * top-floor / bottom-floor teleports are immediate with no
 * sequence animation — just a plane change and face direction toward the loc.
 *
 * The destination is resolved to the nearest walkable tile before teleporting
 * to handle cases where the same-XY tile at the target level is blocked
 * (e.g. the Lighthouse cog wheel occupying the staircase tile on level 2).
 */
function executeInstantTraversal(
    event: LocInteractionEvent,
    dest: TraversalDestination,
): void {
    const { player, tile, services } = event;

    const resolved = resolveWalkableDest(services, dest);

    services.movement.requestTeleportAction(player, {
        x: resolved.x,
        y: resolved.y,
        level: resolved.level,
        delayTicks: 0,
        preserveAnimation: false,
        requireCanTeleport: false,
        replacePending: true,
        arriveFaceTileX: tile.x,
        arriveFaceTileY: tile.y,
    });
}

// ---------------------------------------------------------------------------
// Single-floor traversal helpers (climb-up / climb-down)
// ---------------------------------------------------------------------------

/**
 * Ticks to wait after arrival before teleporting.
 * Gives the client time to finish walk interpolation so the player
 * visually reaches the loc before disappearing.
 */
const CLIMB_DELAY_TICKS = 1;

function executeTraversal(
    event: LocInteractionEvent,
    dest: TraversalDestination,
    direction: "up" | "down" = "up",
): void {
    const { player, tile, level, services } = event;

    const anim = direction === "down" ? LADDER_CLIMB_DOWN_ANIM : LADDER_CLIMB_UP_ANIM;

    services.animation.playPlayerSeq(player, anim);

    services.movement.requestTeleportAction(player, {
        x: dest.x,
        y: dest.y,
        level: dest.level,
        delayTicks: CLIMB_DELAY_TICKS,
        preserveAnimation: true,
        requireCanTeleport: false,
        replacePending: true,
    });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerClimbingHandlers(registry: IScriptRegistry, _services: ScriptServices): void {
    // ---- climb-up: default plane + 1 ----
    registry.registerLocAction("climb-up", (event) => {
        const dest = resolveDestination(event, +1);
        if (!dest) return;
        executeTraversal(event, dest, "up");
    });

    // ---- climb-down / descend: default plane - 1 ----
    for (const action of ["climb-down", "descend"]) {
        registry.registerLocAction(action, (event) => {
            const dest = resolveDestination(event, -1);
            if (!dest) return;
            executeTraversal(event, dest, "down");
        });
    }

    // ---- enter: dungeon entrances, cave entries, etc. ----
    registry.registerLocAction("enter", (event) => {
        ensureResolved(event.services);
        const link = intermapLinks.find(event.tile.x, event.tile.y, event.level);
        if (!link) {
            event.services.messaging.sendGameMessage(event.player, "Nothing interesting happens.");
            return;
        }
        const dir = link.level < event.level ? "down" : "up";
        executeTraversal(event, link, dir);
    });

    // ---- top-floor: skip directly to the highest floor (no animation) ----
    for (const action of ["top-floor", "top floor"]) {
        registry.registerLocAction(action, (event) => {
            ensureResolved(event.services);
            const { tile, level } = event;

            // Intermap link takes priority (handles dungeon/non-standard destinations)
            const link = intermapLinks.find(tile.x, tile.y, level);
            if (link) {
                executeInstantTraversal(event, link);
                return;
            }

            const { level: targetLevel, fixedDest } = resolveMultiFloorTarget(event, "top");
            if (targetLevel <= level) return;

            // Use fixed dest from data file (OSRS-accurate) when available,
            // otherwise fall back to nearest-walkable scan from player tile.
            const destXY = fixedDest ?? { x: event.player.tileX, y: event.player.tileY };
            executeInstantTraversal(event, { ...destXY, level: targetLevel });
        });
    }

    // ---- bottom-floor: skip directly to the ground floor (no animation) ----
    for (const action of ["bottom-floor", "bottom floor"]) {
        registry.registerLocAction(action, (event) => {
            ensureResolved(event.services);
            const { tile, level } = event;

            if (level <= 0) return;

            // Intermap link takes priority
            const link = intermapLinks.find(tile.x, tile.y, level);
            if (link) {
                executeInstantTraversal(event, link);
                return;
            }

            const { level: targetLevel, fixedDest } = resolveMultiFloorTarget(event, "bottom");
            if (targetLevel >= level) return;

            const destXY = fixedDest ?? { x: event.player.tileX, y: event.player.tileY };
            executeInstantTraversal(event, { ...destXY, level: targetLevel });
        });
    }

    // ---- climb (ambiguous): show dialogue asking up or down ----
    registry.registerLocAction("climb", (event) => {
        ensureResolved(event.services);
        const { player, level, services } = event;

        // Check intermap link first — if present, use it directly (no ambiguity)
        const link = intermapLinks.find(event.tile.x, event.tile.y, level);
        if (link) {
            const dir = link.level < level ? "down" : "up";
            executeTraversal(event, link, dir);
            return;
        }

        // Fall back to plane +/- 1 with direction choice
        const canGoUp = level < 3;
        const canGoDown = level > 0;

        const upDest = canGoUp ? resolveDestination(event, +1) : null;
        const downDest = canGoDown ? resolveDestination(event, -1) : null;

        if (upDest && downDest) {
            services.dialog.openDialogOptions(player, {
                id: "climb-direction",
                title: "Climb up or down?",
                options: ["Climb-up.", "Climb-down."],
                onSelect: (choiceIndex: number) => {
                    if (choiceIndex === 0 && upDest) {
                        executeTraversal(event, upDest, "up");
                    } else if (downDest) {
                        executeTraversal(event, downDest, "down");
                    }
                },
            });
        } else if (upDest) {
            executeTraversal(event, upDest, "up");
        } else if (downDest) {
            executeTraversal(event, downDest, "down");
        }
    });
}

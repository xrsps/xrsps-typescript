import fs from "fs";
import path from "path";

import { CollisionFlag } from "../../../pathfinding/legacy/pathfinder/flag/CollisionFlag";
import type { PathService } from "../../../pathfinding/PathService";
import { type LocInteractionEvent, type ScriptModule } from "../types";

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

// -- Animations (from animation_names.txt) -----------------------------------
const LADDER_CLIMB_UP_ANIM = 828;   // human_reachforladder
const LADDER_CLIMB_DOWN_ANIM = 833; // human_reachforladdertop

// -- Sounds (from osrs-synths.json) ------------------------------------------
const STAIR_SOUND = 2420; // up_and_down_stairs

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
    resolveWalkableDestinations(pathService: PathService): void {
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure intermap link destinations have been resolved to walkable tiles.
 * Called lazily on first interaction when PathService is available.
 */
function ensureResolved(services: LocInteractionEvent["services"]): void {
    const pathService = services.getPathService?.();
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

/**
 * Ticks to wait after arrival before teleporting.
 * Gives the client time to finish walk interpolation so the player
 * visually reaches the loc before disappearing.
 */
const CLIMB_DELAY_TICKS = 2;

function executeTraversal(
    event: LocInteractionEvent,
    dest: TraversalDestination,
    direction: "up" | "down" = "up",
): void {
    const { player, tile, level, services } = event;

    const anim = direction === "down" ? LADDER_CLIMB_DOWN_ANIM : LADDER_CLIMB_UP_ANIM;

    // Look up the return traversal loc at the destination so the player
    // faces it on arrival (e.g. the ladder you'd climb back up).
    const returnLoc = intermapLinks.findSourceTile(dest.x, dest.y, dest.level);

    // Schedule a delayed teleport.  The climb animation, sound, and face
    // direction all fire at the destination via arrive* fields so they land
    // in the same tick as the teleport snap (OSRS parity).
    services.requestTeleportAction?.(player, {
        x: dest.x,
        y: dest.y,
        level: dest.level,
        delayTicks: CLIMB_DELAY_TICKS,
        arriveSeqId: anim,
        arriveSoundId: STAIR_SOUND,
        arriveSoundRadius: 1,
        arriveFaceTileX: returnLoc?.x,
        arriveFaceTileY: returnLoc?.y,
        requireCanTeleport: false,
        replacePending: true,
    });
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const climbingModule: ScriptModule = {
    id: "content.climbing",
    register(registry, _services) {
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
                event.services.sendGameMessage(event.player, "Nothing interesting happens.");
                return;
            }
            const dir = link.level < event.level ? "down" : "up";
            executeTraversal(event, link, dir);
        });

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
                services.openDialogOptions?.(player, {
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
    },
};

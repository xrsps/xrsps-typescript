import {
    createEmptyTemplateChunks,
    packTemplateChunk,
} from "../../../../src/shared/instance/InstanceTypes";
import type { WorldEntityBuildArea } from "../../../../src/shared/worldentity/WorldEntityTypes";

// ============================================================================
// Source Region — m60_100 (boat template in cache)
// ============================================================================

// The world entity scene uses source-region coordinates internally.
// All locs, NPCs, and the player position use coordinates relative to
// the source region at (3840, 6400).
export const SOURCE_BASE_X = 3840;
export const SOURCE_BASE_Y = 6400;

// Source chunk that contains the boat
const SOURCE_CHUNK_X = SOURCE_BASE_X / 8; // 480
const SOURCE_CHUNK_Y = SOURCE_BASE_Y / 8; // 800

// Ocean fill chunk (Port Sarim deep ocean)
const OCEAN_CHUNK_X = 383;
const OCEAN_CHUNK_Y = 392;

const TEMPLATE_MIN = 2;
const TEMPLATE_MAX = 11;

// ============================================================================
// Instance Coordinates (source-region space, from packet capture)
// ============================================================================

// Region center for the scene (chunk coords)
export const SAILING_REGION_X = SOURCE_CHUNK_X; // 480
export const SAILING_REGION_Y = SOURCE_CHUNK_Y; // 800

// Player spawn position inside the boat (source coords)
export const SAILING_INTRO_X = SOURCE_BASE_X + 4; // 3844
export const SAILING_INTRO_Y = SOURCE_BASE_Y + 4; // 6404
export const SAILING_INTRO_LEVEL = 1;

// Port Sarim return location
export const PORT_SARIM_RETURN_X = 3046;
export const PORT_SARIM_RETURN_Y = 3207;
export const PORT_SARIM_RETURN_LEVEL = 0;

// ============================================================================
// Boat Loc Definitions (source-region coordinates from packet capture)
// ============================================================================

export interface BoatLoc {
    id: number;
    x: number;
    y: number;
    level: number;
    shape: number;
    rotation: number;
}

function buildBoatLocs(): BoatLoc[] {
    const bx = SOURCE_BASE_X;
    const by = SOURCE_BASE_Y;
    return [
        // Hull (plane 0)
        { id: 59516, x: bx + 2, y: by + 1, level: 0, shape: 10, rotation: 0 },
        { id: 59624, x: bx + 1, y: by + 1, level: 0, shape: 10, rotation: 0 },
        // Superstructure (plane 1)
        { id: 59620, x: bx + 4, y: by + 6, level: 1, shape: 10, rotation: 0 },
        { id: 59553, x: bx + 4, y: by + 4, level: 1, shape: 10, rotation: 0 },
        { id: 60480, x: bx + 3, y: by + 2, level: 1, shape: 10, rotation: 1 },
        // Invisible blockers (plane 1)
        { id: 32545, x: bx + 2, y: by + 3, level: 1, shape: 22, rotation: 0 },
        { id: 32545, x: bx + 2, y: by + 2, level: 1, shape: 22, rotation: 0 },
        { id: 32545, x: bx + 5, y: by + 2, level: 1, shape: 22, rotation: 0 },
        { id: 32545, x: bx + 2, y: by + 5, level: 1, shape: 22, rotation: 0 },
        { id: 32545, x: bx + 5, y: by + 5, level: 1, shape: 22, rotation: 0 },
        // Sound locs (plane 1)
        { id: 58569, x: bx + 5, y: by + 3, level: 1, shape: 22, rotation: 0 },
        { id: 58526, x: bx + 2, y: by + 4, level: 1, shape: 22, rotation: 0 },
        { id: 58568, x: bx + 5, y: by + 4, level: 1, shape: 22, rotation: 0 },
    ];
}

export const SAILING_INTRO_BOAT_LOCS = buildBoatLocs();

// ============================================================================
// NPC Spawn Positions (source-region coordinates, plane 1)
// ============================================================================

export const SAILING_INTRO_NPC_SPAWNS = {
    willBoat: {
        id: 14958,
        x: SOURCE_BASE_X + 4,
        y: SOURCE_BASE_Y + 3,
        level: 1,
    },
    anneBoat: {
        id: 14963,
        x: SOURCE_BASE_X + 4,
        y: SOURCE_BASE_Y + 2,
        level: 1,
    },
    boatHp: {
        id: 15187,
        x: SOURCE_BASE_X + 3,
        y: SOURCE_BASE_Y + 3,
        level: 1,
    },
};

// ============================================================================
// Docked Boat at Port Sarim (overworld locs for ::sail visibility)
// ============================================================================

// World entity scene anchor: entityCoord(3050) + sizeChunks(8)*4 = 3054.
// Boat locs at source offset (n, m) appear at overworld:
//   worldX = 3054 + n - 4,  worldY = 3193 + m - 4
export const DOCK_OFFSET_X = 3054 - 4; // 3050
export const DOCK_OFFSET_Y = 3193 - 4; // 3189

function buildDockedBoatLocs(): BoatLoc[] {
    const dx = DOCK_OFFSET_X;
    const dy = DOCK_OFFSET_Y;
    return [
        // Hull (plane 0)
        { id: 59516, x: dx + 2, y: dy + 1, level: 0, shape: 10, rotation: 0 },
        { id: 59624, x: dx + 1, y: dy + 1, level: 0, shape: 10, rotation: 0 },
        // Superstructure (plane 0 in overworld — no raised deck in overworld terrain)
        { id: 59620, x: dx + 4, y: dy + 6, level: 0, shape: 10, rotation: 0 },
        { id: 59553, x: dx + 4, y: dy + 4, level: 0, shape: 10, rotation: 0 },
        { id: 60480, x: dx + 3, y: dy + 2, level: 0, shape: 10, rotation: 1 },
    ];
}

export const SAILING_DOCKED_BOAT_LOCS = buildDockedBoatLocs();

export const SAILING_DOCKED_PLAYER_X = DOCK_OFFSET_X + 4;
export const SAILING_DOCKED_PLAYER_Y = DOCK_OFFSET_Y + 4;
export const SAILING_DOCKED_PLAYER_LEVEL = 0;

export const SAILING_DOCKED_NPC_SPAWNS = [
    { id: 14959, x: DOCK_OFFSET_X + 4, y: DOCK_OFFSET_Y + 3, level: 0 },
    { id: 14964, x: DOCK_OFFSET_X + 4, y: DOCK_OFFSET_Y + 2, level: 0 },
];

// ============================================================================
// Template Builder
// ============================================================================

/**
 * Build the 4x13x13 template chunk grid for the sailing world entity.
 *
 * Places the source region chunk (480, 800) at the center of the grid.
 * Fills surrounding chunks with ocean terrain.
 */
/**
 * Build template chunks for the world entity overlay (::sail, overworld boat).
 * Only the center chunk has the boat — surrounding chunks are empty so
 * the overlay doesn't cover Port Sarim terrain with ocean.
 */
export function buildSailingOverlayTemplates(): number[][][] {
    const chunks = createEmptyTemplateChunks();

    for (let plane = 0; plane < 4; plane++) {
        // Only the center chunk: boat source region.
        // Surrounding chunks are intentionally empty so the overlay doesn't
        // cover Port Sarim terrain with ocean visuals.  Server-side collision
        // blocking is handled separately in buildDockedCollision().
        chunks[plane][6][6] = packTemplateChunk(
            plane, SOURCE_CHUNK_X, SOURCE_CHUNK_Y, 0,
        );
    }

    return chunks;
}

/**
 * Build template chunks for the sailing instance scene.
 * Boat at center, ocean everywhere else for the sailing environment.
 */
export function buildSailingIntroTemplates(): number[][][] {
    const chunks = createEmptyTemplateChunks();

    for (let plane = 0; plane < 4; plane++) {
        for (let cx = TEMPLATE_MIN; cx < TEMPLATE_MAX; cx++) {
            for (let cy = TEMPLATE_MIN; cy < TEMPLATE_MAX; cy++) {
                if (cx === 6 && cy === 6) {
                    chunks[plane][cx][cy] = packTemplateChunk(
                        plane, SOURCE_CHUNK_X, SOURCE_CHUNK_Y, 0,
                    );
                } else {
                    chunks[plane][cx][cy] = packTemplateChunk(
                        plane, OCEAN_CHUNK_X, OCEAN_CHUNK_Y, 0,
                    );
                }
            }
        }
    }

    return chunks;
}

// ============================================================================
// World Entity Configuration (from packet capture)
// ============================================================================

export const SAILING_WORLD_ENTITY_INDEX = 3426;
export const SAILING_WORLD_ENTITY_CONFIG_ID = 2;
export const SAILING_WORLD_ENTITY_SIZE_X = 8;
export const SAILING_WORLD_ENTITY_SIZE_Z = 8;

export const SAILING_INTRO_BUILD_AREAS: WorldEntityBuildArea[] = [
    {
        sourceBaseX: SOURCE_BASE_X,
        sourceBaseY: SOURCE_BASE_Y,
        destBaseX: 15680,
        destBaseY: 6976,
        planes: 4,
        rotation: 0,
    },
];

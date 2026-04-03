import type { CollisionMap } from "../../../../src/rs/scene/CollisionMap";
import type { PlayerState } from "../player";
import type { NpcSpawnConfig, NpcState } from "../npc";
import type { PathService } from "../../pathfinding/PathService";
import type { MapCollisionService } from "../../world/MapCollisionService";
import {
    buildSailingIntroTemplates,
    buildSailingOverlayTemplates,
    SOURCE_BASE_X,
    SOURCE_BASE_Y,
    SAILING_INTRO_BOAT_LOCS,
    SAILING_INTRO_LEVEL,
    SAILING_INTRO_NPC_SPAWNS,
    SAILING_INTRO_X,
    SAILING_INTRO_Y,
    SAILING_WORLD_ENTITY_INDEX,
} from "./SailingInstance";
import { SailingWorldView } from "./SailingWorldView";
import { logger } from "../../utils/logger";

// Sailing instance region: source base is (3840, 6400).
const INSTANCE_MIN_X = 3840;
const INSTANCE_MAX_X = 3840 + 8 * 13;
const INSTANCE_MIN_Y = 6400;
const INSTANCE_MAX_Y = 6400 + 8 * 13;

// Scene size: 13 chunks * 8 tiles = 104 tiles
const INSTANCE_SCENE_SIZE = 104;

// Entity position: center at (3054.5, 3193.5).
// Scene is 104 tiles (13 chunks * 8). Center of scene = local (52, 52).
// baseX = floor(entityCenterX - sceneCenter) = floor(3054.5 - 52) = 3002
// baseY = floor(entityCenterY - sceneCenter) = floor(3193.5 - 52) = 3141
const DOCK_WV_BASE_X = 3002;
const DOCK_WV_BASE_Y = 3141;

export interface SailingInstanceServices {
    teleportToInstance: (
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        templateChunks: number[][][],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ) => void;
    spawnNpc: (config: NpcSpawnConfig) => NpcState | undefined;
    removeNpc: (npcId: number) => boolean;
    pathService?: PathService;
    mapCollision?: MapCollisionService;
}

export class SailingInstanceManager {
    private readonly services: SailingInstanceServices;
    private dockedWorldView?: SailingWorldView;

    constructor(services: SailingInstanceServices) {
        this.services = services;
    }

    isInSailingInstanceRegion(player: PlayerState): boolean {
        return (
            player.tileX >= INSTANCE_MIN_X &&
            player.tileX < INSTANCE_MAX_X &&
            player.tileY >= INSTANCE_MIN_Y &&
            player.tileY < INSTANCE_MAX_Y
        );
    }

    initInstance(player: PlayerState): void {
        this.disposeInstance(player);

        const templateChunks = buildSailingIntroTemplates();
        player.worldViewId = SAILING_WORLD_ENTITY_INDEX;
        this.services.teleportToInstance(
            player,
            SAILING_INTRO_X,
            SAILING_INTRO_Y,
            SAILING_INTRO_LEVEL,
            templateChunks,
            SAILING_INTRO_BOAT_LOCS,
        );

        const { willBoat, anneBoat, boatHp } = SAILING_INTRO_NPC_SPAWNS;
        for (const spawn of [willBoat, anneBoat, boatHp]) {
            const npc = this.services.spawnNpc({ ...spawn, wanderRadius: 0 });
            if (npc) {
                npc.worldViewId = SAILING_WORLD_ENTITY_INDEX;
                player.instanceNpcIds.add(npc.id);
            } else {
                logger.warn(
                    `[SailingInstanceManager] Failed to spawn NPC ${spawn.id} for player ${player.id}`,
                );
            }
        }

        const npcIds = [...player.instanceNpcIds].join(", ");
        logger.info(
            `[SailingInstance] Created instance for player ${player.id} — spawned ${player.instanceNpcIds.size} NPCs [${npcIds}]`,
        );
    }

    /**
     * Build per-WorldView collision from the overlay template chunks and register
     * with PathService. The WorldView's baseX/baseY map scene-local coords to
     * world tiles at the dock position.
     */
    buildDockedCollision(): void {
        const mapCollision = this.services.mapCollision;
        const pathService = this.services.pathService;
        if (!mapCollision || !pathService) return;
        if (this.dockedWorldView) return;

        const templateChunks = buildSailingOverlayTemplates();
        const collisionMaps = mapCollision.buildInstanceCollision(
            templateChunks,
            0, 0,
            INSTANCE_SCENE_SIZE,
            INSTANCE_SCENE_SIZE,
        );
        if (!collisionMaps) {
            logger.warn("[SailingInstance] Failed to build docked collision from template chunks");
            return;
        }

        // OSRS parity: collision maps start as FLOOR_BLOCKED (0x200000) and
        // terrain decode clears walkable tiles.  Our CollisionMap.reset() starts
        // at 0 (walkable), so ocean/empty tiles have no blocking.  Fix this by
        // flooding the deck plane with FLOOR_BLOCKED, then carving out walkable
        // deck tiles derived from the boat locs.
        const FLOOR_BLOCKED = 0x200000 | 0x40000; // FLOOR | FLOOR_DECORATION
        const DECK_PLANE = 1; // boat deck is at source plane 1
        const deckCm = collisionMaps[DECK_PLANE];
        if (deckCm) {
            // Block every tile on the deck plane
            for (let x = 0; x < INSTANCE_SCENE_SIZE; x++) {
                for (let y = 0; y < INSTANCE_SCENE_SIZE; y++) {
                    if (deckCm.isWithinBounds(x, y)) {
                        deckCm.flag(x, y, FLOOR_BLOCKED);
                    }
                }
            }
        }

        // Scene base: (regionX - 6) * 8 = (480 - 6) * 8 = 3792, (800 - 6) * 8 = 6352
        const sceneBaseX = (SOURCE_BASE_X / 8 - 6) * 8;
        const sceneBaseY = (SOURCE_BASE_Y / 8 - 6) * 8;

        // Define the walkable deck rectangle from the boat structure.
        // The invisible blockers (32545) form the perimeter at offsets:
        //   left:  bx+2 (y: by+2, by+3, by+5)
        //   right: bx+5 (y: by+2, by+5)
        // The walkable interior is everything strictly inside that perimeter.
        const deckMinX = (SOURCE_BASE_X + 3) - sceneBaseX; // bx+3 → local 51
        const deckMaxX = (SOURCE_BASE_X + 4) - sceneBaseX; // bx+4 → local 52
        const deckMinY = (SOURCE_BASE_Y + 2) - sceneBaseY; // by+2 → local 50
        const deckMaxY = (SOURCE_BASE_Y + 5) - sceneBaseY; // by+5 → local 53
        let clearedCount = 0;
        for (let x = deckMinX; x <= deckMaxX; x++) {
            for (let y = deckMinY; y <= deckMaxY; y++) {
                if (!deckCm.isWithinBounds(x, y)) continue;
                const cur = deckCm.getFlag(x, y);
                deckCm.setFlag(x, y, cur & ~FLOOR_BLOCKED);
                clearedCount++;
            }
        }

        // Apply invisible blockers as OBJECT collision on top.
        const INVISIBLE_BLOCKER_ID = 32545;
        for (const loc of SAILING_INTRO_BOAT_LOCS) {
            if (loc.id !== INVISIBLE_BLOCKER_ID) continue;
            const lx = loc.x - sceneBaseX;
            const ly = loc.y - sceneBaseY;
            const plane = loc.level & 3;
            const cm = collisionMaps[plane];
            if (!cm || !cm.isWithinBounds(lx, ly)) continue;
            cm.flag(lx, ly, 0x100); // OBJECT
        }
        logger.info(
            `[SailingInstance] Deck collision: flooded plane ${DECK_PLANE}, cleared ${clearedCount} deck tiles`,
        );

        this.dockedWorldView = new SailingWorldView(
            SAILING_WORLD_ENTITY_INDEX,
            DOCK_WV_BASE_X,
            DOCK_WV_BASE_Y,
            INSTANCE_SCENE_SIZE,
            INSTANCE_SCENE_SIZE,
            collisionMaps,
            1, // basePlane: boat deck collision is at plane 1 in the source scene
        );
        pathService.registerWorldViewCollision(SAILING_WORLD_ENTITY_INDEX, this.dockedWorldView);
        logger.info(
            `[SailingInstance] Registered docked WorldView collision: base=(${DOCK_WV_BASE_X},${DOCK_WV_BASE_Y}) size=${INSTANCE_SCENE_SIZE}`,
        );
    }

    clearDockedCollision(): void {
        if (!this.dockedWorldView) return;
        this.services.pathService?.removeWorldViewCollision(SAILING_WORLD_ENTITY_INDEX);
        this.dockedWorldView = undefined;
    }

    disposeInstance(player: PlayerState): void {
        player.worldViewId = -1;
        this.clearDockedCollision();
        if (player.instanceNpcIds.size === 0) return;

        const npcIds = [...player.instanceNpcIds].join(", ");
        for (const npcId of player.instanceNpcIds) {
            this.services.removeNpc(npcId);
        }

        logger.info(
            `[SailingInstance] Destroyed instance for player ${player.id} — removed ${player.instanceNpcIds.size} NPCs [${npcIds}]`,
        );
        player.instanceNpcIds.clear();
    }
}

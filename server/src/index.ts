import path from "path";

import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { config } from "./config";
import { initSpellWidgetMapping } from "./game/spells/SpellDataProvider";
import { createGamemode } from "./game/gamemodes/GamemodeRegistry";
import { NpcManager } from "./game/npcManager";
import { PlayerState } from "./game/player";
import { GameTicker } from "./game/ticker";
import { WSServer } from "./network/wsServer";
import { PathService } from "./pathfinding/PathService";
import { logger } from "./utils/logger";
import { setViewportEnumService } from "./widgets/viewport";
import { ViewportEnumService } from "./widgets/viewport/ViewportEnumService";
import { initCacheEnv } from "./world/CacheEnv";
import { MapCollisionService } from "./world/MapCollisionService";

async function main() {
    logger.info(
        `Boot: starting server with tickMs=${config.tickMs}, host=${config.host}, port=${config.port}`,
    );
    const ticker = new GameTicker(config.tickMs);

    // Initialize cache + collision + path services
    logger.info("Boot: initializing cache environment (caches/)...");
    const cacheEnv = initCacheEnv("caches");
    logger.info(`Boot: cache ready (rev=${cacheEnv.info.revision}, name=${cacheEnv.info.name})`);

    // Build full scenes like the editor (models included) so server has parity
    logger.info("Boot: creating map collision service (precomputed=true)...");
    const mapService = new MapCollisionService(cacheEnv, false, {
        precomputedRoot: "server/cache/collision",
        usePrecomputed: true,
    });
    logger.info("Boot: map collision service ready");
    const pathService = new PathService(mapService);
    logger.info("Boot: path service ready");

    const cacheFactory = getCacheLoaderFactory(cacheEnv.info, cacheEnv.cacheSystem as any);
    const npcTypeLoader = cacheFactory.getNpcTypeLoader();
    const basTypeLoader = cacheFactory.getBasTypeLoader();

    // Initialize viewport enum service for display mode component mapping
    const enumTypeLoader = cacheFactory.getEnumTypeLoader();
    if (enumTypeLoader) {
        const viewportEnumService = new ViewportEnumService(enumTypeLoader);
        setViewportEnumService(viewportEnumService);
        logger.info("Boot: viewport enum service ready (enum 1745 loaded)");
    } else {
        logger.warn("Boot: viewport enum service unavailable, using hardcoded fallbacks");
    }

    const npcManager = new NpcManager(mapService, pathService, npcTypeLoader, basTypeLoader);
    npcManager.loadFromFile(path.resolve("server/data/npc-spawns.json"));
    logger.info("Boot: NPC manager ready (spawns loaded)");

    logger.info(`Boot: creating gamemode "${config.gamemode}"...`);
    const gamemode = createGamemode(config.gamemode);
    PlayerState.gamemodeRef = gamemode;
    logger.info(`Boot: gamemode "${gamemode.name}" created`);

    logger.info("Boot: constructing WebSocket server...");
    const server = new WSServer({
        host: config.host,
        port: config.port,
        tickMs: config.tickMs,
        ticker,
        pathService,
        mapService,
        npcManager,
        cacheEnv,
        serverName: config.serverName,
        maxPlayers: config.maxPlayers,
        gamemode,
    });
    logger.info("Boot: WebSocket server constructed");

    // Initialize spell-widget mappings from cache (must happen after gamemode registers SpellDataProvider)
    logger.info("Boot: initializing spell-widget mappings from cache...");
    initSpellWidgetMapping(cacheEnv.info, cacheEnv.cacheSystem);
    logger.info("Boot: spell-widget mappings initialized");

    // Start the game tick
    ticker.start();
    logger.info("Boot: game ticker started");

    // Graceful shutdown
    const shutdown = (signal: string) => () => {
        logger.info(`Received ${signal}, shutting down...`);
        ticker.stop();
        process.exit(0);
    };
    process.on("SIGINT", shutdown("SIGINT"));
    process.on("SIGTERM", shutdown("SIGTERM"));
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});

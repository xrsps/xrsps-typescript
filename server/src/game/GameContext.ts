import type { GameTicker } from "./ticker";
import type { GamemodeDefinition } from "./gamemodes/GamemodeDefinition";
import type { NpcManager } from "./npcManager";
import type { PlayerState } from "./player";
import type { PathService } from "../pathfinding/PathService";
import type { MapCollisionService } from "../world/MapCollisionService";
import type { CacheEnv } from "../world/CacheEnv";
import type { DataLoaderService } from "./services/DataLoaderService";
import type { AuthenticationService } from "../network/AuthenticationService";
import type { PlayerNetworkLayer } from "../network/PlayerNetworkLayer";

/**
 * Central service container for the game server.
 * Owns all subsystem references and provides access to shared state.
 *
 * Replaces WSServer as the dependency root — services receive GameContext
 * (or narrow interfaces extracted from it) instead of reaching into WSServer.
 *
 * Populated incrementally: initially holds only Phase 1 services,
 * with more services added as extraction progresses.
 */
export class GameContext {
    readonly ticker: GameTicker;
    readonly gamemode: GamemodeDefinition;
    readonly npcManager: NpcManager | undefined;
    readonly pathService: PathService | undefined;
    readonly mapService: MapCollisionService | undefined;
    readonly cacheEnv: CacheEnv | undefined;

    // Phase 1 services
    readonly dataLoaders: DataLoaderService;
    readonly auth: AuthenticationService;
    readonly network: PlayerNetworkLayer;

    // Player manager is set after construction (needs services wired first)
    private _players: any | undefined;

    constructor(opts: {
        ticker: GameTicker;
        gamemode: GamemodeDefinition;
        npcManager?: NpcManager;
        pathService?: PathService;
        mapService?: MapCollisionService;
        cacheEnv?: CacheEnv;
        dataLoaders: DataLoaderService;
        auth: AuthenticationService;
        network: PlayerNetworkLayer;
    }) {
        this.ticker = opts.ticker;
        this.gamemode = opts.gamemode;
        this.npcManager = opts.npcManager;
        this.pathService = opts.pathService;
        this.mapService = opts.mapService;
        this.cacheEnv = opts.cacheEnv;
        this.dataLoaders = opts.dataLoaders;
        this.auth = opts.auth;
        this.network = opts.network;
    }

    getCurrentTick(): number {
        return this.ticker.currentTick();
    }

    setPlayers(players: any): void {
        this._players = players;
    }

    getPlayers(): any | undefined {
        return this._players;
    }

    getPlayerById(id: number): PlayerState | undefined {
        return this._players?.getById(id);
    }
}

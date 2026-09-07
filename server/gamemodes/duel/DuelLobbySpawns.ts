import { CollisionFlag } from "../../../client/common/CollisionFlag";
import { DUEL_LOBBY_BOUNDS, DUEL_LOBBY_CENTER } from "../../../client/common/duel/DuelProtocol";
import { DUEL_SHOPKEEPER } from "../../../client/common/duel/DuelShop";
import { buildDuelLobbyCollision, DUEL_LOBBY_SCENE_BOUNDS } from "./DuelLobbyScene";

type Tile = {x:number;y:number};
type Occupant = {id:number;tileX:number;tileY:number;level:number};
const collision = buildDuelLobbyCollision();
const blocked = CollisionFlag.OBJECT | CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION;

export function isDuelLobbyWalkable(x:number,y:number):boolean {
    const bounds=DUEL_LOBBY_BOUNDS;
    return x>=bounds.minX && x<=bounds.maxX && y>=bounds.minY && y<=bounds.maxY &&
        (collision.getFlag(x-DUEL_LOBBY_SCENE_BOUNDS.minX,y-DUEL_LOBBY_SCENE_BOUNDS.minY)&blocked)===0;
}

// Arrivals start around the plaza, expanding outward as it fills. Every candidate
// is an actual clear floor tile; nobody is placed in palms, benches, or a chest.
export const DUEL_LOBBY_SPAWN_TILES: readonly Tile[] = (() => {
    const tiles:Tile[]=[];
    const bounds=DUEL_LOBBY_BOUNDS;
    for (let x=bounds.minX+1;x<bounds.maxX;x++) for (let y=bounds.minY+1;y<bounds.maxY;y++) {
        if (isDuelLobbyWalkable(x,y) && !(x===DUEL_SHOPKEEPER.x && y===DUEL_SHOPKEEPER.y)) tiles.push({x,y});
    }
    const distance=(tile:Tile)=>Math.max(Math.abs(tile.x-DUEL_LOBBY_CENTER.x),Math.abs(tile.y-DUEL_LOBBY_CENTER.y));
    return tiles.sort((a,b)=>distance(a)-distance(b) || a.y-b.y || a.x-b.x);
})();

export function findDuelLobbySpawn(playerId:number,players:Iterable<Occupant>):Tile {
    const occupied=new Set<string>();
    for (const player of players) {
        if (player.id!==playerId && player.level===DUEL_LOBBY_CENTER.level) occupied.add(`${player.tileX},${player.tileY}`);
    }
    const tile=DUEL_LOBBY_SPAWN_TILES.find((candidate)=>!occupied.has(`${candidate.x},${candidate.y}`));
    if (!tile) throw new Error("The courtyard is full. Please try again shortly.");
    return {...tile};
}

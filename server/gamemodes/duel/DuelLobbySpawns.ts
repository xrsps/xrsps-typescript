import { CollisionFlag } from "../../../client/common/CollisionFlag";
import { DUEL_LOBBY_BOUNDS, DUEL_LOBBY_CENTER } from "../../../client/common/duel/DuelProtocol";
import { DUEL_SHOPKEEPER } from "../../../client/common/duel/DuelShop";
import { buildDuelLobbyCollision, DUEL_LOBBY_SCENE_BOUNDS } from "./DuelLobbyScene";

type Tile = {x:number;y:number};
type Occupant = {id:number;tileX:number;tileY:number;level:number};
const collision = buildDuelLobbyCollision();
const blocked = CollisionFlag.OBJECT | CollisionFlag.OBJECT_ROUTE_BLOCKER | CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION;

export function isDuelLobbyWalkable(x:number,y:number):boolean {
    const bounds=DUEL_LOBBY_BOUNDS;
    return Number.isInteger(x) && Number.isInteger(y) && x>=bounds.minX && x<=bounds.maxX && y>=bounds.minY && y<=bounds.maxY &&
        (collision.getFlag(x-DUEL_LOBBY_SCENE_BOUNDS.minX,y-DUEL_LOBBY_SCENE_BOUNDS.minY)&blocked)===0;
}

// Follow native wall/door collision so arrivals cannot land inside a closed room.
export const DUEL_LOBBY_SPAWN_TILES: readonly Tile[] = (() => {
    const tiles:Tile[]=[{x:DUEL_LOBBY_CENTER.x,y:DUEL_LOBBY_CENTER.y}];
    const reached=new Set([`${DUEL_LOBBY_CENTER.x},${DUEL_LOBBY_CENTER.y}`]);
    const directions=[[-1,0,CollisionFlag.BLOCK_WEST],[1,0,CollisionFlag.BLOCK_EAST],
        [0,-1,CollisionFlag.BLOCK_SOUTH],[0,1,CollisionFlag.BLOCK_NORTH]];
    for (let index=0;index<tiles.length;index++) for (const [dx,dy,mask] of directions) {
        const x=tiles[index].x+dx,y=tiles[index].y+dy,key=`${x},${y}`;
        if (reached.has(key) || !isDuelLobbyWalkable(x,y) ||
            (collision.getFlag(x-DUEL_LOBBY_SCENE_BOUNDS.minX,y-DUEL_LOBBY_SCENE_BOUNDS.minY)&mask)!==0) continue;
        reached.add(key); tiles.push({x,y});
    }
    const distance=(tile:Tile)=>Math.max(Math.abs(tile.x-DUEL_LOBBY_CENTER.x),Math.abs(tile.y-DUEL_LOBBY_CENTER.y));
    return tiles.filter(tile=>!(tile.x===DUEL_SHOPKEEPER.x && tile.y===DUEL_SHOPKEEPER.y))
        .sort((a,b)=>distance(a)-distance(b) || a.y-b.y || a.x-b.x);
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

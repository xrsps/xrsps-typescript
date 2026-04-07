export type Vec2 = { x: number; y: number };

export interface TrackedNode<T = unknown> {
    key: string;
    tile: Vec2;
    level: number;
    expiryTick: number;
    data: T;
}

export interface IResourceNodeTracker<T = unknown> {
    has(key: string): boolean;
    get(key: string): TrackedNode<T> | undefined;
    getByTile(tile: Vec2, level: number): TrackedNode<T> | undefined;
    hasTile(tile: Vec2, level: number): boolean;
    add(key: string, tile: Vec2, level: number, expiryTick: number, data: T): void;
    addWithRandomDuration(
        key: string,
        tile: Vec2,
        level: number,
        currentTick: number,
        durationRange: { min: number; max: number },
        data: T,
    ): void;
    remove(key: string): boolean;
    processExpired(currentTick: number, callback: (node: TrackedNode<T>) => void): void;
    readonly size: number;
}

export function buildTileKey(tile: Vec2, level: number): string {
    return `${level}:${tile.x}:${tile.y}`;
}

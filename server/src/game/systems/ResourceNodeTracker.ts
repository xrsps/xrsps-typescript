export type Vec2 = { x: number; y: number };

export interface TrackedNode<T = unknown> {
    key: string;
    tile: Vec2;
    level: number;
    expiryTick: number;
    data: T;
}

export class ResourceNodeTracker<T = unknown> {
    private nodes = new Map<string, TrackedNode<T>>();

    has(key: string): boolean {
        return this.nodes.has(key);
    }

    get(key: string): TrackedNode<T> | undefined {
        return this.nodes.get(key);
    }

    getByTile(tile: Vec2, level: number): TrackedNode<T> | undefined {
        return this.nodes.get(buildTileKey(tile, level));
    }

    hasTile(tile: Vec2, level: number): boolean {
        return this.nodes.has(buildTileKey(tile, level));
    }

    add(key: string, tile: Vec2, level: number, expiryTick: number, data: T): void {
        if (this.nodes.has(key)) return;
        this.nodes.set(key, { key, tile, level, expiryTick, data });
    }

    addWithRandomDuration(
        key: string,
        tile: Vec2,
        level: number,
        currentTick: number,
        durationRange: { min: number; max: number },
        data: T,
    ): void {
        if (this.nodes.has(key)) return;
        const duration = randomInRange(durationRange.min, durationRange.max);
        this.add(key, tile, level, currentTick + duration, data);
    }

    remove(key: string): boolean {
        return this.nodes.delete(key);
    }

    processExpired(currentTick: number, callback: (node: TrackedNode<T>) => void): void {
        for (const [key, node] of this.nodes.entries()) {
            if (currentTick < node.expiryTick) continue;
            this.nodes.delete(key);
            callback(node);
        }
    }

    get size(): number {
        return this.nodes.size;
    }
}

export function buildTileKey(tile: Vec2, level: number): string {
    return `${level}:${tile.x}:${tile.y}`;
}

function randomInRange(min: number, max: number): number {
    const clampedMin = Math.max(1, Math.floor(min));
    const clampedMax = Math.max(clampedMin, Math.floor(max));
    if (clampedMax === clampedMin) return clampedMin;
    const span = clampedMax - clampedMin + 1;
    return clampedMin + Math.floor(Math.random() * span);
}

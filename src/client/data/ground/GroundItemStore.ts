import {
    GroundItemStackMessage,
    GroundItemsServerPayload,
} from "../../../network/ServerConnection";

export type ClientGroundItemStack = GroundItemStackMessage & {
    name: string;
    gePrice: number;
    haPrice: number;
    tradeable: boolean;
};

export type GroundItemOverlayEntry = {
    tileX: number;
    tileY: number;
    level: number;
    label: string;
    color?: number;
    timerLabel?: string;
    timerColor?: number;
    line?: number;
};

export type GroundItemMetadata = {
    name: string;
    gePrice: number;
    haPrice: number;
    tradeable: boolean;
};

type ResolveMetadata = (itemId: number) => GroundItemMetadata;

const DEFAULT_METADATA_RESOLVER: ResolveMetadata = (itemId: number) => ({
    name: `Item ${itemId | 0}`,
    gePrice: 0,
    haPrice: 0,
    tradeable: false,
});

export class GroundItemStore {
    private stacksByTile = new Map<string, ClientGroundItemStack[]>();
    private stacksById = new Map<number, ClientGroundItemStack>();
    private listeners = new Set<() => void>();
    private resolveMetadata: ResolveMetadata = DEFAULT_METADATA_RESOLVER;
    private version = 0;

    private normalizeStack(stack: GroundItemStackMessage): ClientGroundItemStack | undefined {
        if (!stack || !(stack.id > 0) || !(stack.itemId > 0)) return undefined;
        const tile = stack.tile ? stack.tile : { x: 0, y: 0, level: 0 };
        const metadata = this.resolveMetadata(stack.itemId | 0);
        return {
            id: stack.id | 0,
            itemId: stack.itemId | 0,
            quantity: Math.max(1, stack.quantity | 0),
            tile: { x: tile.x | 0, y: tile.y | 0, level: tile.level | 0 },
            createdTick:
                Number.isFinite(stack.createdTick) && (stack.createdTick as number) >= 0
                    ? (stack.createdTick as number) | 0
                    : undefined,
            privateUntilTick:
                Number.isFinite(stack.privateUntilTick) && (stack.privateUntilTick as number) > 0
                    ? (stack.privateUntilTick as number) | 0
                    : undefined,
            expiresTick:
                Number.isFinite(stack.expiresTick) && (stack.expiresTick as number) > 0
                    ? (stack.expiresTick as number) | 0
                    : undefined,
            ownerId:
                Number.isFinite(stack.ownerId) && (stack.ownerId as number) >= 0
                    ? (stack.ownerId as number) | 0
                    : undefined,
            isPrivate: stack.isPrivate === true,
            ownership:
                stack.ownership === 0 ||
                stack.ownership === 1 ||
                stack.ownership === 2 ||
                stack.ownership === 3
                    ? stack.ownership
                    : 0,
            name:
                typeof metadata.name === "string" && metadata.name.length > 0
                    ? metadata.name
                    : `Item ${stack.itemId | 0}`,
            gePrice: Math.max(0, metadata.gePrice | 0),
            haPrice: Math.max(0, metadata.haPrice | 0),
            tradeable: metadata.tradeable === true,
        };
    }

    private removeEntry(entry: ClientGroundItemStack): void {
        const key = this.tileKey(entry.tile.x | 0, entry.tile.y | 0, entry.tile.level | 0);
        const list = this.stacksByTile.get(key);
        if (!list) return;
        const next = list.filter((stack) => (stack.id | 0) !== (entry.id | 0));
        if (next.length > 0) this.stacksByTile.set(key, next);
        else this.stacksByTile.delete(key);
    }

    private upsertEntry(entry: ClientGroundItemStack): void {
        const existing = this.stacksById.get(entry.id | 0);
        if (existing) {
            this.removeEntry(existing);
        }
        const key = this.tileKey(entry.tile.x | 0, entry.tile.y | 0, entry.tile.level | 0);
        const list = this.stacksByTile.get(key);
        if (list) list.push(entry);
        else this.stacksByTile.set(key, [entry]);
        this.stacksById.set(entry.id | 0, entry);
    }

    update(payload: GroundItemsServerPayload | undefined): void {
        if (!payload) {
            this.stacksByTile.clear();
            this.stacksById.clear();
            this.notify();
            return;
        }
        if (payload.kind === "snapshot") {
            this.stacksByTile.clear();
            this.stacksById.clear();
            for (const stack of payload.stacks) {
                const entry = this.normalizeStack(stack);
                if (!entry) continue;
                this.upsertEntry(entry);
            }
            this.notify();
            return;
        }

        const removes = Array.isArray(payload.removes) ? payload.removes : [];
        for (const stackId of removes) {
            const existing = this.stacksById.get(stackId | 0);
            if (!existing) continue;
            this.removeEntry(existing);
            this.stacksById.delete(stackId | 0);
        }
        const upserts = Array.isArray(payload.upserts) ? payload.upserts : [];
        for (const stack of upserts) {
            const entry = this.normalizeStack(stack);
            if (!entry) continue;
            this.upsertEntry(entry);
        }
        this.notify();
    }

    setMetadataResolver(fn?: ResolveMetadata): void {
        this.resolveMetadata = fn ? fn : DEFAULT_METADATA_RESOLVER;
    }

    setNameResolver(fn?: (itemId: number) => string): void {
        if (!fn) {
            this.resolveMetadata = DEFAULT_METADATA_RESOLVER;
            return;
        }
        this.resolveMetadata = (itemId: number) => ({
            ...DEFAULT_METADATA_RESOLVER(itemId),
            name: fn(itemId),
        });
    }

    /**
     * Clear all ground items - used on disconnect/logout.
     */
    clear(): void {
        this.stacksByTile.clear();
        this.stacksById.clear();
        this.notify();
    }

    subscribe(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    getVersion(): number {
        return this.version | 0;
    }

    getStacksAt(tileX: number, tileY: number, level: number): ClientGroundItemStack[] {
        const key = this.tileKey(tileX | 0, tileY | 0, level | 0);
        const list = this.stacksByTile.get(key);
        if (!list || list.length === 0) return [];
        return list.map((entry) => ({ ...entry, tile: { ...entry.tile } }));
    }

    getStackById(stackId: number): ClientGroundItemStack | undefined {
        const entry = this.stacksById.get(stackId | 0);
        if (!entry) return undefined;
        return { ...entry, tile: { ...entry.tile } };
    }

    getAllStacks(): ClientGroundItemStack[] {
        const result: ClientGroundItemStack[] = [];
        for (const list of this.stacksByTile.values()) {
            for (const stack of list) {
                result.push({ ...stack, tile: { ...stack.tile } });
            }
        }
        return result;
    }

    getStacksInRadius(
        centerX: number,
        centerY: number,
        level: number,
        opts: { radius?: number; maxEntries?: number } = {},
    ): ClientGroundItemStack[] {
        const radius = Math.max(1, typeof opts.radius === "number" ? opts.radius : 12);
        const maxEntries = Math.max(1, typeof opts.maxEntries === "number" ? opts.maxEntries : 512);
        const result: ClientGroundItemStack[] = [];

        for (const [key, stacks] of this.stacksByTile.entries()) {
            if (!stacks || stacks.length === 0) continue;
            const [lvlStr, xStr, yStr] = key.split("|");
            const lvl = Number(lvlStr) | 0;
            if (lvl !== (level | 0)) continue;

            const tileX = Number(xStr) | 0;
            const tileY = Number(yStr) | 0;
            const dx = Math.abs(tileX - (centerX | 0));
            const dy = Math.abs(tileY - (centerY | 0));
            if (Math.max(dx, dy) > radius) continue;

            for (const stack of stacks) {
                result.push({ ...stack, tile: { ...stack.tile } });
                if (result.length >= maxEntries) {
                    return result;
                }
            }
        }

        return result;
    }

    getOverlayEntries(
        centerX: number,
        centerY: number,
        level: number,
        opts: { radius?: number; maxEntries?: number } = {},
    ): GroundItemOverlayEntry[] {
        const radius = Math.max(1, typeof opts.radius === "number" ? opts.radius : 12);
        const maxEntries = Math.max(1, typeof opts.maxEntries === "number" ? opts.maxEntries : 40);
        const entries: GroundItemOverlayEntry[] = [];
        const visited = new Set<string>();
        for (const [key, stacks] of this.stacksByTile.entries()) {
            if (!stacks || stacks.length === 0) continue;
            const [lvlStr, xStr, yStr] = key.split("|");
            const lvl = Number(lvlStr) | 0;
            if (lvl !== (level | 0)) continue;
            const tileX = Number(xStr) | 0;
            const tileY = Number(yStr) | 0;
            const dx = Math.abs(tileX - (centerX | 0));
            const dy = Math.abs(tileY - (centerY | 0));
            if (Math.max(dx, dy) > radius) continue;
            for (const stack of stacks) {
                const label = stack.quantity > 1 ? `${stack.name} (${stack.quantity})` : stack.name;
                const entryKey = `${stack.id}`;
                if (visited.has(entryKey)) continue;
                visited.add(entryKey);
                entries.push({
                    tileX,
                    tileY,
                    level: lvl,
                    label,
                });
                if (entries.length >= maxEntries) return entries;
            }
        }
        return entries;
    }

    private tileKey(x: number, y: number, level: number): string {
        return `${level}|${x}|${y}`;
    }

    private notify(): void {
        this.version = (this.version + 1) | 0;
        for (const cb of this.listeners) {
            try {
                cb();
            } catch (err) {
                console.log("ground item listener error", err);
            }
        }
    }
}

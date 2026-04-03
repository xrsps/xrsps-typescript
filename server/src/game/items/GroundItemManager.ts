import { getItemDefinition } from "../../data/items";

/**
 * OSRS Ground Item Timings (docs/ground-items.md):
 * - Items are private (only visible to dropper) for 60 seconds (100 ticks)
 * - Tradeable items: 60s private + 120s public = 180s total (300 ticks)
 * - Untradeable items: 180s private-only (300 ticks)
 * - Monster drops: 60s private + until despawn public = 200 ticks total (~120 seconds)
 * - Wilderness consumables (food/potions): 15 seconds (25 ticks)
 * - Max 128 unique item stacks per tile
 */
export const GROUND_ITEM_PRIVATE_TICKS = 100; // 60 seconds
export const GROUND_ITEM_TRADEABLE_TOTAL_TICKS = 300; // 180 seconds for tradeable (60s private + 120s public)
export const GROUND_ITEM_UNTRADEABLE_TOTAL_TICKS = 300; // 180 seconds for untradeable (private only)
export const GROUND_ITEM_MONSTER_DROP_TICKS = 200; // ~120 seconds for monster drops
export const GROUND_ITEM_WILDERNESS_CONSUMABLE_TICKS = 25; // 15 seconds for wilderness consumables
export const GROUND_ITEM_MAX_STACKS_PER_TILE = 128; // OSRS limit

export type GroundItemStack = {
    id: number;
    itemId: number;
    quantity: number;
    tile: { x: number; y: number; level: number };
    /** WorldView this item belongs to (-1 = top-level, >=0 = nested entity index). */
    worldViewId: number;
    createdTick: number;
    ownerId?: number;
    privateUntilTick?: number;
    expiresTick?: number;
};

export type SpawnGroundItemOptions = {
    ownerId?: number;
    privateTicks?: number;
    durationTicks?: number;
    /** If true, uses monster drop timing (200 ticks) */
    isMonsterDrop?: boolean;
    /** If true, item is in wilderness (immediate visibility for non-consumables) */
    isWilderness?: boolean;
    /** If true, item is a consumable (food/potion) - fast despawn in wilderness */
    isConsumable?: boolean;
};

const TILE_KEY_SEPARATOR = ":";

type StackIndexEntry = { key: string; stack: GroundItemStack };

export class GroundItemManager {
    private stacksByTile = new Map<string, GroundItemStack[]>();
    private stacksById = new Map<number, StackIndexEntry>();
    private nextId = 1;
    private serial = 1;

    constructor(
        private readonly opts?: { defaultDurationTicks?: number; defaultPrivateTicks?: number },
    ) {}

    private tileKey(x: number, y: number, level: number, worldViewId: number = -1): string {
        return `${worldViewId}${TILE_KEY_SEPARATOR}${level}${TILE_KEY_SEPARATOR}${x}${TILE_KEY_SEPARATOR}${y}`;
    }

    getSerial(): number {
        return this.serial;
    }

    private bumpSerial(): void {
        this.serial = this.serial + 1;
        if (this.serial <= 0) this.serial = 1;
    }

    private isPrivateForOthers(
        ownerId: number | undefined,
        privateUntilTick: number | undefined,
        currentTick: number,
    ): boolean {
        return (
            ownerId !== undefined &&
            privateUntilTick !== undefined &&
            privateUntilTick > currentTick
        );
    }

    spawn(
        itemId: number,
        quantity: number,
        tile: { x: number; y: number; level: number },
        currentTick: number,
        opts?: SpawnGroundItemOptions,
        worldViewId: number = -1,
    ): GroundItemStack | undefined {
        if (!(itemId > 0) || !(quantity > 0)) return undefined;
        const def = getItemDefinition(itemId);
        if (!def) return undefined;
        const key = this.tileKey(tile.x, tile.y, tile.level, worldViewId);
        const list = this.stacksByTile.get(key) ?? [];
        const isStackable = def.stackable;

        // OSRS: Max 128 unique item stacks per tile
        // Determine duration based on item type and context
        // Priority: 1. Per-spawn override, 2. Context-specific (wilderness/monster), 3. Item-specific (tradeable), 4. Constructor default
        let duration: number;
        if (opts?.durationTicks !== undefined) {
            // Explicit per-spawn override takes highest priority
            duration = Math.max(0, opts.durationTicks);
        } else if (opts?.isWilderness && opts?.isConsumable) {
            // Wilderness consumables despawn fast (15 seconds)
            duration = GROUND_ITEM_WILDERNESS_CONSUMABLE_TICKS;
        } else if (opts?.isMonsterDrop) {
            // Monster drops use shorter timer
            duration = GROUND_ITEM_MONSTER_DROP_TICKS;
        } else if (def.tradeable) {
            // Standard tradeable items: 180 seconds total
            duration = GROUND_ITEM_TRADEABLE_TOTAL_TICKS;
        } else {
            // Untradeable items: 180 seconds private-only
            duration = GROUND_ITEM_UNTRADEABLE_TOTAL_TICKS;
        }

        // Determine private duration
        let privateTicks: number;
        if (opts?.privateTicks !== undefined) {
            privateTicks = Math.max(0, opts.privateTicks);
        } else if (opts?.isWilderness && !opts?.isConsumable) {
            // Wilderness non-consumables are immediately visible
            privateTicks = 0;
        } else {
            privateTicks = Math.max(0, this.opts?.defaultPrivateTicks ?? GROUND_ITEM_PRIVATE_TICKS);
        }

        const ownerId = opts?.ownerId !== undefined ? opts.ownerId : undefined;
        const privateUntilTick = privateTicks > 0 ? currentTick + privateTicks : undefined;
        const expiresTick = duration > 0 ? currentTick + duration : undefined;
        const newIsPrivate = this.isPrivateForOthers(ownerId, privateUntilTick, currentTick);
        const stack = isStackable
            ? list.find(
                  (entry) =>
                      entry.itemId === itemId &&
                      (() => {
                          const existingIsPrivate = this.isPrivateForOthers(
                              entry.ownerId,
                              entry.privateUntilTick,
                              currentTick,
                          );
                          if (existingIsPrivate !== newIsPrivate) return false;
                          if (!newIsPrivate) return true;
                          return entry.ownerId === ownerId;
                      })(),
              )
            : undefined;

        if (!stack && list.length >= GROUND_ITEM_MAX_STACKS_PER_TILE) {
            return undefined; // Can't drop here - tile is full
        }

        const base: GroundItemStack = stack ?? {
            id: this.nextId++,
            itemId: itemId,
            quantity: 0,
            tile: { x: tile.x, y: tile.y, level: tile.level },
            worldViewId,
            createdTick: currentTick,
        };
        base.quantity += quantity;
        base.ownerId = newIsPrivate ? ownerId : undefined;
        base.privateUntilTick = newIsPrivate
            ? Math.max(base.privateUntilTick ?? 0, privateUntilTick ?? 0)
            : undefined;
        base.expiresTick =
            expiresTick !== undefined
                ? Math.max(base.expiresTick ?? 0, expiresTick)
                : base.expiresTick;
        if (!stack) {
            list.push(base);
            this.stacksByTile.set(key, list);
            this.stacksById.set(base.id, { key, stack: base });
        } else {
            if (!this.stacksById.has(stack.id)) {
                this.stacksById.set(stack.id, { key, stack });
            }
        }
        this.bumpSerial();
        return base;
    }

    removeById(
        stackId: number,
        quantity: number,
        currentTick: number,
        requesterPlayerId?: number,
    ): { removed: number; remaining?: number } | undefined {
        const idxEntry = this.stacksById.get(stackId);
        if (!idxEntry) return undefined;
        const { key, stack } = idxEntry;
        const list = this.stacksByTile.get(key);
        if (!list) {
            this.stacksById.delete(stackId);
            return undefined;
        }
        const listIndex = list.indexOf(stack);
        if (listIndex === -1) {
            this.stacksById.delete(stackId);
            return undefined;
        }
        if (
            stack.privateUntilTick &&
            stack.privateUntilTick > currentTick &&
            stack.ownerId !== undefined &&
            stack.ownerId !== (requesterPlayerId ?? stack.ownerId)
        ) {
            return undefined;
        }
        const requestedQty = Number.isFinite(quantity)
            ? Math.max(1, Math.min(2147483647, Math.floor(quantity)))
            : 1;
        const removeQty = Math.min(stack.quantity, requestedQty);
        stack.quantity -= removeQty;
        if (stack.quantity <= 0) {
            list.splice(listIndex, 1);
            if (list.length === 0) {
                this.stacksByTile.delete(key);
            }
            this.stacksById.delete(stack.id);
        }
        this.bumpSerial();
        return { removed: removeQty, remaining: stack.quantity > 0 ? stack.quantity : undefined };
    }

    tick(currentTick: number): void {
        let touched = false;
        for (const [key, stacks] of this.stacksByTile.entries()) {
            for (let i = stacks.length - 1; i >= 0; i--) {
                const stack = stacks[i];
                if (stack.expiresTick && stack.expiresTick <= currentTick) {
                    stacks.splice(i, 1);
                    this.stacksById.delete(stack.id);
                    touched = true;
                }
            }
            if (stacks.length === 0) {
                this.stacksByTile.delete(key);
            }
        }
        if (touched) this.bumpSerial();
    }

    queryArea(
        centerX: number,
        centerY: number,
        level: number,
        radiusTiles: number,
        currentTick: number,
        observerPlayerId?: number,
        worldViewId: number = -1,
    ): GroundItemStack[] {
        const radius = Math.max(0, radiusTiles);
        const x0 = centerX - radius;
        const x1 = centerX + radius;
        const y0 = centerY - radius;
        const y1 = centerY + radius;
        const levelKey = level;
        const out: GroundItemStack[] = [];
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const key = this.tileKey(x, y, levelKey, worldViewId);
                const list = this.stacksByTile.get(key);
                if (!list) continue;
                for (const stack of list) {
                    if (
                        stack.privateUntilTick &&
                        stack.privateUntilTick > currentTick &&
                        stack.ownerId !== undefined &&
                        stack.ownerId !== (observerPlayerId ?? stack.ownerId)
                    ) {
                        continue;
                    }
                    out.push(stack);
                }
            }
        }
        return out;
    }
}

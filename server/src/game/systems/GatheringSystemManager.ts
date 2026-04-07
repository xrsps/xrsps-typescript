import type { IResourceNodeTracker, TrackedNode } from "./ResourceNodeTypes";

export interface GatheringSystemServices {
    emitLocChange: (
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
        opts?: { newShape?: number; newRotation?: number },
    ) => void;
    spawnGroundItem: (
        itemId: number,
        quantity: number,
        tile: { x: number; y: number; level: number },
        currentTick: number,
        opts?: { ownerId?: number; durationTicks?: number; privateTicks?: number },
    ) => void;
}

export type TrackerExpireCallback<T = unknown> = (node: TrackedNode<T>, services: GatheringSystemServices) => void;

interface RegisteredTracker {
    tracker: IResourceNodeTracker<any>;
    onExpire: TrackerExpireCallback<any>;
}

export class GatheringSystemManager {
    private registeredTrackers = new Map<string, RegisteredTracker>();
    private services: GatheringSystemServices;

    constructor(services: GatheringSystemServices) {
        this.services = services;
    }

    registerTracker<T>(name: string, tracker: IResourceNodeTracker<T>, onExpire: TrackerExpireCallback<T>): void {
        this.registeredTrackers.set(name, { tracker, onExpire });
    }

    getTracker<T = unknown>(name: string): IResourceNodeTracker<T> | undefined {
        return this.registeredTrackers.get(name)?.tracker as IResourceNodeTracker<T> | undefined;
    }

    processTick(tick: number): void {
        for (const { tracker, onExpire } of this.registeredTrackers.values()) {
            tracker.processExpired(tick, (node) => onExpire(node, this.services));
        }
    }
}

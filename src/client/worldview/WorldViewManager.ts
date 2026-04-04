import type { MapManager, MapSquare } from "../MapManager";
import { WorldEntity } from "./WorldEntity";
import { WorldView } from "./WorldView";

export class WorldViewManager {
    primaryWorldView: WorldView | null = null;
    private readonly worldViews: Map<number, WorldView> = new Map();
    private readonly worldEntities: Map<number, WorldEntity> = new Map();

    createPrimaryWorldView(sizeX: number, sizeY: number): WorldView {
        const view = new WorldView(-1, sizeX, sizeY);
        this.primaryWorldView = view;
        this.worldViews.set(-1, view);
        return view;
    }

    createWorldView(
        id: number,
        sizeX: number,
        sizeY: number,
        opts: ConstructorParameters<typeof WorldView>[3] = {},
    ): WorldView {
        const view = new WorldView(id, sizeX, sizeY, opts);
        this.worldViews.set(id, view);

        const entity = new WorldEntity(id);
        entity.ownerWorldViewId = -1;
        entity.configId = opts.configId ?? -1;
        this.worldEntities.set(id, entity);

        return view;
    }

    removeWorldView(id: number): void {
        this.worldViews.delete(id);
        this.worldEntities.delete(id);
    }

    getWorldView(id: number): WorldView | undefined {
        return this.worldViews.get(id);
    }

    getWorldViewByOverlayMapId(mapId: number): WorldView | undefined {
        for (const [id, view] of this.worldViews) {
            if (id === -1) continue;
            if ((view.overlayMapId | 0) === (mapId | 0)) {
                return view;
            }
        }
        return undefined;
    }

    getWorldEntity(entityIndex: number): WorldEntity | undefined {
        return this.worldEntities.get(entityIndex);
    }

    findWorldViewAt(tileX: number, tileY: number): WorldView | undefined {
        for (const [id, view] of this.worldViews) {
            if (id === -1) continue;
            if (view.containsTile(tileX, tileY)) {
                return view;
            }
        }
        return this.primaryWorldView ?? undefined;
    }

    getOverlayMapSquare<T extends MapSquare>(
        entityIndex: number,
        mapManager: MapManager<T>,
    ): T | undefined {
        const view = this.worldViews.get(entityIndex);
        if (!view || view.isTopLevel()) return undefined;
        return mapManager.mapSquares.get(view.overlayMapId);
    }

    addNpcToWorldView(worldViewId: number, npcEcsId: number): void {
        const view = this.worldViews.get(worldViewId);
        if (view) view.npcIds.add(npcEcsId);
    }

    removeNpcFromWorldView(worldViewId: number, npcEcsId: number): void {
        const view = this.worldViews.get(worldViewId);
        if (view) view.npcIds.delete(npcEcsId);
    }

    addPlayerToWorldView(worldViewId: number, playerEcsId: number): void {
        const view = this.worldViews.get(worldViewId);
        if (view) view.playerIds.add(playerEcsId);
    }

    removePlayerFromWorldView(worldViewId: number, playerEcsId: number): void {
        const view = this.worldViews.get(worldViewId);
        if (view) view.playerIds.delete(playerEcsId);
    }

    interpolateEntities(cycle: number, cycleFraction: number): void {
        for (const entity of this.worldEntities.values()) {
            entity.interpolatePath(cycle, cycleFraction);
        }
    }

    clear(): void {
        for (const [id] of this.worldViews) {
            if (id !== -1) {
                this.worldViews.delete(id);
                this.worldEntities.delete(id);
            }
        }
    }

    [Symbol.iterator](): IterableIterator<WorldView> {
        return this.worldViews.values();
    }
}

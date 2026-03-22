/**
 * Loads and indexes door definitions from JSON data files.
 * Supports hot-reloading for development.
 */
import fs from "fs";
import path from "path";

import { logger } from "../utils/logger";
import { readDoorCatalog, resolveDoorCatalogPath } from "./DoorCatalogFile";
import { DoubleDoorDef, GateDef, SingleDoorDef } from "./DoorDefinitions";

export class DoorDefinitionLoader {
    // closedId -> full SingleDoorDef
    private singleDoors: Map<number, SingleDoorDef> = new Map();
    // openedId -> full SingleDoorDef (reverse lookup)
    private singleDoorsReverse: Map<number, SingleDoorDef> = new Map();
    // any gate ID in gate set -> full definition
    private gates: Map<number, GateDef> = new Map();
    // any door ID in double door set -> full definition
    private doubleDoors: Map<number, DoubleDoorDef> = new Map();

    private catalogPath: string;
    private watchEnabled: boolean;
    private fileWatchers: fs.FSWatcher[] = [];
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(catalogPath: string = "server/data/doors.json", watchEnabled: boolean = false) {
        this.catalogPath = resolveDoorCatalogPath(catalogPath);
        this.watchEnabled = watchEnabled;
        this.loadDefinitions();
        if (watchEnabled) {
            this.setupWatchers();
        }
    }

    private loadDefinitions(): void {
        const catalog = readDoorCatalog(this.catalogPath);
        this.loadSingleDoors(catalog.definitions.singleDoors);
        this.loadGates(catalog.definitions.gates);
        this.loadDoubleDoors(catalog.definitions.doubleDoors);
        logger.info(
            `[DoorDefinitionLoader] Loaded ${this.singleDoors.size} single doors, ` +
                `${this.gates.size / 4} gate sets, ${this.doubleDoors.size / 4} double door sets`,
        );
    }

    private loadSingleDoors(data: SingleDoorDef[]): void {
        try {
            this.singleDoors.clear();
            this.singleDoorsReverse.clear();
            for (const def of data) {
                if (!(def.closed > 0) || !(def.opened > 0)) {
                    logger.warn(
                        `[DoorDefinitionLoader] Invalid single door entry: ${JSON.stringify(def)}`,
                    );
                    continue;
                }
                this.singleDoors.set(def.closed, def);
                this.singleDoorsReverse.set(def.opened, def);
            }
            logger.debug(
                `[DoorDefinitionLoader] Loaded ${this.singleDoors.size} single door mappings`,
            );
        } catch (err) {
            logger.error(`[DoorDefinitionLoader] Failed to load single door definitions:`, err);
        }
    }

    private loadDoubleDoors(data: DoubleDoorDef[]): void {
        try {
            this.doubleDoors.clear();
            for (const def of data) {
                if (!this.isValidDoubleDoorDef(def)) {
                    logger.warn(
                        `[DoorDefinitionLoader] Invalid double door entry: ${JSON.stringify(def)}`,
                    );
                    continue;
                }
                // Index all 4 door IDs to the same definition for O(1) lookup
                this.doubleDoors.set(def.closed.left, def);
                this.doubleDoors.set(def.closed.right, def);
                this.doubleDoors.set(def.opened.left, def);
                this.doubleDoors.set(def.opened.right, def);
            }
            logger.debug(
                `[DoorDefinitionLoader] Loaded ${this.doubleDoors.size / 4} double door sets`,
            );
        } catch (err) {
            logger.error(`[DoorDefinitionLoader] Failed to load double door definitions:`, err);
        }
    }

    private loadGates(data: GateDef[]): void {
        try {
            this.gates.clear();
            for (const def of data) {
                if (!this.isValidGateDef(def)) {
                    logger.warn(
                        `[DoorDefinitionLoader] Invalid gate entry: ${JSON.stringify(def)}`,
                    );
                    continue;
                }
                this.gates.set(def.closed.hinge, def);
                this.gates.set(def.closed.extension, def);
                this.gates.set(def.opened.hinge, def);
                this.gates.set(def.opened.extension, def);
            }
            logger.debug(`[DoorDefinitionLoader] Loaded ${this.gates.size / 4} gate sets`);
        } catch (err) {
            logger.error(`[DoorDefinitionLoader] Failed to load gate definitions:`, err);
        }
    }

    private isValidDoubleDoorDef(def: DoubleDoorDef): boolean {
        return (
            def.closed.left > 0 &&
            def.closed.right > 0 &&
            def.opened.left > 0 &&
            def.opened.right > 0
        );
    }

    private isValidGateDef(def: GateDef): boolean {
        const openStyle = def.openStyle;
        const validOpenStyle =
            openStyle === undefined || openStyle === "hinge" || openStyle === "center";
        return (
            def.closed.hinge > 0 &&
            def.closed.extension > 0 &&
            def.opened.hinge > 0 &&
            def.opened.extension > 0 &&
            validOpenStyle
        );
    }

    private setupWatchers(): void {
        const watchFile = (filePath: string, reloadFn: () => void) => {
            if (!fs.existsSync(filePath)) return;
            try {
                const watcher = fs.watch(filePath, (eventType) => {
                    if (eventType !== "change") return;
                    // Debounce rapid file changes
                    const existing = this.debounceTimers.get(filePath);
                    if (existing) clearTimeout(existing);
                    this.debounceTimers.set(
                        filePath,
                        setTimeout(() => {
                            logger.info(
                                `[DoorDefinitionLoader] Hot-reloading ${path.basename(filePath)}`,
                            );
                            reloadFn();
                            this.debounceTimers.delete(filePath);
                        }, 100),
                    );
                });
                this.fileWatchers.push(watcher);
            } catch (err) {
                logger.error(`[DoorDefinitionLoader] Failed to watch ${filePath}:`, err);
            }
        };

        watchFile(this.catalogPath, () => this.loadDefinitions());
    }

    // === Query Methods ===

    /**
     * Get the single door pair for a loc ID.
     * Returns both closed and opened IDs regardless of which was passed.
     */
    getSingleDoorPair(locId: number): SingleDoorDef | undefined {
        const id = locId;
        // Check if this is an opened door (reverse lookup)
        const byOpened = this.singleDoorsReverse.get(id);
        if (byOpened !== undefined) {
            return byOpened;
        }
        // Check if this is a closed door
        return this.singleDoors.get(id);
    }

    /**
     * Get the double door definition for a loc ID.
     * Works with any of the 4 IDs in the double door set.
     */
    getDoubleDoorDef(locId: number): DoubleDoorDef | undefined {
        return this.doubleDoors.get(locId);
    }

    /**
     * Get the gate definition for a loc ID.
     * Works with any of the 4 IDs in the gate set.
     */
    getGateDef(locId: number): GateDef | undefined {
        return this.gates.get(locId);
    }

    /**
     * Check if a loc ID is a known closed door (single or double).
     */
    isClosedDoor(locId: number): boolean {
        const id = locId;
        if (this.singleDoors.has(id)) return true;
        const dd = this.doubleDoors.get(id);
        return dd !== undefined && (dd.closed.left === id || dd.closed.right === id);
    }

    /**
     * Check if a loc ID is a known opened door (single or double).
     */
    isOpenedDoor(locId: number): boolean {
        const id = locId;
        if (this.singleDoorsReverse.has(id)) return true;
        const dd = this.doubleDoors.get(id);
        return dd !== undefined && (dd.opened.left === id || dd.opened.right === id);
    }

    /**
     * Check if a loc ID is any known door (single or double, open or closed).
     */
    isKnownDoor(locId: number): boolean {
        const id = locId;
        return (
            this.singleDoors.has(id) ||
            this.singleDoorsReverse.has(id) ||
            this.gates.has(id) ||
            this.doubleDoors.has(id)
        );
    }

    /**
     * Get the partner ID for a double door.
     * Returns undefined if not a double door or partner not found.
     */
    getDoubleDoorPartner(locId: number): number | undefined {
        const id = locId;
        const def = this.doubleDoors.get(id);
        if (!def) return undefined;

        // Find which position this ID is in and return its partner
        if (def.closed.left === id) return def.closed.right;
        if (def.closed.right === id) return def.closed.left;
        if (def.opened.left === id) return def.opened.right;
        if (def.opened.right === id) return def.opened.left;
        return undefined;
    }

    /**
     * Get all single door definitions (for debugging/export).
     */
    getAllSingleDoors(): SingleDoorDef[] {
        return Array.from(this.singleDoors.values());
    }

    /**
     * Get all double door definitions (for debugging/export).
     */
    getAllDoubleDoors(): DoubleDoorDef[] {
        const seen = new Set<string>();
        const result: DoubleDoorDef[] = [];
        for (const def of this.doubleDoors.values()) {
            const key = `${def.closed.left}-${def.closed.right}-${def.opened.left}-${def.opened.right}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(def);
        }
        return result;
    }

    /**
     * Clean up file watchers on shutdown.
     */
    dispose(): void {
        for (const watcher of this.fileWatchers) {
            watcher.close();
        }
        this.fileWatchers = [];
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }
}

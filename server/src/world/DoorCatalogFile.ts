import fs from "fs";
import path from "path";

import { DoubleDoorDef, GateDef, SingleDoorDef } from "./DoorDefinitions";

export type RuntimeTilePairStats = {
    closed: number;
    opened: number;
    count: number;
    lastObserved: string;
};

export type RuntimeTileEntry = {
    level: number;
    x: number;
    y: number;
    pairs: RuntimeTilePairStats[];
};

export type PersistedRuntimeDoorTileMap = {
    version: 1;
    generatedAt: string;
    entries: RuntimeTileEntry[];
};

export type PersistedDoorCatalog = {
    version: 1;
    definitions: {
        singleDoors: SingleDoorDef[];
        doubleDoors: DoubleDoorDef[];
        gates: GateDef[];
    };
    runtimeTileMappings: PersistedRuntimeDoorTileMap;
};

const EPOCH_ISO = new Date(0).toISOString();

function isRecord(value: unknown): value is Record<string, unknown> {
    return Object(value) === value && !Array.isArray(value);
}

function isDoorCatalog(value: unknown): value is PersistedDoorCatalog {
    return isRecord(value) && isRecord(value.definitions) && isRecord(value.runtimeTileMappings);
}

function usesCombinedCatalog(filePath: string): boolean {
    if (path.basename(filePath).toLowerCase() === "doors.json") {
        return true;
    }
    if (!fs.existsSync(filePath)) {
        return false;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return isDoorCatalog(parsed);
    } catch {
        return false;
    }
}

function normalizeSingleDoors(value: unknown): SingleDoorDef[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => {
            const e = entry as SingleDoorDef | undefined;
            const normalized: SingleDoorDef = {
                closed: e?.closed ?? -1,
                opened: e?.opened ?? -1,
            };
            // Preserve optional openDir field — "cw" is the default and can be omitted.
            if (e?.openDir === "cw" || e?.openDir === "ccw") {
                normalized.openDir = e.openDir;
            }
            return normalized;
        })
        .filter((entry) => entry.closed > 0 && entry.opened > 0 && entry.closed !== entry.opened)
        .sort((a, b) => a.closed - b.closed || a.opened - b.opened);
}

function normalizeDoubleDoors(value: unknown): DoubleDoorDef[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => ({
            closed: {
                left: (entry as DoubleDoorDef | undefined)?.closed?.left ?? -1,
                right: (entry as DoubleDoorDef | undefined)?.closed?.right ?? -1,
            },
            opened: {
                left: (entry as DoubleDoorDef | undefined)?.opened?.left ?? -1,
                right: (entry as DoubleDoorDef | undefined)?.opened?.right ?? -1,
            },
        }))
        .filter(
            (entry) =>
                entry.closed.left > 0 &&
                entry.closed.right > 0 &&
                entry.opened.left > 0 &&
                entry.opened.right > 0,
        )
        .sort(
            (a, b) =>
                a.closed.left - b.closed.left ||
                a.closed.right - b.closed.right ||
                a.opened.left - b.opened.left ||
                a.opened.right - b.opened.right,
        );
}

function normalizeGates(value: unknown): GateDef[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => {
            const openStyle = (entry as GateDef | undefined)?.openStyle;
            const normalized: GateDef = {
                closed: {
                    hinge: (entry as GateDef | undefined)?.closed?.hinge ?? -1,
                    extension: (entry as GateDef | undefined)?.closed?.extension ?? -1,
                },
                opened: {
                    hinge: (entry as GateDef | undefined)?.opened?.hinge ?? -1,
                    extension: (entry as GateDef | undefined)?.opened?.extension ?? -1,
                },
            };
            if (openStyle === "center" || openStyle === "hinge") {
                normalized.openStyle = openStyle;
            }
            return normalized;
        })
        .filter(
            (entry) =>
                entry.closed.hinge > 0 &&
                entry.closed.extension > 0 &&
                entry.opened.hinge > 0 &&
                entry.opened.extension > 0 &&
                entry.closed.hinge !== entry.closed.extension &&
                entry.opened.hinge !== entry.opened.extension,
        )
        .sort(
            (a, b) =>
                a.closed.hinge - b.closed.hinge ||
                a.closed.extension - b.closed.extension ||
                a.opened.hinge - b.opened.hinge ||
                a.opened.extension - b.opened.extension,
        );
}

function normalizeRuntimeTileMappings(value: unknown): PersistedRuntimeDoorTileMap {
    const persisted = isRecord(value) ? (value as PersistedRuntimeDoorTileMap) : undefined;
    const entries = Array.isArray(persisted?.entries) ? persisted.entries : [];
    const generatedAt = persisted?.generatedAt;

    return {
        version: 1,
        generatedAt: generatedAt && generatedAt.length > 0 ? generatedAt : EPOCH_ISO,
        entries: entries
            .map((entry) => ({
                level: entry?.level ?? -1,
                x: entry?.x ?? -1,
                y: entry?.y ?? -1,
                pairs: Array.isArray(entry?.pairs)
                    ? entry.pairs
                          .map((pair) => ({
                              closed: pair?.closed ?? -1,
                              opened: pair?.opened ?? -1,
                              count: Math.max(1, pair?.count ?? 1),
                              lastObserved:
                                  pair?.lastObserved && pair.lastObserved.length > 0
                                      ? pair.lastObserved
                                      : EPOCH_ISO,
                          }))
                          .filter(
                              (pair) =>
                                  pair.closed > 0 && pair.opened > 0 && pair.closed !== pair.opened,
                          )
                          .sort(
                              (a, b) =>
                                  b.count - a.count || a.closed - b.closed || a.opened - b.opened,
                          )
                    : [],
            }))
            .filter((entry) => entry.pairs.length > 0)
            .sort((a, b) => a.level - b.level || a.x - b.x || a.y - b.y),
    };
}

function createEmptyCatalog(): PersistedDoorCatalog {
    return {
        version: 1,
        definitions: {
            singleDoors: [],
            doubleDoors: [],
            gates: [],
        },
        runtimeTileMappings: {
            version: 1,
            generatedAt: EPOCH_ISO,
            entries: [],
        },
    };
}

function readJsonIfExists(filePath: string): unknown {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function resolveDoorCatalogPath(inputPath: string): string {
    const resolved = path.resolve(inputPath);
    return resolved.endsWith(".json") ? resolved : path.join(resolved, "doors.json");
}

export function readDoorCatalog(filePath: string): PersistedDoorCatalog {
    const resolved = resolveDoorCatalogPath(filePath);
    const parsed = readJsonIfExists(resolved);
    if (!isDoorCatalog(parsed)) {
        return createEmptyCatalog();
    }

    return {
        version: 1,
        definitions: {
            singleDoors: normalizeSingleDoors(parsed.definitions.singleDoors),
            doubleDoors: normalizeDoubleDoors(parsed.definitions.doubleDoors),
            gates: normalizeGates(parsed.definitions.gates),
        },
        runtimeTileMappings: normalizeRuntimeTileMappings(parsed.runtimeTileMappings),
    };
}

export function writeDoorCatalog(filePath: string, catalog: PersistedDoorCatalog): void {
    const resolved = resolveDoorCatalogPath(filePath);
    writeJsonFile(resolved, {
        version: 1,
        definitions: {
            singleDoors: normalizeSingleDoors(catalog.definitions.singleDoors),
            doubleDoors: normalizeDoubleDoors(catalog.definitions.doubleDoors),
            gates: normalizeGates(catalog.definitions.gates),
        },
        runtimeTileMappings: normalizeRuntimeTileMappings(catalog.runtimeTileMappings),
    } satisfies PersistedDoorCatalog);
}

export function updateDoorCatalog(
    filePath: string,
    updater: (catalog: PersistedDoorCatalog) => PersistedDoorCatalog,
): PersistedDoorCatalog {
    const next = updater(readDoorCatalog(filePath));
    writeDoorCatalog(filePath, next);
    return next;
}

export function readSingleDoorDefsFromFile(filePath: string): SingleDoorDef[] {
    const parsed = readJsonIfExists(filePath);
    if (isDoorCatalog(parsed)) {
        return normalizeSingleDoors(parsed.definitions.singleDoors);
    }
    return normalizeSingleDoors(parsed);
}

export function readRuntimeTileMappingsFromFile(filePath: string): PersistedRuntimeDoorTileMap {
    const parsed = readJsonIfExists(filePath);
    if (isDoorCatalog(parsed)) {
        return normalizeRuntimeTileMappings(parsed.runtimeTileMappings);
    }
    return normalizeRuntimeTileMappings(parsed);
}

export function writeRuntimeTileMappingsToFile(
    filePath: string,
    runtimeTileMappings: PersistedRuntimeDoorTileMap,
): void {
    if (usesCombinedCatalog(filePath)) {
        updateDoorCatalog(filePath, (catalog) => ({
            ...catalog,
            runtimeTileMappings: normalizeRuntimeTileMappings(runtimeTileMappings),
        }));
        return;
    }
    writeJsonFile(filePath, normalizeRuntimeTileMappings(runtimeTileMappings));
}

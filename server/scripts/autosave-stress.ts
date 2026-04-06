import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";

import { MAX_XP, SKILL_IDS, getXpForLevel } from "../../src/rs/skill/skills";
import { DEFAULT_EQUIP_SLOT_COUNT } from "../src/game/equipment";
import {
    type BankSnapshotEntry,
    type EquipmentSnapshotEntry,
    INVENTORY_SLOT_COUNT,
    type InventorySnapshotEntry,
    type PlayerLocationSnapshot,
    type PlayerPersistentVars,
    type PlayerSkillPersistentEntry,
    PlayerState,
} from "../src/game/player";
import type { GamemodeDefinition } from "../src/game/gamemodes/GamemodeDefinition";
import { DEFAULT_BANK_CAPACITY } from "../src/game/state/PlayerBankSystem";
import { PlayerPersistence } from "../src/game/state/PlayerPersistence";

const STUB_GAMEMODE = {
    id: "stress-test",
    name: "Stress Test",
    getSkillXpMultiplier: () => 1,
    getDropRateMultiplier: () => 1,
    isDropBoostEligible: () => false,
    transformDropItemId: (_n: number, id: number) => id,
    hasInfiniteRunEnergy: () => false,
    canInteract: () => true,
    initializePlayer: () => {},
    serializePlayerState: () => undefined,
    deserializePlayerState: () => {},
    onNpcKill: () => {},
    isTutorialActive: () => false,
    getSpawnLocation: () => ({ x: 3222, y: 3218, level: 0 }),
    onPlayerHandshake: () => {},
    onPlayerLogin: () => {},
    getDisplayName: (_p: unknown, name: string) => name,
    getChatPlayerType: () => 0,
    registerHandlers: () => {},
    initialize: () => {},
} as unknown as GamemodeDefinition;

const DEFAULT_OPTIONS = {
    players: 64,
    iterations: 5,
    bankCapacity: DEFAULT_BANK_CAPACITY,
    bankFill: 0.65,
    inventoryFill: 0.85,
    equipFill: 0.75,
    varps: 64,
    varbits: 64,
    seed: 1337,
} as const;

const DEFAULT_OUTPUT_ROOT = path.resolve(process.cwd(), "tmp", "autosave-stress");

interface HarnessOptions {
    players: number;
    iterations: number;
    bankCapacity: number;
    bankFill: number;
    inventoryFill: number;
    equipFill: number;
    varps: number;
    varbits: number;
    seed: number;
    outputDir: string;
}

type HarnessResult = {
    iteration: number;
    savedPlayers: number;
    elapsedMs: number;
    fileSizeBytes: number;
    deltaBytes: number;
};

interface PlayerHandle {
    key: string;
    player: PlayerState;
    seed: number;
}

class Prng {
    private state: number;

    constructor(seed: number) {
        const normalized = seed >>> 0;
        this.state = normalized === 0 ? 0x6d2b79f5 : normalized;
    }

    next(): number {
        this.state = (this.state * 1664525 + 1013904223) >>> 0;
        return this.state / 0x100000000;
    }

    nextInt(maxExclusive: number): number {
        if (!(maxExclusive > 0)) return 0;
        return Math.floor(this.next() * maxExclusive);
    }

    nextBoolean(): boolean {
        return this.next() >= 0.5;
    }

    nextUInt32(): number {
        this.next();
        return this.state >>> 0;
    }
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function clampPositiveInt(value: number, fallback: number, max?: number): number {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    const normalized = Math.floor(value);
    if (max !== undefined) {
        return Math.min(normalized, max);
    }
    return normalized;
}

function parseCliArgs(): HarnessOptions {
    const rawArgs = process.argv.slice(2);
    const overrides: Partial<HarnessOptions & { outputDir?: string }> = {};
    for (let i = 0; i < rawArgs.length; i++) {
        const token = rawArgs[i];
        if (!token || !token.startsWith("--")) continue;
        const eqIndex = token.indexOf("=");
        const key = token.slice(2, eqIndex >= 0 ? eqIndex : undefined);
        let value = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined;
        if (value === undefined) {
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("--")) {
                value = next;
                i++;
            }
        }
        if (!value) {
            throw new Error(`Missing value for --${key}`);
        }
        switch (key) {
            case "players":
            case "iterations":
            case "bankCapacity":
            case "varps":
            case "varbits":
            case "seed": {
                overrides[key] = parseInt(value, 10) as any;
                break;
            }
            case "bankFill":
            case "inventoryFill":
            case "equipFill": {
                overrides[key] = parseFloat(value) as any;
                break;
            }
            case "outDir":
            case "output":
            case "outputDir": {
                overrides.outputDir = value;
                break;
            }
            default:
                throw new Error(`Unknown flag --${key}`);
        }
    }

    const resolved: HarnessOptions = {
        players: clampPositiveInt(
            overrides.players ?? DEFAULT_OPTIONS.players,
            DEFAULT_OPTIONS.players,
        ),
        iterations: clampPositiveInt(
            overrides.iterations ?? DEFAULT_OPTIONS.iterations,
            DEFAULT_OPTIONS.iterations,
        ),
        bankCapacity: clampPositiveInt(
            overrides.bankCapacity ?? DEFAULT_OPTIONS.bankCapacity,
            DEFAULT_OPTIONS.bankCapacity,
        ),
        bankFill: clamp01(overrides.bankFill ?? DEFAULT_OPTIONS.bankFill),
        inventoryFill: clamp01(overrides.inventoryFill ?? DEFAULT_OPTIONS.inventoryFill),
        equipFill: clamp01(overrides.equipFill ?? DEFAULT_OPTIONS.equipFill),
        varps: clampPositiveInt(overrides.varps ?? DEFAULT_OPTIONS.varps, DEFAULT_OPTIONS.varps),
        varbits: clampPositiveInt(
            overrides.varbits ?? DEFAULT_OPTIONS.varbits,
            DEFAULT_OPTIONS.varbits,
        ),
        seed: Math.floor(overrides.seed ?? DEFAULT_OPTIONS.seed) >>> 0,
        outputDir: "",
    };

    const explicitOutDir = overrides.outputDir;
    if (explicitOutDir) {
        resolved.outputDir = path.resolve(process.cwd(), explicitOutDir);
    } else {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        resolved.outputDir = path.join(DEFAULT_OUTPUT_ROOT, timestamp);
    }

    return resolved;
}

function createPlayers(count: number, rng: Prng): PlayerHandle[] {
    const players: PlayerHandle[] = [];
    for (let i = 0; i < count; i++) {
        const spawnX = 3200 + rng.nextInt(512);
        const spawnY = 3200 + rng.nextInt(512);
        const level = rng.nextInt(4);
        const player = new PlayerState(i + 1, spawnX, spawnY, level, STUB_GAMEMODE);
        const seed = rng.nextUInt32() || (i + 1) * 97;
        players.push({
            key: `player-${(i + 1).toString().padStart(4, "0")}`,
            player,
            seed,
        });
    }
    return players;
}

function scrambleSeed(seed: number, iteration: number): number {
    const mixed = (seed ^ (iteration * 0x9e3779b1)) >>> 0;
    return (mixed ^ (mixed >>> 16)) >>> 0;
}

function refreshPlayers(players: PlayerHandle[], iteration: number, opts: HarnessOptions): void {
    for (const handle of players) {
        const rng = new Prng(scrambleSeed(handle.seed, iteration + 1));
        const snapshot = createRandomSnapshot(rng, opts);
        handle.player.applyPersistentVars(snapshot);
    }
}

function createRandomSnapshot(rng: Prng, opts: HarnessOptions): PlayerPersistentVars {
    const varps = createVarMap(rng, opts.varps, 7000, 20000);
    const varbits = createVarMap(rng, opts.varbits, 4000, 4);
    const bank = createBankEntries(rng, opts.bankCapacity, opts.bankFill);
    const inventory = createInventoryEntries(rng, opts.inventoryFill);
    const equipment = createEquipmentEntries(rng, opts.equipFill);
    const skills = createSkillEntries(rng);
    const autocastEnabled = rng.nextBoolean();
    const combatSpellId = rng.nextBoolean() ? rng.nextInt(80) + 1 : undefined;

    return {
        varps,
        varbits,
        bank,
        bankCapacity: opts.bankCapacity,
        inventory,
        equipment,
        skills,
        hitpoints: 1 + rng.nextInt(125),
        location: createLocationSnapshot(rng),
        runEnergy: rng.nextInt(10001),
        runToggle: rng.nextBoolean(),
        autoRetaliate: rng.nextBoolean(),
        combatStyleSlot: rng.nextInt(4),
        combatStyleCategory: rng.nextInt(32),
        combatSpellId,
        autocastEnabled,
        autocastMode: autocastEnabled
            ? rng.nextBoolean()
                ? "autocast"
                : "defensive_autocast"
            : null,
        specialEnergy: rng.nextInt(101),
        specialActivated: rng.nextBoolean(),
    };
}

function createVarMap(
    rng: Prng,
    count: number,
    maxKey: number,
    maxValue: number,
): Record<number, number> | undefined {
    const entries = clampPositiveInt(count, 0, maxKey);
    if (entries <= 0) return undefined;
    const out: Record<number, number> = {};
    for (let i = 0; i < entries; i++) {
        const key = rng.nextInt(maxKey);
        const value = rng.nextInt(maxValue);
        out[key] = value;
    }
    return out;
}

function createBankEntries(rng: Prng, capacity: number, fillRatio: number): BankSnapshotEntry[] {
    const normalizedCapacity = clampPositiveInt(capacity, DEFAULT_BANK_CAPACITY);
    const fillCount = Math.min(
        normalizedCapacity,
        Math.max(0, Math.round(normalizedCapacity * clamp01(fillRatio))),
    );
    if (fillCount === 0) return [];
    const slots = pickRandomSlots(normalizedCapacity, fillCount, rng);
    return slots.map((slot) => ({
        slot,
        itemId: 1 + rng.nextInt(35_000),
        quantity: 1 + rng.nextInt(120_000),
    }));
}

function createInventoryEntries(rng: Prng, fillRatio: number): InventorySnapshotEntry[] {
    const maxSlots = INVENTORY_SLOT_COUNT;
    const fillSlots = Math.max(0, Math.round(maxSlots * clamp01(fillRatio)));
    const entries: InventorySnapshotEntry[] = [];
    for (let i = 0; i < fillSlots; i++) {
        entries.push({
            slot: i,
            itemId: 1 + rng.nextInt(2000),
            quantity: 1 + rng.nextInt(500),
        });
    }
    return entries;
}

function createEquipmentEntries(rng: Prng, fillRatio: number): EquipmentSnapshotEntry[] {
    const maxSlots = DEFAULT_EQUIP_SLOT_COUNT;
    const fillSlots = Math.max(0, Math.round(maxSlots * clamp01(fillRatio)));
    if (fillSlots === 0) return [];
    const slots = pickRandomSlots(maxSlots, fillSlots, rng);
    return slots.map((slot) => ({ slot, itemId: 1 + rng.nextInt(30_000) }));
}

function createSkillEntries(rng: Prng): PlayerSkillPersistentEntry[] {
    return SKILL_IDS.map((id) => {
        const baseLevel = 1 + rng.nextInt(99);
        const virtualBoost = rng.nextInt(27);
        const xp = Math.min(MAX_XP, getXpForLevel(baseLevel + virtualBoost));
        const boost = rng.nextInt(7) - rng.nextInt(3);
        return { id, xp, boost };
    });
}

function createLocationSnapshot(rng: Prng): PlayerLocationSnapshot {
    return {
        x: 3000 + rng.nextInt(1000),
        y: 3000 + rng.nextInt(1000),
        level: rng.nextInt(4),
        orientation: rng.nextInt(2048),
        rot: rng.nextInt(2048),
    };
}

function pickRandomSlots(count: number, picks: number, rng: Prng): number[] {
    const indices = Array.from({ length: count }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, picks).sort((a, b) => a - b);
}

function ensureOutputDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function getFileSizeBytes(filePath: string): number {
    try {
        const stat = fs.statSync(filePath);
        return stat.size;
    } catch {
        return 0;
    }
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    const decimals = value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDelta(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes === 0) return "±0 B";
    const prefix = bytes > 0 ? "+" : "-";
    return `${prefix}${formatBytes(Math.abs(bytes))}`;
}

function printReport(opts: HarnessOptions, storePath: string, results: HarnessResult[]): void {
    console.log("Autosave Stress Harness");
    console.log(
        `Players=${opts.players} iterations=${opts.iterations} bankCapacity=${
            opts.bankCapacity
        } fill=${(opts.bankFill * 100).toFixed(0)}%`,
    );
    console.log(
        `InventoryFill=${(opts.inventoryFill * 100).toFixed(0)}% equipFill=${(
            opts.equipFill * 100
        ).toFixed(0)}% varps=${opts.varps} varbits=${opts.varbits}`,
    );
    console.log(`Snapshot path: ${storePath}`);
    console.log("");

    const header = ["Iter", "Saved", "Save ms", "File Size", "Delta", "Bytes/Player"];
    const rows = results.map((result) => {
        const perPlayer = result.savedPlayers > 0 ? result.fileSizeBytes / result.savedPlayers : 0;
        return [
            result.iteration.toString(),
            result.savedPlayers.toString(),
            result.elapsedMs.toFixed(1),
            formatBytes(result.fileSizeBytes),
            formatDelta(result.deltaBytes),
            formatBytes(perPlayer),
        ];
    });
    const widths = header.map((col, idx) =>
        Math.max(col.length, ...rows.map((row) => row[idx]?.length ?? 0)),
    );

    const renderRow = (cells: string[]) =>
        cells.map((cell, idx) => cell.padStart(widths[idx])).join("  ");

    console.log(renderRow(header));
    console.log(widths.map((w) => "-".repeat(w)).join("  "));
    for (const row of rows) {
        console.log(renderRow(row));
    }
    console.log("");

    const totalMs = results.reduce((sum, entry) => sum + entry.elapsedMs, 0);
    const avgMs = results.length > 0 ? totalMs / results.length : 0;
    const maxMs = results.reduce((max, entry) => Math.max(max, entry.elapsedMs), 0);
    const finalSize = results[results.length - 1]?.fileSizeBytes ?? 0;
    console.log(
        `Average save time: ${avgMs.toFixed(2)} ms (peak ${maxMs.toFixed(2)} ms) across ${
            results.length
        } sweep(s)`,
    );
    console.log(
        `Final snapshot size: ${formatBytes(finalSize)} (${formatBytes(
            opts.players > 0 ? finalSize / opts.players : 0,
        )} per player)`,
    );
}

async function main(): Promise<void> {
    const opts = parseCliArgs();
    ensureOutputDir(opts.outputDir);
    const storePath = path.join(opts.outputDir, "player-state.json");
    const persistence = new PlayerPersistence({ dataDir: opts.outputDir, storePath });
    const players = createPlayers(opts.players, new Prng(opts.seed));
    const results: HarnessResult[] = [];

    for (let iteration = 0; iteration < opts.iterations; iteration++) {
        refreshPlayers(players, iteration, opts);
        const entries = players.map((handle) => ({ key: handle.key, player: handle.player }));
        const started = performance.now();
        persistence.savePlayers(entries);
        const elapsedMs = performance.now() - started;
        const fileSizeBytes = getFileSizeBytes(storePath);
        const previousSize = results.length > 0 ? results[results.length - 1]!.fileSizeBytes : 0;
        results.push({
            iteration: iteration + 1,
            savedPlayers: entries.length,
            elapsedMs,
            fileSizeBytes,
            deltaBytes: fileSizeBytes - previousSize,
        });
    }

    printReport(opts, storePath, results);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});

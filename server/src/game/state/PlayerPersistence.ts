import fs from "fs";
import path from "path";

import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import { MAX_XP, SKILL_IDS } from "../../../../src/rs/skill/skills";
import { DEFAULT_EQUIP_SLOT_COUNT } from "../equipment";
import {
    type BankSnapshotEntry,
    DEFAULT_BANK_CAPACITY,
    type EquipmentSnapshotEntry,
    INVENTORY_SLOT_COUNT,
    type InventorySnapshotEntry,
    type PlayerLocationSnapshot,
    type PlayerPersistentVars,
    type PlayerSkillPersistentEntry,
    PlayerState,
    normalizeSkillXpValue,
} from "../player";

const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../../data");
const MAX_TILE_COORD = 32767;
const MAX_LOCATION_LEVEL = 3;
const MAX_ROTATION = 2047;
const MAX_RUN_ENERGY = 10000;
const MAX_SPECIAL_ENERGY = 100;

interface SanitizedCollectionLogCategoryStat {
    structId: number;
    count1: number;
    count2?: number;
    count3?: number;
}

interface SanitizedCollectionLogUnlockEntry {
    itemId: number;
    runeDay: number;
    sequence: number;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeJsonFile(filePath: string, data: unknown): void {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
        // Best-effort persistence only; ignore write failures for now.
    }
}

function sanitizeInventorySnapshot(
    entries: InventorySnapshotEntry[] | undefined,
): InventorySnapshotEntry[] | undefined {
    if (entries === undefined) return undefined;
    if (!Array.isArray(entries)) return [];
    const sanitized: InventorySnapshotEntry[] = [];
    for (const entry of entries) {
        if (entry === undefined || entry === null) continue;
        const slot = entry.slot;
        const itemId = entry.itemId;
        const quantity = entry.quantity;
        if (slot < 0 || slot >= INVENTORY_SLOT_COUNT) continue;
        if (!(itemId > 0) || !(quantity > 0)) continue;
        sanitized.push({
            slot,
            itemId,
            quantity: Math.max(1, quantity),
        });
    }
    sanitized.sort((a, b) => a.slot - b.slot);
    return entries.length === 0 ? [] : sanitized;
}

function sanitizeEquipmentSnapshot(
    entries: EquipmentSnapshotEntry[] | undefined,
): EquipmentSnapshotEntry[] | undefined {
    if (entries === undefined) return undefined;
    if (!Array.isArray(entries)) return [];
    const sanitized: EquipmentSnapshotEntry[] = [];
    for (const entry of entries) {
        if (!entry) continue;
        const slot = entry.slot;
        if (slot < 0 || slot >= DEFAULT_EQUIP_SLOT_COUNT) continue;
        if (!(entry.itemId > 0)) continue;
        if (slot === EquipmentSlot.AMMO) {
            const qty = entry.quantity !== undefined ? Math.max(1, entry.quantity) : 1;
            sanitized.push({ slot, itemId: entry.itemId, quantity: qty });
        } else {
            sanitized.push({ slot, itemId: entry.itemId });
        }
    }
    sanitized.sort((a, b) => a.slot - b.slot);
    return entries.length === 0 ? [] : sanitized;
}

function sanitizeSkillsSnapshot(
    entries: PlayerSkillPersistentEntry[] | undefined,
): PlayerSkillPersistentEntry[] | undefined {
    if (entries === undefined) return undefined;
    if (!Array.isArray(entries)) return [];
    const validIds = new Set<number>(SKILL_IDS);
    const sanitized: PlayerSkillPersistentEntry[] = [];
    for (const entry of entries) {
        if (!entry) continue;
        const normalizedId = entry.id;
        if (!validIds.has(normalizedId)) continue;
        if (!Number.isFinite(entry.xp)) continue;
        const out: PlayerSkillPersistentEntry = {
            id: normalizedId,
            xp: normalizeSkillXpValue(entry.xp),
        };
        if (entry.boost !== undefined) {
            out.boost = Math.floor(entry.boost);
        }
        sanitized.push(out);
    }
    return entries.length === 0 ? [] : sanitized;
}

function sanitizeLocationSnapshot(
    snapshot: PlayerLocationSnapshot | undefined,
): PlayerLocationSnapshot | undefined {
    if (snapshot === undefined) return undefined;
    const normalized: PlayerLocationSnapshot = {
        x: clampCoord(snapshot.x),
        y: clampCoord(snapshot.y),
        level: Math.max(0, Math.min(MAX_LOCATION_LEVEL, snapshot.level)),
    };
    if (snapshot.orientation !== undefined) {
        normalized.orientation = snapshot.orientation & MAX_ROTATION;
    }
    if (snapshot.rot !== undefined) {
        normalized.rot = snapshot.rot & MAX_ROTATION;
    }
    return normalized;
}

function clampCoord(value: number): number {
    return Math.max(0, Math.min(MAX_TILE_COORD, Math.floor(value)));
}

function sanitizeCollectionLogSnapshot(
    data: PlayerPersistentVars["collectionLog"] | undefined,
): PlayerPersistentVars["collectionLog"] | undefined {
    if (data === undefined) return undefined;

    const result: NonNullable<PlayerPersistentVars["collectionLog"]> = {};

    if (Array.isArray(data.items)) {
        const sanitizedItems: Array<{ itemId: number; quantity: number }> = [];
        for (const item of data.items) {
            if (item === undefined || item === null) continue;
            if (item.itemId <= 0 || item.quantity <= 0) continue;
            sanitizedItems.push({ itemId: item.itemId, quantity: item.quantity });
        }
        if (sanitizedItems.length > 0) {
            result.items = sanitizedItems;
        }
    }

    if (Array.isArray(data.itemUnlocks)) {
        const sanitizedItemUnlocks: SanitizedCollectionLogUnlockEntry[] = [];
        for (const entry of data.itemUnlocks) {
            if (entry === undefined || entry === null) continue;
            if (entry.itemId <= 0 || entry.runeDay < 0 || entry.sequence <= 0) continue;
            sanitizedItemUnlocks.push({
                itemId: entry.itemId,
                runeDay: Math.max(0, Math.floor(entry.runeDay)),
                sequence: Math.max(1, Math.floor(entry.sequence)),
            });
        }
        if (sanitizedItemUnlocks.length > 0) {
            result.itemUnlocks = sanitizedItemUnlocks;
        }
    }

    if (Array.isArray(data.categoryStats)) {
        const sanitizedStats: SanitizedCollectionLogCategoryStat[] = [];
        for (const stat of data.categoryStats) {
            if (stat === undefined || stat === null) continue;
            const structId = stat.structId;
            const count1 = stat.count1;
            if (structId < 0) continue;
            const entry: SanitizedCollectionLogCategoryStat = {
                structId,
                count1,
            };
            if (stat.count2 !== undefined) entry.count2 = stat.count2;
            if (stat.count3 !== undefined) entry.count3 = stat.count3;
            sanitizedStats.push(entry);
        }
        if (sanitizedStats.length > 0) {
            result.categoryStats = sanitizedStats;
        }
    }

    // Return undefined if nothing was sanitized
    if (!result.items && !result.itemUnlocks && !result.categoryStats) return undefined;
    return result;
}

function mergeStates(
    defaults?: PlayerPersistentVars,
    overrides?: PlayerPersistentVars,
): PlayerPersistentVars | undefined {
    if (!defaults && !overrides) return undefined;
    const varps: Record<number, number> = {};
    const varbits: Record<number, number> = {};
    const leagueTaskProgress: Record<number, number> = {};
    const sources: PlayerPersistentVars[] = [defaults ?? {}, overrides ?? {}];
    for (const source of sources) {
        if (source.varps) {
            for (const [key, value] of Object.entries(source.varps)) {
                const id = parseInt(key, 10);
                if (!Number.isNaN(id)) {
                    varps[id] = value;
                }
            }
        }
        if (source.varbits) {
            for (const [key, value] of Object.entries(source.varbits)) {
                const id = parseInt(key, 10);
                if (!Number.isNaN(id)) {
                    varbits[id] = value;
                }
            }
        }
        if (source.leagueTaskProgress) {
            for (const [key, value] of Object.entries(source.leagueTaskProgress)) {
                const taskId = parseInt(key, 10);
                if (!Number.isNaN(taskId)) {
                    leagueTaskProgress[taskId] = value;
                }
            }
        }
    }
    const result: PlayerPersistentVars = {};
    if (Object.keys(varps).length > 0) result.varps = varps;
    if (Object.keys(varbits).length > 0) result.varbits = varbits;
    if (Object.keys(leagueTaskProgress).length > 0) {
        const sanitizedLeagueTaskProgress: Record<number, number> = {};
        for (const [key, value] of Object.entries(leagueTaskProgress)) {
            const taskId = parseInt(key, 10);
            if (Number.isNaN(taskId) || taskId < 0) continue;
            const normalized = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
            if (normalized > 0) {
                sanitizedLeagueTaskProgress[taskId] = normalized;
            }
        }
        if (Object.keys(sanitizedLeagueTaskProgress).length > 0) {
            result.leagueTaskProgress = sanitizedLeagueTaskProgress;
        }
    }
    const bankSource = overrides?.bank ?? defaults?.bank;
    if (bankSource) {
        const sanitized: BankSnapshotEntry[] = [];
        for (const entry of bankSource) {
            if (!entry) continue;
            const slot = entry.slot;
            if (!(entry.itemId > 0)) continue;
            const placeholder = !!entry.placeholder;
            const filler = !!entry.filler;
            if (!(entry.quantity > 0) && !placeholder && !filler) continue;
            sanitized.push({
                slot,
                itemId: entry.itemId,
                quantity: Math.max(0, entry.quantity),
                placeholder,
                filler,
                tab: entry.tab !== undefined ? Math.max(0, entry.tab) : 0,
            });
        }
        // Sort slots to keep deterministic ordering
        sanitized.sort((a, b) => a.slot - b.slot);
        result.bank = sanitized;
    }
    const bankCapacitySource = overrides?.bankCapacity ?? defaults?.bankCapacity;
    if (bankCapacitySource !== undefined && bankCapacitySource > 0) {
        result.bankCapacity = bankCapacitySource;
    } else if (result.bank) {
        result.bankCapacity = DEFAULT_BANK_CAPACITY;
    }
    const bankPlaceholders = overrides?.bankPlaceholders ?? defaults?.bankPlaceholders;
    if (bankPlaceholders !== undefined) {
        result.bankPlaceholders = bankPlaceholders;
    }
    const bankWithdrawNotes = overrides?.bankWithdrawNotes ?? defaults?.bankWithdrawNotes;
    if (bankWithdrawNotes !== undefined) {
        result.bankWithdrawNotes = bankWithdrawNotes;
    }
    const bankInsertMode = overrides?.bankInsertMode ?? defaults?.bankInsertMode;
    if (bankInsertMode !== undefined) {
        result.bankInsertMode = bankInsertMode;
    }
    const bankQuantityMode = overrides?.bankQuantityMode ?? defaults?.bankQuantityMode;
    if (bankQuantityMode !== undefined) {
        result.bankQuantityMode = Math.max(0, Math.min(5, bankQuantityMode));
    }

    const inventorySource =
        overrides && Object.prototype.hasOwnProperty.call(overrides, "inventory")
            ? overrides.inventory
            : defaults?.inventory;
    if (inventorySource !== undefined) {
        result.inventory = sanitizeInventorySnapshot(inventorySource) ?? [];
    }

    const equipmentSource =
        overrides && Object.prototype.hasOwnProperty.call(overrides, "equipment")
            ? overrides.equipment
            : defaults?.equipment;
    if (equipmentSource !== undefined) {
        result.equipment = sanitizeEquipmentSnapshot(equipmentSource) ?? [];
    }

    const pick = <K extends keyof PlayerPersistentVars>(
        key: K,
    ): PlayerPersistentVars[K] | undefined => {
        if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
            return overrides[key];
        }
        return defaults?.[key];
    };

    const skillsSource = pick("skills");
    if (skillsSource !== undefined) {
        result.skills = sanitizeSkillsSnapshot(skillsSource) ?? [];
    }

    // Project-specific onboarding/character design state
    const accountStage = pick("accountStage");
    if (accountStage !== undefined) {
        result.accountStage = Math.max(0, Math.min(10, Math.floor(accountStage)));
    }
    const accountCreationTimeMs = pick("accountCreationTimeMs");
    if (accountCreationTimeMs !== undefined) {
        result.accountCreationTimeMs = Math.max(
            0,
            Math.min(Number.MAX_SAFE_INTEGER, Math.floor(accountCreationTimeMs)),
        );
    }
    const appearanceSource = pick("appearance");
    if (appearanceSource) {
        const apOut: NonNullable<PlayerPersistentVars["appearance"]> = {};
        const gender = appearanceSource.gender;
        if (gender !== undefined) {
            apOut.gender = gender === 1 ? 1 : 0;
        }
        if (appearanceSource.kits) {
            apOut.kits = appearanceSource.kits.map((n) => n).slice(0, 7);
        }
        if (appearanceSource.colors) {
            apOut.colors = appearanceSource.colors.map((n) => n).slice(0, 5);
        }
        if (
            Object.prototype.hasOwnProperty.call(apOut, "gender") ||
            Object.prototype.hasOwnProperty.call(apOut, "kits") ||
            Object.prototype.hasOwnProperty.call(apOut, "colors")
        ) {
            result.appearance = apOut;
        }
    }

    const hpSource = pick("hitpoints");
    if (hpSource !== undefined) {
        result.hitpoints = Math.max(0, Math.floor(hpSource));
    }

    const location = sanitizeLocationSnapshot(pick("location"));
    if (location) {
        result.location = location;
    }

    const runEnergy = pick("runEnergy");
    if (runEnergy !== undefined) {
        result.runEnergy = Math.max(0, Math.min(MAX_RUN_ENERGY, Math.floor(runEnergy)));
    }

    const runToggle = pick("runToggle");
    if (runToggle !== undefined) {
        result.runToggle = runToggle;
    }

    const autoRetaliate = pick("autoRetaliate");
    if (autoRetaliate !== undefined) {
        result.autoRetaliate = autoRetaliate;
    }

    const playTimeSeconds = pick("playTimeSeconds");
    if (playTimeSeconds !== undefined) {
        result.playTimeSeconds = Math.max(
            0,
            Math.min(Number.MAX_SAFE_INTEGER, Math.floor(playTimeSeconds)),
        );
    }

    const combatStyleSlot = pick("combatStyleSlot");
    if (combatStyleSlot !== undefined) {
        result.combatStyleSlot = combatStyleSlot;
    }

    const combatStyleCategory = pick("combatStyleCategory");
    if (combatStyleCategory !== undefined) {
        result.combatStyleCategory = combatStyleCategory;
    }

    const combatSpellId = pick("combatSpellId");
    if (combatSpellId !== undefined) {
        result.combatSpellId = combatSpellId;
    }

    const autocastEnabled = pick("autocastEnabled");
    if (autocastEnabled !== undefined) {
        result.autocastEnabled = autocastEnabled;
    }

    const autocastMode = pick("autocastMode");
    if (
        autocastMode === "autocast" ||
        autocastMode === "defensive_autocast" ||
        autocastMode === null
    ) {
        result.autocastMode = autocastMode ?? null;
    }

    const specialEnergy = pick("specialEnergy");
    if (specialEnergy !== undefined) {
        result.specialEnergy = Math.max(0, Math.min(MAX_SPECIAL_ENERGY, Math.floor(specialEnergy)));
    }

    const specialActivated = pick("specialActivated");
    if (specialActivated !== undefined) {
        result.specialActivated = specialActivated;
    }

    const followerSource = pick("follower");
    if (
        followerSource &&
        Number.isFinite(followerSource.itemId) &&
        Number.isFinite(followerSource.npcTypeId) &&
        followerSource.itemId > 0 &&
        followerSource.npcTypeId > 0
    ) {
        result.follower = {
            itemId: Math.floor(followerSource.itemId),
            npcTypeId: Math.floor(followerSource.npcTypeId),
        };
    }

    // Collection log: merge items and category stats from both sources
    const collectionLogSource = pick("collectionLog");
    const sanitizedCollectionLog = sanitizeCollectionLogSnapshot(collectionLogSource);
    if (sanitizedCollectionLog) {
        result.collectionLog = sanitizedCollectionLog;
    }

    // Degradation charges (crystal bow, etc.)
    const degradationSource = pick("degradationCharges");
    if (Array.isArray(degradationSource)) {
        const sanitizedDegradation: Array<{ slot: number; itemId: number; charges: number }> = [];
        for (const entry of degradationSource) {
            if (entry === undefined || entry === null) continue;
            const slot = entry.slot;
            const itemId = entry.itemId;
            const charges = entry.charges;
            if (slot < 0 || slot >= DEFAULT_EQUIP_SLOT_COUNT) continue;
            if (itemId <= 0 || charges <= 0) continue;
            sanitizedDegradation.push({
                slot,
                itemId,
                charges,
            });
        }
        if (sanitizedDegradation.length > 0) {
            result.degradationCharges = sanitizedDegradation;
        }
    }

    return result;
}

export interface PlayerPersistenceOptions {
    dataDir?: string;
    storePath?: string;
    defaultsPath?: string;
}

export class PlayerPersistence {
    private readonly store = new Map<string, PlayerPersistentVars>();
    private readonly defaults: PlayerPersistentVars | undefined;
    private readonly storePath: string;
    private readonly defaultsPath: string;

    constructor(options: PlayerPersistenceOptions = {}) {
        const dataDir = options.dataDir ? path.resolve(options.dataDir) : DEFAULT_DATA_DIR;
        this.storePath = options.storePath
            ? path.resolve(options.storePath)
            : path.join(dataDir, "player-state.json");
        this.defaultsPath = options.defaultsPath
            ? path.resolve(options.defaultsPath)
            : path.join(dataDir, "player-defaults.json");
        this.defaults = readJsonFile<PlayerPersistentVars | undefined>(
            this.defaultsPath,
            undefined,
        );
        const data = readJsonFile<Record<string, PlayerPersistentVars>>(this.storePath, {});
        for (const [key, snapshot] of Object.entries(data)) {
            this.store.set(key, snapshot);
        }
    }

    applyToPlayer(player: PlayerState, key: string): void {
        const snapshot = mergeStates(this.defaults, this.store.get(key));
        player.applyPersistentVars(snapshot);
    }

    hasKey(key: string): boolean {
        return this.store.has(key);
    }

    saveSnapshot(key: string, player: PlayerState): void {
        const snapshot = player.exportPersistentVars();
        this.store.set(key, snapshot);
        this.flush();
    }

    savePlayers(entries: Array<{ key: string; player: PlayerState }>): void {
        if (!entries || entries.length === 0) return;
        for (const entry of entries) {
            const snapshot = entry.player.exportPersistentVars();
            this.store.set(entry.key, snapshot);
        }
        this.flush();
    }

    private flush(): void {
        const payload: Record<string, PlayerPersistentVars> = {};
        for (const [key, snapshot] of this.store.entries()) {
            payload[key] = snapshot;
        }
        writeJsonFile(this.storePath, payload);
    }
}

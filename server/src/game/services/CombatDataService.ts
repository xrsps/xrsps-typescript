import path from "path";

import type { EnumTypeLoader } from "../../../../src/rs/config/enumtype/EnumTypeLoader";
import type { NpcSoundLookup, NpcSoundType } from "../../audio/NpcSoundLookup";
import type { NpcManager } from "../npcManager";
import type { NpcState } from "../npc";
import type { DataLoaderService } from "./DataLoaderService";
import { logger } from "../../utils/logger";

export interface CombatDataServiceDeps {
    dataLoaders: DataLoaderService;
    npcManager: NpcManager | undefined;
    npcSoundLookup: NpcSoundLookup | undefined;
}

/**
 * Loads and provides NPC combat definitions, stats, special attack data,
 * and NPC sound lookups. Extracted from WSServer.
 */
export class CombatDataService {
    private npcCombatDefs?: Record<
        string,
        { attack?: number; block?: number; death?: number; deathSound?: number }
    >;
    private npcCombatDefaults?: {
        attack: number;
        block: number;
        death: number;
    };
    private npcCombatStats?: Record<string, any>;
    private specialAttackCostUnitsByWeapon?: Map<number, number>;
    private specialAttackDescriptionByWeapon?: Map<number, string>;
    private specialAttackDefaultDescription?: string;

    constructor(private readonly deps: CombatDataServiceDeps) {}

    setDeferredDeps(deferred: { npcSoundLookup?: NpcSoundLookup }): void {
        Object.assign(this.deps, deferred);
    }

    // --- NPC combat definitions ---

    loadNpcCombatDefs(): void {
        if (this.npcCombatDefs) return;
        try {
            const raw = require(path.resolve("server/data/npc-combat-defs.json"));
            const defaults = raw?.defaults;
            if (defaults) {
                this.npcCombatDefaults = {
                    attack: defaults.attack ?? 422,
                    block: defaults.block ?? 424,
                    death: defaults.death ?? 836,
                };
            }
            const entries: Record<string, any> = {};
            const npcs = raw?.npcs;
            if (npcs && typeof npcs === "object") {
                for (const [key, val] of Object.entries(npcs)) {
                    if (val && typeof val === "object") {
                        entries[key] = val;
                    }
                }
            }
            this.npcCombatDefs = entries;
        } catch (err) {
            logger.warn("[combat] failed to load npc-combat-defs.json", err);
            this.npcCombatDefs = {};
            this.npcCombatDefaults = { attack: 422, block: 424, death: 836 };
        }
    }

    loadNpcCombatStats(): void {
        if (this.npcCombatStats) return;
        try {
            const raw = require(path.resolve("server/data/npc-combat-stats.json"));
            this.npcCombatStats = raw ?? {};
        } catch {
            this.npcCombatStats = {};
        }
    }

    getNpcCombatSequences(typeId: number): {
        block?: number;
        attack?: number;
        death?: number;
    } {
        this.loadNpcCombatDefs();
        const key = String(typeId);
        const entry = this.npcCombatDefs?.[key];
        if (entry) {
            return {
                block: entry.block ?? this.npcCombatDefaults?.block,
                attack: entry.attack ?? this.npcCombatDefaults?.attack,
                death: entry.death ?? this.npcCombatDefaults?.death,
            };
        }
        return {
            block: this.npcCombatDefaults?.block,
            attack: this.npcCombatDefaults?.attack,
            death: this.npcCombatDefaults?.death,
        };
    }

    resolveNpcCombatProfile(npc: NpcState): any {
        return npc.combat;
    }

    getNpcParamValue(npc: NpcState, paramKey: number): number | undefined {
        try {
            const npcType = this.deps.npcManager?.getNpcType?.(npc.typeId);
            const params = npcType?.params;
            if (!params) return undefined;
            const val = params.get(paramKey);
            return typeof val === "number" ? val : undefined;
        } catch {
            return undefined;
        }
    }

    // --- Special attack data ---

    loadSpecialAttackCacheData(enumTypeLoader: EnumTypeLoader): void {
        try {
            const costEnum = enumTypeLoader.load(906);
            const costMap = new Map<number, number>();
            for (let i = 0; i < costEnum.keys.length; i++) {
                costMap.set(costEnum.keys[i], costEnum.intValues[i]);
            }
            this.specialAttackCostUnitsByWeapon = costMap;
        } catch (err) {
            logger.warn("[cache] failed to load special attack cost enum (906)", err);
        }

        try {
            const descEnum = enumTypeLoader.load(1739);
            const descMap = new Map<number, string>();
            for (let i = 0; i < descEnum.keys.length; i++) {
                const val = descEnum.stringValues[i] ?? "";
                if (val) descMap.set(descEnum.keys[i], val);
            }
            this.specialAttackDescriptionByWeapon = descMap;
            this.specialAttackDefaultDescription = descEnum.defaultString || undefined;
        } catch (err) {
            logger.warn("[cache] failed to load special attack description enum (1739)", err);
        }
    }

    getWeaponSpecialCostPercent(weaponItemId: number): number | undefined {
        const units = this.specialAttackCostUnitsByWeapon?.get(weaponItemId);
        if (units === undefined || units <= 0) return undefined;
        return Math.max(1, Math.min(100, Math.ceil(units / 10)));
    }

    getWeaponSpecialDescription(weaponItemId: number): string | undefined {
        const direct = this.specialAttackDescriptionByWeapon?.get(weaponItemId);
        if (direct) return direct;
        return this.specialAttackDefaultDescription;
    }

    // --- NPC sound methods ---

    getNpcSoundFromTable88(typeId: number, soundType: NpcSoundType): number | undefined {
        if (!this.deps.npcSoundLookup) return undefined;
        try {
            const npcTypeLoader = this.deps.dataLoaders.getNpcTypeLoader();
            if (!npcTypeLoader) return undefined;
            const npcType = npcTypeLoader.load(typeId);
            if (!npcType) return undefined;
            return this.deps.npcSoundLookup.getSoundForNpc(npcType, soundType);
        } catch {
            return undefined;
        }
    }

    getNpcDeathSoundId(npc: NpcState): number | undefined {
        const table88 = this.getNpcSoundFromTable88(npc.typeId, "death");
        if (table88 !== undefined) return table88;

        this.loadNpcCombatDefs();
        const entry = this.npcCombatDefs?.[String(npc.typeId)];
        if (entry?.deathSound !== undefined) return entry.deathSound;

        return undefined;
    }

    getNpcAttackSoundId(npc: NpcState): number {
        const NPC_ATTACK_SOUND = 394;
        const table88 = this.getNpcSoundFromTable88(npc.typeId, "attack");
        return table88 ?? NPC_ATTACK_SOUND;
    }

    getNpcHitSoundId(npc: NpcState): number | undefined {
        return this.getNpcSoundFromTable88(npc.typeId, "hit");
    }

    getNpcDefendSoundId(npc: NpcState): number | undefined {
        return this.getNpcSoundFromTable88(npc.typeId, "defend");
    }
}

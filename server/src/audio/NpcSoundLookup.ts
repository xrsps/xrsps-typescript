import fs from "fs";
import path from "path";

import { DbRepository } from "../../../src/rs/config/db/DbRepository";
import { NpcType } from "../../../src/rs/config/npctype/NpcType";
import { logger } from "../utils/logger";

export type NpcSoundType = "attack" | "death" | "hit" | "defend";

type NpcSoundEntry = {
    key: string;
    soundName: string;
    soundId: number;
};

type NpcSoundCategoryValue = string | number;
type NpcSoundMapJson = {
    npcs?: Record<string, Partial<Record<NpcSoundType, number>>>;
};

/**
 * Utility to look up NPC sounds from Database Table 88
 */
export class NpcSoundLookup {
    private readonly npcKeyAliases: Record<string, string> = {
        man: "human",
        woman: "human",
    };
    private soundCategories = new Map<string, NpcSoundCategoryValue[]>();
    private entriesByType: Record<NpcSoundType, NpcSoundEntry[]> = {
        attack: [],
        death: [],
        hit: [],
        defend: [],
    };
    private soundIdByName = new Map<string, number>();
    private npcSoundMap = new Map<number, Partial<Record<NpcSoundType, number>>>();
    private initialized = false;
    private readonly cache = new Map<string, number | null>();

    constructor(private dbRepository: DbRepository) {}

    /**
     * Initialize by loading Table 88 sound categories
     */
    initialize(): void {
        if (this.initialized) return;

        const table88Rows = this.dbRepository.getRows(88);
        let soundPairCount = 0;

        for (const row of table88Rows) {
            const categoryName = (row.getColumn(0)?.values?.[0] as string | undefined)?.trim() ?? "";
            const sounds = row.getColumn(2)?.values as NpcSoundCategoryValue[] | undefined;
            if (categoryName && Array.isArray(sounds)) {
                this.soundCategories.set(categoryName.toLowerCase(), sounds);
            }
            if (!Array.isArray(sounds)) continue;
            for (let i = 0; i + 1 < sounds.length; i += 2) {
                const soundNameRaw = sounds[i];
                const soundIdRaw = sounds[i + 1];
                const soundName = (soundNameRaw as string | undefined)?.toLowerCase() ?? "";
                if (!soundName || typeof soundIdRaw !== "number" || soundIdRaw <= 0) continue;
                const soundId = soundIdRaw;
                soundPairCount++;
                if (!this.soundIdByName.has(soundName)) {
                    this.soundIdByName.set(soundName, soundId);
                }
                const attackKey = this.extractKey(soundName, "attack");
                if (attackKey)
                    this.entriesByType.attack.push({ key: attackKey, soundName, soundId });
                const deathKey = this.extractKey(soundName, "death");
                if (deathKey) this.entriesByType.death.push({ key: deathKey, soundName, soundId });
                const hitKey = this.extractKey(soundName, "hit");
                if (hitKey) this.entriesByType.hit.push({ key: hitKey, soundName, soundId });
                const defendKey = this.extractKey(soundName, "defend");
                if (defendKey)
                    this.entriesByType.defend.push({ key: defendKey, soundName, soundId });
            }
        }

        this.loadNpcSoundMapFile(path.resolve(__dirname, "../../../data/npc-sounds.generated.json"));
        this.loadNpcSoundMapFile(path.resolve(__dirname, "../../../data/npc-sounds.overrides.json"));

        this.initialized = true;
        logger.info(
            `[NpcSoundLookup] Loaded ${this.soundCategories.size} sound categories, ${soundPairCount} sound pair(s) from Table 88, ${this.npcSoundMap.size} npc sound map override(s)`,
        );
    }

    getSoundByName(soundName: string): number | undefined {
        if (!this.initialized) {
            this.initialize();
        }
        const key = (soundName || "").trim().toLowerCase();
        if (!key) return undefined;
        const soundId = this.soundIdByName.get(key);
        return soundId !== undefined && soundId > 0 ? soundId : undefined;
    }

    /**
     * Get sound ID for an NPC and sound type
     * Uses sound-name matching (e.g., "goblin_death") against the NPC's display name.
     */
    getSoundForNpc(npcType: NpcType, soundType: NpcSoundType): number | undefined {
        if (!this.initialized) {
            this.initialize();
        }

        const npcId = npcType.id;
        const mapped = this.npcSoundMap.get(npcId)?.[soundType];
        if (mapped !== undefined && mapped > 0) {
            return mapped;
        }

        const npcKey = this.normalizeKey(npcType.name);
        if (!npcKey) return undefined;
        const canonicalKey = this.npcKeyAliases[npcKey] ?? npcKey;
        const cacheKey =
            canonicalKey === npcKey
                ? `${soundType}:${npcKey}`
                : `${soundType}:${canonicalKey}:${npcKey}`;
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            return cached ?? undefined;
        }

        const entries = this.entriesByType[soundType] ?? [];
        let bestSoundId = this.findBestSoundIdForKey(entries, canonicalKey);
        if (bestSoundId === undefined && canonicalKey !== npcKey) {
            bestSoundId = this.findBestSoundIdForKey(entries, npcKey);
        }

        this.cache.set(cacheKey, bestSoundId ?? null);
        return bestSoundId;
    }

    /**
     * Get all sounds for an NPC category (for debugging)
     */
    getSoundsForCategory(category: string): NpcSoundCategoryValue[] | undefined {
        return this.soundCategories.get(category.toLowerCase());
    }

    private normalizeKey(value: string | undefined | null): string {
        return (value || "").toLowerCase().replace(/[^a-z]/g, "");
    }

    private extractKey(soundName: string, soundType: NpcSoundType): string | undefined {
        const name = (soundName || "").toLowerCase();
        if (!name) return undefined;
        let match: RegExpMatchArray | null = null;
        if (soundType === "death") {
            match = name.match(/^(.*)_death\d*$/);
        } else if (soundType === "attack") {
            match = name.match(/^(.*)_attack\d*$/);
        } else if (soundType === "hit") {
            match = name.match(/^(.*)_hit\d*$/);
        } else if (soundType === "defend") {
            match = name.match(/^(.*)_(?:defend|block)(?:_\d+|\d*)$/);
        }
        if (!match) return undefined;
        const base = match[1] ?? "";
        const key = this.normalizeKey(base);
        return key || undefined;
    }

    private findBestSoundIdForKey(entries: NpcSoundEntry[], npcKey: string): number | undefined {
        let bestScore = 0;
        let bestSoundId: number | undefined = undefined;
        for (const entry of entries) {
            const score = this.scoreKeyMatch(npcKey, entry.key);
            if (score <= 0) continue;
            if (score > bestScore) {
                bestScore = score;
                bestSoundId = entry.soundId;
            }
        }
        return bestSoundId;
    }

    private scoreKeyMatch(npcKey: string, candidateKey: string): number {
        if (!npcKey || !candidateKey) return 0;
        if (npcKey === candidateKey) return 10000 + candidateKey.length;
        if (npcKey.includes(candidateKey)) return 5000 + candidateKey.length;
        return 0;
    }

    private loadNpcSoundMapFile(filePath: string): void {
        try {
            if (!fs.existsSync(filePath)) return;
            const raw = fs.readFileSync(filePath, "utf8");
            const json = JSON.parse(raw) as NpcSoundMapJson;
            const npcs = json.npcs;
            if (!npcs) return;

            for (const [idStr, sounds] of Object.entries(npcs)) {
                const npcId = parseInt(idStr, 10);
                if (Number.isNaN(npcId) || npcId < 0) continue;
                const mapped: Partial<Record<NpcSoundType, number>> = {};
                for (const type of ["attack", "death", "hit", "defend"] as const) {
                    const value = sounds[type];
                    if (value !== undefined && value > 0) {
                        mapped[type] = value;
                    }
                }
                if (!mapped.attack && !mapped.death && !mapped.hit && !mapped.defend) continue;
                const existing = this.npcSoundMap.get(npcId) ?? {};
                this.npcSoundMap.set(npcId, { ...existing, ...mapped });
            }
        } catch (err) {
            logger.warn(`[NpcSoundLookup] Failed to load NPC sound map file: ${filePath}`, err);
        }
    }
}

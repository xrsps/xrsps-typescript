import { SoundEffect } from "../../../../rs/audio/legacy/SoundEffect";
import { CacheSystem } from "../../../../rs/cache/CacheSystem";
import { IndexType } from "../../../../rs/cache/IndexType";
import { ByteBuffer } from "../../../../rs/io/ByteBuffer";
import { RawSoundData, loadVorbisSample } from "../../VorbisWasm";

/**
 * Minimal SoundCache used by MusicPatch to fetch Vorbis music samples (index 14)
 * and legacy sound effects (index 4). OSRS patch-based music uses both: the low
 * bit of the sample id selects sound effect (0) vs music sample (1).
 */
export class SoundCache {
    private readonly musicSampleIndexId = IndexType.DAT2.musicSamples;
    private readonly soundEffectIndexId = IndexType.DAT2.soundEffects;

    constructor(private cache: CacheSystem) {}

    /**
     * Load a music sample (Vorbis) by group/file (or smart id if single-file groups).
     */
    async loadMusicSample(groupId: number, fileId: number): Promise<RawSoundData | null> {
        return loadVorbisSample(this.cache, groupId, fileId);
    }

    /**
     * Load a legacy sound effect (Instrument-based) by group/file.
     */
    async loadSoundEffect(groupId: number, fileId: number): Promise<RawSoundData | null> {
        const index = this.cache.getIndex(this.soundEffectIndexId);
        if (!index) return null;
        const file = index.getFile(groupId, fileId);
        if (!file) return null;
        try {
            const raw = SoundEffect.decode(new ByteBuffer(file.data)).toRawSound();
            return { ...raw, looped: false };
        } catch (err) {
            console.warn("[SoundCache] failed to decode sound effect", groupId, fileId, err);
            return null;
        }
    }

    /**
     * RuneLite naming: method883(var1) chooses group/file automatically if single-file groups.
     */
    async method883(id: number): Promise<RawSoundData | null> {
        const index = this.cache.getIndex(this.musicSampleIndexId);
        if (!index) {
            console.warn(`[SoundCache]  musicSamples index not available`);
            return null;
        }
        const archiveCount = index.getArchiveCount();

        // Try different loading strategies
        try {
            // First try: single archive with file id
            if (archiveCount === 1) {
                const result = await this.loadMusicSample(0, id);
                if (result) return result;
            }

            // Second try: archive id with single file
            const fileCount = index.getFileCount(id);
            if (fileCount === 1) {
                const result = await this.loadMusicSample(id, 0);
                if (result) return result;
            }

            // Third try: getFileSmart
            const file = index.getFileSmart(id);
            if (file) {
                return loadVorbisSample(this.cache, id, 0);
            }
        } catch (err) {
            console.warn(`[SoundCache] method883 failed for id ${id}:`, err);
        }

        return null;
    }

    /**
     * RuneLite naming: method881(var1) fetches a sound effect by id.
     */
    async method881(id: number): Promise<RawSoundData | null> {
        const index = this.cache.getIndex(this.soundEffectIndexId);
        if (!index) return null;
        const archiveCount = index.getArchiveCount();
        if (archiveCount === 1) {
            return this.loadSoundEffect(0, id);
        }
        if (index.getFileCount(id) === 1) {
            return this.loadSoundEffect(id, 0);
        }
        return null;
    }
}

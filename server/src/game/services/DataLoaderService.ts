import { ConfigType } from "../../../../src/rs/cache/ConfigType";
import { IndexType } from "../../../../src/rs/cache/IndexType";
import { getCacheLoaderFactory } from "../../../../src/rs/cache/loader/CacheLoaderFactory";
import { Huffman, tryLoadOsrsHuffman } from "../../../../src/rs/chat/Huffman";
import type { BasType } from "../../../../src/rs/config/bastype/BasType";
import type { BasTypeLoader } from "../../../../src/rs/config/bastype/BasTypeLoader";
import { DbRepository } from "../../../../src/rs/config/db/DbRepository";
import type { EnumTypeLoader } from "../../../../src/rs/config/enumtype/EnumTypeLoader";
import { ArchiveHealthBarDefinitionLoader } from "../../../../src/rs/config/healthbar/HealthBarDefinitionLoader";
import type { IdkTypeLoader } from "../../../../src/rs/config/idktype/IdkTypeLoader";
import type { NpcTypeLoader } from "../../../../src/rs/config/npctype/NpcTypeLoader";
import type { ObjType } from "../../../../src/rs/config/objtype/ObjType";
import type { ObjTypeLoader } from "../../../../src/rs/config/objtype/ObjTypeLoader";
import type { SeqTypeLoader } from "../../../../src/rs/config/seqtype/SeqTypeLoader";
import { logger } from "../../utils/logger";
import type { CacheEnv } from "../../world/CacheEnv";

/**
 * Owns all cache-backed type loaders and provides accessor methods.
 * Extracted from WSServer to centralize data loading concerns.
 */
export class DataLoaderService {
    private objTypeLoader?: ObjTypeLoader;
    private idkTypeLoader?: IdkTypeLoader;
    private basTypeLoader?: BasTypeLoader;
    private locTypeLoader?: any;
    private enumTypeLoader?: EnumTypeLoader;
    private structTypeLoader?: any;
    private seqTypeLoader?: SeqTypeLoader;
    private npcTypeLoader?: NpcTypeLoader;
    private dbRepository?: DbRepository;
    private huffman?: Huffman;
    private healthBarDefLoader?: ArchiveHealthBarDefinitionLoader;

    private cacheFactory: any;

    constructor(private readonly cacheEnv: CacheEnv) {
        this.cacheFactory = getCacheLoaderFactory(
            cacheEnv.info as any,
            cacheEnv.cacheSystem as any,
        );

        this.huffman = tryLoadOsrsHuffman(cacheEnv.cacheSystem as any);
        if (!this.huffman) {
            logger.warn(
                "[chat] failed to load OSRS Huffman table (idx10); public chat may be garbled",
            );
        }

        try {
            const configIndex = cacheEnv.cacheSystem.getIndex(IndexType.DAT2.configs);
            if (configIndex.archiveExists(ConfigType.OSRS.healthBar)) {
                const archive = configIndex.getArchive(ConfigType.OSRS.healthBar);
                this.healthBarDefLoader = new ArchiveHealthBarDefinitionLoader(
                    cacheEnv.info as any,
                    archive,
                );
            }
        } catch {}

        this.initLoaders();
    }

    private initLoaders(): void {
        const factory = this.cacheFactory;
        if (!factory) return;

        try {
            this.locTypeLoader = factory.getLocTypeLoader();
        } catch {}
        try {
            this.npcTypeLoader = factory.getNpcTypeLoader?.();
        } catch {}
        try {
            this.seqTypeLoader = factory.getSeqTypeLoader?.();
        } catch {}
        try {
            this.objTypeLoader = factory.getObjTypeLoader();
        } catch {}
        try {
            this.idkTypeLoader = factory.getIdkTypeLoader();
        } catch {}
        try {
            this.basTypeLoader = factory.getBasTypeLoader();
        } catch {}
        try {
            this.enumTypeLoader = factory.getEnumTypeLoader?.();
        } catch {}
        try {
            this.structTypeLoader = factory.getStructTypeLoader?.();
        } catch {}

        if (this.cacheEnv) {
            try {
                this.dbRepository = new DbRepository(this.cacheEnv.cacheSystem as any);
            } catch (err) {
                logger.warn("[DataLoaderService] failed to load DbRepository", err);
            }
        }
    }

    getCacheEnv(): CacheEnv {
        return this.cacheEnv;
    }

    getCacheFactory(): any {
        return this.cacheFactory;
    }

    getObjType(itemId: number): ObjType | undefined {
        try {
            return this.objTypeLoader?.load?.(itemId);
        } catch {
            return undefined;
        }
    }

    getObjTypeLoader(): ObjTypeLoader | undefined {
        return this.objTypeLoader;
    }

    getIdkTypeLoader(): IdkTypeLoader | undefined {
        return this.idkTypeLoader;
    }

    getBasTypeLoader(): BasTypeLoader | undefined {
        return this.basTypeLoader;
    }

    loadBas(basId: number): BasType | undefined {
        try {
            return this.basTypeLoader?.load(basId);
        } catch {
            return undefined;
        }
    }

    getLocTypeLoader(): any {
        return this.locTypeLoader;
    }

    getLocDefinition(locId: number): any {
        try {
            return this.locTypeLoader?.load?.(locId);
        } catch {
            return undefined;
        }
    }

    getEnumTypeLoader(): EnumTypeLoader | undefined {
        return this.enumTypeLoader;
    }

    getStructTypeLoader(): any {
        return this.structTypeLoader;
    }

    getSeqTypeLoader(): SeqTypeLoader | undefined {
        return this.seqTypeLoader;
    }

    getNpcTypeLoader(): NpcTypeLoader | undefined {
        return this.npcTypeLoader;
    }

    getDbRepository(): DbRepository | undefined {
        return this.dbRepository;
    }

    getHuffman(): Huffman | undefined {
        return this.huffman;
    }

    getHealthBarDefLoader(): ArchiveHealthBarDefinitionLoader | undefined {
        return this.healthBarDefLoader;
    }
}

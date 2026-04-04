import { Archive } from "../../cache/Archive";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import {
    ArchiveTypeLoader,
    IndexTypeLoader,
    IndexedDatTypeLoader,
    TypeLoader,
} from "../TypeLoader";
import { ObjType } from "./ObjType";

export type ObjTypeLoader = TypeLoader<ObjType>;

/**
 * OSRS parity: Item definitions are post-processed after decode:
 * - noteTemplate -> genCert(noteTemplate, note)
 * - notedId      -> genBought(notedId, unnotedId)
 * - placeholderTemplate -> genPlaceholder(placeholderTemplate, placeholder)
 *
 * Reference: `class341.ItemDefinition_get` in the deob.
 *
 * Our generic TypeLoader pipeline calls `type.post()` but ObjType requires access
 * to other ObjTypes to apply these transforms, so we wrap the loader instead.
 */
export class PostProcessedObjTypeLoader implements ObjTypeLoader {
    constructor(private readonly base: ObjTypeLoader) {}

    load(id: number): ObjType {
        const obj = this.base.load(id);
        const anyObj = obj as any;
        if (anyObj.__postProcessed === true) return obj;

        // Mark before resolving dependencies to avoid recursion loops.
        anyObj.__postProcessed = true;

        try {
            // Note (certificate)
            if ((obj.noteTemplate | 0) !== -1) {
                obj.genCert(this.load(obj.noteTemplate | 0), this.load(obj.note | 0));
            }
        } catch {}

        try {
            // Bought (notedId/unnotedId link variant)
            if ((obj.notedId | 0) !== -1) {
                obj.genBought(this.load(obj.notedId | 0), this.load(obj.unnotedId | 0));
            }
        } catch {}

        try {
            // Placeholder
            if ((obj.placeholderTemplate | 0) !== -1) {
                obj.genPlaceholder(
                    this.load(obj.placeholderTemplate | 0),
                    this.load(obj.placeholder | 0),
                );
            }
        } catch {}

        return obj;
    }

    getCount(): number {
        return this.base.getCount();
    }

    clearCache(): void {
        this.base.clearCache();
    }
}

export class DatObjTypeLoader {
    static load(cacheInfo: CacheInfo, configArchive: Archive): ObjTypeLoader {
        return IndexedDatTypeLoader.load(ObjType, cacheInfo, configArchive, "obj");
    }
}

export class ArchiveObjTypeLoader extends ArchiveTypeLoader<ObjType> implements ObjTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(ObjType, cacheInfo, archive);
    }
}

export class IndexObjTypeLoader extends IndexTypeLoader<ObjType> implements ObjTypeLoader {
    constructor(cacheInfo: CacheInfo, index: CacheIndex) {
        super(ObjType, cacheInfo, index);
    }
}

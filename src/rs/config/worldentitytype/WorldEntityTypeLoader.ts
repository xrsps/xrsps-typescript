import { Archive } from "../../cache/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { WorldEntityType } from "./WorldEntityType";

export type WorldEntityTypeLoader = TypeLoader<WorldEntityType>;

export class ArchiveWorldEntityTypeLoader
    extends ArchiveTypeLoader<WorldEntityType>
    implements WorldEntityTypeLoader
{
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(WorldEntityType, cacheInfo, archive);
    }
}

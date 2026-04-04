import { BasTypeLoader } from "../../config/bastype/BasTypeLoader";
import { EnumTypeLoader } from "../../config/enumtype/EnumTypeLoader";
import { FloorTypeLoader, OverlayFloorTypeLoader } from "../../config/floortype/FloorTypeLoader";
import { IdkTypeLoader } from "../../config/idktype/IdkTypeLoader";
import { LocTypeLoader } from "../../config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../../config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../../config/objtype/ObjTypeLoader";
import { ParamTypeLoader } from "../../config/paramtype/ParamTypeLoader";
import { SeqTypeLoader } from "../../config/seqtype/SeqTypeLoader";
import { SpotAnimTypeLoader } from "../../config/spotanimtype/SpotAnimTypeLoader";
import { StructTypeLoader } from "../../config/structtype/StructTypeLoader";
import { VarcIntTypeLoader } from "../../config/vartype/VarcIntTypeLoader";
import { VarBitTypeLoader } from "../../config/vartype/bit/VarBitTypeLoader";
import { MapFileIndex } from "../../map/MapFileIndex";
import { MapFileLoader } from "../../map/MapFileLoader";
import { ModelLoader } from "../../model/ModelLoader";
import { SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../../sprite/IndexedSprite";
import { TextureLoader } from "../../texture/TextureLoader";
import { CacheIndex } from "../CacheIndex";
import { CacheInfo } from "../CacheInfo";
import { CacheSystem } from "../CacheSystem";
import { detectCacheType } from "../CacheType";
import { Dat2CacheLoaderFactory } from "./Dat2CacheLoaderFactory";
import { DatCacheLoaderFactory } from "./DatCacheLoaderFactory";
import { LegacyCacheLoaderFactory } from "./LegacyCacheLoaderFactory";

export interface CacheLoaderFactory {
    getUnderlayTypeLoader(): FloorTypeLoader;
    getOverlayTypeLoader(): OverlayFloorTypeLoader;

    getVarBitTypeLoader(): VarBitTypeLoader;
    getVarcIntTypeLoader(): VarcIntTypeLoader;

    getLocTypeLoader(): LocTypeLoader;
    getNpcTypeLoader(): NpcTypeLoader;
    getObjTypeLoader(): ObjTypeLoader;

    getSeqTypeLoader(): SeqTypeLoader;
    getSpotAnimTypeLoader(): SpotAnimTypeLoader;

    getBasTypeLoader(): BasTypeLoader;

    getParamTypeLoader(): ParamTypeLoader;

    // Player appearance: IdentityKit loader
    getIdkTypeLoader(): IdkTypeLoader;

    getEnumTypeLoader(): EnumTypeLoader | undefined;
    getStructTypeLoader(): StructTypeLoader | undefined;

    getTextureLoader(): TextureLoader;

    getModelLoader(): ModelLoader;
    getSeqFrameLoader(): SeqFrameLoader;
    getSkeletalSeqLoader(): SkeletalSeqLoader | undefined;

    getMapFileLoader(): MapFileLoader;

    getMapScenes(): IndexedSprite[];
    getMapFunctions(): IndexedSprite[];
}

export function getCacheLoaderFactory(
    cacheInfo: CacheInfo,
    cacheSystem: CacheSystem,
): CacheLoaderFactory {
    const cacheType = detectCacheType(cacheInfo);
    switch (cacheType) {
        case "legacy":
            return new LegacyCacheLoaderFactory(cacheInfo, cacheSystem);
        case "dat":
            return new DatCacheLoaderFactory(cacheInfo, cacheType, cacheSystem);
        case "dat2":
            return new Dat2CacheLoaderFactory(cacheInfo, cacheType, cacheSystem);
    }
    throw new Error("Not implemented");
}

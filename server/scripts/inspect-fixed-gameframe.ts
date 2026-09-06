import { ArchiveEnumTypeLoader } from "../../client/rs/config/enumtype/EnumTypeLoader";
import { initCacheEnv } from "../src/world/CacheEnv";
const env = initCacheEnv("caches");
const enums = new ArchiveEnumTypeLoader(env.info, env.indices.configs.getArchive(8));
for (const id of [1129, 1130, 1133, 1134, 1135, 1136, 1137]) {
    const type = enums.load(id);
    console.log(JSON.stringify({ id, keys: type.keys, values: type.intValues, strings: type.stringValues }));
}

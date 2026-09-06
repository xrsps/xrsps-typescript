import { ArchiveObjTypeLoader } from "../../client/rs/config/objtype/ObjTypeLoader";
import { ArchiveNpcTypeLoader } from "../../client/rs/config/npctype/NpcTypeLoader";
import { initCacheEnv } from "../src/world/CacheEnv";

const env = initCacheEnv("caches");
const objects = new ArchiveObjTypeLoader(env.info, env.indices.configs.getArchive(10));
const npcs = new ArchiveNpcTypeLoader(env.info, env.indices.configs.getArchive(9));
for (const id of [22521, 405, 20544, 20545]) {
    const item = objects.load(id);
    console.log(JSON.stringify({ id, name: item.name, model: item.model }));
}
const merchant = npcs.load(2817);
console.log(JSON.stringify({ id: merchant.id, name: merchant.name, actions: merchant.actions }));

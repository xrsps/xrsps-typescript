import { initCacheEnv } from "../src/world/CacheEnv";
import { IndexType } from "../../client/rs/cache/IndexType";
import { parseScriptFromBytes } from "../../client/rs/cs2/Script";
const env = initCacheEnv("caches");
const index = env.cacheSystem.getIndex(IndexType.DAT2.clientScript);
const ids = process.argv.slice(2).map(Number);
for (const id of ids.length ? ids : index.getArchiveIds()) {
    const file = index.getArchive(id).getFile(0);
    if (!file) continue;
    const script = parseScriptFromBytes(id, file.data);
    if (ids.length || script.stringOperands.some(text => text && /accept (trade|challenge)|wishes to (trade|duel)|duel with|challenge request/i.test(text))) {
        console.log(JSON.stringify({ id, name: script.name, intArgs: script.intArgCount, strArgs: script.objArgCount }));
        if (ids.length) console.log(JSON.stringify({ switches: script.switches?.map(table => Object.fromEntries(table)) }));
        if (ids.length) for (let i = 0; i < script.instructions.length; i++) console.log(`${i}: ${script.instructions[i]} ${script.intOperands[i]} ${script.stringOperands[i] || ""}`);
        else console.log(script.stringOperands.filter(Boolean).join(" | "));
    }
}

# 70.9 — Write a cache export script

Write a Bun script that dumps every item from the OSRS cache to a CSV file. Shows how to use the shared cache loader outside the server/client runtime.

## What you're building

A one-shot script that:

1. Opens the OSRS cache at `caches/<version>/`.
2. Walks every item type.
3. Writes `item_id, name, members, stackable, tradeable, examine` to `items.csv`.

## The script

`scripts/cache/export-items-csv.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { CacheSystem } from "../../src/cache/CacheSystem";
import { ObjTypeLoader } from "../../src/cache/ObjTypeLoader";

async function main() {
    const target = (await fs.readFile("target.txt", "utf8")).trim();
    const cacheDir = path.resolve("caches", target);

    console.log(`[export-items-csv] Loading cache from ${cacheDir}`);
    const cache = await CacheSystem.openFromDisk(cacheDir);

    const objTypes = new ObjTypeLoader(cache);
    const maxId = objTypes.size; // however the loader exposes its count
    console.log(`[export-items-csv] Found ${maxId} item entries`);

    const lines: string[] = ["id,name,members,stackable,tradeable,examine"];

    for (let id = 0; id < maxId; id++) {
        const obj = objTypes.load(id);
        if (!obj) continue;

        const name = (obj.name ?? "null").replace(/,/g, ";");
        const examine = (obj.examine ?? "").replace(/,/g, ";");
        const members = obj.members ? "1" : "0";
        const stackable = obj.stackable ? "1" : "0";
        const tradeable = obj.tradeable ? "1" : "0";

        lines.push(`${id},${name},${members},${stackable},${tradeable},${examine}`);
    }

    const outPath = path.resolve("items.csv");
    await fs.writeFile(outPath, lines.join("\n") + "\n");
    console.log(`[export-items-csv] Wrote ${lines.length - 1} rows to ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

## Run it

```sh
bun scripts/cache/export-items-csv.ts
```

Output:

```
[export-items-csv] Loading cache from /.../caches/osrs-237_2026-03-25
[export-items-csv] Found 28492 item entries
[export-items-csv] Wrote 28000 rows to /.../items.csv
```

Open `items.csv` in any spreadsheet tool. Filter, sort, search — whatever you need.

## Why it works

- **`CacheSystem.openFromDisk(dir)`** — opens the cache files from a filesystem path (the client uses an IndexedDB variant; the script uses disk).
- **`ObjTypeLoader`** — decodes item type definitions from index 19 of the cache.
- **`load(id)`** — returns `undefined` if the id doesn't exist (the cache has gaps). Skip those.

The cache loader is pure TypeScript with no DOM dependencies — you can use it in any Bun/Node script.

## Variation: export NPCs

Swap `ObjTypeLoader` for `NpcTypeLoader` and change the field list:

```ts
const npcTypes = new NpcTypeLoader(cache);
const lines = ["id,name,size,combat,actions"];
for (let id = 0; id < npcTypes.size; id++) {
    const npc = npcTypes.load(id);
    if (!npc) continue;
    lines.push(`${id},${npc.name ?? ""},${npc.size ?? 1},${npc.combatLevel ?? 0},"${(npc.actions ?? []).join("|")}"`);
}
```

The same pattern works for loc types (`LocTypeLoader`), animations (`AnimTypeLoader`), textures, models, etc. Each loader has its own return shape.

## Variation: export to SQLite

```sh
bun add @types/bun
```

```ts
import { Database } from "bun:sqlite";

const db = new Database("items.db");
db.exec(`
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY,
        name TEXT,
        members INTEGER,
        stackable INTEGER,
        tradeable INTEGER,
        examine TEXT
    );
`);

const insert = db.prepare(
    "INSERT OR REPLACE INTO items (id, name, members, stackable, tradeable, examine) VALUES (?, ?, ?, ?, ?, ?)",
);

for (let id = 0; id < objTypes.size; id++) {
    const obj = objTypes.load(id);
    if (!obj) continue;
    insert.run(id, obj.name ?? null, obj.members ? 1 : 0, obj.stackable ? 1 : 0, obj.tradeable ? 1 : 0, obj.examine ?? null);
}
```

Now you have a queryable SQLite DB. `bun:sqlite` is built in — no external deps.

## Caveats

- **Cache version pinning** — the script reads `target.txt` for the current cache version. If you bump the cache, re-run the script.
- **Memory** — loading every item at once is fine (items are small); other loaders (models, animations) are heavier. For bulk exports, stream the output rather than accumulating in memory.
- **File path assumptions** — the script assumes it's run from the repo root. Relative paths elsewhere will break.

## Canonical facts

- **Cache system**: `src/cache/CacheSystem.ts` (`openFromDisk(dir)` for Node/Bun, `openFromIndexedDB()` for browsers).
- **Item type loader**: `src/cache/ObjTypeLoader.ts`.
- **NPC type loader**: `src/cache/NpcTypeLoader.ts`.
- **Loc type loader**: `src/cache/LocTypeLoader.ts`.
- **Version pin**: `target.txt` (current: `osrs-237_2026-03-25`).
- **Cache dir**: `caches/<version>/`.
- **Rule**: cache loaders are DOM-free and usable in any Bun/Node script.

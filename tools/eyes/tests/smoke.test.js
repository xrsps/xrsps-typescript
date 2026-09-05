// Smoke test: talk to mcp.js over stdio exactly like an MCP host would, run a
// short play session, and assert on what comes back. Needs a running game
// server and client (EYES_CLIENT_URL), plus `playwright install chromium`.
//
//   EYES_CLIENT_URL=http://localhost:3000 node tests/smoke.test.js

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.EYES_TEST_OUT || path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });

const USER = process.env.EYES_TEST_USER || "eyestester";
const PASS = process.env.EYES_TEST_PASS || "eyespass123";

function assert(cond, msg) {
    if (!cond) throw new Error(`assertion failed: ${msg}`);
    console.log(`  ok  ${msg}`);
}
const textOf = (res) => res.content.find((c) => c.type === "text")?.text ?? "";
const jsonOf = (res) => JSON.parse(textOf(res));
const imageOf = (res) => res.content.find((c) => c.type === "image");

const transport = new StdioClientTransport({ command: "node", args: [path.join(here, "..", "src", "mcp.js")], env: process.env });
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

try {
    const tools = await client.listTools();
    console.log(`tools: ${tools.tools.map((t) => t.name).join(", ")}`);
    assert(tools.tools.length >= 20, `server exposes ${tools.tools.length} tools`);

    console.log("game_open + login (cache boot can take a minute)...");
    const opened = jsonOf(await client.callTool({ name: "game_open", arguments: { username: USER, password: PASS } }));
    assert(opened.loggedIn === true, `logged in as ${opened.playerName}`);
    assert(opened.tile && Number.isInteger(opened.tile.x), `player tile ${JSON.stringify(opened.tile)}`);

    const look = await client.callTool({ name: "game_look", arguments: {} });
    const img = imageOf(look);
    assert(img && img.mimeType === "image/jpeg", `look returned a jpeg (${Math.round((img.data.length * 3) / 4 / 1024)} KB)`);
    fs.writeFileSync(path.join(outDir, "look.jpg"), Buffer.from(img.data, "base64"));

    // Character creator shows on first login: confirm it if present.
    const state0 = jsonOf(await client.callTool({ name: "game_state", arguments: {} }));
    if (state0.openWidgets.some((w) => w.groupId === 679)) {
        // 679 = character creator (a type-0 "modal" sub-interface)
        console.log("  character creator open -> clicking Confirm");
        await client.callTool({ name: "game_click", arguments: { x: 514, y: 446 } });
        await client.callTool({ name: "game_wait", arguments: { ms: 2500 } });
    }

    const npcs = jsonOf(await client.callTool({ name: "game_npcs", arguments: { radius: 30 } }));
    assert(Array.isArray(npcs) && npcs.length > 0, `${npcs.length} NPCs nearby, nearest: ${npcs[0]?.name} @ ${npcs[0]?.tile.x},${npcs[0]?.tile.y}`);
    assert(npcs.every((n) => typeof n.name === "string" && !n.name.startsWith("npc#")), "NPC names resolved from cache");

    const skills = jsonOf(await client.callTool({ name: "game_skills", arguments: {} }));
    assert(skills.length >= 23, `${skills.length} skills reported`);

    const inv = jsonOf(await client.callTool({ name: "game_inventory", arguments: {} }));
    assert(Array.isArray(inv.inventory) && Array.isArray(inv.equipment), `inventory ${inv.inventory.length} items, equipment ${inv.equipment.length}`);

    // Walk 4 tiles east and confirm the tile changes.
    const from = state0.tile;
    const target = { x: from.x + 4, y: from.y };
    await client.callTool({ name: "game_walk", arguments: { x: target.x, y: target.y, run: true } });
    const arrived = await client.callTool({ name: "game_wait", arguments: { until: `eyes.tile() && eyes.tile().x === ${target.x}`, timeoutMs: 15000 } });
    assert(!arrived.isError, `walked from ${from.x},${from.y} to ${target.x},${target.y}`);

    // Chat round-trip: say something, see it echoed by the server.
    const phrase = `eyes online ${Date.now() % 10000}`;
    await client.callTool({ name: "game_say", arguments: { text: phrase } });
    const echoed = await client.callTool({ name: "game_wait", arguments: { until: `eyes.chat(10).some(m => m.text.toLowerCase().includes("${phrase}"))`, timeoutMs: 8000 } });
    assert(!echoed.isError, `public chat "${phrase}" round-tripped (server capitalises it)`);

    // Screen<->tile projection and a hover menu on an NPC.
    const nearest = npcs.find((n) => n.screen);
    if (nearest) {
        const menu = jsonOf(await client.callTool({ name: "game_hover", arguments: { x: nearest.screen.x, y: nearest.screen.y - 10 } }));
        console.log(`  hover over ${nearest.name}: ${menu.entries.map((e) => `${e.action} ${e.target}`).slice(0, 4).join(" | ")}`);
        assert(menu.entries.length > 0, "hover produced a context menu");
    }

    const con = jsonOf(await client.callTool({ name: "game_console", arguments: { pattern: "\\[ws\\]", last: 5 } }));
    assert(con.console.length > 0, `console filter works (${con.console.length} [ws] lines)`);
    assert(con.errors.length === 0, `no uncaught page errors`);

    const evald = jsonOf(await client.callTool({ name: "game_eval", arguments: { expression: "client.localPlayerName" } }));
    assert(typeof evald === "string" && evald.length > 0, `game_eval -> "${evald}"`);

    const final = await client.callTool({ name: "game_look", arguments: {} });
    fs.writeFileSync(path.join(outDir, "final.jpg"), Buffer.from(imageOf(final).data, "base64"));
    console.log(`screenshots in ${outDir}`);
    console.log("SMOKE OK");
} finally {
    await client.callTool({ name: "game_close", arguments: {} }).catch(() => {});
    await client.close();
}

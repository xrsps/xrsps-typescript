#!/usr/bin/env node
// MCP server (stdio) that gives a coding agent eyes on the XRSPS client.
//
//   claude mcp add xrsps-eyes -- node tools/eyes/src/mcp.js
//
// or via the repo's .mcp.json. Every tool is prefixed `game_`.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { GameEyes } from "./GameEyes.js";

const eyes = new GameEyes();

const server = new McpServer({ name: "xrsps-eyes", version: "0.1.0" });

// Every text result is JSON so callers can always parse it.
const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value ?? null, null, 2) }] });
const image = (img, extra) => ({
    content: [
        ...(extra ? [{ type: "text", text: JSON.stringify(extra, null, 2) }] : []),
        { type: "image", data: img.base64, mimeType: img.mimeType },
    ],
});
const guard = (fn) => async (args) => {
    try {
        return await fn(args ?? {});
    } catch (err) {
        return { isError: true, content: [{ type: "text", text: `error: ${err?.message ?? err}` }] };
    }
};

const shotSchema = {
    format: z.enum(["jpeg", "png"]).optional().describe("jpeg (default, small) or png (lossless)"),
    quality: z.number().int().min(20).max(100).optional().describe("jpeg quality, default 80"),
};

// ---------------------------------------------------------------- lifecycle

server.registerTool(
    "game_open",
    {
        title: "Open the game client",
        description:
            "Launch headless Chromium and open the XRSPS client (default http://localhost:3000, override with url or EYES_CLIENT_URL). " +
            "Pass username+password to auto-login and wait until the world is loaded. The game server must already be running.",
        inputSchema: {
            url: z.string().url().optional(),
            username: z.string().optional(),
            password: z.string().optional().describe("8-20 chars; first login registers the account"),
        },
    },
    guard(async ({ url, username, password }) => text(await eyes.open({ url, username, password }))),
);

server.registerTool(
    "game_login",
    {
        title: "Log in",
        description: "Reload the client and auto-login with the given credentials, waiting for the world to load.",
        inputSchema: { username: z.string(), password: z.string() },
    },
    guard(async ({ username, password }) => text(await eyes.login(username, password))),
);

server.registerTool(
    "game_close",
    { title: "Close the browser", description: "Close the headless browser and free resources." },
    guard(async () => {
        await eyes.close();
        return text("closed");
    }),
);

// ---------------------------------------------------------------- seeing

server.registerTool(
    "game_look",
    {
        title: "Look at the screen",
        description:
            "Screenshot + structured game state in one call (game state, player tile, HP, open widgets, last chat lines). " +
            "Use this first, and after every action, to see what actually happened.",
        inputSchema: shotSchema,
    },
    guard(async (opts) => {
        const { state, image: img } = await eyes.look(opts);
        return image(img, state);
    }),
);

server.registerTool(
    "game_screenshot",
    { title: "Screenshot", description: "Just the screenshot (no state). Optional clip region.", inputSchema: {
        ...shotSchema,
        clip: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    } },
    guard(async (opts) => image(await eyes.screenshot(opts))),
);

server.registerTool(
    "game_state",
    { title: "Game state", description: "Structured state: gameState, loggedIn, player tile, HP/prayer, camera, open widgets, menu/modal flags, recent chat." },
    guard(async () => text(await eyes.state())),
);

server.registerTool(
    "game_npcs",
    { title: "Nearby NPCs", description: "NPCs within radius tiles of the player, sorted by distance, with serverId (for game_npc_action) and on-screen coordinates.", inputSchema: { radius: z.number().int().min(1).max(104).optional() } },
    guard(async ({ radius }) => text(await eyes.npcs(radius ?? 15))),
);

server.registerTool(
    "game_players",
    { title: "Nearby players", description: "Other players in view, sorted by distance.", inputSchema: { radius: z.number().int().min(1).max(104).optional() } },
    guard(async ({ radius }) => text(await eyes.players(radius ?? 15))),
);

server.registerTool(
    "game_inventory",
    { title: "Inventory + equipment", description: "Backpack and worn equipment with item ids, names and quantities." },
    guard(async () => text({ inventory: await eyes.inventory(), equipment: await eyes.equipment() })),
);

server.registerTool(
    "game_skills",
    { title: "Skills", description: "All skills: current level, base level, xp." },
    guard(async () => text(await eyes.skills())),
);

server.registerTool(
    "game_chat",
    { title: "Chat history", description: "Most recent chat lines across channels (game messages, public, private...).", inputSchema: { count: z.number().int().min(1).max(200).optional() } },
    guard(async ({ count }) => text(await eyes.chat(count ?? 20))),
);

server.registerTool(
    "game_menu",
    { title: "Current menu", description: "Entries of the context menu the client has built for the current mouse position (use game_hover first). Pick one with game_menu_pick." },
    guard(async () => text(await eyes.menu())),
);

// ---------------------------------------------------------------- input

server.registerTool(
    "game_click",
    { title: "Click", description: "Mouse click at screen coordinates (viewport 1280x800 by default). button: left|right|middle.", inputSchema: {
        x: z.number(), y: z.number(),
        button: z.enum(["left", "right", "middle"]).optional(),
        double: z.boolean().optional(),
    } },
    guard(async ({ x, y, button, double }) => {
        await eyes.click(x, y, { button: button ?? "left", clickCount: double ? 2 : 1 });
        return text("clicked");
    }),
);

server.registerTool(
    "game_hover",
    { title: "Hover", description: "Move the mouse to screen coordinates and return the menu options the client built for that spot (what a left/right click would do).", inputSchema: { x: z.number(), y: z.number() } },
    guard(async ({ x, y }) => text(await eyes.hover(x, y))),
);

server.registerTool(
    "game_menu_pick",
    { title: "Pick menu entry", description: "Invoke a context-menu entry by index (from game_menu / game_hover).", inputSchema: { index: z.number().int().min(0) } },
    guard(async ({ index }) => text(await eyes.menuInvoke(index))),
);

server.registerTool(
    "game_click_tile",
    { title: "Click a world tile", description: "Project a world tile to the screen and click it (walks there / interacts with what's on it).", inputSchema: {
        x: z.number().int(), y: z.number().int(), plane: z.number().int().optional(),
        button: z.enum(["left", "right"]).optional(),
    } },
    guard(async ({ x, y, plane, button }) => text(await eyes.clickTile(x, y, plane, { button: button ?? "left" }))),
);

server.registerTool(
    "game_key",
    { title: "Key press", description: "Press a key (Playwright names: Enter, Escape, F1..F12, ArrowUp, a, Space...). hold = ms to hold it down (camera keys).", inputSchema: { key: z.string(), hold: z.number().int().min(0).optional() } },
    guard(async ({ key, hold }) => text(await eyes.key(key, { hold: hold ?? 0 }))),
);

server.registerTool(
    "game_type",
    { title: "Type text", description: "Type text via the keyboard (chat box, dialogs). enter=true presses Enter afterwards.", inputSchema: { text: z.string(), enter: z.boolean().optional() } },
    guard(async ({ text: t, enter }) => text(await eyes.type(t, { enter: !!enter }))),
);

server.registerTool(
    "game_drag",
    { title: "Drag", description: "Mouse drag between two points (middle button by default = rotate camera; left = drag items/scrollbars).", inputSchema: {
        x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
        button: z.enum(["left", "middle", "right"]).optional(),
    } },
    guard(async ({ x1, y1, x2, y2, button }) => text(await eyes.drag(x1, y1, x2, y2, { button: button ?? "middle" }))),
);

server.registerTool(
    "game_scroll",
    { title: "Scroll wheel", description: "Mouse wheel at a position (zoom the camera over the world, scroll lists over widgets). Negative deltaY zooms in.", inputSchema: { x: z.number(), y: z.number(), deltaY: z.number() } },
    guard(async ({ x, y, deltaY }) => text(await eyes.scroll(x, y, deltaY))),
);

// ---------------------------------------------------------------- game actions (packets)

server.registerTool(
    "game_walk",
    { title: "Walk to tile", description: "Send a walk request to a world tile (server-side pathfinding, like clicking the minimap).", inputSchema: { x: z.number().int(), y: z.number().int(), run: z.boolean().optional() } },
    guard(async ({ x, y, run }) => text(await eyes.walk(x, y, run ?? true))),
);

server.registerTool(
    "game_say",
    { title: "Public chat", description: "Send a public chat message.", inputSchema: { text: z.string().min(1).max(80) } },
    guard(async ({ text: t }) => text(await eyes.say(t))),
);

server.registerTool(
    "game_npc_action",
    { title: "NPC action", description: "Trigger option op (1-5, e.g. 1=Talk-to/Attack depending on NPC) on an NPC by serverId from game_npcs.", inputSchema: { serverId: z.number().int(), op: z.number().int().min(1).max(5).optional() } },
    guard(async ({ serverId, op }) => text(await eyes.npcAction(serverId, op ?? 1))),
);

server.registerTool(
    "game_widget",
    { title: "Open/close widget", description: "Ask the server to open or close a widget group by id.", inputSchema: { groupId: z.number().int(), action: z.enum(["open", "close"]), modal: z.boolean().optional() } },
    guard(async ({ groupId, action, modal }) => text(action === "open" ? await eyes.openWidget(groupId, !!modal) : await eyes.closeWidget(groupId))),
);

// ---------------------------------------------------------------- waiting + logs + escape hatch

server.registerTool(
    "game_wait",
    { title: "Wait", description: "Wait ms (default 1200 = two server ticks), or until a JS expression over (client, eyes) is truthy.", inputSchema: {
        ms: z.number().int().min(0).max(120_000).optional(),
        until: z.string().optional().describe("e.g. eyes.state().tile.x === 3222"),
        timeoutMs: z.number().int().optional(),
    } },
    guard(async ({ ms, until, timeoutMs }) => {
        if (until) return text(await eyes.waitFor(until, timeoutMs ?? 30_000));
        return text(await eyes.wait(ms ?? 1200));
    }),
);

server.registerTool(
    "game_console",
    { title: "Browser console", description: "Recent console output from the client (filter with a regex pattern and/or types), plus uncaught page errors.", inputSchema: {
        last: z.number().int().min(1).max(500).optional(),
        pattern: z.string().optional(),
        types: z.array(z.enum(["log", "info", "warning", "error", "debug"])).optional(),
    } },
    guard(async ({ last, pattern, types }) => text({ console: eyes.consoleLog({ last: last ?? 50, pattern, types }), errors: eyes.pageErrors() })),
);

server.registerTool(
    "game_network",
    { title: "Network log", description: "Recent non-cache HTTP responses (failures always kept) and WebSocket frame counters.", inputSchema: { last: z.number().int().optional(), failedOnly: z.boolean().optional() } },
    guard(async ({ last, failedOnly }) => text(eyes.networkLog({ last: last ?? 50, failedOnly: !!failedOnly }))),
);

server.registerTool(
    "game_eval",
    { title: "Evaluate JS in the client", description: "Escape hatch: evaluate a JS expression inside the page with `client` (window.osrsClient) and `eyes` (window.__eyes) in scope. Result must be JSON-serialisable.", inputSchema: { expression: z.string() } },
    guard(async ({ expression }) => text(await eyes.eval(expression))),
);

// ---------------------------------------------------------------- go

const transport = new StdioServerTransport();
await server.connect(transport);

const bye = () => eyes.close().finally(() => process.exit(0));
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
process.stdin.on("close", bye);

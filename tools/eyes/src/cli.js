#!/usr/bin/env node
// `eyes` CLI — the same GameEyes core behind a tiny local daemon, so shell
// scripts (and agents with only a Bash tool) can drive the game one command
// at a time without relaunching the browser.
//
//   eyes serve [--headed]                 start the daemon (keeps the browser)
//   eyes open [user pass]                 open client (+ auto-login)
//   eyes look [out.jpg]                   state + screenshot to file
//   eyes shot [out.jpg]                   screenshot only
//   eyes state | npcs [r] | players [r] | inv | skills | chat [n] | menu
//   eyes click x y [right|middle] | hover x y | tile x y [plane]
//   eyes key Enter | type "text" [--enter] | drag x1 y1 x2 y2 | scroll x y dy
//   eyes walk x y | say "hi" | npc <serverId> [op] | widget open|close <id>
//   eyes wait [ms] | until "<js expr>" | console [pattern] | net | eval "<js>"
//   eyes close | stop

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { GameEyes } from "./GameEyes.js";

const PORT = Number(process.env.EYES_PORT || 7788);
const [, , cmd, ...argv] = process.argv;

function flag(name) {
    const i = argv.indexOf(name);
    if (i >= 0) {
        argv.splice(i, 1);
        return true;
    }
    return false;
}

const usage = () => {
    const src = fs.readFileSync(new URL(import.meta.url), "utf8");
    console.log(src.split("\n").filter((l) => l.startsWith("//   ")).map((l) => l.slice(5)).join("\n"));
};

// ------------------------------------------------------------------ daemon

async function serve() {
    const headed = flag("--headed");
    const eyes = new GameEyes({ headless: !headed });
    const server = http.createServer(async (req, res) => {
        if (req.method !== "POST" || req.url !== "/rpc") {
            res.writeHead(404);
            return res.end();
        }
        let body = "";
        for await (const chunk of req) body += chunk;
        let out;
        try {
            const { method, args = [] } = JSON.parse(body || "{}");
            if (method === "stop") {
                out = { ok: true, result: "stopping" };
                setTimeout(() => eyes.close().finally(() => process.exit(0)), 50);
            } else if (typeof eyes[method] !== "function") {
                throw new Error(`unknown method ${method}`);
            } else {
                out = { ok: true, result: await eyes[method](...args) };
            }
        } catch (err) {
            out = { ok: false, error: err?.message ?? String(err) };
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
    });
    server.listen(PORT, "127.0.0.1", () => {
        console.log(`eyes daemon on http://127.0.0.1:${PORT} (${headed ? "headed" : "headless"}, client ${eyes.opts.clientUrl})`);
    });
    const bye = () => eyes.close().finally(() => process.exit(0));
    process.on("SIGINT", bye);
    process.on("SIGTERM", bye);
}

// ------------------------------------------------------------------ client

function rpc(method, ...args) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ method, args });
        const req = http.request(
            { host: "127.0.0.1", port: PORT, path: "/rpc", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
            (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () => {
                    try {
                        const out = JSON.parse(body);
                        out.ok ? resolve(out.result) : reject(new Error(out.error));
                    } catch (e) {
                        reject(e);
                    }
                });
            },
        );
        req.on("error", (e) => reject(new Error(`eyes daemon not reachable on :${PORT} — run "eyes serve" first (${e.message})`)));
        req.end(data);
    });
}

const num = (v) => (v === undefined ? undefined : Number(v));
const print = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
const saveImage = (img, file) => {
    const out = path.resolve(file || `eyes-${Date.now()}.${img.mimeType === "image/png" ? "png" : "jpg"}`);
    fs.writeFileSync(out, Buffer.from(img.base64, "base64"));
    return out;
};

async function main() {
    switch (cmd) {
        case "serve":
            return serve();
        case "stop":
            return print(await rpc("stop"));
        case "open":
            return print(await rpc("open", { username: argv[0], password: argv[1] }));
        case "login":
            return print(await rpc("login", argv[0], argv[1]));
        case "close":
            return print(await rpc("close"));
        case "look": {
            const { state, image } = await rpc("look", {});
            print(state);
            return console.log(`screenshot: ${saveImage(image, argv[0])}`);
        }
        case "shot":
            return console.log(saveImage(await rpc("screenshot", { format: argv[0]?.endsWith(".png") ? "png" : "jpeg" }), argv[0]));
        case "state":
            return print(await rpc("state"));
        case "npcs":
            return print(await rpc("npcs", num(argv[0]) ?? 15));
        case "players":
            return print(await rpc("players", num(argv[0]) ?? 15));
        case "inv":
        case "inventory":
            return print({ inventory: await rpc("inventory"), equipment: await rpc("equipment") });
        case "skills":
            return print(await rpc("skills"));
        case "chat":
            return print(await rpc("chat", num(argv[0]) ?? 20));
        case "menu":
            return print(await rpc("menu"));
        case "pick":
            return print(await rpc("menuInvoke", num(argv[0])));
        case "click":
            return print(await rpc("click", num(argv[0]), num(argv[1]), { button: argv[2] || "left" }));
        case "hover":
            return print(await rpc("hover", num(argv[0]), num(argv[1])));
        case "tile":
            return print(await rpc("clickTile", num(argv[0]), num(argv[1]), num(argv[2])));
        case "key":
            return print(await rpc("key", argv[0], { hold: num(argv[1]) ?? 0 }));
        case "type": {
            const enter = flag("--enter");
            return print(await rpc("type", argv.join(" "), { enter }));
        }
        case "drag":
            return print(await rpc("drag", num(argv[0]), num(argv[1]), num(argv[2]), num(argv[3]), { button: argv[4] || "middle" }));
        case "scroll":
            return print(await rpc("scroll", num(argv[0]), num(argv[1]), num(argv[2])));
        case "walk":
            return print(await rpc("walk", num(argv[0]), num(argv[1]), !flag("--walk")));
        case "say":
            return print(await rpc("say", argv.join(" ")));
        case "npc":
            return print(await rpc("npcAction", num(argv[0]), num(argv[1]) ?? 1));
        case "widget":
            return print(await rpc(argv[0] === "close" ? "closeWidget" : "openWidget", num(argv[1])));
        case "wait":
            return print(await rpc("wait", num(argv[0]) ?? 1200));
        case "until":
            return print(await rpc("waitFor", argv[0], num(argv[1]) ?? 30000));
        case "console":
            return print({ console: await rpc("consoleLog", { last: 50, pattern: argv[0] }), errors: await rpc("pageErrors") });
        case "net":
            return print(await rpc("networkLog", { last: 50, failedOnly: flag("--failed") }));
        case "eval":
            return print(await rpc("eval", argv.join(" ")));
        default:
            usage();
            process.exit(cmd ? 1 : 0);
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});

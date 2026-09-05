// GameEyes — drives the XRSPS browser client in (headless) Chromium so a coding
// agent can *see* the game: screenshots, structured game state (via the in-client
// `window.__eyes` bridge), input, console/network capture.
//
// Plain JavaScript (ESM). Playwright is the only heavy dependency.

import { chromium } from "playwright";

const DEFAULTS = {
    clientUrl: process.env.EYES_CLIENT_URL || "http://localhost:3000",
    headless: (process.env.EYES_HEADED || "").trim() === "" ? true : false,
    width: Number(process.env.EYES_WIDTH || 1280),
    height: Number(process.env.EYES_HEIGHT || 800),
    executablePath: process.env.EYES_CHROMIUM || undefined,
    /** ms to wait for the client (cache download + boot) before giving up */
    bootTimeoutMs: Number(process.env.EYES_BOOT_TIMEOUT_MS || 180_000),
    loginTimeoutMs: Number(process.env.EYES_LOGIN_TIMEOUT_MS || 120_000),
    /** ms to wait for the first scene to render after login (LOADING_GAME -> LOGGED_IN) */
    sceneTimeoutMs: Number(process.env.EYES_SCENE_TIMEOUT_MS || 90_000),
};

const RING = 500;

function ring(arr, item) {
    arr.push(item);
    if (arr.length > RING) arr.splice(0, arr.length - RING);
}

export class GameEyes {
    constructor(options = {}) {
        this.opts = { ...DEFAULTS, ...options };
        this.browser = null;
        this.context = null;
        this.page = null;
        this.console = [];
        this.errors = [];
        this.network = [];
        this.websockets = [];
        this.startedAt = null;
    }

    // ------------------------------------------------------------ lifecycle

    get isOpen() {
        return !!this.page && !this.page.isClosed();
    }

    async launch() {
        if (this.browser) return;
        this.browser = await chromium.launch({
            headless: this.opts.headless,
            executablePath: this.opts.executablePath,
            args: [
                // WebGL2 without a GPU: SwiftShader via ANGLE.
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--ignore-gpu-blocklist",
                "--enable-webgl",
                "--autoplay-policy=no-user-gesture-required",
                "--no-sandbox",
            ],
        });
        this.context = await this.browser.newContext({
            viewport: { width: this.opts.width, height: this.opts.height },
            deviceScaleFactor: 1,
        });
        this.page = await this.context.newPage();
        this.startedAt = Date.now();
        this._wire(this.page);
    }

    _wire(page) {
        const t = () => Date.now() - this.startedAt;
        page.on("console", (m) => ring(this.console, { t: t(), type: m.type(), text: m.text() }));
        page.on("pageerror", (e) => ring(this.errors, { t: t(), message: e.message, stack: e.stack }));
        page.on("websocket", (ws) => {
            const entry = { t: t(), url: ws.url(), sent: 0, received: 0, closed: false };
            ring(this.websockets, entry);
            ws.on("framesent", () => entry.sent++);
            ws.on("framereceived", () => entry.received++);
            ws.on("close", () => (entry.closed = true));
        });
        page.on("response", async (r) => {
            const s = r.status();
            const u = r.url();
            // Keep failures and anything that isn't the cache firehose.
            if (s >= 400 || !/\/caches\//.test(u)) {
                ring(this.network, { t: t(), status: s, method: r.request().method(), url: u });
            }
        });
        page.on("requestfailed", (r) =>
            ring(this.network, { t: t(), status: 0, method: r.method(), url: r.url(), error: r.failure()?.errorText }),
        );
    }

    async close() {
        try {
            await this.browser?.close();
        } finally {
            this.browser = this.context = this.page = null;
        }
    }

    // ------------------------------------------------------------ navigation

    /**
     * Open the client. With credentials, the client auto-logs in (URL params
     * are consumed and scrubbed by the client itself) and we wait for the world.
     */
    async open({ url, username, password, waitForLogin = true } = {}) {
        await this.launch();
        const base = url || this.opts.clientUrl;
        const target = new URL(base);
        target.searchParams.set("eyes", "1");
        if (username) target.searchParams.set("username", username);
        if (password) target.searchParams.set("password", password);
        this.console.length = 0;
        this.errors.length = 0;
        this.network.length = 0;
        this.websockets.length = 0;
        await this.page.goto(target.toString(), { waitUntil: "domcontentloaded" });
        await this.waitForBridge();
        if (username && password && waitForLogin) {
            await this.waitForLogin();
        }
        return this.state();
    }

    async login(username, password) {
        return this.open({ username, password });
    }

    async waitForBridge(timeoutMs = this.opts.bootTimeoutMs) {
        await this.page.waitForFunction(() => !!globalThis.__eyes, null, { timeout: timeoutMs, polling: 500 });
    }

    async waitForLogin(timeoutMs = this.opts.loginTimeoutMs) {
        await this.page.waitForFunction(
            () => {
                const e = globalThis.__eyes;
                if (!e) return false;
                const s = e.state();
                return s.loggedIn && s.tile !== null;
            },
            null,
            { timeout: timeoutMs, polling: 500 },
        );
        // Then wait for the first scene to stream in (gameState LOADING_GAME -> LOGGED_IN),
        // so the first screenshot is the world and not the "Loading - please wait" overlay.
        // Not fatal: a slow cache stream just means the caller sees LOADING_GAME in state().
        await this.page
            .waitForFunction(() => globalThis.__eyes?.state().gameStateId === 30, null, {
                timeout: this.opts.sceneTimeoutMs,
                polling: 500,
            })
            .catch(() => {});
        await this.page.waitForTimeout(1000);
    }

    async reload() {
        await this.page.reload({ waitUntil: "domcontentloaded" });
        await this.waitForBridge();
        return this.state();
    }

    // ------------------------------------------------------------ bridge

    /** Call a method on window.__eyes inside the page. */
    async bridge(method, ...args) {
        this._assertOpen();
        return this.page.evaluate(
            ([m, a]) => {
                const e = globalThis.__eyes;
                if (!e) throw new Error("eyes bridge not installed (open the client with ?eyes=1)");
                const fn = e[m];
                if (typeof fn !== "function") throw new Error(`unknown bridge method: ${m}`);
                const out = fn.apply(e, a);
                return out === undefined ? null : JSON.parse(JSON.stringify(out));
            },
            [method, args],
        );
    }

    state() {
        return this.bridge("state");
    }
    npcs(radius = 15, includeUnnamed = false) {
        return this.bridge("npcs", radius, includeUnnamed);
    }
    players(radius = 15) {
        return this.bridge("players", radius);
    }
    inventory() {
        return this.bridge("inventory");
    }
    equipment() {
        return this.bridge("equipment");
    }
    skills() {
        return this.bridge("skills");
    }
    chat(count = 20) {
        return this.bridge("chat", count);
    }
    menu() {
        return this.bridge("menu");
    }
    menuInvoke(index) {
        return this.bridge("menuInvoke", index);
    }
    walk(x, y, run = true) {
        return this.bridge("walk", x, y, run);
    }
    say(text) {
        return this.bridge("say", text);
    }
    npcAction(serverId, op = 1) {
        return this.bridge("npcAction", serverId, op);
    }
    playerAction(serverId, op) {
        return this.bridge("playerAction", serverId, op);
    }
    locAction(locId, x, y, plane, action) {
        return this.bridge("locAction", locId, x, y, plane, action);
    }
    openWidget(groupId, modal = false) {
        return this.bridge("openWidget", groupId, modal);
    }
    closeWidget(groupId) {
        return this.bridge("closeWidget", groupId);
    }
    tileToScreen(x, y, plane) {
        return this.bridge("tileToScreen", x, y, plane);
    }
    screenToTile(x, y) {
        return this.bridge("screenToTile", x, y);
    }

    /** Evaluate arbitrary JS in the page (window.osrsClient / window.__eyes are available). */
    async eval(expression) {
        this._assertOpen();
        return this.page.evaluate((src) => {
            // eslint-disable-next-line no-new-func
            const out = new Function("client", "eyes", `return (${src});`)(globalThis.osrsClient, globalThis.__eyes);
            return out === undefined ? null : JSON.parse(JSON.stringify(out));
        }, expression);
    }

    // ------------------------------------------------------------ seeing

    /**
     * Screenshot as a base64 string. JPEG by default (a 3D scene compresses
     * ~8x better than PNG, which matters when the image goes to a model).
     */
    async screenshot({ format = "jpeg", quality = 80, clip } = {}) {
        this._assertOpen();
        const buf = await this.page.screenshot({
            type: format,
            ...(format === "jpeg" ? { quality } : {}),
            ...(clip ? { clip } : {}),
        });
        return { mimeType: format === "jpeg" ? "image/jpeg" : "image/png", base64: buf.toString("base64"), bytes: buf.length };
    }

    /** State + screenshot in one go — "look at the screen". */
    async look(opts) {
        const [state, image] = await Promise.all([this.state().catch((e) => ({ error: String(e) })), this.screenshot(opts)]);
        return { state, image };
    }

    // ------------------------------------------------------------ input

    async click(x, y, { button = "left", clickCount = 1, delay = 40 } = {}) {
        this._assertOpen();
        await this.page.mouse.move(x, y);
        await this.page.waitForTimeout(30); // let the client build the hover menu
        await this.page.mouse.click(x, y, { button, clickCount, delay });
        return true;
    }

    async hover(x, y) {
        this._assertOpen();
        await this.page.mouse.move(x, y);
        await this.page.waitForTimeout(60);
        return this.menu();
    }

    async drag(x1, y1, x2, y2, { button = "middle", steps = 12 } = {}) {
        this._assertOpen();
        await this.page.mouse.move(x1, y1);
        await this.page.mouse.down({ button });
        await this.page.mouse.move(x2, y2, { steps });
        await this.page.mouse.up({ button });
        return true;
    }

    async scroll(x, y, deltaY) {
        this._assertOpen();
        await this.page.mouse.move(x, y);
        await this.page.mouse.wheel(0, deltaY);
        return true;
    }

    async key(key, { hold = 0 } = {}) {
        this._assertOpen();
        if (hold > 0) {
            await this.page.keyboard.down(key);
            await this.page.waitForTimeout(hold);
            await this.page.keyboard.up(key);
        } else {
            await this.page.keyboard.press(key);
        }
        return true;
    }

    async type(text, { enter = false, delay = 15 } = {}) {
        this._assertOpen();
        await this.page.keyboard.type(text, { delay });
        if (enter) await this.page.keyboard.press("Enter");
        return true;
    }

    /** Click on a world tile (projects it to the screen first). */
    async clickTile(x, y, plane, opts) {
        const s = await this.tileToScreen(x, y, plane);
        if (!s) throw new Error(`tile ${x},${y} is not on screen`);
        await this.click(s.x, s.y, opts);
        return s;
    }

    // ------------------------------------------------------------ waiting

    async wait(ms) {
        this._assertOpen();
        await this.page.waitForTimeout(ms);
        return true;
    }

    /** Wait until a JS expression over (client, eyes) is truthy. */
    async waitFor(expression, timeoutMs = 30_000) {
        this._assertOpen();
        await this.page.waitForFunction(
            (src) => {
                try {
                    // eslint-disable-next-line no-new-func
                    return !!new Function("client", "eyes", `return (${src});`)(globalThis.osrsClient, globalThis.__eyes);
                } catch {
                    return false;
                }
            },
            expression,
            { timeout: timeoutMs, polling: 250 },
        );
        return true;
    }

    // ------------------------------------------------------------ logs

    consoleLog({ last = 50, pattern, types } = {}) {
        let items = this.console;
        if (types?.length) items = items.filter((c) => types.includes(c.type));
        if (pattern) {
            const re = new RegExp(pattern, "i");
            items = items.filter((c) => re.test(c.text));
        }
        return items.slice(-last);
    }

    pageErrors(last = 20) {
        return this.errors.slice(-last);
    }

    networkLog({ last = 50, failedOnly = false } = {}) {
        let items = this.network;
        if (failedOnly) items = items.filter((n) => n.status === 0 || n.status >= 400);
        return { requests: items.slice(-last), websockets: this.websockets.slice(-5) };
    }

    _assertOpen() {
        if (!this.isOpen) throw new Error("no page open — call open() first");
    }
}

import { CacheIndex } from "../../rs/cache/CacheIndex";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { getOrientation, isMobileMode, isTouchDevice } from "../../util/DeviceUtil";
import { GameState, LoginIndex } from "./GameState";
import { LoginAction, LoginActions } from "./LoginAction";
import { LoginScreenAnimation } from "./LoginScreenAnimation";
import type { LoginState } from "./LoginState";

/** Type alias for rendering context (supports both regular and offscreen canvas) */
type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Cached world grid layout parameters.
 * Computed once and reused across drawWorldSelect, drawWorldSelectGridOnly, and drawWorldSelectHoverOnly.
 */
interface WorldGridLayout {
    cols: number;
    rows: number;
    xGap: number;
    yGap: number;
    xOffset: number;
    yOffset: number;
    rowWidth: number;
    rowHeight: number;
    worldCount: number;
    columnsPerPage: number;
    totalColumns: number;
}

/**
 * Result of hover detection on world grid.
 */
interface WorldHoverResult {
    index: number; // Index in sorted worlds array, or -1 if none
    world: World | null; // The hovered world, or null
    x: number; // X position of hovered cell
    y: number; // Y position of hovered cell
}

/**
 * Layout configuration for responsive/mobile rendering.
 * Computed based on viewport size and device capabilities.
 */
export interface LoginLayoutConfig {
    /** Scale factor for all positions/sizes (1.0 = desktop baseline) */
    scale: number;
    /** Mobile mode active (touch device or forced via URL) */
    isMobile: boolean;
    /** Touch input detected */
    isTouch: boolean;
    /** Minimum touch target size (44px scaled) */
    minTouchTarget: number;
    /** Use list view for world select instead of grid */
    worldSelectListMode: boolean;
    /** Screen orientation */
    orientation: "portrait" | "landscape";
    /** Viewport width */
    viewportWidth: number;
    /** Viewport height */
    viewportHeight: number;
}

/**
 * World data for world select display.
 * Mirrors OSRS World.java structure.
 */
export interface World {
    id: number;
    population: number; // -1 = offline
    location: number; // 0=US, 1=UK, 3=Australia, 7=Germany
    activity: string; // World type description
    properties: number; // Flags: 1=members, 4=pvp, etc.
}

/**
 * World properties flags (matches OSRS)
 */
export const WorldFlags = {
    MEMBERS: 1,
    PVP: 4,
    BOUNTY: 0x20,
    HIGH_RISK: 0x400,
    SKILL_TOTAL: 0x800,
    BETA: 0x20000,
    FRESH_START: 0x2000000,
    DEADMAN: 0x20000000,
} as const;

/**
 * World background type indices (matches sl_back sprite indices)
 */
enum WorldBackgroundType {
    FREE_NORMAL = 0,
    MEMBERS_NORMAL = 1,
    FREE_PVP = 2,
    MEMBERS_PVP = 3,
    FREE_BETA = 4,
    MEMBERS_BETA = 5,
    FREE_DEADMAN = 6,
    MEMBERS_DEADMAN = 7,
    FREE_FRESH_START = 8,
    MEMBERS_FRESH_START = 9,
    FREE_HIGH_RISK = 10,
    MEMBERS_HIGH_RISK = 11,
}

/**
 * Mock world list for testing.
 * In production, this would come from the server.
 */
const MOCK_WORLDS: World[] = [
    { id: 301, population: 487, location: 0, activity: "Trade - Free", properties: 0 },
    { id: 302, population: 1243, location: 0, activity: "Trade - Members", properties: 1 },
    { id: 303, population: 89, location: 1, activity: "Skill Total 500", properties: 1 },
    { id: 304, population: 234, location: 1, activity: "PvP World", properties: 1 | 4 },
    { id: 305, population: 567, location: 0, activity: "Free-to-play", properties: 0 },
    { id: 306, population: 1890, location: 3, activity: "Members", properties: 1 },
    { id: 307, population: 45, location: 7, activity: "Skill Total 750", properties: 1 },
    { id: 308, population: 678, location: 0, activity: "Members", properties: 1 },
    { id: 309, population: -1, location: 1, activity: "Offline", properties: 0 },
    { id: 310, population: 432, location: 0, activity: "Members", properties: 1 },
    { id: 311, population: 123, location: 3, activity: "Free-to-play", properties: 0 },
    { id: 312, population: 876, location: 7, activity: "Members", properties: 1 },
    { id: 313, population: 345, location: 0, activity: "Bounty Hunter", properties: 1 },
    { id: 314, population: 654, location: 1, activity: "Members", properties: 1 },
    { id: 315, population: 234, location: 0, activity: "Free-to-play", properties: 0 },
    { id: 316, population: 1567, location: 0, activity: "Members", properties: 1 },
];

/**
 * Server list entry for the server browser.
 */
export interface ServerListEntry {
    name: string;
    address: string;
    secure: boolean;
    playerCount: number | null;
    maxPlayers: number;
}

const PLACEHOLDER_SERVERS: ServerListEntry[] = [
    { name: "Local Development", address: "localhost:43594", secure: false, playerCount: null, maxPlayers: 2047 },
    { name: "Grizz Island", address: "grizzisland.playit.plus:48165", secure: false, playerCount: null, maxPlayers: 2047 },
];

/**
 * Login screen renderer.
 * Instance-based class that renders login screens based on LoginState.
 * Sprites, fonts, and canvas are instance properties.
 * All rendering methods take LoginState as parameter.
 */
export class LoginRenderer {
    // ========== Layout Constants ==========

    /** Standard login box X position (within 765px content area) */
    private readonly LOGIN_BOX_X = 202;

    /** Login box center (loginBoxX + 180) */
    private readonly LOGIN_BOX_CENTER = 382;

    /** Standard content width (login UI is designed for this) */
    private readonly CONTENT_WIDTH = 765;

    /** Native login scene width */
    private readonly SCENE_WIDTH = 765;

    /** Native login scene height */
    private readonly SCENE_HEIGHT = 503;

    /** Width of the background art asset */
    private static readonly TITLE_BG_WIDTH = 1089;

    /** Horizontal crop applied to the background art in the 765px login scene */
    private static readonly TITLE_BG_CROP_X = Math.floor((LoginRenderer.TITLE_BG_WIDTH - 765) / 2);

    /** Max background container width */
    private static readonly MAX_BG_WIDTH = 765;

    /** Max background container height */
    private static readonly MAX_BG_HEIGHT = 503;

    // ========== Layout State ==========

    /** Horizontal offset to center container within canvas */
    containerX: number = 0;

    /** Container width (matches native login background width) */
    containerWidth: number = LoginRenderer.MAX_BG_WIDTH;

    /** Container height (matches native login background height) */
    containerHeight: number = LoginRenderer.MAX_BG_HEIGHT;

    /** Horizontal padding to center content within container */
    xPadding: number = 0;

    /** Current logical layout width (pre-scale coordinate space) */
    canvasWidth: number = this.SCENE_WIDTH;

    /** Current logical layout height (pre-scale coordinate space) */
    canvasHeight: number = this.SCENE_HEIGHT;

    /** Render-space scale applied to map layout coordinates onto the surface */
    private renderScale: number = 1.0;

    /** Render-space X offset applied after scaling */
    private renderOffsetX: number = 0;

    /** Render-space Y offset applied after scaling */
    private renderOffsetY: number = 0;

    /** Current draw surface width for visibility calculations */
    private renderSurfaceWidth: number = this.SCENE_WIDTH;

    /** Whether the mobile keyboard-focused login framing is active */
    private mobileKeyboardFocusActive: boolean = false;

    /** Active login field while mobile keyboard framing is active */
    private mobileKeyboardFocusField: number = 0;

    /** Computed login box X */
    loginBoxX: number = 202;

    /** Computed login box center */
    loginBoxCenter: number = 382;

    // ========== Title Background ==========

    /** Title background image (loaded from loading-bg.jpg) */
    titleBackgroundImage: ImageBitmap | undefined;

    // ========== Sprites ==========

    logoSprite: IndexedSprite | undefined;
    logoImage: HTMLImageElement | undefined;
    logoImageLoaded: boolean = false;
    titleboxSprite: IndexedSprite | undefined;
    titlebuttonSprite: IndexedSprite | undefined;
    titlebuttonLargeSprite: IndexedSprite | undefined;
    playNowTextSprite: IndexedSprite | undefined;
    runesSprites: IndexedSprite[] | undefined;
    titleMuteSprites: IndexedSprite[] | undefined;
    optionsRadioSprite0: IndexedSprite | undefined;
    optionsRadioSprite2: IndexedSprite | undefined;
    optionsRadioSprite4: IndexedSprite | undefined;
    optionsRadioSprite6: IndexedSprite | undefined;
    worldSelectLeftSprite: IndexedSprite | undefined;
    worldSelectRightSprite: IndexedSprite | undefined;
    worldSelectButtonSprite: IndexedSprite | undefined;
    worldSelectBackSprites: IndexedSprite[] | undefined; // World row backgrounds
    worldSelectFlagSprites: IndexedSprite[] | undefined; // Country flags
    worldSelectStarSprites: IndexedSprite[] | undefined; // Members/free icons
    worldSelectArrowSprites: IndexedSprite[] | undefined; // Sort arrows

    // ========== Fonts ==========

    fontBold12: BitmapFont | undefined;
    fontPlain11: BitmapFont | undefined;
    fontPlain12: BitmapFont | undefined;

    // ========== Animation ==========

    /** Client cycle counter for animations (legacy, still used for fire) */
    cycle: number = 0;

    /** Time-based caret blink state */
    private lastTickTime: number = 0;
    private caretBlinkMs: number = 0;
    private static readonly CARET_BLINK_INTERVAL_MS = 500; // 500ms on, 500ms off

    /** Mouse X position for hover detection */
    mouseX: number = 0;

    /** Mouse Y position for hover detection */
    mouseY: number = 0;

    /** Server list entries */
    serverList: ServerListEntry[] = PLACEHOLDER_SERVERS;

    /** Whether a server probe is currently in flight */
    probing: boolean = false;

    /** Whether servers have been probed at least once */
    probed: boolean = false;

    refreshServerList(): void {
        if (this.probing) return;
        this.probed = false;
        this.probing = true;

        const promises = this.serverList.map(async (server) => {
            const protocol = server.secure ? "https" : "http";
            let httpOk = false;
            try {
                const res = await fetch(`${protocol}://${server.address}/status`, {
                    signal: AbortSignal.timeout(8000),
                });
                if (res.ok) {
                    const data = await res.json();
                    server.playerCount = typeof data.playerCount === "number" ? data.playerCount : null;
                    if (typeof data.maxPlayers === "number") server.maxPlayers = data.maxPlayers;
                    if (typeof data.serverName === "string") server.name = data.serverName;
                    httpOk = true;
                }
            } catch { /* fall through to ws probe */ }

            if (!httpOk) {
                const wsProto = server.secure ? "wss" : "ws";
                const alive = await this.probeWebSocket(`${wsProto}://${server.address}`, 5000);
                server.playerCount = alive ? -1 : null;
            }
        });

        Promise.all(promises).finally(() => {
            this.probing = false;
            this.probed = true;
        });
    }

    private probeWebSocket(url: string, timeoutMs: number): Promise<boolean> {
        return new Promise((resolve) => {
            let settled = false;
            const ws = new WebSocket(url);
            const timer = setTimeout(() => {
                if (!settled) { settled = true; ws.close(); resolve(false); }
            }, timeoutMs);
            ws.addEventListener("open", () => {
                if (!settled) { settled = true; clearTimeout(timer); ws.close(); resolve(true); }
            });
            ws.addEventListener("error", () => {
                if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
            });
        });
    }

    /** World sorting option (0=world, 1=players, 2=location, 3=type) */
    worldSortOption: number = 0;

    /** World sorting direction (0=ascending, 1=descending) */
    worldSortDirection: number = 0;

    /** Current sorted worlds list (for click handling) */
    currentSortedWorlds: World[] = [];

    // Performance: cache sorted worlds to avoid O(n log n) sort every frame
    private cachedSortedWorlds: World[] | null = null;
    private cachedSortOption: number = -1;
    private cachedSortDirection: number = -1;

    /** Login screen runes animation */
    loginScreenRunesAnimation: LoginScreenAnimation | undefined;

    // ========== Canvas ==========

    private canvas: HTMLCanvasElement | undefined;
    private ctx: CanvasRenderingContext2D | undefined;

    // Performance: cache rendered sprites as OffscreenCanvas (synchronous, no async overhead)
    private spriteCache = new WeakMap<IndexedSprite, OffscreenCanvas>();

    // Performance: cache text measurements to avoid repeated font.measure() calls
    private textMeasureCache = new WeakMap<BitmapFont, Map<string, number>>();

    // Performance: cache world select grid to avoid redrawing 80+ sprites/text on hover
    private worldSelectCache: OffscreenCanvas | null = null;
    private worldSelectCacheCtx: OffscreenCanvasRenderingContext2D | null = null;
    private worldSelectCachePage: number = -1;
    private worldSelectCacheSortOption: number = -1;
    private worldSelectCacheSortDirection: number = -1;
    private worldSelectCacheWidth: number = 0;
    private worldSelectCacheHeight: number = 0;

    // Performance: cache entire title screen (without hover) for fast hover-only updates
    private titleCache: OffscreenCanvas | null = null;
    private titleCacheCtx: OffscreenCanvasRenderingContext2D | null = null;
    private titleCacheStateHash: string = "";
    private titleCacheWidth: number = 0;
    private titleCacheHeight: number = 0;
    // ========== Mobile/Responsive Layout ==========

    /** Current layout configuration for responsive rendering */
    layoutConfig: LoginLayoutConfig = {
        scale: 1.0,
        isMobile: isMobileMode,
        isTouch: isTouchDevice,
        minTouchTarget: 44,
        worldSelectListMode: false,
        orientation: "landscape",
        viewportWidth: 765,
        viewportHeight: 503,
    };

    /** Scaled position cache for responsive rendering */
    private scaledLoginBoxX: number = 202;
    private scaledLoginBoxCenter: number = 382;

    // Performance: cache world grid layout to avoid redundant calculations
    private cachedGridLayout: WorldGridLayout | null = null;
    private cachedGridWorldCount: number = -1;

    // ========== Constructor ==========

    // ========== Layout Configuration ==========

    /**
     * Compute layout configuration based on viewport size and device capabilities.
     * Call this at the start of each frame or when viewport changes.
     */
    computeLayoutConfig(canvasWidth: number, canvasHeight: number): LoginLayoutConfig {
        const orientation = getOrientation();
        const isMobile = isMobileMode;
        const isTouch = isTouchDevice;

        // OSRS desktop title/login stays authored at native fixed-mode size. Only mobile layout
        // scales the scene down to fit smaller handheld viewports.
        let scale = 1.0;
        if (isMobile) {
            const fitScale = Math.min(
                1.0,
                canvasWidth / this.SCENE_WIDTH,
                canvasHeight / this.SCENE_HEIGHT,
            );
            scale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1.0;
        }

        // On mobile with small screens (portrait or small landscape), use list mode for world select
        // List mode provides 60px rows vs 19px grid rows for touch targets
        const worldSelectListMode = isMobile && (orientation === "portrait" || canvasHeight < 400);

        // Minimum touch target (44px is Apple HIG recommendation)
        const minTouchTarget = isTouch ? 44 : 0;

        this.layoutConfig = {
            scale,
            isMobile,
            isTouch,
            minTouchTarget,
            worldSelectListMode,
            orientation,
            viewportWidth: canvasWidth,
            viewportHeight: canvasHeight,
        };

        // Update scaled positions
        this.scaledLoginBoxX = this.loginBoxX * scale;
        this.scaledLoginBoxCenter = this.loginBoxCenter * scale;

        return this.layoutConfig;
    }

    /**
     * Get the current layout config (for external access).
     */
    getLayoutConfig(): LoginLayoutConfig {
        return this.layoutConfig;
    }

    getRenderScale(): number {
        return this.renderScale;
    }

    getTitleAssetStateHash(): string {
        return `${this.logoImageLoaded ? 1 : 0}|${this.logoSprite ? 1 : 0}|${
            this.titleBackgroundImage ? 1 : 0
        }|${this.titleboxSprite ? 1 : 0}|${this.titlebuttonSprite ? 1 : 0}|${
            this.titleMuteSprites?.length ?? 0
        }|${this.fontBold12 ? 1 : 0}|${this.fontPlain11 ? 1 : 0}|${this.fontPlain12 ? 1 : 0}|${
            this.loginScreenRunesAnimation ? 1 : 0
        }`;
    }

    syncMobileViewportState(state: LoginState, keyboardFocused: boolean = false): void {
        this.mobileKeyboardFocusActive =
            state.loginIndex === LoginIndex.LOGIN_FORM &&
            state.onMobile &&
            state.virtualKeyboardVisible &&
            keyboardFocused;
        this.mobileKeyboardFocusField = state.currentLoginField === 1 ? 1 : 0;
    }

    getViewportTransformStateHash(): string {
        return `${this.mobileKeyboardFocusActive ? 1 : 0}|${this.mobileKeyboardFocusField}|${
            this.renderScale
        }|${this.renderOffsetX}|${this.renderOffsetY}`;
    }

    private clampFocusedOffset(
        offset: number,
        scaledSceneSize: number,
        surfaceSize: number,
    ): number {
        if (!Number.isFinite(offset)) {
            return 0;
        }
        if (scaledSceneSize <= surfaceSize) {
            return Math.round((surfaceSize - scaledSceneSize) / 2);
        }

        const minOffset = Math.round(surfaceSize - scaledSceneSize);
        if (offset < minOffset) {
            return minOffset;
        }
        if (offset > 0) {
            return 0;
        }
        return Math.round(offset);
    }

    private getMobileKeyboardFocusTransform(
        viewportWidth: number,
        viewportHeight: number,
        drawSurfaceWidth: number,
        drawSurfaceHeight: number,
        safeSurfaceScale: number,
        layoutScale: number,
    ): { renderScale: number; renderOffsetX: number; renderOffsetY: number } | undefined {
        if (!this.mobileKeyboardFocusActive || !this.layoutConfig.isMobile) {
            return undefined;
        }

        const coverScale = Math.max(
            viewportWidth / this.SCENE_WIDTH,
            viewportHeight / this.SCENE_HEIGHT,
        );
        const focusedScale = Math.max(layoutScale, Math.min(2.4, coverScale * 1.15));
        if (!Number.isFinite(focusedScale) || focusedScale <= layoutScale) {
            return undefined;
        }

        const renderScale = focusedScale * safeSurfaceScale;
        const scaledSceneWidth = this.SCENE_WIDTH * renderScale;
        const scaledSceneHeight = this.SCENE_HEIGHT * renderScale;
        const focusX = this.LOGIN_BOX_CENTER;
        const focusY = this.mobileKeyboardFocusField === 1 ? 256 : 241;
        const targetFocusX = drawSurfaceWidth / 2;
        const targetFocusY = drawSurfaceHeight * 0.46;
        const renderOffsetX = this.clampFocusedOffset(
            targetFocusX - focusX * renderScale,
            scaledSceneWidth,
            drawSurfaceWidth,
        );
        const renderOffsetY = this.clampFocusedOffset(
            targetFocusY - focusY * renderScale,
            scaledSceneHeight,
            drawSurfaceHeight,
        );

        return {
            renderScale,
            renderOffsetX,
            renderOffsetY,
        };
    }

    private withRenderTransform(ctx: RenderContext, drawFn: () => void): void {
        const scale = this.renderScale;
        const offsetX = this.renderOffsetX;
        const offsetY = this.renderOffsetY;
        const priorSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;

        if (Math.abs(scale - 1.0) < 0.0001 && offsetX === 0 && offsetY === 0) {
            try {
                drawFn();
            } finally {
                ctx.imageSmoothingEnabled = priorSmoothing;
            }
            return;
        }

        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
        try {
            drawFn();
        } finally {
            ctx.restore();
            ctx.imageSmoothingEnabled = priorSmoothing;
        }
    }

    private toLayoutPoint(x: number, y: number): { x: number; y: number } {
        const scale = this.renderScale;
        if (!Number.isFinite(scale) || scale <= 0) {
            return { x: x | 0, y: y | 0 };
        }

        const layoutX = Math.floor((x - this.renderOffsetX) / scale);
        const layoutY = Math.floor((y - this.renderOffsetY) / scale);
        return { x: layoutX, y: layoutY };
    }

    constructor() {
        // Initialize with default layout
        this.updateLayout(this.SCENE_WIDTH, this.SCENE_HEIGHT);
    }

    // ========== Public Accessors ==========

    getCanvas(width: number, height: number): HTMLCanvasElement {
        if (!this.canvas) {
            this.canvas = document.createElement("canvas");
        }
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.ctx = this.canvas.getContext("2d", { willReadFrequently: true }) || undefined;
        }
        return this.canvas;
    }

    getContext(): CanvasRenderingContext2D | undefined {
        return this.ctx;
    }

    /** Increment animation cycle and update time-based animations */
    tick(): void {
        this.cycle++;

        // Time-based caret blink
        const now = performance.now();
        if (this.lastTickTime === 0) {
            this.lastTickTime = now;
        }
        const elapsed = now - this.lastTickTime;
        this.lastTickTime = now;
        this.caretBlinkMs =
            (this.caretBlinkMs + elapsed) % (LoginRenderer.CARET_BLINK_INTERVAL_MS * 2);
    }

    /** Returns true if caret should be visible (time-based) */
    private isCaretVisible(): boolean {
        return this.caretBlinkMs < LoginRenderer.CARET_BLINK_INTERVAL_MS;
    }

    /** Get fire animation for direct texture access */
    getFireAnimation(): LoginScreenAnimation | undefined {
        return this.loginScreenRunesAnimation;
    }

    /** Get fire positions for WebGL rendering (left and right fire X coordinates) */
    getFirePositions(): { leftX: number; rightX: number; y: number } {
        const logical = this.getLogicalFirePositions();
        const scale = this.renderScale;
        const leftX = logical.leftX * scale + this.renderOffsetX;
        const rightX = logical.rightX * scale + this.renderOffsetX;
        const y = logical.y * scale + this.renderOffsetY;
        return { leftX, rightX, y };
    }

    private getLogicalFirePositions(): { leftX: number; rightX: number; y: number } {
        // OSRS parity:
        // left  = Login.xPadding - 22
        // right = Login.xPadding + 22 + 765 - 128
        const leftX = this.xPadding - 22;
        const rightX = this.xPadding + 22 + 765 - 128;
        return { leftX, rightX, y: 0 };
    }

    private getVisibleLayoutRightEdge(): number {
        const scale = Math.max(this.renderScale, 0.0001);
        return (this.renderSurfaceWidth - this.renderOffsetX) / scale;
    }

    private getTitleMuteDrawPosition(): { x: number; y: number } {
        // The custom login background is wider than the native 765px title scene and is rendered
        // full-width, so anchor the music toggle to the visible background edge.
        const defaultRightEdge = this.xPadding + this.CONTENT_WIDTH;
        const backgroundRightEdge = this.titleBackgroundImage
            ? this.xPadding - LoginRenderer.TITLE_BG_CROP_X + this.titleBackgroundImage.width
            : defaultRightEdge;
        const titleRightEdge = Math.min(backgroundRightEdge, this.getVisibleLayoutRightEdge());
        return {
            x: Math.floor(titleRightEdge) - 40,
            y: 463,
        };
    }

    private isTitleMuteHit(x: number, y: number): boolean {
        const mutePos = this.getTitleMuteDrawPosition();
        // Keep the original 50x50 hit area, anchored to the actual draw position.
        return x >= mutePos.x - 10 && y >= 453 && x < mutePos.x + 40 && y < this.SCENE_HEIGHT;
    }

    private drawTitleMuteButton(ctx: RenderContext, titleMusicDisabled: boolean): void {
        if (!this.titleMuteSprites) {
            return;
        }

        const muteSprite = titleMusicDisabled ? this.titleMuteSprites[1] : this.titleMuteSprites[0];
        if (!muteSprite) {
            return;
        }

        const mutePos = this.getTitleMuteDrawPosition();
        this.drawSprite(ctx, muteSprite, mutePos.x, mutePos.y);
    }

    /**
     * Compute which world is hovered based on current mouse position.
     * Call this BEFORE drawing to determine if redraw is needed.
     * Returns the hovered world index or -1 if none.
     */
    computeHoveredWorldIndex(state: LoginState, _width: number, _height: number): number {
        if (!state.worldSelectOpen) return -1;

        const sortedWorlds = this.getSortedWorlds();
        const worldCount = sortedWorlds.length;

        // Use cached grid layout (same as drawWorldSelect)
        const layout = this.getGridLayout(worldCount);

        // Use consolidated hover detection
        const hoverResult = this.findHoveredWorld(sortedWorlds, layout, state.worldSelectPage);
        return hoverResult.index;
    }

    computeHoveredServerIndex(state: LoginState): number {
        if (!state.serverListOpen || !this.probed) return -1;

        const servers = this.serverList;
        const rowH = 24;
        const headerH = 30;
        const panelW = 350;
        const panelH = headerH + servers.length * rowH;
        const panelX = Math.floor((this.canvasWidth - panelW) / 2);
        const panelY = Math.floor((this.canvasHeight - panelH) / 2);

        const rowStartY = panelY + headerH;
        const mx = this.mouseX;
        const my = this.mouseY;

        if (mx >= panelX + 4 && mx <= panelX + panelW - 4) {
            for (let i = 0; i < servers.length; i++) {
                const ry = rowStartY + i * rowH;
                if (my >= ry && my < ry + rowH) {
                    return i;
                }
            }
        }
        return -1;
    }

    /** Update mouse position for hover detection */
    setMousePosition(x: number, y: number): void {
        const mapped = this.toLayoutPoint(x, y);
        this.mouseX = mapped.x;
        this.mouseY = mapped.y;
    }

    // ========== Layout ==========

    updateLayout(
        canvasWidth: number,
        canvasHeight: number,
        surfaceWidth: number = canvasWidth,
        surfaceHeight: number = canvasHeight,
    ): void {
        // Validate dimensions - use defaults if invalid
        if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) {
            canvasWidth = this.SCENE_WIDTH;
        }
        if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) {
            canvasHeight = this.SCENE_HEIGHT;
        }
        if (!Number.isFinite(surfaceWidth) || surfaceWidth <= 0) {
            surfaceWidth = canvasWidth;
        }
        if (!Number.isFinite(surfaceHeight) || surfaceHeight <= 0) {
            surfaceHeight = canvasHeight;
        }

        const viewportWidth = Math.max(1, Math.round(canvasWidth));
        const viewportHeight = Math.max(1, Math.round(canvasHeight));
        const drawSurfaceWidth = Math.max(1, Math.round(surfaceWidth));
        const drawSurfaceHeight = Math.max(1, Math.round(surfaceHeight));

        this.computeLayoutConfig(viewportWidth, viewportHeight);

        const layoutScale = this.layoutConfig.scale > 0 ? this.layoutConfig.scale : 1.0;
        const surfaceScaleX = drawSurfaceWidth / viewportWidth;
        const surfaceScaleY = drawSurfaceHeight / viewportHeight;
        const surfaceScale = Math.min(surfaceScaleX, surfaceScaleY);
        const safeSurfaceScale =
            Number.isFinite(surfaceScale) && surfaceScale > 0 ? surfaceScale : 1.0;

        // Keep the browser canvas at the real device DPR, but scale a fixed native login scene
        // inside it instead of stretching the scene to the viewport dimensions.
        let renderScale = layoutScale * safeSurfaceScale;
        const layoutWidth = this.SCENE_WIDTH;
        const layoutHeight = this.SCENE_HEIGHT;

        let renderOffsetX = Math.floor(
            (drawSurfaceWidth - Math.round(layoutWidth * renderScale)) / 2,
        );
        let renderOffsetY = 0;
        const mobileFocusTransform = this.getMobileKeyboardFocusTransform(
            viewportWidth,
            viewportHeight,
            drawSurfaceWidth,
            drawSurfaceHeight,
            safeSurfaceScale,
            layoutScale,
        );
        if (mobileFocusTransform) {
            renderScale = mobileFocusTransform.renderScale;
            renderOffsetX = mobileFocusTransform.renderOffsetX;
            renderOffsetY = mobileFocusTransform.renderOffsetY;
        }

        this.renderScale = renderScale;
        this.renderSurfaceWidth = drawSurfaceWidth;
        this.renderOffsetX = renderOffsetX;
        this.renderOffsetY = renderOffsetY;

        this.canvasWidth = layoutWidth;
        this.canvasHeight = layoutHeight;

        this.containerWidth = LoginRenderer.MAX_BG_WIDTH;
        this.containerHeight = LoginRenderer.MAX_BG_HEIGHT;

        // The native login scene is the background container, so its origin is fixed.
        this.containerX = 0;

        this.xPadding = 0;

        this.loginBoxX = this.xPadding + this.LOGIN_BOX_X;
        this.loginBoxCenter = this.xPadding + this.LOGIN_BOX_CENTER;
    }

    // ========== Asset Loading ==========

    loadLogoImage(): Promise<boolean> {
        if (this.logoImage && this.logoImageLoaded) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            this.logoImage = new Image();
            this.logoImage.onload = () => {
                this.logoImageLoaded = true;
                console.log("[LoginRenderer] Logo image loaded from PNG");
                resolve(true);
            };
            this.logoImage.onerror = () => {
                console.warn("[LoginRenderer] Failed to load logo image from PNG");
                this.logoImage = undefined;
                this.logoImageLoaded = false;
                resolve(false);
            };
            this.logoImage.src = "/images/logo.png";
        });
    }

    async loadTitleBackground(): Promise<boolean> {
        try {
            const response = await fetch("/images/loading-bg.jpg");
            if (response.ok) {
                const blob = await response.blob();
                const imageBitmap = await createImageBitmap(blob);
                this.titleBackgroundImage = imageBitmap;
                console.log("[LoginRenderer] Title background loaded");
                return true;
            }
        } catch (e) {
            console.warn("[LoginRenderer] Title background load failed:", e);
        }
        return false;
    }

    loadTitleSprites(cache: CacheSystem): boolean {
        try {
            // Note: Logo PNG image is loaded separately via loadLogoImage()
            // This avoids async race conditions during phased loading

            const spriteIndex = cache.getIndex(IndexType.DAT2.sprites);

            this.logoSprite = this.loadSprite(spriteIndex, "logo");
            this.titleboxSprite = this.loadSprite(spriteIndex, "titlebox");
            this.titlebuttonSprite = this.loadSprite(spriteIndex, "titlebutton");
            this.titlebuttonLargeSprite = this.loadSprite(spriteIndex, "titlebutton_large");
            this.playNowTextSprite = this.loadSprite(spriteIndex, "play_now_text");
            this.runesSprites = this.loadSprites(spriteIndex, "runes");
            this.titleMuteSprites = this.loadSprites(spriteIndex, "title_mute");

            const radioSprites = this.loadSprites(spriteIndex, "options_radio_buttons");
            if (radioSprites) {
                this.optionsRadioSprite0 = radioSprites[0];
                this.optionsRadioSprite2 = radioSprites[2];
                this.optionsRadioSprite4 = radioSprites[4];
                this.optionsRadioSprite6 = radioSprites[6];
            }

            this.worldSelectLeftSprite = this.loadSprite(spriteIndex, "leftarrow");
            this.worldSelectRightSprite = this.loadSprite(spriteIndex, "rightarrow");
            this.worldSelectButtonSprite = this.loadSprite(spriteIndex, "sl_button");
            this.worldSelectBackSprites = this.loadSprites(spriteIndex, "sl_back");
            this.worldSelectFlagSprites = this.loadSprites(spriteIndex, "sl_flags");
            this.worldSelectStarSprites = this.loadSprites(spriteIndex, "sl_stars");
            this.worldSelectArrowSprites = this.loadSprites(spriteIndex, "sl_arrows");

            if (this.runesSprites) {
                this.loginScreenRunesAnimation = new LoginScreenAnimation(this.runesSprites);
            }

            return true;
        } catch (e) {
            console.warn("[LoginRenderer] Failed to load title sprites:", e);
            return false;
        }
    }

    loadFonts(cache: CacheSystem): boolean {
        try {
            this.fontBold12 = BitmapFont.tryLoad(cache, 496);
            this.fontPlain11 = BitmapFont.tryLoad(cache, 494);
            this.fontPlain12 = BitmapFont.tryLoad(cache, 495);
            return !!(this.fontBold12 && this.fontPlain11 && this.fontPlain12);
        } catch (e) {
            console.warn("[LoginRenderer] Failed to load fonts:", e);
            return false;
        }
    }

    private loadSprite(spriteIndex: CacheIndex, name: string): IndexedSprite | undefined {
        try {
            const archiveId = spriteIndex.getArchiveId(name);
            if (archiveId === -1) return undefined;
            return SpriteLoader.loadIntoIndexedSprite(spriteIndex, archiveId);
        } catch {
            return undefined;
        }
    }

    private loadSprites(spriteIndex: CacheIndex, name: string): IndexedSprite[] | undefined {
        try {
            const archiveId = spriteIndex.getArchiveId(name);
            if (archiveId === -1) return undefined;
            return SpriteLoader.loadIntoIndexedSprites(spriteIndex, archiveId);
        } catch {
            return undefined;
        }
    }

    // ========== Input Handling ==========

    /**
     * Handle keyboard input on login screen.
     * Modifies state directly for efficiency.
     * Returns true if input was consumed.
     */
    handleKeyInput(state: LoginState, key: string, char: string): boolean {
        if (state.loginIndex === LoginIndex.LOGIN_FORM) {
            if (key === "Tab") {
                state.currentLoginField = state.currentLoginField === 0 ? 1 : 0;
                return true;
            }
            if (key === "Enter") {
                if (state.currentLoginField === 0 && state.username.length > 0) {
                    state.currentLoginField = 1;
                    return true;
                }
                // Enter on password field handled by action system
                return false;
            }
            if (key === "Backspace") {
                if (state.currentLoginField === 0) {
                    if (state.username.length > 0) {
                        state.username = state.username.slice(0, -1);
                    }
                } else {
                    if (state.password.length > 0) {
                        state.password = state.password.slice(0, -1);
                    }
                }
                return true;
            }
            if (char.length === 1 && char.charCodeAt(0) >= 32) {
                if (state.currentLoginField === 0) {
                    if (state.username.length < 320) {
                        state.username += char;
                    }
                } else {
                    if (state.password.length < 20) {
                        state.password += char;
                    }
                }
                return true;
            }
        } else if (state.loginIndex === LoginIndex.AUTHENTICATOR) {
            if (key === "Backspace") {
                if (state.otp.length > 0) {
                    state.otp = state.otp.slice(0, -1);
                }
                return true;
            }
            if (char >= "0" && char <= "9") {
                if (state.otp.length < 6) {
                    state.otp += char;
                }
                return true;
            }
        } else if (state.loginIndex === LoginIndex.FORGOT_PASSWORD) {
            if (key === "Backspace") {
                if (state.username.length > 0) {
                    state.username = state.username.slice(0, -1);
                }
                return true;
            }
            if (char.length === 1 && char.charCodeAt(0) >= 32) {
                if (state.username.length < 320) {
                    state.username += char;
                }
                return true;
            }
        } else if (
            state.loginIndex === LoginIndex.DATE_OF_BIRTH &&
            state.dobEntryAvailable &&
            !state.onMobile
        ) {
            if (key === "Tab") {
                state.dobFieldIndex = (state.dobFieldIndex + 1) % 8;
                return true;
            }
            if (key === "Backspace") {
                const current = state.dobFields[state.dobFieldIndex];
                if (current && current.length > 0) {
                    state.dobFields[state.dobFieldIndex] = current.slice(0, -1);
                } else if (state.dobFieldIndex > 0) {
                    state.dobFieldIndex--;
                }
                return true;
            }
            if (char >= "0" && char <= "9") {
                const current = state.dobFields[state.dobFieldIndex] ?? "";
                if (current.length < 1) {
                    state.dobFields[state.dobFieldIndex] = current + char;
                    if (state.dobFieldIndex < 7) {
                        state.dobFieldIndex++;
                    }
                }
                return true;
            }
        }
        return false;
    }

    /**
     * Handle mouse click on login screen.
     * Returns action to perform, or undefined if click wasn't on a button.
     * Uses pre-allocated action objects to avoid allocations.
     */
    handleMouseClick(
        state: LoginState,
        x: number,
        y: number,
        button: number,
        gameState: GameState = GameState.LOGIN_SCREEN,
    ): LoginAction | undefined {
        if (button !== 1) return undefined;

        const mapped = this.toLayoutPoint(x, y);
        x = mapped.x;
        y = mapped.y;

        // Music mute button (global - works on all login screens)
        if (
            (gameState >= GameState.LOGIN_SCREEN || gameState === GameState.LOADING) &&
            this.titleMuteSprites?.[0]
        ) {
            if (this.isTitleMuteHit(x, y)) {
                return LoginActions.TOGGLE_MUSIC;
            }
        }

        // Server list overlay handling (when open) - check before button
        if (state.serverListOpen) {
            return this.handleServerListClick(state, x, y);
        }

        // Server list button (bottom left, replaces world select button)
        if (
            gameState >= GameState.LOGIN_SCREEN &&
            this.worldSelectButtonSprite
        ) {
            const buttonX = this.containerX + 5;
            const buttonY = 463;
            const buttonW = this.worldSelectButtonSprite.subWidth || 100;
            const buttonH = this.worldSelectButtonSprite.subHeight || 35;
            if (x >= buttonX && x <= buttonX + buttonW && y >= buttonY && y <= buttonY + buttonH) {
                return LoginActions.OPEN_SERVER_LIST;
            }
        }

        // World select overlay handling (when open)
        if (state.worldSelectOpen) {
            return this.handleWorldSelectClick(state, x, y);
        }

        // Route to appropriate screen handler
        switch (state.loginIndex) {
            case LoginIndex.WELCOME:
                return this.handleWelcomeClick(x, y);
            case LoginIndex.WARNING:
                return this.handleWarningClick(x, y);
            case LoginIndex.LOGIN_FORM:
                return this.handleLoginFormClick(state, x, y, gameState);
            case LoginIndex.INVALID_CREDENTIALS:
                return this.handleInvalidCredentialsClick(x, y);
            case LoginIndex.AUTHENTICATOR:
                return this.handleAuthenticatorClick(state, x, y);
            case LoginIndex.FORGOT_PASSWORD:
                return this.handleForgotPasswordClick(x, y);
            case LoginIndex.DATE_OF_BIRTH:
                return this.handleDobClick(state, x, y);
            case LoginIndex.MESSAGE:
            case LoginIndex.MUST_ACCEPT_TERMS:
                return this.handleMessageClick(state, x, y);
            case LoginIndex.TRY_AGAIN:
                return this.handleTryAgainClick(x, y);
            case LoginIndex.BANNED:
                return this.handleBannedClick(x, y);
            case LoginIndex.OK_MESSAGE:
                return this.handleOkMessageClick(x, y);
            default:
                return undefined;
        }
    }

    private handleWelcomeClick(x: number, y: number): LoginAction | undefined {
        const buttonY = 291;
        const newUserX = this.loginBoxCenter - 80;
        if (this.isButtonHit(x, y, newUserX, buttonY)) {
            return LoginActions.NEW_USER;
        }
        const existingUserX = this.loginBoxCenter + 80;
        if (this.isButtonHit(x, y, existingUserX, buttonY)) {
            return LoginActions.EXISTING_USER;
        }
        return undefined;
    }

    private handleWarningClick(x: number, y: number): LoginAction | undefined {
        const buttonY = 321;
        if (this.isButtonHit(x, y, this.loginBoxCenter - 80, buttonY)) {
            return LoginActions.CONTINUE;
        }
        if (this.isButtonHit(x, y, this.loginBoxCenter + 80, buttonY)) {
            return LoginActions.CANCEL;
        }
        return undefined;
    }

    private handleLoginFormClick(
        state: LoginState,
        x: number,
        y: number,
        gameState: GameState,
    ): LoginAction | undefined {
        const isConnecting = gameState === GameState.CONNECTING;

        // Field clicks (updated Y offset: 201 + 15 + 15 + 10 = 241)
        const fieldBaseY = 201 + 15 + 15 + 10;
        if (y >= fieldBaseY - 12 && y < fieldBaseY + 3) {
            return LoginActions.FIELD_USERNAME;
        }
        if (y >= fieldBaseY + 3 && y < fieldBaseY + 18) {
            return LoginActions.FIELD_PASSWORD;
        }

        // Don't process button/checkbox clicks when connecting
        if (isConnecting) {
            return undefined;
        }

        // Checkbox: Remember username
        if (this.optionsRadioSprite0 && this.fontBold12) {
            const rememberY = 275; // Updated to match new layout
            const checkboxX = this.loginBoxX + 180 - 108;
            const checkboxW = this.optionsRadioSprite0.subWidth;
            const checkboxH = this.optionsRadioSprite0.subHeight || 15;
            if (
                x >= checkboxX &&
                x <= checkboxX + checkboxW &&
                y >= rememberY - checkboxH &&
                y <= rememberY
            ) {
                return LoginActions.TOGGLE_REMEMBER;
            }

            // Checkbox: Hide username
            const hideTextWidth = this.measureText(this.fontBold12, "Hide username: ");
            const hideCheckboxX =
                checkboxX +
                this.measureText(this.fontBold12, "Remember username: ") +
                checkboxW +
                10 +
                hideTextWidth;
            if (
                x >= hideCheckboxX &&
                x <= hideCheckboxX + checkboxW &&
                y >= rememberY - checkboxH &&
                y <= rememberY
            ) {
                return LoginActions.TOGGLE_HIDE_USERNAME;
            }
        }

        // Buttons
        const buttonY = 301;
        if (this.isButtonHit(x, y, this.loginBoxCenter - 80, buttonY)) {
            return LoginActions.LOGIN;
        }
        if (this.isButtonHit(x, y, this.loginBoxCenter + 80, buttonY)) {
            return LoginActions.CANCEL;
        }

        return undefined;
    }

    private handleInvalidCredentialsClick(x: number, y: number): LoginAction | undefined {
        const centerX = this.loginBoxX + 180;
        if (this.isButtonHit(x, y, centerX, 276)) {
            return LoginActions.TRY_AGAIN;
        }
        if (this.isButtonHit(x, y, centerX, 326)) {
            return LoginActions.FORGOT_PASSWORD;
        }
        return undefined;
    }

    private handleAuthenticatorClick(
        state: LoginState,
        x: number,
        y: number,
    ): LoginAction | undefined {
        // Trust checkbox
        if (this.fontBold12 && this.optionsRadioSprite0) {
            const trustTextWidth = this.measureText(this.fontBold12, "for 30 days: ");
            const checkboxX = this.loginBoxX + 180 - 9 + trustTextWidth + 15;
            const checkboxY = 288 - this.fontBold12.lineHeight;
            const checkboxW = this.optionsRadioSprite0.subWidth;
            const checkboxH = this.optionsRadioSprite0.subHeight || 15;
            if (
                x >= checkboxX &&
                x <= checkboxX + checkboxW &&
                y >= checkboxY &&
                y <= checkboxY + checkboxH
            ) {
                return LoginActions.TOGGLE_TRUST;
            }
        }

        // Buttons
        if (this.isButtonHit(x, y, this.loginBoxX + 180 - 80, 321)) {
            return LoginActions.CONTINUE;
        }
        if (this.isButtonHit(x, y, this.loginBoxX + 180 + 80, 321)) {
            return LoginActions.CANCEL;
        }
        return undefined;
    }

    private handleForgotPasswordClick(x: number, y: number): LoginAction | undefined {
        if (this.isButtonHit(x, y, this.loginBoxX + 180 - 80, 321)) {
            return LoginActions.RECOVER;
        }
        if (this.isButtonHit(x, y, this.loginBoxX + 180 + 80, 321)) {
            return LoginActions.BACK;
        }
        return undefined;
    }

    private handleDobClick(state: LoginState, x: number, y: number): LoginAction | undefined {
        if (state.dobEntryAvailable && !state.onMobile) {
            // Desktop DOB field clicks
            const fieldY = 201 + 15 + 15 + 10;
            let fieldX = this.loginBoxCenter - 150;
            for (let i = 0; i < 8; i++) {
                if (x >= fieldX && x <= fieldX + 30 && y >= fieldY && y <= fieldY + 40) {
                    state.dobFieldIndex = i;
                    return undefined;
                }
                fieldX += i === 1 || i === 3 ? 50 : 35;
            }
            if (this.isButtonHit(x, y, this.loginBoxCenter - 80, 321)) {
                return LoginActions.CONTINUE;
            }
            if (this.isButtonHit(x, y, this.loginBoxCenter + 80, 321)) {
                return LoginActions.CANCEL;
            }
        } else {
            if (this.isButtonHit(x, y, this.loginBoxX + 180 - 80, 321)) {
                return LoginActions.CONTINUE;
            }
            if (this.isButtonHit(x, y, this.loginBoxX + 180 + 80, 321)) {
                return LoginActions.BACK;
            }
        }
        return undefined;
    }

    private handleMessageClick(state: LoginState, x: number, y: number): LoginAction | undefined {
        const buttonY = state.loginIndex === LoginIndex.MESSAGE ? 321 : 311;
        if (this.isButtonHit(x, y, this.loginBoxX + 180, buttonY)) {
            return LoginActions.BACK;
        }
        return undefined;
    }

    private handleTryAgainClick(x: number, y: number): LoginAction | undefined {
        if (this.isButtonHit(x, y, this.loginBoxX + 180, 311)) {
            return LoginActions.TRY_AGAIN;
        }
        return undefined;
    }

    private handleBannedClick(x: number, y: number): LoginAction | undefined {
        if (this.isButtonHit(x, y, this.loginBoxX + 180, 276)) {
            return LoginActions.CONTINUE;
        }
        if (this.isButtonHit(x, y, this.loginBoxX + 180, 326)) {
            return LoginActions.BACK;
        }
        return undefined;
    }

    private handleOkMessageClick(x: number, y: number): LoginAction | undefined {
        if (this.isButtonHit(x, y, this.loginBoxX + 180, 301)) {
            return LoginActions.BACK;
        }
        return undefined;
    }

    private handleServerListClick(
        state: LoginState,
        x: number,
        y: number,
    ): LoginAction | undefined {
        const panelW = 350;
        const contentH = this.probed ? this.serverList.length * 24 : 30;
        const panelH = 30 + contentH;
        const panelX = Math.floor((this.canvasWidth - panelW) / 2);
        const panelY = Math.floor((this.canvasHeight - panelH) / 2);

        // Refresh button (below panel, left)
        const btnY = panelY + panelH + 30;
        if (this.isButtonHit(x, y, panelX + panelW / 2 - 80, btnY)) {
            return LoginActions.REFRESH_SERVER_LIST;
        }

        // Close button (below panel, right)
        if (this.isButtonHit(x, y, panelX + panelW / 2 + 80, btnY)) {
            return LoginActions.CLOSE_SERVER_LIST;
        }

        // Server row clicks (only when probed)
        if (this.probed) {
            const rowStartY = panelY + 30;
            const rowH = 24;
            for (let i = 0; i < this.serverList.length; i++) {
                const ry = rowStartY + i * rowH;
                if (x >= panelX + 4 && x <= panelX + panelW - 4 && y >= ry && y < ry + rowH) {
                    return { type: "select_server", index: i };
                }
            }
        }

        // Click inside panel consumes the event (don't pass through)
        if (x >= panelX && x <= panelX + panelW && y >= panelY && y <= panelY + panelH) {
            return undefined;
        }

        // Click outside panel closes it
        return LoginActions.CLOSE_SERVER_LIST;
    }

    private handleWorldSelectClick(
        state: LoginState,
        x: number,
        y: number,
    ): LoginAction | undefined {
        // Mobile list mode: use tap-to-select
        if (this.layoutConfig.worldSelectListMode) {
            const index = this.getMobileWorldIndexAtPosition(
                state,
                x,
                y,
                this.canvasWidth,
                this.canvasHeight,
            );

            // Close button tapped
            if (index === -2) {
                return LoginActions.CLOSE_WORLD_SELECT;
            }

            // World row tapped
            if (index >= 0 && index < this.currentSortedWorlds.length) {
                const world = this.currentSortedWorlds[index];
                if (world.population !== -1) {
                    // Can't select offline worlds
                    return { type: "select_world", worldId: world.id };
                }
            }

            return undefined;
        }

        // Desktop grid mode: Cancel button (top right header area)
        if (x >= this.xPadding + 708 && x <= this.xPadding + 758 && y >= 4 && y <= 20) {
            return LoginActions.CLOSE_WORLD_SELECT;
        }

        // Sort column clicks (in header area y < 23)
        if (y < 23 && this.worldSelectArrowSprites) {
            // World column sort
            if (x >= this.xPadding + 280 && x <= this.xPadding + 320) {
                return { type: "world_sort", column: 0 };
            }
            // Players column sort
            if (x >= this.xPadding + 390 && x <= this.xPadding + 430) {
                return { type: "world_sort", column: 1 };
            }
            // Location column sort
            if (x >= this.xPadding + 500 && x <= this.xPadding + 540) {
                return { type: "world_sort", column: 2 };
            }
            // Type column sort
            if (x >= this.xPadding + 610 && x <= this.xPadding + 650) {
                return { type: "world_sort", column: 3 };
            }
        }

        // Page navigation - left arrow
        if (this.worldSelectLeftSprite && state.worldSelectPage > 0) {
            const arrowY = Math.floor(
                this.canvasHeight / 2 - this.worldSelectLeftSprite.subHeight / 2,
            );
            if (
                x >= 8 &&
                x <= 8 + this.worldSelectLeftSprite.subWidth &&
                y >= arrowY &&
                y <= arrowY + this.worldSelectLeftSprite.subHeight
            ) {
                return LoginActions.WORLD_PAGE_LEFT;
            }
        }

        // Page navigation - right arrow
        if (this.worldSelectRightSprite && state.worldSelectPage < state.worldSelectPagesCount) {
            const arrowX = this.canvasWidth - this.worldSelectRightSprite.subWidth - 8;
            const arrowY = Math.floor(
                this.canvasHeight / 2 - this.worldSelectRightSprite.subHeight / 2,
            );
            if (
                x >= arrowX &&
                x <= arrowX + this.worldSelectRightSprite.subWidth &&
                y >= arrowY &&
                y <= arrowY + this.worldSelectRightSprite.subHeight
            ) {
                return LoginActions.WORLD_PAGE_RIGHT;
            }
        }

        // World row click - look up by world ID (survives re-sorting)
        if (state.hoveredWorldId >= 0) {
            const world = this.currentSortedWorlds.find((w) => w.id === state.hoveredWorldId);
            if (world && world.population !== -1) {
                // Can't select offline worlds
                return { type: "select_world", worldId: world.id };
            }
        }

        return undefined;
    }

    /**
     * Check if click is within button bounds (center X, center Y).
     * Expands hit area on touch devices to meet 44px minimum touch target.
     */
    private isButtonHit(
        clickX: number,
        clickY: number,
        buttonCenterX: number,
        buttonCenterY: number,
    ): boolean {
        // OSRS parity: login button hit bounds are center +/-75 (x) and +/-20 (y).
        // Reference: MusicTrackNoteMaskEntry.java loginIndex==0 checks.
        const visualHalfW = 75;
        const visualHalfH = 20;

        // On touch devices, enforce minimum 44px touch targets in SCREEN space.
        // Convert that minimum back to layout space so it stays 44px after render scaling.
        const scale =
            Number.isFinite(this.layoutConfig.scale) && this.layoutConfig.scale > 0
                ? this.layoutConfig.scale
                : 1.0;
        const minScreenHalf = this.layoutConfig.isTouch
            ? Math.ceil(this.layoutConfig.minTouchTarget / 2)
            : 0;
        const minLayoutHalf = minScreenHalf > 0 ? Math.ceil(minScreenHalf / scale) : 0;
        const hitHalfW = Math.max(visualHalfW, minLayoutHalf);
        const hitHalfH = Math.max(visualHalfH, minLayoutHalf);

        return (
            clickX >= buttonCenterX - hitHalfW &&
            clickX <= buttonCenterX + hitHalfW &&
            clickY >= buttonCenterY - hitHalfH &&
            clickY <= buttonCenterY + hitHalfH
        );
    }

    // ========== Rendering - Main Entry Points ==========

    /**
     * Draw download progress screen (cache download phase).
     * Used before cache is available, so uses minimal assets.
     */
    drawDownload(
        state: LoginState,
        width: number,
        height: number,
        layoutWidth: number = width,
        layoutHeight: number = height,
    ): void {
        const canvas = this.getCanvas(width, height);
        const ctx = this.getContext();
        if (!ctx) return;

        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        this.updateLayout(layoutWidth, layoutHeight, width, height);

        this.withRenderTransform(ctx, () => {
            // Draw title background if available (may not be during early download)
            this.drawTitleBackgroundToCtx(ctx);
            this.drawLogoToCtx(ctx);

            // Draw download progress bar
            this.drawDownloadBarToCtx(ctx, state);
        });
    }

    /**
     * Draw initial loading screen (asset loading phase).
     */
    drawInitial(
        state: LoginState,
        width: number,
        height: number,
        layoutWidth: number = width,
        layoutHeight: number = height,
    ): void {
        const canvas = this.getCanvas(width, height);
        const ctx = this.getContext();
        if (!ctx) return;

        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        this.updateLayout(layoutWidth, layoutHeight, width, height);

        this.withRenderTransform(ctx, () => {
            // Draw title background
            this.drawTitleBackgroundToCtx(ctx);
            this.drawLogoToCtx(ctx);

            // Draw loading bar
            this.drawLoadingBarToCtx(ctx, state);

            // OSRS title loading state shows the music toggle before the welcome buttons appear.
            this.drawTitleMuteButton(ctx, state.titleMusicDisabled);
        });
    }

    /**
     * Draw login screen.
     * @param skipFire If true, don't draw fire animation (for separate fire texture rendering)
     * @param hoverOnly If true, only update hover overlay (fast path for mouse movement)
     */
    drawTitle(
        state: LoginState,
        gameState: GameState,
        width: number,
        height: number,
        skipFire: boolean = false,
        hoverOnly: boolean = false,
        layoutWidth: number = width,
        layoutHeight: number = height,
    ): void {
        const canvas = this.getCanvas(width, height);
        const ctx = this.getContext();
        if (!ctx) return;

        this.updateLayout(layoutWidth, layoutHeight, width, height);

        // Compute state hash for caching (excludes hover-related state)
        const stateHash = this.computeTitleStateHash(
            state,
            gameState,
            width,
            height,
            layoutWidth,
            layoutHeight,
            skipFire,
        );
        const cacheValid =
            this.titleCache !== null &&
            this.titleCacheStateHash === stateHash &&
            this.titleCacheWidth === width &&
            this.titleCacheHeight === height;

        // Fast path: if only hover changed and cache is valid, skip full redraw
        if (hoverOnly && cacheValid && state.worldSelectOpen) {
            // Blit cached title to main canvas
            ctx.drawImage(this.titleCache!, 0, 0);
            // Draw only hover overlay
            this.withRenderTransform(ctx, () => {
                this.drawWorldSelectHoverOnly(ctx, state, this.canvasWidth, this.canvasHeight);
            });
            return;
        }

        // Full redraw path - either cache miss or not hover-only
        if (!cacheValid) {
            // Create or resize title cache
            if (
                !this.titleCache ||
                this.titleCacheWidth !== width ||
                this.titleCacheHeight !== height
            ) {
                this.titleCache = new OffscreenCanvas(width, height);
                this.titleCacheCtx = this.titleCache.getContext("2d");
            }

            if (this.titleCacheCtx) {
                const cacheCtx = this.titleCacheCtx;

                cacheCtx.fillStyle = "#000000";
                cacheCtx.fillRect(0, 0, width, height);
                this.withRenderTransform(cacheCtx, () => {
                    // Draw title background
                    this.drawTitleBackgroundToCtx(cacheCtx);

                    if (!state.serverListOpen) {
                        // Loading state (gameState 0) - shows progress bar
                        if (gameState === GameState.LOADING) {
                            this.drawLoadingBarToCtx(cacheCtx, state);
                        }

                        // Login screen (gameState 10, 20, or 50) - shows loginIndex-based views
                        if (
                            gameState === GameState.LOGIN_SCREEN ||
                            gameState === GameState.CONNECTING ||
                            gameState === GameState.SPECIAL_LOGIN
                        ) {
                            this.drawLoginScreenToCtx(cacheCtx, state, gameState);
                        }
                    }

                    // Rune animations (only on login screen - gameState >= 10)
                    // Skip if using separate fire texture
                    if (
                        !skipFire &&
                        gameState >= GameState.LOGIN_SCREEN &&
                        this.loginScreenRunesAnimation
                    ) {
                        cacheCtx.save();
                        cacheCtx.beginPath();
                        cacheCtx.rect(
                            this.containerX,
                            0,
                            this.containerWidth,
                            this.containerHeight,
                        );
                        cacheCtx.clip();

                        // Fire positions fixed relative to content center.
                        const firePos = this.getLogicalFirePositions();
                        this.loginScreenRunesAnimation.draw(cacheCtx, firePos.leftX, this.cycle);
                        this.loginScreenRunesAnimation.draw(cacheCtx, firePos.rightX, this.cycle);

                        cacheCtx.restore();
                    }

                    if (!state.serverListOpen) {
                        // Logo
                        this.drawLogoToCtx(cacheCtx);

                        // Mute button (only when gameState >= 10)
                        if (gameState >= GameState.LOGIN_SCREEN) {
                            this.drawTitleMuteButton(cacheCtx, state.titleMusicDisabled);
                        }
                    }

                    // Server list button (bottom left)
                    if (
                        gameState >= GameState.LOGIN_SCREEN &&
                        this.worldSelectButtonSprite &&
                        this.fontPlain11
                    ) {
                        const buttonX = this.containerX + 5;
                        const buttonY = 463;
                        this.drawSprite(cacheCtx, this.worldSelectButtonSprite, buttonX, buttonY);
                        this.drawCenteredText(
                            cacheCtx,
                            this.fontPlain11,
                            state.serverName,
                            buttonX + (this.worldSelectButtonSprite.subWidth >> 1),
                            buttonY + 22,
                            0xffffff,
                        );
                    }

                    // Server list overlay
                    if (state.serverListOpen) {
                        this.drawServerListOverlay(cacheCtx, state);
                    }

                    // World select grid (without hover) - uses its own cache
                    if (state.worldSelectOpen) {
                        this.drawWorldSelectGridOnly(
                            cacheCtx,
                            state,
                            this.canvasWidth,
                            this.canvasHeight,
                        );
                    }
                });

                // Update cache metadata
                this.titleCacheStateHash = stateHash;
                this.titleCacheWidth = width;
                this.titleCacheHeight = height;
            }
        }

        // Blit cached title to main canvas
        if (this.titleCache) {
            ctx.drawImage(this.titleCache, 0, 0);
        }

        // Draw hover overlay on main canvas (not cached)
        if (state.worldSelectOpen) {
            this.withRenderTransform(ctx, () => {
                this.drawWorldSelectHoverOnly(ctx, state, this.canvasWidth, this.canvasHeight);
            });
        }
    }

    /** Compute state hash for title cache (excludes hover state) */
    private computeTitleStateHash(
        state: LoginState,
        gameState: GameState,
        width: number,
        height: number,
        layoutWidth: number,
        layoutHeight: number,
        skipFire: boolean,
    ): string {
        return `${gameState}|${state.loginIndex}|${state.username.length}|${
            state.password.length
        }|${state.otp.length}|${state.currentLoginField}|${state.onMobile}|${
            state.virtualKeyboardVisible
        }|${state.serverListOpen}|${state.hoveredServerIndex}|${state.serverName}|${this.probing}|${this.probed}|${this.serverList.map(s => s.playerCount).join(",")}|${state.worldSelectOpen}|${state.worldSelectPage}|${state.loadingPercent}|${
            state.rememberUsername
        }|${state.isUsernameHidden}|${state.trustComputer}|${state.titleMusicDisabled}|${
            state.worldId
        }|${width}|${height}|${layoutWidth}|${layoutHeight}|${skipFire}|${this.worldSortOption}|${
            this.worldSortDirection
        }|${this.isCaretVisible()}|${this.getViewportTransformStateHash()}|${this.getTitleAssetStateHash()}`;
    }

    // ========== Rendering - Components ==========

    private drawTitleBackgroundToCtx(ctx: RenderContext): void {
        if (this.titleBackgroundImage) {
            ctx.drawImage(
                this.titleBackgroundImage,
                this.xPadding - LoginRenderer.TITLE_BG_CROP_X,
                0,
                LoginRenderer.TITLE_BG_WIDTH,
                this.containerHeight,
            );
        }
    }

    private drawLoadingBarToCtx(ctx: RenderContext, state: LoginState): void {
        const centerX = this.loginBoxCenter;
        const barY = 245;
        const barWidth = 304;
        const barHeight = 34;
        const barX = centerX - barWidth / 2;

        // OSRS loading bar structure (from class207.java drawTitle):
        // - Outer red border at (0,0) size 304x34
        // - Inner black border at (1,1) size 302x32
        // - Red progress fill at (2,2) width=percent*3, height=30
        // - Black remainder fill
        // Color: 9179409 = #8c1111 (RGB 140, 17, 17)

        // Outer red border
        ctx.strokeStyle = "#8c1111";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

        // Inner black border
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(barX + 1.5, barY + 1.5, barWidth - 3, barHeight - 3);

        // Black background (remainder)
        ctx.fillStyle = "#000000";
        ctx.fillRect(barX + 2, barY + 2, barWidth - 4, barHeight - 4);

        // Red progress fill (percent * 3 pixels, max 300)
        const fillWidth = Math.floor(state.loadingPercent * 3);
        ctx.fillStyle = "#8c1111";
        ctx.fillRect(barX + 2, barY + 2, fillWidth, barHeight - 4);

        // Draw text using fontBold12 (OSRS parity - class207.java uses fontBold12)
        // Falls back to Helvetica if bitmap font not loaded yet
        const loadingText = state.loadingText || `${state.loadingPercent}%`;
        const titleText = "RuneScape is loading - please wait...";

        if (this.fontBold12) {
            // Use bitmap font (OSRS parity - class207.java uses fontBold12)
            // BitmapFont.draw uses baseline Y like OSRS AbstractFont.draw
            // OSRS: title at Y=245-var3=225, loading at Y=276-var3=256, bar at Y=253-var3=233
            // Relative: title at barY-8, loading at barY+23
            this.drawCenteredText(ctx, this.fontBold12, titleText, centerX, barY - 8, 0xffffff);
            this.drawCenteredText(ctx, this.fontBold12, loadingText, centerX, barY + 23, 0xffffff);
        } else {
            // Fallback to system font before bitmap fonts are loaded
            ctx.font = "bold 13px Helvetica, Arial, sans-serif";
            ctx.fillStyle = "white";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(titleText, centerX, barY - 8);
            ctx.textBaseline = "middle";
            ctx.fillText(loadingText, centerX, barY + barHeight / 2);
        }
    }

    /**
     * Draw download progress bar (cache download phase).
     * Similar to loading bar but shows download bytes instead of percentage.
     */
    private drawDownloadBarToCtx(ctx: RenderContext, state: LoginState): void {
        const centerX = this.loginBoxCenter;
        const barY = 245;
        const barWidth = 304;
        const barHeight = 34;
        const barX = centerX - barWidth / 2;

        // OSRS uses Helvetica Bold 13pt for the loading bar (from GameEngine.java drawInitial)
        ctx.font = "bold 13px Helvetica, Arial, sans-serif";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";

        // Draw title text
        ctx.textBaseline = "bottom";
        ctx.fillText("RuneScape is loading - please wait...", centerX, barY - 8);

        // Calculate progress percentage
        const progress =
            state.downloadTotal > 0
                ? Math.min(100, Math.floor((state.downloadCurrent / state.downloadTotal) * 100))
                : 0;

        // OSRS loading bar structure
        // Outer red border
        ctx.strokeStyle = "#8c1111";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

        // Inner black border
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(barX + 1.5, barY + 1.5, barWidth - 3, barHeight - 3);

        // Black background (remainder)
        ctx.fillStyle = "#000000";
        ctx.fillRect(barX + 2, barY + 2, barWidth - 4, barHeight - 4);

        // Red progress fill (percent * 3 pixels, max 300)
        const fillWidth = Math.floor(progress * 3);
        ctx.fillStyle = "#8c1111";
        ctx.fillRect(barX + 2, barY + 2, fillWidth, barHeight - 4);

        // Draw progress text centered in bar
        // OSRS format: "Loading sprites - X%" when label available
        let progressText: string;
        if (state.downloadLabel) {
            // Capitalize first letter and add percentage
            const label =
                state.downloadLabel.charAt(0).toUpperCase() + state.downloadLabel.slice(1);
            progressText = `Loading ${label} - ${progress}%`;
        } else {
            progressText = `${progress}%`;
        }
        ctx.fillStyle = "white";
        ctx.textBaseline = "middle";
        ctx.fillText(progressText, centerX, barY + barHeight / 2);
    }

    private drawLoginScreenToCtx(
        ctx: RenderContext,
        state: LoginState,
        gameState: GameState,
    ): void {
        // Draw titlebox background
        if (this.titleboxSprite) {
            this.drawSprite(ctx, this.titleboxSprite, this.loginBoxX, 170);
        }

        // Route to appropriate screen
        switch (state.loginIndex) {
            case LoginIndex.WELCOME:
                this.drawWelcomeScreen(ctx, state);
                break;
            case LoginIndex.WARNING:
                this.drawWarningScreen(ctx, state);
                break;
            case LoginIndex.LOGIN_FORM:
                this.drawLoginForm(ctx, state, gameState);
                break;
            case LoginIndex.INVALID_CREDENTIALS:
                this.drawInvalidCredentials(ctx, state);
                break;
            case LoginIndex.AUTHENTICATOR:
                this.drawAuthenticator(ctx, state);
                break;
            case LoginIndex.FORGOT_PASSWORD:
                this.drawForgotPassword(ctx, state);
                break;
            case LoginIndex.MESSAGE:
                this.drawMessage(ctx, state);
                break;
            case LoginIndex.DATE_OF_BIRTH:
                this.drawDateOfBirth(ctx, state);
                break;
            case LoginIndex.NOT_ELIGIBLE:
                this.drawNotEligible(ctx, state);
                break;
            case LoginIndex.TRY_AGAIN:
                this.drawTryAgain(ctx, state);
                break;
            case LoginIndex.WELCOME_DISPLAY_NAME:
                this.drawWelcomeDisplayName(ctx, state);
                break;
            case LoginIndex.TERMS:
                this.drawTerms(ctx, state);
                break;
            case LoginIndex.MUST_ACCEPT_TERMS:
                this.drawMustAcceptTerms(ctx, state);
                break;
            case LoginIndex.BANNED:
                this.drawBanned(ctx, state);
                break;
            case LoginIndex.OK_MESSAGE:
                this.drawOkMessage(ctx, state);
                break;
            case LoginIndex.DOB_NOT_SET:
                this.drawDobNotSet(ctx, state);
                break;
            case LoginIndex.DOWNLOAD_LAUNCHER:
                this.drawDownloadLauncher(ctx, state);
                break;
            case LoginIndex.WORLD_HOP_WARNING:
                this.drawWorldHopWarning(ctx, state);
                break;
        }
    }

    // ========== Rendering - Individual Screens ==========

    private drawWelcomeScreen(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Welcome to xRSPS",
            this.loginBoxX + 180,
            251,
            0xffff00,
        );
        this.drawButton(ctx, this.loginBoxCenter - 80, 291, "New User");
        this.drawButton(ctx, this.loginBoxCenter + 80, 291, "Existing User");
    }

    private drawWarningScreen(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response0,
            this.loginBoxX + 180,
            201,
            0xffff00,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            236,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response2,
            this.loginBoxX + 180,
            251,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response3,
            this.loginBoxX + 180,
            266,
            0xffffff,
        );
        this.drawButton(ctx, this.loginBoxCenter - 80, 321, "Continue");
        this.drawButton(ctx, this.loginBoxCenter + 80, 321, "Cancel");
    }

    private drawLoginForm(ctx: RenderContext, state: LoginState, gameState: GameState): void {
        if (!this.fontBold12) return;

        const isConnecting = gameState === GameState.CONNECTING;

        // Response messages at top
        let textY = 201;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response0,
            this.loginBoxX + 180,
            textY,
            0xffff00,
        );
        textY += 15;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            textY,
            0xffff00,
        );
        textY += 15;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response2,
            this.loginBoxX + 180,
            textY,
            0xffff00,
        );
        textY += 10; // OSRS uses 10px gap before input fields

        // Username field
        const cursor = this.isCaretVisible() ? "|" : "";
        const displayUsername = state.isUsernameHidden
            ? "*".repeat(state.username.length)
            : state.username;
        const usernameCursor = state.currentLoginField === 0 ? cursor : "";
        this.drawText(
            ctx,
            this.fontBold12,
            "Username: " + this.truncateFromStart(displayUsername, 195) + usernameCursor,
            this.loginBoxX + 180 - 108,
            textY,
            0xffffff,
        );
        textY += 15;

        // Password field
        const passwordCursor = state.currentLoginField === 1 ? cursor : "";
        this.drawText(
            ctx,
            this.fontBold12,
            "Password: " + state.getMaskedPassword() + passwordCursor,
            this.loginBoxX + 180 - 108,
            textY,
            0xffffff,
        );
        textY += 30;

        // Checkboxes (only show when not connecting)
        if (!isConnecting) {
            const checkboxX = this.loginBoxX + 180 - 108;
            const rememberSprite = this.getCheckboxSprite(
                state.rememberUsername,
                state.rememberUsernameHover,
            );
            if (rememberSprite) {
                this.drawText(
                    ctx,
                    this.fontBold12,
                    "Remember username: ",
                    checkboxX,
                    textY,
                    0xffff00,
                );
                const textWidth = this.measureText(this.fontBold12, "Remember username: ");
                this.drawSprite(
                    ctx,
                    rememberSprite,
                    checkboxX + textWidth,
                    textY - this.fontBold12.lineHeight,
                );
            }
        }

        // Buttons (hide when connecting)
        if (!isConnecting) {
            this.drawButton(ctx, this.loginBoxCenter - 80, 301, "Login");
            this.drawButton(ctx, this.loginBoxCenter + 80, 301, "Cancel");
        }

        // Help link (only show when not connecting)
        if (!isConnecting && this.fontPlain11) {
            const helpText =
                state.loginFieldType === 1
                    ? "Can't login? Click here."
                    : "Having trouble logging in?";
            this.drawCenteredText(
                ctx,
                this.fontPlain11,
                helpText,
                this.loginBoxX + 180,
                357,
                0xffffff,
            );
        }
    }

    private drawInvalidCredentials(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response0,
            this.loginBoxX + 180,
            201,
            0xffff00,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            221,
            0xffff00,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response2,
            this.loginBoxX + 180,
            241,
            0xffff00,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 276, "Try again");
        this.drawButton(ctx, this.loginBoxX + 180, 326, "Forgotten password?");
    }

    private drawAuthenticator(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;

        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Authenticator",
            this.loginBoxX + 180,
            201,
            0xffff00,
        );

        let textY = 236;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            textY,
            0xffffff,
        );
        textY += 15;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response2,
            this.loginBoxX + 180,
            textY,
            0xffffff,
        );
        textY += 15;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response3,
            this.loginBoxX + 180,
            textY,
            0xffffff,
        );
        textY += 15;

        // PIN field
        const cursor = this.isCaretVisible() ? "|" : "";
        this.drawText(
            ctx,
            this.fontBold12,
            "PIN: " + state.getMaskedOtp() + cursor,
            this.loginBoxX + 180 - 108,
            textY,
            0xffffff,
        );

        // Trust checkbox
        textY -= 8;
        this.drawText(
            ctx,
            this.fontBold12,
            "Trust this computer",
            this.loginBoxX + 180 - 9,
            textY,
            0xffff00,
        );
        textY += 15;
        this.drawText(
            ctx,
            this.fontBold12,
            "for 30 days: ",
            this.loginBoxX + 180 - 9,
            textY,
            0xffff00,
        );

        const trustTextWidth = this.measureText(this.fontBold12, "for 30 days: ");
        const checkboxX = this.loginBoxX + 180 - 9 + trustTextWidth + 15;
        const checkboxY = textY - this.fontBold12.lineHeight;
        const trustSprite = state.trustComputer
            ? this.optionsRadioSprite2
            : this.optionsRadioSprite0;
        if (trustSprite) {
            this.drawSprite(ctx, trustSprite, checkboxX, checkboxY);
        }

        this.drawButton(ctx, this.loginBoxX + 180 - 80, 321, "Continue");
        this.drawButton(ctx, this.loginBoxX + 180 + 80, 321, "Cancel");

        if (this.fontPlain11) {
            this.drawCenteredText(
                ctx,
                this.fontPlain11,
                "Can't login? Click here.",
                this.loginBoxX + 180,
                357,
                0xffffff,
            );
        }
    }

    private drawForgotPassword(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12 || !this.fontPlain12) return;

        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Forgotten your password?",
            this.loginBoxX + 180,
            201,
            0xffff00,
        );

        let textY = 221;
        this.drawCenteredText(
            ctx,
            this.fontPlain12,
            state.response1,
            this.loginBoxX + 180,
            textY,
            0xffffff,
        );
        textY += 15;
        this.drawCenteredText(
            ctx,
            this.fontPlain12,
            state.response2,
            this.loginBoxX + 180,
            textY,
            0xffffff,
        );
        textY += 15;
        this.drawCenteredText(
            ctx,
            this.fontPlain12,
            state.response3,
            this.loginBoxX + 180,
            textY,
            0xffffff,
        );
        textY += 15;

        const cursor = this.isCaretVisible() ? "|" : "";
        const displayUsername = this.truncateFromStart(state.username, 215);
        this.drawText(
            ctx,
            this.fontBold12,
            "Email: " + displayUsername + cursor,
            this.loginBoxX + 180 - 108,
            textY,
            0xffffff,
        );

        this.drawButton(ctx, this.loginBoxX + 180 - 80, 321, "Recover");
        this.drawButton(ctx, this.loginBoxX + 180 + 80, 321, "Back");

        if (this.fontPlain11) {
            this.drawCenteredText(
                ctx,
                this.fontPlain11,
                "Still having trouble logging in?",
                this.loginBoxCenter,
                356,
                0x0fffffff,
            );
        }
    }

    private drawMessage(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            216,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response2,
            this.loginBoxX + 180,
            231,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response3,
            this.loginBoxX + 180,
            246,
            0xffffff,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 321, "Back");
    }

    private drawDateOfBirth(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;

        if (state.dobEntryAvailable && !state.onMobile) {
            // Desktop DOB entry
            let textY = 201;
            this.drawCenteredText(
                ctx,
                this.fontBold12,
                state.response1,
                this.loginBoxCenter,
                textY,
                0xffff00,
            );
            textY += 15;
            this.drawCenteredText(
                ctx,
                this.fontBold12,
                state.response2,
                this.loginBoxCenter,
                textY,
                0xffff00,
            );
            textY += 15;
            this.drawCenteredText(
                ctx,
                this.fontBold12,
                state.response3,
                this.loginBoxCenter,
                textY,
                0xffff00,
            );

            // DOB fields would be drawn here
            this.drawButton(ctx, this.loginBoxCenter - 80, 321, "Submit");
            this.drawButton(ctx, this.loginBoxCenter + 80, 321, "Cancel");
        } else {
            // Mobile alternative
            this.drawCenteredText(
                ctx,
                this.fontBold12,
                "Your date of birth isn't set.",
                this.loginBoxX + 180,
                216,
                0xffff00,
            );
            this.drawButton(ctx, this.loginBoxX + 180 - 80, 321, "Set Date of Birth");
            this.drawButton(ctx, this.loginBoxX + 180 + 80, 321, "Back");
        }
    }

    private drawNotEligible(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Sorry, but your account is not eligible to play.",
            this.loginBoxX + 180,
            216,
            0xffff00,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 301, "Ok");
    }

    private drawTryAgain(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            216,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response2,
            this.loginBoxX + 180,
            231,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response3,
            this.loginBoxX + 180,
            246,
            0xffffff,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 311, "Try Again");
    }

    private drawWelcomeDisplayName(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Welcome to xRSPS",
            this.loginBoxX + 180,
            209,
            0xffff00,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.displayName,
            this.loginBoxX + 180,
            229,
            0xffffff,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 311, "Play");
    }

    private drawTerms(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Terms and Conditions",
            this.loginBoxX + 180,
            201,
            0xffff00,
        );
        this.drawButton(ctx, this.loginBoxCenter - 80, 311, "Accept");
        this.drawButton(ctx, this.loginBoxCenter + 80, 311, "Decline");
    }

    private drawMustAcceptTerms(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "You must accept the terms to continue.",
            this.loginBoxX + 180,
            216,
            0xffff00,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 311, "Back");
    }

    private drawBanned(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Your account has been disabled.",
            this.loginBoxX + 180,
            201,
            0xffff00,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 276, "Appeal");
        this.drawButton(ctx, this.loginBoxX + 180, 326, "Back");
    }

    private drawOkMessage(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            221,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response2,
            this.loginBoxX + 180,
            236,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response3,
            this.loginBoxX + 180,
            251,
            0xffffff,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 301, "Ok");
    }

    private drawDobNotSet(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Your date of birth isn't set.",
            this.loginBoxX + 180,
            216,
            0xffff00,
        );
        this.drawButton(ctx, this.loginBoxX + 180 - 80, 321, "Set Date of Birth");
        this.drawButton(ctx, this.loginBoxX + 180 + 80, 321, "Back");
    }

    private drawDownloadLauncher(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            201,
            0xffff00,
        );
        this.drawButton(ctx, this.loginBoxX + 180, 276, "Download Launcher");
        this.drawButton(ctx, this.loginBoxX + 180, 326, "Back");
    }

    private drawWorldHopWarning(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12) return;
        // World hop warning is similar to the WARNING screen
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response0,
            this.loginBoxX + 180,
            201,
            0xffff00,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response1,
            this.loginBoxX + 180,
            236,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response2,
            this.loginBoxX + 180,
            251,
            0xffffff,
        );
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            state.response3,
            this.loginBoxX + 180,
            266,
            0xffffff,
        );
        this.drawButton(ctx, this.loginBoxCenter - 80, 321, "Continue");
        this.drawButton(ctx, this.loginBoxCenter + 80, 321, "Cancel");
    }

    private drawServerListOverlay(ctx: RenderContext, state: LoginState): void {
        if (!this.fontBold12 || !this.fontPlain12) return;

        const servers = this.serverList;
        const rowH = 24;
        const headerH = 30;
        const panelW = 350;
        const showRows = this.probed;
        const contentH = showRows ? servers.length * rowH : 30;
        const panelH = headerH + contentH;
        const panelX = Math.floor((this.canvasWidth - panelW) / 2);
        const panelY = Math.floor((this.canvasHeight - panelH) / 2);

        // Dim background - cover full canvas by inverting the render transform
        const dimScale = this.renderScale || 1;
        const dimOffX = this.renderOffsetX || 0;
        const dimOffY = this.renderOffsetY || 0;
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(
            -dimOffX / dimScale,
            -dimOffY / dimScale,
            this.renderSurfaceWidth / dimScale + 1,
            this.renderSurfaceWidth / dimScale + 1,
        );

        // Panel background
        ctx.fillStyle = "#2b2013";
        ctx.fillRect(panelX, panelY, panelW, panelH);

        // Panel border
        ctx.strokeStyle = "#6b5a3e";
        ctx.lineWidth = 2;
        ctx.strokeRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2);

        // Header background
        this.drawGradientRect(ctx, panelX + 2, panelY + 2, panelW - 4, headerH - 2, 0x5c4a30, 0x3d2e1a);

        // Column headers
        const col1X = panelX + 10;
        const col2X = panelX + 140;
        const col3X = panelX + 265;
        const headerTextY = panelY + 20;
        this.drawText(ctx, this.fontBold12, "Server Name", col1X, headerTextY, 0xffcc00);
        this.drawText(ctx, this.fontBold12, "Address", col2X, headerTextY, 0xffcc00);
        this.drawText(ctx, this.fontBold12, "Players", col3X, headerTextY, 0xffcc00);

        // Separator line
        ctx.fillStyle = "#6b5a3e";
        ctx.fillRect(panelX + 4, panelY + headerH, panelW - 8, 1);

        if (!showRows) {
            // First probe not yet complete — show loading
            this.drawCenteredText(
                ctx, this.fontPlain12, "Loading servers...",
                panelX + panelW / 2, panelY + headerH + 18, 0xaaaaaa,
            );
        } else {
            // Refreshing indicator
            if (this.probing) {
                this.drawText(ctx, this.fontPlain12, "Refreshing...", col3X - 30, panelY + panelH - 4, 0xffcc00);
            }

            // Server rows
            const rowStartY = panelY + headerH;
            for (let i = 0; i < servers.length; i++) {
                const server = servers[i];
                const ry = rowStartY + i * rowH;

                // Hover highlight
                if (state.hoveredServerIndex === i) {
                    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
                    ctx.fillRect(panelX + 4, ry, panelW - 8, rowH);
                }

                // Alternating row tint
                if (i % 2 === 0) {
                    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
                    ctx.fillRect(panelX + 4, ry, panelW - 8, rowH);
                }

                const textY = ry + 16;
                const nameMaxW = col2X - col1X - 4;
                const addrMaxW = col3X - col2X - 4;
                this.drawText(ctx, this.fontPlain12, this.ellipsis(server.name, nameMaxW), col1X, textY, 0xffffff);
                this.drawText(ctx, this.fontPlain12, this.ellipsis(server.address, addrMaxW), col2X, textY, 0xaaaaaa);
                if (server.playerCount === null) {
                    this.drawText(ctx, this.fontPlain12, "Offline", col3X, textY, 0xff0000);
                } else if (server.playerCount === -1) {
                    this.drawText(ctx, this.fontPlain12, "Online", col3X, textY, 0x00ff00);
                } else {
                    const playersStr = `${server.playerCount}/${server.maxPlayers}`;
                    this.drawText(ctx, this.fontPlain12, playersStr, col3X, textY, 0x00ff00);
                }
            }
        }

        ctx.restore();

        // Discord notice
        this.drawCenteredText(
            ctx, this.fontPlain12!, "Get your server added through the Discord",
            panelX + panelW / 2, panelY - 8, 0xaaaaaa,
        );

        // Buttons below the panel
        this.drawButton(ctx, panelX + panelW / 2 - 80, panelY + panelH + 30, "Refresh");
        this.drawButton(ctx, panelX + panelW / 2 + 80, panelY + panelH + 30, "Close");
    }

    private drawWorldSelect(
        ctx: RenderContext,
        state: LoginState,
        width: number,
        height: number,
    ): void {
        if (!this.fontBold12 || !this.fontPlain11) return;

        // Mobile: use full-screen list view for touch-friendly world selection
        if (this.layoutConfig.worldSelectListMode) {
            this.drawMobileWorldSelectList(ctx, state, width, height);
            return;
        }

        // Sort worlds based on current sort option
        const sortedWorlds = this.getSortedWorlds();
        const worldCount = sortedWorlds.length;

        // Use cached grid layout (consolidates duplicate calculation)
        const layout = this.getGridLayout(worldCount);
        const {
            cols,
            rows,
            xGap,
            yGap,
            xOffset,
            yOffset,
            rowWidth,
            rowHeight,
            columnsPerPage,
            totalColumns,
        } = layout;

        // Calculate page count
        state.worldSelectPagesCount = Math.max(0, totalColumns - columnsPerPage);

        // Store sorted worlds for click handling
        this.currentSortedWorlds = sortedWorlds;

        // Performance: Check if we can use cached world grid
        const needsRedraw =
            this.worldSelectCache === null ||
            this.worldSelectCachePage !== state.worldSelectPage ||
            this.worldSelectCacheSortOption !== this.worldSortOption ||
            this.worldSelectCacheSortDirection !== this.worldSortDirection ||
            this.worldSelectCacheWidth !== width ||
            this.worldSelectCacheHeight !== height;

        if (needsRedraw) {
            // Create or resize cache canvas
            if (
                !this.worldSelectCache ||
                this.worldSelectCacheWidth !== width ||
                this.worldSelectCacheHeight !== height
            ) {
                this.worldSelectCache = new OffscreenCanvas(width, height);
                this.worldSelectCacheCtx = this.worldSelectCache.getContext("2d");
            }

            if (this.worldSelectCacheCtx) {
                const cacheCtx = this.worldSelectCacheCtx;

                // Clear cache
                cacheCtx.clearRect(0, 0, width, height);

                // Fill background - match parent container size
                cacheCtx.fillStyle = "#000000";
                cacheCtx.fillRect(
                    this.containerX,
                    23,
                    this.containerWidth,
                    this.containerHeight - 23,
                );

                // Draw gradient header bars - match container width
                const headerLeftWidth = 125;
                const headerRightWidth = this.containerWidth - headerLeftWidth;
                this.drawGradientRect(
                    cacheCtx,
                    this.containerX,
                    0,
                    headerLeftWidth,
                    23,
                    0xbda9a9,
                    0x8b7a88,
                );
                this.drawGradientRect(
                    cacheCtx,
                    this.containerX + headerLeftWidth,
                    0,
                    headerRightWidth,
                    23,
                    0x4f4f4f,
                    0x292929,
                );

                // Draw "Select a world" title - centered in left header
                this.drawCenteredText(
                    cacheCtx,
                    this.fontBold12,
                    "Select a world",
                    this.containerX + headerLeftWidth / 2,
                    15,
                    0x000000,
                );

                // Draw members/free legend with stars
                if (this.worldSelectStarSprites && this.worldSelectStarSprites.length >= 2) {
                    this.drawSprite(
                        cacheCtx,
                        this.worldSelectStarSprites[1],
                        this.xPadding + 140,
                        1,
                    );
                    this.drawText(
                        cacheCtx,
                        this.fontPlain11,
                        "Members only world",
                        this.xPadding + 152,
                        10,
                        0xffffff,
                    );
                    this.drawSprite(
                        cacheCtx,
                        this.worldSelectStarSprites[0],
                        this.xPadding + 140,
                        12,
                    );
                    this.drawText(
                        cacheCtx,
                        this.fontPlain11,
                        "Free world",
                        this.xPadding + 152,
                        21,
                        0xffffff,
                    );
                }

                // Draw sort arrows and column headers
                if (this.worldSelectArrowSprites && this.worldSelectArrowSprites.length >= 4) {
                    this.drawSortColumn(cacheCtx, this.xPadding + 280, "World", 0);
                    this.drawSortColumn(cacheCtx, this.xPadding + 390, "Players", 1);
                    this.drawSortColumn(cacheCtx, this.xPadding + 500, "Location", 2);
                    this.drawSortColumn(cacheCtx, this.xPadding + 610, "Type", 3);
                }

                // Draw cancel button
                cacheCtx.fillStyle = "#000000";
                cacheCtx.fillRect(this.xPadding + 708, 4, 50, 16);
                this.drawCenteredText(
                    cacheCtx,
                    this.fontPlain11,
                    "Cancel",
                    this.xPadding + 708 + 25,
                    16,
                    0xffffff,
                );

                // Draw pagination arrows
                if (this.worldSelectLeftSprite && state.worldSelectPage > 0) {
                    const arrowY = Math.floor(
                        height / 2 - this.worldSelectLeftSprite.subHeight / 2,
                    );
                    this.drawSprite(cacheCtx, this.worldSelectLeftSprite, 8, arrowY);
                }
                if (
                    this.worldSelectRightSprite &&
                    state.worldSelectPage < state.worldSelectPagesCount
                ) {
                    const arrowX = width - this.worldSelectRightSprite.subWidth - 8;
                    const arrowY = Math.floor(
                        height / 2 - this.worldSelectRightSprite.subHeight / 2,
                    );
                    this.drawSprite(cacheCtx, this.worldSelectRightSprite, arrowX, arrowY);
                }

                // Draw world grid to cache
                let drawY = yOffset + 23;
                let drawX = xOffset + this.xPadding;
                let rowIndex = 0;
                let columnIndex = state.worldSelectPage;

                const startWorldIndex = state.worldSelectPage * rows;
                for (
                    let i = startWorldIndex;
                    i < worldCount && columnIndex - state.worldSelectPage < cols;
                    i++
                ) {
                    const world = sortedWorlds[i];

                    // Determine population text
                    let popText = world.population.toString();
                    if (world.population === -1) {
                        popText = "OFF";
                    } else if (world.population > 1980) {
                        popText = "FULL";
                    }

                    // Determine background type
                    const bgType = this.getWorldBackgroundType(world);

                    // Draw background
                    if (
                        this.worldSelectBackSprites &&
                        bgType < this.worldSelectBackSprites.length
                    ) {
                        this.drawSprite(
                            cacheCtx,
                            this.worldSelectBackSprites[bgType],
                            drawX,
                            drawY,
                        );
                    }

                    // Draw flag
                    if (this.worldSelectFlagSprites) {
                        const isMember = (world.properties & WorldFlags.MEMBERS) !== 0;
                        const flagIndex = (isMember ? 8 : 0) + world.location;
                        if (flagIndex < this.worldSelectFlagSprites.length) {
                            this.drawSprite(
                                cacheCtx,
                                this.worldSelectFlagSprites[flagIndex],
                                drawX + 29,
                                drawY,
                            );
                        }
                    }

                    // Draw world ID
                    const worldIdColor =
                        (world.properties & WorldFlags.HIGH_RISK) !== 0 ? 0xff0000 : 0x000000;
                    this.drawCenteredText(
                        cacheCtx,
                        this.fontBold12,
                        world.id.toString(),
                        drawX + 15,
                        drawY + rowHeight / 2 + 5,
                        worldIdColor,
                    );

                    // Draw population
                    this.drawCenteredText(
                        cacheCtx,
                        this.fontPlain11,
                        popText,
                        drawX + 60,
                        drawY + rowHeight / 2 + 5,
                        0x0ffffff,
                    );

                    // Move to next position
                    drawY += rowHeight + yGap;
                    rowIndex++;
                    if (rowIndex >= rows) {
                        drawY = yOffset + 23;
                        drawX += xGap + rowWidth;
                        rowIndex = 0;
                        columnIndex++;
                    }
                }

                // Update cache metadata
                this.worldSelectCachePage = state.worldSelectPage;
                this.worldSelectCacheSortOption = this.worldSortOption;
                this.worldSelectCacheSortDirection = this.worldSortDirection;
                this.worldSelectCacheWidth = width;
                this.worldSelectCacheHeight = height;
            }
        }

        // Draw cached world grid to main canvas
        if (this.worldSelectCache) {
            ctx.drawImage(this.worldSelectCache, 0, 0);
        }

        // Use consolidated hover detection (eliminates duplicate loop)
        const hoverResult = this.findHoveredWorld(sortedWorlds, layout, state.worldSelectPage);
        state.hoveredWorldId = hoverResult.world ? hoverResult.world.id : -1;

        // Draw hover highlight overlay (just a simple rectangle)
        if (hoverResult.world) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(hoverResult.x, hoverResult.y, rowWidth, rowHeight);
            ctx.restore();
        }

        // Draw hover tooltip
        if (hoverResult.world) {
            const activity = hoverResult.world.activity || "-";
            const tooltipWidth = this.measureText(this.fontPlain11, activity) + 6;
            const tooltipHeight = this.fontPlain11.lineHeight + 8;
            let tooltipY = this.mouseY + 25;
            if (tooltipHeight + tooltipY > 480) {
                tooltipY = this.mouseY - 25 - tooltipHeight;
            }
            const tooltipX = this.mouseX - tooltipWidth / 2;

            // Draw tooltip background
            ctx.fillStyle = "#ffff70";
            ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 1;
            ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

            // Draw tooltip text
            this.drawCenteredText(
                ctx,
                this.fontPlain11,
                activity,
                this.mouseX,
                tooltipY + this.fontPlain11.lineHeight + 4,
                0x000000,
            );
        }
    }

    /**
     * Draw mobile-friendly world select list view.
     * Full-screen modal with large 60px touch-friendly rows.
     * Supports touch scrolling with momentum.
     */
    private drawMobileWorldSelectList(
        ctx: RenderContext,
        state: LoginState,
        width: number,
        height: number,
    ): void {
        if (!this.fontBold12 || !this.fontPlain11) return;

        const sortedWorlds = this.getSortedWorlds();
        this.currentSortedWorlds = sortedWorlds;

        // Mobile list constants
        const ROW_HEIGHT = 60; // Touch-friendly row height (vs 19px grid)
        const HEADER_HEIGHT = 50;
        const CLOSE_BUTTON_SIZE = 44; // Touch target minimum
        const PADDING = 16;

        // Apply momentum scrolling
        if (Math.abs(state.mobileWorldSelectScrollVelocity) > 0.5) {
            state.mobileWorldSelectScrollOffset += state.mobileWorldSelectScrollVelocity;
            state.mobileWorldSelectScrollVelocity *= 0.92; // Friction
        } else {
            state.mobileWorldSelectScrollVelocity = 0;
        }

        // Clamp scroll bounds
        const maxScroll = Math.max(0, sortedWorlds.length * ROW_HEIGHT - (height - HEADER_HEIGHT));
        state.mobileWorldSelectScrollOffset = Math.max(
            0,
            Math.min(maxScroll, state.mobileWorldSelectScrollOffset),
        );

        // Draw full-screen background
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, width, height);

        // Draw header bar
        ctx.fillStyle = "#2d2d2d";
        ctx.fillRect(0, 0, width, HEADER_HEIGHT);

        // Draw header title
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Select World",
            width / 2,
            HEADER_HEIGHT / 2 + 5,
            0xffffff,
        );

        // Draw close button (X) in top right
        const closeX = width - CLOSE_BUTTON_SIZE - 4;
        const closeY = (HEADER_HEIGHT - CLOSE_BUTTON_SIZE) / 2;
        ctx.fillStyle = "#444444";
        ctx.fillRect(closeX, closeY, CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE);
        ctx.strokeStyle = "#666666";
        ctx.lineWidth = 1;
        ctx.strokeRect(closeX, closeY, CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE);
        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "X",
            closeX + CLOSE_BUTTON_SIZE / 2,
            closeY + CLOSE_BUTTON_SIZE / 2 + 5,
            0xffffff,
        );

        // Draw world list
        const listY = HEADER_HEIGHT;
        const listHeight = height - HEADER_HEIGHT;
        const scrollOffset = state.mobileWorldSelectScrollOffset;

        // Calculate visible range for efficient rendering
        const firstVisibleIndex = Math.floor(scrollOffset / ROW_HEIGHT);
        const lastVisibleIndex = Math.min(
            sortedWorlds.length - 1,
            Math.ceil((scrollOffset + listHeight) / ROW_HEIGHT),
        );

        // Clip to list area
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, listY, width, listHeight);
        ctx.clip();

        for (let i = firstVisibleIndex; i <= lastVisibleIndex; i++) {
            const world = sortedWorlds[i];
            const rowY = listY + i * ROW_HEIGHT - scrollOffset;

            // Row background (alternating colors)
            const isMember = (world.properties & WorldFlags.MEMBERS) !== 0;
            if (i % 2 === 0) {
                ctx.fillStyle = isMember ? "#1e2a1e" : "#1a1a1a";
            } else {
                ctx.fillStyle = isMember ? "#253025" : "#222222";
            }
            ctx.fillRect(0, rowY, width, ROW_HEIGHT);

            // Highlight hovered/selected world
            if (world.id === state.hoveredWorldId) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
                ctx.fillRect(0, rowY, width, ROW_HEIGHT);
            }

            // Draw flag icon
            if (this.worldSelectFlagSprites) {
                const flagIndex = (isMember ? 8 : 0) + world.location;
                if (flagIndex < this.worldSelectFlagSprites.length) {
                    const flagSprite = this.worldSelectFlagSprites[flagIndex];
                    this.drawSprite(ctx, flagSprite, PADDING, rowY + (ROW_HEIGHT - 16) / 2);
                }
            }

            // Draw world ID (larger for touch)
            const worldIdX = PADDING + 40;
            const worldIdColor =
                (world.properties & WorldFlags.HIGH_RISK) !== 0 ? 0xff6666 : 0xffffff;
            this.drawText(
                ctx,
                this.fontBold12,
                `World ${world.id}`,
                worldIdX,
                rowY + 22,
                worldIdColor,
            );

            // Draw activity text below world ID
            const activityText = world.activity || "-";
            this.drawText(ctx, this.fontPlain11, activityText, worldIdX, rowY + 40, 0xaaaaaa);

            // Draw population on right side
            let popText: string;
            let popColor: number;
            if (world.population === -1) {
                popText = "Offline";
                popColor = 0x888888;
            } else if (world.population > 1980) {
                popText = "Full";
                popColor = 0xff6666;
            } else if (world.population > 1500) {
                popText = `${world.population}`;
                popColor = 0xffaa00;
            } else {
                popText = `${world.population}`;
                popColor = 0x66ff66;
            }
            const popWidth = this.measureText(this.fontBold12, popText);
            this.drawText(
                ctx,
                this.fontBold12,
                popText,
                width - PADDING - popWidth,
                rowY + ROW_HEIGHT / 2 + 5,
                popColor,
            );

            // Draw population label
            this.drawText(
                ctx,
                this.fontPlain11,
                "players",
                width - PADDING - popWidth,
                rowY + ROW_HEIGHT / 2 + 18,
                0x666666,
            );

            // Draw separator line
            ctx.strokeStyle = "#333333";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(PADDING, rowY + ROW_HEIGHT - 0.5);
            ctx.lineTo(width - PADDING, rowY + ROW_HEIGHT - 0.5);
            ctx.stroke();
        }

        ctx.restore();

        // Draw scroll indicator if content overflows
        if (maxScroll > 0) {
            const scrollBarHeight = Math.max(
                30,
                (listHeight / (maxScroll + listHeight)) * listHeight,
            );
            const scrollBarY = listY + (scrollOffset / maxScroll) * (listHeight - scrollBarHeight);
            ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
            ctx.fillRect(width - 6, scrollBarY, 4, scrollBarHeight);
        }
    }

    /**
     * Get world index at screen position for mobile list view tap detection.
     * Returns the index in currentSortedWorlds or -1 if none.
     */
    getMobileWorldIndexAtPosition(
        state: LoginState,
        x: number,
        y: number,
        width: number,
        height: number,
    ): number {
        const ROW_HEIGHT = 60;
        const HEADER_HEIGHT = 50;
        const CLOSE_BUTTON_SIZE = 44;

        // Check close button first
        const closeX = width - CLOSE_BUTTON_SIZE - 4;
        const closeY = (HEADER_HEIGHT - CLOSE_BUTTON_SIZE) / 2;
        if (
            x >= closeX &&
            x <= closeX + CLOSE_BUTTON_SIZE &&
            y >= closeY &&
            y <= closeY + CLOSE_BUTTON_SIZE
        ) {
            return -2; // Special value for close button
        }

        // Check if in list area
        if (y < HEADER_HEIGHT) return -1;

        // Calculate which row was tapped
        const listY = y - HEADER_HEIGHT + state.mobileWorldSelectScrollOffset;
        const index = Math.floor(listY / ROW_HEIGHT);

        if (index >= 0 && index < this.currentSortedWorlds.length) {
            return index;
        }

        return -1;
    }

    /** Draw world select grid only (no hover overlay) - for title caching */
    private drawWorldSelectGridOnly(
        ctx: RenderContext,
        state: LoginState,
        width: number,
        height: number,
    ): void {
        if (!this.fontBold12 || !this.fontPlain11) return;

        const sortedWorlds = this.getSortedWorlds();
        const worldCount = sortedWorlds.length;

        // Use cached grid layout (consolidates duplicate calculation)
        const layout = this.getGridLayout(worldCount);
        const {
            cols,
            rows,
            xGap,
            yGap,
            xOffset,
            yOffset,
            rowWidth,
            rowHeight,
            columnsPerPage,
            totalColumns,
        } = layout;

        state.worldSelectPagesCount = Math.max(0, totalColumns - columnsPerPage);
        this.currentSortedWorlds = sortedWorlds;

        // Draw directly to provided context (for title cache)
        ctx.fillStyle = "#000000";
        ctx.fillRect(this.containerX, 23, this.containerWidth, this.containerHeight - 23);

        const headerLeftWidth = 125;
        const headerRightWidth = this.containerWidth - headerLeftWidth;
        this.drawGradientRect(ctx, this.containerX, 0, headerLeftWidth, 23, 0xbda9a9, 0x8b7a88);
        this.drawGradientRect(
            ctx,
            this.containerX + headerLeftWidth,
            0,
            headerRightWidth,
            23,
            0x4f4f4f,
            0x292929,
        );

        this.drawCenteredText(
            ctx,
            this.fontBold12,
            "Select a world",
            this.containerX + headerLeftWidth / 2,
            15,
            0x000000,
        );

        if (this.worldSelectStarSprites && this.worldSelectStarSprites.length >= 2) {
            this.drawSprite(ctx, this.worldSelectStarSprites[1], this.xPadding + 140, 1);
            this.drawText(
                ctx,
                this.fontPlain11,
                "Members only world",
                this.xPadding + 152,
                10,
                0xffffff,
            );
            this.drawSprite(ctx, this.worldSelectStarSprites[0], this.xPadding + 140, 12);
            this.drawText(ctx, this.fontPlain11, "Free world", this.xPadding + 152, 21, 0xffffff);
        }

        if (this.worldSelectArrowSprites && this.worldSelectArrowSprites.length >= 4) {
            this.drawSortColumn(ctx, this.xPadding + 280, "World", 0);
            this.drawSortColumn(ctx, this.xPadding + 390, "Players", 1);
            this.drawSortColumn(ctx, this.xPadding + 500, "Location", 2);
            this.drawSortColumn(ctx, this.xPadding + 610, "Type", 3);
        }

        ctx.fillStyle = "#000000";
        ctx.fillRect(this.xPadding + 708, 4, 50, 16);
        this.drawCenteredText(
            ctx,
            this.fontPlain11,
            "Cancel",
            this.xPadding + 708 + 25,
            16,
            0xffffff,
        );

        if (this.worldSelectLeftSprite && state.worldSelectPage > 0) {
            const arrowY = Math.floor(height / 2 - this.worldSelectLeftSprite.subHeight / 2);
            this.drawSprite(ctx, this.worldSelectLeftSprite, 8, arrowY);
        }
        if (this.worldSelectRightSprite && state.worldSelectPage < state.worldSelectPagesCount) {
            const arrowX = width - this.worldSelectRightSprite.subWidth - 8;
            const arrowY = Math.floor(height / 2 - this.worldSelectRightSprite.subHeight / 2);
            this.drawSprite(ctx, this.worldSelectRightSprite, arrowX, arrowY);
        }

        let drawY = yOffset + 23;
        let drawX = xOffset + this.xPadding;
        let rowIndex = 0;
        let columnIndex = state.worldSelectPage;

        const startWorldIndex = state.worldSelectPage * rows;
        for (
            let i = startWorldIndex;
            i < worldCount && columnIndex - state.worldSelectPage < cols;
            i++
        ) {
            const world = sortedWorlds[i];

            let popText = world.population.toString();
            if (world.population === -1) {
                popText = "OFF";
            } else if (world.population > 1980) {
                popText = "FULL";
            }

            const bgType = this.getWorldBackgroundType(world);

            if (this.worldSelectBackSprites && bgType < this.worldSelectBackSprites.length) {
                this.drawSprite(ctx, this.worldSelectBackSprites[bgType], drawX, drawY);
            }

            if (this.worldSelectFlagSprites) {
                const isMember = (world.properties & WorldFlags.MEMBERS) !== 0;
                const flagIndex = (isMember ? 8 : 0) + world.location;
                if (flagIndex < this.worldSelectFlagSprites.length) {
                    this.drawSprite(ctx, this.worldSelectFlagSprites[flagIndex], drawX + 29, drawY);
                }
            }

            const worldIdColor =
                (world.properties & WorldFlags.HIGH_RISK) !== 0 ? 0xff0000 : 0x000000;
            this.drawCenteredText(
                ctx,
                this.fontBold12,
                world.id.toString(),
                drawX + 15,
                drawY + rowHeight / 2 + 5,
                worldIdColor,
            );
            this.drawCenteredText(
                ctx,
                this.fontPlain11,
                popText,
                drawX + 60,
                drawY + rowHeight / 2 + 5,
                0x0ffffff,
            );

            drawY += rowHeight + yGap;
            rowIndex++;
            if (rowIndex >= rows) {
                drawY = yOffset + 23;
                drawX += xGap + rowWidth;
                rowIndex = 0;
                columnIndex++;
            }
        }
    }

    /** Draw only hover overlay + tooltip (fast path for hover-only updates) */
    private drawWorldSelectHoverOnly(
        ctx: RenderContext,
        state: LoginState,
        _width: number,
        _height: number,
    ): void {
        if (!this.fontPlain11) return;

        const sortedWorlds = this.getSortedWorlds();
        const worldCount = sortedWorlds.length;

        // Use cached grid layout (consolidates duplicate calculation)
        const layout = this.getGridLayout(worldCount);
        const { rowWidth, rowHeight } = layout;

        // Use consolidated hover detection (eliminates duplicate loop)
        const hoverResult = this.findHoveredWorld(sortedWorlds, layout, state.worldSelectPage);
        state.hoveredWorldId = hoverResult.world ? hoverResult.world.id : -1;

        // Draw hover highlight
        if (hoverResult.world) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(hoverResult.x, hoverResult.y, rowWidth, rowHeight);
            ctx.restore();
        }

        // Draw tooltip
        if (hoverResult.world) {
            const activity = hoverResult.world.activity || "-";
            const tooltipWidth = this.measureText(this.fontPlain11, activity) + 6;
            const tooltipHeight = this.fontPlain11.lineHeight + 8;
            let tooltipY = this.mouseY + 25;
            if (tooltipHeight + tooltipY > 480) {
                tooltipY = this.mouseY - 25 - tooltipHeight;
            }
            const tooltipX = this.mouseX - tooltipWidth / 2;

            ctx.fillStyle = "#ffff70";
            ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 1;
            ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

            this.drawCenteredText(
                ctx,
                this.fontPlain11,
                activity,
                this.mouseX,
                tooltipY + this.fontPlain11.lineHeight + 4,
                0x000000,
            );
        }
    }

    private drawSortColumn(ctx: RenderContext, x: number, label: string, sortIndex: number): void {
        if (!this.worldSelectArrowSprites || !this.fontBold12) return;

        // Draw up arrow (ascending)
        const upArrowIdx =
            this.worldSortOption === sortIndex && this.worldSortDirection === 0 ? 2 : 0;
        this.drawSprite(ctx, this.worldSelectArrowSprites[upArrowIdx], x, 4);

        // Draw down arrow (descending)
        const downArrowIdx =
            this.worldSortOption === sortIndex && this.worldSortDirection === 1 ? 3 : 1;
        this.drawSprite(ctx, this.worldSelectArrowSprites[downArrowIdx], x + 15, 4);

        // Draw label
        this.drawText(ctx, this.fontBold12, label, x + 32, 17, 0xffffff);
    }

    private getWorldBackgroundType(world: World): number {
        const isMember = (world.properties & WorldFlags.MEMBERS) !== 0;

        if ((world.properties & WorldFlags.BETA) !== 0) {
            return isMember ? WorldBackgroundType.MEMBERS_BETA : WorldBackgroundType.FREE_BETA;
        }
        if ((world.properties & WorldFlags.DEADMAN) !== 0) {
            return isMember
                ? WorldBackgroundType.MEMBERS_DEADMAN
                : WorldBackgroundType.FREE_DEADMAN;
        }
        if ((world.properties & WorldFlags.HIGH_RISK) !== 0) {
            return isMember
                ? WorldBackgroundType.MEMBERS_HIGH_RISK
                : WorldBackgroundType.FREE_HIGH_RISK;
        }
        if ((world.properties & WorldFlags.PVP) !== 0) {
            return isMember ? WorldBackgroundType.MEMBERS_PVP : WorldBackgroundType.FREE_PVP;
        }
        if ((world.properties & WorldFlags.FRESH_START) !== 0) {
            return isMember
                ? WorldBackgroundType.MEMBERS_FRESH_START
                : WorldBackgroundType.FREE_FRESH_START;
        }

        return isMember ? WorldBackgroundType.MEMBERS_NORMAL : WorldBackgroundType.FREE_NORMAL;
    }

    /**
     * Compute and cache world grid layout parameters.
     * This consolidates the duplicate layout calculation from 3 methods into 1.
     */
    private getGridLayout(worldCount: number): WorldGridLayout {
        // Return cached layout if world count hasn't changed
        if (this.cachedGridLayout !== null && this.cachedGridWorldCount === worldCount) {
            return this.cachedGridLayout;
        }

        const rowWidth = 88;
        const rowHeight = 19;
        let cols = Math.floor(765 / (rowWidth + 1)) - 1;
        let rows = Math.floor(480 / (rowHeight + 1));

        // Fit the grid to the world count
        do {
            const prevRows = rows;
            const prevCols = cols;
            if (rows * (cols - 1) >= worldCount) cols--;
            if (cols * (rows - 1) >= worldCount) rows--;
            if (cols * (rows - 1) >= worldCount) rows--;
            if (prevRows === rows && prevCols === cols) break;
        } while (true);

        // Calculate spacing
        let xGap = Math.floor((765 - rowWidth * cols) / (cols + 1));
        if (xGap > 5) xGap = 5;
        let yGap = Math.floor((480 - rowHeight * rows) / (rows + 1));
        if (yGap > 5) yGap = 5;

        const xOffset = Math.floor((765 - rowWidth * cols - xGap * (cols - 1)) / 2);
        const yOffset = Math.floor((480 - rows * rowHeight - yGap * (rows - 1)) / 2);

        const columnsPerPage = cols;
        const totalColumns = Math.ceil(worldCount / rows);

        this.cachedGridLayout = {
            cols,
            rows,
            xGap,
            yGap,
            xOffset,
            yOffset,
            rowWidth,
            rowHeight,
            worldCount,
            columnsPerPage,
            totalColumns,
        };
        this.cachedGridWorldCount = worldCount;

        return this.cachedGridLayout;
    }

    /**
     * Find which world is hovered based on mouse position.
     * Consolidates duplicate hover detection from drawWorldSelect and drawWorldSelectHoverOnly.
     */
    private findHoveredWorld(
        sortedWorlds: World[],
        layout: WorldGridLayout,
        page: number,
    ): WorldHoverResult {
        const { cols, rows, xGap, yGap, xOffset, yOffset, rowWidth, rowHeight, worldCount } =
            layout;

        let drawY = yOffset + 23;
        let drawX = xOffset + this.xPadding;
        let rowIndex = 0;
        let columnIndex = page;

        const startWorldIndex = page * rows;
        for (let i = startWorldIndex; i < worldCount && columnIndex - page < cols; i++) {
            const world = sortedWorlds[i];
            const canJoin = world.population !== -1;

            const isHovered =
                this.mouseX >= drawX &&
                this.mouseY >= drawY &&
                this.mouseX < drawX + rowWidth &&
                this.mouseY < drawY + rowHeight &&
                canJoin;

            if (isHovered) {
                return { index: i, world, x: drawX, y: drawY };
            }

            // Move to next position
            drawY += rowHeight + yGap;
            rowIndex++;
            if (rowIndex >= rows) {
                drawY = yOffset + 23;
                drawX += xGap + rowWidth;
                rowIndex = 0;
                columnIndex++;
            }
        }

        return { index: -1, world: null, x: 0, y: 0 };
    }

    private getSortedWorlds(): World[] {
        // Performance: return cached result if sort options haven't changed
        if (
            this.cachedSortedWorlds !== null &&
            this.cachedSortOption === this.worldSortOption &&
            this.cachedSortDirection === this.worldSortDirection
        ) {
            return this.cachedSortedWorlds;
        }

        const worlds = [...MOCK_WORLDS];
        const ascending = this.worldSortDirection === 0;

        worlds.sort((a, b) => {
            let result = 0;

            switch (this.worldSortOption) {
                case 0: // World ID
                    result = a.id - b.id;
                    break;
                case 1: // Players (population)
                    // Offline worlds (-1) go to end when ascending, start when descending
                    const popA = a.population === -1 ? (ascending ? 2001 : -1) : a.population;
                    const popB = b.population === -1 ? (ascending ? 2001 : -1) : b.population;
                    result = popA - popB;
                    break;
                case 2: // Location
                    result = a.location - b.location;
                    break;
                case 3: // Type (activity)
                    if (a.activity === "-") {
                        result = ascending ? 1 : -1;
                    } else if (b.activity === "-") {
                        result = ascending ? -1 : 1;
                    } else {
                        result = a.activity.localeCompare(b.activity);
                    }
                    break;
            }

            return ascending ? result : -result;
        });

        // Cache the result
        this.cachedSortedWorlds = worlds;
        this.cachedSortOption = this.worldSortOption;
        this.cachedSortDirection = this.worldSortDirection;

        return worlds;
    }

    private drawGradientRect(
        ctx: RenderContext,
        x: number,
        y: number,
        width: number,
        height: number,
        startColor: number,
        endColor: number,
    ): void {
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, "#" + (startColor & 0xffffff).toString(16).padStart(6, "0"));
        gradient.addColorStop(1, "#" + (endColor & 0xffffff).toString(16).padStart(6, "0"));
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, width, height);
    }

    private drawSpriteWithOverlay(
        ctx: RenderContext,
        sprite: IndexedSprite,
        x: number,
        y: number,
        alpha: number,
        overlayColor: number,
    ): void {
        // Draw sprite first
        this.drawSprite(ctx, sprite, x, y);

        // Then draw overlay with alpha
        const w = sprite.subWidth;
        const h = sprite.subHeight;
        if (w <= 0 || h <= 0) return;

        ctx.save();
        ctx.globalAlpha = alpha / 255;
        ctx.fillStyle = "#" + (overlayColor & 0xffffff).toString(16).padStart(6, "0");
        ctx.fillRect(x + sprite.xOffset, y + sprite.yOffset, w, h);
        ctx.restore();
    }

    // ========== Rendering Utilities ==========

    private drawLogoToCtx(ctx: RenderContext): void {
        if (this.logoImageLoaded && this.logoImage) {
            const logoX = this.xPadding + 382 - Math.floor(this.logoImage.width / 2);
            ctx.drawImage(this.logoImage, logoX, 18);
        } else if (this.logoSprite) {
            const logoX = this.xPadding + 382 - Math.floor(this.logoSprite.subWidth / 2);
            this.drawSprite(ctx, this.logoSprite, logoX, 18);
        }
    }

    private drawButton(
        ctx: RenderContext,
        centerX: number,
        centerY: number,
        text: string,
        font: BitmapFont = this.fontBold12!,
    ): void {
        if (!this.titlebuttonSprite || !font) return;

        const buttonW = this.titlebuttonSprite.subWidth;
        const buttonH = this.titlebuttonSprite.subHeight;
        const buttonX = Math.floor(centerX - buttonW / 2);
        const buttonY = Math.floor(centerY - buttonH / 2);

        this.drawSprite(ctx, this.titlebuttonSprite, buttonX, buttonY);
        this.drawCenteredText(ctx, font, text, centerX, centerY + 5, 0xffffff);
    }

    private drawSprite(ctx: RenderContext, sprite: IndexedSprite, x: number, y: number): void {
        const w = sprite.subWidth;
        const h = sprite.subHeight;
        if (w <= 0 || h <= 0) return;
        const drawX = Math.floor(x + sprite.xOffset);
        const drawY = Math.floor(y + sprite.yOffset);

        // Performance: check cache first to avoid expensive re-rendering
        const cached = this.spriteCache.get(sprite);
        if (cached) {
            ctx.drawImage(cached, drawX, drawY);
            return;
        }

        // Check for OffscreenCanvas support
        if (typeof OffscreenCanvas === "undefined") {
            console.warn(
                "[LoginRenderer] OffscreenCanvas not supported, sprite rendering may be degraded",
            );
            return;
        }

        // Create a dedicated OffscreenCanvas for this sprite (cached synchronously)
        const spriteCanvas = new OffscreenCanvas(w, h);
        const spriteCtx = spriteCanvas.getContext("2d");
        if (!spriteCtx) {
            return;
        }

        // Render sprite to its dedicated canvas
        const imageData = spriteCtx.createImageData(w, h);
        const data = imageData.data;
        const pixels = sprite.pixels;
        const palette = sprite.palette;
        const alpha = sprite.alpha;

        for (let i = 0; i < pixels.length; i++) {
            const paletteIndex = pixels[i] & 0xff;
            if (paletteIndex === 0 && (!alpha || alpha[i] === 0)) {
                data[i * 4] = 0;
                data[i * 4 + 1] = 0;
                data[i * 4 + 2] = 0;
                data[i * 4 + 3] = 0;
            } else {
                const color = palette[paletteIndex];
                data[i * 4] = (color >> 16) & 0xff;
                data[i * 4 + 1] = (color >> 8) & 0xff;
                data[i * 4 + 2] = color & 0xff;
                data[i * 4 + 3] = alpha ? alpha[i] : 255;
            }
        }

        spriteCtx.putImageData(imageData, 0, 0);

        // Cache synchronously - no async createImageBitmap overhead
        this.spriteCache.set(sprite, spriteCanvas);

        // Draw from the cached canvas
        ctx.drawImage(spriteCanvas, drawX, drawY);
    }

    private drawCenteredText(
        ctx: RenderContext,
        font: BitmapFont,
        text: string,
        x: number,
        y: number,
        color: number,
    ): void {
        const textWidth = this.measureText(font, text);
        this.drawText(ctx, font, text, x - Math.floor(textWidth / 2), y, color);
    }

    /** Performance: cached text measurement to avoid repeated font.measure() calls */
    private measureText(font: BitmapFont, text: string): number {
        let fontCache = this.textMeasureCache.get(font);
        if (!fontCache) {
            fontCache = new Map<string, number>();
            this.textMeasureCache.set(font, fontCache);
        }
        const cached = fontCache.get(text);
        if (cached !== undefined) {
            return cached;
        }
        const width = font.measure(text);
        fontCache.set(text, width);
        return width;
    }

    private drawText(
        ctx: RenderContext,
        font: BitmapFont,
        text: string,
        x: number,
        y: number,
        color: number,
    ): void {
        const colorStr = "#" + (color & 0xffffff).toString(16).padStart(6, "0");
        font.draw(ctx, text, x, y, colorStr);
    }

    private getCheckboxSprite(checked: boolean, hover: boolean): IndexedSprite | undefined {
        if (checked) {
            return hover ? this.optionsRadioSprite6 : this.optionsRadioSprite2;
        } else {
            return hover ? this.optionsRadioSprite4 : this.optionsRadioSprite0;
        }
    }

    private truncateFromStart(str: string, maxWidth: number): string {
        if (!this.fontBold12) return str;
        while (this.fontBold12.measure(str) > maxWidth && str.length > 0) {
            str = str.substring(1);
        }
        return str;
    }

    private ellipsis(str: string, maxWidth: number): string {
        if (!this.fontPlain12) return str;
        if (this.fontPlain12.measure(str) <= maxWidth) return str;
        const ellip = "...";
        const ellipW = this.fontPlain12.measure(ellip);
        while (this.fontPlain12.measure(str) + ellipW > maxWidth && str.length > 0) {
            str = str.slice(0, -1);
        }
        return str + ellip;
    }

    // ========== Resource Cleanup ==========

    /**
     * Dispose of all resources held by this renderer.
     * Call this when the login renderer is no longer needed.
     */
    dispose(): void {
        // Clear sprite references
        this.logoSprite = undefined;
        this.logoImage = undefined;
        this.logoImageLoaded = false;
        this.titleboxSprite = undefined;
        this.titlebuttonSprite = undefined;
        this.titlebuttonLargeSprite = undefined;
        this.playNowTextSprite = undefined;
        this.runesSprites = undefined;
        this.titleMuteSprites = undefined;
        this.optionsRadioSprite0 = undefined;
        this.optionsRadioSprite2 = undefined;
        this.optionsRadioSprite4 = undefined;
        this.optionsRadioSprite6 = undefined;
        this.worldSelectLeftSprite = undefined;
        this.worldSelectRightSprite = undefined;
        this.worldSelectButtonSprite = undefined;

        // Clear font references
        this.fontBold12 = undefined;
        this.fontPlain11 = undefined;
        this.fontPlain12 = undefined;

        // Clear title background
        if (this.titleBackgroundImage) {
            this.titleBackgroundImage.close();
            this.titleBackgroundImage = undefined;
        }

        // Clear animation
        if (this.loginScreenRunesAnimation) {
            this.loginScreenRunesAnimation.destroy();
            this.loginScreenRunesAnimation = undefined;
        }

        // Clear canvas references
        this.canvas = undefined;
        this.ctx = undefined;
    }

    /**
     * Reset animation state. Call when returning to login screen after logout.
     */
    resetAnimationState(): void {
        this.cycle = 0;
        this.lastTickTime = 0;
        this.caretBlinkMs = 0;
        if (this.loginScreenRunesAnimation) {
            this.loginScreenRunesAnimation.reset();
        }
    }
}

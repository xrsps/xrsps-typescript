import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import type { OsrsClient } from "../../client/OsrsClient";
import { GameState } from "../../client/login";
import { getCanvasCssSize } from "../../util/DeviceUtil";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

/**
 * Login screen overlay.
 * Renders the OSRS title/login screen when not logged in.
 *
 * Performance optimization: Uses separate textures for static UI and fire animation.
 * - Static UI texture: Only uploaded when state changes
 * - Fire texture: Small 128x256, uploaded every frame
 */
export class LoginOverlay implements Overlay {
    private app!: PicoApp;
    private gl!: WebGL2RenderingContext;

    // Main UI rendering
    private uiProgram!: Program;
    private uiDrawCall?: DrawCall;
    private vertexArray?: VertexArray;
    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private uiTexture?: Texture;

    // Fire rendering (separate small texture)
    private fireProgram!: Program;
    private fireDrawCall?: DrawCall;
    private fireVertexArray?: VertexArray;
    private firePositions?: VertexBuffer;
    private fireUvs?: VertexBuffer;
    private fireTexture?: Texture;

    // Cached screen dimensions
    private width: number = 765;
    private height: number = 503;
    private uiTextureWidth: number = 0;
    private uiTextureHeight: number = 0;
    private layoutWidth: number = 765;
    private layoutHeight: number = 503;

    // Current game state
    private gameState: GameState = GameState.LOADING;

    // Reference to OsrsClient for login rendering
    private osrsClient: OsrsClient;

    // Performance: dirty flag to skip redundant UI redraws
    private lastStateHash: string = "";
    private lastCursorBlink: boolean = false;
    private lastHoveredWorldIndex: number = -1;
    private lastHoveredServerIndex: number = -1;
    private uiNeedsRedraw: boolean = true;

    constructor(osrsClient: OsrsClient) {
        this.osrsClient = osrsClient;
    }

    /**
     * Set the current game state. When not logged in, the overlay renders.
     */
    setGameState(state: GameState): void {
        if (this.gameState !== state) {
            this.gameState = state;
            this.uiNeedsRedraw = true;
        }
    }

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.gl = args.app.gl as WebGL2RenderingContext;

        // Simple fullscreen quad shader for UI
        const uiVertSrc = `#version 300 es
            in vec2 aPosition;
            in vec2 aUV;
            out vec2 vUV;
            void main() {
                gl_Position = vec4(aPosition, 0.0, 1.0);
                vUV = aUV;
            }
        `;

        const uiFragSrc = `#version 300 es
            precision highp float;
            in vec2 vUV;
            out vec4 fragColor;
            uniform sampler2D uTexture;
            void main() {
                fragColor = texture(uTexture, vUV);
            }
        `;

        this.uiProgram = this.app.createProgram(uiVertSrc, uiFragSrc);

        // Fire shader - draws fire texture at specific position with alpha blending
        const fireVertSrc = `#version 300 es
            in vec2 aPosition;
            in vec2 aUV;
            out vec2 vUV;
            uniform vec4 uFireRect; // x, y, width, height in normalized coords
            void main() {
                // Transform unit quad to fire rectangle position
                vec2 pos = aPosition * 0.5 + 0.5; // 0..1
                pos = pos * uFireRect.zw + uFireRect.xy; // scale and offset
                pos = pos * 2.0 - 1.0; // back to clip space
                gl_Position = vec4(pos, 0.0, 1.0);
                vUV = aUV;
            }
        `;

        const fireFragSrc = `#version 300 es
            precision highp float;
            in vec2 vUV;
            out vec4 fragColor;
            uniform sampler2D uTexture;
            void main() {
                vec4 color = texture(uTexture, vUV);
                fragColor = color;
            }
        `;

        this.fireProgram = this.app.createProgram(fireVertSrc, fireFragSrc);

        // Create fullscreen quad geometry for UI
        const positions = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

        const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]);

        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, positions);
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, uvs);

        this.vertexArray = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);

        // Create fire quad geometry (same unit quad, transformed by uniform)
        this.firePositions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, positions);
        this.fireUvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, uvs);

        this.fireVertexArray = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.firePositions)
            .vertexAttributeBuffer(1, this.fireUvs);
    }

    update(args: OverlayUpdateArgs): void {
        // Update dimensions from args
        const { width, height } = args.resolution;
        if (this.width !== width || this.height !== height) {
            this.width = width;
            this.height = height;
            this.uiNeedsRedraw = true;
        }

        // Only render if on login screen (not logged in / loading game)
        if (
            this.gameState === GameState.LOGGED_IN ||
            this.gameState === GameState.LOADING_GAME ||
            this.gameState === GameState.RECONNECTING ||
            this.gameState === GameState.PLEASE_WAIT
        ) {
            return;
        }

        const { loginRenderer, loginState, inputManager } = this.osrsClient;
        const rendererCanvas = this.osrsClient.renderer?.canvas;
        const cssSize = rendererCanvas ? getCanvasCssSize(rendererCanvas) : undefined;
        const rawCssWidth =
            cssSize && Number.isFinite(cssSize.width) && cssSize.width > 0 ? cssSize.width : width;
        const rawCssHeight =
            cssSize && Number.isFinite(cssSize.height) && cssSize.height > 0
                ? cssSize.height
                : height;
        const cssLayoutWidth = Math.max(1, Math.round(rawCssWidth));
        const cssLayoutHeight = Math.max(1, Math.round(rawCssHeight));
        // Login input is mapped in CSS/layout space before being projected into the backing
        // store. The cached title texture must use that same space on desktop and mobile or
        // button hitboxes drift away from the rendered positions on HiDPI displays.
        const renderLayoutWidth = cssLayoutWidth;
        const renderLayoutHeight = cssLayoutHeight;

        this.layoutWidth = renderLayoutWidth;
        this.layoutHeight = renderLayoutHeight;

        const keyboardFocused =
            (this.osrsClient.renderer as any)?.isMobileLoginInputActive?.() === true;
        loginRenderer.syncMobileViewportState(loginState, keyboardFocused);
        loginRenderer.updateLayout(cssLayoutWidth, cssLayoutHeight, width, height);

        // Update mouse position for hover detection in world select
        const mouseX = inputManager?.mouseX ?? 0;
        const mouseY = inputManager?.mouseY ?? 0;
        if (inputManager) {
            loginRenderer.setMousePosition(mouseX, mouseY);

            // Transfer touch scroll velocity for mobile world select list
            if (loginState.worldSelectOpen && loginRenderer.layoutConfig.worldSelectListMode) {
                // Apply touch scroll velocity to scroll offset (inverted: drag up = scroll down)
                if (inputManager.isTouchScrolling) {
                    loginState.mobileWorldSelectScrollOffset -= inputManager.touchScrollVelocityY;
                    loginState.mobileWorldSelectScrollVelocity = -inputManager.touchScrollVelocityY;
                    this.uiNeedsRedraw = true;
                } else if (Math.abs(loginState.mobileWorldSelectScrollVelocity) > 0.5) {
                    // Continue momentum scrolling
                    this.uiNeedsRedraw = true;
                }
            }
        }

        // The cached login UI and separate fire overlay are authored in CSS/layout space, then
        // the fullscreen quad scales that texture to the canvas backing store.
        loginRenderer.updateLayout(
            renderLayoutWidth,
            renderLayoutHeight,
            renderLayoutWidth,
            renderLayoutHeight,
        );

        // Performance: compute state hash to detect changes
        const cursorBlink = loginRenderer.cycle % 40 < 20;
        const stateHash = this.computeStateHash(
            loginState,
            loginRenderer,
            width,
            height,
            renderLayoutWidth,
            renderLayoutHeight,
        );

        // Performance: Only check hover changes, not every mouse pixel movement
        // This avoids full redraw when mouse moves within the same world row
        const hoveredWorldIndex = loginState.worldSelectOpen
            ? loginRenderer.computeHoveredWorldIndex(loginState, width, height)
            : -1;
        const hoveredServerIndex = loginState.serverListOpen
            ? loginRenderer.computeHoveredServerIndex(loginState)
            : -1;
        loginState.hoveredServerIndex = hoveredServerIndex;
        const hoverChanged =
            hoveredWorldIndex !== this.lastHoveredWorldIndex ||
            hoveredServerIndex !== this.lastHoveredServerIndex;

        // Determine what kind of update is needed
        const stateChanged =
            stateHash !== this.lastStateHash || cursorBlink !== this.lastCursorBlink;
        const hoverOnlyChange = hoverChanged && !stateChanged && loginState.worldSelectOpen;

        if (stateChanged || hoverChanged) {
            this.uiNeedsRedraw = true;
        }

        // Update tracking variables
        this.lastStateHash = stateHash;
        this.lastCursorBlink = cursorBlink;
        this.lastHoveredWorldIndex = hoveredWorldIndex;
        this.lastHoveredServerIndex = hoveredServerIndex;

        // Only redraw UI when needed (LOADING/DOWNLOADING screen or state changed)
        // OSRS only draws the title fire once the login title screen is active (gameState >= 10).
        const isLoginScreenWithFire = this.gameState >= GameState.LOGIN_SCREEN;

        if (
            this.uiNeedsRedraw ||
            this.gameState === GameState.LOADING ||
            this.gameState === GameState.DOWNLOADING
        ) {
            // Draw login screen WITHOUT fire (fire rendered separately)
            if (this.gameState === GameState.DOWNLOADING) {
                loginRenderer.drawDownload(
                    loginState,
                    renderLayoutWidth,
                    renderLayoutHeight,
                    renderLayoutWidth,
                    renderLayoutHeight,
                );
            } else if (this.gameState === GameState.LOADING) {
                loginRenderer.drawInitial(
                    loginState,
                    renderLayoutWidth,
                    renderLayoutHeight,
                    renderLayoutWidth,
                    renderLayoutHeight,
                );
            } else {
                // Fast path: only hover changed, use cached title + hover overlay
                // skipFire=true, hoverOnly=true for fast path
                loginRenderer.drawTitle(
                    loginState,
                    this.gameState,
                    renderLayoutWidth,
                    renderLayoutHeight,
                    true,
                    hoverOnlyChange,
                    renderLayoutWidth,
                    renderLayoutHeight,
                );
            }

            // Update UI texture
            const loginCanvas = loginRenderer.getCanvas(renderLayoutWidth, renderLayoutHeight);
            this.updateUITexture(loginCanvas, renderLayoutWidth, renderLayoutHeight);
            this.uiNeedsRedraw = false;
        }

        // Update fire texture every frame (small 128x264 texture)
        // Skip when world select is open since fire is hidden behind it
        if (isLoginScreenWithFire && !loginState.worldSelectOpen) {
            const fireAnim = loginRenderer.getFireAnimation();
            if (fireAnim) {
                const fireCanvas = fireAnim.updateAndGetCanvas(loginRenderer.cycle);
                if (fireCanvas) {
                    this.updateFireTexture(fireCanvas);
                }
            }
        }
    }

    private updateUITexture(canvas: HTMLCanvasElement, width: number, height: number): void {
        // Recreate texture if size changed
        if (this.uiTextureWidth !== width || this.uiTextureHeight !== height) {
            if (this.uiTexture) {
                this.uiTexture.delete();
            }
            this.uiTexture = this.app.createTexture2D(canvas as unknown as HTMLImageElement, {
                flipY: false,
                magFilter: PicoGL.NEAREST,
                minFilter: PicoGL.NEAREST,
            });
            this.uiTextureWidth = width;
            this.uiTextureHeight = height;

            // Recreate draw call with new texture
            this.uiDrawCall = this.app
                .createDrawCall(this.uiProgram, this.vertexArray!)
                .texture("uTexture", this.uiTexture);
        } else if (this.uiTexture) {
            // Just update texture data
            this.uiTexture.data(canvas as unknown as HTMLImageElement);
        }
    }

    private updateFireTexture(canvas: OffscreenCanvas): void {
        if (!this.fireTexture) {
            this.fireTexture = this.app.createTexture2D(canvas as unknown as HTMLImageElement, {
                flipY: false,
                magFilter: PicoGL.NEAREST,
                minFilter: PicoGL.NEAREST,
            });

            // Create fire draw call
            this.fireDrawCall = this.app
                .createDrawCall(this.fireProgram, this.fireVertexArray!)
                .texture("uTexture", this.fireTexture);
        } else {
            // Update fire texture data.
            this.fireTexture.data(canvas as unknown as HTMLImageElement);
        }
    }

    /** Compute a hash of state values that affect rendering */
    private computeStateHash(
        loginState: import("../../client/login/LoginState").LoginState,
        loginRenderer: import("../../client/login/LoginRenderer").LoginRenderer,
        width: number,
        height: number,
        layoutWidth: number,
        layoutHeight: number,
    ): string {
        // Include all values that affect visual output (excluding animations)
        // Include download progress for DOWNLOADING state
        return `${this.gameState}|${loginState.loginIndex}|${loginState.username.length}|${
            loginState.password.length
        }|${loginState.otp.length}|${loginState.currentLoginField}|${loginState.onMobile}|${
            loginState.virtualKeyboardVisible
        }|${loginState.serverListOpen}|${loginState.serverName}|${loginRenderer.probing}|${loginRenderer.probed}|${loginRenderer.serverList.map(s => s.playerCount).join(",")}|${loginState.worldSelectOpen}|${loginState.worldSelectPage}|${
            loginState.loadingPercent
        }|${loginState.rememberUsername}|${loginState.isUsernameHidden}|${
            loginState.trustComputer
        }|${loginState.titleMusicDisabled}|${
            loginState.worldId
        }|${width}|${height}|${layoutWidth}|${layoutHeight}|${loginState.downloadCurrent}|${
            loginState.downloadTotal
        }|${loginRenderer.getViewportTransformStateHash()}|${loginRenderer.getTitleAssetStateHash()}`;
    }

    draw(phase: RenderPhase): void {
        // Only draw during PostPresent phase and when not logged in
        if (phase !== RenderPhase.PostPresent) {
            return;
        }

        if (
            this.gameState === GameState.LOGGED_IN ||
            this.gameState === GameState.LOADING_GAME ||
            this.gameState === GameState.RECONNECTING ||
            this.gameState === GameState.PLEASE_WAIT
        ) {
            return;
        }

        // Disable depth test for fullscreen quad
        this.app.disable(PicoGL.DEPTH_TEST);

        // Draw UI background first
        if (this.uiDrawCall && this.uiTexture) {
            this.app.disable(PicoGL.BLEND);
            this.uiDrawCall.draw();
        }

        // Draw fire overlays (on login screen OR during loading once sprites are loaded)
        const { loginState, loginRenderer } = this.osrsClient;
        const fireAnimAvailable = !!loginRenderer.getFireAnimation();
        const showFire =
            this.gameState >= GameState.LOGIN_SCREEN ||
            (this.gameState === GameState.LOADING && fireAnimAvailable);
        if (showFire && !loginState.worldSelectOpen && this.fireDrawCall && this.fireTexture) {
            // Enable alpha blending for fire
            this.app.enable(PicoGL.BLEND);
            this.gl.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);

            const { loginRenderer } = this.osrsClient;
            const firePos = loginRenderer.getFirePositions();
            const fireScale = loginRenderer.getRenderScale();
            const layoutScaleX = this.layoutWidth > 0 ? this.width / this.layoutWidth : 1;
            const layoutScaleY = this.layoutHeight > 0 ? this.height / this.layoutHeight : 1;
            const firePixelWidth = 128 * fireScale * layoutScaleX;
            const firePixelHeight = 264 * fireScale * layoutScaleY;
            const fireLeftX = firePos.leftX * layoutScaleX;
            const fireRightX = firePos.rightX * layoutScaleX;
            const fireY = firePos.y * layoutScaleY;

            // Convert pixel coordinates to normalized coordinates (0..1)
            const fireWidth = firePixelWidth / this.width;
            const fireHeight = firePixelHeight / this.height;

            // Left fire
            this.fireDrawCall.uniform("uFireRect", [
                fireLeftX / this.width,
                1 - (fireY + firePixelHeight) / this.height,
                fireWidth,
                fireHeight,
            ]);
            this.fireDrawCall.draw();

            // Right fire
            this.fireDrawCall.uniform("uFireRect", [
                fireRightX / this.width,
                1 - (fireY + firePixelHeight) / this.height,
                fireWidth,
                fireHeight,
            ]);
            this.fireDrawCall.draw();

            this.app.disable(PicoGL.BLEND);
        }

        // Re-enable depth test
        this.app.enable(PicoGL.DEPTH_TEST);
    }

    dispose(): void {
        try {
            this.uiTexture?.delete();
            this.fireTexture?.delete();
            this.vertexArray?.delete();
            this.fireVertexArray?.delete();
            this.positions?.delete();
            this.uvs?.delete();
            this.firePositions?.delete();
            this.fireUvs?.delete();
            this.uiProgram?.delete();
            this.fireProgram?.delete();
        } catch {}
    }
}

import { vec2 } from "gl-matrix";

import { ClientState } from "./ClientState";

/**
 * OSRS internal key code mapping table.
 * Maps Java/DOM keyCode to OSRS internal codes.
 * Source: class27.field115 in deobfuscated OSRS client.
 * Index = DOM keyCode, Value = OSRS internal code (-1 = unmapped)
 */
// prettier-ignore
const OSRS_KEY_MAP: number[] = [
    -1, -1, -1, -1, -1, -1, -1, -1, 85, 80, 84, -1, 91, 84, -1, -1, // 0-15 (8=backspace->85, 9=tab->80, 10=enter->84, 13=enter->84)
    81, 82, 86, -1, -1, -1, -1, -1, -1, -1, -1, 13, -1, -1, -1, -1, // 16-31 (16=shift->81, 17=ctrl->82, 18=alt->86, 27=escape->13)
    83, 104, 105, 103, 102, 96, 98, 97, 99, -1, -1, -1, -1, -1, -1, -1, // 32-47 (32=space->83, 33=pgup->104, 34=pgdn->105, 35=end->103, 36=home->102, 37=left->96, 38=up->98, 39=right->97, 40=down->99)
    25, 16, 17, 18, 19, 20, 21, 22, 23, 24, -1, -1, -1, -1, -1, -1, // 48-63 (48-57 = digits 0-9 -> 25, 16-24)
    -1, 48, 68, 66, 50, 34, 51, 52, 53, 39, 54, 55, 56, 70, 69, 40, // 64-79 (65-90 = A-Z letters)
    41, 32, 35, 49, 36, 38, 67, 33, 65, 37, 64, -1, -1, -1, -1, -1, // 80-95
    228, 231, 227, 233, 224, 219, 225, 230, 226, 232, 89, 87, -1, 88, 229, 90, // 96-111 (numpad)
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, -1, -1, -1, 101, // 112-127 (F1-F12 -> 1-12, 127=delete->101)
];

/**
 * Convert DOM keyCode to OSRS internal key code.
 */
function toOsrsKeyCode(domKeyCode: number): number {
    if (domKeyCode >= 0 && domKeyCode < OSRS_KEY_MAP.length) {
        return OSRS_KEY_MAP[domKeyCode];
    }
    return -1;
}

export function getMousePos(container: HTMLElement, event: MouseEvent | Touch): vec2 {
    const rect = container.getBoundingClientRect();
    const baseW = container.clientWidth || container.offsetWidth || rect.width;
    const baseH = container.clientHeight || container.offsetHeight || rect.height;

    let cssX = event.clientX - rect.left;
    let cssY = event.clientY - rect.top;

    // Forced-landscape portrait mode rotates the root 90deg clockwise.
    // Remap screen-space input back into unrotated local coordinates.
    const root = typeof document !== "undefined" ? document.documentElement : undefined;
    const forceLandscape = root?.dataset?.iosSafariForceLandscape === "1";
    const rotatedLandscape = root?.dataset?.iosSafariForceLandscapeRotated === "1";
    if (forceLandscape && rotatedLandscape) {
        // Inverse of: local -> screen, rotate +90deg around center.
        // screenX = localH - localY
        // screenY = localX
        // => localX = screenY
        // => localY = localH - screenX
        const rotatedX = cssY;
        const rotatedY = baseH - cssX;
        cssX = rotatedX;
        cssY = rotatedY;
    }

    cssX = Math.max(0, Math.min(baseW, cssX));
    cssY = Math.max(0, Math.min(baseH, cssY));

    // Scale from CSS coordinates to canvas internal coordinates
    // This handles cases where canvas is CSS-scaled (displayed size != internal resolution)
    const canvas = container as HTMLCanvasElement;
    const scaleX = canvas.width && baseW ? canvas.width / baseW : 1;
    const scaleY = canvas.height && baseH ? canvas.height / baseH : 1;
    const x = Math.floor(cssX * scaleX);
    const y = Math.floor(cssY * scaleY);
    return [x, y];
}

export function getAxisDeadzone(axis: number, zone: number): number {
    if (Math.abs(axis) < zone) {
        return 0;
    } else if (axis < 0) {
        return axis + zone;
    } else {
        return axis - zone;
    }
}

/**
 * Click modes matching OSRS GameApplet.java:
 * - 0: No click / released
 * - 1: Left mouse button
 * - 2: Right mouse button
 */
export const ClickMode = {
    NONE: 0,
    LEFT: 1,
    RIGHT: 2,
} as const;

/**
 * OSRS-parity input manager matching GameApplet.java variables:
 *
 * Mouse state:
 * - mouseX, mouseY: Current mouse position
 * - clickMode1: Raw click mode, set on press, cleared each frame (transferred to clickMode3)
 * - clickMode2: Held mode, persists while button held, 0 when released
 * - clickMode3: Frame-synchronized click (single-frame pulse from clickMode1)
 * - clickX, clickY: Raw click position (transferred to saveClickX/Y)
 * - saveClickX, saveClickY: Frame-synchronized click position
 * - mouseWheelDown: Middle button held
 * - mouseWheelX, mouseWheelY: Middle button drag origin
 * - idleTime: Frames since last input (for AFK detection)
 * - clickTime: Timestamp of last click
 *
 * Keyboard state:
 * - keyArray[128]: Key states (1=pressed, 0=released)
 * - charQueue: Queue of typed characters
 */
export class InputManager {
    private static readonly SYNTHETIC_MOUSE_SUPPRESS_MS = 700;

    element?: HTMLElement;

    // When true, double-click may request Pointer Lock (hides cursor).
    enablePointerLock: boolean = false;

    // === OSRS Mouse State (GameApplet.java parity) ===

    /** Current mouse X position */
    mouseX: number = -1;
    /** Current mouse Y position */
    mouseY: number = -1;

    /** Raw click mode, set on mousedown, cleared per frame to clickMode3 */
    clickMode1: number = ClickMode.NONE;
    /** Held mode, persists while button held, 0 on release */
    clickMode2: number = ClickMode.NONE;
    /** Frame-synchronized click mode (single-frame pulse) */
    clickMode3: number = ClickMode.NONE;

    /** Raw click X position */
    clickX: number = -1;
    /** Raw click Y position */
    clickY: number = -1;
    /** Frame-synchronized click X position */
    saveClickX: number = -1;
    /** Frame-synchronized click Y position */
    saveClickY: number = -1;

    /** Middle mouse button held */
    mouseWheelDown: boolean = false;
    /** Middle mouse drag start X */
    mouseWheelX: number = -1;
    /** Middle mouse drag start Y */
    mouseWheelY: number = -1;
    /** Per-frame accumulated middle-mouse drag delta for camera rotation. */
    private _cameraDragDeltaX: number = 0;
    private _cameraDragDeltaY: number = 0;

    /** Frames since last user input */
    idleTime: number = 0;
    /** Timestamp of last click */
    clickTime: number = 0;

    /**
     * Monotonic timestamp of last user input (mouse/key/touch/wheel), in ms.
     * Used for CS2 `idletimer_get` (opcode 3328) which is based on real time, not frame count.
     */
    private lastInputTimeMs: number =
        typeof performance !== "undefined" ? performance.now() : Date.now();

    /** Accumulated wheel delta for current frame */
    wheelDeltaY: number = 0;
    wheelCamDeltaX: number = 0;
    wheelCamDeltaY: number = 0;

    // === Pinch-to-zoom state ===
    /** Whether a pinch gesture is active (2 fingers on screen) */
    private isPinching: boolean = false;
    /** Initial distance between two touch points when pinch started */
    private pinchStartDistance: number = 0;
    /** Last known distance between two touch points */
    private lastPinchDistance: number = 0;
    /** Center point of pinch gesture */
    private pinchCenterX: number = 0;
    private pinchCenterY: number = 0;
    /** Accumulated pinch zoom delta (positive = zoom in, negative = zoom out) */
    pinchZoomDelta: number = 0;

    // === Touch scroll state (for mobile lists) ===
    /** Previous touch Y position for scroll velocity calculation */
    private prevTouchY: number = -1;
    /** Previous touch timestamp for velocity calculation */
    private prevTouchTime: number = 0;
    /** Touch scroll velocity Y (pixels/frame) */
    touchScrollVelocityY: number = 0;
    /** Whether touch scrolling is active */
    isTouchScrolling: boolean = false;
    /** Timestamp of the most recent touch interaction (used to suppress synthetic mouse events). */
    private lastTouchInputTimeMs: number = -1;

    // === Keyboard State ===

    /** Key states array (indexed by char code, 1=pressed 0=released) */
    keyArray: number[] = new Array(128).fill(0);
    /** Character queue for typed input */
    private charQueue: number[] = new Array(128).fill(0);
    /** Read index for charQueue circular buffer */
    private readIndex: number = 0;
    /** Write index for charQueue circular buffer */
    private writeIndex: number = 0;

    /** Map of held keys by code (for camera controls etc) */
    keys: Map<string, boolean> = new Map();
    /** Key events queued this frame (for widget onKey handlers) */
    keyEvents: { keyTyped: number; keyPressed: number; code: string }[] = [];
    /** Shift key state */
    shiftDown: boolean = false;

    // === OSRS Internal Key State (for CS2 KEYHELD/KEYPRESSED opcodes) ===

    /** Key states by OSRS internal key code (1=held, 0=released) */
    osrsKeyState: number[] = new Array(256).fill(0);
    /** Keys pressed this frame by OSRS internal code (for wasKeyPressed) */
    osrsKeyPressedThisFrame: Set<number> = new Set();

    // === Touch/Pointer State ===
    isTouch: boolean = false;

    // === Delta tracking for camera ===
    lastMouseX: number = -1;
    lastMouseY: number = -1;
    deltaMouseX: number = 0;
    deltaMouseY: number = 0;

    // === Gamepad ===
    gamepadIndex?: number;

    // === Legacy compatibility (for gradual migration) ===
    /** @deprecated Use saveClickX/saveClickY with clickMode3 */
    get leftClickX(): number {
        return this.clickMode3 === ClickMode.LEFT ? this.saveClickX : -1;
    }
    /** @deprecated Use saveClickX/saveClickY with clickMode3 */
    get leftClickY(): number {
        return this.clickMode3 === ClickMode.LEFT ? this.saveClickY : -1;
    }
    /** @deprecated Use saveClickX/saveClickY with clickMode3 */
    get pickX(): number {
        return this.clickMode3 === ClickMode.RIGHT ? this.saveClickX : -1;
    }
    /** @deprecated Use saveClickX/saveClickY with clickMode3 */
    get pickY(): number {
        return this.clickMode3 === ClickMode.RIGHT ? this.saveClickY : -1;
    }
    /** @deprecated Use mouseWheelX/Y with isDragging check */
    get dragX(): number {
        return this.clickMode2 === ClickMode.LEFT ? this.mouseWheelX : -1;
    }
    /** @deprecated Use mouseWheelX/Y with isDragging check */
    get dragY(): number {
        return this.clickMode2 === ClickMode.LEFT ? this.mouseWheelY : -1;
    }
    /** @deprecated Use mouseWheelX/Y with isCameraDragging check */
    get middleDragX(): number {
        return this.mouseWheelDown ? this.mouseWheelX : -1;
    }
    /** @deprecated Use mouseWheelX/Y with isCameraDragging check */
    get middleDragY(): number {
        return this.mouseWheelDown ? this.mouseWheelY : -1;
    }

    init(element: HTMLElement) {
        if (this.element) {
            this.cleanUp();
        }
        this.element = element;

        window.addEventListener("gamepadconnected", this.onGamepadConnected);
        window.addEventListener("gamepaddisconnected", this.onGamepadDisconnected);

        element.addEventListener("dblclick", this.onDoubleClick);
        element.addEventListener("keydown", this.onKeyDown);
        element.addEventListener("keyup", this.onKeyUp);
        element.addEventListener("mousedown", this.onMouseDown);
        element.addEventListener("mousemove", this.onMouseMove);
        element.addEventListener("mouseup", this.onMouseUp);
        element.addEventListener("mouseleave", this.onMouseLeave);
        const nonPassive: AddEventListenerOptions = { passive: false };
        element.addEventListener("wheel", this.onWheel, nonPassive);
        element.addEventListener("touchstart", this.onTouchStart, nonPassive);
        element.addEventListener("touchmove", this.onTouchMove, nonPassive);
        element.addEventListener("touchend", this.onTouchEnd, nonPassive);
        element.addEventListener("contextmenu", this.onContextMenu);
        element.addEventListener("focusout", this.onFocusOut);
    }

    cleanUp() {
        if (!this.element) return;

        window.removeEventListener("gamepadconnected", this.onGamepadConnected);
        window.removeEventListener("gamepaddisconnected", this.onGamepadDisconnected);

        this.element.removeEventListener("dblclick", this.onDoubleClick);
        this.element.removeEventListener("keydown", this.onKeyDown);
        this.element.removeEventListener("keyup", this.onKeyUp);
        this.element.removeEventListener("mousedown", this.onMouseDown);
        this.element.removeEventListener("mousemove", this.onMouseMove);
        this.element.removeEventListener("mouseup", this.onMouseUp);
        this.element.removeEventListener("mouseleave", this.onMouseLeave);
        this.element.removeEventListener("wheel", this.onWheel);
        this.element.removeEventListener("touchstart", this.onTouchStart);
        this.element.removeEventListener("touchmove", this.onTouchMove);
        this.element.removeEventListener("touchend", this.onTouchEnd);
        this.element.removeEventListener("contextmenu", this.onContextMenu);
        this.element.removeEventListener("focusout", this.onFocusOut);
        this.removeDocumentGrab();

        this.element = undefined;
    }

    // === OSRS-style helpers ===

    isShiftDown(): boolean {
        return this.shiftDown;
    }

    isKeyDown(key: string): boolean {
        return this.keys.has(key);
    }

    isKeyDownEvent(key: string): boolean {
        return !!this.keys.get(key);
    }

    /** Check if left mouse is currently held (OSRS: clickMode2 == 1) */
    isDragging(): boolean {
        return this.clickMode2 === ClickMode.LEFT;
    }

    /** Check if middle mouse is currently held for camera */
    isCameraDragging(): boolean {
        return this.mouseWheelDown;
    }

    isPointerLock(): boolean {
        return document.pointerLockElement === this.element;
    }

    isFocused(): boolean {
        return this.mouseX !== -1 && this.mouseY !== -1;
    }

    hasMovedMouse(): boolean {
        return this.lastMouseX !== this.mouseX || this.lastMouseY !== this.mouseY;
    }
    /** Flush all buffered key events and char queue (call when transitioning away from game) */
    flushInput(): void {
        this.readIndex = this.writeIndex;
        this.keyEvents.length = 0;
    }

    /** Read next character from queue (OSRS: readChar) */
    readChar(): number {
        if (this.writeIndex === this.readIndex) return -1;
        const char = this.charQueue[this.readIndex];
        this.readIndex = (this.readIndex + 1) & 0x7f;
        return char;
    }

    /**
     * Check if a key is currently held by OSRS internal key code.
     * Used by CS2 KEYHELD opcode (3500).
     */
    isKeyHeld(osrsKeyCode: number): boolean {
        if (osrsKeyCode < 0 || osrsKeyCode >= this.osrsKeyState.length) {
            return false;
        }
        return this.osrsKeyState[osrsKeyCode] === 1;
    }

    /**
     * Check if a key was pressed this frame by OSRS internal key code.
     * Used by CS2 KEYPRESSED opcode (3501).
     */
    wasKeyPressed(osrsKeyCode: number): boolean {
        return this.osrsKeyPressedThisFrame.has(osrsKeyCode);
    }

    getDeltaMouseX(): number {
        if (this.isPointerLock()) return this.deltaMouseX;
        if (this.isDragging()) return this._dragStartX - this.mouseX;
        return 0;
    }

    getDeltaMouseY(): number {
        if (this.isPointerLock()) return this.deltaMouseY;
        if (this.isDragging()) return this._dragStartY - this.mouseY;
        return 0;
    }

    getDeltaCameraX(): number {
    return this._cameraDragDeltaX;
    }

    getDeltaCameraY(): number {
        return this._cameraDragDeltaY;
    }

    getGamepad(): Gamepad | null {
        if (this.gamepadIndex === undefined) return null;
        const gamepads = navigator.getGamepads();
        return gamepads ? gamepads[this.gamepadIndex] : null;
    }

    // === Internal drag tracking ===
    private _dragStartX: number = -1;
    private _dragStartY: number = -1;

    // === Event Handlers ===

    private nowMs(): number {
        return typeof performance !== "undefined" ? performance.now() : Date.now();
    }

    /**
     * OSRS AFK logout window is 5 minutes (300s). CS2 scripts query remaining time in ms.
     */
    getIdleLogoutRemainingMs(): number {
        const elapsed = Math.max(0, this.nowMs() - this.lastInputTimeMs);
        const remaining = 300_000 - elapsed;
        return remaining > 0 ? remaining | 0 : 0;
    }

    private onGamepadConnected = (event: GamepadEvent) => {
        this.gamepadIndex = event.gamepad.index;
    };

    private onGamepadDisconnected = (_event: GamepadEvent) => {
        this.gamepadIndex = undefined;
    };

    private onDoubleClick = (_event: MouseEvent) => {
        if (!this.enablePointerLock) return;
        if (!document.pointerLockElement && this.element) {
            this.element.requestPointerLock();
        }
    };

    private shouldSuppressSyntheticMouse(): boolean {
        const lastTouch = this.lastTouchInputTimeMs;
        if (lastTouch < 0) return false;
        return this.nowMs() - lastTouch <= InputManager.SYNTHETIC_MOUSE_SUPPRESS_MS;
    }

    /**
     * Mouse button pressed - OSRS GameApplet.mousePressed
     */
    private onMouseDown = (event: MouseEvent) => {
        if (!this.element) return;
        if (this.shouldSuppressSyntheticMouse()) return;

        const [x, y] = getMousePos(this.element, event);
        // Keep modifier state in sync even if key events were missed due to focus.
        this.shiftDown = event.shiftKey === true;
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.clickX = x;
        this.clickY = y;
        this.clickTime = Date.now();

        // Middle mouse: camera pan
        if (event.button === 1) {
            this.mouseWheelDown = true;
            this.mouseWheelX = x;
            this.mouseWheelY = y;
            event.preventDefault();
            this.installDocumentGrab();
            return;
        }

        // Right click
        if (event.button === 2) {
            this.clickMode1 = ClickMode.RIGHT;
            this.clickMode2 = ClickMode.RIGHT;
        }
        // Left click
        else if (event.button === 0) {
            this.clickMode1 = ClickMode.LEFT;
            this.clickMode2 = ClickMode.LEFT;
            this._dragStartX = x;
            this._dragStartY = y;
        }

        this.mouseX = x;
        this.mouseY = y;
        this.isTouch = false;
        this.installDocumentGrab();
    };

    /**
     * Mouse released - OSRS GameApplet.mouseReleased
     */
    private onMouseUp = (event: MouseEvent) => {
        if (!this.element) return;
        if (this.shouldSuppressSyntheticMouse()) return;

        const [x, y] = getMousePos(this.element, event);
        // Keep modifier state in sync even if key events were missed due to focus.
        this.shiftDown = event.shiftKey === true;
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.clickMode2 = ClickMode.NONE;
        this.mouseWheelDown = false;
        this._dragStartX = -1;
        this._dragStartY = -1;
        this.mouseX = x;
        this.mouseY = y;
        this.removeDocumentGrab();
    };

    /**
     * Mouse moved - OSRS GameApplet.mouseMoved
     */
    private onMouseMove = (event: MouseEvent) => {
        if (!this.element) return;
        if (this.shouldSuppressSyntheticMouse()) return;

        const [x, y] = getMousePos(this.element, event);
        // Keep modifier state in sync even if key events were missed due to focus.
        this.shiftDown = event.shiftKey === true;
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.mouseX = x;
        this.mouseY = y;

        if (this.isPointerLock()) {
            this.deltaMouseX -= event.movementX;
            this.deltaMouseY -= event.movementY;
        }

        // Update camera drag position while middle-dragging (OSRS: mouseDragged) - Fixed
        if (this.mouseWheelDown) {
            const deltaX = this.mouseWheelX - x;
            const deltaY = this.mouseWheelY - y;
            this._cameraDragDeltaX += deltaX;
            this._cameraDragDeltaY += deltaY;
            this.mouseWheelDragged(deltaX, -deltaY);
            this.mouseWheelX = x;
            this.mouseWheelY = y;
        }

        this.isTouch = false;
    };

    /**
     * Mouse exited - OSRS GameApplet.mouseExited
     * OSRS parity: only sets coordinates to -1, does NOT reset button state.
     * Java AWT's implicit mouse grab means mouseReleased still fires outside
     * the component — our document-level grab listeners handle that.
     */
    private onMouseLeave = (_event: MouseEvent) => {
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.mouseX = -1;
        this.mouseY = -1;
    };

    // ── Document-level mouse grab (Java AWT implicit grab parity) ──
    // Java AWT delivers mouseDragged/mouseReleased to the component even when
    // the cursor is outside it, as long as a button was pressed on that component.
    // The web only fires these events on the element itself, so we install
    // temporary document-level listeners while a button is held.

    private _docGrabInstalled = false;

    private installDocumentGrab() {
        if (this._docGrabInstalled) return;
        this._docGrabInstalled = true;
        document.addEventListener("mousemove", this.onDocGrabMove, true);
        document.addEventListener("mouseup", this.onDocGrabUp, true);
    }

    private removeDocumentGrab() {
        if (!this._docGrabInstalled) return;
        this._docGrabInstalled = false;
        document.removeEventListener("mousemove", this.onDocGrabMove, true);
        document.removeEventListener("mouseup", this.onDocGrabUp, true);
    }

    /** Document-level mousemove — only updates coords when cursor is outside the canvas. */
    private onDocGrabMove = (event: MouseEvent) => {
        if (!this.element) return;
        // If the event target is within our element, the element's own onMouseMove handles it.
        if (this.element.contains(event.target as Node)) return;

        const [x, y] = getMousePos(this.element, event);
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.mouseX = x;
        this.mouseY = y;
    };

    /** Document-level mouseup — catches releases that occur outside the canvas. */
    private onDocGrabUp = (event: MouseEvent) => {
        this.removeDocumentGrab();
        if (!this.element) return;
        // If released inside our element, the element's own onMouseUp handles it.
        if (this.element.contains(event.target as Node)) return;

        const [x, y] = getMousePos(this.element, event);
        this.shiftDown = event.shiftKey === true;
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.clickMode2 = ClickMode.NONE;
        this.mouseWheelDown = false;
        this._dragStartX = -1;
        this._dragStartY = -1;
        this.mouseX = x;
        this.mouseY = y;
    };

    private onWheel = (event: WheelEvent) => {
        event.preventDefault();
        // OSRS parity: mouse wheel input resets idle timer (prevents AFK logout while scrolling).
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        if (this.mouseWheelDown) {
            this.wheelCamDeltaX += event.deltaX;
            this.wheelCamDeltaY += event.deltaY;
        } else {
            this.wheelDeltaY += event.deltaY;
        }
    };

    // Callback for mouse wheel camera drag (can be overridden)
    mouseWheelDragged(_deltaX: number, _deltaY: number) {
        // Override in subclass or set callback
    }

    // === Touch handlers ===

    /**
     * Calculate the distance between two touch points
     */
    private getTouchDistance(touch1: Touch, touch2: Touch): number {
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Calculate the center point between two touch points (in canvas coordinates)
     */
    private getTouchCenter(touch1: Touch, touch2: Touch): [number, number] {
        if (!this.element) return [0, 0];
        const [x1, y1] = getMousePos(this.element, touch1);
        const [x2, y2] = getMousePos(this.element, touch2);
        return [((x1 + x2) / 2) | 0, ((y1 + y2) / 2) | 0];
    }

    private onTouchStart = (event: TouchEvent) => {
        if (!this.element) return;
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.lastTouchInputTimeMs = this.lastInputTimeMs;
        this.isTouch = true;

        // Two-finger pinch gesture
        if (event.touches.length === 2) {
            this.isPinching = true;
            const distance = this.getTouchDistance(event.touches[0], event.touches[1]);
            this.pinchStartDistance = distance;
            this.lastPinchDistance = distance;
            const [cx, cy] = this.getTouchCenter(event.touches[0], event.touches[1]);
            this.pinchCenterX = cx;
            this.pinchCenterY = cy;
            // Cancel any single-touch click in progress
            this.clickMode1 = ClickMode.NONE;
            this.clickMode2 = ClickMode.NONE;
            event.preventDefault();
            return;
        }

        // Single touch - treat as click
        const [x, y] = getMousePos(this.element, event.touches[0]);
        this.clickX = x;
        this.clickY = y;
        this.clickTime = Date.now();
        this.clickMode1 = ClickMode.LEFT;
        this.clickMode2 = ClickMode.LEFT;
        this._dragStartX = x;
        this._dragStartY = y;
        this.mouseX = x;
        this.mouseY = y;

        // Initialize touch scroll tracking
        this.prevTouchY = y;
        this.prevTouchTime = performance.now();
        this.touchScrollVelocityY = 0;
        this.isTouchScrolling = false;
        event.preventDefault();
    };

    private onTouchMove = (event: TouchEvent) => {
        if (!this.element) return;
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.lastTouchInputTimeMs = this.lastInputTimeMs;

        // Handle pinch gesture
        if (this.isPinching && event.touches.length === 2) {
            const distance = this.getTouchDistance(event.touches[0], event.touches[1]);
            const delta = distance - this.lastPinchDistance;
            // Convert pixel distance to zoom delta (negative = zoom out, positive = zoom in)
            // Scale factor to make pinch feel natural (similar to mouse wheel)
            this.pinchZoomDelta += -delta * 2;
            this.lastPinchDistance = distance;
            const [cx, cy] = this.getTouchCenter(event.touches[0], event.touches[1]);
            this.pinchCenterX = cx;
            this.pinchCenterY = cy;
            event.preventDefault();
            return;
        }

        // Single touch move
        const [x, y] = getMousePos(this.element, event.touches[0]);
        this.mouseX = x;
        this.mouseY = y;

        // Calculate touch scroll velocity for mobile lists
        if (this.prevTouchY >= 0) {
            const now = performance.now();
            const deltaTime = now - this.prevTouchTime;
            if (deltaTime > 0) {
                const deltaY = y - this.prevTouchY;
                // Only track scrolling if there's significant vertical movement
                if (Math.abs(deltaY) > 2) {
                    this.isTouchScrolling = true;
                    // Velocity in pixels per 16ms (approx one frame at 60fps)
                    this.touchScrollVelocityY = (deltaY / deltaTime) * 16;
                }
            }
            this.prevTouchY = y;
            this.prevTouchTime = now;
        }
        event.preventDefault();
    };

    private onTouchEnd = (event: TouchEvent) => {
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();
        this.lastTouchInputTimeMs = this.lastInputTimeMs;

        // If we were pinching and now have less than 2 fingers, end the pinch
        if (this.isPinching && event.touches.length < 2) {
            this.isPinching = false;
            this.pinchStartDistance = 0;
            this.lastPinchDistance = 0;
            // If one finger remains, transition back to single-touch mode
            if (event.touches.length === 1 && this.element) {
                const [x, y] = getMousePos(this.element, event.touches[0]);
                this.mouseX = x;
                this.mouseY = y;
                this._dragStartX = x;
                this._dragStartY = y;
            }
            event.preventDefault();
            return;
        }

        // Normal touch end
        this.clickMode2 = ClickMode.NONE;
        this._dragStartX = -1;
        this._dragStartY = -1;

        // Reset touch scroll tracking (but keep velocity for momentum)
        this.prevTouchY = -1;
        this.prevTouchTime = 0;
        // Note: touchScrollVelocityY is intentionally kept for momentum scrolling
        // It will be consumed by the mobile world select list
        event.preventDefault();
    };

    private onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        // Position already captured in onMouseDown
    };

    // === Keyboard handlers - OSRS GameApplet.keyPressed/keyReleased ===

    private onKeyDown = (event: KeyboardEvent) => {
        event.preventDefault();
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();

        const keyCode = event.keyCode;
        const charCode =
            !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1
                ? event.key.charCodeAt(0) | 0
                : 0;
        const osrsKeyCode = toOsrsKeyCode(keyCode);

        // Track shift state
        if (event.shiftKey) {
            this.shiftDown = true;
        }

        // Track OSRS internal key state for KEYHELD/KEYPRESSED opcodes.
        if (osrsKeyCode !== -1) {
            if (osrsKeyCode > 0 && osrsKeyCode < 128) {
                this.keyArray[osrsKeyCode] = 1;
            }
            this.osrsKeyState[osrsKeyCode] = 1;
            this.osrsKeyPressedThisFrame.add(osrsKeyCode);
            if (osrsKeyCode === 81 || osrsKeyCode === 82) {
                ClientState.setKeybindState(osrsKeyCode, true);
            }
        }

        // OSRS parity: widget onKey receives either an internal key code OR a typed character.
        // For typed characters: keyTyped = -1, keyPressed = charCode.
        // For key presses: keyTyped = osrsKeyCode, keyPressed = 0.
        if (charCode >= 32) {
            this.keyEvents.push({
                keyTyped: -1,
                keyPressed: charCode,
                code: event.code,
            });
            this.charQueue[this.writeIndex] = charCode;
            this.writeIndex = (this.writeIndex + 1) & 0x7f;
        } else if (osrsKeyCode !== -1) {
            this.keyEvents.push({
                keyTyped: osrsKeyCode,
                keyPressed: 0,
                code: event.code,
            });
        }

        // Track by code for camera controls
        this.keys.set(event.code, true);
    };

    private onKeyUp = (event: KeyboardEvent) => {
        event.preventDefault();
        this.idleTime = 0;
        this.lastInputTimeMs = this.nowMs();

        const keyCode = event.keyCode;

        // Clear shift state
        if (keyCode === 16) {
            // VK_SHIFT
            this.shiftDown = false;
        }

        const osrsKeyCode = toOsrsKeyCode(keyCode);
        if (osrsKeyCode !== -1) {
            if (osrsKeyCode > 0 && osrsKeyCode < 128) {
                this.keyArray[osrsKeyCode] = 0;
            }
            this.osrsKeyState[osrsKeyCode] = 0;
            if (osrsKeyCode === 81 || osrsKeyCode === 82) {
                ClientState.setKeybindState(osrsKeyCode, false);
            }
        }

        this.keys.delete(event.code);
    };

    private onFocusOut = () => {
        // Clear all key states on focus loss (OSRS: focusLost)
        for (let i = 0; i < 128; i++) {
            this.keyArray[i] = 0;
        }
        // Clear OSRS internal key states
        for (let i = 0; i < this.osrsKeyState.length; i++) {
            this.osrsKeyState[i] = 0;
        }
        this.osrsKeyPressedThisFrame.clear();
        this.shiftDown = false;
        this.keys.clear();
        ClientState.setKeybindState(81, false);
        ClientState.setKeybindState(82, false);
        this.resetMouse();
    };

    resetMouse() {
        this.mouseX = -1;
        this.mouseY = -1;
        this.clickMode2 = ClickMode.NONE;
        this.mouseWheelDown = false;
        this._dragStartX = -1;
        this._dragStartY = -1;
        this.removeDocumentGrab();
    }

    /**
     * Called at start of each game loop iteration - OSRS game loop pattern:
     *
     * ```java
     * clickMode3 = clickMode1;
     * saveClickX = clickX;
     * saveClickY = clickY;
     * clickMode1 = 0;
     * processGameLoop();
     * ```
     */
    onFrameStart() {
        // Transfer click state for this frame
        this.clickMode3 = this.clickMode1;
        this.saveClickX = this.clickX;
        this.saveClickY = this.clickY;
        this.clickMode1 = ClickMode.NONE;
    }

    /**
     * Called at end of each frame
     */
    onFrameEnd() {
        // Update key event tracking (transition from "just pressed" to "held")
        for (const key of this.keys.keys()) {
            this.keys.set(key, false);
        }

        // Update drag positions for delta calculation
        if (this.isDragging() && !this.isTouch) {
            this._dragStartX = this.mouseX;
            this._dragStartY = this.mouseY;
        }
        if (this.isCameraDragging()) {
            this.mouseWheelX = this.mouseX;
            this.mouseWheelY = this.mouseY;
        }

        // Clear per-frame deltas
        this.deltaMouseX = 0;
        this.deltaMouseY = 0;
        this.wheelDeltaY = 0;
        this.wheelCamDeltaX = 0;
        this.wheelCamDeltaY = 0;
        this._cameraDragDeltaX = 0;
        this._cameraDragDeltaY = 0;
        this.pinchZoomDelta = 0;
        this.lastMouseX = this.mouseX;
        this.lastMouseY = this.mouseY;

        // Clear key events queue
        this.keyEvents.length = 0;

        // Clear per-frame OSRS key pressed tracking (for wasKeyPressed)
        this.osrsKeyPressedThisFrame.clear();

        // Increment idle time
        this.idleTime++;
    }

    /** @deprecated Use onFrameStart() for OSRS parity */
    clearPick() {
        // No-op for compatibility
    }
}

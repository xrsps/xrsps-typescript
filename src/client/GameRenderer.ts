import { Schema } from "leva/dist/declarations/src/types";

import { Renderer } from "../components/renderer/Renderer";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { clamp } from "../util/MathUtil";
import { ProjectionType } from "./Camera";
import { ClientState } from "./ClientState";
import { OsrsRendererType } from "./GameRenderers";
import { getAxisDeadzone } from "./InputManager";
import { MapManager, MapSquare } from "./MapManager";
import { OsrsClient } from "./OsrsClient";
import { IProjectileManager } from "./interfaces/IProjectileManager";
import type { PlayerSpotAnimationEvent } from "./sync/PlayerSyncTypes";

export interface HitsplatEventPayload {
    targetType: "player" | "npc";
    targetId: number;
    damage: number;
    style?: number;
    tick?: number;
    /** OSRS secondary hitsplat type (var3 in SoundSystem.method877). */
    type2?: number;
    /** OSRS secondary hitsplat value (var4 in SoundSystem.method877). */
    damage2?: number;
    /** OSRS extra cycles added to the hitsplat lifetime (var6 in Actor.addHitSplat). */
    delayCycles?: number;
}

export abstract class GameRenderer<T extends MapSquare = MapSquare> extends Renderer {
    abstract type: OsrsRendererType;

    mapManager: MapManager<T>;
    uiHidden: boolean = false;

    constructor(public osrsClient: OsrsClient) {
        super();
        // Keep the number of queued map loads low to cap memory spikes
        this.mapManager = new MapManager(osrsClient.workerPool.size, this.queueLoadMap.bind(this));
    }

    protected override getEffectiveFpsLimit(): number {
        let limit = super.getEffectiveFpsLimit();
        const target = Number(this.osrsClient.targetFps) | 0;
        if (target > 0) {
            limit = limit > 0 ? Math.min(limit, target) : target;
        }
        try {
            if (typeof document !== "undefined" && document.hidden) {
                limit = limit > 0 ? Math.min(limit, 30) : 30;
            }
        } catch {}
        return limit > 0 ? limit : 0;
    }

    override start(): void {
        try {
            this.osrsClient.startClientTickLoop();
        } catch {}
        super.start();
    }

    override stop(): void {
        try {
            this.osrsClient.stopClientTickLoop();
        } catch {}
        super.stop();
    }

    override async init() {
        this.osrsClient.inputManager.init(this.canvas);
    }

    override cleanUp(): void {
        this.osrsClient.inputManager.cleanUp();
    }

    setUiHidden(hidden: boolean): void {
        this.uiHidden = !!hidden;
    }

    /**
     * Clear session-specific caches to prevent memory leaks on logout/disconnect.
     * Subclasses should override to clear their accumulated session data.
     */
    clearSessionCaches(): void {
        // Base implementation does nothing - subclasses override
    }

    initCache(): void {
        if (!this.osrsClient.loadedCache) return;
        this.mapManager.init(
            this.osrsClient.mapFileIndex,
            SceneBuilder.fillEmptyTerrain(this.osrsClient.loadedCache.info),
        );
        if (!this.osrsClient.isLoggedIn()) {
            return;
        }
        // Use camera position for initial load (player position not yet available)
        const camera = this.osrsClient.camera;
        this.mapManager.update(
            camera.getPosX(),
            camera.getPosZ(),
            camera,
            this.stats.frameCount,
            this.osrsClient.mapRadius,
            ClientState.baseX | 0,
            ClientState.baseY | 0,
            this.osrsClient.expandedMapLoading | 0,
        );
    }

    /**
     * Initialize overlay assets from the cache.
     * Called during phased loading after cache is fully available.
     */
    initOverlays(): void {
        // Base implementation does nothing - subclasses override
    }

    getControls(): Schema {
        return {};
    }

    queueLoadMap(mapX: number, mapY: number, streamGeneration?: number): void {}

    /**
     * OSRS parity: collision flags for route reconstruction (e.g. run-step traversal).
     * Default implementation returns 0 when not supported by the renderer.
     */
    getCollisionFlagAt(_plane: number, _tileX: number, _tileY: number): number {
        return 0;
    }

    handleInput(deltaTime: number) {
        // OSRS frame start: transfer click state (clickMode1 -> clickMode3)
        this.osrsClient.inputManager.onFrameStart();

        this.handleKeyInput(deltaTime);
        this.handleControllerInput(deltaTime);

        if (!this.uiHidden) {
            // Process UI interaction BEFORE mouse input so widgets can consume scroll
            // before camera zoom uses it
            this.osrsClient.handleUiInput();
            // Update widget layout (CS2 positioning/sizing)
            this.osrsClient.updateWidgets();
        }

        // Mouse input (camera zoom) uses whatever wheel delta remains after UI
        this.handleMouseInput();
    }

    handleKeyInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const inputManager = this.osrsClient.inputManager;
        const camera = this.osrsClient.camera;

        let cameraSpeedMult = 1.0;
        if (inputManager.isShiftDown()) {
            cameraSpeedMult = 10.0;
        }
        if (inputManager.isKeyDown("Tab")) {
            cameraSpeedMult = 0.1;
        }

        // Arrow-key rotation speed tuned to OSRS pacing (~4s per revolution)
        const deltaPitch = 64 * 8 * deltaTimeSec; // ~90°/s
        const deltaYaw = 512 * deltaTimeSec; // 2048 units / 4s

        if (inputManager.isKeyDown("ArrowUp")) {
            // Up tilts camera downward (increase positive pitch)
            camera.updatePitch(camera.pitch, deltaPitch);
        }
        if (inputManager.isKeyDown("ArrowDown")) {
            // Down tilts camera upward (decrease positive pitch)
            camera.updatePitch(camera.pitch, -deltaPitch);
        }
        if (inputManager.isKeyDown("ArrowRight")) {
            // Right rotates view to the right (negative yaw delta due to RS yaw basis)
            camera.updateYaw(camera.yaw, -deltaYaw);
        }
        if (inputManager.isKeyDown("ArrowLeft")) {
            // Left rotates view to the left
            camera.updateYaw(camera.yaw, deltaYaw);
        }

        // camera position controls
        let deltaX = 0;
        let deltaY = 0;
        let deltaZ = 0;

        const deltaPos = 16 * (this.osrsClient.cameraSpeed * cameraSpeedMult) * deltaTimeSec;
        const deltaHeight = 8 * (this.osrsClient.cameraSpeed * cameraSpeedMult) * deltaTimeSec;

        if (!this.osrsClient.followPlayerCamera) {
            if (inputManager.isKeyDown("KeyW")) {
                // Forward
                deltaZ -= deltaPos;
            }
            if (inputManager.isKeyDown("KeyA")) {
                // Left
                deltaX += deltaPos;
            }
            if (inputManager.isKeyDown("KeyS")) {
                // Back
                deltaZ += deltaPos;
            }
            if (inputManager.isKeyDown("KeyD")) {
                // Right
                deltaX -= deltaPos;
            }
            if (inputManager.isKeyDown("KeyE") || inputManager.isKeyDown("KeyR")) {
                // Move up
                deltaY -= deltaHeight;
            }
            if (
                inputManager.isKeyDown("KeyQ") ||
                inputManager.isKeyDown("KeyC") ||
                inputManager.isKeyDown("KeyF")
            ) {
                // Move down
                deltaY += deltaHeight;
            }
        }

        if (!this.osrsClient.followPlayerCamera) {
            if (deltaX !== 0 || deltaZ !== 0) {
                camera.move(deltaX, 0, deltaZ);
            }
            if (deltaY !== 0) {
                camera.move(0, deltaY, 0);
            }
        }

        if (!this.osrsClient.followPlayerCamera) {
            if (inputManager.isKeyDown("KeyP")) {
                camera.snapToPosition(2780, undefined, 9537);
            }
        }

        // Toggle hover devoverlay with F3
        if (inputManager.isKeyDownEvent("F3")) {
            this.osrsClient.hoverOverlayEnabled = !this.osrsClient.hoverOverlayEnabled;
        }
    }

    handleMouseInput() {
        const inputManager = this.osrsClient.inputManager;
        const camera = this.osrsClient.camera;

        if (inputManager.isPointerLock()) {
            this.osrsClient.closeMenu();
        }

        // mouse/touch controls
        const deltaMouseX = inputManager.getDeltaMouseX();
        const deltaMouseY = inputManager.getDeltaMouseY();

        if (!this.osrsClient.followPlayerCamera) {
            if (deltaMouseX !== 0 || deltaMouseY !== 0) {
                if (inputManager.isTouch) {
                    camera.move(0, clamp(-deltaMouseY, -100, 100) * 0.004, 0);
                } else {
                    camera.updatePitch(camera.pitch, deltaMouseY * 0.9);
                    camera.updateYaw(camera.yaw, deltaMouseX * -0.9);
                }
            }
        }

        // Middle-mouse camera drag (RuneLite style, works while following)
        const deltaCamX = inputManager.getDeltaCameraX();
        const deltaCamY = inputManager.getDeltaCameraY();
        if (deltaCamX !== 0 || deltaCamY !== 0) {
            camera.updatePitch(camera.pitch, deltaCamY * 0.9);
            camera.updateYaw(camera.yaw, deltaCamX * -0.9);
        }

        // Scroll wheel zoom.
        // Follow-camera zoom is driven by widget onScroll handlers on the main viewport root.
        // Combine wheel and pinch inputs (pinchZoomDelta is scaled similarly to wheel)
        const zoomDelta = inputManager.wheelDeltaY + inputManager.pinchZoomDelta;
        if (zoomDelta !== 0) {
            if (
                !this.osrsClient.followPlayerCamera &&
                camera.projectionType === ProjectionType.PERSPECTIVE
            ) {
                const zoomSpeed = 0.02; // tiles per wheel unit
                const clampedDelta = clamp(zoomDelta, -120, 120);
                if (clampedDelta !== 0) {
                    camera.move(0, 0, clampedDelta * zoomSpeed, true);
                    camera.updated = true;
                }
            } else if (camera.projectionType === ProjectionType.ORTHO) {
                // For ortho: higher value zooms in; wheel down (positive) zooms out
                const scale = 0.03;
                camera.orthoZoom = clamp(camera.orthoZoom + -zoomDelta * scale, 1, 60);
                camera.updated = true;
            }
        }
    }

    handleControllerInput(deltaTime: number) {
        const deltaPitch = deltaTime;
        const deltaYaw = deltaTime;

        const inputManager = this.osrsClient.inputManager;
        const camera = this.osrsClient.camera;

        // controller
        const gamepad = inputManager.getGamepad();

        if (gamepad && gamepad.connected && gamepad.mapping === "standard") {
            let cameraSpeedMult = 0.01;
            // X, R1
            if (gamepad.buttons[0].pressed || gamepad.buttons[5].pressed) {
                cameraSpeedMult = 0.1;
            }

            const zone = 0.1;

            const leftX = getAxisDeadzone(gamepad.axes[0], zone);
            const leftY = getAxisDeadzone(-gamepad.axes[1], zone);
            const leftTrigger = gamepad.buttons[6].value;

            const rightX = getAxisDeadzone(gamepad.axes[2], zone);
            const rightY = getAxisDeadzone(-gamepad.axes[3], zone);
            const rightTrigger = gamepad.buttons[7].value;

            const trigger = leftTrigger - rightTrigger;

            if (leftX !== 0 || leftY !== 0 || trigger !== 0) {
                camera.move(
                    leftX * cameraSpeedMult * -deltaTime,
                    0,
                    leftY * cameraSpeedMult * -deltaTime,
                    false,
                );
                camera.move(0, trigger * cameraSpeedMult * -deltaTime, 0);
            }

            if (rightX !== 0) {
                camera.updateYaw(camera.yaw, deltaYaw * 1.5 * rightX);
            }
            if (rightY !== 0) {
                // Gamepad right stick: pushing up should tilt up (decrease pitch)
                camera.updatePitch(camera.pitch, -deltaPitch * 1.5 * rightY);
            }
        }
    }

    registerHitsplat(_event: HitsplatEventPayload): void {}

    registerSpotAnimation(_event: PlayerSpotAnimationEvent): void {}

    abstract getProjectileManager(): IProjectileManager | undefined;

    override onFrameEnd(): void {
        super.onFrameEnd();

        // URL/search params syncing removed; no-op when camera updates

        this.osrsClient.inputManager.onFrameEnd();
        this.osrsClient.camera.onFrameEnd();
    }
}

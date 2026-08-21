import Denque from "denque";
import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import { button, folder } from "leva";
import { Schema } from "leva/dist/declarations/src/types";
import {
    DrawCall,
    Framebuffer,
    App as PicoApp,
    PicoGL,
    Program,
    Renderbuffer,
    Texture,
    Timer,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import {
    getClientCycle,
    getCurrentTick,
    getServerTickPhaseNow,
    isServerConnected,
    sendEmote,
    sendInteractFollow,
    sendInteractStop,
    subscribeTick,
} from "../../../network/ServerConnection";
import { sendLogin } from "../../../network/ServerConnection";
import { flushPackets } from "../../../network/packet";
import { createTextureArray } from "../../../picogl/PicoTexture";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { CollisionFlag } from "../../../common/CollisionFlag";
import { isInWilderness } from "../../../common/world/Wilderness";
import {
    getWorldLocChanges,
    getWorldLocSpawns,
    getWorldTerrainOverrides,
} from "../../../common/gamemode/GamemodeContentStore";
import { OsrsMenuEntry } from "../../../rs/MenuEntry";
import { MenuTargetType } from "../../../rs/MenuEntry";
import type { OverlayFloorType } from "../../../rs/config/floortype/OverlayFloorType";
import { LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../../rs/config/loctype/LocModelType";
import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcDrawPriority, NpcType } from "../../../rs/config/npctype/NpcType";
import { PlayerAppearance } from "../../../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../../../rs/config/player/PlayerModelLoader";
import { decodeInteractionIndex } from "../../../rs/interaction/InteractionIndex";
import { getMapIndexFromTile, getMapPlaneId, getMapSquareId } from "../../../rs/map/MapFileIndex";
import { Model } from "../../../rs/model/Model";
import { ModelData } from "../../../rs/model/ModelData";
import { Scene } from "../../../rs/scene/Scene";
import { getUiScale } from "../../../ui/UiScale";
import { ClickCrossOverlay } from "../../../ui/devoverlay/ClickCrossOverlay";
import { GroundItemOverlay } from "../../../ui/devoverlay/GroundItemOverlay";
import { HealthBarOverlay } from "../../../ui/devoverlay/HealthBarOverlay";
import { HitsplatOverlay } from "../../../ui/devoverlay/HitsplatOverlay";
import {
    InteractHighlightDrawTarget,
    InteractHighlightOverlay,
} from "../../../ui/devoverlay/InteractHighlightOverlay";
import { LoadingMessageOverlay } from "../../../ui/devoverlay/LoadingMessageOverlay";
import { LoginOverlay } from "../../../ui/devoverlay/LoginOverlay";
import { OverheadPrayerOverlay } from "../../../ui/devoverlay/OverheadPrayerOverlay";
import { OverheadTextOverlay } from "../../../ui/devoverlay/OverheadTextOverlay";
import {
    HealthBarEntry,
    HitsplatEntry,
    OverheadPrayerEntry,
    OverheadTextEntry,
    type OverlayUpdateArgs,
    RenderPhase,
} from "../../../ui/devoverlay/Overlay";
import { OverlayManager } from "../../../ui/devoverlay/OverlayManager";
import type { TileMarkerOverlay } from "../../../ui/devoverlay/TileMarkerOverlay";
import { TileTextOverlay } from "../../../ui/devoverlay/TileTextOverlay";
import { WidgetsOverlay } from "../../../ui/devoverlay/WidgetsOverlay";
import { MENU_ACTION_DEPRIORITIZE_OFFSET, MenuAction, menuAction } from "../../../ui/menu/MenuAction";
import { worldEntriesToSimple } from "../../../ui/menu/MenuBridge";
import type { MenuClickContext, SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import { chooseDefaultMenuEntry, shouldLeftClickOpenMenu } from "../../../ui/menu/MenuEngine";
import { MenuOpcode } from "../../../ui/menu/MenuState";
import { Model2DRenderer } from "../../../ui/model/Model2DRenderer";
import {
    canTargetGroundItem,
    canTargetNpc,
    canTargetObject,
    canTargetPlayer,
} from "../../../widgets/WidgetFlags";
import { WidgetLoader } from "../../../widgets/WidgetLoader";
import { WidgetManager } from "../../../widgets/WidgetManager";
import { layoutWidgets } from "../../../widgets/layout/WidgetLayout";
import { collectWidgetsAtPoint } from "../../../widgets/menu/utils";
import {
    getCanvasCssSize,
    isIos,
    isMobileMode,
    isTouchDevice,
    isWebGL2Supported,
} from "../../../common/utils/DeviceUtil";
import { clamp } from "../../../common/utils/MathUtil";
import { ClientState } from "../../../game/ClientState";
import { GameRenderer } from "../../../game/GameRenderer";
import type { HitsplatEventPayload } from "../../../game/GameRenderer";
import { OsrsRendererType, WEBGL } from "../../../game/GameRenderers";
import { ClickMode, getMousePos } from "../../../game/InputManager";
import { OsrsClient } from "../../../game/OsrsClient";
import { ActorAnimationClip } from "../../../game/actor/ActorAnimation";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    MAX_HITSPLAT_SLOTS,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../../../game/actor/ActorOverlayState";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../../../game/data/ground/GroundItemStore";
import { NpcEcs } from "../../../game/ecs/NpcEcs";
import type { PlayerAnimKey } from "../../../game/ecs/PlayerEcs";
import { GameState, LoginIndex } from "../../../game/login";
import { Ray, rayIntersectsBox } from "../../../game/math/Raycast";
import { isMouseInUIRegion as checkMouseInUIRegion } from "../../../game/menu/WorldMenuBuilder";
import {
    advanceAnimation,
    computeMovementOrientation,
    computeMovementStep,
    interpolateRotation,
    parseInteractionTarget,
} from "../../../game/movement/NpcClientTick";
import type { TileMarkersPluginConfig } from "../../../game/plugins/tilemarkers/types";
import { computeRoofPlaneLimit } from "../../../game/roof/RoofVisibility";
import { sampleBridgeHeightForWorldTile } from "../../../game/scene/BridgeHeightSampler";
import {
    BridgePlaneStrategy,
    resolveBridgePromotedPlane,
    resolveCollisionSamplePlaneForLocal,
    resolveCollisionSamplePlaneForWorldTile,
    resolveGroundItemStackPlane,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForLocal,
    resolveInteractionPlaneForWorldTile,
} from "../../../game/scene/PlaneResolver";
import { SceneRaycastHit, SceneRaycaster } from "../../../game/scene/SceneRaycaster";
import {
    TILE_FLAG_BRIDGE,
    getTileRenderFlagAt as lookupTileRenderFlagAt,
} from "../../../game/scene/TileRenderFlags";
import { LoadingRequirement } from "../../../game/state/LoadingTracker";
import type { PlayerSpotAnimationEvent } from "../../../game/sync/PlayerSyncTypes";
import { RAD_TO_RS_UNITS, computeFacingRotation } from "../../../game/utils/rotation";
import { AnimationFrames } from "../../AnimationFrames";
import { ChatheadFactory } from "../../ChatheadFactory";
import { type DrawBackend, createDrawBackend } from "../../DrawBackend";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../../DrawRange";
import { InteractType } from "../../InteractType";
import { profiler } from "../../PerformanceProfiler";
import { PlayerChatheadFactory } from "../../PlayerChatheadFactory";
import { resolveFogRange } from "../../RenderDistancePolicy";
import { WebGLMapSquare } from "../../WebGLMapSquare";
import { WorldEntityAnimator } from "../../WorldEntityAnimator";
import { SceneBuffer } from "../../buffer/SceneBuffer";
import { getModelFaces, isModelFaceTransparent } from "../../buffer/SceneBuffer";
import { GfxManager } from "../../gfx/GfxManager";
import { GfxRenderer } from "../../gfx/GfxRenderer";
import { buildGroundItemGeometry } from "../../ground/GroundItemMeshBuilder";
import { type MinimapIcon, SdMapData } from "../../loader/SdMapData";
import { SdMapDataLoader } from "../../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../../loader/SdMapLoaderInput";
import { isDoorLocType } from "../../loc/SceneLocs";
import {
    DynamicNpcAnimLoader,
    DynamicNpcFrameGeometry,
    DynamicNpcSequenceMeta,
} from "../../npc/DynamicNpcAnimLoader";
import { PlayerRenderer } from "../../player/PlayerRenderer";
import { ProjectileManager } from "../../projectiles/ProjectileManager";
import { ProjectileRenderer } from "../../projectiles/ProjectileRenderer";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
    createPlayerProgram,
    createProjectileProgram,
} from "../../shaders/Shaders";
import { KNOWN_WATER_TEXTURE_IDS } from "../../water/WaterTextureIds";
import type { WebGLOsrsRendererHost } from "../hostInterface";
import { RENDER_CONSTANTS } from "../constants";

export function render(host: WebGLOsrsRendererHost, time: number, deltaTime: number, resized: boolean): void {

        profiler.startFrame();

        // One-time initialization of overlay scales. onResize fires before host.app is
        // initialized (early-return guard at the top of onResize), so overlay scales may not
        // have been set yet. We set them here on the first render frame where host.app exists.
        if (!host._overlaysScaleInitialized && host.app) {
            const bufW = host.canvas.width;
            const bufH = host.canvas.height;
            if (bufW > 0 && bufH > 0) {
                const metrics = host.computeUiRenderMetrics(bufW, bufH);
                const overlayScale = metrics.renderScaleX;
                if (host.overheadTextOverlay) host.overheadTextOverlay.scale = overlayScale;
                if (host.hitsplatOverlay) host.hitsplatOverlay.scale = overlayScale;
                if (host.overheadPrayerOverlay) host.overheadPrayerOverlay.scale = overlayScale;
                if (host.healthBarOverlay) {
                    host.healthBarOverlay.scale =
                        overlayScale * RENDER_CONSTANTS.HEALTH_BAR_VISUAL_SCALE;
                }
                if (host.clickCrossOverlay) host.clickCrossOverlay.scale = overlayScale;
                if (host.groundItemOverlay) host.groundItemOverlay.scale = overlayScale;
                (host.canvas as any).__uiRenderScale = overlayScale;
                host._overlaysScaleInitialized = true;
            }
        }

        const onLoginScreen = host.osrsClient.isOnLoginScreen();
        const loggedIn = host.osrsClient.isLoggedIn();
        const loginLikeState = !loggedIn;
        // When transitioning from login→gameplay, re-sync overlay scales. The first-frame sync
        // runs during login state (renderScaleX≈1) but gameplay uses a different scale formula.
        // No onResize fires on this transition so we must re-compute here.
        if (host._lastLoginLikeState === true && !loginLikeState && host.app) {
            const bufW = host.canvas.width;
            const bufH = host.canvas.height;
            if (bufW > 0 && bufH > 0) {
                const metrics = host.computeUiRenderMetrics(bufW, bufH);
                const overlayScale = metrics.renderScaleX;
                if (host.overheadTextOverlay) host.overheadTextOverlay.scale = overlayScale;
                if (host.hitsplatOverlay) host.hitsplatOverlay.scale = overlayScale;
                if (host.overheadPrayerOverlay) host.overheadPrayerOverlay.scale = overlayScale;
                if (host.healthBarOverlay) {
                    host.healthBarOverlay.scale =
                        overlayScale * RENDER_CONSTANTS.HEALTH_BAR_VISUAL_SCALE;
                }
                if (host.clickCrossOverlay) host.clickCrossOverlay.scale = overlayScale;
                if (host.groundItemOverlay) host.groundItemOverlay.scale = overlayScale;
                (host.canvas as any).__uiRenderScale = overlayScale;
            }
        }
        host._lastLoginLikeState = loginLikeState;
        const desiredImageRendering = loginLikeState && isMobileMode ? "pixelated" : "";
        if (host.canvas.style.imageRendering !== desiredImageRendering) {
            host.canvas.style.imageRendering = desiredImageRendering;
        }

        // Reset frame accumulators
        host._frameIndices = 0;
        host._frameBatches = 0;
        const showDebugTimer = host.osrsClient.inputManager.isKeyDown("KeyY");
        const profileGpuTimer = profiler.enabled;

        if (showDebugTimer || profileGpuTimer) {
            host.timer.start();
        }

        const frameCount = host.stats.frameCount;

        const timeSec = time / 1000;

        // Use server tick index for cross-client alignment
        const serverTick = getCurrentTick() | 0;
        const ticksElapsed = Math.min(serverTick - host.lastTick, 1);
        if (ticksElapsed > 0) host.lastTick = serverTick;

        // Use client cycles (20ms each) for hitsplat timing
        const clientCycle = getClientCycle() | 0;

        // Use server-derived phase to anchor interpolation within the active client tick.
        // We map the server's millisecond offset onto the local tick cadence so that
        // render-time blending stays in sync without lagging one whole server cycle.
        let phaseFromServer = Number.NaN;
        try {
            const { phase, tickMs } = getServerTickPhaseNow();
            const tickLengthMs = Math.max(1, tickMs | 0);
            const clampedPhase = Math.max(0, Math.min(1, phase));
            const msIntoServerTick = clampedPhase * tickLengthMs;
            const clientTickMs = host.clientTickDurationMs;
            if (clientTickMs > 0) {
                const msIntoClientTick = msIntoServerTick % clientTickMs;
                phaseFromServer = msIntoClientTick / clientTickMs;
            }
        } catch {
            phaseFromServer = Number.NaN;
        }
        if (!Number.isFinite(phaseFromServer)) {
            const ticksF = timeSec / host.clientTickDurationSec;
            const clientTick = Math.floor(ticksF);
            phaseFromServer = ticksF - clientTick;
        }
        host.clientTickPhase = Math.max(0, Math.min(1, phaseFromServer));

        // Maintain local integration pace based on the authoritative client cycle (Client.cycle),
        // not wallclock-derived render time.
        const clientTick = clientCycle | 0;

        if (!host.hasClientTickBaseline) {
            host.lastClientTick = clientTick;
            host.hasClientTickBaseline = true;
            host.pendingClientTicks = 0;
        } else {
            const deltaTicks = clientTick - host.lastClientTick;
            if (deltaTicks < 0) {
                // Client cycle can reset on world hops/login; treat as a new baseline.
                host.lastClientTick = clientTick;
                host.pendingClientTicks = 0;
            } else if (deltaTicks > 0) {
                host.pendingClientTicks = Math.min(
                    RENDER_CONSTANTS.MAX_CLIENT_TICK_DEBT,
                    host.pendingClientTicks + deltaTicks,
                );
                host.lastClientTick = clientTick;
            }
        }

        let clientTicksElapsed = 0;
        if (host.pendingClientTicks > 0) {
            clientTicksElapsed = Math.min(RENDER_CONSTANTS.MAX_CLIENT_TICKS_PER_FRAME, host.pendingClientTicks);
            host.pendingClientTicks -= clientTicksElapsed;
        }

        // ========== Title/Login Rendering (before game resource checks) ==========
        // Non-game states only need title/login overlays, not world resources like textureArray.
        const inputManager = host.osrsClient.inputManager;
        host.syncMobileLoginInput(false);
        if (!loggedIn) {
            // Transfer click state for this frame ()
            inputManager.onFrameStart();
            const uiMetrics = host.computeUiRenderMetrics(host.app.width, host.app.height);
            host.osrsClient.loginRenderer.syncMobileViewportState(
                host.osrsClient.loginState,
                host.isMobileLoginKeyboardOpen(),
            );
            host.osrsClient.loginRenderer.updateLayout(
                uiMetrics.layoutW,
                uiMetrics.layoutH,
                host.app.width,
                host.app.height,
            );

            if (onLoginScreen) {
                // Keep login input mapping in sync with the current canvas dimensions before click handling.
                // Other non-game states (e.g. cache downloading/loading) still use the title overlay path
                // but must not drive login-form interaction.
                let char = inputManager.readChar();
                while (char !== -1) {
                    host.osrsClient.handleLoginKeyInput("", String.fromCharCode(char));
                    char = inputManager.readChar();
                }
                // Handle special keys from key events
                for (const keyEvent of inputManager.keyEvents) {
                    if (keyEvent.code === "Tab") {
                        host.osrsClient.handleLoginKeyInput("Tab", "");
                    } else if (keyEvent.code === "Enter" || keyEvent.code === "NumpadEnter") {
                        // Enter in login form = login button or field switch
                        const { loginState } = host.osrsClient;
                        if (loginState.canAttemptLogin()) {
                            // Update game state to CONNECTING (hides buttons)
                            loginState.savePersistedLoginState();
                            host.osrsClient.updateGameState(GameState.CONNECTING);
                            sendLogin(
                                loginState.username.trim(),
                                loginState.password,
                                host.osrsClient.loadedCache?.info?.revision ?? 0,
                            );
                        } else {
                            loginState.showCredentialValidationError();
                            host.osrsClient.handleLoginKeyInput("Enter", "");
                        }
                    } else if (keyEvent.code === "Backspace") {
                        host.osrsClient.handleLoginKeyInput("Backspace", "");
                    }
                }
                inputManager.keyEvents.length = 0; // Clear processed key events

                // Handle mouse clicks for login buttons
                if (
                    inputManager.clickMode3 !== 0 &&
                    inputManager.saveClickX !== -1 &&
                    inputManager.saveClickY !== -1
                ) {
                    const action = host.osrsClient.handleLoginMouseClick(
                        inputManager.saveClickX,
                        inputManager.saveClickY,
                        inputManager.clickMode3,
                    );
                    const shouldRefocusMobileLoginInput =
                        isMobileMode &&
                        host.osrsClient.loginState.loginIndex === LoginIndex.LOGIN_FORM &&
                        host.osrsClient.loginState.virtualKeyboardVisible &&
                        inputManager.isTouch;
                    if (shouldRefocusMobileLoginInput) {
                        host.syncMobileLoginInput(true);
                    } else {
                        host.syncMobileLoginInput(false);
                    }
                    if (action === "connect") {
                        // Send login message
                        const { loginState } = host.osrsClient;
                        loginState.savePersistedLoginState();
                        sendLogin(
                            loginState.username.trim(),
                            loginState.password,
                            host.osrsClient.loadedCache?.info?.revision ?? 0,
                        );
                    }
                    // Clear click mode to prevent further processing
                    inputManager.clickMode3 = 0;
                    inputManager.saveClickX = -1;
                    inputManager.saveClickY = -1;
                }

                // Tick login animation
                host.osrsClient.tickLogin();
            } else {
                inputManager.keyEvents.length = 0;
            }

            // Skip normal world rendering while not logged in.
            // But still flush packets. The widget overlay lives on a separate canvas,
            // so explicitly blank it here before we skip the normal post-present pass.
            host.widgetsOverlay?.clearAndHide();
            flushPackets();

            // Clear default framebuffer for login screen overlay
            host.app.defaultDrawFramebuffer();
            host.app.clearColor(0.0, 0.0, 0.0, 1.0);
            host.app.clear();

            // Draw login screen overlay only
            try {
                if (!host.uiHidden && host.loginOverlay) {
                    host.loginOverlay.setGameState(host.osrsClient.gameState);
                    host.loginOverlay.update({
                        time,
                        delta: deltaTime,
                        resolution: { width: host.app.width, height: host.app.height },
                        state: {
                            hoverEnabled: false,
                            playerLevel: 0,
                            clientTickPhase: 0,
                        },
                        helpers: host.getOverlayHelpers(),
                    });
                    host.loginOverlay.draw(RenderPhase.PostPresent);
                }
            } catch (e) {
                console.warn("[WebGLOsrsRenderer] Login screen render error:", e);
            }

            // Also draw loading message overlay during login screen (for testing visibility)
            // Note: LoadingMessageOverlay subscribes to state machine, so no need to setGameState()
            try {
                if (!host.uiHidden && host.loadingMessageOverlay) {
                    host.loadingMessageOverlay.update({
                        time,
                        delta: deltaTime,
                        resolution: { width: host.app.width, height: host.app.height },
                        state: {
                            hoverEnabled: false,
                            playerLevel: 0,
                            clientTickPhase: 0,
                        },
                        helpers: host.getOverlayHelpers(),
                    });
                    host.loadingMessageOverlay.draw(RenderPhase.PostPresent);
                }
            } catch (e) {
                console.warn("[WebGLOsrsRenderer] Loading message overlay error:", e);
            }

            profiler.endFrame(deltaTime);
            return; // Skip rest of render while not logged in
        }

        // ========== Game Resource Checks ==========
        host.syncSceneFramebufferSize();
        if (host.needsFramebufferUpdate) {
            host.initFramebuffer();
        }

        if (
            !host.mainProgram ||
            !host.mainAlphaProgram ||
            !host.npcProgram ||
            !host.sceneUniformBuffer ||
            !host.framebuffer ||
            !host.textureFramebuffer ||
            !host.frameDrawCall ||
            !host.textureArray ||
            !host.textureMaterials ||
            !host.waterTextures
        ) {
            return;
        }

        if (resized) {
            host.resolutionUni[0] = host.app.width;
            host.resolutionUni[1] = host.app.height;
        }

        const camera = host.osrsClient.camera;

        profiler.startPhase("input");
        host.handleInput(deltaTime);

        // Tick mouse cross animation (OSRS-style visual feedback)
        ClientState.tickMouseCross();

        // Flush any queued binary packets to the server (OSRS-style)
        flushPackets();
        profiler.endPhase();

        // Defer follow-camera and matrices until after tick updates to keep player centered
        if (host.cullBackFace) {
            host.app.enable(PicoGL.CULL_FACE);
        } else {
            host.app.disable(PicoGL.CULL_FACE);
        }

        const directTextureScenePass = host.shouldUseDirectTextureScenePass();
        const sceneFramebuffer = directTextureScenePass
            ? host.textureFramebuffer!
            : host.framebuffer!;

        host.app.enable(PicoGL.DEPTH_TEST);
        host.app.depthMask(true);

        host.app.drawFramebuffer(sceneFramebuffer);
        host.app.viewport(0, 0, host.sceneRenderWidth | 0, host.sceneRenderHeight | 0);

        profiler.startPhase("tick");
        // Dynamic path always uses current appearance; no NPC fallback rebuild
        // Always keep dynamic player animation enabled; do not switch to pre-baked clips.
        // This removes the prebake path entirely for players, even with multiple players present.
        host.tickPass(timeSec, ticksElapsed, clientTicksElapsed, clientCycle);
        profiler.endPhase();

        // Now update follow camera and matrices using up-to-date player position
        if (host.osrsClient.followPlayerCamera && host.osrsClient.playerEcs.size() > 0) {
            host.updateCameraFollow(deltaTime, timeSec);
        }
        camera.applySmoothing(deltaTime);
        let cameraShakeApplied = false;
        let restoreCameraX = 0;
        let restoreCameraY = 0;
        let restoreCameraZ = 0;
        let restoreCameraPitch = 0;
        let restoreCameraYaw = 0;
        // Ensure camera uses valid dimensions
        const camWidth = Math.max(1, host.app.width || host.canvas.width || 1);
        const camHeight = Math.max(1, host.app.height || host.canvas.height || 1);
        const sceneViewport = host.getSceneViewportWidgetRect();
        const sceneFramebufferViewport = host.scaleViewportRectToSceneBuffer(sceneViewport);
        camera.update(
            camWidth,
            camHeight,
            sceneViewport.x,
            sceneViewport.y,
            sceneViewport.width,
            sceneViewport.height,
        );
        host.clearSceneFramebuffer(sceneFramebufferViewport);
        // keep CS2-visible viewport zoom in sync with the viewport widget size
        // (Client.viewportZoom; i.e., Rasterizer3D.get3dZoom()) so scripts and widget models scale correctly.
        try {
            host.osrsClient.cs2Vm.context.viewportZoom = camera.computeViewportZoomForSize(
                sceneViewport.width,
                sceneViewport.height,
            );
        } catch {}

        // OSRS camera shake is applied as a temporary render perturbation, then restored.
        try {
            const shake = host.computeCameraShakeOffsets(clientCycle);
            if (shake.active) {
                restoreCameraX = camera.getPosX();
                restoreCameraY = camera.getPosY();
                restoreCameraZ = camera.getPosZ();
                restoreCameraPitch = camera.pitch | 0;
                restoreCameraYaw = camera.yaw | 0;

                let shakenPitch = restoreCameraPitch;
                if ((shake.pitch | 0) !== 0) {
                    let camAngleX = 128 + Math.floor((clamp(shakenPitch, 0, 512) * 255) / 512);
                    camAngleX = Math.max(128, Math.min(383, camAngleX + (shake.pitch | 0)));
                    shakenPitch = clamp(Math.floor(((camAngleX - 128) * 512) / 255), 0, 512);
                }
                const shakenYaw = (restoreCameraYaw + (shake.yaw | 0)) & 2047;

                camera.snapToPosition(
                    restoreCameraX + shake.x / 128,
                    restoreCameraY + shake.y / 128,
                    restoreCameraZ + shake.z / 128,
                );
                camera.snapToPitch(shakenPitch);
                camera.snapToYaw(shakenYaw);
                camera.update(
                    camWidth,
                    camHeight,
                    sceneViewport.x,
                    sceneViewport.y,
                    sceneViewport.width,
                    sceneViewport.height,
                );
                cameraShakeApplied = true;
            }
        } catch {}

        // Update hovered tile using latest camera matrices
        profiler.startPhase("hover");
        host.updateHoveredTile();
        profiler.endPhase();

        // Map manager streaming/visibility update.
        profiler.startPhase("mapMgr");
        host.mapManager.update(
            host.playerPosUni[0],
            host.playerPosUni[1],
            camera,
            frameCount,
            host.osrsClient.mapRadius,
            ClientState.baseX | 0,
            ClientState.baseY | 0,
            host.osrsClient.expandedMapLoading | 0,
        );
        host.syncStreamGenerationFromMapManager();
        const renderDistance = host.resolveEffectiveRenderDistanceTiles(frameCount | 0);
        profiler.endPhase();

        // Keep fog tied to configured render distance.
        // Edge-based fog clamping causes over-aggressive fog collapse near stream boundaries.
        const { fogEnd, fogDepth } = resolveFogRange({
            renderDistance,
            autoFogDepth: host.autoFogDepth,
            autoFogDepthFactor: host.autoFogDepthFactor,
            manualFogDepth: host.fogDepth,
        });

        // Update scene uniform buffer
        profiler.startPhase("sceneUbo");
        host.cameraPosUni[0] = camera.getPosX();
        host.cameraPosUni[1] = camera.getPosZ();
        host.sceneUniformBuffer
            .set(0, camera.viewProjMatrix as Float32Array)
            .set(1, camera.viewMatrix as Float32Array)
            .set(2, camera.projectionMatrix as Float32Array)
            .set(3, host.skyColor as Float32Array)
            .set(4, host.sceneHslOverride as Float32Array)
            .set(5, host.cameraPosUni as Float32Array)
            .set(6, host.playerPosUni as Float32Array)
            .set(7, fogEnd as any)
            .set(8, fogDepth as any)
            .set(9, timeSec as any)
            .set(10, host.brightness as any)
            .set(11, host.colorBanding as any)
            .set(12, host.osrsClient.isNewTextureAnim as any)
            .update();
        profiler.endPhase();

        // CPU-side interactions with latest camera
        profiler.startPhase("interact");
        const leftClickedNow = inputManager.leftClickX !== -1 && inputManager.leftClickY !== -1;
        const pickedNow = inputManager.pickX !== -1 && inputManager.pickY !== -1;
        const cycleChanged = (clientCycle | 0) !== (host.lastInteractionClientCycle | 0);
        const menuStateChanged = host.lastInteractionMenuOpen !== host.osrsClient.menuOpen;
        const shouldRunInteractionPass =
            host.osrsClient.tooltips ||
            leftClickedNow ||
            pickedNow ||
            cycleChanged ||
            menuStateChanged;
        if (!inputManager.isPointerLock() && shouldRunInteractionPass) {
            host.checkInteractions();
            host.lastInteractionClientCycle = clientCycle | 0;
            host.lastInteractionMenuOpen = !!host.osrsClient.menuOpen;
        } else {
            host.lastInteractionRaycastHitCount = 0;
            host.lastInteractionMenuOptionCount = 0;
        }
        profiler.endPhase();

        profiler.startPhase("actorData");
        const actorIndex = host.updateActorDataTexture();
        profiler.endPhase();

        // Update projectiles
        profiler.startPhase("projectiles");
        host.projectileManager?.update(deltaTime);
        host.gfxManager?.update();
        profiler.endPhase();

        const npcDataTextureIndex = actorIndex;
        const playerDataTextureIndex = actorIndex;
        const npcDataTexture = host.actorDataTextureBuffer[actorIndex];
        const playerDataTexture = npcDataTexture;

        profiler.startPhase("roof");
        host.roofPlaneLimit = host.computeFrameRoofPlaneLimit();
        profiler.endPhase();

        let opaqueIndices = 0;
        let opaqueBatches = 0;
        let opaqueActorIndices = 0;
        let opaqueActorBatches = 0;
        let transparentIndices = 0;
        let transparentBatches = 0;
        let transparentNpcIndices = 0;
        let transparentNpcBatches = 0;
        let transparentPlayerIndices = 0;
        let transparentPlayerBatches = 0;
        host.frameRoofFilteredRangeCount = 0;
        host.frameRoofTotalRangeCount = 0;

        let passStartIndices = host._frameIndices;
        let passStartBatches = host._frameBatches;
        host.app.disable(PicoGL.BLEND);
        profiler.startPhase("opaque");
        passStartIndices = host._frameIndices;
        passStartBatches = host._frameBatches;
        host.renderOpaquePass();
        opaqueIndices = Math.max(0, host._frameIndices - passStartIndices);
        opaqueBatches = Math.max(0, host._frameBatches - passStartBatches);
        profiler.endPhase();
        profiler.startPhase("opaqueActor");
        passStartIndices = host._frameIndices;
        passStartBatches = host._frameBatches;
        host.renderOpaqueActorPass(playerDataTextureIndex, playerDataTexture);
        opaqueActorIndices = Math.max(0, host._frameIndices - passStartIndices);
        opaqueActorBatches = Math.max(0, host._frameBatches - passStartBatches);
        profiler.endPhase();

        host.app.enable(PicoGL.BLEND);
        profiler.startPhase("transparent");
        passStartIndices = host._frameIndices;
        passStartBatches = host._frameBatches;
        host.renderTransparentPass();
        transparentIndices = Math.max(0, host._frameIndices - passStartIndices);
        transparentBatches = Math.max(0, host._frameBatches - passStartBatches);
        profiler.endPhase();
        profiler.startPhase("transpNpc");
        passStartIndices = host._frameIndices;
        passStartBatches = host._frameBatches;
        host.renderTransparentNpcPass(npcDataTextureIndex, npcDataTexture);
        transparentNpcIndices = Math.max(0, host._frameIndices - passStartIndices);
        transparentNpcBatches = Math.max(0, host._frameBatches - passStartBatches);
        profiler.endPhase();
        profiler.startPhase("transpPlayer");
        passStartIndices = host._frameIndices;
        passStartBatches = host._frameBatches;
        host.renderTransparentPlayerPass(playerDataTextureIndex, playerDataTexture);
        transparentPlayerIndices = Math.max(0, host._frameIndices - passStartIndices);
        transparentPlayerBatches = Math.max(0, host._frameBatches - passStartBatches);
        profiler.endPhase();

        try {
            host.drawSceneTileOverlays(time, deltaTime);
        } catch {}

        // Can't sample from the scene renderbuffer, so only blit when the scene pass
        // didn't already render directly into the texture framebuffer.
        profiler.startPhase("blit");
        if (!directTextureScenePass) {
            host.app.readFramebuffer(host.framebuffer);
            host.app.drawFramebuffer(host.textureFramebuffer);
            host.gl.readBuffer(PicoGL.COLOR_ATTACHMENT0);
            host.app.blitFramebuffer(PicoGL.COLOR_BUFFER_BIT, {
                srcStartX: 0,
                srcStartY: 0,
                srcEndX: host.sceneRenderWidth | 0,
                srcEndY: host.sceneRenderHeight | 0,
                dstStartX: 0,
                dstStartY: 0,
                dstEndX: host.app.width | 0,
                dstEndY: host.app.height | 0,
                filter: PicoGL.LINEAR,
            });
        }
        host.app.viewport(0, 0, host.app.width | 0, host.app.height | 0);
        profiler.endPhase();

        // Restore baseline camera before actor2d-style overlays (OSRS drawEntities restore semantics).
        if (cameraShakeApplied) {
            camera.snapToPosition(restoreCameraX, restoreCameraY, restoreCameraZ);
            camera.snapToPitch(restoreCameraPitch);
            camera.snapToYaw(restoreCameraYaw);
            camera.update(
                camWidth,
                camHeight,
                sceneViewport.x,
                sceneViewport.y,
                sceneViewport.width,
                sceneViewport.height,
            );
        }

        // Update overlays and draw pre-present overlays (e.g., hitsplats) into frame texture.
        profiler.startPhase("overlayFrame");
        try {
            host.resetHealthBarOutput();
            host.resetHitsplatOutput();
            host.resetOverheadTextOutput();
            host.resetOverheadPrayerOutput();
            let playerWorldX: number | undefined = undefined;
            let playerWorldZ: number | undefined = undefined;
            let playerLevel = resolveGroundItemStackPlane(host.getPlayerRawPlane() | 0);
            let playerRawLevel = host.getPlayerRawPlane() | 0;
            let playerAnchorIdx = 0;
            const playerFrameCount = host.playerRenderer.getFrameCount();
            const playerFrameHeights = host.playerRenderer.getFrameHeights();
            const playerDefaultHeightTiles = host.playerRenderer.getDefaultHeightTiles();
            const hitsplats = host.hitsplatOutput;
            const healthBars = host.healthBarOutput;
            const overheadTexts = host.overheadTextOutput;
            const overheadPrayers = host.overheadPrayerOutput;
            const hitsplatMaxEntries = host.getFrameHitsplatMaxEntries();
            const healthBarMaxEntries = host.getFrameHealthBarMaxEntries();
            const overheadTextMaxEntries = host.getFrameOverheadTextMaxEntries();
            const overheadPrayerMaxEntries = host.getFrameOverheadPrayerMaxEntries();
            const groundOverlayMaxEntries = host.getFrameGroundItemOverlayMaxEntries();
            const groundOverlayRadius = host.getFrameGroundItemOverlayRadius();
            let groundOverlayEntries: GroundItemOverlayEntry[] | undefined;

            try {
                const peHs = host.osrsClient.playerEcs;
                const nHs = peHs.size?.() ?? (peHs as any).size?.() ?? 0;
                if (nHs > 0) {
                    const controlledId = host.osrsClient.controlledPlayerServerId | 0;
                    const controlledIdx = peHs.getIndexForServerId(controlledId);
                    playerAnchorIdx = controlledIdx !== undefined ? controlledIdx : 0;
                    if (host.shouldRenderPlayerIndex(playerAnchorIdx)) {
                        const px = peHs.getX(playerAnchorIdx) | 0;
                        const py = peHs.getY(playerAnchorIdx) | 0;
                        playerWorldX = px / 128.0;
                        playerWorldZ = py / 128.0;
                        playerLevel = peHs.getLevel(playerAnchorIdx) | 0;
                        playerRawLevel = playerLevel;
                    }
                }
            } catch {}

            if (
                playerWorldX != null &&
                playerWorldZ != null &&
                hitsplats.length < hitsplatMaxEntries
            ) {
                const localPlayerHeightFallback =
                    host.osrsClient.playerEcs.getDefaultHeightTiles?.(playerAnchorIdx) ??
                    playerDefaultHeightTiles ??
                    host.playerDefaultHeightTiles ??
                    200 / 128;
                const hitsplatOffset = host.resolvePlayerHitsplatOffset(
                    playerAnchorIdx,
                    localPlayerHeightFallback,
                );
                const healthBarOffset =
                    host.resolvePlayerLogicalHeightTiles(
                        playerAnchorIdx,
                        localPlayerHeightFallback,
                    ) +
                    15 / 128;
                const playerServerId = host.getEffectiveControlledPlayerId();
                const state =
                    playerServerId > 0 ? host.playerHitsplats.get(playerServerId) : undefined;
                if (state) {
                    for (let slot = 0; slot < 4 && hitsplats.length < hitsplatMaxEntries; slot++) {
                        // Use client cycles and calculate visibility from end cycle
                        const animProgress = host.getHitsplatVisibility(state, slot, clientCycle);
                        if (animProgress === undefined) continue;
                        const entry = host.acquireHitsplatEntry();
                        entry.worldX = playerWorldX;
                        entry.worldZ = playerWorldZ;
                        entry.plane = playerLevel;
                        entry.footprintRadius = RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS;
                        entry.heightOffsetTiles = hitsplatOffset;
                        entry.damage = state.hitSplatValues[slot] | 0;
                        entry.count = 1;
                        entry.color = undefined;
                        entry.scale = RENDER_CONSTANTS.HITSPLAT_PLAYER_SCALE;
                        entry.variant = slot & 3;
                        entry.style = state.hitSplatTypes[slot] | 0;
                        entry.type2 = state.hitSplatTypes2[slot] | 0;
                        entry.damage2 = state.hitSplatValues2[slot] | 0;
                        entry.animProgress = animProgress;
                        hitsplats.push(entry);
                    }
                }
                if (playerServerId > 0) {
                    host.appendActorHealthBars(
                        host.playerHealthBars,
                        playerServerId,
                        "player",
                        playerWorldX,
                        playerWorldZ,
                        playerLevel,
                        RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS,
                        healthBarOffset,
                        healthBars,
                        clientCycle,
                        healthBarMaxEntries,
                    );
                }
            }

            // Other players' overhead text first; the local player's is appended after
            // NPC text so it settles last in the overlap pass and draws on top.
            const localPlayerTextIdx = host.getControlledPlayerEcsIndex();
            try {
                const pe = host.osrsClient.playerEcs;
                const count = pe.size?.() ?? (pe as any).size?.() ?? 0;
                for (let i = 0; i < count; i++) {
                    if (i === localPlayerTextIdx) continue;
                    host.appendPlayerOverheadText(
                        i,
                        overheadTexts,
                        overheadTextMaxEntries,
                        playerDefaultHeightTiles,
                    );
                }
            } catch {}

            // NPC overhead text (forced chat / say)
            try {
                const ne = host.osrsClient.npcEcs;
                ne.forEachActive((ecsId: number) => {
                    const chatState = ne.getOverheadText(ecsId);
                    if (!chatState) return;
                    if (overheadTexts.length >= overheadTextMaxEntries) return;
                    const text = chatState.text;
                    if (!text || text.length === 0) return;
                    const localX = ne.getX(ecsId) | 0;
                    const localY = ne.getY(ecsId) | 0;
                    const mid = (ne as any).mapId?.[ecsId] ?? 0;
                    const mapX = (mid >> 8) & 0xff;
                    const mapY = mid & 0xff;
                    const worldX = mapX * 64 + localX / 128.0;
                    const worldZ = mapY * 64 + localY / 128.0;
                    const plane = ne.getLevel(ecsId) | 0;
                    const overhead = host.acquireOverheadTextEntry();
                    overhead.worldX = worldX;
                    overhead.worldZ = worldZ;
                    overhead.plane = plane;
                    overhead.text = text;
                    overhead.color = host.mapOverheadColor(0);
                    overhead.colorId = 0;
                    overhead.effect = 0;
                    overhead.modIcon = undefined;
                    overhead.pattern = undefined;
                    const duration = 100;
                    const remaining = Math.max(0, Math.min(duration, chatState.remaining));
                    overhead.duration = duration;
                    overhead.remaining = remaining;
                    overhead.life = host.computeOverheadAlpha(overhead);
                    const npcTypeId = ne.getNpcTypeId(ecsId) | 0;
                    const npcHeight = npcTypeId > 0 ? host.getNpcDefaultHeight(npcTypeId) : 200;
                    overhead.footprintRadius = host.getNpcFootprintRadius(npcTypeId);
                    overhead.groupKey = host.makeActorGroupKey(true, ne.getServerId(ecsId) | 0);
                    overhead.heightOffsetTiles = npcHeight / 128.0;
                    overheadTexts.push(overhead);
                });
            } catch {}

            // Local player's overhead text settles last in the overlap pass.
            try {
                if (localPlayerTextIdx !== undefined) {
                    host.appendPlayerOverheadText(
                        localPlayerTextIdx,
                        overheadTexts,
                        overheadTextMaxEntries,
                        playerDefaultHeightTiles,
                    );
                }
            } catch {}

            // Render overhead prayer icons for all players
            try {
                const pe = host.osrsClient.playerEcs;
                const count = pe.size?.() ?? (pe as any).size?.() ?? 0;
                if (count > 0) {
                    for (let i = 0; i < count; i++) {
                        if (overheadPrayers.length >= overheadPrayerMaxEntries) break;
                        if (!host.shouldRenderPlayerIndex(i)) continue;
                        const headIconPrayer = pe.getHeadIconPrayer(i);
                        if (headIconPrayer < 0) continue;

                        const px = pe.getX(i) | 0;
                        const py = pe.getY(i) | 0;
                        const worldX = px / 128.0;
                        const worldZ = py / 128.0;
                        const plane = pe.getLevel(i) | 0;

                        const entry = host.acquireOverheadPrayerEntry();
                        entry.worldX = worldX;
                        entry.worldZ = worldZ;
                        entry.plane = plane;
                        entry.footprintRadius = RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS;
                        entry.groupKey = host.makeActorGroupKey(
                            false,
                            pe.getServerIdForIndex?.(i) ?? 0,
                        );
                        entry.headIconPrayer = headIconPrayer;
                        // Position above the player head, above any health bars/hitsplats
                        entry.heightOffsetTiles = host.resolvePlayerHeadIconOffset(
                            i,
                            playerDefaultHeightTiles,
                        );
                        overheadPrayers.push(entry);
                    }
                }
            } catch {}

            // Render hitsplats for other players
            try {
                const pe = host.osrsClient.playerEcs;
                const count = pe.size?.() ?? (pe as any).size?.() ?? 0;
                if (count > 0 && host.playerHitsplats.size > 0) {
                    const controlledId = host.getEffectiveControlledPlayerId();
                    for (let i = 0; i < count; i++) {
                        if (
                            hitsplats.length >= hitsplatMaxEntries &&
                            healthBars.length >= healthBarMaxEntries
                        ) {
                            break;
                        }
                        if (!host.shouldRenderPlayerIndex(i)) continue;

                        // Get server ID for this player
                        const serverId = pe.getServerIdForIndex?.(i);
                        if (!serverId || serverId === controlledId) continue; // Skip controlled player (already rendered above)

                        // Check if this player has hitsplats
                        const state = host.playerHitsplats.get(serverId);
                        if (!state) continue;

                        const px = pe.getX(i) | 0;
                        const py = pe.getY(i) | 0;
                        const worldX = px / 128.0;
                        const worldZ = py / 128.0;
                        const plane = pe.getLevel(i) | 0;

                        const playerHeightFallback = pe.getDefaultHeightTiles?.(i) ?? 200 / 128;
                        const hitsplatOffset = host.resolvePlayerHitsplatOffset(
                            i,
                            playerHeightFallback,
                        );
                        const healthBarOffset =
                            host.resolvePlayerLogicalHeightTiles(i, playerHeightFallback) +
                            15 / 128;

                        for (
                            let slot = 0;
                            slot < 4 && hitsplats.length < hitsplatMaxEntries;
                            slot++
                        ) {
                            // Use client cycles and calculate visibility from end cycle
                            const animProgress = host.getHitsplatVisibility(
                                state,
                                slot,
                                clientCycle,
                            );
                            if (animProgress === undefined) continue;
                            const entry = host.acquireHitsplatEntry();
                            entry.worldX = worldX;
                            entry.worldZ = worldZ;
                            entry.plane = plane;
                            entry.footprintRadius = RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS;
                            entry.heightOffsetTiles = hitsplatOffset;
                            entry.damage = state.hitSplatValues[slot] | 0;
                            entry.count = 1;
                            entry.color = undefined;
                            entry.scale = RENDER_CONSTANTS.HITSPLAT_PLAYER_SCALE;
                            entry.variant = slot & 3;
                            entry.style = state.hitSplatTypes[slot] | 0;
                            entry.type2 = state.hitSplatTypes2[slot] | 0;
                            entry.damage2 = state.hitSplatValues2[slot] | 0;
                            entry.animProgress = animProgress;
                            hitsplats.push(entry);
                        }

                        // Add health bar for this player
                        if (serverId > 0 && healthBars.length < healthBarMaxEntries) {
                            host.appendActorHealthBars(
                                host.playerHealthBars,
                                serverId,
                                "player",
                                worldX,
                                worldZ,
                                plane,
                                RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS,
                                healthBarOffset,
                                healthBars,
                                clientCycle,
                                healthBarMaxEntries,
                            );
                        }
                    }
                }
            } catch {}

            try {
                if (host.objectIdOverlay) {
                    host.objectIdOverlay.radius = Math.max(
                        1,
                        (host.osrsClient.renderDistance / 8) | 0,
                    );
                    host.objectIdOverlay.enabled = !!host.osrsClient.showObjectTileIds;
                }
                if (host.walkableOverlay) {
                    host.walkableOverlay.radius = Math.max(
                        1,
                        host.osrsClient.collisionOverlayRadius | 0 || 12,
                    );
                    host.walkableOverlay.enabled = !!host.osrsClient.showCollisionOverlay;
                }
            } catch {}

            const seen = host.hitsplatSeenNpc;
            seen.clear();
            const shouldProcessNpcOverlays =
                !!host.overlayManager &&
                (host.npcHitsplats.size > 0 || host.npcHealthBars.size > 0);
            if (shouldProcessNpcOverlays) {
                try {
                    const npcEcs = host.osrsClient.npcEcs;
                    for (let i = 0; i < host.mapManager.visibleMapCount; i++) {
                        if (
                            hitsplats.length >= hitsplatMaxEntries &&
                            healthBars.length >= healthBarMaxEntries
                        ) {
                            break;
                        }
                        const map = host.mapManager.visibleMaps[i];
                        if (!map?.npcEntityIds || map.npcEntityIds.length === 0) continue;
                        for (let j = 0; j < map.npcEntityIds.length; j++) {
                            if (
                                hitsplats.length >= hitsplatMaxEntries &&
                                healthBars.length >= healthBarMaxEntries
                            ) {
                                break;
                            }
                            const ecsId = map.npcEntityIds[j] | 0;
                            if (ecsId <= 0 || seen.has(ecsId)) continue;
                            if (!host.shouldRenderNpcFromMap(map, ecsId)) continue;
                            if (!npcEcs.isActive(ecsId)) continue;
                            seen.add(ecsId);
                            const localX = npcEcs.getX(ecsId) | 0;
                            const localY = npcEcs.getY(ecsId) | 0;
                            const serverId = npcEcs.getServerId(ecsId) | 0;
                            if (serverId <= 0) continue;
                            const state = host.npcHitsplats.get(serverId);
                            const hb = host.npcHealthBars.get(serverId);
                            const hasHealth = !!hb && hb.bars.length > 0;
                            if (!hasHealth && !state) continue;
                            const npcMapId = npcEcs.getMapId(ecsId) | 0;
                            const npcMapX = (npcMapId >> 8) & 0xff;
                            const npcMapY = npcMapId & 0xff;
                            const baseWorldX = npcMapX * 64 + localX / 128.0;
                            const baseWorldZ = npcMapY * 64 + localY / 128.0;
                            // Raw plane: overlay anchor heights apply bridge promotion
                            // per sample, mirroring the model placement plane.
                            const plane = npcEcs.getLevel(ecsId) | 0;
                            const npcTypeId = npcEcs.getNpcTypeId?.(ecsId);
                            const footprintRadius = host.getNpcFootprintRadius(npcTypeId);
                            const overlayAnchor = host.resolveNpcOverlayAnchor(
                                ecsId,
                                baseWorldX,
                                baseWorldZ,
                                npcTypeId,
                            );
                            const worldX = overlayAnchor.worldX;
                            const worldZ = overlayAnchor.worldZ;
                            const hitsplatOffset = overlayAnchor.logicalHeightTiles * 0.5;
                            const healthBarOffset = overlayAnchor.logicalHeightTiles + 15 / 128;
                            if (hasHealth && healthBars.length < healthBarMaxEntries) {
                                host.appendActorHealthBars(
                                    host.npcHealthBars,
                                    serverId,
                                    "npc",
                                    worldX,
                                    worldZ,
                                    plane,
                                    footprintRadius,
                                    healthBarOffset,
                                    healthBars,
                                    clientCycle,
                                    healthBarMaxEntries,
                                );
                            }
                            if (!state) continue;
                            for (
                                let slot = 0;
                                slot < 4 && hitsplats.length < hitsplatMaxEntries;
                                slot++
                            ) {
                                // Use client cycles and calculate visibility from end cycle
                                const animProgress = host.getHitsplatVisibility(
                                    state,
                                    slot,
                                    clientCycle,
                                );
                                if (animProgress === undefined) continue;
                                const entry = host.acquireHitsplatEntry();
                                entry.worldX = worldX;
                                entry.worldZ = worldZ;
                                entry.plane = plane;
                                entry.footprintRadius = footprintRadius;
                                entry.heightOffsetTiles = hitsplatOffset;
                                entry.damage = state.hitSplatValues[slot] | 0;
                                entry.count = 1;
                                entry.color = undefined;
                                entry.scale = RENDER_CONSTANTS.HITSPLAT_NPC_SCALE;
                                entry.variant = slot & 3;
                                entry.style = state.hitSplatTypes[slot] | 0;
                                entry.type2 = state.hitSplatTypes2[slot] | 0;
                                entry.damage2 = state.hitSplatValues2[slot] | 0;
                                entry.animProgress = animProgress;
                                hitsplats.push(entry);
                            }
                        }
                    }
                } catch {}
            }

            // Spot animations were previously collected from SpotAnimationManager; no-op now.

            if (playerWorldX != null && playerWorldZ != null) {
                const overlayEntries = host.withGroundItemOverlayHeights(
                    host.osrsClient.getGroundItemOverlayEntries(
                        Math.floor(playerWorldX),
                        Math.floor(playerWorldZ),
                        playerLevel,
                        { radius: groundOverlayRadius, maxEntries: groundOverlayMaxEntries },
                    ),
                );
                if (overlayEntries.length > 0) {
                    groundOverlayEntries = overlayEntries;
                } else {
                    try {
                        const camX = Math.floor(host.osrsClient.camera.getPosX());
                        const camY = Math.floor(host.osrsClient.camera.getPosZ());
                        const camLevel = resolveGroundItemStackPlane(host.getPlayerRawPlane() | 0);
                        const camEntries = host.withGroundItemOverlayHeights(
                            host.osrsClient.getGroundItemOverlayEntries(camX, camY, camLevel, {
                                radius: groundOverlayRadius,
                                maxEntries: groundOverlayMaxEntries,
                            }),
                        );
                        if (camEntries.length > 0) {
                            groundOverlayEntries = camEntries;
                        }
                    } catch {}
                }
            } else {
                try {
                    const peHs = host.osrsClient.playerEcs;
                    const idx = peHs.getIndexForServerId(host.osrsClient.controlledPlayerServerId);
                    if (idx !== undefined) {
                        const fallbackX = (peHs.getX(idx) / 128.0) | 0;
                        const fallbackY = (peHs.getY(idx) / 128.0) | 0;
                        const fallbackLevel = peHs.getLevel(idx) | 0;
                        const overlayEntries = host.withGroundItemOverlayHeights(
                            host.osrsClient.getGroundItemOverlayEntries(
                                fallbackX,
                                fallbackY,
                                fallbackLevel,
                                {
                                    radius: groundOverlayRadius,
                                    maxEntries: groundOverlayMaxEntries,
                                },
                            ),
                        );
                        if (overlayEntries.length > 0) {
                            groundOverlayEntries = overlayEntries;
                        }
                    }
                } catch {}
            }

            // Update login overlay game state
            if (host.loginOverlay) {
                host.loginOverlay.setGameState(host.osrsClient.gameState);
            }

            // Note: LoadingMessageOverlay subscribes to state machine directly,
            // so no need to manually call setGameState() here

            if (!host.uiHidden) {
                // Reset the per-actor 2D element offsets before this frame's draws.
                host.actor2dStacks.clear();
                host.overlayManager?.update({
                    time,
                    delta: deltaTime,
                    resolution: { width: host.app.width, height: host.app.height },
                    state: {
                        hoverEnabled: !!host.osrsClient.hoverOverlayEnabled,
                        hoverTile: undefined,
                        playerLevel,
                        playerRawLevel,
                        destTile: undefined,
                        clientTickPhase: host.clientTickPhase,
                        playerFrameCount,
                        playerFreezeFrame: host.playerFreezeFrame,
                        playerFixedFrame: host.playerFixedFrame,
                        playerFrameHeightTiles: playerFrameHeights,
                        playerDefaultHeightTiles,
                        playerWorldX,
                        playerWorldZ,
                        hitsplats,
                        healthBars: healthBars.length > 0 ? healthBars : undefined,
                        overheadTexts: overheadTexts.length > 0 ? overheadTexts : undefined,
                        overheadPrayers: overheadPrayers.length > 0 ? overheadPrayers : undefined,
                        groundItems: groundOverlayEntries,
                        gameCycle: clientCycle | 0,
                        actor2dStacks: host.actor2dStacks,
                        // spotAnimations removed
                    },
                    helpers: host.getOverlayHelpers(),
                });
                host.overlayManager?.draw(RenderPhase.ToFrameTexture);
            }
        } catch {}
        profiler.endPhase();

        host.app.disable(PicoGL.DEPTH_TEST);
        host.app.depthMask(false);

        host.app.disable(PicoGL.BLEND);

        profiler.startPhase("present");
        host.app.clearMask(PicoGL.COLOR_BUFFER_BIT | PicoGL.DEPTH_BUFFER_BIT);
        host.app.clearColor(host.skyColor[0], host.skyColor[1], host.skyColor[2], host.skyColor[3]);
        host.app.defaultDrawFramebuffer().clear();

        if (host.frameFxaaDrawCall && host.fxaaEnabled) {
            host.frameFxaaDrawCall.uniform("u_resolution", host.resolutionUni);
            host.frameFxaaDrawCall.texture("u_frame", host.textureFramebuffer.colorAttachments[0]);
            host.frameFxaaDrawCall.draw();
        } else {
            host.frameDrawCall.texture("u_frame", host.textureFramebuffer.colorAttachments[0]);
            host.frameDrawCall.draw();
        }
        profiler.endPhase();

        // Update and draw overlays (post-present).
        profiler.startPhase("overlayPost");
        try {
            const playerLevel = host.getPlayerBasePlane() | 0;
            const playerRawLevel = host.getPlayerRawPlane() | 0;
            const tileMarkersConfig = host.osrsClient.tileMarkersPlugin.getConfig();
            // Compute player world position for post-present overlays
            // Use current position (no interpolation) to match player model rendering
            let postPlayerWorldX: number | undefined = undefined;
            let postPlayerWorldZ: number | undefined = undefined;
            try {
                const idx = host.getControlledPlayerEcsIndex();
                if (idx !== undefined) {
                    const px = host.osrsClient.playerEcs.getX(idx) | 0;
                    const py = host.osrsClient.playerEcs.getY(idx) | 0;
                    postPlayerWorldX = px / 128.0;
                    postPlayerWorldZ = py / 128.0;
                }
            } catch {}
            // Keep devoverlay state synced
            try {
                if (host.objectIdOverlay) {
                    host.objectIdOverlay.radius = Math.max(
                        1,
                        (host.osrsClient.renderDistance / 8) | 0,
                    );
                    host.objectIdOverlay.enabled = !!host.osrsClient.showObjectTileIds;
                }
                if (host.walkableOverlay) {
                    host.walkableOverlay.radius = Math.max(
                        1,
                        host.osrsClient.collisionOverlayRadius | 0 || 12,
                    );
                    host.walkableOverlay.enabled = !!host.osrsClient.showCollisionOverlay;
                }
                host.syncTileMarkerOverlayConfig(tileMarkersConfig);
            } catch {}
            const args = host.ensureOverlayUpdateArgs(false);
            args.time = time;
            args.delta = deltaTime;
            args.resolution.width = host.app.width;
            args.resolution.height = host.app.height;
            host.populateTileMarkerOverlayState(
                args.state,
                tileMarkersConfig,
                playerLevel,
                playerRawLevel,
            );
            args.state.clientTickPhase = host.clientTickPhase;
            args.state.playerWorldX = postPlayerWorldX;
            args.state.playerWorldZ = postPlayerWorldZ;
            // Dev overlay: show non-interpolated server tiles for all actors (NPCs + Players)
            if (args.state.hoverEnabled) {
                // PERF: Reuse cached array instead of creating new one each frame
                const actorServerTiles = host.cachedActorServerTiles;
                host.cachedActorServerTilesCount = 0;

                // Players
                try {
                    const pe = host.osrsClient.playerEcs;
                    const n = pe.size() | 0;
                    const ms = host.osrsClient.playerMovementSync;
                    for (let i = 0; i < n; i++) {
                        const serverId = pe.getServerIdForIndex(i);
                        if (serverId === undefined || (serverId | 0) <= 0) continue;
                        const st = ms.getState(serverId | 0);
                        if (!st) continue;
                        // PERF: Reuse existing entry or create new one
                        const idx = host.cachedActorServerTilesCount++;
                        let entry = actorServerTiles[idx];
                        if (!entry) {
                            entry = {
                                x: 0,
                                y: 0,
                                plane: 0,
                                kind: "player",
                                serverId: 0,
                                label: "",
                            };
                            actorServerTiles[idx] = entry;
                        }
                        entry.x = st.tileX | 0;
                        entry.y = st.tileY | 0;
                        entry.plane = st.level | 0;
                        entry.kind = "player";
                        entry.serverId = serverId | 0;
                        entry.label = "";
                    }
                } catch {}

                // NPCs (visible maps only, like other devoverlays)
                try {
                    const npcEcs = host.osrsClient.npcEcs;
                    const seen = host.actorServerTilesSeenNpc;
                    seen.clear();
                    for (let i = 0; i < host.mapManager.visibleMapCount; i++) {
                        const map = host.mapManager.visibleMaps[i];
                        if (!map?.npcEntityIds || map.npcEntityIds.length === 0) continue;
                        for (let j = 0; j < map.npcEntityIds.length; j++) {
                            const ecsId = map.npcEntityIds[j] | 0;
                            if (ecsId <= 0) continue;
                            if (!npcEcs.isActive(ecsId)) continue;
                            const serverId = npcEcs.getServerId(ecsId) | 0;
                            if (serverId <= 0) continue;
                            if (seen.has(serverId)) continue;
                            seen.add(serverId);
                            const st = npcEcs.getServerState(ecsId);
                            if (!st) continue;
                            let label = "";
                            try {
                                const tid = npcEcs.getNpcTypeId?.(ecsId) | 0;
                                if (tid > 0 && host.osrsClient.npcTypeLoader) {
                                    const base = host.osrsClient.npcTypeLoader.load(tid);
                                    let resolved = base;
                                    try {
                                        resolved =
                                            base.transform(
                                                host.osrsClient.varManager,
                                                host.osrsClient.npcTypeLoader,
                                            ) ?? base;
                                    } catch {}
                                    const resolvedId = resolved?.id | 0;
                                    const cached = host.npcNameCache.get(resolvedId);
                                    if (cached !== undefined) {
                                        label = cached;
                                    } else {
                                        const name =
                                            typeof resolved?.name === "string" &&
                                            resolved.name.length > 0 &&
                                            resolved.name !== "null"
                                                ? resolved.name
                                                : "";
                                        host.npcNameCache.set(resolvedId, name);
                                        label = name;
                                    }
                                }
                            } catch {}
                            // PERF: Reuse existing entry or create new one
                            const idx = host.cachedActorServerTilesCount++;
                            let entry = actorServerTiles[idx];
                            if (!entry) {
                                entry = {
                                    x: 0,
                                    y: 0,
                                    plane: 0,
                                    kind: "npc",
                                    serverId: 0,
                                    label: "",
                                };
                                actorServerTiles[idx] = entry;
                            }
                            entry.x = st.tileX | 0;
                            entry.y = st.tileY | 0;
                            entry.plane = st.plane | 0;
                            entry.kind = "npc";
                            entry.serverId = serverId;
                            entry.label = label;
                        }
                    }
                } catch {}

                // If multiple NPCs share the same name, append server id so each label is trackable.
                try {
                    // PERF: Reuse cached Map instead of creating new one each frame
                    const nameCounts = host.actorServerTilesNameCounts;
                    nameCounts.clear();
                    const count = host.cachedActorServerTilesCount;
                    for (let i = 0; i < count; i++) {
                        const e = actorServerTiles[i];
                        if (e.kind !== "npc") continue;
                        const name = e.label;
                        if (!name || name.length === 0) continue;
                        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
                    }
                    for (let i = 0; i < count; i++) {
                        const e = actorServerTiles[i];
                        if (e.kind !== "npc") continue;
                        const name = e.label;
                        if (!name || name.length === 0) continue;
                        if ((nameCounts.get(name) ?? 0) > 1) {
                            e.label = `${name} (${e.serverId | 0})`;
                        }
                    }
                } catch {}

                // PERF: Set array length directly instead of .slice() to avoid allocation
                const activeCount = host.cachedActorServerTilesCount;
                if (activeCount > 0) {
                    // Truncate array length to active count (reused entries beyond this are ignored)
                    actorServerTiles.length = activeCount;
                    args.state.actorServerTiles = actorServerTiles;
                } else {
                    args.state.actorServerTiles = undefined;
                }
            } else {
                args.state.actorServerTiles = undefined;
            }
            if (!host.uiHidden) {
                host.overlayManager?.update(args);
                host.overlayManager?.draw(RenderPhase.PostPresent);
            }
        } catch {}
        profiler.endPhase();

        host.ensureWorldEntityOverlaysLoaded(time);

        let mapApplyCount = 0;
        // Load new map squares
        profiler.startPhase("mapApply");
        mapApplyCount += host.applyReadyStreamGenerationBatch(timeSec);
        const mapData = host.mapsToLoad.shift();
        if (mapData) {
            const firstMapId = getMapSquareId(mapData.mapX, mapData.mapY);
            const firstBatchId = host.queuedLocReloadBatchByMap.get(firstMapId);
            const toApply: SdMapData[] = [mapData];
            if (typeof firstBatchId === "number") {
                host.queuedLocReloadBatchByMap.delete(firstMapId);
                while (host.mapsToLoad.length > 0) {
                    const next = host.mapsToLoad.peekFront();
                    if (!next) break;
                    const nextMapId = getMapSquareId(next.mapX, next.mapY);
                    const nextBatchId = host.queuedLocReloadBatchByMap.get(nextMapId);
                    if (nextBatchId !== firstBatchId) break;
                    host.mapsToLoad.shift();
                    host.queuedLocReloadBatchByMap.delete(nextMapId);
                    toApply.push(next);
                }
            }

            for (const pendingMap of toApply) {
                if (!host.isValidMapData(pendingMap)) {
                    console.warn(
                        `[WebGLOsrsRenderer] mapsToLoad rejected: mapX=${pendingMap.mapX} mapY=${pendingMap.mapY} cacheName=${pendingMap.cacheName} loadNpcs=${pendingMap.loadNpcs} smooth=${pendingMap.smoothTerrain}`,
                    );
                    continue;
                }
                console.log(
                    `[WebGLOsrsRenderer] mapsToLoad applying: mapX=${pendingMap.mapX} mapY=${pendingMap.mapY} verts=${pendingMap.vertices?.length}`,
                );
                mapApplyCount++;
                host.loadMap(
                    host.mainProgram,
                    host.mainAlphaProgram,
                    host.npcProgram,
                    host.textureArray,
                    host.textureMaterials,
                    host.waterTextures,
                    host.sceneUniformBuffer,
                    pendingMap,
                    host.skipMapFadeIn ? -1.0 : timeSec,
                );

                // Configure world entity overlay maps: set interactionPlane + deck height
                for (const [entityIndex, overlay] of host.worldEntityOverlays) {
                    const overlayMapX = 200 + entityIndex;
                    const overlayMapY = 200 + entityIndex;
                    if (pendingMap.mapX !== overlayMapX || pendingMap.mapY !== overlayMapY)
                        continue;
                    const overlayMapId = getMapSquareId(overlayMapX, overlayMapY);
                    const overlayMap = host.mapManager.mapSquares.get(overlayMapId);
                    if (!overlayMap) continue;
                    // Use server-provided basePlane (authoritative), fall back to cache
                    const weType = host.osrsClient.worldEntityTypeLoader?.load(overlay.configId);
                    const basePlane = overlay.basePlane || (weType?.basePlane ?? 0);

                    // Single source of truth: all interaction/height queries
                    // on this overlay map use the deck plane.
                    overlayMap.interactionPlane = basePlane;

                    if (overlay.deckHeight !== undefined && overlay.deckHeight !== 0) continue;
                    if (basePlane === 0) {
                        overlay.deckHeight = 0;
                        continue;
                    }
                    if (!overlayMap.heightMapData) continue;
                    const hmSize = overlayMap.heightMapSize;
                    const hmX = 48 + 4;
                    const hmY = 48 + 4;
                    if (hmX >= 0 && hmX < hmSize && hmY >= 0 && hmY < hmSize) {
                        const idx = basePlane * hmSize * hmSize + hmY * hmSize + hmX;
                        const rawVal = overlayMap.heightMapData[idx] ?? 0;
                        overlay.deckHeight = -(rawVal * 8);
                    }
                }
            }
        }
        profiler.endPhase();

        // Amortize expensive texture mipmap rebuilds outside the hot map-load path.
        profiler.startPhase("mipmaps");
        host.maybeRegenerateTextureMipmaps(time);
        profiler.endPhase();

        // Update positions for custom labels
        profiler.startPhase("labels");
        host.updateCustomLabels();
        profiler.endPhase();

        if (showDebugTimer || profileGpuTimer) {
            host.timer.end();
        }

        // Update public stats for devoverlay
        host.stats.drawBatches = host._frameBatches;
        host.stats.indicesSubmitted = host._frameIndices | 0;
        host.stats.trianglesSubmitted = (host._frameIndices / 3) | 0;
        host.stats.verticesSubmitted = host.stats.indicesSubmitted;
        host.stats.visibleMaps = host.mapManager.visibleMapCount | 0;
        host.stats.loadedMaps = host.mapManager.mapSquares.size | 0;

        const trackedPassIndices =
            opaqueIndices +
            opaqueActorIndices +
            transparentIndices +
            transparentNpcIndices +
            transparentPlayerIndices;
        const trackedPassBatches =
            opaqueBatches +
            opaqueActorBatches +
            transparentBatches +
            transparentNpcBatches +
            transparentPlayerBatches;
        const untrackedPassIndices = Math.max(0, host._frameIndices - trackedPassIndices);
        const untrackedPassBatches = Math.max(0, host._frameBatches - trackedPassBatches);

        // Record stats for profiler
        profiler.recordDrawCall(host.stats.drawBatches | 0, host.stats.trianglesSubmitted);
        profiler.recordGauge("visibleMaps", host.stats.visibleMaps);
        profiler.recordGauge("loadedMaps", host.stats.loadedMaps);
        profiler.recordGauge(
            "fpsLimit",
            host.stats.frameBudgetMs > 0 ? 1000 / host.stats.frameBudgetMs : 0,
        );
        profiler.recordGauge("frameBudgetMs", host.stats.frameBudgetMs);
        profiler.recordGauge("callbackDeltaMs", host.stats.callbackDeltaMs);
        profiler.recordGauge("estimatedRefreshHz", host.stats.estimatedRefreshHz);
        profiler.recordGauge("limiterSkippedCallbacks", host.stats.limiterSkippedCallbacks);
        profiler.recordGauge("limiterSkipDebtMs", host.stats.limiterSkipDebtMs);
        profiler.recordGauge("timeoutScheduler", host.stats.usedTimeoutScheduler ? 1 : 0);
        profiler.recordGauge(
            "frameJsMs",
            Math.max(0, performance.now() - host.stats.frameTimeStart),
        );
        profiler.recordGauge(
            "resolutionScale",
            host.osrsClient.mobileEffectiveResolutionScale || 1,
        );
        profiler.recordGauge("canvasPixelsMp", (host.app.width * host.app.height) / 1_000_000);
        profiler.recordGauge(
            "scenePixelsMp",
            (host.sceneRenderWidth * host.sceneRenderHeight) / 1_000_000,
        );
        profiler.recordGauge(
            "queuedMaps",
            ((host.mapsToLoad.length | 0) + (host.getPendingStreamMapCount() | 0)) | 0,
        );
        profiler.recordGauge("mapApplyCount", mapApplyCount | 0);
        profiler.recordGauge("pendingLocUpdates", host.pendingLocUpdates.size | 0);
        profiler.recordGauge("interactionHits", host.lastInteractionRaycastHitCount | 0);
        profiler.recordGauge("menuOptions", host.lastInteractionMenuOptionCount | 0);
        profiler.recordGauge("actorRenderCount", host.actorRenderCount | 0);
        profiler.recordGauge("groundItemMaps", host.groundItemStacks.size | 0);
        profiler.recordGauge("lodVisibleMaps", host.lastLodVisibleMapCount | 0);
        profiler.recordGauge("fullDetailVisibleMaps", host.lastFullDetailVisibleMapCount | 0);
        profiler.recordGauge(
            "distanceCulledVisibleMaps",
            host.lastDistanceCulledVisibleMapCount | 0,
        );
        profiler.recordGauge("renderDistanceTiles", host.getFrameRenderDistanceTiles() | 0);
        profiler.recordGauge("renderDistanceBaseTiles", host.osrsClient.renderDistance | 0);
        profiler.recordGauge("lodThreshold", host.lastLodThreshold | 0);
        profiler.recordGauge("roofPlaneLimit", host.getRoofPlaneLimit() | 0);
        profiler.recordGauge("roofFilteredRanges", host.frameRoofFilteredRangeCount | 0);
        profiler.recordGauge("roofTotalRanges", host.frameRoofTotalRangeCount | 0);
        profiler.recordGauge(
            "roofFilterPct",
            (host.frameRoofFilteredRangeCount / Math.max(1, host.frameRoofTotalRangeCount)) * 100,
        );
        profiler.recordGauge("triOpaque", (opaqueIndices / 3) | 0);
        profiler.recordGauge("triOpaqueActor", (opaqueActorIndices / 3) | 0);
        profiler.recordGauge("triTransparent", (transparentIndices / 3) | 0);
        profiler.recordGauge("triTranspNpc", (transparentNpcIndices / 3) | 0);
        profiler.recordGauge("triTranspPlayer", (transparentPlayerIndices / 3) | 0);
        profiler.recordGauge("triUntracked", (untrackedPassIndices / 3) | 0);
        profiler.recordGauge("batchOpaque", opaqueBatches | 0);
        profiler.recordGauge("batchOpaqueActor", opaqueActorBatches | 0);
        profiler.recordGauge("batchTransparent", transparentBatches | 0);
        profiler.recordGauge("batchTranspNpc", transparentNpcBatches | 0);
        profiler.recordGauge("batchTranspPlayer", transparentPlayerBatches | 0);
        profiler.recordGauge("batchUntracked", untrackedPassBatches | 0);
        host.finishRenderFrame(camera, deltaTime, showDebugTimer, profileGpuTimer);

        // Emote timers are advanced per-tick above.
    
}

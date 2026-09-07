import { useCallback, useEffect, useRef, useState } from "react";

import { RenderStatsOverlay } from "../components/RenderStatsOverlay";
import { OsrsLoadingBar } from "../components/OsrsLoadingBar";
import { DuelArenaOverlay } from "../components/DuelArena/DuelArenaOverlay";
// Legacy CSS menu and React minimap/orbs removed in favor of widget-based rendering
import { subscribeChatMessages, subscribeHandshake } from "../network/ServerConnection";
import { DownloadProgress } from "../rs/cache/CacheFiles";
import { Canvas } from "../ui/Canvas";
import { formatBytes } from "../common/utils/BytesUtil";
import { isIos, isMobileMode } from "../common/utils/DeviceUtil";
import { DebugControls } from "./DebugControls";
import "./GameContainer.css";
import { GameRenderer } from "./GameRenderer";
import { OsrsClient } from "./OsrsClient";
import { SidebarShell } from "./sidebar/SidebarShell";

interface OsrsContainerProps {
    osrsClient: OsrsClient;
}

type WidgetActionBridgeEvent = {
    widget?: unknown;

    option?: string;

    target?: string;

    cursorX?: number;

    cursorY?: number;

    slot?: number;

    itemId?: number;

    opIndex?: number;

    opSubIndex?: number;
};

type WidgetMenuProvider = {
    getEntriesAt?: (x: number, y: number) => unknown[] | undefined;
};

type WidgetLookupInput = {
    groupId?: number;

    childIndex?: number;

    itemId?: number;
};

type CanvasUiBridgeState = {
    mouseX?: number;

    mouseY?: number;

    onWidgetAction?: (event: WidgetActionBridgeEvent) => void;

    onWidgetExamine?: (widget: WidgetLookupInput | undefined) => void;

    getWidgetMenuEntries?: (
        widget: WidgetLookupInput | undefined,

        px?: number,

        py?: number,
    ) => unknown[];

    inventoryMenu?: WidgetMenuProvider;

    spellbookMenu?: WidgetMenuProvider;
};

type CanvasWithUiBridge = HTMLCanvasElement & {
    __ui?: CanvasUiBridgeState;
};

function resolvePointerCoordinate(
    explicitValue: number | undefined,

    fallbackValue: number | undefined,
): number {
    if (typeof explicitValue === "number" && !Number.isNaN(explicitValue)) {
        return explicitValue;
    }

    if (typeof fallbackValue === "number" && !Number.isNaN(fallbackValue)) {
        return fallbackValue;
    }

    return -1;
}

export function GameContainer({ osrsClient }: OsrsContainerProps): JSX.Element {
    const [renderer, setRenderer] = useState<GameRenderer>(osrsClient.renderer);

    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();

    const [hideUi, setHideUi] = useState(false);

    const [fps, setFps] = useState(0);

    const [, forceStatsOverlayRefresh] = useState(0);

    const [fishingStatus, setFishingStatus] = useState<{ label: string; detail: string } | null>(
        null,
    );

    const fishingStatusTimer = useRef<number | undefined>(undefined);

    // Legacy CSS menu props removed

    const requestRef = useRef<number | undefined>(undefined);

    const widgetManagerReady = osrsClient.widgetManager != null;

    const fpsUiLastMs = useRef(0);

    const animate = useCallback(
        (_time: DOMHighResTimeStamp) => {
            const now = performance.now();
            // Cap React FPS UI updates (~4Hz). Per-RAF setState was thrashing the tree.
            if (now - fpsUiLastMs.current >= 250) {
                fpsUiLastMs.current = now;
                setFps(Math.round(renderer.stats.frameTimeFps));
                if (!hideUi && osrsClient.hoverOverlayEnabled) {
                    forceStatsOverlayRefresh(renderer.stats.frameCount | 0);
                }
            }

            requestRef.current = requestAnimationFrame(animate);
        },
        [hideUi, osrsClient, renderer],
    );

    useEffect(() => {
        renderer.setUiHidden(hideUi);
    }, [renderer, hideUi]);

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);

        return () => cancelAnimationFrame(requestRef.current!);
    }, [animate]);

    useEffect(() => {
        const frameId = requestAnimationFrame(() => {
            if (!widgetManagerReady || !renderer.canvas.isConnected) {
                return;
            }

            renderer.forceResize();

            osrsClient.updateWidgets();
        });

        return () => cancelAnimationFrame(frameId);
    }, [renderer, osrsClient, widgetManagerReady]);

    // Optional: hook to handle widget context-menu actions dispatched from the GL UI

    useEffect(() => {
        try {
            const canvas = renderer?.canvas as CanvasWithUiBridge | undefined;

            if (!canvas) return;

            const uiState: CanvasUiBridgeState = canvas.__ui || {};

            canvas.__ui = uiState;

            uiState.onWidgetAction = (event: WidgetActionBridgeEvent) => {
                const cursorX = resolvePointerCoordinate(event.cursorX, uiState.mouseX);

                const cursorY = resolvePointerCoordinate(event.cursorY, uiState.mouseY);

                osrsClient.handleWidgetAction({
                    ...event,

                    cursorX,

                    cursorY,
                });
            };

            uiState.onWidgetExamine = (widget: WidgetLookupInput | undefined) => {
                osrsClient.examineWidgetItem(widget);
            };

            // Provide dynamic widget menu entries for special UIs (e.g., mobile viewport icons)

            uiState.getWidgetMenuEntries = (
                widget: WidgetLookupInput | undefined,

                px?: number,

                py?: number,
            ) => {
                try {
                    if (!widget) return [];

                    if (typeof widget.groupId !== "number") return [];

                    const groupId = widget.groupId | 0;

                    const pointerX = resolvePointerCoordinate(px, uiState.mouseX);

                    const pointerY = resolvePointerCoordinate(py, uiState.mouseY);

                    if (groupId === 149 && pointerX >= 0 && pointerY >= 0) {
                        const menu = uiState.inventoryMenu;

                        const slotEntries =
                            typeof menu?.getEntriesAt === "function"
                                ? menu.getEntriesAt(pointerX, pointerY)
                                : undefined;

                        if (slotEntries && slotEntries.length) {
                            return slotEntries;
                        }
                    }

                    if (groupId === 218 && pointerX >= 0 && pointerY >= 0) {
                        const menu = uiState.spellbookMenu;

                        const spellEntries =
                            typeof menu?.getEntriesAt === "function"
                                ? menu.getEntriesAt(pointerX, pointerY)
                                : undefined;

                        if (spellEntries && spellEntries.length) {
                            return spellEntries;
                        }
                    }
                } catch {}

                return [];
            };
        } catch {}
    }, [renderer, osrsClient]);

    useEffect(() => {
        return subscribeHandshake(({ chatIcons, isAdmin }) => {
            const nextIsAdmin =
                typeof isAdmin === "boolean"
                    ? isAdmin
                    : Array.isArray(chatIcons) && chatIcons.includes(1);
            osrsClient.localPlayerIsAdmin = nextIsAdmin;
        });
    }, [osrsClient]);

    const updateFishingStatus = useCallback((detail?: string) => {
        if (fishingStatusTimer.current) {
            window.clearTimeout(fishingStatusTimer.current);

            fishingStatusTimer.current = undefined;
        }

        if (!detail) {
            setFishingStatus(null);

            return;
        }

        setFishingStatus({ label: "Fishing", detail });

        fishingStatusTimer.current = window.setTimeout(() => {
            setFishingStatus(null);

            fishingStatusTimer.current = undefined;
        }, 4000);
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeChatMessages((msg) => {
            if (!msg || msg.messageType !== "game" || typeof msg.text !== "string") {
                return;
            }

            const normalized = msg.text.trim().toLowerCase();

            const startTriggers = [
                "attempt to catch",

                "catch some",

                "fail to catch anything",

                "haul in",
            ];

            const stopTriggers = [
                "stop fishing",

                "run out of bait",

                "run out of feathers",

                "run out of karambwanji",

                "too full to hold any more fish",

                "you don't have any",
            ];

            if (startTriggers.some((phrase) => normalized.includes(phrase))) {
                updateFishingStatus(msg.text);

                return;
            }

            if (normalized.includes("minnow") && normalized.includes("catch")) {
                updateFishingStatus(msg.text);

                return;
            }

            if (stopTriggers.some((phrase) => normalized.includes(phrase))) {
                updateFishingStatus(undefined);
            }
        });

        return () => {
            unsubscribe();

            if (fishingStatusTimer.current) {
                window.clearTimeout(fishingStatusTimer.current);

                fishingStatusTimer.current = undefined;
            }
        };
    }, [updateFishingStatus]);

    let loadingBarOverlay: JSX.Element | undefined = undefined;

    if (downloadProgress) {
        const formattedCacheSize = formatBytes(downloadProgress.total);

        const progress = ((downloadProgress.current / downloadProgress.total) * 100) | 0;

        loadingBarOverlay = (
            <div className="overlay-container max-height">
                <OsrsLoadingBar
                    text={`Downloading cache (${formattedCacheSize})`}
                    progress={progress}
                />
            </div>
        );
    }

    return (
        <div className="max-height game-container-root" onContextMenuCapture={event => {
            // The game menu can appear between right-button down and contextmenu.
            // Capture at the game root so the newly opened interface is covered too.
            if (osrsClient.duelArenaMode) { event.preventDefault(); event.stopPropagation(); }
        }}>
            <div
                className={[
                    "game-viewport",
                    isMobileMode ? "game-viewport-mobile" : "",
                    isMobileMode && isIos ? "game-viewport-apple" : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
            >
                <div className="game-canvas-shell">
                    <div className="game-canvas-stage">
                        {loadingBarOverlay}

                        {!osrsClient.duelArenaMode && <div className="hud right-top">
                            <div className="fps-counter content-text">{fps}</div>

                            {!hideUi && (
                                <>
                                    <div className="fps-counter content-text">
                                        {osrsClient.debugText}
                                    </div>

                                    {fishingStatus && (
                                        <div className="skill-status content-text">
                                            <div className="label">Fishing</div>

                                            <div className="detail">{fishingStatus.detail}</div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>}

                        {/* CSS-based OSRS menu removed in favor of GL overlay */}

                        {!osrsClient.duelArenaMode && !hideUi && osrsClient.customLabelScreens.length > 0 && (
                            <>
                                {osrsClient.customLabelScreens.map((lbl, i) => (
                                    <div
                                        key={`custom-label-${i}`}
                                        className="tile-label content-text"
                                        style={{
                                            position: "absolute",

                                            left: lbl.x,

                                            top: lbl.y - 16,

                                            pointerEvents: "none",
                                        }}
                                    >
                                        {lbl.text}
                                    </div>
                                ))}
                            </>
                        )}

                        <Canvas renderer={renderer} />
                        {osrsClient.duelArenaMode && <DuelArenaOverlay client={osrsClient} />}
                    </div>
                </div>

                {!osrsClient.duelArenaMode && !hideUi && (
                    <span>
                        {/* Bottom-left performance/optimization overlay (F3 toggles) */}

                        {(osrsClient.hoverOverlayEnabled || isMobileMode) && (
                            <>
                                <RenderStatsOverlay
                                    renderer={renderer}
                                    cacheInfo={osrsClient.loadedCache?.info}
                                    showDetails={osrsClient.hoverOverlayEnabled}
                                />
                            </>
                        )}
                        {/* OSRS tabs moved into WebGL devoverlay */}
                    </span>
                )}

                {!osrsClient.duelArenaMode && !hideUi && !osrsClient.isOnLoginScreen() && (
                    <SidebarShell osrsClient={osrsClient} store={osrsClient.sidebar} />
                )}
            </div>

            {/* Debug controls sidebar (Leva) - top-left corner */}

            {!osrsClient.duelArenaMode && <DebugControls
                renderer={renderer}
                hideUi={hideUi}
                setRenderer={setRenderer}
                setHideUi={setHideUi}
                setDownloadProgress={setDownloadProgress}
            />}
        </div>
    );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { registerSerializer } from "threads";
import WebFont from "webfontloader";

import {
    sendHandshake,
    setAutoSendHandshake,
    subscribeHandshake,
    subscribeLoginResponse,
} from "../network/ServerConnection";
import { pruneCacheStorage, resolveCacheKey } from "../rs/cache/CacheFiles";
import { IndexType } from "../rs/cache/IndexType";
import {
    getCacheManifestEntry,
    isCacheManifestComplete,
    removeCacheManifestEntry,
    writeCacheManifestEntry,
} from "../common/utils/CacheManifest";
import {
    checkMobile,
    isIos,
    isStandaloneDisplayMode,
    isTouchDevice,
} from "../common/utils/DeviceUtil";
import {
    describeStorageShortfall,
    ensurePersistentStorage,
    getStorageBudget,
    hasEnoughStorage,
} from "../common/utils/StorageUtil";
import { fetchCacheList, loadCacheFilesAuto } from "./Caches";
import { GameContainer } from "./GameContainer";
import { getAvailableRenderers } from "./GameRenderers";
import { OsrsClient } from "./OsrsClient";
import { installEyesBridge } from "./debug/EyesBridge";
import {
    getClientPreference,
    setClientPreference,
} from "./preferences/ClientPreferences";
import { useSafariLandscapeLock } from "./useSafariLandscapeLock";
import { useViewportCssVars } from "./useViewportCssVars";
import { renderDataLoaderSerializer } from "./worker/RenderDataLoader";
import { RenderDataWorkerPool } from "./worker/RenderDataWorkerPool";

registerSerializer(renderDataLoaderSerializer);

WebFont.load({
    custom: {
        families: ["OSRS Bold", "OSRS Small"],
    },
});

const cachesPromise = fetchCacheList();

// --- HMR-aware nonce to force worker pool re-creation on Fast Refresh ---
declare const module: any;

type LoginUnsubscriber = () => void;
function readWorkerPoolNonce(): number {
    if (typeof window === "undefined") return 0;
    const value = window.__rsWorkerPoolNonce;
    return typeof value === "number" && Number.isFinite(value) ? value | 0 : 0;
}

function incrementWorkerPoolNonce(): void {
    if (typeof window === "undefined") return;
    const current = readWorkerPoolNonce();
    window.__rsWorkerPoolNonce = (current + 1) | 0;
}

function hasCacheStorage(): boolean {
    return typeof globalThis.caches !== "undefined";
}

// Initialize and capture a stable nonce for this module evaluation
if (typeof window !== "undefined" && window.__rsWorkerPoolNonce === undefined) {
    window.__rsWorkerPoolNonce = 0;
}
readWorkerPoolNonce();

// On hot-reload, dispose the existing OsrsClient and increment the nonce
if (typeof module !== "undefined" && module.hot) {
    module.hot.dispose(() => {
        if (typeof window !== "undefined") {
            // Dispose existing OsrsClient to stop audio and free resources
            const existingClient = window.osrsClient;
            if (existingClient) {
                existingClient.dispose();
                window.osrsClient = undefined;
            }
            // Increment nonce so useMemo re-creates the worker pool
            incrementWorkerPoolNonce();
        }
    });
}

// Worker pool is created inside the component so we can tune thread count

function OsrsClientApp() {
    const [errorMessage, setErrorMessage] = useState<string>();
    const [osrsClient, setOsrsClient] = useState<OsrsClient>();
    const [storageWarnings, setStorageWarnings] = useState<string[]>([]);
    const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent>();
    const [showInstallPrompt, setShowInstallPrompt] = useState(false);
    const [showIosInstallHint, setShowIosInstallHint] = useState(false);
    const loginUnsubscribers = useMemo<Array<LoginUnsubscriber>>(() => [], []);
    useViewportCssVars();
    // Phones only (not iPad): CSS-rotate when portrait + try orientation.lock.
    // Enabled from login onward — portrait layout is unusable for the classic UI.
    const safariLandscapeLock = useSafariLandscapeLock(checkMobile());

    const addStorageWarning = useCallback((message: string) => {
        setStorageWarnings((prev) => {
            if (prev.includes(message)) {
                return prev;
            }
            return [...prev, message];
        });
    }, []);

    useEffect(() => {
        if (!(isTouchDevice || isIos)) return;

        const isStandalone = isStandaloneDisplayMode();

        if (
            isIos &&
            !isStandalone &&
            !getClientPreference("iosInstallHintDismissed")
        ) {
            setShowIosInstallHint(true);
        }

        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            if (!isTouchDevice) return;
            if (getClientPreference("installPromptDismissed")) return;
            const promptEvent = event as BeforeInstallPromptEvent;
            setDeferredInstallPrompt(promptEvent);
            setShowInstallPrompt(true);
        };

        const handleAppInstalled = () => {
            setDeferredInstallPrompt(undefined);
            setShowInstallPrompt(false);
            setShowIosInstallHint(false);
            setClientPreference("installPromptDismissed", true);
            setClientPreference("iosInstallHintDismissed", true);
        };

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.addEventListener("appinstalled", handleAppInstalled);

        return () => {
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
            window.removeEventListener("appinstalled", handleAppInstalled);
        };
    }, []);

    const handleInstallClick = useCallback(async () => {
        const promptEvent = deferredInstallPrompt;
        if (!promptEvent) return;
        try {
            promptEvent.prompt();
            await promptEvent.userChoice.catch(() => {});
        } finally {
            setDeferredInstallPrompt(undefined);
            setShowInstallPrompt(false);
            setClientPreference("installPromptDismissed", true);
        }
    }, [deferredInstallPrompt]);

    const dismissInstallPrompt = useCallback(() => {
        setShowInstallPrompt(false);
        setClientPreference("installPromptDismissed", true);
    }, []);

    const dismissIosHint = useCallback(() => {
        setShowIosInstallHint(false);
        setClientPreference("iosInstallHintDismissed", true);
    }, []);

    const dismissStorageWarnings = useCallback(() => {
        setStorageWarnings([]);
        // Avoid revealing a near-duplicate "add to home screen" banner underneath.
        setShowIosInstallHint(false);
        setClientPreference("iosInstallHintDismissed", true);
    }, []);

    // Two workers build maps in parallel — halves total grid load time.
    // Progressive rendering shows each map as it arrives, no main-thread freeze.
    const workerCount = useMemo(() => {
        return 2;
    }, []);

    const workerPool = useMemo(() => RenderDataWorkerPool.create(workerCount), [workerCount]);

    useEffect(() => {
        return () => {
            // Terminate workers on unmount or when workerCount changes
            workerPool.terminate().catch(() => {});
        };
    }, [workerPool]);

    useEffect(() => {
        const abortController = new AbortController();
        let disposed = false;
        let clientToDispose: OsrsClient | undefined;
        let rendererCheckFrame: number | undefined;
        let rendererCheckTimer: ReturnType<typeof setTimeout> | undefined;

        const load = async () => {
            const cacheList = await cachesPromise;
            if (!cacheList) {
                setErrorMessage("Failed to load cache list");
                throw new Error("No caches found");
            }

            // No URL params supported: always use latest cache
            let cacheInfo = cacheList.latest;

            const isStandalone = isStandaloneDisplayMode();

            const persisted = await ensurePersistentStorage();

            // On iOS PWA, storage is automatically persistent even if the API says otherwise
            const effectivelyPersistent = persisted === true || (isStandalone && isIos);

            if (!effectivelyPersistent) {
                if (persisted === false) {
                    console.warn(
                        "[storage] Browser denied persistent storage; cached RuneScape data may be evicted",
                    );
                    // Notification removed - user is likely on iOS PWA where storage is persistent anyway
                } else if (persisted === "unsupported") {
                    console.warn(
                        "[storage] Persistent storage API not available; browser may evict cached data",
                    );
                    // Skip on iOS Safari-in-tab: the dedicated home-screen hint already covers this.
                    if (!(isIos && !isStandalone)) {
                        addStorageWarning(
                            "Persistent storage not supported in this browser. Cached assets may be cleared. Install as PWA or use a modern browser.",
                        );
                    }
                }

                // iOS Safari (not installed): do not also push a storage banner about
                // Add to Home Screen — showIosInstallHint already shows that once.
            }

            const cacheSize = typeof cacheInfo.size === "number" ? cacheInfo.size : 0;
            const expectedBytes = Math.max(cacheSize, 256 * 1024 * 1024);
            const budget = await getStorageBudget();
            const enoughStorage = await hasEnoughStorage(expectedBytes);
            if (!enoughStorage) {
                setErrorMessage(
                    `Not enough storage available to keep the RuneScape cache. ${describeStorageShortfall(
                        expectedBytes,
                        budget,
                    )}`,
                );
                return;
            }

            await pruneCacheStorage([cacheInfo.name]);

            const manifestEntry = await getCacheManifestEntry(cacheInfo.name);
            let cacheInvalidated = false;
            if (manifestEntry) {
                const complete = await isCacheManifestComplete(manifestEntry);
                if (!complete) {
                    cacheInvalidated = true;
                    await removeCacheManifestEntry(cacheInfo.name);
                    addStorageWarning(
                        "Cached RuneScape data was cleared by the browser; assets will be re-downloaded.",
                    );
                }
            }

            if (cacheInvalidated && hasCacheStorage()) {
                try {
                    await globalThis.caches.delete(resolveCacheKey(cacheInfo.name));
                } catch {}
            }

            // ========== Create OsrsClient BEFORE cache download ==========
            // This allows the LoginRenderer to display download progress via the state machine
            const availableRenderers = getAvailableRenderers();
            if (availableRenderers.length === 0) {
                setErrorMessage("No renderers available");
                return;
            }
            const rendererType = availableRenderers[0];

            // Create OsrsClient without cache - starts in DOWNLOADING state
            const client = new OsrsClient(
                workerPool,
                cacheList,
                rendererType,
                // No cache yet - will be initialized after download
            );
            clientToDispose = client;

            // Set OsrsClient immediately so GameContainer can render the login overlay
            setOsrsClient(client);
            window.osrsClient = client;
            // Automation/debug hook (only when ?eyes=1): window.__eyes
            installEyesBridge(client);

            // ========== Download cache with progress routed through OsrsClient ==========
            // Load all cache files during DOWNLOADING phase
            // Extra indices needed for full functionality
            const extraIndexIds = [
                IndexType.DAT2.interfaces,
                IndexType.DAT2.fonts,
                IndexType.DAT2.clientScript,
                IndexType.DAT2.musicTracks,
                IndexType.DAT2.musicSamples,
                IndexType.DAT2.musicPatches,
            ];

            // Sparse (on-demand) loading when supported; legacy full download otherwise.
            const cache = await loadCacheFilesAuto(
                cacheInfo,
                abortController.signal,
                (progress) => {
                    // Route download progress through OsrsClient to LoginState
                    client.setDownloadProgress(progress.current, progress.total, progress.label);
                },
                extraIndexIds,
            );

            // ========== Ensure renderer is ready before loading ==========
            // Wait for React to render GameContainer/Canvas and for renderer to initialize
            // This is needed because if cache is already cached, loadCacheFiles returns instantly
            // and we'd call initCache before the render loop is running
            await new Promise<void>((resolve) => {
                const checkRenderer = () => {
                    if (disposed) {
                        resolve();
                        return;
                    }
                    if (client.renderer?.running) {
                        resolve();
                    } else {
                        rendererCheckFrame = requestAnimationFrame(checkRenderer);
                    }
                };
                // Give React time to render (state updates are async)
                rendererCheckTimer = setTimeout(checkRenderer, 100);
            });

            if (disposed) return;

            // ========== Initialize cache and finalize OsrsClient ==========
            client.initCache(cache);
            client.init();

            // ========== Login Screen Flow ==========
            setAutoSendHandshake(false);

            const unsubLogin = subscribeLoginResponse((response) => {
                if (response.success) {
                    console.log("[OsrsClientApp] Login successful, sending handshake");
                    const username =
                        client.loginState?.username || response.displayName || "Player";
                    sendHandshake(username);
                } else {
                    console.log(
                        "[OsrsClientApp] Login failed:",
                        response.errorCode,
                        response.error,
                    );
                    if (response.errorCode !== undefined) {
                        client.handleLoginError(response.errorCode);
                    } else {
                        client.onLoginFailed(response.error || "Login failed");
                    }
                }
            });

            const unsubHandshake = subscribeHandshake((info) => {
                console.log("[OsrsClientApp] Handshake received, player logged in:", info.name);
                client.onLoginSuccess();
            });
            loginUnsubscribers.push(unsubLogin, unsubHandshake);

            try {
                const fileNames = cache.files.getFileNames();
                await writeCacheManifestEntry({
                    cacheName: cacheInfo.name,
                    files: fileNames,
                    updatedAt: new Date().toISOString(),
                    size: cacheInfo.size,
                    revision: cacheInfo.revision,
                });
            } catch {}
        };

        // Attempt to load regardless of platform; rely on feature detection
        // to determine available renderers at runtime.
        load().catch((err) => {
            if (disposed) return;
            console.error(err);
            try {
                const msg = err && typeof err.message === "string" ? err.message : String(err);
                setErrorMessage(msg || "Failed to initialize");
            } catch {
                setErrorMessage("Failed to initialize");
            }
        });

        return () => {
            disposed = true;
            if (rendererCheckTimer !== undefined) clearTimeout(rendererCheckTimer);
            if (rendererCheckFrame !== undefined) cancelAnimationFrame(rendererCheckFrame);
            while (loginUnsubscribers.length > 0) {
                const unsub = loginUnsubscribers.pop();
                if (!unsub) continue;
                try {
                    unsub();
                } catch {}
            }
            abortController.abort();
            clientToDispose?.dispose();
            if (window.osrsClient === clientToDispose) window.osrsClient = undefined;
        };
    }, [addStorageWarning, loginUnsubscribers, workerPool]);

    let content: JSX.Element | undefined;

    if (errorMessage) {
        content = <div className="center-container max-height content-text">{errorMessage}</div>;
    } else if (osrsClient) {
        // Show GameContainer - LoginRenderer handles all loading states (DOWNLOADING and LOADING)
        content = <GameContainer osrsClient={osrsClient} />;
    } else {
        // Brief loading state before OsrsClient is created (checking storage, opening caches, etc.)
        content = (
            <div
                style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    background: "black",
                }}
            />
        );
    }

    let bannerContent: JSX.Element | undefined;
    if (showInstallPrompt) {
        bannerContent = (
            <div
                style={{
                    background: "#0f0d25",
                    color: "#ffffff",
                    padding: "20px 24px",
                    fontSize: "0.95rem",
                    lineHeight: 1.4,
                }}
            >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Install OSRS Client</div>
                <div style={{ marginBottom: 14 }}>
                    Add the app for faster launches and offline-ready assets.
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                    <button
                        type="button"
                        onClick={handleInstallClick}
                        style={{
                            flex: 1,
                            background: "#4a43ff",
                            color: "#ffffff",
                            border: "none",
                            padding: "12px 18px",
                            borderRadius: 10,
                            fontWeight: 600,
                        }}
                    >
                        Install
                    </button>
                    <button
                        type="button"
                        onClick={dismissInstallPrompt}
                        style={{
                            flex: "0 0 auto",
                            background: "rgba(255,255,255,0.1)",
                            color: "#f8f9ff",
                            border: "none",
                            padding: "12px 18px",
                            borderRadius: 10,
                        }}
                    >
                        Maybe later
                    </button>
                </div>
            </div>
        );
    } else if (storageWarnings.length > 0) {
        bannerContent = (
            <div
                style={{
                    background: "#150f2e",
                    color: "#f2f2ff",
                    padding: "18px 24px",
                    fontSize: "0.92rem",
                    lineHeight: 1.5,
                    position: "relative",
                }}
            >
                <button
                    type="button"
                    aria-label="Close"
                    onClick={dismissStorageWarnings}
                    style={{
                        position: "absolute",
                        top: 10,
                        right: 12,
                        background: "transparent",
                        border: "none",
                        color: "#f2f2ff",
                        fontSize: "1.25rem",
                        lineHeight: 1,
                        padding: "4px 8px",
                        cursor: "pointer",
                    }}
                >
                    ×
                </button>
                {storageWarnings.map((msg, idx) => (
                    <p key={idx} style={{ margin: idx === 0 ? "0 28px 0 0" : "8px 28px 0 0" }}>
                        {msg}
                    </p>
                ))}
            </div>
        );
    } else if (showIosInstallHint) {
        bannerContent = (
            <div
                style={{
                    background: "#0f0d25",
                    color: "#f8f9ff",
                    padding: "18px 24px",
                    fontSize: "0.95rem",
                    lineHeight: 1.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    position: "relative",
                }}
            >
                <span style={{ paddingRight: 28 }}>
                    Add OSRS Client to your home screen: tap the share icon, then choose
                    <strong> Add to Home Screen</strong>.
                </span>
                <button
                    type="button"
                    aria-label="Close"
                    onClick={dismissIosHint}
                    style={{
                        position: "absolute",
                        top: 10,
                        right: 12,
                        background: "transparent",
                        border: "none",
                        color: "#f8f9ff",
                        fontSize: "1.25rem",
                        lineHeight: 1,
                        padding: "4px 8px",
                        cursor: "pointer",
                    }}
                >
                    ×
                </button>
            </div>
        );
    }

    const bannerWrapper = bannerContent ? (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1000,
                pointerEvents: "auto",
                boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            }}
        >
            {bannerContent}
        </div>
    ) : null;

    const appClassName = [
        "App",
        "max-height",
        safariLandscapeLock.enabled ? "ios-safari-force-landscape" : "",
        safariLandscapeLock.enabled && safariLandscapeLock.rotated
            ? "ios-safari-force-landscape-rotated"
            : "",
    ]
        .filter((name) => name.length > 0)
        .join(" ");

    return (
        <div className={appClassName}>
            {bannerWrapper}
            {content}
        </div>
    );
}

interface BeforeInstallPromptEvent extends Event {
    prompt: () => void;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default OsrsClientApp;

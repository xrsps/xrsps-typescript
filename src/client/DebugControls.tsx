import FileSaver from "file-saver";
import { vec3 } from "gl-matrix";
import { Leva, button, buttonGroup, folder, useControls } from "leva";
import { ButtonGroupOpts, Schema } from "leva/dist/declarations/src/types";
import { memo, useEffect, useState } from "react";

import { DownloadProgress } from "../rs/cache/CacheFiles";
import { IndexType } from "../rs/cache/IndexType";
import { isTouchDevice } from "../util/DeviceUtil";
import { lerp, slerp } from "../util/MathUtil";
import { loadCacheFiles } from "./Caches";
import { CameraView, ProjectionType } from "./Camera";
import { ClientState } from "./ClientState";
import { GameRenderer } from "./GameRenderer";
import {
    OsrsRendererType,
    createRenderer,
    getAvailableRenderers,
    getRendererName,
} from "./GameRenderers";
import { OsrsClient } from "./OsrsClient";
import { profiler } from "./webgl/PerformanceProfiler";

interface OsrsClientControlsProps {
    renderer: GameRenderer;
    hideUi: boolean;
    setRenderer: (renderer: GameRenderer) => void;
    setHideUi: (hideUi: boolean | ((hideUi: boolean) => boolean)) => void;
    setDownloadProgress: (progress: DownloadProgress | undefined) => void;
}

type DebugOverlayRenderer = {
    objectBoundsOverlay?: { enabled: boolean };
    widgetsOverlay?: { enabled: boolean };
};

enum VarType {
    VARP = 0,
    VARBIT = 1,
}

export const DebugControls = memo(
    ({
        renderer,
        hideUi: hidden,
        setRenderer,
        setHideUi,
        setDownloadProgress,
    }: OsrsClientControlsProps): JSX.Element => {
        const osrsClient = renderer.osrsClient;

        const [projectionType, setProjectionType] = useState<ProjectionType>(
            osrsClient.camera.projectionType,
        );

        const [isExportingSprites, setExportingSprites] = useState(false);
        const [isExportingTextures, setExportingTextures] = useState(false);

        const [varType, setVarType] = useState<VarType>(VarType.VARBIT);
        const [varId, setVarId] = useState(0);
        const [varValue, setVarValue] = useState(0);

        const ensureResidentBudgetForRadius = (mapRadius: number): void => {
            // Budget enough to keep the full (2r+1)^2 grid resident with some slack for backtracking.
            const grid = (mapRadius * 2 + 1) ** 2;
            const desired = Math.min(256, Math.max(128, grid * 2));
            try {
                renderer.mapManager.setMaxResidentMaps(desired);
            } catch {}
        };

        const [animationDuration, setAnimationDuration] = useState(10);
        const [cameraPoints, setCameraPoints] = useState<CameraView[]>(() => []);

        const addPoint = () => {
            setCameraPoints((pts) => [
                ...pts,
                {
                    position: vec3.fromValues(
                        osrsClient.camera.pos[0],
                        osrsClient.camera.pos[1],
                        osrsClient.camera.pos[2],
                    ),
                    pitch: osrsClient.camera.pitch,
                    yaw: osrsClient.camera.yaw,
                    orthoZoom: osrsClient.camera.orthoZoom,
                },
            ]);
        };

        const removeLastPoint = () => {
            setCameraPoints((pts) => pts.slice(0, pts.length - 1));
        };

        useEffect(() => {
            function handleKeyDown(e: KeyboardEvent) {
                if (e.repeat) {
                    return;
                }

                switch (e.key) {
                    case "F1":
                        setHideUi((v) => !v);
                        break;
                    case "F2":
                        setCameraRunning((v) => !v);
                        break;
                    case "F3":
                        addPoint();
                        break;
                    case "F4":
                        removeLastPoint();
                        break;
                }
            }

            document.addEventListener("keydown", handleKeyDown);

            return () => {
                document.removeEventListener("keydown", handleKeyDown);
            };
        }, [osrsClient]);

        useEffect(() => {
            setPointControls(
                folder(
                    cameraPoints.reduce((acc: Record<string, any>, v, i) => {
                        const point = v;
                        const buttons: ButtonGroupOpts = {
                            Teleport: () => osrsClient.setCamera(point),
                            Delete: () => setCameraPoints((pts) => pts.filter((_, j) => j !== i)),
                        };
                        acc["Point " + i] = buttonGroup(buttons);
                        return acc;
                    }, {}),
                ),
            );
        }, [osrsClient, cameraPoints]);

        const [pointsControls, setPointControls] = useState(folder({}));
        const [isCameraRunning, setCameraRunning] = useState(false);

        useEffect(() => {
            if (!isCameraRunning) {
                return;
            }

            const segmentCount = cameraPoints.length - 1;
            // Need at least 2 points to start
            if (segmentCount <= 0) {
                setCameraRunning(false);
                return;
            }

            let animationId = -1;

            let start: number;
            const animate = (time: DOMHighResTimeStamp) => {
                if (!start) {
                    start = time;
                }

                const elapsed = time - start;
                const overallProgress = elapsed / (animationDuration * 1000);

                const startIndex = Math.floor(overallProgress * segmentCount);
                const endIndex = startIndex + 1;
                const from = cameraPoints[startIndex];
                const to = cameraPoints[endIndex];
                const localProgress = (overallProgress * segmentCount) % 1;

                const isComplete = elapsed > animationDuration * 1000;
                if (isComplete) {
                    setCameraRunning(false);
                    osrsClient.setCamera(cameraPoints[cameraPoints.length - 1]);
                    return;
                }
                const newView: CameraView = {
                    position: vec3.fromValues(
                        lerp(from.position[0], to.position[0], localProgress),
                        lerp(from.position[1], to.position[1], localProgress),
                        lerp(from.position[2], to.position[2], localProgress),
                    ),
                    pitch: lerp(from.pitch, to.pitch, localProgress),
                    yaw: slerp(from.yaw, to.yaw, localProgress, 2048),
                    orthoZoom: lerp(from.orthoZoom, to.orthoZoom, localProgress),
                };
                osrsClient.setCamera(newView);

                animationId = requestAnimationFrame(animate);
            };

            // Start animating
            animationId = requestAnimationFrame(animate);

            return () => {
                cancelAnimationFrame(animationId);
            };
        }, [osrsClient, cameraPoints, animationDuration, isCameraRunning]);

        const rendererOptions: Record<string, OsrsRendererType> = {};
        for (let v of getAvailableRenderers()) {
            rendererOptions[getRendererName(v)] = v;
        }

        const recordSchema: Schema = {
            "Add point (F3)": button(() => addPoint()),
            "Delete last point (F4)": button(() => removeLastPoint()),
            Length: {
                value: animationDuration,
                onChange: (v: number) => {
                    setAnimationDuration(v);
                },
            },
            Points: pointsControls,
        };

        if (isCameraRunning) {
            const buttonName = "Stop (F2)";
            recordSchema[buttonName] = button(() => setCameraRunning(false));
            recordSchema[buttonName].order = -1;
        } else {
            const buttonName = "Start (F2)";
            recordSchema[buttonName] = button(() => setCameraRunning(true));
            recordSchema[buttonName].order = -1;
        }

        // Extract Player folder from renderer schema so we can render it top-level
        const rendererSchema: any = renderer.getControls();
        const playerFolder = rendererSchema?.Player;
        if (playerFolder) {
            delete rendererSchema.Player;
        }

        useControls(
            {
                Links: folder({}, { collapsed: true }),
                Camera: folder(
                    {
                        Projection: {
                            value: projectionType,
                            options: {
                                Perspective: ProjectionType.PERSPECTIVE,
                                Ortho: ProjectionType.ORTHO,
                            },
                            onChange: (v: ProjectionType) => {
                                osrsClient.camera.setProjectionType(v);
                                setProjectionType(v);
                            },
                            order: 0,
                        },
                        ...createCameraControls(osrsClient),
                        Speed: {
                            value: osrsClient.cameraSpeed,
                            min: 0.1,
                            max: 5,
                            step: 0.1,
                            onChange: (v: number) => {
                                osrsClient.cameraSpeed = v;
                            },
                            order: 10,
                        },
                    },
                    { collapsed: false },
                ),
                Distance: folder(
                    {
                        View: {
                            value: osrsClient.renderDistance,
                            min: 25,
                            max: 90,
                            step: 1,
                            label: "Draw distance",
                            onChange: (v: number) => {
                                const clampedDistance = Math.max(25, Math.min(90, v | 0));
                                osrsClient.renderDistance = clampedDistance;
                                // Tile-based LOD threshold.
                                osrsClient.lodDistance = Math.max(0, clampedDistance - 2);
                            },
                        },
                        Advanced: folder(
                            {
                                Render: {
                                    value: osrsClient.renderDistance,
                                    min: 25,
                                    max: 90,
                                    step: 1,
                                    label: "Draw distance",
                                    onChange: (v: number) => {
                                        osrsClient.renderDistance = Math.max(
                                            25,
                                            Math.min(90, v | 0),
                                        );
                                    },
                                },
                                ExpandedMapLoading: {
                                    value: osrsClient.expandedMapLoading,
                                    min: 0,
                                    max: 5,
                                    step: 1,
                                    label: "Expanded map loading",
                                    onChange: (v: number) => {
                                        osrsClient.expandedMapLoading = Math.max(
                                            0,
                                            Math.min(5, v | 0),
                                        );
                                        if (!osrsClient.isLoggedIn()) {
                                            return;
                                        }
                                        try {
                                            const cam = osrsClient.camera;
                                            renderer.mapManager.update(
                                                cam.getPosX(),
                                                cam.getPosZ(),
                                                cam,
                                                renderer.stats.frameCount,
                                                osrsClient.mapRadius,
                                                ClientState.baseX | 0,
                                                ClientState.baseY | 0,
                                                osrsClient.expandedMapLoading | 0,
                                            );
                                        } catch {}
                                    },
                                },
                                MapRadius: {
                                    value: osrsClient.mapRadius,
                                    min: 0,
                                    max: 7,
                                    step: 1,
                                    label: "Map radius (map squares)",
                                    onChange: (v: number) => {
                                        osrsClient.mapRadius = v;
                                        ensureResidentBudgetForRadius(v);
                                        if (!osrsClient.isLoggedIn()) {
                                            return;
                                        }
                                        try {
                                            const cam = osrsClient.camera;
                                            renderer.mapManager.update(
                                                cam.getPosX(),
                                                cam.getPosZ(),
                                                cam,
                                                renderer.stats.frameCount,
                                                osrsClient.mapRadius,
                                                ClientState.baseX | 0,
                                                ClientState.baseY | 0,
                                                osrsClient.expandedMapLoading | 0,
                                            );
                                        } catch {}
                                    },
                                },
                                Lod: {
                                    value: osrsClient.lodDistance,
                                    min: 0,
                                    max: 512,
                                    step: 1,
                                    label: "LOD distance (tiles)",
                                    onChange: (v: number) => {
                                        osrsClient.lodDistance = v;
                                    },
                                },
                            },
                            { collapsed: true },
                        ),
                    },
                    { collapsed: false },
                ),
                ...(osrsClient.loadedCache
                    ? {
                          Cache: folder(
                              {
                                  Version: {
                                      value: osrsClient.loadedCache.info.name,
                                      options: osrsClient.cacheList.caches.map(
                                          (cache) => cache.name,
                                      ),
                                      onChange: async (v: string) => {
                                          const cacheInfo = osrsClient.cacheList.caches.find(
                                              (cache) => cache.name === v,
                                          );
                                          if (
                                              v !== osrsClient.loadedCache?.info.name &&
                                              cacheInfo
                                          ) {
                                              const loadedCache = await loadCacheFiles(
                                                  cacheInfo,
                                                  undefined,
                                                  setDownloadProgress,
                                                  [
                                                      IndexType.DAT2.interfaces,
                                                      IndexType.DAT2.fonts,
                                                      IndexType.DAT2.clientScript,
                                                      IndexType.DAT2.musicTracks,
                                                      IndexType.DAT2.musicSamples,
                                                      IndexType.DAT2.musicPatches,
                                                  ],
                                              );
                                              osrsClient.initCache(loadedCache);
                                              setDownloadProgress(undefined);
                                          }
                                      },
                                  },
                              },
                              { collapsed: true },
                          ),
                      }
                    : {}),
                // Top-level Player folder as provided by renderer
                ...(playerFolder ? { Player: playerFolder } : {}),
                Render: folder(
                    {
                        Renderer: {
                            value: renderer.type,
                            options: rendererOptions,
                            onChange: (v: OsrsRendererType) => {
                                if (renderer.type !== v) {
                                    const renderer = createRenderer(v, osrsClient);
                                    osrsClient.setRenderer(renderer);
                                    setRenderer(renderer);
                                }
                            },
                        },
                        "Fps Limit": {
                            value: osrsClient.targetFps,
                            min: 0,
                            max: 999,
                            onChange: (v: number) => {
                                osrsClient.setTargetFps(v);
                            },
                        },
                        Profiler: {
                            value: profiler.enabled,
                            onChange: (v: boolean) => {
                                profiler.enabled = !!v;
                            },
                        },
                        "Profiler Verbose": {
                            value: profiler.verbose,
                            onChange: (v: boolean) => {
                                profiler.verbose = !!v;
                            },
                        },
                        ...rendererSchema,
                    },
                    { collapsed: true },
                ),
                Vars: folder(
                    {
                        Type: {
                            value: varType,
                            options: {
                                Varplayer: VarType.VARP,
                                Varbit: VarType.VARBIT,
                            },
                            onChange: setVarType,
                        },
                        Id: {
                            value: varId,
                            step: 1,
                            onChange: setVarId,
                        },
                        Value: {
                            value: varValue,
                            step: 1,
                            onChange: setVarValue,
                        },
                        Set: button(() => {
                            const varManager = osrsClient.varManager;
                            let updated = false;
                            if (varType === VarType.VARP) {
                                updated = varManager.setVarp(varId, varValue);
                            } else {
                                updated = varManager.setVarbit(varId, varValue);
                            }
                            if (updated) {
                                osrsClient.updateVars();
                                osrsClient.renderer.mapManager.clearMaps();
                            }
                        }),
                        Clear: button(() => {
                            osrsClient.varManager.clear();
                            osrsClient.updateVars();
                            osrsClient.renderer.mapManager.clearMaps();
                        }),
                    },
                    { collapsed: true },
                ),
                Menu: folder(
                    {
                        Tooltips: {
                            value: osrsClient.tooltips,
                            onChange: (v: boolean) => {
                                osrsClient.tooltips = v;
                            },
                        },
                        "Debug Id": {
                            value: osrsClient.debugId,
                            onChange: (v: boolean) => {
                                osrsClient.debugId = v;
                            },
                        },
                    },
                    { collapsed: true },
                ),
                DevTools: folder(
                    {
                        "Object Tile IDs": {
                            value: osrsClient.showObjectTileIds,
                            onChange: (v: boolean) => {
                                osrsClient.showObjectTileIds = !!v;
                            },
                        },
                        "Collision Overlay": {
                            value: osrsClient.showCollisionOverlay,
                            onChange: (v: boolean) => {
                                osrsClient.showCollisionOverlay = !!v;
                            },
                        },
                        "Object Bounds (purple)": {
                            value: false,
                            onChange: (v: boolean) => {
                                const renderer = osrsClient.renderer as DebugOverlayRenderer;
                                if (renderer.objectBoundsOverlay) {
                                    renderer.objectBoundsOverlay.enabled = !!v;
                                }
                            },
                        },
                        "Server Path Overlay": {
                            value: osrsClient.showServerPathOverlay,
                            onChange: (v: boolean) => {
                                osrsClient.showServerPathOverlay = !!v;
                            },
                        },
                        "Collision Radius": {
                            value: osrsClient.collisionOverlayRadius,
                            min: 1,
                            max: 48,
                            step: 1,
                            onChange: (v: number) => {
                                osrsClient.collisionOverlayRadius = v | 0;
                            },
                        },
                        "Show Widgets": {
                            value: true,
                            onChange: (v: boolean) => {
                                // Find the widgets overlay and toggle it
                                const renderer = osrsClient.renderer as DebugOverlayRenderer;
                                if (renderer.widgetsOverlay) {
                                    renderer.widgetsOverlay.enabled = v;
                                    console.log("Widgets overlay:", v ? "enabled" : "disabled");
                                }
                            },
                        },
                        // Simplified devoverlay: draw only tile borders with red/green edges; no mode selector
                    },
                    { collapsed: true },
                ),
                Record: folder(recordSchema, { collapsed: true }),
                Export: folder(
                    {
                        "Export Sprites": button(
                            () => {
                                if (isExportingSprites || !osrsClient.loadedCache) {
                                    return;
                                }
                                setExportingSprites(true);
                                const cacheName = osrsClient.loadedCache.info.name;
                                osrsClient.workerPool
                                    .exportSprites()
                                    .then((zipBlob) => {
                                        FileSaver.saveAs(zipBlob, `sprites_${cacheName}.zip`);
                                    })
                                    .finally(() => {
                                        setExportingSprites(false);
                                    });
                            },
                            { disabled: isExportingSprites },
                        ),
                        "Export Textures": button(
                            () => {
                                if (isExportingTextures || !osrsClient.loadedCache) {
                                    return;
                                }
                                setExportingTextures(true);
                                const cacheName = osrsClient.loadedCache.info.name;
                                osrsClient.workerPool
                                    .exportTextures()
                                    .then((zipBlob) => {
                                        FileSaver.saveAs(zipBlob, `textures_${cacheName}.zip`);
                                    })
                                    .finally(() => {
                                        setExportingTextures(false);
                                    });
                            },
                            { disabled: isExportingTextures },
                        ),
                    },
                    { collapsed: true },
                ),
            },
            [
                renderer,
                projectionType,
                varType,
                varId,
                varValue,
                pointsControls,
                isCameraRunning,
                isExportingSprites,
                isExportingTextures,
            ],
        );

        return (
            <div className="leva-left">
                <Leva
                    titleBar={{ filter: false }}
                    collapsed={true}
                    hideCopyButton={true}
                    hidden={hidden}
                />
            </div>
        );
    },
);

function createCameraControls(osrsClient: OsrsClient): Schema {
    if (osrsClient.camera.projectionType === ProjectionType.PERSPECTIVE) {
        return {};
    } else {
        return {
            "Ortho Zoom": {
                value: osrsClient.camera.orthoZoom,
                min: 1,
                max: 60,
                step: 1,
                onChange: (v: number) => {
                    osrsClient.camera.orthoZoom = v;
                },
            },
        };
    }
}

import Denque from "denque";
import { applyDuelWorldMenu, canAttackDuelPlayer } from "../../../game/duel/DuelWorldMenu";
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
import { RENDER_CONSTANTS, formatPlayerCombatLabel } from "../constants";

export function checkInteractions(host: WebGLOsrsRendererHost, ): void {

        const frameCount = host.stats.frameCount;
        host.lastInteractionRaycastHitCount = 0;
        host.lastInteractionMenuOptionCount = 0;
        let raycastHitCount = 0;

        const inputManager = host.osrsClient.inputManager;
        const isMouseDown = inputManager.dragX !== -1 || inputManager.dragY !== -1;
        const pickX = inputManager.pickX;
        const pickY = inputManager.pickY;
        const picked = pickX !== -1 && pickY !== -1;
        const leftClicked = inputManager.leftClickX !== -1 && inputManager.leftClickY !== -1;

        // If the click is inside the bottom-right UI tabs region, consume it (don't interact with world).
        if (leftClicked) {
            const contW = 241;
            const contH = 37 + 261 + 37; // strip + panel + strip
            const contX = host.app.width - 8 - contW; // right margin 8
            const contY = host.app.height - 8 - contH; // bottom margin 8
            const mx = inputManager.leftClickX;
            const my = inputManager.leftClickY;
            if (mx >= contX && mx <= contX + contW && my >= contY && my <= contY + contH) {
                host.clearInteractHighlightHoverTarget();
                return;
            }
        }

        const menuCooldown = isTouchDevice ? 50 : 10;

        if (
            (inputManager.mouseX === -1 ||
                inputManager.mouseY === -1 ||
                frameCount - host.osrsClient.menuOpenedFrame < menuCooldown) &&
            !leftClicked
        ) {
            if (inputManager.mouseX === -1 || inputManager.mouseY === -1) {
                host.clearInteractHighlightHoverTarget();
            }
            return;
        }

        // Don't auto close menu on touch devices
        if (host.osrsClient.menuOpen && !picked && !isMouseDown && isTouchDevice) {
            return;
        }

        if (!picked && !leftClicked && !host.osrsClient.tooltips) {
            host.osrsClient.closeMenu();
            host.clearInteractHighlightHoverTarget();
            return;
        }

        const usingPinnedMenu =
            host.osrsClient.menuOpen &&
            !!host.osrsClient.menuPinnedEntries &&
            host.osrsClient.menuPinnedEntries.length > 0;
        // PERF: Reuse cached array and copy entries in-place instead of .slice()
        const menuEntries = host.cachedMenuEntries;
        menuEntries.length = 0;
        if (usingPinnedMenu) {
            for (let i = 0; i < host.osrsClient.menuPinnedEntries!.length; i++) {
                menuEntries.push(host.osrsClient.menuPinnedEntries![i]);
            }
        }

        const hasActiveSpell = ClientState.isSpellSelected;
        // PERF: Reuse cached spell object instead of creating new one each frame
        let activeSpell = host.cachedActiveSpell;
        if (hasActiveSpell) {
            if (!activeSpell) {
                activeSpell = {
                    spellId: 0,
                    spellName: "",
                    actionName: "",
                    spellLevel: 0,
                    runes: null,
                    targetMask: 0,
                };
                host.cachedActiveSpell = activeSpell;
            }
            activeSpell.spellId = ClientState.selectedSpellId;
            activeSpell.spellName = ClientState.selectedSpellName;
            activeSpell.actionName = ClientState.selectedSpellActionName;
            activeSpell.spellLevel = ClientState.selectedSpellLevel;
            activeSpell.runes = ClientState.selectedSpellRunes;
            activeSpell.targetMask = ClientState.selectedSpellTargetMask;
        } else {
            activeSpell = null;
        }
        // world "Use" targeting is driven by ClientState.isItemSelected (not inventory UI selection).
        const hasSelectedItem =
            ClientState.isItemSelected === 1 && (ClientState.selectedItemId | 0) > 0;
        const selectedItemName = String(ClientState.selectedSpellName || "");
        const anchorX = picked ? pickX : inputManager.mouseX;
        const anchorY = picked ? pickY : inputManager.mouseY;
        const anchorInSceneViewport = host.osrsClient.camera.containsScreenPoint(anchorX, anchorY);

        // Only build world menu entries (NPCs, objects, Walk here) when mouse is NOT
        // over an interactive widget. In resizable mode, viewport covers the whole screen but
        // widgets (inventory, chat, etc.) are layered on top and should capture clicks.
        // Check if mouse is in a UI region (chatbox, minimap, sidebar)
        // The client uses dynamic region checks based on frame dimensions
        // PERF: Inline check instead of IIFE to avoid per-frame function allocation
        const mouseInUIRegion = host.isMouseInUIRegion(anchorX, anchorY);
        // Also treat any visible widget/modal capture under the pointer as UI.
        // This prevents world hover/menu fallbacks ("Walk here") from leaking through modal overlays.
        const mouseOverWidget =
            anchorX !== -1 && anchorY !== -1
                ? host.osrsClient.isPointOverWidget(anchorX, anchorY)
                : false;

        // Build world menu entries only if:
        // 1. Not using a pinned menu
        // 2. Mouse is not in a static UI region (chatbox, minimap, sidebar)
        // 3. Mouse is not over any blocking widget/modal capture
        if (!usingPinnedMenu && !mouseInUIRegion && !mouseOverWidget) {
            // base menu always starts with Cancel.
            menuEntries.push({
                option: "Cancel",
                targetId: -1,
                targetType: MenuTargetType.NONE,
                targetName: "",
                targetLevel: -1,
            });
        }

        if (!usingPinnedMenu && !mouseInUIRegion && !mouseOverWidget && anchorInSceneViewport) {
            // PERF: Reuse cached arrays/sets instead of allocating new ones each frame
            const locIds = host.cachedLocIds;
            locIds.clear();
            const objIds = host.cachedObjIds;
            objIds.clear();
            const npcIds = host.cachedNpcIds;
            npcIds.clear();
            const playerIds = host.cachedPlayerIds;
            playerIds.clear();
            const hoveredTile = host.osrsClient.hoveredTile;

            // add Walk here only when no item/spell is selected.
            const baseX = (ClientState.baseX | 0) as number;
            const baseY = (ClientState.baseY | 0) as number;
            const anchorTile = host.computeTileAt(anchorX, anchorY);
            let walkHereEntry: OsrsMenuEntry | undefined = undefined;
            if (ClientState.isItemSelected === 0 && !ClientState.isSpellSelected) {
                const walkTile = anchorTile ?? host.osrsClient.menuTile ?? hoveredTile;
                const tileX = (walkTile?.tileX ?? 0) | 0;
                const tileY = (walkTile?.tileY ?? 0) | 0;
                const localX = (tileX - baseX) | 0;
                const localY = (tileY - baseY) | 0;
                walkHereEntry = {
                    option: "Walk here",
                    targetId: -1,
                    targetType: MenuTargetType.NONE,
                    targetName: "",
                    targetLevel: -1,
                    mapX: localX,
                    mapY: localY,
                    tile: walkTile ? { tileX, tileY, plane: (walkTile as any)?.plane } : undefined,
                    onClick: (_entry, evt?: MouseEvent) => {
                        try {
                            if (isServerConnected()) sendInteractStop();
                        } catch {}
                        // use the tile determined at menu creation
                        // time, not a re-raycast.  The camera may have shifted
                        // while the menu was open, making a second computeTileAt
                        // return the wrong tile.
                        const wx = tileX;
                        const wy = tileY;
                        if (wx > 0 && wy > 0) {
                            const xy = host.toGLClickXY(evt);
                            menuAction(
                                (wx - baseX) | 0,
                                (wy - baseY) | 0,
                                MenuOpcode.WalkHere,
                                0,
                                -1,
                                "Walk here",
                                "",
                                xy.sx,
                                xy.sy,
                            );
                            try {
                                host.spawnClickCross(
                                    { tileX: wx, tileY: wy, plane: (walkTile as any)?.plane },
                                    xy,
                                    "yellow",
                                );
                            } catch {}
                        }
                        host.osrsClient.closeMenu();
                    },
                };
                menuEntries.push(walkHereEntry);
            }

            const ray = host.screenToRay(anchorX, anchorY);
            // scene interactions are filtered by the current client plane
            // (raw server plane), not the bridge-promoted render plane.
            const interactionPlane = host.getPlayerRawPlane() | 0;
            const raycastHits =
                ray && host.sceneRaycaster
                    ? host.sceneRaycaster.raycast(ray, {
                        maxHits: 1000,
                        basePlane: interactionPlane,
                    })
                    : [];
            raycastHitCount = raycastHits.length | 0;

            const npcEcs = host.osrsClient.npcEcs;
            const playerEcs = host.osrsClient.playerEcs;
            const normalizePlayerName = (name: string | undefined): string => {
                return String(name ?? "")
                    .replace(/<[^>]*>/g, "")
                    .trim()
                    .toLowerCase();
            };
            const clanMemberNames = new Set<string>();
            try {
                const cs2Ctx: any = host.osrsClient.cs2Vm?.context;
                const addName = (raw: unknown): void => {
                    if (typeof raw !== "string") return;
                    const normalized = normalizePlayerName(raw);
                    if (normalized.length > 0) clanMemberNames.add(normalized);
                };
                const addListByField = (list: unknown, fieldName: string): void => {
                    if (!Array.isArray(list)) return;
                    for (const entry of list) {
                        addName((entry as any)?.[fieldName]);
                    }
                };
                const addNameList = (list: unknown): void => {
                    if (!Array.isArray(list)) return;
                    for (const entry of list) addName(entry);
                };
                addListByField(cs2Ctx?.clanMembers, "name");
                addNameList(cs2Ctx?.clanSettings?.memberNames);
                addNameList(cs2Ctx?.clanChannel?.userNames);
            } catch {}
            const isClanMemberName = (name: string | undefined): boolean => {
                const normalized = normalizePlayerName(name);
                return normalized.length > 0 && clanMemberNames.has(normalized);
            };

            const addPlayerMenuEntries = (
                ecsIndex: number,
                worldTileX: number,
                worldTileY: number,
            ): void => {
                const idx = ecsIndex | 0;
                if (idx < 0) return;
                if (playerIds.has(idx)) return;
                playerIds.add(idx);

                const sidRaw = playerEcs.getServerIdForIndex?.(idx);
                const sid = (typeof sidRaw === "number" ? sidRaw | 0 : idx | 0) | 0;
                const myId = host.osrsClient.controlledPlayerServerId | 0;
                if ((sid | 0) === (myId | 0)) return;

                const displayName = playerEcs.getName(idx);
                const playerLabel = displayName || "Player";
                const localX = (worldTileX - baseX) | 0;
                const localY = (worldTileY - baseY) | 0;
                const playerPlane = playerEcs.getLevel(idx) | 0;
                const targetCombatLevel = playerEcs.getCombatLevel(idx) | 0;
                const targetTeam = playerEcs.getTeam(idx) | 0;
                const localEcsIndex = playerEcs.getIndexForServerId?.(myId);
                const localCombatLevelFromEcs =
                    typeof localEcsIndex === "number"
                        ? playerEcs.getCombatLevel(localEcsIndex | 0) | 0
                        : 0;
                const localCombatLevel =
                    localCombatLevelFromEcs > 0
                        ? localCombatLevelFromEcs
                        : ClientState.localPlayerCombatLevel | 0;
                // Plain name for PLAYER menu rows; osrsTargetLabel appends colored (level-N)
                // from targetLevel — same path as NPCs. Walk-here is MenuTargetType.NONE so
                // it needs the level baked into the string via formatPlayerCombatLabel.
                const playerWalkLabel = formatPlayerCombatLabel(
                    playerLabel,
                    localCombatLevel,
                    targetCombatLevel,
                );
                const localTeam =
                    typeof localEcsIndex === "number"
                        ? playerEcs.getTeam(localEcsIndex | 0) | 0
                        : 0;
                const localWorldX =
                    typeof localEcsIndex === "number"
                        ? playerEcs.getX(localEcsIndex | 0) >> 7
                        : 0;
                const localWorldY =
                    typeof localEcsIndex === "number"
                        ? playerEcs.getY(localEcsIndex | 0) >> 7
                        : 0;
                const canAttackPlayers = host.osrsClient.duelArenaMode
                    ? canAttackDuelPlayer(sid)
                    : isInWilderness(localWorldX, localWorldY);
                const targetIsClanMember = isClanMemberName(playerLabel);

                // When hovering a player, Walk here target becomes the player's label.
                if (walkHereEntry) {
                    walkHereEntry.targetName = `<col=ffffff>${playerWalkLabel}`;
                }

                // Item selection: Use only (HttpHeaders.addPlayerToMenu).
                if (ClientState.isItemSelected === 1) {
                    const itemName =
                        selectedItemName || `Item ${ClientState.selectedItemId | 0 || 0}`;
                    menuEntries.push({
                        option: "Use",
                        targetId: -1,
                        targetType: MenuTargetType.PLAYER,
                        targetName: `${itemName} -> ${playerLabel}`,
                        targetLevel: targetCombatLevel,
                        mapX: localX,
                        mapY: localY,
                        playerServerId: sid | 0,
                        tile: { tileX: worldTileX, tileY: worldTileY, plane: playerPlane },
                        onClick: (entry?: any) =>
                            host.osrsClient.useSelectedItemOnFromMenu(
                                (entry as any) ?? ({} as any),
                                {
                                    playerServerId: sid | 0,
                                    mapX: localX,
                                    mapY: localY,
                                    tile: {
                                        tileX: worldTileX,
                                        tileY: worldTileY,
                                        plane: playerPlane,
                                    },
                                },
                            ),
                    });
                    return;
                }

                // Spell selection: Cast only when targetable (HttpHeaders.addPlayerToMenu).
                if (ClientState.isSpellSelected) {
                    if (hasActiveSpell && activeSpell && canTargetPlayer(activeSpell.targetMask)) {
                        menuEntries.push({
                            option: activeSpell.actionName || "Cast",
                            targetId: -1,
                            targetType: MenuTargetType.PLAYER,
                            targetName: `${activeSpell.spellName} -> ${playerLabel}`,
                            targetLevel: targetCombatLevel,
                            mapX: localX,
                            mapY: localY,
                            playerServerId: sid | 0,
                            spellCast: {
                                spellId: activeSpell.spellId,
                                spellName: activeSpell.spellName,
                                spellLevel: activeSpell.spellLevel,
                                runes: activeSpell.runes,
                                playerServerId: sid | 0,
                            },
                        });
                    }
                    return;
                }

                // No selection: insert player actions in 7..0 order.
                for (let actionIdx = 7; actionIdx >= 0; actionIdx--) {
                    if (actionIdx === 2) {
                        menuEntries.push({
                            option: "Follow",
                            targetId: sid | 0,
                            targetType: MenuTargetType.PLAYER,
                            targetName: playerLabel,
                            targetLevel: targetCombatLevel,
                            mapX: localX,
                            mapY: localY,
                            playerServerId: sid | 0,
                            actionIndex: 2, // OPPLAYER3 - Follow
                            onClick: () => {
                                try {
                                    host.osrsClient.playerInteractionSystem.beginFollow(sid | 0);
                                    if (isServerConnected()) sendInteractFollow(sid | 0, "follow");
                                } catch {}
                            },
                        });
                    } else if (actionIdx === 1) {
                        // OSRS: Trade is typically a low-priority player option from the server.
                        menuEntries.push({
                            option: "Trade with",
                            targetId: sid | 0,
                            targetType: MenuTargetType.PLAYER,
                            targetName: playerLabel,
                            targetLevel: targetCombatLevel,
                            mapX: localX,
                            mapY: localY,
                            playerServerId: sid | 0,
                            actionIndex: 1, // OPPLAYER2 - Trade with
                            deprioritized: true,
                            onClick: () => {
                                try {
                                    host.osrsClient.playerInteractionSystem.beginTrade(sid | 0);
                                    if (isServerConnected()) sendInteractFollow(sid | 0, "trade");
                                } catch {}
                            },
                        });
                    } else if (actionIdx === 0) {
                        // Player combat is a Wilderness-only menu action.
                        if (!canAttackPlayers) continue;
                        const attackOption = ClientState.playerAttackOption | 0;
                        if (attackOption === 3) continue;

                        let deprioritized = false;
                        if (attackOption === 1) {
                            deprioritized = true;
                        } else if (attackOption === 0) {
                            deprioritized = targetCombatLevel > localCombatLevel;
                        } else if (attackOption === 4) {
                            deprioritized = targetIsClanMember;
                        }

                        // Team logic overrides attack option priority when both players have teams.
                        if (localTeam !== 0 && targetTeam !== 0) {
                            deprioritized = localTeam === targetTeam;
                        }

                        menuEntries.push({
                            option: "Attack",
                            targetId: sid | 0,
                            targetType: MenuTargetType.PLAYER,
                            targetName: playerLabel,
                            targetLevel: targetCombatLevel,
                            mapX: localX,
                            mapY: localY,
                            playerServerId: sid | 0,
                            actionIndex: 0, // OPPLAYER1 - Attack
                            deprioritized,
                            onClick: () => {
                                try {
                                    host.osrsClient.playerInteractionSystem.beginCombat(sid | 0, {
                                        targetType: "player",
                                        tile: { x: localX | 0, y: localY | 0 },
                                    });
                                } catch {}
                            },
                        });
                    }
                }
            };

            const addNpcMenuEntries = (
                npcTypeId: number,
                npcServerId: number,
                npcEcsId: number,
                worldTileX: number,
                worldTileY: number,
            ): void => {
                const sid = npcServerId | 0;
                const ecsId = npcEcsId | 0;
                if (sid <= 0 || ecsId <= 0) return;
                if (npcIds.has(sid)) return;
                npcIds.add(sid);

                let npcType = host.osrsClient.npcTypeLoader.load(npcTypeId | 0);
                if (npcType.transforms) {
                    const transformed = npcType.transform(
                        host.osrsClient.varManager,
                        host.osrsClient.npcTypeLoader,
                    );
                    if (transformed) npcType = transformed;
                }
                if (npcType.name === "null" && !host.osrsClient.debugId) return;
                if (npcType.isFollower && (ClientState.followerIndex | 0) !== (sid | 0)) {
                    return;
                }

                const localX = (worldTileX - baseX) | 0;
                const localY = (worldTileY - baseY) | 0;
                const npcPlane = npcEcs.getLevel(ecsId) | 0;
                const isFollowerLowPriority =
                    npcType.isFollower && ClientState.followerOpsLowPriority;

                // OSRS: For followers with low priority, insert Examine first (opcode 1003).
                if (isFollowerLowPriority) {
                    menuEntries.push({
                        option: "Examine",
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                    });
                }

                // Item selection: Use only (opcode 7), except follower examine above remains.
                if (ClientState.isItemSelected === 1) {
                    const itemName =
                        selectedItemName || `Item ${ClientState.selectedItemId | 0 || 0}`;
                    menuEntries.push({
                        option: "Use",
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: `${itemName} -> ${npcType.name}`,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                        tile: { tileX: worldTileX, tileY: worldTileY, plane: npcPlane },
                        onClick: (entry?: any) =>
                            host.osrsClient.useSelectedItemOnFromMenu(
                                (entry as any) ?? ({} as any),
                                {
                                    npcServerId: sid | 0,
                                    mapX: localX,
                                    mapY: localY,
                                    tile: { tileX: worldTileX, tileY: worldTileY, plane: npcPlane },
                                },
                            ),
                    });
                    return;
                }

                // Spell selection: Cast only when targetable (opcode 8), except follower examine above remains.
                if (ClientState.isSpellSelected) {
                    if (hasActiveSpell && activeSpell && canTargetNpc(activeSpell.targetMask)) {
                        menuEntries.push({
                            option: activeSpell.actionName || "Cast",
                            targetId: npcType.id,
                            targetType: MenuTargetType.NPC,
                            npcServerId: sid | 0,
                            targetName: `${activeSpell.spellName} -> ${npcType.name}`,
                            targetLevel: npcType.combatLevel,
                            mapX: localX,
                            mapY: localY,
                            spellCast: {
                                spellId: activeSpell.spellId,
                                spellName: activeSpell.spellName,
                                spellLevel: activeSpell.spellLevel,
                                runes: activeSpell.runes,
                                npcServerId: sid | 0,
                                mapX: localX,
                                mapY: localY,
                            },
                        });
                    }
                    return;
                }

                const actions = npcType.actions ?? [];
                const followerDeprioritized = isFollowerLowPriority;

                // OSRS: Non-attack options first (4..0).
                for (let actionIdx = 4; actionIdx >= 0; actionIdx--) {
                    const option = actions[actionIdx];
                    if (!option) continue;
                    if (option.toLowerCase() === "attack") continue;
                    const opt = option;
                    menuEntries.push({
                        option: opt,
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                        actionIndex: actionIdx,
                        deprioritized: followerDeprioritized,
                        onClick: (_entry?: any, _evt?: any, ctx?: any) => {
                            // When called as a side-effect by MenuState.invoke (worldMenuStateDispatch),
                            // menuAction already handles packet dispatch.
                            if (ctx?.worldMenuStateDispatch) return;
                            try {
                                host.osrsClient.interactNpc({
                                    npcServerId: sid | 0,
                                    option: opt,
                                    actionIndex: actionIdx,
                                    mapX: localX | 0,
                                    mapY: localY | 0,
                                    tile: { tileX: worldTileX | 0, tileY: worldTileY | 0 },
                                });
                            } catch {}
                            host.osrsClient.closeMenu();
                        },
                    });
                }

                // OSRS: Attack options after non-attack (4..0) with npcAttackOption deprioritization.
                for (let actionIdx = 4; actionIdx >= 0; actionIdx--) {
                    const option = actions[actionIdx];
                    if (!option) continue;
                    if (option.toLowerCase() !== "attack") continue;
                    if (ClientState.npcAttackOption === 3) continue;

                    let deprioritized = false;
                    const attackOption = ClientState.npcAttackOption | 0;
                    if (attackOption === 1) {
                        deprioritized = true;
                    } else if (attackOption === 0) {
                        const npcLevel = (npcType.combatLevel ?? 0) | 0;
                        const playerLevel = ClientState.localPlayerCombatLevel | 0 | 0;
                        if (npcLevel > playerLevel) deprioritized = true;
                    }

                    menuEntries.push({
                        option,
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                        actionIndex: actionIdx,
                        deprioritized,
                        onClick: (_entry?: any, _evt?: any, ctx?: any) => {
                            if (ctx?.worldMenuStateDispatch) return;
                            try {
                                host.osrsClient.attackNpc({
                                    npcServerId: sid | 0,
                                    actionIndex: actionIdx,
                                    mapX: localX | 0,
                                    mapY: localY | 0,
                                    tile: { tileX: worldTileX | 0, tileY: worldTileY | 0 },
                                });
                            } catch {}
                            host.osrsClient.closeMenu();
                        },
                    });
                }

                // OSRS: Examine at the bottom for non-followers / normal priority followers.
                if (!isFollowerLowPriority) {
                    menuEntries.push({
                        option: "Examine",
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        npcServerId: sid | 0,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        mapX: localX,
                        mapY: localY,
                    });
                }
            };

            // Process raycast hits to build menu entries
            let lastTagKey: string | null = null;
            for (let hitIndex = raycastHits.length - 1; hitIndex >= 0; hitIndex--) {
                const hit = raycastHits[hitIndex];
                const interactId = hit.interactId | 0;
                const interactType = hit.interactType;
                const tagKey = `${interactType}|${interactId}|${hit.tileX ?? ""}|${
                    hit.tileY ?? ""
                }|${hit.npcServerId ?? ""}|${hit.playerEcsIndex ?? ""}`;
                if (tagKey === lastTagKey) continue;
                lastTagKey = tagKey;

                if (interactType === InteractType.LOC) {
                    const baseLocType = host.osrsClient.locTypeLoader.load(interactId);
                    if (!baseLocType) continue;
                    let resolvedLocType = baseLocType;
                    if (baseLocType?.transforms) {
                        const transformed = baseLocType.transform(
                            host.osrsClient.varManager,
                            host.osrsClient.locTypeLoader,
                        );
                        if (transformed) {
                            resolvedLocType = transformed;
                        }
                    }
                    if (resolvedLocType.name === "null" && !host.osrsClient.debugId) continue;

                    const worldTileX = (hit.tileX ?? 0) | 0;
                    const worldTileY = (hit.tileY ?? 0) | 0;
                    const localX = (worldTileX - baseX) | 0;
                    const localY = (worldTileY - baseY) | 0;

                    const dedupeKey = `${interactId | 0}|${localX | 0}|${localY | 0}`;
                    if (locIds.has(dedupeKey)) continue;
                    locIds.add(dedupeKey);

                    // Item selection suppresses normal actions/examine.
                    if (ClientState.isItemSelected === 1) {
                        const itemName =
                            selectedItemName || `Item ${ClientState.selectedItemId | 0 || 0}`;
                        menuEntries.push({
                            option: "Use",
                            targetId: interactId,
                            targetType: MenuTargetType.LOC,
                            targetName: `${itemName} -> ${resolvedLocType.name}`,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                            onClick: (entry?: any) =>
                                host.osrsClient.useSelectedItemOnFromMenu(
                                    (entry as any) ?? ({} as any),
                                    { mapX: localX, mapY: localY },
                                ),
                        });
                        continue;
                    }

                    // Spell selection suppresses normal actions/examine.
                    if (ClientState.isSpellSelected) {
                        if (
                            hasActiveSpell &&
                            activeSpell &&
                            canTargetObject(activeSpell.targetMask)
                        ) {
                            menuEntries.push({
                                option: activeSpell.actionName || "Cast",
                                targetId: interactId,
                                targetType: MenuTargetType.LOC,
                                targetName: `${activeSpell.spellName} -> ${resolvedLocType.name}`,
                                targetLevel: -1,
                                mapX: localX,
                                mapY: localY,
                                spellCast: {
                                    spellId: activeSpell.spellId,
                                    spellName: activeSpell.spellName,
                                    spellLevel: activeSpell.spellLevel,
                                    runes: activeSpell.runes,
                                    mapX: localX,
                                    mapY: localY,
                                },
                            });
                        }
                        continue;
                    }

                    // LOC actions inserted 4..0, then Examine.
                    for (let actionIdx = 4; actionIdx >= 0; actionIdx--) {
                        const option = resolvedLocType.actions?.[actionIdx];
                        if (!option) continue;
                        menuEntries.push({
                            option,
                            targetId: interactId,
                            targetType: MenuTargetType.LOC,
                            targetName: resolvedLocType.name,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                            actionIndex: actionIdx,
                        });
                    }

                    menuEntries.push({
                        option: "Examine",
                        targetId: interactId,
                        targetType: MenuTargetType.LOC,
                        targetName: resolvedLocType.name,
                        targetLevel: -1,
                        mapX: localX,
                        mapY: localY,
                    });
                } else if (interactType === InteractType.OBJ) {
                    // Ground items: build options for all stacks at the hovered tile (OSRS: type=3 tag).
                    const worldTileX = (hit.tileX ?? 0) | 0;
                    const worldTileY = (hit.tileY ?? 0) | 0;
                    const localX = (worldTileX - baseX) | 0;
                    const localY = (worldTileY - baseY) | 0;

                    // Ground items stay indexed by the raw client plane; bridge promotion is render-only.
                    const plane = resolveGroundItemStackPlane(host.getPlayerRawPlane() | 0);
                    const stacks = host.osrsClient.groundItems.getStacksAt(
                        worldTileX,
                        worldTileY,
                        plane,
                    );
                    if (!stacks || stacks.length === 0) continue;
                    const groundItemsPlugin = host.osrsClient.groundItemsPlugin;

                    const tileKey = `${localX}:${localY}`;
                    if (objIds.has(tileKey)) continue;
                    objIds.add(tileKey);

                    // Item selection: Use only (OSRS: opcode 16 per item, suppresses normal ops).
                    if (ClientState.isItemSelected === 1) {
                        const itemName =
                            selectedItemName || `Item ${ClientState.selectedItemId | 0 || 0}`;
                        for (const stack of stacks) {
                            const objType = host.osrsClient.objTypeLoader.load(stack.itemId);
                            if (!objType || objType.name === "null") continue;
                            const menuName = groundItemsPlugin.getMenuTargetName(
                                stack,
                                objType.name,
                            );
                            menuEntries.push({
                                option: "Use",
                                targetId: stack.itemId,
                                targetType: MenuTargetType.OBJ,
                                targetName: `${itemName} -> ${menuName}`,
                                targetLevel: -1,
                                mapX: localX,
                                mapY: localY,
                                tile: { tileX: worldTileX, tileY: worldTileY, plane },
                                onClick: (entry?: any) =>
                                    host.osrsClient.useSelectedItemOnFromMenu(
                                        (entry as any) ?? ({} as any),
                                        { tile: { tileX: worldTileX, tileY: worldTileY, plane } },
                                    ),
                            });
                        }
                        continue;
                    }

                    // Spell selection: Cast only when targetable (OSRS: opcode 17 per item).
                    if (ClientState.isSpellSelected) {
                        if (
                            hasActiveSpell &&
                            activeSpell &&
                            canTargetGroundItem(activeSpell.targetMask)
                        ) {
                            for (const stack of stacks) {
                                const objType = host.osrsClient.objTypeLoader.load(stack.itemId);
                                if (!objType || objType.name === "null") continue;
                                const menuName = groundItemsPlugin.getMenuTargetName(
                                    stack,
                                    objType.name,
                                );
                                menuEntries.push({
                                    option: activeSpell.actionName || "Cast",
                                    targetId: stack.itemId,
                                    targetType: MenuTargetType.OBJ,
                                    targetName: `${activeSpell.spellName} -> ${menuName}`,
                                    targetLevel: -1,
                                    mapX: localX,
                                    mapY: localY,
                                    spellCast: {
                                        spellId: activeSpell.spellId,
                                        spellName: activeSpell.spellName,
                                        spellLevel: activeSpell.spellLevel,
                                        runes: activeSpell.runes,
                                        mapX: localX,
                                        mapY: localY,
                                    },
                                });
                            }
                        }
                        continue;
                    }

                    // No selection: insert ground actions 4..0 with Take fallback at index 2, then Examine.
                    for (const stack of stacks) {
                        const objType = host.osrsClient.objTypeLoader.load(stack.itemId);
                        if (!objType || objType.name === "null") continue;
                        const menuName = groundItemsPlugin.getMenuTargetName(stack, objType.name);
                        const menuTarget = groundItemsPlugin.getMenuTargetColorized(
                            stack,
                            menuName,
                        );
                        const deprioritized = groundItemsPlugin.shouldDeprioritizeInMenu(stack);

                        const actions = objType.groundActions ?? [];
                        for (let actionIdx = 4; actionIdx >= 0; actionIdx--) {
                            const option = actions[actionIdx];
                            if (option) {
                                const capturedStack = stack;
                                menuEntries.push({
                                    option,
                                    targetId: stack.itemId,
                                    targetType: MenuTargetType.OBJ,
                                    targetName: menuTarget,
                                    targetLevel: -1,
                                    mapX: localX,
                                    mapY: localY,
                                    actionIndex: actionIdx,
                                    deprioritized,
                                    onClick:
                                        option.toLowerCase() === "take"
                                            ? () => host.osrsClient.takeGroundItem(capturedStack)
                                            : () => host.osrsClient.closeMenu(),
                                });
                            } else if (actionIdx === 2) {
                                const capturedStack = stack;
                                menuEntries.push({
                                    option: "Take",
                                    targetId: stack.itemId,
                                    targetType: MenuTargetType.OBJ,
                                    targetName: menuTarget,
                                    targetLevel: -1,
                                    mapX: localX,
                                    mapY: localY,
                                    actionIndex: 2,
                                    deprioritized,
                                    onClick: () => host.osrsClient.takeGroundItem(capturedStack),
                                });
                            }
                        }

                        menuEntries.push({
                            option: "Examine",
                            targetId: stack.itemId,
                            targetType: MenuTargetType.OBJ,
                            targetName: menuTarget,
                            targetLevel: -1,
                            mapX: localX,
                            mapY: localY,
                        });
                    }
                } else if (interactType === InteractType.NPC) {
                    // SceneRaycaster encodes players as InteractType.NPC with a high interactId offset.
                    const PLAYER_INTERACT_BASE = 0x8000;
                    if (interactId >= PLAYER_INTERACT_BASE) {
                        const ecsIndex = hit.playerEcsIndex;
                        if (ecsIndex == null) continue;

                        const playerSubX = playerEcs.getX(ecsIndex) | 0;
                        const playerSubY = playerEcs.getY(ecsIndex) | 0;
                        const worldTileX = (hit.tileX ?? (playerSubX >> 7) | 0) | 0;
                        const worldTileY = (hit.tileY ?? (playerSubY >> 7) | 0) | 0;

                        // OSRS X-ray menu: when centered on a tile, also add all entities at same coords.
                        if ((playerSubX & 127) === 64 && (playerSubY & 127) === 64) {
                            // NPCs at same coords (size=1)
                            const npcsAtTile = npcEcs.queryByTile(worldTileX, worldTileY);
                            for (const otherNpcEcsId of npcsAtTile) {
                                const otherId = otherNpcEcsId | 0;
                                if (otherId <= 0) continue;
                                if (!npcEcs.isActive(otherId) || !npcEcs.isLinked(otherId))
                                    continue;
                                if ((npcEcs.getSize(otherId) | 0) !== 1) continue;

                                const otherMapId = npcEcs.getMapId(otherId) | 0;
                                const otherMapX = (otherMapId >> 8) & 0xff;
                                const otherMapY = otherMapId & 0xff;
                                const otherLocalSubX = npcEcs.getX(otherId) | 0;
                                const otherLocalSubY = npcEcs.getY(otherId) | 0;
                                const otherWorldSubX = (otherMapX << 13) + otherLocalSubX;
                                const otherWorldSubY = (otherMapY << 13) + otherLocalSubY;
                                if (otherWorldSubX !== playerSubX || otherWorldSubY !== playerSubY)
                                    continue;

                                addNpcMenuEntries(
                                    npcEcs.getNpcTypeId(otherId) | 0,
                                    npcEcs.getServerId(otherId) | 0,
                                    otherId,
                                    worldTileX,
                                    worldTileY,
                                );
                            }

                            // Other players at same coords
                            for (const otherPlayerIndex of playerEcs.getAllActiveIndices()) {
                                const otherIdx = otherPlayerIndex | 0;
                                if (otherIdx === (ecsIndex | 0)) continue;
                                if ((playerEcs.getX(otherIdx) | 0) !== playerSubX) continue;
                                if ((playerEcs.getY(otherIdx) | 0) !== playerSubY) continue;
                                addPlayerMenuEntries(otherIdx, worldTileX, worldTileY);
                            }
                        }

                        addPlayerMenuEntries(ecsIndex, worldTileX, worldTileY);
                    } else {
                        const npcServerId = hit.npcServerId;
                        const npcEcsId = hit.npcEcsId;
                        if (npcServerId == null || npcEcsId == null) continue;

                        const worldTileX = (hit.tileX ?? 0) | 0;
                        const worldTileY = (hit.tileY ?? 0) | 0;

                        const ecsId = npcEcsId | 0;
                        const localSubX = npcEcs.getX(ecsId) | 0;
                        const localSubY = npcEcs.getY(ecsId) | 0;
                        const npcSize = npcEcs.getSize(ecsId) | 0;

                        // OSRS X-ray menu: when a size-1 NPC is centered on a tile, add all entities at same coords.
                        if (npcSize === 1 && (localSubX & 127) === 64 && (localSubY & 127) === 64) {
                            // Other NPCs on the same coords
                            const npcsAtTile = npcEcs.queryByTile(worldTileX, worldTileY);
                            for (const otherNpcEcsId of npcsAtTile) {
                                const otherId = otherNpcEcsId | 0;
                                if (otherId <= 0 || otherId === ecsId) continue;
                                if (!npcEcs.isActive(otherId) || !npcEcs.isLinked(otherId))
                                    continue;
                                if ((npcEcs.getSize(otherId) | 0) !== 1) continue;
                                const otherLocalSubX = npcEcs.getX(otherId) | 0;
                                const otherLocalSubY = npcEcs.getY(otherId) | 0;
                                if (otherLocalSubX !== localSubX || otherLocalSubY !== localSubY)
                                    continue;

                                addNpcMenuEntries(
                                    npcEcs.getNpcTypeId(otherId) | 0,
                                    npcEcs.getServerId(otherId) | 0,
                                    otherId,
                                    worldTileX,
                                    worldTileY,
                                );
                            }

                            // Players on the same coords
                            const hitMapId = hit.mapId | 0;
                            const hitMapX = (hitMapId >> 8) & 0xff;
                            const hitMapY = hitMapId & 0xff;
                            const npcWorldSubX = (hitMapX << 13) + localSubX;
                            const npcWorldSubY = (hitMapY << 13) + localSubY;

                            for (const otherPlayerIndex of playerEcs.getAllActiveIndices()) {
                                const otherIdx = otherPlayerIndex | 0;
                                if ((playerEcs.getX(otherIdx) | 0) !== npcWorldSubX) continue;
                                if ((playerEcs.getY(otherIdx) | 0) !== npcWorldSubY) continue;
                                addPlayerMenuEntries(otherIdx, worldTileX, worldTileY);
                            }
                        }

                        addNpcMenuEntries(
                            interactId | 0,
                            npcServerId | 0,
                            npcEcsId | 0,
                            worldTileX,
                            worldTileY,
                        );
                    }
                }
            }

            if (host.osrsClient.duelArenaMode) applyDuelWorldMenu(menuEntries);

            // Wrap NPC/LOC/PLAYER/OBJ entries to spawn a red cross when selected
            try {
                const tileForMenu = host.osrsClient.menuTile ?? hoveredTile;
                for (const e of menuEntries) {
                    if (
                        (e.targetType === MenuTargetType.NPC ||
                            e.targetType === MenuTargetType.LOC ||
                            e.targetType === MenuTargetType.PLAYER ||
                            e.targetType === MenuTargetType.OBJ) &&
                        e.option !== "Examine"
                    ) {
                        const orig = e.onClick;
                        e.onClick = (entry, evt?: MouseEvent, ctx?: unknown) =>
                            host.performWorldEntryAction(
                                e,
                                orig,
                                evt,
                                tileForMenu,
                                ctx as MenuClickContext | undefined,
                            );
                    }
                }
            } catch {}
        }
        const effectiveEntries =
            host.osrsClient.menuOpen &&
            host.osrsClient.menuPinnedEntries &&
            host.osrsClient.menuPinnedEntries.length > 0
                ? host.osrsClient.menuPinnedEntries
                : menuEntries;
        host.lastInteractionRaycastHitCount = raycastHitCount | 0;
        host.lastInteractionMenuOptionCount = effectiveEntries.length | 0;
        // PERF: Copy entries into cached array to avoid sharing reference with cachedMenuEntries
        // This prevents the array from being cleared at the start of the next frame
        const clientEntries = host.cachedClientMenuEntries;
        clientEntries.length = 0;
        for (let i = 0; i < effectiveEntries.length; i++) {
            clientEntries.push(effectiveEntries[i]);
        }
        host.osrsClient.menuEntries = clientEntries;
        let shouldFreeze = !!(
            host.osrsClient.menuOpen &&
            host.osrsClient.menuPinnedEntries &&
            host.osrsClient.menuPinnedEntries.length > 0
        );
        // PERF: Use cached bound toCssEvent function instead of creating closure each frame
        host.currentFrameCount = frameCount;
        let simpleEntries = host.buildSimpleMenuEntries(effectiveEntries, {
            shouldFreeze,
            toCssEvent: host.boundToCssEvent,
        });
        // Use shouldLeftClickOpenMenu which checks:
        // 1) leftClickOpensMenu setting && menuOptionsCount > 2
        // 2) OR top entry opcode is CC_OP_LowPriority (1007)
        // AND top entry is not shiftClickable
        const leftClickMenuToggle = !!(
            leftClicked &&
            !host.osrsClient.menuOpen &&
            shouldLeftClickOpenMenu(simpleEntries, !!host.osrsClient.settings?.leftClickOpensMenu)
        );
        if (leftClickMenuToggle) {
            host.osrsClient.menuOpen = true;
            host.osrsClient.menuOpenedFrame = frameCount;
            host.osrsClient.menuX = inputManager.leftClickX;
            host.osrsClient.menuY = inputManager.leftClickY;
            const clickedFromLeft = host.computeTileAt(
                inputManager.leftClickX,
                inputManager.leftClickY,
            );
            if (clickedFromLeft) {
                host.osrsClient.menuTile = clickedFromLeft;
                host.hoverTileX = clickedFromLeft.tileX;
                host.hoverTileY = clickedFromLeft.tileY;
                const cx = clickedFromLeft.tileX + 0.5;
                const cy = clickedFromLeft.tileY + 0.5;
                const clickedPlane = clickedFromLeft.plane;
                const h = host.sampleHeightAtExactPlane(cx, cy, clickedPlane);
                const scr = host.worldToScreen(cx, h - 0.1, cy);
                if (scr) {
                    host.osrsClient.hoveredTile = {
                        tileX: clickedFromLeft.tileX,
                        tileY: clickedFromLeft.tileY,
                        plane: clickedFromLeft.plane,
                    };
                    host.osrsClient.hoveredTileScreen = {
                        x: scr[0],
                        y: scr[1],
                    };
                }
            }
            try {
                host.osrsClient.menuPinnedEntries = menuEntries.slice();
                host.osrsClient.menuPinnedEntriesVersion++;
            } catch {}
            host.osrsClient.menuEntries = menuEntries.slice();
            shouldFreeze = true;
            simpleEntries = host.buildSimpleMenuEntries(menuEntries, {
                shouldFreeze: true,
                toCssEvent: host.boundToCssEvent,
            });
        }

        host.updateInteractHighlightHoverTarget(simpleEntries);

        // Handle left-click default action via the same menu interface as right-click
        // Skip if menu is open (choose-option.ts handles menu clicks)
        // Skip if click is in a UI region (region-based checks)
        // PERF: Reuse helper method instead of IIFE to avoid per-click function allocation
        const leftClickInUIRegion = leftClicked
            ? host.isMouseInUIRegion(inputManager.leftClickX, inputManager.leftClickY)
            : false;

        // block world interaction when a widget at the click point captures input.
        const hasUIClickTarget = leftClicked
            ? host.osrsClient.isPointOverWidget(inputManager.leftClickX, inputManager.leftClickY)
            : false;

        if (
            leftClicked &&
            !leftClickMenuToggle &&
            !host.osrsClient.menuOpen &&
            !leftClickInUIRegion &&
            !hasUIClickTarget
        ) {
            const clicked = host.computeTileAt(inputManager.leftClickX, inputManager.leftClickY);
            if (clicked) {
                host.osrsClient.menuTile = clicked;
                host.hoverTileX = clicked.tileX;
                host.hoverTileY = clicked.tileY;
            }
            const defaultEntry = chooseDefaultMenuEntry(simpleEntries, {
                hasSelectedSpell: ClientState.isSpellSelected,
                hasSelectedItem: ClientState.isItemSelected === 1,
            });
            // If an item/spell is selected and the default left-click is not Use/Cast, cancel selection like OSRS.
            const hasSelectedItem = ClientState.isItemSelected === 1;
            const hasSelectedSpell = ClientState.isSpellSelected;
            const act = defaultEntry?.action;

            // Cancel item selection if action is not Use/Cast
            if (hasSelectedItem && (!act || (act !== MenuAction.Use && act !== MenuAction.Cast))) {
                host.osrsClient.inventory?.setSelectedSlot?.(null);
                ClientState.clearItemSelection();
            }

            // Cancel spell selection if action is not Cast (clicking on non-targetable area)
            if (hasSelectedSpell && (!act || act !== MenuAction.Cast)) {
                host.osrsClient.clearSelectedSpell();
            }
            if (defaultEntry) {
                host.onInteractHighlightEntryInvoked(defaultEntry, clicked);
                const xy = host.toGLClickXY();
                const idx = defaultEntry.menuStateIndex;
                // For "Walk here", handle directly using clicked tile (menu coords may be stale)
                const isWalk = defaultEntry.option === "Walk here";
                if (isWalk && clicked) {
                    try {
                        if (isServerConnected()) sendInteractStop();
                    } catch {}
                    menuAction(
                        ((clicked.tileX | 0) - (ClientState.baseX | 0)) | 0,
                        ((clicked.tileY | 0) - (ClientState.baseY | 0)) | 0,
                        MenuOpcode.WalkHere,
                        0,
                        -1,
                        "Walk here",
                        "",
                        xy.sx,
                        xy.sy,
                    );
                    // No client prediction on click - wait for server
                    try {
                        host.spawnClickCross(clicked, xy, "yellow");
                    } catch {}
                    host.osrsClient.closeMenu();
                } else if (typeof idx === "number") {
                    try {
                        host.osrsClient.menuState.invoke(idx, xy.sx, xy.sy, {
                            source: "primary",
                        });
                    } catch {}
                } else if (typeof defaultEntry.onClick === "function") {
                    try {
                        defaultEntry.onClick(xy.sx, xy.sy);
                    } catch {}
                }
            } else if (clicked) {
                host.clearInteractHighlightActiveTarget();
                try {
                    // Fallback: route like Walk here
                    const sx = inputManager.leftClickX | 0;
                    const sy = inputManager.leftClickY | 0;
                    menuAction(
                        ((clicked.tileX | 0) - (ClientState.baseX | 0)) | 0,
                        ((clicked.tileY | 0) - (ClientState.baseY | 0)) | 0,
                        MenuOpcode.WalkHere,
                        0,
                        -1,
                        "Walk here",
                        "",
                        sx,
                        sy,
                    );
                    // No client prediction on click - wait for server
                    const playerPlane = host.getPlayerBasePlane() | 0;
                    const clickedPlane = clicked.plane ?? playerPlane;
                    host.clickCrossOverlay?.spawn(
                        clicked.tileX | 0,
                        clicked.tileY | 0,
                        sx,
                        sy,
                        clickedPlane,
                        undefined,
                        "yellow",
                    );
                } catch {}
            }
            host.osrsClient.menuOpen = false;
            host.osrsClient.menuPinnedEntries = undefined;
            host.osrsClient.menuEntries = [];
            return;
        }

        if (picked) {
            // Only open the world menu for picks over the world. Picks over UI
            // belong to the widget layer (which shows its own menu, falling back
            // to a Cancel-only one); flagging menuOpen here with no entries left
            // an invisible "open" menu that swallowed every left click, and
            // opening a Cancel menu here instead consumed the right-click before
            // the widget layer could build the real widget menu.
            const pickOverUi = mouseInUIRegion || mouseOverWidget;
            if (!pickOverUi) {
                host.osrsClient.menuOpen = true;
                host.osrsClient.menuOpenedFrame = frameCount;
            }
        }
        // If a pick event happened, anchor menu to the true click position and compute exact tile at click
        if (picked) {
            host.osrsClient.menuX = pickX;
            host.osrsClient.menuY = pickY;
            const clicked = host.computeTileAt(pickX, pickY);
            if (clicked) {
                host.osrsClient.menuTile = clicked;
                // Immediately reflect in hover devoverlay for this frame
                host.hoverTileX = clicked.tileX;
                host.hoverTileY = clicked.tileY;
                const cx = clicked.tileX + 0.5;
                const cy = clicked.tileY + 0.5;
                // Use the clicked plane directly and sample at exact height without promotion
                const clickedPlane = clicked.plane;
                const h = host.sampleHeightAtExactPlane(cx, cy, clickedPlane);
                const scr = host.worldToScreen(cx, h - 0.1, cy);
                if (scr) {
                    host.osrsClient.hoveredTile = {
                        tileX: clicked.tileX,
                        tileY: clicked.tileY,
                        plane: clicked.plane,
                    };
                    host.osrsClient.hoveredTileScreen = {
                        x: scr[0],
                        y: scr[1],
                    };
                }
            }
            // Pin the current entries so moving targets don't change the list while the menu is open
            try {
                host.osrsClient.menuPinnedEntries = menuEntries.slice();
                host.osrsClient.menuPinnedEntriesVersion++;
                host.osrsClient.menuFrozenSimpleEntries = undefined;
                host.osrsClient.menuFrozenSimpleEntriesVersion = 0;
            } catch {}
            inputManager.clearPick();
        } else if (!host.osrsClient.menuOpen) {
            // No pick this frame and menu not open: update hover anchor to follow mouse
            host.osrsClient.menuX = inputManager.mouseX;
            host.osrsClient.menuY = inputManager.mouseY;
            host.osrsClient.menuTile = undefined;
        }
        const pinnedActive =
            host.osrsClient.menuOpen &&
            !!host.osrsClient.menuPinnedEntries &&
            host.osrsClient.menuPinnedEntries.length > 0;
        if (pinnedActive && !shouldFreeze && host.osrsClient.menuPinnedEntries) {
            simpleEntries = host.buildSimpleMenuEntries(host.osrsClient.menuPinnedEntries, {
                shouldFreeze: true,
                toCssEvent: host.boundToCssEvent,
            });
            shouldFreeze = true;
        }

        // Handle UI hotkeys in the world interaction pass (ESC selection/menu cancel parity).
        try {
            const im = host.osrsClient.inputManager;
            if (im?.isKeyDownEvent?.("Escape")) {
                let escapeConsumed = false;
                if (ClientState.isItemSelected === 1) {
                    host.osrsClient.inventory?.setSelectedSlot?.(null);
                    ClientState.clearItemSelection();
                    escapeConsumed = true;
                }
                if (ClientState.isSpellSelected) {
                    host.osrsClient.clearSelectedSpell();
                    escapeConsumed = true;
                }
                if (host.osrsClient.menuOpen) {
                    host.osrsClient.closeMenu();
                    escapeConsumed = true;
                }
                if (!escapeConsumed) {
                    const closedGroupId = host.osrsClient.widgetSessionManager?.closeTopModal?.();
                    if (typeof closedGroupId === "number") {
                        escapeConsumed = true;
                    }
                }
            }
        } catch {}

        // Bridge menu entries to the GL UI overlay (Choose Option) so it shows
        // the actual list of options at the cursor/pinned position.
        try {
            const canvas: any = host.app.gl.canvas as any;
            const ui = (canvas.__ui = canvas.__ui || {});
            // Provide a callback so the GL menu can close the world menu when clicking outside
            try {
                ui.closeWorldMenu = () => host.osrsClient.closeMenu();
            } catch {}
            const existing = ui.menu as any;
            // If not in menuOpen state and a map-driven menu is visible, hide it (right-click activation only)
            if (!host.osrsClient.menuOpen) {
                if (existing && existing.source === "map") {
                    existing.open = false;
                }
                return;
            }
            // If a pinned widget-driven menu is open, do not override it with map entries
            if (
                existing &&
                existing.open &&
                existing.follow === false &&
                existing.source === "widgets"
            ) {
                return;
            }
            const simpleList = host.osrsClient.menuActiveSimpleEntries.length
                ? host.osrsClient.menuActiveSimpleEntries
                : simpleEntries;
            // menuX/menuY are already in canvas coordinates from InputManager
            const mx = (host.osrsClient.menuX | 0) as number;
            const my = (host.osrsClient.menuY | 0) as number;
            ui.menu = {
                open: simpleList.length > 0,
                follow: false,
                x: mx,
                y: my,
                entries: simpleList,
                source: "map",
                menuState: host.osrsClient.menuState,
                onEntryInvoke: (entry: SimpleMenuEntry) => {
                    host.onInteractHighlightEntryInvoked(entry, host.osrsClient.menuTile);
                },
            };
        } catch {}
    
}

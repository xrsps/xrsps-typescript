/**
 * EyesBridge — a structured window into the running game for automation.
 *
 * Installed as `window.__eyes` when the page is opened with `?eyes=1`
 * (or `localStorage.eyes === "1"`). Everything returns plain JSON so a driver
 * outside the page (Playwright, the `tools/eyes` MCP server, a test) can read
 * real game state instead of guessing from pixels, and can trigger the same
 * actions a player would (walk, chat, NPC options, widgets).
 *
 * Nothing here is used by the game itself. Every accessor is defensive: a
 * subsystem that isn't ready yet yields `null`/`[]` rather than throwing.
 */
import { chatHistory } from "../../rs/cs2/ChatHistory";
import { SkillId } from "../../rs/skill/skills";
import {
    sendChat,
    sendLocInteract,
    sendNpcOption,
    sendPlayerOption,
    sendWalk,
    sendWidgetClose,
    sendWidgetOpen,
} from "../../network/ServerConnection";
import { ClientState } from "../ClientState";
import type { OsrsClient } from "../OsrsClient";
import { GameState } from "../login/GameState";

type Tile = { x: number; y: number; plane: number };

export type EyesActor = {
    /** Server-side index (player pid / NPC server id) — use with npcAction/playerAction. */
    serverId: number;
    ecsIndex: number;
    name: string;
    typeId?: number;
    combatLevel?: number;
    tile: Tile;
    /** Chebyshev distance in tiles from the local player. */
    distance: number;
    /** Screen position of the actor's feet, if on screen. */
    screen: { x: number; y: number } | null;
};

const CHAT_TYPE_NAMES: Record<number, string> = {
    0: "game",
    1: "modchat",
    2: "public",
    3: "private",
    4: "engine",
    5: "loginlogout",
    6: "private_out",
    7: "modprivate",
    9: "friendschat",
    11: "clanchat",
    14: "trade",
    30: "trade_req",
    90: "spam",
    105: "console",
    109: "npc_examine",
};

function gameStateName(state: number): string {
    return (GameState as unknown as Record<number, string>)[state] ?? String(state);
}

export function shouldInstallEyes(): boolean {
    try {
        if (typeof window === "undefined") return false;
        if (new URLSearchParams(window.location.search).get("eyes") === "1") return true;
        return window.localStorage?.getItem("eyes") === "1";
    } catch {
        return false;
    }
}

export function createEyesBridge(client: OsrsClient) {
    // Private-but-stable internals the bridge reads. Kept in one place so a
    // rename upstream only breaks this file.
    const internals = () =>
        client as unknown as {
            lastPlayerSyncLocalIndex: number;
            skillsMap: Map<number, { currentLevel: number; baseLevel: number; xp: number }>;
        };

    function localEcsIndex(): number | undefined {
        const pid = internals().lastPlayerSyncLocalIndex | 0;
        if (pid < 0) return undefined;
        return client.playerEcs.getIndexForServerId(pid);
    }

    function localTile(): Tile | null {
        const idx = localEcsIndex();
        if (idx === undefined) return null;
        return {
            x: client.playerEcs.getX(idx) >> 7,
            y: client.playerEcs.getY(idx) >> 7,
            plane: client.playerEcs.getLevel(idx) | 0,
        };
    }

    function tileToScreen(x: number, y: number, plane?: number): { x: number; y: number } | null {
        try {
            const renderer = client.renderer as unknown as {
                getApproxTileHeight?: (wx: number, wy: number, plane?: number) => number;
                worldToScreen?: (x: number, y: number, z: number) => number[] | Float32Array | undefined;
            };
            if (!renderer.worldToScreen) return null;
            const p = plane ?? localTile()?.plane ?? 0;
            const h = renderer.getApproxTileHeight?.(x + 0.5, y + 0.5, p) ?? 0;
            const s = renderer.worldToScreen(x + 0.5, h, y + 0.5);
            if (!s) return null;
            const sx = Math.round(s[0]);
            const sy = Math.round(s[1]);
            const w = client.camera.screenWidth || window.innerWidth;
            const hgt = client.camera.screenHeight || window.innerHeight;
            if (sx < 0 || sy < 0 || sx > w || sy > hgt) return null;
            return { x: sx, y: sy };
        } catch {
            return null;
        }
    }

    function screenToTile(sx: number, sy: number): Tile | null {
        try {
            const renderer = client.renderer as unknown as {
                computeTerrainTileAt?: (
                    mx: number,
                    my: number,
                ) => { tileX: number; tileY: number; plane: number } | undefined;
            };
            const t = renderer.computeTerrainTileAt?.(sx, sy);
            return t ? { x: t.tileX, y: t.tileY, plane: t.plane } : null;
        } catch {
            return null;
        }
    }

    function dist(a: Tile | null, b: Tile): number {
        if (!a) return -1;
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }

    function npcName(typeId: number): string {
        try {
            let type = client.npcTypeLoader.load(typeId);
            if (type && (type as { transform?: unknown }).transform && client.varManager) {
                const transformed = (
                    type as unknown as {
                        transform: (vm: unknown, loader: unknown) => typeof type | undefined;
                    }
                ).transform(client.varManager, client.npcTypeLoader);
                if (transformed) type = transformed;
            }
            const name = type?.name;
            // The cache uses the literal string "null" for hidden/placeholder NPCs.
            return name && name !== "null" ? name : "";
        } catch {
            return `npc#${typeId}`;
        }
    }

    function itemName(itemId: number): string {
        try {
            return client.objTypeLoader.load(itemId)?.name ?? `item#${itemId}`;
        } catch {
            return `item#${itemId}`;
        }
    }

    function inventoryOf(inv: { getSlots(): { slot: number; itemId: number; quantity: number }[] }) {
        return inv
            .getSlots()
            .filter((s) => s.itemId >= 0 && s.quantity > 0)
            .map((s) => ({ slot: s.slot, itemId: s.itemId, name: itemName(s.itemId), quantity: s.quantity }));
    }

    const api = {
        version: 1,

        /** One-shot summary of where the game is right now. */
        state() {
            const tile = localTile();
            const session = client.widgetSessionManager as unknown as
                | { modalStack?: number[] }
                | undefined;
            const openWidgets = api.widgets();
            const skills = api.skills();
            const hp = skills.find((s) => s.id === SkillId.Hitpoints);
            const prayer = skills.find((s) => s.id === SkillId.Prayer);
            return {
                gameState: gameStateName(client.gameState),
                gameStateId: client.gameState,
                loggedIn: client.isLoggedIn(),
                playerName: client.localPlayerName || null,
                combatLevel: ClientState.localPlayerCombatLevel,
                tile,
                hitpoints: hp ? { current: hp.current, max: hp.base } : null,
                prayer: prayer ? { current: prayer.current, max: prayer.base } : null,
                destination:
                    ClientState.destinationWorldX > 0
                        ? { x: ClientState.destinationWorldX, y: ClientState.destinationWorldY }
                        : null,
                camera: {
                    yaw: client.camera.yaw,
                    pitch: client.camera.pitch,
                    zoom: client.camera.viewportZoom,
                    width: client.camera.screenWidth,
                    height: client.camera.screenHeight,
                },
                menuOpen: ClientState.isMenuOpen,
                // type 0 sub-interfaces are OSRS "modal" interfaces (dialogs, character creator, bank...)
                modalOpen: !!session?.modalStack?.length || openWidgets.some((w) => w.type === 0),
                rootInterface: client.widgetManager?.rootInterface ?? -1,
                openWidgets,
                inventoryCount: api.inventory().length,
                lastChat: api.chat(3),
                login: client.isLoggedIn()
                    ? null
                    : {
                          server: client.loginState.serverAddress,
                          secure: client.loginState.serverSecure,
                          loginIndex: client.loginState.loginIndex,
                          username: client.loginState.username,
                      },
            };
        },

        tile: localTile,
        tileToScreen,
        screenToTile,

        /** Sub-interfaces currently mounted into the root interface (open widget groups). */
        widgets(): { groupId: number; type: number; containerUid: number }[] {
            const out: { groupId: number; type: number; containerUid: number }[] = [];
            try {
                const parents = client.widgetManager?.interfaceParents;
                if (parents) {
                    for (const [containerUid, p] of parents) {
                        out.push({ groupId: p.group, type: p.type, containerUid });
                    }
                }
            } catch {}
            return out;
        },

        /** Nearby NPCs sorted by distance (hidden "null"-named NPCs skipped unless includeUnnamed). */
        npcs(radius: number = 15, includeUnnamed: boolean = false): EyesActor[] {
            const me = localTile();
            const out: EyesActor[] = [];
            try {
                client.npcEcs.forEachActive((id) => {
                    // NPC ECS positions are map-square local; getWorldX/Y rebase them.
                    const tile: Tile = {
                        x: client.npcEcs.getWorldX(id) >> 7,
                        y: client.npcEcs.getWorldY(id) >> 7,
                        plane: client.npcEcs.getLevel(id) | 0,
                    };
                    const d = dist(me, tile);
                    if (me && d > radius) return;
                    const typeId = client.npcEcs.getNpcTypeId(id) | 0;
                    const name = npcName(typeId);
                    if (!name && !includeUnnamed) return;
                    out.push({
                        serverId: client.npcEcs.getServerId(id),
                        ecsIndex: id,
                        name: name || `npc#${typeId}`,
                        typeId,
                        tile,
                        distance: d,
                        screen: tileToScreen(tile.x, tile.y, tile.plane),
                    });
                });
            } catch {}
            return out.sort((a, b) => a.distance - b.distance);
        },

        /** Other players in view, sorted by distance. */
        players(radius: number = 15): EyesActor[] {
            const me = localTile();
            const mine = localEcsIndex();
            const out: EyesActor[] = [];
            try {
                for (const serverId of client.playerEcs.getAllServerIds()) {
                    const idx = client.playerEcs.getIndexForServerId(serverId);
                    if (idx === undefined || idx === mine) continue;
                    const tile: Tile = {
                        x: client.playerEcs.getX(idx) >> 7,
                        y: client.playerEcs.getY(idx) >> 7,
                        plane: client.playerEcs.getLevel(idx) | 0,
                    };
                    const d = dist(me, tile);
                    if (me && d > radius) continue;
                    out.push({
                        serverId,
                        ecsIndex: idx,
                        name: client.playerEcs.getName(idx) ?? `player#${serverId}`,
                        tile,
                        distance: d,
                        screen: tileToScreen(tile.x, tile.y, tile.plane),
                    });
                }
            } catch {}
            return out.sort((a, b) => a.distance - b.distance);
        },

        inventory: () => inventoryOf(client.inventory),
        equipment: () => inventoryOf(client.equipment),

        skills() {
            const map = internals().skillsMap;
            const out: { id: number; name: string; current: number; base: number; xp: number }[] = [];
            if (!map) return out;
            for (const [id, s] of map) {
                out.push({
                    id,
                    name: (SkillId as unknown as Record<number, string>)[id] ?? String(id),
                    current: s.currentLevel,
                    base: s.baseLevel,
                    xp: s.xp,
                });
            }
            return out.sort((a, b) => a.id - b.id);
        },

        /** Most recent chat lines across all channels, newest last. */
        chat(count: number = 20) {
            const all: { type: string; from: string; text: string; cycle: number }[] = [];
            const store = chatHistory as unknown as {
                messagesByType?: Map<number, { type: number; from: string; text: string; cycle: number }[]>;
            };
            const byType = store.messagesByType;
            if (byType) {
                for (const [, msgs] of byType) {
                    for (const m of msgs) {
                        all.push({
                            type: CHAT_TYPE_NAMES[m.type] ?? String(m.type),
                            from: m.from,
                            text: m.text,
                            cycle: m.cycle,
                        });
                    }
                }
            }
            all.sort((a, b) => a.cycle - b.cycle);
            return all.slice(-Math.max(1, count | 0));
        },

        /** Entries of the currently built right-click/left-click menu. */
        menu() {
            const menu = client.menuState;
            const entries: {
                index: number;
                action: string;
                target: string;
                opcode: number;
                identifier: number;
            }[] = [];
            const n = menu.count();
            for (let i = 0; i < n; i++) {
                const e = menu.getEntry(i);
                if (!e) continue;
                entries.push({
                    index: i,
                    action: e.action,
                    target: e.target,
                    opcode: e.opcode as number,
                    identifier: e.identifier,
                });
            }
            return { open: ClientState.isMenuOpen, entries };
        },

        /** Invoke a menu entry by index (as if clicked). */
        menuInvoke(index: number) {
            client.menuState.invoke(index | 0);
            return true;
        },

        // ---- actions -------------------------------------------------------

        walk(x: number, y: number, run: boolean = true) {
            sendWalk({ x: x | 0, y: y | 0 }, !!run);
            return true;
        },

        say(text: string) {
            sendChat(String(text), "public", 0);
            return true;
        },

        /** Trigger NPC option `op` (1..5) on an NPC by server id (see npcs()). */
        npcAction(serverId: number, op: number = 1) {
            sendNpcOption(serverId | 0, op | 0, 0);
            return true;
        },

        playerAction(serverId: number, op: number) {
            sendPlayerOption(serverId | 0, op | 0);
            return true;
        },

        locAction(locId: number, x: number, y: number, plane?: number, action?: string) {
            sendLocInteract(locId | 0, { x: x | 0, y: y | 0 }, plane, action);
            return true;
        },

        openWidget(groupId: number, modal: boolean = false) {
            sendWidgetOpen(groupId | 0, { modal });
            return true;
        },

        closeWidget(groupId: number) {
            sendWidgetClose(groupId | 0);
            return true;
        },

        /** Escape hatch for anything not covered above. */
        client: () => client,
    };

    return api;
}

export type EyesBridge = ReturnType<typeof createEyesBridge>;

declare global {
    interface Window {
        __eyes?: EyesBridge;
    }
}

export function installEyesBridge(client: OsrsClient): void {
    if (!shouldInstallEyes()) return;
    try {
        window.__eyes = createEyesBridge(client);
        console.log("[eyes] bridge installed as window.__eyes");
    } catch (err) {
        console.warn("[eyes] failed to install bridge", err);
    }
}

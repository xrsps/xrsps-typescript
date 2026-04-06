import { MenuTargetType, type OsrsMenuEntry } from "../../rs/MenuEntry";
import { MenuAction, inferMenuAction } from "./MenuAction";
import type { MenuClickContext, SimpleMenuEntry } from "./MenuEngine";
import { normalizeMenuEntries } from "./MenuEngine";
import { MenuState } from "./MenuState";

type WidgetMenuEntryInput = {
    option: string;
    target?: string;
    onClick?: (gx?: number, gy?: number, ctx?: MenuClickContext) => void;
    widgetAction?: {
        slot?: number;
        itemId?: number;
    };
    suppressWidgetAction?: boolean;
};

export type TargetLabelOptions = {
    includeExamineIds?: boolean; // default false (OSRS doesn't show IDs)
    includeNpcLevel?: boolean; // default true
    /** Used for OSRS combat-level color tags on NPC targets. */
    localPlayerCombatLevel?: number;
};

// Color start tag helper
function colorStartTag(rgb: number): string {
    return `<col=${(rgb >>> 0).toString(16)}>`;
}

// Combat level coloring (npcLevel, playerLevel)
function combatLevelColorTag(npcLevel: number, localPlayerLevel: number): string {
    const diff = (localPlayerLevel | 0) - (npcLevel | 0);
    if (diff < -9) return colorStartTag(16711680);
    if (diff < -6) return colorStartTag(16723968);
    if (diff < -3) return colorStartTag(16740352);
    if (diff < 0) return colorStartTag(16756736);
    if (diff > 9) return colorStartTag(65280);
    if (diff > 6) return colorStartTag(4259584);
    if (diff > 3) return colorStartTag(8453888);
    return diff > 0 ? colorStartTag(12648192) : colorStartTag(16776960);
}

function hasColorTag(s: string): boolean {
    return /<col=|<color=/i.test(s);
}

function hasColorResetTag(s: string): boolean {
    return /<\/col>|<\/color>/i.test(s);
}

function splitArrow(raw: string): { left: string; right: string } | null {
    if (!raw) return null;
    if (!raw.includes("->")) return null;
    // Prefer the OSRS formatted delimiter " -> " when present.
    const delim = raw.includes(" -> ") ? " -> " : "->";
    const parts = raw.split(delim);
    if (parts.length < 2) return null;
    const left = parts[0]?.trim() ?? "";
    const right = parts.slice(1).join(delim).trim();
    if (!left.length && !right.length) return null;
    return { left, right };
}

function formatNpcNameWithLevel(
    name: string,
    npcLevel: number,
    localPlayerCombatLevel?: number,
    includeLevel?: boolean,
): string {
    let out = name;
    if (includeLevel && (npcLevel | 0) > 0) {
        const lp = typeof localPlayerCombatLevel === "number" ? localPlayerCombatLevel | 0 : 0;
        const tag = lp ? combatLevelColorTag(npcLevel | 0, lp) : colorStartTag(16776960);
        // Reference (yes, double-space): tag + " " + " (" + "level-" + level + ")"
        out += `${tag}  (level-${npcLevel | 0})`;
    }
    return out;
}

/**
 * Format the right-side target label for an OsrsMenuEntry in OSRS style.
 */
export function osrsTargetLabel(e: OsrsMenuEntry, opts: TargetLabelOptions = {}): string {
    if (!e) return "";
    // opcode 23 (Walk here) can have a non-empty target (e.g., when hovering a player).
    // In that case, the target string already contains any necessary <col> tags.
    if (e.targetType === MenuTargetType.NONE) return String(e.targetName || "");
    const includeIds = !!opts.includeExamineIds;
    const includeLevels = opts.includeNpcLevel !== false;
    const rawName = String(e.targetName || "");
    const baseColor = (() => {
        switch (e.targetType) {
            case MenuTargetType.NPC:
                return 16776960; // yellow
            case MenuTargetType.LOC:
                return 65535; // cyan
            case MenuTargetType.OBJ:
            case MenuTargetType.ITEM:
                return 16748608; // orange
            case MenuTargetType.PLAYER:
                return 16777215; // white
            default:
                return 16777215;
        }
    })();

    const arrow = splitArrow(rawName);
    let t = "";
    if (arrow) {
        const isUse = String(e.option || "").toLowerCase() === "use";
        let left = arrow.left;
        if (!hasColorTag(left)) {
            // OSRS default: selected item names are orange; selected spell names are green.
            const leftColor = isUse ? 16748608 : 65280;
            left = `${colorStartTag(leftColor)}${left}</col>`;
        } else if (!hasColorResetTag(left)) {
            // Avoid color bleed into the arrow if the left side has an opening <col> without a close.
            left = `${left}</col>`;
        }

        const rightBase =
            e.targetType === MenuTargetType.NPC
                ? formatNpcNameWithLevel(
                      arrow.right,
                      e.targetLevel | 0,
                      opts.localPlayerCombatLevel,
                      includeLevels,
                  )
                : arrow.right;
        const right = rightBase.length ? `${colorStartTag(baseColor)}${rightBase}` : "";
        t = left.length && right.length ? `${left} -> ${right}` : `${left}${right}`;
    } else {
        const base =
            e.targetType === MenuTargetType.NPC
                ? formatNpcNameWithLevel(
                      rawName,
                      e.targetLevel | 0,
                      opts.localPlayerCombatLevel,
                      includeLevels,
                  )
                : rawName;
        t = base.length ? `${colorStartTag(baseColor)}${base}` : "";
    }
    if (
        includeIds &&
        String(e.option).toLowerCase() === "examine" &&
        (e.targetType === MenuTargetType.NPC ||
            e.targetType === MenuTargetType.LOC ||
            e.targetType === MenuTargetType.OBJ)
    ) {
        const idLabel = `ID: ${Math.trunc(e.targetId)}`;
        t = t ? `${t} (${idLabel})` : idLabel;
    }
    return t;
}

/**
 * Convert world OsrsMenuEntry[] into normalized SimpleMenuEntry[] suitable for the GL overlay.
 * The provided toCssEvent converter receives GL-space pixels and returns a MouseEvent-like object
 * ({ clientX, clientY }) so existing handlers can work unchanged.
 */
export function worldEntriesToSimple(
    source: OsrsMenuEntry[],
    opts: {
        toCssEvent?: (gx?: number, gy?: number) => any;
        label?: TargetLabelOptions;
        menuState?: MenuState;
        registerWithState?: boolean;
        resetMenuState?: boolean;
    } = {},
): SimpleMenuEntry[] {
    const toEvt = opts.toCssEvent;
    const register = !!opts.menuState && opts.registerWithState !== false;
    if (register && opts.resetMenuState !== false) {
        opts.menuState?.reset();
    }
    const intermediate: SimpleMenuEntry[] = (source || []).map((e) => {
        const action = e.spellCast ? MenuAction.Cast : inferMenuAction(e.option, e.targetType);
        // osrsTargetLabel already includes the level text for NPCs
        const label = osrsTargetLabel(e, opts.label) || undefined;
        return {
            option: e.option,
            target: label,
            action,
            targetType: e.targetType,
            targetId: typeof e.targetId === "number" ? e.targetId : undefined,
            mapX: typeof e.mapX === "number" ? e.mapX : undefined,
            mapY: typeof e.mapY === "number" ? e.mapY : undefined,
            npcServerId:
                typeof e.npcServerId === "number"
                    ? e.npcServerId
                    : (e.spellCast?.npcServerId as number | undefined) ?? undefined,
            actionIndex:
                typeof e.actionIndex === "number" && e.actionIndex >= 0 ? e.actionIndex : undefined,
            opcode: typeof e.opcode === "number" ? e.opcode : undefined,
            playerServerId:
                typeof e.playerServerId === "number"
                    ? e.playerServerId
                    : (e.spellCast?.playerServerId as number | undefined) ?? undefined,
            onClick: (gx?: number, gy?: number, ctx?: MenuClickContext) => {
                const evt = typeof toEvt === "function" ? toEvt(gx, gy) : undefined;
                try {
                    e.onClick?.(e as any, evt, ctx as any);
                } catch (err) {
                    console.warn?.("[menu] world entry onClick threw", err);
                }
            },
        };
    });
    const list = normalizeMenuEntries(intermediate);
    if (register && opts.menuState) {
        const state = opts.menuState;
        for (const entry of list) {
            const npcArg0 =
                entry.targetType === MenuTargetType.NPC &&
                typeof entry.npcServerId === "number" &&
                Number.isFinite(entry.npcServerId)
                    ? entry.npcServerId | 0
                    : undefined;
            const playerArg0 =
                entry.targetType === MenuTargetType.PLAYER &&
                typeof entry.playerServerId === "number" &&
                Number.isFinite(entry.playerServerId)
                    ? entry.playerServerId | 0
                    : undefined;
            const idx = state.add({
                option: entry.option,
                target: entry.target,
                action: entry.action,
                targetType: entry.targetType,
                targetId: entry.targetId,
                arg0: npcArg0 ?? playerArg0,
                mapX: entry.mapX,
                mapY: entry.mapY,
                playerServerId: entry.playerServerId,
                actionIndex: entry.actionIndex,
                opcode: entry.opcode,
                handler: entry.onClick,
            });
            entry.menuStateIndex = idx;
        }
    }
    return list;
}

/**
 * Convert widget-origin menu entries into SimpleMenuEntry[] (OSRS display order) and wire
 * default widget action/examine hooks. This centralizes the mapping logic used by the GL UI.
 */
export function widgetEntriesToSimple(
    entries: Array<WidgetMenuEntryInput> | undefined,
    ctx: {
        ui: any;
        chosenWidget: any;
        scheduleRender: () => void;
        menuState?: MenuState;
    },
): SimpleMenuEntry[] {
    const { ui, chosenWidget, scheduleRender, menuState } = ctx;
    if (menuState) menuState.reset();
    const list: SimpleMenuEntry[] = (entries || []).map((e) => ({
        option: e.option,
        target: e.target,
        action: inferMenuAction(e.option),
        targetType: e.target ? MenuTargetType.ITEM : MenuTargetType.NONE,
        onClick: (() => {
            const lower = String(e.option || "").toLowerCase();
            const shouldDispatchWidgetAction =
                !e.suppressWidgetAction &&
                lower !== "cancel" &&
                lower !== "examine" &&
                lower !== "inspect";
            const dispatchWidgetAction = (clickCtx?: MenuClickContext): boolean => {
                if (!shouldDispatchWidgetAction) return false;
                const hook = ui?.onWidgetAction;
                if (typeof hook !== "function") return false;
                try {
                    // widget ops on item containers need slot/itemId.
                    // Dynamic CC_CREATE children store slot index in `childIndex`.
                    const fallbackSlot =
                        typeof chosenWidget?.childIndex === "number"
                            ? chosenWidget.childIndex | 0
                            : undefined;
                    const fallbackItemId =
                        typeof chosenWidget?.itemId === "number"
                            ? chosenWidget.itemId | 0
                            : undefined;
                    hook({
                        widget: chosenWidget,
                        option: e.option,
                        target: e.target,
                        source: clickCtx?.source ?? "menu",
                        cursorX: ui?.mouseX,
                        cursorY: ui?.mouseY,
                        slot: e.widgetAction?.slot ?? fallbackSlot,
                        itemId: e.widgetAction?.itemId ?? fallbackItemId,
                    });
                    return true;
                } catch (err) {
                    console.warn?.("[menu] widget action dispatch failed", err);
                    return false;
                }
            };
            if (typeof e.onClick === "function")
                return (gx?: number, gy?: number, clickCtx?: MenuClickContext) => {
                    dispatchWidgetAction(clickCtx);
                    try {
                        e.onClick?.(gx, gy, clickCtx);
                    } catch (err) {
                        console.warn?.("[menu] widget entry onClick threw", err);
                    }
                    if (ui?.menu) ui.menu.open = false;
                    ui.menu = undefined;
                    (ui as any)?.closeWorldMenu?.();
                    scheduleRender();
                };
            if (lower === "cancel" || lower === "examine" || lower === "inspect")
                return () => {
                    const hook = ui?.onWidgetExamine || ui?.setDetails;
                    if (typeof hook === "function") hook(chosenWidget);
                    if (ui?.menu) ui.menu.open = false;
                    ui.menu = undefined;
                    (ui as any)?.closeWorldMenu?.();
                    scheduleRender();
                };
            return (gx?: number, gy?: number, clickCtx?: MenuClickContext) => {
                const dispatched = dispatchWidgetAction(clickCtx);
                if (!dispatched) {
                    console.log(
                        `[ui] widget action: ${e.option}` + (e.target ? ` -> ${e.target}` : ""),
                        chosenWidget,
                    );
                }
                if (ui?.menu) ui.menu.open = false;
                ui.menu = undefined;
                (ui as any)?.closeWorldMenu?.();
                scheduleRender();
            };
        })(),
    }));
    // Widget-derived menu entries are already provided in OSRS display order (top-to-bottom).
    // normalizeMenuEntries expects OSRS insertion order (reverse-render semantics) and would invert
    // widget ops like minimap orbs.
    const ordered = list;
    if (menuState) {
        for (const entry of ordered) {
            const idx = menuState.add({
                option: entry.option,
                target: entry.target,
                action: entry.action,
                handler: entry.onClick,
            });
            entry.menuStateIndex = idx;
        }
    }
    return ordered;
}

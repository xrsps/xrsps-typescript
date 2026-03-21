import {
    PRAYER_DEFINITIONS,
    PRAYER_NAME_TO_BIT,
    type PrayerDefinition,
    type PrayerName,
} from "../../../../../src/rs/prayer/prayers";
import {
    VARBIT_PRAYER_FILTER_ALLOW_COMBINED_TIER,
    VARBIT_PRAYER_FILTER_BLOCK_HEALING,
    VARBIT_PRAYER_FILTER_BLOCK_LACK_LEVEL,
    VARBIT_PRAYER_FILTER_BLOCK_LOCKED,
    VARBIT_PRAYER_FILTER_BLOCK_LOW_TIER,
} from "../../../../../src/shared/vars";
import { GameframeTab } from "../../../widgets/InterfaceService";
import { DisplayMode, getPrayerTabUid } from "../../../widgets/viewport";
import { type ScriptModule } from "../types";

/**
 * Prayer widget handlers for interface 541 (prayer tab) and 160 (minimap prayer orb).
 *
 * Uses onButton registration since binary IF_BUTTON packets don't send option strings.
 * Prayer buttons use childId to identify which prayer was clicked.
 * Prayer orb toggle uses server state to determine activate/deactivate.
 */

const PRAYER_WIDGET_GROUP_ID = 541;
const MINIMAP_WIDGET_GROUP_ID = 160;
const PRAYER_ORB_COMPONENT = 20; // Prayer orb in minimap interface
const QUICK_PRAYER_SETUP_GROUP_ID = 77;
const QUICK_PRAYER_SETUP_BUTTONS_COMPONENT = 4;
const QUICK_PRAYER_SETUP_DONE_COMPONENT = 5;
const QUICK_PRAYER_SETUP_BUTTON_FLAGS = 1 << 1; // transmit op1
const QUICK_PRAYER_SETUP_WIDGET_UID =
    ((QUICK_PRAYER_SETUP_GROUP_ID & 0xffff) << 16) |
    (QUICK_PRAYER_SETUP_BUTTONS_COMPONENT & 0xffff);
const QUICK_PRAYER_BASE_ENUM_IDS = [4956, 3341, 3342, 3343] as const;
const PRAYER_OBJ_PARAM_QUICK_BIT = 630;
const PRAYER_OBJ_PARAM_COMPONENT = 1751;

const QUICK_ACTION_TOGGLE = "quicktoggle";
const QUICK_ACTION_SET = "quickset";
const PRAYER_FILTER_COMPONENT_ID = 42;
const PRAYER_FILTER_BUTTON_COMPONENT_ID = 6;
const PRAYER_FILTER_FLAGS = 1 << 1; // transmit op1
const PRAYER_FILTER_SLOT_START = 0;
const PRAYER_FILTER_SLOT_END = 4;
const PRAYER_FILTER_WIDGET_UID =
    ((PRAYER_WIDGET_GROUP_ID & 0xffff) << 16) | (PRAYER_FILTER_COMPONENT_ID & 0xffff);

const PRAYER_FILTER_VARBIT_BY_SLOT = new Map<number, number>([
    [0, VARBIT_PRAYER_FILTER_BLOCK_LOW_TIER],
    [1, VARBIT_PRAYER_FILTER_ALLOW_COMBINED_TIER],
    [2, VARBIT_PRAYER_FILTER_BLOCK_HEALING],
    [3, VARBIT_PRAYER_FILTER_BLOCK_LACK_LEVEL],
    [4, VARBIT_PRAYER_FILTER_BLOCK_LOCKED],
]);

// OSRS parity: Prayer component ids are cache-driven (Obj param 1751 via script7823 enums),
// and are not sequential from 5. Prayer buttons are 541:9..37.
const PRAYER_CHILD_ID_BY_NAME: Record<PrayerName, number> = {
    thick_skin: 9,
    burst_of_strength: 10,
    clarity_of_thought: 11,
    rock_skin: 12,
    superhuman_strength: 13,
    improved_reflexes: 14,
    rapid_restore: 15,
    rapid_heal: 16,
    protect_item: 17,
    steel_skin: 18,
    ultimate_strength: 19,
    incredible_reflexes: 20,
    protect_from_magic: 21,
    protect_from_missiles: 22,
    protect_from_melee: 23,
    retribution: 24,
    redemption: 25,
    smite: 26,
    sharp_eye: 27,
    hawk_eye: 28,
    eagle_eye: 29,
    mystic_will: 30,
    mystic_lore: 31,
    mystic_might: 32,
    rigour: 33,
    chivalry: 34,
    piety: 35,
    augury: 36,
    preserve: 37,
};

const PRAYERS_BY_CHILD_ID = new Map<number, PrayerDefinition>();
for (const def of PRAYER_DEFINITIONS) {
    const childId = PRAYER_CHILD_ID_BY_NAME[def.id];
    if (childId !== undefined) {
        PRAYERS_BY_CHILD_ID.set(childId, def);
    }
}

const PRAYER_BY_QUICK_SLOT = new Map<number, PrayerName>();
for (const def of PRAYER_DEFINITIONS) {
    const slot = def.quickSlot;
    if (slot === null || slot === undefined) continue;
    PRAYER_BY_QUICK_SLOT.set(slot, def.id);
}
const DEFAULT_QUICK_PRAYER_SETUP_SLOTS = Array.from(PRAYER_BY_QUICK_SLOT.keys()).sort(
    (a, b) => a - b,
);

export const prayerWidgetModule: ScriptModule = {
    id: "content.prayer-widgets",
    register(registry, services) {
        const quickPrayerSetupSlotToPrayer = buildQuickPrayerSetupSlotMap(services);
        const quickPrayerSetupSlots = Array.from(
            new Set<number>([
                ...DEFAULT_QUICK_PRAYER_SETUP_SLOTS,
                ...Array.from(quickPrayerSetupSlotToPrayer.keys()),
            ]),
        ).sort((a, b) => a - b);
        const lastOrbToggleTickByPlayerId = new Map<number, number>();
        const lastOrbSetupTickByPlayerId = new Map<number, number>();
        const lastQuickPrayerToggleTickByPlayerSlot = new Map<string, number>();
        const lastQuickPrayerDoneTickByPlayerId = new Map<number, number>();

        const queuePrayerFilterFlags = (playerId: number) => {
            services.queueWidgetEvent?.(playerId, {
                action: "set_flags_range",
                uid: PRAYER_FILTER_WIDGET_UID,
                fromSlot: PRAYER_FILTER_SLOT_START,
                toSlot: PRAYER_FILTER_SLOT_END,
                flags: PRAYER_FILTER_FLAGS,
            });
        };

        const queueQuickPrayerSetupFlags = (playerId: number) => {
            for (const slot of quickPrayerSetupSlots) {
                services.queueWidgetEvent?.(playerId, {
                    action: "set_flags_range",
                    uid: QUICK_PRAYER_SETUP_WIDGET_UID,
                    fromSlot: slot,
                    toSlot: slot,
                    flags: QUICK_PRAYER_SETUP_BUTTON_FLAGS,
                });
            }
        };

        // ============ PRAYER BUTTONS (541:9-37, non-sequential by prayer id) ============
        // Register handler for each prayer button using onButton
        for (const [childId, def] of PRAYERS_BY_CHILD_ID) {
            registry.onButton(PRAYER_WIDGET_GROUP_ID, childId, (event) => {
                const player = event.player;
                const current = new Set(player.getActivePrayers());
                // Always use toggle behavior based on server state.
                // The client CS2 script (prayer_op) toggles local state before sending
                // the action, so the option text reflects client state, not user intent.
                if (current.has(def.id)) {
                    current.delete(def.id);
                } else {
                    current.add(def.id);
                }
                const desired = Array.from(current);
                player.setQuickPrayersEnabled(false);
                if (services.applyPrayers) {
                    services.applyPrayers(player, desired);
                } else {
                    player.setActivePrayers(desired);
                    services.queueCombatState?.(player);
                }
            });
        }

        // ============ QUICK PRAYER BUTTON (541:4) ============
        // The quick prayer orb in the prayer tab
        const QUICK_PRAYER_COMPONENT = 4;
        registry.onButton(PRAYER_WIDGET_GROUP_ID, QUICK_PRAYER_COMPONENT, (event) => {
            const player = event.player;
            const opId = event.opId ?? 1;
            // Op1 = toggle quick prayers, Op2 = set quick prayers
            if (opId === 2) {
                handleQuickPrayerAction(QUICK_ACTION_SET, player, services);
            } else {
                handleQuickPrayerAction(QUICK_ACTION_TOGGLE, player, services);
            }
        });

        // ============ PRAYER FILTER ROWS (541:42 dynamic slots 0-4) ============
        // The filters menu rows are dynamic children created by CS2 under 541:42.
        // Server toggles backing varbits; client scripts redraw from onVarTransmit.
        registry.onButton(PRAYER_WIDGET_GROUP_ID, PRAYER_FILTER_COMPONENT_ID, (event) => {
            queuePrayerFilterFlags(event.player.id);

            const slot = event.slot ?? -1;
            const varbitId = PRAYER_FILTER_VARBIT_BY_SLOT.get(slot);
            if (varbitId === undefined) return;

            const player = event.player;
            const current = player.getVarbitValue(varbitId);
            const next = current === 0 ? 1 : 0;
            player.setVarbitValue(varbitId, next);

            if (services.queueVarbit) {
                services.queueVarbit(player.id, varbitId, next);
            } else {
                services.sendVarbit?.(player, varbitId, next);
            }
        });

        // Ensure dynamic filter row transmit flags are refreshed when Filters tab is opened.
        registry.onButton(PRAYER_WIDGET_GROUP_ID, PRAYER_FILTER_BUTTON_COMPONENT_ID, (event) => {
            queuePrayerFilterFlags(event.player.id);
        });

        // ============ QUICK PRAYER SETUP (77:4, 77:5) ============
        // 77:4 is the dynamic buttons container. Dynamic child slot IDs are generated by CS2.
        registry.onButton(
            QUICK_PRAYER_SETUP_GROUP_ID,
            QUICK_PRAYER_SETUP_BUTTONS_COMPONENT,
            (event) => {
                const player = event.player;
                const slot = event.slot ?? event.childId ?? -1;
                if (slot < 0) return;

                const pid = player.id;
                const tick = event.tick;
                const key = `${pid}:${slot}`;
                if (lastQuickPrayerToggleTickByPlayerSlot.get(key) === tick) return;
                lastQuickPrayerToggleTickByPlayerSlot.set(key, tick);

                const prayer =
                    quickPrayerSetupSlotToPrayer.get(slot) ?? PRAYER_BY_QUICK_SLOT.get(slot);
                if (!prayer) return;

                const next = new Set<PrayerName>(player.getQuickPrayers());
                if (next.has(prayer)) {
                    next.delete(prayer);
                } else {
                    next.add(prayer);
                }
                player.setQuickPrayers(next);
                player.setQuickPrayersEnabled(false);
                services.queueCombatState?.(player);
            },
        );

        // 77:5 is the "Done" button in quick prayer setup.
        registry.onButton(
            QUICK_PRAYER_SETUP_GROUP_ID,
            QUICK_PRAYER_SETUP_DONE_COMPONENT,
            (event) => {
                const player = event.player;
                const pid = player.id;
                const tick = event.tick;
                if (lastQuickPrayerDoneTickByPlayerId.get(pid) === tick) return;
                lastQuickPrayerDoneTickByPlayerId.set(pid, tick);

                openQuickPrayerSetupTab(false, player, services);
            },
        );

        // ============ PRAYER ORB (160:20) ============
        // Minimap prayer orb supports:
        // - Op1: Activate/Deactivate quick prayers
        // - Op2: Setup (open quick prayer interface 77 in prayer tab)
        registry.onButton(MINIMAP_WIDGET_GROUP_ID, PRAYER_ORB_COMPONENT, (event) => {
            const player = event.player;
            const pid = player.id;
            const tick = event.tick;
            const opId = event.opId ?? 1;

            if (opId === 2) {
                if (lastOrbSetupTickByPlayerId.get(pid) === tick) return;
                lastOrbSetupTickByPlayerId.set(pid, tick);
                openQuickPrayerSetupTab(true, player, services);
                queueQuickPrayerSetupFlags(pid);
                return;
            }
            if (opId !== 1) return;

            if (lastOrbToggleTickByPlayerId.get(pid) === tick) return;
            lastOrbToggleTickByPlayerId.set(pid, tick);

            const isEnabled = player.areQuickPrayersEnabled?.() ?? false;
            handlePrayerOrbClick(isEnabled ? "deactivate" : "activate", player, services);
        });
    },
};

function buildQuickPrayerSetupSlotMap(
    services: Parameters<ScriptModule["register"]>[1],
): Map<number, PrayerName> {
    const slotToPrayer = new Map<number, PrayerName>();
    const enumLoader = services.getEnumTypeLoader?.() ?? services.enumTypeLoader;
    const getObjType = services.getObjType;
    if (!enumLoader?.load || !getObjType) {
        return slotToPrayer;
    }

    for (const enumId of QUICK_PRAYER_BASE_ENUM_IDS) {
        const enumType = enumLoader.load(enumId);
        const keys = enumType?.keys ?? [];
        const intValues = enumType?.intValues ?? [];
        const outputCount = enumType?.outputCount ?? 0;
        const count = Math.min(
            outputCount > 0 ? outputCount : Number.MAX_SAFE_INTEGER,
            keys.length,
            intValues.length,
        );
        if (!(count > 0)) continue;

        for (let i = 0; i < count; i++) {
            const objId = intValues[i];
            if (!(objId > 0)) continue;

            const obj = getObjType(objId) as { params?: Map<number, number> } | undefined;
            const params = obj?.params;
            const componentUid = params?.get(PRAYER_OBJ_PARAM_COMPONENT);
            if (
                componentUid === undefined ||
                !Number.isFinite(componentUid) ||
                componentUid <= 0
            ) {
                continue;
            }

            const quickBit = params?.get(PRAYER_OBJ_PARAM_QUICK_BIT);
            if (quickBit === undefined || !Number.isFinite(quickBit)) continue;

            const prayer = PRAYER_BY_QUICK_SLOT.get(quickBit);
            if (!prayer || PRAYER_NAME_TO_BIT[prayer] !== quickBit) continue;

            const baseButtonChildId = keys[i];
            if (!slotToPrayer.has(baseButtonChildId)) {
                slotToPrayer.set(baseButtonChildId, prayer);
            }
        }
    }

    return slotToPrayer;
}

function openQuickPrayerSetupTab(
    openSetup: boolean,
    player: any,
    services: Parameters<ScriptModule["register"]>[1],
): void {
    const displayMode = (player?.displayMode ?? DisplayMode.RESIZABLE_NORMAL) as DisplayMode;
    const prayerTabUid = getPrayerTabUid(displayMode);
    const interfaceService = services.getInterfaceService?.();
    interfaceService?.focusTab(player, GameframeTab.PRAYER);
    services.openSubInterface?.(
        player,
        prayerTabUid,
        openSetup ? QUICK_PRAYER_SETUP_GROUP_ID : PRAYER_WIDGET_GROUP_ID,
        1,
    );
    if (openSetup) {
        // Ensure the client receives authoritative quick-prayer selection before setup redraw scripts.
        services.queueCombatState?.(player);
    }
}

function handlePrayerOrbClick(
    option: string,
    player: any,
    services: Parameters<ScriptModule["register"]>[1],
): void {
    const quick = Array.from(player.getQuickPrayers() as Iterable<PrayerName>);

    if (option === "activate") {
        if (quick.length === 0) {
            player.setQuickPrayersEnabled(false);
            services.sendGameMessage(player, "You haven't selected any quick-prayers.");
            services.queueCombatState?.(player);
            return;
        }
        const apply = services.applyPrayers;
        if (apply) {
            const result = apply(player, quick);
            if (result?.errors?.length) {
                services.sendGameMessage(
                    player,
                    result.errors[0]?.message ?? "You can't use that prayer.",
                );
                player.setQuickPrayersEnabled(false);
                services.queueCombatState?.(player);
                return;
            }
        } else {
            player.setActivePrayers(quick);
        }
        player.setQuickPrayersEnabled(true);
        services.queueCombatState?.(player);
    } else if (option === "deactivate") {
        const apply = services.applyPrayers;
        if (apply) {
            apply(player, []);
        } else {
            player.clearActivePrayers();
        }
        player.setQuickPrayersEnabled(false);
        services.queueCombatState?.(player);
    }
}

function normalizeQuickOption(option?: string): string {
    return (option || "").toLowerCase();
}

function handleQuickPrayerAction(
    option: string | undefined,
    player: any,
    services: Parameters<ScriptModule["register"]>[1],
): void {
    const normalized = normalizeQuickOption(option);
    if (normalized === QUICK_ACTION_SET) {
        const next = Array.from(player.getActivePrayers() as Iterable<PrayerName>);
        player.setQuickPrayers(next);
        player.setQuickPrayersEnabled(false);
        services.queueCombatState?.(player);
        return;
    }
    if (normalized === QUICK_ACTION_TOGGLE) {
        const quick = Array.from(player.getQuickPrayers() as Iterable<PrayerName>);
        if (quick.length === 0) {
            player.setQuickPrayersEnabled(false);
            services.sendGameMessage(player, "You haven't selected any quick-prayers.");
            services.queueCombatState?.(player);
            return;
        }
        const apply = services.applyPrayers;
        if (player.areQuickPrayersEnabled()) {
            if (apply) {
                apply(player, []);
            } else {
                player.clearActivePrayers();
                services.queueCombatState?.(player);
            }
            player.setQuickPrayersEnabled(false);
            services.queueCombatState?.(player);
            return;
        }
        if (apply) {
            const result = apply(player, quick);
            if (result?.errors?.length) {
                services.sendGameMessage(
                    player,
                    result.errors[0]?.message ?? "You can't use that prayer.",
                );
                player.setQuickPrayersEnabled(false);
                services.queueCombatState?.(player);
                return;
            }
        } else {
            player.setActivePrayers(quick);
            services.queueCombatState?.(player);
        }
        player.setQuickPrayersEnabled(true);
        services.queueCombatState?.(player);
        return;
    }
    // Unknown quick action; ignore silently.
}

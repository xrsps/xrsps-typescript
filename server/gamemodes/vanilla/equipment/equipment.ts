import { type IScriptRegistry, type ScriptServices } from "../../../src/game/scripts/types";

const DFS_ITEM_IDS = [11283, 11284];

const EXPLORER_RING_DEFS = [
    { itemId: 13125, chargesPerDay: 2, restorePercent: 50 },
    { itemId: 13126, chargesPerDay: 3, restorePercent: 50 },
    { itemId: 13127, chargesPerDay: 3, restorePercent: 50 },
    { itemId: 13128, chargesPerDay: 4, restorePercent: 50 },
];
const explorerRingStateKey = Symbol("explorerRingCharges");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const GOD_BOOKS: Array<{
    id: number;
    name: string;
    deity: string;
    preachLines: string[];
}> = [
    {
        id: 3840,
        name: "Holy book",
        deity: "Saradomin",
        preachLines: [
            "Saradomin's light will cleanse this land!",
            "Stand fast, for Saradomin watches over us.",
        ],
    },
    {
        id: 3842,
        name: "Unholy book",
        deity: "Zamorak",
        preachLines: ["Chaos will remake the world!", "Embrace the flames of Zamorak!"],
    },
    {
        id: 3844,
        name: "Book of balance",
        deity: "Guthix",
        preachLines: ["Balance in all things.", "Guthix sleeps, yet his will endures."],
    },
    {
        id: 12608,
        name: "Book of law",
        deity: "Armadyl",
        preachLines: ["Harmony through the skies!", "Armadyl guides those who seek justice."],
    },
    {
        id: 12610,
        name: "Book of war",
        deity: "Bandos",
        preachLines: ["Strength above all!", "Bandos demands victory!"],
    },
    {
        id: 12612,
        name: "Book of darkness",
        deity: "Zaros",
        preachLines: ["Zaros' return is inevitable.", "Knowledge is the purest power."],
    },
    {
        id: 12614,
        name: "Book of balance",
        deity: "Guthix",
        preachLines: ["The balance must be preserved.", "Guthix teaches patience and restraint."],
    },
    {
        id: 22299,
        name: "Book of the dead",
        deity: "Kharedst's memoirs",
        preachLines: [
            "The dead whisper secrets to those who listen.",
            "Remember the fallen of the Kharidian desert.",
        ],
    },
];

const dfsChargeKey = Symbol("dfsCharges");

const getDragonfireCharges = (player: any): number => {
    const value = player?.[dfsChargeKey];
    if (Number.isFinite(value as number)) {
        return Math.max(0, value as number);
    }
    player[dfsChargeKey] = 0;
    return 0;
};

const getDayKey = (): number => Math.floor(Date.now() / MS_PER_DAY);

const getExplorerRingState = (player: any): { dayKey: number; used: number } => {
    let state = player?.[explorerRingStateKey];
    const today = getDayKey();
    if (!state) {
        state = { dayKey: today, used: 0 };
    } else if (state.dayKey !== today) {
        state = { dayKey: today, used: 0 };
    }
    player[explorerRingStateKey] = state;
    return state;
};

export function registerEquipmentHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    for (const itemId of DFS_ITEM_IDS) {
        registry.registerEquipmentAction(
            itemId,
            ({ player }) => {
                const store = player;
                const charges = getDragonfireCharges(store);
                if (charges > 0) {
                    services.sendGameMessage(
                        player,
                        `You unleash the dragonfire shield. Stored energy drops to ${Math.max(
                            0,
                            charges - 1,
                        )}.`,
                    );
                    store[dfsChargeKey] = Math.max(0, charges - 1);
                } else {
                    services.sendGameMessage(
                        player,
                        "The shield hasn't absorbed any dragonfire yet.",
                    );
                }
            },
            "operate",
        );

        registry.registerEquipmentAction(
            itemId,
            ({ player }) => {
                const charges = getDragonfireCharges(player);
                services.sendGameMessage(
                    player,
                    `The shield currently holds ${charges} dragonfire charge${
                        charges === 1 ? "" : "s"
                    } (demo value).`,
                );
            },
            "check",
        );
    }

    for (const ring of EXPLORER_RING_DEFS) {
        registry.registerEquipmentAction(
            ring.itemId,
            ({ player }) => {
                const state = getExplorerRingState(player);
                if (state.used >= ring.chargesPerDay) {
                    services.sendGameMessage(
                        player,
                        "Your Explorer's ring has no remaining energy restores for today.",
                    );
                    return;
                }
                state.used++;
                player.adjustRunEnergyPercent(ring.restorePercent);
                const remaining = Math.max(0, ring.chargesPerDay - state.used);
                services.sendGameMessage(
                    player,
                    `You recharge some run energy (${
                        ring.restorePercent
                    }%). ${remaining} charge${remaining === 1 ? "" : "s"} remaining today.`,
                );
            },
            "operate",
        );

        registry.registerEquipmentAction(
            ring.itemId,
            ({ player }) => {
                const state = getExplorerRingState(player);
                const remaining = Math.max(0, ring.chargesPerDay - state.used);
                services.sendGameMessage(
                    player,
                    `Explorer's ring restores remaining today: ${remaining} of ${ring.chargesPerDay}.`,
                );
            },
            "check",
        );
    }

    for (const entry of GOD_BOOKS) {
        registry.registerEquipmentAction(
            entry.id,
            ({ player }) => {
                services.sendGameMessage(
                    player,
                    `You check the ${entry.name.toLowerCase()}. ${
                        entry.deity
                    } watches over you.`,
                );
            },
            "check",
        );

        registry.registerEquipmentAction(
            entry.id,
            ({ player }) => {
                const lines = entry.preachLines;
                const line =
                    lines[Math.floor(Math.random() * lines.length)] ??
                    `${entry.deity} offers their guidance.`;
                services.sendGameMessage(player, line);
            },
            "preach",
        );
    }
}

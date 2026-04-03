import { type ScriptModule } from "../../types";

const RUNE_PACKS = [
    { packId: 12728, runeId: 556, quantity: 100, name: "air" }, // Air rune pack
    { packId: 12730, runeId: 555, quantity: 100, name: "water" }, // Water rune pack
    { packId: 12732, runeId: 557, quantity: 100, name: "earth" }, // Earth rune pack
    { packId: 12734, runeId: 554, quantity: 100, name: "fire" }, // Fire rune pack
    { packId: 12736, runeId: 558, quantity: 100, name: "mind" }, // Mind rune pack
    { packId: 12738, runeId: 562, quantity: 100, name: "chaos" }, // Chaos rune pack
];

export const packsModule: ScriptModule = {
    id: "items.packs",
    register(registry, services) {
        for (const pack of RUNE_PACKS) {
            registry.registerItemAction(
                pack.packId,
                ({ player, source, services: svc }) => {
                    const inventory = svc.getInventoryItems(player);
                    const slotEntry = inventory[source.slot];
                    if (
                        !slotEntry ||
                        slotEntry.itemId !== source.itemId ||
                        slotEntry.quantity <= 0
                    ) {
                        return;
                    }

                    if (!svc.consumeItem(player, source.slot)) {
                        return;
                    }

                    svc.addItemToInventory(player, pack.runeId, pack.quantity);
                    svc.snapshotInventory(player);
                    svc.sendGameMessage(
                        player,
                        `You open the ${pack.name} rune pack and receive ${pack.quantity} ${pack.name} runes.`,
                    );
                },
                "open",
            );
        }
    },
};
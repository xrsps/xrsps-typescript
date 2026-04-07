import { type IScriptRegistry, type ScriptServices } from "../../../../src/game/scripts/types";

function mapFollowerFailure(reason: string): string {
    switch (reason) {
        case "already_active":
            return "You already have a follower.";
        case "not_owner":
            return "That's not your follower.";
        default:
            return "Nothing interesting happens.";
    }
}

export function registerFollowerItemHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    const followerDefs = services.followers?.getItemDefinitions() ?? [];
    for (const definition of followerDefs) {
        registry.registerItemAction(
            definition.itemId,
            ({ player, source, services: svc }) => {
                const inventory = svc.inventory.getInventoryItems(player);
                const slotEntry = inventory[source.slot];
                if (
                    !slotEntry ||
                    slotEntry.itemId !== source.itemId ||
                    slotEntry.quantity <= 0
                ) {
                    return;
                }

                svc.dialog.closeInterruptibleInterfaces(player);

                if (!svc.inventory.consumeItem(player, source.slot)) {
                    return;
                }

                const result = svc.followers?.summonFollowerFromItem(
                    player,
                    source.itemId,
                    definition.npcTypeId,
                );
                if (!result || !result.ok) {
                    svc.inventory.addItemToInventory(player, source.itemId, 1);
                    svc.inventory.snapshotInventoryImmediate(player);
                    svc.messaging.sendGameMessage(player, mapFollowerFailure(result?.reason ?? ""));
                    return;
                }

                svc.inventory.snapshotInventoryImmediate(player);
            },
            "drop",
        );

        registry.registerNpcInteraction(
            definition.npcTypeId,
            ({ player, npc, services: svc }) => {
                const follower = npc.getFollowerState();
                if (!follower) {
                    svc.messaging.sendGameMessage(player, "Nothing interesting happens.");
                    return;
                }

                if (follower.ownerPlayerId !== player.id) {
                    svc.messaging.sendGameMessage(player, "That's not your follower.");
                    return;
                }

                const inventory = svc.inventory.getInventoryItems(player);
                const hasSpace = inventory.some(
                    (entry) => entry.itemId <= 0 || entry.quantity <= 0,
                );
                if (!hasSpace) {
                    svc.messaging.sendGameMessage(player, "You don't have enough inventory space.");
                    return;
                }

                const pickup = svc.followers?.pickupFollower(player, npc.id);
                if (!pickup || !pickup.ok) {
                    svc.messaging.sendGameMessage(player, mapFollowerFailure(pickup?.reason ?? ""));
                    return;
                }

                const restored = svc.inventory.addItemToInventory(player, pickup.itemId, 1);
                if (restored.added <= 0) {
                    svc.followers?.summonFollowerFromItem(player, pickup.itemId, pickup.npcTypeId);
                    svc.messaging.sendGameMessage(player, "You don't have enough inventory space.");
                    return;
                }

                svc.inventory.snapshotInventoryImmediate(player);
            },
            "pick-up",
        );
    }

    const primaryNpcTypeIds = new Set(followerDefs.map((d) => d.npcTypeId));
    const variantNpcTypeIds = new Set<number>();
    for (const definition of followerDefs) {
        for (const variant of definition.variants ?? []) {
            if (!primaryNpcTypeIds.has(variant.npcTypeId)) {
                variantNpcTypeIds.add(variant.npcTypeId);
            }
        }
    }

    for (const npcTypeId of variantNpcTypeIds) {
        registry.registerNpcInteraction(
            npcTypeId,
            ({ player, npc, services: svc }) => {
                const follower = npc.getFollowerState();
                if (!follower) {
                    svc.messaging.sendGameMessage(player, "Nothing interesting happens.");
                    return;
                }

                if (follower.ownerPlayerId !== player.id) {
                    svc.messaging.sendGameMessage(player, "That's not your follower.");
                    return;
                }

                const inventory = svc.inventory.getInventoryItems(player);
                const hasSpace = inventory.some(
                    (entry) => entry.itemId <= 0 || entry.quantity <= 0,
                );
                if (!hasSpace) {
                    svc.messaging.sendGameMessage(player, "You don't have enough inventory space.");
                    return;
                }

                const pickup = svc.followers?.pickupFollower(player, npc.id);
                if (!pickup || !pickup.ok) {
                    svc.messaging.sendGameMessage(player, mapFollowerFailure(pickup?.reason ?? ""));
                    return;
                }

                const restored = svc.inventory.addItemToInventory(player, pickup.itemId, 1);
                if (restored.added <= 0) {
                    svc.followers?.summonFollowerFromItem(player, pickup.itemId, pickup.npcTypeId);
                    svc.messaging.sendGameMessage(player, "You don't have enough inventory space.");
                    return;
                }

                svc.inventory.snapshotInventoryImmediate(player);
            },
            "pick-up",
        );

        registry.registerNpcInteraction(
            npcTypeId,
            ({ player, npc, services: svc }) => {
                const follower = npc.getFollowerState();
                if (!follower || follower.ownerPlayerId !== player.id) {
                    return;
                }

                const definition =
                    svc.followers?.getDefinitionByItemId(follower.itemId) ??
                    svc.followers?.getDefinitionByNpcTypeId(npc.typeId);
                if (!definition) {
                    return;
                }

                svc.messaging.sendGameMessage(
                    player,
                    `${
                        npc.name ?? "Your follower"
                    } watches you in silence. That interaction isn't implemented yet.`,
                );
            },
            "talk-to",
        );

        registry.registerNpcInteraction(
            npcTypeId,
            ({ player, npc, services: svc }) => {
                const follower = npc.getFollowerState();
                if (!follower) {
                    svc.messaging.sendGameMessage(player, "Nothing interesting happens.");
                    return;
                }
                if (follower.ownerPlayerId !== player.id) {
                    svc.messaging.sendGameMessage(player, "That's not your follower.");
                    return;
                }
                const metamorph = svc.followers?.metamorphFollower(player, npc.id);
                if (!metamorph || !metamorph.ok) {
                    svc.messaging.sendGameMessage(player, mapFollowerFailure(metamorph?.reason ?? ""));
                }
            },
            "metamorphosis",
        );
    }
}

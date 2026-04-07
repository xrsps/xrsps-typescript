import type { ActionExecutionResult, ScheduledAction } from "../actions";
import type { PlayerState } from "../player";
import type { ServerServices } from "../ServerServices";

export class ActionDispatchService {
    constructor(private readonly services: ServerServices) {}

    dispatch(
        player: PlayerState,
        action: ScheduledAction,
        tick: number,
    ): ActionExecutionResult {
        switch (action.kind) {
            case "inventory.use_on":
                return this.services.inventoryActionHandler!.executeInventoryUseOnAction(
                    player, action.data, tick,
                );
            case "inventory.equip":
                return this.services.inventoryActionHandler!.executeInventoryEquipAction(
                    player, action.data,
                );
            case "inventory.consume":
                return this.services.inventoryActionHandler!.executeInventoryConsumeAction(
                    player, action.data,
                );
            case "inventory.consume_script":
                return this.services.inventoryActionHandler!.executeScriptedConsumeAction(
                    player, action.data, tick,
                );
            case "inventory.move":
                return this.services.inventoryActionHandler!.executeInventoryMoveAction(
                    player, action.data,
                );
            case "inventory.unequip":
                return this.services.inventoryActionHandler!.executeInventoryUnequipAction(
                    player, action.data,
                );
            case "combat.attack":
                return this.services.combatActionHandler!.executeCombatAttackAction(
                    player, action.data, tick,
                );
            case "combat.autocast":
                return this.services.combatActionHandler!.executeCombatAutocastAction(
                    player, action.data, tick,
                );
            case "combat.playerHit":
                return this.services.combatActionHandler!.executeCombatPlayerHitAction(
                    player, action.data, tick,
                );
            case "combat.npcRetaliate":
                return this.services.combatActionHandler!.executeCombatNpcRetaliateAction(
                    player, action.data, tick,
                );
            case "combat.companionHit":
                return this.services.combatActionHandler!.executeCombatCompanionHitAction(
                    player, action.data, tick,
                );
            case "movement.teleport":
                return this.services.movementService.executeMovementTeleportAction(player, action.data, tick);
            case "emote.play":
                return this.services.movementService.executeEmotePlayAction(player, action.data);
            case "npc.trade": {
                const tradeData = action.data as { npcTypeId?: number; shopId?: string };
                this.services.scriptRuntime.getServices().openShop?.(player, tradeData);
                return { ok: true, effects: [] };
            }
            default: {
                const scriptHandler = this.services.scriptRegistry.findActionHandler(action.kind);
                if (scriptHandler) {
                    return scriptHandler({
                        player,
                        data: action.data,
                        tick,
                        services: this.services.scriptRuntime.getServices(),
                    });
                }
                return {
                    ok: false,
                    reason: `unknown_action:${action.kind}`,
                    effects: [
                        {
                            type: "log",
                            playerId: player.id,
                            level: "warn",
                            message: `Unhandled action kind ${action.kind}`,
                        },
                    ],
                };
            }
        }
    }
}

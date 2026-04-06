import type { ActionExecutionResult, ScheduledAction } from "../actions";
import type { PlayerState } from "../player";

export interface ActionDispatchServiceDeps {
    inventoryActionHandler: {
        executeInventoryUseOnAction: (player: PlayerState, data: any, tick: number) => ActionExecutionResult;
        executeInventoryEquipAction: (player: PlayerState, data: any) => ActionExecutionResult;
        executeInventoryConsumeAction: (player: PlayerState, data: any) => ActionExecutionResult;
        executeScriptedConsumeAction: (player: PlayerState, data: any, tick: number) => ActionExecutionResult;
        executeInventoryMoveAction: (player: PlayerState, data: any) => ActionExecutionResult;
        executeInventoryUnequipAction: (player: PlayerState, data: any) => ActionExecutionResult;
    };
    combatActionHandler: {
        executeCombatAttackAction: (player: PlayerState, data: any, tick: number) => ActionExecutionResult;
        executeCombatAutocastAction: (player: PlayerState, data: any, tick: number) => ActionExecutionResult;
        executeCombatPlayerHitAction: (player: PlayerState, data: any, tick: number) => ActionExecutionResult;
        executeCombatNpcRetaliateAction: (player: PlayerState, data: any, tick: number) => ActionExecutionResult;
        executeCombatCompanionHitAction: (player: PlayerState, data: any, tick: number) => ActionExecutionResult;
    };
    executeMovementTeleportAction: (player: PlayerState, data: any, tick: number) => ActionExecutionResult;
    executeEmotePlayAction: (player: PlayerState, data: any) => ActionExecutionResult;
    getScriptServices: () => any;
    findActionHandler: (kind: string) => ((event: any) => ActionExecutionResult) | undefined;
}

export class ActionDispatchService {
    constructor(private readonly deps: ActionDispatchServiceDeps) {}

    dispatch(
        player: PlayerState,
        action: ScheduledAction,
        tick: number,
    ): ActionExecutionResult {
        switch (action.kind) {
            case "inventory.use_on":
                return this.deps.inventoryActionHandler.executeInventoryUseOnAction(
                    player, action.data, tick,
                );
            case "inventory.equip":
                return this.deps.inventoryActionHandler.executeInventoryEquipAction(
                    player, action.data,
                );
            case "inventory.consume":
                return this.deps.inventoryActionHandler.executeInventoryConsumeAction(
                    player, action.data,
                );
            case "inventory.consume_script":
                return this.deps.inventoryActionHandler.executeScriptedConsumeAction(
                    player, action.data, tick,
                );
            case "inventory.move":
                return this.deps.inventoryActionHandler.executeInventoryMoveAction(
                    player, action.data,
                );
            case "inventory.unequip":
                return this.deps.inventoryActionHandler.executeInventoryUnequipAction(
                    player, action.data,
                );
            case "combat.attack":
                return this.deps.combatActionHandler.executeCombatAttackAction(
                    player, action.data, tick,
                );
            case "combat.autocast":
                return this.deps.combatActionHandler.executeCombatAutocastAction(
                    player, action.data, tick,
                );
            case "combat.playerHit":
                return this.deps.combatActionHandler.executeCombatPlayerHitAction(
                    player, action.data, tick,
                );
            case "combat.npcRetaliate":
                return this.deps.combatActionHandler.executeCombatNpcRetaliateAction(
                    player, action.data, tick,
                );
            case "combat.companionHit":
                return this.deps.combatActionHandler.executeCombatCompanionHitAction(
                    player, action.data, tick,
                );
            case "movement.teleport":
                return this.deps.executeMovementTeleportAction(player, action.data, tick);
            case "emote.play":
                return this.deps.executeEmotePlayAction(player, action.data);
            case "npc.trade": {
                const tradeData = action.data as { npcTypeId?: number; shopId?: string };
                this.deps.getScriptServices().openShop?.(player, tradeData);
                return { ok: true, effects: [] };
            }
            default: {
                const scriptHandler = this.deps.findActionHandler(action.kind);
                if (scriptHandler) {
                    return scriptHandler({
                        player,
                        data: action.data,
                        tick,
                        services: this.deps.getScriptServices(),
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

import { type IScriptRegistry, type ScriptServices } from "../../../../src/game/scripts/types";

const DOOR_ACTIONS = ["open", "close", "unlock", "lock"];

// Door/gate sound effects (OSRS sound IDs)
const DOOR_SOUND = 60; // Standard wooden door open/close
const GATE_SOUND = 71; // Metal gate open/close

export function registerDoorHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    const { doorManager, emitLocChange } = services.location;
    if (!doorManager) return;

    for (const action of DOOR_ACTIONS) {
        registry.registerLocAction(action, (event) => {
            const result = doorManager.toggleDoor({
                x: event.tile.x,
                y: event.tile.y,
                level: event.level,
                currentId: event.locId,
                action: event.action,
                currentTick: event.tick,
            });
            if (result?.success && result.newLocId !== undefined) {
                emitLocChange(event.locId, result.newLocId, event.tile, event.level, {
                    oldTile: event.tile,
                    newTile: result.newTile ?? event.tile,
                    oldRotation: result.oldRotation,
                    newRotation: result.newRotation,
                });

                if (result.partnerResult) {
                    emitLocChange(
                        result.partnerResult.oldLocId,
                        result.partnerResult.newLocId,
                        result.partnerResult.oldTile,
                        event.level,
                        {
                            oldTile: result.partnerResult.oldTile,
                            newTile: result.partnerResult.newTile,
                            oldRotation: result.partnerResult.oldRotation,
                            newRotation: result.partnerResult.newRotation,
                        },
                    );
                }

                // Play door/gate sound
                // Check if loc is a gate by looking up its definition
                const locDef = services.data.getLocDefinition(event.locId);
                const locName = (locDef?.name ?? "").toLowerCase();
                const isGate = locName.includes("gate");
                const soundId = isGate ? GATE_SOUND : DOOR_SOUND;

                services.sound.playAreaSound({
                    soundId,
                    tile: { x: event.tile.x, y: event.tile.y },
                    level: event.level,
                    radius: 5,
                    volume: 255,
                });
            }
        });
    }
}

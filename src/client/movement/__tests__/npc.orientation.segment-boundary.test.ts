import { MovementDirection, directionToOrientation } from "../../../shared/Direction";
import { NpcEcs } from "../../ecs/NpcEcs";
import { NpcMovementSync } from "../NpcMovementSync";

function subOf(tile: number): number {
    return (tile << 7) + 64;
}

describe("NpcMovementSync retreat facing parity", () => {
    test("queued movement does not immediately replace the prior facing", () => {
        const ecs = new NpcEcs();
        const id = ecs.createNpc(50, 50, 99, 1, subOf(10), subOf(10), 0, 1536, 10, 10, 64, true);
        ecs.setServerMapping(id, 777);
        ecs.setTargetRot(id, 1536);
        ecs.setRotation(id, 1536);
        ecs.setServerState(id, {
            subX: subOf(10),
            subY: subOf(10),
            tileX: 10,
            tileY: 10,
            plane: 0,
        });

        const sync = new NpcMovementSync(ecs);
        sync.applyNpcUpdate({
            serverId: 777,
            ecsIndex: id,
            level: 0,
            localX: subOf(10),
            localY: subOf(10),
            mapBaseX: 0,
            mapBaseY: 0,
            directions: [MovementDirection.West],
            traversals: [1],
            moved: true,
        });

        expect(ecs.getTargetRot(id)).toBe(1536);
        expect(ecs.getCurrentStepRot(id)).toBeUndefined();

        ecs.updateClient(1);

        expect(ecs.getCurrentStepRot(id)).toBe(directionToOrientation(MovementDirection.West));
        expect(ecs.getTargetRot(id)).toBe(1536);
    });
});

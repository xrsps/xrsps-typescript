import { NpcEcs } from "./NpcEcs";

describe("NpcEcs map indexing", () => {
    it("keeps NPCs addressable when they reside in negative map squares", () => {
        const ecs = new NpcEcs();

        const mapX = -1;
        const mapY = 0;
        const spawnTileX = 12;
        const spawnTileY = 34;
        const level = 1;
        const typeId = 42;

        const id = ecs.createNpc(
            mapX,
            mapY,
            typeId,
            1,
            spawnTileX * 128,
            spawnTileY * 128,
            level,
            0,
            spawnTileX,
            spawnTileY,
        );

        expect(id).toBeGreaterThan(0);
        expect(ecs.findBySpawn(mapX, mapY, spawnTileX, spawnTileY, level, typeId)).toBe(id);

        ecs.destroyNpcsForMap(mapX, mapY);

        expect(ecs.isActive(id)).toBe(false);
        expect(ecs.findBySpawn(mapX, mapY, spawnTileX, spawnTileY, level, typeId)).toBeUndefined();
    });

    it("rebases local coordinates when moving NPC ownership to another map square", () => {
        const ecs = new NpcEcs();
        const id = ecs.createNpc(50, 50, 99, 1, 3200, 4600, 0, 0, 25, 35);
        ecs.setTargetXY(id, 3600, 5000);

        const prevMapId = ecs.getMapId(id) | 0;
        const prevMapX = (prevMapId >> 8) & 0xff;
        const prevMapY = prevMapId & 0xff;
        const prevWorldX = ((prevMapX << 13) + (ecs.getX(id) | 0)) | 0;
        const prevWorldY = ((prevMapY << 13) + (ecs.getY(id) | 0)) | 0;
        const prevTargetWorldX = ((prevMapX << 13) + (ecs.getTargetX(id) | 0)) | 0;
        const prevTargetWorldY = ((prevMapY << 13) + (ecs.getTargetY(id) | 0)) | 0;

        ecs.rebaseToMapSquare(id, 51, 49);

        const nextMapId = ecs.getMapId(id) | 0;
        const nextMapX = (nextMapId >> 8) & 0xff;
        const nextMapY = nextMapId & 0xff;
        const nextWorldX = ((nextMapX << 13) + (ecs.getX(id) | 0)) | 0;
        const nextWorldY = ((nextMapY << 13) + (ecs.getY(id) | 0)) | 0;
        const nextTargetWorldX = ((nextMapX << 13) + (ecs.getTargetX(id) | 0)) | 0;
        const nextTargetWorldY = ((nextMapY << 13) + (ecs.getTargetY(id) | 0)) | 0;

        expect(nextMapX).toBe(51);
        expect(nextMapY).toBe(49);
        expect(nextWorldX).toBe(prevWorldX);
        expect(nextWorldY).toBe(prevWorldY);
        expect(nextTargetWorldX).toBe(prevTargetWorldX);
        expect(nextTargetWorldY).toBe(prevTargetWorldY);
        expect(ecs.queryByMap(50, 50)).toHaveLength(0);
        expect(ecs.queryByMap(51, 49)).toContain(id);
    });
});

describe("NpcEcs movement parity", () => {
    it("snaps to far targets (>256 units) and consumes one step", () => {
        const ecs = new NpcEcs();
        const id = ecs.createNpc(50, 50, 99, 1, 64, 64, 0, 0, 0, 0);
        ecs.setServerMapping(id, 1);

        const firstTargetX = 64 + 1280;
        const secondTargetX = 64 + 1408;
        ecs.enqueueStep(id, firstTargetX, 64, 4);
        ecs.enqueueStep(id, secondTargetX, 64, 4);

        ecs.updateClient(1);

        // OSRS parity: one far path step is snapped/consumed per client tick.
        expect(ecs.getX(id)).toBe(firstTargetX);
        expect(ecs.getY(id)).toBe(64);
        expect(ecs.isStepActive(id)).toBe(true);
        expect(ecs.getTargetX(id)).toBe(secondTargetX);
        expect(ecs.getTargetY(id)).toBe(64);
    });

    it("drains queued far steps across subsequent ticks to catch up quickly", () => {
        const ecs = new NpcEcs();
        const id = ecs.createNpc(50, 50, 99, 1, 64, 64, 0, 0, 0, 0);
        ecs.setServerMapping(id, 2);

        const targetA = 64 + 1280;
        const targetB = 64 + 1664;
        const targetC = 64 + 2048;
        ecs.enqueueStep(id, targetA, 64, 4);
        ecs.enqueueStep(id, targetB, 64, 4);
        ecs.enqueueStep(id, targetC, 64, 4);

        ecs.updateClient(1);
        expect(ecs.getX(id)).toBe(targetA);
        ecs.updateClient(1);
        expect(ecs.getX(id)).toBe(targetB);
        ecs.updateClient(1);
        expect(ecs.getX(id)).toBe(targetC);
    });

    it("slows clipped NPC movement while turning into a retreat step", () => {
        const clipped = new NpcEcs();
        const clippedId = clipped.createNpc(50, 50, 99, 1, 64, 64, 0, 0, 0, 0, 64, true);
        clipped.setServerMapping(clippedId, 3);
        clipped.setRotation(clippedId, 1024);
        clipped.enqueueStep(clippedId, 64 + 128, 64, 4);

        clipped.updateClient(1);

        expect(clipped.getX(clippedId)).toBe(66);
        expect(clipped.getY(clippedId)).toBe(64);

        const unclipped = new NpcEcs();
        const unclippedId = unclipped.createNpc(50, 50, 99, 1, 64, 64, 0, 0, 0, 0, 64, false);
        unclipped.setServerMapping(unclippedId, 4);
        unclipped.setRotation(unclippedId, 1024);
        unclipped.enqueueStep(unclippedId, 64 + 128, 64, 4);

        unclipped.updateClient(1);

        expect(unclipped.getX(unclippedId)).toBe(68);
        expect(unclipped.getY(unclippedId)).toBe(64);
    });
});

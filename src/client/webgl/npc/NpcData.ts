import { AnimationFrames } from "../AnimationFrames";
import type {
    NpcInstance,
    NpcRenderBundle,
    NpcRenderExtraAnim,
    NpcRenderTemplate,
} from "./NpcRenderTemplate";

export type NpcData = {
    id: number;
    serverId?: number;
    worldViewId?: number;
    tileX: number;
    tileY: number;
    level: number;
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames | undefined;
    extraAnims?: NpcRenderExtraAnim[];
};

export function createNpcDatas(
    bundles: NpcRenderBundle[],
    baseTileX: number,
    baseTileY: number,
): NpcData[] {
    const npcs: NpcData[] = [];

    for (const bundle of bundles) {
        for (const instance of bundle.instances) {
            npcs.push(createNpcData(bundle.template, instance, baseTileX, baseTileY));
        }
    }

    return npcs;
}

export function createNpcData(
    template: NpcRenderTemplate,
    instance: NpcInstance,
    baseTileX: number,
    baseTileY: number,
): NpcData {
    const tileX = (instance.x | 0) - (baseTileX | 0);
    const tileY = (instance.y | 0) - (baseTileY | 0);
    const level = instance.level;
    return {
        id: instance.typeId,
        serverId: typeof instance.serverId === "number" ? instance.serverId | 0 : undefined,
        worldViewId:
            typeof instance.worldViewId === "number" ? instance.worldViewId | 0 : undefined,
        tileX,
        tileY,
        level,
        idleAnim: template.idleAnim,
        walkAnim: template.walkAnim,
        extraAnims: template.extraAnims?.slice(),
    };
}

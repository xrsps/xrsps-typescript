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
    tileX: number;
    tileY: number;
    level: number;
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames | undefined;
    extraAnims?: NpcRenderExtraAnim[];
};

export function createNpcDatas(bundles: NpcRenderBundle[]): NpcData[] {
    const npcs: NpcData[] = [];

    for (const bundle of bundles) {
        for (const instance of bundle.instances) {
            npcs.push(createNpcData(bundle.template, instance));
        }
    }

    return npcs;
}

export function createNpcData(template: NpcRenderTemplate, instance: NpcInstance): NpcData {
    const tileX = instance.x % 64;
    const tileY = instance.y % 64;
    const level = instance.level;
    return {
        id: instance.typeId,
        serverId: typeof instance.serverId === "number" ? instance.serverId | 0 : undefined,
        tileX,
        tileY,
        level,
        idleAnim: template.idleAnim,
        walkAnim: template.walkAnim,
        extraAnims: template.extraAnims?.slice(),
    };
}

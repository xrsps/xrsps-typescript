import { AnimationFrames } from "../AnimationFrames";

export type NpcInstance = {
    /** Optional server-authored NPC index (OSRS: 1..65534). */
    serverId?: number;
    typeId: number;
    x: number;
    y: number;
    level: number;
    worldViewId?: number;
    name?: string;
};

export type NpcRenderExtraAnim = {
    seqId: number;
    anim: AnimationFrames;
    frameLengths: number[];
};

export type NpcRenderTemplate = {
    typeId: number;
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames | undefined;
    extraAnims?: NpcRenderExtraAnim[];
};

export type NpcRenderBundle = {
    template: NpcRenderTemplate;
    instances: NpcInstance[];
};

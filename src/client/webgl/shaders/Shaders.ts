import { ProgramSource, prependDefines } from "./ShaderUtil";
import frameFxaaFragShader from "./frame-fxaa.frag.glsl";
import frameFxaaVertShader from "./frame-fxaa.vert.glsl";
import frameFragShader from "./frame.frag.glsl";
import frameVertShader from "./frame.vert.glsl";
import mainFragShader from "./main.frag.glsl";
import mainVertShader from "./main.vert.glsl";
import npcVertShader from "./npc.vert.glsl";
import playerFragShader from "./player.frag.glsl";
import playerVertShader from "./player.vert.glsl";
import projectileVertShader from "./projectile.vert.glsl";

export function createProgram(
    vertShader: string,
    fragShader: string,
    discardAlpha: boolean,
    multiDraw: boolean,
): ProgramSource {
    const defines: string[] = [];
    if (multiDraw) {
        defines.push("MULTI_DRAW");
    }
    if (discardAlpha) {
        defines.push("DISCARD_ALPHA");
    }
    return [prependDefines(vertShader, defines), prependDefines(fragShader, defines)];
}

export function createMainProgram(discardAlpha: boolean, multiDraw: boolean): ProgramSource {
    return createProgram(mainVertShader, mainFragShader, discardAlpha, multiDraw);
}

export function createNpcProgram(discardAlpha: boolean, multiDraw: boolean): ProgramSource {
    return createProgram(npcVertShader, mainFragShader, discardAlpha, multiDraw);
}

export function createProjectileProgram(discardAlpha: boolean, multiDraw: boolean): ProgramSource {
    return createProgram(projectileVertShader, mainFragShader, discardAlpha, multiDraw);
}

export function createPlayerProgram(discardAlpha: boolean, multiDraw: boolean): ProgramSource {
    return createProgram(playerVertShader, playerFragShader, discardAlpha, multiDraw);
}

export const FRAME_PROGRAM = [frameVertShader, frameFragShader];
export const FRAME_FXAA_PROGRAM = [frameFxaaVertShader, frameFxaaFragShader];

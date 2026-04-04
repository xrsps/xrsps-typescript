import {
    DrawCall,
    Framebuffer,
    App as PicoApp,
    PicoGL,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

export interface InteractHighlightDrawTarget {
    trianglePoints?: ReadonlyArray<readonly [number, number, number]>;
    /** 0xRRGGBB */
    color: number;
    alpha?: number;
}

export interface InteractHighlightOverlayContext {
    getTargets: () => ReadonlyArray<InteractHighlightDrawTarget>;
}

const MAX_TRI_POINTS = 131072; // 43k triangles
const DEFAULT_ALPHA = 0.95;
const DEFAULT_OUTLINE_RADIUS = 1.9;

const MASK_VERT_SRC = `#version 300 es
layout(std140, column_major) uniform;
precision highp float;

uniform SceneUniforms {
    mat4 u_viewProjMatrix;
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    vec4 u_skyColor;
    vec4 u_sceneHslOverride;
    vec2 u_cameraPos;
    vec2 u_playerPos;
    float u_renderDistance;
    float u_fogDepth;
    float u_currentTime;
    float u_brightness;
    float u_colorBanding;
    float u_isNewTextureAnim;
};

layout(location=0) in vec3 a_position;

void main() {
    vec4 pos = u_viewMatrix * vec4(a_position, 1.0);
    gl_Position = u_projectionMatrix * pos;
}
`;

const MASK_FRAG_SRC = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() {
    fragColor = vec4(1.0);
}
`;

const COMPOSE_VERT_SRC = `#version 300 es
layout(location=0) in vec2 a_position;
out vec2 v_uv;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = a_position * 0.5 + 0.5;
}
`;

const COMPOSE_FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_mask;
uniform vec2 u_texelSize;
uniform vec4 u_color;
uniform float u_outlineRadius;
out vec4 fragColor;

float ringAverage(vec2 stepPx) {
    float sum = 0.0;
    sum += texture(u_mask, v_uv + vec2(-stepPx.x, -stepPx.y)).a;
    sum += texture(u_mask, v_uv + vec2(0.0, -stepPx.y)).a;
    sum += texture(u_mask, v_uv + vec2(stepPx.x, -stepPx.y)).a;
    sum += texture(u_mask, v_uv + vec2(-stepPx.x, 0.0)).a;
    sum += texture(u_mask, v_uv + vec2(stepPx.x, 0.0)).a;
    sum += texture(u_mask, v_uv + vec2(-stepPx.x, stepPx.y)).a;
    sum += texture(u_mask, v_uv + vec2(0.0, stepPx.y)).a;
    sum += texture(u_mask, v_uv + vec2(stepPx.x, stepPx.y)).a;
    return sum * 0.125;
}

void main() {
    float center = texture(u_mask, v_uv).a;
    vec2 stepA = u_texelSize * u_outlineRadius;
    vec2 stepB = u_texelSize * (u_outlineRadius * 2.0);
    vec2 stepC = u_texelSize * (u_outlineRadius * 3.0);

    // Weighted multi-ring blur around the model mask.
    float ringA = ringAverage(stepA);
    float ringB = ringAverage(stepB);
    float ringC = ringAverage(stepC);
    float blur = ringA * 0.42 + ringB * 0.36 + ringC * 0.22;

    // Outside-only halo: interior mask area should not be tinted.
    float outside = max(1.0 - center, 0.0);
    float edge = blur * outside;
    edge = smoothstep(0.005, 0.34, edge);
    if (edge <= 0.001) {
        discard;
    }
    fragColor = vec4(u_color.rgb, u_color.a * edge);
}
`;

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export class InteractHighlightOverlay implements Overlay {
    constructor(private readonly ctx: InteractHighlightOverlayContext) {}

    private app!: PicoApp;
    private sceneUniforms!: UniformBuffer;

    private maskTexture?: Texture;
    private maskFramebuffer?: Framebuffer;
    private maskWidth = 0;
    private maskHeight = 0;

    private triPositions?: VertexBuffer;
    private triArray?: VertexArray;
    private triDrawCall?: DrawCall;

    private quadPositions?: VertexBuffer;
    private quadArray?: VertexArray;
    private quadDrawCall?: DrawCall;

    private readonly triVerts = new Float32Array(MAX_TRI_POINTS * 3);
    private readonly color = new Float32Array(4);
    private readonly texelSize = new Float32Array(2);

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.sceneUniforms = args.sceneUniforms;

        const maskProgram = this.app.createProgram(MASK_VERT_SRC, MASK_FRAG_SRC);
        const composeProgram = this.app.createProgram(COMPOSE_VERT_SRC, COMPOSE_FRAG_SRC);

        this.triPositions = this.app.createVertexBuffer(PicoGL.FLOAT, 3, this.triVerts);
        this.triArray = this.app.createVertexArray().vertexAttributeBuffer(0, this.triPositions);
        this.triArray.numElements = 0;
        this.triDrawCall = this.app
            .createDrawCall(maskProgram, this.triArray)
            .uniformBlock("SceneUniforms", this.sceneUniforms)
            .primitive(PicoGL.TRIANGLES);

        const quadVerts = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
        this.quadPositions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, quadVerts);
        this.quadArray = this.app.createVertexArray().vertexAttributeBuffer(0, this.quadPositions);
        this.quadArray.numElements = 6;
        this.quadDrawCall = this.app
            .createDrawCall(composeProgram, this.quadArray)
            .uniform("u_texelSize", this.texelSize)
            .uniform("u_color", this.color)
            .uniform("u_outlineRadius", DEFAULT_OUTLINE_RADIUS);
    }

    update(_args: OverlayUpdateArgs): void {}

    draw(phase: RenderPhase): void {
        if (phase !== RenderPhase.PostPresent) return;
        if (
            !this.triPositions ||
            !this.triArray ||
            !this.triDrawCall ||
            !this.quadDrawCall ||
            !this.quadArray
        ) {
            return;
        }

        const targets = this.ctx.getTargets?.() ?? [];
        if (targets.length === 0) {
            this.triPositions.numItems = 0;
            this.triArray.numElements = 0;
            return;
        }

        this.ensureMaskTarget();
        if (
            !this.maskTexture ||
            !this.maskFramebuffer ||
            this.maskWidth <= 0 ||
            this.maskHeight <= 0
        ) {
            return;
        }

        this.texelSize[0] = 1.0 / this.maskWidth;
        this.texelSize[1] = 1.0 / this.maskHeight;

        this.app.disable(PicoGL.DEPTH_TEST);
        this.app.disable(PicoGL.CULL_FACE);

        for (const target of targets) {
            const triPoints = target.trianglePoints;
            if (!triPoints || triPoints.length < 3) {
                continue;
            }

            const triCount = this.writeTriangleVerts(triPoints);
            if (triCount < 3) {
                continue;
            }

            this.triPositions.data(this.triVerts.subarray(0, triCount * 3));
            this.triPositions.numItems = triCount;
            this.triArray.numElements = triCount;

            this.app.drawFramebuffer(this.maskFramebuffer);
            this.app.viewport(0, 0, this.maskWidth, this.maskHeight);
            this.app.disable(PicoGL.BLEND);
            this.app.clearColor(0.0, 0.0, 0.0, 0.0);
            this.app.clear();
            this.triDrawCall.draw();

            const color = target.color >>> 0;
            this.color[0] = ((color >> 16) & 0xff) / 255.0;
            this.color[1] = ((color >> 8) & 0xff) / 255.0;
            this.color[2] = (color & 0xff) / 255.0;
            this.color[3] = clamp01(
                Number.isFinite(target.alpha) ? (target.alpha as number) : DEFAULT_ALPHA,
            );

            this.app.defaultDrawFramebuffer();
            this.app.viewport(0, 0, this.maskWidth, this.maskHeight);
            this.app.enable(PicoGL.BLEND);
            this.app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);
            this.quadDrawCall
                .texture("u_mask", this.maskTexture)
                .uniform("u_texelSize", this.texelSize)
                .uniform("u_color", this.color)
                .draw();
        }

        this.app.disable(PicoGL.BLEND);
    }

    dispose(): void {
        try {
            this.triPositions?.delete?.();
            this.triArray?.delete?.();
            this.quadPositions?.delete?.();
            this.quadArray?.delete?.();
            this.maskFramebuffer?.delete?.();
            this.maskTexture?.delete?.();
        } catch {}
        this.triPositions = undefined;
        this.triArray = undefined;
        this.triDrawCall = undefined;
        this.quadPositions = undefined;
        this.quadArray = undefined;
        this.quadDrawCall = undefined;
        this.maskFramebuffer = undefined;
        this.maskTexture = undefined;
        this.maskWidth = 0;
        this.maskHeight = 0;
    }

    private ensureMaskTarget(): void {
        const w = this.app.width | 0;
        const h = this.app.height | 0;
        if (w <= 0 || h <= 0) return;
        if (
            this.maskTexture &&
            this.maskFramebuffer &&
            this.maskWidth === w &&
            this.maskHeight === h
        ) {
            return;
        }

        try {
            this.maskFramebuffer?.delete?.();
            this.maskTexture?.delete?.();
        } catch {}

        this.maskTexture = this.app.createTexture2D(w, h, {
            internalFormat: PicoGL.RGBA8,
            minFilter: PicoGL.LINEAR,
            magFilter: PicoGL.LINEAR,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        this.maskFramebuffer = this.app.createFramebuffer().colorTarget(0, this.maskTexture);
        this.maskWidth = w;
        this.maskHeight = h;
    }

    private writeTriangleVerts(
        triPoints: ReadonlyArray<readonly [number, number, number]>,
    ): number {
        const maxCount = Math.min((triPoints.length / 3) | 0, (MAX_TRI_POINTS / 3) | 0) * 3;
        let vi = 0;
        for (let i = 0; i < maxCount; i++) {
            const p = triPoints[i];
            this.triVerts[vi++] = p[0];
            this.triVerts[vi++] = p[1];
            this.triVerts[vi++] = p[2];
        }
        return maxCount;
    }
}

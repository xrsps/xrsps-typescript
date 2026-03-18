import { vec3 } from "gl-matrix";
import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import type { GroundItemOverlayEntry } from "../../client/data/ground/GroundItemStore";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { FONT_PLAIN_11 } from "../fonts";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

type CachedTexture = {
    tex: Texture;
    w: number;
    h: number;
};

const SCREEN_VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_texCoord;
uniform vec2 u_resolution;
out vec2 v_uv;
void main(){
    vec2 zeroToOne = a_position / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clip = zeroToTwo - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_uv = a_texCoord;
}`;

const SCREEN_FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_sprite;
uniform vec4 u_tint;
out vec4 fragColor;
void main(){
    vec4 texel = texture(u_sprite, v_uv);
    fragColor = vec4(texel.rgb * u_tint.rgb, texel.a * u_tint.a);
}`;

const H_PADDING = 2;
const V_PADDING = 2;
const TEXTURE_CACHE_MAX = 512;

export class GroundItemOverlay implements Overlay {
    constructor(
        _program: Program,
        private ctx: { getCacheSystem: () => any },
    ) {}

    private app!: PicoApp;
    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;
    private screenSize = new Float32Array(2);
    private tint = new Float32Array([1, 1, 1, 1]);
    private quadVerts = new Float32Array(12);
    private quadUvs = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);
    private centerWorld = vec3.create();
    private entries: GroundItemOverlayEntry[] = [];
    private lastArgs?: OverlayUpdateArgs;
    private font?: BitmapFont;
    private screenProgram?: Program;
    private textCache: Map<string, CachedTexture> = new Map();

    // Use native-size 11px font to keep text crisp (avoid fractional downscaling blur).
    fontId: number = FONT_PLAIN_11;
    scale: number = 1.0;

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(12));
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(this.quadUvs));
        this.uvs.data(this.quadUvs);
        this.array = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);
        this.screenProgram = this.app.createProgram(SCREEN_VERT_SRC, SCREEN_FRAG_SRC);
        this.drawCall = this.app
            .createDrawCall(this.screenProgram, this.array)
            .uniform("u_resolution", this.screenSize)
            .uniform("u_tint", this.tint)
            .primitive(PicoGL.TRIANGLES);
        this.ensureFont();
    }

    update(args: OverlayUpdateArgs): void {
        this.lastArgs = args;
        // Renderer updates overlays multiple times per frame.
        // Only consume groundItems when that field is explicitly present;
        // otherwise preserve entries from the previous update pass.
        if (Object.prototype.hasOwnProperty.call(args.state, "groundItems")) {
            this.entries = Array.isArray(args.state.groundItems) ? args.state.groundItems : [];
        }
    }

    draw(phase: RenderPhase): void {
        if (phase !== RenderPhase.PostPresent) return;
        if (!this.drawCall || !this.positions || !this.uvs) return;
        const args = this.lastArgs;
        if (!args || this.entries.length === 0) return;

        this.screenSize[0] = this.app.width;
        this.screenSize[1] = this.app.height;
        this.app.enable(PicoGL.BLEND);
        this.app.disable(PicoGL.DEPTH_TEST);

        const scale = this.scale || 1.0;

        for (const entry of this.entries) {
            const baseLabel = typeof entry.label === "string" ? entry.label : "";
            const timerLabel = typeof entry.timerLabel === "string" ? entry.timerLabel : "";
            if (baseLabel.length === 0 && timerLabel.length === 0) {
                continue;
            }

            // Use the ground stack's actual plane as the base input for height sampling.
            // Ground piles stay indexed on the raw plane; bridge promotion belongs in the
            // height sampler, not in interaction/effective-plane resolution.
            const h = args.helpers.getTileHeightAtPlane(
                entry.tileX + 0.5,
                entry.tileY + 0.5,
                entry.level,
            );
            const line = Math.max(0, entry.line ?? 0);
            this.centerWorld[0] = entry.tileX + 0.5;
            this.centerWorld[1] = h - 0.05 - line * 0.22;
            this.centerWorld[2] = entry.tileY + 0.5;
            const screenPos = args.helpers.worldToScreen?.(
                this.centerWorld[0],
                this.centerWorld[1],
                this.centerWorld[2],
            );
            if (!screenPos || typeof screenPos[0] !== "number" || typeof screenPos[1] !== "number")
                continue;

            const tex = this.getTextTexture(
                baseLabel,
                timerLabel,
                entry.color ?? 0xffffff,
                Number.isFinite(entry.timerColor) ? (entry.timerColor as number) : 0xffff00,
            );
            if (!tex) continue;

            const centerX = Math.round(screenPos[0]);
            const centerY = Math.round(screenPos[1]);
            const width = Math.max(1, Math.round(tex.w * scale));
            const heightPx = Math.max(1, Math.round(tex.h * scale));
            const left = centerX - Math.round(width / 2);
            const top = centerY - Math.round(heightPx / 2);

            this.quadVerts[0] = left;
            this.quadVerts[1] = top;
            this.quadVerts[2] = left;
            this.quadVerts[3] = top + heightPx;
            this.quadVerts[4] = left + width;
            this.quadVerts[5] = top + heightPx;
            this.quadVerts[6] = left;
            this.quadVerts[7] = top;
            this.quadVerts[8] = left + width;
            this.quadVerts[9] = top + heightPx;
            this.quadVerts[10] = left + width;
            this.quadVerts[11] = top;

            this.positions.data(this.quadVerts);
            this.tint[0] = 1;
            this.tint[1] = 1;
            this.tint[2] = 1;
            this.tint[3] = 1;
            this.drawCall
                .uniform("u_resolution", this.screenSize)
                .uniform("u_tint", this.tint)
                .texture("u_sprite", tex.tex)
                .draw();
        }
    }

    dispose(): void {
        try {
            this.positions?.delete?.();
            this.uvs?.delete?.();
            this.array?.delete?.();
            this.drawCall?.delete?.();
        } catch {}
        for (const cached of this.textCache.values()) {
            try {
                cached.tex.delete?.();
            } catch {}
        }
        this.positions = undefined;
        this.uvs = undefined;
        this.array = undefined;
        this.drawCall = undefined;
        this.font = undefined;
        this.textCache.clear();
        try {
            this.screenProgram?.delete?.();
        } catch {}
        this.screenProgram = undefined;
    }

    private ensureFont(): void {
        try {
            if (this.font) return;
            let font = BitmapFont.tryLoad(this.ctx.getCacheSystem(), this.fontId);
            if (!font && this.fontId !== FONT_PLAIN_11) {
                font = BitmapFont.tryLoad(this.ctx.getCacheSystem(), FONT_PLAIN_11);
            }
            if (font) this.font = font;
        } catch (e) {
            console.error("GroundItemOverlay: failed to load font", e);
        }
    }

    private getTextTexture(
        baseLabel: string,
        timerLabel: string,
        baseColor: number,
        timerColor: number,
    ): CachedTexture | undefined {
        this.ensureFont();
        const font = this.font;
        if (!font) return undefined;

        const key = `${baseColor >>> 0}|${timerColor >>> 0}|${baseLabel}|${timerLabel}`;
        const cached = this.textCache.get(key);
        if (cached) {
            return cached;
        }

        const baseWidth = baseLabel.length > 0 ? font.measure(baseLabel) : 0;
        const timerWidth = timerLabel.length > 0 ? font.measure(timerLabel) : 0;
        const width = Math.max(1, Math.ceil(H_PADDING * 2 + baseWidth + timerWidth));
        const ascent = font.maxAscent || font.ascent || 11;
        const descent = font.maxDescent || 2;
        const height = Math.max(1, Math.ceil(V_PADDING * 2 + ascent + descent));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", {
            willReadFrequently: true as any,
        }) as CanvasRenderingContext2D | null;
        if (!ctx) return undefined;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const baseline = V_PADDING + ascent;
        let penX = H_PADDING;
        if (baseLabel.length > 0) {
            font.draw(ctx, baseLabel, penX, baseline, `#${(baseColor >>> 0).toString(16).padStart(6, "0")}`);
            penX += baseWidth;
        }
        if (timerLabel.length > 0) {
            font.draw(ctx, timerLabel, penX, baseline, `#${(timerColor >>> 0).toString(16).padStart(6, "0")}`);
        }

        const tex = this.app.createTexture2D(canvas as any, {
            flipY: false,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        const next: CachedTexture = { tex, w: canvas.width, h: canvas.height };
        if (this.textCache.size >= TEXTURE_CACHE_MAX) {
            const firstKey = this.textCache.keys().next().value;
            if (firstKey !== undefined) {
                const first = this.textCache.get(firstKey);
                try {
                    first?.tex.delete?.();
                } catch {}
                this.textCache.delete(firstKey);
            }
        }
        this.textCache.set(key, next);
        return next;
    }
}

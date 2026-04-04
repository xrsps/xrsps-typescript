import { vec3 } from "gl-matrix";
import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import type { CacheIndex } from "../../rs/cache/CacheIndex";
import type { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { GraphicsDefaults } from "../../rs/config/defaults/GraphicsDefaults";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import {
    OverheadPrayerEntry,
    Overlay,
    OverlayInitArgs,
    OverlayUpdateArgs,
    RenderPhase,
} from "./Overlay";

export interface OverheadPrayerContext {
    getCacheSystem: () => CacheSystem;
    getLoadedCacheInfo: () => any;
}

interface SpriteTexture {
    tex: Texture;
    w: number;
    h: number;
}

/**
 * Renders overhead prayer icons above players/NPCs in screen space.
 * Uses the same billboard shader approach as HealthBarOverlay.
 */
export class OverheadPrayerOverlay implements Overlay {
    constructor(
        private readonly program: Program,
        private readonly ctx: OverheadPrayerContext,
    ) {}

    private app!: PicoApp;
    private sceneUniforms!: UniformBuffer;

    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;

    private spriteIndex?: CacheIndex;
    private prayerSprites: Map<number, SpriteTexture> = new Map();
    private failedSpriteIndices: Set<number> = new Set();
    private headIconsPrayerArchiveId: number = -1;

    private screenSize: Float32Array = new Float32Array(2);
    private tint: Float32Array = new Float32Array([1, 1, 1, 1]);
    private centerWorld: vec3 = vec3.create();
    private quadVerts: Float32Array = new Float32Array(12);
    private quadUvs: Float32Array = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);

    private lastArgs?: OverlayUpdateArgs;

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.sceneUniforms = args.sceneUniforms;

        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(12));
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, this.quadUvs);
        this.array = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);
        this.drawCall = this.app
            .createDrawCall(this.program, this.array)
            .uniformBlock("SceneUniforms", this.sceneUniforms)
            .uniform("u_screenSize", this.screenSize)
            .uniform("u_tint", this.tint)
            .primitive(PicoGL.TRIANGLES);

        this.destroyTextures();
        this.initAssetsFromCache();
    }

    private destroyTextures(): void {
        for (const sprite of this.prayerSprites.values()) {
            try {
                sprite.tex.delete?.();
            } catch {}
        }
        this.prayerSprites.clear();
        this.failedSpriteIndices.clear();
    }

    dispose(): void {
        this.destroyTextures();
        try {
            this.positions?.delete?.();
            this.uvs?.delete?.();
            this.array?.delete?.();
        } catch {}
        this.positions = undefined;
        this.uvs = undefined;
        this.array = undefined;
        this.drawCall = undefined;
    }

    private initAssetsFromCache(): void {
        try {
            const cacheSystem = this.ctx.getCacheSystem();
            if (!cacheSystem) return; // Cache not loaded yet
            this.spriteIndex = cacheSystem.getIndex(IndexType.DAT2.sprites);

            // Load graphics defaults to get the headicons_prayer archive ID
            const cacheInfo = this.ctx.getLoadedCacheInfo?.();
            if (cacheInfo) {
                const defaults = GraphicsDefaults.load(cacheInfo, cacheSystem);
                this.headIconsPrayerArchiveId = defaults.headIconsPrayer;
            }

            // Fallback: try by name
            if (this.headIconsPrayerArchiveId < 0 && this.spriteIndex) {
                try {
                    this.headIconsPrayerArchiveId =
                        this.spriteIndex.getArchiveId("headicons_prayer");
                } catch {}
            }
        } catch (err) {
            console.warn("[OverheadPrayerOverlay] initAssetsFromCache error", err);
        }
    }

    private getPrayerSprite(index: number): SpriteTexture | undefined {
        if (index < 0) return undefined;
        const cached = this.prayerSprites.get(index);
        if (cached) return cached;

        // Don't retry failed indices
        if (this.failedSpriteIndices.has(index)) return undefined;

        if (!this.spriteIndex || this.headIconsPrayerArchiveId < 0) {
            this.failedSpriteIndices.add(index);
            return undefined;
        }

        try {
            // Load all sprites from the headicons_prayer archive
            const sprites = SpriteLoader.loadIntoIndexedSprites(
                this.spriteIndex,
                this.headIconsPrayerArchiveId,
            );
            if (!sprites || index >= sprites.length) {
                this.failedSpriteIndices.add(index);
                return undefined;
            }

            const indexed = sprites[index];
            if (!indexed) {
                this.failedSpriteIndices.add(index);
                return undefined;
            }

            const sprite = this.createTextureFromIndexedSprite(indexed);
            this.prayerSprites.set(index, sprite);
            return sprite;
        } catch (err) {
            console.warn("[OverheadPrayerOverlay] failed to load prayer sprite", index, err);
            this.failedSpriteIndices.add(index);
            return undefined;
        }
    }

    private createTextureFromIndexedSprite(spr: IndexedSprite): SpriteTexture {
        const width = Math.max(1, spr.subWidth | 0);
        const height = Math.max(1, spr.subHeight | 0);
        const pixels = new Uint8Array(width * height * 4);
        const palette = spr.palette ?? new Int32Array([0xff_ff_ff_ff]);
        const src = spr.pixels ?? new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = src[i] & 0xff;
            const color = palette[idx] ?? 0;
            const r = (color >> 16) & 0xff;
            const g = (color >> 8) & 0xff;
            const b = color & 0xff;
            // Index 0 is transparent in OSRS indexed sprites
            const a = idx === 0 ? 0 : 0xff;
            const di = i * 4;
            pixels[di] = r;
            pixels[di + 1] = g;
            pixels[di + 2] = b;
            pixels[di + 3] = a;
        }
        const tex = this.app.createTexture2D(pixels, width, height, {
            internalFormat: PicoGL.RGBA8,
            type: PicoGL.UNSIGNED_BYTE,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        return { tex, w: width, h: height };
    }

    update(args: OverlayUpdateArgs): void {
        this.lastArgs = args;
    }

    draw(phase: RenderPhase): void {
        if (phase !== RenderPhase.ToFrameTexture) return;
        if (!this.drawCall || !this.positions || !this.uvs) return;

        const args = this.lastArgs;
        if (!args) return;
        const entries = args.state.overheadPrayers as OverheadPrayerEntry[] | undefined;
        if (!entries || entries.length === 0) return;

        this.screenSize[0] = this.app.width;
        this.screenSize[1] = this.app.height;
        this.app.enable(PicoGL.BLEND);
        this.app.disable(PicoGL.DEPTH_TEST);

        const helpers = args.helpers;
        const center = this.centerWorld;

        for (const entry of entries) {
            const iconIndex = entry.headIconPrayer | 0;
            if (iconIndex < 0) continue;

            const sprite = this.getPrayerSprite(iconIndex);
            if (!sprite) continue;

            // Use the actor's actual plane directly for height calculation.
            // getEffectivePlaneForTile would incorrectly promote plane 0 to 1 under bridges.
            const plane = entry.plane | 0;
            const height = helpers.getTileHeightAtPlane(entry.worldX, entry.worldZ, plane);
            const headOffset = entry.heightOffsetTiles ?? 0.9;

            center[0] = entry.worldX;
            center[1] = height - headOffset;
            center[2] = entry.worldZ;

            // OSRS draws the sprite centered at x - 12, y - var9
            // var9 is accumulated (25 per icon above actor head)
            // Reference: class386.java lines 345-356
            // Position relative to head with sprite centered horizontally
            const spriteW = sprite.w;
            const spriteH = sprite.h;

            // Position: centered horizontally, offset above head
            // In OSRS: drawTransBgAt(var2 + Client.viewportTempX - 12, var3 + Client.viewportTempY - var9)
            // var9 = 25 for first icon (prayer), so drawn at y - 25
            // The -12 centers a 24px wide icon, we center dynamically based on actual sprite width
            const x = -Math.floor(spriteW / 2);
            const y = -25; // Match OSRS offset of 25 pixels above the anchor

            this.writeQuad(x, y, spriteW, spriteH);
            this.resetFullUvs();

            this.tint[0] = 1.0;
            this.tint[1] = 1.0;
            this.tint[2] = 1.0;
            this.tint[3] = 1.0;

            this.positions.data(this.quadVerts);
            this.uvs.data(this.quadUvs);
            this.drawCall
                .uniform("u_screenSize", this.screenSize)
                .uniform("u_centerWorld", center)
                .uniform("u_tint", this.tint)
                .texture("u_sprite", sprite.tex)
                .draw();
        }
    }

    private writeQuad(x: number, y: number, w: number, h: number): void {
        const verts = this.quadVerts;
        verts[0] = x;
        verts[1] = y;
        verts[2] = x;
        verts[3] = y + h;
        verts[4] = x + w;
        verts[5] = y + h;
        verts[6] = x;
        verts[7] = y;
        verts[8] = x + w;
        verts[9] = y + h;
        verts[10] = x + w;
        verts[11] = y;
    }

    private resetFullUvs(): void {
        const uvs = this.quadUvs;
        uvs[0] = 0;
        uvs[1] = 0;
        uvs[2] = 0;
        uvs[3] = 1;
        uvs[4] = 1;
        uvs[5] = 1;
        uvs[6] = 0;
        uvs[7] = 0;
        uvs[8] = 1;
        uvs[9] = 1;
        uvs[10] = 1;
        uvs[11] = 0;
    }
}

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
import { ConfigType } from "../../rs/cache/ConfigType";
import { IndexType } from "../../rs/cache/IndexType";
import { HitSplatType } from "../../rs/config/hitsplat/HitSplatType";
import { ArchiveHitSplatTypeLoader } from "../../rs/config/hitsplat/HitSplatTypeLoader";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { FONT_PLAIN_11 } from "../fonts";
import { HitsplatEntry, Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

export interface HitsplatContext {
    // Cache access
    getCacheSystem: () => any;
    getLoadedCacheInfo: () => any;
    getVarValue: (varbitId: number, varpId: number) => number;
}

export class HitsplatOverlay implements Overlay {
    constructor(
        private program: Program,
        private ctx: HitsplatContext,
    ) {}

    private app!: PicoApp;
    private sceneUniforms!: UniformBuffer;

    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;

    private bgParts?: {
        left: { tex: Texture; w: number; h: number };
        mid: { tex: Texture; w: number; h: number };
        right: { tex: Texture; w: number; h: number };
    };
    private spriteTextures: Map<string, { tex: Texture; w: number; h: number }> = new Map();
    private spriteIndex?: CacheIndex;
    private digits?: {
        tex: Texture;
        w: number;
        h: number;
        ascent: number;
        glyphs: Array<{
            u0: number;
            v0: number;
            u1: number;
            v1: number;
            w: number;
            h: number;
            lb: number;
            tb: number;
            adv: number;
        }>;
    };
    private fontBmp?: BitmapFont;
    private textTex?: Texture;
    private textTexW: number = 0;
    private textTexH: number = 0;
    private lastTextKey?: string;
    // Runtime uniforms
    private tint: Float32Array = new Float32Array([1, 1, 1, 1]);
    private screenSize: Float32Array = new Float32Array(2);
    private centerWorld: vec3 = vec3.create();
    private quadVerts: Float32Array = new Float32Array(6 * 2);
    private quadUvs: Float32Array = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);
    private stackDxBase: Int16Array = new Int16Array([0, 0, -15, 15]);
    private stackDyBase: Int16Array = new Int16Array([0, -20, -10, -10]);
    private drawOrder: Uint8Array = new Uint8Array([0, 1, 2, 3]);

    // Controls
    scale: number = 1.0;
    damageSpriteName: string = "hitmark,1";
    blockSpriteName: string = "hitmark,0";
    fontId: number = FONT_PLAIN_11;
    count: number = 1;
    defId: number = -1;
    damage: number = 99;
    type?: HitSplatType;

    private width: number = 96;
    private height: number = 40;
    private defs?: Map<number, HitSplatType>;

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.sceneUniforms = args.sceneUniforms;

        // Quad buffers
        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(6 * 2));
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

        // GPU-only assets (background + digits)
        this.destroyGpuAssets();
        this.initAssetsFromCache();
    }

    private lastArgs?: OverlayUpdateArgs;
    private entries: HitsplatEntry[] = [];

    update(args: OverlayUpdateArgs): void {
        this.lastArgs = args;
        // OverlayManager updates overlays twice per frame. Preserve the scene-pass
        // hitsplat payload when the later post-present update omits it.
        if (Object.prototype.hasOwnProperty.call(args.state, "hitsplats")) {
            this.entries = Array.isArray(args.state.hitsplats) ? args.state.hitsplats : [];
        }
    }

    draw(phase: RenderPhase): void {
        if (phase !== RenderPhase.PostPresent) return;
        if (!this.drawCall || !this.positions) return;

        const args = this.lastArgs;
        if (!args) return;

        const entries = this.entries;
        if (entries.length === 0) return;

        this.screenSize[0] = this.app.width;
        this.screenSize[1] = this.app.height;
        this.app.enable(PicoGL.BLEND);
        this.app.disable(PicoGL.DEPTH_TEST);

        const centerWorld = this.centerWorld;
        const stackDxBase = this.stackDxBase;
        const stackDyBase = this.stackDyBase;
        const order = this.drawOrder;
        const quadVerts = this.quadVerts;

        for (const entry of entries) {
            const worldX = entry.worldX;
            const worldZ = entry.worldZ;
            const basePlane = entry.plane | 0;
            // Use the actor's actual plane directly for height calculation.
            // getEffectivePlaneForTile would incorrectly promote plane 0 to 1 under bridges,
            // causing hitsplats to render at the wrong height for actors under bridges.
            const h = args.helpers.getTileHeightAtPlane(worldX, worldZ, basePlane);
            // Base hitsplat anchor above the actor in world space.
            const headOffsetTiles = entry.heightOffsetTiles ?? 0.5;
            const anchorY = h - headOffsetTiles;
            centerWorld[0] = worldX;
            centerWorld[1] = anchorY;
            centerWorld[2] = worldZ;

            // OSRS Parity: Get definition for this hitsplat style to calculate animation
            const entryType =
                typeof entry.style === "number" ? this.resolveDefinition(entry.style) : undefined;
            const useType = entryType ?? this.type;

            // OSRS Parity: Secondary hitsplat type (e.g., poison icon with damage)
            // Reference: class386.java lines 425-431, 525-569, 649-676
            const type2 = (entry.type2 ?? -1) | 0;
            const damage2 = (entry.damage2 ?? 0) | 0;
            const type2Def = type2 >= 0 ? this.resolveDefinition(type2) : undefined;

            const damageVal = (entry.damage ?? this.damage) | 0;
            let numberText = damageVal.toString();
            try {
                const pat = useType?.textPattern || "";
                if (pat && pat.indexOf("%1") !== -1) {
                    numberText = pat.replace(/%1/g, damageVal.toString());
                }
            } catch {}

            // OSRS Parity: Build secondary text if type2 is valid
            let numberText2: string | undefined;
            if (type2Def) {
                numberText2 = damage2.toString();
                try {
                    const pat2 = type2Def.textPattern || "";
                    if (pat2 && pat2.indexOf("%1") !== -1) {
                        numberText2 = pat2.replace(/%1/g, damage2.toString());
                    }
                } catch {}
            }

            const resolvedScale = entry.scale ?? this.scale ?? 1.0;
            if (!Number.isFinite(resolvedScale) || resolvedScale <= 0) continue;

            const count = Math.max(1, Math.min(4, (entry.count ?? this.count ?? 1) | 0));
            // OSRS Parity: Base screen Y offset is -12 pixels (class386.java line 682)
            const baseTop = -12 * resolvedScale;
            const variantRaw = entry.variant ?? 0;
            const variant = ((variantRaw % order.length) + order.length) % order.length;

            const col = (entry.color ?? useType?.textColor ?? 0xffffff) >>> 0;
            // OSRS Parity: textOffsetY (field2086) is an additional Y offset for text
            // Reference: class386.java line 685: var69 = var66 + var95.field2086 + 15
            const textOffsetY = (useType?.textOffsetY ?? 0) | 0;

            // OSRS Parity: Calculate animation offsets and alpha from animProgress
            // Reference: class386.drawActor2d lines 678-714
            // Fade alpha calculated when fadeStartCycle >= 0
            const animProgress = entry.animProgress ?? 0;
            const defXOffset = (useType?.xOffset ?? 0) | 0;
            const defYOffset = (useType?.yOffset ?? 0) | 0;
            const fadeStartCycle = (useType?.fadeStartCycle ?? -1) | 0;
            const displayCycles = (useType?.displayCycles ?? 70) | 0;

            // OSRS (class386.java lines 679-680):
            // var63 = field2081 - remainingCycles * field2081 / field2069
            //       = xOffset * animProgress (starts at 0, ends at xOffset)
            // var64 = remainingCycles * field2089 / field2069 - field2089
            //       = yOffset * (1 - animProgress) - yOffset = -yOffset * animProgress
            //       BUT this means: starts at -yOffset (when progress=0), ends at 0 (when progress=1)
            // So hitsplat starts BELOW center and rises UP to center position
            const animXOffset = (defXOffset * animProgress) | 0;
            const animYOffset = (-defYOffset * (1 - animProgress)) | 0;

            // OSRS Parity: Calculate fade alpha
            // Reference: class386.java lines 712-715
            // var73 = (remainingCycles << 8) / (displayCycles - fadeStartCycle)
            // remainingCycles = displayCycles * (1 - animProgress)
            let animAlpha = 1.0;
            if (fadeStartCycle >= 0 && displayCycles > fadeStartCycle) {
                const remainingCycles = displayCycles * (1 - animProgress);
                const fadeRange = displayCycles - fadeStartCycle;
                // Alpha goes from 256+ (clamped to 255) to 0 as remainingCycles decreases
                const alpha256 = (remainingCycles * 256) / fadeRange;
                animAlpha = Math.max(0, Math.min(1, alpha256 / 255));
            }
            const textInfo = this.digits ? this.buildTextTexture(numberText, col) : undefined;
            centerWorld[1] = anchorY;

            for (let i = 0; i < count; i++) {
                const pIdx = order[(variant + i) % order.length];
                // OSRS parity: slot offsets and animated x/y offsets are applied in screen
                // space before the hitsplat box is laid out from its top edge.
                const cx = ((stackDxBase[pIdx] * resolvedScale) | 0) + animXOffset;
                const topY = ((stackDyBase[pIdx] * resolvedScale) | 0) + baseTop + animYOffset;

                if (this.bgParts) {
                    const lw = (this.bgParts.left.w * resolvedScale) | 0;
                    const lh = (this.bgParts.left.h * resolvedScale) | 0;
                    const rw = (this.bgParts.right.w * resolvedScale) | 0;
                    // OSRS Parity: Calculate actual total width from sprites, not hardcoded
                    // Reference: class386.java calculates var51 = left + middle*n + right
                    const middleWidth =
                        ((this.width - this.bgParts.left.w - this.bgParts.right.w) *
                            resolvedScale) |
                        0;
                    const totalWidth = lw + middleWidth + rw;
                    const lx = cx - (totalWidth >> 1);
                    const ly = topY;
                    quadVerts[0] = lx;
                    quadVerts[1] = ly;
                    quadVerts[2] = lx;
                    quadVerts[3] = ly + lh;
                    quadVerts[4] = lx + lw;
                    quadVerts[5] = ly + lh;
                    quadVerts[6] = lx;
                    quadVerts[7] = ly;
                    quadVerts[8] = lx + lw;
                    quadVerts[9] = ly + lh;
                    quadVerts[10] = lx + lw;
                    quadVerts[11] = ly;
                    // OSRS Parity: Apply fade alpha
                    this.tint[0] = 1.0;
                    this.tint[1] = 1.0;
                    this.tint[2] = 1.0;
                    this.tint[3] = animAlpha;
                    this.positions!.data(quadVerts);
                    this.drawCall!.uniform("u_screenSize", this.screenSize)
                        .uniform("u_centerWorld", centerWorld)
                        .texture("u_sprite", this.bgParts.left.tex)
                        .draw();

                    const mw =
                        ((this.width - this.bgParts.left.w - this.bgParts.right.w) *
                            resolvedScale) |
                        0;
                    const mh = (this.bgParts.mid.h * resolvedScale) | 0;
                    const mx0 = lx + lw;
                    for (let px = 0; px < mw; px += this.bgParts.mid.w * resolvedScale) {
                        const x = mx0 + px;
                        const w = Math.min(this.bgParts.mid.w * resolvedScale, mw - px) | 0;
                        quadVerts[0] = x;
                        quadVerts[1] = ly;
                        quadVerts[2] = x;
                        quadVerts[3] = ly + mh;
                        quadVerts[4] = x + w;
                        quadVerts[5] = ly + mh;
                        quadVerts[6] = x;
                        quadVerts[7] = ly;
                        quadVerts[8] = x + w;
                        quadVerts[9] = ly + mh;
                        quadVerts[10] = x + w;
                        quadVerts[11] = ly;
                        // OSRS Parity: Apply fade alpha
                        this.tint[0] = this.tint[1] = this.tint[2] = 1.0;
                        this.tint[3] = animAlpha;
                        this.positions!.data(quadVerts);
                        this.drawCall!.uniform("u_screenSize", this.screenSize)
                            .uniform("u_centerWorld", centerWorld)
                            .texture("u_sprite", this.bgParts.mid.tex)
                            .draw();
                    }

                    const rh = (this.bgParts.right.h * resolvedScale) | 0;
                    const rx = lx + lw + mw;
                    quadVerts[0] = rx;
                    quadVerts[1] = ly;
                    quadVerts[2] = rx;
                    quadVerts[3] = ly + rh;
                    quadVerts[4] = rx + rw;
                    quadVerts[5] = ly + rh;
                    quadVerts[6] = rx;
                    quadVerts[7] = ly;
                    quadVerts[8] = rx + rw;
                    quadVerts[9] = ly + rh;
                    quadVerts[10] = rx + rw;
                    quadVerts[11] = ly;
                    // OSRS Parity: Apply fade alpha
                    this.tint[0] = this.tint[1] = this.tint[2] = 1.0;
                    this.tint[3] = animAlpha;
                    this.positions!.data(quadVerts);
                    this.drawCall!.uniform("u_screenSize", this.screenSize)
                        .uniform("u_centerWorld", centerWorld)
                        .texture("u_sprite", this.bgParts.right.tex)
                        .draw();
                } else {
                    const sprite = this.getSpriteTextureForEntry(entry);
                    if (!sprite) continue;
                    const w = (sprite.w * resolvedScale) | 0;
                    const hq = (sprite.h * resolvedScale) | 0;
                    const x = cx - (w >> 1);
                    const y = topY;
                    quadVerts[0] = x;
                    quadVerts[1] = y;
                    quadVerts[2] = x;
                    quadVerts[3] = y + hq;
                    quadVerts[4] = x + w;
                    quadVerts[5] = y + hq;
                    quadVerts[6] = x;
                    quadVerts[7] = y;
                    quadVerts[8] = x + w;
                    quadVerts[9] = y + hq;
                    quadVerts[10] = x + w;
                    quadVerts[11] = y;
                    // OSRS Parity: Apply fade alpha
                    this.tint[0] = 1.0;
                    this.tint[1] = 1.0;
                    this.tint[2] = 1.0;
                    this.tint[3] = animAlpha;
                    this.positions!.data(quadVerts);
                    this.drawCall!.uniform("u_screenSize", this.screenSize)
                        .uniform("u_centerWorld", centerWorld)
                        .texture("u_sprite", sprite.tex)
                        .draw();
                }

                if (this.digits && textInfo) {
                    const tw = textInfo.w * resolvedScale;
                    const th = textInfo.h * resolvedScale;
                    const gx = cx - (tw >> 1);
                    // OSRS parity: text draw Y is a baseline at (top + textOffsetY + 15).
                    // The cached texture is built with its baseline at `ascent`.
                    const gy = topY + (15 + textOffsetY - textInfo.ascent) * resolvedScale;
                    quadVerts[0] = gx;
                    quadVerts[1] = gy;
                    quadVerts[2] = gx;
                    quadVerts[3] = gy + th;
                    quadVerts[4] = gx + tw;
                    quadVerts[5] = gy + th;
                    quadVerts[6] = gx;
                    quadVerts[7] = gy;
                    quadVerts[8] = gx + tw;
                    quadVerts[9] = gy + th;
                    quadVerts[10] = gx + tw;
                    quadVerts[11] = gy;
                    this.positions!.data(quadVerts);
                    // OSRS Parity: Apply fade alpha to text as well
                    this.tint[0] = this.tint[1] = this.tint[2] = 1.0;
                    this.tint[3] = animAlpha;
                    this.drawCall!.uniform("u_screenSize", this.screenSize)
                        .uniform("u_centerWorld", centerWorld)
                        .texture("u_sprite", textInfo.tex)
                        .draw();
                }

                // OSRS Parity: Secondary hitsplat rendering (type2)
                // Reference: class386.java lines 649-676, 737-757, 778-798
                // Secondary hitsplat renders to the right of primary with 2px gap
                if (type2Def && numberText2 !== undefined) {
                    // Calculate position: right of primary hitsplat with 2px gap
                    const primaryWidth = this.bgParts
                        ? ((this.bgParts.left.w +
                              (this.width - this.bgParts.left.w - this.bgParts.right.w) +
                              this.bgParts.right.w) *
                              resolvedScale) |
                          0
                        : this.width * resolvedScale;
                    const secondaryXOffset = ((primaryWidth >> 1) + 2) | 0;
                    const scx = cx + secondaryXOffset;

                    // Get secondary hitsplat background sprites
                    const sec2LeftSprite =
                        type2Def.leftSpriteId >= 0
                            ? this.textureFromSpriteId(type2Def.leftSpriteId)
                            : undefined;
                    const sec2MidSprite =
                        type2Def.middleSpriteId >= 0
                            ? this.textureFromSpriteId(type2Def.middleSpriteId)
                            : undefined;
                    const sec2RightSprite =
                        type2Def.rightSpriteId >= 0
                            ? this.textureFromSpriteId(type2Def.rightSpriteId)
                            : undefined;

                    if (sec2LeftSprite && sec2MidSprite && sec2RightSprite) {
                        // Render secondary background (left + mid + right)
                        const slw = (sec2LeftSprite.w * resolvedScale) | 0;
                        const slh = (sec2LeftSprite.h * resolvedScale) | 0;
                        const srw = (sec2RightSprite.w * resolvedScale) | 0;
                        // Calculate secondary width based on text width or minimum
                        const sec2TextInfo = this.digits
                            ? this.buildTextTexture(numberText2, type2Def.textColor ?? 0xffffff)
                            : undefined;
                        const sec2TextWidth = sec2TextInfo
                            ? (sec2TextInfo.w * resolvedScale) | 0
                            : 20;
                        const sec2MiddleWidth =
                            (Math.max(sec2MidSprite.w, sec2TextWidth - slw - srw + 8) *
                                resolvedScale) |
                            0;
                        const sec2TotalWidth = slw + sec2MiddleWidth + srw;
                        const slx = scx;
                        const sly = topY;

                        // Draw left part
                        quadVerts[0] = slx;
                        quadVerts[1] = sly;
                        quadVerts[2] = slx;
                        quadVerts[3] = sly + slh;
                        quadVerts[4] = slx + slw;
                        quadVerts[5] = sly + slh;
                        quadVerts[6] = slx;
                        quadVerts[7] = sly;
                        quadVerts[8] = slx + slw;
                        quadVerts[9] = sly + slh;
                        quadVerts[10] = slx + slw;
                        quadVerts[11] = sly;
                        this.tint[0] = this.tint[1] = this.tint[2] = 1.0;
                        this.tint[3] = animAlpha;
                        this.positions!.data(quadVerts);
                        this.drawCall!.uniform("u_screenSize", this.screenSize)
                            .uniform("u_centerWorld", centerWorld)
                            .texture("u_sprite", sec2LeftSprite.tex)
                            .draw();

                        // Draw middle parts
                        const smh = (sec2MidSprite.h * resolvedScale) | 0;
                        const smx0 = slx + slw;
                        for (
                            let px = 0;
                            px < sec2MiddleWidth;
                            px += sec2MidSprite.w * resolvedScale
                        ) {
                            const sx = smx0 + px;
                            const sw =
                                Math.min(sec2MidSprite.w * resolvedScale, sec2MiddleWidth - px) | 0;
                            quadVerts[0] = sx;
                            quadVerts[1] = sly;
                            quadVerts[2] = sx;
                            quadVerts[3] = sly + smh;
                            quadVerts[4] = sx + sw;
                            quadVerts[5] = sly + smh;
                            quadVerts[6] = sx;
                            quadVerts[7] = sly;
                            quadVerts[8] = sx + sw;
                            quadVerts[9] = sly + smh;
                            quadVerts[10] = sx + sw;
                            quadVerts[11] = sly;
                            this.tint[0] = this.tint[1] = this.tint[2] = 1.0;
                            this.tint[3] = animAlpha;
                            this.positions!.data(quadVerts);
                            this.drawCall!.uniform("u_screenSize", this.screenSize)
                                .uniform("u_centerWorld", centerWorld)
                                .texture("u_sprite", sec2MidSprite.tex)
                                .draw();
                        }

                        // Draw right part
                        const srh = (sec2RightSprite.h * resolvedScale) | 0;
                        const srx = slx + slw + sec2MiddleWidth;
                        quadVerts[0] = srx;
                        quadVerts[1] = sly;
                        quadVerts[2] = srx;
                        quadVerts[3] = sly + srh;
                        quadVerts[4] = srx + srw;
                        quadVerts[5] = sly + srh;
                        quadVerts[6] = srx;
                        quadVerts[7] = sly;
                        quadVerts[8] = srx + srw;
                        quadVerts[9] = sly + srh;
                        quadVerts[10] = srx + srw;
                        quadVerts[11] = sly;
                        this.tint[0] = this.tint[1] = this.tint[2] = 1.0;
                        this.tint[3] = animAlpha;
                        this.positions!.data(quadVerts);
                        this.drawCall!.uniform("u_screenSize", this.screenSize)
                            .uniform("u_centerWorld", centerWorld)
                            .texture("u_sprite", sec2RightSprite.tex)
                            .draw();

                        // Draw secondary text
                        if (sec2TextInfo) {
                            const stw = sec2TextInfo.w * resolvedScale;
                            const sth = sec2TextInfo.h * resolvedScale;
                            const sec2TextOffsetY = (type2Def.textOffsetY ?? 0) | 0;
                            const stx = slx + (sec2TotalWidth >> 1) - (stw >> 1);
                            const sty =
                                topY +
                                (15 + sec2TextOffsetY - sec2TextInfo.ascent) * resolvedScale;
                            quadVerts[0] = stx;
                            quadVerts[1] = sty;
                            quadVerts[2] = stx;
                            quadVerts[3] = sty + sth;
                            quadVerts[4] = stx + stw;
                            quadVerts[5] = sty + sth;
                            quadVerts[6] = stx;
                            quadVerts[7] = sty;
                            quadVerts[8] = stx + stw;
                            quadVerts[9] = sty + sth;
                            quadVerts[10] = stx + stw;
                            quadVerts[11] = sty;
                            this.positions!.data(quadVerts);
                            this.tint[0] = this.tint[1] = this.tint[2] = 1.0;
                            this.tint[3] = animAlpha;
                            this.drawCall!.uniform("u_screenSize", this.screenSize)
                                .uniform("u_centerWorld", centerWorld)
                                .texture("u_sprite", sec2TextInfo.tex)
                                .draw();
                        }
                    }
                }
            }
        }
    }

    private getSpriteTextureForEntry(
        entry: HitsplatEntry,
    ): { tex: Texture; w: number; h: number } | undefined {
        const spriteKey = this.getSpriteKeyForEntry(entry);
        if (!spriteKey) return undefined;
        return this.ensureSpriteTexture(spriteKey);
    }

    private getSpriteKeyForEntry(entry: HitsplatEntry): string | undefined {
        const damageVal = entry.damage ?? this.damage;
        if (damageVal == null) return undefined;
        return damageVal > 0 ? this.damageSpriteName : this.blockSpriteName;
    }

    private ensureSpriteTexture(token: string): { tex: Texture; w: number; h: number } | undefined {
        const key = token.trim().toLowerCase();
        if (!key) return undefined;
        const cached = this.spriteTextures.get(key);
        if (cached) return cached;
        const spriteIndex = this.getSpriteIndex();
        if (!spriteIndex) return undefined;
        try {
            const archiveId = spriteIndex.getArchiveId(token);
            if (archiveId < 0) return undefined;
            const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, archiveId);
            if (!sprite) return undefined;
            const tex = this.createTextureFromIndexedSprite(sprite);
            const resource = { tex, w: sprite.subWidth | 0, h: sprite.subHeight | 0 };
            this.spriteTextures.set(key, resource);
            return resource;
        } catch {
            return undefined;
        }
    }

    private getSpriteIndex(): CacheIndex | undefined {
        if (this.spriteIndex) return this.spriteIndex;
        try {
            const cacheSystem = this.ctx.getCacheSystem();
            const idx = cacheSystem.getIndex(IndexType.DAT2.sprites);
            this.spriteIndex = idx;
            return idx;
        } catch {
            return undefined;
        }
    }

    /**
     * Load a sprite texture by its sprite ID (used for secondary hitsplat backgrounds)
     */
    private textureFromSpriteId(
        spriteId: number,
    ): { tex: Texture; w: number; h: number } | undefined {
        if (spriteId < 0) return undefined;
        const key = `id:${spriteId}`;
        const cached = this.spriteTextures.get(key);
        if (cached) return cached;
        const spriteIndex = this.getSpriteIndex();
        if (!spriteIndex) return undefined;
        try {
            const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, spriteId);
            if (!sprite) return undefined;
            const tex = this.createTextureFromIndexedSprite(sprite);
            const resource = { tex, w: sprite.subWidth | 0, h: sprite.subHeight | 0 };
            this.spriteTextures.set(key, resource);
            return resource;
        } catch {
            return undefined;
        }
    }

    dispose(): void {
        this.destroyGpuAssets();
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
        const cacheSystem = this.ctx.getCacheSystem();
        const spriteIndex = cacheSystem.getIndex(IndexType.DAT2.sprites);
        this.spriteIndex = spriteIndex;
        // Try definition-based background first
        let usedDef: HitSplatType | undefined;
        try {
            const configIndex = cacheSystem.getIndex(IndexType.DAT2.configs);
            if (configIndex.archiveExists(ConfigType.OSRS.hitSplat)) {
                const hitsplatArchive = configIndex.getArchive(ConfigType.OSRS.hitSplat);
                const loader = new ArchiveHitSplatTypeLoader(
                    this.ctx.getLoadedCacheInfo(),
                    hitsplatArchive,
                );
                if (!this.defs) {
                    const ids = Array.from(hitsplatArchive.fileIds) as number[];
                    ids.sort((a, b) => a - b);
                    const map = new Map<number, HitSplatType>();
                    for (const id of ids) {
                        try {
                            const t = loader.load(id);
                            if (t) map.set(id, t);
                        } catch {}
                    }
                    this.defs = map;
                    try {
                        if (
                            this.defId < 0 &&
                            this.ctx.getLoadedCacheInfo()?.game === "oldschool" &&
                            map.has(26)
                        ) {
                            this.defId = 26;
                        }
                    } catch {}
                }
                if (this.defId >= 0) {
                    const id = this.defId | 0;
                    let t = this.defs?.get(id);
                    if (t?.multihitsplats && t.multihitsplats.length >= 2) {
                        const idx =
                            t.varbitId !== -1
                                ? this.ctx.getVarValue(t.varbitId, -1)
                                : t.varpId !== -1
                                ? this.ctx.getVarValue(-1, t.varpId)
                                : -1;
                        const arr = t.multihitsplats;
                        let nextId = -1;
                        if (idx >= 0 && idx < arr.length - 1) nextId = arr[idx] | 0;
                        else nextId = arr[arr.length - 1] | 0;
                        if (nextId >= 0) {
                            try {
                                t = this.defs?.get(nextId) ?? loader.load(nextId);
                            } catch {}
                        }
                    }
                    usedDef = t;
                    if (usedDef) this.type = usedDef;
                }
            }
        } catch {}

        if (usedDef) {
            this.type = usedDef;
            if (
                usedDef.leftSpriteId >= 0 &&
                usedDef.middleSpriteId >= 0 &&
                usedDef.rightSpriteId >= 0
            ) {
                try {
                    const left = SpriteLoader.loadIntoIndexedSprite(
                        spriteIndex,
                        usedDef.leftSpriteId,
                    )!;
                    const mid = SpriteLoader.loadIntoIndexedSprite(
                        spriteIndex,
                        usedDef.middleSpriteId,
                    )!;
                    const right = SpriteLoader.loadIntoIndexedSprite(
                        spriteIndex,
                        usedDef.rightSpriteId,
                    )!;
                    this.bgParts = {
                        left: {
                            tex: this.createTextureFromIndexedSprite(left),
                            w: left.subWidth | 0,
                            h: left.subHeight | 0,
                        },
                        mid: {
                            tex: this.createTextureFromIndexedSprite(mid),
                            w: mid.subWidth | 0,
                            h: mid.subHeight | 0,
                        },
                        right: {
                            tex: this.createTextureFromIndexedSprite(right),
                            w: right.subWidth | 0,
                            h: right.subHeight | 0,
                        },
                    };
                    this.width = (left.subWidth | 0) + (mid.subWidth | 0) + (right.subWidth | 0);
                    this.height = Math.max(
                        left.subHeight | 0,
                        mid.subHeight | 0,
                        right.subHeight | 0,
                    );
                } catch {}
            }
        }

        if (!this.bgParts) {
            const fallbackSprite =
                this.ensureSpriteTexture(this.damageSpriteName) ??
                this.ensureSpriteTexture(this.blockSpriteName);
            if (fallbackSprite) {
                this.width = fallbackSprite.w | 0;
                this.height = fallbackSprite.h | 0;
            }
            this.type = usedDef;
        }

        // Digits atlas
        try {
            const fid = (this.type?.fontId ?? -1) >= 0 ? this.type!.fontId | 0 : this.fontId ?? -1;
            const bmp = BitmapFont.tryLoad(this.ctx.getCacheSystem(), fid);
            this.fontBmp = bmp ?? undefined;
            this.digits = bmp ? this.createDigitsAtlas(bmp) : undefined;
            if (!this.digits) {
                console.warn("[HitsplatOverlay] digits atlas not built (fontId)", fid);
            }
        } catch {}
    }

    private createTextureFromIndexedSprite(spr: IndexedSprite): Texture {
        const w = spr.subWidth | 0 || 1;
        const h = spr.subHeight | 0 || 1;
        const out = new Uint8Array(w * h * 4);
        const pal = spr.palette;
        const spx = spr.pixels;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = spx[x + y * w] & 0xff;
                if (idx === 0) continue;
                const rgb = pal[idx] | 0;
                const di = (x + y * w) * 4;
                out[di] = (rgb >> 16) & 0xff;
                out[di + 1] = (rgb >> 8) & 0xff;
                out[di + 2] = rgb & 0xff;
                out[di + 3] = 255;
            }
        }
        return this.app.createTexture2D(out, w, h, {
            internalFormat: PicoGL.RGBA8,
            type: PicoGL.UNSIGNED_BYTE,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
    }

    private createDigitsAtlas(bmp: BitmapFont) {
        const digits = "0123456789";
        let totalW = 2;
        let maxH = 1;
        const meta: Array<{ w: number; h: number; lb: number; tb: number; adv: number }> = [];
        for (let i = 0; i < digits.length; i++) {
            const ch = digits.charCodeAt(i) & 0xff;
            const w = bmp.widths[ch] | 0 || 1;
            const h = bmp.heights[ch] | 0 || 1;
            const lb = bmp.leftBearings[ch] | 0;
            const tb = bmp.topBearings[ch] | 0;
            const adv = bmp.advances[ch] | 0 || w;
            meta.push({ w, h, lb, tb, adv });
            totalW += w + 1;
            maxH = Math.max(maxH, h);
        }
        const W = totalW | 0;
        const H = Math.max(1, maxH | 0);
        const out = new Uint8Array(W * H * 4);
        const glyphs: Array<{
            u0: number;
            v0: number;
            u1: number;
            v1: number;
            w: number;
            h: number;
            lb: number;
            tb: number;
            adv: number;
        }> = [];
        let penX = 1;
        for (let i = 0; i < digits.length; i++) {
            const ch = digits.charCodeAt(i) & 0xff;
            const w = bmp.widths[ch] | 0 || 1;
            const h = bmp.heights[ch] | 0 || 1;
            const lb = bmp.leftBearings[ch] | 0;
            const tb = bmp.topBearings[ch] | 0;
            const adv = bmp.advances[ch] | 0 || w;
            const img = bmp.glyphPixels[ch] as Uint8Array | undefined;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (img ? img[y * w + x] : 0) & 0xff;
                    if (idx === 0) continue;
                    const di = (penX + x + y * W) * 4;
                    out[di] = 255;
                    out[di + 1] = 255;
                    out[di + 2] = 255;
                    out[di + 3] = 255;
                }
            }
            const u0 = penX / W;
            const v0 = 0;
            const u1 = (penX + w) / W;
            const v1 = h / H;
            glyphs.push({ u0, v0, u1, v1, w, h, lb, tb, adv });
            penX += w + 1;
        }
        const tex = this.app.createTexture2D(out, W, H, {
            internalFormat: PicoGL.RGBA8,
            type: PicoGL.UNSIGNED_BYTE,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        return { tex, w: W, h: H, ascent: bmp.ascent | 0 || H, glyphs };
    }

    private destroyGpuAssets(): void {
        try {
            for (const spr of this.spriteTextures.values()) {
                spr.tex.delete?.();
            }
        } catch {}
        try {
            this.bgParts?.left.tex.delete?.();
            this.bgParts?.mid.tex.delete?.();
            this.bgParts?.right.tex.delete?.();
        } catch {}
        try {
            this.digits?.tex.delete?.();
        } catch {}
        this.spriteTextures.clear();
        this.bgParts = undefined;
        this.digits = undefined;
        try {
            this.textTex?.delete?.();
        } catch {}
        this.textTex = undefined;
        this.textTexW = this.textTexH = 0;
        this.lastTextKey = undefined;
        this.spriteIndex = undefined;
        // Clear cached state so initAssetsFromCache reloads everything
        this.defs = undefined;
        this.type = undefined;
        this.fontBmp = undefined;
    }

    private buildTextTexture(
        text: string,
        color: number,
    ): { tex: Texture; w: number; h: number; ascent: number } | undefined {
        const bmp = this.fontBmp;
        if (!bmp || !this.app) return undefined;
        const activeFontId =
            (this.type?.fontId ?? -1) >= 0 ? this.type!.fontId | 0 : this.fontId | 0;
        const key = `${activeFontId}|${bmp.ascent}|${color >>> 0}|${text}`;
        if (this.lastTextKey === key && this.textTex) {
            return {
                tex: this.textTex,
                w: this.textTexW,
                h: this.textTexH,
                ascent: bmp.maxAscent | 0,
            };
        }
        try {
            const w = Math.max(1, bmp.measure(text) | 0);
            const h = Math.max(1, (bmp.maxAscent + bmp.maxDescent) | 0 || bmp.ascent | 0 || 12);
            const can = document.createElement("canvas");
            can.width = w;
            can.height = h;
            const ctx2 = can.getContext("2d", {
                willReadFrequently: true as any,
            }) as CanvasRenderingContext2D | null;
            if (!ctx2) return undefined;
            // draw baseline at maxAscent so full glyphs fit
            const baseline = bmp.maxAscent | 0;
            const cssColor = `#${(color >>> 0).toString(16).padStart(6, "0")}`;
            bmp.draw(ctx2, text, 0, baseline, cssColor);
            // upload
            try {
                this.textTex?.delete?.();
            } catch {}
            this.textTex = this.app.createTexture2D(can as any, {
                flipY: false,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
                wrapS: PicoGL.CLAMP_TO_EDGE,
                wrapT: PicoGL.CLAMP_TO_EDGE,
            });
            this.textTexW = w;
            this.textTexH = h;
            this.lastTextKey = key;
            return { tex: this.textTex, w, h, ascent: bmp.maxAscent | 0 };
        } catch {
            return undefined;
        }
    }

    private resolveDefinition(id?: number): HitSplatType | undefined {
        const defs = this.defs;
        if (!defs || defs.size === 0) return undefined;
        if (typeof id !== "number" || id < 0) return undefined;
        let t = defs.get(id);
        if (!t) return undefined;
        if (t.multihitsplats && t.multihitsplats.length >= 2) {
            const idx =
                t.varbitId !== -1
                    ? this.ctx.getVarValue(t.varbitId, -1)
                    : t.varpId !== -1
                    ? this.ctx.getVarValue(-1, t.varpId)
                    : -1;
            const arr = t.multihitsplats;
            let nextId = -1;
            if (idx >= 0 && idx < arr.length - 1) nextId = arr[idx] | 0;
            else nextId = arr[arr.length - 1] | 0;
            if (nextId >= 0) {
                t = defs.get(nextId) ?? t;
            }
        }
        return t;
    }

    getDefinition(id?: number): HitSplatType | undefined {
        return this.resolveDefinition(id);
    }
}

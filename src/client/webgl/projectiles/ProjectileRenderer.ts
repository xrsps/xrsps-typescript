import { vec2 } from "gl-matrix";
import PicoGL, { DrawCall, Texture } from "picogl";

import type { WebGLMapSquare } from "../WebGLMapSquare";
import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";
import type { GfxCache } from "../gfx/GfxCache";
import type { SpotAnimGpuCache } from "../gfx/SpotAnimGpuCache";
import type { Projectile } from "./Projectile";
import type { ProjectileManager } from "./ProjectileManager";

type Pass = "opaque" | "alpha";

/**
 * Renders projectiles using SpotAnimation models.
 * Uses the actor data texture system (like NPCs) for positioning.
 */
export class ProjectileRenderer {
    private gfxCache: GfxCache;
    private gpuCache?: SpotAnimGpuCache;
    // Tracks last frame per projectile for sound dispatch throttle
    private lastSoundFrame: WeakMap<Projectile, number> = new WeakMap();

    constructor(
        private renderer: WebGLOsrsRenderer,
        private projectileManager: ProjectileManager,
    ) {
        // Get GfxCache from the existing GfxRenderer
        const gfxRenderer = (this.renderer as any).gfxRenderer;
        this.gfxCache = gfxRenderer?.getCache();
        this.gpuCache = gfxRenderer?.getGpuCache?.();
        if (!this.gfxCache) {
            return;
        }
    }

    private resolveFrameIndex(spotId: number, projectile: Projectile): number {
        if (!this.gfxCache) return 0;
        const frameCount = Math.max(1, this.gfxCache.getFrameCount(spotId) | 0);
        const raw = projectile.animationFrame | 0;
        const wrapped = ((raw % frameCount) + frameCount) % frameCount;
        return wrapped;
    }

    private getOrCreateSpotAnimGpu(
        spotId: number,
        frameIdx: number,
        transparent: boolean,
        program: any,
    ): { vao: any; vb: any; ib: any; drawCall: DrawCall; indexCount: number } | undefined {
        if (!program) return undefined;
        const programKey = transparent ? "projectile-alpha" : "projectile-opaque";
        return this.gpuCache?.getOrCreate(spotId, frameIdx, transparent, programKey, program);
    }

    /**
     * Render projectiles for a given map using actor data texture
     */
    renderMapPass(
        map: WebGLMapSquare,
        baseOffset: number,
        actorDataTexture: Texture | undefined,
        pass: Pass,
    ): void {
        if (!this.gfxCache || !actorDataTexture) return;
        if (!map.projectileDataTextureOffsets || baseOffset === -1) return;

        const transparent = pass === "alpha";

        // Get projectiles in this map region
        const projectiles = this.projectileManager.getProjectilesForMap(map.mapX, map.mapY);
        if (projectiles.length === 0) return;

        const sampleHeight = (this.renderer as any)?.getApproxTileHeight?.bind?.(this.renderer);

        // Group projectiles by (spotId, frameIdx) to reuse geometry
        const groups = new Map<string, { slots: number[]; indices: number[] }>();

        for (let i = 0; i < projectiles.length; i++) {
            const proj = projectiles[i];
            const spotId = proj.projectileId | 0;
            const frameIdx = this.resolveFrameIndex(spotId, proj);

            // Fire per-frame sounds once when the projectile frame advances
            try {
                const last = this.lastSoundFrame.get(proj);
                if (last !== frameIdx) {
                    const mv: any = this.renderer.osrsClient as any;
                    const spot = mv.spotAnimTypeLoader?.load?.(spotId | 0);
                    const seqId: number =
                        typeof spot?.sequenceId === "number" ? spot.sequenceId | 0 : -1;
                    if (seqId >= 0) {
                        const seqType = mv.seqTypeLoader?.load?.(seqId | 0);
                        if (seqType && seqType.frameSounds?.size) {
                            const p = proj.getPosition();
                            const isLocal =
                                (this.projectileManager as any)?.isLocalCaster?.(proj) ?? false;
                            mv.handleSeqFrameSounds(seqType, frameIdx | 0, {
                                position: { x: p.x | 0, y: p.y | 0, z: (proj.plane | 0) * 128 },
                                isLocalPlayer: !!isLocal,
                                debugSeqId: seqId | 0,
                                debugFrame: frameIdx | 0,
                            });
                        }
                    }
                    this.lastSoundFrame.set(proj, frameIdx | 0);
                }
            } catch {}
            const key = `${spotId}|${frameIdx}`;
            const entry = groups.get(key) ?? { slots: [], indices: [] };
            entry.slots.push(i);
            entry.indices.push(i);
            if (!groups.has(key)) groups.set(key, entry);
        }

        const mapWorldX = map.mapX << 13;
        const mapWorldY = map.mapY << 13;
        // Render each group

        for (const [key, entry] of groups) {
            const { slots, indices } = entry;
            const [spotStr, frameStr] = key.split("|");
            const spotId = parseInt(spotStr, 10) | 0;
            const frameIdx = parseInt(frameStr, 10) | 0;

            const prog = transparent
                ? (this.renderer as any).projectileProgram
                : (this.renderer as any).projectileProgramOpaque ??
                  (this.renderer as any).projectileProgram;

            if (!prog) {
                if ((globalThis as any).DEBUG_PROJECTILES_TRAJ) {
                    const firstProj = projectiles[indices[0] | 0];
                    console.warn(
                        `[ProjectileRenderer] missing program pid=${
                            (firstProj as any)?.debugId ?? -1
                        } pass=${pass} spotId=${spotId}`,
                    );
                }
                continue;
            }

            const vaoRec = this.getOrCreateSpotAnimGpu(spotId, frameIdx, transparent, prog);
            if (!vaoRec) continue;

            const subOffset = vec2.create();

            const dc: DrawCall = this.renderer.configureDrawCall(vaoRec.drawCall)
                .uniformBlock("SceneUniforms", (this.renderer as any).sceneUniformBuffer)
                .uniform("u_timeLoaded", -1.0)
                .texture("u_textures", (this.renderer as any).textureArray)
                .texture("u_textureMaterials", (this.renderer as any).textureMaterials)
                .uniform("u_mapPos", vec2.fromValues(map.mapX, map.mapY))
                .uniform("u_npcDataOffset", baseOffset | 0)
                .texture("u_npcDataTexture", actorDataTexture)
                .texture("u_heightMap", map.heightMapTexture)
                .uniform("u_sceneBorderSize", map.borderSize)
                .uniform("u_projectileSubOffset", subOffset);

            (this.renderer as any).app.disable(PicoGL.CULL_FACE);

            // Render each projectile instance with its own height
            for (let i = 0; i < slots.length; i++) {
                const proj = projectiles[indices[i]];
                const pos = proj.getPosition();
                const relativeSlot = slots[i] | 0;
                const relativeXf = pos.x - mapWorldX;
                const relativeYf = pos.y - mapWorldY;
                const fracX = relativeXf - Math.floor(relativeXf);
                const fracY = relativeYf - Math.floor(relativeYf);
                // Provide ground-relative height offset for the shader.
                // In the projectile shader, positive u_modelYOffset raises the model (it is subtracted).
                // Ground and projectile Z are negative-up, so above-ground means pos.z < ground.
                let groundUnitsUsed: number | undefined = undefined;
                let heightOffset = pos.z;
                try {
                    const localTileX = Math.max(0, Math.min(63, ((relativeXf >> 7) | 0) as number));
                    const localTileY = Math.max(0, Math.min(63, ((relativeYf >> 7) | 0) as number));
                    // getApproxTileHeight() is already bridge-aware (it applies BridgePlaneStrategy.RENDER),
                    // so do not pre-resolve a promoted plane here or we'd double-apply bridge promotion.
                    const gt = sampleHeight?.(pos.x / 128, pos.y / 128, proj.plane | 0) as number;
                    if (Number.isFinite(gt)) {
                        groundUnitsUsed = (gt as number) * 128;
                        // Flip sign so above-ground yields positive offset.
                        heightOffset = groundUnitsUsed - pos.z;
                    }
                } catch {}

                /*if ((globalThis as any).DEBUG_PROJECTILES_TRAJ) {
                    console.log(
                        `[ProjectileRenderer] draw pid=${(proj as any).debugId ?? -1} spotId=${spotId} frame=${frameIdx} map=(${map.mapX},${map.mapY}) rel=(${relativeXf.toFixed(
                            1,
                        )},${relativeYf.toFixed(1)}) posZ=${pos.z.toFixed(
                            1,
                        )} ground=${(groundUnitsUsed ?? NaN).toFixed(1)} yOff=${heightOffset.toFixed(
                            1,
                        )}`,
                    );
                }*/

                dc.uniform("u_drawIdOverride", relativeSlot);
                dc.uniform("u_modelYOffset", heightOffset);
                vec2.set(subOffset, fracX, fracY);
                dc.uniform("u_projectileSubOffset", subOffset);
                dc.draw();
            }

            dc.uniform("u_drawIdOverride", -1);
            vec2.set(subOffset, 0, 0);
            dc.uniform("u_projectileSubOffset", subOffset);

            if ((this.renderer as any).cullBackFace)
                (this.renderer as any).app.enable(PicoGL.CULL_FACE);
        }
    }
}

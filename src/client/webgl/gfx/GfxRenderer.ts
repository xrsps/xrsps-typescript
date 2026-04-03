import { vec2 } from "gl-matrix";
import PicoGL, { DrawCall, Texture } from "picogl";

import type { WebGLMapSquare } from "../WebGLMapSquare";
import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";
import { GfxCache } from "./GfxCache";
import { GfxManager } from "./GfxManager";
import type { GfxInstance } from "./GfxManager";
import { SpotAnimGpuCache } from "./SpotAnimGpuCache";

type Pass = "opaque" | "alpha";

export class GfxRenderer {
    private cache: GfxCache;
    private gpuCache: SpotAnimGpuCache;
    // Reusable Maps to avoid per-frame allocations
    private reusableGroupsMap = new Map<string, Array<{ slot: number; yOffUnits: number }>>();
    private reusableYOffsetMap = new Map<number, Array<{ slot: number; yOffUnits: number }>>();
    // Frame index cache to avoid recomputing cumulative offsets (null = no frame lengths)
    private frameOffsetCache = new Map<number, number[] | null>();

    constructor(
        private renderer: WebGLOsrsRenderer,
        private mgr: GfxManager,
    ) {
        this.cache = new GfxCache(renderer);
        this.gpuCache = new SpotAnimGpuCache(renderer, this.cache, 192);
    }

    getCache(): GfxCache {
        return this.cache;
    }

    getGpuCache(): SpotAnimGpuCache {
        return this.gpuCache;
    }

    /**
     * Clear and return the reusable groups map to avoid per-frame allocation.
     */
    private getReusableGroupsMap(): Map<string, Array<{ slot: number; yOffUnits: number }>> {
        // Clear all arrays in the map and clear the map itself
        for (const arr of this.reusableGroupsMap.values()) {
            arr.length = 0;
        }
        this.reusableGroupsMap.clear();
        return this.reusableGroupsMap;
    }

    /**
     * Clear and return the reusable y-offset map to avoid per-frame allocation.
     */
    private getReusableYOffsetMap(): Map<number, Array<{ slot: number; yOffUnits: number }>> {
        for (const arr of this.reusableYOffsetMap.values()) {
            arr.length = 0;
        }
        this.reusableYOffsetMap.clear();
        return this.reusableYOffsetMap;
    }

    /** Render attached actor effects (players and NPCs) for a given map/pass using actorDataTexture. */
    renderMapPass(
        map: WebGLMapSquare,
        actorDataTexture: Texture | undefined,
        pass: Pass,
        offsets: { player?: number; npc?: number; world?: number } = {},
    ): void {
        if (!actorDataTexture) return;
        const playerOffset =
            offsets.player !== undefined && offsets.player !== -1 ? offsets.player | 0 : undefined;
        const npcOffset =
            offsets.npc !== undefined && offsets.npc !== -1 ? offsets.npc | 0 : undefined;
        const worldOffset =
            offsets.world !== undefined && offsets.world !== -1 ? offsets.world | 0 : undefined;
        if (playerOffset === undefined && npcOffset === undefined && worldOffset === undefined)
            return;

        const transparent = pass === "alpha";
        const nowMs = (performance?.now?.() as number) || Date.now();
        const prog = transparent
            ? (this.renderer as any).npcProgram
            : (this.renderer as any).npcProgramOpaque ?? (this.renderer as any).npcProgram;
        if (!prog) return;
        const programKey = transparent ? "npc-alpha" : "npc-opaque";

        const renderAttachments = <T extends { inst: GfxInstance; slot: number }>(
            entries: T[],
            baseOffset: number | undefined,
            resolveYOffset: (entry: T) => number,
        ) => {
            if (baseOffset === undefined) return;
            if (entries.length === 0) return;

            const groups = this.getReusableGroupsMap();
            for (const entry of entries) {
                const { inst, slot } = entry;
                if (inst.startTimeMs == null) continue;
                const ageMs = Math.max(0, nowMs - (inst.startTimeMs | 0));
                const frameIdx = this.computeSpotFrameIdxByMs(inst.spotId, Math.floor(ageMs));

                // Dispatch frame-sounds once per frame change for this instance
                if (inst.lastSoundFrame !== frameIdx) {
                    try {
                        const mv: any = this.renderer.osrsClient as any;
                        const spot = mv.spotAnimTypeLoader?.load?.(inst.spotId | 0);
                        const seqId: number =
                            typeof spot?.sequenceId === "number" ? spot.sequenceId | 0 : -1;
                        if (seqId >= 0) {
                            const seqType = mv.seqTypeLoader?.load?.(seqId | 0);
                            if (seqType && seqType.frameSounds?.size) {
                                // Resolve world position and local-player flag
                                let px: number | undefined;
                                let py: number | undefined;
                                let pz: number | undefined;
                                let isLocal = false;

                                const anyEntry: any = entry as any;
                                if (typeof anyEntry.pid === "number") {
                                    const pid = anyEntry.pid | 0;
                                    px = mv.playerEcs?.getX?.(pid) | 0;
                                    py = mv.playerEcs?.getY?.(pid) | 0;
                                    const lvl = mv.playerEcs?.getLevel?.(pid) | 0;
                                    pz = (lvl | 0) * 128;
                                    const sid = mv.playerEcs?.getServerIdForIndex?.(pid);
                                    isLocal =
                                        typeof sid === "number" &&
                                        (sid | 0) === (mv.controlledPlayerServerId | 0);
                                } else if (typeof anyEntry.ecsId === "number") {
                                    const eid = anyEntry.ecsId | 0;
                                    px = mv.npcEcs?.getX?.(eid) | 0;
                                    py = mv.npcEcs?.getY?.(eid) | 0;
                                    const lvl = mv.npcEcs?.getLevel?.(eid) | 0;
                                    pz = (lvl | 0) * 128;
                                    isLocal = false;
                                } else if (inst.world) {
                                    px = (inst.world.tileX | 0) * 128 + 64;
                                    py = (inst.world.tileY | 0) * 128 + 64;
                                    pz = (inst.world.level | 0) * 128;
                                    isLocal = false;
                                }

                                const pos =
                                    px !== undefined && py !== undefined
                                        ? { x: px, y: py, z: pz }
                                        : undefined;
                                mv.handleSeqFrameSounds(seqType, frameIdx | 0, {
                                    position: pos,
                                    isLocalPlayer: isLocal,
                                    debugSeqId: seqId | 0,
                                    debugFrame: frameIdx | 0,
                                });
                            }
                        }
                    } catch {}
                    inst.lastSoundFrame = frameIdx | 0;
                }
                const key = `${inst.spotId}|${frameIdx}`;
                const arr = groups.get(key) ?? [];
                const yOffUnits = resolveYOffset(entry) | 0;
                arr.push({ slot, yOffUnits });
                if (!groups.has(key)) groups.set(key, arr);
            }

            for (const [key, instances] of groups) {
                if (instances.length === 0) continue;
                const [spotStr, frameStr] = key.split("|");
                const spotId = parseInt(spotStr, 10) | 0;
                const frameIdx = parseInt(frameStr, 10) | 0;
                const vaoRec = this.gpuCache.getOrCreate(
                    spotId,
                    frameIdx,
                    transparent,
                    programKey,
                    prog,
                );
                if (!vaoRec) continue;

                const dc: DrawCall = this.renderer.configureDrawCall(vaoRec.drawCall)
                    .uniformBlock("SceneUniforms", (this.renderer as any).sceneUniformBuffer)
                    .uniform("u_timeLoaded", -1.0)
                    .texture("u_textures", (this.renderer as any).textureArray)
                    .texture("u_textureMaterials", (this.renderer as any).textureMaterials)
                    .uniform("u_mapPos", vec2.fromValues(map.mapX, map.mapY))
                    .uniform("u_npcDataOffset", baseOffset | 0)
                    .texture("u_npcDataTexture", actorDataTexture)
                    .texture("u_heightMap", map.heightMapTexture)
                    .uniform("u_sceneBorderSize", map.borderSize);

                (this.renderer as any).app.disable(PicoGL.CULL_FACE);

                const yOffsetGroups = this.getReusableYOffsetMap();
                for (const inst of instances) {
                    const yOff = inst.yOffUnits | 0;
                    let group = yOffsetGroups.get(yOff);
                    if (!group) {
                        group = [];
                        yOffsetGroups.set(yOff, group);
                    }
                    group.push(inst);
                }

                for (const [yOff, groupInstances] of yOffsetGroups) {
                    dc.uniform("u_modelYOffset", yOff);
                    const drawRanges: Array<[number, number, number]> = [];
                    const drawIndices: number[] = [];
                    for (const inst of groupInstances) {
                        drawRanges.push([0, vaoRec.indexCount, 1]);
                        drawIndices.push(inst.slot | 0);
                    }
                    dc.uniform("u_drawIdOverride", -1);
                    (this.renderer as any).draw(dc, drawRanges, drawIndices);
                }

                if ((this.renderer as any).cullBackFace)
                    (this.renderer as any).app.enable(PicoGL.CULL_FACE);
            }
        };

        if (playerOffset !== undefined) {
            const playerEntries = this.mgr.getAttachedPlayersForMap(map.mapX, map.mapY);
            renderAttachments(playerEntries, playerOffset, ({ inst }) => {
                if (inst.anchor === "offset") {
                    const tiles = inst.yOffsetTiles ?? 0;
                    const units = Math.round(tiles * 128);
                    return units;
                }
                return 0;
            });
        }

        if (npcOffset !== undefined) {
            const npcEntries = this.mgr.getAttachedNpcsForMap(map);
            renderAttachments(npcEntries, npcOffset, ({ inst }) => {
                if (inst.anchor === "offset") {
                    const tiles = inst.yOffsetTiles ?? 0;
                    const units = Math.round(tiles * 128);
                    return units;
                }
                return 0;
            });
        }

        if (worldOffset !== undefined) {
            const worldEntries = this.mgr.getWorldInstancesForMap(map);
            renderAttachments(worldEntries, worldOffset, ({ inst }) => {
                if (inst.anchor === "offset") {
                    const tiles = inst.yOffsetTiles ?? inst.world?.heightOffsetTiles ?? 0;
                    const units = Math.round(tiles * 128);
                    return units;
                }
                return 0;
            });
        }
    }

    /**
     * Get or compute cumulative frame offsets for fast frame index lookup.
     * Cached per spotId to avoid recomputation.
     */
    private getFrameOffsets(spotId: number): number[] | null {
        let offsets = this.frameOffsetCache.get(spotId);
        if (offsets !== undefined) {
            return offsets;
        }

        const lengths = this.cache.getFrameLengths(spotId);
        if (!lengths || lengths.length === 0) {
            this.frameOffsetCache.set(spotId, null);
            return null;
        }

        // Precompute cumulative offsets for O(1) binary search
        offsets = new Array(lengths.length);
        let acc = 0;
        for (let i = 0; i < lengths.length; i++) {
            acc += Math.max(1, lengths[i] | 0);
            offsets[i] = acc;
        }
        this.frameOffsetCache.set(spotId, offsets);
        return offsets;
    }

    private computeSpotFrameIdxByMs(spotId: number, ageMs: number): number {
        try {
            const cycles = Math.max(0, Math.floor((ageMs | 0) / 20));
            const offsets = this.getFrameOffsets(spotId);

            if (offsets && offsets.length > 0) {
                const total = offsets[offsets.length - 1];
                const t = total > 0 ? ((cycles % total) + total) % total : cycles % offsets.length;

                // Binary search through cumulative offsets
                let low = 0;
                let high = offsets.length - 1;
                while (low < high) {
                    const mid = (low + high) >>> 1;
                    if (t < offsets[mid]) {
                        high = mid;
                    } else {
                        low = mid + 1;
                    }
                }
                return low | 0;
            }

            const fc = Math.max(1, this.cache.getFrameCount(spotId) | 0);
            return ((cycles % fc) + fc) % fc;
        } catch {
            return 0;
        }
    }
}

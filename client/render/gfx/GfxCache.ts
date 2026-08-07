import { Model } from "../../rs/model/Model";
import { ModelData } from "../../rs/model/ModelData";
import type { TextureLoader } from "../../rs/texture/TextureLoader";
import { getModelFacesFiltered, SceneBuffer } from "../buffer/SceneBuffer";
import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";

type FrameKey = string; // `${spotId}|${frameIdx}|${pass}|${version}` where pass is 0=opaque,1=alpha
const FRAME_GEOMETRY_VERSION = 2;

export class GfxCache {
    private baseBySpot = new Map<number, Model>();
    private frameGeom = new Map<FrameKey, { vertices: Uint8Array; indices: Int32Array }>();
    constructor(private renderer: WebGLOsrsRenderer) {}

    private getSpotType(spotId: number): any | undefined {
        try {
            return this.renderer.osrsClient.spotAnimTypeLoader?.load?.(spotId | 0);
        } catch {
            return undefined;
        }
    }

    ensureBase(spotId: number): Model | undefined {
        const cached = this.baseBySpot.get(spotId | 0);
        if (cached) return cached;
        const spot = this.getSpotType(spotId);
        if (!spot) return undefined;
        const mv: any = this.renderer.osrsClient as any;
        const md0 = mv.modelLoader?.getModel?.(spot.modelId);
        if (!md0) return undefined;
        const md = ModelData.copyFrom(md0, false, false, false, false);
        if (spot.recolorFrom) {
            for (let i = 0; i < spot.recolorFrom.length; i++)
                md.recolor(spot.recolorFrom[i], spot.recolorTo[i]);
        }
        if (spot.retextureFrom) {
            for (let i = 0; i < spot.retextureFrom.length; i++)
                md.retexture(spot.retextureFrom[i], spot.retextureTo[i]);
        }
        const model: Model = md.light(
            mv.textureLoader,
            ((spot.ambient | 0) + 64) | 0,
            ((spot.contrast | 0) + 850) | 0,
            -30,
            -50,
            -30,
        ) as Model;
        // Scale/orientation from spot def
        try {
            if ((spot.widthScale | 0) !== 128 || (spot.heightScale | 0) !== 128) {
                model.scale(spot.widthScale | 0, spot.heightScale | 0, spot.widthScale | 0);
            }
        } catch {}
        try {
            const ori = (((spot.orientation | 0) % 360) + 360) % 360;
            if (ori === 90) model.rotate90();
            else if (ori === 180) model.rotate180();
            else if (ori === 270) model.rotate270();
        } catch {}
        this.baseBySpot.set(spotId | 0, model);
        return model;
    }

    getFrameCount(spotId: number): number {
        const spot = this.getSpotType(spotId);
        if (!spot) return 1;
        const seqId: number = typeof spot.sequenceId === "number" ? spot.sequenceId | 0 : -1;
        if (seqId < 0) return 1;
        try {
            const seq = this.renderer.osrsClient.seqTypeLoader?.load?.(seqId);
            if (!seq) return 1;
            if (seq.isSkeletalSeq?.()) return Math.max(1, seq.getSkeletalDuration?.() | 0);
            return Math.max(1, (seq.frameIds?.length ?? 1) | 0);
        } catch {
            return 1;
        }
    }

    /** Return total duration in ticks for the spot's sequence. */
    getDurationTicks(spotId: number): number | undefined {
        try {
            const spot = this.renderer.osrsClient.spotAnimTypeLoader?.load?.(spotId | 0);
            if (!spot) return undefined;
            const seqId: number = typeof spot.sequenceId === "number" ? spot.sequenceId | 0 : -1;
            if (seqId < 0) return undefined;
            const mv: any = this.renderer.osrsClient as any;
            const seq = mv.seqTypeLoader?.load?.(seqId | 0);
            if (!seq) return undefined;
            if (seq.isSkeletalSeq?.()) return Math.max(1, seq.getSkeletalDuration?.() | 0);
            const fc = Math.max(1, (seq.frameIds?.length ?? 1) | 0);
            let total = 0;
            for (let i = 0; i < fc; i++) total += seq.getFrameLength(mv.seqFrameLoader, i) | 0;
            return Math.max(1, total | 0);
        } catch {
            return undefined;
        }
    }

    /** Return per-frame lengths for non-skeletal sequences, or undefined for skeletal. */
    getFrameLengths(spotId: number): number[] | undefined {
        try {
            const spot = this.renderer.osrsClient.spotAnimTypeLoader?.load?.(spotId | 0);
            if (!spot) return undefined;
            const seqId: number = typeof spot.sequenceId === "number" ? spot.sequenceId | 0 : -1;
            if (seqId < 0) return undefined;
            const mv: any = this.renderer.osrsClient as any;
            const seq = mv.seqTypeLoader?.load?.(seqId | 0);
            if (!seq || seq.isSkeletalSeq?.()) return undefined;
            const fc = Math.max(1, (seq.frameIds?.length ?? 1) | 0);
            const arr: number[] = new Array(fc);
            for (let i = 0; i < fc; i++) arr[i] = seq.getFrameLength(mv.seqFrameLoader, i) | 0;
            return arr;
        } catch {
            return undefined;
        }
    }

    /** Build and cache geometry arrays for (spot, frame, pass). */
    ensureFrameGeometry(
        spotId: number,
        frameIdx: number,
        transparent: boolean,
    ): { vertices: Uint8Array; indices: Int32Array } | undefined {
        const pass = transparent ? 1 : 0;
        const key = `${spotId | 0}|${frameIdx | 0}|${pass}|${FRAME_GEOMETRY_VERSION}` as FrameKey;
        const existing = this.frameGeom.get(key);
        if (existing) return existing;

        const base = this.ensureBase(spotId);
        if (!base) return undefined;
        const model = this.applyFrame(base, spotId, frameIdx);
        if (!model) return undefined;

        // Collect textures to ensure on GPU
        try {
            const mv: any = this.renderer.osrsClient as any;
            const used = new Set<number>();
            if ((model as any).faceTextures) {
                const texLoader = mv.textureLoader;
                for (let i = 0; i < (model as any).faceCount; i++) {
                    const tid = (model as any).faceTextures[i];
                    if (tid !== -1 && texLoader.isSd?.(tid)) used.add(tid);
                }
            }
            if (used.size > 0) {
                const toUpload = new Map<number, Int32Array>();
                for (const tid of used) {
                    if (!(this.renderer as any).loadedTextureIds?.has?.(tid)) {
                        try {
                            const px = (
                                this.renderer.osrsClient as any
                            ).textureLoader.getPixelsArgb(tid, 128, true, 1.0);
                            toUpload.set(tid, px);
                        } catch {}
                    }
                }
                if (toUpload.size > 0) (this.renderer as any).updateTextureArray?.(toUpload);
            }
        } catch {}

        // Convert to interleaved + index arrays using SceneBuffer
        const textureLoader = (this.renderer.osrsClient as any).textureLoader as TextureLoader;
        const textureIdIndexMap =
            (this.renderer as any).textureIdIndexMap ?? new Map<number, number>();

        const sceneBuf = new SceneBuffer(
            textureLoader,
            textureIdIndexMap,
            ((model as any).verticesCount | 0) + 16,
        );
        const faces = getModelFacesFiltered(model, textureLoader, transparent);
        if (faces.length > 0) sceneBuf.addModel(model, faces);
        const out = {
            vertices: sceneBuf.vertexBuf.byteArray(),
            indices: new Int32Array(sceneBuf.indices),
        };
        this.frameGeom.set(key, out);
        return out;
    }

    private applyFrame(base: Model, spotId: number, frameIdx: number): Model | undefined {
        try {
            const spot = this.getSpotType(spotId);
            if (!spot) return undefined;
            const mv: any = this.renderer.osrsClient as any;
            const seqId: number = typeof spot.sequenceId === "number" ? spot.sequenceId | 0 : -1;
            if (seqId < 0) return Model.copyAnimated(base, true, true);
            const seq = mv.seqTypeLoader?.load?.(seqId | 0);
            if (seq?.isSkeletalSeq?.()) {
                const duration = Math.max(1, seq.getSkeletalDuration?.() | 0);
                const clamped = (((frameIdx | 0) % duration) + duration) % duration;
                const skeletal = mv.skeletalSeqLoader?.load?.(seq.skeletalId | 0);
                if (!skeletal) return undefined;
                const out = Model.copyAnimated(base, !skeletal.hasAlphaTransform, true);
                out.animateSkeletal(skeletal, clamped | 0);
                return out;
            }
            if (seq?.frameIds && seq.frameIds.length > 0) {
                const ids = seq.frameIds;
                const idx =
                    Math.max(0, (((frameIdx | 0) % ids.length) + ids.length) % ids.length) | 0;
                const frameKey = ids[idx] | 0;
                const seqFrame = mv.seqFrameLoader?.load?.(frameKey);
                if (seqFrame) {
                    const out = Model.copyAnimated(
                        base,
                        !seqFrame.hasAlphaTransform,
                        !seqFrame.hasColorTransform,
                    );
                    out.animate(seqFrame, undefined, !!seq.op14);
                    return out;
                }
                return undefined;
            }
            return seq ? undefined : Model.copyAnimated(base, true, true);
        } catch {
            return undefined;
        }
    }
}

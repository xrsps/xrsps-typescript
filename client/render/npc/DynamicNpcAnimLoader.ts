/**
 * DynamicNpcAnimLoader - Builds dynamic NPC sequence metadata and current-frame geometry on demand.
 *
 * OSRS applies NPC sequences at render time. We mirror that by resolving the
 * current posed model when needed rather than baking whole sequences into a
 * persistent GPU buffer.
 */
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../rs/config/npctype/NpcType";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqType } from "../../rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarManager } from "../../rs/config/vartype/VarManager";
import { Model } from "../../rs/model/Model";
import { ModelLoader } from "../../rs/model/ModelLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { SceneBuffer } from "../buffer/SceneBuffer";

export interface DynamicNpcSequenceMeta {
    key: string;
    npcTypeId: number;
    seqId: number;
    frameLengths: number[];
    frameCount: number;
    skeletal: boolean;
}

export interface DynamicNpcFrameGeometry {
    key: string;
    npcTypeId: number;
    seqId: number;
    frameId: number;
    overlaySeqId?: number;
    overlayFrameId?: number;
    opaqueVertices: Uint8Array;
    opaqueIndices: Int32Array;
    alphaVertices: Uint8Array;
    alphaIndices: Int32Array;
    approxBytes: number;
}

const CACHE_CONFIG = {
    /** Cap dynamic current-frame geometry cache to a bounded CPU budget. */
    MAX_GEOMETRY_BYTES: 16 * 1024 * 1024,
} as const;

export class DynamicNpcAnimLoader {
    private npcModelLoader: NpcModelLoader | undefined;
    private textureIdIndexMap: Map<number, number> | undefined;
    private seqMetaCache = new Map<string, DynamicNpcSequenceMeta>();
    private geomCache = new Map<string, DynamicNpcFrameGeometry>();
    private geomCacheBytes = 0;
    private opaqueSceneBuf: SceneBuffer | undefined;
    private alphaSceneBuf: SceneBuffer | undefined;

    constructor(
        private npcTypeLoader: NpcTypeLoader | undefined,
        private modelLoader: ModelLoader | undefined,
        private textureLoader: TextureLoader | undefined,
        private seqTypeLoader: SeqTypeLoader | undefined,
        private seqFrameLoader: SeqFrameLoader | undefined,
        private skeletalSeqLoader: SkeletalSeqLoader | undefined,
        private varManager: VarManager | undefined,
    ) {
        this.initLoader();
    }

    private initLoader(): void {
        if (
            this.npcTypeLoader &&
            this.modelLoader &&
            this.textureLoader &&
            this.seqTypeLoader &&
            this.seqFrameLoader &&
            this.varManager
        ) {
            this.npcModelLoader = new NpcModelLoader(
                this.npcTypeLoader,
                this.modelLoader,
                this.textureLoader,
                this.seqTypeLoader,
                this.seqFrameLoader,
                this.skeletalSeqLoader,
                this.varManager,
            );
        }
    }

    setTextureIdIndexMap(map: Map<number, number>): void {
        this.textureIdIndexMap = map;
    }

    isReady(): boolean {
        return !!(this.npcModelLoader && this.textureLoader && this.textureIdIndexMap);
    }

    getSequenceMeta(npcTypeId: number, seqId: number): DynamicNpcSequenceMeta | undefined {
        if (seqId < 0 || !this.isReady()) {
            return undefined;
        }

        const npcType = this.getResolvedNpcType(npcTypeId);
        if (!npcType) {
            return undefined;
        }

        const key = `${npcType.id}:${seqId}`;
        const cached = this.seqMetaCache.get(key);
        if (cached) {
            return cached;
        }

        const seqType = this.seqTypeLoader?.load(seqId);
        if (!seqType) {
            return undefined;
        }

        const frameCount = this.getFrameCount(seqType);
        if (frameCount <= 0) {
            return undefined;
        }

        // Validate that this NPC model can actually be resolved for the sequence
        // before the renderer commits to the dynamic path.
        const validationModel = this.npcModelLoader?.getModel(npcType, seqId, 0);
        if (!validationModel) {
            return undefined;
        }

        const meta: DynamicNpcSequenceMeta = {
            key,
            npcTypeId: npcType.id | 0,
            seqId: seqId | 0,
            frameLengths: this.getFrameLengths(seqType, frameCount),
            frameCount,
            skeletal: seqType.isSkeletalSeq(),
        };
        this.seqMetaCache.set(key, meta);
        return meta;
    }

    getFrameGeometry(
        npcTypeId: number,
        seqId: number,
        frameId: number,
        overlaySeqId: number = -1,
        overlayFrameId: number = -1,
    ): DynamicNpcFrameGeometry | undefined {
        if (!this.isReady()) {
            return undefined;
        }

        const meta = this.getSequenceMeta(npcTypeId, seqId);
        if (!meta) {
            return undefined;
        }

        const resolvedNpcType = this.getResolvedNpcType(npcTypeId);
        if (!resolvedNpcType) {
            return undefined;
        }

        const normalizedFrame =
            meta.frameCount > 0 ? Math.max(0, frameId | 0) % (meta.frameCount | 0) : 0;
        const normalizedOverlayFrame = Math.max(0, overlayFrameId | 0);
        const overlayKey =
            overlaySeqId >= 0 ? `:${overlaySeqId | 0}:${normalizedOverlayFrame | 0}` : "";
        const key = `${resolvedNpcType.id}:${seqId}:${normalizedFrame}${overlayKey}`;
        const cached = this.geomCache.get(key);
        if (cached) {
            this.promoteGeometryEntry(key, cached);
            return cached;
        }

        if (
            !this.isSequenceFrameReady(seqId, normalizedFrame) ||
            (overlaySeqId >= 0 &&
                !this.isSequenceFrameReady(overlaySeqId, normalizedOverlayFrame))
        ) {
            return undefined;
        }

        const model = this.npcModelLoader?.getModel(
            resolvedNpcType,
            seqId,
            normalizedFrame,
            overlaySeqId | 0,
            normalizedOverlayFrame | 0,
        );
        if (!model) {
            return undefined;
        }

        return this.cacheModelGeometry(
            key,
            resolvedNpcType.id | 0,
            seqId | 0,
            normalizedFrame | 0,
            model,
            overlaySeqId >= 0 ? overlaySeqId | 0 : undefined,
            overlaySeqId >= 0 ? normalizedOverlayFrame | 0 : undefined,
        );
    }

    private isSequenceFrameReady(seqId: number, frameId: number): boolean {
        const seqType = this.seqTypeLoader?.load(seqId | 0);
        if (!seqType) return false;
        if (seqType.isSkeletalSeq()) {
            return !!this.skeletalSeqLoader?.load(seqType.skeletalId);
        }
        const ids = seqType.frameIds;
        if (!ids?.length) return false;
        return !!this.seqFrameLoader?.load(ids[Math.max(0, frameId | 0) % ids.length] | 0);
    }

    getBaseGeometry(npcTypeId: number): DynamicNpcFrameGeometry | undefined {
        if (!this.isReady()) return undefined;

        const resolvedNpcType = this.getResolvedNpcType(npcTypeId);
        if (!resolvedNpcType) return undefined;

        const key = `${resolvedNpcType.id}:base`;
        const cached = this.geomCache.get(key);
        if (cached) {
            this.promoteGeometryEntry(key, cached);
            return cached;
        }

        const model = this.npcModelLoader?.getModel(resolvedNpcType, -1, -1);
        if (!model) return undefined;

        return this.cacheModelGeometry(key, resolvedNpcType.id | 0, -1, 0, model);
    }

    private cacheModelGeometry(
        key: string,
        npcTypeId: number,
        seqId: number,
        frameId: number,
        model: Model,
        overlaySeqId?: number,
        overlayFrameId?: number,
    ): DynamicNpcFrameGeometry {
        const opaque = this.buildGeometry(model, false);
        const alpha = this.buildGeometry(model, true);
        const entry: DynamicNpcFrameGeometry = {
            key,
            npcTypeId,
            seqId,
            frameId,
            overlaySeqId,
            overlayFrameId,
            opaqueVertices: opaque.vertices,
            opaqueIndices: opaque.indices,
            alphaVertices: alpha.vertices,
            alphaIndices: alpha.indices,
            approxBytes:
                opaque.vertices.byteLength +
                opaque.indices.byteLength +
                alpha.vertices.byteLength +
                alpha.indices.byteLength,
        };

        this.geomCache.set(key, entry);
        this.geomCacheBytes += entry.approxBytes;
        this.evictGeometryEntriesIfNeeded();
        return entry;
    }

    clear(): void {
        this.seqMetaCache.clear();
        this.geomCache.clear();
        this.geomCacheBytes = 0;
        this.opaqueSceneBuf = undefined;
        this.alphaSceneBuf = undefined;
    }

    getStats(): {
        sequenceMetaEntries: number;
        geometryEntries: number;
        geometryBytes: number;
        topEntries: Array<{ key: string; approxBytes: number }>;
    } {
        return {
            sequenceMetaEntries: this.seqMetaCache.size,
            geometryEntries: this.geomCache.size,
            geometryBytes: this.geomCacheBytes,
            topEntries: Array.from(this.geomCache.values())
                .sort((a, b) => b.approxBytes - a.approxBytes || a.key.localeCompare(b.key))
                .slice(0, 8)
                .map((entry) => ({ key: entry.key, approxBytes: entry.approxBytes })),
        };
    }

    logStats(reason: string = "manual"): void {
        const stats = this.getStats();
        console.log(
            `[DynamicNpcAnimLoader] ${reason}: ` +
                `sequenceMetaEntries=${stats.sequenceMetaEntries}, ` +
                `geometryEntries=${stats.geometryEntries}, ` +
                `geometryBytes=${stats.geometryBytes}`,
        );
        for (const entry of stats.topEntries) {
            console.log(
                `[DynamicNpcAnimLoader] top geometry ${entry.key}: approxBytes=${entry.approxBytes}`,
            );
        }
    }

    private getResolvedNpcType(npcTypeId: number): NpcType | undefined {
        const npcType = this.npcTypeLoader?.load(npcTypeId);
        if (!npcType) {
            return undefined;
        }
        if (!npcType.transforms) {
            return npcType;
        }
        return npcType.transform(this.varManager!, this.npcTypeLoader!) ?? npcType;
    }

    private getFrameCount(seqType: SeqType): number {
        if (seqType.isSkeletalSeq()) {
            return Math.max(0, seqType.getSkeletalDuration() | 0);
        }
        return Math.max(0, seqType.frameIds?.length ?? 0);
    }

    private getFrameLengths(seqType: SeqType, frameCount: number): number[] {
        if (seqType.isSkeletalSeq()) {
            return new Array(frameCount).fill(1);
        }

        const lengths = new Array<number>(frameCount);
        for (let i = 0; i < frameCount; i++) {
            lengths[i] = seqType.getFrameLength(this.seqFrameLoader!, i) | 0;
        }
        return lengths;
    }

    private buildGeometry(
        model: Model,
        transparent: boolean,
    ): { vertices: Uint8Array; indices: Int32Array } {
        if (!this.textureLoader || !this.textureIdIndexMap) {
            return {
                vertices: new Uint8Array(0),
                indices: new Int32Array(0),
            };
        }

        let sceneBuf = transparent ? this.alphaSceneBuf : this.opaqueSceneBuf;
        if (!sceneBuf) {
            sceneBuf = new SceneBuffer(
                this.textureLoader,
                this.textureIdIndexMap,
                Math.max(16, (model.verticesCount | 0) + 16),
            );
            if (transparent) {
                this.alphaSceneBuf = sceneBuf;
            } else {
                this.opaqueSceneBuf = sceneBuf;
            }
        }

        this.resetSceneBuf(sceneBuf);
        sceneBuf.addModelAnimFrame(model, transparent);

        return {
            vertices: new Uint8Array(sceneBuf.vertexBuf.byteArray()),
            indices: new Int32Array(sceneBuf.indices),
        };
    }

    private resetSceneBuf(sceneBuf: SceneBuffer): void {
        sceneBuf.vertexBuf.offset = 0;
        sceneBuf.vertexBuf.vertexIndices.clear();
        sceneBuf.indices.length = 0;
        sceneBuf.usedTextureIds.clear();
    }

    private promoteGeometryEntry(key: string, entry: DynamicNpcFrameGeometry): void {
        this.geomCache.delete(key);
        this.geomCache.set(key, entry);
    }

    private evictGeometryEntriesIfNeeded(): void {
        while (this.geomCacheBytes > CACHE_CONFIG.MAX_GEOMETRY_BYTES && this.geomCache.size > 1) {
            const oldestKey = this.geomCache.keys().next().value as string | undefined;
            if (!oldestKey) {
                break;
            }
            const oldest = this.geomCache.get(oldestKey);
            this.geomCache.delete(oldestKey);
            if (!oldest) {
                continue;
            }
            this.geomCacheBytes = Math.max(0, this.geomCacheBytes - oldest.approxBytes);
        }
    }
}

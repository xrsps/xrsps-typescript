import { CacheSystem } from "../../../../rs/cache/CacheSystem";
import { IndexType } from "../../../../rs/cache/IndexType";
import { ByteBuffer } from "../../../../rs/io/ByteBuffer";
import { MusicPatchNode2 } from "./MusicPatchNode2";

/**
 * Port of RuneLite MusicPatch parser.
 * Holds per-note metadata and sample ids.
 */
export class MusicPatch {
    rawSounds: (null | number)[] = new Array(128).fill(null); // placeholder for resolved sound ids
    pitchOffsets: Int16Array = new Int16Array(128);
    volumes: Uint8Array = new Uint8Array(128);
    pans: Uint8Array = new Uint8Array(128);
    envelopes: MusicPatchNode2[] = new Array(128);
    exclusiveClasses: Int16Array = new Int16Array(128); // Signed to allow -1 (no exclusive class)
    sampleIds: Int32Array = new Int32Array(128);
    globalVolume = 0;

    constructor(data: Uint8Array | Int8Array) {
        const bytes =
            data instanceof Uint8Array
                ? data
                : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const buf = new ByteBuffer(bytes);

        // Read variable-length sections
        let var3 = 0;
        while (buf._data[buf.offset + var3] !== 0) var3++;
        const var4 = new Uint8Array(var3);
        for (let i = 0; i < var3; i++) var4[i] = buf.readUnsignedByte();
        buf.offset++; // skip zero
        var3++;
        let var5 = buf.offset;
        buf.offset += var3;

        let var6 = 0;
        while (buf._data[buf.offset + var6] !== 0) var6++;
        const var7 = new Uint8Array(var6);
        for (let i = 0; i < var6; i++) var7[i] = buf.readUnsignedByte();
        buf.offset++;
        var6++;
        let var8 = buf.offset;
        buf.offset += var6;

        let var9 = 0;
        while (buf._data[buf.offset + var9] !== 0) var9++;
        const var10 = new Uint8Array(var9);
        for (let i = 0; i < var9; i++) var10[i] = buf.readUnsignedByte();
        buf.offset++;
        var9++;
        const var36 = new Uint8Array(var9);
        let var12 = 0;
        if (var9 > 1) {
            var36[1] = 1;
            let var13 = 1;
            var12 = 2;
            for (let var14 = 2; var14 < var9; ++var14) {
                let var41 = buf.readUnsignedByte();
                if (var41 === 0) {
                    var13 = var12++;
                } else {
                    if (var41 <= var13) --var41;
                    var13 = var41;
                }
                var36[var14] = var13;
            }
        } else {
            var12 = var9;
        }

        const var37: MusicPatchNode2[] = new Array(var12);
        for (let i = 0; i < var12; i++) {
            const node = new MusicPatchNode2();
            let len = buf.readUnsignedByte();
            if (len > 0) node.volumeEnvelope = new Uint8Array(len * 2);
            len = buf.readUnsignedByte();
            if (len > 0) {
                node.releaseEnvelope = new Uint8Array(len * 2 + 2);
                node.releaseEnvelope[1] = 64;
            }
            var37[i] = node;
        }

        let var14 = buf.readUnsignedByte();
        const var42 = var14 > 0 ? new Uint8Array(var14 * 2) : null;
        var14 = buf.readUnsignedByte();
        const var16 = var14 > 0 ? new Uint8Array(var14 * 2) : null;

        let var17 = 0;
        while (buf._data[buf.offset + var17] !== 0) var17++;
        const var18 = new Uint8Array(var17);
        for (let i = 0; i < var17; i++) var18[i] = buf.readByte();
        buf.offset++;
        var17++;
        let var19 = 0;
        for (let var20 = 0; var20 < 128; var20++) {
            var19 += buf.readUnsignedByte();
            this.pitchOffsets[var20] = var19;
        }
        var19 = 0;
        for (let var20 = 0; var20 < 128; var20++) {
            var19 += buf.readUnsignedByte();
            this.pitchOffsets[var20] = this.pitchOffsets[var20] + (var19 << 8);
        }
        let var20 = 0;
        let var21 = 0;
        let var22 = 0;
        for (let var23 = 0; var23 < 128; var23++) {
            if (var20 === 0) {
                if (var21 < var18.length) {
                    var20 = var18[var21++];
                } else {
                    var20 = -1;
                }
                var22 = buf.readVarInt();
            }
            this.pitchOffsets[var23] = this.pitchOffsets[var23] + (((var22 - 1) & 2) << 14);
            this.sampleIds[var23] = var22;
            --var20;
        }

        var20 = 0;
        var21 = 0;
        var22 = 0;
        for (let var23 = 0; var23 < 128; var23++) {
            if (this.sampleIds[var23] !== 0) {
                if (var20 === 0) {
                    if (var21 < var4.length) {
                        var20 = var4[var21++];
                    } else {
                        var20 = -1;
                    }
                    var22 = buf._data[var5++] - 1;
                }
                this.exclusiveClasses[var23] = var22;
                --var20;
            }
        }

        var20 = 0;
        var21 = 0;
        let var24 = 0;
        for (let var25 = 0; var25 < 128; var25++) {
            if (this.sampleIds[var25] !== 0) {
                if (var20 === 0) {
                    if (var21 < var7.length) {
                        var20 = var7[var21++];
                    } else {
                        var20 = -1;
                    }
                    // In the original client, attenuation values live in the bytes we skipped at `var8`.
                    var24 = buf._data[var8++] + 16;
                }
                this.pans[var25] = var24 << 2;
                --var20;
            }
        }

        var20 = 0;
        var21 = 0;
        let var26 = var37[0];
        for (let var27 = 0; var27 < 128; var27++) {
            if (this.sampleIds[var27] !== 0) {
                if (var20 === 0) {
                    var26 = var37[var36[var21]];
                    if (var21 < var10.length) {
                        var20 = var10[var21++];
                    } else {
                        var20 = -1;
                    }
                }
                this.envelopes[var27] = var26;
                --var20;
            }
        }

        var20 = 0;
        var21 = 0;
        let var26Volume = 0;
        for (let var27 = 0; var27 < 128; var27++) {
            if (var20 === 0) {
                if (var21 < var18.length) {
                    var20 = var18[var21++];
                } else {
                    var20 = -1;
                }

                // Only consume a new volume byte when this note actually references a sample.
                if (this.sampleIds[var27] > 0) {
                    var26Volume = buf.readUnsignedByte() + 1;
                }
            }

            this.volumes[var27] = var26Volume;
            --var20;
        }

        this.globalVolume = buf.readUnsignedByte() + 1;

        // Read envelope amplitude values (odd indices)
        for (let var27 = 0; var27 < var12; var27++) {
            const node = var37[var27];
            if (node.volumeEnvelope) {
                for (let var29 = 1; var29 < node.volumeEnvelope.length; var29 += 2) {
                    node.volumeEnvelope[var29] = buf.readByte();
                }
            }
            if (node.releaseEnvelope) {
                for (let var29 = 3; var29 < node.releaseEnvelope.length - 2; var29 += 2) {
                    node.releaseEnvelope[var29] = buf.readByte();
                }
            }
        }

        if (var42) {
            for (let i = 1; i < var42.length; i += 2) {
                var42[i] = buf.readByte();
            }
        }
        if (var16) {
            for (let i = 1; i < var16.length; i += 2) {
                var16[i] = buf.readByte();
            }
        }

        // Read release envelope time values (even indices, cumulative)
        for (let var27 = 0; var27 < var12; var27++) {
            const node = var37[var27];
            if (node.releaseEnvelope) {
                let var19 = 0;
                for (let var29 = 2; var29 < node.releaseEnvelope.length; var29 += 2) {
                    var19 = 1 + var19 + buf.readUnsignedByte();
                    node.releaseEnvelope[var29] = var19;
                }
            }
        }

        // Read volume envelope time values (even indices, cumulative)
        for (let var27 = 0; var27 < var12; var27++) {
            const node = var37[var27];
            if (node.volumeEnvelope) {
                let var19 = 0;
                for (let var29 = 2; var29 < node.volumeEnvelope.length; var29 += 2) {
                    var19 = 1 + var19 + buf.readUnsignedByte();
                    node.volumeEnvelope[var29] = var19;
                }
            }
        }

        // Process global volume envelope (var42)
        if (var42) {
            let var19 = buf.readUnsignedByte();
            var42[0] = var19;

            for (let var27 = 2; var27 < var42.length; var27 += 2) {
                var19 = var19 + 1 + buf.readUnsignedByte();
                var42[var27] = var19;
            }

            let var47 = var42[0];
            let var28 = var42[1];

            for (let var29 = 0; var29 < var47; var29++) {
                this.volumes[var29] = ((var28 * this.volumes[var29] + 32) >> 6) & 0xff;
            }

            for (let var29 = 2; var29 < var42.length; var29 += 2) {
                const var30 = var42[var29];
                const var31 = var42[var29 + 1];
                let var32 = var28 * (var30 - var47) + Math.floor((var30 - var47) / 2);

                for (let var33 = var47; var33 < var30; var33++) {
                    const var34 = Math.floor(var32 / (var30 - var47));
                    this.volumes[var33] = ((var34 * this.volumes[var33] + 32) >> 6) & 0xff;
                    var32 += var31 - var28;
                }

                var47 = var30;
                var28 = var31;
            }

            for (let var45 = var47; var45 < 128; var45++) {
                this.volumes[var45] = ((var28 * this.volumes[var45] + 32) >> 6) & 0xff;
            }
        }

        // Process global pan envelope (var16)
        if (var16) {
            let var19 = buf.readUnsignedByte();
            var16[0] = var19;

            for (let var27 = 2; var27 < var16.length; var27 += 2) {
                var19 = var19 + 1 + buf.readUnsignedByte();
                var16[var27] = var19;
            }

            let var47 = var16[0];
            let var44 = ((var16[1] << 24) >> 24) << 1; // sign-extend and multiply

            for (let var29 = 0; var29 < var47; var29++) {
                let var45 = var44 + (this.pans[var29] & 255);
                if (var45 < 0) var45 = 0;
                if (var45 > 128) var45 = 128;
                this.pans[var29] = var45;
            }

            for (let var29 = 2; var29 < var16.length; var29 += 2) {
                const var30 = var16[var29];
                const var46 = ((var16[var29 + 1] << 24) >> 24) << 1;
                let var32 = var44 * (var30 - var47) + Math.floor((var30 - var47) / 2);

                for (let var33 = var47; var33 < var30; var33++) {
                    const var34 = Math.floor(var32 / (var30 - var47));
                    let var35 = var34 + (this.pans[var33] & 255);
                    if (var35 < 0) var35 = 0;
                    if (var35 > 128) var35 = 128;
                    this.pans[var33] = var35;
                    var32 += var46 - var44;
                }

                var47 = var30;
                var44 = var46;
            }

            for (let var45 = var47; var45 < 128; var45++) {
                let var46 = var44 + (this.pans[var45] & 255);
                if (var46 < 0) var46 = 0;
                if (var46 > 128) var46 = 128;
                this.pans[var45] = var46;
            }
        }

        // Read MusicPatchNode2 additional fields
        // Decay rate
        for (let var27 = 0; var27 < var12; var27++) {
            var37[var27].decayRate = buf.readUnsignedByte();
        }

        // Volume envelope rate, release envelope rate, and decay modifier
        for (let var27 = 0; var27 < var12; var27++) {
            const node = var37[var27];
            if (node.volumeEnvelope) {
                node.volumeEnvelopeRate = buf.readUnsignedByte();
            }
            if (node.releaseEnvelope) {
                node.releaseEnvelopeRate = buf.readUnsignedByte();
            }
            if (node.decayRate > 0) {
                node.decayModifier = buf.readUnsignedByte();
            }
        }

        // Vibrato rate
        for (let var27 = 0; var27 < var12; var27++) {
            var37[var27].vibratoRate = buf.readUnsignedByte();
        }

        // Vibrato depth
        for (let var27 = 0; var27 < var12; var27++) {
            const node = var37[var27];
            if (node.vibratoRate > 0) {
                node.vibratoDepth = buf.readUnsignedByte();
            }
        }

        // Vibrato delay
        for (let var27 = 0; var27 < var12; var27++) {
            const node = var37[var27];
            if (node.vibratoDepth > 0) {
                node.vibratoDelay = buf.readUnsignedByte();
            }
        }
    }

    static tryLoad(cache: CacheSystem, patchId: number): MusicPatch | null {
        const patches = cache.getIndex(IndexType.DAT2.musicPatches);
        if (!patches) return null;
        const file = patches.getFileSmart(patchId);
        if (!file) return null;
        try {
            return new MusicPatch(file.data);
        } catch (err) {
            console.warn("[MusicPatch] failed to parse patch", patchId, err);
            return null;
        }
    }
}

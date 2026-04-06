import { ByteBuffer } from "../../../../rs/io/ByteBuffer";

/**
 * Faithful port of the OSRS/RuneLite MusicTrack constructor to convert cache musicTrack bytes to MIDI.
 */
export class MusicTrack {
    static toMidi(dataIn: Uint8Array | Int8Array): Uint8Array | null {
        try {
            const data =
                dataIn instanceof Uint8Array
                    ? dataIn
                    : new Uint8Array(dataIn.buffer, dataIn.byteOffset, dataIn.byteLength);

            // Validate minimum input length (need at least 3 bytes for header at end)
            if (data.length < 4) {
                console.warn("[MusicTrack] Input too short");
                return null;
            }

            const var1 = new ByteBuffer(data);

            var1.offset = var1._data.length - 3;
            const var2 = var1.readUnsignedByte();
            const var3 = var1.readUnsignedShort();
            let var4 = var2 * 10 + 14;
            var1.offset = 0;
            let var5 = 0;
            let var6 = 0;
            let var7 = 0;
            let var8 = 0;
            let var9 = 0;
            let var10 = 0;
            let var11 = 0;
            let var12 = 0;

            let var13: number;
            let var14: number;
            let var15: number;
            for (var13 = 0; var13 < var2; ++var13) {
                var14 = -1;
                // Safety limit to prevent infinite loop on malformed data
                const maxEvents = data.length * 2;
                let eventCount = 0;
                while (eventCount++ < maxEvents) {
                    if (var1.offset >= var1._data.length) {
                        throw new Error("Unexpected end of data");
                    }
                    var15 = var1.readUnsignedByte();
                    if (var15 !== var14) {
                        ++var4;
                    }
                    var14 = var15 & 15;
                    if (var15 === 7) {
                        break;
                    }

                    if (var15 === 23) {
                        ++var5;
                    } else if (var14 === 0) {
                        ++var7;
                    } else if (var14 === 1) {
                        ++var8;
                    } else if (var14 === 2) {
                        ++var6;
                    } else if (var14 === 3) {
                        ++var9;
                    } else if (var14 === 4) {
                        ++var10;
                    } else if (var14 === 5) {
                        ++var11;
                    } else {
                        if (var14 !== 6) {
                            throw new Error("Unknown event type");
                        }
                        ++var12;
                    }
                }
                if (eventCount >= maxEvents) {
                    throw new Error("Event limit exceeded - malformed data");
                }
            }

            var4 += var5 * 5;
            var4 += (var7 + var8 + var6 + var9 + var11) * 2;
            var4 += var10 + var12;
            var13 = var1.offset;
            var14 = var2 + var5 + var6 + var7 + var8 + var9 + var10 + var11 + var12;

            for (var15 = 0; var15 < var14; ++var15) {
                var1.readVarInt();
            }

            var4 += var1.offset - var13;
            var15 = var1.offset;
            let var16 = 0;
            let var17 = 0;
            let var18 = 0;
            let var19 = 0;
            let var20 = 0;
            let var21 = 0;
            let var22 = 0;
            let var23 = 0;
            let var24 = 0;
            let var25 = 0;
            let var26 = 0;
            let var27 = 0;
            let var28 = 0;

            let var29: number;
            for (var29 = 0; var29 < var6; ++var29) {
                var28 = (var28 + var1.readUnsignedByte()) & 127;
                if (var28 !== 0 && var28 !== 32) {
                    if (var28 === 1) {
                        ++var16;
                    } else if (var28 === 33) {
                        ++var17;
                    } else if (var28 === 7) {
                        ++var18;
                    } else if (var28 === 39) {
                        ++var19;
                    } else if (var28 === 10) {
                        ++var20;
                    } else if (var28 === 42) {
                        ++var21;
                    } else if (var28 === 99) {
                        ++var22;
                    } else if (var28 === 98) {
                        ++var23;
                    } else if (var28 === 101) {
                        ++var24;
                    } else if (var28 === 100) {
                        ++var25;
                    } else if (
                        var28 !== 64 &&
                        var28 !== 65 &&
                        var28 !== 120 &&
                        var28 !== 121 &&
                        var28 !== 123
                    ) {
                        ++var27;
                    } else {
                        ++var26;
                    }
                } else {
                    ++var12;
                }
            }

            var29 = 0;
            let var30 = var1.offset;
            var1.offset += var26;
            let var31 = var1.offset;
            var1.offset += var11;
            let var32 = var1.offset;
            var1.offset += var10;
            let var33 = var1.offset;
            var1.offset += var9;
            let var34 = var1.offset;
            var1.offset += var16;
            let var35 = var1.offset;
            var1.offset += var18;
            let var36 = var1.offset;
            var1.offset += var20;
            let var37 = var1.offset;
            var1.offset += var7 + var8 + var11;
            let var38 = var1.offset;
            var1.offset += var7;
            let var39 = var1.offset;
            var1.offset += var27;
            let var40 = var1.offset;
            var1.offset += var8;
            let var41 = var1.offset;
            var1.offset += var17;
            let var42 = var1.offset;
            var1.offset += var19;
            let var43 = var1.offset;
            var1.offset += var21;
            let var44 = var1.offset;
            var1.offset += var12;
            let var45 = var1.offset;
            var1.offset += var9;
            let var46 = var1.offset;
            var1.offset += var22;
            let var47 = var1.offset;
            var1.offset += var23;
            let var48 = var1.offset;
            var1.offset += var24;
            let var49 = var1.offset;
            var1.offset += var25;
            let var50 = var1.offset;
            var1.offset += var5 * 3;

            const out: number[] = [];
            const writeByte = (b: number) => out.push(b & 0xff);
            const writeInt = (v: number) => {
                writeByte((v >>> 24) & 0xff);
                writeByte((v >>> 16) & 0xff);
                writeByte((v >>> 8) & 0xff);
                writeByte(v & 0xff);
            };
            const writeShort = (v: number) => {
                writeByte((v >>> 8) & 0xff);
                writeByte(v & 0xff);
            };
            const writeVarInt = (v: number) => {
                let val = v;
                const stack = [val & 0x7f];
                val >>>= 7;
                while (val > 0) {
                    stack.push((val & 0x7f) | 0x80);
                    val >>>= 7;
                }
                for (let i = stack.length - 1; i >= 0; i--) writeByte(stack[i]);
            };
            const writeLengthInt = (pos: number, len: number) => {
                out[pos] = (len >>> 24) & 0xff;
                out[pos + 1] = (len >>> 16) & 0xff;
                out[pos + 2] = (len >>> 8) & 0xff;
                out[pos + 3] = len & 0xff;
            };

            writeInt(0x4d546864); // MThd
            writeInt(6);
            writeShort(var2 > 1 ? 1 : 0);
            writeShort(var2);
            writeShort(var3);
            var1.offset = var13;
            let var52 = 0;
            let var53 = 0;
            let var54 = 0;
            let var55 = 0;
            let var56 = 0;
            let var57 = 0;
            let var58 = 0;
            const var59 = new Array(128).fill(0);
            var28 = 0;
            const var60 = new Array(16).fill(0);
            const var61 = new Array(16).fill(0);
            var61[9] = 128;
            var60[9] = 128;

            for (let var63 = 0; var63 < var2; ++var63) {
                writeInt(0x4d54726b); // MTrk
                const lengthPos = out.length;
                writeInt(0); // placeholder
                let var64 = out.length;
                let var65 = var64;
                let var66 = -1;

                // Safety limit for track event processing
                const maxTrackEvents = data.length * 2;
                let trackEventCount = 0;
                while (trackEventCount++ < maxTrackEvents) {
                    if (var29 >= data.length) {
                        throw new Error("Event index out of bounds");
                    }
                    const var67 = var1.readVarInt();
                    writeVarInt(var67);
                    var65 += var67;
                    const var68 = var1._data[var29++] & 255;
                    const var69 = var68 !== var66;
                    var66 = var68 & 15;
                    if (var68 === 7) {
                        if (var69) {
                            writeByte(255);
                        }

                        writeByte(47);
                        writeByte(0);
                        writeLengthInt(lengthPos, out.length - lengthPos - 4);
                        break;
                    }

                    if (var68 === 23) {
                        if (var69) {
                            writeByte(255);
                        }

                        writeByte(81);
                        writeByte(3);
                        writeByte(var1._data[var50++]);
                        writeByte(var1._data[var50++]);
                        writeByte(var1._data[var50++]);
                    } else {
                        var52 ^= var68 >> 4;
                        let var71: number;
                        let var74: number;
                        if (var66 === 0) {
                            if (var69) {
                                writeByte(var52 + 144);
                            }

                            var53 += var1._data[var37++];
                            var54 += var1._data[var38++];
                            var74 = var53 & 127;
                            var71 = var54 & 127;
                            writeByte(var74);
                            writeByte(var71);
                            if (var71 > 0) {
                                // bookkeeping skipped
                            }
                        } else if (var66 === 1) {
                            if (var69) {
                                writeByte(var52 + 128);
                            }

                            var53 += var1._data[var37++];
                            var55 += var1._data[var40++];
                            writeByte(var53 & 127);
                            writeByte(var55 & 127);
                        } else {
                            let var70: number;
                            if (var66 === 2) {
                                if (var69) {
                                    writeByte(var52 + 176);
                                }

                                var28 = (var28 + var1._data[var15++]) & 127;
                                writeByte(var28);
                                if (var28 !== 0 && var28 !== 32) {
                                    if (var28 === 1) {
                                        var70 = var1._data[var34++];
                                    } else if (var28 === 33) {
                                        var70 = var1._data[var41++];
                                    } else if (var28 === 7) {
                                        var70 = var1._data[var35++];
                                    } else if (var28 === 39) {
                                        var70 = var1._data[var42++];
                                    } else if (var28 === 10) {
                                        var70 = var1._data[var36++];
                                    } else if (var28 === 42) {
                                        var70 = var1._data[var43++];
                                    } else if (var28 === 99) {
                                        var70 = var1._data[var46++];
                                    } else if (var28 === 98) {
                                        var70 = var1._data[var47++];
                                    } else if (var28 === 101) {
                                        var70 = var1._data[var48++];
                                    } else if (var28 === 100) {
                                        var70 = var1._data[var49++];
                                    } else if (
                                        var28 !== 64 &&
                                        var28 !== 65 &&
                                        var28 !== 120 &&
                                        var28 !== 121 &&
                                        var28 !== 123
                                    ) {
                                        var70 = var1._data[var39++];
                                    } else {
                                        var70 = var1._data[var30++];
                                    }
                                } else {
                                    var70 = var1._data[var44++];
                                }

                                var74 = var70 + var59[var28];
                                var59[var28] = var74;
                                var71 = var74 & 127;
                                writeByte(var71);
                                if (var28 === 0) {
                                    var60[var52] = (var71 << 14) + (var60[var52] & -2080769);
                                }

                                if (var28 === 32) {
                                    var60[var52] = (var60[var52] & -16257) + (var71 << 7);
                                }
                            } else if (var66 === 3) {
                                if (var69) {
                                    writeByte(var52 + 224);
                                }

                                var56 += var1._data[var45++];
                                var56 += var1._data[var33++] << 7;
                                writeByte(var56 & 127);
                                writeByte((var56 >> 7) & 127);
                            } else if (var66 === 4) {
                                if (var69) {
                                    writeByte(var52 + 208);
                                }

                                var57 += var1._data[var32++];
                                writeByte(var57 & 127);
                            } else if (var66 === 5) {
                                if (var69) {
                                    writeByte(var52 + 160);
                                }

                                var53 += var1._data[var37++];
                                var58 += var1._data[var31++];
                                writeByte(var53 & 127);
                                writeByte(var58 & 127);
                            } else {
                                if (var66 !== 6) {
                                    throw new Error("Unknown event type");
                                }

                                if (var69) {
                                    writeByte(var52 + 192);
                                }

                                var70 = var1._data[var44++];
                                var61[var52] = var70 + var60[var52];
                                writeByte(var70);
                            }
                        }
                    }
                }
                if (trackEventCount >= maxTrackEvents) {
                    throw new Error("Track event limit exceeded - malformed data");
                }
            }

            return new Uint8Array(out);
        } catch (e) {
            console.warn("[MusicTrack] toMidi failed", e);
            return null;
        }
    }
}

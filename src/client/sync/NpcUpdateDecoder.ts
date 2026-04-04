import { DIRECTION_TO_ORIENTATION } from "../../shared/Direction";
import { BitStream } from "./BitStream";
import type { HealthBarUpdate, HitsplatUpdate } from "./PlayerSyncTypes";

export type NpcSpotAnimUpdate = {
    slot: number;
    id: number;
    height: number;
    delayCycles: number;
};

export type NpcSpawn = {
    npcId: number;
    typeId: number;
    tileX: number;
    tileY: number;
    level: number;
    rot: number;
    teleport: boolean;
    worldViewId: number;
};

export type NpcMovement = {
    npcId: number;
    directions: number[];
    traversals: number[];
};

export type NpcUpdateBlock = {
    faceEntity?: number;
    hitsplats?: HitsplatUpdate[];
    healthBars?: HealthBarUpdate[];
    spotAnims?: NpcSpotAnimUpdate[];
    seq?: { id: number; delay: number };
    say?: string;
    colorOverride?: {
        startCycle: number;
        endCycle: number;
        hue: number;
        sat: number;
        lum: number;
        amount: number;
    };
};

export type NpcInfoFrame = {
    spawns: NpcSpawn[];
    removals: number[];
    movements: NpcMovement[];
    updateBlocks: Map<number, NpcUpdateBlock>;
    localNpcIds: number[];
};

/**
 * Decodes the OSRS NPC update packet (`class353.updateNpcs`).
 *
 * Notes:
 * - Maintains a local NPC id list internally (like Client.npcIndices).
 * - Only decodes the subset of update blocks that our server currently emits:
 *   FACE_ENTITY (0x8), HIT_MASK (0x20), COLOR_OVERRIDE (0x100), SPOTANIM2 (0x20000), SEQUENCE (0x10).
 */
export class NpcUpdateDecoder {
    private npcIndices: number[] = [];

    reset(): void {
        this.npcIndices.length = 0;
    }

    decode(
        buffer: Uint8Array,
        opts: {
            large: boolean;
            loopCycle: number;
            clientCycle: number;
            localTileX: number;
            localTileY: number;
            level: number;
        },
    ): NpcInfoFrame {
        const stream = new BitStream(buffer);
        const removals: number[] = [];
        const spawns: NpcSpawn[] = [];
        const movements: NpcMovement[] = [];
        const updateBlocks = new Map<number, NpcUpdateBlock>();

        stream.initBitAccess();
        const count = stream.readBits(8) | 0;
        if (count < this.npcIndices.length) {
            for (let i = count; i < this.npcIndices.length; i++) {
                removals.push(this.npcIndices[i] | 0);
            }
        }
        if (count !== this.npcIndices.length) {
            // Desync detected — reset local list and let server re-add everything
            for (const id of this.npcIndices) removals.push(id | 0);
            this.npcIndices = [];
            return { spawns: [], removals, movements: [], updateBlocks: new Map(), localNpcIds: [] };
        }

        const nextIndices: number[] = [];
        const needsUpdateIds: number[] = [];

        for (let i = 0; i < count; i++) {
            const npcId = this.npcIndices[i] | 0;
            const flag = stream.readBits(1) | 0;
            if (flag === 0) {
                nextIndices.push(npcId);
                continue;
            }
            const moveType = stream.readBits(2) | 0;
            if (moveType === 0) {
                nextIndices.push(npcId);
                needsUpdateIds.push(npcId);
                continue;
            }
            if (moveType === 1) {
                nextIndices.push(npcId);
                const netDir = stream.readBits(3) | 0;
                const dir = netDir & 7;
                const needs = (stream.readBits(1) | 0) === 1;
                movements.push({
                    npcId,
                    directions: [dir],
                    traversals: [1],
                });
                if (needs) needsUpdateIds.push(npcId);
                continue;
            }
            if (moveType === 2) {
                nextIndices.push(npcId);
                const runFlag = (stream.readBits(1) | 0) === 1;
                if (runFlag) {
                    const net0 = stream.readBits(3) | 0;
                    const net1 = stream.readBits(3) | 0;
                    const d0 = net0 & 7;
                    const d1 = net1 & 7;
                    movements.push({
                        npcId,
                        directions: [d0, d1],
                        traversals: [2, 2],
                    });
                } else {
                    const net0 = stream.readBits(3) | 0;
                    const d0 = net0 & 7;
                    movements.push({
                        npcId,
                        directions: [d0],
                        traversals: [0],
                    });
                }
                const needs = (stream.readBits(1) | 0) === 1;
                if (needs) needsUpdateIds.push(npcId);
                continue;
            }
            if (moveType === 3) {
                removals.push(npcId);
                continue;
            }
        }

        // Add new NPCs.
        while (true) {
            // Server guarantees a 16-bit sentinel (65535).
            const npcId = stream.readBits(16) | 0;
            if (npcId === 0xffff) break;

            const needsUpdate = (stream.readBits(1) | 0) === 1;
            const hasExtra32 = (stream.readBits(1) | 0) === 1;
            let worldViewId = -1;
            if (hasExtra32) {
                worldViewId = stream.readBits(32) & 0xffff;
                if (worldViewId === 0) worldViewId = -1;
            }
            const teleport = (stream.readBits(1) | 0) === 1;

            const dy = opts.large
                ? ((stream.readBits(8) << 24) >> 24) | 0
                : (() => {
                      let v = stream.readBits(5) | 0;
                      if (v > 15) v -= 32;
                      return v | 0;
                  })();
            const dx = opts.large
                ? ((stream.readBits(8) << 24) >> 24) | 0
                : (() => {
                      let v = stream.readBits(5) | 0;
                      if (v > 15) v -= 32;
                      return v | 0;
                  })();

            const rotIdx = stream.readBits(3) | 0;
            const defaultRot = DIRECTION_TO_ORIENTATION[rotIdx & 7];
            const rot = (typeof defaultRot === "number" ? defaultRot : 0) & 2047;
            const typeId = stream.readBits(14) | 0;

            const tileX = (opts.localTileX | 0) + (dx | 0);
            const tileY = (opts.localTileY | 0) + (dy | 0);

            spawns.push({
                npcId,
                typeId,
                tileX,
                tileY,
                level: opts.level | 0,
                rot,
                teleport,
                worldViewId,
            });
            nextIndices.push(npcId);
            if (needsUpdate) needsUpdateIds.push(npcId);
        }

        stream.finishBitAccess();

        // Update blocks (subset, in UrlRequester.method2903 order for the bits we emit).
        for (const npcId of needsUpdateIds) {
            let mask = stream.readUnsignedByte() | 0;
            if ((mask & 0x80) !== 0) {
                mask |= (stream.readUnsignedByte() | 0) << 8;
            }
            if ((mask & 0x4000) !== 0) {
                mask |= (stream.readUnsignedByte() | 0) << 16;
            }

            const block: NpcUpdateBlock = {};

            // FACE_ENTITY (0x8)
            if ((mask & 0x8) !== 0) {
                let targetIndex = (stream.readUnsignedShortAddLE() | 0) & 0xffff;
                targetIndex |= (stream.readUnsignedByteAdd() & 0xff) << 16;
                if ((targetIndex | 0) === 0xffffff) targetIndex = -1;
                block.faceEntity = targetIndex | 0;
            }

            // HIT_MASK (0x20) (UrlRequester.method2903 semantics; differs from player HIT_MASK).
            if ((mask & 0x20) !== 0) {
                const hits: HitsplatUpdate[] = [];
                const hitCount = stream.readUnsignedByteSub() | 0;
                for (let i = 0; i < hitCount; i++) {
                    let type = stream.readUShortSmart() | 0;
                    let damage = -1;
                    let type2 = -1;
                    let damage2 = -1;
                    const raw = type | 0;
                    if (raw === 32767) {
                        type = stream.readUShortSmart() | 0;
                        damage = stream.readUShortSmart() | 0;
                        type2 = stream.readUShortSmart() | 0;
                        damage2 = stream.readUShortSmart() | 0;
                    } else if (raw !== 32766) {
                        damage = stream.readUShortSmart() | 0;
                    } else {
                        type = -1;
                    }
                    const delayCycles = stream.readUShortSmart() | 0;
                    hits.push({
                        type,
                        damage,
                        type2,
                        damage2,
                        delayCycles,
                    });
                }

                const bars: HealthBarUpdate[] = [];
                const barCount = stream.readUnsignedByteSub() | 0;
                for (let i = 0; i < barCount; i++) {
                    const id = stream.readUShortSmart() | 0;
                    const cycleOffset = stream.readUShortSmart() | 0;
                    if (cycleOffset !== 32767) {
                        // OSRS: this delay is already in client cycles (Client.cycle units).
                        const delayCycles = stream.readUShortSmart() | 0;
                        const health = stream.readUnsignedByteNeg() | 0;
                        const health2 = cycleOffset > 0 ? stream.readUnsignedByteNeg() | 0 : health;
                        bars.push({
                            id,
                            cycle: ((opts.clientCycle | 0) + delayCycles) | 0,
                            health,
                            health2,
                            cycleOffset,
                        });
                    } else {
                        bars.push({
                            id,
                            cycle: opts.clientCycle | 0,
                            health: 0,
                            health2: 0,
                            cycleOffset: 0,
                            removed: true,
                        });
                    }
                }

                if (hits.length > 0) block.hitsplats = hits;
                if (bars.length > 0) block.healthBars = bars;
            }

            // SAY (0x40) — NPC forced overhead chat
            if ((mask & 0x40) !== 0) {
                block.say = stream.readStringCp1252NullTerminated();
            }

            // COLOR_OVERRIDE (0x100)
            if ((mask & 0x100) !== 0) {
                const startCycle = ((opts.clientCycle | 0) + (stream.readUnsignedShortAdd() | 0)) | 0;
                const endCycle = ((opts.clientCycle | 0) + (stream.readUnsignedShortAdd() | 0)) | 0;
                const hue = stream.readByteNeg();
                const sat = stream.readByteSub();
                const lum = stream.readByteNeg();
                const amount = ((stream.readUnsignedByteSub() << 24) >> 24); // cast to signed byte
                block.colorOverride = { startCycle, endCycle, hue, sat, lum, amount };
            }

            // SPOT_ANIM2 list (0x20000)
            if ((mask & 0x20000) !== 0) {
                const list: NpcSpotAnimUpdate[] = [];
                const count = stream.readUnsignedByte() | 0;
                for (let i = 0; i < count; i++) {
                    const slot = stream.readUnsignedByteAdd() | 0;
                    const spotIdRaw = stream.readUnsignedShortLE() | 0;
                    const packed = stream.readUnsignedIntME() >>> 0;
                    const height = (packed >>> 16) & 0xffff;
                    const delayCycles = packed & 0xffff;
                    const spotId = spotIdRaw === 65535 ? -1 : spotIdRaw;
                    list.push({
                        slot: slot & 0xff,
                        id: spotId,
                        height: height | 0,
                        delayCycles: delayCycles | 0,
                    });
                }
                if (list.length > 0) block.spotAnims = list;
            }

            // SEQUENCE (0x10)
            if ((mask & 0x10) !== 0) {
                let seqId = stream.readUnsignedShortBE() | 0;
                if (seqId === 65535) seqId = -1;
                const delay = stream.readUnsignedByte() | 0;
                block.seq = { id: seqId | 0, delay: delay & 0xff };
            }

            if (Object.keys(block).length > 0) {
                updateBlocks.set(npcId | 0, block);
            }
        }

        this.npcIndices = nextIndices.slice(0, 255);
        return {
            spawns,
            removals,
            movements,
            updateBlocks,
            localNpcIds: this.npcIndices.slice(),
        };
    }
}

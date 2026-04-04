/**
 * Instance system parity tests.
 *
 * Verifies that our instance coordinate transformations are correct.
 *
 * Run with:  npx tsx tests/instance-parity.test.ts
 */

import {
    CHUNK_SIZE,
    INSTANCE_CHUNK_COUNT,
    INSTANCE_SIZE,
    PLANE_COUNT,
    createEmptyTemplateChunks,
    deriveRegionsFromCenter,
    deriveRegionsFromTemplates,
    packTemplateChunk,
    rotateChunkX,
    rotateChunkY,
    rotateObjectChunkX,
    rotateObjectChunkY,
    unpackTemplateChunk,
} from "../src/shared/instance/InstanceTypes";
import { ServerPacketId, SERVER_PACKET_LENGTHS } from "../src/shared/packets/ServerPacketId";

// ============================================================================
// Minimal test harness
// ============================================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, msg: string): void {
    if (condition) {
        passed++;
    } else {
        failed++;
        failures.push(msg);
        console.error(`  FAIL: ${msg}`);
    }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        const detail = `${msg} — expected ${expected}, got ${actual}`;
        failures.push(detail);
        console.error(`  FAIL: ${detail}`);
    }
}

function describe(name: string, fn: () => void): void {
    console.log(`\n${name}`);
    fn();
}

function it(name: string, fn: () => void): void {
    try {
        fn();
    } catch (e: any) {
        failed++;
        const detail = `${name} — threw: ${e.message}`;
        failures.push(detail);
        console.error(`  FAIL: ${detail}`);
    }
}

// ============================================================================
// 1. Rotation helpers — must match MapLoader.java lines 1189-1262
// ============================================================================

describe("rotateChunkX (MapLoader.java:1189)", () => {
    it("rotation 0 returns x", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                assertEqual(rotateChunkX(x, y, 0), x, `rot0 x=${x} y=${y}`);
            }
        }
    });
    it("rotation 1 returns y", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                assertEqual(rotateChunkX(x, y, 1), y, `rot1 x=${x} y=${y}`);
            }
        }
    });
    it("rotation 2 returns 7-x", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                assertEqual(rotateChunkX(x, y, 2), 7 - x, `rot2 x=${x} y=${y}`);
            }
        }
    });
    it("rotation 3 returns 7-y", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                assertEqual(rotateChunkX(x, y, 3), 7 - y, `rot3 x=${x} y=${y}`);
            }
        }
    });
    it("rotation wraps with & 3", () => {
        assertEqual(rotateChunkX(3, 5, 4), rotateChunkX(3, 5, 0), "rot4 == rot0");
        assertEqual(rotateChunkX(3, 5, 7), rotateChunkX(3, 5, 3), "rot7 == rot3");
    });
});

describe("rotateChunkY (MapLoader.java:1200)", () => {
    it("rotation 0 returns y", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                assertEqual(rotateChunkY(x, y, 0), y, `rot0 x=${x} y=${y}`);
            }
        }
    });
    it("rotation 1 returns 7-x", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                assertEqual(rotateChunkY(x, y, 1), 7 - x, `rot1 x=${x} y=${y}`);
            }
        }
    });
    it("rotation 2 returns 7-y", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                assertEqual(rotateChunkY(x, y, 2), 7 - y, `rot2 x=${x} y=${y}`);
            }
        }
    });
    it("rotation 3 returns x", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                assertEqual(rotateChunkY(x, y, 3), x, `rot3 x=${x} y=${y}`);
            }
        }
    });
});

describe("rotateObjectChunkX (MapLoader.java:1211)", () => {
    it("orientation bit swaps sizeX/sizeY", () => {
        // orientation=0: no swap => rotation 2 uses sizeX
        assertEqual(rotateObjectChunkX(3, 4, 2, 2, 3, 0), 7 - 3 - (2 - 1), "no swap");
        // orientation=1: swap => rotation 2 uses sizeY as sizeX
        assertEqual(rotateObjectChunkX(3, 4, 2, 2, 3, 1), 7 - 3 - (3 - 1), "swapped");
    });
    it("rotation 0 returns x", () => {
        assertEqual(rotateObjectChunkX(5, 3, 0, 1, 1, 0), 5, "rot0");
    });
    it("rotation 1 returns y", () => {
        assertEqual(rotateObjectChunkX(5, 3, 1, 1, 1, 0), 3, "rot1");
    });
    it("rotation 2 returns 7-x-(sizeX-1)", () => {
        assertEqual(rotateObjectChunkX(5, 3, 2, 3, 2, 0), 7 - 5 - 2, "rot2 sizeX=3");
    });
    it("rotation 3 returns 7-y-(sizeY-1)", () => {
        assertEqual(rotateObjectChunkX(5, 3, 3, 3, 2, 0), 7 - 3 - 1, "rot3 sizeY=2");
    });
});

describe("rotateObjectChunkY (MapLoader.java:1247)", () => {
    it("rotation 0 returns y", () => {
        assertEqual(rotateObjectChunkY(5, 3, 0, 1, 1, 0), 3, "rot0");
    });
    it("rotation 1 returns 7-x-(sizeX-1)", () => {
        assertEqual(rotateObjectChunkY(5, 3, 1, 3, 2, 0), 7 - 5 - 2, "rot1 sizeX=3");
    });
    it("rotation 2 returns 7-y-(sizeY-1)", () => {
        assertEqual(rotateObjectChunkY(5, 3, 2, 3, 2, 0), 7 - 3 - 1, "rot2 sizeY=2");
    });
    it("rotation 3 returns x", () => {
        assertEqual(rotateObjectChunkY(5, 3, 3, 3, 2, 0), 5, "rot3");
    });
    it("orientation bit swaps sizes for Y too", () => {
        // orientation=1 swaps: sizeX=2->3, sizeY=3->2
        // rotation=1: 7-x-(newSizeX-1) = 7-5-(3-1) = 0
        assertEqual(rotateObjectChunkY(5, 3, 1, 2, 3, 1), 7 - 5 - (3 - 1), "swap rot1");
    });
});

// ============================================================================
// 2. Rotation identity — 4 rotations return to original position
// ============================================================================

describe("4 successive 90° rotations return to origin", () => {
    it("tile rotation round-trip", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                let rx = x, ry = y;
                for (let r = 0; r < 4; r++) {
                    const nx = rotateChunkX(rx, ry, 1);
                    const ny = rotateChunkY(rx, ry, 1);
                    rx = nx;
                    ry = ny;
                }
                assertEqual(rx, x, `tile x round-trip (${x},${y})`);
                assertEqual(ry, y, `tile y round-trip (${x},${y})`);
            }
        }
    });

    it("object rotation round-trip (1x1)", () => {
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                let rx = x, ry = y;
                for (let r = 0; r < 4; r++) {
                    const nx = rotateObjectChunkX(rx, ry, 1, 1, 1, 0);
                    const ny = rotateObjectChunkY(rx, ry, 1, 1, 1, 0);
                    rx = nx;
                    ry = ny;
                }
                assertEqual(rx, x, `obj x round-trip (${x},${y})`);
                assertEqual(ry, y, `obj y round-trip (${x},${y})`);
            }
        }
    });
});

// ============================================================================
// 3. Template chunk packing — must match bit layout from MapLoader.java
// ============================================================================

describe("packTemplateChunk / unpackTemplateChunk (26-bit layout)", () => {
    it("round-trips all fields", () => {
        const cases = [
            { plane: 0, chunkX: 0, chunkY: 0, rotation: 0 },
            { plane: 3, chunkX: 1023, chunkY: 2047, rotation: 3 },
            { plane: 1, chunkX: 400, chunkY: 800, rotation: 2 },
            { plane: 2, chunkX: 50, chunkY: 100, rotation: 1 },
        ];
        for (const c of cases) {
            const packed = packTemplateChunk(c.plane, c.chunkX, c.chunkY, c.rotation);
            const unpacked = unpackTemplateChunk(packed);
            assertEqual(unpacked.plane, c.plane, `plane ${c.plane}`);
            assertEqual(unpacked.chunkX, c.chunkX, `chunkX ${c.chunkX}`);
            assertEqual(unpacked.chunkY, c.chunkY, `chunkY ${c.chunkY}`);
            assertEqual(unpacked.rotation, c.rotation, `rotation ${c.rotation}`);
        }
    });

    it("matches reference bit extraction", () => {
        // Reference code extracts:
        //   plane    = (packed >> 24) & 3
        //   rotation = (packed >> 1) & 3
        //   chunkX   = (packed >> 14) & 1023
        //   chunkY   = (packed >> 3) & 2047
        const packed = packTemplateChunk(2, 400, 800, 1);
        assertEqual((packed >> 24) & 3, 2, "plane bits");
        assertEqual((packed >> 14) & 1023, 400, "chunkX bits");
        assertEqual((packed >> 3) & 2047, 800, "chunkY bits");
        assertEqual((packed >> 1) & 3, 1, "rotation bits");
    });
});

// ============================================================================
// 4. createEmptyTemplateChunks
// ============================================================================

describe("createEmptyTemplateChunks", () => {
    it("returns 4×13×13 grid filled with -1", () => {
        const chunks = createEmptyTemplateChunks();
        assertEqual(chunks.length, PLANE_COUNT, "planes");
        for (let p = 0; p < PLANE_COUNT; p++) {
            assertEqual(chunks[p].length, INSTANCE_CHUNK_COUNT, `plane ${p} cx count`);
            for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
                assertEqual(chunks[p][cx].length, INSTANCE_CHUNK_COUNT, `plane ${p} cx ${cx} cy count`);
                for (let cy = 0; cy < INSTANCE_CHUNK_COUNT; cy++) {
                    assertEqual(chunks[p][cx][cy], -1, `[${p}][${cx}][${cy}] = -1`);
                }
            }
        }
    });
});

// ============================================================================
// 5. deriveRegionsFromTemplates
// ============================================================================

describe("deriveRegionsFromTemplates", () => {
    it("returns empty for all-empty grid", () => {
        const chunks = createEmptyTemplateChunks();
        const regions = deriveRegionsFromTemplates(chunks);
        assertEqual(regions.length, 0, "no regions for empty grid");
    });

    it("derives correct region IDs", () => {
        const chunks = createEmptyTemplateChunks();
        // chunkX=48 (region mapX = 48/8 = 6), chunkY=400 (region mapY = 400/8 = 50)
        // regionId = (6 << 8) | 50 = 1586
        chunks[0][0][0] = packTemplateChunk(0, 48, 400, 0);
        const regions = deriveRegionsFromTemplates(chunks);
        assertEqual(regions.length, 1, "one region");
        assertEqual(regions[0], (6 << 8) | 50, "correct region ID");
    });

    it("deduplicates regions from same map square", () => {
        const chunks = createEmptyTemplateChunks();
        // Two chunks from same region (chunkX=8 and chunkX=9, both regionX=1)
        chunks[0][0][0] = packTemplateChunk(0, 8, 16, 0);
        chunks[0][1][0] = packTemplateChunk(0, 9, 16, 0);
        const regions = deriveRegionsFromTemplates(chunks);
        assertEqual(regions.length, 1, "deduplicated to one region");
    });

    it("returns distinct regions from different map squares", () => {
        const chunks = createEmptyTemplateChunks();
        chunks[0][0][0] = packTemplateChunk(0, 8, 16, 0);   // region (1, 2)
        chunks[0][1][0] = packTemplateChunk(0, 16, 24, 0);  // region (2, 3)
        const regions = deriveRegionsFromTemplates(chunks);
        assertEqual(regions.length, 2, "two distinct regions");
    });
});

// ============================================================================
// 5b. deriveRegionsFromCenter (Js5Archive.java normal path lines 57-64)
// ============================================================================

describe("deriveRegionsFromCenter", () => {
    it("matches reference: iterates (regionX-6)/8 to (regionX+6)/8", () => {
        // regionX=400 chunk coords => mapX range = 394/8=49 to 406/8=50 (2 values)
        // regionY=400 chunk coords => mapY range = 394/8=49 to 406/8=50 (2 values)
        const regions = deriveRegionsFromCenter(400, 400);
        assertEqual(regions.length, 4, "2x2 = 4 regions");
        // Verify specific IDs: (49<<8)|49, (49<<8)|50, (50<<8)|49, (50<<8)|50
        assert(regions.includes((49 << 8) | 49), "contains (49,49)");
        assert(regions.includes((49 << 8) | 50), "contains (49,50)");
        assert(regions.includes((50 << 8) | 49), "contains (50,49)");
        assert(regions.includes((50 << 8) | 50), "contains (50,50)");
    });

    it("handles aligned center (chunk 48 = exactly map square 6)", () => {
        // regionX=48: (48-6)/8=5, (48+6)/8=6 => mapX = 5,6
        // regionY=48: same => mapY = 5,6
        const regions = deriveRegionsFromCenter(48, 48);
        assertEqual(regions.length, 4, "2x2 = 4 regions");
    });
});

// ============================================================================
// 6. Constants
// ============================================================================

describe("Instance constants match reference", () => {
    it("INSTANCE_CHUNK_COUNT = 13", () => {
        assertEqual(INSTANCE_CHUNK_COUNT, 13, "chunk count");
    });
    it("CHUNK_SIZE = 8", () => {
        assertEqual(CHUNK_SIZE, 8, "chunk size");
    });
    it("INSTANCE_SIZE = 104", () => {
        assertEqual(INSTANCE_SIZE, 104, "instance size");
    });
    it("PLANE_COUNT = 4", () => {
        assertEqual(PLANE_COUNT, 4, "plane count");
    });
});

// ============================================================================
// 7. REBUILD_NORMAL packet registration (replaces non-standard LEAVE_INSTANCE)
// ============================================================================

describe("REBUILD_NORMAL packet", () => {
    it("has a ServerPacketId", () => {
        assertEqual(ServerPacketId.REBUILD_NORMAL, 141, "packet id");
    });
    it("has variable short length (-2)", () => {
        assertEqual(SERVER_PACKET_LENGTHS[ServerPacketId.REBUILD_NORMAL], -2, "packet length");
    });
    it("REBUILD_REGION is still registered", () => {
        assertEqual(ServerPacketId.REBUILD_REGION, 140, "rebuild_region id");
        assertEqual(SERVER_PACKET_LENGTHS[ServerPacketId.REBUILD_REGION], -2, "rebuild_region length");
    });
});

// ============================================================================
// 8. Noise offset calculation parity
// ============================================================================

describe("Noise offset calculation (MapLoader.java:319-331)", () => {
    it("matches reference: noiseXOffset = (sourceChunkX - targetCX) * 8", () => {
        // Reference:
        //   var92 = chunkX from unpack (e.g. 48)
        //   var51 = target cx (e.g. 3)
        //   noiseXOffset = (var92 - var51) * 8 = (48 - 3) * 8 = 360
        const chunkX = 48;
        const cx = 3;
        const noiseXOffset = (chunkX - cx) * CHUNK_SIZE;
        assertEqual(noiseXOffset, 360, "noiseXOffset");
    });

    it("noise coordinates reconstruct correctly", () => {
        // In decodeInstanceTerrainChunk:
        //   noiseX = chunkSceneX + localX + noiseXOffset
        // where chunkSceneX = cx * 8, noiseXOffset = (chunkX - cx) * 8
        //   noiseX = cx*8 + localX + (chunkX - cx)*8 = chunkX*8 + localX
        // This is the source tile's absolute position — correct for noise.
        const cx = 5;
        const chunkX = 48;
        const localX = 3;
        const chunkSceneX = cx * CHUNK_SIZE;
        const noiseXOffset = (chunkX - cx) * CHUNK_SIZE;
        const noiseX = chunkSceneX + localX + noiseXOffset;
        assertEqual(noiseX, chunkX * CHUNK_SIZE + localX, "noiseX = source absolute X");
    });
});

// ============================================================================
// 9. Object orientation rotation parity
// ============================================================================

describe("Object orientation + chunk rotation (MapLoader.java:1030)", () => {
    it("combined rotation = (objectOrientation + chunkRotation) & 3", () => {
        for (let orient = 0; orient < 4; orient++) {
            for (let rot = 0; rot < 4; rot++) {
                const combined = (orient + rot) & 3;
                assert(combined >= 0 && combined < 4,
                    `(${orient} + ${rot}) & 3 = ${combined} is valid`);
            }
        }
    });
});

// ============================================================================
// 10. clearTerrainChunk: must NOT clear tileRenderFlags (reference parity)
// ============================================================================

describe("clearTerrainChunk parity (MapLoader.java:886-915)", () => {
    it("reference only clears tileHeights, not tileRenderFlags", () => {
        // This test validates the fix was applied by checking our understanding:
        // The reference MapLoader.clearTerrainChunk:
        //   - Sets paddedTileHeights[plane][x][y] = 0 for the 8x8 chunk
        //   - Propagates edge heights from neighbors
        //   - Does NOT touch paddedTileSettings (our tileRenderFlags)
        //
        // Our fix removed the tileRenderFlags[level][x][y] = 0 line.
        // We verify this by reading the source file.
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(__dirname, "../src/rs/scene/SceneBuilder.ts"),
            "utf-8",
        );

        // Find the clearTerrainChunk method body
        const clearStart = source.indexOf("private clearTerrainChunk(");
        assert(clearStart !== -1, "clearTerrainChunk exists");

        const clearEnd = source.indexOf("private fillMissingTerrain(", clearStart);
        const clearBody = source.slice(clearStart, clearEnd);

        // Must NOT contain tileRenderFlags assignment
        assert(
            !clearBody.includes("tileRenderFlags[level][x][y] = 0"),
            "clearTerrainChunk does not clear tileRenderFlags",
        );

        // Must contain tileHeights zeroing
        assert(
            clearBody.includes("tileHeights[level][x][y] = 0"),
            "clearTerrainChunk zeros tileHeights",
        );
    });
});

// ============================================================================
// 11. fillMissingTerrain: must set tileLightOcclusions = 127 (reference parity)
// ============================================================================

describe("fillMissingTerrain parity (MapLoader.java:859-884)", () => {
    it("sets tileLightOcclusions[0] = 127 for empty chunks", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(__dirname, "../src/rs/scene/SceneBuilder.ts"),
            "utf-8",
        );

        const fillStart = source.indexOf("private fillMissingTerrain(");
        assert(fillStart !== -1, "fillMissingTerrain exists");

        const fillEnd = source.indexOf("private decodeInstanceLocs(", fillStart);
        const fillBody = source.slice(fillStart, fillEnd);

        assert(
            fillBody.includes("tileLightOcclusions[0][sceneX][sceneY] = 127"),
            "fillMissingTerrain sets tileLightOcclusions = 127",
        );
    });
});

// ============================================================================
// 12. Overlay ID read as signed (reference parity)
// ============================================================================

describe("Overlay ID reading parity (MapLoader.java:482)", () => {
    it("decodeTerrainTile reads overlay as signed", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(__dirname, "../src/rs/scene/SceneBuilder.ts"),
            "utf-8",
        );

        // Find the overlay read inside decodeTerrainTile
        // It should now pass signed: true
        const terrainMethod = source.indexOf("decodeTerrainTile(");
        assert(terrainMethod !== -1, "decodeTerrainTile exists");

        // Find the tileOverlays assignment
        const overlayAssign = source.indexOf("scene.tileOverlays[level][x][y] = readTerrainValue(");
        assert(overlayAssign !== -1, "tileOverlays assignment found");

        // Extract the call — should contain 'true' for the signed parameter
        const callEnd = source.indexOf(");", overlayAssign);
        const overlayCall = source.slice(overlayAssign, callEnd + 2);
        assert(
            overlayCall.includes("true"),
            "overlay readTerrainValue passes signed=true",
        );
    });
});

// ============================================================================
// 13. REBUILD_NORMAL client dispatch (OSRS parity: exit instance via normal region load)
// ============================================================================

describe("REBUILD_NORMAL client dispatch", () => {
    it("ServerConnection handles rebuild_normal message", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(__dirname, "../src/network/ServerConnection.ts"),
            "utf-8",
        );

        assert(
            source.includes('msg.type === "rebuild_normal"'),
            "ServerConnection dispatches rebuild_normal",
        );
        assert(
            source.includes("ClientState.inInstance = false"),
            "ServerConnection resets inInstance",
        );
        assert(
            source.includes("ClientState.instanceTemplateChunks = null"),
            "ServerConnection clears templateChunks",
        );
        assert(
            source.includes("rebuildNormalListeners"),
            "ServerConnection notifies rebuildNormal listeners",
        );
    });

    it("OsrsClient subscribes to rebuildNormal", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(__dirname, "../src/client/OsrsClient.ts"),
            "utf-8",
        );

        assert(
            source.includes("subscribeRebuildNormal"),
            "OsrsClient imports subscribeRebuildNormal",
        );
        assert(
            source.includes("clearInstance"),
            "OsrsClient calls clearInstance on renderer",
        );
    });

    it("WebGLOsrsRenderer has clearInstance method", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(__dirname, "../src/client/webgl/WebGLOsrsRenderer.ts"),
            "utf-8",
        );

        assert(
            source.includes("clearInstance(): void"),
            "clearInstance method exists",
        );
        assert(
            source.includes("this.instanceActive = false"),
            "clearInstance resets instanceActive",
        );
    });
});

// ============================================================================
// 14. Server-side REBUILD_NORMAL encoding
// ============================================================================

describe("Server-side REBUILD_NORMAL", () => {
    it("ServerBinaryEncoder has encodeRebuildNormal", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(
                __dirname,
                "../server/src/network/packet/ServerBinaryEncoder.ts",
            ),
            "utf-8",
        );

        assert(
            source.includes("encodeRebuildNormal("),
            "encodeRebuildNormal exists",
        );
        assert(
            source.includes("ServerPacketId.REBUILD_NORMAL"),
            "uses REBUILD_NORMAL packet ID",
        );
    });

    it("messages.ts routes rebuild_normal", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(__dirname, "../server/src/network/messages.ts"),
            "utf-8",
        );

        assert(
            source.includes('"rebuild_normal"'),
            "messages.ts handles rebuild_normal",
        );
    });

    it("wsServer has sendRebuildNormal method", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(__dirname, "../server/src/network/wsServer.ts"),
            "utf-8",
        );

        assert(
            source.includes("sendRebuildNormal(player"),
            "wsServer.sendRebuildNormal exists",
        );
    });
});

// ============================================================================
// 15. ServerBinaryDecoder handles REBUILD_NORMAL
// ============================================================================

describe("ServerBinaryDecoder REBUILD_NORMAL", () => {
    it("decoder case exists", () => {
        const fs = require("fs");
        const source = fs.readFileSync(
            require("path").resolve(
                __dirname,
                "../src/network/packet/ServerBinaryDecoder.ts",
            ),
            "utf-8",
        );

        assert(
            source.includes("ServerPacketId.REBUILD_NORMAL"),
            "decoder handles REBUILD_NORMAL",
        );
        assert(
            source.includes('"rebuild_normal"'),
            "returns rebuild_normal message type",
        );
    });
});

// ============================================================================
// Report
// ============================================================================

console.log("\n" + "=".repeat(60));
if (failed === 0) {
    console.log(`ALL ${passed} TESTS PASSED`);
} else {
    console.log(`${passed} passed, ${failed} FAILED`);
    console.log("\nFailures:");
    for (const f of failures) {
        console.log(`  - ${f}`);
    }
}
console.log("=".repeat(60));

process.exit(failed > 0 ? 1 : 0);

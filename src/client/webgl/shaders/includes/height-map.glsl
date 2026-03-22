const int sceneBorderSize = 6;
const int tileSize = 128;
const int tileSizeShift = 7;

int getTileHeight(int x, int z, uint plane) {
    return texelFetch(u_heightMap, ivec3(sceneBorderSize + x, sceneBorderSize + z, plane), 0).r * 8;
}

// Height interpolation that matches the terrain mesh surface.
//
// The terrain is triangulated per-tile along one of two diagonals depending
// on tile shape/rotation. Since that data isn't available in the shader we
// compute the height for BOTH possible diagonal splits and take the maximum.
// This guarantees objects sit at or above the rendered terrain surface
// regardless of the actual diagonal — a small upward bias on mismatched
// tiles is far less noticeable than clipping underground.
float getHeightInterp(vec2 pos, uint plane) {
    ivec2 ipos = ivec2(pos);
    int tileX = ipos.x >> tileSizeShift;
    int tileZ = ipos.y >> tileSizeShift;
    int offsetX = ipos.x & (tileSize - 1);
    int offsetZ = ipos.y & (tileSize - 1);
    int hSW = getTileHeight(tileX, tileZ, plane);
    int hSE = getTileHeight(tileX + 1, tileZ, plane);
    int hNW = getTileHeight(tileX, tileZ + 1, plane);
    int hNE = getTileHeight(tileX + 1, tileZ + 1, plane);

    // SE-NW diagonal (offsetX + offsetZ = 128)
    int h0;
    if (offsetX + offsetZ <= tileSize) {
        h0 = (hSW * tileSize + (hSE - hSW) * offsetX + (hNW - hSW) * offsetZ) >> tileSizeShift;
    } else {
        int rx = tileSize - offsetX;
        int rz = tileSize - offsetZ;
        h0 = (hNE * tileSize + (hNW - hNE) * rx + (hSE - hNE) * rz) >> tileSizeShift;
    }

    // SW-NE diagonal (offsetX = offsetZ)
    int h1;
    if (offsetX <= offsetZ) {
        h1 = (hSW * tileSize + (hNW - hSW) * offsetZ + (hNE - hNW) * offsetX) >> tileSizeShift;
    } else {
        h1 = (hSW * tileSize + (hSE - hSW) * offsetX + (hNE - hSE) * offsetZ) >> tileSizeShift;
    }

    return float(max(h0, h1));
}

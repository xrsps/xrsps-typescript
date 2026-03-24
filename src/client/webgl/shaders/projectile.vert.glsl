#version 300 es

#include "./includes/multi-draw.glsl";

#define TEXTURE_ANIM_UNIT (1.0f / 128.0f)

#define PI  3.141592653589793238462643383279
#define TAU 6.283185307179586476925286766559
// TAU / 2048.0
#define RS_TO_RADIANS 0.00306796157

#define FOG_CORNER_ROUNDING 8.0

precision highp float;

layout(std140, column_major) uniform;

uniform highp isampler2D u_textureMaterials;

#include "./includes/scene-uniforms.glsl";

// Per map square
uniform vec2 u_mapPos;
uniform float u_timeLoaded;

uniform int u_npcDataOffset;

uniform highp usampler2D u_npcDataTexture;
uniform mediump isampler2DArray u_heightMap;
uniform float u_modelYOffset;
uniform vec2 u_projectileSubOffset;

layout(location = 0) in uvec3 a_vertex;

out vec4 v_color;
out vec2 v_texCoord;
flat out uint v_texId;
flat out float v_alphaCutOff;
out float v_fogAmount;
flat out float v_plane;

#include "./includes/branchless-logic.glsl";
#include "./includes/hsl-to-rgb.glsl";
#include "./includes/unpack-float.glsl";
#include "./includes/fog.glsl";

#include "./includes/material.glsl";
#include "./includes/height-map.glsl";

#include "./includes/vertex.glsl";

struct ProjectileInfo {
    vec2 tilePos;
    uint plane;
    uint yaw;
    uint pitch;
    uint roll;
};

ivec2 getDataTexCoordFromIndex(int index) {
    return ivec2(index % 16, index / 16);
}

float decodeSignedU16(uint value) {
    return float((value & 0x8000u) != 0u ? int(value) - 65536 : int(value));
}

ProjectileInfo decodeProjectileInfo(int offset) {
    int baseTexel = (offset + gl_InstanceID) * 2;
    uvec4 data = texelFetch(u_npcDataTexture, getDataTexCoordFromIndex(baseTexel), 0);

    ProjectileInfo info;

    info.tilePos = vec2(decodeSignedU16(data.r), decodeSignedU16(data.g));
    info.plane = data.b & 0x3u;
    info.yaw = (data.b >> 2) & 0x7ffu; // Bits 2-12 contain yaw (0-2047)

    // Extract pitch packed across data.b[13:15] (high 3 bits) and data.a[9:12] (low 4 bits)
    uint pitchHi = (data.b >> 13) & 0x7u;
    uint pitchLo = (data.a >> 9) & 0xfu;
    uint pitchPacked = (pitchHi << 4) | pitchLo;
    info.pitch = pitchPacked << 4; // Restore to 11-bit range with 16-unit precision (7 bits -> 11 bits)

    // Extract roll from data.a[13:15] (3 bits)
    uint rollPacked = (data.a >> 13) & 0x7u;
    info.roll = rollPacked << 8; // Restore to 11-bit range with 256-unit precision (3 bits -> 11 bits)

    return info;
}

mat4 rotationX(in float angle) {
    return mat4(       1.0,          0.0,               0.0,    0.0,
                       0.0,  cos(angle),       -sin(angle),    0.0,
                       0.0,  sin(angle),        cos(angle),    0.0,
                       0.0,          0.0,               0.0,    1.0);
}

mat4 rotationY(in float angle) {
    return mat4(cos(angle),        0.0,        sin(angle),    0.0,
                         0.0,      1.0,               0.0,    0.0,
               -sin(angle),        0.0,        cos(angle),    0.0,
                         0.0,      0.0,               0.0,    1.0);
}

mat4 rotationZ(in float angle) {
    return mat4(cos(angle),  -sin(angle),        0.0,    0.0,
                sin(angle),   cos(angle),        0.0,    0.0,
                       0.0,          0.0,        1.0,    0.0,
                       0.0,          0.0,        0.0,    1.0);
}

void main() {
    Vertex vertex = decodeVertex(a_vertex.x, a_vertex.y, a_vertex.z, u_brightness, vec4(-1, -1, -1, 0));

    v_color = vertex.color;

    Material material = getMaterial(vertex.textureId);
    vec2 textureAnimation = vec2(material.animU, material.animV);

    if (u_isNewTextureAnim > 0.5) {
        v_texCoord = vertex.texCoord + mod(mod(u_currentTime, 128.0) * textureAnimation / 64.0, 1.0);
    } else {
        v_texCoord = vertex.texCoord + (u_currentTime / 0.02) * textureAnimation * TEXTURE_ANIM_UNIT;
    }
    v_texId = vertex.textureId;
    v_alphaCutOff = material.alphaCutOff;

    ProjectileInfo projInfo = decodeProjectileInfo(getDrawId() + u_npcDataOffset);

    vec2 tilePos = projInfo.tilePos + u_projectileSubOffset;

    // Apply rotations: roll (around forward), pitch (tilt up/down), yaw (face travel direction)
    // Row-vector convention (v * M): apply local-space order left-to-right.
    float yawAngle = float(projInfo.yaw) * RS_TO_RADIANS;
    float pitchAngle = float(projInfo.pitch) * RS_TO_RADIANS;
    float rollAngle = float(projInfo.roll) * RS_TO_RADIANS;

    vec4 localPos = vec4(vertex.pos, 1.0);
    localPos = localPos * rotationZ(rollAngle) * rotationX(pitchAngle) * rotationY(yawAngle);
    localPos += vec4(tilePos.x, 0.0, tilePos.y, 0.0);

    // OSRS parity: projectiles are grounded against the height map in the shader,
    // same as NPCs/players, then a ground-relative vertical offset is applied.
    localPos.y -= getHeightInterp(tilePos, projInfo.plane);

    // Apply CPU-provided ground-relative offset only.
    // Follow NPC/GFX convention: negative u_modelYOffset raises the model.
    localPos.y -= u_modelYOffset;

    localPos /= vec4(vec3(128.0), 1.0);
    localPos += vec4(vec3(u_mapPos.x, 0.0, u_mapPos.y) * vec3(64.0), 0.0);

    float loadAlpha = smoothstep(0.0, 1.0, min((u_currentTime - u_timeLoaded), 1.0));
    float isLoading = when_neq(loadAlpha, 1.0);

    vec2 playerOffset = vec2(localPos.x - u_playerPos.x, localPos.z - u_playerPos.y);
    float dist = length(playerOffset);

    v_fogAmount = fogFactorOSRS(dist);
    v_fogAmount = isLoading * max(1.0 - loadAlpha, v_fogAmount) +
        (1.0 - isLoading) * v_fogAmount;

    vec4 viewPos = u_viewMatrix * localPos;
    gl_Position = u_projectionMatrix * viewPos;
    v_plane = float(projInfo.plane);
}

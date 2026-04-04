#version 300 es

#include "./includes/multi-draw.glsl";

#define TEXTURE_ANIM_UNIT (1.0f / 128.0f)

#define PI  3.141592653589793238462643383279
#define TAU 6.283185307179586476925286766559
// TAU / 2048.0
#define RS_TO_RADIANS 0.00306796157

#define FOG_CORNER_ROUNDING 8.0

#define NPC_INTERACT_TYPE 3.0

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
uniform mat4 u_worldEntityTransform;

layout(location = 0) in uvec3 a_vertex;

out vec4 v_color;
out vec2 v_texCoord;
flat out uint v_texId;
flat out float v_alphaCutOff;
out float v_fogAmount;
flat out float v_plane;
flat out uint v_priority;

#include "./includes/branchless-logic.glsl";
#include "./includes/hsl-to-rgb.glsl";
#include "./includes/unpack-float.glsl";
#include "./includes/fog.glsl";

#include "./includes/material.glsl";
#include "./includes/height-map.glsl";

#include "./includes/vertex.glsl";

struct PlayerInfo {
    vec2 tilePos;
    uint plane;
    uint rotation;
    vec4 hslOverride; // per-actor HSL override (hue, sat, lum, amount)
};

ivec2 getDataTexCoordFromIndex(int index) {
    return ivec2(index % 16, index / 16);
}

float decodeSignedU16(uint value) {
    return float((value & 0x8000u) != 0u ? int(value) - 65536 : int(value));
}

PlayerInfo decodePlayerInfo(int offset) {
    int baseTexel = (offset + gl_InstanceID) * 2;
    uvec4 data = texelFetch(u_npcDataTexture, getDataTexCoordFromIndex(baseTexel), 0);
    uvec4 data1 = texelFetch(u_npcDataTexture, getDataTexCoordFromIndex(baseTexel + 1), 0);

    PlayerInfo info;

    info.tilePos = vec2(decodeSignedU16(data.r), decodeSignedU16(data.g));
    info.plane = data.b & 0x3u;
    info.rotation = data.b >> 2;

    // Unpack per-actor HSL override from 2nd texel
    // R: hue(7) | sat(7) << 7,  G: lum(7) | amount(8) << 7
    info.hslOverride = vec4(
        float(int(data1.r) & 0x7F),           // hue (0-127, -1 encoded as 127)
        float((int(data1.r) >> 7) & 0x7F),    // sat (0-127)
        float(int(data1.g) & 0x7F),           // lum (0-127)
        float((int(data1.g) >> 7) & 0xFF)     // amount (0-255)
    );

    return info;
}

mat4 rotationY( in float angle ) {
    return mat4(cos(angle),		0,		sin(angle),	0,
                         0,		1.0,			 0,	0,
                -sin(angle),	0,		cos(angle),	0,
                        0, 		0,				0,	1);
}

void main() {
    PlayerInfo playerInfo = decodePlayerInfo(getDrawId() + u_npcDataOffset);
    Vertex vertex = decodeVertex(a_vertex.x, a_vertex.y, a_vertex.z, u_brightness, playerInfo.hslOverride);

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

    vec4 localPos = vec4(vertex.pos, 1.0) * rotationY(float(playerInfo.rotation) * RS_TO_RADIANS) + vec4(playerInfo.tilePos.x, 0, playerInfo.tilePos.y, 0.0);

    localPos.y -= getHeightInterp(playerInfo.tilePos, playerInfo.plane);
    localPos.y += u_modelYOffset;

    localPos /= vec4(vec3(128.0), 1.0);

    localPos += vec4(vec3(u_mapPos.x, 0, u_mapPos.y) * vec3(64), 0);

    float loadAlpha = smoothstep(0.0, 1.0, min((u_currentTime - u_timeLoaded), 1.0));
    float isLoading = when_neq(loadAlpha, 1.0);

    // Calculate radial distance from player for proper OSRS-style fog
    vec2 playerOffset = vec2(localPos.x - u_playerPos.x, localPos.z - u_playerPos.y);
    float dist = length(playerOffset);

    v_fogAmount = fogFactorOSRS(dist);
    v_fogAmount = isLoading * max(1.0 - loadAlpha, v_fogAmount) +
        (1.0 - isLoading) * v_fogAmount;

    // Transform to view space
    vec4 viewPos = u_worldEntityTransform * (u_viewMatrix * localPos);

    // Apply a small view-space depth offset for non-zero priorities.
    // Higher priority = slightly closer to the camera.
    if (vertex.priority > 0u) {
        const float PRIORITY_LAYER_EPSILON = 0.01; // tune relative to near/far and scale
        float layer = float(vertex.priority & 0x7u);
        // Camera looks down -Z in view space; decreasing z moves closer to camera
        viewPos.z += layer * PRIORITY_LAYER_EPSILON;
    }

    gl_Position = u_projectionMatrix * viewPos;
    v_plane = float(playerInfo.plane);
    v_priority = vertex.priority;
}

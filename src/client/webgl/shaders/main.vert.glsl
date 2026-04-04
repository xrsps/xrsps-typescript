#version 300 es

#include "./includes/multi-draw.glsl";

#define TEXTURE_ANIM_UNIT (1.0f / 128.0f)

#define CONTOUR_GROUND_CENTER_TILE 0.0
#define CONTOUR_GROUND_VERTEX 1.0
#define CONTOUR_GROUND_NONE 2.0
#define FOG_CORNER_ROUNDING 8.0

precision highp float;

layout(std140, column_major) uniform;

uniform highp isampler2D u_textureMaterials;

#include "./includes/scene-uniforms.glsl";

// Per map square
uniform int u_drawIdOffset;

uniform vec2 u_mapPos;
uniform float u_timeLoaded;
uniform float u_roofPlaneLimit;
uniform mat4 u_worldEntityTransform;


uniform highp usampler2D u_modelInfoTexture;
uniform mediump isampler2DArray u_heightMap;

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

struct ModelInfo {
    vec2 tilePos;
    uint height;
    uint plane;
    uint planeCullLevel;
    uint priority;
    float contourGround;
};

ivec2 getDataTexCoordFromIndex(int index) {
    return ivec2(index % 16, index / 16);
}

ModelInfo decodeModelInfo(int offset) {
    uvec4 data = texelFetch(u_modelInfoTexture, getDataTexCoordFromIndex(offset + gl_InstanceID), 0);

    ModelInfo info;

    info.tilePos = vec2(float(data.r & 0x3FFFu), float(data.g & 0x3FFFu));
    info.height = (data.b >> 8) * 8u;
    info.plane = data.r >> 14;
    info.planeCullLevel = (data.b >> 6) & 0x3u;
    info.priority = data.b & 0x7u;
    info.contourGround = float((data.g >> 14) & 0x3u);

    return info;
}

void main() {
    int offset = int(texelFetch(u_modelInfoTexture, getDataTexCoordFromIndex(getDrawId() + u_drawIdOffset), 0).r);

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

    ModelInfo modelInfo = decodeModelInfo(offset);

    // Roof culling: use planeCullLevel for culling decision, not plane
    // planeCullLevel accounts for force-level-0 flags and bridge adjustments
    if (float(modelInfo.planeCullLevel) > u_roofPlaneLimit + 0.5) {
        v_color = vec4(0.0);
        v_texCoord = vec2(0.0);
        v_texId = 0u;
        v_alphaCutOff = 1.0;
        v_fogAmount = 1.0;
        v_plane = float(modelInfo.plane);
        gl_Position = vec4(0.0);
        return;
    }

    vec3 localPos = vertex.pos + vec3(modelInfo.tilePos.x, 0, modelInfo.tilePos.y);

    vec2 interpPos = modelInfo.tilePos * vec2(when_eq(modelInfo.contourGround, CONTOUR_GROUND_CENTER_TILE))
            + localPos.xz * vec2(when_eq(modelInfo.contourGround, CONTOUR_GROUND_VERTEX));
    localPos.y -= float(modelInfo.height);
    localPos.y -= getHeightInterp(interpPos, modelInfo.plane) * when_neq(modelInfo.contourGround, CONTOUR_GROUND_NONE);

    localPos /= 128.0;

    localPos += vec3(u_mapPos.x, 0, u_mapPos.y) * vec3(64);

    float loadAlpha = smoothstep(0.0, 1.0, min((u_currentTime - u_timeLoaded), 1.0));
    float isLoading = when_neq(loadAlpha, 1.0);

    // Calculate radial distance from player for proper OSRS-style fog
    vec2 playerOffset = vec2(localPos.x - u_playerPos.x, localPos.z - u_playerPos.y);
    float dist = length(playerOffset);

    v_fogAmount = fogFactorOSRS(dist);
    v_fogAmount = isLoading * max(1.0 - loadAlpha, v_fogAmount) +
        (1.0 - isLoading) * v_fogAmount;

    // World entity bobbing: applied in view/camera space, matching OSRS where
    // Scene_cameraPitchSine is multiplied after the camera transform in drawInternal.
    vec4 viewPos = u_worldEntityTransform * (u_viewMatrix * vec4(localPos, 1.0));

    // Small, view-space epsilons (tune gently if needed)
    const float PLANE_LAYER_EPSILON     = 0.001;   // plane/level separation
    const float PRIORITY_LAYER_EPSILON  = 0.001;  // per-model (instance) overlay ordering
    const float FACE_PRIORITY_EPSILON   = 0.001; // per-face ordering (finer than model)

    // If camera looks along -Z, closer = more negative Z.
    // Planes: keep small separation; priority handles overlays.
    viewPos.z += float(modelInfo.plane) * PLANE_LAYER_EPSILON;

    // Priority 0..7: larger = closer (e.g., carpets/decals above floors)
    // Coarse per-model bias
    uint mp = modelInfo.priority & 0x7u;
    if (mp > 0u) {
        viewPos.z += float(mp) * PRIORITY_LAYER_EPSILON;
    }
    // Fine per-face bias carried in the vertex (used by locs, including carpet details)
    uint fp = vertex.priority & 0x7u;
    if (fp > 0u) {
        viewPos.z += float(fp) * FACE_PRIORITY_EPSILON;
    }

    gl_Position = u_projectionMatrix * viewPos;
    v_plane = float(modelInfo.plane);
}

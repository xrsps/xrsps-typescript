#version 300 es

precision highp float;

layout(std140, column_major) uniform;

#include "./includes/scene-uniforms.glsl";

uniform highp sampler2DArray u_textures;
uniform highp isampler2D u_textureMaterials;

#include "./includes/material.glsl";

in vec4 v_color;
in vec2 v_texCoord;
flat in uint v_texId;
flat in float v_alphaCutOff;
in float v_fogAmount;
flat in float v_plane;

layout(location = 0) out vec4 fragColor;

void main() {
    // Sample base texture first for early alpha discard
    vec4 textureColor = texture(u_textures, vec3(v_texCoord, v_texId), -2.0).bgra;
    float alpha = textureColor.a * v_color.a;

#ifdef DISCARD_ALPHA
    // Early discard before expensive operations
    if ((v_texId == 0u && alpha < 0.01) || (textureColor.a < v_alphaCutOff)) {
        discard;
    }
#endif

    // Only fetch material and do animation if texture is animated
    Material mat = getMaterial(v_texId);
    int frameCount = max(mat.frameCount, 1);
    if (frameCount > 1) {
        float frameSpeed = float(max(mat.animSpeed, 1));
        float frameT = mod(u_currentTime * frameSpeed, float(frameCount));
        float frame0 = floor(frameT);
        float frame1 = mod(frame0 + 1.0, float(frameCount));
        float tMix = fract(frameT);
        vec4 tex0 = texture(u_textures, vec3(v_texCoord, float(v_texId) + frame0), -2.0).bgra;
        vec4 tex1 = texture(u_textures, vec3(v_texCoord, float(v_texId) + frame1), -2.0).bgra;
        textureColor = mix(tex0, tex1, tMix);
        alpha = textureColor.a * v_color.a;
    }

    float banding = max(u_colorBanding, 1.0);
    vec3 paletteColor = round(v_color.rgb * banding) / banding;
    vec3 surface = textureColor.rgb * paletteColor * u_brightness;

    float fog = clamp(v_fogAmount, 0.0, 1.0);
    fog = smoothstep(0.0, 1.0, fog);

    vec3 finalRgb = mix(surface, u_skyColor.rgb, fog);

    fragColor = vec4(clamp(finalRgb, 0.0, 1.0), alpha);
}

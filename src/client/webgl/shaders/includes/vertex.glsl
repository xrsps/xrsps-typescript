struct Vertex {
    vec3 pos;
    vec4 color;
    vec2 texCoord;
    uint textureId;
    uint priority;
};

// HSL color override matching OSRS AbstractRasterizer.applyHslOverride.
// Used for both scene-level (Scene_cameraY) and per-actor (Actor.colorOverride) tinting.
// override: vec4(hue, sat, lum, amount) — hue/sat/lum use -1 for "no override".
// Reference: AbstractRasterizer.java lines 175-193
int applyHslOverride(int hsl, vec4 override) {
    if (override.w <= 0.0) return hsl;

    int hue = (hsl >> 10) & 63;
    int sat = (hsl >> 7) & 7;
    int lum = hsl & 127;
    int iAmount = int(override.w);

    if (override.x >= 0.0) {
        hue += (iAmount * (int(override.x) - hue)) >> 7;
    }
    if (override.y >= 0.0) {
        sat += (iAmount * (int(override.y) - sat)) >> 7;
    }
    if (override.z >= 0.0) {
        lum += (iAmount * (int(override.z) - lum)) >> 7;
    }

    return (hue << 10) | (sat << 7) | lum;
}

// Decode a vertex from packed data.
// actorHslOverride: per-actor HSL override (poison/freeze/venom tint).
//   Pass vec4(-1, -1, -1, 0) for non-actor geometry (tiles, locs).
// OSRS order: actor override first, then scene override, then hslToRgb.
Vertex decodeVertex(uint v0, uint v1, uint v2, float brightness, vec4 actorHslOverride) {
    float x = float(int((v0 >> 17u) & 0x7FFFu) - 0x4000);
    // uPacked: low 6 bits from v0, high 5 bits from v2[4:0]
    float u = unpackFloat11(((v0 >> 11u) & 0x3Fu) | ((v2 & 0x1Fu) << 6u));
    float v = unpackFloat11(v0 & 0x7FFu);

    float y = -float(int((v1) & 0x7FFFu) - 0x4000);
    int hsl = int((v1 >> 15u) & 0xFFFFu);
    float isTextured = float((v1 >> 31) & 0x1u);
    float textureId = float(((hsl >> 7) | int(((v2 >> 5u) & 0x1u) << 9u)) + 1) * isTextured;

    // Apply per-actor HSL override (poison/freeze/venom tint) before scene override.
    // Reference: Actor.colorOverride applied at model level before scene rasterization
    hsl = applyHslOverride(hsl, actorHslOverride);

    // Apply scene-level HSL override (Scene_cameraY / RasterizerClip.colorOverride)
    hsl = applyHslOverride(hsl, u_sceneHslOverride);

    float z = float(int((v2 >> 17u) & 0x7FFFu) - 0x4000);
    float alpha = float((v2 >> 9u) & 0xFFu) / 255.0;
    uint priority = (v2 >> 6u) & 0x7u;

    vec4 color = when_eq(textureId, 0.0) * vec4(hslToRgb(hsl, brightness), alpha)
        + when_neq(textureId, 0.0) * vec4(vec3(float(hsl & 0x7F) / 127.0), alpha);

    return Vertex(vec3(x, y, z), color, vec2(u, v), uint(textureId), priority);
}

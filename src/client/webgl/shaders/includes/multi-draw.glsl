#ifdef MULTI_DRAW
#extension GL_ANGLE_multi_draw : require
#endif

// Remap texture for indirect draw ID lookup
uniform highp isampler2D u_drawIdRemap;
uniform bool u_useDrawIdRemap;
// Override for single-range draws where gl_DrawID is always 0
uniform int u_drawIdOverride;

int getDrawId() {
#ifdef MULTI_DRAW
    if (u_useDrawIdRemap) {
        // Multi-draw with filtering: look up remapped ID
        ivec2 remapCoord = ivec2(gl_DrawID % 16, gl_DrawID / 16);
        return texelFetch(u_drawIdRemap, remapCoord, 0).r;
    }
#endif

    if (u_drawIdOverride >= 0) {
        // Single-range draw with explicit override (PlayerRenderer per-player draws)
        return u_drawIdOverride;
    }

#ifdef MULTI_DRAW
    {
        // True multi-draw without filtering: use gl_DrawID directly
        return gl_DrawID;
    }
#else
    return 0;
#endif
}

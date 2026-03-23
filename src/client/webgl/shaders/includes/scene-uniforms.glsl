// Per frame
uniform SceneUniforms {
    mat4 u_viewProjMatrix;
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    vec4 u_skyColor;
    // Scene-level HSL override (matches OSRS HslOverride / Scene.Scene_cameraY).
    // x = overrideHue   (-1.0 = no override, else 0-63)
    // y = overrideSat   (-1.0 = no override, else 0-7)
    // z = overrideLum   (-1.0 = no override, else 0-127)
    // w = overrideAmount (0-255, 0 = disabled)
    vec4 u_sceneHslOverride;
    vec2 u_cameraPos;
    vec2 u_playerPos;
    float u_renderDistance;
    float u_fogDepth;
    float u_currentTime;
    float u_brightness;
    float u_colorBanding;
    float u_isNewTextureAnim;
};

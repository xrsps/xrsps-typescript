import { createGL, createProgram } from "./gl-utils";

type Texture = { tex: WebGLTexture; w: number; h: number };

export class GLRenderer {
    gl: WebGL2RenderingContext;
    canvas: HTMLCanvasElement;
    // Programs
    progTex!: WebGLProgram;
    progSolid!: WebGLProgram;
    progGrad!: WebGLProgram; // Vertical gradient program
    progMasked!: WebGLProgram; // Masked texture program (for compass)
    // Locations
    aPos_tex = -1;
    aUV_tex = -1;
    uProj_tex!: WebGLUniformLocation;
    uSampler_tex!: WebGLUniformLocation;
    uTintColor_tex!: WebGLUniformLocation;
    uTintStrength_tex!: WebGLUniformLocation;
    uAlpha_tex!: WebGLUniformLocation;
    aPos_col = -1;
    aColor_col = -1;
    uProj_col!: WebGLUniformLocation;
    // Gradient uniforms
    uProj_grad!: WebGLUniformLocation;
    uColorTop_grad!: WebGLUniformLocation;
    uColorBot_grad!: WebGLUniformLocation;
    vaoGrad!: WebGLVertexArrayObject;
    // Masked texture uniforms
    uProj_masked!: WebGLUniformLocation;
    uContent_masked!: WebGLUniformLocation;
    uMask_masked!: WebGLUniformLocation;
    uMaskBounds_masked!: WebGLUniformLocation;
    // Buffers
    vbo!: WebGLBuffer;
    ibo!: WebGLBuffer;
    vaoTex!: WebGLVertexArrayObject;
    vaoCol!: WebGLVertexArrayObject;
    // State
    width = 1;
    height = 1;
    proj = new Float32Array(16);
    // Simple texture cache (key: string)
    textures = new Map<string, Texture>();
    // PERF: Cached arrays to avoid per-call allocations
    private rectVerts = new Float32Array(8); // 4 vertices × 2 coords
    private gradVerts = new Float32Array(12); // 4 vertices × 3 floats (x, y, t)
    private texVerts = new Float32Array(16); // 4 vertices × 4 floats (x, y, u, v)
    private rotatedVerts = new Float32Array(16); // 4 vertices × 4 floats (x, y, u, v)
    private maskedVerts = new Float32Array(16); // 4 vertices × 4 floats (x, y, u, v)
    private perfDrawCalls = 0;
    private perfTextureDrawCalls = 0;
    private perfSolidDrawCalls = 0;
    private perfGradientDrawCalls = 0;
    private perfMaskedDrawCalls = 0;
    private static readonly SOLID_BATCH_RECT_CAPACITY = 2048;
    private solidBatchData = new Float32Array(GLRenderer.SOLID_BATCH_RECT_CAPACITY * 36);
    private solidBatchFloatCount = 0;
    private textureBatchData = new Float32Array(16 * 256);
    private textureBatchTriangleData = new Float32Array(24 * 256);
    private textureBatchQuadCount = 0;
    private textureBatchTex: Texture | null = null;
    private textureBatchTintStrength = 0;
    private textureBatchTintColor: [number, number, number] = [0, 0, 0];
    private textureBatchAlpha = 1;

    constructor(canvas: HTMLCanvasElement) {
        const gl = createGL(canvas);
        if (!gl) throw new Error("WebGL2 not available");
        this.gl = gl;
        this.canvas = canvas;
        this.init();
    }

    init() {
        const gl = this.gl;
        // Programs
        const vsTex = `#version 300 es\nprecision mediump float;\nlayout(location=0) in vec2 aPos; layout(location=1) in vec2 aUV; uniform mat4 uProj; out vec2 vUV; void main(){ vUV=aUV; gl_Position=uProj*vec4(aPos,0.0,1.0);} `;
        const fsTex = `#version 300 es\nprecision mediump float; in vec2 vUV; uniform sampler2D uSampler; uniform vec3 uTintColor; uniform float uTintStrength; uniform float uAlpha; out vec4 o; void main(){ vec4 c = texture(uSampler, vUV); c.rgb = mix(c.rgb, uTintColor, clamp(uTintStrength, 0.0, 1.0)); c.a *= uAlpha; o = c; }`;
        const vsCol = `#version 300 es
precision mediump float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aColor;
uniform mat4 uProj;
out vec4 vColor;
void main(){
    vColor = aColor;
    gl_Position=uProj*vec4(aPos,0.0,1.0);
}`;
        const fsCol = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 o;
void main(){ o = vColor; }`;
        // OSRS PARITY: Vertical gradient shader for fillMode=1 (GRADIENT_VERTICAL)
        // Reference: Rasterizer2D.Rasterizer2D_fillRectangleGradient
        const vsGrad = `#version 300 es\nprecision mediump float; layout(location=0) in vec2 aPos; layout(location=1) in float aT; uniform mat4 uProj; out float vT; void main(){ vT=aT; gl_Position=uProj*vec4(aPos,0.0,1.0);} `;
        const fsGrad = `#version 300 es\nprecision mediump float; in float vT; uniform vec4 uColorTop; uniform vec4 uColorBot; out vec4 o; void main(){ o = mix(uColorTop, uColorBot, vT); }`;
        // OSRS PARITY: Masked texture shader for compass (contentType 1339)
        // Reference: SpritePixels.drawRotatedMaskedCenteredAround
        // Content is sampled with rotated UVs, mask is sampled based on screen position
        const vsMasked = `#version 300 es
precision mediump float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aContentUV;
uniform mat4 uProj;
uniform vec4 uMaskBounds; // x, y, width, height in screen coords
out vec2 vContentUV;
out vec2 vScreenPos;
void main(){
    vContentUV = aContentUV;
    vScreenPos = aPos;
    gl_Position = uProj * vec4(aPos, 0.0, 1.0);
}`;
        const fsMasked = `#version 300 es
precision mediump float;
in vec2 vContentUV;
in vec2 vScreenPos;
uniform sampler2D uContent;
uniform sampler2D uMask;
uniform vec4 uMaskBounds; // x, y, width, height
out vec4 o;
void main(){
    vec4 content = texture(uContent, vContentUV);
    // Compute mask UV from screen position (axis-aligned to widget bounds)
    vec2 maskUV = (vScreenPos - uMaskBounds.xy) / uMaskBounds.zw;
    // Clamp to valid UV range and discard if outside
    if (maskUV.x < 0.0 || maskUV.x > 1.0 || maskUV.y < 0.0 || maskUV.y > 1.0) {
        discard;
    }
    vec4 mask = texture(uMask, maskUV);
    // OSRS mask sprite 1179 is the orb FRAME - opaque where the frame is,
    // transparent in the center hole where compass should show through
    // So we INVERT: show content where mask is TRANSPARENT, hide where OPAQUE
    if (mask.a > 0.5) discard;
    // Show content with its alpha
    o = content;
}`;
        this.progTex = createProgram(gl, vsTex, fsTex);
        this.progSolid = createProgram(gl, vsCol, fsCol);
        this.progGrad = createProgram(gl, vsGrad, fsGrad);
        this.progMasked = createProgram(gl, vsMasked, fsMasked);
        this.uProj_tex = gl.getUniformLocation(this.progTex, "uProj")!;
        this.uSampler_tex = gl.getUniformLocation(this.progTex, "uSampler")!;
        this.uTintColor_tex = gl.getUniformLocation(this.progTex, "uTintColor")!;
        this.uTintStrength_tex = gl.getUniformLocation(this.progTex, "uTintStrength")!;
        this.uAlpha_tex = gl.getUniformLocation(this.progTex, "uAlpha")!;
        this.uProj_col = gl.getUniformLocation(this.progSolid, "uProj")!;
        // Gradient program uniforms
        this.uProj_grad = gl.getUniformLocation(this.progGrad, "uProj")!;
        this.uColorTop_grad = gl.getUniformLocation(this.progGrad, "uColorTop")!;
        this.uColorBot_grad = gl.getUniformLocation(this.progGrad, "uColorBot")!;
        // Masked texture program uniforms
        this.uProj_masked = gl.getUniformLocation(this.progMasked, "uProj")!;
        this.uContent_masked = gl.getUniformLocation(this.progMasked, "uContent")!;
        this.uMask_masked = gl.getUniformLocation(this.progMasked, "uMask")!;
        this.uMaskBounds_masked = gl.getUniformLocation(this.progMasked, "uMaskBounds")!;

        // Buffers and VAOs
        this.vbo = gl.createBuffer()!;
        this.ibo = gl.createBuffer()!;
        // Geometry: 4 verts, 6 indices (two triangles)
        const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        // VAO for textured
        this.vaoTex = gl.createVertexArray()!;
        gl.bindVertexArray(this.vaoTex);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        // aPos (location=0), aUV (location=1)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        // VAO for solid (only aPos)
        this.vaoCol = gl.createVertexArray()!;
        gl.bindVertexArray(this.vaoCol);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        // VAO for gradient (aPos + aT interleaved: x, y, t per vertex)
        this.vaoGrad = gl.createVertexArray()!;
        gl.bindVertexArray(this.vaoGrad);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0); // x, y
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8); // t (interpolation factor)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bindVertexArray(null);

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        // Preserve correct destination alpha inside the offscreen UI buffer so
        // semi-transparent widget sprites do not become transparent again when
        // the cached widget texture is composited onto the main frame.
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    resize(w: number, h: number) {
        this.width = Math.max(1, w | 0);
        this.height = Math.max(1, h | 0);
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.gl.viewport(0, 0, this.width, this.height);
        this.proj = ortho(0, this.width, this.height, 0, -1, 1);
    }

    clear(r = 0.043, g = 0.059, b = 0.078, a = 1) {
        const gl = this.gl;
        this.solidBatchFloatCount = 0;
        this.textureBatchQuadCount = 0;
        this.textureBatchTex = null;
        gl.clearColor(r, g, b, a);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    getPerfCounters() {
        return {
            drawCalls: this.perfDrawCalls,
            textureDrawCalls: this.perfTextureDrawCalls,
            solidDrawCalls: this.perfSolidDrawCalls,
            gradientDrawCalls: this.perfGradientDrawCalls,
            maskedDrawCalls: this.perfMaskedDrawCalls,
        };
    }

    resetPerfCounters() {
        this.perfDrawCalls = 0;
        this.perfTextureDrawCalls = 0;
        this.perfSolidDrawCalls = 0;
        this.perfGradientDrawCalls = 0;
        this.perfMaskedDrawCalls = 0;
    }

    flush() {
        this.flushSolidBatch();
        this.flushTextureBatch();
    }

    drawRect(x: number, y: number, w: number, h: number, color: [number, number, number, number]) {
        this.flushTextureBatch();
        this.appendSolidRect(x, y, w, h, color);
    }

    /**
     * OSRS PARITY: Draw a vertical gradient rectangle
     * Reference: Rasterizer2D.Rasterizer2D_fillRectangleGradient (fillMode=1)
     * Interpolates color from top to bottom
     */
    drawRectGradientVertical(
        x: number,
        y: number,
        w: number,
        h: number,
        colorTop: [number, number, number, number],
        colorBot: [number, number, number, number],
    ) {
        const gl = this.gl;
        this.flushTextureBatch();
        this.flushSolidBatch();
        // PERF: Reuse cached array instead of allocating new Float32Array
        const verts = this.gradVerts;
        // top-left
        verts[0] = x;
        verts[1] = y;
        verts[2] = 0;
        // top-right
        verts[3] = x + w;
        verts[4] = y;
        verts[5] = 0;
        // bottom-right
        verts[6] = x + w;
        verts[7] = y + h;
        verts[8] = 1;
        // bottom-left
        verts[9] = x;
        verts[10] = y + h;
        verts[11] = 1;
        gl.useProgram(this.progGrad);
        gl.uniformMatrix4fv(this.uProj_grad, false, this.proj);
        gl.uniform4fv(this.uColorTop_grad, colorTop);
        gl.uniform4fv(this.uColorBot_grad, colorBot);
        gl.bindVertexArray(this.vaoGrad);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        this.perfDrawCalls++;
        this.perfGradientDrawCalls++;
    }

    /**
     * OSRS PARITY: Draw a vertical gradient rectangle with separate alpha values
     * Reference: Rasterizer2D.Rasterizer2D_fillRectangleGradientAlpha (fillMode=2)
     * Interpolates both color AND alpha from top to bottom
     */
    drawRectGradientAlpha(
        x: number,
        y: number,
        w: number,
        h: number,
        colorTop: number,
        colorBot: number,
        alphaTop: number,
        alphaBot: number,
    ) {
        // Convert OSRS colors to RGBA
        const rT = ((colorTop >>> 16) & 0xff) / 255;
        const gT = ((colorTop >>> 8) & 0xff) / 255;
        const bT = (colorTop & 0xff) / 255;
        const rB = ((colorBot >>> 16) & 0xff) / 255;
        const gB = ((colorBot >>> 8) & 0xff) / 255;
        const bB = (colorBot & 0xff) / 255;
        // OSRS passes alpha as 0-255 where 255 = opaque, convert to 0-1
        const aT = alphaTop / 255;
        const aB = alphaBot / 255;
        this.drawRectGradientVertical(x, y, w, h, [rT, gT, bT, aT], [rB, gB, bB, aB]);
    }

    drawTexture(
        tex: Texture,
        x: number,
        y: number,
        w: number,
        h: number,
        uScale = 1,
        vScale = 1,
        tintStrength = 0,
        tintColor: [number, number, number] = [0, 0, 0],
        flipX = false,
        flipY = false,
        alpha = 1,
    ) {
        if (!tex?.tex) return;

        this.flushSolidBatch();
        // UV coordinates with flip support
        const u0 = flipX ? uScale : 0;
        const u1 = flipX ? 0 : uScale;
        const v0 = flipY ? vScale : 0;
        const v1 = flipY ? 0 : vScale;
        this.appendTextureQuad(tex, x, y, x + w, y + h, u0, v0, u1, v1, tintStrength, tintColor, alpha);
    }

    drawTextureQuads(
        tex: Texture,
        vertices: Float32Array,
        quadCount: number,
        tintStrength = 0,
        tintColor: [number, number, number] = [0, 0, 0],
        alpha = 1,
    ) {
        if (!tex?.tex || quadCount <= 0) return;

        this.flushSolidBatch();
        this.appendTextureQuads(
            tex,
            vertices.subarray(0, quadCount * 16),
            quadCount,
            tintStrength,
            tintColor,
            alpha,
        );
    }

    /**
     * OSRS PARITY: Draw a texture rotated around its center
     * Reference: SpritePixels.method9857() and method9855()
     * Used for compass rotation and widgets with spriteAngle
     *
     * @param tex The texture to draw
     * @param x Left edge X position
     * @param y Top edge Y position
     * @param w Width
     * @param h Height
     * @param angle OSRS angle in 16-bit format (0-65536 = 360 degrees) OR 11-bit (0-2048) based on angleScale
     * @param angleScale Divisor for angle: 65536 for widget spriteAngle, 2048 for camera yaw
     * @param tintStrength 0-1 tint strength
     * @param tintColor RGB tint color
     * @param alpha Overall opacity
     */
    drawTextureRotated(
        tex: Texture,
        x: number,
        y: number,
        w: number,
        h: number,
        angle: number,
        angleScale: number = 65536,
        tintStrength = 0,
        tintColor: [number, number, number] = [0, 0, 0],
        alpha = 1,
    ) {
        const gl = this.gl;
        this.flushTextureBatch();
        this.flushSolidBatch();
        gl.useProgram(this.progTex);
        gl.uniformMatrix4fv(this.uProj_tex, false, this.proj);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex.tex);
        gl.uniform1i(this.uSampler_tex, 0);
        gl.uniform3f(this.uTintColor_tex, tintColor[0], tintColor[1], tintColor[2]);
        gl.uniform1f(this.uTintStrength_tex, tintStrength);
        gl.uniform1f(this.uAlpha_tex, alpha);

        // Convert OSRS angle to radians
        // OSRS uses angle / 326.11 for 2048 scale (camera yaw)
        // Or angle * 9.587379924285257E-5 for 65536 scale (widget spriteAngle)
        // Both are equivalent: 2π / angleScale
        const radians = (angle * Math.PI * 2) / angleScale;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);

        // Center of rotation (center of the widget/sprite)
        const cx = x + w / 2;
        const cy = y + h / 2;

        // Half-dimensions
        const hw = w / 2;
        const hh = h / 2;

        // Calculate rotated corner positions
        // Corners relative to center: (-hw,-hh), (hw,-hh), (hw,hh), (-hw,hh)
        // Rotated position = center + (corner rotated by angle)
        const x0 = cx + (-hw * cos - -hh * sin);
        const y0 = cy + (-hw * sin + -hh * cos);
        const x1 = cx + (hw * cos - -hh * sin);
        const y1 = cy + (hw * sin + -hh * cos);
        const x2 = cx + (hw * cos - hh * sin);
        const y2 = cy + (hw * sin + hh * cos);
        const x3 = cx + (-hw * cos - hh * sin);
        const y3 = cy + (-hw * sin + hh * cos);

        // PERF: Reuse cached array instead of allocating new Float32Array
        const verts = this.rotatedVerts;
        verts[0] = x0;
        verts[1] = y0;
        verts[2] = 0;
        verts[3] = 0; // top-left
        verts[4] = x1;
        verts[5] = y1;
        verts[6] = 1;
        verts[7] = 0; // top-right
        verts[8] = x2;
        verts[9] = y2;
        verts[10] = 1;
        verts[11] = 1; // bottom-right
        verts[12] = x3;
        verts[13] = y3;
        verts[14] = 0;
        verts[15] = 1; // bottom-left
        gl.bindVertexArray(this.vaoTex);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        this.perfDrawCalls++;
        this.perfTextureDrawCalls++;
    }

    /**
     * OSRS PARITY: Draw a texture rotated with a mask applied
     * Reference: SpritePixels.drawRotatedMaskedCenteredAround()
     * Used for compass (contentType 1339) which needs circular masking
     *
     * @param contentTex The texture to draw (compass sprite)
     * @param maskTex The mask texture (widget's sprite defining circular shape)
     * @param x Left edge X position
     * @param y Top edge Y position
     * @param w Width of the output area
     * @param h Height of the output area
     * @param angle OSRS angle for content rotation
     * @param angleScale Divisor for angle (65536 for widget spriteAngle, 2048 for camera yaw)
     */
    drawTextureRotatedMasked(
        contentTex: Texture,
        maskTex: Texture,
        x: number,
        y: number,
        w: number,
        h: number,
        angle: number,
        angleScale: number = 65536,
    ) {
        const gl = this.gl;
        this.flushTextureBatch();
        this.flushSolidBatch();
        gl.useProgram(this.progMasked);
        gl.uniformMatrix4fv(this.uProj_masked, false, this.proj);

        // Bind content texture to unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, contentTex.tex);
        gl.uniform1i(this.uContent_masked, 0);

        // Bind mask texture to unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskTex.tex);
        gl.uniform1i(this.uMask_masked, 1);

        // Pass mask bounds for screen-space UV calculation
        gl.uniform4f(this.uMaskBounds_masked, x, y, w, h);

        // Convert OSRS angle to radians
        const radians = (angle * Math.PI * 2) / angleScale;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);

        // Center of rotation
        const cx = x + w / 2;
        const cy = y + h / 2;
        const hw = w / 2;
        const hh = h / 2;

        // Calculate rotated corner positions for the quad
        const x0 = cx + (-hw * cos - -hh * sin);
        const y0 = cy + (-hw * sin + -hh * cos);
        const x1 = cx + (hw * cos - -hh * sin);
        const y1 = cy + (hw * sin + -hh * cos);
        const x2 = cx + (hw * cos - hh * sin);
        const y2 = cy + (hw * sin + hh * cos);
        const x3 = cx + (-hw * cos - hh * sin);
        const y3 = cy + (-hw * sin + hh * cos);

        // PERF: Reuse cached array instead of allocating new Float32Array
        const verts = this.maskedVerts;
        verts[0] = x0;
        verts[1] = y0;
        verts[2] = 0;
        verts[3] = 0; // top-left
        verts[4] = x1;
        verts[5] = y1;
        verts[6] = 1;
        verts[7] = 0; // top-right
        verts[8] = x2;
        verts[9] = y2;
        verts[10] = 1;
        verts[11] = 1; // bottom-right
        verts[12] = x3;
        verts[13] = y3;
        verts[14] = 0;
        verts[15] = 1; // bottom-left

        gl.bindVertexArray(this.vaoTex);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        this.perfDrawCalls++;
        this.perfMaskedDrawCalls++;

        // Reset to texture unit 0
        gl.activeTexture(gl.TEXTURE0);
    }

    private appendSolidRect(
        x: number,
        y: number,
        w: number,
        h: number,
        color: [number, number, number, number],
    ) {
        if (this.solidBatchFloatCount + 36 > this.solidBatchData.length) {
            this.flushSolidBatch();
        }

        const data = this.solidBatchData;
        let o = this.solidBatchFloatCount;
        const x1 = x + w;
        const y1 = y + h;
        const r = color[0];
        const g = color[1];
        const b = color[2];
        const a = color[3];

        data[o++] = x;
        data[o++] = y;
        data[o++] = r;
        data[o++] = g;
        data[o++] = b;
        data[o++] = a;

        data[o++] = x1;
        data[o++] = y;
        data[o++] = r;
        data[o++] = g;
        data[o++] = b;
        data[o++] = a;

        data[o++] = x1;
        data[o++] = y1;
        data[o++] = r;
        data[o++] = g;
        data[o++] = b;
        data[o++] = a;

        data[o++] = x;
        data[o++] = y;
        data[o++] = r;
        data[o++] = g;
        data[o++] = b;
        data[o++] = a;

        data[o++] = x1;
        data[o++] = y1;
        data[o++] = r;
        data[o++] = g;
        data[o++] = b;
        data[o++] = a;

        data[o++] = x;
        data[o++] = y1;
        data[o++] = r;
        data[o++] = g;
        data[o++] = b;
        data[o++] = a;

        this.solidBatchFloatCount = o;
    }

    private appendTextureQuad(
        tex: Texture,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        u0: number,
        v0: number,
        u1: number,
        v1: number,
        tintStrength: number,
        tintColor: [number, number, number],
        alpha: number,
    ) {
        this.prepareTextureBatch(tex, 1, tintStrength, tintColor, alpha);
        const data = this.textureBatchData;
        const offset = this.textureBatchQuadCount * 16;
        data[offset + 0] = x0;
        data[offset + 1] = y0;
        data[offset + 2] = u0;
        data[offset + 3] = v0;
        data[offset + 4] = x1;
        data[offset + 5] = y0;
        data[offset + 6] = u1;
        data[offset + 7] = v0;
        data[offset + 8] = x1;
        data[offset + 9] = y1;
        data[offset + 10] = u1;
        data[offset + 11] = v1;
        data[offset + 12] = x0;
        data[offset + 13] = y1;
        data[offset + 14] = u0;
        data[offset + 15] = v1;
        this.textureBatchQuadCount++;
    }

    private appendTextureQuads(
        tex: Texture,
        vertices: Float32Array,
        quadCount: number,
        tintStrength: number,
        tintColor: [number, number, number],
        alpha: number,
    ) {
        this.prepareTextureBatch(tex, quadCount, tintStrength, tintColor, alpha);
        const offset = this.textureBatchQuadCount * 16;
        this.textureBatchData.set(vertices, offset);
        this.textureBatchQuadCount += quadCount;
    }

    private prepareTextureBatch(
        tex: Texture,
        addQuads: number,
        tintStrength: number,
        tintColor: [number, number, number],
        alpha: number,
    ) {
        if (
            this.textureBatchQuadCount > 0 &&
            !this.canReuseTextureBatch(tex, tintStrength, tintColor, alpha)
        ) {
            this.flushTextureBatch();
        }
        if (this.textureBatchQuadCount === 0) {
            this.textureBatchTex = tex;
            this.textureBatchTintStrength = tintStrength;
            this.textureBatchTintColor[0] = tintColor[0];
            this.textureBatchTintColor[1] = tintColor[1];
            this.textureBatchTintColor[2] = tintColor[2];
            this.textureBatchAlpha = alpha;
        }
        this.ensureTextureBatchCapacity(addQuads);
    }

    private canReuseTextureBatch(
        tex: Texture,
        tintStrength: number,
        tintColor: [number, number, number],
        alpha: number,
    ): boolean {
        return (
            this.textureBatchTex === tex &&
            this.textureBatchTintStrength === tintStrength &&
            this.textureBatchAlpha === alpha &&
            this.textureBatchTintColor[0] === tintColor[0] &&
            this.textureBatchTintColor[1] === tintColor[1] &&
            this.textureBatchTintColor[2] === tintColor[2]
        );
    }

    private ensureTextureBatchCapacity(addQuads: number) {
        const requiredQuads = this.textureBatchQuadCount + addQuads;
        const currentQuads = this.textureBatchData.length / 16;
        if (requiredQuads <= currentQuads) return;

        let nextQuads = Math.max(1, currentQuads);
        while (nextQuads < requiredQuads) {
            nextQuads <<= 1;
        }

        const next = new Float32Array(nextQuads * 16);
        next.set(this.textureBatchData.subarray(0, this.textureBatchQuadCount * 16));
        this.textureBatchData = next;
    }

    private ensureTextureTriangleBatchCapacity(quadCount: number) {
        const requiredFloats = quadCount * 24;
        if (requiredFloats <= this.textureBatchTriangleData.length) return;

        let nextLength = Math.max(24, this.textureBatchTriangleData.length);
        while (nextLength < requiredFloats) {
            nextLength <<= 1;
        }

        this.textureBatchTriangleData = new Float32Array(nextLength);
    }

    private flushSolidBatch() {
        if (this.solidBatchFloatCount === 0) return;

        const gl = this.gl;
        gl.useProgram(this.progSolid);
        gl.uniformMatrix4fv(this.uProj_col, false, this.proj);
        gl.bindVertexArray(this.vaoCol);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            this.solidBatchData.subarray(0, this.solidBatchFloatCount),
            gl.DYNAMIC_DRAW,
        );
        gl.drawArrays(gl.TRIANGLES, 0, this.solidBatchFloatCount / 6);
        this.perfDrawCalls++;
        this.perfSolidDrawCalls++;
        this.solidBatchFloatCount = 0;
    }

    private flushTextureBatch() {
        if (this.textureBatchQuadCount === 0 || !this.textureBatchTex?.tex) return;

        const gl = this.gl;
        gl.useProgram(this.progTex);
        gl.uniformMatrix4fv(this.uProj_tex, false, this.proj);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textureBatchTex.tex);
        gl.uniform1i(this.uSampler_tex, 0);
        gl.uniform3f(
            this.uTintColor_tex,
            this.textureBatchTintColor[0],
            this.textureBatchTintColor[1],
            this.textureBatchTintColor[2],
        );
        gl.uniform1f(this.uTintStrength_tex, this.textureBatchTintStrength);
        gl.uniform1f(this.uAlpha_tex, this.textureBatchAlpha);
        gl.bindVertexArray(this.vaoTex);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

        // Some browsers/drivers report intermittent glDrawElements buffer-size failures on the
        // large shared textured UI batch. Expand quads into triangles and submit with drawArrays
        // so CS2/widget text does not depend on element-buffer behavior.
        this.ensureTextureTriangleBatchCapacity(this.textureBatchQuadCount);
        const src = this.textureBatchData;
        const dst = this.textureBatchTriangleData;
        let srcOffset = 0;
        let dstOffset = 0;
        for (let i = 0; i < this.textureBatchQuadCount; i++) {
            dst[dstOffset + 0] = src[srcOffset + 0];
            dst[dstOffset + 1] = src[srcOffset + 1];
            dst[dstOffset + 2] = src[srcOffset + 2];
            dst[dstOffset + 3] = src[srcOffset + 3];
            dst[dstOffset + 4] = src[srcOffset + 4];
            dst[dstOffset + 5] = src[srcOffset + 5];
            dst[dstOffset + 6] = src[srcOffset + 6];
            dst[dstOffset + 7] = src[srcOffset + 7];
            dst[dstOffset + 8] = src[srcOffset + 8];
            dst[dstOffset + 9] = src[srcOffset + 9];
            dst[dstOffset + 10] = src[srcOffset + 10];
            dst[dstOffset + 11] = src[srcOffset + 11];
            dst[dstOffset + 12] = src[srcOffset + 0];
            dst[dstOffset + 13] = src[srcOffset + 1];
            dst[dstOffset + 14] = src[srcOffset + 2];
            dst[dstOffset + 15] = src[srcOffset + 3];
            dst[dstOffset + 16] = src[srcOffset + 8];
            dst[dstOffset + 17] = src[srcOffset + 9];
            dst[dstOffset + 18] = src[srcOffset + 10];
            dst[dstOffset + 19] = src[srcOffset + 11];
            dst[dstOffset + 20] = src[srcOffset + 12];
            dst[dstOffset + 21] = src[srcOffset + 13];
            dst[dstOffset + 22] = src[srcOffset + 14];
            dst[dstOffset + 23] = src[srcOffset + 15];
            srcOffset += 16;
            dstOffset += 24;
        }
        gl.bufferData(gl.ARRAY_BUFFER, dst.subarray(0, dstOffset), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, this.textureBatchQuadCount * 6);
        this.perfDrawCalls++;
        this.perfTextureDrawCalls++;

        this.textureBatchQuadCount = 0;
        this.textureBatchTex = null;
    }
    createTextureFromCanvas(key: string, canvas: HTMLCanvasElement): Texture {
        const gl = this.gl;
        // Check if already cached - avoid recreating
        const existing = this.textures.get(key);
        if (existing) return existing;
        // Reset to texture unit 0 and unbind to avoid state pollution from PicoGL
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        const tex = gl.createTexture();
        if (!tex) {
            // Fallback: return a placeholder if texture creation fails
            console.warn("[GLRenderer] createTexture() returned null for key:", key);
            return { tex: null as any, w: canvas.width, h: canvas.height };
        }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        // Cached widget/text/sprite canvases should never wrap; UI tiling is handled explicitly
        // by draw loops, and repeat sampling causes edge bleed when UVs land fractionally outside 0..1.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        const t: Texture = { tex, w: canvas.width, h: canvas.height };
        this.textures.set(key, t);
        return t;
    }

    getTexture(key: string) {
        return this.textures.get(key);
    }

    /**
     * Update an existing texture from a canvas, or create if it doesn't exist.
     * Unlike createTextureFromCanvas, this will re-upload the canvas data every call.
     * Use for dynamic textures like minimap that change every frame.
     */
    updateTextureFromCanvas(key: string, canvas: HTMLCanvasElement): Texture {
        const gl = this.gl;
        const existing = this.textures.get(key);

        if (existing && existing.tex) {
            // Update existing texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, existing.tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            existing.w = canvas.width;
            existing.h = canvas.height;
            return existing;
        }

        // Create new texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        const tex = gl.createTexture();
        if (!tex) {
            console.warn("[GLRenderer] createTexture() returned null for key:", key);
            return { tex: null as any, w: canvas.width, h: canvas.height };
        }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        const t: Texture = { tex, w: canvas.width, h: canvas.height };
        this.textures.set(key, t);
        return t;
    }
}

function ortho(l: number, r: number, b: number, t: number, n: number, f: number) {
    const out = new Float32Array(16);
    out[0] = 2 / (r - l);
    out[5] = 2 / (t - b);
    out[10] = -2 / (f - n);
    out[12] = -(r + l) / (r - l);
    out[13] = -(t + b) / (t - b);
    out[14] = -(f + n) / (f - n);
    out[15] = 1;
    return out;
}

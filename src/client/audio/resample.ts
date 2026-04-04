/**
 * Resample a mono Float32Array to a target sample rate using linear interpolation.
 * Lightweight linear-interpolation decimator suitable for SFX work in the browser.
 */
export function resampleToSampleRate(
    input: Float32Array,
    sourceRate: number,
    targetRate: number,
): Float32Array {
    if (sourceRate <= 0 || targetRate <= 0 || input.length === 0 || sourceRate === targetRate) {
        return input.slice();
    }

    const ratio = targetRate / sourceRate;
    const outputLength = Math.max(1, Math.round(input.length * ratio));
    const output = new Float32Array(outputLength);
    const invRatio = sourceRate / targetRate;

    for (let i = 0; i < outputLength; i++) {
        const position = i * invRatio;
        const index = Math.floor(position);
        const frac = position - index;
        // Bounds check to prevent reading beyond array end
        const sample0 = index < input.length ? input[index] : 0;
        const sample1 = index + 1 < input.length ? input[index + 1] : sample0;
        output[i] = sample0 + (sample1 - sample0) * frac;
    }

    return output;
}

/**
 * Apply a lightweight low-pass smoothing filter in-place to blunt the high-frequency hiss
 * inherent in legacy 8-bit RuneScape sound effects. The forward/backward passes maintain
 * zero-lag response while remaining inexpensive.
 */
export function smoothLowPass(
    data: Float32Array,
    sampleRate: number,
    cutoffHz: number = Math.min(10000, sampleRate * 0.45),
): void {
    if (data.length === 0 || sampleRate <= 0 || cutoffHz <= 0) return;

    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const alpha = dt / (rc + dt);

    // Forward pass
    let prev = data[0];
    for (let i = 0; i < data.length; i++) {
        const current = data[i];
        prev = prev + alpha * (current - prev);
        data[i] = prev;
    }

    // Backward pass for zero-phase
    prev = data[data.length - 1];
    for (let i = data.length - 1; i >= 0; i--) {
        const current = data[i];
        prev = prev + alpha * (current - prev);
        data[i] = prev;
    }

    // Clamp to [-1, 1] after filtering to avoid any stray overshoots
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v > 1) {
            data[i] = 1;
        } else if (v < -1) {
            data[i] = -1;
        }
    }
}

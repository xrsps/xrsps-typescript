import { mat4, vec3 } from "gl-matrix";

import { DEGREES_TO_RADIANS, RS_TO_RADIANS } from "../rs/MathConstants";
import { clamp } from "../common/utils/MathUtil";
import { Frustum } from "./Frustum";

export interface CameraView {
    position: vec3;
    pitch: number;
    yaw: number;
    orthoZoom: number;
}

export enum ProjectionType {
    PERSPECTIVE,
    ORTHO,
}

export class Camera {
    static moveCameraRotOrigin: vec3 = vec3.create();
    static deltaTemp: vec3 = vec3.create();
    private static readonly FOV_SCRIPT_BASE = 7;
    private static readonly FOV_SCRIPT_SCALE = 256;

    pos: vec3;

    pitch: number;
    yaw: number;

    private targetPos: vec3;
    private targetPitch: number;
    private targetYaw: number;

    private readonly positionMaxSpeedPerSec = 12; // tiles per second toward target
    private readonly positionSpringPerSec = 6; // proportional easing factor
    private readonly positionMinSpeedPerSec = 0.25; // ensures drift settles
    private readonly yawMaxSpeedPerSec = 2048 / 4; // full rotation in ~4 seconds
    private readonly yawMinSpeedPerSec = 10;
    private readonly pitchMaxSpeedPerSec = 192; // matches RS camera responsiveness
    private readonly pitchMinSpeedPerSec = 16;
    private readonly positionEpsilon = 1e-4;
    private readonly angleEpsilon = 1e-3;

    projectionType: ProjectionType = ProjectionType.PERSPECTIVE;

    orthoZoom: number = 15;

    // OSRS viewport parameters (script op defaults)
    private viewportFovLow: number = 256;
    private viewportFovHigh: number = 205;
    private viewportFovClampMin: number = 1;
    private viewportFovClampMax: number = 32767;
    private viewportZoomClampMin: number = 1;
    private viewportZoomClampMax: number = 32767;
    private viewportZoomHeightMin: number = 256;
    private viewportZoomHeightMax: number = 320;

    viewportZoom: number = 0;
    viewportWidth: number = 0;
    viewportHeight: number = 0;
    viewportXOffset: number = 0;
    viewportYOffset: number = 0;
    screenWidth: number = 0;
    screenHeight: number = 0;

    projectionMatrix: mat4 = mat4.create();
    cameraMatrix: mat4 = mat4.create();
    viewMatrix: mat4 = mat4.create();
    viewProjMatrix: mat4 = mat4.create();
    private viewportTransformMatrix: mat4 = mat4.create();

    frustum = new Frustum();

    updated: boolean = false;
    updatedPosition: boolean = false;
    updatedLastFrame: boolean = false;
    constructor(x: number, y: number, z: number, pitch: number, yaw: number) {
        this.pos = vec3.fromValues(x, y, z);
        this.pitch = pitch;
        this.yaw = yaw;
        this.targetPos = vec3.clone(this.pos);
        this.targetPitch = clamp(pitch, 0, 512);
        this.targetYaw = this.wrapYawInternal(yaw);
    }

    static scriptFovToScale(scriptValue: number): number {
        return Math.trunc(
            Math.pow(2, scriptValue / Camera.FOV_SCRIPT_SCALE + Camera.FOV_SCRIPT_BASE),
        );
    }

    static fovScaleToScriptValue(fovScale: number): number {
        return Math.trunc(
            (Math.log(fovScale) / Math.LN2 - Camera.FOV_SCRIPT_BASE) * Camera.FOV_SCRIPT_SCALE,
        );
    }

    static rawPitchToScenePitchAngle(rawPitch: number): number {
        const normalizedPitch = clamp(Number(rawPitch) || 0, 0, 512);
        return 128 + Math.floor((normalizedPitch * 255) / 512);
    }

    snapToPosition(x?: number, y?: number, z?: number): void {
        if (x !== undefined) {
            this.pos[0] = x;
            this.targetPos[0] = x;
        }
        if (y !== undefined) {
            this.pos[1] = y;
            this.targetPos[1] = y;
        }
        if (z !== undefined) {
            this.pos[2] = z;
            this.targetPos[2] = z;
        }
        this.updated = true;
        this.updatedPosition = true;
    }

    setTargetPosition(x: number, y: number, z: number): void {
        this.targetPos[0] = x;
        this.targetPos[1] = y;
        this.targetPos[2] = z;
        this.updated = true;
    }

    private wrapYawInternal(yaw: number): number {
        return ((yaw % 2048) + 2048) % 2048;
    }

    private normalizeYawDelta(delta: number): number {
        let normalized = ((delta % 2048) + 2048) % 2048;
        if (normalized > 1024) {
            normalized -= 2048;
        } else if (normalized < -1024) {
            normalized += 2048;
        }
        return normalized;
    }

    getScenePitchAngle(): number {
        return Camera.rawPitchToScenePitchAngle(this.pitch);
    }

    getScenePitchRadians(): number {
        return -this.getScenePitchAngle() * RS_TO_RADIANS;
    }

    setTargetYaw(yaw: number): void {
        this.targetYaw = this.wrapYawInternal(yaw);
        this.updated = true;
    }

    setTargetPitch(pitch: number): void {
        this.targetPitch = clamp(pitch, 0, 512);
        this.updated = true;
    }

    snapToPitch(pitch: number): void {
        this.targetPitch = clamp(pitch, 0, 512);
        this.pitch = this.targetPitch;
        this.updated = true;
    }

    snapToYaw(yaw: number): void {
        const wrapped = this.wrapYawInternal(yaw);
        this.targetYaw = wrapped;
        this.yaw = this.targetYaw;
        this.updated = true;
    }

    setProjectionType(type: ProjectionType) {
        this.projectionType = type;
        this.updated = true;
    }

    applySmoothing(deltaTimeMs: number): void {
        if (!Number.isFinite(deltaTimeMs)) {
            return;
        }
        const dt = Math.max(0, deltaTimeMs) / 1000;
        if (dt === 0) {
            this.alignToTargetsIfClose();
            return;
        }

        let didUpdate = false;
        let movedPosition = false;

        for (let i = 0; i < 3; i++) {
            const diff = this.targetPos[i] - this.pos[i];
            const absDiff = Math.abs(diff);
            if (absDiff <= this.positionEpsilon) {
                this.pos[i] = this.targetPos[i];
                continue;
            }
            const spring = absDiff * this.positionSpringPerSec * dt;
            const speedCap = this.positionMaxSpeedPerSec * dt;
            const minStep = this.positionMinSpeedPerSec * dt;
            let step = spring + minStep;
            step = Math.min(step, speedCap > 0 ? speedCap : step);
            step = Math.min(step, absDiff);
            if (step <= this.positionEpsilon) {
                this.pos[i] = this.targetPos[i];
                continue;
            }
            const delta = Math.sign(diff) * step;
            this.pos[i] += delta;
            if (Math.abs(this.targetPos[i] - this.pos[i]) <= this.positionEpsilon) {
                this.pos[i] = this.targetPos[i];
            }
            movedPosition = true;
            didUpdate = true;
        }

        if (movedPosition) {
            this.updatedPosition = true;
        }

        const pitchDiff = this.targetPitch - this.pitch;
        const pitchAbs = Math.abs(pitchDiff);
        if (pitchAbs > this.angleEpsilon) {
            const speedCap = this.pitchMaxSpeedPerSec * dt;
            const minStep = this.pitchMinSpeedPerSec * dt;
            let step = Math.min(pitchAbs, speedCap > 0 ? speedCap : pitchAbs);
            if (step < minStep && pitchAbs > this.angleEpsilon) {
                step = Math.min(pitchAbs, minStep);
            }
            const delta = Math.sign(pitchDiff) * step;
            this.pitch = clamp(this.pitch + delta, 0, 512);
            if (Math.abs(this.targetPitch - this.pitch) <= this.angleEpsilon) {
                this.pitch = this.targetPitch;
            }
            didUpdate = true;
        } else {
            this.pitch = this.targetPitch;
        }

        const yawDiff = this.normalizeYawDelta(this.targetYaw - this.yaw);
        const yawAbs = Math.abs(yawDiff);
        if (yawAbs > this.angleEpsilon) {
            const speedCap = this.yawMaxSpeedPerSec * dt;
            const minStep = this.yawMinSpeedPerSec * dt;
            let step = Math.min(yawAbs, speedCap > 0 ? speedCap : yawAbs);
            if (step < minStep && yawAbs > this.angleEpsilon) {
                step = Math.min(yawAbs, minStep);
            }
            const delta = Math.sign(yawDiff) * step;
            this.yaw = this.wrapYawInternal(this.yaw + delta);
            if (Math.abs(this.normalizeYawDelta(this.targetYaw - this.yaw)) <= this.angleEpsilon) {
                this.yaw = this.wrapYawInternal(this.targetYaw);
            }
            didUpdate = true;
        } else {
            this.yaw = this.wrapYawInternal(this.targetYaw);
        }

        if (didUpdate) {
            this.updated = true;
        }
    }

    move(deltaX: number, deltaY: number, deltaZ: number, rotatePitch: boolean = false): void {
        Camera.deltaTemp[0] = deltaX;
        Camera.deltaTemp[1] = deltaY;
        Camera.deltaTemp[2] = deltaZ;

        if (rotatePitch) {
            vec3.rotateX(
                Camera.deltaTemp,
                Camera.deltaTemp,
                Camera.moveCameraRotOrigin,
                -this.getScenePitchRadians(),
            );
        }
        vec3.rotateY(
            Camera.deltaTemp,
            Camera.deltaTemp,
            Camera.moveCameraRotOrigin,
            (this.yaw - 1024) * RS_TO_RADIANS,
        );

        vec3.add(this.pos, this.pos, Camera.deltaTemp);
        vec3.copy(this.targetPos, this.pos);
        this.updated = true;
        this.updatedPosition = true;
    }

    updatePitch(_pitch: number, deltaPitch: number): void {
        // Positive-down pitch in RS units: 0 (level) .. 512 (≈90° down)
        const next = clamp(this.targetPitch + deltaPitch, 0, 512);
        this.pitch = next;
        this.targetPitch = next;
        this.updated = true;
    }

    getYaw(): number {
        // Return normalized yaw in RS units [0, 2048) as integer for debug/UI
        return (((this.yaw % 2048) + 2048) % 2048) & 2047;
    }

    setYaw(yaw: number): void {
        // Keep yaw numerically stable by wrapping into [0, 2048)
        const wrapped = this.wrapYawInternal(yaw);
        this.yaw = wrapped;
        this.setTargetYaw(wrapped);
    }

    updateYaw(_yaw: number, deltaYaw: number): void {
        const next = this.wrapYawInternal(this.targetYaw + deltaYaw);
        this.yaw = next;
        this.targetYaw = next;
        this.updated = true;
    }

    update(
        screenWidth: number,
        screenHeight: number,
        viewportX: number = 0,
        viewportY: number = 0,
        viewportWidth: number = screenWidth,
        viewportHeight: number = screenHeight,
    ) {
        this.screenWidth = Math.max(1, screenWidth | 0);
        this.screenHeight = Math.max(1, screenHeight | 0);

        const viewportMetrics = this.computeOsrsViewportForSize(viewportWidth, viewportHeight);
        this.viewportZoom = viewportMetrics.viewportZoom;
        this.viewportWidth = viewportMetrics.viewportWidth;
        this.viewportHeight = viewportMetrics.viewportHeight;
        this.viewportXOffset = (viewportX | 0) + viewportMetrics.viewportXOffset;
        this.viewportYOffset = (viewportY | 0) + viewportMetrics.viewportYOffset;

        // Projection
        mat4.identity(this.projectionMatrix);
        if (this.projectionType === ProjectionType.PERSPECTIVE) {
            const fovY = 2 * Math.atan(this.viewportHeight / (2 * this.viewportZoom));
            const aspect = this.viewportWidth / this.viewportHeight;
            mat4.perspective(this.projectionMatrix, fovY, aspect, 0.1, 1024.0 * 4);
        } else {
            mat4.ortho(
                this.projectionMatrix,
                -this.viewportWidth / this.orthoZoom,
                this.viewportWidth / this.orthoZoom,
                -this.viewportHeight / this.orthoZoom,
                this.viewportHeight / this.orthoZoom,
                -1024.0 * 4,
                1024.0 * 4,
            );
        }
        this.applyViewportTransform();

        // View
        const pitch = this.getScenePitchRadians();
        const yaw = (this.yaw - 1024) * RS_TO_RADIANS;

        mat4.identity(this.cameraMatrix);

        mat4.translate(this.cameraMatrix, this.cameraMatrix, this.pos);
        mat4.rotateY(this.cameraMatrix, this.cameraMatrix, yaw);
        mat4.rotateZ(this.cameraMatrix, this.cameraMatrix, 180 * DEGREES_TO_RADIANS); // Roll
        mat4.rotateX(this.cameraMatrix, this.cameraMatrix, pitch);

        mat4.invert(this.viewMatrix, this.cameraMatrix);

        // Calculate view projection matrix
        mat4.multiply(this.viewProjMatrix, this.projectionMatrix, this.viewMatrix);

        this.frustum.setPlanes(this.viewProjMatrix);
    }

    computeViewportZoomForSize(width: number, height: number): number {
        const { viewportZoom } = this.computeOsrsViewportForSize(width, height);
        return Math.max(1, viewportZoom | 0);
    }

    computeViewportMetricsForSize(
        width: number,
        height: number,
    ): { viewportZoom: number; viewportWidth: number; viewportHeight: number } {
        const { viewportZoom, viewportWidth, viewportHeight } = this.computeOsrsViewportForSize(
            width,
            height,
        );
        return {
            viewportZoom: Math.max(1, viewportZoom | 0),
            viewportWidth: Math.max(1, viewportWidth | 0),
            viewportHeight: Math.max(1, viewportHeight | 0),
        };
    }

    getViewportFovValues(): { low: number; high: number } {
        return {
            low: Camera.fovScaleToScriptValue(this.viewportFovLow),
            high: Camera.fovScaleToScriptValue(this.viewportFovHigh),
        };
    }

    setViewportFovValues(low: number, high: number): void {
        const nextLow = Camera.scriptFovToScale(low | 0);
        const nextHigh = Camera.scriptFovToScale(high | 0);
        this.viewportFovLow = nextLow > 0 ? nextLow : 256;
        this.viewportFovHigh = nextHigh > 0 ? nextHigh : 256;
        this.updated = true;
    }

    getViewportZoomRange(): { min: number; max: number } {
        return {
            min: this.viewportZoomHeightMin | 0,
            max: this.viewportZoomHeightMax | 0,
        };
    }

    setViewportZoomRange(min: number, max: number): void {
        this.viewportZoomHeightMin = min > 0 ? min | 0 : 256;
        this.viewportZoomHeightMax = max > 0 ? max | 0 : 320;
        this.updated = true;
    }

    containsScreenPoint(x: number, y: number): boolean {
        const viewportWidth = this.viewportWidth | 0;
        const viewportHeight = this.viewportHeight | 0;
        if (viewportWidth <= 0 || viewportHeight <= 0) {
            return false;
        }

        const viewportX = this.viewportXOffset | 0;
        const viewportY = this.viewportYOffset | 0;
        return (
            x >= viewportX &&
            y >= viewportY &&
            x < viewportX + viewportWidth &&
            y < viewportY + viewportHeight
        );
    }

    private computeOsrsViewportForSize(width: number, height: number) {
        let viewportWidth = Math.max(1, width | 0);
        let viewportHeight = Math.max(1, height | 0);
        let viewportXOffset = 0;
        let viewportYOffset = 0;

        const diff = viewportHeight - 334;
        let fovScale: number;
        if (diff < 0) {
            fovScale = this.viewportFovLow;
        } else if (diff >= 100) {
            fovScale = this.viewportFovHigh;
        } else {
            fovScale =
                ((this.viewportFovHigh - this.viewportFovLow) * diff) / 100 + this.viewportFovLow;
        }

        const zoomRatio = (viewportHeight * fovScale * 512) / (viewportWidth * 334);

        if (zoomRatio < this.viewportZoomClampMin) {
            const clamp = this.viewportZoomClampMin;
            fovScale = (clamp * viewportWidth * 334) / (viewportHeight * 512);
            if (fovScale > this.viewportFovClampMax) {
                fovScale = this.viewportFovClampMax;
                const scaledWidth = (viewportHeight * fovScale * 512) / (clamp * 334);
                const gutter = Math.max(0, Math.trunc((viewportWidth - scaledWidth) / 2));
                viewportXOffset += gutter;
                viewportWidth -= gutter * 2;
            }
        } else if (zoomRatio > this.viewportZoomClampMax) {
            const clamp = this.viewportZoomClampMax;
            fovScale = (clamp * viewportWidth * 334) / (viewportHeight * 512);
            if (fovScale < this.viewportFovClampMin) {
                fovScale = this.viewportFovClampMin;
                const scaledHeight = (clamp * viewportWidth * 334) / (fovScale * 512);
                const gutter = Math.max(0, Math.trunc((viewportHeight - scaledHeight) / 2));
                viewportYOffset += gutter;
                viewportHeight -= gutter * 2;
            }
        }

        viewportWidth = Math.max(1, viewportWidth | 0);
        viewportHeight = Math.max(1, viewportHeight | 0);
        // Client.viewportZoom is an integer (var3 * var6 / 334).
        const viewportZoom = ((viewportHeight * fovScale) / 334) | 0;

        return {
            viewportZoom,
            viewportWidth,
            viewportHeight,
            viewportXOffset,
            viewportYOffset,
        };
    }

    onFrameEnd() {
        this.updatedLastFrame = this.updated;
        this.updated = false;
        this.updatedPosition = false;
    }

    private alignToTargetsIfClose(): void {
        for (let i = 0; i < 3; i++) {
            if (Math.abs(this.targetPos[i] - this.pos[i]) <= this.positionEpsilon) {
                this.pos[i] = this.targetPos[i];
            }
        }
        if (Math.abs(this.targetPitch - this.pitch) <= this.angleEpsilon) {
            this.pitch = this.targetPitch;
        }
        if (Math.abs(this.normalizeYawDelta(this.targetYaw - this.yaw)) <= this.angleEpsilon) {
            this.yaw = this.wrapYawInternal(this.targetYaw);
        }
    }

    getPosX(): number {
        return this.pos[0];
    }

    getPosY(): number {
        return this.pos[1];
    }

    getPosZ(): number {
        return this.pos[2];
    }

    getMapX(): number {
        return this.getPosX() >> 6;
    }

    getMapY(): number {
        return this.getPosZ() >> 6;
    }

    getTargetPos(): vec3 {
        return this.targetPos;
    }

    /**
     * Set the FOV and zoom clamp values for viewport calculations.
     * Called by VIEWPORT_CLAMPFOV CS2 opcode.
     * Values of 0 indicate no clamping (use defaults).
     */
    setClampFov(
        fovClampMin: number,
        fovClampMax: number,
        zoomClampMin: number,
        zoomClampMax: number,
    ): void {
        // If all values are 0, reset to defaults (no clamping)
        if (fovClampMin === 0 && fovClampMax === 0 && zoomClampMin === 0 && zoomClampMax === 0) {
            this.viewportFovClampMin = 1;
            this.viewportFovClampMax = 32767;
            this.viewportZoomClampMin = 1;
            this.viewportZoomClampMax = 32767;
        } else {
            this.viewportFovClampMin = fovClampMin;
            this.viewportFovClampMax = fovClampMax;
            this.viewportZoomClampMin = zoomClampMin;
            this.viewportZoomClampMax = zoomClampMax;
        }
        this.updated = true;
    }

    private applyViewportTransform(): void {
        const screenWidth = Math.max(1, this.screenWidth | 0);
        const screenHeight = Math.max(1, this.screenHeight | 0);
        const viewportWidth = Math.max(1, this.viewportWidth | 0);
        const viewportHeight = Math.max(1, this.viewportHeight | 0);
        const viewportX = this.viewportXOffset | 0;
        const viewportY = this.viewportYOffset | 0;

        const scaleX = viewportWidth / screenWidth;
        const scaleY = viewportHeight / screenHeight;
        const translateX = (2 * viewportX + viewportWidth) / screenWidth - 1;
        const translateY = 1 - (2 * viewportY + viewportHeight) / screenHeight;

        mat4.set(
            this.viewportTransformMatrix,
            scaleX,
            0,
            0,
            0,
            0,
            scaleY,
            0,
            0,
            0,
            0,
            1,
            0,
            translateX,
            translateY,
            0,
            1,
        );
        mat4.multiply(this.projectionMatrix, this.viewportTransformMatrix, this.projectionMatrix);
    }
}

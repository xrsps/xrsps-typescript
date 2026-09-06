import assert from "node:assert/strict";
import { mat4, vec3, vec4 } from "gl-matrix";

import { Camera } from "../game/Camera";
import { RS_TO_RADIANS } from "../rs/MathConstants";

const camera = new Camera(0, 0, 0, 256, 512);
camera.move(0, 0, -1);
assert.ok(camera.getPosX() > 0.99, "forward should follow the viewed direction");

camera.snapToPosition(0, 0, 0);
camera.move(0, 0, 1, true);
assert.ok(camera.getPosY() < 0, "zooming out should move the camera upward");

// High nearby terrain must raise the view along with the follow orbit. Previously
// the orbit used angle382 but the view used250, hiding the player behind chat.
const followCamera = new Camera(0, 0, 0, 245, 1862);
followCamera.setMinimumScenePitchAngle(382);
assert.equal(followCamera.getScenePitchAngle(), 382);
assert.equal(followCamera.pitch, 245, "terrain pressure must preserve the input pitch");
const rotation = mat4.create();
mat4.rotateY(rotation, rotation, (followCamera.yaw - 1024) * RS_TO_RADIANS);
mat4.rotateZ(rotation, rotation, Math.PI);
mat4.rotateX(rotation, rotation, -382 * RS_TO_RADIANS);
const forward = vec3.transformMat4(vec3.create(), vec3.fromValues(0, 0, -1), rotation);
const focus = vec3.fromValues(0, -75 / 128, 0);
const orbit = vec3.scaleAndAdd(vec3.create(), focus, forward, -(600 + 3 * 382) / 128);
followCamera.snapToPosition(...(Array.from(orbit) as [number, number, number]));
followCamera.update(765, 503, 4, 4, 512, 334);
const project = (point: vec3) => {
    const clip = vec4.transformMat4(vec4.create(), vec4.fromValues(...(Array.from(point) as [number, number, number]), 1), followCamera.viewProjMatrix);
    return { x: (clip[0] / clip[3] + 1) * 765 / 2, y: (1 - clip[1] / clip[3]) * 503 / 2 };
};
const projectedFocus = project(focus);
assert.ok(Math.abs(projectedFocus.x - 260) < 0.01, "follow focal point must remain horizontally centred");
assert.ok(Math.abs(projectedFocus.y - 171) < 0.01, "follow focal point must remain vertically centred");
const projectedFeet = project(vec3.create());
assert.ok(projectedFeet.y > 4 && projectedFeet.y < 338, "local player feet must remain above the fixed chatbox");

followCamera.setMinimumScenePitchAngle(128);
assert.equal(followCamera.getScenePitchAngle(), 250, "decaying terrain pressure must restore the user's angle");
followCamera.setMinimumScenePitchAngle(999);
assert.equal(followCamera.getScenePitchAngle(), 383, "native pitch limits must remain bounded");
followCamera.setMinimumScenePitchAngle(NaN);
assert.equal(followCamera.getScenePitchAngle(), 250, "invalid limits must reset to the native minimum");

console.log("camera control orientation ok");

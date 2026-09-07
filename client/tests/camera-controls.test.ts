import assert from "node:assert/strict";

import { Camera } from "../game/Camera";

const camera = new Camera(0, 0, 0, 256, 512);
camera.move(0, 0, -1);
assert.ok(camera.getPosX() > 0.99, "forward should follow the viewed direction");

camera.snapToPosition(0, 0, 0);
camera.move(0, 0, 1, true);
assert.ok(camera.getPosY() < 0, "zooming out should move the camera upward");

console.log("camera control orientation ok");

import type { OsrsClient } from "../OsrsClient";
import { clamp } from "../../common/utils/MathUtil";
import { duelInteractionStore } from "./DuelInteractionStore";

interface DuelCameraState { distance: number; }
const states = new WeakMap<OsrsClient, DuelCameraState>();

export function getDuelCameraState(client: OsrsClient): DuelCameraState {
    let state = states.get(client);
    if (!state) {
        state = { distance: 24 };
        states.set(client, state);
        client.camera.snapToYaw(0);
        client.camera.snapToPitch(270);
    }
    return state;
}

/** Native input conventions, without routing scroll/keys through hidden game widgets. */
export function updateDuelCameraInput(client: OsrsClient, deltaTime: number): void {
    const state = getDuelCameraState(client);
    const input = client.inputManager, camera = client.camera;
    const active = document.activeElement;
    const modal = !!document.querySelector(".duel-modal-backdrop") || !!duelInteractionStore.getSnapshot();
    const typing = active instanceof HTMLElement && !!active.closest("input, textarea, select, button, [contenteditable='true'], .duel-public-chat");
    if (!modal && !typing) {
        const amount = 512 * clamp(deltaTime, 0, 100) / 1000;
        if (input.isKeyDown("ArrowUp")) camera.updatePitch(camera.pitch, amount);
        if (input.isKeyDown("ArrowDown")) camera.updatePitch(camera.pitch, -amount);
        if (input.isKeyDown("ArrowLeft")) camera.updateYaw(camera.yaw, amount);
        if (input.isKeyDown("ArrowRight")) camera.updateYaw(camera.yaw, -amount);
    }
    const rect = client.renderer.canvas.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + input.mouseX * rect.width / Math.max(1, client.renderer.canvas.width),
        rect.top + input.mouseY * rect.height / Math.max(1, client.renderer.canvas.height));
    const overUi = !!target?.closest(".duel-ui");
    if (!modal && !overUi) {
        // Original middle-button orbit and touch orbit remain available as well.
        camera.updateYaw(camera.yaw, input.getDeltaCameraX() * .9);
        camera.updatePitch(camera.pitch, input.getDeltaCameraY() * -.9);
        if (input.wheelDeltaY) state.distance = clamp(state.distance * Math.exp(clamp(input.wheelDeltaY, -120, 120) * .0015), 8, 60);
    }
}

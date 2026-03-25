import {
    decodeInteractionIndex,
    encodeInteractionIndex,
} from "../../rs/interaction/InteractionIndex";
import type { OsrsClient } from "../OsrsClient";

type InteractionMode = "follow" | "trade" | "combat";
type InteractionTargetType = "player" | "npc";

/**
 * PlayerInteractionSystem owns client-side interaction state (follow/trade).
 * It does not send network packets; callers should invoke server messages
 * separately. Facing is fully server-authoritative via the face direction
 * update mask in the player sync packet.
 */
export class PlayerInteractionSystem {
    private active?: {
        mode: InteractionMode;
        targetType: InteractionTargetType;
        targetServerId: number;
    };
    private activeOrigin?: "client" | "server";

    constructor(private mv: OsrsClient) {}

    beginFollow(targetServerId: number): void {
        if (targetServerId == null) return;
        this.active = {
            mode: "follow",
            targetType: "player",
            targetServerId: targetServerId | 0,
        };
        this.activeOrigin = "client";
        try {
            const pe = this.mv.playerEcs;
            const idx = pe.getIndexForServerId(this.mv.controlledPlayerServerId);
            if (idx !== undefined) {
                pe.setInteractionIndex(idx, encodeInteractionIndex("player", targetServerId | 0));
            }
        } catch {}
        try {
            this.mv.closeMenu();
        } catch {}
    }

    beginTrade(targetServerId: number): void {
        if (targetServerId == null) return;
        this.active = {
            mode: "trade",
            targetType: "player",
            targetServerId: targetServerId | 0,
        };
        this.activeOrigin = "client";
        try {
            const pe = this.mv.playerEcs;
            const idx = pe.getIndexForServerId(this.mv.controlledPlayerServerId);
            if (idx !== undefined) {
                pe.setInteractionIndex(idx, encodeInteractionIndex("player", targetServerId | 0));
            }
        } catch {}
        try {
            this.mv.closeMenu();
        } catch {}
    }

    beginCombat(
        targetServerId: number,
        opts?: { tile?: { x: number; y: number }; targetType?: InteractionTargetType },
    ): void {
        if (targetServerId == null) return;
        this.active = {
            mode: "combat",
            targetType: opts?.targetType ?? "npc",
            targetServerId: targetServerId | 0,
        };
        this.activeOrigin = "client";
        try {
            const pe = this.mv.playerEcs;
            const idx = pe.getIndexForServerId(this.mv.controlledPlayerServerId);
            if (idx !== undefined) {
                pe.setInteractionIndex(
                    idx,
                    encodeInteractionIndex(opts?.targetType ?? "npc", targetServerId | 0),
                );
            }
        } catch {}
        try {
            this.mv.closeMenu();
        } catch {}
    }

    cancel(reason?: string): void {
        this.active = undefined;
        this.activeOrigin = undefined;
        try {
            const pe = this.mv.playerEcs;
            const idx = pe.getIndexForServerId(this.mv.controlledPlayerServerId);
            if (idx !== undefined) {
                try {
                    pe.setInteractionIndex(idx, undefined);
                } catch {}
                const cx = pe.getX(idx) | 0;
                const cy = pe.getY(idx) | 0;
                const tx = pe.getTargetX(idx) | 0;
                const ty = pe.getTargetY(idx) | 0;

                const ctx = (cx >> 7) | 0;
                const cty = (cy >> 7) | 0;
                const ttx = (tx >> 7) | 0;
                const tty = (ty >> 7) | 0;

                if (ctx !== ttx || cty !== tty) {
                    let or = pe.getTargetRotation(idx) | 0;
                    if (ctx < ttx) {
                        if (cty < tty) or = 1280;
                        else if (cty > tty) or = 1792;
                        else or = 1536;
                    } else if (ctx > ttx) {
                        if (cty < tty) or = 768;
                        else if (cty > tty) or = 256;
                        else or = 512;
                    } else if (cty < tty) or = 1024;
                    else if (cty > tty) or = 0;
                    pe.setTargetRot(idx, or & 2047);
                }
            }
        } catch {}
    }

    syncServerInteraction(interactionIndex?: number): void {
        if (typeof interactionIndex !== "number" || interactionIndex < 0) {
            if (this.activeOrigin !== "client") {
                this.active = undefined;
                this.activeOrigin = undefined;
            }
            return;
        }
        const decoded = decodeInteractionIndex(interactionIndex);
        if (!decoded) {
            if (this.activeOrigin !== "client") {
                this.active = undefined;
                this.activeOrigin = undefined;
            }
            return;
        }
        const derivedMode: InteractionMode = decoded.type === "npc" ? "combat" : "follow";
        const derivedTargetType: InteractionTargetType = decoded.type === "npc" ? "npc" : "player";
        const targetId = decoded.id | 0;
        if (
            this.activeOrigin === "client" &&
            this.active &&
            this.active.mode === derivedMode &&
            this.active.targetType === derivedTargetType &&
            this.active.targetServerId === targetId
        ) {
            return;
        }
        if (this.activeOrigin === "client") return;
        if (
            this.activeOrigin === "server" &&
            this.active &&
            this.active.mode === derivedMode &&
            this.active.targetType === derivedTargetType &&
            this.active.targetServerId === targetId
        ) {
            return;
        }
        this.active = {
            mode: derivedMode,
            targetType: derivedTargetType,
            targetServerId: targetId,
        };
        this.activeOrigin = "server";
    }
}

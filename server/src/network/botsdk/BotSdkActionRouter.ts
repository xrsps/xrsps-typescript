/**
 * Routes decoded bot-SDK action frames to the corresponding xRSPS service
 * call. This is the bridge that turns "LLM said walk to (3210, 3425)" into
 * an actual path being assigned to a `PlayerState`.
 *
 * **Design rule**: every action handler here delegates to an EXISTING
 * service method — no gameplay logic lives in the bot-SDK layer. If a new
 * action needs logic that doesn't exist yet, add it to the relevant
 * service (MovementService, InventoryService, etc.) and call it from here.
 *
 * **PR 5 scope**: walkTo + chatPublic + attackNpc + dropItem + eatFood.
 * More actions land in later PRs as specific capabilities (banking,
 * equipment, skilling) justify the server-side plumbing work.
 */

import type { AnyActionFrame } from "./BotSdkProtocol";
import type { ServerServices } from "../../game/ServerServices";
import type { PlayerManager, PlayerState } from "../../game/player";
import { logger } from "../../utils/logger";

export interface ActionDispatchResult {
    success: boolean;
    message: string;
}

export interface ActionRouterDeps {
    players: () => PlayerManager | undefined;
    getCurrentTick: () => number;
    services: () => ServerServices;
}

/** How long a dropped item stays on the ground before despawning (ticks). */
const DROP_DURATION_TICKS = 300;
/** How long the drop is visible only to the owner before going public. */
const DROP_PRIVATE_TICKS = 100;
/** Maximum chat message length. Same cap the normal chat handler uses. */
const CHAT_MAX_LENGTH = 80;

export class BotSdkActionRouter {
    constructor(private readonly deps: ActionRouterDeps) {}

    dispatch(playerId: number, frame: AnyActionFrame): ActionDispatchResult {
        const players = this.deps.players();
        if (!players) {
            return { success: false, message: "server not ready" };
        }
        const player = players.getPlayerById(playerId);
        if (!player) {
            return { success: false, message: `no such agent player id=${playerId}` };
        }
        if (!player.agent) {
            return { success: false, message: `player id=${playerId} is not an agent` };
        }

        try {
            switch (frame.action) {
                case "walkTo":
                    return this.walkTo(players, player, frame);
                case "chatPublic":
                    return this.chatPublic(player, frame);
                case "attackNpc":
                    return this.attackNpc(players, player, frame);
                case "dropItem":
                    return this.dropItem(player, frame);
                case "eatFood":
                    return this.eatFood(player, frame);
                default: {
                    const exhaustive: never = frame;
                    return {
                        success: false,
                        message: `unsupported action: ${JSON.stringify(exhaustive)}`,
                    };
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(`[botsdk] action dispatch error for player ${playerId}:`, err);
            return { success: false, message };
        }
    }

    // ─── walkTo ────────────────────────────────────────────────────────

    private walkTo(
        players: PlayerManager,
        player: PlayerState,
        frame: Extract<AnyActionFrame, { action: "walkTo" }>,
    ): ActionDispatchResult {
        const { x, z, run } = frame;
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
            return { success: false, message: "walkTo: x/z must be finite numbers" };
        }
        const result = players.moveAgent(
            player,
            { x, y: z },
            !!run,
            this.deps.getCurrentTick(),
        );
        if (!result.ok) {
            return { success: false, message: result.message ?? "walkTo failed" };
        }
        return {
            success: true,
            message: result.destinationCorrection
                ? `walking toward (${result.destinationCorrection.x}, ${result.destinationCorrection.y})`
                : `walking toward (${x}, ${z})`,
        };
    }

    // ─── chatPublic ────────────────────────────────────────────────────

    private chatPublic(
        player: PlayerState,
        frame: Extract<AnyActionFrame, { action: "chatPublic" }>,
    ): ActionDispatchResult {
        const rawText = frame.text;
        if (typeof rawText !== "string" || rawText.trim().length === 0) {
            return { success: false, message: "chatPublic: text is required" };
        }
        const text = rawText.trim().slice(0, CHAT_MAX_LENGTH);
        const svc = this.deps.services();

        const playerType = svc.authService?.getPublicChatPlayerType?.(player) ?? 0;
        svc.messagingService.queueChatMessage({
            messageType: "public",
            playerId: player.id,
            from: player.name ?? "",
            prefix: "",
            text,
            playerType,
        });

        return { success: true, message: `said "${text}"` };
    }

    // ─── attackNpc ─────────────────────────────────────────────────────

    private attackNpc(
        players: PlayerManager,
        player: PlayerState,
        frame: Extract<AnyActionFrame, { action: "attackNpc" }>,
    ): ActionDispatchResult {
        const npcId = frame.npcId;
        if (!Number.isFinite(npcId)) {
            return { success: false, message: "attackNpc: npcId is required" };
        }
        const svc = this.deps.services();
        const npc = svc.npcManager?.getById(npcId);
        if (!npc) {
            return { success: false, message: `attackNpc: no NPC with id=${npcId}` };
        }

        const result = players.attackNpcAsAgent(
            player,
            npc,
            this.deps.getCurrentTick(),
        );
        if (!result.ok) {
            return { success: false, message: result.message ?? "attack failed" };
        }
        return {
            success: true,
            message: `attacking NPC ${npcId}`,
        };
    }

    // ─── dropItem ──────────────────────────────────────────────────────

    private dropItem(
        player: PlayerState,
        frame: Extract<AnyActionFrame, { action: "dropItem" }>,
    ): ActionDispatchResult {
        const slot = frame.slot;
        if (!Number.isInteger(slot) || slot < 0 || slot >= 28) {
            return { success: false, message: "dropItem: slot must be 0..27" };
        }

        const svc = this.deps.services();
        const invEntries = player.items.getInventoryEntries();
        const entry = invEntries[slot];
        if (!entry || entry.itemId <= 0 || entry.quantity <= 0) {
            return { success: false, message: `dropItem: slot ${slot} is empty` };
        }

        const itemId = entry.itemId;
        const quantity = entry.quantity;

        const consumed = svc.inventoryService.consumeItem?.(player, slot);
        if (consumed === undefined || consumed === false) {
            return { success: false, message: "dropItem: failed to remove from inventory" };
        }

        try {
            svc.groundItems.spawn(
                itemId,
                quantity,
                { x: player.tileX, y: player.tileY, level: player.level },
                this.deps.getCurrentTick(),
                {
                    ownerId: player.id,
                    durationTicks: DROP_DURATION_TICKS,
                    privateTicks: DROP_PRIVATE_TICKS,
                } as Record<string, unknown>,
            );
        } catch (err) {
            // Even if ground-item spawn fails, the item is gone from
            // the agent's inventory — nothing we can do to roll back.
            logger.warn(`[botsdk] ground-item spawn failed after drop`, err);
            return {
                success: false,
                message: `dropped from inventory but ground spawn failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }

        return {
            success: true,
            message: `dropped item ${itemId} x${quantity} from slot ${slot}`,
        };
    }

    // ─── eatFood ───────────────────────────────────────────────────────

    private eatFood(
        player: PlayerState,
        frame: Extract<AnyActionFrame, { action: "eatFood" }>,
    ): ActionDispatchResult {
        const invEntries = player.items.getInventoryEntries();

        // Pick a slot: explicit override, or scan for the first
        // consumable. The InventoryActionHandler decides whether the
        // item is actually edible — we just pick the first non-empty
        // slot if the agent didn't specify.
        let slot = frame.slot;
        if (slot === undefined || slot === null) {
            slot = invEntries.findIndex(
                (e) => e && e.itemId > 0 && e.quantity > 0,
            );
            if (slot < 0) {
                return { success: false, message: "eatFood: inventory is empty" };
            }
        } else if (!Number.isInteger(slot) || slot < 0 || slot >= 28) {
            return { success: false, message: "eatFood: slot must be 0..27" };
        }

        const entry = invEntries[slot];
        if (!entry || entry.itemId <= 0) {
            return { success: false, message: `eatFood: slot ${slot} is empty` };
        }

        const svc = this.deps.services();
        const handler = svc.inventoryActionHandler;
        if (!handler) {
            return {
                success: false,
                message: "eatFood: InventoryActionHandler not ready",
            };
        }

        const result = handler.executeInventoryConsumeAction?.(player, {
            slotIndex: slot,
            itemId: entry.itemId,
            option: "eat",
        }) as { success?: boolean; message?: string } | undefined;

        if (result && result.success === false) {
            return {
                success: false,
                message: result.message ?? `eatFood: could not consume slot ${slot}`,
            };
        }

        return {
            success: true,
            message: `ate item ${entry.itemId} from slot ${slot}`,
        };
    }
}

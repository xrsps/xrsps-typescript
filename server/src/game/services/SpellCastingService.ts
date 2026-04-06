import type { WebSocket } from "ws";

import { SkillId } from "../../../../src/rs/skill/skills";
import { resolveSelectedSpellPayload } from "../../../../src/shared/spells/selectedSpellPayload";
import { getItemDefinition } from "../../data/items";
import {
    type SpellDataEntry,
    getSpellData,
    getSpellDataByWidget,
} from "../spells/SpellDataProvider";
import type { PlayerState } from "../player";
import { SpellCaster } from "../spells/SpellCaster";
import { logger } from "../../utils/logger";

export interface SpellCastingServiceDeps {
    getPlayerBySocket: (ws: WebSocket) => PlayerState | undefined;
    getSocketByPlayerId: (id: number) => WebSocket | undefined;
    getInventory: (player: PlayerState) => Array<{ itemId: number; quantity: number }>;
    setInventorySlot: (player: PlayerState, slot: number, itemId: number, quantity: number) => void;
    addItemToInventory: (player: PlayerState, itemId: number, quantity: number) => void;
    sendInventorySnapshot: (ws: WebSocket, player: PlayerState) => void;
    queueChatMessage: (msg: { messageType: string; playerId?: number; text: string; targetPlayerIds?: number[] }) => void;
    queueSpellResult: (playerId: number, payload: {
        casterId: number;
        spellId: number;
        outcome: "success" | "failure";
        reason?: string;
        targetType: "npc" | "player" | "loc" | "obj" | "tile" | "item";
    }) => void;
    awardSkillXp: (player: PlayerState, skillId: SkillId, xp: number) => void;
    enqueueSpotAnimation: (event: {
        tick: number;
        playerId: number;
        spotId: number;
        delay: number;
        height: number;
    }) => void;
    getCurrentTick: () => number;
    getActiveFrameTick: () => number | undefined;
}

export class SpellCastingService {
    constructor(private readonly deps: SpellCastingServiceDeps) {}

    handleSpellCastOnItem(
        ws: WebSocket,
        payload: {
            spellbookGroupId?: number;
            widgetChildId?: number;
            selectedSpellWidgetId?: number;
            selectedSpellChildIndex?: number;
            selectedSpellItemId?: number;
            spellId?: number;
            slot: number;
            itemId: number;
            widgetId?: number;
        },
    ): void {
        const player = this.deps.getPlayerBySocket(ws);
        if (!player) return;

        const slot = payload.slot;
        const targetItemId = payload.itemId;

        let spellData: SpellDataEntry | undefined;
        let spellId: number;
        const resolvedSelection = resolveSelectedSpellPayload(payload);

        if (
            resolvedSelection.spellbookGroupId !== undefined &&
            resolvedSelection.widgetChildId !== undefined
        ) {
            spellData = getSpellDataByWidget(
                resolvedSelection.spellbookGroupId,
                resolvedSelection.widgetChildId,
            );
            spellId = spellData?.id ?? -1;
        } else if (payload.spellId !== undefined) {
            spellId = payload.spellId;
            spellData = getSpellData(spellId);
        } else {
            this.sendSpellFailure(player, -1, "invalid_spell");
            return;
        }

        if (!spellData) {
            this.sendSpellFailure(player, spellId, "invalid_spell");
            return;
        }

        const magicSkill = player.getSkill(SkillId.Magic);
        const magicLevel = Math.max(1, magicSkill.baseLevel + magicSkill.boost);
        if (spellData.levelRequired && magicLevel < spellData.levelRequired) {
            this.deps.queueChatMessage({
                messageType: "game",
                playerId: player.id,
                text: `You need a Magic level of ${spellData.levelRequired} to cast this spell.`,
            });
            this.sendSpellFailure(player, spellId, "level_requirement");
            return;
        }

        const inventory = this.deps.getInventory(player);
        const invSlot = inventory[slot];
        if (!invSlot || invSlot.itemId !== targetItemId || invSlot.quantity <= 0) {
            this.sendSpellFailure(player, spellId, "invalid_target");
            return;
        }

        if (spellData.runeCosts && spellData.runeCosts.length > 0) {
            const validation = SpellCaster.validate({
                player,
                spellId,
            });
            if (!validation.success) {
                this.deps.queueChatMessage({
                    messageType: "game",
                    playerId: player.id,
                    text: "You don't have the required runes.",
                });
                this.sendSpellFailure(player, spellId, "out_of_runes");
                return;
            }
        }

        const HIGH_ALCH_ID = 9111;
        const LOW_ALCH_ID = 9110;
        const COINS_ID = 995;

        if (spellId === HIGH_ALCH_ID || spellId === LOW_ALCH_ID) {
            const itemDef = getItemDefinition(targetItemId);
            if (!itemDef) {
                this.deps.queueChatMessage({
                    messageType: "game",
                    playerId: player.id,
                    text: "You cannot alchemise this item.",
                });
                this.sendSpellFailure(player, spellId, "alch_invalid_item");
                return;
            }

            const alchValue = spellId === HIGH_ALCH_ID ? itemDef.highAlch : itemDef.lowAlch;
            if (alchValue <= 0) {
                this.deps.queueChatMessage({
                    messageType: "game",
                    playerId: player.id,
                    text: "You cannot alchemise this item.",
                });
                this.sendSpellFailure(player, spellId, "alch_invalid_item");
                return;
            }

            if (targetItemId === COINS_ID) {
                this.deps.queueChatMessage({
                    messageType: "game",
                    playerId: player.id,
                    text: "You cannot alchemise coins.",
                });
                this.sendSpellFailure(player, spellId, "alch_invalid_item");
                return;
            }

            if (spellData.runeCosts) {
                const outcome = SpellCaster.execute(
                    { player, spellId },
                    { success: true, spellData },
                );
                if (!outcome.success) {
                    this.sendSpellFailure(player, spellId, "out_of_runes");
                    return;
                }
            }

            if (invSlot.quantity > 1) {
                this.deps.setInventorySlot(player, slot, targetItemId, invSlot.quantity - 1);
            } else {
                this.deps.setInventorySlot(player, slot, 0, 0);
            }

            this.deps.addItemToInventory(player, COINS_ID, alchValue);

            const xpAward = spellId === HIGH_ALCH_ID ? 65 : 31;
            this.deps.awardSkillXp(player, SkillId.Magic, xpAward);

            const animId = spellId === HIGH_ALCH_ID ? 713 : 712;
            player.queueOneShotSeq(animId);
            const tick = this.deps.getActiveFrameTick() ?? this.deps.getCurrentTick();
            this.deps.enqueueSpotAnimation({
                tick: tick,
                playerId: player.id,
                spotId: spellData.castSpotAnim ?? 113,
                delay: 0,
                height: 100,
            });

            const sock = this.deps.getSocketByPlayerId(player.id);
            if (sock) this.deps.sendInventorySnapshot(sock, player);

            this.deps.queueSpellResult(player.id, {
                casterId: player.id,
                spellId: spellId,
                outcome: "success",
                targetType: "item",
            });

            logger.info(
                `[magic] Player ${player.id} cast ${spellData.name} on item ${targetItemId} for ${alchValue} coins`,
            );
            return;
        }

        this.deps.queueChatMessage({
            messageType: "game",
            playerId: player.id,
            text: "Nothing interesting happens.",
        });
        this.sendSpellFailure(player, spellId, "invalid_target");
    }

    sendSpellFailure(player: PlayerState, spellId: number, reason: string): void {
        this.deps.queueSpellResult(player.id, {
            casterId: player.id,
            spellId: spellId,
            outcome: "failure",
            reason: reason as any,
            targetType: "item",
        });
    }

    enqueueSpellFailureChat(
        player: PlayerState,
        spellId: number,
        reason: string | undefined,
    ): void {
        let text: string | undefined;
        const sd = getSpellData(spellId);
        switch (reason) {
            case "level_requirement": {
                const req = sd?.levelRequired ?? 1;
                text = `You need a Magic level of ${req} to cast this spell.`;
                break;
            }
            case "out_of_runes":
                text = "You do not have enough runes to cast this spell.";
                break;
            case "out_of_range":
                text = "You need to be closer to use that spell.";
                break;
            case "invalid_target":
                text = "You can't cast that on that target.";
                break;
            case "immune_target":
                text =
                    spellId === 3293
                        ? "This spell only affects undead."
                        : "The spell has no effect.";
                break;
            case "already_active":
                text = "That target is already affected by this spell.";
                break;
            case "line_of_sight":
                text = "You don't have a clear line of sight to that target.";
                break;
            case "restricted_zone":
                text = "A magical force stops you from casting that here.";
                break;
            case "cooldown":
                text = "You can't cast that yet.";
                break;
            case "teleblocked":
                text = "You can't teleport while teleblocked.";
                break;
            case "teleport_blocked_area":
                text = "A magical force stops you from teleporting.";
                break;
            case "not_autocastable_with_weapon":
                text = "You can't autocast that spell with this weapon.";
                break;
            case "alch_invalid_item":
                text = "You cannot alchemise this item.";
                break;
            case "superheat_invalid_item":
                text = "You can't superheat that.";
                break;
            case "telegrab_invalid":
                text = "You can't reach that.";
                break;
            case "charge_orb_wrong_obelisk":
                text = "You can only charge this orb at the Obelisk of the correct element.";
                break;
            case "charge_orb_missing_orb":
                text = "You need an unpowered orb to cast this spell.";
                break;
            case "invalid_spell":
            default:
                text = sd?.category === "utility" ? "Nothing interesting happens." : undefined;
        }
        if (text) {
            this.deps.queueChatMessage({ messageType: "game", text });
        }
    }
}

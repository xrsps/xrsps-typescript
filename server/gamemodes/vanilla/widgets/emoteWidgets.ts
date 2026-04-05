import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import { getEmoteSeq } from "../../../src/game/emotes";
import { getSkillcapeSeqId, getSkillcapeSpotId } from "../../../src/game/equipment";
import { type IScriptRegistry, type ScriptServices, type WidgetActionEvent } from "../../../src/game/scripts/types";

/**
 * Emote widget handlers for interface 216 (emotes tab).
 *
 * Uses onButton registration since binary IF_BUTTON packets don't send option strings.
 * Emotes are dynamic children where slot = emote index (0-55).
 * Op1 = Perform, Op2 = Loop (for emotes that support looping).
 */

const EMOTE_WIDGET_GROUP_ID = 216;
const EMOTE_CONTAINER_COMPONENT = 1; // Container for emote buttons
const SKILLCAPE_EMOTE_INDEX = 43;
const SKILLCAPE_SPOT_HEIGHT = 120; // ~0.94 tiles (head height)

// Keyword fallback for skillcape sequences when exact ID mapping doesn't exist
const SKILLCAPE_SEQ_BY_KEYWORD: Array<{ key: string; seq: number }> = [
    { key: "agility", seq: 4977 },
    { key: "attack", seq: 4981 },
    { key: "strength", seq: 4981 },
    { key: "defence", seq: 4981 },
    { key: "defense", seq: 4981 },
    { key: "hitpoints", seq: 4971 },
    { key: "hp", seq: 4971 },
    { key: "ranging", seq: 4973 },
    { key: "ranged", seq: 4973 },
    { key: "prayer", seq: 4979 },
    { key: "magic", seq: 4939 },
    { key: "runecraft", seq: 4947 },
    { key: "construction", seq: 4953 },
    { key: "cooking", seq: 4955 },
    { key: "crafting", seq: 4949 },
    { key: "farming", seq: 4963 },
    { key: "firemaking", seq: 4975 },
    { key: "fishing", seq: 4951 },
    { key: "fletching", seq: 4937 },
    { key: "herblore", seq: 4969 },
    { key: "hunter", seq: 5158 },
    { key: "mining", seq: 4941 },
    { key: "slayer", seq: 4967 },
    { key: "smithing", seq: 4943 },
    { key: "thieving", seq: 4965 },
    { key: "woodcutting", seq: 4957 },
    { key: "max", seq: 4945 },
];

// Emotes that have loop variants
const LOOP_SEQ_MAP: Record<number, number> = {
    12: 10048, // Dance -> emote_dance_loop
    13: 10049, // Jig -> emote_dance_scottish_loop
    15: 10050, // Headbang -> emote_dance_headbang_loop
    26: 10062, // Lean -> emote_mime_lean_loop
    47: 10052, // Crazy dance -> human_emote_crabdance_loop
    54: 10061, // Sit down -> emote_sit_loop
};

export function registerEmoteWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    // Handle emote widget (216) actions
    // Uses onButton for the emote container component
    registry.onButton(EMOTE_WIDGET_GROUP_ID, EMOTE_CONTAINER_COMPONENT, (event) => {
        handleEmote(event, services);
    });
}

/**
 * Handle emote button click
 */
function handleEmote(event: WidgetActionEvent, services: any): void {
    const player = event.player;
    const slot = event.slot;
    const opId = event.opId ?? 1;

    // Slot corresponds to emote index (0-55)
    if (slot === undefined || slot < 0 || slot > 55) {
        services.logger?.debug?.(`[emote] invalid slot=${slot} for player=${player.id}`);
        return;
    }

    const emoteIndex = slot;
    // Op1 = Perform, Op2 = Loop
    const isLoop = opId === 2;

    // Get sequence ID for this emote
    let seqId = getEmoteSeq(emoteIndex);
    let spotId: number | undefined;

    // Handle skillcape emote (index 43) - derive sequence and spot from equipped cape
    if (emoteIndex === SKILLCAPE_EMOTE_INDEX) {
        const capeId = services.getEquippedItem?.(player, EquipmentSlot.CAPE) ?? -1;
        if (capeId > 0) {
            // Get skillcape-specific sequence - prefer exact ID mapping
            const capeSeq = getSkillcapeSeqId(capeId);
            if (capeSeq !== undefined) {
                seqId = capeSeq;
            } else {
                // Fallback: match by item name keyword
                const obj = services.getObjType?.(capeId);
                const name = String(obj?.name || "").toLowerCase();
                for (const m of SKILLCAPE_SEQ_BY_KEYWORD) {
                    if (name.includes(m.key)) {
                        seqId = m.seq;
                        break;
                    }
                }
            }
            // Get skillcape-specific spot animation
            spotId = getSkillcapeSpotId(capeId) ?? 833; // fallback to HP sparkles
        }
    }

    // Handle loop variants - some emotes have separate loop sequences
    if (isLoop && seqId !== undefined && LOOP_SEQ_MAP[emoteIndex]) {
        seqId = LOOP_SEQ_MAP[emoteIndex];
    }

    if (seqId === undefined || seqId < 0) {
        services.logger?.debug?.(
            `[emote] unknown emote index=${emoteIndex} for player=${player.id}`,
        );
        return;
    }

    // Play the emote sequence with immediate feedback to the client
    if (services.playPlayerSeqImmediate) {
        services.playPlayerSeqImmediate(player, seqId);
        services.logger?.info?.(
            `[emote] player=${player.id} emote=${emoteIndex} seq=${seqId} loop=${isLoop}`,
        );
    } else if (services.playPlayerSeq) {
        // Fallback to delayed playback
        services.playPlayerSeq(player, seqId, 0);
        services.logger?.info?.(
            `[emote] player=${player.id} emote=${emoteIndex} seq=${seqId} loop=${isLoop} (delayed)`,
        );
    } else {
        services.logger?.warn?.(`[emote] playPlayerSeq service not available`);
    }

    // For skillcape emote, also broadcast the spot animation (graphic effect)
    if (emoteIndex === SKILLCAPE_EMOTE_INDEX && spotId !== undefined && spotId >= 0) {
        services.broadcastPlayerSpot?.(player, spotId, SKILLCAPE_SPOT_HEIGHT, 0);
        services.logger?.debug?.(`[emote] skillcape spot player=${player.id} spotId=${spotId}`);
    }
}

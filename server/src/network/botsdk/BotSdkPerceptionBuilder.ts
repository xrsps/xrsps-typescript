/**
 * Builds {@link AgentPerceptionSnapshot} values from live game state.
 *
 * This is the single place that translates "what the server knows" into
 * "what the LLM can see". Everything the plugin exposes as TOON context
 * originates here — so keep the output small and structured.
 *
 * **PR 1 scope**: minimal snapshot — self + basic skill summary + empty
 * nearby/events lists. PR 2 expands to inventory and equipment, PR 4 adds
 * the nearby-entity scans, PR 5 adds recent-events recording.
 */

import {
    SKILL_IDS,
    SKILL_NAME,
} from "../../../../src/rs/skill/skills";
import type {
    AgentPerceptionInventoryItem,
    AgentPerceptionSelf,
    AgentPerceptionSkill,
    AgentPerceptionSnapshot,
} from "../../agent";
import type { PlayerState } from "../../game/player";

export class BotSdkPerceptionBuilder {
    /**
     * Build a fresh snapshot for the given agent player. Intended to be
     * cheap enough to call on every emit cycle (default every 3 ticks).
     */
    build(player: PlayerState, currentTick: number): AgentPerceptionSnapshot {
        return {
            tick: currentTick,
            self: this.buildSelf(player),
            skills: this.buildSkills(player),
            inventory: this.buildInventory(player),
            equipment: [], // PR 2: populate from PlayerEquipmentAccessor
            nearbyNpcs: [], // PR 4
            nearbyPlayers: [], // PR 4
            nearbyGroundItems: [], // PR 4
            nearbyObjects: [], // PR 4
            recentEvents: [], // PR 5
        };
    }

    private buildSelf(player: PlayerState): AgentPerceptionSelf {
        const hp = player.skillSystem.getHitpointsCurrent();
        const maxHp = player.skillSystem.getHitpointsMax();
        return {
            id: player.id,
            name: player.name ?? "",
            combatLevel: player.skillSystem.combatLevel,
            hp,
            maxHp,
            x: player.tileX,
            z: player.tileY,
            level: player.level,
            runEnergy: player.energy.getRunEnergyPercent(),
            inCombat: player.combat.isAttacking() || player.isBeingAttacked(),
        };
    }

    private buildSkills(player: PlayerState): AgentPerceptionSkill[] {
        const out: AgentPerceptionSkill[] = [];
        for (const id of SKILL_IDS) {
            const entry = player.skillSystem.getSkill(id);
            if (!entry) continue;
            // The composed skill entry exposes baseLevel + boost. Current
            // level = base + boost (capped at MAX_TEMP_HITPOINT_LEVEL for hp).
            const level = entry.baseLevel + (entry.boost ?? 0);
            out.push({
                id,
                name: SKILL_NAME[id] ?? `skill_${id}`,
                level,
                baseLevel: entry.baseLevel,
                xp: entry.xp,
            });
        }
        return out;
    }

    private buildInventory(player: PlayerState): AgentPerceptionInventoryItem[] {
        const items = player.items;
        if (!items) return [];
        const out: AgentPerceptionInventoryItem[] = [];
        const inv = items.getInventoryEntries();
        for (let slot = 0; slot < inv.length; slot++) {
            const entry = inv[slot];
            if (!entry || entry.itemId <= 0) continue;
            out.push({
                slot,
                itemId: entry.itemId,
                name: `item_${entry.itemId}`, // name resolution comes in PR 2
                count: entry.quantity ?? 1,
            });
        }
        return out;
    }
}

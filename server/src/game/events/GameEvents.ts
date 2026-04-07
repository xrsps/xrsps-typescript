import type { SkillId } from "../../../../src/rs/skill/skills";
import type { PlayerState } from "../player";
import type { NpcState } from "../npc";

/**
 * Map of all game event names to their payload types.
 * Gamemodes and plugins subscribe to these events to react to game state changes
 * without tight coupling to the systems that produce them.
 */
export interface GameEventMap {
    // ── Player lifecycle ──────────────────────────────────────────────
    "player:login": {
        player: PlayerState;
    };
    "player:logout": {
        playerId: number;
        username: string;
    };

    // ── Skills ────────────────────────────────────────────────────────
    "skill:xpGain": {
        player: PlayerState;
        skillId: SkillId;
        xpGained: number;
        totalXp: number;
        source: "skill" | "combat" | "quest" | "other";
    };
    "skill:levelUp": {
        player: PlayerState;
        skillId: SkillId;
        oldLevel: number;
        newLevel: number;
    };
    "combat:levelUp": {
        player: PlayerState;
        oldLevel: number;
        newLevel: number;
    };

    // ── Equipment ─────────────────────────────────────────────────────
    "equipment:equip": {
        player: PlayerState;
        itemId: number;
        slot: number;
    };
    "equipment:unequip": {
        player: PlayerState;
        itemId: number;
        slot: number;
    };

    // ── Death ─────────────────────────────────────────────────────────
    "npc:death": {
        npc: NpcState;
        npcTypeId: number;
        combatLevel?: number;
        killerPlayerId: number | undefined;
        tile: { x: number; y: number; level: number };
    };
    // ── Interfaces ────────────────────────────────────────────────────
    "interfaces:closeInterruptible": {
        player: PlayerState;
    };

    // ── Items ─────────────────────────────────────────────────────────
    "item:craft": {
        playerId: number;
        itemId: number;
        count: number;
    };
}

export type GameEventName = keyof GameEventMap;

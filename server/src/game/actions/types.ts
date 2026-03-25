import type { ProjectileLaunch } from "../../../../src/shared/projectiles/ProjectileLaunch";
import type { HitsplatSourceType } from "../combat/OsrsHitsplatIds";
import { PlayerState } from "../player";
import type { CoreActionPayloadByKind } from "./actionPayloads";
import type { SkillActionPayloadByKind } from "./skillActionPayloads";

export type BuiltInActionKind =
    | "inventory.equip"
    | "inventory.consume"
    | "inventory.consume_script"
    | "inventory.use_on"
    | "inventory.move"
    | "inventory.unequip"
    | "inventory.drop"
    | "combat.autocast"
    | "combat.special"
    | "combat.attack"
    | "combat.playerHit"
    | "combat.npcRetaliate"
    | "combat.companionHit"
    | "skill.smith"
    | "skill.cook"
    | "skill.tan"
    | "skill.fletch"
    | "skill.spin"
    | "skill.sinew"
    | "skill.flax"
    | "skill.woodcut"
    | "skill.firemaking"
    | "skill.mine"
    | "skill.fish"
    | "skill.smelt"
    | "skill.bolt_enchant"
    | "skill.picklock"
    | "skill.pickpocket"
    | "movement.teleport"
    | "emote.play";

export type ActionKind = BuiltInActionKind | (string & {});

type ActionPayloadByKind = CoreActionPayloadByKind & SkillActionPayloadByKind;

type ActionDataForKind<K extends ActionKind> = K extends keyof ActionPayloadByKind
    ? ActionPayloadByKind[K]
    : unknown;

export type HitsplatEffect = {
    type: "hitsplat";
    playerId: number;
    targetType: "player" | "npc";
    targetId: number;
    damage: number;
    style: number;
    /** Secondary hitsplat type (`var3` in Actor.addHitSplat), optional. */
    type2?: number;
    /** Secondary hitsplat value (`var4` in Actor.addHitSplat), optional. */
    damage2?: number;
    sourceType?: HitsplatSourceType;
    sourcePlayerId?: number;
    hpCurrent?: number;
    hpMax?: number;
    tick?: number;
    /** Client-side delay in ticks before displaying the hitsplat. */
    delayTicks?: number;
};

export type BaseActionEffect =
    | {
          type: "inventorySnapshot";
          playerId: number;
      }
    | {
          type: "appearanceUpdate";
          playerId: number;
      }
    | {
          type: "message";
          playerId: number;
          message: string;
          severity?: "info" | "warn" | "error";
      }
    | {
          type: "combatState";
          playerId: number;
      }
    | {
          type: "log";
          playerId: number;
          level?: "debug" | "info" | "warn" | "error";
          message: string;
          meta?: Record<string, unknown>;
      }
    | HitsplatEffect
    | {
          type: "forcedChat";
          /** Actor that triggered the effect (not necessarily the recipient). */
          playerId: number;
          /** Player receiving the forced overhead chat update block. */
          targetId: number;
          text: string;
      }
    | {
          type: "forcedMovement";
          /** Actor that triggered the effect (not necessarily the recipient). */
          playerId: number;
          /** Player receiving the forced-move update block. */
          targetId: number;
          startDeltaX: number;
          startDeltaY: number;
          endDeltaX: number;
          endDeltaY: number;
          startCycle: number;
          endCycle: number;
          /** OSRS `field1173` (forced-move facing) in RS rotation units (0..2047). */
          direction: number;
      }
    | {
          type: "projectile";
          playerId: number;
          projectile: ProjectileLaunch;
      };

// Skill/level-up celebration effects (OSRS parity).
export type LevelUpEffect = {
    type: "levelUp";
    playerId: number;
    /** OSRS skill id (0..22). */
    skillId: number;
    /** New base level after the XP update. */
    newLevel: number;
    /** Number of levels gained in this update (>= 1). */
    levelIncrement: number;
};

export type CombatLevelUpEffect = {
    type: "combatLevelUp";
    playerId: number;
    /** New combat level after applying skill level changes. */
    newLevel: number;
    /** Number of combat levels gained in this update (>= 1). */
    levelIncrement: number;
};

export type ActionEffect = BaseActionEffect | LevelUpEffect | CombatLevelUpEffect;

export interface ActionExecutionResult {
    ok: boolean;
    effects?: ActionEffect[];
    cooldownTicks?: number;
    groups?: string[];
    reason?: string;
}

export interface ActionRequest<K extends ActionKind = ActionKind> {
    kind: K;
    data: ActionDataForKind<K>;
    delayTicks?: number;
    groups?: string[];
    cooldownTicks?: number;
}

export interface ScheduledAction<K extends ActionKind = ActionKind> {
    id: number;
    kind: K;
    executeTick: number;
    data: ActionDataForKind<K>;
    groups: string[];
    cooldownTicks: number;
    requestTick: number;
}

export interface PlayerActionState {
    queue: ScheduledAction[];
    groupLocks: Map<string, number>;
}

export type ActionPerformer = (
    player: PlayerState,
    action: ScheduledAction,
    tick: number,
) => ActionExecutionResult;

export interface ActionEnqueueResult {
    ok: boolean;
    actionId?: number;
    reason?: string;
}

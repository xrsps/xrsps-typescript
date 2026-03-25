import type { AttackType } from "../combat/AttackType";
import type { LockState } from "../model/LockState";

export interface ActionTile {
    x: number;
    y: number;
}

export type InventoryUseOnTarget =
    | { kind: "npc"; id?: number; tile?: ActionTile; plane?: number }
    | { kind: "player"; id?: number; tile?: ActionTile; plane?: number }
    | { kind: "loc"; id?: number; tile?: ActionTile; plane?: number }
    | { kind: "obj"; id?: number; tile?: ActionTile; plane?: number }
    | { kind: "inv"; slot: number; itemId: number };

export interface InventoryUseOnActionData {
    slot: number;
    itemId: number;
    target?: InventoryUseOnTarget;
    modifierFlags?: number;
}

export interface InventoryEquipActionData {
    slotIndex: number;
    itemId: number;
    option?: string;
    equipSlot?: number;
}

export interface InventoryConsumeActionData {
    slotIndex: number;
    itemId: number;
    option?: string;
}

export interface InventoryConsumeScriptActionData {
    slotIndex: number;
    itemId: number;
    option?: string;
    apply?: () => void;
}

export interface InventoryMoveActionData {
    from: number;
    to: number;
}

export interface InventoryUnequipActionData {
    slot: number;
    playSound?: boolean;
}

export interface InventoryDropActionData {
    slotIndex: number;
    itemId: number;
    option?: string;
    quantity?: number;
}

export interface CombatProjectileParamsData {
    projectileId?: number;
    startHeight?: number;
    endHeight?: number;
    slope?: number;
    steepness?: number;
    startDelay?: number;
}

export interface CombatAmmoEffectData {
    effectType?: string;
    graphicId?: number;
    selfDamage?: number;
    leechPercent?: number;
    poison?: boolean;
}

export interface CombatSpecialEffectsData {
    freezeTicks?: number;
    healFraction?: number;
    prayerFraction?: number;
    siphonRunEnergyPercent?: number;
    prayerDisableTicks?: number;
    drainMagicByDamage?: boolean;
    drainCombatStatByDamage?: boolean;
}

export interface CombatSpecialPayloadData {
    costPercent?: number;
    weaponItemId?: number;
    effects?: CombatSpecialEffectsData;
    minDamagePerHit?: number;
    maxDamagePerHit?: number;
    specGraphicId?: number;
    specProjectileId?: number;
    specSoundId?: number;
    hitSounds?: number[];
}

export interface CombatHitPayloadData {
    npcId?: number;
    attackDelay?: number;
    hitDelay?: number;
    damage?: number;
    maxHit?: number;
    style?: number;
    type2?: number;
    damage2?: number;
    retaliateDamage?: number;
    retaliationDelay?: number;
    retaliationTotalDelay?: number;
    expectedHitTick?: number;
    landed?: boolean;
    attackType?: AttackType | string;
    attackStyleMode?: unknown;
    spellId?: unknown;
    spellBaseXpAtCast?: unknown;
    ammoEffect?: CombatAmmoEffectData;
    hitIndex?: number;
    /** Combat XP was already granted when the attack was committed, not on impact. */
    xpGrantedOnAttack?: unknown;
}

export interface CombatAttackActionData {
    npcId: number;
    attackDelay?: number;
    hit?: CombatHitPayloadData;
    hits?: CombatHitPayloadData[];
    special?: CombatSpecialPayloadData;
    projectile?: CombatProjectileParamsData;
    additionalProjectiles?: CombatProjectileParamsData[];
}

export interface CombatAutocastActionData {
    targetId: number;
    spellId?: number;
    castMode?: "autocast" | "defensive_autocast";
}

type CombatPlayerHitBase = {
    damage?: number;
    maxHit?: number;
    style?: number;
    type2?: number;
    damage2?: number;
    clientDelayTicks?: number;
    expectedHitTick?: number;
    landed?: boolean | 1 | "true";
    attackType?: AttackType | string;
    attackDelay?: number;
    hitDelay?: number;
    retaliateDamage?: number;
    retaliationDelay?: number;
    retaliationTotalDelay?: number;
    attackStyleMode?: unknown;
    spellId?: unknown;
    spellBaseXpAtCast?: unknown;
    special?: CombatSpecialPayloadData;
    ammoEffect?: CombatAmmoEffectData;
    hitIndex?: number;
    hit?: CombatHitPayloadData;
    /** Combat XP was already granted when the attack was committed, not on impact. */
    xpGrantedOnAttack?: unknown;
};

export type CombatPlayerHitActionData =
    | (CombatPlayerHitBase & { npcId: number; targetId?: number })
    | (CombatPlayerHitBase & { targetId: number; npcId?: number });

export interface CombatNpcRetaliateActionData {
    npcId: number;
    phase: "swing" | "hit";
    damage?: number;
    maxHit?: number;
    style?: number;
    type2?: number;
    damage2?: number;
    attackType?: AttackType | string;
    hitDelay?: number;
    isAggression?: boolean;
}

export interface CombatCompanionHitActionData {
    companionNpcId: number;
    targetNpcId: number;
    damage?: number;
    maxHit?: number;
    style?: number;
    type2?: number;
    damage2?: number;
    attackType?: AttackType | string;
}

export interface CombatSpecialActionData {
    npcId?: number;
    targetId?: number;
    special?: CombatSpecialPayloadData;
}

export interface MovementTeleportActionData {
    x: number;
    y: number;
    level: number;
    forceRebuild: boolean;
    resetAnimation: boolean;
    unlockLockState?: LockState;
    endSpotAnim?: number;
    endSpotHeight?: number;
    endSpotDelay?: number;
    arriveSoundId?: number;
    arriveSoundRadius?: number;
    arriveSoundVolume?: number;
    arriveMessage?: string;
    arriveSeqId?: number;
    arriveFaceTileX?: number;
    arriveFaceTileY?: number;
    preserveAnimation?: boolean;
}

export interface EmotePlayActionData {
    emoteId?: number;
    seqId?: number;
    delayTicks?: number;
}

export type CoreActionPayloadByKind = {
    "inventory.equip": InventoryEquipActionData;
    "inventory.consume": InventoryConsumeActionData;
    "inventory.consume_script": InventoryConsumeScriptActionData;
    "inventory.use_on": InventoryUseOnActionData;
    "inventory.move": InventoryMoveActionData;
    "inventory.unequip": InventoryUnequipActionData;
    "inventory.drop": InventoryDropActionData;
    "combat.autocast": CombatAutocastActionData;
    "combat.special": CombatSpecialActionData;
    "combat.attack": CombatAttackActionData;
    "combat.playerHit": CombatPlayerHitActionData;
    "combat.npcRetaliate": CombatNpcRetaliateActionData;
    "combat.companionHit": CombatCompanionHitActionData;
    "movement.teleport": MovementTeleportActionData;
    "emote.play": EmotePlayActionData;
};

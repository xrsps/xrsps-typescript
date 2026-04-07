import {
    EquipmentSlot,
} from "../../../../src/rs/config/player/Equipment";
import {
    AttackStyle,
    type WeaponDataEntry,
} from "../combat/WeaponDataProvider";
import { getAttackStyle, getHitSoundForStyle, getMissSound } from "../combat/WeaponDataProvider";
import { AttackType } from "../combat/AttackType";
import { getMeleeAttackSequenceForCategory } from "../combat/CombatStyleSequenceProvider";
import { resolvePlayerAttackReach } from "../combat/CombatRules";
import type { PlayerState } from "../player";
import type { NpcState } from "../npc";
import type { ServerServices } from "../ServerServices";
import { logger } from "../../utils/logger";

const DEFAULT_ATTACK_SEQ = 422;
const DEFAULT_ATTACK_SPEED = 4;
const DEFAULT_HIT_SOUND = 2567;
const DEFAULT_MISS_SOUND = 2564;
const DEFAULT_MAGIC_SPLASH_SOUND = 227;
const MAGIC_CAST_SEQ = 711; // Standard magic casting animation (human_caststrike)
const MAGIC_CAST_STAFF_SEQ = 1162; // Magic casting with staff (human_caststrike_staff)
const MELEE_HIT_DELAY_TICKS = 1;
const UNARMED_PUNCH_SOUND = 2567;
const UNARMED_KICK_SOUND = 2568;
const WEAPON_SPEED_PARAM = 771;

const MAGIC_WEAPON_CATEGORY_IDS = new Set([18, 24, 29, 31]);
const RANGED_WEAPON_CATEGORY_IDS = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 19, 20, 22, 23, 26, 27, 30, 33]);

const SPELL_CAST_SEQUENCE_OVERRIDES: Record<number, number> = {
    3274: 1163, // Confuse
    3278: 1164, // Weaken
    3282: 1165, // Curse
    3325: 1168, // Enfeeble
    3326: 1169, // Stun
    3293: 724, // Crumble Undead
    9075: 725, // Superheat Item
    9110: 712, // Low Alchemy
    9111: 713, // High Alchemy
    9100: 723, // Telekinetic Grab
    9076: 726, // Charge Air Orb
    9077: 726, // Charge Earth Orb
    9078: 726, // Charge Fire Orb
    9079: 726, // Charge Water Orb
    9001: 722, // Bones to Bananas
    // Ancient Magicks – Rush / Blitz (single target)
    4629: 1978, // Smoke Rush
    4630: 1978, // Shadow Rush
    4632: 1978, // Blood Rush
    4633: 1978, // Ice Rush
    4641: 1978, // Smoke Blitz
    4642: 1978, // Shadow Blitz
    4644: 1978, // Blood Blitz
    4645: 1978, // Ice Blitz
    // Ancient Magicks – Burst / Barrage (multi-target)
    4635: 1979, // Smoke Burst
    4636: 1979, // Shadow Burst
    4638: 1979, // Blood Burst
    4639: 1979, // Ice Burst
    4647: 1979, // Smoke Barrage
    4648: 1979, // Shadow Barrage
    4650: 1979, // Blood Barrage
    4651: 1979, // Ice Barrage
};

/**
 * Player-side combat resolution: attack sequences, speeds, sounds, hit delays.
 */
export class PlayerCombatService {
    private weaponWarningsLogged = new Set<number>();

    constructor(private readonly services: ServerServices) {}

    private get weaponData(): Map<number, WeaponDataEntry> {
        return this.services.appearanceService.getWeaponData();
    }

    private ensureEquipArray(player: PlayerState): number[] {
        return this.services.equipmentService.ensureEquipArray(player);
    }

    pickAttackSequence(player: PlayerState): number {
        try {
            const spellId = player.combat.spellId;
            const autocastEnabled = !!player.combat.autocastEnabled;
            if (spellId > 0 && autocastEnabled) {
                const category = player.combat.weaponCategory ?? 0;
                if (MAGIC_WEAPON_CATEGORY_IDS.has(category)) {
                    const mapped = SPELL_CAST_SEQUENCE_OVERRIDES[spellId];
                    if (mapped) return mapped;
                    return MAGIC_CAST_STAFF_SEQ;
                }
            }

            const weaponCategory = player.combat.weaponCategory ?? 0;
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];

            if (weaponId > 0) {
                const dataEntry = this.weaponData.get(weaponId);
                if (dataEntry) {
                    const styleSlot = player.combat.styleSlot ?? 0;
                    const attackSequences = dataEntry?.attackSequences;
                    if (attackSequences) {
                        const styleAnim = attackSequences[styleSlot as 0 | 1 | 2 | 3];
                        if (styleAnim !== undefined && styleAnim >= 0) return styleAnim;
                    }
                    const overrideAttack = dataEntry?.animOverrides?.attack;
                    if (overrideAttack !== undefined && overrideAttack >= 0) return overrideAttack;
                    const attackSequence = dataEntry?.attackSequence;
                    if (attackSequence !== undefined && attackSequence >= 0) return attackSequence;
                }
            }

            const styleSlot = player.combat.styleSlot ?? 0;
            const mapped = getMeleeAttackSequenceForCategory(weaponCategory, styleSlot);
            if (mapped !== undefined && mapped > 0) return mapped;
        } catch (err) { logger.warn("[combat] failed to resolve attack sequence", err); }
        return DEFAULT_ATTACK_SEQ;
    }

    pickCombatSound(player: PlayerState, isHit: boolean): number {
        try {
            const spellId = player.combat.spellId ?? -1;
            const autocastEnabled = !!player.combat.autocastEnabled;
            const category = player.combat.weaponCategory ?? 0;
            if (spellId > 0 && autocastEnabled && MAGIC_WEAPON_CATEGORY_IDS.has(category)) {
                const stage: "impact" | "splash" = isHit ? "impact" : "splash";
                const spellSound = this.pickSpellSound(spellId, stage);
                if (spellSound !== undefined) return spellSound;
            }
            if (!isHit) return getMissSound();
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            const styleSlot = player.combat.styleSlot ?? 0;
            if (weaponId > 0) {
                const hitSound = getHitSoundForStyle(weaponId, styleSlot);
                if (hitSound !== undefined) return hitSound;
            } else {
                return styleSlot === 1 ? UNARMED_KICK_SOUND : UNARMED_PUNCH_SOUND;
            }
        } catch (err) { logger.warn("[combat] failed to resolve combat sound", err); }
        return isHit ? DEFAULT_HIT_SOUND : DEFAULT_MISS_SOUND;
    }

    pickSpellSound(spellId: number, stage: "cast" | "impact" | "splash"): number | undefined {
        const castMap: Record<number, number> = {
            3273: 220, 3281: 218, 3294: 216, 3313: 222, 21876: 4028,
            3275: 211, 3285: 209, 3297: 207, 3315: 213, 21877: 4030,
            3277: 132, 3288: 130, 3302: 128, 3319: 134, 21878: 4025,
            3279: 160, 3291: 157, 3307: 155, 3321: 162, 21879: 4032,
            3274: 119, 3278: 3011, 3282: 127, 3324: 3009, 3325: 148, 3326: 3004,
            3283: 101, 3300: 3003, 3322: 151,
            3293: 122, 9075: 190, 9110: 98, 9111: 97, 9100: 3006,
            9076: 116, 9077: 115, 9078: 117, 9079: 118, 9001: 114,
        };
        const impactMap: Record<number, number> = {
            3273: 221, 3281: 219, 3294: 217, 3313: 223, 21876: 4027,
            3275: 212, 3285: 210, 3297: 208, 3315: 214, 21877: 4029,
            3277: 133, 3288: 131, 3302: 129, 3319: 135, 21878: 4026,
            3279: 161, 3291: 158, 3307: 156, 3321: 163, 21879: 4031,
            3274: 121, 3278: 3010, 3282: 126, 3324: 3008, 3325: 150, 3326: 3005,
            3283: 99, 3300: 3002, 3322: 153,
            3293: 124, 9100: 3007,
        };
        if (stage === "cast") return castMap[spellId];
        if (stage === "impact") return impactMap[spellId];
        if (stage === "splash") return DEFAULT_MAGIC_SPLASH_SOUND;
        return undefined;
    }

    pickHitDelay(player: PlayerState): number {
        try {
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                const dataEntry = this.weaponData.get(weaponId);
                if (dataEntry?.hitDelay !== undefined && dataEntry.hitDelay > 0) return dataEntry.hitDelay;
            }
        } catch (err) { logger.warn("[combat] failed to resolve hit delay", err); }
        return MELEE_HIT_DELAY_TICKS;
    }

    resolveBaseAttackSpeed(player: PlayerState): number {
        try {
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                const dataEntry = this.weaponData.get(weaponId);
                const overrideSpeed = dataEntry?.attackSpeed;
                if (overrideSpeed !== undefined && overrideSpeed > 0) return overrideSpeed;
                const obj = this.services.dataLoaderService.getObjType(weaponId);
                if (!obj) return DEFAULT_ATTACK_SPEED;
                const rawSpeed = obj.params?.get(WEAPON_SPEED_PARAM) as number | undefined;
                if (rawSpeed !== undefined && rawSpeed > 0) return rawSpeed;
            }
        } catch (err) { logger.warn("[combat] failed to resolve attack speed", err); }
        return DEFAULT_ATTACK_SPEED;
    }

    pickAttackSpeed(player: PlayerState): number {
        const equip = this.ensureEquipArray(player);
        const weaponId = equip[EquipmentSlot.WEAPON];
        const baseSpeed = this.resolveBaseAttackSpeed(player);
        const weaponCategory = player.combat.weaponCategory ?? 0;
        const styleSlot = player.combat.styleSlot ?? 0;
        if (RANGED_WEAPON_CATEGORY_IDS.has(weaponCategory)) {
            const actualStyle = getAttackStyle(weaponId, styleSlot);
            if (actualStyle === AttackStyle.RAPID) return Math.max(1, baseSpeed - 1);
        }
        return baseSpeed;
    }

    getPlayerAttackReach(player: PlayerState): number {
        let baseRange: number | undefined;
        try {
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                const obj = this.services.dataLoaderService.getObjType(weaponId);
                const rawRange = obj?.params?.get(13) as number | undefined;
                if (rawRange !== undefined && rawRange > 0) baseRange = rawRange;
            }
        } catch (err) { logger.warn("[combat] failed to resolve attack range", err); }
        return resolvePlayerAttackReach(player.combat, { baseRange });
    }

    pickSpellCastSequence(
        player: PlayerState,
        spellId: number,
        isAutocast: boolean,
    ): number {
        const normalizedSpellId = spellId;
        const category = player.combat.weaponCategory ?? 0;
        const hasMagicWeapon = MAGIC_WEAPON_CATEGORY_IDS.has(category);

        if (hasMagicWeapon) {
            const mapped = SPELL_CAST_SEQUENCE_OVERRIDES[normalizedSpellId];
            if (mapped !== undefined && mapped >= 0) {
                return mapped;
            }
            return MAGIC_CAST_STAFF_SEQ;
        }

        if (isAutocast) {
            return this.pickAttackSequence(player);
        }
        return MAGIC_CAST_SEQ;
    }

    deriveAttackTypeFromStyle(style: number | undefined, attacker?: PlayerState): AttackType {
        const stored = attacker?.getCurrentAttackType?.();
        if (stored) return stored;
        if (style === 3 || (attacker?.combat.spellId ?? -1) > 0) return "magic";
        const category = attacker?.combat.weaponCategory ?? -1;
        if (MAGIC_WEAPON_CATEGORY_IDS.has(category)) return "magic";
        if (RANGED_WEAPON_CATEGORY_IDS.has(category)) return "ranged";
        return "melee";
    }

    pickNpcFaceTile(player: PlayerState, npc: NpcState): { x: number; y: number } {
        const size = Math.max(1, npc.size);
        let bestX = npc.tileX;
        let bestY = npc.tileY;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let dx = 0; dx < size; dx++) {
            for (let dy = 0; dy < size; dy++) {
                const tx = npc.tileX + dx;
                const ty = npc.tileY + dy;
                const dist =
                    (tx - player.tileX) * (tx - player.tileX) +
                    (ty - player.tileY) * (ty - player.tileY);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestX = tx;
                    bestY = ty;
                }
            }
        }
        return { x: bestX, y: bestY };
    }
}

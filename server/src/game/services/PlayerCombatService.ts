import {
    EquipmentSlot,
} from "../../../../src/rs/config/player/Equipment";
import {
    AttackStyle,
    type WeaponDataEntry,
    getAttackStyle,
    getHitSoundForStyle,
    getMissSound,
} from "../../../data/weapons";
import { AttackType } from "../combat/AttackType";
import { getMeleeAttackSequenceForCategory } from "../combat/CombatStyleSequences";
import { resolvePlayerAttackReach } from "../combat/CombatRules";
import type { DataLoaderService } from "./DataLoaderService";
import type { PlayerState } from "../player";
import { logger } from "../../utils/logger";

const DEFAULT_ATTACK_SEQ = 422;
const DEFAULT_ATTACK_SPEED = 4;
const DEFAULT_HIT_SOUND = 2567;
const DEFAULT_MISS_SOUND = 2564;
const DEFAULT_MAGIC_SPLASH_SOUND = 227;
const MAGIC_CAST_STAFF_SEQ = 711;
const MELEE_HIT_DELAY_TICKS = 1;
const UNARMED_PUNCH_SOUND = 2567;
const UNARMED_KICK_SOUND = 2568;
const WEAPON_SPEED_PARAM = 771;

const MAGIC_WEAPON_CATEGORY_IDS = new Set([18, 24, 29, 31]);
const RANGED_WEAPON_CATEGORY_IDS = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 19, 20, 22, 23, 26, 27, 30, 33]);

const SPELL_CAST_SEQUENCE_OVERRIDES: Record<number, number> = {};

export interface PlayerCombatServiceDeps {
    dataLoaders: DataLoaderService;
    weaponData: Map<number, WeaponDataEntry>;
    ensureEquipArray: (player: PlayerState) => number[];
}

/**
 * Player-side combat resolution: attack sequences, speeds, sounds, hit delays.
 * Extracted from WSServer.
 */
export class PlayerCombatService {
    private weaponWarningsLogged = new Set<number>();

    constructor(private readonly deps: PlayerCombatServiceDeps) {}

    pickAttackSequence(player: PlayerState): number {
        try {
            const spellId = player.combatSpellId;
            const autocastEnabled = !!player.autocastEnabled;
            if (spellId > 0 && autocastEnabled) {
                const category = player.combatWeaponCategory ?? 0;
                if (MAGIC_WEAPON_CATEGORY_IDS.has(category)) {
                    const mapped = SPELL_CAST_SEQUENCE_OVERRIDES[spellId];
                    if (mapped) return mapped;
                    return MAGIC_CAST_STAFF_SEQ;
                }
            }

            const weaponCategory = player.combatWeaponCategory ?? 0;
            const equip = this.deps.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];

            if (weaponId > 0) {
                const dataEntry = this.deps.weaponData.get(weaponId);
                if (dataEntry) {
                    const styleSlot = player.combatStyleSlot ?? 0;
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

            const styleSlot = player.combatStyleSlot ?? 0;
            const mapped = getMeleeAttackSequenceForCategory(weaponCategory, styleSlot);
            if (mapped !== undefined && mapped > 0) return mapped;
        } catch {}
        return DEFAULT_ATTACK_SEQ;
    }

    pickCombatSound(player: PlayerState, isHit: boolean): number {
        try {
            const spellId = player.combatSpellId ?? -1;
            const autocastEnabled = !!player.autocastEnabled;
            const category = player.combatWeaponCategory ?? 0;
            if (spellId > 0 && autocastEnabled && MAGIC_WEAPON_CATEGORY_IDS.has(category)) {
                const stage: "impact" | "splash" = isHit ? "impact" : "splash";
                const spellSound = this.pickSpellSound(spellId, stage);
                if (spellSound !== undefined) return spellSound;
            }
            if (!isHit) return getMissSound();
            const equip = this.deps.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            const styleSlot = player.combatStyleSlot ?? 0;
            if (weaponId > 0) {
                const hitSound = getHitSoundForStyle(weaponId, styleSlot);
                if (hitSound !== undefined) return hitSound;
            } else {
                return styleSlot === 1 ? UNARMED_KICK_SOUND : UNARMED_PUNCH_SOUND;
            }
        } catch {}
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
            const equip = this.deps.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                const dataEntry = this.deps.weaponData.get(weaponId);
                if (dataEntry?.hitDelay !== undefined && dataEntry.hitDelay > 0) return dataEntry.hitDelay;
            }
        } catch {}
        return MELEE_HIT_DELAY_TICKS;
    }

    resolveBaseAttackSpeed(player: PlayerState): number {
        try {
            const equip = this.deps.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                const dataEntry = this.deps.weaponData.get(weaponId);
                const overrideSpeed = dataEntry?.attackSpeed;
                if (overrideSpeed !== undefined && overrideSpeed > 0) return overrideSpeed;
                const obj = this.deps.dataLoaders.getObjType(weaponId);
                if (!obj) return DEFAULT_ATTACK_SPEED;
                const rawSpeed = obj.params?.get(WEAPON_SPEED_PARAM) as number | undefined;
                if (rawSpeed !== undefined && rawSpeed > 0) return rawSpeed;
            }
        } catch {}
        return DEFAULT_ATTACK_SPEED;
    }

    pickAttackSpeed(player: PlayerState): number {
        const equip = this.deps.ensureEquipArray(player);
        const weaponId = equip[EquipmentSlot.WEAPON];
        const baseSpeed = this.resolveBaseAttackSpeed(player);
        const weaponCategory = player.combatWeaponCategory ?? 0;
        const styleSlot = player.combatStyleSlot ?? 0;
        if (RANGED_WEAPON_CATEGORY_IDS.has(weaponCategory)) {
            const actualStyle = getAttackStyle(weaponId, styleSlot);
            if (actualStyle === AttackStyle.RAPID) return Math.max(1, baseSpeed - 1);
        }
        return baseSpeed;
    }

    getPlayerAttackReach(player: PlayerState): number {
        let baseRange: number | undefined;
        try {
            const equip = this.deps.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                const obj = this.deps.dataLoaders.getObjType(weaponId);
                const rawRange = obj?.params?.get(13) as number | undefined;
                if (rawRange !== undefined && rawRange > 0) baseRange = rawRange;
            }
        } catch {}
        return resolvePlayerAttackReach(player, { baseRange });
    }

    deriveAttackTypeFromStyle(style: number | undefined, attacker?: PlayerState): AttackType {
        const stored = attacker?.getCurrentAttackType?.();
        if (stored) return stored;
        if (style === 3 || (attacker?.combatSpellId ?? -1) > 0) return "magic";
        const category = attacker?.combatWeaponCategory ?? -1;
        if (MAGIC_WEAPON_CATEGORY_IDS.has(category)) return "magic";
        if (RANGED_WEAPON_CATEGORY_IDS.has(category)) return "ranged";
        return "melee";
    }
}

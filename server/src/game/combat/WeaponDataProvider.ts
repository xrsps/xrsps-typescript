export type AttackTypeValue = "stab" | "slash" | "crush" | "ranged" | "magic";

export const AttackType = {
    STAB: "stab",
    SLASH: "slash",
    CRUSH: "crush",
    RANGED: "ranged",
    MAGIC: "magic",
} as const;

export const XpMode = {
    ATTACK: "attack",
    STRENGTH: "strength",
    DEFENCE: "defence",
    SHARED: "shared",
    RANGED: "ranged",
    RANGED_DEFENCE: "ranged_defence",
    MAGIC: "magic",
    MAGIC_DEFENCE: "magic_defence",
} as const;
export type XpModeValue =
    | "attack"
    | "strength"
    | "defence"
    | "shared"
    | "ranged"
    | "ranged_defence"
    | "magic"
    | "magic_defence";

export const AttackStyle = {
    ACCURATE: "accurate",
    AGGRESSIVE: "aggressive",
    CONTROLLED: "controlled",
    DEFENSIVE: "defensive",
    RAPID: "rapid",
    LONGRANGE: "longrange",
} as const;
export type AttackStyleValue =
    | "accurate"
    | "aggressive"
    | "controlled"
    | "defensive"
    | "rapid"
    | "longrange";

export type CombatStyleData = {
    name: string;
    attackType: AttackTypeValue;
    xpMode: XpModeValue;
    attackStyle: AttackStyleValue;
};

export type WeaponDataEntry = {
    itemId: number;
    name?: string;
    equipmentType?: string;
    combatCategory?: number;
    animOverrides?: Record<string, number>;
    /** @deprecated Use attackSequences instead */
    attackSequence?: number;
    attackSequences?: {
        0?: number;
        1?: number;
        2?: number;
        3?: number;
    };
    combatStyles?: {
        0?: CombatStyleData;
        1?: CombatStyleData;
        2?: CombatStyleData;
        3?: CombatStyleData;
    };
    specialAttackAnim?: number;
    specialAttackCost?: number;
    attackSpeed?: number;
    hitDelay?: number;
    /** @deprecated Use hitSounds instead for per-attack-type sounds */
    hitSound?: number;
    hitSounds?: {
        stab?: number;
        slash?: number;
        crush?: number;
        ranged?: number;
    };
    missSound?: number;
};

export interface WeaponDataProvider {
    getWeaponData(itemId: number): WeaponDataEntry | undefined;
    getWeaponDataOrDefault(itemId: number): WeaponDataEntry;
    getAttackSpeed(itemId: number, isRapidStyle?: boolean): number;
    isRangedWeapon(itemId: number): boolean;
    isMagicWeapon(itemId: number): boolean;
    isPoweredStaff(itemId: number): boolean;
    isMeleeWeapon(itemId: number): boolean;
    getHitDelay(itemId: number): number;
    getDefaultAttackSequences(combatCategory: number): { 0: number; 1: number; 2: number; 3: number };
    getAttackAnimation(itemId: number, styleIndex?: number): number;
    getAttackSequences(itemId: number): { 0: number; 1: number; 2: number; 3: number };
    getDefaultCombatStyles(combatCategory: number): Record<number, CombatStyleData>;
    getCombatStyle(itemId: number, styleIndex?: number): CombatStyleData;
    getCombatStyles(itemId: number): Record<number, CombatStyleData>;
    getAttackType(itemId: number, styleIndex?: number): AttackTypeValue;
    getXpMode(itemId: number, styleIndex?: number): XpModeValue;
    getAttackStyle(itemId: number, styleIndex?: number): AttackStyleValue;
    getStyleBonus(attackStyle: AttackStyleValue): {
        attack: number;
        strength: number;
        defence: number;
        ranged: number;
        magic: number;
    };
    getSpecialAttack(itemId: number): { anim: number; cost: number } | undefined;
    hasSpecialAttack(itemId: number): boolean;
    getNumCombatStyles(itemId: number): number;
    getDefaultHitSounds(combatCategory: number): {
        stab?: number;
        slash?: number;
        crush?: number;
        ranged?: number;
    };
    getHitSound(itemId: number, attackType: AttackTypeValue): number | undefined;
    getHitSoundForStyle(itemId: number, styleIndex?: number): number | undefined;
    getMissSound(): number;
    getPoweredStaffCastSound(weaponId: number): number | undefined;
    getPoweredStaffImpactSound(weaponId: number): number | undefined;
    getPoweredStaffCastGfx(weaponId: number): number | undefined;
    getPoweredStaffImpactGfx(weaponId: number): number | undefined;
    getPoweredStaffSplashGfx(weaponId: number): number | undefined;
    getPoweredStaffProjectileId(weaponId: number): number | undefined;
    getRangedImpactSound(weaponId: number): number | undefined;
    getAllEntries(): ReadonlyArray<WeaponDataEntry>;
    getEntryMap(): ReadonlyMap<number, WeaponDataEntry>;
    readonly MISS_SOUND: number;
    readonly CombatCategory: typeof CombatCategoryConst;
}

export const CombatCategoryConst = {
    UNARMED: 0,
    AXE: 1,
    HAMMER: 2,
    BOW: 3,
    SCIMITAR: 9,
    CROSSBOW: 5,
    SALAMANDER: 6,
    CHINCHOMPA: 7,
    GUN: 8,
    TWO_HANDED_SWORD: 10,
    PICKAXE: 11,
    HALBERD: 12,
    STAFF: 13,
    POLESTAFF: 13,
    SCYTHE: 14,
    SPEAR: 15,
    MACE: 16,
    DAGGER: 17,
    MAGIC_STAFF: 18,
    THROWN: 19,
    WHIP: 20,
    STAFF_HALBERD: 21,
    CLAW: 4,
    POWERED_STAFF: 24,
    BLUDGEON: 27,
    BULWARK: 28,
    PARTISAN: 30,
    TUMEKEN: 24,
} as const;

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

import { getProviderRegistry } from "../providers/ProviderRegistry";

export function registerWeaponDataProvider(provider: WeaponDataProvider): void {
    getProviderRegistry().weaponData = provider;
}

export function getWeaponDataProvider(): WeaponDataProvider | undefined {
    return getProviderRegistry().weaponData;
}

function ensureProvider(): WeaponDataProvider {
    const p = getProviderRegistry().weaponData;
    if (!p) {
        throw new Error("[weapons] WeaponDataProvider not registered. Ensure the gamemode has initialized.");
    }
    return p;
}

export function getWeaponData(itemId: number): WeaponDataEntry | undefined {
    return ensureProvider().getWeaponData(itemId);
}

export function getWeaponDataOrDefault(itemId: number): WeaponDataEntry {
    return ensureProvider().getWeaponDataOrDefault(itemId);
}

export function getAttackSpeed(itemId: number, isRapidStyle?: boolean): number {
    return ensureProvider().getAttackSpeed(itemId, isRapidStyle);
}

export function isRangedWeapon(itemId: number): boolean {
    return ensureProvider().isRangedWeapon(itemId);
}

export function isMagicWeapon(itemId: number): boolean {
    return ensureProvider().isMagicWeapon(itemId);
}

export function isPoweredStaff(itemId: number): boolean {
    return ensureProvider().isPoweredStaff(itemId);
}

export function isMeleeWeapon(itemId: number): boolean {
    return ensureProvider().isMeleeWeapon(itemId);
}

export function getHitDelay(itemId: number): number {
    return ensureProvider().getHitDelay(itemId);
}

export function getDefaultAttackSequences(combatCategory: number) {
    return ensureProvider().getDefaultAttackSequences(combatCategory);
}

export function getAttackAnimation(itemId: number, styleIndex?: number): number {
    return ensureProvider().getAttackAnimation(itemId, styleIndex);
}

export function getAttackSequences(itemId: number) {
    return ensureProvider().getAttackSequences(itemId);
}

export function getDefaultCombatStyles(combatCategory: number) {
    return ensureProvider().getDefaultCombatStyles(combatCategory);
}

export function getCombatStyle(itemId: number, styleIndex?: number) {
    return ensureProvider().getCombatStyle(itemId, styleIndex);
}

export function getCombatStyles(itemId: number) {
    return ensureProvider().getCombatStyles(itemId);
}

export function getAttackType(itemId: number, styleIndex?: number) {
    return ensureProvider().getAttackType(itemId, styleIndex);
}

export function getXpMode(itemId: number, styleIndex?: number) {
    return ensureProvider().getXpMode(itemId, styleIndex);
}

export function getAttackStyle(itemId: number, styleIndex?: number) {
    return ensureProvider().getAttackStyle(itemId, styleIndex);
}

export function getStyleBonus(attackStyle: AttackStyleValue) {
    return ensureProvider().getStyleBonus(attackStyle);
}

export function getSpecialAttack(itemId: number) {
    return ensureProvider().getSpecialAttack(itemId);
}

export function hasSpecialAttack(itemId: number) {
    return ensureProvider().hasSpecialAttack(itemId);
}

export function getNumCombatStyles(itemId: number) {
    return ensureProvider().getNumCombatStyles(itemId);
}

export function getDefaultHitSounds(combatCategory: number) {
    return ensureProvider().getDefaultHitSounds(combatCategory);
}

export function getHitSound(itemId: number, attackType: AttackTypeValue) {
    return ensureProvider().getHitSound(itemId, attackType);
}

export function getHitSoundForStyle(itemId: number, styleIndex?: number) {
    return ensureProvider().getHitSoundForStyle(itemId, styleIndex);
}

export function getMissSound(): number {
    return ensureProvider().getMissSound();
}

export function getPoweredStaffCastSound(weaponId: number) {
    return ensureProvider().getPoweredStaffCastSound(weaponId);
}

export function getPoweredStaffImpactSound(weaponId: number) {
    return ensureProvider().getPoweredStaffImpactSound(weaponId);
}

export function getPoweredStaffCastGfx(weaponId: number) {
    return ensureProvider().getPoweredStaffCastGfx(weaponId);
}

export function getPoweredStaffImpactGfx(weaponId: number) {
    return ensureProvider().getPoweredStaffImpactGfx(weaponId);
}

export function getPoweredStaffSplashGfx(weaponId: number) {
    return ensureProvider().getPoweredStaffSplashGfx(weaponId);
}

export function getPoweredStaffProjectileId(weaponId: number) {
    return ensureProvider().getPoweredStaffProjectileId(weaponId);
}

export function getRangedImpactSound(weaponId: number) {
    return ensureProvider().getRangedImpactSound(weaponId);
}

/** @deprecated Access weapon data through WeaponDataProvider instead */
export const weaponDataEntries: WeaponDataEntry[] = new Proxy([] as WeaponDataEntry[], {
    get(target, prop, receiver) {
        if (_provider) {
            const entries = _provider.getAllEntries();
            if (prop === "length") return entries.length;
            if (prop === Symbol.iterator) return entries[Symbol.iterator].bind(entries);
            if (typeof prop === "string" && !isNaN(Number(prop))) {
                return entries[Number(prop)];
            }
            return Reflect.get(entries as unknown as Record<PropertyKey, unknown>, prop, receiver);
        }
        return Reflect.get(target, prop, receiver);
    },
});

/** @deprecated Access weapon data through WeaponDataProvider instead */
export const weaponDataMap: Map<number, WeaponDataEntry> = new Proxy(
    new Map<number, WeaponDataEntry>(),
    {
        get(target, prop, receiver) {
            if (_provider) {
                const map = _provider.getEntryMap();
                if (prop === "get") return map.get.bind(map);
                if (prop === "has") return map.has.bind(map);
                if (prop === "size") return map.size;
                if (prop === "entries") return map.entries.bind(map);
                if (prop === "keys") return map.keys.bind(map);
                if (prop === "values") return map.values.bind(map);
                if (prop === "forEach") return map.forEach.bind(map);
                if (prop === Symbol.iterator) return map[Symbol.iterator].bind(map);
                return Reflect.get(map as unknown as Record<PropertyKey, unknown>, prop, receiver);
            }
            return Reflect.get(target, prop, receiver);
        },
    },
);

export const MISS_SOUND = 2521;

export const DARK_BOW_SOUNDS = {
    doubleFire: 3732,
    dragonAttack: 3733,
    shadowAttack: 3736,
    impact: 3735,
    shadowImpact: 3737,
    equip: 3738,
};

export const CROSSBOW_BOLT_SOUNDS = {
    standard: 2695,
    diamond: 2913,
    grappling: 2928,
    grappleSplash: 2929,
};

export const CHINCHOMPA_SOUNDS = {
    attack: 359,
    explode: 360,
    hit: 361,
    trapped: 362,
};

export const ARROW_IMPACT_SOUNDS = {
    standard: 2693,
    launch: 2692,
    slayer: 2703,
};

export const MAGIC_DART_SOUNDS = {
    fire: 1718,
    hit: 174,
};

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

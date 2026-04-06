/**
 * Bridge module: delegates all weapon data access to the registered WeaponDataProvider.
 * The actual weapon data definitions live in server/gamemodes/vanilla/data/weapons.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
import type {
    AttackStyleValue,
    AttackTypeValue,
    WeaponDataEntry,
    WeaponDataProvider,
} from "../src/game/combat/WeaponDataProvider";

export {
    AttackType,
    AttackStyle,
    XpMode,
    CombatCategoryConst as CombatCategory,
} from "../src/game/combat/WeaponDataProvider";

export type {
    AttackTypeValue,
    AttackStyleValue,
    XpModeValue,
    CombatStyleData,
    WeaponDataEntry,
    WeaponDataProvider,
} from "../src/game/combat/WeaponDataProvider";

export {
    type PoweredStaffSpellData,
    calculatePoweredStaffBaseDamage,
    getPoweredStaffSpellData,
    hasPoweredStaffSpellData,
} from "../src/data/spells";

let _provider: WeaponDataProvider | undefined;

export function registerWeaponDataProvider(provider: WeaponDataProvider): void {
    _provider = provider;
}

export function getWeaponDataProvider(): WeaponDataProvider | undefined {
    return _provider;
}

function ensureProvider(): WeaponDataProvider {
    if (!_provider) {
        throw new Error("[weapons] WeaponDataProvider not registered. Ensure the gamemode has initialized.");
    }
    return _provider;
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
            return Reflect.get(entries as any, prop, receiver);
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
                return Reflect.get(map as any, prop, receiver);
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

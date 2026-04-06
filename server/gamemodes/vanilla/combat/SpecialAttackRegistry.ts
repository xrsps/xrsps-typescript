/**
 * Vanilla Special Attack Registry
 *
 * OSRS-accurate special attack system.
 * Each weapon has a defined special attack with:
 * - Energy cost (25%, 50%, 55%, 60%, 100%)
 * - Accuracy/damage multipliers
 * - Special effects (freeze, heal, drain, etc.)
 * - Custom animations and graphics
 */
import type {
    SpecialAttackDef,
    SpecialAttackProvider,
} from "../../../src/game/combat/SpecialAttackProvider";

// =============================================================================
// Special Attack Registry
// =============================================================================

class SpecialAttackRegistryImpl implements SpecialAttackProvider {
    private readonly specs = new Map<number, SpecialAttackDef>();

    constructor() {
        this.registerAllSpecials();
    }

    get(weaponId: number): SpecialAttackDef | undefined {
        return this.specs.get(weaponId);
    }

    has(weaponId: number): boolean {
        return this.specs.has(weaponId);
    }

    getEnergyCost(weaponId: number): number {
        return this.specs.get(weaponId)?.energyCost ?? 0;
    }

    resolveAmmoModifiers(
        specialDef: SpecialAttackDef,
        ammoId: number,
    ): {
        damageMultiplier: number;
        minDamagePerHit: number;
        maxDamagePerHit?: number;
        graphicId?: number;
        projectileId?: number;
        soundId?: number;
        name: string;
    } {
        if (!specialDef.ammoModifiers) {
            return {
                damageMultiplier: specialDef.damageMultiplier,
                minDamagePerHit: specialDef.minDamagePerHit ?? 0,
                maxDamagePerHit: specialDef.maxDamagePerHit,
                graphicId: specialDef.graphicId,
                projectileId: specialDef.projectileId,
                soundId: specialDef.soundId,
                name: specialDef.name,
            };
        }

        const specificMod = specialDef.ammoModifiers[ammoId];
        if (specificMod) {
            return {
                damageMultiplier: specificMod.damageMultiplier,
                minDamagePerHit: specificMod.minDamagePerHit,
                maxDamagePerHit: specificMod.maxDamagePerHit,
                graphicId: specificMod.graphicId ?? specialDef.graphicId,
                projectileId: specificMod.projectileId ?? specialDef.projectileId,
                soundId: specificMod.soundId ?? specialDef.soundId,
                name: specificMod.name ?? specialDef.name,
            };
        }

        const defaultMod = specialDef.ammoModifiers.default;
        if (defaultMod) {
            return {
                damageMultiplier: defaultMod.damageMultiplier,
                minDamagePerHit: defaultMod.minDamagePerHit,
                maxDamagePerHit: defaultMod.maxDamagePerHit,
                graphicId: defaultMod.graphicId ?? specialDef.graphicId,
                projectileId: defaultMod.projectileId ?? specialDef.projectileId,
                soundId: defaultMod.soundId ?? specialDef.soundId,
                name: defaultMod.name ?? specialDef.name,
            };
        }

        return {
            damageMultiplier: specialDef.damageMultiplier,
            minDamagePerHit: specialDef.minDamagePerHit ?? 0,
            maxDamagePerHit: specialDef.maxDamagePerHit,
            graphicId: specialDef.graphicId,
            projectileId: specialDef.projectileId,
            soundId: specialDef.soundId,
            name: specialDef.name,
        };
    }

    applyDarkBowDamageModifiers(
        damage: number,
        minDamage: number,
        maxDamage: number | undefined,
        hitLanded: boolean,
    ): number {
        if (!hitLanded) {
            return minDamage;
        }
        let adjustedDamage = damage;
        if (adjustedDamage < minDamage) {
            adjustedDamage = minDamage;
        }
        if (maxDamage !== undefined && adjustedDamage > maxDamage) {
            adjustedDamage = maxDamage;
        }
        return adjustedDamage;
    }

    isDarkBow(weaponId: number): boolean {
        return (
            weaponId === 11235 ||
            weaponId === 12765 ||
            weaponId === 12766 ||
            weaponId === 12767 ||
            weaponId === 12768
        );
    }

    calculateDragonClawsHits(maxHit: number, hitRolls: number[]): number[] {
        const hits: number[] = [0, 0, 0, 0];

        if (hitRolls[0] > 0) {
            const first = hitRolls[0];
            hits[0] = first;
            hits[1] = Math.floor(first / 2);
            hits[2] = Math.floor(first / 4);
            hits[3] = Math.floor(first / 4) + (first % 4 >= 2 ? 1 : 0);
        } else if (hitRolls[1] > 0) {
            const second = hitRolls[1];
            hits[0] = 0;
            hits[1] = second;
            hits[2] = Math.floor(second / 2);
            hits[3] = Math.floor(second / 2) + (second % 2);
        } else if (hitRolls[2] > 0) {
            const third = hitRolls[2];
            hits[0] = 0;
            hits[1] = 0;
            hits[2] = Math.floor(third * 0.75);
            hits[3] = Math.floor(third * 0.75) + (Math.floor(third * 0.5) % 2);
        } else {
            hits[0] = 0;
            hits[1] = 0;
            hits[2] = 0;
            hits[3] = hitRolls[3] > 0 ? Math.floor(maxHit * 1.5) : 0;
        }

        return hits;
    }

    canGraniteMaulCombo(
        weaponId: number,
        lastAttackTick: number,
        currentTick: number,
    ): boolean {
        const isGmaul = weaponId === 4153 || weaponId === 12848;
        return isGmaul && currentTick === lastAttackTick;
    }

    private register(def: SpecialAttackDef): void {
        for (const weaponId of def.weaponIds) {
            this.specs.set(weaponId, def);
        }
    }

    private registerAllSpecials(): void {
        // =====================================================================
        // Godswords
        // =====================================================================

        this.register({
            name: "The Judgment",
            weaponIds: [11802, 20368],
            energyCost: 50,
            accuracyMultiplier: 2.0,
            damageMultiplier: 1.375,
            hitCount: 1,
            animationId: 7644,
            graphicId: 1211,
            soundId: 3869,
        });

        this.register({
            name: "Warstrike",
            weaponIds: [11804, 20370],
            energyCost: 50,
            accuracyMultiplier: 2.0,
            damageMultiplier: 1.21,
            hitCount: 1,
            effects: {
                drainDefenceByDamage: 1.0,
            },
            animationId: 7642,
            graphicId: 1212,
            soundId: 3865,
        });

        this.register({
            name: "Healing Blade",
            weaponIds: [11806, 20372],
            energyCost: 50,
            accuracyMultiplier: 2.0,
            damageMultiplier: 1.1,
            hitCount: 1,
            effects: {
                healFraction: 0.5,
                prayerFraction: 0.25,
            },
            animationId: 7640,
            graphicId: 1209,
            soundId: 3866,
        });

        this.register({
            name: "Ice Cleave",
            weaponIds: [11808, 20374],
            energyCost: 50,
            accuracyMultiplier: 2.0,
            damageMultiplier: 1.1,
            hitCount: 1,
            effects: {
                freezeTicks: 33,
            },
            animationId: 7638,
            graphicId: 1210,
            targetGraphicId: 369,
            soundId: 3867,
        });

        // =====================================================================
        // Dragon Weapons
        // =====================================================================

        this.register({
            name: "Puncture",
            weaponIds: [1215, 1231, 5680, 5698],
            energyCost: 25,
            accuracyMultiplier: 1.15,
            damageMultiplier: 1.15,
            hitCount: 2,
            effects: {
                doubleHit: true,
            },
            animationId: 1062,
            graphicId: 252,
            soundId: 2537,
        });

        this.register({
            name: "Cleave",
            weaponIds: [1305],
            energyCost: 25,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.15,
            hitCount: 1,
            animationId: 1058,
            graphicId: 248,
            soundId: 2529,
        });

        this.register({
            name: "Rampage",
            weaponIds: [1377],
            energyCost: 100,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 0,
            effects: {},
            animationId: 1056,
            graphicId: 246,
            soundId: 2530,
        });

        this.register({
            name: "Shatter",
            weaponIds: [1434],
            energyCost: 25,
            accuracyMultiplier: 1.25,
            damageMultiplier: 1.5,
            hitCount: 1,
            animationId: 1060,
            graphicId: 251,
            soundId: 2541,
        });

        this.register({
            name: "Sever",
            weaponIds: [4587],
            energyCost: 55,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            effects: {},
            animationId: 1872,
            graphicId: 347,
            soundId: 2540,
        });

        this.register({
            name: "Sweep",
            weaponIds: [3204],
            energyCost: 30,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.1,
            hitCount: 2,
            animationId: 1203,
            graphicId: 282,
            soundId: 2533,
        });

        this.register({
            name: "Shove",
            weaponIds: [1249, 1263, 5716, 5730],
            energyCost: 25,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 0,
            effects: {
                stunTicks: 5,
            },
            animationId: 1064,
            soundId: 2544,
        });

        this.register({
            name: "Smash",
            weaponIds: [13576],
            energyCost: 50,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.5,
            hitCount: 1,
            effects: {
                drainDefence: 0.3,
            },
            animationId: 1378,
            graphicId: 1292,
            soundId: 2541,
        });

        this.register({
            name: "Slice and Dice",
            weaponIds: [13652, 20784],
            energyCost: 50,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 4,
            effects: {
                quadHit: true,
            },
            animationId: 7514,
            graphicId: 1171,
            hitSounds: [4138, 4140, 4141, 4141],
        });

        // =====================================================================
        // Abyssal Weapons
        // =====================================================================

        this.register({
            name: "Energy Drain",
            weaponIds: [4151, 12773, 12774, 12006],
            energyCost: 50,
            accuracyMultiplier: 1.25,
            damageMultiplier: 1.0,
            hitCount: 1,
            effects: {
                drainRunEnergy: 10,
            },
            animationId: 1658,
            soundId: 2713,
        });

        this.register({
            name: "Abyssal Puncture",
            weaponIds: [13265, 13267, 13269, 13271],
            energyCost: 50,
            accuracyMultiplier: 1.25,
            damageMultiplier: 0.85,
            hitCount: 2,
            effects: {
                doubleHit: true,
            },
            animationId: 3300,
            graphicId: 1283,
            soundId: 2537,
        });

        this.register({
            name: "Penance",
            weaponIds: [13263],
            energyCost: 50,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            animationId: 3299,
            graphicId: 1284,
            soundId: 3302,
        });

        // =====================================================================
        // Barrows Weapons
        // =====================================================================

        this.register({
            name: "Defiler",
            weaponIds: [4755],
            energyCost: 100,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            effects: {
                ignoreProtectionPrayer: true,
            },
        });

        // =====================================================================
        // Ranged Weapons
        // =====================================================================

        this.register({
            name: "Descent of Darkness",
            weaponIds: [11235, 12765, 12766, 12767, 12768],
            energyCost: 55,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.3,
            hitCount: 2,
            attackType: "ranged",
            animationId: 426,
            graphicId: 1101,
            soundId: 3736,
            minDamagePerHit: 5,
            ammoModifiers: {
                11212: {
                    damageMultiplier: 1.5,
                    minDamagePerHit: 8,
                    maxDamagePerHit: 48,
                    graphicId: 1099,
                    projectileId: 1099,
                    name: "Descent of Dragons",
                    soundId: 3733,
                },
                11227: {
                    damageMultiplier: 1.5,
                    minDamagePerHit: 8,
                    maxDamagePerHit: 48,
                    graphicId: 1099,
                    projectileId: 1099,
                    name: "Descent of Dragons",
                    soundId: 3733,
                },
                11228: {
                    damageMultiplier: 1.5,
                    minDamagePerHit: 8,
                    maxDamagePerHit: 48,
                    graphicId: 1099,
                    projectileId: 1099,
                    name: "Descent of Dragons",
                    soundId: 3733,
                },
                11229: {
                    damageMultiplier: 1.5,
                    minDamagePerHit: 8,
                    maxDamagePerHit: 48,
                    graphicId: 1099,
                    projectileId: 1099,
                    name: "Descent of Dragons",
                    soundId: 3733,
                },
                default: {
                    damageMultiplier: 1.3,
                    minDamagePerHit: 5,
                    graphicId: 1101,
                    projectileId: 1101,
                    name: "Descent of Darkness",
                    soundId: 3736,
                },
            },
        });

        this.register({
            name: "Snapshot",
            weaponIds: [861, 12788],
            energyCost: 55,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 2,
            attackType: "ranged",
            animationId: 1074,
            soundId: 2545,
        });

        this.register({
            name: "Armadyl Eye",
            weaponIds: [11785],
            energyCost: 40,
            accuracyMultiplier: 2.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            attackType: "ranged",
            animationId: 4230,
            graphicId: 301,
            soundId: 3870,
        });

        this.register({
            name: "Annihilate",
            weaponIds: [21902],
            energyCost: 60,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.2,
            hitCount: 1,
            attackType: "ranged",
            animationId: 7552,
            graphicId: 1438,
            soundId: 2545,
        });

        this.register({
            name: "Toxic Siphon",
            weaponIds: [12926],
            energyCost: 50,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.5,
            hitCount: 1,
            attackType: "ranged",
            effects: {
                healFraction: 0.5,
            },
            animationId: 5061,
            graphicId: 1043,
            soundId: 2697,
        });

        this.register({
            name: "Concentrated Shot",
            weaponIds: [19478, 19481],
            energyCost: 65,
            accuracyMultiplier: 1.25,
            damageMultiplier: 1.25,
            hitCount: 1,
            attackType: "ranged",
            animationId: 7222,
            soundId: 3739,
        });

        this.register({
            name: "Evoke",
            weaponIds: [26374],
            energyCost: 75,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            attackType: "ranged",
            effects: {
                guaranteedFirstHit: true,
            },
            soundId: 3870,
        });

        // =====================================================================
        // Magic Weapons
        // =====================================================================

        this.register({
            name: "Power of Death",
            weaponIds: [11791, 12904, 22296],
            energyCost: 100,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 0,
            attackType: "magic",
            animationId: 7967,
            graphicId: 1228,
        });

        this.register({
            name: "Invocate",
            weaponIds: [24424],
            energyCost: 75,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            attackType: "magic",
            effects: {
                prayerFraction: 0.5,
                drainPrayerByDamage: true,
            },
        });

        this.register({
            name: "Immolate",
            weaponIds: [24422],
            energyCost: 55,
            accuracyMultiplier: 1.5,
            damageMultiplier: 1.0,
            hitCount: 1,
            attackType: "magic",
        });

        // =====================================================================
        // Other Melee Weapons
        // =====================================================================

        this.register({
            name: "Quick Smash",
            weaponIds: [4153, 12848],
            energyCost: 50,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            animationId: 1667,
            graphicId: 340,
            soundId: 2715,
        });

        this.register({
            name: "Saradomin's Lightning",
            weaponIds: [11838],
            energyCost: 100,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.1,
            hitCount: 1,
            effects: {},
            animationId: 7515,
            graphicId: 1194,
            targetGraphicId: 1195,
            soundId: 3853,
        });

        this.register({
            name: "Saradomin's Lightning",
            weaponIds: [12809],
            energyCost: 65,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.25,
            hitCount: 1,
            effects: {},
            animationId: 7515,
            graphicId: 1194,
            targetGraphicId: 1195,
            soundId: 3853,
        });

        this.register({
            name: "Demonbane",
            weaponIds: [19675],
            energyCost: 50,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            effects: {},
            animationId: 2890,
        });

        this.register({
            name: "Backstab",
            weaponIds: [8872],
            energyCost: 75,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            effects: {
                drainDefence: 1.0,
            },
            animationId: 4198,
            graphicId: 704,
        });

        this.register({
            name: "Sweep",
            weaponIds: [13080, 13091, 23987, 23995],
            energyCost: 30,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.1,
            hitCount: 2,
            animationId: 1203,
            graphicId: 282,
        });

        this.register({
            name: "Ruthless Impale",
            weaponIds: [26219],
            energyCost: 25,
            accuracyMultiplier: 1.5,
            damageMultiplier: 1.0,
            hitCount: 1,
            animationId: 6118,
        });

        this.register({
            name: "Blood Sacrifice",
            weaponIds: [26233],
            energyCost: 50,
            accuracyMultiplier: 2.0,
            damageMultiplier: 1.1,
            hitCount: 1,
            effects: {},
            animationId: 9171,
            graphicId: 2006,
            targetGraphicId: 2005,
        });

        this.register({
            name: "Disrupt",
            weaponIds: [27690],
            energyCost: 50,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            attackType: "magic",
            effects: {
                guaranteedFirstHit: true,
            },
            animationId: 9620,
            graphicId: 2373,
            targetGraphicId: 2374,
        });

        this.register({
            name: "Soul Harvest",
            weaponIds: [28338],
            energyCost: 50,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 1,
            effects: {},
            animationId: 10171,
            graphicId: 2582,
        });

        this.register({
            name: "Reap",
            weaponIds: [22325, 22486, 22664],
            energyCost: 100,
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            hitCount: 3,
            animationId: 8056,
        });
    }
}

export function createSpecialAttackProvider(): SpecialAttackProvider {
    return new SpecialAttackRegistryImpl();
}

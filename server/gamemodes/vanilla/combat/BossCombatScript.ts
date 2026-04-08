import { BossScript, registerBossScript } from "../../../src/game/combat/BossScriptFramework";

export {
    BossScript,
    BossPhase,
    BossSpecialAttack,
    BossMechanic,
    registerBossScript,
    getBossScript,
    createBossScript,
} from "../../../src/game/combat/BossScriptFramework";

// ============================================
// Boss Implementations
// ============================================

class GiantMoleScript extends BossScript {
    protected initialize(): void {
        this.addPhase({
            name: "Normal",
            attackPatterns: ["claw", "stomp"],
            mechanics: ["dig_escape"],
        });

        this.addSpecialAttack({
            name: "claw",
            cooldown: 4,
            animation: 3312,
            minDamage: 1,
            maxDamage: 21,
            style: "melee",
        });

        this.addSpecialAttack({
            name: "stomp",
            cooldown: 6,
            animation: 3313,
            minDamage: 5,
            maxDamage: 30,
            style: "melee",
            aoeRadius: 1,
        });

        this.addMechanic({
            name: "dig_escape",
            interval: 10,
            shouldActivate: (boss) => {
                const npc = boss.getNpc();
                const hpPercent = npc.getHitpoints() / npc.getMaxHitpoints();
                return hpPercent < 0.5 && Math.random() < 0.15;
            },
            tick: (boss) => {
                // Teleport to random location in lair
            },
        });
    }
}

class DagannothRexScript extends BossScript {
    protected initialize(): void {
        this.addPhase({
            name: "Normal",
            attackPatterns: ["melee_attack"],
        });

        this.addSpecialAttack({
            name: "melee_attack",
            cooldown: 4,
            animation: 2853,
            minDamage: 1,
            maxDamage: 26,
            style: "melee",
        });
    }

    protected getAttackSpeed(): number {
        return 4;
    }
}

class DagannothPrimeScript extends BossScript {
    protected initialize(): void {
        this.addPhase({
            name: "Normal",
            attackPatterns: ["magic_attack"],
        });

        this.addSpecialAttack({
            name: "magic_attack",
            cooldown: 4,
            animation: 2854,
            projectile: 162,
            minDamage: 1,
            maxDamage: 50,
            style: "magic",
        });
    }
}

class DagannothSupremeScript extends BossScript {
    protected initialize(): void {
        this.addPhase({
            name: "Normal",
            attackPatterns: ["ranged_attack"],
        });

        this.addSpecialAttack({
            name: "ranged_attack",
            cooldown: 4,
            animation: 2855,
            projectile: 294,
            minDamage: 1,
            maxDamage: 30,
            style: "ranged",
        });
    }
}

class GeneralGraardorScript extends BossScript {
    protected initialize(): void {
        this.addPhase({
            name: "Normal",
            attackPatterns: ["melee_attack", "ranged_attack"],
        });

        this.addSpecialAttack({
            name: "melee_attack",
            cooldown: 6,
            animation: 7018,
            minDamage: 1,
            maxDamage: 60,
            style: "melee",
        });

        this.addSpecialAttack({
            name: "ranged_attack",
            cooldown: 6,
            animation: 7021,
            minDamage: 1,
            maxDamage: 35,
            style: "ranged",
            aoeRadius: 15,
            condition: (boss) => {
                return Math.random() < 0.33;
            },
        });
    }

    protected getAttackSpeed(): number {
        return 6;
    }
}

class ZulrahScript extends BossScript {
    protected initialize(): void {
        this.addPhase({
            name: "Green",
            attackPatterns: ["ranged_attack", "venom_cloud"],
            hpThresholdPercent: 100,
        });

        this.addPhase({
            name: "Blue",
            attackPatterns: ["magic_attack", "venom_cloud"],
            hpThresholdPercent: 75,
            onEnter: (boss) => {
                // boss.getNpc().setTransformation(2043);
            },
        });

        this.addPhase({
            name: "Red",
            attackPatterns: ["melee_attack"],
            hpThresholdPercent: 50,
            onEnter: (boss) => {
                // boss.getNpc().setTransformation(2044);
            },
        });

        this.addPhase({
            name: "Green Final",
            attackPatterns: ["ranged_attack", "venom_cloud", "snakeling"],
            hpThresholdPercent: 25,
            onEnter: (boss) => {
                // boss.getNpc().setTransformation(2042);
            },
        });

        this.addSpecialAttack({
            name: "ranged_attack",
            cooldown: 4,
            animation: 5069,
            projectile: 1044,
            minDamage: 1,
            maxDamage: 41,
            style: "ranged",
        });

        this.addSpecialAttack({
            name: "magic_attack",
            cooldown: 4,
            animation: 5069,
            projectile: 1046,
            minDamage: 1,
            maxDamage: 41,
            style: "magic",
        });

        this.addSpecialAttack({
            name: "melee_attack",
            cooldown: 3,
            animation: 5806,
            minDamage: 1,
            maxDamage: 32,
            style: "melee",
        });

        this.addSpecialAttack({
            name: "venom_cloud",
            cooldown: 12,
            animation: 5069,
            minDamage: 0,
            maxDamage: 0,
            style: "typeless",
            execute: (boss, target) => {
                // Spawn venom cloud at target location
            },
        });

        this.addSpecialAttack({
            name: "snakeling",
            cooldown: 20,
            animation: 5069,
            minDamage: 0,
            maxDamage: 0,
            style: "typeless",
            execute: (boss, target) => {
                // Spawn snakeling NPCs
            },
        });
    }

    protected getAttackSpeed(): number {
        return 4;
    }
}

registerBossScript(5779, GiantMoleScript); // Giant Mole
registerBossScript(2265, DagannothRexScript); // Dagannoth Rex
registerBossScript(2266, DagannothPrimeScript); // Dagannoth Prime
registerBossScript(2267, DagannothSupremeScript); // Dagannoth Supreme
registerBossScript(2215, GeneralGraardorScript); // General Graardor
registerBossScript(2042, ZulrahScript); // Zulrah

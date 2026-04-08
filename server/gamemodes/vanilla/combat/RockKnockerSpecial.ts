import { SkillId } from "../../../../src/rs/skill/skills";
import type { InstantUtilitySpecialProvider } from "../../../src/game/combat/InstantUtilitySpecialProvider";
import type { PlayerState } from "../../../src/game/player";

export const ROCK_KNOCKER_SOUND_ID = 2530; // dragon_axe_thunder
export const ROCK_KNOCKER_MINING_BOOST = 3;
export const FISHSTABBER_FISHING_BOOST = 3;
export const LUMBER_UP_WOODCUTTING_BOOST = 3;

const ROCK_KNOCKER_SEQ_BY_WEAPON = new Map<number, number>([
    [11920, 7138], // Dragon pickaxe
    [12797, 334], // Dragon pickaxe (pretty)
    [13243, 3410], // Infernal pickaxe
    [20014, 7267], // 3rd age pickaxe
    [23677, 8330], // Dragon pickaxe (or)
    [23680, 8329], // Crystal pickaxe
    [23682, 8329], // Crystal pickaxe (inactive)
    [25063, 3410], // Infernal pickaxe (or)
    [25112, 11821], // Echo pickaxe
    [25369, 3410], // Infernal pickaxe (uncharged)
    [25376, 8330], // Dragon pickaxe (or)
]);

const FISHSTABBER_SEQ_BY_WEAPON = new Map<number, number>([
    [21028, 7401], // Dragon harpoon
    [21031, 7402], // Infernal harpoon
    [21033, 7402], // Infernal harpoon (uncharged)
    [23762, 8336], // Crystal harpoon
    [23764, 8336], // Crystal harpoon (inactive)
    [25059, 8784], // Infernal harpoon (or)
    [25114, 8784], // Echo harpoon
    [25367, 8784], // Infernal harpoon (uncharged, or)
    [25373, 88], // Dragon harpoon (or)
    [30342, 11867], // Echo harpoon (reloaded)
    [30343, 11867], // Echo harpoon (reloaded, empty)
    [30349, 11868], // Echo harpoon (reloaded, no infernal)
]);

const LUMBER_UP_SEQ_BY_WEAPON = new Map<number, number>([
    [6739, 2846], // Dragon axe
    [13241, 2117], // Infernal axe
    [13242, 2117], // Infernal axe (uncharged)
    [20011, 7264], // 3rd age axe
    [23673, 8324], // Crystal axe
    [23675, 8324], // Crystal axe (inactive)
    [25066, 12026], // Infernal axe (or)
    [25110, 12025], // Echo axe
    [25371, 24], // Infernal axe (uncharged, or)
    [25378, 24], // Dragon axe (or)
    [28217, 10071], // Dragon felling axe
    [28220, 10072], // Crystal felling axe
    [28223, 10073], // Crystal felling axe (inactive)
    [28226, 10074], // 3rd age felling axe
    [30347, 11939], // Infernal axe (or, reloaded)
    [30348, 11940], // Infernal axe (uncharged, reloaded)
    [30352, 11940], // Dragon axe (or, reloaded)
]);

type RockKnockerBoostPlayer = Pick<PlayerState, "skillSystem">;
type InstantUtilityMarkerCarrier = Record<string, number | undefined> | null | undefined;

const INSTANT_UTILITY_SPECIAL_HANDLED_TICK_KEY = "__instantUtilitySpecialHandledTick";

export function getRockKnockerSpecialSequence(weaponObjId: number): number | undefined {
    return ROCK_KNOCKER_SEQ_BY_WEAPON.get(weaponObjId);
}

export function getFishstabberSpecialSequence(weaponObjId: number): number | undefined {
    return FISHSTABBER_SEQ_BY_WEAPON.get(weaponObjId);
}

export function getLumberUpSpecialSequence(weaponObjId: number): number | undefined {
    return LUMBER_UP_SEQ_BY_WEAPON.get(weaponObjId);
}

export function markInstantUtilitySpecialHandledAtTick(
    player: InstantUtilityMarkerCarrier,
    tick: number,
): void {
    if (!player || !Number.isFinite(tick)) return;
    player[INSTANT_UTILITY_SPECIAL_HANDLED_TICK_KEY] = tick;
}

export function wasInstantUtilitySpecialHandledAtTick(
    player: InstantUtilityMarkerCarrier,
    tick: number,
): boolean {
    if (!player || !Number.isFinite(tick)) return false;
    const previous = player[INSTANT_UTILITY_SPECIAL_HANDLED_TICK_KEY];
    return previous !== undefined && previous === tick;
}

export function applyRockKnockerMiningBoost(player: RockKnockerBoostPlayer): void {
    const miningSkill = player.skillSystem.getSkill(SkillId.Mining);
    const baseLevel = Math.max(1, miningSkill.baseLevel);
    const boost = miningSkill.boost;
    const currentLevel = Math.max(1, baseLevel + boost);
    const targetLevel = Math.max(currentLevel, baseLevel + ROCK_KNOCKER_MINING_BOOST);
    player.skillSystem.setSkillBoost(SkillId.Mining, targetLevel);
}

export function applyFishstabberFishingBoost(player: RockKnockerBoostPlayer): void {
    const fishingSkill = player.skillSystem.getSkill(SkillId.Fishing);
    const baseLevel = Math.max(1, fishingSkill.baseLevel);
    const boost = fishingSkill.boost;
    const currentLevel = Math.max(1, baseLevel + boost);
    const targetLevel = Math.max(currentLevel, baseLevel + FISHSTABBER_FISHING_BOOST);
    player.skillSystem.setSkillBoost(SkillId.Fishing, targetLevel);
}

export function applyLumberUpWoodcuttingBoost(player: RockKnockerBoostPlayer): void {
    const woodcuttingSkill = player.skillSystem.getSkill(SkillId.Woodcutting);
    const baseLevel = Math.max(1, woodcuttingSkill.baseLevel);
    const boost = woodcuttingSkill.boost;
    const currentLevel = Math.max(1, baseLevel + boost);
    const targetLevel = Math.max(currentLevel, baseLevel + LUMBER_UP_WOODCUTTING_BOOST);
    player.skillSystem.setSkillBoost(SkillId.Woodcutting, targetLevel);
}

export function createInstantUtilitySpecialProvider(): InstantUtilitySpecialProvider {
    return {
        getInstantUtilitySpecial(weaponId) {
            const rkSeq = getRockKnockerSpecialSequence(weaponId);
            if (rkSeq !== undefined) return { kind: "rock_knocker", seqId: rkSeq, soundId: ROCK_KNOCKER_SOUND_ID };
            const fsSeq = getFishstabberSpecialSequence(weaponId);
            if (fsSeq !== undefined) return { kind: "fishstabber", seqId: fsSeq };
            const luSeq = getLumberUpSpecialSequence(weaponId);
            if (luSeq !== undefined) return { kind: "lumber_up", seqId: luSeq };
            return undefined;
        },
        applySpecialBoost(player, kind) {
            if (kind === "rock_knocker") applyRockKnockerMiningBoost(player);
            else if (kind === "fishstabber") applyFishstabberFishingBoost(player);
            else applyLumberUpWoodcuttingBoost(player);
        },
        markHandledAtTick: markInstantUtilitySpecialHandledAtTick,
        wasHandledAtTick: wasInstantUtilitySpecialHandledAtTick,
    };
}

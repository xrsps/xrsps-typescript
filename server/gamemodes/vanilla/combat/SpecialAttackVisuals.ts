import type { SpecialAttackVisualProvider } from "../../../src/game/combat/SpecialAttackVisualProvider";
import { getItemDefinition } from "../../../src/game/scripts/types";

const SPEC_ANIM_DRAGON_DAGGER = 1062;
const SPEC_SPOT_DRAGON_DAGGER = 252;
const SPEC_ANIM_DRAGON_SCIMITAR = 1872;
const SPEC_SPOT_DRAGON_SCIMITAR_TRAIL = 347;
const SPEC_ANIM_GODSWORD = 7004;
const SPEC_SPOT_GODSWORD_ZAMORAK = 1205;
const SPEC_SPOT_GODSWORD_ARMADYL = 1206;
const SPEC_SPOT_GODSWORD_SARADOMIN = 1207;
const SPEC_SPOT_GODSWORD_BANDOS = 1208;

export function pickSpecialAttackVisualOverride(
    weaponItemId: number,
): { seqId?: number; spotId?: number; spotHeight?: number } | undefined {
    if (!(weaponItemId > 0)) return undefined;
    const def = getItemDefinition(weaponItemId);
    const name = (def?.name ?? "").toString().toLowerCase();

    if (name.includes("dragon dagger")) {
        return { seqId: SPEC_ANIM_DRAGON_DAGGER, spotId: SPEC_SPOT_DRAGON_DAGGER };
    }

    if (name.includes("dragon scimitar")) {
        return {
            seqId: SPEC_ANIM_DRAGON_SCIMITAR,
            spotId: SPEC_SPOT_DRAGON_SCIMITAR_TRAIL,
        };
    }

    if (name.includes("godsword")) {
        if (name.includes("zamorak godsword")) {
            return { seqId: SPEC_ANIM_GODSWORD, spotId: SPEC_SPOT_GODSWORD_ZAMORAK };
        }
        if (name.includes("armadyl godsword")) {
            return { seqId: SPEC_ANIM_GODSWORD, spotId: SPEC_SPOT_GODSWORD_ARMADYL };
        }
        if (name.includes("saradomin godsword")) {
            return { seqId: SPEC_ANIM_GODSWORD, spotId: SPEC_SPOT_GODSWORD_SARADOMIN };
        }
        if (name.includes("bandos godsword")) {
            return { seqId: SPEC_ANIM_GODSWORD, spotId: SPEC_SPOT_GODSWORD_BANDOS };
        }
    }

    return undefined;
}

export function createSpecialAttackVisualProvider(): SpecialAttackVisualProvider {
    return { pickSpecialAttackVisualOverride };
}

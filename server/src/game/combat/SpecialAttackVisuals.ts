import { getItemDefinition } from "../../data/items";
import {
    SPEC_ANIM_DRAGON_DAGGER,
    SPEC_SPOT_DRAGON_DAGGER,
    SPEC_ANIM_DRAGON_SCIMITAR,
    SPEC_SPOT_DRAGON_SCIMITAR_TRAIL,
    SPEC_ANIM_GODSWORD,
    SPEC_SPOT_GODSWORD_ZAMORAK,
    SPEC_SPOT_GODSWORD_ARMADYL,
    SPEC_SPOT_GODSWORD_SARADOMIN,
    SPEC_SPOT_GODSWORD_BANDOS,
} from "../../network/wsServerTypes";

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

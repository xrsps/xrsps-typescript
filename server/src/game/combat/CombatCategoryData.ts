import type { DbRepository } from "../../../../src/rs/config/db/DbRepository";
import { AttackType } from "./AttackType";

const COMBAT_DB_TABLE_ID = 78;

function parseTooltipForAttackType(text: string | undefined): AttackType {
    if (!text) return "melee";
    const normalized = text.toLowerCase();
    if (normalized.includes("magic xp")) {
        return "magic";
    }
    if (normalized.includes("ranged xp") || normalized.includes("range xp")) {
        return "ranged";
    }
    return "melee";
}

// Map combat style button labels/tooltips to melee accuracy bonus index.
// Indices correspond to ObjType attack bonuses: 0=stab,1=slash,2=crush.
function parseMeleeBonusIndex(
    label: string | undefined,
    tooltip: string | undefined,
): number | undefined {
    const combined = `${label ?? ""} ${tooltip ?? ""}`.toLowerCase();
    if (!combined.trim()) return undefined;

    // Stab-style names in OSRS interfaces.
    if (
        combined.includes("stab") ||
        combined.includes("lunge") ||
        combined.includes("poke") ||
        combined.includes("jab") ||
        combined.includes("impale") ||
        combined.includes("spike")
    ) {
        return 0;
    }

    // Slash-style names.
    if (
        combined.includes("slash") ||
        combined.includes("chop") ||
        combined.includes("hack") ||
        combined.includes("slice") ||
        combined.includes("reap") ||
        combined.includes("sweep")
    ) {
        return 1;
    }

    // Crush-style names.
    if (
        combined.includes("crush") ||
        combined.includes("smash") ||
        combined.includes("pound") ||
        combined.includes("bash") ||
        combined.includes("clobber")
    ) {
        return 2;
    }

    return undefined;
}

export class CombatCategoryData {
    private readonly attackTypes = new Map<number, AttackType[]>();
    private readonly meleeBonusIndices = new Map<number, Array<number | undefined>>();

    constructor(repo: DbRepository) {
        try {
            const rows = repo.getRows(COMBAT_DB_TABLE_ID);
            for (const row of rows) {
                const idColumn = row.columns.get(0);
                const buttonsColumn = row.columns.get(1);
                if (!idColumn || !buttonsColumn) continue;
                const categoryIdValue = idColumn.values?.[0];
                if (typeof categoryIdValue !== "number" || !Number.isFinite(categoryIdValue)) {
                    continue;
                }
                const categoryId = categoryIdValue;
                const stride = buttonsColumn.types.length;
                if (stride < 4) continue;
                const slots: AttackType[] = [];
                const meleeIdx: Array<number | undefined> = [];
                for (let idx = 0; idx < buttonsColumn.values.length; idx += stride) {
                    const slotValue = buttonsColumn.values[idx];
                    const label = String(buttonsColumn.values[idx + 1] ?? "");
                    const tooltip = String(buttonsColumn.values[idx + 2] ?? "");
                    const slot =
                        typeof slotValue === "number" && Number.isInteger(slotValue)
                            ? slotValue
                            : undefined;
                    if (slot === undefined) continue;
                    slots[slot] = parseTooltipForAttackType(tooltip);
                    meleeIdx[slot] = parseMeleeBonusIndex(label, tooltip);
                }
                if (slots.length > 0) {
                    this.attackTypes.set(categoryId, slots);
                    this.meleeBonusIndices.set(categoryId, meleeIdx);
                }
            }
        } catch (err) {
            console.warn("[CombatCategoryData] failed to load DB rows", err);
        }
    }

    getAttackTypes(categoryId: number | undefined): AttackType[] | undefined {
        if (categoryId === undefined) return undefined;
        const types = this.attackTypes.get(categoryId);
        return types ? types.slice() : undefined;
    }

    getMeleeBonusIndices(categoryId: number | undefined): Array<number | undefined> | undefined {
        if (categoryId === undefined) return undefined;
        const indices = this.meleeBonusIndices.get(categoryId);
        return indices ? indices.slice() : undefined;
    }
}

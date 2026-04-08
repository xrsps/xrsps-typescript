export const AttackType = {
    Melee: "melee",
    Ranged: "ranged",
    Magic: "magic",
} as const;
export type AttackType = (typeof AttackType)[keyof typeof AttackType];

const ATTACK_TYPE_VALUES = new Set<string>(Object.values(AttackType));

export function normalizeAttackType(value: unknown): AttackType | undefined {
    if (typeof value === "string" && ATTACK_TYPE_VALUES.has(value)) {
        return value as AttackType;
    }
    if (value !== undefined && value !== null) {
        const lower = String(value).toLowerCase();
        if (ATTACK_TYPE_VALUES.has(lower)) {
            return lower as AttackType;
        }
    }
    return undefined;
}

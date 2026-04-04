import { ClientState } from "../../../client/ClientState";
import type { WidgetNode } from "../WidgetNode";

/**
 * Minimal context required to evaluate CS1 (IF1) widget comparisons.
 * Mirrors the reference client data sources used by class345.runCs1 /
 * SecureRandomCallable.method2318.
 */
export type Cs1Context = {
    getWidgetByUid(uid: number): WidgetNode | undefined;
    osrsClient?: any;
};

// Reference: Skills.Skills_enabled (r215).
const SKILLS_ENABLED: boolean[] = [
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    false,
];

// Reference: Skills.Skills_experienceTable (r215).
const SKILLS_XP_TABLE: Int32Array = (() => {
    const out = new Int32Array(99);
    let acc = 0;
    for (let i = 0; i < 99; i++) {
        const level = i + 1;
        const step = (level + 300.0 * Math.pow(2.0, level / 7.0)) | 0;
        acc = (acc + step) | 0;
        out[i] = (acc / 4) | 0;
    }
    return out;
})();

function getVarManager(ctx?: Cs1Context): any | undefined {
    try {
        return ctx?.osrsClient?.varManager;
    } catch {
        return undefined;
    }
}

function getSkillsMap(ctx?: Cs1Context): Map<number, any> | undefined {
    try {
        const map = ctx?.osrsClient?.skillsMap;
        return map instanceof Map ? (map as Map<number, any>) : undefined;
    } catch {
        return undefined;
    }
}

function getSkillCurrentLevel(ctx: Cs1Context | undefined, skillId: number): number {
    const entry = getSkillsMap(ctx)?.get(skillId | 0);
    const level = entry?.currentLevel;
    return Number.isFinite(level) ? level | 0 : 1;
}

function getSkillBaseLevel(ctx: Cs1Context | undefined, skillId: number): number {
    const entry = getSkillsMap(ctx)?.get(skillId | 0);
    const level = entry?.baseLevel;
    return Number.isFinite(level) ? level | 0 : 1;
}

function getSkillXp(ctx: Cs1Context | undefined, skillId: number): number {
    const entry = getSkillsMap(ctx)?.get(skillId | 0);
    const xp = entry?.xp;
    return Number.isFinite(xp) ? xp | 0 : 0;
}

function isMembersWorld(ctx: Cs1Context | undefined): boolean {
    try {
        const flag = ctx?.osrsClient?.isMembersWorld;
        return typeof flag === "boolean" ? flag : true;
    } catch {
        return true;
    }
}

function isMembersItem(ctx: Cs1Context | undefined, itemId: number): boolean {
    try {
        const loader = ctx?.osrsClient?.objTypeLoader;
        const def = loader?.load?.(itemId | 0);
        return !!def?.isMembers;
    } catch {
        return false;
    }
}

function getRunEnergy(ctx: Cs1Context | undefined): number {
    try {
        const units = ctx?.osrsClient?.runEnergyUnits;
        return Number.isFinite(units) ? units | 0 : 0;
    } catch {
        return 0;
    }
}

function getWeight(ctx: Cs1Context | undefined): number {
    try {
        const weight = ctx?.osrsClient?.playerWeight;
        return Number.isFinite(weight) ? weight | 0 : 0;
    } catch {
        return 0;
    }
}

function getPlayerWorldTileX(ctx: Cs1Context | undefined): number {
    try {
        const osrsClient = ctx?.osrsClient;
        const pe = osrsClient?.playerEcs;
        const serverId = osrsClient?.controlledPlayerServerId;
        const idx =
            pe && typeof pe.getIndexForServerId === "function"
                ? pe.getIndexForServerId(serverId | 0)
                : undefined;
        if (idx === undefined) return 0;
        const x = pe.getX(idx);
        return (x >> 7) | 0;
    } catch {
        return 0;
    }
}

function getPlayerWorldTileY(ctx: Cs1Context | undefined): number {
    try {
        const osrsClient = ctx?.osrsClient;
        const pe = osrsClient?.playerEcs;
        const serverId = osrsClient?.controlledPlayerServerId;
        const idx =
            pe && typeof pe.getIndexForServerId === "function"
                ? pe.getIndexForServerId(serverId | 0)
                : undefined;
        if (idx === undefined) return 0;
        const y = pe.getY(idx);
        return (y >> 7) | 0;
    } catch {
        return 0;
    }
}

/**
 * OSRS PARITY: CS1 comparison execution for IF1 widgets.
 * Reference: class345.runCs1() and SecureRandomCallable.method2318().
 */
export function runCs1(widget: WidgetNode, ctx?: Cs1Context): boolean {
    const comparisons = widget.cs1Comparisons;
    if (!comparisons) return false;
    const comparisonValues = widget.cs1ComparisonValues;
    if (!comparisonValues) return false;

    for (let i = 0; i < comparisons.length; i++) {
        const value = evalCs1Instruction(widget, i, ctx);
        const target = comparisonValues[i] | 0;
        const op = comparisons[i] | 0;
        if (op === 2) {
            if (value >= target) return false;
        } else if (op === 3) {
            if (value <= target) return false;
        } else if (op === 4) {
            if (value === target) return false;
        } else if ((value | 0) !== (target | 0)) {
            return false;
        }
    }

    return true;
}

/**
 * OSRS PARITY: Evaluate CS1 instruction list (SecureRandomCallable.method2318).
 */
export function evalCs1Instruction(widget: WidgetNode, index: number, ctx?: Cs1Context): number {
    const all = widget.cs1Instructions;
    if (!all || index < 0 || index >= all.length) return -2;

    try {
        const instr = all[index];
        let acc = 0;
        let pos = 0;
        let pendingOp = 0; // 0=add, 1=sub, 2=div, 3=mul

        while (true) {
            const opcode = instr[pos++] | 0;
            let value = 0;
            let nextOp = 0;

            if (opcode === 0) {
                return acc | 0;
            }

            if (opcode === 1) {
                value = getSkillCurrentLevel(ctx, instr[pos++] | 0) | 0;
            } else if (opcode === 2) {
                value = getSkillBaseLevel(ctx, instr[pos++] | 0) | 0;
            } else if (opcode === 3) {
                value = getSkillXp(ctx, instr[pos++] | 0) | 0;
            } else if (opcode === 4) {
                const group = instr[pos++] | 0;
                const child = instr[pos++] | 0;
                const uid = ((group & 0xffff) << 16) | (child & 0xffff);
                const w = ctx?.getWidgetByUid(uid);
                const itemId = instr[pos++] | 0;
                if (w && itemId !== -1 && (!isMembersItem(ctx, itemId) || isMembersWorld(ctx))) {
                    const itemIds = w.itemIds;
                    const itemQuantities = w.itemQuantities;
                    if (Array.isArray(itemIds) && Array.isArray(itemQuantities)) {
                        for (let i = 0; i < itemIds.length; i++) {
                            if (((itemId + 1) | 0) === (itemIds[i] | 0)) {
                                value = (value + (itemQuantities[i] | 0)) | 0;
                            }
                        }
                    }
                }
            } else if (opcode === 5) {
                const varpId = instr[pos++] | 0;
                const varManager = getVarManager(ctx);
                value = (varManager?.getVarp?.(varpId) ?? 0) | 0;
            } else if (opcode === 6) {
                const skillId = instr[pos++] | 0;
                const base = getSkillBaseLevel(ctx, skillId) | 0;
                const idx = Math.max(0, Math.min(98, (base - 1) | 0));
                value = SKILLS_XP_TABLE[idx] | 0;
            } else if (opcode === 7) {
                const varpId = instr[pos++] | 0;
                const varManager = getVarManager(ctx);
                const raw = (varManager?.getVarp?.(varpId) ?? 0) | 0;
                value = ((raw * 100) / 46875) | 0;
            } else if (opcode === 8) {
                value = (ClientState.localPlayerCombatLevel ?? 3) | 0;
            } else if (opcode === 9) {
                let total = 0;
                for (let s = 0; s < 25; s++) {
                    if (SKILLS_ENABLED[s]) {
                        total = (total + (getSkillBaseLevel(ctx, s) | 0)) | 0;
                    }
                }
                value = total | 0;
            } else if (opcode === 10) {
                const group = instr[pos++] | 0;
                const child = instr[pos++] | 0;
                const uid = ((group & 0xffff) << 16) | (child & 0xffff);
                const w = ctx?.getWidgetByUid(uid);
                const itemId = instr[pos++] | 0;
                if (w && itemId !== -1 && (!isMembersItem(ctx, itemId) || isMembersWorld(ctx))) {
                    const itemIds = w.itemIds;
                    if (Array.isArray(itemIds)) {
                        for (let i = 0; i < itemIds.length; i++) {
                            if (((itemId + 1) | 0) === (itemIds[i] | 0)) {
                                value = 999999999;
                                break;
                            }
                        }
                    }
                }
            } else if (opcode === 11) {
                value = getRunEnergy(ctx) | 0;
            } else if (opcode === 12) {
                value = getWeight(ctx) | 0;
            } else if (opcode === 13) {
                const varpId = instr[pos++] | 0;
                const bit = instr[pos++] | 0;
                const varManager = getVarManager(ctx);
                const raw = (varManager?.getVarp?.(varpId) ?? 0) | 0;
                value = (raw & (1 << bit)) !== 0 ? 1 : 0;
            } else if (opcode === 14) {
                const varbitId = instr[pos++] | 0;
                const varManager = getVarManager(ctx);
                value = (varManager?.getVarbit?.(varbitId) ?? 0) | 0;
            } else if (opcode === 15) {
                nextOp = 1;
            } else if (opcode === 16) {
                nextOp = 2;
            } else if (opcode === 17) {
                nextOp = 3;
            } else if (opcode === 18) {
                value = getPlayerWorldTileX(ctx) | 0;
            } else if (opcode === 19) {
                value = getPlayerWorldTileY(ctx) | 0;
            } else if (opcode === 20) {
                value = instr[pos++] | 0;
            }

            if (nextOp === 0) {
                if (pendingOp === 0) {
                    acc = (acc + value) | 0;
                } else if (pendingOp === 1) {
                    acc = (acc - value) | 0;
                } else if (pendingOp === 2) {
                    if (value !== 0) acc = (acc / value) | 0;
                } else if (pendingOp === 3) {
                    acc = Math.imul(acc | 0, value | 0) | 0;
                }
                pendingOp = 0;
            } else {
                pendingOp = nextOp | 0;
            }
        }
    } catch {
        return -1;
    }
}

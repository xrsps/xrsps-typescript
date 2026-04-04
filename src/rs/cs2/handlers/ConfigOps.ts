/**
 * Config operations: ObjType, NpcType, LocType, Struct, Enum parameters
 */
import {
    getCollectionLogEnumCountOverride,
    getCollectionLogEnumValueOverride,
    getCollectionLogStructParamOverride,
} from "../../../shared/collectionlog/custom";
import {
    getCustomEnumCountOverride,
    getCustomEnumValueOverride,
    getCustomStructParam,
    getRelicOrMasteryStructParam,
    getLeagueTaskStructParam,
} from "../../../shared/leagues/GamemodeContentStore";
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

export function registerConfigOps(handlers: HandlerMap): void {
    // === ObjType (Item) ===
    handlers.set(Opcodes.OC_NAME, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const name = ctx.objTypeLoader?.load(itemId)?.name ?? "null";
        ctx.pushString(name);
    });

    handlers.set(Opcodes.OC_OP, (ctx) => {
        const opIndex = ctx.intStack[--ctx.intStackSize];
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        ctx.pushString(obj?.groundActions?.[opIndex - 1] ?? "");
    });

    handlers.set(Opcodes.OC_IOP, (ctx) => {
        const opIndex = ctx.intStack[--ctx.intStackSize];
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        ctx.pushString(obj?.inventoryActions?.[opIndex - 1] ?? "");
    });

    handlers.set(Opcodes.OC_COST, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const cost = ctx.objTypeLoader?.load(itemId)?.price ?? 0;
        ctx.pushInt(cost);
    });

    handlers.set(Opcodes.OC_STACKABLE, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // Check if stackability is ALWAYS (1) - default (0) is NEVER
        const stackable = obj?.stackability === 1;
        ctx.pushInt(stackable ? 1 : 0);
    });

    handlers.set(Opcodes.OC_CERT, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // note = the noted version of this item
        ctx.pushInt(obj?.notedId ?? -1);
    });

    handlers.set(Opcodes.OC_UNCERT, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // unnotedId = the unnoted version of this item
        ctx.pushInt(obj?.unnotedId ?? -1);
    });

    handlers.set(Opcodes.OC_MEMBERS, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const members = ctx.objTypeLoader?.load(itemId)?.isMembers ?? false;
        ctx.pushInt(members ? 1 : 0);
    });

    handlers.set(Opcodes.OC_PLACEHOLDER, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // OSRS parity (see ScriptOpcodes.OC_PLACEHOLDER):
        // If this item has a placeholder defined (placeholder >= 0) and is NOT itself a placeholder
        // (placeholderTemplate == -1), return the placeholder item id; else return the input id.
        if (obj && (obj.placeholderTemplate | 0) === -1 && (obj.placeholder | 0) >= 0) {
            ctx.pushInt(obj.placeholder | 0);
        } else {
            ctx.pushInt(itemId | 0);
        }
    });

    handlers.set(Opcodes.OC_UNPLACEHOLDER, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // OSRS parity (see ScriptOpcodes.OC_UNPLACEHOLDER):
        // If this item IS a placeholder (placeholderTemplate >= 0 && placeholder >= 0), return the
        // original/underlying item id stored in placeholder; else return the input id.
        if (obj && (obj.placeholderTemplate | 0) >= 0 && (obj.placeholder | 0) >= 0) {
            ctx.pushInt(obj.placeholder | 0);
        } else {
            ctx.pushInt(itemId | 0);
        }
    });

    handlers.set(Opcodes.OC_FIND, (ctx) => {
        // Start item search - searches item names containing the query string
        const query = ctx.stringStack[--ctx.stringStackSize].toLowerCase();

        // Clear previous search results
        ctx.itemSearchResults = [];
        ctx.itemSearchIndex = 0;

        if (query.length > 0 && ctx.objTypeLoader) {
            // Search through all items for matching names
            // Note: This searches items 0-65535 which covers all standard items
            const maxItemId = 65535;
            for (let id = 0; id < maxItemId; id++) {
                const obj = ctx.objTypeLoader.load(id);
                if (obj && obj.name && obj.name !== "null") {
                    if (obj.name.toLowerCase().includes(query)) {
                        ctx.itemSearchResults.push(id);
                    }
                }
            }
        }

        ctx.pushInt(ctx.itemSearchResults.length);
    });

    handlers.set(Opcodes.OC_FINDNEXT, (ctx) => {
        if (ctx.itemSearchIndex < ctx.itemSearchResults.length) {
            ctx.pushInt(ctx.itemSearchResults[ctx.itemSearchIndex++]);
        } else {
            ctx.pushInt(-1); // no more results
        }
    });

    handlers.set(Opcodes.OC_FINDRESET, (ctx) => {
        // Reset search state
        ctx.itemSearchResults = [];
        ctx.itemSearchIndex = 0;
    });

    handlers.set(Opcodes.OC_SHIFTCLICKIOP, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // Returns the shift-click inventory option index (1-based for iop), or -1 if none
        const shiftIndex = obj?.getShiftClickIndex?.() ?? -1;
        // Convert to 1-based iop index for script usage (scripts expect 1-5, not 0-4)
        ctx.pushInt(shiftIndex >= 0 ? shiftIndex + 1 : -1);
    });

    // oc_isubop(obj, opIndex, subIndex) - gets inventory sub-operation text for an item
    // Used for nested menu actions like "Use" -> "Use with X"
    // Note: Sub-operations are rarely used in modern OSRS, return empty string
    handlers.set(Opcodes.OC_ISUBOP, (ctx) => {
        const subIndex = ctx.intStack[--ctx.intStackSize];
        const opIndex = ctx.intStack[--ctx.intStackSize];
        const itemId = ctx.intStack[--ctx.intStackSize];
        // Most items don't have sub-operations defined
        // This is primarily a legacy feature, return empty string
        ctx.pushString("");
    });

    handlers.set(Opcodes.OC_PARAM, (ctx) => {
        const paramId = ctx.intStack[--ctx.intStackSize];
        const itemId = ctx.intStack[--ctx.intStackSize];
        const param = ctx.paramTypeLoader?.load(paramId);
        const obj = ctx.objTypeLoader?.load(itemId);
        if (param && obj && obj.params) {
            const val = obj.params.get(paramId);
            if (param.isString()) {
                ctx.pushString(typeof val === "string" ? val : param.defaultString || "");
            } else {
                ctx.pushInt(typeof val === "number" ? val : param.defaultInt || 0);
            }
        } else {
            if (param?.isString()) {
                ctx.pushString(param.defaultString || "");
            } else {
                ctx.pushInt(param?.defaultInt ?? 0);
            }
        }
    });

    // === NpcType ===
    handlers.set(Opcodes.NC_NAME, (ctx) => {
        const npcId = ctx.intStack[--ctx.intStackSize];
        const name = ctx.npcTypeLoader?.load(npcId)?.name ?? "";
        ctx.pushString(name);
    });

    handlers.set(Opcodes.NC_PARAM, (ctx) => {
        const paramId = ctx.intStack[--ctx.intStackSize];
        const npcId = ctx.intStack[--ctx.intStackSize];
        const param = ctx.paramTypeLoader?.load(paramId);
        const npc = ctx.npcTypeLoader?.load(npcId);
        if (param && npc && npc.params) {
            const val = npc.params.get(paramId);
            if (param.isString()) {
                ctx.pushString(typeof val === "string" ? val : param.defaultString || "");
            } else {
                ctx.pushInt(typeof val === "number" ? val : param.defaultInt || 0);
            }
        } else {
            if (param?.isString()) {
                ctx.pushString(param.defaultString || "");
            } else {
                ctx.pushInt(param?.defaultInt ?? 0);
            }
        }
    });

    // === LocType ===
    handlers.set(Opcodes.LC_NAME, (ctx) => {
        const locId = ctx.intStack[--ctx.intStackSize];
        const name = ctx.locTypeLoader?.load(locId)?.name ?? "";
        ctx.pushString(name);
    });

    handlers.set(Opcodes.LC_PARAM, (ctx) => {
        const paramId = ctx.intStack[--ctx.intStackSize];
        const locId = ctx.intStack[--ctx.intStackSize];
        const param = ctx.paramTypeLoader?.load(paramId);
        const loc = ctx.locTypeLoader?.load(locId);
        if (param && loc && loc.params) {
            const val = loc.params.get(paramId);
            if (param.isString()) {
                ctx.pushString(typeof val === "string" ? val : param.defaultString || "");
            } else {
                ctx.pushInt(typeof val === "number" ? val : param.defaultInt || 0);
            }
        } else {
            if (param?.isString()) {
                ctx.pushString(param.defaultString || "");
            } else {
                ctx.pushInt(param?.defaultInt ?? 0);
            }
        }
    });

    // === StructType ===
    handlers.set(Opcodes.STRUCT_PARAM, (ctx) => {
        const paramId = ctx.intStack[--ctx.intStackSize];
        const structId = ctx.intStack[--ctx.intStackSize];
        const param = ctx.paramTypeLoader?.load(paramId);

        // Collection log definitions are data-driven and override cache struct params.
        const collectionLogOverride = getCollectionLogStructParamOverride(structId, paramId);
        if (collectionLogOverride !== undefined) {
            if (typeof collectionLogOverride === "string") {
                ctx.pushString(collectionLogOverride);
            } else {
                ctx.pushInt(collectionLogOverride | 0);
            }
            return;
        }

        // Check for custom content override first (centralized registry)
        let overrideVal = getCustomStructParam(structId, paramId);
        // Then check for cache league task data
        if (overrideVal === undefined) {
            overrideVal = getLeagueTaskStructParam(structId, paramId);
        }
        // Then check for relic/mastery override
        if (overrideVal === undefined) {
            overrideVal = getRelicOrMasteryStructParam(structId, paramId);
        }

        if (param && overrideVal !== undefined) {
            if (param.isString()) {
                ctx.pushString(
                    typeof overrideVal === "string" ? overrideVal : param.defaultString || "",
                );
            } else {
                ctx.pushInt(typeof overrideVal === "number" ? overrideVal : param.defaultInt || 0);
            }
            return;
        }
        const struct = ctx.structTypeLoader?.load(structId);
        if (param && struct && struct.params) {
            const val = struct.params.get(paramId);
            if (param.isString()) {
                ctx.pushString(typeof val === "string" ? val : param.defaultString || "");
            } else {
                ctx.pushInt(typeof val === "number" ? val : param.defaultInt || 0);
            }
        } else {
            if (param?.isString()) {
                ctx.pushString(param.defaultString || "");
            } else {
                ctx.pushInt(param?.defaultInt ?? 0);
            }
        }
    });

    // === EnumType ===
    // enum(outputType, inputType, enumId, key) - pops 4 values
    handlers.set(Opcodes.ENUM, (ctx) => {
        let key = ctx.intStack[--ctx.intStackSize];
        const enumId = ctx.intStack[--ctx.intStackSize];
        const inputType = ctx.intStack[--ctx.intStackSize]; // type code (not used, but must pop)
        const outputType = ctx.intStack[--ctx.intStackSize]; // type code (not used, but must pop)

        // Collection log enums are server-configurable and override cache enum values.
        const collectionLogEnumValue = getCollectionLogEnumValueOverride(enumId, key);
        if (collectionLogEnumValue !== undefined) {
            ctx.pushInt(collectionLogEnumValue | 0);
            return;
        }

        const enumType = ctx.enumTypeLoader?.load(enumId);
        const baseCount = enumType?.outputCount ?? 0;

        // Check for custom content enum override
        // - Tasks are prepended (inserted at beginning)
        // - Challenges are prepended (inserted at beginning)
        const customOverride = getCustomEnumValueOverride(enumId, key, baseCount);

        if (customOverride) {
            if ("custom" in customOverride) {
                ctx.pushInt(customOverride.custom);
                return;
            }
            // Shift the key to account for inserted custom content
            key = customOverride.shiftedKey;
        }

        if (enumType?.outputType === "s") {
            if (enumType.stringValues) {
                const idx = enumType.keys?.indexOf(key) ?? -1;
                const result =
                    idx >= 0 ? enumType.stringValues[idx] : enumType.defaultString ?? "null";
                ctx.pushString(result);
            } else {
                ctx.pushString(enumType.defaultString ?? "null");
            }
        } else {
            if (enumType?.intValues) {
                const idx = enumType.keys?.indexOf(key) ?? -1;
                const result = idx >= 0 ? enumType.intValues[idx] : enumType.defaultInt ?? -1;
                ctx.pushInt(result);
            } else {
                ctx.pushInt(enumType?.defaultInt ?? -1);
            }
        }
    });

    handlers.set(Opcodes.ENUM_STRING, (ctx) => {
        const key = ctx.intStack[--ctx.intStackSize];
        const enumId = ctx.intStack[--ctx.intStackSize];

        const collectionLogEnumValue = getCollectionLogEnumValueOverride(enumId, key);
        if (collectionLogEnumValue !== undefined) {
            ctx.pushString(String(collectionLogEnumValue | 0));
            return;
        }

        const enumType = ctx.enumTypeLoader?.load(enumId);
        if (enumType && enumType.stringValues) {
            const idx = enumType.keys?.indexOf(key) ?? -1;
            ctx.pushString(
                idx >= 0 ? enumType.stringValues[idx] : enumType.defaultString ?? "null",
            );
        } else {
            ctx.pushString(enumType?.defaultString ?? "null");
        }
    });

    handlers.set(Opcodes.ENUM_GETOUTPUTCOUNT, (ctx) => {
        const enumId = ctx.intStack[--ctx.intStackSize];

        const collectionLogCount = getCollectionLogEnumCountOverride(enumId);
        if (collectionLogCount !== undefined) {
            ctx.pushInt(collectionLogCount);
            return;
        }

        const enumType = ctx.enumTypeLoader?.load(enumId);
        const baseCount = enumType?.outputCount ?? 0;
        // Add custom content count from centralized registry
        const customCount = getCustomEnumCountOverride(enumId);
        ctx.pushInt(baseCount + customCount);
    });

    // === Map Element Category ===
    handlers.set(Opcodes.MEC_TEXT, (ctx) => {
        const mecId = ctx.intStack[--ctx.intStackSize];
        ctx.pushString(""); // stub
    });

    handlers.set(Opcodes.MEC_TEXTSIZE, (ctx) => {
        const mecId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(0); // stub
    });

    handlers.set(Opcodes.MEC_CATEGORY, (ctx) => {
        const mecId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(0); // stub
    });

    handlers.set(Opcodes.MEC_SPRITE, (ctx) => {
        const mecId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(-1); // stub
    });
}

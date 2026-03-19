/**
 * Server-side spell widget loader.
 * Mirrors the client/CS2 contract: spell buttons come from spell item params in the cache.
 */
import type { CacheInfo } from "../../../src/rs/cache/CacheInfo";
import { CacheSystem } from "../../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../../src/rs/cache/loader/CacheLoaderFactory";
import type { EnumTypeLoader } from "../../../src/rs/config/enumtype/EnumTypeLoader";
import type { ObjTypeLoader } from "../../../src/rs/config/objtype/ObjTypeLoader";

export const SPELLBOOK_GROUP_ID = 218;

export type SpellbookName = "standard" | "ancient" | "lunar" | "arceuus";

export type SpellWidgetInfo = {
    objectId: number;
    name: string;
    groupId: number;
    fileId: number;
    spellbook?: SpellbookName;
};

const SPELLBOOK_ROOT_ENUM_ID = 1981;
const SPELL_BUTTON_PARAM_ID = 596;
const SPELL_NAME_PARAM_ID = 601;

const SPELLBOOK_ENUM_KEY_TO_NAME: Record<number, SpellbookName> = {
    0: "standard",
    1: "ancient",
    2: "lunar",
    3: "arceuus",
};

const SPELL_NAME_LOOKUP_ALIASES: Record<string, string[]> = {
    "ape atoll teleport (arceuus)": ["ape atoll teleport"],
    "carrallangar teleport": ["carrallanger teleport"],
    "home teleport": ["lumbridge home teleport"],
    "monster examine": ["monster inspect"],
};

const spellWidgetsByName = new Map<string, SpellWidgetInfo[]>();

function normalizeSpellName(name: string): string {
    return name.toLowerCase().trim();
}

function getSpellNameLookupKeys(spellName: string): string[] {
    const normalizedName = normalizeSpellName(spellName);
    const keys = new Set<string>([normalizedName]);
    for (const alias of SPELL_NAME_LOOKUP_ALIASES[normalizedName] ?? []) {
        keys.add(normalizeSpellName(alias));
    }
    return [...keys];
}

function safeLoadObjType(objLoader: ObjTypeLoader, objId: number) {
    try {
        return objLoader.load(objId);
    } catch {
        return undefined;
    }
}

function safeLoadEnumType(enumLoader: EnumTypeLoader, enumId: number) {
    try {
        return enumLoader.load(enumId);
    } catch {
        return undefined;
    }
}

function buildSpellWidgetInfo(
    objLoader: ObjTypeLoader,
    objId: number,
    spellbook?: SpellbookName,
): SpellWidgetInfo | undefined {
    const objType = safeLoadObjType(objLoader, objId);
    const componentHash = objType?.params?.get(SPELL_BUTTON_PARAM_ID);
    if (typeof componentHash !== "number") {
        return undefined;
    }

    const rawName = objType?.params?.get(SPELL_NAME_PARAM_ID);
    let name: string | undefined;
    if (typeof rawName === "string" && rawName.trim().length > 0) {
        name = rawName.trim();
    } else if (typeof objType?.name === "string" && objType.name.trim().length > 0) {
        name = objType.name.trim();
    }
    if (!name) {
        return undefined;
    }

    return {
        objectId: objId,
        name,
        groupId: (componentHash >>> 16) & 0xffff,
        fileId: componentHash & 0xffff,
        spellbook,
    };
}

function collectSpellWidgetInfos(
    enumLoader: EnumTypeLoader,
    objLoader: ObjTypeLoader,
    enumId: number,
    spellbook: SpellbookName | undefined,
    seenEnums: Set<string>,
    seenWidgets: Set<string>,
    output: SpellWidgetInfo[],
): void {
    const enumVisitKey = `${spellbook ?? "unknown"}:${enumId}`;
    if (seenEnums.has(enumVisitKey)) {
        return;
    }
    seenEnums.add(enumVisitKey);

    const enumType = safeLoadEnumType(enumLoader, enumId);
    if (!enumType?.intValues || !enumType.keys || !enumType.outputCount) {
        return;
    }

    for (let index = 0; index < enumType.outputCount; index++) {
        const value = enumType.intValues[index];
        if (typeof value !== "number") {
            continue;
        }

        const key = enumType.keys[index];
        const resolvedSpellbook = SPELLBOOK_ENUM_KEY_TO_NAME[key] ?? spellbook;
        const spellWidget = buildSpellWidgetInfo(objLoader, value, resolvedSpellbook);
        if (spellWidget) {
            const widgetKey = `${resolvedSpellbook ?? "unknown"}:${spellWidget.objectId}:${spellWidget.groupId}:${spellWidget.fileId}`;
            if (seenWidgets.has(widgetKey)) {
                continue;
            }
            seenWidgets.add(widgetKey);
            output.push(spellWidget);
            continue;
        }

        collectSpellWidgetInfos(
            enumLoader,
            objLoader,
            value,
            resolvedSpellbook,
            seenEnums,
            seenWidgets,
            output,
        );
    }
}

function loadSpellWidgetInfos(cacheInfo: CacheInfo, cache: CacheSystem): SpellWidgetInfo[] {
    const cacheFactory = getCacheLoaderFactory(cacheInfo, cache);
    const enumLoader = cacheFactory.getEnumTypeLoader();
    if (!enumLoader) {
        console.warn("[SpellWidgetLoader] Enum loader unavailable; spell widget mapping is empty");
        spellWidgetsByName.clear();
        return [];
    }

    const objLoader = cacheFactory.getObjTypeLoader();
    const spellWidgets: SpellWidgetInfo[] = [];
    collectSpellWidgetInfos(
        enumLoader,
        objLoader,
        SPELLBOOK_ROOT_ENUM_ID,
        undefined,
        new Set<string>(),
        new Set<string>(),
        spellWidgets,
    );

    spellWidgetsByName.clear();
    for (const spellWidget of spellWidgets) {
        const normalizedName = normalizeSpellName(spellWidget.name);
        const existing = spellWidgetsByName.get(normalizedName);
        if (existing) {
            existing.push(spellWidget);
        } else {
            spellWidgetsByName.set(normalizedName, [spellWidget]);
        }
    }

    return spellWidgets;
}

/**
 * Build a spell name -> (groupId, fileId) lookup.
 * Populates the runtime widget lookup from live cache spell data.
 */
export function buildSpellNameToWidgetMap(
    cacheInfo: CacheInfo,
    cache: CacheSystem,
): Map<string, { groupId: number; fileId: number }> {
    const result = new Map<string, { groupId: number; fileId: number }>();
    const spellWidgets = loadSpellWidgetInfos(cacheInfo, cache);

    for (const spellWidget of spellWidgets) {
        const normalizedName = normalizeSpellName(spellWidget.name);
        if (!result.has(normalizedName)) {
            result.set(normalizedName, {
                groupId: spellWidget.groupId,
                fileId: spellWidget.fileId,
            });
        }
    }

    console.log(
        `[SpellWidgetLoader] Loaded ${spellWidgets.length} spell widget records (${result.size} unique names)`,
    );
    return result;
}

export function getSpellWidgetInfo(
    spellName: string,
    spellbook?: SpellbookName,
): SpellWidgetInfo | undefined {
    const lookupKeys = getSpellNameLookupKeys(spellName);
    for (const lookupKey of lookupKeys) {
        const spellWidgets = spellWidgetsByName.get(lookupKey);
        if (!spellWidgets?.length) {
            continue;
        }

        if (spellbook) {
            const spellWidget = spellWidgets.find((candidate) => candidate.spellbook === spellbook);
            if (spellWidget) {
                return spellWidget;
            }
            continue;
        }

        return spellWidgets[0];
    }
    return undefined;
}

/**
 * Get the current widget child ID for a spell button by name.
 */
export function getSpellWidgetId(spellName: string, spellbook?: SpellbookName): number | undefined {
    return getSpellWidgetInfo(spellName, spellbook)?.fileId;
}

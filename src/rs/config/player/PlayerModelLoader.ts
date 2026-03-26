import { Model } from "../../model/Model";
import { ModelData } from "../../model/ModelData";
import { ModelLoader } from "../../model/ModelLoader";
import { TextureLoader } from "../../texture/TextureLoader";
import { IdkTypeLoader } from "../idktype/IdkTypeLoader";
import { ObjType } from "../objtype/ObjType";
import { ObjTypeLoader } from "../objtype/ObjTypeLoader";
import {
    EquipmentSlot,
    HeadCoverage,
    deriveEquipSlotFromParams,
    getHeadCoverage,
} from "./Equipment";
import { Gender, PlayerAppearance } from "./PlayerAppearance";
import {
    PLAYER_BODY_RECOLOR_FROM_1,
    PLAYER_BODY_RECOLOR_FROM_2,
    PLAYER_BODY_RECOLOR_TO_1,
    PLAYER_BODY_RECOLOR_TO_2,
} from "./PlayerDesignColors";

// Phase A: compose body from IdentityKits only (no equipment yet)
export class PlayerModelLoader {
    private readonly defaultKitsCache = new Map<number, number[]>();

    constructor(
        readonly idkTypeLoader: IdkTypeLoader,
        readonly objTypeLoader: ObjTypeLoader,
        readonly modelLoader: ModelLoader,
        readonly textureLoader: TextureLoader,
    ) {}

    buildStaticModel(appearance: PlayerAppearance, extraObjTypes?: ObjType[]): Model | undefined {
        const modelDatas: ModelData[] = [];
        const colors = Array.isArray(appearance.colors) ? appearance.colors : [];

        // Body parts 0..6 per Idk: 0 head, 1 jaw, 2 torso, 3 arms, 4 hands, 5 legs, 6 feet
        for (let part = 0; part <= 6; part++) {
            const kitId = appearance.kits[part] ?? -1;
            if (kitId === -1) continue;
            try {
                const kit = this.idkTypeLoader.load(kitId) as any;
                const ids: number[] = kit.modelIds ?? [];
                for (let i = 0; i < ids.length; i++) {
                    const md = this.modelLoader.getModel(ids[i]);
                    if (!md) continue;
                    // Apply kit recolors/retextures first
                    if (kit.recolorFrom) {
                        for (let r = 0; r < kit.recolorFrom.length; r++) {
                            md.recolor(kit.recolorFrom[r], kit.recolorTo[r]);
                        }
                    }
                    if (kit.retextureFrom) {
                        for (let r = 0; r < kit.retextureFrom.length; r++) {
                            md.retexture(kit.retextureFrom[r], kit.retextureTo[r]);
                        }
                    }
                    // OSRS parity: Apply PlayerComposition body color recolors (hair/torso/legs/feet/skin).
                    // Reference: PlayerComposition.getModel recolor loops.
                    for (let c = 0; c < 5; c++) {
                        const idx = (colors[c] ?? 0) | 0;
                        const pal1 = PLAYER_BODY_RECOLOR_TO_1[c] ?? [];
                        if (idx >= 0 && idx < pal1.length) {
                            md.recolor(PLAYER_BODY_RECOLOR_FROM_1[c] | 0, pal1[idx] | 0);
                        }
                        const pal2 = PLAYER_BODY_RECOLOR_TO_2[c] ?? [];
                        if (idx >= 0 && idx < pal2.length) {
                            md.recolor(PLAYER_BODY_RECOLOR_FROM_2[c] | 0, pal2[idx] | 0);
                        }
                    }
                    modelDatas.push(md);
                }
            } catch {}
        }

        // Merge extra wearable object models (e.g., boots, helms)
        if (extraObjTypes && extraObjTypes.length > 0) {
            const isFemale = appearance.gender === (1 as any);
            for (const obj of extraObjTypes) {
                const ids: number[] = [];
                const wearModel0 = isFemale ? obj.femaleModel : obj.maleModel;
                const wearModel1 = isFemale ? obj.femaleModel1 : obj.maleModel1;
                const wearModel2 = isFemale ? obj.femaleModel2 : obj.maleModel2;
                if (wearModel0 !== -1) ids.push(wearModel0);
                if (wearModel1 !== -1) ids.push(wearModel1);
                if (wearModel2 !== -1) ids.push(wearModel2);
                for (const id of ids) {
                    const md = this.modelLoader.getModel(id);
                    if (!md) continue;
                    if (obj.resizeX !== 128 || obj.resizeY !== 128 || obj.resizeZ !== 128) {
                        md.resize(obj.resizeX, obj.resizeY, obj.resizeZ);
                    }
                    if (obj.recolorFrom) {
                        for (let r = 0; r < obj.recolorFrom.length; r++) {
                            md.recolor(obj.recolorFrom[r], obj.recolorTo[r]);
                        }
                    }
                    if (obj.retextureFrom) {
                        for (let r = 0; r < obj.retextureFrom.length; r++) {
                            md.retexture(obj.retextureFrom[r], obj.retextureTo[r]);
                        }
                    }
                    // Apply wearable offsets (male assumed for default appearance)
                    try {
                        const male = appearance.gender === (0 as any); // Gender.MALE = 0
                        const ox = male
                            ? (obj as any).manwearXOff | 0
                            : (obj as any).womanwearXOff | 0;
                        const oy = male
                            ? (obj as any).manwearYOff | 0
                            : (obj as any).womanwearYOff | 0;
                        const oz = male
                            ? (obj as any).manwearZOff | 0
                            : (obj as any).womanwearZOff | 0;
                        if (ox !== 0 || oy !== 0 || oz !== 0) {
                            md.translate(ox, oy, oz);
                        }
                    } catch {}
                    modelDatas.push(md);
                }
            }
        }

        if (modelDatas.length === 0) {
            return undefined;
        }

        const merged = ModelData.merge(modelDatas, modelDatas.length);
        const model = merged.light(this.textureLoader, 64, 850, -30, -50, -30);
        // OSRS parity: do not baseline-align the merged player model (PlayerComposition.getModel
        // returns the lit model without translating it to force bottomY=0). Widget modelOffsetY
        // and modelZoom handle framing for UI renders.
        return model;
    }

    /**
     * Convenience: build a static model from an appearance and equipped items by slot (12 slots).
     * Applies head coverage (hair/beard hiding) from the head-slot item before composing.
     */
    buildStaticModelFromEquipment(
        appearance: PlayerAppearance,
        equippedItemIdsBySlot?: Array<number | null | undefined>,
    ): Model | undefined {
        // Clone the appearance so equipment-specific overrides do not mutate the caller state
        const workingAppearance = new PlayerAppearance(
            appearance.gender,
            Array.isArray(appearance.colors) ? [...appearance.colors] : [],
            Array.isArray(appearance.kits) ? [...appearance.kits] : [],
            Array.isArray(appearance.equip) ? [...appearance.equip] : new Array(14).fill(-1),
            appearance.headIcons ? { ...appearance.headIcons } : { prayer: -1 },
        );

        const kits = workingAppearance.kits;
        if (kits.length < 7) kits.length = 7;

        const equippedSlots = new Set<EquipmentSlot>();
        const hiddenParts = new Set<number>();
        const equipSource =
            equippedItemIdsBySlot && equippedItemIdsBySlot.length > 0
                ? equippedItemIdsBySlot
                : Array.isArray(workingAppearance.equip)
                ? workingAppearance.equip
                : [];
        for (let slot = 0; slot < equipSource.length; slot++) {
            const itemId = equipSource[slot];
            if (typeof itemId !== "number" || itemId < 0) continue;
            let obj: ObjType | undefined;
            try {
                obj = this.objTypeLoader.load(itemId);
            } catch {}
            const metaSlot = deriveEquipSlotFromParams(obj) ?? (slot as EquipmentSlot);
            if (metaSlot !== undefined) equippedSlots.add(metaSlot);

            if (metaSlot === EquipmentSlot.HEAD) {
                const coverage = getHeadCoverage(obj);
                if (coverage === HeadCoverage.HEAD || coverage === HeadCoverage.HEAD_AND_JAW) {
                    hiddenParts.add(0);
                    kits[0] = -1;
                }
                if (coverage === HeadCoverage.HEAD_AND_JAW) {
                    hiddenParts.add(1);
                    kits[1] = -1;
                }
            }
        }

        const fallbackKits = this.getDefaultKitsForGender(workingAppearance.gender);
        for (let part = 0; part < 7; part++) {
            if ((kits[part] ?? -1) !== -1) continue;
            if (hiddenParts.has(part)) continue;
            if (this.partCoveredByEquipment(part, equippedSlots, hiddenParts)) continue;
            if (fallbackKits[part] !== -1) kits[part] = fallbackKits[part];
        }
        const extras: ObjType[] = [];
        if (equippedItemIdsBySlot && equippedItemIdsBySlot.length > 0) {
            // Walk the equipped items and apply coverage/suppression based on metadata when available
            for (let slot = 0; slot < equippedItemIdsBySlot.length; slot++) {
                const id = equippedItemIdsBySlot[slot];
                if (id == null || id < 0) continue;
                let obj: ObjType | undefined;
                try {
                    obj = this.objTypeLoader.load(id);
                } catch {}
                if (!obj) continue;

                // Determine actual equipment slot from item params if present (full fidelity)
                const metaSlot = deriveEquipSlotFromParams(obj) ?? (slot as EquipmentSlot);

                // Torso/arms suppression for body
                if (metaSlot === EquipmentSlot.BODY) {
                    if (kits.length < 7) kits.length = 7;
                    kits[2] = -1; // torso
                    kits[3] = -1; // arms
                }
                // Head + jaw suppression
                // Legs suppression
                if (metaSlot === EquipmentSlot.LEGS) {
                    if (kits.length < 7) kits.length = 7;
                    kits[5] = -1; // legs
                }
                // Hands suppression
                if (metaSlot === EquipmentSlot.GLOVES) {
                    if (kits.length < 7) kits.length = 7;
                    kits[4] = -1; // hands
                }
                // Feet suppression
                if (metaSlot === EquipmentSlot.BOOTS) {
                    if (kits.length < 7) kits.length = 7;
                    kits[6] = -1; // feet
                }

                extras.push(obj);
            }
        }

        return this.buildStaticModel(workingAppearance, extras);
    }

    private partCoveredByEquipment(
        part: number,
        equippedSlots: Set<EquipmentSlot>,
        hiddenParts?: Set<number>,
    ): boolean {
        if (hiddenParts?.has(part)) return true;
        switch (part) {
            case 0:
                return hiddenParts?.has(0) ?? false;
            case 1:
                return hiddenParts?.has(1) ?? false;
            case 2:
            case 3:
                return equippedSlots.has(EquipmentSlot.BODY);
            case 4:
                return equippedSlots.has(EquipmentSlot.GLOVES);
            case 5:
                return equippedSlots.has(EquipmentSlot.LEGS);
            case 6:
                return equippedSlots.has(EquipmentSlot.BOOTS);
            default:
                return false;
        }
    }

    private getDefaultKitsForGender(gender: Gender): number[] {
        const key = Number(gender ?? 0) | 0;
        const cached = this.defaultKitsCache.get(key);
        if (cached) return cached;

        const defaults = new Array<number>(7).fill(-1);
        const count = this.idkTypeLoader.getCount?.() ?? 0;
        const expectedBodyPartId = (partIndex: number) =>
            ((partIndex | 0) + (gender === Gender.FEMALE ? 7 : 0)) | 0;
        for (let id = 0; id < count; id++) {
            try {
                const kit = this.idkTypeLoader.load(id) as any;
                if (!kit || kit.nonSelectable) continue;
                const rawPart = kit.bodyPartId ?? kit.bodyPartyId;
                const part = typeof rawPart === "number" ? rawPart | 0 : -1;
                if (part >= 0 && part < 14) {
                    const base = gender === Gender.FEMALE ? (part - 7) | 0 : part | 0;
                    if (base >= 0 && base < defaults.length) {
                        if (part === expectedBodyPartId(base) && defaults[base] === -1) {
                            defaults[base] = id;
                        }
                    }
                }
            } catch {}
        }

        if (defaults[0] === -1 || defaults[1] === -1) {
            try {
                const fallback =
                    gender === Gender.FEMALE
                        ? PlayerAppearance.defaultFemale(this.idkTypeLoader)
                        : PlayerAppearance.defaultMale(this.idkTypeLoader);
                if (defaults[0] === -1 && fallback.kits[0] !== undefined) {
                    defaults[0] = fallback.kits[0] ?? -1;
                }
                if (defaults[1] === -1 && fallback.kits[1] !== undefined) {
                    defaults[1] = fallback.kits[1] ?? -1;
                }
            } catch {}
        }
        if (defaults[0] <= 0) {
            for (let id = 1; id < count; id++) {
                try {
                    const kit = this.idkTypeLoader.load(id) as any;
                    const rawPart = kit.bodyPartId ?? kit.bodyPartyId;
                    if ((rawPart | 0) === expectedBodyPartId(0)) {
                        defaults[0] = id;
                        break;
                    }
                } catch {}
            }
        }
        if (defaults[1] === -1) {
            for (let id = 0; id < count; id++) {
                try {
                    const kit = this.idkTypeLoader.load(id) as any;
                    const rawPart = kit.bodyPartId ?? kit.bodyPartyId;
                    if ((rawPart | 0) === expectedBodyPartId(1)) {
                        defaults[1] = id;
                        break;
                    }
                } catch {}
            }
        }

        this.defaultKitsCache.set(key, defaults);
        return defaults;
    }
}

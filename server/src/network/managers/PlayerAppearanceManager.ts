/**
 * PlayerAppearanceManager - Handles player appearance, equipment visuals, and animation sets.
 *
 * Extracted from wsServer.ts for better organization and testability.
 * Uses a service interface pattern to avoid circular dependencies.
 */
import type { BasType } from "../../../../src/rs/config/bastype/BasType";
import type { IdkType } from "../../../../src/rs/config/idktype/IdkType";
import type { ObjType } from "../../../../src/rs/config/objtype/ObjType";
import {
    EquipmentSlot,
    HeadCoverage,
    deriveEquipSlotFromParams,
    getHeadCoverage,
} from "../../../../src/rs/config/player/Equipment";
import { DEFAULT_EQUIP_SLOT_COUNT } from "../../game/equipment";
import type { PlayerAppearance as PlayerAppearanceState, PlayerState } from "../../game/player";
import { buildAnimSetFromBas, ensureCorePlayerAnimSet } from "../anim/playerAnim";
import type { Appearance as HandshakeAppearance } from "../messages";

/** Animation keys for player movement/idle states */
const PLAYER_ANIM_KEYS = [
    "idle",
    "walk",
    "walkBack",
    "walkLeft",
    "walkRight",
    "run",
    "runBack",
    "runLeft",
    "runRight",
    "turnLeft",
    "turnRight",
] as const;

/** Player animation set definition */
export interface PlayerAnimSet {
    idle?: number;
    walk?: number;
    walkBack?: number;
    walkLeft?: number;
    walkRight?: number;
    run?: number;
    runBack?: number;
    runLeft?: number;
    runRight?: number;
    turnLeft?: number;
    turnRight?: number;
}

/** Pending appearance snapshot entry */
export interface AppearanceSnapshotEntry {
    playerId: number;
    payload: {
        x: number;
        y: number;
        level: number;
        rot: number;
        orientation: number;
        running: boolean;
        appearance: PlayerAppearanceState | undefined;
        name?: string;
        anim?: PlayerAnimSet;
        moved: boolean;
        turned: boolean;
        snap: boolean;
        directions?: number[];
    };
}

/** ObjType loader reference */
export interface ObjTypeLoaderRef {
    load(id: number): ObjType;
}

/** BasType loader reference for base animation sets */
export interface BasTypeLoaderRef {
    load(id: number): BasType;
}

/** IdkType loader reference for identity kits */
export interface IdkTypeLoaderRef {
    load(id: number): IdkType;
}

/** Services required by PlayerAppearanceManager */
export interface PlayerAppearanceServices {
    /** Get pending appearance snapshots array (mutable) */
    getPendingAppearanceSnapshots(): AppearanceSnapshotEntry[];
    /** Get ObjType loader */
    getObjTypeLoader(): ObjTypeLoaderRef | undefined;
    /** Get BasType loader */
    getBasTypeLoader(): BasTypeLoaderRef | undefined;
    /** Get IdkType loader */
    getIdkTypeLoader(): IdkTypeLoaderRef | undefined;
    /** Get default body kits for gender */
    getDefaultBodyKits(gender: number): number[];
    /** Ensure equipment array exists on player */
    ensureEquipArray(player: PlayerState): number[];
    /** Get ObjType by ID */
    getObjType(id: number): ObjType | undefined;
    /** Build animation payload for player */
    buildAnimPayload(player: PlayerState): PlayerAnimSet | undefined;
    /** Get default player animation (male) */
    getDefaultPlayerAnimMale(): PlayerAnimSet | undefined;
    /** Get default player animation (female) */
    getDefaultPlayerAnimFemale(): PlayerAnimSet | undefined;
    /** Get default player animation (fallback) */
    getDefaultPlayerAnim(): PlayerAnimSet;
    /** Get weapon animation overrides map */
    getWeaponAnimOverrides(): Map<number, Record<string, number>>;
    /** Apply weapon animation overrides to player */
    applyWeaponAnimOverrides(
        player: PlayerState,
        animTarget: Record<string, number | undefined>,
    ): void;
    /** Log a message */
    log(level: "info" | "warn" | "error" | "debug", message: string): void;
}

/**
 * Manager for player appearance, equipment visuals, and animation sets.
 */
export class PlayerAppearanceManager {
    constructor(private readonly services: PlayerAppearanceServices) {}

    /**
     * Queue an appearance snapshot for a player.
     */
    queueAppearanceSnapshot(
        player: PlayerState,
        overrides?: Partial<{
            x: number;
            y: number;
            level: number;
            rot: number;
            orientation: number;
            running: boolean;
            appearance: PlayerAppearanceState | undefined;
            name?: string;
            anim?: PlayerAnimSet;
            moved: boolean;
            turned: boolean;
            snap: boolean;
            directions?: number[];
        }>,
    ): void {
        const pendingSnapshots = this.services.getPendingAppearanceSnapshots();

        const base = () => ({
            x: player.x,
            y: player.y,
            level: player.level,
            rot: player.rot,
            orientation: player.getOrientation() & 2047,
            running: false,
            appearance: player.appearance,
            name: player.name,
            anim: this.services.buildAnimPayload(player),
            moved: false,
            turned: false,
            snap: false,
            directions: undefined as number[] | undefined,
        });

        let entry = pendingSnapshots.find((snap) => snap.playerId === player.id);
        if (!entry) {
            entry = {
                playerId: player.id,
                payload: base(),
            };
            pendingSnapshots.push(entry);
        }
        Object.assign(entry.payload, {
            appearance: player.appearance,
            name: player.name,
            anim: this.services.buildAnimPayload(player), // Update anim on refresh (e.g., after death clears equipment)
        });
        if (overrides) Object.assign(entry.payload, overrides);
    }

    /**
     * Refresh appearance kits based on equipment and gender.
     */
    refreshAppearanceKits(player: PlayerState): void {
        if (!player.appearance) {
            player.appearance = { gender: 0, equip: [], headIcons: { prayer: -1 } };
        }
        const appearance = player.appearance;
        const gender = appearance.gender === 1 ? 1 : 0;
        appearance.gender = gender;
        const expectedBodyPartId = (partIndex: number) => partIndex + (gender === 1 ? 7 : 0);

        // Normalize colors to a fixed 5-entry palette for base body tones
        const colorsSource = Array.isArray(appearance.colors)
            ? appearance.colors.filter((value): value is number => Number.isFinite(value))
            : [];
        const colors = new Array<number>(5).fill(0);
        for (let i = 0; i < Math.min(colorsSource.length, colors.length); i++) {
            colors[i] = colorsSource[i];
        }
        appearance.colors = colors;

        // Start from provided kits (if any) and fall back to defaults per body part
        const kits: number[] = Array.isArray(appearance.kits)
            ? appearance.kits.filter((value): value is number => Number.isFinite(value))
            : [];
        if (kits.length < 7) kits.length = 7;

        // Drop any kit IDs that don't match the current gender's bodyPartId set.
        const idkLoader = this.services.getIdkTypeLoader?.();
        if (idkLoader) {
            for (let part = 0; part < 7; part++) {
                const kitId = kits[part] ?? -1;
                if (kitId < 0) continue;
                try {
                    const kit = idkLoader.load(kitId);
                    const bodyPartId = this.getIdkBodyPartId(kit);
                    if (bodyPartId !== expectedBodyPartId(part)) {
                        kits[part] = -1;
                    }
                } catch {
                    kits[part] = -1;
                }
            }
        }
        const defaults = this.services.getDefaultBodyKits(gender);
        for (let part = 0; part < 7; part++) {
            if ((kits[part] ?? -1) < 0 && defaults[part] !== -1) {
                kits[part] = defaults[part];
            }
        }

        const equip = this.services.ensureEquipArray(player);
        for (let slot = 0; slot < equip.length; slot++) {
            const itemId = equip[slot];
            if (!(itemId > 0)) continue;
            const obj = this.services.getObjType(itemId);
            const metaSlot = deriveEquipSlotFromParams(obj) ?? (slot as EquipmentSlot);
            switch (metaSlot) {
                case EquipmentSlot.HEAD: {
                    const coverage = getHeadCoverage(obj);
                    if (coverage === HeadCoverage.HEAD || coverage === HeadCoverage.HEAD_AND_JAW) {
                        kits[0] = -1;
                    }
                    if (coverage === HeadCoverage.HEAD_AND_JAW && kits.length > 1) {
                        kits[1] = -1;
                    }
                    break;
                }
                case EquipmentSlot.BODY:
                    kits[2] = -1;
                    kits[3] = -1;
                    break;
                case EquipmentSlot.LEGS:
                    kits[5] = -1;
                    break;
                case EquipmentSlot.GLOVES:
                    kits[4] = -1;
                    break;
                case EquipmentSlot.BOOTS:
                    kits[6] = -1;
                    break;
                default:
                    break;
            }
        }

        for (let part = 0; part < kits.length; part++) {
            kits[part] = kits[part] ?? -1;
        }
        appearance.kits = kits;
        appearance.equip = equip;

        this.assignPlayerAnimFromAppearance(player);
    }

    /**
     * Send appearance update by queuing a snapshot.
     */
    sendAppearanceUpdate(player: PlayerState): void {
        this.queueAppearanceSnapshot(player);
    }

    /**
     * Assign player animation set from appearance.
     */
    assignPlayerAnimFromAppearance(player: PlayerState): PlayerAnimSet | undefined {
        const appearance = player.appearance;
        const resolved = this.resolveAnimForAppearance(appearance);
        const animTarget = player.anim;
        for (const key of PLAYER_ANIM_KEYS) {
            const value = resolved[key];
            if (value !== undefined) animTarget[key] = value;
        }
        this.services.applyWeaponAnimOverrides(player, animTarget);
        return resolved;
    }

    /**
     * Resolve animation set for appearance.
     */
    resolveAnimForAppearance(appearance: { gender?: number } | undefined): PlayerAnimSet {
        const gender = appearance?.gender === 1 ? 1 : 0;
        const genderFallback =
            gender === 1
                ? this.services.getDefaultPlayerAnimFemale() ?? this.services.getDefaultPlayerAnim()
                : this.services.getDefaultPlayerAnimMale() ?? this.services.getDefaultPlayerAnim();

        const basId = this.guessBasIdForAppearance(appearance);
        if (basId !== undefined) {
            const basLoader = this.services.getBasTypeLoader();
            if (basLoader) {
                const fromBas = this.loadAnimSetFromBas(() => basLoader.load(basId));
                if (fromBas) return ensureCorePlayerAnimSet(fromBas, genderFallback);
            }
        }
        return ensureCorePlayerAnimSet(genderFallback, this.services.getDefaultPlayerAnim());
    }

    /**
     * Guess BAS ID for appearance based on gender.
     */
    guessBasIdForAppearance(appearance: { gender?: number } | undefined): number | undefined {
        if (!this.services.getBasTypeLoader()) return undefined;
        const gender = appearance?.gender === 1 ? 1 : 0;
        if (gender === 1) return 1;
        return 0;
    }

    /**
     * Load animation set from BAS loader.
     */
    loadAnimSetFromBas(loader: () => BasType | undefined): PlayerAnimSet | undefined {
        try {
            const bas = loader?.();
            return this.animSetFromBas(bas);
        } catch {
            return undefined;
        }
    }

    /**
     * Extract animation set from BAS object.
     */
    animSetFromBas(bas: BasType | undefined): PlayerAnimSet | undefined {
        return buildAnimSetFromBas(bas);
    }

    private getIdkBodyPartId(kit: IdkType): number {
        const extendedKit = kit as IdkType & { bodyPartId?: number };
        return extendedKit.bodyPartId ?? kit.bodyPartyId;
    }

    /**
     * Sanitize handshake appearance data.
     */
    sanitizeHandshakeAppearance(raw: HandshakeAppearance): PlayerAppearanceState {
        return {
            gender: raw.gender === 1 ? 1 : 0,
            kits: raw.kits?.slice(0, 12),
            colors: raw.colors?.slice(0, 10),
            equip: new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(-1),
            equipQty: new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(0),
            headIcons: { prayer: -1 },
        };
    }

    /**
     * Create default appearance.
     */
    createDefaultAppearance(): PlayerAppearanceState {
        return {
            gender: 0,
            kits: undefined,
            colors: undefined,
            equip: new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(-1),
            equipQty: new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(0),
            headIcons: { prayer: -1 },
        };
    }
}

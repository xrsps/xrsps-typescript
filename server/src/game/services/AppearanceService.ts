import type { BasType } from "../../../../src/rs/config/bastype/BasType";
import { PlayerAppearance as CachePlayerAppearance } from "../../../../src/rs/config/player/PlayerAppearance";
import {
    EquipmentSlot,
} from "../../../../src/rs/config/player/Equipment";
import type { IdkType } from "../../../../src/rs/config/idktype/IdkType";
import type { WeaponDataEntry } from "../../../data/weapons";
import { weaponDataEntries } from "../../../data/weapons";
import type { BroadcastScheduler, PlayerAnimSet } from "../systems/BroadcastScheduler";
import type { GamemodeDefinition } from "../gamemodes/GamemodeDefinition";
import type { PlayerState, PlayerAppearance as PlayerAppearanceState } from "../player";
import type { DataLoaderService } from "./DataLoaderService";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";
import { logger } from "../../utils/logger";

const EQUIP_SLOT_COUNT = 14;

export type { PlayerAppearanceState, PlayerAnimSet };

const PLAYER_ANIM_KEYS = ["idle", "walk", "run", "turnLeft", "turnRight"] as const;

function buildAnimSetFromBas(bas: BasType | undefined): PlayerAnimSet | undefined {
    if (!bas) return undefined;
    const set: PlayerAnimSet = {};
    if ((bas as any).idleSeq !== undefined) set.idle = (bas as any).idleSeq;
    if ((bas as any).walkSeq !== undefined) set.walk = (bas as any).walkSeq;
    if ((bas as any).runSeq !== undefined) set.run = (bas as any).runSeq;
    if ((bas as any).turnLeft !== undefined) set.turnLeft = (bas as any).turnLeft;
    if ((bas as any).turnRight !== undefined) set.turnRight = (bas as any).turnRight;
    return set;
}

function ensureCorePlayerAnimSet(
    source: PlayerAnimSet,
    fallback: PlayerAnimSet,
): PlayerAnimSet {
    const result: PlayerAnimSet = { ...source };
    for (const key of PLAYER_ANIM_KEYS) {
        if (result[key] === undefined || result[key]! < 0) {
            result[key] = fallback[key];
        }
    }
    return result;
}

export interface AppearanceServiceDeps {
    dataLoaders: DataLoaderService;
    gamemode: GamemodeDefinition;
    playerAppearanceManager: any;
    broadcastScheduler: BroadcastScheduler;
    getActiveFrame: () => TickFrame | undefined;
    isAdminPlayer: (player: PlayerState | undefined) => boolean;
}

/**
 * Manages player appearance, animation sets, body kits, and weapon data.
 * Extracted from WSServer.
 */
export class AppearanceService {
    private defaultPlayerAnim: PlayerAnimSet = {
        idle: 808,
        walk: 819,
        run: 824,
        turnLeft: 823,
        turnRight: 823,
    };
    private defaultPlayerAnimMale?: PlayerAnimSet;
    private defaultPlayerAnimFemale?: PlayerAnimSet;
    private weaponAnimOverrides = new Map<number, Record<string, number>>();
    private weaponData = new Map<number, WeaponDataEntry>();
    private readonly defaultBodyKitCache = new Map<number, number[]>();

    constructor(private readonly deps: AppearanceServiceDeps) {}

    setDeferredDeps(deferred: { playerAppearanceManager?: any }): void {
        Object.assign(this.deps, deferred);
    }

    loadWeaponData(): void {
        const dataMap = new Map<number, WeaponDataEntry>();
        const animOverrides = new Map<number, Record<string, number>>();
        for (const entry of weaponDataEntries) {
            dataMap.set(entry.itemId, entry);
            if (entry.animOverrides) {
                animOverrides.set(entry.itemId, { ...entry.animOverrides });
            }
        }
        this.weaponData = dataMap;
        this.weaponAnimOverrides = animOverrides;
        if (this.weaponData.size > 0) {
            logger.info(`[appearance] loaded ${this.weaponData.size} weapon data entries`);
        }
    }

    getWeaponData(): Map<number, WeaponDataEntry> {
        return this.weaponData;
    }

    getWeaponAnimOverrides(): Map<number, Record<string, number>> {
        return this.weaponAnimOverrides;
    }

    initDefaultAnims(): void {
        const basLoader = this.deps.dataLoaders.getBasTypeLoader();
        if (!basLoader) return;

        this.defaultPlayerAnimMale =
            this.loadAnimSetFromBas(() => basLoader.load(0)) ?? this.defaultPlayerAnimMale;
        this.defaultPlayerAnimFemale =
            this.loadAnimSetFromBas(() => basLoader.load(1)) ?? this.defaultPlayerAnimFemale;

        const bcount = basLoader.getCount?.() ?? 0;
        let best: PlayerAnimSet | undefined;
        for (let id = 0; id < bcount; id++) {
            const anim = this.loadAnimSetFromBas(() => basLoader.load(id));
            if (!anim) continue;
            if (!best) best = anim;
            const prefers =
                (anim.idle ?? -1) === 808 ||
                (anim.walk ?? -1) === 819 ||
                (anim.run ?? -1) === 824;
            if (prefers) {
                best = anim;
                break;
            }
        }
        if (best) this.defaultPlayerAnim = best;

        if (!this.defaultPlayerAnimMale) this.defaultPlayerAnimMale = this.defaultPlayerAnim;
        if (!this.defaultPlayerAnimFemale) this.defaultPlayerAnimFemale = this.defaultPlayerAnim;
    }

    refreshAppearanceKits(p: PlayerState): void {
        this.deps.playerAppearanceManager.refreshAppearanceKits(p);
    }

    queueAppearanceSnapshot(player: PlayerState, overrides?: any): void {
        this.deps.playerAppearanceManager.queueAppearanceSnapshot(player, overrides);
    }

    getOrCreateAppearance(player: PlayerState): PlayerAppearanceState {
        return player.appearance ?? (player.appearance = this.createDefaultAppearance());
    }

    sanitizeHandshakeAppearance(raw: any): PlayerAppearanceState {
        const colors = raw.colors?.slice(0, 10);
        const kits = raw.kits?.slice(0, 12);
        return {
            gender: raw.gender === 1 ? 1 : 0,
            colors,
            kits,
            equip: new Array<number>(EQUIP_SLOT_COUNT).fill(-1),
            equipQty: new Array<number>(EQUIP_SLOT_COUNT).fill(0),
            headIcons: { prayer: -1 },
        };
    }

    createDefaultAppearance(): PlayerAppearanceState {
        return {
            gender: 0,
            colors: undefined,
            kits: undefined,
            equip: new Array<number>(EQUIP_SLOT_COUNT).fill(-1),
            equipQty: new Array<number>(EQUIP_SLOT_COUNT).fill(0),
            headIcons: { prayer: -1 },
        };
    }

    getDefaultBodyKits(gender: number): number[] {
        const key = gender ?? 0;
        const cached = this.defaultBodyKitCache.get(key);
        if (cached) return cached.slice();

        const loader = this.deps.dataLoaders.getIdkTypeLoader();
        const defaults = new Array<number>(7).fill(-1);
        const count = loader?.getCount() ?? 0;
        const expectedPart = (part: number) => part + (key === 1 ? 7 : 0);
        for (let id = 0; id < count; id++) {
            try {
                const kit = loader?.load(id);
                if (!kit || kit.nonSelectable) continue;
                const part = this.getIdkBodyPartId(kit);
                if (part >= 0 && part < 14) {
                    const base = key === 1 ? part - 7 : part;
                    if (base >= 0 && base < defaults.length) {
                        if (part === expectedPart(base) && defaults[base] === -1) {
                            defaults[base] = id;
                        }
                    }
                }
            } catch {}
        }

        if (loader && (defaults[0] === -1 || defaults[1] === -1)) {
            try {
                const fallback =
                    gender === 1
                        ? CachePlayerAppearance.defaultFemale(loader)
                        : CachePlayerAppearance.defaultMale(loader);
                if (fallback) {
                    if (defaults[0] === -1 && fallback.kits[0] !== undefined) {
                        defaults[0] = fallback.kits[0] ?? -1;
                    }
                    if (defaults[1] === -1 && fallback.kits[1] !== undefined) {
                        defaults[1] = fallback.kits[1] ?? -1;
                    }
                }
            } catch {}
        }

        this.defaultBodyKitCache.set(key, defaults.slice());
        return defaults;
    }

    getIdkBodyPartId(kit: IdkType): number {
        const extendedKit = kit as IdkType & { bodyPartId?: number };
        return extendedKit.bodyPartId ?? kit.bodyPartyId;
    }

    assignPlayerAnimFromAppearance(p: PlayerState): PlayerAnimSet | undefined {
        const appearance = p.appearance;
        const resolved = this.resolveAnimForAppearance(appearance);
        const animTarget = p.anim;
        for (const key of PLAYER_ANIM_KEYS) {
            const value = resolved[key];
            if (value !== undefined) animTarget[key] = value;
        }
        this.applyWeaponAnimOverrides(p, animTarget);
        return resolved;
    }

    resolveAnimForAppearance(appearance: { gender?: number } | undefined): PlayerAnimSet {
        const gender = appearance?.gender === 1 ? 1 : 0;
        const genderFallback =
            gender === 1
                ? this.defaultPlayerAnimFemale ?? this.defaultPlayerAnim
                : this.defaultPlayerAnimMale ?? this.defaultPlayerAnim;

        const basId = this.guessBasIdForAppearance(appearance);
        if (basId !== undefined) {
            const basLoader = this.deps.dataLoaders.getBasTypeLoader();
            if (basLoader) {
                const fromBas = this.loadAnimSetFromBas(() => basLoader.load(basId));
                if (fromBas) return ensureCorePlayerAnimSet(fromBas, genderFallback);
            }
        }
        return ensureCorePlayerAnimSet(genderFallback, this.defaultPlayerAnim);
    }

    guessBasIdForAppearance(
        appearance: { gender?: number } | undefined,
    ): number | undefined {
        if (!this.deps.dataLoaders.getBasTypeLoader()) return undefined;
        const gender = appearance?.gender === 1 ? 1 : 0;
        return gender === 1 ? 1 : 0;
    }

    loadAnimSetFromBas(loader: () => BasType | undefined): PlayerAnimSet | undefined {
        try {
            const bas = loader?.();
            return buildAnimSetFromBas(bas);
        } catch {
            return undefined;
        }
    }

    applyWeaponAnimOverrides(
        p: PlayerState,
        animTarget: Record<string, number | undefined>,
    ): void {
        const equip = Array.isArray(p.appearance?.equip) ? p.appearance.equip : undefined;
        const itemId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] ?? -1 : -1;
        const overrides = this.weaponAnimOverrides.get(itemId);
        if (!overrides) return;
        for (const [key, value] of Object.entries(overrides)) {
            animTarget[key] = value;
        }
    }

    buildAnimPayload(p: PlayerState): PlayerAnimSet | undefined {
        this.assignPlayerAnimFromAppearance(p);
        const source = p.anim;
        if (!source || Object.keys(source).length === 0) return undefined;
        const payload: PlayerAnimSet = {};
        let has = false;
        for (const key of PLAYER_ANIM_KEYS) {
            const v = source[key];
            if (v !== undefined && v >= 0) {
                payload[key] = v;
                has = true;
            }
        }
        return has ? payload : undefined;
    }

    sendAnimUpdate(p: PlayerState): void {
        const payload = this.buildAnimPayload(p);
        if (!payload) return;
        this.queueAnimSnapshot(p.id, payload);
    }

    queueAnimSnapshot(playerId: number, anim: PlayerAnimSet | undefined): void {
        if (!anim) return;
        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.animSnapshots.push({ playerId, anim });
            return;
        }
        this.deps.broadcastScheduler.queueAnimSnapshot(playerId, anim);
    }

    sendAppearanceUpdate(p: PlayerState): void {
        this.queueAppearanceSnapshot(p);
    }

    getAppearanceDisplayName(player: PlayerState | undefined): string {
        const baseName = player?.name ?? "";
        return this.deps.gamemode.getDisplayName(
            player as PlayerState,
            baseName,
            this.deps.isAdminPlayer(player),
        );
    }
}

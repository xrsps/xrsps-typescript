import { ARROW_LAUNCH_DELAY_TICKS, ARROW_TRAVEL_TIME_TICKS } from "../AmmoSystem";
import { CombatAttackStyle } from "../model/CombatAttack";
import { type WeaponCombatContext, type WeaponCombatProfile } from "./WeaponCombatProfile";
import { CORE_SPECIAL_ATTACK_PROFILES } from "./special-attacks";

export { ANCIENT_AUTOCAST_STAFF_IDS, MagicStaffValidator } from "./MagicStaffValidator";

export interface CombatPluginLookup {
    readonly weaponId?: number;
    readonly categoryId?: number;
}

const GENERIC_WEAPON_PROFILE: WeaponCombatProfile = Object.freeze({
    id: "core:generic",
});

const DEFAULT_UNARMED_PROFILE: WeaponCombatProfile = Object.freeze({
    id: "core:unarmed",
    categoryIds: Object.freeze([0]),
    attackAnimation: (context: WeaponCombatContext) =>
        context.attack.traits.style === CombatAttackStyle.Aggressive ? 423 : 422,
});

const DEFAULT_ABYSSAL_WHIP_PROFILE: WeaponCombatProfile = Object.freeze({
    id: "core:abyssal_whip",
    itemIds: Object.freeze([4151]),
    categoryIds: Object.freeze([20]),
    attackAnimation: 1658,
});

const DEFAULT_SHORTBOW_PROFILE: WeaponCombatProfile = Object.freeze({
    id: "core:shortbow",
    itemIds: Object.freeze([841]),
    categoryIds: Object.freeze([3]),
    attackAnimation: 426,
    projectile: Object.freeze({
        id: 10,
        startHeight: 40,
        endHeight: 36,
        slope: 0,
        steepness: 64,
        startDelayTicks: ARROW_LAUNCH_DELAY_TICKS,
        travelTimeTicks: ARROW_TRAVEL_TIME_TICKS,
        lifeModel: "linear5-clamped10",
    }),
});

/**
 * Content-facing registry for weapon-specific combat behavior.
 *
 * Exact item registrations take precedence over category registrations. A
 * caller may replace an existing registration explicitly, which makes content
 * hot-reload and gamemode overrides deterministic.
 */
export class CombatPluginRegistry {
    private static sharedInstance: CombatPluginRegistry | undefined;

    private readonly profilesById = new Map<string, WeaponCombatProfile>();
    private readonly profilesByItemId = new Map<number, WeaponCombatProfile>();
    private readonly profilesByCategoryId = new Map<number, WeaponCombatProfile>();

    static get shared(): CombatPluginRegistry {
        if (!this.sharedInstance) {
            const registry = new CombatPluginRegistry();
            registry.registerDefaults();
            this.sharedInstance = registry;
        }
        return this.sharedInstance;
    }

    register(profile: WeaponCombatProfile, options?: { replace?: boolean }): void {
        const id = profile.id.trim();
        if (!id) {
            throw new Error("Combat plugin profiles require a non-empty id");
        }

        const replace = options?.replace === true;
        if (!replace && this.profilesById.has(id)) {
            throw new Error(`Combat plugin profile '${id}' is already registered`);
        }

        const normalized = this.normalizeProfile(profile, id);
        if (replace) {
            this.unregister(id);
        }

        for (const itemId of normalized.itemIds ?? []) {
            this.assertRegistrationAvailable(this.profilesByItemId, itemId, id, replace, "item");
        }
        for (const categoryId of normalized.categoryIds ?? []) {
            this.assertRegistrationAvailable(
                this.profilesByCategoryId,
                categoryId,
                id,
                replace,
                "category",
            );
        }

        this.profilesById.set(id, normalized);
        for (const itemId of normalized.itemIds ?? []) {
            this.profilesByItemId.set(itemId, normalized);
        }
        for (const categoryId of normalized.categoryIds ?? []) {
            this.profilesByCategoryId.set(categoryId, normalized);
        }
    }

    unregister(profileId: string): boolean {
        const profile = this.profilesById.get(profileId);
        if (!profile) return false;

        this.profilesById.delete(profileId);
        for (const [itemId, registered] of this.profilesByItemId) {
            if (registered.id === profileId) this.profilesByItemId.delete(itemId);
        }
        for (const [categoryId, registered] of this.profilesByCategoryId) {
            if (registered.id === profileId) this.profilesByCategoryId.delete(categoryId);
        }
        return true;
    }

    resolve(lookup: CombatPluginLookup): WeaponCombatProfile {
        const weaponId = this.normalizeOptionalId(lookup.weaponId);
        if (weaponId !== undefined) {
            const itemProfile = this.profilesByItemId.get(weaponId);
            if (itemProfile) return itemProfile;
        }

        const categoryId = this.normalizeOptionalId(lookup.categoryId);
        if (categoryId !== undefined) {
            const categoryProfile = this.profilesByCategoryId.get(categoryId);
            if (categoryProfile) return categoryProfile;
        }
        return GENERIC_WEAPON_PROFILE;
    }

    getById(profileId: string): WeaponCombatProfile | undefined {
        if (profileId === GENERIC_WEAPON_PROFILE.id) return GENERIC_WEAPON_PROFILE;
        return this.profilesById.get(profileId);
    }

    getAll(): readonly WeaponCombatProfile[] {
        return Object.freeze([...this.profilesById.values()]);
    }

    private registerDefaults(): void {
        this.register(DEFAULT_UNARMED_PROFILE);
        this.register(DEFAULT_ABYSSAL_WHIP_PROFILE);
        this.register(DEFAULT_SHORTBOW_PROFILE);
        for (const profile of CORE_SPECIAL_ATTACK_PROFILES) {
            this.register(profile);
        }
    }

    private normalizeProfile(profile: WeaponCombatProfile, id: string): WeaponCombatProfile {
        const itemIds = this.normalizeIds(profile.itemIds);
        const categoryIds = this.normalizeIds(profile.categoryIds);
        return Object.freeze({
            ...profile,
            id,
            itemIds: itemIds.length > 0 ? Object.freeze(itemIds) : undefined,
            categoryIds: categoryIds.length > 0 ? Object.freeze(categoryIds) : undefined,
        });
    }

    private normalizeIds(values: readonly number[] | undefined): number[] {
        if (!values) return [];
        const result = new Set<number>();
        for (const value of values) {
            if (!Number.isFinite(value)) {
                throw new RangeError(
                    `Combat plugin registration id must be finite; received ${value}`,
                );
            }
            result.add(Math.trunc(value));
        }
        return [...result];
    }

    private normalizeOptionalId(value: number | undefined): number | undefined {
        return value !== undefined && Number.isFinite(value) ? Math.trunc(value) : undefined;
    }

    private assertRegistrationAvailable(
        registry: Map<number, WeaponCombatProfile>,
        key: number,
        profileId: string,
        replace: boolean,
        kind: "item" | "category",
    ): void {
        const existing = registry.get(key);
        if (existing && existing.id !== profileId && !replace) {
            throw new Error(
                `Combat ${kind} ${key} is already registered to profile '${existing.id}'`,
            );
        }
        if (existing && replace) {
            this.unregister(existing.id);
        }
    }
}

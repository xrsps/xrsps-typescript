/**
 * Spell Base XP Provider
 *
 * Core provider interface for spell base XP lookup.
 * Gamemodes register their spell XP data at startup.
 */

export interface SpellXpProvider {
    getSpellBaseXp(spellId: number): number;
}

let activeProvider: SpellXpProvider | undefined;

export function registerSpellXpProvider(provider: SpellXpProvider): void {
    activeProvider = provider;
}

export function getSpellBaseXp(spellId: number): number {
    return activeProvider?.getSpellBaseXp(spellId) ?? 0;
}

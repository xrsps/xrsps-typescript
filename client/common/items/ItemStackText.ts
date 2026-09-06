/** Original OSRS inventory quantity abbreviations and colours, shared by native and React UI. */
export function itemStackText(quantity: number): { text: string; color: string } {
    const amount = Math.max(0, Math.trunc(quantity));
    if (amount < 100_000) return { text: String(amount), color: "#ffff00" };
    if (amount < 10_000_000) return { text: `${Math.floor(amount / 1000)}K`, color: "#ffffff" };
    return { text: `${Math.floor(amount / 1_000_000)}M`, color: "#00ff80" };
}

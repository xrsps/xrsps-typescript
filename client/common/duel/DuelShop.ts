/** The Al Kharid shopkeeper uses an original cache model and native Talk-to action. */
export const DUEL_SHOPKEEPER = { id: 2817, x: 3370, y: 3267, level: 0, direction: 0, wanderRadius: 0 } as const;

export type ShopCurrency = "gold" | "platinum";
export interface DuelShopPackage {
    readonly id: string;
    readonly currency: ShopCurrency;
    readonly quantity: number;
    readonly label: string;
    readonly name: string;
    readonly description: string;
    readonly packaging: "pouch" | "bundle" | "chest";
    readonly price: { readonly amountMinor: number; readonly currency: string } | null;
}

/** Products are separate from payment pricing, which has not been configured yet. */
export const DUEL_SHOP_PACKAGES: readonly DuelShopPackage[] = Object.freeze([
    { id: "gold-10m", currency: "gold", quantity: 10_000_000, label: "10 million gold", name: "Gold pouch", description: "A pouch for your next duel", packaging: "pouch", price: null },
    { id: "gold-50m", currency: "gold", quantity: 50_000_000, label: "50 million gold", name: "Gold bundle", description: "A well-stocked collection", packaging: "bundle", price: null },
    { id: "gold-100m", currency: "gold", quantity: 100_000_000, label: "100 million gold", name: "Gold chest", description: "A chest for the arena regular", packaging: "chest", price: null },
    { id: "platinum-10k", currency: "platinum", quantity: 10_000, label: "10,000 platinum tokens", name: "Platinum pouch", description: "A pouch for your next duel", packaging: "pouch", price: null },
    { id: "platinum-50k", currency: "platinum", quantity: 50_000, label: "50,000 platinum tokens", name: "Platinum bundle", description: "A well-stocked collection", packaging: "bundle", price: null },
    { id: "platinum-100k", currency: "platinum", quantity: 100_000, label: "100,000 platinum tokens", name: "Platinum chest", description: "A chest for the arena regular", packaging: "chest", price: null },
].map(product => Object.freeze(product)) as DuelShopPackage[]);

export function findDuelShopPackage(id: string): DuelShopPackage | undefined {
    return DUEL_SHOP_PACKAGES.find(product => product.id === id);
}

export function duelShopPrice(product: DuelShopPackage): string {
    return product.price ? new Intl.NumberFormat("en-US", { style: "currency", currency: product.price.currency })
        .format(product.price.amountMinor / 100) : "Pricing coming soon";
}

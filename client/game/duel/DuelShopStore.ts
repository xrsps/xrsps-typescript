import { findDuelShopPackage } from "../../common/duel/DuelShop";

export interface DuelShopDraft {
    readonly account: string;
    readonly email: string;
    readonly packageId: string;
    readonly status: "awaiting-payment-setup";
}
export interface DuelShopState {
    readonly open: boolean;
    readonly packageId: string;
    readonly stage: "browse" | "review" | "draft";
    readonly draft: DuelShopDraft | null;
}

export function isValidShopEmail(email: string): boolean {
    return email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Session-only order previews. This store never requests payment or grants game currency. */
export function createDuelShopStore() {
    let state: DuelShopState = Object.freeze({ open: false, packageId: "gold-10m", stage: "browse", draft: null });
    const listeners = new Set<() => void>();
    const update = (next: DuelShopState) => { state = Object.freeze(next); listeners.forEach(listener => listener()); };
    return {
        getSnapshot: () => state,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        open() { if (!state.open) update({ ...state, open: true }); },
        close() { if (state.open) update({ ...state, open: false }); },
        select(packageId: string) {
            if (!findDuelShopPackage(packageId)) return false;
            update({ ...state, packageId, stage: "browse", draft: null });
            return true;
        },
        review() {
            if (!state.open || !findDuelShopPackage(state.packageId)) return false;
            update({ ...state, stage: "review", draft: null });
            return true;
        },
        back() { update({ ...state, stage: "browse", draft: null }); },
        order(account: string, email: string) {
            if (!state.open || state.stage !== "review" || !account.trim() || !isValidShopEmail(email) || !findDuelShopPackage(state.packageId)) return false;
            const draft = Object.freeze({ account, email: email.trim(), packageId: state.packageId, status: "awaiting-payment-setup" as const });
            update({ ...state, stage: "draft", draft });
            return true;
        },
        reset() { update({ open: false, packageId: "gold-10m", stage: "browse", draft: null }); },
    };
}

export const duelShopStore = createDuelShopStore();

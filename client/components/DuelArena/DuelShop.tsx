import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DUEL_SHOP_PACKAGES, duelShopPrice, findDuelShopPackage, ShopCurrency } from "../../common/duel/DuelShop";
import { duelShopStore, isValidShopEmail } from "../../game/duel/DuelShopStore";
import { CacheItemIcon, CurrencyIcon } from "./CurrencyIcon";
import { DuelModal } from "./DuelModal";
import "./DuelShop.css";

const currencyName = (currency: ShopCurrency) => currency === "gold" ? "Gold coins" : "Platinum tokens";

export function DuelShop({ playerName }: { playerName: string }) {
    const shop = useSyncExternalStore(duelShopStore.subscribe, duelShopStore.getSnapshot);
    const [email, setEmail] = useState("");
    const emailInput = useRef<HTMLInputElement>(null);
    const checkoutButton = useRef<HTMLButtonElement>(null);
    const doneButton = useRef<HTMLButtonElement>(null);
    useEffect(() => { setEmail(""); return () => duelShopStore.reset(); }, [playerName]);
    useEffect(() => {
        if (!shop.open) return;
        const frame = requestAnimationFrame(() => {
            if (shop.stage === "browse") checkoutButton.current?.focus();
            else if (shop.stage === "review") emailInput.current?.focus();
            else doneButton.current?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [shop.open, shop.stage]);
    if (!shop.open) return null;
    const product = findDuelShopPackage(shop.packageId)!;
    const browsing = shop.stage === "browse";
    const ordered = shop.stage === "draft";
    const quantity = product.quantity.toLocaleString("en-US");
    return <DuelModal title="The Arena Exchange" onClose={duelShopStore.close} wide>
        <div className="duel-shop">
            <div className="duel-shop-intro"><span className="duel-shop-seal" aria-hidden="true">✦</span>
                <div><span className="duel-shop-eyebrow">COURTYARD MERCHANT</span>
                    <p>Welcome, {playerName}. Take a look at my gold and platinum packages.</p></div></div>
            <div className="duel-shop-progress" aria-label="Order progress">
                <span aria-current={browsing ? "step" : undefined}>01 <b>Choose package</b></span>
                <span aria-current={shop.stage === "review" ? "step" : undefined}>02 <b>Checkout</b></span>
                <span aria-current={ordered ? "step" : undefined}>03 <b>Order draft</b></span>
            </div>
            {browsing ? <>
                <div className="duel-shop-tabs" role="group" aria-label="Shop currency">
                    {(["gold", "platinum"] as const).map(currency => <button type="button" key={currency}
                        aria-pressed={product.currency === currency}
                        onClick={() => duelShopStore.select(DUEL_SHOP_PACKAGES.find(item => item.currency === currency)!.id)}>
                        <CacheItemIcon itemId={currency === "gold" ? 995 : 13204} quantity={10000} showQuantity={false} />{currencyName(currency)}</button>)}
                </div>
                <div className="duel-shop-packages" role="group" aria-label="Currency packages">
                    {DUEL_SHOP_PACKAGES.filter(item => item.currency === product.currency).map(item =>
                        <button type="button" key={item.id} className="duel-shop-package" aria-pressed={item.id === product.id}
                            onClick={() => duelShopStore.select(item.id)}>
                            <span className={`duel-shop-package-art ${item.packaging === "bundle" ? "is-bundle" : ""}`}>
                                <CacheItemIcon itemId={item.packaging === "chest" ? 405 : 22521} />
                                {item.packaging === "bundle" && <CacheItemIcon itemId={22521} />}</span>
                            <span className="duel-shop-package-name">{item.name}</span>
                            <strong>{item.quantity.toLocaleString("en-US")}</strong><span>{currencyName(item.currency)}</span>
                            <span className="duel-shop-package-description">{item.description}</span>
                            <small>{duelShopPrice(item)}</small><span className="duel-shop-selected">{item.id === product.id ? "Selected" : "Select package"}</span>
                        </button>)}
                </div>
            </> : <section className="duel-shop-review" aria-label="Order summary">
                <div className="duel-shop-review-title"><CurrencyIcon currency={product.currency} quantity={product.quantity} />
                    <div><span>{currencyName(product.currency)}</span><strong>{quantity}</strong></div>
                    <span className="duel-shop-status">{ordered ? "DRAFT" : "REVIEW"}</span></div>
                <dl><div><dt>Account</dt><dd>{playerName}</dd></div><div><dt>Package</dt><dd>{product.label}</dd></div>
                    {ordered && <div><dt>Email</dt><dd>{shop.draft?.email}</dd></div>}
                    <div><dt>Total</dt><dd>{duelShopPrice(product)}</dd></div><div><dt>Payment</dt><dd>Not available yet</dd></div></dl>
            </section>}
            {shop.stage === "review" && <form id="duel-shop-checkout" className="duel-shop-checkout" onSubmit={event => {
                event.preventDefault(); duelShopStore.order(playerName, email);
            }}>
                <div><label htmlFor="duel-shop-username">Game username</label>
                    <input id="duel-shop-username" value={playerName} readOnly autoComplete="off" />
                    <small>Your signed-in account</small></div>
                <div><label htmlFor="duel-shop-email">Email address</label>
                    <input id="duel-shop-email" ref={emailInput} type="email" value={email} required maxLength={254} autoComplete="email"
                        placeholder="you@example.com" onChange={event => setEmail(event.target.value)} />
                    <small>For order updates when checkout opens</small></div>
            </form>}
            {ordered && <div className="duel-shop-draft-message" role="status"><strong>Your order draft is ready</strong>
                <p>Payments are not available yet; no payment was taken.</p></div>}
            {!ordered && <p className="duel-shop-payment-note">Purchases open soon. Choose a package to prepare your order.</p>}
            <footer className="duel-shop-footer"><span>{browsing ? "Choose a package to continue" : ordered ? "Saved in this session" : "Check your account and amount"}</span>
                <div>{!browsing && <button key="shop-back" type="button" onClick={duelShopStore.back}>{ordered ? "Browse packages" : "Back"}</button>}
                    {browsing ? <button key="shop-checkout" ref={checkoutButton} type="button" className="duel-primary" onClick={event => {
                        event.preventDefault(); duelShopStore.review();
                    }}>Checkout →</button> :
                        !ordered ? <button key="shop-order" className="duel-primary" type="submit" form="duel-shop-checkout" disabled={!isValidShopEmail(email)}>Order</button> :
                            <button key="shop-done" ref={doneButton} type="button" className="duel-primary" onClick={duelShopStore.close}>Done</button>}</div></footer>
        </div>
    </DuelModal>;
}

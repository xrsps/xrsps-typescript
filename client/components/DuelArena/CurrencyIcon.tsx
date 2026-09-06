import { createContext, useContext, useEffect, useState } from "react";
import type { OsrsClient } from "../../game/OsrsClient";
import type { ItemIconRenderer } from "../../ui/item/ItemIconRenderer";
import { itemStackText } from "../../common/items/ItemStackText";

export const CurrencyIconContext = createContext<OsrsClient | null>(null);
const icons = new WeakMap<ItemIconRenderer, Map<number, string>>();

/** Render the cache's count-specific item model, at native inventory sprite resolution. */
function currencySprite(client: OsrsClient, itemId: number, quantity: number): string | undefined {
    const renderer = (client.renderer as unknown as { itemIconRenderer?: ItemIconRenderer }).itemIconRenderer;
    if (!renderer || !client.objTypeLoader) return;
    const variant = client.objTypeLoader.load(itemId).getCountObj(client.objTypeLoader, Math.max(1, quantity));
    let cache = icons.get(renderer);
    if (!cache) { cache = new Map(); icons.set(renderer, cache); }
    let src = cache.get(variant.id);
    if (!src) {
        const canvas = renderer.renderToCanvas(variant.id, 1, { outline: 1, shadow: 0, quantityMode: 0 });
        if (!canvas) return;
        src = canvas.toDataURL("image/png");
        cache.set(variant.id, src);
    }
    return src;
}

export function CacheItemIcon({ itemId, quantity = 1, showQuantity = false }: { itemId: number; quantity?: number; showQuantity?: boolean }) {
    const client = useContext(CurrencyIconContext);
    const [src, setSrc] = useState<string>();
    useEffect(() => {
        if (!client) { setSrc(undefined); return; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;
        const draw = () => {
            if (cancelled) return;
            try {
                const image = currencySprite(client, itemId, quantity);
                if (image) { setSrc(image); return; }
            } catch { /* Cache models may still be streaming; retry when ready. */ }
            timer = setTimeout(draw, 300);
        };
        draw();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [client, itemId, quantity]);
    const stack = itemStackText(quantity);
    return <span className="duel-currency-icon" data-item-id={itemId} aria-hidden="true">
        {src && <img src={src} width={36} height={32} alt="" draggable={false} />}
        {showQuantity && quantity > 0 && <span className="duel-stack-quantity" style={{ color: stack.color }}>{stack.text}</span>}
    </span>;
}

export function CurrencyIcon({ currency, quantity }: { currency: "gold" | "platinum"; quantity: number }) {
    return <CacheItemIcon itemId={currency === "gold" ? 995 : 13204} quantity={quantity} showQuantity />;
}

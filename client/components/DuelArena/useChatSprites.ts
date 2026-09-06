import { CSSProperties, useContext, useEffect, useState } from "react";
import { IndexType } from "../../rs/cache/IndexType";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { CurrencyIconContext } from "./CurrencyIcon";

/** Original cache chatbox (1017), channel strip (1018), buttons and report tab. */
const SPRITES = { paper: 1017, tabs: 1018, button: 3051, report: 3057 } as const;
export function useChatSprites(): CSSProperties {
    const client = useContext(CurrencyIconContext);
    const [style, setStyle] = useState<CSSProperties>({});
    useEffect(() => {
        if (!client) return;
        let timer: ReturnType<typeof setTimeout>;
        let stopped = false;
        const load = () => {
            if (stopped) return;
            try {
                const index = client.cacheSystem.getIndex(IndexType.DAT2.sprites);
                const result: Record<string, string> = {};
                for (const [name, id] of Object.entries(SPRITES)) {
                    const sprite = SpriteLoader.loadIntoIndexedSprite(index, id);
                    if (!sprite) { timer = setTimeout(load, 300); return; }
                    const canvas = document.createElement("canvas");
                    canvas.width = sprite.width; canvas.height = sprite.height;
                    const context = canvas.getContext("2d");
                    if (!context) return;
                    const image = context.createImageData(canvas.width, canvas.height);
                    for (let y = 0; y < sprite.subHeight; y++) for (let x = 0; x < sprite.subWidth; x++) {
                        const source = y * sprite.subWidth + x, palette = sprite.pixels[source];
                        const rgb = sprite.palette[palette], target = ((y + sprite.yOffset) * canvas.width + x + sprite.xOffset) * 4;
                        image.data[target] = (rgb >>> 16) & 255; image.data[target + 1] = (rgb >>> 8) & 255; image.data[target + 2] = rgb & 255;
                        image.data[target + 3] = sprite.alpha?.[source] ?? (palette === 0 ? 0 : 255);
                    }
                    context.putImageData(image, 0, 0);
                    result[`--chat-${name}`] = `url("${canvas.toDataURL("image/png")}")`;
                }
                setStyle(result as CSSProperties);
            } catch { timer = setTimeout(load, 300); }
        };
        load();
        return () => { stopped = true; clearTimeout(timer); };
    }, [client]);
    return style;
}

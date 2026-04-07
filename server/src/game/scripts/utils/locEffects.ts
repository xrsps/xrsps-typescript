import {
    type LocEffectDefinition,
    getLocEffect,
    registerLocEffects,
} from "../../../data/locEffects";
import { type ScriptServices } from "../types";

export const triggerLocEffect = (
    services: ScriptServices,
    locId: number,
    tile: { x: number; y: number } | undefined,
    level: number,
): boolean => {
    if (!tile) return false;
    const effect = getLocEffect(locId);
    if (!effect) return false;
    if (effect.graphic) {
        services.animation.playLocGraphic({
            spotId: effect.graphic.spotId,
            tile: { x: tile.x, y: tile.y },
            level: level,
            height: effect.graphic.height,
            delayTicks: effect.graphic.delayTicks,
        });
    }
    if (effect.sound) {
        services.sound.playLocSound({
            soundId: effect.sound.soundId,
            tile: { x: tile.x, y: tile.y },
            level: level,
            loops: effect.sound.loops,
            delayMs: effect.sound.delayMs,
        });
    }
    return true;
};

export const registerLocEffectsForScript = (
    locIds: Iterable<number>,
    effect: LocEffectDefinition,
): (() => void) => {
    const entries = Array.from(locIds, (locId) => ({ locId, effect }));
    if (entries.length === 0) return () => {};
    return registerLocEffects(entries);
};

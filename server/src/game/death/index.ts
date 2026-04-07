/**
 * Player Death System
 *
 * Exports for the death system module following OSRS/RSMod patterns.
 */

// Types
export {
    DeathType,
    DEATH_ANIMATION_ID,
    DEATH_ANIMATION_TICKS,
    DEFAULT_RESPAWN_LOCATIONS,
    type DeathContext,
    type DeathHookResult,
    type ItemProtectionResult,
    type ItemSource,
    type PlayerDeathServices,
    type PostDeathHook,
    type PreDeathHook,
    type RespawnLocation,
    type ValuedItem,
} from "./types";

// Item Protection Calculator
export {
    ItemProtectionCalculator,
    getKeptItemCount,
    type ItemProtectionOptions,
} from "./ItemProtectionCalculator";

// Death Hook Registry
export {
    DeathHookRegistry,
    createRingOfLifeHook,
    createPhoenixNecklaceHook,
} from "./DeathHookRegistry";

// Player Death Service
export { PlayerDeathService } from "./PlayerDeathService";

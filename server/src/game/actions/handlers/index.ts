/**
 * Action handlers module.
 *
 * Contains specialized handlers for different action categories,
 * extracted from wsServer for better organization and testability.
 */

export {
    CombatActionHandler,
    type CombatActionServices,
    type ProjectileParams,
    type ProjectileTiming,
    type NpcCombatSequences,
    type SpellCastRequest,
    type HitPayload,
    type SpecialAttackPayload,
    type SpotAnimRequest,
    type SoundRequest,
    type ChatMessageRequest,
    type ActionScheduleRequest,
    type ActionScheduleResult,
    type InteractionState,
    type SkillSync,
} from "./CombatActionHandler";

export { SkillActionHandler, type SkillActionServices } from "./SkillActionHandler";

export {
    SpellActionHandler,
    type SpellActionServices,
    type SpellCastModifiers,
    type SpellTargetKind,
    type SpellCastTarget,
    type SpellResultPayload,
    type SpellDataEntry,
    type PlayerAttackPlan,
    type SpellCastContext,
    type SpellValidationResult,
    type SpellExecutionResult,
    type SpellCastNpcPayload,
    type SpellCastPlayerPayload,
    type SpellCastLocPayload,
    type SpellCastObjPayload,
} from "./SpellActionHandler";

export {
    InventoryActionHandler,
    type InventoryActionServices,
    type EquipResult,
    type UnequipResult,
    type CookingRecipe,
    type ObjTypeInfo,
} from "./InventoryActionHandler";

export {
    EffectDispatcher,
    type EffectDispatcherServices,
    type HitsplatBroadcast,
    type ForcedChatBroadcast,
    type ForcedMovementBroadcast,
    type LevelUpPopup,
    type TickFrame,
} from "./EffectDispatcher";
export type { ProjectileLaunch } from "../../../../../src/shared/projectiles/ProjectileLaunch";

export {
    WidgetDialogHandler,
    type WidgetDialogServices,
    type WidgetAction,
    type ScriptDialogRequest,
    type ScriptDialogOptionRequest,
    type WidgetActionRequest,
} from "./WidgetDialogHandler";

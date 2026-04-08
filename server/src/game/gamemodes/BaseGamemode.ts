import type { PlayerState } from "../player";
import type { IScriptRegistry, ScriptServices } from "../scripts/types";
import type {
    GamemodeDefinition,
    GamemodeInitContext,
    GamemodeUiBridge,
    GamemodeUiController,
    HandshakeBridge,
    GamemodeBridge,
} from "./GamemodeDefinition";

const DEFAULT_SPAWN = { x: 3222, y: 3218, level: 0 };

/**
 * Default UI controller providing no-op implementations for gamemodes
 * that don't need side journal, tutorial overlay, or custom widget lifecycle.
 */
export class DefaultUiController implements GamemodeUiController {
    normalizeSideJournalState(
        _player: PlayerState,
        incomingStateVarp?: number,
    ): { tab: number; stateVarp: number } {
        return { tab: 0, stateVarp: incomingStateVarp ?? 0 };
    }

    applySideJournalUi(_player: PlayerState): void {}

    queueTutorialOverlay(
        _player: PlayerState,
        _opts?: { queueFlashsideVarbitOnStep3?: boolean },
    ): void {}

    handleWidgetClose(_player: PlayerState, _groupId: number): void {}

    handleWidgetOpen(_player: PlayerState, _groupId: number): void {}

    activateQuestTab(_playerId: number): void {}

    getSideJournalBootstrapState(_player: PlayerState): {
        varps: Record<number, number>;
        varbits: Record<number, number>;
    } {
        return { varps: {}, varbits: {} };
    }
}

/**
 * Abstract base providing sensible OSRS defaults for every
 * {@link GamemodeDefinition} hook.  Extend this when building a gamemode
 * from scratch without vanilla systems (banking, shops, skills, etc.).
 *
 * For a full OSRS experience, extend {@link VanillaGamemode} instead.
 */
export abstract class BaseGamemode implements GamemodeDefinition {
    abstract readonly id: string;
    abstract readonly name: string;

    // === XP ===

    getSkillXpMultiplier(_player: PlayerState): number {
        return 1;
    }

    // === Drops ===

    getDropRateMultiplier(_player: PlayerState | undefined): number {
        return 1;
    }

    isDropBoostEligible(_entry: { dropBoostEligible?: boolean }): boolean {
        return false;
    }

    transformDropItemId(_npcTypeId: number, itemId: number, _player: PlayerState | undefined): number {
        return itemId;
    }

    // === Player Rules ===

    hasInfiniteRunEnergy(_player: PlayerState): boolean {
        return false;
    }

    canInteract(_player: PlayerState): boolean {
        return true;
    }

    // === Player Lifecycle ===

    initializePlayer(_player: PlayerState): void {}

    serializePlayerState(_player: PlayerState): Record<string, unknown> | undefined {
        return undefined;
    }

    deserializePlayerState(_player: PlayerState, _data: Record<string, unknown>): void {}

    onNpcKill(_playerId: number, _npcTypeId: number, _combatLevel?: number): void {}

    // === Login / Handshake ===

    isTutorialActive(_player: PlayerState): boolean {
        return false;
    }

    getSpawnLocation(_player: PlayerState): { x: number; y: number; level: number } {
        return DEFAULT_SPAWN;
    }

    onPlayerHandshake(_player: PlayerState, _bridge: HandshakeBridge): void {}

    onPlayerLogin(_player: PlayerState, _bridge: GamemodeBridge): void {}

    // === Display ===

    getDisplayName(_player: PlayerState, baseName: string, _isAdmin: boolean): string {
        return baseName;
    }

    getChatPlayerType(_player: PlayerState, _isAdmin: boolean): number {
        return 0;
    }

    // === Scripts ===

    registerHandlers(_registry: IScriptRegistry, _services: ScriptServices): void {}

    // === UI Controller ===

    createUiController(_bridge: GamemodeUiBridge): GamemodeUiController {
        return new DefaultUiController();
    }

    // === Server Lifecycle ===

    initialize(_context: GamemodeInitContext): void {}

    dispose(): void {}
}

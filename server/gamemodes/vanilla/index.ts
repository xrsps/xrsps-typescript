import type { PlayerState } from "../../src/game/player";
import type { ScriptManifestEntry } from "../../src/game/scripts/manifest";
import type { GamemodeBridge, GamemodeDefinition, GamemodeInitContext, HandshakeBridge } from "../../src/game/gamemodes/GamemodeDefinition";

const DEFAULT_SPAWN = { x: 3222, y: 3218, level: 0 };

export class VanillaGamemode implements GamemodeDefinition {
    readonly id = "vanilla";
    readonly name = "Vanilla";

    getSkillXpMultiplier(_player: PlayerState): number {
        return 1;
    }

    getDropRateMultiplier(_player: PlayerState | undefined): number {
        return 1;
    }

    isDropBoostEligible(_entry: { dropBoostEligible?: boolean }): boolean {
        return false;
    }

    transformDropItemId(_npcTypeId: number, itemId: number, _player: PlayerState | undefined): number {
        return itemId;
    }

    hasInfiniteRunEnergy(_player: PlayerState): boolean {
        return false;
    }

    canInteract(_player: PlayerState): boolean {
        return true;
    }

    initializePlayer(_player: PlayerState): void {}

    serializePlayerState(_player: PlayerState): Record<string, unknown> | undefined {
        return undefined;
    }

    deserializePlayerState(_player: PlayerState, _data: Record<string, unknown>): void {}

    onNpcKill(_playerId: number, _npcTypeId: number): void {}

    isTutorialActive(_player: PlayerState): boolean {
        return false;
    }

    getSpawnLocation(_player: PlayerState): { x: number; y: number; level: number } {
        return DEFAULT_SPAWN;
    }

    onPlayerHandshake(_player: PlayerState, _bridge: HandshakeBridge): void {}

    onPlayerLogin(_player: PlayerState, _bridge: GamemodeBridge): void {}

    getDisplayName(_player: PlayerState, baseName: string, _isAdmin: boolean): string {
        return baseName;
    }

    getChatPlayerType(_player: PlayerState, _isAdmin: boolean): number {
        return 0;
    }

    getScriptManifest(): ScriptManifestEntry[] {
        return [];
    }

    initialize(_context: GamemodeInitContext): void {}
}

export function createGamemode(): GamemodeDefinition {
    return new VanillaGamemode();
}

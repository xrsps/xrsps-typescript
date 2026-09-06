import { DUEL_LOBBY_CENTER, type DuelSnapshot } from "../../../client/common/duel/DuelProtocol";
import { DUEL_SHOPKEEPER } from "../../../client/common/duel/DuelShop";
import { encodeDuelSnapshot } from "../../src/network/packet/DuelSnapshotEncoder";
import { BaseGamemode, DefaultUiController } from "../../src/game/gamemodes/BaseGamemode";
import type { GamemodeInitContext, GamemodeUiBridge } from "../../src/game/gamemodes/GamemodeDefinition";
import type { PlayerState } from "../../src/game/player";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import { DEFAULT_LOGIN_VARBITS } from "../vanilla/data/loginVarbits";
import { DEFAULT_LOGIN_VARPS } from "../vanilla/data/loginVarps";
import { DuelArenaService } from "./DuelArenaService";
import { buildDuelLobbyPacket, installDuelLobbyCollision } from "./DuelLobbyScene";
import { registerDuelProviders } from "./DuelProviders";

export class DuelGamemode extends BaseGamemode {
    override readonly id = "duel";
    override readonly name = "Duel Arena";
    private arena?: DuelArenaService;
    private duelScripts?: ScriptServices;

    override initialize(context: GamemodeInitContext): void {
        registerDuelProviders();
        installDuelLobbyCollision(context.serverServices);
        context.serverServices.spawnNpc({ ...DUEL_SHOPKEEPER, name: "Shop keeper" });
        this.arena = new DuelArenaService(context.serverServices);
        if (this.duelScripts) this.arena.setScriptServices(this.duelScripts);
        context.serverServices.registerSnapshotEncoder("duel", (_id, payload) => ({
            message: encodeDuelSnapshot(payload as DuelSnapshot), context: "duel_snapshot",
        }));
        context.serverServices.registerTickCallback((tick) => this.arena?.tick(tick));
    }

    override registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
        this.duelScripts = services;
        this.arena?.setScriptServices(services);
        registry.registerCommand("duel", ({ player, args }) => this.arena?.command(player, args));
    }

    override initializePlayer(player: PlayerState): void { player.account.accountStage = 2; }
    resolveAccountStage(player: PlayerState): void { player.account.accountStage = 2; }
    override getSpawnLocation(_player: PlayerState) { return { ...DUEL_LOBBY_CENTER }; }
    onPlayerRestore(player: PlayerState): void { this.arena?.enter(player); }
    onPlayerDisconnect(playerId: number): void { this.arena?.disconnect(playerId); }
    override shouldLoadDefaultNpcSpawns(): boolean { return false; }
    getContentDataPacket(): Uint8Array { return buildDuelLobbyPacket(); }
    shouldSpawnTestBots(): boolean { return false; }
    getLoginVarbits(_player: PlayerState): Array<[number, number]> { return DEFAULT_LOGIN_VARBITS; }
    getLoginVarps(_player: PlayerState): Array<[number, number]> { return DEFAULT_LOGIN_VARPS; }
    override getSkillXpMultiplier(_player: PlayerState): number { return 0; }
    override createUiController(_bridge: GamemodeUiBridge): DefaultUiController {
        return new DefaultUiController();
    }
    canAttackPlayer(attacker: PlayerState, target: PlayerState): boolean {
        return this.arena?.canAttack(attacker, target) ?? false;
    }
    canSeePlayer(viewer: PlayerState, target: PlayerState): boolean {
        return this.arena?.canSee(viewer, target) ?? viewer.id === target.id;
    }
    getPublicChatRecipientIds(sender: PlayerState): number[] { return this.arena?.publicChatRecipients(sender) ?? []; }
    canMoveTo(player: PlayerState, x: number, y: number): boolean {
        return this.arena?.canMove(player, x, y) ?? false;
    }
    getMovementGroup(player: PlayerState): string {
        return this.arena?.movementGroup(player) ?? "duel:lobby";
    }
    handlePlayerDeath(player: PlayerState): boolean { return this.arena?.handleDeath(player) ?? true; }
    allowClientMessage(_player: PlayerState, type: string, payload: unknown): boolean {
        if (type === "chat") {
            const text = (payload as { text?: unknown })?.text;
            return typeof text === "string" && (!text.trim().startsWith("::") || /^::duel(?:\s|$)/i.test(text.trim()));
        }
        return ["walk", "player_attack", "logout", "ping", "keepalive", "window_status",
            "client_info", "interface_close", "focus", "idle"].includes(type);
    }
}

export function createGamemode(): DuelGamemode { return new DuelGamemode(); }

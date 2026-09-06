import { DUEL_LOBBY_CENTER, type DuelSnapshot } from "../../../client/common/duel/DuelProtocol";
import { DUEL_SHOPKEEPER } from "../../../client/common/duel/DuelShop";
import { encodeDuelSnapshot } from "../../src/network/packet/DuelSnapshotEncoder";
import { BaseGamemode } from "../../src/game/gamemodes/BaseGamemode";
import type { GamemodeInitContext, GamemodeUiBridge } from "../../src/game/gamemodes/GamemodeDefinition";
import type { PlayerState } from "../../src/game/player";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import { DEFAULT_LOGIN_VARBITS } from "../vanilla/data/loginVarbits";
import { DEFAULT_LOGIN_VARPS } from "../vanilla/data/loginVarps";
import { DuelArenaService } from "./DuelArenaService";
import { buildDuelLobbyPacket } from "./DuelLobbyScene";
import { registerDuelProviders } from "./DuelProviders";
import { allowDuelClientMessage } from "./DuelClientRules";
import { DuelNativeBank } from "./DuelNativeBank";
import { registerDuelNativeUi } from "./DuelNativeUi";
import { VanillaUiController } from "../vanilla/VanillaUiController";
import { registerEquipmentStatsInterfaceHooks } from "../vanilla/equipment/EquipmentStatsInterfaceHooks";
import { registerWidgetCloseHandlers } from "../vanilla/modals/widgetCloseHandlers";
import { registerWidgetOpenHandlers } from "../vanilla/modals/widgetOpenHandlers";
import { DisplayMode } from "../../src/widgets/viewport";

export class DuelGamemode extends BaseGamemode {
    override readonly id = "duel";
    override readonly name = "Duel Arena";
    private arena?: DuelArenaService;
    private duelScripts?: ScriptServices;
    private nativeBank?: DuelNativeBank;
    private serverServices?: GamemodeInitContext["serverServices"];

    override initialize(context: GamemodeInitContext): void {
        registerDuelProviders();
        context.serverServices.spawnNpc({ ...DUEL_SHOPKEEPER, name: "Shop keeper" });
        this.arena = new DuelArenaService(context.serverServices);
        this.serverServices = context.serverServices;
        this.nativeBank = new DuelNativeBank(context.serverServices, this.arena);
        const interfaces = context.serverServices.getInterfaceService();
        if (interfaces) registerEquipmentStatsInterfaceHooks(interfaces);
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
        registerDuelNativeUi(registry, services);
    }

    contributeScriptServices(services: ScriptServices): void {
        this.duelScripts = services;
        this.arena?.setScriptServices(services);
        this.nativeBank?.contribute(services);
        registerWidgetCloseHandlers(services, {
            closeModal: (player) => this.serverServices?.getInterfaceService()?.closeModal(player),
        });
        registerWidgetOpenHandlers(services);
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
    getLoginDisplayMode(_player: PlayerState): DisplayMode { return DisplayMode.FIXED; }
    override getSkillXpMultiplier(_player: PlayerState): number { return 0; }
    override createUiController(bridge: GamemodeUiBridge): VanillaUiController {
        return new VanillaUiController(bridge);
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
    allowClientMessage(player: PlayerState, type: string, payload: unknown): boolean {
        return allowDuelClientMessage(player, type, payload, this.arena?.isFreeInLobby(player) ?? false);
    }
}

export function createGamemode(): DuelGamemode { return new DuelGamemode(); }

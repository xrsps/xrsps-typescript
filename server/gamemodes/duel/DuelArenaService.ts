import type { DuelParticipant, DuelSnapshot } from "../../../client/common/duel/DuelProtocol";
import { ARENA_CENTER, DUEL_LOBBY_BOUNDS, DUEL_LOBBY_CENTER } from "../../../client/common/duel/DuelProtocol";
import type { GamemodeServerServices } from "../../src/game/gamemodes/GamemodeDefinition";
import { LockState } from "../../src/game/model/LockState";
import type { PlayerState } from "../../src/game/player";
import type { ScriptServices } from "../../src/game/scripts/types";
import { DuelEconomy } from "./DuelEconomy";
import { accountKey } from "./DuelCurrency";
import { equipDuelWeapon, prepareDuelFighter, stopDuelCombat } from "./DuelLoadout";
import { DuelNegotiation } from "./DuelNegotiation";
import { type DuelSession, isDuelInArena } from "./DuelSession";
import { DuelTradeService } from "./DuelTradeService";
import { findDuelLobbySpawn } from "./DuelLobbySpawns";

/** Shared lobby, two-human negotiations and isolated, safely settled OSRS combat. */
export class DuelArenaService {
    private readonly rooms = new Map<string, DuelSession>();
    private readonly memberships = new Map<number, DuelSession>();
    private readonly connected = new Map<number, PlayerState>();
    private readonly notices = new Map<number, string>();
    private readonly negotiation: DuelNegotiation;
    private readonly trade: DuelTradeService;
    private scripts?: ScriptServices;

    constructor(private readonly services: GamemodeServerServices,
        private readonly economy: DuelEconomy = new DuelEconomy()) {
        this.trade = new DuelTradeService(economy, { getPlayer: (id) => this.connected.get(id),
            isAvailable: (player) => !this.memberships.has(player.id),
            notice: (player, message) => this.notice(player, message), getTick: () => services.getCurrentTick() });
        this.negotiation = new DuelNegotiation({ players: this.connected, memberships: this.memberships,
            sessions: this.rooms, economy, tick: () => services.getCurrentTick(),
            available: (player) => !this.memberships.has(player.id) && !this.trade.isBusy(player.id),
            notice: (player, message) => this.notice(player, message), start: (room) => this.start(room) });
    }
    setScriptServices(scripts: ScriptServices): void { this.scripts = scripts; }

    isFreeInLobby(player: PlayerState): boolean {
        return this.connected.get(player.id) === player && !this.memberships.has(player.id) &&
            !this.trade.isBusy(player.id) && player.level === DUEL_LOBBY_CENTER.level && this.insideLobby(player.tileX, player.tileY);
    }

    mutateBank<T>(player: PlayerState, mutation: () => T): T {
        if (!this.isFreeInLobby(player)) throw Error("Finish or cancel your current duel or trade first.");
        return this.economy.mutateBank(player, mutation);
    }

    enter(player: PlayerState): void {
        this.economy.initialize(player);
        this.connected.set(player.id, player);
        this.returnToLobby(player);
        this.publishAll();
    }

    command(player: PlayerState, args: string[]): void {
        if (this.connected.get(player.id) !== player) return;
        const [action, ...values] = args;
        this.notices.delete(player.id);
        try {
            if (!this.negotiation.command(player, action, values) && !this.trade.command(player, args)) {
                switch (action) {
                    case "leave": this.leave(player.id); break;
                    case "attack": this.attack(player, false); break;
                    case "special": this.attack(player, true); break;
                    case "bank": this.bank(player, values); break;
                    case "exchange": this.exchange(player, values); break;
                    case "weapon": throw Error("The agreed weapon is fixed for the entire duel.");
                    default: throw Error("Right-click another player to challenge or trade.");
                }
            }
        } catch (error) {
            this.notice(player, error instanceof Error ? error.message : "That action could not be completed.");
        }
        this.publishAll();
    }

    canAttack(attacker: PlayerState, target: PlayerState): boolean {
        const room = this.memberships.get(attacker.id);
        return !!room && room.status === "fighting" && room === this.memberships.get(target.id) &&
            attacker.id !== target.id && this.connected.get(attacker.id) === attacker &&
            this.connected.get(target.id) === target && attacker.level === ARENA_CENTER.level &&
            target.level === ARENA_CENTER.level && this.insideArena(attacker.tileX, attacker.tileY) &&
            this.insideArena(target.tileX, target.tileY) && attacker.combat.weaponItemId === room.weaponId &&
            target.combat.weaponItemId === room.weaponId;
    }
    canSee(viewer: PlayerState, target: PlayerState): boolean {
        if (viewer.id === target.id) return true;
        const viewerRoom = this.memberships.get(viewer.id), targetRoom = this.memberships.get(target.id);
        if (!isDuelInArena(viewerRoom) && !isDuelInArena(targetRoom)) return true;
        return !!viewerRoom && viewerRoom === targetRoom;
    }
    canMove(player: PlayerState, x: number, y: number): boolean {
        if (this.connected.get(player.id) !== player || this.trade.isBusy(player.id)) return false;
        const room = this.memberships.get(player.id);
        return room ? room.status === "fighting" && this.insideArena(x, y) : this.insideLobby(x, y);
    }
    publicChatRecipients(sender: PlayerState): number[] {
        if (this.connected.get(sender.id) !== sender) return [];
        return [...this.connected.values()].filter((player) => this.canSee(sender, player)).map((player) => player.id);
    }
    movementGroup(player: PlayerState): string {
        const room = this.memberships.get(player.id);
        return isDuelInArena(room) ? room!.code : "duel:lobby";
    }

    handleDeath(player: PlayerState): boolean {
        const room = this.memberships.get(player.id);
        if (room?.status === "fighting") {
            const winner = room.seats.find((seat) => seat.player.id !== player.id)!;
            this.finish(room, winner.player.id, `${winner.player.name} wins the full stake!`);
            player.queueOneShotSeq(836, 0);
        } else stopDuelCombat(player);
        return true;
    }
    disconnect(playerId: number): void {
        this.trade.disconnect(playerId);
        this.negotiation.removeRequests(playerId);
        this.leave(playerId, true);
        this.memberships.delete(playerId);
        this.connected.delete(playerId);
        this.notices.delete(playerId);
        this.publishAll();
    }

    tick(tick: number): void {
        this.negotiation.tick(); this.trade.tick();
        for (const room of this.rooms.values()) {
            if (room.status === "countdown" && tick >= room.startsAt) {
                room.status = "fighting"; room.message = "Fight! Click your opponent or press Attack.";
                for (const seat of room.seats) seat.player.lock = LockState.NONE;
            }
            if (isDuelInArena(room) && room.status !== "finished") {
                for (const seat of room.seats) {
                    const player = seat.player;
                    if (player.combat.weaponItemId !== room.weaponId || player.appearance.equip?.[3] !== room.weaponId) {
                        equipDuelWeapon(player, room.weaponId, this.services);
                    }
                    if (player.level !== ARENA_CENTER.level || !this.insideArena(player.tileX, player.tileY)) {
                        const winner = room.seats.find((entry) => entry !== seat)!;
                        this.finish(room, room.status === "countdown" ? null : winner.player.id,
                            room.status === "countdown" ? "The duel could not start. Both stakes are refunded." : "Your opponent left the ring. You win the full stake.");
                    }
                    if (room.status === "fighting" && player.skillSystem.getHitpointsCurrent() <= 0) this.handleDeath(player);
                }
            }
            if (room.status === "finished") {
                this.settle(room);
                if (!room.escrowed && tick >= room.finishedAt + 10) this.close(room, room.message);
            }
        }
        for (const player of this.connected.values()) {
            if (!this.memberships.has(player.id) && (player.level !== DUEL_LOBBY_CENTER.level || !this.insideLobby(player.tileX, player.tileY))) this.returnToLobby(player);
        }
        this.publishAll();
    }

    private start(room: DuelSession): void {
        try {
            room.seats.forEach((seat, side) => {
                this.services.getInterfaceService?.()?.closeModal(seat.player);
                prepareDuelFighter(seat.player, room.weaponId, side, this.services);
                this.position(seat.player, ARENA_CENTER.x + (side === 0 ? -2 : 2), ARENA_CENTER.y);
                seat.player.setForcedOrientation(side === 0 ? 1536 : 512);
                this.notices.delete(seat.player.id);
            });
            room.status = "countdown"; room.startsAt = this.services.getCurrentTick() + 5;
            room.message = "Stakes secured. Get ready.";
        } catch (error) {
            this.finish(room, null, "The duel could not start. Both stakes are refunded.");
            throw error;
        }
    }

    private leave(playerId: number, disconnected = false): void {
        const room = this.memberships.get(playerId), player = this.connected.get(playerId);
        if (room) {
            if (room.status === "countdown") {
                this.finish(room, null, "The duel was cancelled before the fight. Both stakes are refunded.");
            } else if (room.status === "fighting") {
                const other = room.seats.find((seat) => seat.player.id !== playerId)!;
                this.finish(room, other.player.id, disconnected ? "Your opponent disconnected. You win the full stake." : "Your opponent forfeited. You win the full stake.");
            }
            if (room.status === "staking" || room.status === "review") this.close(room, "The duel was cancelled. Your currency is unchanged.");
            else if (!room.escrowed) {
                this.memberships.delete(playerId);
                if (!room.seats.some((seat) => this.memberships.has(seat.player.id))) this.rooms.delete(room.code);
            } else if (!disconnected) throw Error("Your duel result is being saved. Please wait.");
        }
        this.negotiation.removeRequests(playerId);
        if (player) {
            stopDuelCombat(player); player.lock = LockState.NONE;
            if (!disconnected) this.returnToLobby(player);
        }
    }
    private finish(room: DuelSession, winnerId: number | null, message: string): void {
        if (room.status === "finished") return;
        room.status = "finished"; room.winnerId = winnerId;
        room.finishedAt = this.services.getCurrentTick(); room.message = message;
        for (const seat of room.seats) {
            stopDuelCombat(seat.player); seat.accepted = false; seat.confirmed = false;
            this.notices.delete(seat.player.id);
        }
        this.settle(room);
    }
    private settle(room: DuelSession): void {
        if (!room.escrowed) return;
        try {
            const accounts = new Set(room.seats.map((seat) => accountKey(seat.player)));
            // Reconnects may replace a PlayerState while a database failure is retried.
            // Only save live instances; offline recipients retain durable currency credits.
            const livePlayers = [...this.connected.values()].filter((player) => accounts.has(accountKey(player)));
            this.economy.settle(room.code, room.seats.find((seat) => seat.player.id === room.winnerId)?.player ?? null, livePlayers);
            room.escrowed = false;
            if (room.message.startsWith("Duel complete. Saving")) {
                const winner = room.seats.find((seat) => seat.player.id === room.winnerId)?.player;
                room.message = winner ? `${winner.name} wins the full stake!` : "Both stakes have been refunded.";
            }
        } catch (error) {
            this.services.logger.warn("[duel] Settlement will be retried", room.code, error);
            room.message = "Duel complete. Saving the result and transferring the stake…";
        }
    }
    private close(room: DuelSession, message: string): void {
        if (room.escrowed) return;
        for (const seat of room.seats) {
            if (this.memberships.get(seat.player.id) !== room) continue;
            this.memberships.delete(seat.player.id);
            if (this.connected.get(seat.player.id) === seat.player) {
                this.returnToLobby(seat.player); this.notice(seat.player, message);
            }
        }
        this.rooms.delete(room.code);
    }

    private bank(player: PlayerState, args: string[]): void {
        this.requireFree(player);
        const [action, currency, raw] = args;
        if (action === "open") { this.scripts?.banking?.openBank?.(player); return; }
        if ((action !== "deposit" && action !== "withdraw") || (currency !== "gold" && currency !== "platinum")) throw Error("Choose a bank action and currency.");
        this.economy.bank(player, action, currency, this.amount(raw));
        this.notice(player, action === "deposit" ? "Currency deposited in your bank." : "Currency withdrawn to your inventory.");
    }
    private exchange(player: PlayerState, args: string[]): void {
        this.requireFree(player);
        const [currency, raw] = args;
        if (currency !== "gold" && currency !== "platinum") throw Error("Choose gold or platinum tokens.");
        this.economy.exchange(player, currency, this.amount(raw));
        this.notice(player, "Currency exchanged at 1 platinum token = 1,000 gold.");
    }
    private requireFree(player: PlayerState): void {
        if (this.memberships.has(player.id) || this.trade.isBusy(player.id)) throw Error("Finish or cancel your current duel or trade first.");
    }
    private amount(raw?: string): number {
        if (!raw || !/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) throw Error("Enter a positive whole amount.");
        return Number(raw);
    }
    private returnToLobby(player: PlayerState): void {
        const spawn = findDuelLobbySpawn(player.id, this.connected.values());
        prepareDuelFighter(player, 5698, player.id % 2, this.services);
        this.position(player, spawn.x, spawn.y);
        player.lock = LockState.NONE;
    }
    private position(player: PlayerState, x: number, y: number): void {
        if (this.scripts) this.scripts.movement.teleportPlayer(player, x, y, 0);
        else player.teleport(x, y, 0);
    }
    private insideArena(x: number, y: number): boolean {
        return Number.isInteger(x) && Number.isInteger(y) && Math.abs(x - ARENA_CENTER.x) <= 6 && Math.abs(y - ARENA_CENTER.y) <= 6;
    }
    private insideLobby(x: number, y: number): boolean {
        return Number.isInteger(x) && Number.isInteger(y) && x >= DUEL_LOBBY_BOUNDS.minX && x <= DUEL_LOBBY_BOUNDS.maxX &&
            y >= DUEL_LOBBY_BOUNDS.minY && y <= DUEL_LOBBY_BOUNDS.maxY;
    }
    private notice(player: PlayerState, message: string): void { this.notices.set(player.id, message); }
    private publishAll(): void { for (const player of this.connected.values()) this.publish(player); }
    private participant(player: PlayerState, room?: DuelSession): DuelParticipant {
        const seat = room?.seats.find((entry) => entry.player === player);
        return { id: player.id, name: player.name ?? "Fighter", hp: player.skillSystem.getHitpointsCurrent(),
            maxHp: player.skillSystem.getHitpointsMax(), weaponId: room?.weaponId ?? 5698,
            specialEnergy: player.specEnergy.getPercent(), ready: !!seat?.accepted };
    }
    private publish(player: PlayerState): void {
        const room = this.memberships.get(player.id), self = room?.seats.find((seat) => seat.player === player);
        const other = room?.seats.find((seat) => seat.player !== player);
        const snapshot: DuelSnapshot = { roomCode: room?.code ?? null, status: room?.status ?? "idle",
            location: isDuelInArena(room) ? "arena" : "lobby", agreedWeaponId: room?.weaponId ?? null,
            countdownTicks: room?.status === "countdown" ? Math.max(0, room.startsAt - this.services.getCurrentTick()) : 0,
            self: this.participant(player, room), opponent: other ? this.participant(other.player, room) : null,
            lobbyPlayers: [...this.connected.values()].filter((entry) => !isDuelInArena(this.memberships.get(entry.id)))
                .slice(0, 256).map((entry) => ({ id: entry.id, name: entry.name ?? "Player" })),
            requests: this.negotiation.incoming(player), wallet: this.economy.wallet(player),
            trade: this.trade.snapshot(player), tradeRequests: this.trade.requests(player),
            stake: room && self && other ? { revision: room.revision, self: { ...self.offer }, opponent: { ...other.offer },
                selfAccepted: self.accepted, opponentAccepted: other.accepted, selfConfirmed: self.confirmed, opponentConfirmed: other.confirmed } : null,
            winnerId: room?.winnerId ?? null, message: this.notices.get(player.id) ?? room?.message ?? "Welcome to the Duel Courtyard. Right-click a player to challenge or trade." };
        this.services.queueGamemodeSnapshot("duel", player.id, snapshot);
    }
    private attack(player: PlayerState, special: boolean): void {
        const room = this.memberships.get(player.id), target = room?.seats.find((seat) => seat.player !== player)?.player;
        if (!target || !this.canAttack(player, target)) return;
        if (special) {
            const cost = room!.weaponId === 5698 ? 25 : 50;
            if (player.specEnergy.getPercent() < cost) throw Error(`You need ${cost}% special energy.`);
            player.specEnergy.setActivated(true);
        }
        player.setCombatTarget(target); player.combat.setInteractingPlayer(target); player.setInteraction("player", target.id);
    }
}

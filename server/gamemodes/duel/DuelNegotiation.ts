import { randomBytes } from "crypto";
import { DUEL_WEAPONS, type DuelWeaponId } from "../../../client/common/duel/DuelProtocol";
import type { PlayerState } from "../../src/game/player";
import type { DuelEconomy } from "./DuelEconomy";
import { accountKey } from "./DuelCurrency";
import { type DuelSession, resetDuelAcceptance } from "./DuelSession";

interface Challenge {
    id: string; fromId: number; toId: number; weaponId: DuelWeaponId; expiresAtTick: number;
}

interface NegotiationHost {
    players: ReadonlyMap<number, PlayerState>;
    memberships: Map<number, DuelSession>;
    sessions: Map<string, DuelSession>;
    economy: DuelEconomy;
    tick(): number;
    available(player: PlayerState): boolean;
    notice(player: PlayerState, message: string): void;
    start(session: DuelSession): void;
}

/** Server-authoritative requests and two-step, revision-bound stake approval. */
export class DuelNegotiation {
    private readonly requests = new Map<string, Challenge>();
    private readonly lastRequest = new Map<number, number>();
    constructor(private readonly host: NegotiationHost) {}

    command(player: PlayerState, action: string, args: string[]): boolean {
        switch (action) {
            case "challenge": this.challenge(player, args[0], args[1]); return true;
            case "respond": this.respond(player, args[0], args[1]); return true;
            case "offer": this.offer(player, args); return true;
            case "accept": this.accept(player, args[0], args[1], false); return true;
            case "confirm": this.accept(player, args[0], args[1], true); return true;
            default: return false;
        }
    }

    incoming(player: PlayerState) {
        return [...this.requests.values()].filter((request) => request.toId === player.id)
            .map((request) => ({ id: request.id, fromId: request.fromId,
                fromName: this.host.players.get(request.fromId)?.name ?? "Player",
                weaponId: request.weaponId, expiresInTicks: Math.max(0, request.expiresAtTick - this.host.tick()) }));
    }

    removeRequests(playerId: number): void {
        for (const request of this.requests.values()) {
            if (request.fromId === playerId || request.toId === playerId) this.requests.delete(request.id);
        }
    }

    tick(): void {
        for (const request of this.requests.values()) {
            if (request.expiresAtTick <= this.host.tick()) this.requests.delete(request.id);
        }
    }

    private challenge(player: PlayerState, rawTarget?: string, rawWeapon?: string): void {
        if (rawWeapon !== "dagger" && rawWeapon !== "whip") throw Error("Choose a dragon dagger (p++) or abyssal whip.");
        const targetId = this.number(rawTarget);
        const target = this.host.players.get(targetId);
        if (!target || target === player || accountKey(target) === accountKey(player)) throw Error("Choose another player in the lobby.");
        if (!this.host.available(player) || !this.host.available(target)) throw Error("Both players must be free in the lobby.");
        if (this.host.tick() < (this.lastRequest.get(player.id) ?? -10) + 3) throw Error("Wait a moment before challenging again.");
        if ([...this.requests.values()].filter((entry) => entry.toId === target.id).length >= 8) {
            throw Error("That player already has several requests. Try again shortly.");
        }
        this.removeRequests(player.id);
        let id: string;
        // The shared command router lowercases arguments; keep opaque IDs canonical.
        do { id = randomBytes(8).toString("hex"); }
        while (this.requests.has(id) || this.host.sessions.has(id));
        this.requests.set(id, { id, fromId: player.id, toId: target.id,
            weaponId: DUEL_WEAPONS[rawWeapon], expiresAtTick: this.host.tick() + 100 });
        this.lastRequest.set(player.id, this.host.tick());
        this.host.notice(player, `Challenge sent to ${target.name}.`);
        this.host.notice(target, `${player.name} wishes to duel with you.`);
    }

    private respond(player: PlayerState, id?: string, answer?: string): void {
        const request = id ? this.requests.get(id) : undefined;
        if (!request || request.toId !== player.id || request.expiresAtTick <= this.host.tick()) {
            throw Error("That duel request has expired.");
        }
        if (answer !== "accept" && answer !== "decline") throw Error("Accept or decline the duel request.");
        this.requests.delete(request.id);
        const from = this.host.players.get(request.fromId);
        if (answer === "decline") {
            if (from) this.host.notice(from, `${player.name} declined your challenge.`);
            return;
        }
        if (!from || !this.host.available(from) || !this.host.available(player)) throw Error("Both players must be free in the lobby.");
        this.removeRequests(from.id); this.removeRequests(player.id);
        const room: DuelSession = { code: request.id, weaponId: request.weaponId,
            seats: [from, player].map((fighter) => ({ player: fighter, offer: { gold: 0, platinum: 0 },
                accepted: false, confirmed: false })) as DuelSession["seats"],
            status: "staking", revision: 0, startsAt: 0, winnerId: null, finishedAt: 0, escrowed: false,
            message: "Set your stake. Both fighters use the agreed weapon for the entire duel." };
        this.host.sessions.set(room.code, room);
        for (const seat of room.seats) {
            this.host.memberships.set(seat.player.id, room);
            seat.player.clearPath(); seat.player.clearWalkDestination();
            this.host.notice(seat.player, room.message);
        }
    }

    private offer(player: PlayerState, args: string[]): void {
        const room = this.editable(player);
        this.checkRevision(room, args[0], args[1]);
        const gold = this.number(args[2]), platinum = this.number(args[3]);
        const inventory = this.host.economy.wallet(player).inventory;
        if (gold > inventory.gold || platinum > inventory.platinum) throw Error("Your inventory does not contain that stake.");
        const seat = room.seats.find((entry) => entry.player === player)!;
        if (seat.offer.gold === gold && seat.offer.platinum === platinum && room.status === "staking") return;
        seat.offer = { gold, platinum };
        resetDuelAcceptance(room);
        room.message = "The stake changed. Both players must accept the new amounts.";
        for (const entry of room.seats) this.host.notice(entry.player, room.message);
    }

    private accept(player: PlayerState, roomId: string | undefined, revision: string | undefined, confirm: boolean): void {
        const room = this.editable(player);
        this.checkRevision(room, roomId, revision);
        const seat = room.seats.find((entry) => entry.player === player)!;
        if (confirm) {
            if (room.status !== "review") throw Error("Both players must accept their stakes before confirming.");
            seat.confirmed = true;
            if (!room.seats.every((entry) => entry.confirmed)) return;
            try {
                this.host.economy.reserve(room.code, room.seats.map((entry) => entry.player) as [PlayerState, PlayerState],
                    room.seats.map((entry) => entry.offer) as [typeof seat.offer, typeof seat.offer]);
                room.escrowed = true;
            } catch (error) {
                resetDuelAcceptance(room);
                throw error;
            }
            this.host.start(room);
        } else {
            if (room.status !== "staking") throw Error("Review the agreed stakes and press Confirm duel.");
            seat.accepted = true;
            if (!room.seats.every((entry) => entry.accepted)) return;
            room.status = "review";
            room.message = "Final check: winner takes the full stake, with no tax. Confirm to start.";
            for (const entry of room.seats) this.host.notice(entry.player, room.message);
        }
    }

    private editable(player: PlayerState): DuelSession {
        const room = this.host.memberships.get(player.id);
        if (!room || (room.status !== "staking" && room.status !== "review")) throw Error("You are not negotiating a duel.");
        return room;
    }

    private checkRevision(room: DuelSession, roomId?: string, raw?: string): void {
        if (roomId !== room.code || raw === undefined || this.number(raw) !== room.revision) {
            throw Error("The stake changed. Review the latest amounts first.");
        }
    }

    private number(raw?: string): number {
        if (!raw || !/^\d{1,10}$/.test(raw)) throw Error("Enter a whole, non-negative amount.");
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value > 2_147_483_647) throw Error("That amount is too large.");
        return value;
    }
}

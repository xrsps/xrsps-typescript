import { randomUUID } from "node:crypto";
import type { DuelCurrencyOffer, DuelTradeRequest, DuelTradeSnapshot } from "../../../client/common/duel/DuelProtocol";
import type { PlayerState } from "../../src/game/player";
import { accountKey, requireOffer } from "./DuelCurrency";
import type { DuelEconomy } from "./DuelEconomy";

export interface DuelTradeHost {
    getPlayer(id: number): PlayerState | undefined;
    isAvailable(player: PlayerState): boolean;
    notice(player: PlayerState, message: string): void;
    getTick(): number;
}

interface Request { id: string; fromId: number; toId: number; expiresAt: number; }
interface Party { player: PlayerState; offer: DuelCurrencyOffer; accepted: boolean; }
interface Session { id: string; revision: number; stage: "offer" | "review"; parties: [Party, Party]; }
const REQUEST_TICKS = 50;

/** Both players review the same numbered offer before a single atomic exchange. */
export class DuelTradeService {
    private readonly pending = new Map<string, Request>();
    private readonly active = new Map<number, Session>();

    constructor(private readonly economy: DuelEconomy, private readonly host: DuelTradeHost) {}

    isBusy(playerId: number): boolean { return this.active.has(playerId); }

    command(player: PlayerState, args: string[]): boolean {
        const [action, id, revision, gold, platinum] = args;
        if (!action?.startsWith("trade_")) return false;
        if (this.host.getPlayer(player.id) !== player) return true;
        this.tick();
        try {
            if (action === "trade_request") this.request(player, this.number(id));
            else if (action === "trade_accept") this.acceptRequest(player, id);
            else if (action === "trade_decline") this.declineRequest(player, id);
            else if (action === "trade_cancel") this.cancel(player, id);
            else {
                const session = this.session(player, id, this.number(revision));
                if (action === "trade_offer") this.offer(session, player, {gold: this.number(gold), platinum: this.number(platinum)});
                else if (action === "trade_review") this.accept(session, player, "offer");
                else if (action === "trade_confirm") this.accept(session, player, "review");
                else throw new Error("Invalid trade action.");
            }
        } catch (error) {
            this.host.notice(player, error instanceof Error ? error.message : "The trade could not be updated.");
        }
        return true;
    }

    snapshot(player: PlayerState): DuelTradeSnapshot | null {
        const session = this.active.get(player.id);
        if (!session) return null;
        const self = session.parties.find((party) => party.player === player)!;
        const other = session.parties.find((party) => party !== self)!;
        return { id: session.id, revision: session.revision, stage: session.stage,
            opponentId: other.player.id, opponentName: other.player.name ?? "Player",
            selfOffer: {...self.offer}, opponentOffer: {...other.offer},
            selfAccepted: self.accepted, opponentAccepted: other.accepted };
    }

    requests(player: PlayerState): DuelTradeRequest[] {
        return [...this.pending.values()].filter((request) => request.toId === player.id && request.expiresAt > this.host.getTick())
            .map((request) => ({id: request.id, fromId: request.fromId,
                fromName: this.host.getPlayer(request.fromId)?.name ?? "Player",
                expiresInTicks: Math.max(0, request.expiresAt - this.host.getTick())}));
    }

    tick(): void {
        for (const [id, request] of this.pending) {
            if (request.expiresAt <= this.host.getTick() || !this.host.getPlayer(request.fromId) || !this.host.getPlayer(request.toId)) this.pending.delete(id);
        }
    }

    disconnect(playerId: number): void {
        const session = this.active.get(playerId);
        if (session) this.close(session, "Trade cancelled: a player left the lobby.");
        for (const [id, request] of this.pending) {
            if (request.fromId === playerId || request.toId === playerId) this.pending.delete(id);
        }
    }

    private request(player: PlayerState, targetId: number): void {
        const target = this.host.getPlayer(targetId);
        if (!target || target === player || accountKey(player) === accountKey(target)) throw new Error("Choose another player in the lobby.");
        this.requireAvailable(player);
        this.requireAvailable(target);
        if (!this.nearby(player, target)) throw new Error("Move closer to trade with that player.");
        // One outgoing request per player keeps invitation spam bounded.
        for (const [id, request] of this.pending) if (request.fromId === player.id) this.pending.delete(id);
        if ([...this.pending.values()].filter((request) => request.toId === target.id).length >= 8) throw new Error("That player has several requests waiting. Try again shortly.");
        const request = {id: randomUUID().replace(/-/g, ""), fromId: player.id, toId: targetId, expiresAt: this.host.getTick() + REQUEST_TICKS};
        this.pending.set(request.id, request);
        this.host.notice(player, `Trade request sent to ${target.name}.`);
        this.host.notice(target, `${player.name} wishes to trade with you.`);
    }

    private acceptRequest(player: PlayerState, id: string): void {
        const request = this.pending.get(id);
        if (!request || request.toId !== player.id) throw new Error("That trade request has expired.");
        const from = this.host.getPlayer(request.fromId);
        if (!from) throw new Error("That player has left the lobby.");
        this.requireAvailable(player);
        this.requireAvailable(from);
        if (!this.nearby(player, from)) throw new Error("Move closer to accept the trade.");
        const session: Session = {id: randomUUID().replace(/-/g, ""), revision: 0, stage: "offer",
            parties: [from, player].map((entry) => ({player: entry, offer: {gold: 0, platinum: 0}, accepted: false})) as [Party, Party]};
        for (const party of session.parties) {
            this.active.set(party.player.id, session);
            party.player.clearPath();
            party.player.clearWalkDestination();
            this.host.notice(party.player, "Enter the currency you want to trade, then review both offers.");
        }
        for (const [pendingId, pending] of this.pending) {
            if ([pending.fromId, pending.toId].some((value) => value === player.id || value === from.id)) this.pending.delete(pendingId);
        }
    }

    private declineRequest(player: PlayerState, id: string): void {
        const request = this.pending.get(id);
        if (!request || request.toId !== player.id) return;
        this.pending.delete(id);
        const from = this.host.getPlayer(request.fromId);
        if (from) this.host.notice(from, `${player.name} declined the trade request.`);
    }

    private session(player: PlayerState, id: string, revision: number): Session {
        const session = this.active.get(player.id);
        if (!session || session.id !== id) throw new Error("That trade is no longer open.");
        if (session.revision !== revision) throw new Error("The trade offer changed. Review the latest amounts.");
        return session;
    }

    private offer(session: Session, player: PlayerState, offer: DuelCurrencyOffer): void {
        requireOffer(offer);
        const inventory = this.economy.wallet(player).inventory;
        if (offer.gold > inventory.gold || offer.platinum > inventory.platinum) throw new Error("You do not have enough currency in your inventory.");
        const party = session.parties.find((entry) => entry.player === player)!;
        if (party.offer.gold === offer.gold && party.offer.platinum === offer.platinum) {
            if (session.stage === "review") this.reset(session);
            return;
        }
        party.offer = {...offer};
        this.reset(session);
    }

    private accept(session: Session, player: PlayerState, stage: Session["stage"]): void {
        if (session.stage !== stage) throw new Error("Review the current trade screen before accepting.");
        session.parties.find((party) => party.player === player)!.accepted = true;
        if (!session.parties.every((party) => party.accepted)) return;
        if (stage === "offer") {
            session.stage = "review";
            session.revision++;
            session.parties.forEach((party) => party.accepted = false);
            return;
        }
        try {
            this.economy.trade(session.id, session.parties.map((party) => party.player) as [PlayerState, PlayerState],
                session.parties.map((party) => party.offer) as [DuelCurrencyOffer, DuelCurrencyOffer]);
            this.close(session, "Trade completed. Your inventory has been updated.");
        } catch (error) {
            this.reset(session);
            for (const party of session.parties) this.host.notice(party.player, error instanceof Error ? error.message : "The trade could not complete.");
        }
    }

    private reset(session: Session): void {
        session.stage = "offer";
        session.revision++;
        session.parties.forEach((party) => party.accepted = false);
    }

    private cancel(player: PlayerState, id: string): void {
        const session = this.active.get(player.id);
        if (session?.id === id) this.close(session, "Trade cancelled. No currency was transferred.");
    }

    private close(session: Session, message: string): void {
        for (const party of session.parties) {
            this.active.delete(party.player.id);
            this.host.notice(party.player, message);
        }
    }

    private requireAvailable(player: PlayerState): void {
        if (this.isBusy(player.id) || !this.host.isAvailable(player)) throw new Error("That player is already busy.");
    }

    private nearby(first: PlayerState, second: PlayerState): boolean {
        return first.level === second.level && Math.max(Math.abs(first.tileX - second.tileX), Math.abs(first.tileY - second.tileY)) <= 15;
    }

    private number(value: string | undefined): number {
        if (!value || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Enter a valid whole amount.");
        return Number(value);
    }
}

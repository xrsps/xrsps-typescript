import type { DuelCurrencyOffer, DuelWeaponId } from "../../../client/common/duel/DuelProtocol";
import type { PlayerState } from "../../src/game/player";

export interface DuelSeat {
    player: PlayerState;
    offer: DuelCurrencyOffer;
    accepted: boolean;
    confirmed: boolean;
}

export interface DuelSession {
    code: string;
    seats: [DuelSeat, DuelSeat];
    weaponId: DuelWeaponId;
    status: "staking" | "review" | "countdown" | "fighting" | "finished";
    revision: number;
    startsAt: number;
    winnerId: number | null;
    finishedAt: number;
    message: string;
    escrowed: boolean;
}

export function isDuelInArena(session: DuelSession | undefined): boolean {
    return !!session && ["countdown", "fighting", "finished"].includes(session.status);
}

export function resetDuelAcceptance(session: DuelSession): void {
    session.status = "staking";
    session.revision++;
    for (const seat of session.seats) { seat.accepted = false; seat.confirmed = false; }
}

import { logger } from "../../utils/logger";
import { TradeActionClientPayload, TradeServerPayload } from "../../network/messages";
import { getItemDefinition } from "../../data/items";
import { type InventoryEntry, PlayerState } from "../player";
import type { ServerServices } from "../ServerServices";

type TradeOfferState = {
    itemId: number;
    quantity: number;
};

type TradePartyState = {
    player: PlayerState;
    offers: TradeOfferState[];
    accepted: boolean;
    confirmAccepted: boolean;
};

type TradeSession = {
    id: string;
    parties: [TradePartyState, TradePartyState];
    stage: "offer" | "confirm";
};

type TradeRequestState = {
    fromId: number;
    toId: number;
    expireTick: number;
};

const REQUEST_TIMEOUT_TICKS = 64; // ~38.4 seconds at 600ms ticks

export class TradeManager {
    private readonly requests = new Map<string, TradeRequestState>();
    private readonly sessions = new Map<string, TradeSession>();
    private readonly sessionByPlayer = new Map<number, TradeSession>();
    private sessionCounter = 1;

    constructor(private readonly svc: ServerServices) {}

    private queueInventorySnapshot(player: PlayerState): void {
        const sock = this.svc.players?.getSocketByPlayerId(player.id);
        if (sock) this.svc.inventoryService.sendInventorySnapshot(sock, player);
    }

    private openTradeWidget(player: PlayerState): void {
        player.widgets.open(335, { modal: true });
    }

    private closeTradeWidget(player: PlayerState): void {
        player.widgets.close(335);
    }

    requestTrade(initiator: PlayerState, target: PlayerState, currentTick: number): void {
        if (initiator.id === target.id) return;
        if (this.sessionByPlayer.has(initiator.id)) {
            this.svc.messagingService.sendGameMessageToPlayer(initiator, "You are already in a trade.");
            return;
        }
        if (this.sessionByPlayer.has(target.id)) {
            this.svc.messagingService.sendGameMessageToPlayer(initiator, "That player is currently busy.");
            return;
        }
        const reverseKey = this.buildRequestKey(target.id, initiator.id);
        const key = this.buildRequestKey(initiator.id, target.id);
        const reverse = this.requests.get(reverseKey);
        if (reverse) {
            this.requests.delete(reverseKey);
            this.requests.delete(key);
            this.startSession(initiator, target);
            return;
        }
        this.requests.set(key, {
            fromId: initiator.id,
            toId: target.id,
            expireTick: currentTick + REQUEST_TIMEOUT_TICKS,
        });
        const name = this.resolveName(initiator);
        this.svc.messagingService.sendGameMessageToPlayer(initiator, "Sending trade offer...");
        this.svc.messagingService.sendGameMessageToPlayer(target, `${name} wishes to trade with you.`);
        this.svc.broadcastService.queueTradeMessage(target.id, {
            kind: "request",
            fromId: initiator.id,
            fromName: name,
        });
    }

    handlePlayerLogout(
        player: PlayerState,
        reason: string = "Other player declined the trade.",
    ): void {
        this.clearRequestsFor(player.id);
        const session = this.sessionByPlayer.get(player.id);
        if (!session) return;
        const other = this.getCounterparty(session, player.id);
        this.closeSession(session, reason, player.id);
        if (other) {
            this.svc.messagingService.sendGameMessageToPlayer(other.player, reason);
        }
    }

    tick(currentTick: number): void {
        for (const [key, req] of Array.from(this.requests.entries())) {
            if (req.expireTick <= currentTick) {
                this.requests.delete(key);
                const fromPlayer = this.svc.players?.getById(req.fromId);
                if (fromPlayer) {
                    this.svc.messagingService.sendGameMessageToPlayer(fromPlayer, "Your trade offer has expired.");
                }
            }
        }
    }

    handleAction(player: PlayerState, action: TradeActionClientPayload, currentTick: number): void {
        const session = this.sessionByPlayer.get(player.id);
        if (!session) {
            this.svc.messagingService.sendGameMessageToPlayer(player, "You're not currently trading.");
            return;
        }
        switch (action.action) {
            case "offer":
                this.handleOfferAction(
                    session,
                    player,
                    action.slot,
                    action.quantity,
                    action.itemId,
                );
                break;
            case "remove":
                this.handleRemoveAction(session, player, action.slot, action.quantity);
                break;
            case "accept":
                this.handleAccept(session, player);
                break;
            case "decline":
                this.closeSession(session, "You decline the trade.");
                break;
            case "confirm_accept":
                this.handleConfirmAccept(session, player);
                break;
            case "confirm_decline":
                this.closeSession(session, "You decline the trade.");
                break;
        }
    }

    private buildRequestKey(fromId: number, toId: number): string {
        return `${fromId}->${toId}`;
    }

    private clearRequestsFor(playerId: number): void {
        for (const [key, req] of Array.from(this.requests.entries())) {
            if (req.fromId === playerId || req.toId === playerId) {
                this.requests.delete(key);
            }
        }
    }

    private startSession(a: PlayerState, b: PlayerState): void {
        const session: TradeSession = {
            id: `trade:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}:${this.sessionCounter++}`,
            parties: [this.createParty(a), this.createParty(b)],
            stage: "offer",
        };
        this.sessions.set(session.id, session);
        this.sessionByPlayer.set(a.id, session);
        this.sessionByPlayer.set(b.id, session);
        try {
            this.openTradeWidget(a);
            this.openTradeWidget(b);
        } catch (err) { logger.warn("[trade] failed to open trade widget", err); }
        this.broadcastSession(session, "open");
    }

    private closeSession(session: TradeSession, reason: string, blamedId?: number): void {
        this.returnOffers(session.parties[0]);
        this.returnOffers(session.parties[1]);
        for (const party of session.parties) {
            try {
                this.closeTradeWidget(party.player);
            } catch (err) { logger.warn("[trade] failed to close trade widget", err); }
            this.queueInventorySnapshot(party.player);
            this.svc.broadcastService.queueTradeMessage(party.player.id, {
                kind: "close",
                reason,
            });
            this.sessionByPlayer.delete(party.player.id);
        }
        this.sessions.delete(session.id);
    }

    private createParty(player: PlayerState): TradePartyState {
        return {
            player,
            offers: [],
            accepted: false,
            confirmAccepted: false,
        };
    }

    private getParty(session: TradeSession, playerId: number): TradePartyState | undefined {
        return session.parties.find((party) => party.player.id === playerId);
    }

    private getCounterparty(session: TradeSession, playerId: number): TradePartyState | undefined {
        return session.parties.find((party) => party.player.id !== playerId);
    }

    private resolveName(player: PlayerState): string {
        if (player.name && player.name.length > 0) return player.name;
        return `Player ${player.id}`;
    }

    private ensureTradeable(player: PlayerState, itemId: number): boolean {
        const def = getItemDefinition(itemId);
        if (!def) return true;
        if (def.tradeable) return true;
        this.svc.messagingService.sendGameMessageToPlayer(player, "That item isn't tradeable.");
        return false;
    }

    private handleOfferAction(
        session: TradeSession,
        player: PlayerState,
        slotIndex: number,
        requestedQty: number,
        itemIdHint?: number,
    ): void {
        const party = this.getParty(session, player.id);
        if (!party) return;
        if (session.stage === "confirm") {
            session.stage = "offer";
            party.confirmAccepted = false;
            const other = this.getCounterparty(session, player.id);
            if (other) other.confirmAccepted = false;
        }
        const inventory = this.svc.inventoryService.getInventory(player);
        const slot = Math.max(0, Math.min(inventory.length - 1, slotIndex));
        const entry = inventory[slot];
        if (!entry || entry.itemId <= 0 || entry.quantity <= 0) {
            this.svc.messagingService.sendGameMessageToPlayer(player, "That item is no longer in your inventory.");
            return;
        }
        if (itemIdHint && itemIdHint !== entry.itemId) {
            this.svc.messagingService.sendGameMessageToPlayer(player, "That item is no longer in your inventory.");
            return;
        }
        if (!this.ensureTradeable(player, entry.itemId)) return;
        const def = getItemDefinition(entry.itemId);
        const isStackable = !!def?.stackable;
        const desired = Math.max(1, requestedQty);
        const amount = isStackable ? Math.min(entry.quantity, desired) : 1;
        if (!(amount > 0)) {
            this.svc.messagingService.sendGameMessageToPlayer(player, "You don't have enough of that item.");
            return;
        }
        this.removeFromInventorySlot(player, slot, entry, amount);
        this.addOffer(party, entry.itemId, amount);
        this.resetAcceptances(session);
        this.queueInventorySnapshot(player);
        this.broadcastSession(session);
    }

    private handleRemoveAction(
        session: TradeSession,
        player: PlayerState,
        offerSlot: number,
        quantity: number,
    ): void {
        const party = this.getParty(session, player.id);
        if (!party) return;
        if (party.offers.length === 0) return;
        const idx = Math.max(0, Math.min(party.offers.length - 1, offerSlot));
        const offer = party.offers[idx];
        if (!offer || offer.quantity <= 0) return;
        const amount = Math.max(1, Math.min(offer.quantity, quantity));
        if (!(amount > 0)) return;
        if (!this.addItemsToInventory(party.player, offer.itemId, amount)) {
            this.svc.messagingService.sendGameMessageToPlayer(player, "You don't have enough space in your inventory.");
            return;
        }
        offer.quantity -= amount;
        if (offer.quantity <= 0) {
            party.offers.splice(idx, 1);
        }
        this.queueInventorySnapshot(player);
        if (session.stage === "confirm") {
            session.stage = "offer";
            party.confirmAccepted = false;
            const otherParty = this.getCounterparty(session, player.id);
            if (otherParty) otherParty.confirmAccepted = false;
        }
        this.resetAcceptances(session);
        this.broadcastSession(session);
    }

    private handleAccept(session: TradeSession, player: PlayerState): void {
        const party = this.getParty(session, player.id);
        if (!party) return;
        party.accepted = true;
        const other = this.getCounterparty(session, player.id);
        if (session.stage === "offer" && other?.accepted) {
            session.stage = "confirm";
            party.confirmAccepted = false;
            if (other) other.confirmAccepted = false;
        }
        this.broadcastSession(session);
    }

    private handleConfirmAccept(session: TradeSession, player: PlayerState): void {
        if (session.stage !== "confirm") return;
        const party = this.getParty(session, player.id);
        if (!party) return;
        party.confirmAccepted = true;
        const other = this.getCounterparty(session, player.id);
        if (party.confirmAccepted && other?.confirmAccepted) {
            this.finalizeTrade(session);
            return;
        }
        this.broadcastSession(session);
    }

    private finalizeTrade(session: TradeSession): void {
        const [a, b] = session.parties;
        if (!this.transferOffers(a, b)) {
            session.stage = "offer";
            this.resetAcceptances(session);
            this.broadcastSession(session);
            return;
        }
        if (!this.transferOffers(b, a)) {
            session.stage = "offer";
            this.resetAcceptances(session);
            this.broadcastSession(session);
            return;
        }
        this.queueInventorySnapshot(a.player);
        this.queueInventorySnapshot(b.player);
        this.closeSession(session, "Trade completed.");
    }

    private transferOffers(from: TradePartyState, to: TradePartyState): boolean {
        if (!this.canReceiveItems(to.player, from.offers)) {
            this.svc.messagingService.sendGameMessageToPlayer(from.player, "Other player doesn't have enough space.");
            this.svc.messagingService.sendGameMessageToPlayer(
                to.player,
                "You don't have enough space in your inventory.",
            );
            return false;
        }
        for (const offer of from.offers) {
            if (!this.addItemsToInventory(to.player, offer.itemId, offer.quantity)) {
                this.svc.messagingService.sendGameMessageToPlayer(
                    from.player,
                    "Other player doesn't have enough space.",
                );
                this.svc.messagingService.sendGameMessageToPlayer(
                    to.player,
                    "You don't have enough space in your inventory.",
                );
                return false;
            }
        }
        from.offers = [];
        return true;
    }

    private removeFromInventorySlot(
        player: PlayerState,
        slot: number,
        entry: InventoryEntry,
        amount: number,
    ): void {
        const remaining = entry.quantity - amount;
        if (remaining > 0) {
            this.svc.inventoryService.setInventorySlot(player, slot, entry.itemId, remaining);
        } else {
            this.svc.inventoryService.setInventorySlot(player, slot, -1, 0);
        }
    }

    private addOffer(party: TradePartyState, itemId: number, amount: number): void {
        const existing = party.offers.find((offer) => offer.itemId === itemId);
        if (existing) existing.quantity += amount;
        else party.offers.push({ itemId, quantity: amount });
    }

    private addItemsToInventory(player: PlayerState, itemId: number, quantity: number): boolean {
        const def = getItemDefinition(itemId);
        const isStackable = !!def?.stackable;
        if (isStackable) {
            return this.svc.inventoryService.addItemToInventory(player, itemId, quantity).added > 0;
        }
        for (let i = 0; i < quantity; i++) {
            const result = this.svc.inventoryService.addItemToInventory(player, itemId, 1);
            if (result.added <= 0) {
                return false;
            }
        }
        return true;
    }

    private returnOffers(party: TradePartyState): void {
        if (party.offers.length === 0) return;
        for (const offer of party.offers) {
            if (offer.quantity <= 0) continue;
            if (!this.addItemsToInventory(party.player, offer.itemId, offer.quantity)) {
                // As a fallback, drop the items on the ground? For now, just log and discard.
                this.svc.messagingService.sendGameMessageToPlayer(
                    party.player,
                    "Could not return some traded items due to lack of space.",
                );
            }
        }
        party.offers = [];
    }

    private canReceiveItems(player: PlayerState, offers: TradeOfferState[]): boolean {
        if (offers.length === 0) return true;
        const clone = this.options
            .getInventory(player)
            .map((entry) => ({ itemId: entry.itemId, quantity: entry.quantity }));
        const findFreeSlot = () => clone.find((slot) => slot.itemId <= 0 || slot.quantity <= 0);
        for (const offer of offers) {
            if (offer.quantity <= 0) continue;
            const def = getItemDefinition(offer.itemId);
            const stackable = !!def?.stackable;
            if (stackable) {
                const existing = clone.find((slot) => slot.itemId === offer.itemId);
                if (existing) existing.quantity += offer.quantity;
                else {
                    const free = findFreeSlot();
                    if (!free) return false;
                    free.itemId = offer.itemId;
                    free.quantity = offer.quantity;
                }
            } else {
                let remaining = offer.quantity;
                while (remaining-- > 0) {
                    const free = findFreeSlot();
                    if (!free) return false;
                    free.itemId = offer.itemId;
                    free.quantity = 1;
                }
            }
        }
        return true;
    }

    private resetAcceptances(session: TradeSession): void {
        for (const party of session.parties) {
            party.accepted = false;
            party.confirmAccepted = false;
        }
    }

    private broadcastSession(session: TradeSession, kind: "open" | "update" = "update"): void {
        for (const party of session.parties) {
            const other = this.getCounterparty(session, party.player.id);
            const payload: TradeServerPayload = {
                kind,
                sessionId: session.id,
                stage: session.stage,
                self: this.buildPartyMessage(party),
                other: other ? this.buildPartyMessage(other) : { playerId: undefined, offers: [] },
                info: this.buildInfoMessage(session, party, other ?? null),
            };
            this.svc.broadcastService.queueTradeMessage(party.player.id, payload);
        }
    }

    private buildPartyMessage(party: TradePartyState) {
        return {
            playerId: party.player.id,
            name: this.resolveName(party.player),
            offers: party.offers.map((offer, idx) => ({
                slot: idx,
                itemId: offer.itemId,
                quantity: Math.max(0, offer.quantity),
            })),
            accepted: party.accepted,
            confirmAccepted: party.confirmAccepted,
        };
    }

    private buildInfoMessage(
        session: TradeSession,
        party: TradePartyState,
        other: TradePartyState | null,
    ): string | undefined {
        if (session.stage === "offer") {
            if (party.accepted && other && !other.accepted)
                return "Waiting for the other player...";
            if (!party.accepted && other?.accepted) return "Other player accepted.";
            return undefined;
        }
        if (session.stage === "confirm") {
            if (party.confirmAccepted && other && !other.confirmAccepted) {
                return "Waiting for the other player...";
            }
            return "Please check the items carefully.";
        }
        return undefined;
    }
}

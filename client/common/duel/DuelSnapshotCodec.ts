import { DUEL_STATUSES, DuelParticipant, DuelSnapshot, DuelCurrencyOffer, DuelWeaponId, isDuelSnapshot } from "./DuelProtocol";

const VERSION = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Length-prefixed UTF-8 and fixed-width integers; no JSON on the duel wire. */
export function encodeDuelSnapshotPayload(s: DuelSnapshot): Uint8Array {
    if (!isDuelSnapshot(s)) throw new TypeError("Invalid duel snapshot");
    const bytes: number[] = [];
    const byte = (v: number) => { bytes.push(v); };
    const short = (v: number) => { bytes.push((v >>> 8) & 255, v & 255); };
    const int = (v: number) => { short(v >>> 16); short(v & 65535); };
    const bool = (v: boolean) => byte(v ? 1 : 0);
    const string = (v: string) => { const b = encoder.encode(v); short(b.length); bytes.push(...b); };
    const offer = (v: DuelCurrencyOffer) => { int(v.gold); int(v.platinum); };
    const fighter = (v: DuelParticipant | null) => {
        bool(v !== null); if (!v) return;
        short(v.id); string(v.name); short(v.hp); short(v.maxHp); short(v.weaponId); byte(v.specialEnergy); bool(v.ready);
    };
    byte(VERSION); byte(DUEL_STATUSES.indexOf(s.status)); byte(s.countdownTicks); string(s.roomCode ?? "");
    fighter(s.self); fighter(s.opponent); short(s.winnerId ?? 65535); string(s.message);
    bool(s.location === "arena"); short(s.agreedWeaponId ?? 0);
    short(s.lobbyPlayers.length); for (const p of s.lobbyPlayers) { short(p.id); string(p.name); }
    short(s.requests.length); for (const r of s.requests) {
        string(r.id); short(r.fromId); string(r.fromName); short(r.weaponId); short(r.expiresInTicks);
    }
    bool(s.stake !== null); if (s.stake) {
        int(s.stake.revision); offer(s.stake.self); offer(s.stake.opponent);
        bool(s.stake.selfAccepted); bool(s.stake.opponentAccepted); bool(s.stake.selfConfirmed); bool(s.stake.opponentConfirmed);
    }
    offer(s.wallet.inventory); offer(s.wallet.bank);
    bool(s.trade !== null); if (s.trade) {
        const t = s.trade; string(t.id); int(t.revision); bool(t.stage === "review"); short(t.opponentId); string(t.opponentName);
        offer(t.selfOffer); offer(t.opponentOffer); bool(t.selfAccepted); bool(t.opponentAccepted);
    }
    short(s.tradeRequests.length); for (const r of s.tradeRequests) {
        string(r.id); short(r.fromId); string(r.fromName); short(r.expiresInTicks);
    }
    return Uint8Array.from(bytes);
}

/** Reject truncated, malformed, unsupported and overlong payloads as one unit. */
export function decodeDuelSnapshotPayload(bytes: Uint8Array): DuelSnapshot {
    let offset = 0;
    const need = (n: number) => { if (offset + n > bytes.length) throw new RangeError("Truncated duel snapshot"); };
    const byte = () => { need(1); return bytes[offset++]; };
    const short = () => (byte() << 8) | byte();
    const int = () => short() * 65536 + short();
    const bool = () => { const v = byte(); if (v > 1) throw new TypeError("Invalid duel boolean"); return v === 1; };
    const string = (max = 256) => {
        const n = short(); if (n > max) throw new RangeError("Overlong duel string"); need(n);
        const v = decoder.decode(bytes.subarray(offset, offset + n)); offset += n; return v;
    };
    const offer = (): DuelCurrencyOffer => ({ gold: int(), platinum: int() });
    const list = <T>(max: number, read: () => T): T[] => {
        const n = short(); if (n > max) throw new RangeError("Overlong duel list");
        return Array.from({ length: n }, read);
    };
    const fighter = (): DuelParticipant | null => !bool() ? null : {
        id: short(), name: string(128), hp: short(), maxHp: short(), weaponId: short() as DuelWeaponId,
        specialEnergy: byte(), ready: bool(),
    };
    if (byte() !== VERSION) throw new TypeError("Unsupported duel protocol version");
    const status = DUEL_STATUSES[byte()], countdownTicks = byte(), roomCode = string(64) || null;
    const self = fighter(), opponent = fighter(), winner = short(), message = string(2048);
    const location = bool() ? "arena" : "lobby", agreedWeaponId = (short() || null) as DuelWeaponId | null;
    const lobbyPlayers = list(256, () => ({ id: short(), name: string(128) }));
    const requests = list(64, () => ({ id: string(64), fromId: short(), fromName: string(128), weaponId: short() as DuelWeaponId, expiresInTicks: short() }));
    const stake = !bool() ? null : { revision: int(), self: offer(), opponent: offer(),
        selfAccepted: bool(), opponentAccepted: bool(), selfConfirmed: bool(), opponentConfirmed: bool() };
    const wallet = { inventory: offer(), bank: offer() };
    const trade = !bool() ? null : { id: string(64), revision: int(), stage: bool() ? "review" as const : "offer" as const,
        opponentId: short(), opponentName: string(128), selfOffer: offer(), opponentOffer: offer(), selfAccepted: bool(), opponentAccepted: bool() };
    const tradeRequests = list(64, () => ({ id: string(64), fromId: short(), fromName: string(128), expiresInTicks: short() }));
    const snapshot = { status, countdownTicks, roomCode, self, opponent, winnerId: winner === 65535 ? null : winner, message,
        location, agreedWeaponId, lobbyPlayers, requests, stake, wallet, trade, tradeRequests };
    if (offset !== bytes.length || !isDuelSnapshot(snapshot)) throw new TypeError("Invalid duel snapshot");
    return snapshot;
}

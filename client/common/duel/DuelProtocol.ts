/** Shared rules and server-authored state for the Duel Arena and its courtyard. */
export const ARENA_CENTER = { x: 3378, y: 3251, level: 0 } as const;
export const DUEL_LOBBY_CENTER = { x: 3377, y: 3232, level: 0 } as const;
export const DUEL_LOBBY_BOUNDS = { minX: 3367, maxX: 3387, minY: 3226, maxY: 3239 } as const;
export const DUEL_WEAPONS = { dagger: 5698, whip: 4151 } as const;
export const DUEL_CURRENCY_LIMIT = 2147483647;
export type DuelWeapon = keyof typeof DUEL_WEAPONS;
export type DuelWeaponId = (typeof DUEL_WEAPONS)[DuelWeapon];
export const DUEL_STATUSES = ["idle", "waiting", "staking", "review", "countdown", "fighting", "finished"] as const;
export type DuelStatus = (typeof DUEL_STATUSES)[number];
export interface DuelCurrencyOffer { gold: number; platinum: number; }
export interface DuelWallet { inventory: DuelCurrencyOffer; bank: DuelCurrencyOffer; }
export interface DuelLobbyPlayer { id: number; name: string; }
export interface DuelRequest { id: string; fromId: number; fromName: string; weaponId: DuelWeaponId; expiresInTicks: number; }
export interface DuelTradeRequest { id: string; fromId: number; fromName: string; expiresInTicks: number; }
export interface DuelTradeSnapshot {
    id: string; revision: number; stage: "offer" | "review";
    opponentId: number; opponentName: string;
    selfOffer: DuelCurrencyOffer; opponentOffer: DuelCurrencyOffer;
    selfAccepted: boolean; opponentAccepted: boolean;
}
export interface DuelStakeSnapshot {
    revision: number; self: DuelCurrencyOffer; opponent: DuelCurrencyOffer;
    selfAccepted: boolean; opponentAccepted: boolean; selfConfirmed: boolean; opponentConfirmed: boolean;
}
export interface DuelParticipant {
    id: number; name: string; hp: number; maxHp: number; weaponId: DuelWeaponId;
    /** Percentage, from 0 to 100. */
    specialEnergy: number; ready: boolean;
}
export interface DuelSnapshot {
    roomCode: string | null; status: DuelStatus; countdownTicks: number;
    self: DuelParticipant | null; opponent: DuelParticipant | null;
    winnerId: number | null; message: string;
    location: "lobby" | "arena"; agreedWeaponId: DuelWeaponId | null;
    lobbyPlayers: DuelLobbyPlayer[]; requests: DuelRequest[];
    stake: DuelStakeSnapshot | null; wallet: DuelWallet;
    trade: DuelTradeSnapshot | null; tradeRequests: DuelTradeRequest[];
}
export function createIdleDuelSnapshot(): DuelSnapshot {
    return {
        roomCode: null, status: "idle", countdownTicks: 0, self: null, opponent: null, winnerId: null,
        message: "Welcome to the courtyard. Right-click a player to challenge or trade.",
        location: "lobby", agreedWeaponId: null, lobbyPlayers: [], requests: [], stake: null,
        wallet: { inventory: { gold: 0, platinum: 0 }, bank: { gold: 0, platinum: 0 } }, trade: null, tradeRequests: [],
    };
}
const integer = (v: unknown, min: number, max: number): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const name = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 32;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
const playerId = (v: unknown) => integer(v, 0, 65534);
const weapon = (v: unknown) => v === DUEL_WEAPONS.dagger || v === DUEL_WEAPONS.whip;
const offer = (v: unknown): boolean => record(v) && integer(v.gold, 0, DUEL_CURRENCY_LIMIT) && integer(v.platinum, 0, DUEL_CURRENCY_LIMIT);
const flags = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === "boolean");
const revision = (v: unknown) => integer(v, 0, 4294967295);
function participant(v: unknown): boolean {
    return v === null || (record(v) && playerId(v.id) && name(v.name) && integer(v.maxHp, 1, 65535) &&
        integer(v.hp, 0, v.maxHp) && weapon(v.weaponId) && integer(v.specialEnergy, 0, 100) && typeof v.ready === "boolean");
}
function request(v: unknown): boolean {
    return record(v) && id(v.id) && playerId(v.fromId) && name(v.fromName) && integer(v.expiresInTicks, 0, 65535);
}
/** Validate every nested field before rendering or encoding a network snapshot. */
export function isDuelSnapshot(value: unknown): value is DuelSnapshot {
    if (!record(value)) return false;
    const s = value;
    return (s.roomCode === null || id(s.roomCode)) && DUEL_STATUSES.includes(s.status as DuelStatus) &&
        integer(s.countdownTicks, 0, 255) && participant(s.self) && participant(s.opponent) &&
        (!record(s.self) || !record(s.opponent) || s.self.id !== s.opponent.id) &&
        (s.winnerId === null || playerId(s.winnerId)) && typeof s.message === "string" && s.message.length <= 512 &&
        (s.location === "lobby" || s.location === "arena") && (s.agreedWeaponId === null || weapon(s.agreedWeaponId)) &&
        Array.isArray(s.lobbyPlayers) && s.lobbyPlayers.length <= 256 && s.lobbyPlayers.every(p => record(p) && playerId(p.id) && name(p.name)) &&
        Array.isArray(s.requests) && s.requests.length <= 64 && s.requests.every(r => request(r) && weapon(r.weaponId)) &&
        Array.isArray(s.tradeRequests) && s.tradeRequests.length <= 64 && s.tradeRequests.every(request) &&
        record(s.wallet) && offer(s.wallet.inventory) && offer(s.wallet.bank) &&
        (s.stake === null || (record(s.stake) && revision(s.stake.revision) && offer(s.stake.self) && offer(s.stake.opponent) &&
            flags(s.stake, ["selfAccepted", "opponentAccepted", "selfConfirmed", "opponentConfirmed"]))) &&
        (s.trade === null || (record(s.trade) && id(s.trade.id) && revision(s.trade.revision) &&
            (s.trade.stage === "offer" || s.trade.stage === "review") && playerId(s.trade.opponentId) && name(s.trade.opponentName) &&
            offer(s.trade.selfOffer) && offer(s.trade.opponentOffer) && flags(s.trade, ["selfAccepted", "opponentAccepted"])));
}

// OSRS `PlayerType` mapping from the reference client (r215).

export type PlayerTypeInfo = {
    id: number;
    modIcon: number;
    isPrivileged: boolean;
    isUser: boolean;
};

const PLAYER_TYPE_BY_ID: Record<number, PlayerTypeInfo> = {
    0: { id: 0, modIcon: -1, isPrivileged: false, isUser: true }, // normal
    1: { id: 1, modIcon: 0, isPrivileged: true, isUser: true }, // player moderator
    2: { id: 2, modIcon: 1, isPrivileged: true, isUser: false }, // jagex moderator
    3: { id: 3, modIcon: 2, isPrivileged: false, isUser: true }, // ironman
    4: { id: 4, modIcon: 3, isPrivileged: false, isUser: true }, // ultimate ironman
    5: { id: 5, modIcon: 10, isPrivileged: false, isUser: true }, // hardcore ironman
    6: { id: 6, modIcon: 22, isPrivileged: false, isUser: true },
    7: { id: 7, modIcon: 41, isPrivileged: false, isUser: true },
    8: { id: 8, modIcon: 42, isPrivileged: false, isUser: true },
    9: { id: 9, modIcon: 43, isPrivileged: false, isUser: true },
    10: { id: 10, modIcon: 44, isPrivileged: false, isUser: true },
    11: { id: 11, modIcon: 45, isPrivileged: false, isUser: true },
    12: { id: 12, modIcon: 46, isPrivileged: false, isUser: true },
    13: { id: 13, modIcon: 47, isPrivileged: false, isUser: true },
    14: { id: 14, modIcon: 48, isPrivileged: false, isUser: true },
    15: { id: 15, modIcon: 49, isPrivileged: false, isUser: true },
    16: { id: 16, modIcon: 52, isPrivileged: false, isUser: true },
};

export function getPlayerTypeInfo(playerTypeId: number): PlayerTypeInfo | undefined {
    const id = playerTypeId | 0;
    return PLAYER_TYPE_BY_ID[id];
}

export function playerTypeIdToModIcon(playerTypeId: number | undefined | null): number {
    if (playerTypeId == null) return -1;
    return getPlayerTypeInfo(playerTypeId)?.modIcon ?? -1;
}

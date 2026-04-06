import type { WebSocket } from "ws";

import { encodeMessage } from "../../network/messages";
import type { PlayerState } from "../player";
import {
    MUSIC_UNLOCK_VARPS,
    VARBIT_ARCEUUS_FAVOR,
    VARBIT_ARCEUUS_SPELLBOOK_UNLOCKED,
    VARBIT_AUTOCAST_DEFMODE,
    VARBIT_AUTOCAST_SET,
    VARBIT_AUTOCAST_SPELL,
    VARBIT_CLIENT_OF_KOUREND,
    VARBIT_IBAN_BOOK_READ,
    VARBIT_MAGE_ARENA_2_PROGRESS,
    VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE,
    VARBIT_XPDROPS_ENABLED,
    VARP_AREA_SOUNDS_VOLUME,
    VARP_ATTACK_STYLE,
    VARP_AUTO_RETALIATE,
    VARP_BIOHAZARD,
    VARP_COMBAT_TARGET_PLAYER_INDEX,
    VARP_DESERT_TREASURE,
    VARP_EADGAR_QUEST,
    VARP_LAST_HOME_TELEPORT,
    VARP_LAST_MINIGAME_TELEPORT,
    VARP_LEGENDS_QUEST,
    VARP_LUNAR_DIPLOMACY,
    VARP_MAGE_ARENA,
    VARP_MASTER_VOLUME,
    VARP_MUSICPLAY,
    VARP_MUSIC_CURRENT_TRACK,
    VARP_MUSIC_VOLUME,
    VARP_OPTION_ATTACK_PRIORITY_NPC,
    VARP_OPTION_ATTACK_PRIORITY_PLAYER,
    VARP_OPTION_RUN,
    VARP_PLAGUE_CITY,
    VARP_SOUND_EFFECTS_VOLUME,
    VARP_SPECIAL_ATTACK,
    VARP_UNDERGROUND_PASS,
    VARP_WATCHTOWER,
    XPDROPS_TRANSMIT_VARPS,
} from "../../../../src/shared/vars";

export interface VarpSyncServiceDeps {
    withDirectSendBypass: (context: string, fn: () => void) => void;
    sendWithGuard: (ws: WebSocket, msg: string | Uint8Array, context: string) => void;
    authService: {
        syncAccountTypeVarbit: (
            player: PlayerState,
            cb: (varbitId: number, value: number) => void,
        ) => void;
    };
    soundManager: {
        syncMusicUnlockVarps: (player: PlayerState, trackId: number) => void;
    };
    queueVarp: (playerId: number, varpId: number, value: number) => void;
    musicUnlockService: { initializeDefaults: (player: PlayerState) => void } | undefined;
}

export interface VarpSyncServiceDeferredDeps {
    soundManager?: { syncMusicUnlockVarps: (player: PlayerState, trackId: number) => void };
    musicUnlockService?: { initializeDefaults: (player: PlayerState) => void };
}

export class VarpSyncService {
    constructor(private readonly deps: VarpSyncServiceDeps) {}

    setDeferredDeps(deferred: VarpSyncServiceDeferredDeps): void {
        Object.assign(this.deps, deferred);
    }

    syncMusicUnlockVarps(player: PlayerState, trackId: number): void {
        this.deps.soundManager.syncMusicUnlockVarps(player, trackId);
    }

    getCombatTargetPlayerVarpValue(player: PlayerState): number {
        const target = player.getCombatTarget();
        if (!target || !target.isPlayer) {
            return -1;
        }
        return target.id & 0x7ff;
    }

    syncCombatTargetPlayerVarp(player: PlayerState): void {
        const nextValue = this.getCombatTargetPlayerVarpValue(player);
        if ((player.getVarpValue(VARP_COMBAT_TARGET_PLAYER_INDEX) | 0) === (nextValue | 0)) {
            return;
        }

        player.setVarpValue(VARP_COMBAT_TARGET_PLAYER_INDEX, nextValue);
        this.deps.queueVarp(player.id, VARP_COMBAT_TARGET_PLAYER_INDEX, nextValue);
    }

    syncAccountTypeVarbit(sock: WebSocket, player: PlayerState): void {
        this.deps.authService.syncAccountTypeVarbit(player, (varbitId, value) => {
            this.deps.withDirectSendBypass("varbit", () =>
                this.deps.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varbit",
                        payload: { varbitId, value },
                    }),
                    "varbit",
                ),
            );
        });
    }

    sendSavedAutocastTransmitVarbits(sock: WebSocket, player: PlayerState): void {
        const autocastVarbits = [
            VARBIT_AUTOCAST_SET,
            VARBIT_AUTOCAST_SPELL,
            VARBIT_AUTOCAST_DEFMODE,
        ] as const;
        for (const varbitId of autocastVarbits) {
            const value = player.getVarbitValue(varbitId);
            this.deps.withDirectSendBypass("varbit", () =>
                this.deps.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varbit",
                        payload: { varbitId, value },
                    }),
                    "varbit",
                ),
            );
        }
    }

    sendSavedTransmitVarps(sock: WebSocket, player: PlayerState): void {
        const transmitVarpIds = [
            VARP_OPTION_RUN,
            VARP_ATTACK_STYLE,
            VARP_AUTO_RETALIATE,
            VARP_SPECIAL_ATTACK,
        ];
        for (const varpId of transmitVarpIds) {
            let value = player.getVarpValue(varpId);

            if (varpId === VARP_AUTO_RETALIATE) {
                value = player.autoRetaliate ? 0 : 1;
                player.setVarpValue(VARP_AUTO_RETALIATE, value);
            }

            if (varpId === VARP_OPTION_RUN) {
                value = player.wantsToRun() ? 1 : 0;
            }

            if (varpId === VARP_OPTION_RUN || varpId === VARP_AUTO_RETALIATE || value !== 0) {
                this.deps.withDirectSendBypass("varp", () =>
                    this.deps.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "varp",
                            payload: { varpId, value },
                        }),
                        "varp",
                    ),
                );
            }
        }

        for (const varpId of XPDROPS_TRANSMIT_VARPS) {
            const value = player.getVarpValue(varpId);
            if (value === 0) continue;
            this.deps.withDirectSendBypass("varp", () =>
                this.deps.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId, value },
                    }),
                    "varp",
                ),
            );
        }

        const DEFAULT_SOUND_VOLUME = 75;
        const volumeVarps = [
            VARP_MUSIC_VOLUME,
            VARP_SOUND_EFFECTS_VOLUME,
            VARP_AREA_SOUNDS_VOLUME,
            VARP_MASTER_VOLUME,
        ];
        for (const varpId of volumeVarps) {
            if (!player.hasVarpValue(varpId)) {
                player.setVarpValue(varpId, DEFAULT_SOUND_VOLUME);
            }
        }

        if (
            !player.hasVarpValue(VARP_MUSIC_CURRENT_TRACK) ||
            player.getVarpValue(VARP_MUSIC_CURRENT_TRACK) === 0
        ) {
            player.setVarpValue(VARP_MUSIC_CURRENT_TRACK, -1);
        }
        const soundVarps = [
            VARP_MUSIC_VOLUME,
            VARP_SOUND_EFFECTS_VOLUME,
            VARP_AREA_SOUNDS_VOLUME,
            VARP_MASTER_VOLUME,
            VARP_MUSICPLAY,
            VARP_MUSIC_CURRENT_TRACK,
        ];
        for (const varpId of soundVarps) {
            const value = player.getVarpValue(varpId);
            this.deps.withDirectSendBypass("varp", () =>
                this.deps.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId, value },
                    }),
                    "varp",
                ),
            );
        }

        const attackOptionVarps = [
            VARP_OPTION_ATTACK_PRIORITY_PLAYER,
            VARP_OPTION_ATTACK_PRIORITY_NPC,
        ];
        for (const varpId of attackOptionVarps) {
            const value = player.getVarpValue(varpId);
            this.deps.withDirectSendBypass("varp", () =>
                this.deps.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId, value },
                    }),
                    "varp",
                ),
            );
        }

        const combatTargetPlayerIndex = this.getCombatTargetPlayerVarpValue(player);
        player.setVarpValue(VARP_COMBAT_TARGET_PLAYER_INDEX, combatTargetPlayerIndex);
        this.deps.withDirectSendBypass("varp", () =>
            this.deps.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varp",
                    payload: {
                        varpId: VARP_COMBAT_TARGET_PLAYER_INDEX,
                        value: combatTargetPlayerIndex,
                    },
                }),
                "varp",
            ),
        );

        this.deps.withDirectSendBypass("varp", () =>
            this.deps.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varp",
                    payload: { varpId: VARP_LAST_HOME_TELEPORT, value: -100000 },
                }),
                "varp",
            ),
        );

        this.deps.withDirectSendBypass("varp", () =>
            this.deps.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varp",
                    payload: { varpId: VARP_LAST_MINIGAME_TELEPORT, value: -100000 },
                }),
                "varp",
            ),
        );

        const spellUnlockVarps: Array<{ varpId: number; value: number }> = [
            { varpId: VARP_LEGENDS_QUEST, value: 180 },
            { varpId: VARP_UNDERGROUND_PASS, value: 110 },
            { varpId: VARP_MAGE_ARENA, value: 8 },
            { varpId: VARP_DESERT_TREASURE, value: 15 },
            { varpId: VARP_LUNAR_DIPLOMACY, value: 190 },
            { varpId: VARP_EADGAR_QUEST, value: 110 },
            { varpId: VARP_WATCHTOWER, value: 13 },
            { varpId: VARP_PLAGUE_CITY, value: 29 },
            { varpId: VARP_BIOHAZARD, value: 16 },
        ];

        for (const { varpId, value } of spellUnlockVarps) {
            this.deps.withDirectSendBypass("varp", () =>
                this.deps.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId, value },
                    }),
                    "varp",
                ),
            );
        }

        const spellUnlockVarbits: Array<{ varbitId: number; value: number }> = [
            { varbitId: VARBIT_ARCEUUS_FAVOR, value: 1000 },
            { varbitId: VARBIT_ARCEUUS_SPELLBOOK_UNLOCKED, value: 1 },
            { varbitId: VARBIT_IBAN_BOOK_READ, value: 1 },
            { varbitId: VARBIT_MAGE_ARENA_2_PROGRESS, value: 6 },
            { varbitId: VARBIT_CLIENT_OF_KOUREND, value: 9 },
        ];

        for (const { varbitId, value } of spellUnlockVarbits) {
            this.deps.withDirectSendBypass("varbit", () =>
                this.deps.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varbit",
                        payload: { varbitId, value },
                    }),
                    "varbit",
                ),
            );
        }

        for (const varpId of MUSIC_UNLOCK_VARPS) {
            const value = player.getVarpValue(varpId);
            if (value !== 0) {
                this.deps.withDirectSendBypass("varp", () =>
                    this.deps.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "varp",
                            payload: { varpId, value },
                        }),
                        "varp",
                    ),
                );
            }
        }

        if (this.deps.musicUnlockService) {
            this.deps.musicUnlockService.initializeDefaults(player);
        }
        const musicUnlockMsgValue = player.getVarbitValue(VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE);
        this.deps.withDirectSendBypass("varbit", () =>
            this.deps.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varbit",
                    payload: {
                        varbitId: VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE,
                        value: musicUnlockMsgValue,
                    },
                }),
                "varbit",
            ),
        );

        const xpDropsEnabledValue = player.getVarbitValue(VARBIT_XPDROPS_ENABLED);
        this.deps.withDirectSendBypass("varbit", () =>
            this.deps.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varbit",
                    payload: {
                        varbitId: VARBIT_XPDROPS_ENABLED,
                        value: xpDropsEnabledValue,
                    },
                }),
                "varbit",
            ),
        );
    }
}

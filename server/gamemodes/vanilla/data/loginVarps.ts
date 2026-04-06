/**
 * Default varp values applied during login for the vanilla gamemode.
 * Includes volume defaults and music track initialization.
 */

import {
    VARP_MUSIC_VOLUME,
    VARP_SOUND_EFFECTS_VOLUME,
    VARP_AREA_SOUNDS_VOLUME,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_CURRENT_TRACK,
} from "../../../../src/shared/vars";

const DEFAULT_SOUND_VOLUME = 75;

export const DEFAULT_LOGIN_VARPS: Array<[number, number]> = [
    [VARP_MUSIC_VOLUME, DEFAULT_SOUND_VOLUME],
    [VARP_SOUND_EFFECTS_VOLUME, DEFAULT_SOUND_VOLUME],
    [VARP_AREA_SOUNDS_VOLUME, DEFAULT_SOUND_VOLUME],
    [VARP_MASTER_VOLUME, DEFAULT_SOUND_VOLUME],
    [VARP_MUSIC_CURRENT_TRACK, -1],
];

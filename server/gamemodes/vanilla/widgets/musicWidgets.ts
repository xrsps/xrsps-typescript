import {
    MUSIC_GROUP_ID,
    MUSIC_JUKEBOX_CHILD_ID,
    MUSIC_SKIP_CHILD_ID,
} from "../../../../src/shared/ui/music";
import { VARP_MUSICPLAY } from "../../../../src/shared/vars";
import type { PlayerState } from "../../../src/game/player";
import { type IScriptRegistry, type ScriptServices } from "../../../src/game/scripts/types";

export function registerMusicWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    const playTrack = (player: PlayerState, trackId: number, trackName: string): void => {
        if (player.varps.getVarpValue(VARP_MUSICPLAY) !== 2) {
            player.varps.setVarpValue(VARP_MUSICPLAY, 2);
            services.variables.sendVarp?.(player, VARP_MUSICPLAY, 2);
        }
        services.sound.playSong(player, trackId, trackName);
    };

    registry.onButton(MUSIC_GROUP_ID, MUSIC_JUKEBOX_CHILD_ID, (event) => {
        const slot = event.slot ?? event.childId;
        const track = services.sound.getMusicTrackBySlot(slot);
        if (!track) {
            return;
        }
        playTrack(event.player, track.trackId, track.trackName);
    });

    registry.onButton(MUSIC_GROUP_ID, MUSIC_SKIP_CHILD_ID, (event) => {
        if (event.player.varps.getVarpValue(VARP_MUSICPLAY) !== 1) {
            return;
        }
        services.sound.skipMusicTrack(event.player);
    });

    // Register for "Play" option without a specific widgetId - filter by groupId in handler
    // Keep this as a fallback for non-binary sources that still forward the target text.
    registry.registerWidgetAction({
        option: "Play",
        handler: (event) => {
            // Only handle music tab (group 239)
            if (event.groupId !== MUSIC_GROUP_ID) return;

            // Strip color tags from target name (CS2 sets opBase with color formatting)
            let trackName = event.target || "";
            trackName = trackName.replace(/<[^>]+>/g, "").trim();
            if (!trackName) return;

            // Look up the track ID from the database
            const trackId = services.sound.getMusicTrackId(trackName) ?? -1;
            if (trackId < 0) return;

            playTrack(event.player, trackId, trackName);
        },
    });
}

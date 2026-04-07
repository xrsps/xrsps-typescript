/**
 * Network managers module.
 *
 * Contains specialized managers for network-related functionality,
 * extracted from wsServer for better organization and testability.
 */

export {
    NpcSyncManager,
    type HealthBarUpdatePayload,
    type NpcViewSnapshot,
    type NpcUpdatePayload,
    type NpcPacketBuffer,
    type NpcTickFrame,
} from "./NpcSyncManager";

export {
    PlayerAppearanceManager,
    type PlayerAnimSet,
    type AppearanceSnapshotEntry,
} from "./PlayerAppearanceManager";

export {
    SoundManager,
    type SoundBroadcastRequest,
    type LocSoundRequest,
    type AreaSoundRequest,
    type TickFrameRef,
    type MusicCatalogTrackRef,
} from "./SoundManager";

export {
    GroundItemHandler,
    type GroundItemActionPayload,
    type GroundItemsServerPayload,
} from "./GroundItemHandler";

export { Cs2ModalManager } from "./Cs2ModalManager";

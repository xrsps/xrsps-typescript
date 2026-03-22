/**
 * Door system type definitions for OSRS 1:1 parity.
 * Based on RSMod door plugin implementation.
 */

/**
 * Which way a single door rotates when it opens.
 * - "cw"  (clockwise):         rotation + 1 — default for most OSRS doors
 * - "ccw" (counter-clockwise): rotation - 1 — used for doors that swing the other way
 *
 *   CW  rotation 0 (W wall) → shifts West  | CCW → shifts South
 *   CW  rotation 1 (N wall) → shifts North | CCW → shifts West
 *   CW  rotation 2 (E wall) → shifts East  | CCW → shifts North
 *   CW  rotation 3 (S wall) → shifts South | CCW → shifts East
 */
export type DoorOpenDir = "cw" | "ccw";

/**
 * Single door definition - maps closed loc ID to opened loc ID
 */
export interface SingleDoorDef {
    closed: number;
    opened: number;
    /** Which way the door rotates when opening. Defaults to "cw". */
    openDir?: DoorOpenDir;
}

/**
 * Double door pair - left and right halves
 */
export interface DoubleDoorPair {
    left: number;
    right: number;
}

/**
 * Double door definition - maps closed pair to opened pair
 */
export interface DoubleDoorDef {
    closed: DoubleDoorPair;
    opened: DoubleDoorPair;
}

/**
 * Gate pair - hinge plus extension piece.
 * These are two locs that move as a single gate object around the hinge pivot.
 */
export interface GatePair {
    hinge: number;
    extension: number;
}

/**
 * Gate movement style:
 * - hinge: one rigid 2-tile gate panel pivoting around hinge (wooden gate behavior)
 * - center: two leaves opening away from center
 */
export type GateOpenStyle = "hinge" | "center";

/**
 * Gate definition - maps closed hinge/extension to opened hinge/extension.
 */
export interface GateDef {
    closed: GatePair;
    opened: GatePair;
    openStyle?: GateOpenStyle;
}

/**
 * Result of a door toggle operation
 */
export interface DoorToggleResult {
    /** Whether the toggle was successful */
    success: boolean;
    /** The new loc ID after toggling */
    newLocId?: number;
    /** The previous rotation before toggling */
    oldRotation?: number;
    /** The new tile position (doors shift when opened) */
    newTile?: { x: number; y: number };
    /** The new rotation (doors rotate 90 degrees when opened) */
    newRotation?: number;
    /** Sound ID to play: 60=close, 62=open */
    soundId: number;
    /** For double doors: the partner door's state change */
    partnerResult?: DoorPartnerResult;
}

/**
 * Partner door result for double doors
 */
export interface DoorPartnerResult {
    oldLocId: number;
    newLocId: number;
    oldTile: { x: number; y: number };
    newTile: { x: number; y: number };
    oldRotation: number;
    newRotation: number;
}

/**
 * Parameters for toggling a door
 */
export interface DoorToggleParams {
    x: number;
    y: number;
    level: number;
    currentId: number;
    /** Wall rotation (0=West, 1=North, 2=East, 3=South). Defaults to 0. */
    rotation?: number;
    /** Loc model type (0=WALL, etc.). Defaults to WALL (0). */
    locType?: number;
    action?: string;
    /** Current game tick for auto-close tracking. Defaults to 0. */
    currentTick?: number;
}

/**
 * Door state tracking per tile
 */
export interface DoorTileState {
    closedId: number;
    openedId: number;
    currentId: number;
    rotation: number;
    locType: number;
    /** Tick when door was opened (for auto-close). Undefined if door is closed. */
    openedAtTick?: number;
}

// Sound effect IDs (OSRS)
export const DOOR_SOUND_CLOSE = 60;
export const DOOR_SOUND_OPEN = 62;

// OSRS: Open doors auto-close after 300 seconds (5 minutes) = 500 ticks at 600ms/tick
export const DOOR_AUTO_CLOSE_TICKS = 500;

// Door-related keywords for recognizing observed door transitions.
export const DOOR_NAME_KEYWORDS = ["door", "gate", "trapdoor", "portcullis", "grill"];
export const DOOR_ACTION_KEYWORDS = ["open", "close", "unlock", "lock"];

/**
 * Game states matching the reference client (Client.gameState).
 * These control which screen is displayed and what logic runs each frame.
 *
 * OSRS Reference (class207.java):
 * - 0/5: Loading screen with progress bar
 * - 10/11/50: Login screen (loginIndex determines which view)
 * - 20: Connecting to server
 * - 30+: Logged in / playing
 *
 * Extended states:
 * - DOWNLOADING: Cache download in progress (before LOADING)
 */
export enum GameState {
    /** Cache downloading from server (shows download progress bar) */
    DOWNLOADING = -1,
    /** Initial loading state - cache/assets loading (shows progress bar) */
    LOADING = 0,
    /** Login screen displayed - uses loginIndex to determine view */
    LOGIN_SCREEN = 10,
    /** Connecting to server after credentials entered */
    CONNECTING = 20,
    /** Loading game data after login - shows "Loading - please wait." */
    LOADING_GAME = 25,
    /** Logged in - game world rendering */
    LOGGED_IN = 30,
    /** Connection lost - shows "Connection lost" message */
    RECONNECTING = 40,
    /** Reconnecting variant - shows "Please wait..." */
    PLEASE_WAIT = 45,
    /** Special login state (seasonal/tournament) - also shows login screens */
    SPECIAL_LOGIN = 50,
    /** Connection lost - attempting to reconnect (shows message) */
    CONNECTION_LOST = 100,
    /** Error state (internal) */
    ERROR = 1000,
}

/**
 * Login screen index - different views within the login screen.
 * Matches Login.loginIndex in the reference client.
 */
export enum LoginIndex {
    /** Welcome screen with "New User" and "Existing User" buttons */
    WELCOME = 0,
    /** Warning/info messages (PvP world, beta, etc) */
    WARNING = 1,
    /** Login form with username/password */
    LOGIN_FORM = 2,
    /** Incorrect username/password error */
    INVALID_CREDENTIALS = 3,
    /** Authenticator entry */
    AUTHENTICATOR = 4,
    /** Forgotten password */
    FORGOT_PASSWORD = 5,
    /** Generic message screen */
    MESSAGE = 6,
    /** Date of birth entry */
    DATE_OF_BIRTH = 7,
    /** Account not eligible */
    NOT_ELIGIBLE = 8,
    /** Try again prompt */
    TRY_AGAIN = 9,
    /** Welcome with display name (Jagex account) */
    WELCOME_DISPLAY_NAME = 10,
    /** World hop warning / specific warning screen */
    WORLD_HOP_WARNING = 11,
    /** Terms acceptance */
    TERMS = 12,
    /** Must accept terms */
    MUST_ACCEPT_TERMS = 13,
    /** Ban information */
    BANNED = 14,
    /** Generic OK message */
    OK_MESSAGE = 24,
    /** Date of birth not set */
    DOB_NOT_SET = 32,
    /** Download launcher prompt */
    DOWNLOAD_LAUNCHER = 33,
}

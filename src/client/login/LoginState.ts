import { LoginIndex } from "./GameState";
import { isIosStandalonePwa } from "../../util/DeviceUtil";
import { DEFAULT_SERVER } from "../../util/serverDefaults";

const STORAGE_KEY_TITLE_MUSIC_DISABLED = "osrs:titleMusicDisabled";
const STORAGE_KEY_LAST_SERVER = "osrs:lastServer";
const STORAGE_KEY_IOS_PWA_LOGIN_STATE = "osrs:iosPwaLoginState";
const IOS_PWA_LOGIN_STATE_VERSION = 1;

type PersistedIosPwaLoginState = {
    version: number;
    username: string;
    password: string;
    rememberUsername: boolean;
    isUsernameHidden: boolean;
};

/**
 * Login state instance class.
 * Holds all mutable state for the login screen.
 */
export class LoginState {
    constructor() {
        // Load persisted settings from localStorage
        this.loadPersistedSettings();
        this.loadPersistedLoginState();
    }

    /** Load settings that should persist between sessions */
    private loadPersistedSettings(): void {
        try {
            const musicDisabled = localStorage.getItem(STORAGE_KEY_TITLE_MUSIC_DISABLED);
            if (musicDisabled !== null) {
                this.titleMusicDisabled = musicDisabled === "true";
            }
        } catch {}
        try {
            const raw = localStorage.getItem(STORAGE_KEY_LAST_SERVER);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (typeof parsed.name === "string") this.serverName = parsed.name;
                if (typeof parsed.address === "string") this.serverAddress = parsed.address;
                if (typeof parsed.secure === "boolean") this.serverSecure = parsed.secure;
            }
        } catch {}
    }

    /** Save title music disabled setting to localStorage */
    saveTitleMusicSetting(): void {
        try {
            localStorage.setItem(STORAGE_KEY_TITLE_MUSIC_DISABLED, String(this.titleMusicDisabled));
        } catch {
            // localStorage not available
        }
    }

    private supportsPersistedLoginState(): boolean {
        return (
            isIosStandalonePwa() &&
            typeof window !== "undefined" &&
            typeof window.localStorage !== "undefined"
        );
    }

    private loadPersistedLoginState(): void {
        if (!this.supportsPersistedLoginState()) {
            return;
        }

        try {
            const raw = window.localStorage.getItem(STORAGE_KEY_IOS_PWA_LOGIN_STATE);
            if (!raw) {
                return;
            }

            const parsed = JSON.parse(raw) as Partial<PersistedIosPwaLoginState>;
            if (parsed.version !== IOS_PWA_LOGIN_STATE_VERSION) {
                return;
            }

            if (typeof parsed.rememberUsername === "boolean") {
                this.rememberUsername = parsed.rememberUsername;
            }
            if (typeof parsed.isUsernameHidden === "boolean") {
                this.isUsernameHidden = parsed.isUsernameHidden;
            }

            if (!this.rememberUsername) {
                this.username = "";
                this.password = "";
                return;
            }

            if (typeof parsed.username === "string") {
                this.username = parsed.username.slice(0, 320);
            }
            if (typeof parsed.password === "string") {
                this.password = parsed.password.slice(0, 20);
            }

            if (this.username.length > 0 || this.password.length > 0) {
                this.loginIndex = LoginIndex.LOGIN_FORM;
                this.currentLoginField = this.username.length > 0 ? 1 : 0;
                this.setResponse("", "Enter your username & password.", "", "");
            }
        } catch {
            // localStorage unavailable or corrupted
        }
    }

    savePersistedLoginState(): void {
        if (!this.supportsPersistedLoginState()) {
            return;
        }

        try {
            const payload: PersistedIosPwaLoginState = {
                version: IOS_PWA_LOGIN_STATE_VERSION,
                username: this.rememberUsername ? this.username.slice(0, 320) : "",
                password: this.rememberUsername ? this.password.slice(0, 20) : "",
                rememberUsername: this.rememberUsername,
                isUsernameHidden: this.isUsernameHidden,
            };
            window.localStorage.setItem(STORAGE_KEY_IOS_PWA_LOGIN_STATE, JSON.stringify(payload));
        } catch {
            // localStorage unavailable
        }
    }
    // ========== UI Dialog State ==========

    /** Current login screen index (which dialog to show) */
    loginIndex: LoginIndex = LoginIndex.WELCOME;

    // ========== Network Protocol State ==========

    /** Network handshake state (0-22, matches reference loginState) */
    networkState: number = 0;

    // ========== Credentials ==========

    /** Username/email input */
    username: string = "";

    /** Password input */
    password: string = "";

    /** Authenticator OTP code */
    otp: string = "";

    /** Display name (for Jagex accounts) */
    displayName: string = "";

    // ========== Response Messages ==========

    /** Response line 0 (title/header) */
    response0: string = "";

    /** Response line 1 */
    response1: string = "";

    /** Response line 2 */
    response2: string = "";

    /** Response line 3 */
    response3: string = "";

    // ========== UI State ==========

    /** Current focused login field (0=username, 1=password) */
    currentLoginField: number = 0;

    /** Remember username checkbox state */
    rememberUsername: boolean = true;

    /** Remember username checkbox hover state */
    rememberUsernameHover: boolean = false;

    /** Hide username checkbox state */
    isUsernameHidden: boolean = false;

    /** Hide username checkbox hover state */
    hideUsernameHover: boolean = false;

    /** Trust this computer checkbox state (authenticator) */
    trustComputer: boolean = false;

    /** Trust checkbox hover state */
    trustComputerHover: boolean = false;

    /** Ban type (-1 = not banned) */
    banType: number = -1;

    /** Login field type (1=normal, 2=having trouble) */
    loginFieldType: number = 1;

    // ========== Date of Birth ==========

    /** DOB input fields (8 digits: DD/MM/YYYY) */
    dobFields: (string | null)[] = new Array(8).fill(null);

    /** Current DOB field index */
    dobFieldIndex: number = 0;

    /** DOB entry available (desktop only) */
    dobEntryAvailable: boolean = true;

    // ========== Server List ==========

    /** Server list overlay open */
    serverListOpen: boolean = false;

    /** Currently hovered server index (-1 = none) */
    hoveredServerIndex: number = -1;

    /** Current server address displayed on the button */
    serverAddress: string = DEFAULT_SERVER.address;

    /** Current server name displayed on the button */
    serverName: string = DEFAULT_SERVER.name;

    /** Whether the current server uses secure WebSocket */
    serverSecure: boolean = DEFAULT_SERVER.secure;

    /** Persist the last selected server to localStorage */
    saveLastServer(): void {
        try {
            localStorage.setItem(STORAGE_KEY_LAST_SERVER, JSON.stringify({
                name: this.serverName,
                address: this.serverAddress,
                secure: this.serverSecure,
            }));
        } catch {}
    }

    // ========== World Select ==========

    /** World selection overlay open */
    worldSelectOpen: boolean = false;

    /** Hovered world ID (not index - survives re-sorting) */
    hoveredWorldId: number = -1;

    /** Current world select page */
    worldSelectPage: number = 0;

    /** Total world select pages */
    worldSelectPagesCount: number = 1;

    /** Selected world ID */
    worldId: number = 1;

    /** World request loading state */
    worldRequestLoading: boolean = false;

    // ========== Mobile World Select ==========

    /** Scroll offset for mobile world select list view (in pixels) */
    mobileWorldSelectScrollOffset: number = 0;

    /** Touch scroll velocity for momentum scrolling */
    mobileWorldSelectScrollVelocity: number = 0;

    /** Filter text for mobile world search */
    mobileWorldSelectFilter: string = "";

    /** Virtual keyboard is currently visible */
    virtualKeyboardVisible: boolean = false;

    // ========== Client Flags ==========

    /** Client language (0=EN) - world select only shows for English */
    clientLanguage: number = 0;

    /** Whether client is on mobile (affects DOB screen) */
    onMobile: boolean = false;

    /** Title music disabled */
    titleMusicDisabled: boolean = false;

    // ========== Loading State ==========

    /** Loading progress percentage (0-100) */
    loadingPercent: number = 10;

    /** Loading status text */
    loadingText: string = "";

    // ========== Download State ==========

    /** Download progress current bytes */
    downloadCurrent: number = 0;

    /** Download progress total bytes */
    downloadTotal: number = 0;

    /** Download progress label (optional custom text) */
    downloadLabel: string = "";

    // ========== Methods ==========

    /**
     * Reset all login state to defaults.
     */
    reset(): void {
        this.loginIndex = LoginIndex.WELCOME;
        this.networkState = 0;
        this.username = "";
        this.password = "";
        this.otp = "";
        this.displayName = "";
        this.response0 = "";
        this.response1 = "";
        this.response2 = "";
        this.response3 = "";
        this.currentLoginField = 0;
        this.serverListOpen = false;
        this.hoveredServerIndex = -1;
        this.worldSelectOpen = false;
        this.hoveredWorldId = -1;
        this.worldSelectPage = 0;
        this.banType = -1;
        this.dobFields = new Array(8).fill(null);
        this.dobFieldIndex = 0;
        this.trustComputer = false;
        this.trustComputerHover = false;
        this.loadingPercent = 10;
        this.loadingText = "";
        // Download state
        this.downloadCurrent = 0;
        this.downloadTotal = 0;
        this.downloadLabel = "";
        // Mobile state
        this.mobileWorldSelectScrollOffset = 0;
        this.mobileWorldSelectScrollVelocity = 0;
        this.mobileWorldSelectFilter = "";
        this.virtualKeyboardVisible = false;
        this.loadPersistedLoginState();
    }

    /**
     * Set response messages for display.
     */
    setResponse(r0: string, r1: string, r2: string, r3: string): void {
        this.response0 = r0;
        this.response1 = r1;
        this.response2 = r2;
        this.response3 = r3;
    }

    /**
     * Prompt for credentials - switch to login form.
     */
    promptCredentials(preserveUsername: boolean = true): void {
        this.loginIndex = LoginIndex.LOGIN_FORM;
        if (!preserveUsername) {
            this.username = "";
            this.password = "";
        }
        this.currentLoginField = this.username.length > 0 ? 1 : 0;
        this.setResponse("", "Enter your username & password.", "", "");
    }

    /**
     * Get masked password string for display.
     */
    getMaskedPassword(): string {
        return "*".repeat(this.password.length);
    }

    /**
     * Get masked OTP string for display.
     */
    getMaskedOtp(): string {
        return "*".repeat(this.otp.length);
    }

    /**
     * Check if credentials are valid for login attempt.
     */
    canAttemptLogin(): boolean {
        return this.username.trim().length > 0 && this.password.length > 0;
    }
}

/**
 * Login screen action types.
 * Returned by input handlers to indicate what action to perform.
 * Uses discriminated union for type-safe action handling.
 */
export type LoginAction =
    | { type: "new_user" }
    | { type: "existing_user" }
    | { type: "login" }
    | { type: "cancel" }
    | { type: "try_again" }
    | { type: "forgot_password" }
    | { type: "back" }
    | { type: "continue" }
    | { type: "recover" }
    | { type: "submit_otp" }
    | { type: "submit_dob" }
    | { type: "toggle_remember" }
    | { type: "toggle_hide_username" }
    | { type: "toggle_trust" }
    | { type: "open_server_list" }
    | { type: "close_server_list" }
    | { type: "refresh_server_list" }
    | { type: "select_server"; index: number }
    | { type: "open_world_select" }
    | { type: "close_world_select" }
    | { type: "select_world"; worldId: number }
    | { type: "world_page_left" }
    | { type: "world_page_right" }
    | { type: "world_sort"; column: number }
    | { type: "toggle_music" }
    | { type: "field_click"; field: number };

/**
 * Pre-allocated action objects to avoid allocations during input handling.
 * Critical for mobile performance.
 */
export const LoginActions = {
    NEW_USER: { type: "new_user" } as const,
    EXISTING_USER: { type: "existing_user" } as const,
    LOGIN: { type: "login" } as const,
    CANCEL: { type: "cancel" } as const,
    TRY_AGAIN: { type: "try_again" } as const,
    FORGOT_PASSWORD: { type: "forgot_password" } as const,
    BACK: { type: "back" } as const,
    CONTINUE: { type: "continue" } as const,
    RECOVER: { type: "recover" } as const,
    SUBMIT_OTP: { type: "submit_otp" } as const,
    SUBMIT_DOB: { type: "submit_dob" } as const,
    TOGGLE_REMEMBER: { type: "toggle_remember" } as const,
    TOGGLE_HIDE_USERNAME: { type: "toggle_hide_username" } as const,
    TOGGLE_TRUST: { type: "toggle_trust" } as const,
    OPEN_SERVER_LIST: { type: "open_server_list" } as const,
    CLOSE_SERVER_LIST: { type: "close_server_list" } as const,
    REFRESH_SERVER_LIST: { type: "refresh_server_list" } as const,
    OPEN_WORLD_SELECT: { type: "open_world_select" } as const,
    CLOSE_WORLD_SELECT: { type: "close_world_select" } as const,
    WORLD_PAGE_LEFT: { type: "world_page_left" } as const,
    WORLD_PAGE_RIGHT: { type: "world_page_right" } as const,
    TOGGLE_MUSIC: { type: "toggle_music" } as const,
    FIELD_USERNAME: { type: "field_click", field: 0 } as const,
    FIELD_PASSWORD: { type: "field_click", field: 1 } as const,
} as const;

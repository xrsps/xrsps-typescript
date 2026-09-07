import { createScriptEvent } from "../../rs/cs2/Cs2Vm";
import type { Cs2Vm } from "../../rs/cs2/Cs2Vm";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import { markWidgetInteractionDirty } from "../../widgets/WidgetInteraction";
import type { WidgetManager } from "../../widgets/WidgetManager";
import { isMobileMode } from "../../common/utils/DeviceUtil";

const CHATBOX_GROUP_ID = 162;
/** Component 162:57 — the chat input line written by [proc,chat_promptinput]. */
const CHATBOX_INPUT_CHILD_ID = 57;
/** CS2 script 223 = [proc,chat_promptinput], rebuilds the chat input line text. */
const CHAT_PROMPT_SCRIPT_ID = 223;
const CHAT_LOCKED_PROMPT = "Press Enter to Chat";
/** Varc 5 is non-zero while a native OSRS chatbox input dialog is active. */
const CHATBOX_INPUT_MODE_VARC = 5;
const CHAT_INPUT_VARC = 335;
const OSRS_KEY_ENTER = 84;
const OSRS_KEY_ESCAPE = 13;

export type EnterToTypeChatDeps = {
    cs2Vm: Cs2Vm;
    varManager: VarManager;
    widgetManager: WidgetManager;
    isLoggedIn: () => boolean;
    isItemSpawnerSearchFocused: () => boolean;
};

/**
 * RuneLite-style "Press Enter to Chat" (desktop only): while locked, keystrokes are
 * not delivered to the chatbox input scripts and WASD rotates the camera instead.
 * Enter (or "/" / ":") unlocks typing; sending a message or Escape re-locks it.
 */
export class EnterToTypeChat {
    private unlocked = false;

    constructor(private readonly deps: EnterToTypeChatDeps) {}

    get isUnlocked(): boolean {
        return this.unlocked;
    }

    reset(): void {
        this.unlocked = false;
    }

    /** Desktop-only; touch devices keep tap-to-type. */
    isEnabled(): boolean {
        return !isMobileMode && this.deps.isLoggedIn();
    }

    /** True while the chatbox ignores typing (keys are free for camera/hotkeys). */
    isLocked(): boolean {
        return this.isEnabled() && !this.unlocked;
    }

    private isNativeChatboxInputActive(): boolean {
        return this.deps.varManager.getVarcInt(CHATBOX_INPUT_MODE_VARC) !== 0;
    }

    /**
     * True while WASD should rotate the camera instead of typing. Any active text
     * input (chat typing mode, chatbox dialogs, item spawner search) releases WASD
     * back to typing.
     */
    isWasdCameraActive(inputDialogType: number): boolean {
        return (
            this.isLocked() &&
            inputDialogType === 0 &&
            !this.isNativeChatboxInputActive() &&
            !this.deps.isItemSpawnerSearchFocused()
        );
    }

    setUnlocked(unlocked: boolean): void {
        if (this.unlocked === unlocked) {
            return;
        }
        this.unlocked = unlocked;
        this.refreshPrompt();
    }

    /**
     * Re-run [proc,chat_promptinput] so the chat input line reflects the real typed
     * buffer. While locked, applyLockPlaceholder() (run every frame) swaps the line
     * back to the "Press Enter to Chat" placeholder.
     */
    refreshPrompt(): void {
        try {
            this.deps.cs2Vm.runScriptEvent(
                createScriptEvent({ args: [CHAT_PROMPT_SCRIPT_ID] }),
            );
        } catch {}
    }

    /**
     * While chat is locked, display "Press Enter to Chat" after the player name in the
     * chat input line (component 162:57). Runs every frame so it self-heals whenever
     * chat_promptinput rewrites the line (login, chat rebuilds, name changes).
     */
    applyLockPlaceholder(): void {
        if (!this.isLocked() || this.isNativeChatboxInputActive()) {
            return;
        }
        const widget = this.deps.widgetManager.findWidget(CHATBOX_GROUP_ID, CHATBOX_INPUT_CHILD_ID);
        if (!widget) {
            return;
        }
        const text = typeof widget.text === "string" ? widget.text : "";
        if (text.length === 0 || text.includes(CHAT_LOCKED_PROMPT)) {
            return;
        }
        // chat_promptinput composes "<col=..>Name<col=..>: typed*</col>"; keep the name
        // prefix and replace everything after the colon (same approach as RuneLite).
        const idx = text.indexOf(":");
        if (idx === -1) {
            return;
        }
        widget.text = `${text.slice(0, idx)}: ${CHAT_LOCKED_PROMPT}`;
        markWidgetInteractionDirty(widget);
        this.deps.widgetManager.invalidateWidgetRender(widget);
    }

    /**
     * Enter-to-type state machine, run per key event before widget onKey dispatch.
     * Returns true when the event is fully consumed (must not reach any widget).
     */
    handleKeyEvent(
        keyEvent: { keyTyped: number; keyPressed: number },
        dialogActive: boolean,
    ): boolean {
        if (dialogActive || this.isNativeChatboxInputActive() || !this.isEnabled()) {
            return false;
        }

        if (!this.unlocked) {
            if (keyEvent.keyTyped === OSRS_KEY_ENTER) {
                // Consume the unlocking Enter so it does not submit an empty message.
                this.setUnlocked(true);
                return true;
            }
            // "/" and ":" start channel messages — unlock and let the character through.
            if (keyEvent.keyPressed === 47 || keyEvent.keyPressed === 58) {
                this.setUnlocked(true);
            }
            return false;
        }

        if (keyEvent.keyTyped === OSRS_KEY_ESCAPE) {
            // Escape cancels typing: clear the buffer and re-lock.
            this.deps.varManager.setVarcString(CHAT_INPUT_VARC, "");
            this.setUnlocked(false);
            return true;
        }
        return false;
    }

    /** True if keys should not be dispatched to chatbox-group widgets. */
    shouldBlockChatboxKeys(dialogActive: boolean): boolean {
        return !dialogActive && !this.isNativeChatboxInputActive() && this.isLocked();
    }

    isChatboxGroupUid(uid: number): boolean {
        return ((uid | 0) >>> 16) === CHATBOX_GROUP_ID;
    }

    /**
     * After a message send, CS2 clears varc 335. Re-lock when that happens while unlocked.
     */
    maybeRelockAfterSend(draftBefore: string, draftAfter: string): void {
        if (
            this.unlocked &&
            this.isEnabled() &&
            draftBefore.trim().length > 0 &&
            draftAfter.trim().length === 0
        ) {
            this.setUnlocked(false);
        }
    }

    getDraft(): string {
        return this.deps.varManager.getVarcString(CHAT_INPUT_VARC) ?? "";
    }
}

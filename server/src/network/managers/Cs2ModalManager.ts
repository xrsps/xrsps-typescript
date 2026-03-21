import {
    INDEXED_MENU_GROUP_ID,
    INDEXED_MENU_LIST_COMPONENT_ID,
    INDEXED_MENU_LIST_UID,
    INDEXED_MENU_PAUSE_BUTTON_FLAGS,
    INDEXED_MENU_SCRIPT_ID,
} from "../../../../src/shared/ui/indexedMenu";
import {
    VOTE_MODAL_COMPONENT_BODY,
    VOTE_MODAL_COMPONENT_CLOSE_BUTTON,
    VOTE_MODAL_COMPONENT_COMPLETION,
    VOTE_MODAL_COMPONENT_FRAME,
    VOTE_MODAL_COMPONENT_NOTE,
    VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_1,
    VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_2,
    VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_3,
    VOTE_MODAL_COMPONENT_PROGRESS_TEXT,
    VOTE_MODAL_COMPONENT_PROGRESS_TRACK,
    VOTE_MODAL_COMPONENT_REWARD,
    VOTE_MODAL_COMPONENT_REWARD_ICON_CHEST,
    VOTE_MODAL_COMPONENT_REWARD_ICON_COINS,
    VOTE_MODAL_COMPONENT_REWARD_ICON_STARS,
    VOTE_MODAL_COMPONENT_REWARD_TRAIL_CENTER,
    VOTE_MODAL_COMPONENT_REWARD_TRAIL_LEFT,
    VOTE_MODAL_COMPONENT_REWARD_TRAIL_RIGHT,
    VOTE_MODAL_COMPONENT_ROW_RULOCUS,
    VOTE_MODAL_COMPONENT_ROW_RUNELIST,
    VOTE_MODAL_COMPONENT_ROW_TOPG,
    VOTE_MODAL_COMPONENT_SITE_RULOCUS,
    VOTE_MODAL_COMPONENT_SITE_RUNELIST,
    VOTE_MODAL_COMPONENT_SITE_TOPG,
    VOTE_MODAL_COMPONENT_STATUS_RULOCUS,
    VOTE_MODAL_COMPONENT_STATUS_RUNELIST,
    VOTE_MODAL_COMPONENT_STATUS_TOPG,
    VOTE_MODAL_COMPONENT_TIMER_HINT,
    VOTE_MODAL_COMPONENT_TITLE,
    VOTE_MODAL_GROUP_ID,
} from "../../../../src/shared/ui/voteModal";
import {
    ITEM_SPAWNER_MODAL_COMPONENT_BODY as ITEM_SPAWNER_MODAL_BODY_COMPONENT,
    ITEM_SPAWNER_MODAL_COMPONENT_CLOSE as ITEM_SPAWNER_MODAL_CLOSE_COMPONENT,
    ITEM_SPAWNER_MODAL_COMPONENT_FRAME as ITEM_SPAWNER_MODAL_FRAME_COMPONENT,
    ITEM_SPAWNER_MODAL_COMPONENT_HELPER as ITEM_SPAWNER_MODAL_HELPER_COMPONENT,
    ITEM_SPAWNER_MODAL_COMPONENT_QUERY as ITEM_SPAWNER_MODAL_QUERY_COMPONENT,
    ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND,
    ITEM_SPAWNER_MODAL_COMPONENT_SLOT_ICON_START,
    ITEM_SPAWNER_MODAL_COMPONENT_SUMMARY as ITEM_SPAWNER_MODAL_SUMMARY_COMPONENT,
    ITEM_SPAWNER_MODAL_COMPONENT_TITLE as ITEM_SPAWNER_MODAL_TITLE_COMPONENT,
    ITEM_SPAWNER_MODAL_GROUP_ID,
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT,
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT_ICON,
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_BODY,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_CLOSE,
    SMITHING_BAR_MODAL_COMPONENT_FRAME,
    SMITHING_BAR_MODAL_COMPONENT_IRON,
    SMITHING_BAR_MODAL_COMPONENT_IRON_ICON,
    SMITHING_BAR_MODAL_COMPONENT_IRON_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL_ICON,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_RUNE,
    SMITHING_BAR_MODAL_COMPONENT_RUNE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_RUNE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_STEEL,
    SMITHING_BAR_MODAL_COMPONENT_STEEL_ICON,
    SMITHING_BAR_MODAL_COMPONENT_STEEL_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_TITLE,
    SMITHING_BAR_MODAL_GROUP_ID,
} from "../../../../src/shared/ui/widgets";
import { FONT_BOLD_12 } from "../../../../src/ui/fonts";
import type { PlayerState } from "../../game/player";

type VoteLink = {
    site: string;
    intervalSeconds: number;
    url: string;
    rowComponentId: number;
    siteComponentId: number;
    statusComponentId: number;
};

type VoteSiteUiState = {
    statusLabel: string;
    siteColorTag: string;
    buttonTextColor: number;
    buttonHoverTextColor: number;
    buttonPressed: boolean;
    statusIconGraphic: number;
    completed: boolean;
    cooldown: boolean;
    canVote: boolean;
};

type SmithingBarOption = {
    barType: number;
    buttonComponentId: number;
    iconComponentId: number;
    textComponentId: number;
    label: string;
};

export type ItemSpawnerSpawnResult = {
    requested: number;
    completed: number;
    itemName: string;
};

export type IndexedMenuRequest = {
    title: string;
    options: string[];
    closeOnSelect?: boolean;
    onSelect?: (player: PlayerState, optionIndex: number, optionLabel: string) => void;
};

type IndexedMenuState = {
    title: string;
    options: string[];
    closeOnSelect: boolean;
    onSelect?: (player: PlayerState, optionIndex: number, optionLabel: string) => void;
};

export interface Cs2ModalManagerServices {
    openModal: (player: PlayerState, interfaceId: number, data?: unknown) => void;
    closeModal: (player: PlayerState) => void;
    getCurrentModal: (player: PlayerState) => number | undefined;
    queueWidgetEvent: (playerId: number, event: any) => void;
    queueGameMessage: (playerId: number, text: string) => void;
    setSmithingBarType: (player: PlayerState, barType: number) => void;
    openSmithingForgeInterface: (player: PlayerState) => void;
    spawnInventoryItem: (player: PlayerState, itemId: number, quantity: number) => ItemSpawnerSpawnResult;
}

const DEFAULT_TOPG_URL = "https://topg.org/runescape-private-servers/";
const DEFAULT_RUNELIST_URL = "https://runelist.io/rsps-toplist/";
const DEFAULT_RULOCUS_URL = "https://www.rulocus.com/top-rsps-list/";
const DEFAULT_VOTE_REWARD_TEXT = "+X Vote Points per vote | Bonus chest +Y at 3/3";

const SCRIPT_STEELBORDER_NOCLOSE = 3737;
const SCRIPT_STONEBUTTON_INIT = 2424;
const SCRIPT_CREATE_V2_STONE_BUTTON_FILLED_FREE_ICON = 2979;
const SCRIPT_CC_GRAPHIC_SWAPPER = 229;
const SCRIPT_IF_FADE = 5843;

const STONEBUTTON_STYLE_OUTLINE = 0;
const STATUS_BUTTON_START_CHILD_INDEX = 0;
const STATUS_BUTTON_ICON_SUBID = 9;
const STATUS_BUTTON_WIDTH = 94;
const STATUS_BUTTON_HEIGHT = 26;
const STATUS_ICON_READY = 426; // rightarrow_small,0
const STATUS_ICON_COOLDOWN = 941; // warning_icons,1
const STATUS_ICON_VOTED = 1210; // tick,0
const STATUS_TEXT_COLOUR_READY = 0x40ff40;
const STATUS_TEXT_COLOUR_READY_HOVER = 0xb5ffb5;
const STATUS_TEXT_COLOUR_COOLDOWN = 0xffd15a;
const STATUS_TEXT_COLOUR_COOLDOWN_HOVER = 0xfff0b3;
const STATUS_TEXT_COLOUR_VOTED = 0x7de67d;
const STATUS_TEXT_COLOUR_VOTED_HOVER = 0xc7ffc7;
const SMITHING_BAR_OPTIONS: readonly SmithingBarOption[] = [
    {
        barType: 1,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE_TEXT,
        label: "Bronze",
    },
    {
        barType: 2,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON_TEXT,
        label: "Iron",
    },
    {
        barType: 3,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL_TEXT,
        label: "Steel",
    },
    {
        barType: 4,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL_TEXT,
        label: "Mithril",
    },
    {
        barType: 5,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT_TEXT,
        label: "Adamant",
    },
    {
        barType: 6,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE_TEXT,
        label: "Rune",
    },
    {
        barType: 7,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_TEXT,
        label: "Lovakite",
    },
] as const;
const PROGRESS_SEGMENT_COMPONENTS = [
    VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_1,
    VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_2,
    VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_3,
] as const;
const REWARD_TRAIL_COMPONENTS = [
    VOTE_MODAL_COMPONENT_REWARD_TRAIL_LEFT,
    VOTE_MODAL_COMPONENT_REWARD_TRAIL_CENTER,
    VOTE_MODAL_COMPONENT_REWARD_TRAIL_RIGHT,
] as const;
const REWARD_ICON_COMPONENTS = [
    VOTE_MODAL_COMPONENT_REWARD_ICON_COINS,
    VOTE_MODAL_COMPONENT_REWARD_ICON_CHEST,
    VOTE_MODAL_COMPONENT_REWARD_ICON_STARS,
] as const;

function normalizeVoteUrl(value: string | undefined, fallback: string): string {
    const trimmed = String(value ?? "").trim();
    if (trimmed.length === 0) return fallback;
    return trimmed;
}

function normalizeRewardText(value: string | undefined): string {
    const trimmed = String(value ?? "").trim();
    if (trimmed.length === 0) return DEFAULT_VOTE_REWARD_TEXT;
    return trimmed.replace(/^rewards?:\s*/i, "");
}

function formatRewardDisplayText(value: string | undefined): string {
    const normalized = normalizeRewardText(value);
    const rewardParts = normalized
        .split(/[|•]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

    let perVote = rewardParts[0] ?? "+X Vote Points per vote";
    let bonus = rewardParts[1] ?? "Bonus chest +Y at 3/3";

    if (!/vote/i.test(perVote)) {
        const amount = perVote.replace(/^\+/, "");
        perVote = `+${amount} Vote Points per vote`;
    }
    if (!/bonus/i.test(bonus)) {
        bonus = `Bonus ${bonus}`;
    }

    return `<col=ffcf70>Rewards:</col> <col=40ff40>${perVote}</col><br><col=ffd15a>${bonus}</col>`;
}

function getItemSpawnerSlotIndexFromIconComponent(componentId: number): number {
    return (componentId | 0) - ITEM_SPAWNER_MODAL_COMPONENT_SLOT_ICON_START;
}

/**
 * Reusable manager for custom CS2-driven modals mounted in mainmodal.
 */
export class Cs2ModalManager {
    private readonly activeVoteModalPlayers = new Set<number>();
    private readonly activeSmithingBarModalPlayers = new Set<number>();
    private readonly activeIndexedMenus = new Map<number, IndexedMenuState>();
    private readonly rewardPulseBrightPhaseByPlayer = new Map<number, boolean>();

    constructor(private readonly services: Cs2ModalManagerServices) {}

    openVoteModal(player: PlayerState): void {
        const playerId = player.id;
        this.activeVoteModalPlayers.add(playerId);
        this.services.openModal(player, VOTE_MODAL_GROUP_ID);
        this.applyVoteModalLayout(player);
        this.refreshVoteModalText(player);
    }

    openSmithingBarModal(player: PlayerState): void {
        const playerId = player.id;
        this.activeSmithingBarModalPlayers.add(playerId);
        this.services.openModal(player, SMITHING_BAR_MODAL_GROUP_ID);
        this.applySmithingBarModalLayout(player);
    }

    openItemSpawnerModal(player: PlayerState, query?: string): string {
        const normalizedQuery = this.normalizeItemSpawnerQuery(query);
        this.services.openModal(player, ITEM_SPAWNER_MODAL_GROUP_ID);
        this.applyItemSpawnerModalLayout(player);
        this.setWidgetTextInGroup(
            player.id,
            ITEM_SPAWNER_MODAL_GROUP_ID,
            ITEM_SPAWNER_MODAL_QUERY_COMPONENT,
            this.escapeWidgetText(normalizedQuery),
        );

        if (normalizedQuery.length === 0) {
            return "Item spawner opened. Type in the search bar to find cache items.";
        }
        return `Item spawner opened for "${normalizedQuery}".`;
    }

    updateItemSpawnerModalQuery(_player: PlayerState, _query: string): void {}

    openIndexedMenu(player: PlayerState, request: IndexedMenuRequest): void {
        const title = String(request.title ?? "").trim();
        const options = request.options
            .map((option) => String(option ?? "").trim())
            .filter((option) => option.length > 0);
        if (title.length === 0 || options.length === 0) {
            return;
        }

        const state: IndexedMenuState = {
            title,
            options,
            closeOnSelect: request.closeOnSelect !== false,
            onSelect: request.onSelect,
        };
        this.activeIndexedMenus.set(player.id, state);
        this.services.openModal(player, INDEXED_MENU_GROUP_ID);
        this.redrawIndexedMenu(player, state);
    }

    handleResumePauseButton(player: PlayerState, widgetId: number, childIndex: number): boolean {
        const state = this.activeIndexedMenus.get(player.id);
        if (!state) {
            return false;
        }

        const currentModal = this.services.getCurrentModal(player);
        if (currentModal !== INDEXED_MENU_GROUP_ID) {
            this.activeIndexedMenus.delete(player.id);
            return false;
        }

        const widgetGroup = (widgetId >>> 16) & 0xffff;
        const widgetComponent = widgetId & 0xffff;
        if (widgetGroup !== INDEXED_MENU_GROUP_ID) {
            return false;
        }
        if (widgetComponent !== INDEXED_MENU_LIST_COMPONENT_ID) {
            return false;
        }
        if (childIndex < 0 || childIndex >= state.options.length) {
            return false;
        }

        const optionIndex = childIndex | 0;
        const optionLabel = state.options[optionIndex] ?? "";
        if (state.closeOnSelect) {
            this.closeIndexedMenu(player);
        }
        state.onSelect?.(player, optionIndex, optionLabel);
        return true;
    }

    handleWidgetAction(
        player: PlayerState,
        groupId: number,
        componentId: number,
        option?: string,
        itemId?: number,
    ): boolean {
        const normalizedGroupId = groupId;
        if (normalizedGroupId === VOTE_MODAL_GROUP_ID) {
            return this.handleVoteModalAction(player, componentId, option);
        }
        if (normalizedGroupId === SMITHING_BAR_MODAL_GROUP_ID) {
            return this.handleSmithingBarModalAction(player, componentId, option);
        }
        if (normalizedGroupId === ITEM_SPAWNER_MODAL_GROUP_ID) {
            return this.handleItemSpawnerModalAction(player, componentId, option, itemId);
        }

        const playerId = player.id;
        const currentModal = this.services.getCurrentModal(player);
        if (currentModal !== VOTE_MODAL_GROUP_ID) {
            this.activeVoteModalPlayers.delete(playerId);
        }
        if (currentModal !== SMITHING_BAR_MODAL_GROUP_ID) {
            this.activeSmithingBarModalPlayers.delete(playerId);
        }
        if (currentModal !== INDEXED_MENU_GROUP_ID) {
            this.activeIndexedMenus.delete(playerId);
        }
        return false;
    }

    handleWidgetCloseState(player: PlayerState, groupId: number): void {
        if (groupId === VOTE_MODAL_GROUP_ID) {
            this.activeVoteModalPlayers.delete(player.id);
            return;
        }
        if (groupId === SMITHING_BAR_MODAL_GROUP_ID) {
            this.activeSmithingBarModalPlayers.delete(player.id);
            return;
        }
        if (groupId === INDEXED_MENU_GROUP_ID) {
            this.activeIndexedMenus.delete(player.id);
        }
    }

    clearPlayerState(player: PlayerState): void {
        const playerId = player.id;
        this.activeVoteModalPlayers.delete(playerId);
        this.activeSmithingBarModalPlayers.delete(playerId);
        this.activeIndexedMenus.delete(playerId);
        this.rewardPulseBrightPhaseByPlayer.delete(playerId);
    }

    private closeIndexedMenu(player: PlayerState): void {
        this.activeIndexedMenus.delete(player.id);
        if (this.services.getCurrentModal(player) === INDEXED_MENU_GROUP_ID) {
            this.services.closeModal(player);
        }
    }

    private redrawIndexedMenu(player: PlayerState, state: IndexedMenuState): void {
        this.services.queueWidgetEvent(player.id, {
            action: "run_script",
            scriptId: INDEXED_MENU_SCRIPT_ID,
            args: [state.title, state.options.join("|")],
        });
        this.services.queueWidgetEvent(player.id, {
            action: "set_flags_range",
            uid: INDEXED_MENU_LIST_UID,
            fromSlot: 0,
            toSlot: state.options.length - 1,
            flags: INDEXED_MENU_PAUSE_BUTTON_FLAGS,
        });
    }

    private handleVoteModalAction(
        player: PlayerState,
        componentId: number,
        option?: string,
    ): boolean {
        const playerId = player.id;
        if (!this.activeVoteModalPlayers.has(playerId)) {
            return false;
        }

        const component = componentId;
        if (component === VOTE_MODAL_COMPONENT_CLOSE_BUTTON || option === "Close") {
            this.closeVoteModal(player);
            return true;
        }

        const link = this.getVoteLinks().find(
            (entry) =>
                entry.rowComponentId === component ||
                entry.siteComponentId === component ||
                entry.statusComponentId === component,
        );
        if (!link) {
            return false;
        }

        const uiState = this.getVoteSiteUiState(player, link, Date.now());
        if (!uiState.canVote) {
            this.refreshVoteModalText(player);
            return true;
        }

        this.startVoteSiteCooldownForTesting(player, link.site, link.intervalSeconds);
        this.triggerRewardVisualPulse(playerId);
        this.sendGameMessage(
            player,
            `Test vote recorded for ${link.site}. Next vote in ${this.formatDuration(
                link.intervalSeconds * 1000,
            )}.`,
        );
        this.refreshVoteModalText(player);
        return true;
    }

    private handleSmithingBarModalAction(
        player: PlayerState,
        componentId: number,
        option?: string,
    ): boolean {
        const playerId = player.id;
        if (!this.activeSmithingBarModalPlayers.has(playerId)) {
            return false;
        }

        const component = componentId;
        if (component === SMITHING_BAR_MODAL_COMPONENT_CLOSE || option === "Close") {
            this.closeSmithingBarModal(player);
            return true;
        }

        const selected = SMITHING_BAR_OPTIONS.find(
            (entry) =>
                entry.buttonComponentId === component ||
                entry.iconComponentId === component ||
                entry.textComponentId === component,
        );
        if (!selected) {
            return false;
        }

        this.services.setSmithingBarType(player, selected.barType);
        this.activeSmithingBarModalPlayers.delete(playerId);
        this.services.closeModal(player);
        this.services.openSmithingForgeInterface(player);
        return true;
    }

    private handleItemSpawnerModalAction(
        player: PlayerState,
        componentId: number,
        option?: string,
        itemId?: number,
    ): boolean {
        if (
            componentId === ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND ||
            componentId === ITEM_SPAWNER_MODAL_QUERY_COMPONENT
        ) {
            return true;
        }

        if (componentId === ITEM_SPAWNER_MODAL_CLOSE_COMPONENT || option === "Close") {
            this.closeItemSpawnerModal(player);
            return true;
        }

        const slotIndex = getItemSpawnerSlotIndexFromIconComponent(componentId);
        if (slotIndex < 0) {
            return false;
        }

        const selectedItemId = typeof itemId === "number" ? itemId | 0 : -1;
        if (!(selectedItemId > 0)) {
            return true;
        }

        const spawnResult = this.services.spawnInventoryItem(player, selectedItemId, 1);
        if (spawnResult.completed < spawnResult.requested) {
            this.sendGameMessage(
                player,
                `Not enough inventory space to spawn ${spawnResult.itemName} (${selectedItemId}).`,
            );
            return true;
        }

        this.sendGameMessage(
            player,
            `Spawned ${spawnResult.itemName} (${selectedItemId}) x${spawnResult.completed}.`,
        );
        return true;
    }

    private applyVoteModalLayout(player: PlayerState): void {
        const playerId = player.id;

        this.runScript(playerId, SCRIPT_STEELBORDER_NOCLOSE, [
            this.getWidgetUid(VOTE_MODAL_COMPONENT_FRAME),
            "Vote Sites",
        ]);
        this.drawStoneButton(playerId, VOTE_MODAL_COMPONENT_CLOSE_BUTTON, "Close");

        this.setWidgetText(
            playerId,
            VOTE_MODAL_COMPONENT_TITLE,
            "<col=ffcf70>Daily Vote Rewards</col>",
        );
        this.setWidgetText(
            playerId,
            VOTE_MODAL_COMPONENT_BODY,
            "Click a site below, vote, and track your daily completion bonus.",
        );
        this.setWidgetText(
            playerId,
            VOTE_MODAL_COMPONENT_REWARD,
            formatRewardDisplayText(process.env.VOTE_REWARD_TEXT),
        );
        this.setWidgetText(playerId, VOTE_MODAL_COMPONENT_TIMER_HINT, "");
        this.setWidgetHidden(playerId, VOTE_MODAL_COMPONENT_TIMER_HINT, true);
        this.setWidgetHidden(playerId, VOTE_MODAL_COMPONENT_PROGRESS_TRACK, false);
        this.setWidgetText(
            playerId,
            VOTE_MODAL_COMPONENT_NOTE,
            "Vote links are posted in chat for safe copy and paste.",
        );
        this.triggerRewardVisualPulse(playerId);
    }

    private refreshVoteModalText(player: PlayerState): void {
        const playerId = player.id;
        const links = this.getVoteLinks();
        const nowMs = Date.now();

        let completedCount = 0;
        let hasCooldown = false;
        for (const link of links) {
            const uiState = this.getVoteSiteUiState(player, link, nowMs);
            if (uiState.completed) completedCount++;
            if (uiState.cooldown) hasCooldown = true;

            this.setWidgetText(
                playerId,
                link.siteComponentId,
                `<col=${uiState.siteColorTag}>${link.site}</col>`,
            );
            this.drawVoteSiteStatusButton(playerId, link, uiState);
        }

        if (hasCooldown) {
            this.setWidgetText(
                playerId,
                VOTE_MODAL_COMPONENT_TIMER_HINT,
                "Cooldown text shows when you can vote again.",
            );
            this.setWidgetHidden(playerId, VOTE_MODAL_COMPONENT_TIMER_HINT, false);
        } else {
            this.setWidgetText(playerId, VOTE_MODAL_COMPONENT_TIMER_HINT, "");
            this.setWidgetHidden(playerId, VOTE_MODAL_COMPONENT_TIMER_HINT, true);
        }

        const complete = completedCount >= links.length;
        const progressColorTag = complete ? "40ff40" : completedCount > 0 ? "ffd27f" : "e8ded0";
        this.setWidgetText(
            playerId,
            VOTE_MODAL_COMPONENT_PROGRESS_TEXT,
            `Vote Progress: <col=${progressColorTag}>${completedCount}/${links.length}</col>`,
        );
        for (let i = 0; i < PROGRESS_SEGMENT_COMPONENTS.length; i++) {
            const componentId = PROGRESS_SEGMENT_COMPONENTS[i];
            this.setWidgetHidden(playerId, componentId, i >= completedCount);
        }

        this.setWidgetHidden(playerId, VOTE_MODAL_COMPONENT_COMPLETION, !complete);
        if (complete) {
            this.setWidgetText(
                playerId,
                VOTE_MODAL_COMPONENT_COMPLETION,
                "All vote sites complete. Daily bonus unlocked.",
            );
        }
    }

    private applySmithingBarModalLayout(player: PlayerState): void {
        const playerId = player.id;
        this.runScript(playerId, SCRIPT_STEELBORDER_NOCLOSE, [
            this.getWidgetUidInGroup(
                SMITHING_BAR_MODAL_GROUP_ID,
                SMITHING_BAR_MODAL_COMPONENT_FRAME,
            ),
            "Select Bar",
        ]);
        this.drawStoneButtonInGroup(
            playerId,
            SMITHING_BAR_MODAL_GROUP_ID,
            SMITHING_BAR_MODAL_COMPONENT_CLOSE,
            "Close",
        );
        this.setWidgetTextInGroup(
            playerId,
            SMITHING_BAR_MODAL_GROUP_ID,
            SMITHING_BAR_MODAL_COMPONENT_TITLE,
            "<col=ffcf70>Select your smithing bar</col>",
        );
        this.setWidgetTextInGroup(
            playerId,
            SMITHING_BAR_MODAL_GROUP_ID,
            SMITHING_BAR_MODAL_COMPONENT_BODY,
            "Choose a metal type, then the anvil list updates to that bar.",
        );
    }

    private applyItemSpawnerModalLayout(player: PlayerState): void {
        const playerId = player.id;
        this.runScript(playerId, SCRIPT_STEELBORDER_NOCLOSE, [
            this.getWidgetUidInGroup(ITEM_SPAWNER_MODAL_GROUP_ID, ITEM_SPAWNER_MODAL_FRAME_COMPONENT),
            "Item Spawner",
        ]);
        this.drawStoneButtonInGroup(
            playerId,
            ITEM_SPAWNER_MODAL_GROUP_ID,
            ITEM_SPAWNER_MODAL_CLOSE_COMPONENT,
            "Close",
        );
        this.setWidgetHiddenInGroup(
            playerId,
            ITEM_SPAWNER_MODAL_GROUP_ID,
            ITEM_SPAWNER_MODAL_TITLE_COMPONENT,
            true,
        );
        this.setWidgetHiddenInGroup(
            playerId,
            ITEM_SPAWNER_MODAL_GROUP_ID,
            ITEM_SPAWNER_MODAL_BODY_COMPONENT,
            true,
        );
        this.setWidgetTextInGroup(
            playerId,
            ITEM_SPAWNER_MODAL_GROUP_ID,
            ITEM_SPAWNER_MODAL_TITLE_COMPONENT,
            "",
        );
        this.setWidgetTextInGroup(
            playerId,
            ITEM_SPAWNER_MODAL_GROUP_ID,
            ITEM_SPAWNER_MODAL_BODY_COMPONENT,
            "",
        );
        this.setWidgetTextInGroup(
            playerId,
            ITEM_SPAWNER_MODAL_GROUP_ID,
            ITEM_SPAWNER_MODAL_HELPER_COMPONENT,
            "<col=c5b79b>Type to search cache items.</col>",
        );
        this.setWidgetTextInGroup(
            playerId,
            ITEM_SPAWNER_MODAL_GROUP_ID,
            ITEM_SPAWNER_MODAL_SUMMARY_COMPONENT,
            "<col=c5b79b>Start typing to filter cache item names.</col>",
        );
    }

    private closeSmithingBarModal(player: PlayerState): void {
        const playerId = player.id;
        this.activeSmithingBarModalPlayers.delete(playerId);
        this.services.closeModal(player);
    }

    private closeItemSpawnerModal(player: PlayerState): void {
        this.services.closeModal(player);
    }

    private closeVoteModal(player: PlayerState): void {
        const playerId = player.id;
        this.activeVoteModalPlayers.delete(playerId);
        this.rewardPulseBrightPhaseByPlayer.delete(playerId);
        this.services.closeModal(player);
    }

    private getVoteLinks(): VoteLink[] {
        return [
            {
                site: "TopG",
                intervalSeconds: 6 * 60 * 60,
                url: normalizeVoteUrl(process.env.VOTE_URL_TOPG, DEFAULT_TOPG_URL),
                rowComponentId: VOTE_MODAL_COMPONENT_ROW_TOPG,
                siteComponentId: VOTE_MODAL_COMPONENT_SITE_TOPG,
                statusComponentId: VOTE_MODAL_COMPONENT_STATUS_TOPG,
            },
            {
                site: "RuneList",
                intervalSeconds: 12 * 60 * 60,
                url: normalizeVoteUrl(process.env.VOTE_URL_RUNELIST, DEFAULT_RUNELIST_URL),
                rowComponentId: VOTE_MODAL_COMPONENT_ROW_RUNELIST,
                siteComponentId: VOTE_MODAL_COMPONENT_SITE_RUNELIST,
                statusComponentId: VOTE_MODAL_COMPONENT_STATUS_RUNELIST,
            },
            {
                site: "RULOCUS",
                intervalSeconds: 12 * 60 * 60,
                url: normalizeVoteUrl(process.env.VOTE_URL_RULOCUS, DEFAULT_RULOCUS_URL),
                rowComponentId: VOTE_MODAL_COMPONENT_ROW_RULOCUS,
                siteComponentId: VOTE_MODAL_COMPONENT_SITE_RULOCUS,
                statusComponentId: VOTE_MODAL_COMPONENT_STATUS_RULOCUS,
            },
        ];
    }

    private getVoteSiteUiState(
        player: PlayerState,
        link: VoteLink,
        nowMs: number,
    ): VoteSiteUiState {
        const cooldownMs = this.getVoteCooldownRemainingMs(player, link.site, nowMs);
        if (cooldownMs > 0) {
            return {
                statusLabel: `In ${this.formatDuration(cooldownMs)}`,
                siteColorTag: "e8ded0",
                buttonTextColor: STATUS_TEXT_COLOUR_COOLDOWN,
                buttonHoverTextColor: STATUS_TEXT_COLOUR_COOLDOWN_HOVER,
                buttonPressed: true,
                statusIconGraphic: STATUS_ICON_COOLDOWN,
                completed: true,
                cooldown: true,
                canVote: false,
            };
        }

        if (this.isVoteSiteMarkedComplete(player, link.site)) {
            return {
                statusLabel: "Voted",
                siteColorTag: "e8ded0",
                buttonTextColor: STATUS_TEXT_COLOUR_VOTED,
                buttonHoverTextColor: STATUS_TEXT_COLOUR_VOTED_HOVER,
                buttonPressed: true,
                statusIconGraphic: STATUS_ICON_VOTED,
                completed: true,
                cooldown: false,
                canVote: false,
            };
        }

        return {
            statusLabel: "Vote",
            siteColorTag: "e8ded0",
            buttonTextColor: STATUS_TEXT_COLOUR_READY,
            buttonHoverTextColor: STATUS_TEXT_COLOUR_READY_HOVER,
            buttonPressed: false,
            statusIconGraphic: STATUS_ICON_READY,
            completed: false,
            cooldown: false,
            canVote: true,
        };
    }

    private getVoteCooldownRemainingMs(player: PlayerState, site: string, nowMs: number): number {
        const rawValue = this.getVoteSiteStateValue(player, site, [
            "__voteSiteCooldowns",
            "__voteCooldownBySite",
            "__voteSiteNextVoteAt",
            "__voteNextVoteAt",
        ]);
        if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
            return 0;
        }

        const value = rawValue > 0 ? Math.floor(rawValue) : 0;
        if (value <= 0) return 0;

        // Epoch ms timestamp
        if (value > 1_000_000_000_000) {
            return Math.max(0, value - nowMs);
        }
        // Epoch seconds timestamp
        if (value > 1_000_000_000) {
            return Math.max(0, value * 1000 - nowMs);
        }

        const maxDurationSeconds = 366 * 24 * 60 * 60;
        if (value <= maxDurationSeconds) {
            return value * 1000;
        }

        const maxDurationMs = maxDurationSeconds * 1000;
        if (value <= maxDurationMs) {
            return value;
        }

        return 0;
    }

    private formatDuration(durationMs: number): string {
        const totalSeconds = Math.max(1, Math.ceil(durationMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
            seconds,
        ).padStart(2, "0")}`;
    }

    private isVoteSiteMarkedComplete(player: PlayerState, site: string): boolean {
        const raw = this.getVoteSiteStateValue(player, site, ["__voteSiteStatus"]);
        return raw === true || raw === 1;
    }

    private startVoteSiteCooldownForTesting(
        player: PlayerState,
        site: string,
        intervalSeconds: number,
    ): void {
        const playerAny = player as any;
        const key = String(site ?? "").trim();
        const lowerKey = key.toLowerCase();
        const existing = playerAny.__voteSiteCooldowns;
        const expiresAtMs = Date.now() + Math.max(1, intervalSeconds) * 1000;

        if (existing instanceof Map) {
            existing.set(key, expiresAtMs);
            existing.set(lowerKey, expiresAtMs);
            return;
        }
        if (existing) {
            existing[key] = expiresAtMs;
            existing[lowerKey] = expiresAtMs;
            return;
        }

        playerAny.__voteSiteCooldowns = {
            [key]: expiresAtMs,
            [lowerKey]: expiresAtMs,
        };
    }

    private getVoteSiteStateValue(
        player: PlayerState,
        site: string,
        containerKeys: string[],
    ): unknown {
        const playerAny = player as any;
        const key = String(site ?? "").trim();
        const lowerKey = key.toLowerCase();

        for (const containerKey of containerKeys) {
            const container = playerAny?.[containerKey];
            if (!container) continue;

            if (container instanceof Map) {
                if (container.has(key)) return container.get(key);
                if (container.has(lowerKey)) return container.get(lowerKey);
                continue;
            }

            if (container) {
                const stateObj = container as Record<string, unknown>;
                if (Object.prototype.hasOwnProperty.call(stateObj, key)) {
                    return stateObj[key];
                }
                if (Object.prototype.hasOwnProperty.call(stateObj, lowerKey)) {
                    return stateObj[lowerKey];
                }
            }
        }

        return undefined;
    }

    private drawStoneButton(playerId: number, componentId: number, label: string): void {
        this.drawStoneButtonInGroup(playerId, VOTE_MODAL_GROUP_ID, componentId, label);
    }

    private drawStoneButtonInGroup(
        playerId: number,
        groupId: number,
        componentId: number,
        label: string,
    ): void {
        this.runScript(playerId, SCRIPT_STONEBUTTON_INIT, [
            this.getWidgetUidInGroup(groupId, componentId),
            FONT_BOLD_12,
            STONEBUTTON_STYLE_OUTLINE,
            label,
        ]);
    }

    private drawVoteSiteStatusButton(
        playerId: number,
        link: VoteLink,
        uiState: VoteSiteUiState,
    ): void {
        const statusUid = this.getWidgetUid(link.statusComponentId);
        this.runScript(playerId, SCRIPT_CREATE_V2_STONE_BUTTON_FILLED_FREE_ICON, [
            statusUid,
            STATUS_BUTTON_START_CHILD_INDEX,
            STATUS_BUTTON_WIDTH,
            STATUS_BUTTON_HEIGHT,
            0,
            0,
            uiState.statusLabel,
            uiState.buttonTextColor,
            uiState.buttonHoverTextColor,
            0,
            uiState.buttonPressed ? 1 : 0,
            uiState.statusIconGraphic,
        ]);
        this.runScript(playerId, SCRIPT_CC_GRAPHIC_SWAPPER, [
            statusUid,
            STATUS_BUTTON_ICON_SUBID,
            uiState.statusIconGraphic,
            statusUid,
        ]);
    }

    private triggerRewardVisualPulse(playerId: number): void {
        const brightPhase = !(this.rewardPulseBrightPhaseByPlayer.get(playerId) ?? false);
        this.rewardPulseBrightPhaseByPlayer.set(playerId, brightPhase);

        const iconTargetTrans = brightPhase ? 16 : 88;
        const iconStep = brightPhase ? -12 : 12;
        const trailTargetTransByIndex = brightPhase ? [140, 90, 150] : [220, 220, 220];
        const trailStep = brightPhase ? -14 : 10;

        for (const componentId of REWARD_ICON_COMPONENTS) {
            this.runScript(playerId, SCRIPT_IF_FADE, [
                this.getWidgetUid(componentId),
                iconTargetTrans,
                iconStep,
            ]);
        }
        for (let i = 0; i < REWARD_TRAIL_COMPONENTS.length; i++) {
            const componentId = REWARD_TRAIL_COMPONENTS[i];
            this.runScript(playerId, SCRIPT_IF_FADE, [
                this.getWidgetUid(componentId),
                trailTargetTransByIndex[i] ?? 220,
                trailStep,
            ]);
        }
    }

    private runScript(playerId: number, scriptId: number, args: Array<number | string>): void {
        this.services.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId: scriptId,
            args,
        });
    }

    private setWidgetText(playerId: number, componentId: number, text: string): void {
        this.setWidgetTextInGroup(playerId, VOTE_MODAL_GROUP_ID, componentId, text);
    }

    private setWidgetItemInGroup(
        playerId: number,
        groupId: number,
        componentId: number,
        itemId: number,
        quantity: number,
    ): void {
        this.services.queueWidgetEvent(playerId, {
            action: "set_item",
            uid: this.getWidgetUidInGroup(groupId, componentId),
            itemId: itemId | 0,
            quantity: Math.max(1, quantity | 0),
        });
    }

    private setWidgetTextInGroup(
        playerId: number,
        groupId: number,
        componentId: number,
        text: string,
    ): void {
        this.services.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: this.getWidgetUidInGroup(groupId, componentId),
            text: String(text ?? ""),
        });
    }

    private setWidgetHidden(playerId: number, componentId: number, hidden: boolean): void {
        this.services.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: this.getWidgetUid(componentId),
            hidden: !!hidden,
        });
    }

    private setWidgetHiddenInGroup(
        playerId: number,
        groupId: number,
        componentId: number,
        hidden: boolean,
    ): void {
        this.services.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: this.getWidgetUidInGroup(groupId, componentId),
            hidden: !!hidden,
        });
    }

    private normalizeItemSpawnerQuery(query: string | undefined): string {
        return String(query ?? "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private escapeWidgetText(value: string): string {
        return String(value ?? "").replace(/[<>]/g, "");
    }

    private getWidgetUid(componentId: number): number {
        return this.getWidgetUidInGroup(VOTE_MODAL_GROUP_ID, componentId);
    }

    private getWidgetUidInGroup(groupId: number, componentId: number): number {
        return ((groupId & 0xffff) << 16) | (componentId & 0xffff);
    }

    private sendGameMessage(player: PlayerState, text: string): void {
        const trimmed = String(text ?? "").trim();
        if (trimmed.length === 0) return;
        this.services.queueGameMessage(player.id, trimmed);
    }
}

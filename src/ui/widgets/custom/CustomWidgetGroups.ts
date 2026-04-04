import {
    VOTE_MODAL_COMPONENT_ACTION_PANEL,
    VOTE_MODAL_COMPONENT_BODY,
    VOTE_MODAL_COMPONENT_CLOSE_BUTTON,
    VOTE_MODAL_COMPONENT_COMPLETION,
    VOTE_MODAL_COMPONENT_FRAME,
    VOTE_MODAL_COMPONENT_INFO_PANEL,
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
    VOTE_MODAL_COMPONENT_ROOT,
    VOTE_MODAL_COMPONENT_ROW_RULOCUS,
    VOTE_MODAL_COMPONENT_ROW_RUNELIST,
    VOTE_MODAL_COMPONENT_ROW_TOPG,
    VOTE_MODAL_COMPONENT_SITE_PANEL,
    VOTE_MODAL_COMPONENT_SITE_RULOCUS,
    VOTE_MODAL_COMPONENT_SITE_RUNELIST,
    VOTE_MODAL_COMPONENT_SITE_TOPG,
    VOTE_MODAL_COMPONENT_STATUS_RULOCUS,
    VOTE_MODAL_COMPONENT_STATUS_RUNELIST,
    VOTE_MODAL_COMPONENT_STATUS_TOPG,
    VOTE_MODAL_COMPONENT_TIMER_HINT,
    VOTE_MODAL_COMPONENT_TITLE,
    VOTE_MODAL_GROUP_ID,
} from "../../../shared/ui/voteModal";
import { getDynamicWidgetGroup } from "../../../shared/gamemode/GamemodeContentStore";
import { SMITHING_BAR_MODAL_GROUP_ID } from "../../../shared/ui/widgets";
import { FONT_BOLD_12, FONT_PLAIN_11 } from "../../fonts";
import { FLAG_TRANSMIT_OP1 } from "../WidgetFlags";
import type { WidgetNode } from "../WidgetNode";
import { buildSmithingBarModalGroup } from "./smithing.cs2";

type WidgetGroupLoadResult = { root: WidgetNode | undefined; widgets: Map<number, WidgetNode> };

function voteModalUid(componentId: number): number {
    return ((VOTE_MODAL_GROUP_ID & 0xffff) << 16) | (componentId & 0xffff);
}

function baseWidget(
    componentId: number,
    parentUid: number,
    overrides: Partial<WidgetNode>,
): WidgetNode {
    const uid = voteModalUid(componentId);
    return {
        uid,
        id: uid,
        childIndex: -1,
        parentUid,
        groupId: VOTE_MODAL_GROUP_ID,
        fileId: componentId | 0,
        isIf3: true,
        type: 0,
        contentType: 0,
        rawX: 0,
        rawY: 0,
        rawWidth: 0,
        rawHeight: 0,
        widthMode: 0,
        heightMode: 0,
        xPositionMode: 0,
        yPositionMode: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        scrollX: 0,
        scrollY: 0,
        scrollWidth: 0,
        scrollHeight: 0,
        isHidden: false,
        hidden: false,
        cachedHidden: false,
        rootIndex: -1,
        cycle: -1,
        modelFrame: 0,
        modelFrameCycle: 0,
        aspectWidth: 1,
        aspectHeight: 1,
        itemId: -1,
        itemQuantity: 0,
        ...overrides,
    };
}

function buildVoteModalGroup(): WidgetGroupLoadResult {
    const widgets = new Map<number, WidgetNode>();
    const rootUid = voteModalUid(VOTE_MODAL_COMPONENT_ROOT);

    const root = baseWidget(VOTE_MODAL_COMPONENT_ROOT, -1, {
        type: 0,
        rawX: 0,
        rawY: 0,
        rawWidth: 18,
        rawHeight: 18,
        widthMode: 1,
        heightMode: 1,
        width: 500,
        height: 320,
        scrollWidth: 0,
        scrollHeight: 0,
        xPositionMode: 1,
        yPositionMode: 1,
    });
    widgets.set(root.uid, root);

    const frame = baseWidget(VOTE_MODAL_COMPONENT_FRAME, rootUid, {
        type: 0,
        rawX: 0,
        rawY: 0,
        rawWidth: 0,
        rawHeight: 0,
        widthMode: 1,
        heightMode: 1,
        width: 500,
        height: 320,
        scrollWidth: 0,
        scrollHeight: 0,
    });
    widgets.set(frame.uid, frame);

    const infoPanel = baseWidget(VOTE_MODAL_COMPONENT_INFO_PANEL, rootUid, {
        type: 3,
        rawX: 40,
        rawY: 150,
        rawWidth: 420,
        rawHeight: 1,
        width: 420,
        height: 1,
        filled: true,
        color: 0x6e5b3b,
        textColor: 0x6e5b3b,
        opacity: 0,
    });
    widgets.set(infoPanel.uid, infoPanel);

    const sitePanel = baseWidget(VOTE_MODAL_COMPONENT_SITE_PANEL, rootUid, {
        type: 0,
        rawX: 22,
        rawY: 160,
        rawWidth: 44,
        rawHeight: 84,
        widthMode: 1,
        yPositionMode: 0,
        width: 456,
        height: 84,
        scrollWidth: 0,
        scrollHeight: 0,
    });
    widgets.set(sitePanel.uid, sitePanel);

    const actionPanel = baseWidget(VOTE_MODAL_COMPONENT_ACTION_PANEL, rootUid, {
        type: 0,
        rawX: 22,
        rawY: 20,
        rawWidth: 44,
        rawHeight: 62,
        widthMode: 1,
        yPositionMode: 2,
        width: 456,
        height: 62,
        scrollWidth: 0,
        scrollHeight: 0,
    });
    widgets.set(actionPanel.uid, actionPanel);

    const title = baseWidget(VOTE_MODAL_COMPONENT_TITLE, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 52,
        rawWidth: 68,
        rawHeight: 18,
        widthMode: 1,
        width: 388,
        height: 18,
        text: "",
        fontId: FONT_BOLD_12,
        textColor: 0xffd27f,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
    });
    widgets.set(title.uid, title);

    const body = baseWidget(VOTE_MODAL_COMPONENT_BODY, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 72,
        rawWidth: 68,
        rawHeight: 34,
        widthMode: 1,
        width: 388,
        height: 34,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xe8ded0,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 0,
        lineHeight: 14,
    });
    widgets.set(body.uid, body);

    const reward = baseWidget(VOTE_MODAL_COMPONENT_REWARD, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 94,
        rawWidth: 68,
        rawHeight: 30,
        widthMode: 1,
        width: 388,
        height: 30,
        text: "",
        fontId: FONT_BOLD_12,
        textColor: 0xffd27f,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 0,
        lineHeight: 14,
    });
    widgets.set(reward.uid, reward);

    const rewardIconCoins = baseWidget(VOTE_MODAL_COMPONENT_REWARD_ICON_COINS, rootUid, {
        type: 5,
        rawX: 176,
        rawY: 108,
        rawWidth: 16,
        rawHeight: 16,
        width: 16,
        height: 16,
        spriteId: 431, // coins,0
        spriteId2: -1,
        opacity: 88,
        isHidden: false,
        hidden: false,
    });
    widgets.set(rewardIconCoins.uid, rewardIconCoins);

    const rewardIconChest = baseWidget(VOTE_MODAL_COMPONENT_REWARD_ICON_CHEST, rootUid, {
        type: 5,
        rawX: 232,
        rawY: 106,
        rawWidth: 20,
        rawHeight: 20,
        width: 20,
        height: 20,
        spriteId: 430, // chest,0
        spriteId2: -1,
        opacity: 88,
        isHidden: false,
        hidden: false,
    });
    widgets.set(rewardIconChest.uid, rewardIconChest);

    const rewardIconStars = baseWidget(VOTE_MODAL_COMPONENT_REWARD_ICON_STARS, rootUid, {
        type: 5,
        rawX: 304,
        rawY: 108,
        rawWidth: 16,
        rawHeight: 16,
        width: 16,
        height: 16,
        spriteId: 479, // stars,0
        spriteId2: -1,
        opacity: 88,
        isHidden: false,
        hidden: false,
    });
    widgets.set(rewardIconStars.uid, rewardIconStars);

    const rewardTrailLeft = baseWidget(VOTE_MODAL_COMPONENT_REWARD_TRAIL_LEFT, rootUid, {
        type: 5,
        rawX: 154,
        rawY: 111,
        rawWidth: 12,
        rawHeight: 12,
        width: 12,
        height: 12,
        spriteId: 479, // stars,0
        spriteId2: -1,
        opacity: 220,
        isHidden: false,
        hidden: false,
    });
    widgets.set(rewardTrailLeft.uid, rewardTrailLeft);

    const rewardTrailCenter = baseWidget(VOTE_MODAL_COMPONENT_REWARD_TRAIL_CENTER, rootUid, {
        type: 5,
        rawX: 258,
        rawY: 111,
        rawWidth: 12,
        rawHeight: 12,
        width: 12,
        height: 12,
        spriteId: 479, // stars,0
        spriteId2: -1,
        opacity: 220,
        isHidden: false,
        hidden: false,
    });
    widgets.set(rewardTrailCenter.uid, rewardTrailCenter);

    const rewardTrailRight = baseWidget(VOTE_MODAL_COMPONENT_REWARD_TRAIL_RIGHT, rootUid, {
        type: 5,
        rawX: 328,
        rawY: 111,
        rawWidth: 12,
        rawHeight: 12,
        width: 12,
        height: 12,
        spriteId: 479, // stars,0
        spriteId2: -1,
        opacity: 220,
        isHidden: false,
        hidden: false,
    });
    widgets.set(rewardTrailRight.uid, rewardTrailRight);

    const topgRow = baseWidget(VOTE_MODAL_COMPONENT_ROW_TOPG, sitePanel.uid, {
        type: 3,
        rawX: 18,
        rawY: 0,
        rawWidth: 400,
        rawHeight: 26,
        width: 400,
        height: 26,
        filled: true,
        color: 0x241e16,
        mouseOverColor: 0x3a3022,
        textColor: 0x241e16,
        opacity: 48,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(topgRow.uid, topgRow);

    const runelistRow = baseWidget(VOTE_MODAL_COMPONENT_ROW_RUNELIST, sitePanel.uid, {
        type: 3,
        rawX: 18,
        rawY: 28,
        rawWidth: 400,
        rawHeight: 26,
        width: 400,
        height: 26,
        filled: true,
        color: 0x241e16,
        mouseOverColor: 0x3a3022,
        textColor: 0x241e16,
        opacity: 48,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(runelistRow.uid, runelistRow);

    const rulocusRow = baseWidget(VOTE_MODAL_COMPONENT_ROW_RULOCUS, sitePanel.uid, {
        type: 3,
        rawX: 18,
        rawY: 56,
        rawWidth: 400,
        rawHeight: 26,
        width: 400,
        height: 26,
        filled: true,
        color: 0x241e16,
        mouseOverColor: 0x3a3022,
        textColor: 0x241e16,
        opacity: 48,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(rulocusRow.uid, rulocusRow);

    const topg = baseWidget(VOTE_MODAL_COMPONENT_SITE_TOPG, rootUid, {
        type: 4,
        rawX: 56,
        rawY: 164,
        rawWidth: 220,
        rawHeight: 18,
        widthMode: 0,
        yPositionMode: 0,
        width: 220,
        height: 18,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xe8ded0,
        mouseOverColor: 0xffffff,
        textShadowed: true,
        xTextAlignment: 0,
        yTextAlignment: 1,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(topg.uid, topg);

    const topgStatus = baseWidget(VOTE_MODAL_COMPONENT_STATUS_TOPG, rootUid, {
        type: 0,
        rawX: 338,
        rawY: 160,
        rawWidth: 94,
        rawHeight: 26,
        widthMode: 0,
        yPositionMode: 0,
        width: 94,
        height: 26,
        scrollWidth: 0,
        scrollHeight: 0,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(topgStatus.uid, topgStatus);

    const runelist = baseWidget(VOTE_MODAL_COMPONENT_SITE_RUNELIST, rootUid, {
        type: 4,
        rawX: 56,
        rawY: 192,
        rawWidth: 220,
        rawHeight: 18,
        widthMode: 0,
        yPositionMode: 0,
        width: 220,
        height: 18,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xe8ded0,
        mouseOverColor: 0xffffff,
        textShadowed: true,
        xTextAlignment: 0,
        yTextAlignment: 1,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(runelist.uid, runelist);

    const runelistStatus = baseWidget(VOTE_MODAL_COMPONENT_STATUS_RUNELIST, rootUid, {
        type: 0,
        rawX: 338,
        rawY: 188,
        rawWidth: 94,
        rawHeight: 26,
        widthMode: 0,
        yPositionMode: 0,
        width: 94,
        height: 26,
        scrollWidth: 0,
        scrollHeight: 0,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(runelistStatus.uid, runelistStatus);

    const rulocus = baseWidget(VOTE_MODAL_COMPONENT_SITE_RULOCUS, rootUid, {
        type: 4,
        rawX: 56,
        rawY: 220,
        rawWidth: 220,
        rawHeight: 18,
        widthMode: 0,
        yPositionMode: 0,
        width: 220,
        height: 18,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xe8ded0,
        mouseOverColor: 0xffffff,
        textShadowed: true,
        xTextAlignment: 0,
        yTextAlignment: 1,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(rulocus.uid, rulocus);

    const rulocusStatus = baseWidget(VOTE_MODAL_COMPONENT_STATUS_RULOCUS, rootUid, {
        type: 0,
        rawX: 338,
        rawY: 216,
        rawWidth: 94,
        rawHeight: 26,
        widthMode: 0,
        yPositionMode: 0,
        width: 94,
        height: 26,
        scrollWidth: 0,
        scrollHeight: 0,
        actions: ["Open Link"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(rulocusStatus.uid, rulocusStatus);

    const timerHint = baseWidget(VOTE_MODAL_COMPONENT_TIMER_HINT, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 248,
        rawWidth: 68,
        rawHeight: 14,
        widthMode: 1,
        yPositionMode: 0,
        width: 388,
        height: 14,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xc5b79b,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
    });
    widgets.set(timerHint.uid, timerHint);

    const note = baseWidget(VOTE_MODAL_COMPONENT_NOTE, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 262,
        rawWidth: 68,
        rawHeight: 14,
        widthMode: 1,
        yPositionMode: 0,
        width: 388,
        height: 14,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xb8aa8d,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
    });
    widgets.set(note.uid, note);

    const progressText = baseWidget(VOTE_MODAL_COMPONENT_PROGRESS_TEXT, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 130,
        rawWidth: 68,
        rawHeight: 14,
        widthMode: 1,
        yPositionMode: 0,
        width: 388,
        height: 14,
        text: "",
        fontId: FONT_BOLD_12,
        textColor: 0xffd27f,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
    });
    widgets.set(progressText.uid, progressText);

    const progressTrack = baseWidget(VOTE_MODAL_COMPONENT_PROGRESS_TRACK, rootUid, {
        type: 3,
        rawX: 0,
        rawY: 146,
        rawWidth: 246,
        rawHeight: 10,
        xPositionMode: 1,
        yPositionMode: 0,
        width: 246,
        height: 10,
        filled: false,
        color: 0x8f7f66,
        textColor: 0x8f7f66,
        opacity: 0,
    });
    widgets.set(progressTrack.uid, progressTrack);

    const segment1 = baseWidget(VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_1, rootUid, {
        type: 3,
        rawX: -81,
        rawY: 148,
        rawWidth: 74,
        rawHeight: 6,
        xPositionMode: 1,
        yPositionMode: 0,
        width: 74,
        height: 6,
        filled: true,
        color: 0x4ec45e,
        textColor: 0x4ec45e,
        opacity: 0,
        isHidden: false,
        hidden: false,
    });
    widgets.set(segment1.uid, segment1);

    const segment2 = baseWidget(VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_2, rootUid, {
        type: 3,
        rawX: 0,
        rawY: 148,
        rawWidth: 74,
        rawHeight: 6,
        xPositionMode: 1,
        yPositionMode: 0,
        width: 74,
        height: 6,
        filled: true,
        color: 0x4ec45e,
        textColor: 0x4ec45e,
        opacity: 0,
        isHidden: false,
        hidden: false,
    });
    widgets.set(segment2.uid, segment2);

    const segment3 = baseWidget(VOTE_MODAL_COMPONENT_PROGRESS_SEGMENT_3, rootUid, {
        type: 3,
        rawX: 81,
        rawY: 148,
        rawWidth: 74,
        rawHeight: 6,
        xPositionMode: 1,
        yPositionMode: 0,
        width: 74,
        height: 6,
        filled: true,
        color: 0x4ec45e,
        textColor: 0x4ec45e,
        opacity: 0,
        isHidden: false,
        hidden: false,
    });
    widgets.set(segment3.uid, segment3);

    const closeButton = baseWidget(VOTE_MODAL_COMPONENT_CLOSE_BUTTON, rootUid, {
        type: 0,
        rawX: 0,
        rawY: 20,
        rawWidth: 118,
        rawHeight: 30,
        xPositionMode: 1,
        yPositionMode: 2,
        width: 118,
        height: 30,
        scrollWidth: 0,
        scrollHeight: 0,
        actions: ["Close"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(closeButton.uid, closeButton);

    const completion = baseWidget(VOTE_MODAL_COMPONENT_COMPLETION, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 54,
        rawWidth: 68,
        rawHeight: 14,
        widthMode: 1,
        yPositionMode: 2,
        width: 388,
        height: 14,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0x40ff40,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
    });
    widgets.set(completion.uid, completion);

    return { root, widgets };
}

export function loadCustomWidgetGroup(groupId: number): WidgetGroupLoadResult | undefined {
    if ((groupId | 0) === VOTE_MODAL_GROUP_ID) {
        return buildVoteModalGroup();
    }
    if ((groupId | 0) === SMITHING_BAR_MODAL_GROUP_ID) {
        return buildSmithingBarModalGroup();
    }
    // Check dynamically loaded widgets (from GAMEMODE_DATA)
    const dynamic = getDynamicWidgetGroup(groupId);
    if (dynamic) {
        return dynamic as WidgetGroupLoadResult;
    }
    return undefined;
}

import {
    ITEM_SPAWNER_MODAL_COMPONENT_BODY,
    ITEM_SPAWNER_MODAL_COMPONENT_CLOSE,
    ITEM_SPAWNER_MODAL_COMPONENT_FRAME,
    ITEM_SPAWNER_MODAL_COMPONENT_HELPER,
    ITEM_SPAWNER_MODAL_COMPONENT_QUERY,
    ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_SCROLLBAR,
    ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_VIEW,
    ITEM_SPAWNER_MODAL_COMPONENT_ROOT,
    ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND,
    ITEM_SPAWNER_MODAL_COMPONENT_SLOT_BACKGROUND_START,
    ITEM_SPAWNER_MODAL_COMPONENT_SLOT_ICON_START,
    ITEM_SPAWNER_MODAL_COMPONENT_SUMMARY,
    ITEM_SPAWNER_MODAL_COMPONENT_TITLE,
    ITEM_SPAWNER_MODAL_GROUP_ID,
    ITEM_SPAWNER_MODAL_RESULT_SLOT_COUNT,
    ITEM_SPAWNER_MODAL_SLOT_COLUMNS,
} from "../../../shared/ui/widgets";
import { FONT_BOLD_12, FONT_PLAIN_11 } from "../../fonts";
import { FLAG_TRANSMIT_OP1 } from "../WidgetFlags";
import type { WidgetNode } from "../WidgetNode";

const ITEM_SPAWNER_MODAL_WIDTH = 520;
const ITEM_SPAWNER_MODAL_HEIGHT = 412;
const ITEM_SPAWNER_SLOT_BACKGROUND_WIDTH = 40;
const ITEM_SPAWNER_SLOT_BACKGROUND_HEIGHT = 36;
const ITEM_SPAWNER_SLOT_ICON_WIDTH = 36;
const ITEM_SPAWNER_SLOT_ICON_HEIGHT = 32;
const ITEM_SPAWNER_SLOT_PITCH_X = 40;
const ITEM_SPAWNER_SLOT_PITCH_Y = 44;
const ITEM_SPAWNER_RESULTS_VIEW_RAW_X = 34;
const ITEM_SPAWNER_RESULTS_VIEW_RAW_Y = 94;
const ITEM_SPAWNER_RESULTS_VIEW_WIDTH = 432;
const ITEM_SPAWNER_RESULTS_VIEW_HEIGHT = 140;
const ITEM_SPAWNER_RESULTS_SCROLLBAR_RAW_X = 470;
const ITEM_SPAWNER_RESULTS_SCROLLBAR_RAW_Y = ITEM_SPAWNER_RESULTS_VIEW_RAW_Y;
const ITEM_SPAWNER_RESULTS_SCROLLBAR_WIDTH = 16;
const ITEM_SPAWNER_RESULTS_SCROLLBAR_HEIGHT = ITEM_SPAWNER_RESULTS_VIEW_HEIGHT;
const ITEM_SPAWNER_SLOT_BACKGROUND_START_RAW_X = 56;
const ITEM_SPAWNER_SLOT_ICON_START_RAW_X = 58;
const ITEM_SPAWNER_SLOT_BACKGROUND_START_RAW_Y = 0;
const ITEM_SPAWNER_SLOT_ICON_START_RAW_Y = 2;

export type WidgetGroupLoadResult = {
    root: WidgetNode | undefined;
    widgets: Map<number, WidgetNode>;
};

function itemSpawnerUid(componentId: number): number {
    return ((ITEM_SPAWNER_MODAL_GROUP_ID & 0xffff) << 16) | (componentId & 0xffff);
}

function itemSpawnerWidget(
    componentId: number,
    parentUid: number,
    overrides: Partial<WidgetNode>,
): WidgetNode {
    const uid = itemSpawnerUid(componentId);
    return {
        uid,
        id: uid,
        childIndex: -1,
        parentUid,
        groupId: ITEM_SPAWNER_MODAL_GROUP_ID,
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

export function buildItemSpawnerModalGroup(): WidgetGroupLoadResult {
    const widgets = new Map<number, WidgetNode>();
    const rootUid = itemSpawnerUid(ITEM_SPAWNER_MODAL_COMPONENT_ROOT);

    const root = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_ROOT, -1, {
        type: 0,
        rawX: 0,
        rawY: 0,
        rawWidth: 18,
        rawHeight: 18,
        widthMode: 1,
        heightMode: 1,
        width: ITEM_SPAWNER_MODAL_WIDTH,
        height: ITEM_SPAWNER_MODAL_HEIGHT,
        scrollWidth: 0,
        scrollHeight: 0,
        xPositionMode: 1,
        yPositionMode: 1,
    });
    widgets.set(root.uid, root);

    const frame = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_FRAME, rootUid, {
        type: 0,
        rawX: 0,
        rawY: 0,
        rawWidth: 0,
        rawHeight: 0,
        widthMode: 1,
        heightMode: 1,
        width: ITEM_SPAWNER_MODAL_WIDTH,
        height: ITEM_SPAWNER_MODAL_HEIGHT,
        scrollWidth: 0,
        scrollHeight: 0,
    });
    widgets.set(frame.uid, frame);

    const title = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_TITLE, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 62,
        rawWidth: 68,
        rawHeight: 20,
        widthMode: 1,
        width: 452,
        height: 20,
        text: "",
        fontId: FONT_BOLD_12,
        textColor: 0xffd27f,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
        isHidden: true,
        hidden: true,
    });
    widgets.set(title.uid, title);

    const body = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_BODY, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 86,
        rawWidth: 68,
        rawHeight: 16,
        widthMode: 1,
        width: 452,
        height: 16,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xe8ded0,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
        isHidden: true,
        hidden: true,
    });
    widgets.set(body.uid, body);

    const searchBackground = itemSpawnerWidget(
        ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND,
        rootUid,
        {
            type: 3,
            rawX: 34,
            rawY: 42,
            rawWidth: 68,
            rawHeight: 24,
            widthMode: 1,
            width: 452,
            height: 24,
            filled: true,
            color: 0x2b241b,
            mouseOverColor: 0x342b20,
            textColor: 0x2b241b,
            opacity: 32,
            actions: ["Edit"],
            flags: FLAG_TRANSMIT_OP1,
        },
    );
    widgets.set(searchBackground.uid, searchBackground);

    const query = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_QUERY, rootUid, {
        type: 4,
        rawX: 44,
        rawY: 46,
        rawWidth: 58,
        rawHeight: 16,
        widthMode: 1,
        width: 432,
        height: 16,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xe8ded0,
        textShadowed: true,
        xTextAlignment: 0,
        yTextAlignment: 1,
        actions: ["Edit"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(query.uid, query);

    const helper = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_HELPER, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 24,
        rawWidth: 68,
        rawHeight: 16,
        widthMode: 1,
        width: 452,
        height: 16,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xc5b79b,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
    });
    widgets.set(helper.uid, helper);

    const summary = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_SUMMARY, rootUid, {
        type: 4,
        rawX: 34,
        rawY: 70,
        rawWidth: 68,
        rawHeight: 16,
        widthMode: 1,
        width: 452,
        height: 16,
        text: "",
        fontId: FONT_PLAIN_11,
        textColor: 0xc5b79b,
        textShadowed: true,
        xTextAlignment: 1,
        yTextAlignment: 1,
    });
    widgets.set(summary.uid, summary);

    const resultsView = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_VIEW, rootUid, {
        type: 0,
        rawX: ITEM_SPAWNER_RESULTS_VIEW_RAW_X,
        rawY: ITEM_SPAWNER_RESULTS_VIEW_RAW_Y,
        rawWidth: ITEM_SPAWNER_RESULTS_VIEW_WIDTH,
        rawHeight: ITEM_SPAWNER_RESULTS_VIEW_HEIGHT,
        width: ITEM_SPAWNER_RESULTS_VIEW_WIDTH,
        height: ITEM_SPAWNER_RESULTS_VIEW_HEIGHT,
        scrollX: 0,
        scrollY: 0,
        scrollWidth: ITEM_SPAWNER_RESULTS_VIEW_WIDTH,
        scrollHeight: ITEM_SPAWNER_RESULTS_VIEW_HEIGHT,
    });
    widgets.set(resultsView.uid, resultsView);

    const scrollbar = itemSpawnerWidget(
        ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_SCROLLBAR,
        rootUid,
        {
            type: 0,
            rawX: ITEM_SPAWNER_RESULTS_SCROLLBAR_RAW_X,
            rawY: ITEM_SPAWNER_RESULTS_SCROLLBAR_RAW_Y,
            rawWidth: ITEM_SPAWNER_RESULTS_SCROLLBAR_WIDTH,
            rawHeight: ITEM_SPAWNER_RESULTS_SCROLLBAR_HEIGHT,
            width: ITEM_SPAWNER_RESULTS_SCROLLBAR_WIDTH,
            height: ITEM_SPAWNER_RESULTS_SCROLLBAR_HEIGHT,
            scrollWidth: 0,
            scrollHeight: 0,
            noClickThrough: true,
        },
    );
    widgets.set(scrollbar.uid, scrollbar);

    for (let slotIndex = 0; slotIndex < ITEM_SPAWNER_MODAL_RESULT_SLOT_COUNT; slotIndex++) {
        const column = slotIndex % ITEM_SPAWNER_MODAL_SLOT_COLUMNS;
        const row = Math.floor(slotIndex / ITEM_SPAWNER_MODAL_SLOT_COLUMNS);
        const backgroundRawX =
            ITEM_SPAWNER_SLOT_BACKGROUND_START_RAW_X + column * ITEM_SPAWNER_SLOT_PITCH_X;
        const iconRawX = ITEM_SPAWNER_SLOT_ICON_START_RAW_X + column * ITEM_SPAWNER_SLOT_PITCH_X;
        const backgroundRawY =
            ITEM_SPAWNER_SLOT_BACKGROUND_START_RAW_Y + row * ITEM_SPAWNER_SLOT_PITCH_Y;
        const iconRawY = ITEM_SPAWNER_SLOT_ICON_START_RAW_Y + row * ITEM_SPAWNER_SLOT_PITCH_Y;

        const background = itemSpawnerWidget(
            ITEM_SPAWNER_MODAL_COMPONENT_SLOT_BACKGROUND_START + slotIndex,
            resultsView.uid,
            {
                type: 3,
                rawX: backgroundRawX,
                rawY: backgroundRawY,
                rawWidth: ITEM_SPAWNER_SLOT_BACKGROUND_WIDTH,
                rawHeight: ITEM_SPAWNER_SLOT_BACKGROUND_HEIGHT,
                width: ITEM_SPAWNER_SLOT_BACKGROUND_WIDTH,
                height: ITEM_SPAWNER_SLOT_BACKGROUND_HEIGHT,
                filled: true,
                color: 0x241e16,
                mouseOverColor: 0x241e16,
                textColor: 0x241e16,
                opacity: 64,
                isHidden: true,
                hidden: true,
            },
        );
        widgets.set(background.uid, background);

        const icon = itemSpawnerWidget(
            ITEM_SPAWNER_MODAL_COMPONENT_SLOT_ICON_START + slotIndex,
            resultsView.uid,
            {
                type: 5,
                rawX: iconRawX,
                rawY: iconRawY,
                rawWidth: ITEM_SPAWNER_SLOT_ICON_WIDTH,
                rawHeight: ITEM_SPAWNER_SLOT_ICON_HEIGHT,
                width: ITEM_SPAWNER_SLOT_ICON_WIDTH,
                height: ITEM_SPAWNER_SLOT_ICON_HEIGHT,
                itemQuantityMode: 2,
                borderType: 1,
                graphicShadow: 0x333333,
                shadowColor: 0x333333,
                text: "",
                actions: ["Spawn"],
                flags: FLAG_TRANSMIT_OP1,
                isHidden: true,
                hidden: true,
            },
        );
        widgets.set(icon.uid, icon);
    }

    const closeButton = itemSpawnerWidget(ITEM_SPAWNER_MODAL_COMPONENT_CLOSE, rootUid, {
        type: 0,
        rawX: 0,
        rawY: 24,
        rawWidth: 110,
        rawHeight: 30,
        xPositionMode: 1,
        yPositionMode: 2,
        width: 110,
        height: 30,
        scrollWidth: 0,
        scrollHeight: 0,
        actions: ["Close"],
        flags: FLAG_TRANSMIT_OP1,
    });
    widgets.set(closeButton.uid, closeButton);

    return { root, widgets };
}

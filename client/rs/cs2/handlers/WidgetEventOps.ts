/**
 * Widget event handler operations: CC_SETON* and IF_SETON*
 */
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

/**
 * Get the target widget for CC_SETON* operations based on intOp.
 * In OSRS, when intOp=1, the "dot" variant (.cc_seton*) is used, which operates on dotWidget.
 * When intOp=0, the regular variant (cc_seton*) is used, which operates on activeWidget.
 */
function getTargetWidget(ctx: any, intOp: number): any {
    return intOp === 1 ? ctx.dotWidget : ctx.activeWidget;
}

export function registerWidgetEventOps(handlers: HandlerMap): void {
    // === CC_SETON* (target widget based on intOp) ===
    // intOp=0: use activeWidget (cc_seton*)
    // intOp=1: use dotWidget (.cc_seton*)
    handlers.set(Opcodes.CC_SETONCLICK, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onClick");
    });

    handlers.set(Opcodes.CC_SETONHOLD, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onHold");
    });

    handlers.set(Opcodes.CC_SETONRELEASE, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onRelease");
    });

    handlers.set(Opcodes.CC_SETONMOUSEOVER, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onMouseOver");
    });

    handlers.set(Opcodes.CC_SETONMOUSELEAVE, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onMouseLeave");
    });

    handlers.set(Opcodes.CC_SETONDRAG, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onDrag");
    });

    handlers.set(Opcodes.CC_SETONTARGETLEAVE, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onTargetLeave");
    });

    handlers.set(Opcodes.CC_SETONVARTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onVarTransmit");
    });

    handlers.set(Opcodes.CC_SETONTIMER, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onTimer");
    });

    handlers.set(Opcodes.CC_SETONOP, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onOp");
    });

    handlers.set(Opcodes.CC_SETONDRAGCOMPLETE, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onDragComplete");
    });

    handlers.set(Opcodes.CC_SETONCLICKREPEAT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onClickRepeat");
    });

    handlers.set(Opcodes.CC_SETONMOUSEREPEAT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onMouseRepeat");
    });

    handlers.set(Opcodes.CC_SETONINVTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onInvTransmit");
    });

    handlers.set(Opcodes.CC_SETONSTATTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onStatTransmit");
    });

    handlers.set(Opcodes.CC_SETONTARGETENTER, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onTargetEnter");
    });

    // CC_SETONSCROLLWHEEL sets onScroll handler (not onScrollWheel)
    // The "wheel" in the opcode name refers to the trigger (mouse wheel), but
    // internally OSRS stores this as "onScroll"
    handlers.set(Opcodes.CC_SETONSCROLLWHEEL, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onScroll");
    });

    handlers.set(Opcodes.CC_SETONCHATTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onChatTransmit");
    });

    handlers.set(Opcodes.CC_SETONKEY, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onKey");
    });

    handlers.set(Opcodes.CC_SETONFRIENDTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onFriendTransmit");
    });

    handlers.set(Opcodes.CC_SETONCLANTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onClanTransmit");
    });

    handlers.set(Opcodes.CC_SETONMISCTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onMiscTransmit");
    });

    handlers.set(Opcodes.CC_SETONDIALOGABORT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onDialogAbort");
    });

    handlers.set(Opcodes.CC_SETONSUBCHANGE, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onSubChange");
    });

    handlers.set(Opcodes.CC_SETONSTOCKTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onStockTransmit");
    });

    handlers.set(Opcodes.CC_SETONRESIZE, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onResize");
    });

    handlers.set(Opcodes.CC_SETONCLANSETTINGSTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onClanSettingsTransmit");
    });

    handlers.set(Opcodes.CC_SETONCLANCHANNELTRANSMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onClanChannelTransmit");
    });

    handlers.set(Opcodes.CC_SETONITEMONITEM, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onItemOnItem");
    });

    handlers.set(Opcodes.CC_SETONCLANSETTINGS, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onClanSettings");
    });

    handlers.set(Opcodes.CC_SETONMAPPOST, (ctx, intOp) => {
        // Clue helper / world map overlay hooks use this. We don't currently trigger it,
        // but we MUST parse and store (or clear) the listener to keep stacks in sync.
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onMapPost");
    });

    handlers.set(Opcodes.CC_INPUT_SETONSUBMIT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onInputSubmit");
    });

    handlers.set(Opcodes.CC_INPUT_SETONABORT, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onInputAbort");
    });

    handlers.set(Opcodes.CC_INPUT_SETONFOCUSCHANGED, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onInputFocusChanged");
    });

    handlers.set(Opcodes.CC_INPUT_SETONUPDATE, (ctx, intOp) => {
        ctx.setEventHandler(getTargetWidget(ctx, intOp), "onInputUpdate");
    });

    // === IF_SETON* (widget UID on stack) ===
    handlers.set(Opcodes.IF_SETONCLICK, (ctx) => {
        ctx.setEventHandlerByUid("onClick");
    });

    handlers.set(Opcodes.IF_SETONHOLD, (ctx) => {
        ctx.setEventHandlerByUid("onHold");
    });

    handlers.set(Opcodes.IF_SETONRELEASE, (ctx) => {
        ctx.setEventHandlerByUid("onRelease");
    });

    handlers.set(Opcodes.IF_SETONMOUSEOVER, (ctx) => {
        ctx.setEventHandlerByUid("onMouseOver");
    });

    handlers.set(Opcodes.IF_SETONMOUSELEAVE, (ctx) => {
        ctx.setEventHandlerByUid("onMouseLeave");
    });

    handlers.set(Opcodes.IF_SETONDRAG, (ctx) => {
        ctx.setEventHandlerByUid("onDrag");
    });

    handlers.set(Opcodes.IF_SETONTARGETLEAVE, (ctx) => {
        ctx.setEventHandlerByUid("onTargetLeave");
    });

    handlers.set(Opcodes.IF_SETONVARTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onVarTransmit");
    });

    handlers.set(Opcodes.IF_SETONTIMER, (ctx) => {
        ctx.setEventHandlerByUid("onTimer");
    });

    handlers.set(Opcodes.IF_SETONOP, (ctx) => {
        ctx.setEventHandlerByUid("onOp");
    });

    handlers.set(Opcodes.IF_SETONDRAGCOMPLETE, (ctx) => {
        ctx.setEventHandlerByUid("onDragComplete");
    });

    handlers.set(Opcodes.IF_SETONCLICKREPEAT, (ctx) => {
        ctx.setEventHandlerByUid("onClickRepeat");
    });

    handlers.set(Opcodes.IF_SETONMOUSEREPEAT, (ctx) => {
        ctx.setEventHandlerByUid("onMouseRepeat");
    });

    handlers.set(Opcodes.IF_SETONINVTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onInvTransmit");
    });

    handlers.set(Opcodes.IF_SETONSTATTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onStatTransmit");
    });

    handlers.set(Opcodes.IF_SETONTARGETENTER, (ctx) => {
        ctx.setEventHandlerByUid("onTargetEnter");
    });

    // IF_SETONSCROLLWHEEL sets onScroll handler (not onScrollWheel)
    handlers.set(Opcodes.IF_SETONSCROLLWHEEL, (ctx) => {
        ctx.setEventHandlerByUid("onScroll");
    });

    handlers.set(Opcodes.IF_SETONCHATTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onChatTransmit");
    });

    handlers.set(Opcodes.IF_SETONKEY, (ctx) => {
        ctx.setEventHandlerByUid("onKey");
    });

    handlers.set(Opcodes.IF_SETONFRIENDTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onFriendTransmit");
    });

    handlers.set(Opcodes.IF_SETONCLANTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onClanTransmit");
    });

    handlers.set(Opcodes.IF_SETONMISCTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onMiscTransmit");
    });

    handlers.set(Opcodes.IF_SETONDIALOGABORT, (ctx) => {
        ctx.setEventHandlerByUid("onDialogAbort");
    });

    handlers.set(Opcodes.IF_SETONSUBCHANGE, (ctx) => {
        ctx.setEventHandlerByUid("onSubChange");
    });

    handlers.set(Opcodes.IF_SETONSTOCKTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onStockTransmit");
    });

    handlers.set(Opcodes.IF_SETONRESIZE, (ctx) => {
        ctx.setEventHandlerByUid("onResize");
    });

    handlers.set(Opcodes.IF_SETONCLANSETTINGSTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onClanSettingsTransmit");
    });

    handlers.set(Opcodes.IF_SETONCLANCHANNELTRANSMIT, (ctx) => {
        ctx.setEventHandlerByUid("onClanChannelTransmit");
    });

    handlers.set(Opcodes.IF_SETONITEMONITEM, (ctx) => {
        ctx.setEventHandlerByUid("onItemOnItem");
    });

    handlers.set(Opcodes.IF_SETONCLANSETTINGS, (ctx) => {
        ctx.setEventHandlerByUid("onClanSettings");
    });

    handlers.set(Opcodes.IF_SETONMAPPOST, (ctx) => {
        ctx.setEventHandlerByUid("onMapPost");
    });

    handlers.set(Opcodes.IF_INPUT_SETONSUBMIT, (ctx) => {
        ctx.setEventHandlerByUid("onInputSubmit");
    });

    handlers.set(Opcodes.IF_INPUT_SETONABORT, (ctx) => {
        ctx.setEventHandlerByUid("onInputAbort");
    });

    handlers.set(Opcodes.IF_INPUT_SETONFOCUSCHANGED, (ctx) => {
        ctx.setEventHandlerByUid("onInputFocusChanged");
    });

    handlers.set(Opcodes.IF_INPUT_SETONUPDATE, (ctx) => {
        ctx.setEventHandlerByUid("onInputUpdate");
    });
}

import { chatHistory } from "./ChatHistory";

const reads = new WeakMap<object, number>();
const rows = new WeakMap<object, number>();

/** Script 84 rebuilds native chat rows. Retain the UID it reads, not just its display text. */
export function recordNativeChatRead(vm: object, scriptId: number | undefined, uid: number): void {
    if (scriptId === 84) reads.set(vm, uid);
}

/** Native onOp listeners include chat type/name but omit message UID. Keep that identity alongside the widget. */
export function bindNativeChatRow(vm: object, scriptId: number | undefined, widget: any): void {
    if (!widget || ((widget.groupId ?? (widget.uid >>> 16)) | 0) !== 162) return;
    const uid = scriptId === 84 ? reads.get(vm) : undefined;
    const listener = widget.onOp ?? widget.eventHandlers?.onOp;
    if (uid !== undefined && listener && chatHistory.getByUid(uid)) rows.set(widget, uid);
    else rows.delete(widget);
}

export function getNativeChatRowUid(widget: unknown): number | undefined {
    if (!widget || typeof widget !== "object") return undefined;
    const uid = rows.get(widget);
    return uid !== undefined && chatHistory.getByUid(uid) ? uid : undefined;
}

import { CacheIndex } from "../../rs/cache/CacheIndex";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { ByteBuffer } from "../../rs/io/ByteBuffer";
import { FONT_BOLD_12, FONT_PLAIN_11 } from "../fonts";
import { loadCustomWidgetGroup } from "./custom/CustomWidgetGroups";
import { markWidgetInteractionDirty } from "./WidgetInteraction";

/**
 * Widget/interface loader for OSRS cache
 * Uses the decoding logic from toolkit/src/widgets.ts
 */
export class WidgetLoader {
    private cache: CacheSystem;
    private interfacesIndex?: CacheIndex;
    private loadedWidgets: Map<number, any> = new Map();

    /**
     * Clear the widget cache to force fresh loading
     * Useful when code changes require re-decoding widgets
     */
    clearCache(): void {
        this.loadedWidgets.clear();
    }

    constructor(cache: CacheSystem) {
        this.cache = cache;
        try {
            this.interfacesIndex = cache.getIndex(IndexType.DAT2.interfaces);
        } catch (e) {
            console.warn("Interfaces index not available:", e);
        }
    }

    /**
     * Get a list of available widget group IDs
     */
    getAvailableGroups(): number[] {
        if (!this.interfacesIndex) return [];
        try {
            const archiveIds = this.interfacesIndex.getArchiveIds();
            return Array.from(archiveIds || []);
        } catch {
            return [];
        }
    }

    /**
     * Create a demo widget root for testing
     * This creates a simple container with some test widgets
     */
    static createDemoWidgetRoot(): any {
        return {
            uid: 1,
            groupId: 0,
            fileId: 0,
            type: 0, // Container
            x: 100,
            y: 100,
            width: 400,
            height: 300,
            hidden: false,
            children: [
                // Background rectangle
                {
                    uid: 2,
                    type: 3, // Rectangle
                    x: 0,
                    y: 0,
                    width: 400,
                    height: 300,
                    textColor: 0x3f3f3f,
                    opacity: 200,
                    filled: true,
                },
                // Title text
                {
                    uid: 3,
                    type: 4, // Text
                    x: 10,
                    y: 10,
                    width: 380,
                    height: 30,
                    text: "Widget System Demo",
                    fontId: FONT_BOLD_12,
                    textColor: 0xffffff,
                    textShadowed: true,
                    xTextAlignment: 1, // Center
                    yTextAlignment: 1, // Center
                },
                // Some inventory slots (2x2 grid)
                {
                    uid: 4,
                    type: 2, // Inventory
                    x: 10,
                    y: 50,
                    width: 64,
                    height: 64,
                    gridColumns: 2,
                    gridRows: 2,
                    gridXPitch: 32,
                    gridYPitch: 32,
                },
                // Info text
                {
                    uid: 5,
                    type: 4, // Text
                    x: 10,
                    y: 120,
                    width: 380,
                    height: 170,
                    text: "This is a demonstration of the widget rendering system.\n\nThe widgets-gl renderer has been integrated into the WebGL Game Client.",
                    fontId: FONT_PLAIN_11,
                    textColor: 0xcccccc,
                    textShadowed: false,
                    xTextAlignment: 0, // Left
                    yTextAlignment: 0, // Top
                },
            ],
        };
    }

    /**
     * Decode a widget from raw data (IF1 or IF3 format)
     */
    private decodeWidget(uid: number, data: Int8Array): any | undefined {
        if (!data || data.length === 0) return undefined;
        const first = data[0] & 0xff;
        if (first === 0xff) return this.decodeIf3(uid, data);
        return this.decodeIf1(uid, data);
    }

    /**
     * Decode IF1 format widget (legacy format)
     */
    private decodeIf1(uid: number, data: Int8Array): any {
        const buf = new ByteBuffer(data);
        const groupId = (uid >>> 16) & 0xffff;
        const fileId = uid & 0xffff;

        const type = buf.readUnsignedByte();
        const buttonType = buf.readUnsignedByte();
        const contentType = buf.readUnsignedShort();
        const rawX = buf.readShort();
        const rawY = buf.readShort();
        const rawWidth = buf.readUnsignedShort();
        const rawHeight = buf.readUnsignedShort();
        const opacity = buf.readUnsignedByte();

        let parentId = buf.readUnsignedShort();
        if (parentId === 0xffff) parentId = -1;
        else parentId += uid & ~0xffff;

        let mouseOverRedirect = buf.readUnsignedShort();
        if (mouseOverRedirect === 0xffff) mouseOverRedirect = -1;

        const w: any = {
            uid,
            // id is the packed (groupId<<16)|fileId identifier.
            // childIndex is -1 for static widgets loaded from cache.
            // Only dynamic widgets (CC_CREATE) have childIndex set to their slot index (>= 0).
            id: uid,
            childIndex: -1,
            groupId,
            fileId,
            isIf3: false,
            type,
            buttonType,
            contentType,
            rawX,
            rawY,
            rawWidth,
            rawHeight,
            x: rawX,
            y: rawY,
            width: rawWidth,
            height: rawHeight,
            parentUid: parentId,
            hidden: false,
            cachedHidden: false, // IF1 non-container widgets default to visible
            opacity,
            mouseOverRedirect,
            // Initialize runtime state fields
            rootIndex: -1,
            cycle: -1,
            modelFrame: 0,
            modelFrameCycle: 0,
            aspectWidth: 1,
            aspectHeight: 1,
            scrollX: 0,
            scrollY: 0,
            scrollWidth: 0,
            scrollHeight: 0,
            itemId: -1,
            itemQuantity: 0,
        };

        // CS1 Comparisons
        const cs1CompCount = buf.readUnsignedByte();
        if (cs1CompCount > 0) {
            w.cs1Comparisons = new Int8Array(cs1CompCount);
            w.cs1ComparisonValues = new Int32Array(cs1CompCount);
            for (let i = 0; i < cs1CompCount; i++) {
                w.cs1Comparisons[i] = buf.readUnsignedByte();
                w.cs1ComparisonValues[i] = buf.readUnsignedShort();
            }
        }

        // CS1 Instructions
        const cs1InstrCount = buf.readUnsignedByte();
        if (cs1InstrCount > 0) {
            w.cs1Instructions = [];
            for (let i = 0; i < cs1InstrCount; i++) {
                const len = buf.readUnsignedShort();
                const instrs = new Int32Array(len);
                for (let j = 0; j < len; j++) {
                    let val = buf.readUnsignedShort();
                    if (val === 0xffff) val = -1;
                    instrs[j] = val;
                }
                w.cs1Instructions.push(instrs);
            }
        }

        if (type === 0) {
            w.scrollHeight = buf.readUnsignedShort();
            w.hidden = buf.readUnsignedByte() === 1;
            w.isHidden = w.hidden; // BUGFIX: Sync isHidden for render visibility checks
            w.cachedHidden = w.hidden; // Store original for fallback when scripts change it
            const count = buf.readUnsignedShort();
            w.rawChildren = [];
            for (let i = 0; i < count; i++) {
                const childId = buf.readUnsignedShort();
                const childX = buf.readShort();
                const childY = buf.readShort();
                w.rawChildren.push({ id: childId, x: childX, y: childY });
            }
        }

        if (type === 1) {
            buf.readUnsignedShort(); // unused
            buf.readUnsignedByte(); // unused
        }

        if (type === 3) {
            w.filled = buf.readUnsignedByte() === 1;
        }

        if (type === 4 || type === 1) {
            w.xTextAlignment = buf.readUnsignedByte();
            w.yTextAlignment = buf.readUnsignedByte();
            w.lineHeight = buf.readUnsignedByte();
            let fontId = buf.readUnsignedShort();
            w.fontId = fontId === 0xffff ? -1 : fontId;
            w.textShadowed = buf.readUnsignedByte() === 1;
        }

        if (type === 4) {
            w.text = buf.readString();
            w.text2 = buf.readString();
        }

        if (type === 1 || type === 3 || type === 4) {
            w.textColor = buf.readInt();
            // this is Widget.color (used for both text and rectangle widgets)
            w.color = w.textColor;
        }

        if (type === 3 || type === 4) {
            w.color2 = buf.readInt();
            w.mouseOverColor = buf.readInt();
            w.mouseOverColor2 = buf.readInt();
        }

        if (type === 5) {
            w.spriteId = buf.readInt();
            w.spriteId2 = buf.readInt();
        }

        if (type === 6) {
            w.modelType = 1;
            w.modelId = buf.readInt();

            w.modelId2 = buf.readInt();

            let seqId = buf.readUnsignedShort();
            w.sequenceId = seqId === 0xffff ? -1 : seqId;

            let seqId2 = buf.readUnsignedShort();
            w.sequenceId2 = seqId2 === 0xffff ? -1 : seqId2;

            w.modelZoom = buf.readUnsignedShort();
            w.rotationX = buf.readUnsignedShort();
            w.rotationY = buf.readUnsignedShort();
            // CS2 parity: model angles alias the cached rotation fields
            w.modelAngleX = w.rotationX;
            w.modelAngleY = w.rotationY;
            w.modelAngleZ = w.rotationZ ?? 0;
        }

        if (type === 8) {
            w.text = buf.readString();
        }

        if (buttonType === 2) {
            w.spellActionName = buf.readString();
            w.spellTargetName = buf.readString();
            const flags = buf.readUnsignedShort() & 0x3f;
            w.flags = (w.flags || 0) | (flags << 11);
        }

        if (buttonType === 1 || buttonType === 4 || buttonType === 5 || buttonType === 6) {
            w.buttonText = buf.readString();
            if (!w.buttonText) {
                if (buttonType === 1) w.buttonText = "Ok";
                else if (buttonType === 4) w.buttonText = "Select";
                else if (buttonType === 5) w.buttonText = "Select";
                else if (buttonType === 6) w.buttonText = "Continue";
            }
        }

        // Legacy flags logic
        if (buttonType === 1 || buttonType === 4 || buttonType === 5) {
            w.flags = (w.flags || 0) | 0x400000;
        }
        if (buttonType === 6) {
            w.flags = (w.flags || 0) | 1;
        }

        markWidgetInteractionDirty(w);
        return w;
    }

    /**
     * Decode IF3 format widget (modern format)
     */
    private decodeIf3(uid: number, data: Int8Array): any {
        const buf = new ByteBuffer(data);
        buf.readByte(); // skip version marker
        const groupId = (uid >>> 16) & 0xffff;
        const fileId = uid & 0xffff;
        const type = buf.readByte();
        const contentType = buf.readUnsignedShort();
        const rawX = buf.readShort();
        const rawY = buf.readShort();
        const rawWidth = buf.readUnsignedShort();
        const rawHeight = type === 9 ? buf.readShort() : buf.readUnsignedShort();
        const widthMode = buf.readByte();
        const heightMode = buf.readByte();
        const xPositionMode = buf.readByte();
        const yPositionMode = buf.readByte();
        let parentId = buf.readUnsignedShort();
        if (parentId === 0xffff) parentId = -1;
        else parentId += uid & ~0xffff;
        const hidden = buf.readUnsignedByte() === 1;

        const w: any = {
            uid,
            // id is the packed (groupId<<16)|fileId identifier.
            // childIndex is -1 for static widgets loaded from cache.
            // Only dynamic widgets (CC_CREATE) have childIndex set to their slot index (>= 0).
            id: uid,
            childIndex: -1,
            groupId,
            fileId,
            isIf3: true,
            type,
            contentType,
            rawX,
            rawY,
            rawWidth,
            rawHeight,
            x: 0,
            y: 0,
            width: rawWidth,
            height: rawHeight,
            widthMode,
            heightMode,
            xPositionMode,
            yPositionMode,
            parentUid: parentId,
            hidden,
            isHidden: hidden, // BUGFIX: Sync isHidden for render visibility checks
            cachedHidden: hidden, // Store original for fallback when scripts change it
            // Initialize runtime state fields
            rootIndex: -1,
            cycle: -1,
            modelFrame: 0,
            modelFrameCycle: 0,
            aspectWidth: 1,
            aspectHeight: 1,
            scrollX: 0,
            scrollY: 0,
            scrollWidth: 0,
            scrollHeight: 0,
            itemId: -1,
            itemQuantity: 0,
        };

        // Type-specific decoding (MUST come before listeners)
        if (type === 0) {
            w.scrollWidth = buf.readUnsignedShort();
            w.scrollHeight = buf.readUnsignedShort();
            w.noClickThrough = buf.readUnsignedByte() === 1;
        } else if (type === 5) {
            // OSRS IF3 type-5 widgets store their active sprite in spriteId.
            w.spriteId = buf.readInt();
            w.spriteAngle = buf.readUnsignedShort();
            w.spriteTiling = buf.readUnsignedByte() === 1;
            w.opacity = buf.readUnsignedByte();
            w.borderType = buf.readUnsignedByte();
            w.graphicShadow = buf.readInt();
            w.shadowColor = w.graphicShadow;
            w.flippedV = buf.readUnsignedByte() === 1;
            w.flippedH = buf.readUnsignedByte() === 1;
        } else if (type === 6) {
            w.modelId = buf.readInt();
            w.modelOffsetX = buf.readShort();
            w.modelOffsetY = buf.readShort();
            w.rotationX = buf.readUnsignedShort();
            w.rotationY = buf.readUnsignedShort();
            w.rotationZ = buf.readUnsignedShort();
            w.modelZoom = buf.readUnsignedShort();
            // CS2 parity: modelAngle* opcodes operate on the same values as cached rotations.
            w.modelAngleX = w.rotationX;
            w.modelAngleY = w.rotationY;
            w.modelAngleZ = w.rotationZ;
            let seqId = buf.readUnsignedShort();
            w.sequenceId = seqId === 0xffff ? -1 : seqId;
            w.modelOrthog = buf.readUnsignedByte() === 1;
            buf.readUnsignedShort(); // unknown
            if (widthMode !== 0) {
                buf.readUnsignedShort(); // unused
            }
            if (heightMode !== 0) {
                buf.readUnsignedShort(); // unknown
            }
        } else if (type === 4) {
            let fontId = buf.readUnsignedShort();
            w.fontId = fontId === 0xffff ? -1 : fontId;
            w.text = buf.readString();
            w.lineHeight = buf.readUnsignedByte();
            w.xTextAlignment = buf.readUnsignedByte();
            w.yTextAlignment = buf.readUnsignedByte();
            w.textShadowed = buf.readUnsignedByte() === 1;
            w.textColor = buf.readInt();
            w.color = w.textColor;
        } else if (type === 3) {
            w.textColor = buf.readInt();
            w.color = w.textColor;
            w.filled = buf.readUnsignedByte() === 1;
            w.opacity = buf.readUnsignedByte();
        } else if (type === 9) {
            w.lineWidth = buf.readUnsignedByte();
            w.textColor = buf.readInt();
            w.color = w.textColor;
            w.lineDirection = buf.readUnsignedByte() === 1;
        }

        // Flags, actions, and misc
        w.flags = buf.readMedium();
        // Extract targetMask from flags (bits 11-16) - used by CS2 if_gettargetmask
        // This determines if a widget can be used in targeting mode (e.g., spell targeting)
        w.targetMask = (w.flags >> 11) & 0x3f;
        w.dataText = buf.readString();
        const actionCount = buf.readUnsignedByte();
        if (actionCount > 0) {
            w.actions = [];
            for (let i = 0; i < actionCount; i++) {
                w.actions.push(buf.readString());
            }
        }
        w.dragZoneSize = buf.readUnsignedByte();
        w.dragThreshold = buf.readUnsignedByte();
        w.isScrollBar = buf.readUnsignedByte() === 1;
        w.spellActionName = buf.readString();
        // Set targetVerb from spellActionName if targetMask is set
        // This enables spell/item targeting mode when the widget is clicked
        if (w.targetMask > 0 && w.spellActionName && w.spellActionName.trim().length > 0) {
            w.targetVerb = w.spellActionName;
        }

        // Read all listeners in fixed order (this is how OSRS does it)
        w.onLoad = this.readListener(buf);
        w.onMouseOver = this.readListener(buf);
        w.onMouseLeave = this.readListener(buf);
        w.onTargetLeave = this.readListener(buf);
        w.onTargetEnter = this.readListener(buf);
        w.onVarTransmit = this.readListener(buf);
        w.onInvTransmit = this.readListener(buf);
        w.onStatTransmit = this.readListener(buf);
        w.onTimer = this.readListener(buf);
        w.onOp = this.readListener(buf);
        w.onMouseRepeat = this.readListener(buf);
        w.onClick = this.readListener(buf);
        w.onClickRepeat = this.readListener(buf);
        w.onRelease = this.readListener(buf);
        w.onHold = this.readListener(buf);
        w.onDrag = this.readListener(buf);
        w.onDragComplete = this.readListener(buf);
        w.onScroll = this.readListener(buf);
        w.varTransmitTriggers = this.readTriggers(buf);
        w.invTransmitTriggers = this.readTriggers(buf);
        w.statTransmitTriggers = this.readTriggers(buf);

        // Track if widget originally had click handlers from cache
        // These flags persist even if CS2 scripts clear the handlers later
        w.__hasOriginalOnOp = w.onOp !== null && w.onOp !== undefined;
        w.__hasOriginalOnClick = w.onClick !== null && w.onClick !== undefined;
        w.__hasOriginalOnHold = w.onHold !== null && w.onHold !== undefined;
        w.__hasOriginalOnRelease = w.onRelease !== null && w.onRelease !== undefined;

        // Set hasListener flag (like OSRS) - true if any listener was read from cache
        w.hasListener = !!(
            w.onLoad ||
            w.onMouseOver ||
            w.onMouseLeave ||
            w.onTargetLeave ||
            w.onTargetEnter ||
            w.onVarTransmit ||
            w.onInvTransmit ||
            w.onStatTransmit ||
            w.onTimer ||
            w.onOp ||
            w.onMouseRepeat ||
            w.onClick ||
            w.onClickRepeat ||
            w.onRelease ||
            w.onHold ||
            w.onDrag ||
            w.onDragComplete ||
            w.onScroll
        );

        markWidgetInteractionDirty(w);
        return w;
    }

    /**
     * Read a listener (script args array) from buffer
     */
    private readListener(buf: ByteBuffer): any[] | null {
        const count = buf.readUnsignedByte();
        if (count === 0) return null;
        const args: any[] = new Array(count);
        for (let i = 0; i < count; i++) {
            const type = buf.readUnsignedByte();
            if (type === 0) {
                args[i] = buf.readInt();
            } else if (type === 1) {
                args[i] = buf.readString();
            }
        }
        return args;
    }

    /**
     * Read trigger IDs array from buffer
     */
    private readTriggers(buf: ByteBuffer): number[] | null {
        const count = buf.readUnsignedByte();
        if (count === 0) return null;
        const triggers: number[] = new Array(count);
        for (let i = 0; i < count; i++) {
            triggers[i] = buf.readInt();
        }
        return triggers;
    }

    /**
     * Load a widget group from cache
     */
    loadWidgetGroup(
        groupId: number,
    ): { root: any | undefined; widgets: Map<number, any> } | undefined {
        try {
            // Check if we've already loaded this group
            const cached = this.loadedWidgets.get(groupId << 16);
            if (cached) return cached;

            // Local custom interfaces (not present in cache archives)
            const custom = loadCustomWidgetGroup(groupId | 0);
            if (custom) {
                this.loadedWidgets.set(groupId << 16, custom);
                return custom;
            }

            if (!this.interfacesIndex) {
                return undefined;
            }

            // Load all widgets in the group
            const widgets = new Map<number, any>();
            const fileIds = this.interfacesIndex.getFileIds(groupId);

            if (!fileIds || fileIds.length === 0) {
                return undefined;
            }

            // Decode each widget file
            for (const fileId of fileIds) {
                try {
                    const file = this.interfacesIndex.getFile(groupId, fileId);
                    if (!file) {
                        continue;
                    }

                    const uid = (groupId << 16) | (fileId & 0xffff);
                    const widget = this.decodeWidget(uid, file.data);

                    if (widget) {
                        widgets.set(uid, widget);
                    }
                } catch (e) {
                    // Skip malformed widget
                    console.error(`[WidgetLoader] Failed to decode widget ${groupId}:${fileId}`, e);
                    continue;
                }
            }

            // IF3 widgets: DO NOT populate children array during loading
            // In OSRS, children array is ONLY for dynamically created widgets via CC_CREATE
            // Static parent-child relationships are determined by parentUid field
            // The renderer will iterate all widgets and filter by parentUid to find children
            // (This matches OSRS updateInterface which iterates Widget[] and filters by parentId)

            // IF1: Link children defined in Type 0 containers and apply positioning
            for (const w of widgets.values()) {
                if (!w.isIf3 && w.type === 0 && w.rawChildren) {
                    if (!w.children) w.children = [];
                    for (const rc of w.rawChildren) {
                        const childUid = (groupId << 16) | (rc.id & 0xffff);
                        const child = widgets.get(childUid);
                        if (child) {
                            // IF1 parents control child position
                            child.x = rc.x;
                            child.y = rc.y;
                            child.parentUid = w.uid;

                            // Avoid duplicates if already linked via parentUid
                            if (!w.children.includes(child)) {
                                w.children.push(child);
                            }
                        }
                    }
                }
            }

            // Children order comes from cache structure and CC_CREATE at runtime
            // No sorting needed - the natural order should be correct for 
            // (Previously sorted by fileId which caused background to render on top of foreground)

            // Find root widget (parentUid === -1)
            // In OSRS, there can be multiple root widgets per interface group
            // The main root (fileId=0) is returned, and all roots are stored in the widgets map
            let root = undefined;
            for (const w of widgets.values()) {
                if (w.parentUid === -1) {
                    // Prefer fileId 0 as the main root
                    if (w.fileId === 0) {
                        root = w;
                        break;
                    }
                    // Fall back to first root found
                    if (!root) {
                        root = w;
                    }
                }
            }

            const result = { root, widgets };

            // Cache the result for future use
            if (root || widgets.size > 0) {
                this.loadedWidgets.set(groupId << 16, result);
            }

            return result;
        } catch (e) {
            console.error(`Failed to load widget group ${groupId}:`, e);
            return undefined;
        }
    }
}

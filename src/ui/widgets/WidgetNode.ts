/** Event handler stored on a widget */
export interface WidgetEventHandler {
    scriptId: number;
    intArgs: number[];
    objectArgs: any[];
    /** Legacy alias retained for compatibility with pre-parity listener data. */
    stringArgs?: string[];
}

/** Event types that can be set on widgets */
export type WidgetEventType =
    | "onLoad"
    | "onClick"
    | "onHold"
    | "onRelease"
    | "onMouseOver"
    | "onMouseLeave"
    | "onDrag"
    | "onDragComplete"
    | "onTargetEnter"
    | "onTargetLeave"
    | "onVarTransmit"
    | "onTimer"
    | "onOp"
    | "onClickRepeat"
    | "onMouseRepeat"
    | "onInvTransmit"
    | "onStatTransmit"
    | "onScroll" // OSRS: Mouse wheel scroll handler (CC_SETONSCROLLWHEEL sets this)
    | "onChatTransmit"
    | "onKey"
    | "onFriendTransmit"
    | "onClanTransmit"
    | "onMiscTransmit"
    | "onDialogAbort"
    | "onSubChange"
    | "onStockTransmit"
    | "onResize"
    | "onClanSettingsTransmit"
    | "onClanChannelTransmit"
    | "onItemOnItem"
    | "onClanSettings"
    | "onMapPost"
    // Input field listeners (opcodes 1436-1439 / 2436-2439)
    | "onInputSubmit"
    | "onInputAbort"
    | "onInputFocusChanged"
    | "onInputUpdate";

export interface WidgetNode {
    // Identity
    uid: number;
    id?: number;
    parentUid: number;
    groupId: number;
    fileId: number;
    childIndex?: number; // OSRS: -1 for static widgets, >= 0 for dynamic children (CC_CREATE slot index)
    type?: number;
    buttonType?: number; // IF1: 0=none, 1=ok, 2=spell, 4=close, 5=toggle, 6=continue
    isIf3?: boolean; // true for IF3 format widgets

    rootIndex?: number; // Index in root interface array (-1 if not root)
    cycle?: number; // Animation cycle for timing (-1 = not animating)

    // Hierarchy
    // children starts as null/undefined, is only set for dynamic widgets via CC_CREATE
    children?: (WidgetNode | null)[] | null;

    // Layout - Computed values
    width: number;
    height: number;
    x: number;
    y: number;
    scrollX: number;
    scrollY: number;
    scrollWidth: number;
    scrollHeight: number;

    // Aspect ratio fields used for layout calculations (default 1:1 = no constraint)
    aspectWidth?: number; // numerator (default 1)
    aspectHeight?: number; // denominator (default 1)

    // Grid (IF1)
    gridColumns?: number;
    gridRows?: number;
    gridXPitch?: number;
    gridYPitch?: number;

    // Raw Layout (from cache/script)
    rawX?: number;
    rawY?: number;
    xPositionMode?: number; // xAlignment in Java
    yPositionMode?: number; // yAlignment in Java
    rawWidth?: number;
    rawHeight?: number;
    widthMode?: number; // widthAlignment in Java
    heightMode?: number; // heightAlignment in Java

    // Visibility / State
    isHidden: boolean;
    hidden?: boolean; // Alias or used by Ops
    cachedHidden?: boolean; // Original hidden state from cache (for fallback)
    noClickThrough?: boolean;
    noScrollThrough?: boolean;
    pinchEnabled?: boolean; // Enables pinch-to-zoom on this widget (mobile)

    // Visuals
    text?: string;
    text2?: string; // hover/alternate text (IF1)
    textColor?: number;
    textShadow?: boolean;
    textShadowed?: boolean; // alias used by cache loader
    fontId?: number;
    xTextAlignment?: number; // 0=left, 1=center, 2=right
    yTextAlignment?: number; // 0=top, 1=center, 2=bottom
    lineHeight?: number;
    pauseText?: string;
    buttonText?: string; // IF1 button tooltip text (Ok, Select, Continue)

    color?: number; // rectangle color
    color2?: number; // gradient second color (for fillMode gradient)
    mouseOverColor?: number; // hover state color
    mouseOverColor2?: number; // hover state gradient second color
    filled?: boolean;
    fillColor?: number;
    /** OSRS FillMode: 0=SOLID, 1=GRADIENT_VERTICAL, 2=GRADIENT_ALPHA */
    fillMode?: number;
    /** transparencyBot for FillMode.GRADIENT_ALPHA bottom transparency */
    transparencyBot?: number;
    opacity?: number; // 0-255, where 255 is fully opaque (cache format)
    transparency?: number; // 0-255, where 255 is fully transparent (CS2 CC_SETTRANS)
    lineWidth?: number;
    lineDirection?: boolean;
    borderType?: number; // outline

    spriteId?: number; // primary sprite (IF3/cache sprite and what CC_SETGRAPHIC/IF_SETGRAPHIC set)
    spriteId2?: number; // alternate sprite (legacy IF1 CS1 / CC_SETGRAPHIC2)

    // IF1 hover redirect
    mouseOverRedirect?: number; // IF1: same-group fileId to treat as hovered instead (-1 = none)
    graphicShadow?: number;
    shadowColor?: number; // alias used by some runtime paths for widget sprite shadow
    vFlip?: boolean;
    hFlip?: boolean;
    verticalFlip?: boolean;
    horizontalFlip?: boolean;
    spriteAngle?: number;
    spriteTiling?: boolean;

    // Content - Single item (type 5 sprite widgets, etc.)
    itemId?: number;
    itemAmount?: number;
    itemQuantity?: number; // Used by Ops
    itemQuantityMode?: number; // 0=never, 1=always, 2=if > 1
    itemShowQuantity?: boolean;

    // Inventory arrays for type 2 (inventory) widgets
    // These hold multiple items in a grid layout (e.g., bank, inventory, equipment)
    itemIds?: number[];
    itemQuantities?: number[];

    // Model
    modelId?: number;
    modelId2?: number; // hover state model
    modelType?: number;
    modelType2?: number; // hover state model type
    modelZoom?: number;
    modelOffsetX?: number; // model X offset (IF3)
    modelOffsetY?: number; // model Y offset (IF3)
    modelX?: number; // tile offset X (IF1/CS2)
    modelY?: number; // tile offset Y (IF1/CS2)
    modelZ?: number;
    rotationX?: number; // model rotation X (cache format)
    rotationY?: number; // model rotation Y (cache format)
    rotationZ?: number; // model rotation Z (cache format)
    modelAngleX?: number; // alias for CS2 ops
    modelAngleY?: number; // alias for CS2 ops
    modelAngleZ?: number; // alias for CS2 ops
    modelAnim?: number;
    sequenceId?: number; // animation ID
    sequenceId2?: number; // hover state animation
    modelOrthog?: boolean;
    modelTransparent?: boolean;
    modelAmbient?: number;
    modelContrast?: number;
    modelLightX?: number;
    modelLightY?: number;
    modelLightZ?: number;

    // Animation frame tracking
    modelFrame?: number; // Current animation frame (0 = start)
    modelFrameCycle?: number; // Cycle count for frame timing

    // Interaction
    actions?: (string | null)[];
    subOps?: ((string | null)[] | null)[]; // subOps[opIndex][subIndex] = text for nested menu actions
    opBase?: string;
    opPriority?: number; // cc_setoppriority: menu entry priority, -1 to disable
    targetVerb?: string; // spellActionName in Java - action text for spell targeting
    targetMask?: number; // Bits 11-16 of flags - determines targeting behavior
    hasListener?: boolean;
    prioritizeMenuEntry?: boolean; // If true, this widget's menu entry appears first
    isScrollBar?: boolean; // If true, widget is a scrollbar component
    dataText?: string; // Extra text data (used by some widgets)

    // Dragging
    isDraggable?: boolean;
    // OSRS: dragDeadZone/dragDeadTime are exposed via CS2 as "drag dead" setters,
    // but the underlying Widget fields used by drag logic are dragZoneSize/dragThreshold.
    // We keep both for compatibility (some code paths still reference the older names).
    dragZoneSize?: number;
    dragThreshold?: number;
    dragDeadZone?: number;
    dragDeadTime?: number;
    dragRenderArea?: WidgetNode; // Widget that defines coordinate space for drag events
    dragRenderBehaviour?: number; // 0=hide, 1=follow cursor, 2=stay in place

    // Cursors
    targetCursor?: number;
    targetCursor2?: number;
    opCursors?: (number | null)[];

    // Keyboard Shortcuts (Runtime)
    // CC_SETOPKEY supports up to 5 key pairs per op, IF_SETOPKEY supports 1 key pair
    opKeys?: ({ keyChars: number[]; keyCodes: number[]; opIndex?: number } | null)[];
    opKeyRates?: ({ rate: number; enabled: boolean; opIndex?: number } | null)[];
    opKeyIgnoreHeld?: boolean[];

    // Raw key binding arrays
    // Key characters for each op (up to 11 ops, 5 keys each)
    // Key codes for each op
    // Key repeat rates per op
    // Key timers per op
    hasKeyBindings?: boolean; // True if any key binding is set
    keyChars?: (Int8Array | null)[];
    keyCodes?: (Int8Array | null)[];
    keyRepeatRates?: number[];
    keyTimers?: number[];

    // Events
    eventHandlers?: Partial<Record<WidgetEventType, WidgetEventHandler>>;

    // Cache-loaded scripts (Object[] in Java - first element is script ID, rest are args)
    onLoad?: any[];
    onResize?: any[];
    onOp?: any[];
    onClick?: any[];
    onHold?: any[];
    onRelease?: any[];
    onMouseOver?: any[];
    onMouseLeave?: any[];
    onDrag?: any[];
    onDragComplete?: any[];
    onTargetEnter?: any[];
    onTargetLeave?: any[];
    onVarTransmit?: any[];
    onTimer?: any[];
    onScroll?: any[]; // OSRS: Mouse wheel scroll handler (CC_SETONSCROLLWHEEL sets this)
    onMouseRepeat?: any[];
    onClickRepeat?: any[];
    onInvTransmit?: any[];
    onStatTransmit?: any[];
    onChatTransmit?: any[];
    onKey?: any[];
    onFriendTransmit?: any[];
    onClanTransmit?: any[];
    onMiscTransmit?: any[];
    onDialogAbort?: any[];
    onSubChange?: any[];
    onStockTransmit?: any[];
    onInputSubmit?: any[];
    onInputAbort?: any[];
    onInputFocusChanged?: any[];
    onInputUpdate?: any[];
    onClanSettingsTransmit?: any[];
    onClanChannelTransmit?: any[];
    onMapPost?: any[];

    // Trigger arrays - var/inv/stat IDs that trigger corresponding handlers
    varTransmitTriggers?: number[];
    invTransmitTriggers?: number[];
    statTransmitTriggers?: number[];

    /**
     * Widget parameters (IterableNodeHashTable in the client).
     * Set/read by CS2 ops like `cc_setparam`, `cc_param`, `if_setparam`, `if_param`, and used by
     * systems like ui_highlights + tooltips.
     *
     * Values are stored as ints (numbers) or strings.
     */
    params?: Map<number, number | string>;

    // Standard fields
    contentType?: number;
    flags?: number; // Widget flags bitfield (targetMask is bits 11-16)

    // CS1 (ClientScript 1) fields for IF1 widgets
    // Used for conditional display of color/text variants (e.g., skill level checks)
    cs1Comparisons?: Int8Array; // Comparison operators: 0/1=eq, 2=lt, 3=gt, 4=neq
    cs1ComparisonValues?: Int32Array; // Target values to compare against
    cs1Instructions?: Int32Array[]; // Instructions that compute values for comparison

    // Render State (Runtime)
    resolvedX?: number;
    resolvedY?: number;
    resolvedWidth?: number;
    resolvedHeight?: number;

    // Computed absolute position (set during hit detection)
    _absX?: number;
    _absY?: number;

    // PARITY: Layout validity flag for lazy evaluation pattern
    // True if x/y/width/height are current with raw values
    // False if raw values have changed but layout hasn't been recalculated
    isLayoutValid?: boolean;

    // Drag pickup offset (for cc_dragpickup)
    _dragPickupOffsetX?: number;
    _dragPickupOffsetY?: number;

    // Last transmit cycle - tracks when this widget's transmit handlers
    // were last processed. Used by engine to gate transmit triggers.
    // Initial value is -1, set to cycleCntr after transmit handlers are processed.
    // Transmit handlers only fire when (eventCycle > lastTransmitCycle).
    lastTransmitCycle?: number;

    // Last changedVarpCount value when this widget's onVarTransmit handler
    // was processed. Used for counter-based var transmit tracking.
    // Initial value is 0 (or undefined), updated to changedVarpCount after onVarTransmit check.
    // onVarTransmit fires when (changedVarpCount > lastChangedVarpCount).
    lastChangedVarpCount?: number;

    // Last changedInvCount value when this widget's onInvTransmit handler
    // was processed. Used for counter-based inventory transmit tracking.
    // Initial value is 0 (or undefined), updated to changedInvCount after onInvTransmit check.
    // onInvTransmit fires when (changedInvCount > lastChangedInvCount).
    lastChangedInvCount?: number;

    // Last changedStatCount value when this widget's onStatTransmit handler
    // was processed. Used for counter-based stat transmit tracking.
    // Initial value is 0 (or undefined), updated to changedStatCount after onStatTransmit check.
    // onStatTransmit fires when (changedStatCount > lastChangedStatCount).
    lastChangedStatCount?: number;
}

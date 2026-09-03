import type { WidgetInputControllerDeps, WidgetInputFrame, WidgetInputState } from "./widgetInputTypes";

export function shouldSkipWidgetClickInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
): boolean {
    // Click/Hold/Release handling (widget-level, not menu-level)
    // IMPORTANT: Skip widget click handling when the right-click menu is open.
    // The menu is not a widget, so clicks would pass through to widgets behind it.
    // Menu clicks are handled by ClickRegistry in processWidgetUiInput.
    // Check both world menu (deps.getMenuOpen()) and widget menu (ui.menu?.open)
    const uiMenu = (deps.getRenderer()?.canvas as any)?.__ui?.menu;
    if (deps.getMenuOpen() || uiMenu?.open) {
        return true;
    }

    // Skip input processing for one frame after menu closes to prevent
    // the menu-selecting click from being processed as a widget click
    if (deps.getMenuJustClosed()) {
        deps.setMenuJustClosed(false);
        return true;
    }
    return false;
}

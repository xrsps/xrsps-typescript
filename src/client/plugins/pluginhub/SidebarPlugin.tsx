import type { ClientSidebarPluginDefinition } from "../../sidebar/pluginTypes";

export const PLUGIN_HUB_SIDEBAR_PLUGIN: ClientSidebarPluginDefinition = Object.freeze({
    id: "plugin_hub",
    title: "xRSPS",
    tooltip: "Customize your Client",
    priority: 100,
    panelId: "plugin_hub",
    icon: ({ label }: { label: string }) => (
        <svg
            className="rl-sidebar-icon-svg"
            viewBox="0 0 24 24"
            role="img"
            aria-label={label}
            aria-hidden="true"
        >
            <path d="M12 3.5 14.3 5l2.8-.3.9 2.7 2.5 1.4-.9 2.7 1.2 2.5-2 1.9-.3 2.8-2.8.4L12 20.5 9.7 19l-2.8.3-.9-2.7-2.5-1.4.9-2.7L3.2 10l2-1.9.3-2.8 2.8-.4Z" />
            <circle cx="12" cy="12" r="3.1" />
        </svg>
    ),
});

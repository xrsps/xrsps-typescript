type WidgetGroupData = {
    root: Record<string, any> | undefined;
    widgets: Map<number, Record<string, any>>;
};

type SerializedWidgetGroup = {
    groupId: number;
    widgets: Record<string, any>[];
};

class CustomWidgetRegistryImpl {
    private readonly groups: WidgetGroupData[] = [];

    register(group: WidgetGroupData): void {
        this.groups.push(group);
    }

    serialize(): SerializedWidgetGroup[] {
        return this.groups.map((group) => {
            const widgets: Record<string, any>[] = [];
            for (const [, widget] of group.widgets) {
                widgets.push(widget);
            }
            const groupId = group.root?.groupId ?? widgets[0]?.groupId ?? 0;
            return { groupId, widgets };
        });
    }

    clear(): void {
        this.groups.length = 0;
    }
}

export const CustomWidgetRegistry = new CustomWidgetRegistryImpl();

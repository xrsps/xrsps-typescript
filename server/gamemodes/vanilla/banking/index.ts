import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import type { BankingProvider } from "./BankingProvider";
import { registerBankWidgetHandlers } from "./bankWidgets";
import { WidgetGroup, BankMainChild, BankSideChild, slotToTabIndex, BankLimits, TAB_SLOT_OFFSET } from "./bankConstants";

export function registerBankingHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerNpcAction("bank", ({ player, services }) => {
        services.openBank(player, { mode: "bank" });
    });
    registry.registerNpcAction("collect", ({ player, services }) => {
        services.openBank(player, { mode: "collect" });
    });
    registry.registerLocAction("bank", ({ player, services }) => {
        services.openBank(player, { mode: "bank" });
    });

    registerBankWidgetHandlers(registry, services);

    // Register packet handlers for banking messages.
    // These were previously hardcoded in MessageHandlers.ts / wsServer.ts.
    registry.registerClientMessageHandler("bank_deposit_inventory", (event) => {
        const tab = event.payload?.tab;
        const tabValue = tab !== undefined && (tab as number) > 0 ? (tab as number) : undefined;
        event.services.depositInventoryToBank?.(event.player, tabValue);
    });

    registry.registerClientMessageHandler("bank_deposit_equipment", (event) => {
        const tab = event.payload?.tab;
        const tabValue = tab !== undefined && (tab as number) > 0 ? (tab as number) : undefined;
        event.services.depositEquipmentToBank?.(event.player, tabValue);
    });

    registry.registerClientMessageHandler("bank_deposit_item", (event) => {
        const payload = event.payload;
        if (!payload) return;
        const slot = typeof payload.slot === "number" ? payload.slot : -1;
        const quantity = typeof payload.quantity === "number" ? payload.quantity : 0;
        const itemIdHint = payload.itemId as number | undefined;
        const tab = payload.tab !== undefined && (payload.tab as number) > 0 ? (payload.tab as number) : undefined;
        const result = event.services.depositInventoryItemToBank?.(
            event.player, slot, quantity, { itemIdHint, tab },
        );
        if (result && !result.ok && result.message) {
            event.services.messaging.sendGameMessage(event.player, result.message);
        }
    });

    registry.registerClientMessageHandler("bank_move", (event) => {
        const payload = event.payload;
        if (!payload) return;
        const from = payload.from as number;
        const to = payload.to as number;
        const modeRaw = payload.mode as string | undefined;
        const tab = payload.tab as number | undefined;
        const insert =
            modeRaw === "insert"
                ? true
                : modeRaw === "swap"
                ? false
                : event.player.bank.getBankInsertMode();
        const entry = event.services.getBankEntryAtClientSlot?.(event.player, from);
        if (!entry) return;
        const banking = event.services.gamemodeServices?.banking as BankingProvider | undefined;
        if (banking?.moveBankSlot) {
            banking.moveBankSlot(event.player, from, to, { insert, tab });
        }
    });

    registry.registerClientMessageHandler("if_buttond", (event) => {
        const payload = event.payload;
        if (!payload) return;
        const banking = event.services.gamemodeServices?.banking as BankingProvider | undefined;
        if (banking?.handleIfButtonD) {
            banking.handleIfButtonD(event.player, {
                sourceWidgetId: payload.sourceWidgetId as number,
                sourceSlot: payload.sourceSlot as number,
                sourceItemId: payload.sourceItemId as number,
                targetWidgetId: payload.targetWidgetId as number,
                targetSlot: payload.targetSlot as number,
                targetItemId: payload.targetItemId as number,
            });
        }
    });
}

export { BankingManager } from "./BankingManager";
export {
    type BankingProvider,
    type BankingProviderServices,
    type BankOperationResult,
    type BankServerUpdate,
    type IfButtonDPayload,
} from "./BankingProvider";
export { registerBankInterfaceHooks, BANK_INTERFACE_ID, type BankOpenData } from "./BankInterfaceHooks";
export {
    WidgetGroup,
    BankMainChild,
    BankSideChild,
    BankVarbit,
    BankVarp,
    BankLimits,
    TAB_SLOT_OFFSET,
    slotToTabIndex,
    getWidgetGroup,
    getWidgetChild,
} from "./bankConstants";

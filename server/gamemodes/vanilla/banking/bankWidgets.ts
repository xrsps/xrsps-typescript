import { BankMainChild, BankSideChild, BankVarbit, WidgetGroup } from "./bankConstants";
import { type PlayerState } from "../../../src/game/player";
import { type IScriptRegistry, type ScriptServices, type WidgetActionEvent } from "../../../src/game/scripts/types";

const BANK_GROUP_ID = WidgetGroup.BANK_MAIN;
const BANKSIDE_GROUP_ID = WidgetGroup.BANK_SIDE;

const packWidgetId = (group: number, child: number) => ((group & 0xffff) << 16) | (child & 0xffff);

const BANK_WIDGET_ITEMS = packWidgetId(BANK_GROUP_ID, BankMainChild.ITEMS);
const BANK_WIDGET_DEPOSIT_INV = packWidgetId(BANK_GROUP_ID, BankMainChild.DEPOSIT_INVENTORY);
const BANK_WIDGET_DEPOSIT_WORN = packWidgetId(BANK_GROUP_ID, BankMainChild.DEPOSIT_WORN);
const BANKSIDE_ITEMS = packWidgetId(BANKSIDE_GROUP_ID, BankSideChild.ITEMS);
const BANK_FILLER_ITEM_ID = 20594;

const requestedQuantityOrZero = (player: PlayerState): number => {
    const requested = Math.trunc(player.bank.getBankCustomQuantity());
    return requested > 0 ? requested : 0;
};

const quantityForDefaultMode = (player: PlayerState, available: number): number => {
    const total = Math.max(0, available);
    switch (player.bank.getBankQuantityMode()) {
        case 0:
            return total > 0 ? 1 : 0;
        case 1:
            return Math.min(5, Math.max(1, total));
        case 2:
            return Math.min(10, Math.max(1, total));
        case 3: {
            const desired = Math.max(1, requestedQuantityOrZero(player));
            return Math.min(total, Math.max(1, desired));
        }
        case 4:
            return total;
        default:
            return total > 0 ? 1 : 0;
    }
};

const quantityForWithdrawOp = (player: PlayerState, opId: number, available: number): number => {
    const total = Math.max(0, available);
    const requested = requestedQuantityOrZero(player);
    switch (opId) {
        case 1:
            return quantityForDefaultMode(player, total);
        case 2:
            return total > 0 ? 1 : 0;
        case 3:
            return Math.min(5, Math.max(1, total));
        case 4:
            return Math.min(10, Math.max(1, total));
        case 5:
        case 6:
            return requested > 0 ? Math.min(total, requested) : 0;
        case 7:
            return total;
        case 8:
            return total > 0 ? Math.max(0, total - 1) : 0;
        default:
            return 0;
    }
};

const quantityForDepositOp = (player: PlayerState, opId: number, available: number): number => {
    const total = Math.max(0, available);
    const requested = requestedQuantityOrZero(player);
    switch (opId) {
        case 2:
            return quantityForDefaultMode(player, total);
        case 3:
            return total > 0 ? 1 : 0;
        case 4:
            return Math.min(5, Math.max(1, total));
        case 5:
            return Math.min(10, Math.max(1, total));
        case 6:
        case 7:
            return requested > 0 ? Math.min(total, requested) : 0;
        case 8:
            return total;
        default:
            return 0;
    }
};

const handleWithdrawOp = (event: WidgetActionEvent, opId: number): void => {
    if (event.groupId !== BANK_GROUP_ID) return;
    if (event.slot === undefined) return;

    const { player, services } = event;

    const entry = services.getBankEntryAtClientSlot(player, event.slot);
    if (!entry || entry.itemId <= 0 || entry.quantity <= 0) return;

    if (event.itemId !== undefined && event.itemId > 0 && event.itemId !== entry.itemId) {
        services.logger?.debug?.(
            `[script:bank-widgets] withdraw ignored (item mismatch) player=${player.id} slot=${event.slot} clientItem=${event.itemId} serverItem=${entry.itemId}`,
        );
        return;
    }

    const quantity = quantityForWithdrawOp(player, opId, entry.quantity);
    if (!(quantity > 0)) return;

    const noted = player.bank.getBankWithdrawNotes();
    const result = services.withdrawFromBankSlot(player, event.slot, quantity, { noted });
    if (!result.ok && result.message) {
        services.sendGameMessage(player, result.message);
    }
};

function registerMainBankWidgets(registry: IScriptRegistry): void {
    const guard = (
        option: string,
        handler: (args: { player: any; services: any; event: any }) => void,
    ) =>
        registry.registerWidgetAction({
            option,
            handler: (event) => {
                if (event.groupId !== BANK_GROUP_ID) return;
                handler({ player: event.player, services: event.services, event });
            },
        });

    registry.registerWidgetAction({
        widgetId: BANK_WIDGET_DEPOSIT_INV,
        handler: ({ player, services, groupId }) => {
            if (groupId !== BANK_GROUP_ID) return;
            const moved = services.depositInventoryToBank(player);
            services.logger?.debug?.(
                `[script:bank-widgets] deposit inventory player=${player.id} moved=${moved}`,
            );
        },
    });

    registry.registerWidgetAction({
        widgetId: BANK_WIDGET_DEPOSIT_WORN,
        handler: ({ player, services, groupId }) => {
            if (groupId !== BANK_GROUP_ID) return;
            const moved = services.depositEquipmentToBank(player);
            services.logger?.debug?.(
                `[script:bank-widgets] deposit equipment player=${player.id} moved=${moved}`,
            );
        },
    });

    registry.onButton(
        BANK_GROUP_ID,
        BankMainChild.SWAP_INSERT_BUTTON,
        ({ player, services }) => {
            const next = !player.bank.getBankInsertMode();
            player.bank.setBankInsertMode(next);
            services.sendVarbit?.(player, BankVarbit.INSERT_MODE, next ? 1 : 0);
            services.logger?.debug?.(
                `[script:bank-widgets] insert mode=${next} player=${player.id}`,
            );
        },
    );

    registry.onButton(BANK_GROUP_ID, BankMainChild.NOTE_BUTTON, ({ player, services }) => {
        const next = !player.bank.getBankWithdrawNotes();
        player.bank.setBankWithdrawNotes(next);
        services.sendVarbit?.(player, BankVarbit.WITHDRAW_NOTES, next ? 1 : 0);
        services.logger?.debug?.(
            `[script:bank-widgets] withdraw notes=${next} player=${player.id}`,
        );
    });

    const setQuantityMode = (player: PlayerState, services: any, mode: number) => {
        player.bank.setBankQuantityMode(mode);
        services.sendVarbit?.(player, BankVarbit.QUANTITY_TYPE, mode);
        services.logger?.debug?.(
            `[script:bank-widgets] quantity mode=${mode} player=${player.id}`,
        );
    };

    registry.onButton(
        BANK_GROUP_ID,
        BankMainChild.QUANTITY_ONE_BUTTON,
        ({ player, services }) => {
            setQuantityMode(player, services, 0);
        },
    );

    registry.onButton(
        BANK_GROUP_ID,
        BankMainChild.QUANTITY_FIVE_BUTTON,
        ({ player, services }) => {
            setQuantityMode(player, services, 1);
        },
    );

    registry.onButton(
        BANK_GROUP_ID,
        BankMainChild.QUANTITY_TEN_BUTTON,
        ({ player, services }) => {
            setQuantityMode(player, services, 2);
        },
    );

    registry.onButton(
        BANK_GROUP_ID,
        BankMainChild.QUANTITY_X_BUTTON,
        ({ player, services }) => {
            setQuantityMode(player, services, 3);
        },
    );

    registry.onButton(
        BANK_GROUP_ID,
        BankMainChild.QUANTITY_ALL_BUTTON,
        ({ player, services }) => {
            setQuantityMode(player, services, 4);
        },
    );

    registry.onButton(
        BANK_GROUP_ID,
        BankMainChild.PLACEHOLDER_BUTTON,
        ({ player, services }) => {
            const next = !player.bank.getBankPlaceholderMode();
            player.bank.setBankPlaceholderMode(next);
            services.sendVarbit?.(player, BankVarbit.LEAVE_PLACEHOLDERS, next ? 1 : 0);
            services.logger?.debug?.(
                `[script:bank-widgets] placeholders=${next} player=${player.id}`,
            );
        },
    );

    guard("Placeholders", ({ player, services }) => {
        const next = !player.bank.getBankPlaceholderMode();
        player.bank.setBankPlaceholderMode(next);
        services.sendVarbit?.(player, BankVarbit.LEAVE_PLACEHOLDERS, next ? 1 : 0);
        services.logger?.debug?.(
            `[script:bank-widgets] placeholders=${next} player=${player.id}`,
        );
    });

    guard("Release placeholders", ({ player, services }) => {
        const cleared = player.bank.releaseBankPlaceholders();
        services.logger?.debug?.(
            `[script:bank-widgets] release placeholders player=${player.id} cleared=${cleared}`,
        );
        if (cleared > 0) {
            services.queueBankSnapshot(player);
            services.sendBankTabVarbits(player);
        }
    });

    guard("Search", ({ services }) => {
        services.logger?.debug?.("[script:bank-widgets] toggled search");
    });

    registry.onButton(BANK_GROUP_ID, BankMainChild.SEARCH, ({ services }) => {
        services.logger?.debug?.("[script:bank-widgets] toggled search");
    });

    registry.onButton(BANK_GROUP_ID, BankMainChild.CLOSE_BUTTON, ({ player, services }) => {
        services.logger?.debug?.(`[script:bank-widgets] close button player=${player.id}`);
        services.closeModal?.(player);
    });

    guard("Fillers", ({ player, services }) => {
        if (!player?.bank) return;
        const bank = player.bank.getBankEntries();
        let filled = 0;
        for (const entry of bank) {
            if (!entry) continue;
            if (entry.itemId <= 0 && !entry.filler) {
                entry.itemId = BANK_FILLER_ITEM_ID;
                entry.quantity = 0;
                entry.placeholder = false;
                entry.filler = true;
                filled++;
            }
        }
        if (filled > 0) {
            services.queueBankSnapshot(player);
            services.logger?.debug?.(
                `[script:bank-widgets] fillers enabled player=${player.id} count=${filled}`,
            );
        }
    });

    guard("Release fillers", ({ player, services }) => {
        if (!player?.bank) return;
        const bank = player.bank.getBankEntries();
        let cleared = 0;
        for (const entry of bank) {
            if (!entry) continue;
            if (entry.filler) {
                entry.itemId = -1;
                entry.quantity = 0;
                entry.placeholder = false;
                entry.filler = false;
                cleared++;
            }
        }
        if (cleared > 0) {
            services.queueBankSnapshot(player);
            services.logger?.debug?.(
                `[script:bank-widgets] fillers released player=${player.id} cleared=${cleared}`,
            );
        }
    });

    for (const opId of [1, 2, 3, 4, 5, 6, 7, 8]) {
        registry.registerWidgetAction({
            widgetId: BANK_WIDGET_ITEMS,
            opId,
            handler: (event) => handleWithdrawOp(event, opId),
        });
    }

    guard("Withdraw-1", ({ event }) => handleWithdrawOp(event, 2));

    for (const [option, opId] of Object.entries({
        "Withdraw-5": 3,
        "Withdraw-10": 4,
        "Withdraw-X": 6,
        "Withdraw-All": 7,
        "Withdraw-All-but-1": 8,
    })) {
        guard(option, ({ event }) => handleWithdrawOp(event, opId));
    }
}

function registerBanksideWidgets(registry: IScriptRegistry): void {
    const handleDeposit = (event: WidgetActionEvent) => {
        if (event.groupId !== BANKSIDE_GROUP_ID) return;
        if (event.widgetId !== BANKSIDE_ITEMS) return;

        const slot = event.slot;
        if (slot === undefined || slot < 0) return;

        const inv = event.player.getInventoryEntries();
        const entry = inv[slot];
        const available = entry && entry.quantity > 0 ? entry.quantity : 0;
        if (available <= 0) return;

        const opId = event.opId;
        const desired =
            opId !== undefined ? quantityForDepositOp(event.player, opId, available) : 0;

        if (!desired || desired <= 0) return;

        const result = event.services?.depositInventoryItemToBank?.(
            event.player,
            slot,
            desired,
            {
                itemIdHint: event.itemId,
            },
        );

        if (result && result.ok === false && result.message) {
            event.services.sendGameMessage(event.player, String(result.message));
        }
    };

    for (const opId of [2, 3, 4, 5, 6, 7, 8]) {
        registry.registerWidgetAction({
            widgetId: BANKSIDE_ITEMS,
            opId,
            handler: handleDeposit,
        });
    }
}

export function registerBankWidgetHandlers(registry: IScriptRegistry, _services: ScriptServices): void {
    registerMainBankWidgets(registry);
    registerBanksideWidgets(registry);
}

import type { GamemodeServerServices } from "../../src/game/gamemodes/GamemodeDefinition";
import type { PlayerState } from "../../src/game/player";
import type { ScriptServices } from "../../src/game/scripts/types";
import { encodeMessage } from "../../src/network/messages";
import { BankingManager, registerBankInterfaceHooks, type BankServerUpdate } from "../vanilla/banking";
import { BankMainChild } from "../vanilla/banking/bankConstants";
import type { DuelArenaService } from "./DuelArenaService";

/** Original bank widgets and slot handling, with the same durable duel economy. */
export class DuelNativeBank {
    private readonly bank: BankingManager;

    constructor(private readonly server: GamemodeServerServices, private readonly arena: DuelArenaService) {
        this.bank = new BankingManager({ ...server,
            queueBankSnapshot: (id, payload) => server.queueGamemodeSnapshot("bank", id, payload),
            sendBankSnapshot: (id, payload) => server.queueGamemodeSnapshot("bank", id, payload),
        });
        server.registerSnapshotEncoder("bank", (_id, payload) => ({
            message: encodeMessage({ type: "bank", payload: payload as BankServerUpdate }), context: "bank_snapshot",
        }), (id) => {
            const player = server.getPlayer(id);
            if (player) player.bank.setBankClientSlotMapping(this.bank.buildBankSlotMapping(player));
        });
        const interfaces = server.getInterfaceService();
        if (interfaces) registerBankInterfaceHooks(interfaces);
    }

    contribute(services: ScriptServices): void {
        const bank = this.bank;
        const allowed = (player: PlayerState) => this.arena.isFreeInLobby(player) && player.widgets.isOpen(12);
        const mutate = <T>(player: PlayerState, action: () => T, rejected: T): T => {
            if (!allowed(player)) return rejected;
            try { return this.arena.mutateBank(player, action); }
            catch (error) {
                services.messaging.sendGameMessage(player, error instanceof Error ? error.message : "The bank could not be updated.");
                bank.queueBankSnapshot(player);
                this.server.sendInventorySnapshot(player.id);
                return rejected;
            }
        };
        const refuseEquipment = (player: PlayerState): boolean => {
            services.messaging.sendGameMessage(player, "Your duel equipment is fixed and cannot be banked or removed.");
            return false;
        };
        services.banking = {
            openBank: (player, opts) => { if (this.arena.isFreeInLobby(player)) bank.openBank(player, opts); },
            depositInventoryToBank: (player, tab) => mutate(player, () => bank.depositInventory(player, tab), false),
            depositEquipmentToBank: refuseEquipment,
            depositEquipmentSlotToBank: refuseEquipment,
            removeEquipmentSlot: refuseEquipment,
            depositInventoryItemToBank: (player, slot, quantity, opts) => mutate(player,
                () => bank.depositItem(player, slot, quantity, opts?.itemIdHint, opts?.tab), { ok: false }),
            withdrawFromBankSlot: (player, slot, quantity, opts) => mutate(player,
                () => bank.withdraw(player, slot, quantity, { overrideNoted: opts?.noted }), { ok: false }),
            getBankEntryAtClientSlot: (player, slot) => bank.getBankEntryAtClientSlot(player, slot),
            moveBankSlot: (player, from, to, opts) => mutate(player, () => bank.moveBankSlot(player, from, to, opts), false),
            handleIfButtonD: (player, payload) => {
                // Only bank/inventory containers can move; worn equipment is loaned.
                if ((payload.sourceWidgetId >>> 16) === 12 &&
                    !([BankMainChild.ITEMS, BankMainChild.TABS] as number[]).includes(payload.sourceWidgetId & 0xffff)) return;
                mutate(player, () => bank.handleIfButtonD(player, payload), undefined);
            },
            queueBankSnapshot: (player) => bank.queueBankSnapshot(player),
            sendBankTabVarbits: (player) => bank.sendBankTabVarbits(player),
            setCurrentTab: (player, tab) => mutate(player, () => bank.setCurrentTab(player, tab), false),
            setTabDisplayMode: (player, mode) => mutate(player, () => bank.setTabDisplayMode(player, mode), false),
            collapseTab: (player, tab) => mutate(player, () => bank.collapseTab(player, tab), false),
            releasePlaceholder: (player, slot, itemId) => mutate(player, () => bank.releasePlaceholder(player, slot, itemId), false),
            releasePlaceholders: (player, tab) => mutate(player, () => bank.releasePlaceholders(player, tab), 0),
        };
    }
}

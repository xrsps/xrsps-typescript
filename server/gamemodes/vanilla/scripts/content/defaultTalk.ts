import { type IScriptRegistry, type ScriptServices } from "../../../../src/game/scripts/types";

/**
 * Fallback Talk-to handler so NPCs without bespoke scripts still respond.
 * This keeps client-side interactions working while content is fleshed out.
 */
export function registerDefaultTalkHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerNpcAction("talk-to", (event) => {
        const npc = event.npc;
        const npcName =
            npc?.name && npc.name !== "null"
                ? String(npc.name)
                : `NPC ${npc?.typeId ?? npc?.id ?? ""}`.trim();

        services.system.logger.info?.(
            `[script:default-talk] fallback dialog npc=${npc?.id} type=${npc?.typeId}`,
        );

        services.dialog.openDialog(event.player, {
            kind: "npc",
            id: `npc_${npc?.id ?? "unknown"}`,
            npcId: npc?.typeId,
            npcName,
            lines: [
                `${npcName} doesn't seem to have anything to say right now.`,
                "Content not implemented yet.",
            ],
            clickToContinue: true,
            closeOnContinue: true,
            onContinue: () => {
                services.dialog.closeDialog(event.player, `npc_${npc?.id ?? "unknown"}`);
            },
        });
    });
}

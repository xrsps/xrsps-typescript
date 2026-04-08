import { deflateSync } from "zlib";

import { CustomItemRegistry } from "../../../src/custom/items/CustomItemRegistry";
import { CustomWidgetRegistry } from "../../src/game/scripts/CustomWidgetRegistry";
import { ServerPacketId } from "../../../src/shared/packets/ServerPacketId";
import { LEAGUE_TASKS } from "./data/leagueTasks.data";
import {
    LEAGUE_MASTERY_CHALLENGES,
    LEAGUE_MASTERY_NODES,
    LEAGUE_RELICS,
} from "./data/leagueMasteries.data";
import { getAllCustomChallenges, getAllCustomTasks } from "./data/custom";
import "./data/custom-items/customItems";

export interface GamemodeDataPayload {
    gamemodeId: string;
    datasets: Array<{
        key: string;
        rows: unknown[];
    }>;
}

export class LeagueContentProvider {
    private cachedPacket: Uint8Array | null = null;

    build(): void {
        // Serialize custom items from the registry
        const customItems: unknown[] = [];
        for (const registered of CustomItemRegistry.getAll()) {
            customItems.push(registered.definition);
        }

        const payload: GamemodeDataPayload = {
            gamemodeId: "leagues-v",
            datasets: [
                { key: "leagueTasks", rows: LEAGUE_TASKS },
                { key: "leagueRelics", rows: LEAGUE_RELICS },
                { key: "leagueMasteryNodes", rows: LEAGUE_MASTERY_NODES },
                { key: "leagueMasteryChallenges", rows: LEAGUE_MASTERY_CHALLENGES },
                { key: "customTasks", rows: getAllCustomTasks() },
                { key: "customChallenges", rows: getAllCustomChallenges() },
                { key: "customItems", rows: customItems },
                { key: "customWidgets", rows: CustomWidgetRegistry.serialize() },
            ],
        };

        const jsonStr = JSON.stringify(payload);
        const jsonBytes = Buffer.from(jsonStr, "utf-8");
        const compressed = deflateSync(jsonBytes);

        // Build the binary packet: [opcode(1)] [length(2)] [flags(1)] [jsonLength(4)] [compressed data]
        const dataLen = 1 + 4 + compressed.length; // flags + jsonLength + compressed
        const packet = new Uint8Array(3 + dataLen); // opcode(1) + lengthPrefix(2) + data
        packet[0] = ServerPacketId.GAMEMODE_DATA;
        packet[1] = (dataLen >> 8) & 0xff;
        packet[2] = dataLen & 0xff;
        packet[3] = 1; // flags: bit 0 = compressed
        packet[4] = (jsonBytes.length >> 24) & 0xff;
        packet[5] = (jsonBytes.length >> 16) & 0xff;
        packet[6] = (jsonBytes.length >> 8) & 0xff;
        packet[7] = jsonBytes.length & 0xff;
        packet.set(compressed, 8);

        this.cachedPacket = packet;
        console.log(
            `[leagues-v] content data built: ${jsonBytes.length} bytes JSON → ${compressed.length} bytes compressed (${Math.round((compressed.length / jsonBytes.length) * 100)}%)`,
        );
    }

    getPacket(): Uint8Array | null {
        return this.cachedPacket;
    }
}

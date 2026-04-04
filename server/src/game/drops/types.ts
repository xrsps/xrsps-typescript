import type { PendingNpcDrop } from "../npcManager";
import type { PlayerState } from "../player";

export type QuantityInput = number | string | readonly [number, number];
export type ProbabilityInput = number | string;

export type DropQuantity = {
    min: number;
    max: number;
};

export type DropConditionDefinition = {
    wildernessOnly?: boolean;
    minimumQuestPoints?: number;
    requiredAnyEquippedItemIds?: number[];
};

export type NpcDropEntryDefinition = {
    itemId?: number;
    itemName?: string;
    quantity?: QuantityInput;
    rarity?: ProbabilityInput;
    altRarity?: ProbabilityInput;
    condition?: DropConditionDefinition;
    altCondition?: DropConditionDefinition;
    dropBoostEligible?: boolean;
};

export type NpcDropPoolDefinition = {
    kind: "weighted" | "independent";
    category: "main" | "tertiary";
    rolls?: number;
    entries: NpcDropEntryDefinition[];
};

export type NpcDropTableDefinition = {
    always?: NpcDropEntryDefinition[];
    pools?: NpcDropPoolDefinition[];
};

export type NpcDropEntry = {
    itemId: number;
    quantity: DropQuantity;
    probability?: number;
    altProbability?: number;
    condition?: DropConditionDefinition;
    altCondition?: DropConditionDefinition;
    dropBoostEligible: boolean;
};

export type NpcDropPool = {
    kind: "weighted" | "independent";
    category: "main" | "tertiary";
    rolls: number;
    entries: NpcDropEntry[];
    nothingProbability: number;
};

export type NpcDropTable = {
    always: NpcDropEntry[];
    pools: NpcDropPool[];
};

export type DropRecipient = {
    ownerId?: number;
    player?: PlayerState;
    dropRateMultiplier: number;
};

export type DropContext = {
    npcTypeId: number;
    npcName: string;
    tile: { x: number; y: number; level: number };
    isWilderness: boolean;
    recipients: DropRecipient[];
    worldViewId?: number;
    transformItemId?: (npcTypeId: number, itemId: number, recipient: DropRecipient) => number;
};

export type DropRollResult = PendingNpcDrop[];

export type ImportedMonsterDefinition = {
    name: string;
    combatLevel?: number;
    duplicate?: boolean;
    incomplete?: boolean;
    table: NpcDropTableDefinition;
};

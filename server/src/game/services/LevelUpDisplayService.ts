import { MAX_REAL_LEVEL, SkillId, getSkillName } from "../../../../src/rs/skill/skills";
import type { PlayerState } from "../player";
import type { LevelUpPopup, WidgetAction } from "./InterfaceManager";
import {
    LEVELUP_INTERFACE_ID,
    LEVELUP_CONTINUE_COMPONENT,
    LEVELUP_SKILL_COMPONENT_BY_SKILL,
    LEVELUP_TEXT1_COMPONENT,
    LEVELUP_TEXT2_COMPONENT,
    LEVELUP_COMBAT_COMPONENT,
} from "../../network/levelUpDisplay";

const CHATBOX_GROUP_ID = 162;
const CHATBOX_CHILD_ID = 567;
const VARBIT_CHATMODAL_UNCLAMP = 10670;
const CHATBOX_RESET_SCRIPT_ID = 2379;
const OBJECTBOX_INTERFACE_ID = 193;
const HUNTER_LEVELUP_ICON_ITEM_ID = 9951;

const LEVELUP_SPOT_ID = 199;
const LEVELUP_99_SPOT_ID = 1388;

const LEVELUP_JINGLE_ID = 29;
const LEVELUP_99_JINGLE_ID = 30;
const LEVELUP_COMBAT_JINGLE_ID = 54;
const LEVELUP_JINGLE_DELAY = 0;
const LEVELUP_FIREWORK_SOUND = 2396;

const LEVELUP_JINGLE_BY_SKILL: Partial<Record<number, number>> = {
    [SkillId.Agility]: 31,
    [SkillId.Attack]: 32,
    [SkillId.Construction]: 33,
    [SkillId.Cooking]: 34,
    [SkillId.Crafting]: 35,
    [SkillId.Defence]: 36,
    [SkillId.Farming]: 37,
    [SkillId.Firemaking]: 38,
    [SkillId.Fishing]: 39,
    [SkillId.Fletching]: 40,
    [SkillId.Herblore]: 41,
    [SkillId.Hitpoints]: 42,
    [SkillId.Hunter]: 43,
    [SkillId.Magic]: 44,
    [SkillId.Mining]: 45,
    [SkillId.Prayer]: 46,
    [SkillId.Ranged]: 47,
    [SkillId.Runecraft]: 48,
    [SkillId.Slayer]: 49,
    [SkillId.Smithing]: 50,
    [SkillId.Strength]: 51,
    [SkillId.Thieving]: 52,
    [SkillId.Woodcutting]: 53,
};

export interface LevelUpDisplayServiceDeps {
    queueWidgetEvent: (playerId: number, action: any) => void;
    enqueueSpotAnimation: (event: any) => void;
    sendJingle: (player: any, jingleId: number, delay?: number) => void;
    sendSound: (player: any, soundId: number) => void;
    getCurrentTick: () => number;
}

export class LevelUpDisplayService {
    constructor(private readonly deps: LevelUpDisplayServiceDeps) {}

    showLevelUpPopup(player: PlayerState, popup: LevelUpPopup): boolean {
        if (popup.kind === "skill") {
            return this.dispatchLevelUpEffect(
                player,
                popup.skillId,
                popup.newLevel,
                popup.levelIncrement,
            );
        }
        return this.dispatchCombatLevelUpEffect(player, popup.newLevel, popup.levelIncrement);
    }

    closeChatboxModalOverlay(playerIdRaw: number): void {
        const playerId = playerIdRaw;
        const chatboxTargetUid = (CHATBOX_GROUP_ID << 16) | CHATBOX_CHILD_ID;

        this.deps.queueWidgetEvent(playerId, { action: "close_sub", targetUid: chatboxTargetUid });

        this.deps.queueWidgetEvent(playerId, {
            action: "set_varbit",
            varbitId: VARBIT_CHATMODAL_UNCLAMP,
            value: 0,
        });

        this.deps.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: chatboxTargetUid,
            hidden: true,
        });
    }

    private openLevelUpChatboxOverlay(playerIdRaw: number, groupId: number): void {
        const playerId = playerIdRaw;
        const chatboxTargetUid = (CHATBOX_GROUP_ID << 16) | CHATBOX_CHILD_ID;

        this.deps.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: chatboxTargetUid,
            hidden: false,
        });

        this.deps.queueWidgetEvent(playerId, {
            action: "open_sub",
            targetUid: chatboxTargetUid,
            groupId,
            type: 0,
            varbits: {
                [VARBIT_CHATMODAL_UNCLAMP]: 1,
            },
            preScripts: [{ scriptId: CHATBOX_RESET_SCRIPT_ID, args: [] }],
        });
    }

    private dispatchCombatLevelUpEffect(
        player: PlayerState,
        newCombatLevelRaw: number,
        levelIncrementRaw: number,
    ): boolean {
        const playerId = player.id;
        const newLevel = Math.max(1, newCombatLevelRaw);
        const levelIncrement = Math.max(1, levelIncrementRaw);

        const noun = "combat";
        const firstChar = noun[0] ?? "";
        const vowel =
            firstChar === "a" ||
            firstChar === "e" ||
            firstChar === "i" ||
            firstChar === "o" ||
            firstChar === "u";
        const levelFormat = levelIncrement === 1 ? (vowel ? "an" : "a") : String(levelIncrement);
        const pluralSuffix = levelIncrement === 1 ? "" : "s";

        this.openLevelUpChatboxOverlay(playerId, LEVELUP_INTERFACE_ID);

        this.deps.queueWidgetEvent(playerId, {
            action: "set_flags",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT,
            flags: 1,
        });

        for (const componentId of Object.values(LEVELUP_SKILL_COMPONENT_BY_SKILL)) {
            const comp = componentId;
            if (typeof comp !== "number") continue;
            this.deps.queueWidgetEvent(playerId, {
                action: "set_hidden",
                uid: (LEVELUP_INTERFACE_ID << 16) | (comp & 0xffff),
                hidden: true,
            });
        }
        this.deps.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_COMBAT_COMPONENT,
            hidden: false,
        });

        this.deps.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT1_COMPONENT,
            text: `<col=000080>Congratulations, you just advanced ${levelFormat} ${noun} level${pluralSuffix}.`,
        });
        this.deps.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT2_COMPONENT,
            text: `Your ${noun} level is now ${newLevel}.`,
        });
        this.deps.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT,
            text: "Click here to continue",
        });

        const tick = this.deps.getCurrentTick();
        this.deps.enqueueSpotAnimation({
            tick,
            playerId,
            spotId: LEVELUP_SPOT_ID,
            delay: 0,
            height: 120,
        });

        this.deps.sendJingle(player, LEVELUP_COMBAT_JINGLE_ID, LEVELUP_JINGLE_DELAY);

        this.deps.sendSound(player, LEVELUP_FIREWORK_SOUND);

        return true;
    }

    private dispatchHunterLevelUpEffect(
        player: PlayerState,
        newLevelRaw: number,
        levelIncrementRaw: number,
    ): boolean {
        const playerId = player.id;
        const newLevel = Math.max(1, newLevelRaw);
        const levelIncrement = Math.max(1, levelIncrementRaw);

        const noun = "Hunter";
        const levelFormat = levelIncrement === 1 ? "a" : String(levelIncrement);
        const pluralSuffix = levelIncrement === 1 ? "" : "s";

        this.openLevelUpChatboxOverlay(playerId, OBJECTBOX_INTERFACE_ID);

        this.deps.queueWidgetEvent(playerId, {
            action: "set_item",
            uid: (OBJECTBOX_INTERFACE_ID << 16) | 1,
            itemId: HUNTER_LEVELUP_ICON_ITEM_ID,
        });
        this.deps.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (OBJECTBOX_INTERFACE_ID << 16) | 2,
            text:
                `<col=000080>Congratulations, you've just advanced ${levelFormat} ${noun} level${pluralSuffix}.` +
                `<col=000000><br><br>Your ${noun} level is now ${newLevel}.`,
        });

        const spotId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_SPOT_ID : LEVELUP_SPOT_ID;
        const tick = this.deps.getCurrentTick();
        this.deps.enqueueSpotAnimation({
            tick,
            playerId,
            spotId,
            delay: 0,
            height: 120,
        });

        const hunterJingle = LEVELUP_JINGLE_BY_SKILL[SkillId.Hunter] ?? LEVELUP_JINGLE_ID;
        const jingleId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_JINGLE_ID : hunterJingle;
        this.deps.sendJingle(player, jingleId, LEVELUP_JINGLE_DELAY);

        this.deps.sendSound(player, LEVELUP_FIREWORK_SOUND);

        return true;
    }

    private dispatchLevelUpEffect(
        player: PlayerState,
        skillIdRaw: number,
        newLevelRaw: number,
        levelIncrementRaw: number,
    ): boolean {
        const playerId = player.id;
        const skillId = skillIdRaw;
        const newLevel = Math.max(1, newLevelRaw);
        const levelIncrement = Math.max(1, levelIncrementRaw);

        if (skillId === (SkillId.Hunter as number)) {
            return this.dispatchHunterLevelUpEffect(player, newLevel, levelIncrement);
        }

        const targetComponentId = LEVELUP_SKILL_COMPONENT_BY_SKILL[skillId];
        if (targetComponentId === undefined) {
            return false;
        }

        const skillName = getSkillName(skillId as SkillId);
        const firstChar = (skillName[0] ?? "").toLowerCase();
        const vowel =
            firstChar === "a" ||
            firstChar === "e" ||
            firstChar === "i" ||
            firstChar === "o" ||
            firstChar === "u";
        const levelFormat = levelIncrement === 1 ? (vowel ? "an" : "a") : String(levelIncrement);
        const pluralSuffix = levelIncrement === 1 ? "" : "s";

        this.openLevelUpChatboxOverlay(playerId, LEVELUP_INTERFACE_ID);

        this.deps.queueWidgetEvent(playerId, {
            action: "set_flags",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT,
            flags: 1,
        });

        for (const componentId of Object.values(LEVELUP_SKILL_COMPONENT_BY_SKILL)) {
            const comp = componentId;
            if (typeof comp !== "number") continue;
            this.deps.queueWidgetEvent(playerId, {
                action: "set_hidden",
                uid: (LEVELUP_INTERFACE_ID << 16) | (comp & 0xffff),
                hidden: comp !== targetComponentId,
            });
        }
        this.deps.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_COMBAT_COMPONENT,
            hidden: true,
        });

        this.deps.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT1_COMPONENT,
            text: `<col=000080>Congratulations, you just advanced ${levelFormat} ${skillName} level${pluralSuffix}.`,
        });
        this.deps.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT2_COMPONENT,
            text: `Your ${skillName} level is now ${newLevel}.`,
        });
        this.deps.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT,
            text: "Click here to continue",
        });

        const spotId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_SPOT_ID : LEVELUP_SPOT_ID;
        const tick = this.deps.getCurrentTick();
        this.deps.enqueueSpotAnimation({
            tick,
            playerId,
            spotId,
            delay: 0,
            height: 120,
        });

        const skillJingle = LEVELUP_JINGLE_BY_SKILL[skillId] ?? LEVELUP_JINGLE_ID;
        const jingleId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_JINGLE_ID : skillJingle;
        this.deps.sendJingle(player, jingleId, LEVELUP_JINGLE_DELAY);

        this.deps.sendSound(player, LEVELUP_FIREWORK_SOUND);

        return true;
    }
}

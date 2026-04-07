import { MAX_REAL_LEVEL, SkillId, getSkillName } from "../../../../src/rs/skill/skills";
import type { PlayerState } from "../../../src/game/player";
import type { ScriptServices } from "../../../src/game/scripts/types";
import type { GameEventBus } from "../../../src/game/events/GameEventBus";
import {
    LEVELUP_INTERFACE_ID,
    LEVELUP_CONTINUE_COMPONENT,
    LEVELUP_SKILL_COMPONENT_BY_SKILL,
    LEVELUP_TEXT1_COMPONENT,
    LEVELUP_TEXT2_COMPONENT,
    LEVELUP_COMBAT_COMPONENT,
} from "../../../src/network/levelUpDisplay";

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
const LEVELUP_FIREWORK_SOUND = 2396;

const LEVELUP_JINGLE_BY_SKILL: Partial<Record<number, number>> = {
    [SkillId.Agility]: 31, [SkillId.Attack]: 32, [SkillId.Construction]: 33,
    [SkillId.Cooking]: 34, [SkillId.Crafting]: 35, [SkillId.Defence]: 36,
    [SkillId.Farming]: 37, [SkillId.Firemaking]: 38, [SkillId.Fishing]: 39,
    [SkillId.Fletching]: 40, [SkillId.Herblore]: 41, [SkillId.Hitpoints]: 42,
    [SkillId.Hunter]: 43, [SkillId.Magic]: 44, [SkillId.Mining]: 45,
    [SkillId.Prayer]: 46, [SkillId.Ranged]: 47, [SkillId.Runecraft]: 48,
    [SkillId.Slayer]: 49, [SkillId.Smithing]: 50, [SkillId.Strength]: 51,
    [SkillId.Thieving]: 52, [SkillId.Woodcutting]: 53,
};

interface LevelUpPopup {
    kind: "skill" | "combat" | "hunter";
    skillId?: number;
    newLevel: number;
    levelIncrement: number;
}

const popupQueues = new Map<number, LevelUpPopup[]>();

function queueWidget(services: ScriptServices, playerId: number, action: Record<string, unknown>): void {
    services.dialog.queueWidgetEvent(playerId, action as any);
}

function openChatboxOverlay(services: ScriptServices, playerId: number, groupId: number): void {
    const chatboxUid = (CHATBOX_GROUP_ID << 16) | CHATBOX_CHILD_ID;
    queueWidget(services, playerId, { action: "set_hidden", uid: chatboxUid, hidden: false });
    queueWidget(services, playerId, {
        action: "open_sub", targetUid: chatboxUid, groupId, type: 0,
        varbits: { [VARBIT_CHATMODAL_UNCLAMP]: 1 },
        preScripts: [{ scriptId: CHATBOX_RESET_SCRIPT_ID, args: [] }],
    });
}

function closeChatboxOverlay(services: ScriptServices, playerId: number): void {
    const chatboxUid = (CHATBOX_GROUP_ID << 16) | CHATBOX_CHILD_ID;
    queueWidget(services, playerId, { action: "close_sub", targetUid: chatboxUid });
    queueWidget(services, playerId, { action: "set_varbit", varbitId: VARBIT_CHATMODAL_UNCLAMP, value: 0 });
    queueWidget(services, playerId, { action: "set_hidden", uid: chatboxUid, hidden: true });
}

function showSkillLevelUp(services: ScriptServices, player: PlayerState, skillId: number, newLevel: number, levelIncrement: number): boolean {
    const playerId = player.id;

    if (skillId === (SkillId.Hunter as number)) {
        return showHunterLevelUp(services, player, newLevel, levelIncrement);
    }

    const targetComp = LEVELUP_SKILL_COMPONENT_BY_SKILL[skillId];
    if (targetComp === undefined) return false;

    const skillName = getSkillName(skillId as SkillId);
    const vowel = "aeiou".includes((skillName[0] ?? "").toLowerCase());
    const fmt = levelIncrement === 1 ? (vowel ? "an" : "a") : String(levelIncrement);
    const s = levelIncrement === 1 ? "" : "s";

    openChatboxOverlay(services, playerId, LEVELUP_INTERFACE_ID);
    queueWidget(services, playerId, { action: "set_flags", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT, flags: 1 });

    for (const comp of Object.values(LEVELUP_SKILL_COMPONENT_BY_SKILL)) {
        if (typeof comp !== "number") continue;
        queueWidget(services, playerId, { action: "set_hidden", uid: (LEVELUP_INTERFACE_ID << 16) | (comp & 0xffff), hidden: comp !== targetComp });
    }
    queueWidget(services, playerId, { action: "set_hidden", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_COMBAT_COMPONENT, hidden: true });
    queueWidget(services, playerId, { action: "set_text", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT1_COMPONENT, text: `<col=000080>Congratulations, you just advanced ${fmt} ${skillName} level${s}.` });
    queueWidget(services, playerId, { action: "set_text", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT2_COMPONENT, text: `Your ${skillName} level is now ${newLevel}.` });
    queueWidget(services, playerId, { action: "set_text", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT, text: "Click here to continue" });

    const spotId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_SPOT_ID : LEVELUP_SPOT_ID;
    services.animation.broadcastPlayerSpot(player, spotId, 120);
    const jingleId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_JINGLE_ID : (LEVELUP_JINGLE_BY_SKILL[skillId] ?? LEVELUP_JINGLE_ID);
    services.sound.sendJingle(player, jingleId);
    services.sound.sendSound(player, LEVELUP_FIREWORK_SOUND);
    return true;
}

function showHunterLevelUp(services: ScriptServices, player: PlayerState, newLevel: number, levelIncrement: number): boolean {
    const playerId = player.id;
    const fmt = levelIncrement === 1 ? "a" : String(levelIncrement);
    const s = levelIncrement === 1 ? "" : "s";

    openChatboxOverlay(services, playerId, OBJECTBOX_INTERFACE_ID);
    queueWidget(services, playerId, { action: "set_item", uid: (OBJECTBOX_INTERFACE_ID << 16) | 1, itemId: HUNTER_LEVELUP_ICON_ITEM_ID });
    queueWidget(services, playerId, {
        action: "set_text", uid: (OBJECTBOX_INTERFACE_ID << 16) | 2,
        text: `<col=000080>Congratulations, you've just advanced ${fmt} Hunter level${s}.<col=000000><br><br>Your Hunter level is now ${newLevel}.`,
    });

    const spotId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_SPOT_ID : LEVELUP_SPOT_ID;
    services.animation.broadcastPlayerSpot(player, spotId, 120);
    const jingleId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_JINGLE_ID : (LEVELUP_JINGLE_BY_SKILL[SkillId.Hunter] ?? LEVELUP_JINGLE_ID);
    services.sound.sendJingle(player, jingleId);
    services.sound.sendSound(player, LEVELUP_FIREWORK_SOUND);
    return true;
}

function showCombatLevelUp(services: ScriptServices, player: PlayerState, newLevel: number, levelIncrement: number): boolean {
    const playerId = player.id;
    const vowel = "aeiou".includes("c");
    const fmt = levelIncrement === 1 ? (vowel ? "an" : "a") : String(levelIncrement);
    const s = levelIncrement === 1 ? "" : "s";

    openChatboxOverlay(services, playerId, LEVELUP_INTERFACE_ID);
    queueWidget(services, playerId, { action: "set_flags", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT, flags: 1 });

    for (const comp of Object.values(LEVELUP_SKILL_COMPONENT_BY_SKILL)) {
        if (typeof comp !== "number") continue;
        queueWidget(services, playerId, { action: "set_hidden", uid: (LEVELUP_INTERFACE_ID << 16) | (comp & 0xffff), hidden: true });
    }
    queueWidget(services, playerId, { action: "set_hidden", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_COMBAT_COMPONENT, hidden: false });
    queueWidget(services, playerId, { action: "set_text", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT1_COMPONENT, text: `<col=000080>Congratulations, you just advanced ${fmt} combat level${s}.` });
    queueWidget(services, playerId, { action: "set_text", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT2_COMPONENT, text: `Your combat level is now ${newLevel}.` });
    queueWidget(services, playerId, { action: "set_text", uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT, text: "Click here to continue" });

    services.animation.broadcastPlayerSpot(player, LEVELUP_SPOT_ID, 120);
    services.sound.sendJingle(player, LEVELUP_COMBAT_JINGLE_ID);
    services.sound.sendSound(player, LEVELUP_FIREWORK_SOUND);
    return true;
}

function showPopup(services: ScriptServices, player: PlayerState, popup: LevelUpPopup): boolean {
    if (popup.kind === "skill" || popup.kind === "hunter") {
        return showSkillLevelUp(services, player, popup.skillId ?? 0, popup.newLevel, popup.levelIncrement);
    }
    return showCombatLevelUp(services, player, popup.newLevel, popup.levelIncrement);
}

function enqueuePopup(services: ScriptServices, player: PlayerState, popup: LevelUpPopup): void {
    const playerId = player.id;
    let queue = popupQueues.get(playerId);
    if (!queue) {
        queue = [];
        popupQueues.set(playerId, queue);
    }
    queue.push(popup);

    if (popup.kind === "skill") {
        const skillName = getSkillName((popup.skillId ?? 0) as SkillId);
        const msg = popup.newLevel === MAX_REAL_LEVEL
            ? `Congratulations, you've reached the highest possible ${skillName} level of 99.`
            : `Congratulations, you've just advanced your ${skillName} level. You are now level ${popup.newLevel}.`;
        services.messaging.sendGameMessage(player, msg);
    }

    if (queue.length === 1) {
        if (!showPopup(services, player, popup)) {
            queue.shift();
            if (queue.length < 1) popupQueues.delete(playerId);
        }
    }
}

function advanceQueue(services: ScriptServices, player: PlayerState): void {
    const queue = popupQueues.get(player.id);
    if (!queue || queue.length === 0) return;
    queue.shift();
    while (queue.length > 0) {
        if (showPopup(services, player, queue[0])) return;
        queue.shift();
    }
    popupQueues.delete(player.id);
    closeChatboxOverlay(services, player.id);
}

function dismissQueue(services: ScriptServices, playerId: number): void {
    const queue = popupQueues.get(playerId);
    if (!queue || queue.length === 0) return;
    popupQueues.delete(playerId);
    closeChatboxOverlay(services, playerId);
}

export function getPopupQueue(playerId: number): readonly LevelUpPopup[] | undefined {
    return popupQueues.get(playerId);
}

export function registerLevelUpHandlers(services: ScriptServices, eventBus: GameEventBus): void {
    eventBus.on("skill:levelUp", ({ player, skillId, oldLevel, newLevel }) => {
        enqueuePopup(services, player, {
            kind: "skill",
            skillId,
            newLevel,
            levelIncrement: Math.max(1, newLevel - oldLevel),
        });
    });

    eventBus.on("combat:levelUp", ({ player, oldLevel, newLevel }) => {
        enqueuePopup(services, player, {
            kind: "combat",
            newLevel,
            levelIncrement: Math.max(1, newLevel - oldLevel),
        });
    });

    eventBus.on("interfaces:closeInterruptible", ({ player }) => {
        dismissQueue(services, player.id);
    });
}

export function handleResumePauseButton(services: ScriptServices, player: PlayerState, widgetId: number, _childIndex: number): boolean {
    const widgetGroup = (widgetId >> 16) & 0xffff;
    const queue = popupQueues.get(player.id);
    if (!queue || queue.length === 0 || widgetGroup !== LEVELUP_INTERFACE_ID) return false;

    const expectedWidgetId = (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT;
    const current = queue[0];
    const expectsLevelupDisplay = current.kind === "combat" || (current.kind === "skill" && current.skillId !== SkillId.Hunter);
    if (!expectsLevelupDisplay || widgetId === expectedWidgetId) {
        advanceQueue(services, player);
    }
    return true;
}

export function handleDismiss(services: ScriptServices, playerId: number): void {
    dismissQueue(services, playerId);
}

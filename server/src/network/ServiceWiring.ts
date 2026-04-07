/**
 * Factory functions extracted from WSServer.
 * Each receives the server instance (typed as WSServerContext) and builds
 * service dependency bags.
 */

import { WebSocket } from "ws";

import { logger } from "../utils/logger";
import {
    VARBIT_SIDE_JOURNAL_TAB,
    VARP_MUSICPLAY,
    VARP_MUSIC_CURRENT_TRACK,
    VARP_SIDE_JOURNAL_STATE,
    VARP_OPTION_RUN,
    VARP_SPECIAL_ATTACK,
    VARP_ATTACK_STYLE,
    VARP_AUTO_RETALIATE,
    VARP_MAP_FLAGS_CACHED,
} from "../../../src/shared/vars";
import { EquipmentSlot } from "../../../src/rs/config/player/Equipment";
import {
    SIDE_JOURNAL_CONTENT_GROUP_BY_TAB,
    SIDE_JOURNAL_TAB_CONTAINER_UID,
} from "../../../src/shared/ui/sideJournal";
import { encodeMessage } from "./messages";
import { encodeCp1252Bytes } from "./encoding/Cp1252";
import {
    NpcPacketEncoder,
    PlayerPacketEncoder,
    type NpcPacketEncoderServices,
    type PlayerPacketEncoderServices,
} from "./encoding";
import {
    NpcSyncManager,
    PlayerAppearanceManager,
    SoundManager,
    GroundItemHandler,
    Cs2ModalManager,
    type NpcSyncManagerServices,
    type PlayerAppearanceServices,
    type SoundManagerServices,
    type GroundItemHandlerServices,
    type Cs2ModalManagerServices,
} from "./managers";
import {
    CombatActionHandler,
    SpellActionHandler,
    InventoryActionHandler,
    EffectDispatcher,
    WidgetDialogHandler,
    type CombatActionServices,
    type SpellActionServices,
    type InventoryActionServices,
    type EffectDispatcherServices,
    type WidgetDialogServices,
} from "../game/actions";
import { ProjectileSystem, type ProjectileSystemServices } from "../game/systems/ProjectileSystem";
import { GatheringSystemManager, type GatheringSystemServices } from "../game/systems/GatheringSystemManager";
import { EquipmentHandler, type EquipmentHandlerServices } from "../game/systems/EquipmentHandler";
import { TickPhaseOrchestrator, type TickPhaseOrchestratorServices, type TickPhaseProvider } from "../game/tick/TickPhaseOrchestrator";
import { PlayerDeathService } from "../game/death/PlayerDeathService";
import type { PlayerDeathServices } from "../game/death/types";
import { CombatEngine } from "../game/systems/combat/CombatEngine";
import { RectAdjacentRouteStrategy } from "../pathfinding/legacy/pathfinder/RouteStrategy";
import { registerAllHandlers } from "./handlers";
import type { BinaryHandlerExtServices } from "./handlers";
import {
    resolveNpcOptionByOpNum,
    resolveLocActionByOpNum,
    resolveGroundItemOptionByOpNum,
} from "./handlers/examineHandler";
import { calculateAmmoConsumption } from "../game/combat/AmmoSystem";
import { canWeaponAutocastSpell, getAutocastCompatibilityMessage, getSpellData, getSpellDataByWidget } from "../game/spells/SpellDataProvider";
import { ensureEquipQtyArrayOn, consumeEquippedAmmoApply, pickEquipSound, unequipItemApply } from "../game/equipment";
import { hasDirectMeleePath, hasDirectMeleeReach, isWithinAttackRange } from "../game/combat/CombatAction";
import { getSpecialAttack } from "../game/combat/SpecialAttackProvider";
import { getSpellBaseXp } from "../game/combat/SpellXpProvider";
import { getProjectileParams } from "../game/data/ProjectileParamsProvider";
import { SpellCaster } from "../game/spells/SpellCaster";
import { isInWilderness, getWildernessLevel } from "../game/combat/MultiCombatZones";
import { combatEffectApplicator } from "../game/combat/CombatEffectApplicator";
import { normalizeAttackType } from "../game/combat/AttackType";
import {
    EQUIP_SLOT_COUNT,
    COMBAT_SOUND_DELAY_MS,
    PLAYER_TAKE_DAMAGE_SOUND,
    PLAYER_ZERO_DAMAGE_SOUND,
} from "./wsServerTypes";
import type { TickFrame } from "./wsServerTypes";
import type { SkillSyncUpdate } from "../game/player";
import type { PlayerState } from "../game/player";
import type { NpcState, NpcSpawnConfig } from "../game/npc";
import { pickSpecialAttackVisualOverride } from "../game/combat/SpecialAttackVisualProvider";
import { testRandFloat, TEST_HIT_FORCE } from "../game/testing/TestRng";
import { faceAngleRs } from "../../../src/rs/utils/rotation";
import { getItemDefinition } from "../data/items";
import { getRangedImpactSound } from "../game/combat/WeaponDataProvider";
import type { MessageRouter } from "./MessageRouter";
import type { WidgetAction } from "../widgets/WidgetManager";
import type { WSServerContext } from "./WSServerContext";

export function createNpcPacketEncoder(server: WSServerContext): NpcPacketEncoder {
    const services: NpcPacketEncoderServices = {
        getNpcById: (id) => server.npcManager?.getById(id),
        getNearbyNpcs: (x, y, level, radius) =>
            server.npcManager?.getNearby(x, y, level, radius) ?? [],
        resolveHealthBarWidth: (defId) => {
            try {
                const def = server.healthBarDefLoader?.load?.(defId);
                return Math.max(1, Math.min(255, def?.width ?? 30));
            } catch (err) {
                logger.warn("Failed to resolve NPC health bar width", err);
                return 30;
            }
        },
    };
    return new NpcPacketEncoder(services);
}

export function createPlayerPacketEncoder(server: WSServerContext): PlayerPacketEncoder {
    const huffman = server.huffman;
    const services: PlayerPacketEncoderServices = {
        getPlayer: (id) => {
            const p = server.players?.getById(id);
            return p ?? undefined;
        },
        getLivePlayers: () => {
            const liveById = new Map<number, PlayerState>();
            if (server.players) {
                server.players.forEach((_, p) => {
                    liveById.set(p.id, p);
                });
                server.players.forEachBot((p) => {
                    liveById.set(p.id, p);
                });
            }
            return liveById;
        },
        buildAnimPayload: (player) => server.appearanceService.buildAnimPayload(player),
        serializeAppearancePayload: (view) => server.serializeAppearancePayload(view),
        resolveHealthBarWidth: (defId) => {
            try {
                const def = server.healthBarDefLoader?.load?.(defId);
                return Math.max(1, Math.min(255, def?.width ?? 30));
            } catch (err) {
                logger.warn("Failed to resolve player health bar width", err);
                return 30;
            }
        },
        encodeHuffmanChat: (text) => {
            const raw = encodeCp1252Bytes(text);
            if (!huffman) {
                return raw;
            }
            const maxCompressed = raw.length * 4 + 8;
            const buf = new Uint8Array(maxCompressed);
            let off = 0;
            // smartByteShort encoding
            const len = raw.length;
            if (len >= 0 && len < 128) {
                buf[off++] = len & 0xff;
            } else if (len >= 0 && len < 32768) {
                const vv = (len + 32768) & 0xffff;
                buf[off++] = (vv >> 8) & 0xff;
                buf[off++] = vv & 0xff;
            }
            const written = huffman.compress(raw, 0, raw.length, buf, off);
            return buf.subarray(0, off + written);
        },
    };
    return new PlayerPacketEncoder(services);
}

export function createCombatActionHandler(server: WSServerContext): CombatActionHandler {
    const services: CombatActionServices = {
        // --- Core Entity Access ---
        getPlayer: (id) => server.players?.getById(id) ?? undefined,
        getNpc: (id) => server.npcManager?.getById(id) ?? undefined,
        getCurrentTick: () => server.options.ticker.currentTick(),
        getPathService: () => server.options.pathService,

        // --- Equipment/Appearance ---
        getEquipArray: (player) => server.equipmentService.ensureEquipArray(player),
        getEquipQtyArray: (player) =>
            ensureEquipQtyArrayOn(player.appearance, EQUIP_SLOT_COUNT),
        markEquipmentDirty: (player) => player.markEquipmentDirty(),
        markAppearanceDirty: (player) => player.markAppearanceDirty(),

        // --- Combat Utilities ---
        pickAttackSequence: (player) => server.playerCombatService!.pickAttackSequence(player),
        pickAttackSpeed: (player) => server.playerCombatService!.pickAttackSpeed(player),
        pickHitDelay: (player) => server.playerCombatService!.pickHitDelay(player),
        getPlayerAttackReach: (player) => server.playerCombatService!.getPlayerAttackReach(player),
        pickNpcFaceTile: (player, npc) => server.playerCombatService!.pickNpcFaceTile(player, npc),
        pickCombatSound: (player, isHit) => server.playerCombatService!.pickCombatSound(player, isHit),
        getRangedImpactSound: (player) => {
            const equip = server.equipmentService.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            return getRangedImpactSound(weaponId);
        },
        deriveAttackTypeFromStyle: (style, player) =>
            server.playerCombatService!.deriveAttackTypeFromStyle(style, player),
        pickBlockSequence: (player) =>
            server.playerCombatManager?.pickBlockSequence(player, server.appearanceService.getWeaponAnimOverrides()) ?? -1,

        // --- NPC Combat ---
        getNpcCombatSequences: (typeId) => server.combatDataService.getNpcCombatSequences(typeId),
        getNpcHitSoundId: (typeId) => server.combatDataService.getNpcHitSoundId({ typeId } as unknown as NpcState),
        getNpcDefendSoundId: (typeId) => server.combatDataService.getNpcDefendSoundId({ typeId } as unknown as NpcState),
        getNpcDeathSoundId: (typeId) => server.combatDataService.getNpcDeathSoundId({ typeId } as unknown as NpcState),
        getNpcAttackSoundId: (typeId) => server.combatDataService.getNpcAttackSoundId({ typeId } as unknown as NpcState),
        resolveNpcAttackType: (npc, hint) => server.combatEffectService.resolveNpcAttackType(npc, hint),
        resolveNpcAttackRange: (npc, attackType) => server.combatEffectService.resolveNpcAttackRange(npc, attackType),
        broadcastNpcSequence: (npc, seqId) => server.combatEffectService.broadcastNpcSequence(npc, seqId),
        estimateNpcDespawnDelayTicksFromSeq: (seqId) =>
            server.combatEffectService.estimateNpcDespawnDelayTicksFromSeq(seqId),

        // --- Projectile ---
        estimateProjectileTiming: (params) => server.projectileTimingService!.estimateProjectileTiming(params as unknown as { player: PlayerState; targetX?: number; targetY?: number }),
        buildPlayerRangedProjectileLaunch: (params) =>
            server.projectileTimingService!.buildPlayerRangedProjectileLaunch(params),

        // --- Spell/Magic ---
        processSpellCastRequest: (player, request) =>
            server.spellActionHandler!.processSpellCastRequest(
                player,
                request as unknown as import("../game/actions/handlers/SpellActionHandler").SpellCastRequest,
                server.options.ticker.currentTick(),
            ),
        queueSpellResult: (playerId, result) => server.broadcastService.queueSpellResult(playerId, result),
        pickSpellSound: (spellId, stage) => server.playerCombatService!.pickSpellSound(spellId, stage),
        resetAutocast: (player) => server.equipmentService.resetAutocast(player),

        // --- Effect Dispatching ---
        broadcastSound: (request, tag) => server.broadcastService.broadcastSound(request, tag),
        withDirectSendBypass: (tag, fn) => server.networkLayer.withDirectSendBypass(tag, fn),
        enqueueSpotAnimation: (request) => server.broadcastService.enqueueSpotAnimation(request),
        queueChatMessage: (request) => server.messagingService.queueChatMessage(request),
        queueCombatState: (player) => server.queueCombatState(player),
        queueSkillSnapshot: (playerId, sync) =>
            server.skillService.queueSkillSnapshot(playerId, sync as SkillSyncUpdate),
        dispatchActionEffects: (effects) =>
            server.effectDispatcher!.dispatchActionEffects(effects),
        broadcast: (data, tag) => server.broadcastService.broadcast(data, tag),
        encodeMessage: (msg) => encodeMessage(msg as unknown as import("./messages").ServerToClient),

        // --- Action Scheduling ---
        scheduleAction: (playerId, request, tick) =>
            server.actionScheduler.requestAction(playerId, request, tick),
        cancelActions: (playerId, predicate) =>
            server.actionScheduler.cancelActions(playerId, predicate),

        // --- Player Interaction State ---
        getPlayerSocket: (playerId) => server.players?.getSocketByPlayerId(playerId),
        getInteractionState: (socket) =>
            socket ? server.players?.getInteractionState(socket as WebSocket) : undefined,
        startNpcAttack: (socket, npc, tick, attackSpeed) =>
            server.players?.startNpcAttack(socket as WebSocket, npc, tick, attackSpeed) ?? {
                ok: false,
            },
        stopPlayerCombat: (socket) => server.players?.stopPlayerCombat(socket as WebSocket),
        startPlayerCombat: (socket, targetId) =>
            server.players?.startPlayerCombat(socket as WebSocket, targetId),
        clearInteractionsWithNpc: (npcId) => server.players?.clearInteractionsWithNpc(npcId),
        sendSkillsMessage: (socket, player) => {
            if (socket instanceof WebSocket) {
                const sync = player.skillSystem.takeSkillSync();
                if (sync) server.skillService.queueSkillSnapshot(player.id, sync);
            }
        },

        // --- Combat System ---
        startNpcCombat: (player, npc, tick, attackSpeed) =>
            server.playerCombatManager?.startCombat(player, npc, tick, attackSpeed),
        resumeAutoAttack: (playerId) => server.playerCombatManager?.resumeAutoAttack(playerId),
        confirmHitLanded: (playerId, tick, npc, damage, attackType, player) =>
            server.playerCombatManager?.confirmHitLanded(
                playerId,
                npc,
                tick,
                damage,
                attackType,
                player,
            ),
        extendAggroHold: (playerId, minimumTicks) =>
            server.playerCombatManager?.extendAggroHold(playerId, minimumTicks),
        rollRetaliateDamage: (npc, player) =>
            server.playerCombatManager?.rollRetaliateDamage(npc, player) ?? 0,
        getDropEligibility: (npc) => server.playerCombatManager?.getDropEligibility?.(npc),
        rollNpcDrops: (npc, eligibility) => server.combatEffectService.rollNpcDrops(npc, eligibility),
        cleanupNpc: (npc) => server.playerCombatManager?.cleanupNpc?.(npc),

        // --- Ground Items ---
        spawnGroundItem: (itemId, quantity, location, tick, options) =>
            server.groundItems.spawn(itemId, quantity, location, tick, options),

        // --- NPC Manager ---
        queueNpcDeath: (npcId, despawnTick, respawnTick, drops) =>
            server.npcManager?.queueDeath?.(npcId, despawnTick, respawnTick, drops) ?? false,

        // --- Prayer/Combat Effects ---
        applyProtectionPrayers: (target, damage, attackType, sourceType) =>
            server.combatEffectService.applyProtectionPrayers(target, damage, attackType, sourceType),
        applySmite: (attacker, target, damage) => server.combatEffectService.applySmite(attacker, target, damage),
        tryActivateRedemption: (player) => server.combatEffectService.tryActivateRedemption(player),
        closeInterruptibleInterfaces: (player) => server.interfaceManager.closeInterruptibleInterfaces(player),
        applyMultiTargetSpellDamage: (params) => server.combatEffectService.applyMultiTargetSpellDamage(params),

        // --- XP Awards ---
        awardCombatXp: (player, damage, hitData, effects) =>
            server.skillService.awardCombatXp(player, damage, hitData, effects),
        getSkillXpMultiplier: (player) => server.gamemode.getSkillXpMultiplier(player),

        // --- Special Attacks ---
        getSpecialAttack: (weaponId) => getSpecialAttack(weaponId),
        pickSpecialAttackVisualOverride: (weaponId) =>
            pickSpecialAttackVisualOverride(weaponId),

        // --- Ammo Consumption ---
        consumeEquippedAmmoApply: (params) => consumeEquippedAmmoApply(params),
        calculateAmmoConsumption: (
            weaponId,
            ammoId,
            ammoQty,
            capeId,
            targetX,
            targetY,
            randFn,
        ) =>
            calculateAmmoConsumption(
                weaponId,
                ammoId,
                ammoQty,
                capeId,
                targetX,
                targetY,
                randFn,
            ),

        // --- Magic Autocast ---
        canWeaponAutocastSpell: (weaponId, spellId) =>
            canWeaponAutocastSpell(weaponId, spellId),
        getAutocastCompatibilityMessage: (reason) =>
            getAutocastCompatibilityMessage(reason as import("../game/spells/SpellDataProvider").AutocastCompatibilityResult["reason"]),

        // --- Spell Caster ---
        validateSpellCast: (context) => SpellCaster.validate(context),
        executeSpellCast: (context, validation) => SpellCaster.execute(context, validation),

        // --- Spell Data ---
        getSpellData: (spellId) => getSpellData(spellId),
        getSpellBaseXp: (spellId) => getSpellBaseXp(spellId),
        getProjectileParams: (projectileId) =>
            projectileId !== undefined ? getProjectileParams(projectileId) : undefined,

        // --- Hitsplat Applicator ---
        applyNpcHitsplat: (npc, style, damage, tick, maxHit) =>
            combatEffectApplicator.applyNpcHitsplat(npc, style, damage, tick, maxHit),
        applyPlayerHitsplat: (player, style, damage, tick, maxHit) =>
            combatEffectApplicator.applyPlayerHitsplat(player, style, damage, tick, maxHit),

        // --- Wilderness Check ---
        isInWilderness: (x, y) => isInWilderness(x, y),

        // --- Range Checks ---
        isWithinAttackRange: (attacker, target, range) =>
            isWithinAttackRange(attacker, target, range),
        hasDirectMeleeReach: (attacker, target, pathService) =>
            hasDirectMeleeReach(attacker, target, pathService),
        hasDirectMeleePath: (attacker, target, pathService) =>
            hasDirectMeleePath(attacker, target, pathService),

        // --- Helpers ---
        normalizeAttackType: (value) => normalizeAttackType(value),
        isActiveFrame: () => !!server.activeFrame,
        log: (level, message) => {
            try {
                if (level === "warn") logger.warn(message);
                else if (level === "error") logger.error(message);
                else logger.info(message);
            } catch (err) { logger.warn("Failed to log combat message", err); }
        },

        // --- NPC Info ---
        getNpcName: (typeId) => {
            try {
                return server.npcTypeLoader?.load(typeId)?.name;
            } catch (err) {
                logger.warn("Failed to load NPC name for typeId", err);
                return undefined;
            }
        },

        // --- Gamemode Events ---
        onNpcKill: (playerId, npcTypeId, combatLevel, npc) => {
            server.gamemode.onNpcKill(playerId, npcTypeId, combatLevel);
            server.eventBus.emit("npc:death", {
                npc: npc!,
                npcTypeId,
                combatLevel,
                killerPlayerId: playerId,
                tile: npc
                    ? { x: npc.tileX, y: npc.tileY, level: npc.level }
                    : { x: 0, y: 0, level: 0 },
            });
        },
    };
    return new CombatActionHandler(services);
}

export function createSpellActionHandler(server: WSServerContext): SpellActionHandler {
    const services: SpellActionServices = {
        // --- Core ---
        getCurrentTick: () => server.options.ticker.currentTick(),
        getDeliveryTick: () =>
            server.activeFrame ? server.activeFrame.tick : server.options.ticker.currentTick() + 1,
        getTickMs: () => server.options.tickMs,
        getFramesPerTick: () => Math.max(1, Math.round(server.options.tickMs / 20)),

        // --- Entity Access ---
        getNpc: (id) => server.npcManager?.getById(id) ?? undefined,
        getPlayer: (id) => server.players?.getById(id) ?? undefined,
        getPlayerSocket: (playerId) => server.players?.getSocketByPlayerId(playerId),
        getNpcType: (npc) => server.npcManager?.getNpcType(npc),

        // --- Spell Data ---
        getSpellData: (spellId) => getSpellData(spellId),
        getSpellDataByWidget: (groupId, childId) => getSpellDataByWidget(groupId, childId),
        getProjectileParams: (projectileId) =>
            projectileId !== undefined ? getProjectileParams(projectileId) : undefined,
        canWeaponAutocastSpell: (weaponId, spellId) =>
            canWeaponAutocastSpell(weaponId, spellId),
        getSpellBaseXp: (spellId) => getSpellBaseXp(spellId),

        // --- Spell Validation/Execution ---
        validateSpellCast: (context) => SpellCaster.validate(context),
        executeSpellCast: (context, validation) => SpellCaster.execute(context, validation),

        // --- Projectile ---
        computeProjectileEndHeight: (opts) => server.projectileTimingService!.computeProjectileEndHeight(opts),
        estimateProjectileTiming: (opts) => server.projectileTimingService!.estimateProjectileTiming(opts),
        buildAndQueueSpellProjectileLaunch: (opts) => {
            if (!server.projectileSystem) return;
            const launch = server.projectileSystem.buildSpellProjectileLaunch({
                player: opts.player,
                targetNpc: opts.targetNpc,
                targetPlayer: opts.targetPlayer,
                targetTile: opts.targetTile,
                spellData: opts.spellData,
                projectileDefaults: opts.projectileDefaults,
                endHeight: opts.endHeight,
                timing: opts.timing,
                impactDelayTicks: opts.impactDelayTicks,
            });
            if (launch) {
                server.projectileTimingService!.queueProjectileForViewers(launch);
            }
        },

        // --- Effects ---
        queueSpellResult: (playerId, payload) => server.broadcastService.queueSpellResult(playerId, payload),
        enqueueSpotAnimation: (request) => server.broadcastService.enqueueSpotAnimation(request),
        enqueueSpellFailureChat: (player, spellId, reason) =>
            server.spellCastingService!.enqueueSpellFailureChat(player, spellId, reason),
        pickSpellSound: (spellId, stage) => server.playerCombatService!.pickSpellSound(spellId, stage),
        broadcastSound: (request, tag) => server.broadcastService.broadcastSound(request, tag),
        withDirectSendBypass: (tag, fn) => server.networkLayer.withDirectSendBypass(tag, fn),
        resetAutocast: (player) => server.equipmentService.resetAutocast(player),

        // --- Combat State ---
        queueCombatSnapshot: (
            playerId,
            weaponCategory,
            weaponItemId,
            autoRetaliate,
            styleSlot,
            activePrayers,
            specialPercent,
        ) =>
            server.queueCombatSnapshot(
                playerId,
                weaponCategory,
                weaponItemId,
                autoRetaliate,
                styleSlot,
                activePrayers,
                specialPercent,
            ),
        pickAttackSequence: (player) => server.playerCombatService!.pickAttackSequence(player),
        pickSpellCastSequence: (player, spellId, isAutocast) =>
            server.playerCombatService!.pickSpellCastSequence(player, spellId, isAutocast),
        pickAttackSpeed: (player) => server.playerCombatService!.pickAttackSpeed(player),
        clearAllInteractions: (socket) => server.players?.clearAllInteractions(socket),
        clearActionsInGroup: (playerId, group) =>
            server.actionScheduler.clearActionsInGroup(playerId, group),
        startNpcCombat: (player, npc, tick, attackSpeed) => {
            server.playerCombatManager?.startCombat(player, npc, tick, attackSpeed);
        },
        stopAutoAttack: (playerId) => server.playerCombatManager?.stopAutoAttack(playerId),

        // --- Inventory ---
        sendInventorySnapshot: (socket, player) => server.inventoryService.sendInventorySnapshot(socket, player),

        // --- Action Scheduling ---
        scheduleAction: (playerId, request, tick) =>
            server.actionScheduler.requestAction(playerId, request, tick),

        // --- XP ---
        awardSkillXp: (player, skillId, xp) => server.skillService.awardSkillXp(player, skillId, xp),

        // --- PvP Combat ---
        planPlayerVsPlayerMagic: (attacker, target) => {
            try {
                const engine = new CombatEngine();
                const res = engine.planPlayerVsPlayerMagic(attacker, target);
                return {
                    hitLanded: !!res.hitLanded,
                    maxHit: res.maxHit,
                    damage: res.damage,
                };
            } catch {
                return { hitLanded: false, maxHit: 0, damage: 0 };
            }
        },
        planPlayerVsNpcMagic: (attacker, target, spellId) => {
            try {
                const engine = new CombatEngine();
                const magicCaster = Object.create(attacker) as PlayerState;
                (magicCaster as unknown as { combat: typeof attacker.combat }).combat = Object.create(attacker.combat);
                magicCaster.combat.spellId = spellId;
                magicCaster.combat.autocastEnabled = false;
                magicCaster.combat.autocastMode = null;
                (magicCaster as unknown as { getCurrentAttackType: () => string }).getCurrentAttackType = () => "magic";
                const res = engine.planPlayerAttack({
                    player: magicCaster,
                    npc: target,
                    attackSpeed: server.playerCombatService!.pickAttackSpeed(attacker),
                });
                return {
                    hitLanded: !!res.hitLanded,
                    maxHit: res.maxHit,
                    damage: res.damage,
                };
            } catch {
                return { hitLanded: false, maxHit: 0, damage: 0 };
            }
        },

        // --- Helpers ---
        faceAngleRs: (x1, y1, x2, y2) => faceAngleRs(x1, y1, x2, y2),
        testRandFloat: () => testRandFloat(),
        getTestHitForce: () => TEST_HIT_FORCE,

        // --- Logging ---
        log: (level, message, data) => {
            try {
                if (level === "warn") logger.warn(message, data);
                else if (level === "error") logger.error(message, data);
                else logger.info(message, data);
            } catch (err) { logger.warn("Failed to log spell action message", err); }
        },
    };
    return new SpellActionHandler(services);
}

export function createInventoryActionHandler(server: WSServerContext): InventoryActionHandler {
    const services: InventoryActionServices = {
        // --- Core ---
        getCurrentTick: () => server.options.ticker.currentTick(),

        // --- Entity Access ---
        getNpc: (id) => server.npcManager?.getById(id) ?? undefined,
        getPlayer: (id) => server.players?.getById(id) ?? undefined,

        // --- Inventory Operations ---
        getInventory: (player) => server.inventoryService.getInventory(player),
        addItemToInventory: (player, itemId, quantity) =>
            server.inventoryService.addItemToInventory(player, itemId, quantity),
        consumeItem: (player, slot) => server.inventoryService.consumeItem(player, slot),
        countInventoryItem: (player, itemId) => server.inventoryService.countInventoryItem(player, itemId),
        markInventoryDirty: (player) => player.markInventoryDirty(),

        // --- Equipment ---
        resolveEquipSlot: (itemId) => server.equipmentService.resolveEquipSlot(itemId),
        equipItem: (player, slotIndex, itemId, equipSlot, options) =>
            server.equipmentService.equipItem(player, slotIndex, itemId, equipSlot, options),
        unequipItem: (player, equipSlot) => {
            // Unequipping closes interruptible interfaces (modals, dialogs)
            server.interfaceManager.closeInterruptibleInterfaces(player);

            const appearance = server.appearanceService.getOrCreateAppearance(player);
            return unequipItemApply({
                appearance,
                equipSlot,
                addItemToInventory: (id, qty) => server.inventoryService.addItemToInventory(player, id, qty),
                slotCount: EQUIP_SLOT_COUNT,
            });
        },
        ensureEquipArray: (player) => server.equipmentService.ensureEquipArray(player),
        refreshCombatWeaponCategory: (player) => server.equipmentService.refreshCombatWeaponCategory(player),
        refreshAppearanceKits: (player) => server.appearanceService.refreshAppearanceKits(player),
        resetAutocast: (player) => server.equipmentService.resetAutocast(player),
        pickEquipSound: (slot, itemName) => pickEquipSound(slot, itemName),

        // --- Object Types ---
        getObjType: (itemId) => server.dataLoaderService.getObjType(itemId),
        isConsumable: (obj, option) => server.inventoryMessageService!.isConsumable(obj as { inventoryActions?: Array<string | null | undefined> } | undefined, option),

        // --- Pathfinding ---
        createRectAdjacentStrategy: (x, y, sizeX, sizeY) =>
            new RectAdjacentRouteStrategy(x, y, sizeX, sizeY),
        findPathSteps: (from, to, size, strategy) => {
            const pathService = server.options.pathService;
            if (!pathService) return { ok: false };
            const res = pathService.findPathSteps(
                {
                    from,
                    to,
                    size,
                },
                {
                    maxSteps: 128,
                    routeStrategy: strategy as unknown as import("../pathfinding/legacy/pathfinder/RouteStrategy").RouteStrategy,
                },
            );
            return { ok: res.ok, steps: res.steps, end: res.end };
        },

        // --- Action Scheduling ---
        scheduleAction: (playerId, request, tick) =>
            server.actionScheduler.requestAction(playerId, request, tick),

        // --- Effects ---
        queueChatMessage: (request) => server.messagingService.queueChatMessage(request),
        buildSkillFailure: (player, message, reason) =>
            server.skillService.buildSkillFailure(player, message, reason),
        playLocSound: (request) => server.soundService.playLocSound(request),

        // --- Script Runtime ---
        queueLocInteraction: (request) => server.scriptRuntime.queueLocInteraction(request),
        queueItemOnLoc: (request) => server.scriptRuntime.queueItemOnLoc(request),
        queueItemOnItem: (request) => server.scriptRuntime.queueItemOnItem(request),

        // --- Scripted Consume ---
        executeScriptedConsume: (player, itemId, slotIndex, option, tick) => {
            const handler = server.scriptRegistry.findItemAction(itemId, option);
            if (handler) {
                handler({
                    player,
                    source: { slot: slotIndex, itemId },
                    target: { slot: -1, itemId: -1 },
                    option,
                    tick: tick ?? 0,
                    services: server.scriptRuntime.getServices(),
                });
                return { handled: true };
            }
            return { handled: false };
        },

        // --- Logging ---
        log: (level, message, data) => {
            try {
                if (level === "warn") logger.warn(message, data);
                else if (level === "error") logger.error(message, data);
                else logger.info(message, data);
            } catch (err) { logger.warn("Failed to log inventory action message", err); }
        },
    };
    return new InventoryActionHandler(services);
}

export function createEffectDispatcher(server: WSServerContext): EffectDispatcher {
    const services: EffectDispatcherServices = {
        // --- Entity Access ---
        getPlayer: (id) => server.players?.getById(id) ?? undefined,
        getPlayerSocket: (playerId) => server.players?.getSocketByPlayerId(playerId),
        isSocketOpen: (socket) => socket?.readyState === WebSocket.OPEN,

        // --- Effect Queueing ---
        enqueueForcedChat: (event) => server.messagingService.enqueueForcedChat(event),
        enqueueForcedMovement: (event) => server.broadcastService.enqueueForcedMovement(event),
        enqueueLevelUpPopup: (player, popup) => server.interfaceManager.enqueueLevelUpPopup(player, popup),
        queueHitsplat: (hitsplat, frame) => {
            if (frame) {
                frame.hitsplats.push(hitsplat);
            } else {
                server.broadcastScheduler.queueHitsplat(hitsplat);
            }
        },

        // --- Snapshots ---
        checkAndSendSnapshots: (player, socket) => server.tickPhaseService.checkAndSendSnapshots(player, socket),

        // --- Chat ---
        queueChatMessage: (request) => server.messagingService.queueChatMessage(request),

        // --- Sound ---
        sendSound: (player, soundId, options) => server.soundService.sendSound(player, soundId, options),

        // --- Projectile ---
        queueProjectileForViewers: (projectile) => server.projectileTimingService!.queueProjectileForViewers(projectile),

        // --- Frame Access ---
        getActiveFrame: () => server.activeFrame,

        // --- Constants ---
        getPlayerTakeDamageSound: () => PLAYER_TAKE_DAMAGE_SOUND,
        getPlayerZeroDamageSound: () => PLAYER_ZERO_DAMAGE_SOUND,
        getCombatSoundDelayMs: () => COMBAT_SOUND_DELAY_MS,

        // --- Logging ---
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else logger.info(message);
        },
    };
    return new EffectDispatcher(services);
}

export function createWidgetDialogHandler(server: WSServerContext): WidgetDialogHandler {
    const services: WidgetDialogServices = {
        // --- Entity Access ---
        getPlayer: (id) => server.players?.getById(id) ?? undefined,
        getPlayerFromSocket: (ws) => server.players?.get(ws as WebSocket) ?? undefined,

        // --- Tick ---
        getCurrentTick: () => server.options.ticker.currentTick(),

        // --- Widget Events ---
        queueWidgetEvent: (playerId, action) => server.queueWidgetEvent(playerId, action as WidgetAction),
        queueClientScript: (playerId, scriptId, ...args) =>
            server.broadcastService.queueClientScript(playerId, scriptId, ...args),
        queueVarbit: (playerId, varbitId, value) => server.variableService.queueVarbit(playerId, varbitId, value),

        // --- Script Runtime ---
        queueWidgetAction: (request) => server.scriptRuntime.queueWidgetAction(request),

        // --- Shop/Smithing/Bank ---
        closeShopInterface: (player, options) => server.scriptRuntime.getServices().closeShop?.(player),
        closeBank: (player) => server.interfaceService?.closeModal(player),
        queueSmithingInterfaceMessage: (playerId, payload) =>
            server.broadcastService.queueSmithingInterfaceMessage(playerId, payload as import("./messages").SmithingServerPayload),

        // --- Constants ---
        getShopGroupId: () => 300,
        getBankGroupId: () => 12,

        // --- Logging ---
        log: (level, message, error) => {
            if (level === "error") logger.error(message, error);
            else if (level === "warn") logger.warn(message, error);
            else if (level === "debug") logger.debug(message);
            else logger.info(message);
        },
    };
    // Pass InterfaceService for unified chatbox modal management
    return new WidgetDialogHandler(services, server.interfaceService!);
}

export function createCs2ModalManager(server: WSServerContext): Cs2ModalManager {
    const services: Cs2ModalManagerServices = {
        openModal: (player, interfaceId, data) =>
            server.interfaceService?.openModal(player, interfaceId, data),
        closeModal: (player) => server.interfaceService?.closeModal(player),
        getCurrentModal: (player) => server.interfaceService?.getCurrentModal(player),
        queueWidgetEvent: (playerId, event) => server.queueWidgetEvent(playerId, event as WidgetAction),
        queueGameMessage: (playerId, text) =>
            server.messagingService.queueChatMessage({
                messageType: "game",
                text: String(text ?? ""),
                targetPlayerIds: [playerId],
            }),
        setSmithingBarType: (player, barType) =>
            player.varps.setVarbitValue(3216, barType),
        openSmithingForgeInterface: (player) => {
            server.scriptRuntime.getServices().production?.openForgeInterface?.(player);
        },
    };
    return new Cs2ModalManager(services);
}

export function createNpcSyncManager(server: WSServerContext): NpcSyncManager {
    const services: NpcSyncManagerServices = {
        // --- NPC Access ---
        getNpcManager: () => server.npcManager,

        // --- Health Bar Definitions ---
        getHealthBarDefLoader: () => server.healthBarDefLoader,

        // --- Packet Buffer Access ---
        getPendingNpcPackets: () => server.pendingNpcPackets,

        // --- Logging ---
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else if (level === "debug") logger.debug(message);
            else logger.info(message);
        },
    };
    return new NpcSyncManager(services);
}

export function createPlayerAppearanceManager(server: WSServerContext): PlayerAppearanceManager {
    const services: PlayerAppearanceServices = {
        getPendingAppearanceSnapshots: () => server.broadcastScheduler.getPendingAppearanceSnapshots(),
        getObjTypeLoader: () => server.objTypeLoader,
        getBasTypeLoader: () => server.basTypeLoader as unknown as import("./managers/PlayerAppearanceManager").BasTypeLoaderRef | undefined,
        getIdkTypeLoader: () => server.idkTypeLoader as unknown as import("./managers/PlayerAppearanceManager").IdkTypeLoaderRef | undefined,
        getDefaultBodyKits: (gender) => server.appearanceService.getDefaultBodyKits(gender),
        ensureEquipArray: (player) => server.equipmentService.ensureEquipArray(player),
        getObjType: (id) => server.dataLoaderService.getObjType(id),
        buildAnimPayload: (player) => server.appearanceService.buildAnimPayload(player),
        getDefaultPlayerAnimMale: () => server.defaultPlayerAnimMale,
        getDefaultPlayerAnimFemale: () => server.defaultPlayerAnimFemale,
        getDefaultPlayerAnim: () => server.defaultPlayerAnim,
        getWeaponAnimOverrides: () => server.appearanceService.getWeaponAnimOverrides(),
        applyWeaponAnimOverrides: (player, animTarget) =>
            server.appearanceService.applyWeaponAnimOverrides(player, animTarget),
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else if (level === "debug") logger.debug(message);
            else logger.info(message);
        },
    };
    return new PlayerAppearanceManager(services);
}

export function createSoundManager(server: WSServerContext): SoundManager {
    const services: SoundManagerServices = {
        getPlayers: () => server.players,
        getNpcSoundLookup: () => server.npcSoundLookup,
        getMusicRegionService: () => server.musicRegionService,
        getMusicCatalogService: () => server.musicCatalogService,
        getMusicUnlockService: () => server.musicUnlockService,
        getNpcTypeLoader: () => server.npcTypeLoader,
        getDbRepository: () => server.dbRepository,
        getWeaponData: () => server.appearanceService.getWeaponData(),
        ensureEquipArray: (player) => server.equipmentService.ensureEquipArray(player),
        getCurrentTick: () => server.options.ticker.currentTick(),
        random: () => Math.random(),
        getVarpMusicPlay: () => VARP_MUSICPLAY,
        getVarpMusicCurrentTrack: () => VARP_MUSIC_CURRENT_TRACK,
        sendWithGuard: (sock, message, context) => server.networkLayer.sendWithGuard(sock, message, context),
        encodeMessage: (msg) => encodeMessage(msg as unknown as import("./messages").ServerToClient),
        queueChatMessage: (request) => server.messagingService.queueChatMessage(request),
        queueClientScript: (playerId, scriptId, ...args) =>
            server.broadcastService.queueClientScript(playerId, scriptId, ...args),
        queueVarp: (playerId, varpId, value) => server.variableService.queueVarp(playerId, varpId, value),
        broadcastToNearby: (x, y, level, radius, message, context) =>
            server.broadcastService.broadcastToNearby(x, y, level, radius, message, context),
        withDirectSendBypass: (context, fn) => server.networkLayer.withDirectSendBypass(context, fn),
        getNpcCombatDefs: () => server.npcCombatDefs,
        getNpcCombatDefaults: () =>
            (server.npcCombatDefaults as { deathSound: number }) ?? {
                deathSound: 512,
            },
        loadNpcCombatDefs: () => server.combatDataService.loadNpcCombatDefs(),
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else if (level === "debug") logger.debug(message);
            else logger.info(message);
        },
    };
    return new SoundManager(services);
}

export function createGroundItemHandler(server: WSServerContext): GroundItemHandler {
    const players = server.players;
    if (!players) {
        throw new Error("Player manager unavailable for ground item handler");
    }
    const services: GroundItemHandlerServices = {
        getGroundItems: () => server.groundItems,
        getPlayers: () => players,
        getCurrentTick: () => server.options.ticker.currentTick(),
        getPlayerGroundSerial: () => server.playerGroundSerial!,
        getPlayerGroundChunk: () => server.playerGroundChunk!,
        getGroundChunkKey: (player) => GroundItemHandler.getGroundChunkKey(player),
        addItemToInventory: (player, itemId, quantity) =>
            server.inventoryService.addItemToInventory(player, itemId, quantity),
        getItemDefinition: (itemId) => server.dataLoaderService.getObjType(itemId) ?? getItemDefinition(itemId),
        isInWilderness: (x, y) => isInWilderness(x, y),
        sendPickupSound: (player) => server.soundService.sendSound(player, 2582),
        sendLootNotification: (player, itemId, quantity) =>
            server.messagingService.sendLootNotification(player, itemId, quantity),
        trackCollectionLogItem: (player, itemId) =>
            server.collectionLogService.trackCollectionLogItem(player, itemId),
        queueChatMessage: (request) => server.messagingService.queueChatMessage(request),
        sendWithGuard: (sock, message, context) => server.networkLayer.sendWithGuard(sock, message, context),
        encodeMessage: (msg) => encodeMessage(msg as unknown as import("./messages").ServerToClient),
        withDirectSendBypass: (context, fn) => server.networkLayer.withDirectSendBypass(context, fn),
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else if (level === "debug") logger.debug(message);
            else logger.info(message);
        },
    };
    return new GroundItemHandler(services);
}

export function createPlayerDeathService(server: WSServerContext): PlayerDeathService {
    const services: PlayerDeathServices = {
        groundItemManager: server.groundItems,
        getCurrentTick: () => server.options.ticker.currentTick(),
        isInWilderness: (x, y) => isInWilderness(x, y),
        getWildernessLevel: (x, y) => getWildernessLevel(x, y),
        getItemDefinition: (itemId) => getItemDefinition(itemId),
        sendMessage: (player, message) => {
            // Queue chat message - will be processed during broadcast phase
            server.messagingService.queueChatMessage({
                messageType: "game",
                text: message,
                targetPlayerIds: [player.id],
            });
        },
        teleportPlayer: (player, x, y, level, forceRebuild = false) =>
            server.movementService.teleportPlayer(player, x, y, level, forceRebuild),
        playAnimation: (player, animId) => {
            try {
                player.queueOneShotSeq(animId, 0);
            } catch (err) { logger.warn("Failed to play death animation", err); }
        },
        clearAnimation: (player) => {
            try {
                player.queueOneShotSeq(-1, 0);
            } catch (err) { logger.warn("Failed to clear death animation", err); }
        },
        refreshAppearance: (player) => {
            server.appearanceService.refreshAppearanceKits(player);
            player.markAppearanceDirty();
            server.playerAppearanceManager!.queueAppearanceSnapshot(player);
            // Note: queueAnimSnapshot is no longer needed here since the appearance block
            // now includes the animation set
        },
        sendInventoryUpdate: (player) => {
            const sock = server.players?.getSocketByPlayerId(player.id);
            if (sock) {
                server.inventoryService.sendInventorySnapshot(sock, player);
            }
        },
        playJingle: (player, jingleId) => {
            server.soundManager?.sendJingle(player, jingleId);
        },
        pathService: server.options.pathService,
        log: (level, message) => {
            if (level === "error") logger.error(`[death] ${message}`);
            else if (level === "warn") logger.warn(`[death] ${message}`);
            else logger.info(`[death] ${message}`);
        },
        clearCombat: (player) => {
            const sock = server.players?.getSocketByPlayerId(player.id);
            if (sock) {
                try { server.players?.clearAllInteractions(sock); } catch (err) { logger.warn("Failed to clear combat interactions on death", err); }
            }
        },
        clearNpcTargetsForPlayer: (playerId) => {
            const nowTick = server.options.ticker.currentTick();
            server.npcManager?.forEach((npc) => {
                try {
                    if (npc.getCombatTargetPlayerId() === playerId) {
                        npc.disengageCombat();
                        // Delay next aggression check by 10 ticks (6s) so the NPC
                        // does not immediately re-aggro the respawned player
                        npc.scheduleNextAggressionCheck(nowTick, 10);
                    }
                } catch (err) { logger.warn("Failed to clear NPC combat target for player", err); }
            });
        },
    };
    return new PlayerDeathService({ services });
}

export function createProjectileSystem(server: WSServerContext): ProjectileSystem {
    const services: ProjectileSystemServices = {
        getCurrentTick: () => server.options.ticker.currentTick(),
        getTickMs: () => server.options.tickMs,
        getActiveFrameTick: () => server.activeFrame?.tick,
        forEachPlayer: (callback) => {
            if (!server.players) return;
            server.players.forEach((_sock, player) => callback(player));
        },
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else logger.info(message);
        },
    };
    return new ProjectileSystem(services);
}

export function createGatheringSystem(server: WSServerContext): GatheringSystemManager {
    const services: GatheringSystemServices = {
        emitLocChange: (oldId, newId, tile, level, opts) =>
            server.locationService.emitLocChange(oldId, newId, tile, level, opts),
        spawnGroundItem: (itemId, quantity, tile, currentTick, opts) =>
            server.groundItems.spawn(itemId, quantity, tile, currentTick, opts),
    };
    return new GatheringSystemManager(services);
}

export function createEquipmentHandler(server: WSServerContext): EquipmentHandler {
    const services: EquipmentHandlerServices = {
        getInventory: (player) => server.inventoryService.getInventory(player),
        getObjType: (itemId) => server.dataLoaderService.getObjType(itemId),
        addItemToInventory: (player, itemId, quantity) =>
            server.inventoryService.addItemToInventory(player, itemId, quantity),
        closeInterruptibleInterfaces: (player) => server.interfaceManager.closeInterruptibleInterfaces(player),
        refreshCombatWeaponCategory: (player) => server.equipmentService.refreshCombatWeaponCategory(player),
        refreshAppearanceKits: (player) => server.appearanceService.refreshAppearanceKits(player),
        resetAutocast: (player) => server.equipmentService.resetAutocast(player),
        playLocSound: (opts) => server.soundService.playLocSound(opts),
        eventBus: server.eventBus,
    };
    return new EquipmentHandler(services);
}

export function createTickOrchestrator(server: WSServerContext): TickPhaseOrchestrator {
    const services: TickPhaseOrchestratorServices = {
        getTickMs: () => server.options.tickMs,
        createTickFrame: (tick, time) => server.tickFrameService.createTickFrame({ tick, time }),
        setActiveFrame: (frame) => {
            server.activeFrame = frame as TickFrame | undefined;
        },
        restorePendingFrame: (frame) => server.tickFrameService.restorePendingFrame(frame as unknown as TickFrame),
        yieldToEventLoop: (stage) => server.tickFrameService.yieldToEventLoop(stage),
        maybeRunAutosave: (frame) => server.tickFrameService.maybeRunAutosave(frame as unknown as TickFrame),
    };
    const phaseProvider: TickPhaseProvider = {
        broadcastTick: (frame) => server.tickPhaseService.broadcastTick(frame as unknown as TickFrame),
        runPreMovementPhase: (frame) => server.tickPhaseService.runPreMovementPhase(frame),
        runMovementPhase: (frame) => server.tickPhaseService.runMovementPhase(frame),
        runMusicPhase: (frame) => server.tickPhaseService.runMusicPhase(frame),
        runScriptPhase: (frame) => server.tickPhaseService.runScriptPhase(frame),
        runCombatPhase: (frame) => server.tickPhaseService.runCombatPhase(frame),
        runDeathPhase: (frame) => server.tickPhaseService.runDeathPhase(frame),
        runPostScriptPhase: (frame) => server.tickPhaseService.runPostScriptPhase(frame),
        runPostEffectsPhase: (frame) => server.tickPhaseService.runPostEffectsPhase(frame),
        runOrphanedPlayersPhase: (frame) => server.tickPhaseService.runOrphanedPlayersPhase(frame),
        runBroadcastPhase: (frame) => server.tickPhaseService.runBroadcastPhase(frame),
    };
    return new TickPhaseOrchestrator(services, phaseProvider);
}

export function registerMessageHandlers(server: WSServerContext, router: MessageRouter): void {
    // Register extracted handlers from MessageHandlers.ts
    const extendedServices: BinaryHandlerExtServices = {
        // Player management
        getPlayer: (ws) => server.players?.get(ws),
        getPlayerById: (id) => server.players?.getById(id),
        startFollowing: (ws, targetId, mode, modifierFlags) =>
            server.players?.startFollowing(ws, targetId, mode, modifierFlags),
        startLocInteract: (ws, opts, currentTick) =>
            server.players?.startLocInteract?.(ws, opts, currentTick),
        clearAllInteractions: (ws) => server.players?.clearAllInteractions(ws),
        startPlayerCombat: (ws, targetId) => server.players?.startPlayerCombat(ws, targetId),

        // Trade
        handleTradeAction: (player, payload, tick) => {
            server.tradeManager?.handleAction(player, payload, tick);
        },

        // Movement
        setPendingWalkCommand: (ws, command) => server.movementService.getPendingWalkCommands().set(ws, command),
        clearPendingWalkCommand: (ws) => server.movementService.getPendingWalkCommands().delete(ws),
        clearActionsInGroup: (playerId, group) =>
            server.actionScheduler.clearActionsInGroup(playerId, group),
        canUseAdminTeleport: (player) => server.authService.isAdminPlayer(player),
        teleportPlayer: (player, x, y, level, forceRebuild = false) =>
            server.movementService.teleportPlayer(player, x, y, level, forceRebuild),
        teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
            server.movementService.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
        teleportToWorldEntity: (player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs) =>
            server.worldEntityService.teleportToWorldEntity(player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs),
        sendWorldEntity: (player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode) =>
            server.worldEntityService.sendWorldEntity(player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode),
        spawnLocForPlayer: (player, locId, tile, level, shape, rotation) =>
            server.locationService.spawnLocForPlayer(player, locId, tile, level, shape, rotation),
        spawnNpc: (config: NpcSpawnConfig) => server.npcManager?.spawnTransientNpc(config),
        initSailingInstance: (player) => server.sailingInstanceManager?.initInstance(player),
        disposeSailingInstance: (player) => server.sailingInstanceManager?.disposeInstance(player),
        removeWorldEntity: (playerId, entityIndex) => server.worldEntityInfoEncoder.removeEntity(playerId, entityIndex),
        queueWorldEntityPosition: (playerId, entityIndex, position) => server.worldEntityInfoEncoder.queuePosition(playerId, entityIndex, position),
        setWorldEntityPosition: (playerId, entityIndex, position) => server.worldEntityInfoEncoder.setPosition(playerId, entityIndex, position),
        queueWorldEntityMask: (playerId, entityIndex, mask) => server.worldEntityInfoEncoder.queueMaskUpdate(playerId, entityIndex, mask),
        buildSailingDockedCollision: () => server.sailingInstanceManager?.buildDockedCollision(),
        applySailingDeckCollision: () => server.sailingInstanceManager?.buildDockedCollision(),
        clearSailingDeckCollision: () => server.sailingInstanceManager?.clearDockedCollision(),
        requestTeleportAction: (player, request) => server.movementService.requestTeleportAction(player, request),

        // Combat/NPC
        getNpcById: (npcId) => server.npcManager?.getById(npcId),
        startNpcAttack: (ws, npc, tick, attackSpeed, modifierFlags) =>
            server.players!.startNpcAttack(ws, npc, tick, attackSpeed, modifierFlags),
        startNpcInteraction: (ws, npc, option, modifierFlags) =>
            server.players?.startNpcInteraction(ws, npc, option, modifierFlags),
        pickAttackSpeed: (player) => server.playerCombatService!.pickAttackSpeed(player),
        startCombat: (player, npc, tick, attackSpeed) =>
            server.playerCombatManager?.startCombat(player, npc, tick, attackSpeed),
        hasNpcOption: (npc, option) => server.npcManager?.hasNpcOption(npc, option) ?? false,
        resolveNpcOption: (npc, opNum) =>
            resolveNpcOptionByOpNum((n) => server.npcTypeLoader?.load(n?.typeId ?? n), npc, opNum),
        resolveLocAction: (player, locId, opNum) =>
            resolveLocActionByOpNum(server.locTypeLoader, locId, opNum, player),
        routePlayer: (ws, to, run, tick) => server.players?.routePlayer(ws, to, run, tick),
        findPath: (opts) =>
            server.options.pathService?.findPath(opts) ?? {
                ok: false,
                message: "path service unavailable",
            },
        edgeHasWallBetween: (x1, y1, x2, y2, level) =>
            server.options.pathService?.edgeHasWallBetween(x1, y1, x2, y2, level) ?? false,

        // Spells
        handleSpellCast: (ws, player, payload, targetType, tick) => {
            if (
                targetType !== "npc" &&
                targetType !== "player" &&
                targetType !== "loc" &&
                targetType !== "obj"
            ) {
                return;
            }
            server.spellActionHandler!.handleSpellCastMessage(
                ws,
                player,
                payload,
                targetType,
                tick,
            );
        },
        handleSpellCastOnItem: (ws, payload) => server.spellCastingService!.handleSpellCastOnItem(ws, payload),

        // Widget/Interface
        handleIfButtonD: () => {},
        handleWidgetAction: (player, payload) => {},
        handleWidgetCloseState: (player, groupId) => {
            server.cs2ModalManager!.handleWidgetCloseState(player, groupId);
            server.widgetDialogHandler!.handleWidgetCloseState(player, groupId);
        },
        openModal: (player, interfaceId, data) =>
            server.interfaceService?.openModal(player, interfaceId, data),
        openIndexedMenu: (player, request) =>
            server.cs2ModalManager!.openIndexedMenu(player, request),
        openSubInterface: (player, targetUid, groupId, type = 0, opts) => {
            if (type === 0 || type === 1) {
                player.widgets.open(groupId, {
                    targetUid,
                    type,
                    modal: opts?.modal !== false,
                });
                return;
            }
            server.queueWidgetEvent(player.id, {
                action: "open_sub",
                targetUid,
                groupId,
                type,
            });
        },
        openDialog: (player, request) =>
            server.widgetDialogHandler!.openDialog(player, request as import("../game/actions/handlers/WidgetDialogHandler").ScriptDialogRequest),
        queueWidgetEvent: (playerId, event) => server.queueWidgetEvent(playerId, event as WidgetAction),
        queueClientScript: (playerId, scriptId, ...args) =>
            server.broadcastService.queueClientScript(playerId, scriptId, ...args),
        queueVarp: (playerId, varpId, value) => server.variableService.queueVarp(playerId, varpId, value),
        queueVarbit: (playerId, varbitId, value) => server.variableService.queueVarbit(playerId, varbitId, value),
        queueNotification: (playerId, notification) =>
            server.messagingService.queueNotification(playerId, notification),
        sendGameMessage: (player, text) => {
            server.messagingService.queueChatMessage({
                messageType: "game",
                text,
                targetPlayerIds: [player.id],
            });
        },
        sendSound: (player, soundId, opts) => server.soundService.sendSound(player, soundId, opts),
        sendVarp: (player, varpId, value) => server.variableService.queueVarp(player.id, varpId, value),
        sendVarbit: (player, varbitId, value) => server.variableService.queueVarbit(player.id, varbitId, value),
        trackCollectionLogItem: (player, itemId) =>
            server.collectionLogService.trackCollectionLogItem(player, itemId),
        sendRunEnergyState: (ws, player) => server.movementService.sendRunEnergyState(ws, player),
        getWeaponSpecialCostPercent: (weaponId) => server.combatDataService.getWeaponSpecialCostPercent(weaponId),
        queueCombatState: (player) => server.queueCombatState(player),
        ensureEquipArray: (player) => server.equipmentService.ensureEquipArray(player),
        gamemodeServices: server.gamemode.getGamemodeServices?.() ?? {},

        // Chat
        queueChatMessage: (msg) => server.messagingService.queueChatMessage(msg),
        getPublicChatPlayerType: (player) => server.authService.getPublicChatPlayerType(player),
        enqueueLevelUpPopup: (player, data) => server.interfaceManager.enqueueLevelUpPopup(player, data),
        findScriptCommand: (name) => server.scriptRegistry.findCommand(name) as ((event: { player: PlayerState; command: string; args: string[]; tick: number; services: Record<string, unknown> }) => string | void | Promise<string | void>) | undefined,
        getCurrentTick: () => server.options.ticker.currentTick(),

        // Debug
        broadcast: (message, context) => server.broadcastService.broadcast(message, context),
        sendWithGuard: (ws, message, context) => server.networkLayer.sendWithGuard(ws, message, context),
        sendAdminResponse: (ws, message, context) =>
            server.networkLayer.sendAdminResponse(ws, message, context),
        withDirectSendBypass: (context, fn) => server.networkLayer.withDirectSendBypass(context, fn),
        encodeMessage: encodeMessage,
        setPendingDebugRequest: (requestId, ws) => server.pendingDebugRequests!.set(requestId, ws),
        getPendingDebugRequest: (requestId) => server.pendingDebugRequests!.get(requestId),

        // Tick
        currentTick: () => server.options.ticker.currentTick(),

        // Constants/Config
        getEquipmentSlotWeapon: () => EquipmentSlot.WEAPON,
        getVarpConstants: () => ({
            VARP_SIDE_JOURNAL_STATE,
            VARP_OPTION_RUN,
            VARP_SPECIAL_ATTACK,
            VARP_ATTACK_STYLE,
            VARP_AUTO_RETALIATE,
            VARP_MAP_FLAGS_CACHED,
        }),
        getVarbitConstants: () => ({
            VARBIT_SIDE_JOURNAL_TAB,
        }),
        getSideJournalConstants: () => ({
            SIDE_JOURNAL_CONTENT_GROUP_BY_TAB: Object.values(
                SIDE_JOURNAL_CONTENT_GROUP_BY_TAB,
            ),
            SIDE_JOURNAL_TAB_CONTAINER_UID,
        }),

        // --- Services for extracted handlers (logout, widget, varp_transmit, if_close) ---
        completeLogout: (ws, player, source) => server.loginHandshakeService.completeLogout(ws, player, source),
        closeInterruptibleInterfaces: (player) => server.interfaceManager.closeInterruptibleInterfaces(player),
        noteWidgetEventForLedger: (playerId, event) => server.interfaceManager.noteWidgetEventForLedger(playerId, event),
        normalizeSideJournalState: (player, value?) => server.normalizeSideJournalState(player, value),
        queueSideJournalGamemodeUi: (player) => server.queueSideJournalGamemodeUi(player),
        syncMusicInterface: (player) => server.soundManager!.syncMusicInterfaceForPlayer(player),
        handleCs2ModalCloseState: (player, groupId) => server.cs2ModalManager!.handleWidgetCloseState(player, groupId),
        handleDialogCloseState: (player, groupId) => server.widgetDialogHandler!.handleWidgetCloseState(player, groupId),
        getInterfaceService: () => server.interfaceService,
        getGamemodeUi: () => server.gamemodeUi,
        getGamemode: () => server.gamemode,

        // --- Services for binary message handlers ---
        resolveGroundItemOptionByOpNum: (itemId, opNum) =>
            resolveGroundItemOptionByOpNum((id) => server.objTypeLoader?.load(id), itemId, opNum),
        handleGroundItemAction: (ws, payload) => server.inventoryMessageService!.handleGroundItemAction(ws, payload),
        getScriptRegistry: () => server.scriptRegistry,
        getScriptRuntime: () => server.scriptRuntime,
        getCs2ModalManager: () => server.cs2ModalManager,
        getWidgetDialogHandler: () => server.widgetDialogHandler,
        getObjType: (itemId) => server.dataLoaderService.getObjType(itemId),
        handleInventoryUseOnMessage: (ws, payload) =>
            server.inventoryMessageService!.handleInventoryUseOnMessage(ws, payload),
        getLevelUpPopupQueue: (playerId) =>
            (server.interfaceManager as unknown as { levelUpPopupQueue?: Map<number, import("../game/services/InterfaceManager").LevelUpPopup[]> }).levelUpPopupQueue?.get(playerId),
        advanceLevelUpPopupQueue: (player) => server.interfaceManager.advanceLevelUpPopupQueue(player),
    };
    registerAllHandlers(router, extendedServices);

    // Simple handlers
    router.register("hello", (ctx) => {
        logger.info(`Hello from ${ctx.payload.client} ${ctx.payload.version ?? ""}`.trim());
    });

    router.register("inventory_use", (ctx) => {
        server.inventoryMessageService!.handleInventoryUseMessage(ctx.ws, ctx.payload);
    });

    // inventory_use_on and ground_item_action are registered by binaryMessageHandlers

    router.register("inventory_move", (ctx) => {
        server.inventoryMessageService!.handleInventoryMoveMessage(ctx.ws, ctx.payload);
    });

    router.register("interact_stop", (ctx) => {
        try {
            // RSMod parity: Use player.resetInteractions() to clear all interactions
            if (ctx.player) {
                ctx.player.resetInteractions();
            }
            // Also clear the interaction system's internal state map
            server.players?.clearAllInteractions(ctx.ws);
        } catch (err) { logger.warn("Failed to handle interact_stop message", err); }
    });


    // More handlers will be added incrementally...
}


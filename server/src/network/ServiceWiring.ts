// @ts-nocheck
/**
 * Factory functions extracted from WSServer.
 * Each receives the server instance and builds service dependency bags.
 *
 * Runtime imports: classes instantiated with `new` must be imported as values.
 * Type-only annotations are covered by @ts-nocheck.
 */

import { logger } from "../utils/logger";
import { encodeMessage } from "./messages";
import { NpcPacketEncoder, PlayerPacketEncoder } from "./encoding";
import {
    NpcSyncManager,
    PlayerAppearanceManager,
    SoundManager,
    GroundItemHandler,
    Cs2ModalManager,
} from "./managers";
import {
    CombatActionHandler,
    SpellActionHandler,
    InventoryActionHandler,
    EffectDispatcher,
    WidgetDialogHandler,
} from "../game/actions";
import { ProjectileSystem } from "../game/systems/ProjectileSystem";
import { GatheringSystemManager } from "../game/systems/GatheringSystemManager";
import { EquipmentHandler } from "../game/systems/EquipmentHandler";
import { TickPhaseOrchestrator } from "../game/tick/TickPhaseOrchestrator";
import { PlayerDeathService } from "../game/death/PlayerDeathService";
import { CombatEngine } from "../game/systems/combat/CombatEngine";
import { RectAdjacentRouteStrategy } from "../pathfinding/legacy/pathfinder/RouteStrategy";
import { registerAllHandlers } from "./handlers";
import { calculateAmmoConsumption } from "../game/combat/AmmoSystem";
import { canWeaponAutocastSpell, getAutocastCompatibilityMessage, getSpellData, getSpellDataByWidget } from "../data/spells";
import { ensureEquipQtyArrayOn, consumeEquippedAmmoApply, pickEquipSound, unequipItemApply } from "../game/equipment";
import { hasDirectMeleePath, hasDirectMeleeReach, isWithinAttackRange } from "../game/combat/CombatAction";
import { getSpecialAttack } from "../game/combat/SpecialAttackRegistry";
import { getSpellBaseXp } from "../game/combat/SpellXpData";
import { getProjectileParams } from "../data/projectileParams";
import { SpellCaster } from "../game/spells/SpellCaster";
import { isInWilderness, getWildernessLevel } from "../game/combat/MultiCombatZones";
import { combatEffectApplicator } from "../game/combat/CombatEffectApplicator";
import { normalizeAttackType } from "../game/combat/AttackType";
import { pickSpecialAttackVisualOverride, testRandFloat } from "./wsServer";
import { faceAngleRs } from "../../../src/rs/utils/rotation";
import { getItemDefinition } from "../data/items";
import { getRangedImpactSound } from "../../data/weapons";

export function createNpcPacketEncoder(server: any): NpcPacketEncoder {
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

export function createPlayerPacketEncoder(server: any): PlayerPacketEncoder {
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
        buildAnimPayload: (player) => server.buildAnimPayload(player),
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
            const raw = server.encodeCp1252(text);
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

export function createCombatActionHandler(server: any): CombatActionHandler {
    const services: CombatActionServices = {
        // --- Core Entity Access ---
        getPlayer: (id) => server.players?.getById(id) ?? undefined,
        getNpc: (id) => server.npcManager?.getById(id) ?? undefined,
        getCurrentTick: () => server.options.ticker.currentTick(),
        getPathService: () => server.options.pathService,

        // --- Equipment/Appearance ---
        getEquipArray: (player) => server.ensureEquipArray(player),
        getEquipQtyArray: (player) =>
            ensureEquipQtyArrayOn(player.appearance, EQUIP_SLOT_COUNT),
        markEquipmentDirty: (player) => player.markEquipmentDirty(),
        markAppearanceDirty: (player) => player.markAppearanceDirty(),

        // --- Combat Utilities ---
        pickAttackSequence: (player) => server.pickAttackSequence(player),
        pickAttackSpeed: (player) => server.pickAttackSpeed(player),
        pickHitDelay: (player) => server.pickHitDelay(player),
        getPlayerAttackReach: (player) => server.getPlayerAttackReach(player),
        pickNpcFaceTile: (player, npc) => server.pickNpcFaceTile(player, npc),
        pickCombatSound: (player, isHit) => server.pickCombatSound(player, isHit),
        getRangedImpactSound: (player) => {
            const equip = server.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            return getRangedImpactSound(weaponId);
        },
        deriveAttackTypeFromStyle: (style, player) =>
            server.deriveAttackTypeFromStyle(style, player),
        pickBlockSequence: (player) =>
            server.playerCombatManager?.pickBlockSequence(player, server.weaponAnimOverrides) ?? -1,

        // --- NPC Combat ---
        getNpcCombatSequences: (typeId) => server.getNpcCombatSequences(typeId),
        getNpcHitSoundId: (typeId) => server.getNpcHitSoundId(typeId),
        getNpcDefendSoundId: (typeId) => server.getNpcDefendSoundId(typeId),
        getNpcDeathSoundId: (typeId) => server.getNpcDeathSoundId(typeId),
        getNpcAttackSoundId: (typeId) => server.getNpcAttackSoundId(typeId),
        resolveNpcAttackType: (npc, hint) => server.resolveNpcAttackType(npc, hint),
        resolveNpcAttackRange: (npc, attackType) => server.resolveNpcAttackRange(npc, attackType),
        broadcastNpcSequence: (npc, seqId) => server.broadcastNpcSequence(npc, seqId),
        estimateNpcDespawnDelayTicksFromSeq: (seqId) =>
            server.estimateNpcDespawnDelayTicksFromSeq(seqId),

        // --- Projectile ---
        estimateProjectileTiming: (params) => server.estimateProjectileTiming(params as any),
        buildPlayerRangedProjectileLaunch: (params) =>
            server.buildPlayerRangedProjectileLaunch(params),

        // --- Spell/Magic ---
        processSpellCastRequest: (player, request) =>
            server.spellActionHandler.processSpellCastRequest(
                player,
                request as any,
                server.options.ticker.currentTick(),
            ),
        queueSpellResult: (playerId, result) => server.queueSpellResult(playerId, result),
        pickSpellSound: (spellId, stage) => server.pickSpellSound(spellId, stage),
        resetAutocast: (player) => server.resetAutocast(player),

        // --- Effect Dispatching ---
        broadcastSound: (request, tag) => server.broadcastSound(request, tag),
        withDirectSendBypass: (tag, fn) => server.withDirectSendBypass(tag, fn),
        enqueueSpotAnimation: (request) => server.enqueueSpotAnimation(request),
        queueChatMessage: (request) => server.queueChatMessage(request),
        queueCombatState: (player) => server.queueCombatState(player),
        queueSkillSnapshot: (playerId, sync) =>
            server.queueSkillSnapshot(playerId, sync as SkillSyncUpdate),
        dispatchActionEffects: (effects) =>
            server.effectDispatcher.dispatchActionEffects(effects),
        broadcast: (data, tag) => server.broadcast(data, tag),
        encodeMessage: (msg) => encodeMessage(msg as any),

        // --- Action Scheduling ---
        scheduleAction: (playerId, request, tick) =>
            server.actionScheduler.requestAction(playerId, request, tick),
        cancelActions: (playerId, predicate) =>
            server.actionScheduler.cancelActions(playerId, predicate),

        // --- Player Interaction State ---
        getPlayerSocket: (playerId) => server.players?.getSocketByPlayerId(playerId),
        getInteractionState: (socket) =>
            socket ? server.players?.getInteractionState(socket) : undefined,
        startNpcAttack: (socket, npc, tick, attackSpeed) =>
            server.players?.startNpcAttack(socket, npc, tick, attackSpeed) ?? {
                ok: false,
            },
        stopPlayerCombat: (socket) => server.players?.stopPlayerCombat(socket),
        startPlayerCombat: (socket, targetId) =>
            server.players?.startPlayerCombat(socket, targetId),
        clearInteractionsWithNpc: (npcId) => server.players?.clearInteractionsWithNpc(npcId),
        sendSkillsMessage: (socket, player) => {
            if (socket instanceof WebSocket) {
                server.sendSkillsMessage(socket, player);
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
        rollNpcDrops: (npc, eligibility) => server.rollNpcDrops(npc, eligibility),
        cleanupNpc: (npc) => server.playerCombatManager?.cleanupNpc?.(npc),

        // --- Ground Items ---
        spawnGroundItem: (itemId, quantity, location, tick, options) =>
            server.groundItems.spawn(itemId, quantity, location, tick, options),

        // --- NPC Manager ---
        queueNpcDeath: (npcId, despawnTick, respawnTick, drops) =>
            server.npcManager?.queueDeath?.(npcId, despawnTick, respawnTick, drops) ?? false,

        // --- Prayer/Combat Effects ---
        applyProtectionPrayers: (target, damage, attackType, sourceType) =>
            server.applyProtectionPrayers(target, damage, attackType, sourceType),
        applySmite: (attacker, target, damage) => server.applySmite(attacker, target, damage),
        tryActivateRedemption: (player) => server.tryActivateRedemption(player),
        closeInterruptibleInterfaces: (player) => server.closeInterruptibleInterfaces(player),
        applyMultiTargetSpellDamage: (params) => server.applyMultiTargetSpellDamage(params),

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
            getAutocastCompatibilityMessage(reason as any),

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
        onNpcKill: (playerId, npcId) => {
            server.gamemode.onNpcKill(playerId, npcId);
        },
    };
    return new CombatActionHandler(services);
}

export function createSpellActionHandler(server: any): SpellActionHandler {
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
        computeProjectileEndHeight: (opts) => server.computeProjectileEndHeight(opts),
        estimateProjectileTiming: (opts) => server.estimateProjectileTiming(opts),
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
                server.queueProjectileForViewers(launch);
            }
        },

        // --- Effects ---
        queueSpellResult: (playerId, payload) => server.queueSpellResult(playerId, payload),
        enqueueSpotAnimation: (request) => server.enqueueSpotAnimation(request),
        enqueueSpellFailureChat: (player, spellId, reason) =>
            server.enqueueSpellFailureChat(player, spellId, reason),
        pickSpellSound: (spellId, stage) => server.pickSpellSound(spellId, stage),
        broadcastSound: (request, tag) => server.broadcastSound(request, tag),
        withDirectSendBypass: (tag, fn) => server.withDirectSendBypass(tag, fn),
        resetAutocast: (player) => server.resetAutocast(player),

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
        pickAttackSequence: (player) => server.pickAttackSequence(player),
        pickSpellCastSequence: (player, spellId, isAutocast) =>
            server.pickSpellCastSequence(player, spellId, isAutocast),
        pickAttackSpeed: (player) => server.pickAttackSpeed(player),
        clearAllInteractions: (socket) => server.players?.clearAllInteractions(socket),
        clearActionsInGroup: (playerId, group) =>
            server.actionScheduler.clearActionsInGroup(playerId, group),
        startNpcCombat: (player, npc, tick, attackSpeed) => {
            server.playerCombatManager?.startCombat(player, npc, tick, attackSpeed);
        },
        stopAutoAttack: (playerId) => server.playerCombatManager?.stopAutoAttack(playerId),

        // --- Inventory ---
        sendInventorySnapshot: (socket, player) => server.sendInventorySnapshot(socket, player),

        // --- Action Scheduling ---
        scheduleAction: (playerId, request, tick) =>
            server.actionScheduler.requestAction(playerId, request, tick),

        // --- XP ---
        awardSkillXp: (player, skillId, xp) => server.awardSkillXp(player, skillId, xp),

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
                (magicCaster as any).combatSpellId = spellId;
                (magicCaster as any).autocastEnabled = false;
                (magicCaster as any).autocastMode = null;
                (magicCaster as any).getCurrentAttackType = () => "magic";
                const res = engine.planPlayerAttack({
                    player: magicCaster,
                    npc: target,
                    attackSpeed: server.pickAttackSpeed(attacker),
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

export function createInventoryActionHandler(server: any): InventoryActionHandler {
    const services: InventoryActionServices = {
        // --- Core ---
        getCurrentTick: () => server.options.ticker.currentTick(),

        // --- Entity Access ---
        getNpc: (id) => server.npcManager?.getById(id) ?? undefined,
        getPlayer: (id) => server.players?.getById(id) ?? undefined,

        // --- Inventory Operations ---
        getInventory: (player) => server.getInventory(player),
        addItemToInventory: (player, itemId, quantity) =>
            server.addItemToInventory(player, itemId, quantity),
        consumeItem: (player, slot) => server.consumeItem(player, slot),
        countInventoryItem: (player, itemId) => server.countInventoryItem(player, itemId),
        markInventoryDirty: (player) => player.markInventoryDirty(),

        // --- Equipment ---
        resolveEquipSlot: (itemId) => server.resolveEquipSlot(itemId),
        equipItem: (player, slotIndex, itemId, equipSlot, options) =>
            server.equipItem(player, slotIndex, itemId, equipSlot, options),
        unequipItem: (player, equipSlot) => {
            // OSRS parity: Unequipping closes interruptible interfaces (modals, dialogs)
            server.closeInterruptibleInterfaces(player);

            const appearance = server.getOrCreateAppearance(player);
            return unequipItemApply({
                appearance,
                equipSlot,
                addItemToInventory: (id, qty) => server.addItemToInventory(player, id, qty),
                slotCount: EQUIP_SLOT_COUNT,
            });
        },
        ensureEquipArray: (player) => server.ensureEquipArray(player),
        refreshCombatWeaponCategory: (player) => server.refreshCombatWeaponCategory(player),
        refreshAppearanceKits: (player) => server.refreshAppearanceKits(player),
        resetAutocast: (player) => server.resetAutocast(player),
        pickEquipSound: (slot, itemName) => pickEquipSound(slot, itemName),

        // --- Object Types ---
        getObjType: (itemId) => server.getObjType(itemId),
        isConsumable: (obj, option) => server.isConsumable(obj as any, option),

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
                    routeStrategy: strategy as any,
                },
            );
            return { ok: res.ok, steps: res.steps, end: res.end };
        },

        // --- Action Scheduling ---
        scheduleAction: (playerId, request, tick) =>
            server.actionScheduler.requestAction(playerId, request, tick),

        // --- Effects ---
        queueChatMessage: (request) => server.queueChatMessage(request),
        buildSkillFailure: (player, message, reason) =>
            server.buildSkillFailure(player, message, reason),
        playLocSound: (request) => server.playLocSound(request),

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

export function createEffectDispatcher(server: any): EffectDispatcher {
    const services: EffectDispatcherServices = {
        // --- Entity Access ---
        getPlayer: (id) => server.players?.getById(id) ?? undefined,
        getPlayerSocket: (playerId) => server.players?.getSocketByPlayerId(playerId),
        isSocketOpen: (socket) => socket?.readyState === WebSocket.OPEN,

        // --- Effect Queueing ---
        enqueueForcedChat: (event) => server.enqueueForcedChat(event),
        enqueueForcedMovement: (event) => server.enqueueForcedMovement(event),
        enqueueLevelUpPopup: (player, popup) => server.enqueueLevelUpPopup(player, popup),
        queueHitsplat: (hitsplat, frame) => {
            if (frame) {
                frame.hitsplats.push(hitsplat);
            } else {
                server.broadcastScheduler.queueHitsplat(hitsplat);
            }
        },

        // --- Snapshots ---
        checkAndSendSnapshots: (player, socket) => server.checkAndSendSnapshots(player, socket),

        // --- Chat ---
        queueChatMessage: (request) => server.queueChatMessage(request as any),

        // --- Sound ---
        sendSound: (player, soundId, options) => server.sendSound(player, soundId, options),

        // --- Projectile ---
        queueProjectileForViewers: (projectile) => server.queueProjectileForViewers(projectile),

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

export function createWidgetDialogHandler(server: any): WidgetDialogHandler {
    const services: WidgetDialogServices = {
        // --- Entity Access ---
        getPlayer: (id) => server.players?.getById(id) ?? undefined,
        getPlayerFromSocket: (ws) => server.players?.get(ws) ?? undefined,

        // --- Tick ---
        getCurrentTick: () => server.options.ticker.currentTick(),

        // --- Widget Events ---
        queueWidgetEvent: (playerId, action) => server.queueWidgetEvent(playerId, action as any),
        queueClientScript: (playerId, scriptId, ...args) =>
            server.queueClientScript(playerId, scriptId, ...args),
        queueVarbit: (playerId, varbitId, value) => server.queueVarbit(playerId, varbitId, value),

        // --- Script Runtime ---
        queueWidgetAction: (request) => server.scriptRuntime.queueWidgetAction(request),

        // --- Shop/Smithing/Bank ---
        closeShopInterface: (player, options) => server.scriptRuntime.getServices().closeShop?.(player),
        closeBank: (player) => server.interfaceService?.closeModal(player),
        queueSmithingInterfaceMessage: (playerId, payload) =>
            server.queueSmithingInterfaceMessage(playerId, payload as any),

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

export function createCs2ModalManager(server: any): Cs2ModalManager {
    const services: Cs2ModalManagerServices = {
        openModal: (player, interfaceId, data) =>
            server.interfaceService?.openModal(player, interfaceId, data),
        closeModal: (player) => server.interfaceService?.closeModal(player),
        getCurrentModal: (player) => server.interfaceService?.getCurrentModal(player),
        queueWidgetEvent: (playerId, event) => server.queueWidgetEvent(playerId, event as any),
        queueGameMessage: (playerId, text) =>
            server.queueChatMessage({
                messageType: "game",
                text: String(text ?? ""),
                targetPlayerIds: [playerId],
            }),
        setSmithingBarType: (player, barType) =>
            player.setVarbitValue(3216, barType),
        openSmithingForgeInterface: (player) => {
            server.scriptRuntime.getServices().production?.openForgeInterface?.(player);
        },
    };
    return new Cs2ModalManager(services);
}

export function createNpcSyncManager(server: any): NpcSyncManager {
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

export function createPlayerAppearanceManager(server: any): PlayerAppearanceManager {
    const services: PlayerAppearanceServices = {
        getPendingAppearanceSnapshots: () => server.broadcastScheduler.getPendingAppearanceSnapshots(),
        getObjTypeLoader: () => server.objTypeLoader,
        getBasTypeLoader: () => server.basTypeLoader,
        getIdkTypeLoader: () => server.idkTypeLoader,
        getDefaultBodyKits: (gender) => server.getDefaultBodyKits(gender),
        ensureEquipArray: (player) => server.ensureEquipArray(player),
        getObjType: (id) => server.getObjType(id),
        buildAnimPayload: (player) => server.buildAnimPayload(player),
        getDefaultPlayerAnimMale: () => server.defaultPlayerAnimMale,
        getDefaultPlayerAnimFemale: () => server.defaultPlayerAnimFemale,
        getDefaultPlayerAnim: () => server.defaultPlayerAnim,
        getWeaponAnimOverrides: () => server.weaponAnimOverrides,
        applyWeaponAnimOverrides: (player, animTarget) =>
            server.applyWeaponAnimOverrides(player, animTarget),
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else if (level === "debug") logger.debug(message);
            else logger.info(message);
        },
    };
    return new PlayerAppearanceManager(services);
}

export function createSoundManager(server: any): SoundManager {
    const services: SoundManagerServices = {
        getPlayers: () => server.players,
        getNpcSoundLookup: () => server.npcSoundLookup,
        getMusicRegionService: () => server.musicRegionService,
        getMusicCatalogService: () => server.musicCatalogService,
        getMusicUnlockService: () => server.musicUnlockService,
        getNpcTypeLoader: () => server.npcTypeLoader,
        getDbRepository: () => server.dbRepository,
        getWeaponData: () => server.weaponData,
        ensureEquipArray: (player) => server.ensureEquipArray(player),
        getCurrentTick: () => server.options.ticker.currentTick(),
        random: () => Math.random(),
        getVarpMusicPlay: () => VARP_MUSICPLAY,
        getVarpMusicCurrentTrack: () => VARP_MUSIC_CURRENT_TRACK,
        sendWithGuard: (sock, message, context) => server.sendWithGuard(sock, message, context),
        encodeMessage: (msg) => encodeMessage(msg as any),
        queueChatMessage: (request) => server.queueChatMessage(request),
        queueClientScript: (playerId, scriptId, ...args) =>
            server.queueClientScript(playerId, scriptId, ...args),
        queueVarp: (playerId, varpId, value) => server.queueVarp(playerId, varpId, value),
        broadcastToNearby: (x, y, level, radius, message, context) =>
            server.broadcastToNearby(x, y, level, radius, message, context),
        withDirectSendBypass: (context, fn) => server.withDirectSendBypass(context, fn),
        getNpcCombatDefs: () => server.npcCombatDefs,
        getNpcCombatDefaults: () =>
            server.npcCombatDefaults ?? {
                deathSound: 512,
            },
        loadNpcCombatDefs: () => server.loadNpcCombatDefs(),
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else if (level === "debug") logger.debug(message);
            else logger.info(message);
        },
    };
    return new SoundManager(services);
}

export function createGroundItemHandler(server: any): GroundItemHandler {
    const players = server.players;
    if (!players) {
        throw new Error("Player manager unavailable for ground item handler");
    }
    const services: GroundItemHandlerServices = {
        getGroundItems: () => server.groundItems,
        getPlayers: () => players,
        getCurrentTick: () => server.options.ticker.currentTick(),
        getPlayerGroundSerial: () => server.playerGroundSerial,
        getPlayerGroundChunk: () => server.playerGroundChunk,
        getGroundChunkKey: (player) => server.getGroundChunkKey(player),
        addItemToInventory: (player, itemId, quantity) =>
            server.addItemToInventory(player, itemId, quantity),
        getItemDefinition: (itemId) => server.getObjType(itemId) ?? getItemDefinition(itemId),
        isInWilderness: (x, y) => isInWilderness(x, y),
        sendPickupSound: (player) => server.sendSound(player, 2582),
        sendLootNotification: (player, itemId, quantity) =>
            server.sendLootNotification(player, itemId, quantity),
        trackCollectionLogItem: (player, itemId) =>
            server.collectionLogService.trackCollectionLogItem(player, itemId),
        queueChatMessage: (request) => server.queueChatMessage(request),
        sendWithGuard: (sock, message, context) => server.sendWithGuard(sock, message, context),
        encodeMessage: (msg) => encodeMessage(msg as any),
        withDirectSendBypass: (context, fn) => server.withDirectSendBypass(context, fn),
        log: (level, message) => {
            if (level === "error") logger.error(message);
            else if (level === "warn") logger.warn(message);
            else if (level === "debug") logger.debug(message);
            else logger.info(message);
        },
    };
    return new GroundItemHandler(services);
}

export function createPlayerDeathService(server: any): PlayerDeathService {
    const services: PlayerDeathServices = {
        groundItemManager: server.groundItems,
        getCurrentTick: () => server.options.ticker.currentTick(),
        isInWilderness: (x, y) => isInWilderness(x, y),
        getWildernessLevel: (x, y) => getWildernessLevel(x, y),
        getItemDefinition: (itemId) => getItemDefinition(itemId),
        sendMessage: (player, message) => {
            // Queue chat message - will be processed during broadcast phase
            server.queueChatMessage({
                messageType: "game",
                text: message,
                targetPlayerIds: [player.id],
            });
        },
        teleportPlayer: (player, x, y, level, forceRebuild = false) =>
            server.teleportPlayer(player, x, y, level, forceRebuild),
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
            server.refreshAppearanceKits(player);
            player.markAppearanceDirty();
            server.queueAppearanceSnapshot(player);
            // Note: queueAnimSnapshot is no longer needed here since the appearance block
            // now includes the animation set
        },
        sendInventoryUpdate: (player) => {
            const sock = server.players?.getSocketByPlayerId(player.id);
            if (sock) {
                server.sendInventorySnapshot(sock, player);
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

export function createProjectileSystem(server: any): ProjectileSystem {
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

export function createGatheringSystem(server: any): GatheringSystemManager {
    const services: GatheringSystemServices = {
        emitLocChange: (oldId, newId, tile, level, opts) =>
            server.emitLocChange(oldId, newId, tile, level, opts),
        spawnGroundItem: (itemId, quantity, tile, currentTick, opts) =>
            server.groundItems.spawn(itemId, quantity, tile, currentTick, opts),
    };
    return new GatheringSystemManager(services);
}

export function createEquipmentHandler(server: any): EquipmentHandler {
    const services: EquipmentHandlerServices = {
        getInventory: (player) => server.getInventory(player),
        getObjType: (itemId) => server.getObjType(itemId),
        addItemToInventory: (player, itemId, quantity) =>
            server.addItemToInventory(player, itemId, quantity),
        closeInterruptibleInterfaces: (player) => server.closeInterruptibleInterfaces(player),
        refreshCombatWeaponCategory: (player) => server.refreshCombatWeaponCategory(player),
        refreshAppearanceKits: (player) => server.refreshAppearanceKits(player),
        resetAutocast: (player) => server.resetAutocast(player),
        playLocSound: (opts) => server.playLocSound(opts),
    };
    return new EquipmentHandler(services);
}

export function createTickOrchestrator(server: any): TickPhaseOrchestrator {
    const services: TickPhaseOrchestratorServices = {
        getTickMs: () => server.options.tickMs,
        createTickFrame: (tick, time) => server.createTickFrame({ tick, time }) as any,
        setActiveFrame: (frame) => {
            server.activeFrame = frame as TickFrame | undefined;
        },
        restorePendingFrame: (frame) => server.restorePendingFrame(frame as TickFrame),
        yieldToEventLoop: (stage) => server.yieldToEventLoop(stage),
        maybeRunAutosave: (frame) => server.maybeRunAutosave(frame as TickFrame),
    };
    const phaseProvider: TickPhaseProvider = {
        broadcastTick: (frame) => server.broadcastTick(frame as TickFrame),
        runPreMovementPhase: (frame) => server.runPreMovementPhase(frame as TickFrame),
        runMovementPhase: (frame) => server.runMovementPhase(frame as TickFrame),
        runMusicPhase: (frame) => server.runMusicPhase(frame as TickFrame),
        runScriptPhase: (frame) => server.runScriptPhase(frame as TickFrame),
        runCombatPhase: (frame) => server.runCombatPhase(frame as TickFrame),
        runDeathPhase: (frame) => server.runDeathPhase(frame as TickFrame),
        runPostScriptPhase: (frame) => server.runPostScriptPhase(frame as TickFrame),
        runPostEffectsPhase: (frame) => server.runPostEffectsPhase(frame as TickFrame),
        runOrphanedPlayersPhase: (frame) => server.runOrphanedPlayersPhase(frame as TickFrame),
        runBroadcastPhase: (frame) => server.runBroadcastPhase(frame as TickFrame),
    };
    return new TickPhaseOrchestrator(services, phaseProvider);
}

export function registerMessageHandlers(server: any, router: MessageRouter): void {
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
        canUseAdminTeleport: (player) => server.isAdminPlayer(player),
        teleportPlayer: (player, x, y, level, forceRebuild = false) =>
            server.teleportPlayer(player, x, y, level, forceRebuild),
        teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
            server.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
        teleportToWorldEntity: (player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs) =>
            server.teleportToWorldEntity(player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs),
        sendWorldEntity: (player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode) =>
            server.sendWorldEntity(player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode),
        spawnLocForPlayer: (player, locId, tile, level, shape, rotation) =>
            server.spawnLocForPlayer(player, locId, tile, level, shape, rotation),
        spawnNpc: (config: any) => server.npcManager?.spawnTransientNpc(config),
        initSailingInstance: (player) => server.sailingInstanceManager?.initInstance(player),
        disposeSailingInstance: (player) => server.sailingInstanceManager?.disposeInstance(player),
        removeWorldEntity: (playerId, entityIndex) => server.worldEntityInfoEncoder.removeEntity(playerId, entityIndex),
        queueWorldEntityPosition: (playerId, entityIndex, position) => server.worldEntityInfoEncoder.queuePosition(playerId, entityIndex, position),
        setWorldEntityPosition: (playerId, entityIndex, position) => server.worldEntityInfoEncoder.setPosition(playerId, entityIndex, position),
        queueWorldEntityMask: (playerId, entityIndex, mask) => server.worldEntityInfoEncoder.queueMaskUpdate(playerId, entityIndex, mask),
        buildSailingDockedCollision: () => server.sailingInstanceManager?.buildDockedCollision(),
        applySailingDeckCollision: () => server.sailingInstanceManager?.buildDockedCollision(),
        clearSailingDeckCollision: () => server.sailingInstanceManager?.clearDockedCollision(),
        requestTeleportAction: (player, request) => server.requestTeleportAction(player, request),

        // Combat/NPC
        getNpcById: (npcId) => server.npcManager?.getById(npcId),
        startNpcAttack: (ws, npc, tick, attackSpeed, modifierFlags) =>
            server.players!.startNpcAttack(ws, npc, tick, attackSpeed, modifierFlags),
        startNpcInteraction: (ws, npc, option, modifierFlags) =>
            server.players?.startNpcInteraction(ws, npc, option, modifierFlags),
        pickAttackSpeed: (player) => server.pickAttackSpeed(player),
        startCombat: (player, npc, tick, attackSpeed) =>
            server.playerCombatManager?.startCombat(player, npc, tick, attackSpeed),
        hasNpcOption: (npc, option) => server.npcManager?.hasNpcOption(npc, option) ?? false,
        resolveNpcOption: (npc, opNum) => server.resolveNpcOptionByOpNum(npc, opNum),
        resolveLocAction: (player, locId, opNum) =>
            server.resolveLocActionByOpNum(locId, opNum, player),
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
            server.spellActionHandler.handleSpellCastMessage(
                ws,
                player,
                payload,
                targetType,
                tick,
            );
        },
        handleSpellCastOnItem: (ws, payload) => server.handleSpellCastOnItem(ws, payload),

        // Widget/Interface
        handleIfButtonD: () => {},
        handleWidgetAction: (player, payload) => {},
        handleWidgetCloseState: (player, groupId) => {
            server.cs2ModalManager.handleWidgetCloseState(player, groupId);
            server.widgetDialogHandler.handleWidgetCloseState(player, groupId);
        },
        openModal: (player, interfaceId, data) =>
            server.interfaceService?.openModal(player, interfaceId, data),
        openIndexedMenu: (player, request) =>
            server.cs2ModalManager.openIndexedMenu(player, request),
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
            server.widgetDialogHandler.openDialog(player, request as any),
        queueWidgetEvent: (playerId, event) => server.queueWidgetEvent(playerId, event as any),
        queueClientScript: (playerId, scriptId, ...args) =>
            server.queueClientScript(playerId, scriptId, ...args),
        queueVarp: (playerId, varpId, value) => server.queueVarp(playerId, varpId, value),
        queueVarbit: (playerId, varbitId, value) => server.queueVarbit(playerId, varbitId, value),
        queueNotification: (playerId, notification) =>
            server.queueNotification(playerId, notification),
        sendGameMessage: (player, text) => {
            server.queueChatMessage({
                messageType: "game",
                text,
                targetPlayerIds: [player.id],
            });
        },
        sendSound: (player, soundId, opts) => server.sendSound(player, soundId, opts),
        sendVarp: (player, varpId, value) => server.queueVarp(player.id, varpId, value),
        sendVarbit: (player, varbitId, value) => server.queueVarbit(player.id, varbitId, value),
        trackCollectionLogItem: (player, itemId) =>
            server.collectionLogService.trackCollectionLogItem(player, itemId),
        sendRunEnergyState: (ws, player) => server.sendRunEnergyState(ws, player),
        getWeaponSpecialCostPercent: (weaponId) => server.getWeaponSpecialCostPercent(weaponId),
        queueCombatState: (player) => server.queueCombatState(player),
        ensureEquipArray: (player) => server.ensureEquipArray(player),
        gamemodeServices: server.gamemode.getGamemodeServices?.() ?? {},

        // Chat
        queueChatMessage: (msg) => server.queueChatMessage(msg),
        getPublicChatPlayerType: (player) => server.getPublicChatPlayerType(player),
        enqueueLevelUpPopup: (player, data) => server.enqueueLevelUpPopup(player, data),
        findScriptCommand: (name) => server.scriptRegistry.findCommand(name),
        getCurrentTick: () => server.options.ticker.currentTick(),

        // Debug
        broadcast: (message, context) => server.broadcast(message, context),
        sendWithGuard: (ws, message, context) => server.sendWithGuard(ws, message, context),
        sendAdminResponse: (ws, message, context) =>
            server.sendAdminResponse(ws, message, context),
        withDirectSendBypass: (context, fn) => server.withDirectSendBypass(context, fn),
        encodeMessage: encodeMessage,
        setPendingDebugRequest: (requestId, ws) => server.pendingDebugRequests.set(requestId, ws),
        getPendingDebugRequest: (requestId) => server.pendingDebugRequests.get(requestId),

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
        completeLogout: (ws, player, source) => server.completeLogout(ws, player, source),
        closeInterruptibleInterfaces: (player) => server.closeInterruptibleInterfaces(player),
        noteWidgetEventForLedger: (playerId, event) => server.noteWidgetEventForLedger(playerId, event),
        normalizeSideJournalState: (player, value?) => server.normalizeSideJournalState(player, value),
        queueSideJournalGamemodeUi: (player) => server.queueSideJournalGamemodeUi(player),
        syncMusicInterface: (player) => server.soundManager.syncMusicInterfaceForPlayer(player),
        handleCs2ModalCloseState: (player, groupId) => server.cs2ModalManager.handleWidgetCloseState(player, groupId),
        handleDialogCloseState: (player, groupId) => server.widgetDialogHandler.handleWidgetCloseState(player, groupId),
        getInterfaceService: () => server.interfaceService,
        getGamemodeUi: () => server.gamemodeUi,
        getGamemode: () => server.gamemode,

        // --- Services for binary message handlers ---
        resolveGroundItemOptionByOpNum: (itemId, opNum) =>
            server.resolveGroundItemOptionByOpNum(itemId, opNum),
        handleGroundItemAction: (ws, payload) => server.handleGroundItemAction(ws, payload),
        getScriptRegistry: () => server.scriptRegistry,
        getScriptRuntime: () => server.scriptRuntime,
        getCs2ModalManager: () => server.cs2ModalManager,
        getWidgetDialogHandler: () => server.widgetDialogHandler,
        getObjType: (itemId) => server.getObjType(itemId),
        handleInventoryUseOnMessage: (ws, payload) =>
            server.handleInventoryUseOnMessage(ws, payload),
        getLevelUpPopupQueue: (playerId) =>
            (server.interfaceManager as any).levelUpPopupQueue?.get(playerId),
        advanceLevelUpPopupQueue: (player) => server.advanceLevelUpPopupQueue(player),
    };
    registerAllHandlers(router, extendedServices);

    // Simple handlers
    router.register("hello", (ctx) => {
        logger.info(`Hello from ${ctx.payload.client} ${ctx.payload.version ?? ""}`.trim());
    });

    router.register("inventory_use", (ctx) => {
        server.handleInventoryUseMessage(ctx.ws, ctx.payload);
    });

    // inventory_use_on and ground_item_action are registered by binaryMessageHandlers

    router.register("inventory_move", (ctx) => {
        server.handleInventoryMoveMessage(ctx.ws, ctx.payload);
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


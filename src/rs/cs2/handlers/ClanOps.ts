/**
 * Clan settings and channel operations
 *
 * ACTIVECLANSETTINGS_* - Access persistent clan configuration (members, ranks, permissions)
 * ACTIVECLANCHANNEL_* - Access active clan channel state (online users, worlds)
 *
 * These opcodes operate on the "active" clan which is set by FIND_LISTENED or FIND_AFFINED.
 * In this implementation, we use ctx.clanSettings and ctx.clanChannel directly.
 */
import { Opcodes } from "../Opcodes";
import type { ClanChannel, ClanSettings, HandlerMap } from "./HandlerTypes";

/**
 * Helper to safely get clan settings, returning null if not available.
 */
function getSettings(ctx: { clanSettings?: ClanSettings | null }): ClanSettings | null {
    return ctx.clanSettings ?? null;
}

/**
 * Helper to safely get clan channel, returning null if not available.
 */
function getChannel(ctx: { clanChannel?: ClanChannel | null }): ClanChannel | null {
    return ctx.clanChannel ?? null;
}

/**
 * Compute sorted member indices (alphabetically by lowercase name).
 * OSRS: ClanSettings.getSortedMembers() / ClanChannel.getSortedMembers()
 * Returns array where sortedIndices[displayIndex] = actualSlot
 */
function computeSortedIndices(names: string[]): number[] {
    // Create array of [index, lowercaseName] pairs
    const pairs: [number, string][] = names.map((name, i) => [i, (name ?? "").toLowerCase()]);
    // Sort by lowercase name
    pairs.sort((a, b) => a[1].localeCompare(b[1]));
    // Return just the original indices in sorted order
    return pairs.map((p) => p[0]);
}

export function registerClanOps(handlers: HandlerMap): void {
    // === Clan Settings ===

    // Check if listened clan settings exist (own clan)
    // Returns 1 if found, 0 if not
    handlers.set(Opcodes.ACTIVECLANSETTINGS_FIND_LISTENED, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings ? 1 : 0);
    });

    // Check if affined clan settings exist for given clan type
    // Pops: clanType (0 = own clan, 1 = guest clan)
    // Returns 1 if found, 0 if not
    handlers.set(Opcodes.ACTIVECLANSETTINGS_FIND_AFFINED, (ctx) => {
        ctx.intStackSize--; // Pop clanType (we only support one clan for now)
        const settings = getSettings(ctx);
        ctx.pushInt(settings ? 1 : 0);
    });

    // Get clan name
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETCLANNAME, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushString(settings?.name ?? "");
    });

    // Get whether unaffined (guest) users are allowed
    // Returns 1 if allowed, 0 if not
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETALLOWUNAFFINED, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.allowGuests ? 1 : 0);
    });

    // Get minimum rank required to talk
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETRANKTALK, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.rankTalk ?? 0);
    });

    // Get minimum rank required to kick
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETRANKKICK, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.rankKick ?? 0);
    });

    // Get minimum rank required for lootshare (unused in OSRS, legacy RS3)
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETRANKLOOTSHARE, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.rankLootshare ?? 0);
    });

    // Get coinshare enabled status
    // Returns 1 if enabled, 0 if not
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETCOINSHARE, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.coinshare ? 1 : 0);
    });

    // Get number of affined (registered) members
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDCOUNT, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.memberNames.length ?? 0);
    });

    // Get affined member display name by slot
    // Pops: slot
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDDISPLAYNAME, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const settings = getSettings(ctx);
        if (settings && slot >= 0 && slot < settings.memberNames.length) {
            ctx.pushString(settings.memberNames[slot]);
        } else {
            ctx.pushString("");
        }
    });

    // Get affined member rank by slot (0-127, see ClanRank)
    // Pops: slot
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDRANK, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const settings = getSettings(ctx);
        if (settings && slot >= 0 && slot < settings.memberRanks.length) {
            ctx.pushInt(settings.memberRanks[slot]);
        } else {
            ctx.pushInt(0);
        }
    });

    // Get number of banned members
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETBANNEDCOUNT, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.bannedNames.length ?? 0);
    });

    // Get banned member display name by slot
    // Pops: slot
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETBANNEDDISPLAYNAME, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const settings = getSettings(ctx);
        if (settings && slot >= 0 && slot < settings.bannedNames.length) {
            ctx.pushString(settings.bannedNames[slot]);
        } else {
            ctx.pushString("");
        }
    });

    // Get affined member extra info (bitfield extraction)
    // Pops: slot, startBit, endBit
    // Returns bits [startBit..endBit] from memberExtraInfo[slot]
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDEXTRAINFO, (ctx) => {
        const endBit = ctx.intStack[--ctx.intStackSize];
        const startBit = ctx.intStack[--ctx.intStackSize];
        const slot = ctx.intStack[--ctx.intStackSize];
        const settings = getSettings(ctx);
        if (settings && slot >= 0 && slot < settings.memberExtraInfo.length) {
            const extraInfo = settings.memberExtraInfo[slot];
            // Extract bits from startBit to endBit
            const mask = (1 << (endBit - startBit + 1)) - 1;
            ctx.pushInt((extraInfo >> startBit) & mask);
        } else {
            ctx.pushInt(0);
        }
    });

    // Get slot of current clan owner (-1 if none)
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETCURRENTOWNER_SLOT, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.currentOwnerSlot ?? -1);
    });

    // Get slot of replacement owner (-1 if none)
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETREPLACEMENTOWNER_SLOT, (ctx) => {
        const settings = getSettings(ctx);
        ctx.pushInt(settings?.replacementOwnerSlot ?? -1);
    });

    // Find affined member slot by name
    // Pops: playerName (string)
    // Returns slot index or -1 if not found
    // Iterates memberNames[] with equals()
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDSLOT, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        const settings = getSettings(ctx);
        if (settings && name) {
            for (let i = 0; i < settings.memberNames.length; i++) {
                if (settings.memberNames[i] === name) {
                    ctx.pushInt(i);
                    return;
                }
            }
        }
        ctx.pushInt(-1);
    });

    // Get sorted affined member slot by display index
    // Pops: displayIndex
    // Returns actual slot at that sorted position (-1 if invalid)
    // OSRS: ClanSettings.getSortedMembers()[displayIndex] - alphabetical by lowercase name
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETSORTEDAFFINEDSLOT, (ctx) => {
        const displayIndex = ctx.intStack[--ctx.intStackSize];
        const settings = getSettings(ctx);
        if (settings && displayIndex >= 0 && displayIndex < settings.memberNames.length) {
            // Compute sorted indices on-demand (like OSRS does lazily)
            const sortedIndices = computeSortedIndices(settings.memberNames);
            ctx.pushInt(sortedIndices[displayIndex]);
        } else {
            ctx.pushInt(-1);
        }
    });

    // Add user to ban list from channel (action - no return)
    // Pops: userSlot (in channel)
    handlers.set(Opcodes.AFFINEDCLANSETTINGS_ADDBANNED_FROMCHANNEL, (ctx) => {
        ctx.intStackSize--; // Pop userSlot
        // This would send a server request to ban the user
        // Implementation depends on server protocol
    });

    // Get affined member join date (runeday)
    // Pops: slot
    // Returns days since RuneScape epoch (Jan 1, 2002)
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDJOINRUNEDAY, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const settings = getSettings(ctx);
        if (settings && slot >= 0 && slot < settings.memberJoinDays.length) {
            ctx.pushInt(settings.memberJoinDays[slot]);
        } else {
            ctx.pushInt(0);
        }
    });

    // Set affined member muted status from channel (action - no return)
    // Pops: userSlot, muted (1 = mute, 0 = unmute)
    handlers.set(Opcodes.AFFINEDCLANSETTINGS_SETMUTED_FROMCHANNEL, (ctx) => {
        ctx.intStackSize -= 2; // Pop userSlot and muted flag
        // This would send a server request to mute/unmute the user
        // Implementation depends on server protocol
    });

    // Get affined member muted status
    // Pops: slot
    // Returns 1 if muted, 0 if not
    handlers.set(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDMUTED, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const settings = getSettings(ctx);
        if (settings && slot >= 0 && slot < settings.memberMuted.length) {
            ctx.pushInt(settings.memberMuted[slot] ? 1 : 0);
        } else {
            ctx.pushInt(0);
        }
    });

    // === Clan Channel ===

    // Check if listened clan channel exists (own clan)
    // Returns 1 if found, 0 if not
    handlers.set(Opcodes.ACTIVECLANCHANNEL_FIND_LISTENED, (ctx) => {
        const channel = getChannel(ctx);
        ctx.pushInt(channel ? 1 : 0);
    });

    // Check if affined clan channel exists for given clan type
    // Pops: clanType (0 = own clan, 1 = guest clan)
    // Returns 1 if found, 0 if not
    handlers.set(Opcodes.ACTIVECLANCHANNEL_FIND_AFFINED, (ctx) => {
        ctx.intStackSize--; // Pop clanType (we only support one channel for now)
        const channel = getChannel(ctx);
        ctx.pushInt(channel ? 1 : 0);
    });

    // Get clan channel name
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETCLANNAME, (ctx) => {
        const channel = getChannel(ctx);
        ctx.pushString(channel?.name ?? "");
    });

    // Get minimum rank required to kick in channel
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETRANKKICK, (ctx) => {
        const channel = getChannel(ctx);
        ctx.pushInt(channel?.rankKick ?? 0);
    });

    // Get minimum rank required to talk in channel
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETRANKTALK, (ctx) => {
        const channel = getChannel(ctx);
        ctx.pushInt(channel?.rankTalk ?? 0);
    });

    // Get number of online users in channel
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETUSERCOUNT, (ctx) => {
        const channel = getChannel(ctx);
        ctx.pushInt(channel?.userNames.length ?? 0);
    });

    // Get online user display name by slot
    // Pops: slot
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETUSERDISPLAYNAME, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const channel = getChannel(ctx);
        if (channel && slot >= 0 && slot < channel.userNames.length) {
            ctx.pushString(channel.userNames[slot]);
        } else {
            ctx.pushString("");
        }
    });

    // Get online user rank by slot
    // Pops: slot
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETUSERRANK, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const channel = getChannel(ctx);
        if (channel && slot >= 0 && slot < channel.userRanks.length) {
            ctx.pushInt(channel.userRanks[slot]);
        } else {
            ctx.pushInt(0);
        }
    });

    // Get online user world by slot
    // Pops: slot
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETUSERWORLD, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const channel = getChannel(ctx);
        if (channel && slot >= 0 && slot < channel.userWorlds.length) {
            ctx.pushInt(channel.userWorlds[slot]);
        } else {
            ctx.pushInt(0);
        }
    });

    // Kick user from channel (action - no return)
    // Pops: userSlot
    handlers.set(Opcodes.ACTIVECLANCHANNEL_KICKUSER, (ctx) => {
        ctx.intStackSize--; // Pop userSlot
        // This would send a server request to kick the user
        // Implementation depends on server protocol
    });

    // Find online user slot by name
    // Pops: playerName (string)
    // Returns slot index or -1 if not found
    // Iterates members with equalsIgnoreCase()
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETUSERSLOT, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        const channel = getChannel(ctx);
        if (channel && name) {
            const nameLower = name.toLowerCase();
            for (let i = 0; i < channel.userNames.length; i++) {
                if (channel.userNames[i].toLowerCase() === nameLower) {
                    ctx.pushInt(i);
                    return;
                }
            }
        }
        ctx.pushInt(-1);
    });

    // Get sorted online user slot by display index
    // Pops: displayIndex
    // Returns actual slot at that sorted position (-1 if invalid)
    // OSRS: ClanChannel.getSortedMembers()[displayIndex] - alphabetical by lowercase name
    handlers.set(Opcodes.ACTIVECLANCHANNEL_GETSORTEDUSERSLOT, (ctx) => {
        const displayIndex = ctx.intStack[--ctx.intStackSize];
        const channel = getChannel(ctx);
        if (channel && displayIndex >= 0 && displayIndex < channel.userNames.length) {
            // Use pre-computed sorted slots if available, otherwise compute on-demand
            if (channel.sortedUserSlots && displayIndex < channel.sortedUserSlots.length) {
                ctx.pushInt(channel.sortedUserSlots[displayIndex]);
            } else {
                const sortedIndices = computeSortedIndices(channel.userNames);
                ctx.pushInt(sortedIndices[displayIndex]);
            }
        } else {
            ctx.pushInt(-1);
        }
    });
}

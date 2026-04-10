# 40.5 — Sync bitstreams

`PLAYER_SYNC` and `NPC_INFO` are the largest per-tick packets and use a bit-packed format inherited from OSRS. This page documents their layout at a level that lets a reader hand-decode one.

## Why bit-packed

At the scale of a busy world, every saved bit matters. A full-byte-aligned representation of "this player took a step north this tick" would waste most of a byte. Bits let the server say "movement? yes. kind? run. direction? NE." in four bits.

Two sides share the bit stream code:

- **Server writer**: `server/src/network/BitWriter.ts`.
- **Client reader**: `src/client/sync/BitStream.ts`.

Both operate on a backing `Uint8Array` with a separate bit offset. The server exposes `writeBits(n, value)`, `writeBit`, and a `byteAlign()` that rounds up to the next byte boundary. The client mirrors with `readBits`, `readSignedBits`, `byteAlign`.

Each packet is a mix of bit-packed and byte-aligned sections. The byte-aligned section is where variable-size blobs (appearance blocks, chat text, hits) are written. The packet header indicates the bit-packed length.

## `PLAYER_SYNC` layout

High level:

```
[ local-player block ]                 ← bit-packed
[ other-players movement block ]       ← bit-packed
[ new-players block ]                  ← bit-packed
[ byte align ]
[ appearance / misc update blobs ]     ← byte-aligned
```

### Local-player block

The local player (the one the packet is addressed to) gets its own slot.

- **1 bit** — did anything change (movement, spot-anim, chat, hit, …)?
- If yes:
  - **2 bits** — movement kind:
    - `00` no movement, but has an update block (appearance etc.).
    - `01` single-step walk.
    - `10` two-step run.
    - `11` teleport or world change.
  - Movement-specific data:
    - Walk: **3 bits** direction (see `Direction.ts`).
    - Run: **3 bits + 3 bits** — two directions.
    - Teleport: **7 bits** new plane / local coord delta, plus a **1 bit** "needs map reload" marker.
  - **1 bit** — has an update block?

If no change, nothing else is written in this section.

### Other-players movement block

- **8 bits** — count of previously-visible players that will be processed.
- For each:
  - **1 bit** — any change?
  - If yes:
    - **2 bits** — movement kind (same encoding).
    - Movement data.
    - **1 bit** — has an update block?
  - If no, the player is considered idle this tick (no update).

If the player has left the local view, the block encodes a "remove" instead:

- **1 bit** — change marker.
- **2 bits** — removal code (`11`).
- No further movement data.

### New-players block

Players who weren't visible last tick but are visible now.

- Loop until a sentinel value `2047` is read:
  - **11 bits** — player index (0-2046).
  - **5 bits** — signed x delta (from the local player).
  - **5 bits** — signed y delta.
  - **1 bit** — jump (teleport into view without animation)?
  - **1 bit** — force update block?

The sentinel `2047` marks the end. The block then byte-aligns.

### Update block (byte-aligned)

For each player that signalled "has an update" above, an update block is appended in the byte-aligned section, in the same order as the bit stream. Each block begins with a mask byte (sometimes two if extended).

Mask flags include (the exact bit positions are in `AppearanceEncoder.ts`):

- **Appearance** — full appearance block: gender, head icon, equipped items, body parts, colors, combat level, total level, player name, transformed NPC id if morphing.
- **Facing entity** — `u16 targetUid`.
- **Chat** — effects byte + color byte + `cstring message` (Huffman-compressed in OSRS; XRSPS uses plain cstring for simplicity).
- **Spot-anim** — `u16 graphicId, u16 delayHeight`.
- **Hits** — `u8 count` + N × hitsplat (`type, damage, delay, max hp pair`).
- **Animation** — `u16 animId, u8 delay`.
- **Face coordinate** — `u16 worldX, u16 worldY`.
- **Force move** — source tile, destination tile, start delay, arrival delay, direction.
- **Force chat** — `cstring text` for forced overhead (NPC speech at player, etc.).
- **Name modifier** — prefix/suffix for the player name (used by gamemodes and admin badges).

The masks are additive — multiple can be set in one tick.

## `NPC_INFO` layout

Same idea, different cast.

```
[ visible NPCs movement block ]        ← bit-packed
[ new NPCs block ]                     ← bit-packed
[ byte align ]
[ NPC update blobs ]                   ← byte-aligned
```

### Visible NPCs block

- **8 bits** — count of previously-visible NPCs.
- For each:
  - **1 bit** — any change?
  - **2 bits** — movement kind (`00` no move, `01` walk, `10` run, `11` transform/remove).
  - Movement data if applicable.
  - **1 bit** — has an update block?

### New NPCs block

- Loop until sentinel:
  - **15 bits** — NPC index.
  - **5 bits** — signed x delta from the local player.
  - **5 bits** — signed y delta.
  - **14 bits** — NPC type id.
  - **1 bit** — spawn direction override?
  - **3 bits** — facing direction if override.

### Update block

Similar to players but with NPC-specific flags:

- **Transform** — `u16 newNpcId`.
- **Combat level / hp** — override for the health bar.
- **Animation** — same shape.
- **Hits** — same shape.
- **Spot-anim** — same shape.
- **Force chat** — `cstring text` for NPC overhead text.
- **Facing tile / facing entity** — same shape.

Encoded by `NpcPacketEncoder.ts`.

## Ordering rule

The server writes the bit-packed sections first because they don't need a length prefix — the decoder consumes exactly as many bits as the format dictates. The byte-aligned update blobs come second because they vary in length and rely on the mask bits in the bit stream section to know how many to expect.

On the client side, `PlayerUpdateDecoder` and `NpcUpdateDecoder` mirror this two-pass pattern: read the bit section into a list of "pending updates", then read the byte-aligned tail to fill them in.

## Interaction index encoding

Where an update refers to another unit, it uses an **interaction index** — a single `u32` packing:

- **type tag** in the high bits (0 = none, 1 = player, 2 = NPC).
- **index** in the low bits.

`0xFFFFFFFF` means "no target". The client unpacks in `PlayerSyncManager.resolveInteractionTarget`.

## Huffman (not used)

OSRS's real sync packets Huffman-compress chat text. XRSPS ships a Huffman table (`src/client/sync/HuffmanProvider.ts`) for compatibility with the reference implementation, but the live encoder currently writes plain cstrings. If you want to re-enable Huffman, flip the flag on the encoder and the decoder and share the same table on both sides.

## Handy conversions

- Direction index (0-7) starting at N going clockwise: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7. Matches `Direction.ts`.
- Plane is 2 bits (0-3).
- Region local coordinate is 6 bits (0-63) on each axis.

## Debugging tips

- The client dev overlay has a "sync packet hex" view — see [10.2](../10-client/02-main-loop.md).
- Set `SYNC_DUMP=1` on the server to log the raw bytes of every sync packet for a single tick.
- If the decoder throws "read past end of bit stream", check whether a new update flag was added without a corresponding decoder branch.

---

## Canonical facts

- **Bit writer**: `server/src/network/BitWriter.ts`.
- **Bit reader**: `src/client/sync/BitStream.ts`.
- **Player encoder**: `server/src/network/encoding/PlayerPacketEncoder.ts`.
- **NPC encoder**: `server/src/network/encoding/NpcPacketEncoder.ts`.
- **Appearance encoder**: `server/src/network/encoding/AppearanceEncoder.ts`.
- **World entity encoder**: `server/src/network/encoding/WorldEntityInfoEncoder.ts`.
- **Client player decoder**: `src/client/sync/PlayerUpdateDecoder.ts`.
- **Client NPC decoder**: `src/client/sync/NpcUpdateDecoder.ts`.
- **Client appearance decoder**: `src/client/sync/AppearanceDecoder.ts`.
- **Huffman table (unused)**: `src/client/sync/HuffmanProvider.ts`.
- **Interaction index rule**: high bits = type (1=player, 2=NPC), low bits = index; `0xFFFFFFFF` = no target.

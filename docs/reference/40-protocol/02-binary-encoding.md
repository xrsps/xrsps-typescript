# 40.2 — Binary encoding

Every packet is a binary WebSocket frame. The framing is:

```
[opcode: u8 | u16]
[size: u8 | u16 | u32 | (none)]   ← depending on opcode
[payload: N bytes]
```

The opcode determines whether there is a size prefix and what the payload shape is. This page documents the primitive encodings that payloads use.

## Opcodes

- **1-byte opcodes** — most client → server and server → client packets.
- **2-byte opcodes** — used for a handful of packets in the "extended" range. Indicated by a reserved first byte.

The opcode constants live in `src/shared/packets/ClientPacketId.ts` and `src/shared/packets/ServerPacketId.ts`.

## Sized vs fixed packets

Each opcode is one of:

- **Fixed size** — the payload has a known byte length from the opcode alone. No size prefix.
- **Size-prefixed** — the payload length is variable. The prefix is either `u8` (for up to 255 bytes) or `u16` (for larger). The decoder knows which from the opcode table.
- **Very large** (rare) — `u32` size prefix.

This is the same pattern OSRS uses.

## Primitive types

All of these are byte-aligned reads/writes from a `PacketBuffer` / `ServerPacketBuffer`:

- **`u8`, `i8`** — 1 byte.
- **`u16`, `i16`** — 2 bytes, big-endian.
- **`u24`** — 3 bytes, big-endian. Used for some coordinate fields.
- **`u32`, `i32`** — 4 bytes, big-endian.
- **`u64`, `i64`** — 8 bytes, big-endian.
- **`smart`** — OSRS's variable-length integer. If the first byte has the high bit clear, it's a `u8`; otherwise it's a `u16` with the high bit cleared. Max value `u16::MAX - 0x8000`.
- **`smart i32`** — 2 or 4 bytes depending on the high bit of the first byte.
- **`cstring`** — null-terminated ASCII / CP-1252 string. Terminator is `0x00`.
- **`jstring`** — OSRS-style string with a leading `0x00` marker and null terminator (rarely used).
- **`bytes(n)`** — raw byte range.

## Endianness

All multi-byte integers are **big-endian**. This is a historical artifact — OSRS was originally a Java client and Java's `DataInputStream` is big-endian.

## Signed values

Signed integers use two's complement. Where a field is documented as signed, the decoder uses `readI16` etc.

## String encoding

Strings are in CP-1252, not UTF-8. This matters for names with accented characters. `server/src/network/encoding/Cp1252.ts` has encoder and decoder helpers. The client uses a matching codec (implicit in how it writes strings).

## Bit streams

Some packet payloads — specifically the player and NPC sync packets — are bit-packed, not byte-aligned. The decoder reads the overall packet as bytes until it reaches the bit-packed section, then switches to bit mode.

- **`readBits(n)`** — read `n` bits (1–32) as unsigned.
- **`readSignedBits(n)`** — two's complement.
- **`byteAlign()`** — skip to the next byte boundary.

On the server side, `BitWriter` is the write counterpart. On the client side, `BitStream` is the read counterpart.

See [40.5 — Sync bitstreams](./05-sync-bitstreams.md) for the full shapes.

## Coordinate encoding

World coordinates are compactly encoded:

- **Full coordinate:** `u16 x, u16 y, u8 plane` (or two `u16` with plane packed in the upper bits).
- **Delta coordinate:** signed 7-bit delta against a known reference tile.
- **Region-relative:** `u6 localX, u6 localY` inside a 64×64 region.
- **Interaction index:** a single `u32` packing type + id for entity references.

The encoding used depends on the packet. Sync packets use deltas; initial state uses full coordinates.

## Obfuscation

None. The protocol is plaintext over the WebSocket (which may itself be TLS). There is no XOR scramble or ISAAC stream cipher like in older OSRS protocols. If you want confidentiality, use `wss://`.

## Message framing and size limits

The WebSocket frame size cap is set by `BinaryProtocol.ts` on the server and enforced by the browser on the client. Defaults are a few megabytes — large enough for worst-case sync packets and initial state, small enough to reject a malicious flood.

## Decoding errors

If a decoder reads past the end of its buffer, `PacketBuffer` throws `RangeError`. The message router catches it, logs the opcode and raw bytes, and closes the connection. This is intentional: a decoder that silently recovers would let protocol drift go unnoticed.

## Where the encoding lives

- **Client → server**: encoder in `src/network/packet/ClientBinaryEncoder.ts`, decoder in `server/src/network/packet/ClientBinaryDecoder.ts`.
- **Server → client**: encoder in `server/src/network/packet/ServerBinaryEncoder.ts`, decoder in `src/network/packet/ServerBinaryDecoder.ts`.
- **Shared primitives**: the packet buffers in each side have the same `u8/u16/…/smart` methods.
- **Bit streams**: `src/client/sync/BitStream.ts` (client read), `server/src/network/BitWriter.ts` (server write).

## Versioning

There is no version byte in the protocol. Client and server are built from the same git commit and shipped together. If you add or remove an opcode, both sides must be rebuilt and redeployed in lockstep.

## Worked example

The `WALK` packet (client → server) looks roughly like:

```
byte 0:     opcode (CLIENT_WALK)
byte 1:     payload size (u8)
byte 2-3:   target x (u16)
byte 4-5:   target y (u16)
byte 6:     modifier flags (u8)    ← shift held, etc.
```

To decode, the server reads the opcode, uses the opcode table to learn the packet is `u8`-size-prefixed, reads one byte to get the size, then reads that many bytes as the payload. The walk handler in `movementHandlers.ts` then reads `u16`, `u16`, `u8` from the payload buffer.

Adding a new field (e.g., a "source tile" for prediction reconciliation) means:

1. Bump the encoder on the client.
2. Bump the decoder on the server.
3. Rebuild both. (The server will refuse to decode an old client because the size won't match.)

---

## Canonical facts

- **Opcodes**: `src/shared/packets/ClientPacketId.ts`, `src/shared/packets/ServerPacketId.ts`.
- **Endianness**: big-endian.
- **Strings**: CP-1252, null-terminated.
- **String codec**: `server/src/network/encoding/Cp1252.ts`.
- **Client packet buffer**: `src/network/packet/PacketBuffer.ts`.
- **Server packet buffer**: `server/src/network/packet/ServerPacketBuffer.ts`.
- **Bit stream (read, client)**: `src/client/sync/BitStream.ts`.
- **Bit writer (server)**: `server/src/network/BitWriter.ts`.
- **Client encoder**: `src/network/packet/ClientBinaryEncoder.ts`.
- **Server decoder (of client packets)**: `server/src/network/packet/ClientBinaryDecoder.ts`.
- **Server encoder (of server packets)**: `server/src/network/packet/ServerBinaryEncoder.ts`.
- **Client decoder (of server packets)**: `src/network/packet/ServerBinaryDecoder.ts`.
- **Max frame size**: set by `BinaryProtocol.ts` on the server.
- **Rule**: no version byte; the protocol is pinned to the git commit.

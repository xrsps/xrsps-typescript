# 40 — Protocol reference

The XRSPS wire protocol is a bespoke, OSRS-influenced binary protocol carried over WebSocket. Every message is a single WebSocket binary frame containing an opcode byte (or multi-byte opcode), an optional size prefix, and a payload. This section documents the protocol end-to-end: connection lifecycle, encoding primitives, and the opcode catalog.

## Pages

| Page | Topic |
|---|---|
| [01 — Connection lifecycle](./01-connection-lifecycle.md) | Handshake, login, reconnect, disconnect |
| [02 — Binary encoding](./02-binary-encoding.md) | Byte layout, integer encodings, strings, bit streams |
| [03 — Client → server](./03-client-to-server.md) | Every `ClientPacketId` and what it carries |
| [04 — Server → client](./04-server-to-client.md) | Every `ServerPacketId` and what it carries |
| [05 — Sync bitstreams](./05-sync-bitstreams.md) | Player + NPC sync packet structure |

## Rule of thumb

The protocol is not API-stable. The pairing of the client and server is 1-to-1: a deployment always ships them built against the same git commit. Rolling upgrades or mixing versions is not supported. In exchange, you get a very compact wire format with no versioning overhead.

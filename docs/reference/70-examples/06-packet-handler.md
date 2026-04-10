# 70.6 — Add a client → server packet

Walks through adding a brand new `CLIENT_TIP_OF_THE_DAY` packet: the client asks the server for a random tip string, and the server replies via an existing notification packet. The goal is to show every file you'd touch when adding an opcode, not to argue for the feature.

## 1. Allocate an opcode

Pick an unused value in the client opcode range (180-255). Looking at `ClientPacketId.ts` the 230-range has 235-239 unused. Use `235`.

Add to `src/shared/packets/ClientPacketId.ts`:

```ts
export const enum ClientPacketId {
    // ... existing ...
    TIP_OF_THE_DAY = 235,
}

export const CLIENT_PACKET_LENGTHS: Record<ClientPacketId, number> = {
    // ... existing ...
    [ClientPacketId.TIP_OF_THE_DAY]: 0, // zero-length request
};
```

The shared opcode file is the single source of truth — both client and server compile against it, so adding the entry there is the first step.

## 2. Encode on the client

Open `src/network/packet/ClientBinaryEncoder.ts`. Find the `PacketWriter` class (or equivalent encode-dispatch table). Add a method:

```ts
encodeTipOfTheDay(): Uint8Array {
    const buf = new PacketBuffer(1);
    buf.writeU8(ClientPacketId.TIP_OF_THE_DAY);
    return buf.bytes();
}
```

The packet has no payload, so we just write the opcode byte. The length table saying `0` means the server will skip its length-read step entirely.

## 3. Send it from the client

Somewhere convenient in the client (for example, a menu button handler):

```ts
import { useServerConnection } from "../network/useServerConnection";

export function TipButton() {
    const conn = useServerConnection();
    return (
        <button onClick={() => conn.send(encoder.encodeTipOfTheDay())}>
            Tip of the day
        </button>
    );
}
```

`ServerConnection.send(bytes)` pushes the packet into the outbound WebSocket frame queue.

## 4. Register a server handler

Open `server/src/network/MessageRouter.ts` (or its binary dispatch sibling `packet/ClientBinaryDecoder.ts` — the exact file depends on how your MessageRouter is wired). Find the opcode dispatch table and add:

```ts
import { ClientPacketId } from "../../../src/shared/packets/ClientPacketId";
import { handleTipOfTheDay } from "./handlers/tipOfTheDayHandler";

// inside the dispatch table:
case ClientPacketId.TIP_OF_THE_DAY:
    handleTipOfTheDay(session, services);
    break;
```

## 5. Write the handler

`server/src/network/handlers/tipOfTheDayHandler.ts`:

```ts
import type { PlayerSession } from "../PlayerSession";
import type { ServerServices } from "../../game/ServerServices";

const TIPS = [
    "Click the minimap to walk there.",
    "Right-click any entity to see its options.",
    "Press Tab to jump to chat.",
    "Use ::home to teleport home (if enabled).",
    "The sync packet is bit-packed — read 40.5 in the docs.",
];

export function handleTipOfTheDay(
    session: PlayerSession,
    services: ServerServices,
): void {
    const player = session.player;
    if (!player) return;

    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];

    // Pipe it back as a chat message (a server packet we already have).
    services.chat.sendGameMessage(player, `Tip of the day: ${tip}`);
}
```

No new server-side packet is needed — we reuse `sendGameMessage`, which funnels through the existing `CHAT_MESSAGE` broadcaster.

## 6. Rebuild both sides

```sh
# in dev: mprocs restarts both tabs on edits
# in CI / prod: build:all
bun run build:all
```

Because `CLIENT_TIP_OF_THE_DAY` is in the shared opcode file, TypeScript will walk you through any missing handlers on either side at compile time — the `Record<ClientPacketId, number>` type makes the length table exhaustive.

## 7. Verify

Click the **Tip of the day** button in the client. A chat message should appear:

> Tip of the day: The sync packet is bit-packed — read 40.5 in the docs.

Server log should show:

```
[network] handled TIP_OF_THE_DAY from player=<name>
```

(if your logger is set to debug).

## What you touched

1. **`src/shared/packets/ClientPacketId.ts`** — opcode + length table.
2. **`src/network/packet/ClientBinaryEncoder.ts`** — client encoder method.
3. **One React component** — callsite.
4. **`server/src/network/MessageRouter.ts`** — dispatch.
5. **`server/src/network/handlers/tipOfTheDayHandler.ts`** — the actual handler.

No broadcaster, no new server opcode — the reply used existing plumbing.

## Variation: adding a payload

If the request needed a payload (say a `u16 category` parameter):

- Change the length table entry to `2` (fixed) or `-1` (`u8` size prefix) depending on whether the payload is fixed or variable.
- Update the client encoder to write the payload bytes after the opcode.
- Update the server handler to read the payload via `session.buffer.readU16()`.
- Both sides must agree on the shape — mismatched lengths will throw `RangeError` in the decoder, the connection closes, and the server logs the raw bytes.

## Canonical facts

- **Opcode source of truth**: `src/shared/packets/ClientPacketId.ts`.
- **Length table rule**: every `ClientPacketId` entry must have a matching `CLIENT_PACKET_LENGTHS` row (enforced by `Record<ClientPacketId, number>`).
- **Client encoder**: `src/network/packet/ClientBinaryEncoder.ts`.
- **Server decoder**: `server/src/network/packet/ClientBinaryDecoder.ts`.
- **Server router**: `server/src/network/MessageRouter.ts`.
- **Reuse server packets** when possible — a new request doesn't always need a new response opcode.
- **Rule**: client and server built from the same commit; there is no version byte.

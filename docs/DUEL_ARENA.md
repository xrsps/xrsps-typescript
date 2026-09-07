# Duel Arena

The default game brings **human players** together in a shared sandstone courtyard.
Players can walk around, challenge each other, trade currency, and manage their
own saved inventory and bank. Accepted duels use the existing OSRS combat engine
in a separate ring. The camera follows your player, with adjustable rotation,
tilt, and zoom.

## Play locally

1. Run `yarn start` from the repository root, then open `http://localhost:3000`.
   Use two browser sessions with different player names to test both sides. The
   first login registers an account; passwords are 8–20 characters.
2. New accounts receive **1,000,000 gold once**. Returning accounts retain their
   balances. Accounts from the previous duel version receive this grant once on
   their first login after the currency update.
3. Click the courtyard floor to walk. Right-click another player and choose
   **Challenge**, then select **Dragon dagger P++** or **Abyssal whip**. The chosen
   weapon applies to both fighters and cannot change during that fight.
4. The other player accepts the challenge. Both players see the stake interface
   and can offer gold, platinum tokens, or both from their inventories. Different
   amounts are allowed, including a free duel with zero stakes.
5. Save any changed offer, then both press **Accept offer**. Check the final
   amounts and weapon, then both press **Confirm & fight**. Editing either offer
   clears both players' acceptance and returns to the offer screen.
6. Both stakes are secured before the three-second countdown. Use **Attack** or
   click the opponent to fight. Click the ring floor to move. **Special attack**
   costs 25% energy for the dagger or 50% for the whip.
7. The winner receives the full combined stake, with **no tax**. Players return
   to the courtyard after the result. A new challenge starts a fresh offer;
   previous stakes and confirmations are never reused.

Every fight starts with equal level-99 combat stats, 99 hitpoints, and full special
energy. Equipment is supplied for the duel. Inventory and bank contents survive
preparation, death, returning to the lobby, and reconnecting. The focused mode
does not expose food, prayer, equipment changes, or other open-world actions.

Use the **mouse wheel** over the world to zoom. **Left/right arrows** rotate the
view and **up/down arrows** tilt it. The camera continues following your player
as you roam. Chat, menus, and other interface controls keep keyboard and wheel
input within the interface.

The original compact courtyard is centred at **(3377, 3232, plane 0)**, with
bounds **X 3367–3387 / Y 3226–3239** (21×14 tiles). Palms, benches, statues,
bank chests and the shopkeeper surround its clear central crossing.
The native arena arcade remains intact; loose spear barricades and ruined
masonry fragments are removed from the combat ring while its walls, statues
and flags remain.

## Banking and trading

Open **Bank & inventory** in the lobby to deposit or withdraw either currency.
Inventory balances are available for stakes and trades; bank balances must first
be withdrawn. The exchange rate is **1 platinum token = 1,000 gold**.
Gold and platinum use their original cache item sprites (items 995 and 13204),
including the appropriate coin-pile image for the displayed amount.
The small quantity labels on these sprites follow the native stack format:

| Quantity | Label colour and format | Example |
| --- | --- | --- |
| Below 100,000 | Yellow, whole amount | `99999` |
| 100,000 to 9,999,999 | White, thousands (`K`) | `1000K` for 1,000,000 |
| 10,000,000 and above | Green, millions (`M`) | `10M` for 10,000,000 |

Abbreviated labels round down; the balance and offer fields retain the exact
amount. An empty stack has no overlaid quantity label.

Right-click a nearby player and choose **Trade**. After they accept the request,
both players enter their offers, review them, and confirm. Changes reset both
approvals. Currency only moves when both players confirm the final trade.
Cancelling or disconnecting before confirmation leaves both balances unchanged.

Banking and exchanges are unavailable while a duel or trade is open. The current
interface trades gold and platinum tokens. Other saved items remain in their
containers but are not offered through this currency interface.

## Courtyard shop

Right-click the shopkeeper near the bank and choose **Talk-to**, or enter
**::shop** in chat, to open **The Arena Exchange**. Choose a gold or platinum
package, review the signed-in account and amount, then enter an email address
to prepare an order draft.

Packages are maintained in [`client/common/duel/DuelShop.ts`](../client/common/duel/DuelShop.ts).
This catalog defines their IDs, currency amounts, names, descriptions, and
pouch/bundle/chest presentation. Prices are currently unconfigured and show
**Pricing coming soon**.

The shop currently creates an **unpaid draft in the browser session only**.
It does not take payment, send the email address, persist an order, or grant
currency. Reloading the page or signing out clears the draft. Payment processing
and purchase fulfilment are not connected.

## Public chat

The original cache parchment and bottom channel tabs show messages from everyone in the courtyard,
including players outside the nearby model-rendering range. Press **Enter** from
the world or click its input to start typing; press **Enter** again to send. Arrow keys and scrolling over chat
do not control the camera. **Escape** leaves the input.

The panel keeps the most recent 100 messages, supports scrolling, and can
be collapsed by clicking its selected channel tab. **All**, **Game**, **Public**,
**Trade**, and **Duel** filter actual message and request history. Private chat,
clan chat, and abuse reporting remain visibly unavailable. It shows an unread count when messages
arrive while collapsed or while reading older lines. Public text renders as plain
text, and each message is delivered once to its audience. The lobby and isolated
duel audiences are separate. On entering the ring the panel collapses to keep
combat controls clear; open **Public** or press **Enter** to speak to your
opponent. Its audience label changes to **Your duel**.
Nearby players also see speech above the speaker's actual model in native yellow
text for about three seconds. Distant messages still reach the courtyard history
without creating models or duplicate chat lines. Enter **::shop** to open the
local shop interface; the command is not broadcast as public speech.

## Server rules and persistence

- Lobby players share visibility and movement space. Each active duel contains
  exactly two players and has separate movement reservations and visibility.
- Negotiating players cannot move until they complete or cancel the interaction.
  Lobby and ring movement stay within their respective bounds; scenery also
  blocks movement. Attack selection and deferred damage both validate the active
  pair. The server rejects weapon changes throughout countdown and combat.
- Duel requests expire after 60 seconds; trade requests after 30 seconds. Only the
  intended recipient can accept, and both players must still be available.
- Every stake or trade approval includes its session ID and offer revision.
  Delayed commands from an earlier offer or session cannot approve a replacement.
- Cancellation during negotiation leaves currency untouched. Leaving or
  disconnecting during countdown refunds both stakes. Leaving or disconnecting
  after combat starts awards the full stake to the other fighter.
- Currency mutations, both player saves, and escrow records commit together in
  SQLite. A failed mutation rolls back both in-memory and stored balances.
  Results settle once; temporary settlement failures retry using current player
  instances, and offline recipients receive durable credits.
- A server restart refunds unresolved escrows to their original owners. Login
  collects those refunds without repeating the starting grant. Completed results
  and trades never replay.
- Each currency stack is limited to 2,147,483,647 in inventory and bank. Duel
  awards fill inventory, then bank. Any overflow remains a durable credit and is
  collected when a later login, bank action, or exchange creates capacity.
- The `duel` gamemode saves accounts under `server/data/gamemodes/duel` (or
  `$XRSPS_DATA_DIR/duel`), separately from vanilla accounts.

## Commands and protocol

The React controls and context menu send these commands through the existing
binary chat packet. Amounts are whole non-negative integers; bank actions and
exchanges require positive amounts. IDs and revisions come from the latest
server-authored snapshot.

| Command after `::duel` | Effect |
| --- | --- |
| `challenge <playerId> <dagger\|whip>` | Send a challenge with one shared weapon |
| `respond <requestId> <accept\|decline>` | Answer a received duel challenge |
| `offer <roomId> <revision> <gold> <platinum>` | Set a stake or return from final review |
| `accept <roomId> <revision>` | Approve the current stake |
| `confirm <roomId> <revision>` | Confirm the reviewed stake and weapon |
| `attack` / `special` | Attack the paired opponent |
| `leave` | Cancel, leave the result, or forfeit active combat |
| `bank <deposit\|withdraw> <gold\|platinum> <amount>` | Move currency between personal containers |
| `exchange <gold\|platinum> <amount>` | Convert inventory currency |
| `trade_request <playerId>` | Send a nearby player a trade request |
| `trade_accept <requestId>` / `trade_decline <requestId>` | Answer a trade request |
| `trade_offer <tradeId> <revision> <gold> <platinum>` | Set or edit a trade offer |
| `trade_review <tradeId> <revision>` | Approve the offer and open final review |
| `trade_confirm <tradeId> <revision>` | Confirm the final exchange |
| `trade_cancel <tradeId>` | Close an uncompleted trade |

The duel snapshot uses binary protocol **version 2** and includes lobby players,
requests, wallet balances, stake revisions, trade state, and combat state. The
roster payload is capped at 256 entries; this does not change the world-sync
player limit. Malformed nested amounts, flags, lists, strings, and overlong
packets are rejected. `eyes.duel()` exposes the decoded snapshot for inspection.

## Deploy together

Update both the game server and client; version 1 private-room clients are not
compatible with the new snapshot protocol.

- **Fly.io:** run the server with `GAMEMODE=duel`. The existing configuration uses
  this default; environment overrides still take precedence. Preserve the game
  database volume when updating the server.
- **Vercel:** build the updated client with the existing `vercel.json` and
  `REACT_APP_GAME_HOST`. No new client environment variables are needed.
- The custom courtyard is delivered through the gamemode content packet. Its
  sandstone walls, paths, palms, statues, benches, and bank chests use existing
  cache assets with matching server collision. The original combat ring remains
  part of the installed OSRS cache.

For engine maintenance, `?classic=1` restores the traditional client interface.
That flag does not change server rules; the open-world game requires a separate
server running `GAMEMODE=vanilla`.

## Verification

Run `yarn --cwd client typecheck`, `yarn --cwd client test`,
`yarn --cwd server typecheck`, and `yarn --cwd server test`.

Server tests cover protocol fixtures, malformed packets, request ownership and
expiry, revised offers, fixed weapons, movement and damage isolation, safe death,
refunds, forfeits, persistent balances, rollback, replay protection, overflow,
and reconnect/restart recovery.

With both local services already running, run
`yarn --cwd tools/eyes test:duel-lobby` for the two-browser lobby workflow. It
checks roaming, real player context menus, banking, currency conversion, trading,
stake confirmation, fixed weapons, combat, forfeits, and persistent balances.
Set `EYES_FULL_DUEL=1` to wait for a full combat death as well. `test:duel` is an
alias for the lobby workflow. `yarn --cwd tools/eyes test:duel-ui` checks keyboard
login, password-error recovery, bank persistence, logout, mobile layout, and
closing dialogs with Escape.
`yarn --cwd tools/eyes test:duel-reload` checks two consecutive sign-out,
page-reload, and sign-in cycles against the same saved inventory and bank.
`yarn --cwd tools/eyes test:duel-chat` checks two real players speaking, delivery
beyond the nearby player range, Enter-to-send, plain text rendering, scrollable
history, collapse, opponent chat in the ring, mobile layout, and camera isolation
while typing. `yarn --cwd tools/eyes test:duel-camera` checks wheel zoom, arrow-key
rotation and tilt, player following, bank-input isolation, original currency
sprites, and scenery at maximum zoom and low camera pitch.
`yarn --cwd tools/eyes test:duel-context` verifies that real player right-clicks,
including right-clicks on the open game menu, suppress the browser context menu.
`yarn --cwd tools/eyes test:duel-shop` checks the real shopkeeper, `::shop`, native
pouch/chest art, both currencies, account/email checkout, explicit order submission,
keyboard focus, unchanged balances, and mobile layout. Set `EYES_CHROMIUM` to your
installed Google Chrome executable to run these checks in Chrome.

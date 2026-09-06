# Duel Arena

The default game uses the original cache-driven OSRS client: its **765 × 503 fixed
gameframe**, minimap, combat styles, inventory, settings, bank, chatbox, player
menus and walking. Human players meet in the original Duel Arena courtyard and
fight in a separate ring. Duel offers, currency trades and the shop remain
additional windows over that client; there is no replacement fullscreen HUD.

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
4. The other player clicks the challenge request in the native chatbox, or
   right-clicks that line and chooses **Accept challenge**. Both see the stake interface
   and can offer gold, platinum tokens, or both from their inventories. Different
   amounts are allowed, including a free duel with zero stakes.
5. Save any changed offer, then both press **Accept offer**. Check the final
   amounts and weapon, then both press **Confirm & fight**. Editing either offer
   clears both players' acceptance and returns to the offer screen.
6. Both stakes are secured before the three-second countdown. Use the opponent's
   native **Attack** option to fight and click the ring floor to move. The native
   **Combat Options** tab controls attack style, auto-retaliate and special attack.
   A special attack costs 25% energy for the dagger or 50% for the whip.
7. The winner receives the full combined stake, with **no tax**. Players return
   to the courtyard after the result. A new challenge starts a fresh offer;
   previous stakes and confirmations are never reused.

Every fight starts with equal level-99 combat stats, 99 hitpoints, and full special
energy. Equipment is supplied for the duel. Inventory and bank contents survive
preparation, death, returning to the lobby, and reconnecting. Native tabs remain
visible, while the server disallows food, prayer, equipment changes, teleports
and actions outside the duel rules.

Use the **mouse wheel** over the world to zoom. **Left/right arrows** rotate the
view and **up/down arrows** tilt it. The camera continues following your player
as you roam. Typing uses the classic chat input; letter keys do not steer the
camera. Arrow keys retain the original camera controls.

The original north waiting courtyard is centred at **(3367, 3267, plane 0)**,
with bounds **X 3357–3388 / Y 3261–3274**. Its terrain, walls, original buildings,
scenery and walking collision come directly from the installed OSRS cache.
The earlier custom plaza and arena scenery removals are no longer applied.
The bank uses the native open chests at **(3381, 3269)** and **(3382, 3270)**;
the shopkeeper stands at **(3370, 3267)**. The existing duel ring remains centred
at **(3378, 3251)**, separate from the waiting courtyard.

New arrivals use connected native floor tiles and avoid the shopkeeper, bank
chests and closed rooms. The cache-derived arrival map never replaces live
walking collision. After changing the installed cache or courtyard bounds, run
`yarn --cwd server tsx scripts/inspect-native-duel-courtyard.ts --write` to rebuild
the arrival data, then rerun without `--write` to verify it against the cache.

## Banking and trading

Choose **Bank** on either original courtyard bank chest to open the native bank.
Use its inventory deposit controls and item withdrawal menu to move saved items.
Inventory balances are available for stakes and trades; bank balances must first
be withdrawn. Choose **Exchange tokens** on the shopkeeper, or type **::exchange**,
to convert inventory currency at **1 platinum token = 1,000 gold**.
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

Right-click a nearby player and choose **Trade with**. The recipient accepts the
request through its native chatbox line. After they accept,
both players enter their offers, review them, and confirm. Changes reset both
approvals. Currency only moves when both players confirm the final trade.
Cancelling or disconnecting before confirmation leaves both balances unchanged.

Banking and exchanges are unavailable while a duel or trade is open. The current
interface trades gold and platinum tokens. Other saved items remain in their
containers but are not offered through this currency interface.

## Courtyard shop

Right-click the courtyard shopkeeper and choose **Talk-to**, or enter
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

The original parchment chatbox and cache-scripted channel controls render the
conversation. With the game focused, type directly beside your player name and
press **Enter** to send; there is no extra Enter-to-start step. Scrolling, channel
selection and request menus use the original widgets.

Public messages reach everyone in the courtyard, including players outside the
nearby model-rendering range. Nearby players also see native yellow speech above
the speaker's model for about three seconds. Distant messages do not create
extra player models or duplicate history lines. Each active duel has its own
two-player chat audience, separate from the lobby.

Duel and trade requests appear as clickable native chat lines. Each line refers
to its exact request and recipient; expired or already-consumed lines cannot
accept a later request. **::shop** and **::exchange** open local duel windows and
are not broadcast as speech. These shortcuts do not intercept vanilla-server
commands when no duel account is active.

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

Duel negotiation windows and native player-menu actions send these commands
through the existing binary chat packet. Original bank and combat widgets also
use their normal client packets, validated by the duel server's allowed actions.
Amounts are whole non-negative integers; bank actions and
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
| `bank open` | Open the native bank while free in the courtyard |
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
- The courtyard and arena load their original cache terrain and scenery. The duel
  content packet identifies the gamemode and clears prior session overrides;
  it does not replace map objects, floors, heights or collision.

The traditional client interface is now the default in duel mode. The open-world
game still requires a separate server running `GAMEMODE=vanilla`.

## Verification

Run `yarn --cwd client typecheck`, `yarn --cwd client test`,
`yarn --cwd server typecheck`, and `yarn --cwd server test`.

Server tests cover the fixed-gameframe mapping, native bank and combat action
permissions, protocol fixtures, malformed packets, request ownership and
expiry, revised offers, fixed weapons, movement and damage isolation, safe death,
refunds, forfeits, persistent balances, rollback, replay protection, overflow,
and reconnect/restart recovery.

Client tests also cover native player-menu callbacks, exact chat-request identity,
stale requests, classic typing and standalone overhead speech. Focused native
checks are available as `yarn --cwd client test:duel-native` and
`yarn --cwd server test:duel-native`.

With both local services already running, set `EYES_CHROMIUM` to the installed
Google Chrome executable and run these real-input browser suites:

| Command in `tools/eyes` | Coverage |
| --- | --- |
| `yarn test:duel-native` | Fixed gameframe and tabs, click-to-walk, wheel/arrow camera, public and overhead chat, native player context menu, challenge window, native bank deposit/withdraw |
| `yarn test:duel-native-flow` | Two humans accept native trade/challenge request lines, revise offers, fight with both weapons through native combat controls, receive full payouts and retain balances after native logout/reload |
| `yarn test:duel-native-shop` | Native chat opens the package shop and currency exchange; username/email checkout creates an unpaid draft without granting currency |
| `yarn test:duel` | All three suites, sequentially |

The previous `test:duel-lobby` and `test:duel-reload` commands now run the native
flow suite. `test:duel-chat`, `test:duel-camera`, `test:duel-context` and
`test:duel-ui` run the native foundation suite; `test:duel-shop` runs the native
shop suite. These scripts no longer run tests targeting the retired fullscreen
HUD. Suites save screenshots and state in `tools/eyes/tests/out/` before and
after actions. A suite is verified only when its actual run completes successfully.
For a focused single-browser bank check, set `EYES_NATIVE_BANK_ONLY=1` when running
`test:duel-native`; leave it unset for the complete two-player foundation suite.
